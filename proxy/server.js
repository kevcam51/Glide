// Glidna — FatSecret IP-whitelist proxy (S93).
//
// A tiny single-purpose relay that runs on a VM with ONE fixed, FatSecret-
// whitelisted IP. Its only job: take a search query from our Cloud Function
// (authenticated by a shared secret), call FatSecret from the whitelisted IP,
// and return FatSecret's raw JSON. It manages the OAuth token itself (FatSecret
// recommends the proxy own token validity/renewal). No user data, no database —
// just a pipe. See README.md for deployment.
//
// Env required:
//   FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET  — FatSecret app credentials
//   PROXY_SECRET                                  — shared secret; the Cloud
//                                                   Function sends it as x-proxy-secret
//   PORT (optional, default 8080)

const http = require("http");
const { URL } = require("url");

const CLIENT_ID = process.env.FATSECRET_CLIENT_ID || "";
const CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET || "";
const PROXY_SECRET = process.env.PROXY_SECRET || "";
const PORT = Number(process.env.PORT) || 8080;

if (!CLIENT_ID || !CLIENT_SECRET || !PROXY_SECRET) {
  console.error("Missing FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET / PROXY_SECRET env.");
  process.exit(1);
}

// OAuth2 client-credentials tokens, cached in memory PER SCOPE (valid ~24h;
// refresh early). The search path still asks for exactly "basic", byte for
// byte. The barcode path needs the `barcode` scope as well — and if FatSecret
// refuses that combination it is asked again with NO scope parameter at all,
// which their docs say grants whatever the account actually holds. That second
// form is the only way to discover an entitlement we cannot see from here.
const _tokens = new Map();   // scope → { token, exp }
async function getToken(scope = "basic") {
  const now = Date.now();
  const c = _tokens.get(scope);
  if (c && now < c.exp - 60000) return c.token;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const ask = (body) => fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  let r = await ask(`grant_type=client_credentials&scope=${encodeURIComponent(scope)}`);
  if (!r.ok && scope !== "basic") {
    console.error("fatsecret token scope", JSON.stringify(scope), "rejected", r.status, "— retrying with no scope");
    r = await ask("grant_type=client_credentials");
  }
  if (!r.ok) throw new Error("fatsecret-auth-" + r.status);
  const j = await r.json();
  _tokens.set(scope, { token: j.access_token, exp: now + (Number(j.expires_in) || 86400) * 1000 });
  return j.access_token;
}

async function fsCall(method, q, token) {
  const url = `https://platform.fatsecret.com/rest/server.api?method=${method}&format=json&max_results=20` +
    `&search_expression=${encodeURIComponent(q)}`;
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}
// v3 is PREMIER-scope-gated: on the Basic tier FatSecret answers HTTP 200 with
// {"error":{"code":14,"message":"Missing scope: scope 'premier'"}} — so the
// fallback must inspect the BODY, not just the status. Cached after the first
// scope error so every search isn't a double round-trip.
let _v3Blocked = false;
async function searchFatSecret(q) {
  const token = await getToken();
  // foods.search.v3 returns each food with a full `servings.serving[]` array —
  // real household servings ("1 cup", "1 breast") + micronutrients — instead of
  // v1's flat "Per 100g" text summary. The Cloud Function (functions/foodsearch.js)
  // parses either shape. Falls back to v1 whenever v3 is unavailable (HTTP error
  // OR an in-body error like the premier-scope gate).
  if (!_v3Blocked) {
    const r3 = await fsCall("foods.search.v3", q, token);
    if (r3.ok) {
      const j3 = await r3.json();
      if (!j3.error) return j3;
      console.error("fatsecret v3 error body:", JSON.stringify(j3.error), "— falling back to v1");
      if (j3.error.code === 14) _v3Blocked = true; // premier-scope gate: stop retrying v3
    } else {
      console.error("fatsecret v3 http", r3.status, "— falling back to v1");
    }
  }
  const r = await fsCall("foods.search", q, token);
  if (!r.ok) throw new Error("fatsecret-search-" + r.status);
  return r.json();
}

