// Glide MCP connector — Phase 2: the OAuth 2.1 authorization layer
// ===========================================================================
// Claude (and any MCP client) will NOT accept a raw token — it drives a real
// OAuth flow. This file is the small authorization server that lets a user
// click "Connect" in their Claude and authorize their own Glidna account.
//
// Verified requirements this implements (S111 research, primary sources):
//   • OAuth 2.1 resource server + AS (draft-ietf-oauth-v2-1)
//   • RFC 9728 Protected Resource Metadata (MUST include authorization_servers)
//   • RFC 8414 Authorization Server Metadata
//   • PKCE with S256 MANDATORY (Claude sends it on every request and refuses
//     to proceed if code_challenge_methods_supported is absent)
//   • RFC 8707 resource indicators — tokens are AUDIENCE-BOUND to this server
//     and MUST NOT be accepted elsewhere (no token passthrough)
//   • RFC 7591 Dynamic Client Registration (Claude's oauth_dcr mode)
//   • RFC 6749 error codes; token endpoint accepts x-www-form-urlencoded
//   • OAuth endpoints must answer in ≤10s (≤30s for refresh)
//
// TOKEN DESIGN — deliberately OPAQUE, not JWT: tokens are random 32-byte
// strings; only their SHA-256 hash is stored. That means (a) no signing secret
// to manage or rotate, (b) a token is instantly revocable by deleting one doc,
// (c) a database leak exposes hashes, not usable tokens. Cost is one extra
// Firestore read per MCP request, which is ~$0.0000006.
//
// STORAGE (all Admin-SDK-only — firestore.rules has no match for these, and
// Firestore denies by default, same as the webauthn collections):
//   mcpClients/{client_id}   registered OAuth clients (DCR)
//   mcpAuthCodes/{codeHash}  5-min single-use authorization codes
//   mcpTokens/{tokenHash}    access (1h) + refresh (30d) tokens
// ===========================================================================

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

// The connector's canonical public identity. Pinned (not derived from the Host
// header) so the audience can't be shifted by calling a different hostname —
// RFC 8707 requires tokens be bound to THIS resource.
const CANONICAL_BASE = "https://glidna.com";
const RESOURCE_URL = `${CANONICAL_BASE}/mcp`;

const CODE_TTL_MS = 5 * 60 * 1000;          // 5 minutes (spec: short-lived)
const ACCESS_TTL_MS = 60 * 60 * 1000;       // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Phase 2 ships the READ-ONLY server, so only `read` is grantable today.
// write:logs / write:plan / trainer are declared for Phase 3 so clients can
// already discover the vocabulary. Keep in step with mcp.js's tool surface.
const SUPPORTED_SCOPES = ["read"];
const ALL_SCOPES = ["read", "write:logs", "write:plan", "trainer"];

const b64url = (buf) => buf.toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest();
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const randomToken = () => b64url(crypto.randomBytes(32));

