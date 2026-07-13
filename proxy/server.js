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

// OAuth2 client-credentials token, cached in memory (valid ~24h; refresh early).
let _token = null, _tokenExp = 0;
async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExp - 60000) return _token;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=basic",
  });
  if (!r.ok) throw new Error("fatsecret-auth-" + r.status);
  const j = await r.json();
  _token = j.access_token;
  _tokenExp = now + (Number(j.expires_in) || 86400) * 1000;
  return _token;
}

async function searchFatSecret(q) {
  const token = await getToken();
  const url = "https://platform.fatsecret.com/rest/server.api?method=foods.search&format=json&max_results=20" +
    `&search_expression=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("fatsecret-search-" + r.status);
  return r.json();
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
    if (u.pathname !== "/search") return send(res, 404, { error: "not-found" });
    // Shared-secret gate so only our Cloud Function can use our FatSecret quota.
    if (req.headers["x-proxy-secret"] !== PROXY_SECRET) return send(res, 403, { error: "forbidden" });
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