// food.get.v4 — full detail for ONE food: real household servings ("1 cup,
// cooked, diced") + micronutrients. Available on the Basic tier (verified),
// unlike foods.search.v3 (premier-gated). The app calls this lazily when the
// user taps a FatSecret result, so search itself stays 1 call.
async function getFatSecretFood(id) {
  const token = await getToken();
  const url = "https://platform.fatsecret.com/rest/server.api?method=food.get.v4&format=json" +
    `&food_id=${encodeURIComponent(id)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("fatsecret-get-" + r.status);
  return r.json();
}

// Barcode → food (S228). FatSecret is the app's primary library, so a branded
// US product it holds and the crowd-sourced sources do not is exactly the scan
// that fails today. Two shapes are tried: the v2 route answers with the whole
// food in one call, the older method answers with an id we then fetch.
//
// ⚠️ THE GATE PREDICATE IS NARROW, deliberately, exactly as _v3Blocked's is. A
// transient in-body error must not permanently disable barcode for the life of
// a VM process nobody restarts. Only a scope/method refusal latches.
let _barcodeGate = false;
const gateErr = (e) => !!e && (e.code === 14 || /missing scope|unknown method/i.test(String(e.message || "")));

async function fsBarcode(gtin13) {
  if (_barcodeGate) return { gated: true };
  const token = await getToken("basic barcode");
  const r2 = await fetch("https://platform.fatsecret.com/rest/food/barcode/find-by-id/v2"
    + `?barcode=${encodeURIComponent(gtin13)}&format=json`, { headers: { Authorization: `Bearer ${token}` } });
  if (r2.ok) {
    const j2 = await r2.json();
    if (j2 && j2.food && j2.food.servings) return { food: j2.food };      // whole food, one call
    if (j2 && j2.error) {
      console.error("fatsecret barcode v2 error:", JSON.stringify(j2.error));
      if (gateErr(j2.error)) { _barcodeGate = true; return { gated: true }; }
    } else if (j2 && j2.food_id) {                                        // id only
      const id = String((j2.food_id && j2.food_id.value) || j2.food_id || "");
      if (/^\d+$/.test(id) && Number(id) > 0) return { food: (await getFatSecretFood(id)).food || null };
      return { food: null };
    }
  } else { console.error("fatsecret barcode v2 http", r2.status); }
  const r1 = await fetch("https://platform.fatsecret.com/rest/server.api?method=food.find_id_for_barcode"
    + `&format=json&barcode=${encodeURIComponent(gtin13)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r1.ok) throw new Error("fatsecret-barcode-" + r1.status);
  const j1 = await r1.json();
  if (j1 && j1.error) {
    console.error("fatsecret barcode v1 error:", JSON.stringify(j1.error));
    if (gateErr(j1.error)) { _barcodeGate = true; return { gated: true }; }
    throw new Error("fatsecret-barcode-error");
  }
  const id = String((j1 && j1.food_id && j1.food_id.value) || "");
  if (!/^\d+$/.test(id) || Number(id) <= 0) return { food: null };        // a REAL miss, not a gate
  const det = await getFatSecretFood(id);
  return { food: (det && det.food) || null };
}

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (u.pathname === "/health") return send(res, 200, { ok: true });
    if (u.pathname !== "/search" && u.pathname !== "/food" && u.pathname !== "/barcode") return send(res, 404, { error: "not-found" });
    // Shared-secret gate so only our Cloud Function can use our FatSecret quota.
    if (req.headers["x-proxy-secret"] !== PROXY_SECRET) return send(res, 403, { error: "forbidden" });
    if (u.pathname === "/barcode") {
      const code = (u.searchParams.get("code") || "").trim();
      if (!/^\d{13}$/.test(code)) return send(res, 400, { error: "bad-code" });
      return send(res, 200, await fsBarcode(code));
    }
    if (u.pathname === "/food") {
      const id = (u.searchParams.get("id") || "").trim().slice(0, 24);
      if (!/^\d+$/.test(id)) return send(res, 400, { error: "bad-id" });
      return send(res, 200, await getFatSecretFood(id));
    }
    const q = (u.searchParams.get("q") || "").trim().slice(0, 80);
    if (q.length < 2) return send(res, 200, { foods: {} });
    const data = await searchFatSecret(q);
    return send(res, 200, data);
  } catch (e) {
    console.error("proxy error", e && e.message);
    return send(res, 502, { error: "upstream", message: (e && e.message) || "error" });
  }
});

server.listen(PORT, () => console.log(`FatSecret proxy listening on :${PORT}`));
