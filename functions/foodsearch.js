// Glidna — FatSecret food-search proxy client (S93).
//
// FatSecret's free tier only answers requests from WHITELISTED IPs, and Cloud
// Functions have dynamic IPs — so we route through a tiny always-on proxy server
// that has ONE fixed, whitelisted IP (see proxy/ + proxy/README.md). This Cloud
// Function stays the authenticated entry point: it checks the Firebase user, calls
// the proxy (shared-secret protected), parses FatSecret's response, and returns
// normalized per-100g foods. The FatSecret credentials live ON the proxy, not here.
//
// Results are used as a FALLBACK by the app (searchFoods in src/App.jsx only calls
// this when USDA + Open Food Facts come up short) to conserve API calls, and every
// FatSecret result is tagged source:"fatsecret" so the UI can flag it.
//
// ACTIVATION (when ready — see proxy/README.md):
//   1. Deploy the proxy VM, note its static IP, whitelist it in FatSecret.
//   2. Set the two proxy secrets, then redeploy this function:
//        printf 'https://PROXY_HOST' | firebase functions:secrets:set FATSECRET_PROXY_URL    --project calorieiq-29762 --data-file=-
//        printf 'SHARED_SECRET'       | firebase functions:secrets:set FATSECRET_PROXY_SECRET --project calorieiq-29762 --data-file=-
//        firebase deploy --only functions:foodSearch --project calorieiq-29762
// Until the proxy URL is set it returns { foods: [], configured: false } — a safe
// no-op (the app keeps using USDA + Open Food Facts).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const FATSECRET_PROXY_URL = defineSecret("FATSECRET_PROXY_URL");
const FATSECRET_PROXY_SECRET = defineSecret("FATSECRET_PROXY_SECRET");

const tidy = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const _n = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

// Micronutrient keys the app understands (matches MICRO_MAP in src/App.jsx). We
// take only the ones FatSecret reports in reliable absolute units; vitamins are
// skipped (FatSecret's vitamin units are % RDI / IU and inconsistent).
function v3Micros(s, per100Factor) {
  const raw = {
    fiber: _n(s.fiber), sugar: _n(s.sugar), satFat: _n(s.saturated_fat),
    monoFat: _n(s.monounsaturated_fat), polyFat: _n(s.polyunsaturated_fat),
    cholesterol: _n(s.cholesterol), sodium: _n(s.sodium), potassium: _n(s.potassium),
    calcium: _n(s.calcium), iron: _n(s.iron),
  };
  const out = {};
  for (const k of Object.keys(raw)) {
    if (raw[k] > 0) { const v = raw[k] * per100Factor; out[k] = v >= 10 ? Math.round(v) : Math.round(v * 100) / 100; }
  }
  return Object.keys(out).length ? out : null;
}

// Parse a foods.search.v3 food object (has a `servings.serving[]` array with a
// real household serving + micros). Returns a per-100g food WITH a realistic
// default serving (grams + label) so the picker opens at "1 cup"/"1 breast"
// instead of a flat 100 g (Kevin's S94e ask), plus per-100g micronutrients.
function parseV3Food(f) {
  let servings = f.servings && f.servings.serving;
  if (!servings) return null;
  if (!Array.isArray(servings)) servings = [servings];
  servings = servings.filter(Boolean);
  if (!servings.length) return null;

  // per-100g basis: prefer an exact "100 g" gram serving; else derive from any
  // gram (or ml) serving by scaling to 100.
  const gramS = servings.filter((s) => /^(g|ml)$/i.test(String(s.metric_serving_unit || "")) && _n(s.metric_serving_amount) > 0);
  const src = gramS.find((s) => Math.round(_n(s.metric_serving_amount)) === 100) || gramS[0];
  if (!src) {
    // No metric basis at all → treat the default serving as the whole unit.
    const d = servings.find((s) => String(s.is_default) === "1") || servings[0];
    const kcal = Math.round(_n(d.calories));
    if (!(kcal > 0)) return null;
    return { per: "serving", servingLabel: String(d.serving_description || "serving").slice(0, 40),
      kcal, p: Math.round(_n(d.protein)), c: Math.round(_n(d.carbohydrate)), f: Math.round(_n(d.fat)),
      micros: v3Micros(d, 1) };
  }
  const amt = _n(src.metric_serving_amount);
  const k = 100 / amt;
  const baseUnit = /ml/i.test(String(src.metric_serving_unit)) ? "ml" : "g";
  const per100 = { kcal: Math.round(_n(src.calories) * k), p: Math.round(_n(src.protein) * k),
    c: Math.round(_n(src.carbohydrate) * k), f: Math.round(_n(src.fat) * k) };
  if (!(per100.kcal > 0)) return null;

  // Realistic DEFAULT serving: the is_default one, unless it's a plain weight
  // ("100 g") — then prefer a descriptive household serving ("1 cup, diced").
  const weightOnly = (s) => /^(g|ml|oz|gram|grams)$/i.test(String(s.measurement_description || "").trim());
  let def = servings.find((s) => String(s.is_default) === "1");
  if (!def || weightOnly(def)) {
    const household = servings.find((s) => !weightOnly(s) && /^(g|ml)$/i.test(String(s.metric_serving_unit || "")) && _n(s.metric_serving_amount) > 0);
    if (household) def = household;
  }
  if (!def) def = src;
  const defGrams = _n(def.metric_serving_amount);
  const defUnit = /ml/i.test(String(def.metric_serving_unit)) ? "ml" : "g";

  return { per: "100g", kcal: per100.kcal, p: per100.p, c: per100.c, f: per100.f,
    unit: baseUnit,
    serving: (defGrams > 0 && defUnit === baseUnit) ? Math.round(defGrams) : null,
    servingText: (defGrams > 0) ? String(def.serving_description || "").slice(0, 40) : "",
    micros: v3Micros(src, k) };
}

