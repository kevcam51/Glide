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

// FatSecret's search returns a text food_description, e.g.
//   "Per 100g - Calories: 155kcal | Fat: 10.61g | Carbs: 1.12g | Protein: 12.58g"
// Parse it and normalize to PER-100g (the app's picker assumes per-100g). Only
// gram-based servings can be normalized; non-gram servings ("1 cup") are skipped.
function parsePer100(desc) {
  const m = String(desc || "").match(
    /Per\s+(.+?)\s*-\s*Calories:\s*([\d.]+)\s*kcal\s*\|\s*Fat:\s*([\d.]+)\s*g\s*\|\s*Carbs:\s*([\d.]+)\s*g\s*\|\s*Protein:\s*([\d.]+)\s*g/i
  );
  if (!m) return null;
  const serving = m[1].trim();
  const kcal = parseFloat(m[2]), f = parseFloat(m[3]), c = parseFloat(m[4]), p = parseFloat(m[5]);
  let grams = null;
  if (/^100\s*g$/i.test(serving)) grams = 100;
  else { const gm = serving.match(/^([\d.]+)\s*g$/i); if (gm) grams = parseFloat(gm[1]); }
  if (!(grams > 0)) return null;
  const k = 100 / grams;
  return { kcal: Math.round(kcal * k), p: Math.round(p * k), c: Math.round(c * k), f: Math.round(f * k) };
}

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
    let arr = j && j.foods && j.foods.food;
    if (!arr) return { foods: [] };
    if (!Array.isArray(arr)) arr = [arr];
    const out = [];
    for (const f of arr) {
      const macros = parsePer100(f.food_description);
      if (!macros || !(macros.kcal > 0)) continue;
      out.push({ name: tidy(f.food_name), brand: f.brand_name ? tidy(f.brand_name) : "",
        kcal: macros.kcal, p: macros.p, c: macros.c, f: macros.f, source: "fatsecret" });
    }
    return { foods: out };
  }
);
