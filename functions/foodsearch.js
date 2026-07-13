// Glidna — FatSecret food-search proxy (S93).
//
// FatSecret Platform API has a large, curated food library (generic + branded +
// restaurant) that meaningfully improves typed food search vs. USDA + Open Food
// Facts alone. It requires OAuth2 (a client id + secret) and is server-only, so
// it must be proxied through this Cloud Function — the secret never touches the
// browser. Results are MERGED with USDA/OFF client-side (see searchFoods in
// src/App.jsx) and ranked together; this just adds to the library.
//
// SETUP (Kevin): create a free app at https://platform.fatsecret.com → get the
// Client ID + Client Secret, then:
//   printf 'ID'     | firebase functions:secrets:set FATSECRET_CLIENT_ID     --project calorieiq-29762 --data-file=-
//   printf 'SECRET' | firebase functions:secrets:set FATSECRET_CLIENT_SECRET --project calorieiq-29762 --data-file=-
//   firebase deploy --only functions:foodSearch --project calorieiq-29762
// Until the secrets are set it returns { foods: [], configured: false } — a safe
// no-op (the app keeps using USDA + Open Food Facts).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const FATSECRET_CLIENT_ID = defineSecret("FATSECRET_CLIENT_ID");
const FATSECRET_CLIENT_SECRET = defineSecret("FATSECRET_CLIENT_SECRET");

// OAuth2 client-credentials token, cached in-memory across warm invocations
// (valid ~24h; we refresh a minute early).
let _token = null, _tokenExp = 0;
async function getToken(id, secret) {
  const now = Date.now();
  if (_token && now < _tokenExp - 60000) return _token;
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch("https://oauth.fatsecret.com/connect/token", {
      method: "POST", signal: ctl.signal,
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=basic",
    });
    if (!r.ok) throw new Error("fatsecret-auth-" + r.status);
    const j = await r.json();
    _token = j.access_token;
    _tokenExp = now + (Number(j.expires_in) || 86400) * 1000;
    return _token;
  } finally { clearTimeout(t); }
}

const tidy = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// FatSecret's search returns a text food_description, e.g.
//   "Per 100g - Calories: 155kcal | Fat: 10.61g | Carbs: 1.12g | Protein: 12.58g"
// Parse it and normalize to PER-100g (the app's picker assumes per-100g and lets
// the user pick a serving). We can only normalize gram-based servings; non-gram
// servings ("1 cup") are skipped here — a later enhancement can call foods.get
// for structured servings.
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
  { secrets: [FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET], region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const id = FATSECRET_CLIENT_ID.value(), secret = FATSECRET_CLIENT_SECRET.value();
    if (!id || !secret || /placeholder/i.test(id) || /placeholder/i.test(secret)) {
      return { foods: [], configured: false };
    }
    const q = String((request.data && request.data.query) || "").trim().slice(0, 80);
    if (q.length < 2) return { foods: [] };

    let token;
    try { token = await getToken(id, secret); } catch (e) { console.error("foodSearch auth", e && e.message); return { foods: [], error: "auth" }; }

    const url = "https://platform.fatsecret.com/rest/server.api?method=foods.search&format=json&max_results=20" +
      `&search_expression=${encodeURIComponent(q)}`;
    let j;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
      if (!r.ok) { console.error("foodSearch search http", r.status); return { foods: [], error: "search" }; }
      j = await r.json();
    } catch (e) { console.error("foodSearch search", e && e.message); return { foods: [], error: "search" }; }
    finally { clearTimeout(t); }

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