// Constant-time compare so a PKCE/secret check can't be timed.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function cors(res, origin) {
  // OAuth endpoints are called by the client's browser and by Anthropic's
  // servers; both need permissive CORS on the metadata/token endpoints.
  res.set("Access-Control-Allow-Origin", origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function oauthError(res, status, code, description) {
  // RFC 6749 §5.2 error shape — Claude keys off these exact codes.
  res.status(status).json({ error: code, error_description: description });
}

// ── 1. Discovery metadata (RFC 9728 + RFC 8414) ────────────────────────────
// One function serves both well-known documents; Vercel rewrites map the
// /.well-known/* paths on glidna.com to it (a Cloud Function can't own the
// domain root by itself).
exports.mcpMetadata = onRequest({ cors: true }, async (req, res) => {
  cors(res, req.get("origin"));
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  res.set("Cache-Control", "public, max-age=3600");

  const path = String(req.path || req.url || "");
  const wantsAS = /oauth-authorization-server|openid-configuration/.test(path)
    || String(req.query.doc || "") === "as";

  if (wantsAS) {
    // RFC 8414 — Authorization Server Metadata.
    res.json({
      issuer: CANONICAL_BASE,
      authorization_endpoint: `${CANONICAL_BASE}/oauth/authorize`,
      token_endpoint: `${CANONICAL_BASE}/oauth/token`,
      registration_endpoint: `${CANONICAL_BASE}/oauth/register`,
      scopes_supported: ALL_SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      // MUST be present — Claude refuses to proceed without S256 advertised.
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"], // public clients + PKCE
      resource_indicators_supported: true,             // RFC 8707
    });
    return;
  }

  // RFC 9728 — Protected Resource Metadata. authorization_servers is REQUIRED.
  res.json({
    resource: RESOURCE_URL,
    authorization_servers: [CANONICAL_BASE],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${CANONICAL_BASE}/connect`,
  });
});

// ── 2. Dynamic Client Registration (RFC 7591) ──────────────────────────────
// Claude's default `oauth_dcr` mode registers itself here. Public client, so
// no client_secret is issued (PKCE is the proof).
exports.mcpRegister = onRequest({ cors: true }, async (req, res) => {
  cors(res, req.get("origin"));
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { oauthError(res, 405, "invalid_request", "POST required."); return; }

  const body = req.body || {};
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length) {
    oauthError(res, 400, "invalid_redirect_uri", "redirect_uris is required.");
    return;
  }
  // Every redirect must be https (or an RFC 8252 loopback, which Claude Code
  // uses). Anything else is a phishing vector.
  for (const u of redirectUris) {
    let parsed;
    try { parsed = new URL(u); } catch { oauthError(res, 400, "invalid_redirect_uri", `Malformed: ${u}`); return; }
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !loopback) {
      oauthError(res, 400, "invalid_redirect_uri", "redirect_uris must be https (or loopback).");
      return;
    }
  }

  const clientId = `glidna_${b64url(crypto.randomBytes(16))}`;
  const now = Date.now();
  await admin.firestore().doc(`mcpClients/${clientId}`).set({
    client_id: clientId,
    client_name: String(body.client_name || "MCP Client").slice(0, 120),
    redirect_uris: redirectUris.slice(0, 10).map((u) => String(u).slice(0, 500)),
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    createdAt: now,
  });

  res.status(201).json({
    client_id: clientId,
    client_id_issued_at: Math.floor(now / 1000),
    client_name: String(body.client_name || "MCP Client").slice(0, 120),
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

// ── 3. Authorization (called BY the consent page, not by Claude) ───────────
// The browser flow is: Claude → glidna.com/oauth/authorize (our React consent
// page) → user signs in with their existing Glidna account (email / Google /
// passkey) → taps Allow → the page POSTs here with their Firebase ID token →
// we mint a single-use code → the page redirects back to Claude.
//
// Requiring a Firebase ID token here means the user's real login is what
// authorizes the grant; this endpoint can never mint a code for someone else.
exports.mcpAuthorize = onRequest({ cors: true }, async (req, res) => {
  cors(res, req.get("origin"));
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { oauthError(res, 405, "invalid_request", "POST required."); return; }

  // Who is granting? (Firebase ID token from the signed-in consent page.)
  const authz = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(authz.trim());
  if (!m) { oauthError(res, 401, "access_denied", "Sign in to authorize."); return; }
  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    uid = decoded.uid;
  } catch (e) {
    oauthError(res, 401, "access_denied", "Invalid session — sign in again.");
    return;
  }

  const b = req.body || {};
  const clientId = String(b.client_id || "");
  const redirectUri = String(b.redirect_uri || "");
  const codeChallenge = String(b.code_challenge || "");
  const challengeMethod = String(b.code_challenge_method || "");
  const resource = String(b.resource || RESOURCE_URL);
  const requested = String(b.scope || "read").split(/\s+/).filter(Boolean);

  if (!clientId || !redirectUri) { oauthError(res, 400, "invalid_request", "client_id and redirect_uri are required."); return; }
  // PKCE S256 is mandatory — never accept `plain`.
  if (!codeChallenge || challengeMethod !== "S256") {
    oauthError(res, 400, "invalid_request", "PKCE with code_challenge_method=S256 is required.");
    return;
  }
  // RFC 8707: only ever issue tokens for OUR resource.
  if (resource && resource.replace(/\/$/, "") !== RESOURCE_URL) {
    oauthError(res, 400, "invalid_target", `Unknown resource. Expected ${RESOURCE_URL}.`);
    return;
  }

  const db = admin.firestore();
  const clientSnap = await db.doc(`mcpClients/${clientId}`).get();
  if (!clientSnap.exists) { oauthError(res, 400, "invalid_client", "Unknown client_id."); return; }
  const client = clientSnap.data();
  // Exact-match the redirect against what was registered (no prefix matching —
  // that's a classic open-redirect hole).
  if (!(client.redirect_uris || []).includes(redirectUri)) {
    oauthError(res, 400, "invalid_redirect_uri", "redirect_uri does not match this client's registration.");
    return;
  }

  // Grant only what we actually support today (read-only server in Phase 2).
  const granted = requested.filter((s) => SUPPORTED_SCOPES.includes(s));
  if (!granted.length) granted.push("read");

  const code = randomToken();
  await db.doc(`mcpAuthCodes/${hashToken(code)}`).set({
    uid,
    clientId,
    redirectUri,
    codeChallenge,
    scope: granted.join(" "),
    aud: RESOURCE_URL,
    expiresAt: Date.now() + CODE_TTL_MS,
    used: false,
    createdAt: Date.now(),
  });

  res.json({ code, redirect_uri: redirectUri, scope: granted.join(" ") });
});

// ── 4. Token endpoint (RFC 6749 + PKCE verification) ───────────────────────
exports.mcpToken = onRequest({ cors: true }, async (req, res) => {
  cors(res, req.get("origin"));
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { oauthError(res, 405, "invalid_request", "POST required."); return; }
  res.set("Cache-Control", "no-store");

  // Spec: the token endpoint takes application/x-www-form-urlencoded. Firebase
  // parses that into req.body; accept JSON too for lenient clients.
  const b = req.body || {};
  const grantType = String(b.grant_type || "");
  const db = admin.firestore();

  if (grantType === "authorization_code") {
    const code = String(b.code || "");
    const verifier = String(b.code_verifier || "");
    const redirectUri = String(b.redirect_uri || "");
    const clientId = String(b.client_id || "");
    if (!code || !verifier) { oauthError(res, 400, "invalid_request", "code and code_verifier are required."); return; }

    const ref = db.doc(`mcpAuthCodes/${hashToken(code)}`);
    // Single-use enforcement in a transaction so two racing redemptions can't
    // both succeed (replay protection).
    let grant = null;
    try {
      grant = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const d = snap.data();
        if (d.used || Date.now() > d.expiresAt) { tx.delete(ref); return null; }
        tx.delete(ref); // burn it — codes are strictly one-shot
        return d;
      });
    } catch (e) {
      oauthError(res, 400, "invalid_grant", "Could not redeem that code.");
      return;
    }
    if (!grant) { oauthError(res, 400, "invalid_grant", "Authorization code is invalid, expired, or already used."); return; }

    // PKCE: base64url(SHA256(verifier)) must equal the stored challenge.
    if (!safeEqual(b64url(sha256(verifier)), grant.codeChallenge)) {
      oauthError(res, 400, "invalid_grant", "PKCE verification failed.");
      return;
    }
    if (redirectUri && redirectUri !== grant.redirectUri) { oauthError(res, 400, "invalid_grant", "redirect_uri mismatch."); return; }
    if (clientId && clientId !== grant.clientId) { oauthError(res, 400, "invalid_grant", "client_id mismatch."); return; }

    const out = await issueTokens(db, grant.uid, grant.clientId, grant.scope);
    res.json(out);
    return;
  }

  if (grantType === "refresh_token") {
    const rt = String(b.refresh_token || "");
    if (!rt) { oauthError(res, 400, "invalid_request", "refresh_token is required."); return; }
    const ref = db.doc(`mcpTokens/${hashToken(rt)}`);
    const snap = await ref.get();
    const d = snap.exists ? snap.data() : null;
    if (!d || d.type !== "refresh" || Date.now() > d.expiresAt) {
      oauthError(res, 400, "invalid_grant", "Refresh token is invalid or expired.");
      return;
    }
    await ref.delete(); // rotate: a refresh token is single-use
    const out = await issueTokens(db, d.uid, d.clientId, d.scope);
    res.json(out);
    return;
  }

  oauthError(res, 400, "unsupported_grant_type",
    "Only authorization_code and refresh_token are supported (no client_credentials — every connection needs user consent).");
});

async function issueTokens(db, uid, clientId, scope) {
  const access = randomToken();
  const refresh = randomToken();
  const now = Date.now();
  const batch = db.batch();
  batch.set(db.doc(`mcpTokens/${hashToken(access)}`), {
    type: "access", uid, clientId, scope,
    aud: RESOURCE_URL, expiresAt: now + ACCESS_TTL_MS, createdAt: now,
  });
  batch.set(db.doc(`mcpTokens/${hashToken(refresh)}`), {
    type: "refresh", uid, clientId, scope,
    aud: RESOURCE_URL, expiresAt: now + REFRESH_TTL_MS, createdAt: now,
  });
  await batch.commit();
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
    scope,
  };
}

// Verify an opaque access token → { uid, scope } or null. Used by mcp.js.
// Exported so the MCP endpoint and this file can't drift apart.
async function verifyAccessToken(db, token) {
  if (!token) return null;
  const snap = await db.doc(`mcpTokens/${hashToken(token)}`).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (d.type !== "access") return null;
  if (Date.now() > d.expiresAt) return null;
  if (d.aud !== RESOURCE_URL) return null; // audience binding (RFC 8707)
  return { uid: d.uid, scope: d.scope || "read", clientId: d.clientId };
}

module.exports.verifyAccessToken = verifyAccessToken;
module.exports.RESOURCE_URL = RESOURCE_URL;
module.exports.CANONICAL_BASE = CANONICAL_BASE;