// FatSecret's LEGACY (v1) search returns a text food_description, e.g.
//   "Per 100g - Calories: 155kcal | Fat: 10.61g | Carbs: 1.12g | Protein: 12.58g"
// Parse it and normalize to PER-100g (the app's picker assumes per-100g). Only
// gram-based servings can be normalized; non-gram servings ("1 cup") are skipped.
// Kept as a fallback so the function works whether the proxy is on v1 or v3.
function parsePer100(desc) {
  const m = String(desc || "").match(
    /Per\s+(.+?)\s*-\s*Calories:\s*([\d.]+)\s*kcal\s*\|\s*Fat:\s*([\d.]+)\s*g\s*\|\s*Carbs:\s*([\d.]+)\s*g\s*\|\s*Protein:\s*([\d.]+)\s*g/i
  );
  if (!m) return null;
  const serving = m[1].trim();
  const kcal = parseFloat(m[2]), f = parseFloat(m[3]), c = parseFloat(m[4]), p = parseFloat(m[5]);
  // Gram-based serving → normalize to per-100g (like USDA/OFF, so the grams picker
  // scales it). Non-gram serving ("1 scoop", "1 container") → keep the macros AS the
  // serving and tell the app it's per-serving so it offers a servings picker instead
  // of grams. (Dropping these was silently hiding most branded/supplement results.)
  let grams = null;
  if (/^100\s*g$/i.test(serving)) grams = 100;
  else { const gm = serving.match(/^([\d.]+)\s*g$/i); if (gm) grams = parseFloat(gm[1]); }
  if (grams > 0) {
    const k = 100 / grams;
    return { per: "100g", kcal: Math.round(kcal * k), p: Math.round(p * k), c: Math.round(c * k), f: Math.round(f * k) };
  }
  return { per: "serving", servingLabel: serving.slice(0, 40),
    kcal: Math.round(kcal), p: Math.round(p), c: Math.round(c), f: Math.round(f) };
}

// Exposed for local parser testing (node -e require + mock v3 payloads).
exports._parseV3Food = parseV3Food;
exports._parsePer100 = parsePer100;

exports.foodSearch = onCall(
  { secrets: [FATSECRET_PROXY_URL, FATSECRET_PROXY_SECRET], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const proxyUrl = FATSECRET_PROXY_URL.value(), proxySecret = FATSECRET_PROXY_SECRET.value();
    if (!proxyUrl || !proxySecret || /placeholder/i.test(proxyUrl) || /placeholder/i.test(proxySecret)) {
      return { foods: [], configured: false };
    }
    const q = String((request.data && request.data.query) || "").trim().slice(0, 80);
    if (q.length < 2) return { foods: [] };

    const url = `${proxyUrl.replace(/\/+$/, "")}/search?q=${encodeURIComponent(q)}`;
    let j;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(url, { headers: { "x-proxy-secret": proxySecret }, signal: ctl.signal });
      if (!r.ok) { console.error("foodSearch proxy http", r.status); return { foods: [], error: "proxy" }; }
      j = await r.json();
    } catch (e) { console.error("foodSearch proxy", e && e.message); return { foods: [], error: "proxy" }; }
    finally { clearTimeout(t); }

    // The proxy returns FatSecret's raw JSON; parse it here so the FatSecret
    // response shape stays in our versioned code (the proxy is a dumb pipe).
    // Handle BOTH envelopes so this works whether the proxy is on v3 (returns
    // `foods_search.results.food[]` with real servings + micros) or the legacy
    // v1 (`foods.food[]` with a text description) — safe during rollout.
    let arr = (j && j.foods_search && j.foods_search.results && j.foods_search.results.food)
      || (j && j.foods && j.foods.food);
    if (!arr) return { foods: [] };
    if (!Array.isArray(arr)) arr = [arr];
    const out = [];
    for (const f of arr) {
      const macros = (f.servings && f.servings.serving) ? parseV3Food(f) : parsePer100(f.food_description);
      if (!macros || !(macros.kcal > 0)) continue;
      out.push({ name: tidy(f.food_name), brand: f.brand_name ? tidy(f.brand_name) : "",
        kcal: macros.kcal, p: macros.p, c: macros.c, f: macros.f, source: "fatsecret",
        per: macros.per, servingLabel: macros.servingLabel || "",
        unit: macros.unit || "g", serving: macros.serving || null,
        servingText: macros.servingText || "", micros: macros.micros || null });
    }
    return { foods: out };
  }
);
