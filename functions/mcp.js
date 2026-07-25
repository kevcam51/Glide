// Glide MCP connector — Phase 1 (READ-ONLY)
// ===========================================================================
// Exposes Glide as a remote MCP server so a user's OWN Claude (or any MCP
// client) can read their Glide data. See docs/MCP-CONNECTOR.md for the full
// design + the verified spec research behind these choices.
//
// ⭐ STANDING RULE (Kevin, S111): the in-app "Ask Glidna" AI and this connector
// must stay at CAPABILITY PARITY. Both are just front doors onto the SAME tool
// layer (aitools.js runTool) — never add an ability to one only. Phase 1 is
// read-only by design (not a capability gap); writes land in Phase 2.
//
// WHY THIS SHAPE (all verified against primary sources, S111):
//   • Transport = Streamable HTTP (single endpoint, POST+GET). Legacy HTTP+SSE
//     is deprecated by Anthropic; don't build it.
//   • STATELESS (sessionIdGenerator: undefined) with a NEW McpServer +
//     transport per request. Cloud Run session affinity is best-effort, so we
//     must not pin in-memory sessions to an instance — and reusing one
//     stateless transport across requests hits SDK bug #1994 (500s).
//   • Sessions are OPTIONAL in the MCP spec, so stateless is fully compliant.
//   • Origin MUST be validated (DNS-rebinding defense, spec requirement).
//   • Auth: Claude allows authless servers, but Glide data is per-user, so we
//     require a bearer token. Phase 1 accepts a Firebase ID token (works today
//     for first-party/testing); Phase 2 adds the full OAuth 2.1 AS layer
//     (RFC 9728 PRM + RFC 8414 metadata + PKCE S256 + RFC 8707 audience) that
//     third-party clients like Claude.ai drive automatically.
//
// Every tool call resolves to a uid and runs through the SAME runTool() the
// chat backend uses, so the server-side access model is identical: a client
// can only ever read their own data; a trainer only their verified clients
// (resolveTargetUid); localPlanId only resolves against the caller's own index.
// ===========================================================================

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const { buildTools, runTool } = require("./aitools");
const { verifyAccessToken, RESOURCE_URL, CANONICAL_BASE } = require("./mcpauth");

// Origins allowed to reach this endpoint. Anthropic connects from its own
// cloud (no Origin header on server-to-server calls), so a MISSING Origin is
// allowed; a PRESENT-but-unknown Origin is rejected 403 per the MCP spec.
const ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://claude.com",
  "https://glidna.com",
  "https://www.glidna.com",
  "http://localhost:5173", // local dev
];
function originOk(origin) {
  if (!origin) return true; // server-to-server (Anthropic cloud) sends none
  return ALLOWED_ORIGINS.includes(origin);
}

// ── Tool surface (Phase 1 = read-only) ─────────────────────────────────────
// These names all exist in aitools.js and only READ. Writes (log_meal,
// set_targets, propose_*, send_client_request, …) land in Phase 2 behind the
// write scopes — see docs/MCP-CONNECTOR.md §4.
const READ_TOOLS = new Set([
  "get_profile",
  "get_nutrition_log",
  "get_nutrition_targets",
  "get_measurements",
  "list_plans",
  "list_exercises",
  "list_notes",
  // NOTE: search_food is deliberately RETIRED in buildTools (S92 — no accuracy
  // gain at 2–2.5× the tokens), so it never reaches this set. Listed nowhere on
  // purpose; if it's ever re-enabled for the app, add it here too (parity rule).
  // trainer-only reads (buildTools already omits these for clients)
  "list_clients",
  "find_client",
  "coach_summary",
  "list_local_plans",
]);

// Daily call caps. These are ABUSE BACKSTOPS, not a revenue lever — measured
// cost is ~0.0013¢ per typical call (S112 costing, verified rates below), so
// generosity is basically free and Kevin wants the connector to become a daily
// habit. The real paywall is Phase 2 WRITES (logging/editing), not reads, so a
// generous free READ tier costs us ~nothing and cannibalizes nothing.
//
// MEASURED COST PER TYPICAL CALL (get_nutrition_log, 7 days = 10 reads/1 write):
//   Firestore nam5 (multi-region, 2x regional): reads $0.06/100k, writes $0.18/100k
//     → 10 x $0.0000006 + 1 x $0.0000018            = $0.0000078
//   Cloud Run request-based, Firebase v2 defaults (256MiB but a FULL 1 vCPU),
//   ~200ms billable (rounded up to 100ms):
//     req $0.0000004 + cpu 0.2 x $0.000024 + mem 0.2 x 0.25 x $0.0000025
//                                                    = $0.0000053
//   TOTAL ~ $0.000013/call  (~1/1000 of a cent)
// So: 200 calls/day/user ~ $0.08/user/month. 2,000/day ~ $0.79. 10,000/day ~ $3.93.
// Free-tier cushion on top: 50,000 Firestore reads/day + 2M Cloud Run req/month.
//
// ⚠️ coach_summary is the outlier — ~120 reads (12x a normal call, ~0.01c). It's
// trainer-only and rate-limited by these same caps, so it stays bounded.
// Trainers act on behalf of MANY clients (a 50-client roster logging meals is
// ~200 calls/day), so the coach tiers get proportionally more headroom than a
// solo client on the same price level. Tier ids come from billing.js CATALOG:
// premium | max | ultra | coach | coach_max | coach_ultra.
const DAILY_CALLS = {
  free: 200,
  premium: 2000,
  coach: 5000,
  max: 10000,
  ultra: 25000,
};
function planFor(profile) {
  if (!profile) return "free";
  if (profile.role === "admin") return "ultra";
  if (profile.entitlements && profile.entitlements.premium === true) return "premium";
  if (profile.subscriptionStatus === "active") {
    // Order matters: check ultra before max before coach, since the coach tiers
    // are named coach_max / coach_ultra. (A plain "includes(max)" test used to
    // drop ultra/coach_ultra — the TOP tiers — down to the premium cap.)
    const t = String(profile.subscriptionTier || "").toLowerCase();
    if (t.includes("ultra")) return "ultra";
    if (t.includes("max")) return "max";
    if (t.includes("coach")) return "coach";
    return "premium";
  }
  // Active trial counts as premium (mirrors the app's isPremium semantics).
  const t = profile.trialStartedAt;
  const startMs = t && typeof t.toMillis === "function" ? t.toMillis()
    : typeof t === "number" ? t : null;
  if (!startMs) return "premium"; // pre-trial/grandfathered account
  const expired = Date.now() >= startMs + (profile.trialLengthDays || 30) * 86400000;
  return expired ? "free" : "premium";
}

function utcDayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Count one MCP call against the caller's daily allowance. Cheap counter,
// same shape as the AI budget (users/{uid}/mcpUsage/{day}).
async function chargeCall(db, uid, plan) {
  const ref = db.doc(`users/${uid}/mcpUsage/${utcDayKey()}`);
  const snap = await ref.get();
  const used = (snap.data() || {}).calls || 0;
  const cap = DAILY_CALLS[plan] || DAILY_CALLS.free;
  if (used >= cap) return { ok: false, used, cap };
  await ref.set({ calls: used + 1, plan, updatedAt: Date.now() }, { merge: true });
  return { ok: true, used: used + 1, cap };
}

// ── Auth ───────────────────────────────────────────────────────────────────
// Phase 1: verify a Firebase ID token from the Authorization: Bearer header.
// Phase 2 swaps this for our own OAuth 2.1 access tokens (same interface:
// token in → uid out), so nothing else here changes.
async function uidFromRequest(req) {
  const h = req.get("authorization") || req.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return null;
  const token = m[1];
  // 1) An OAuth access token we issued (how Claude and every real MCP client
  //    authenticates — opaque, hashed in Firestore, audience-bound).
  try {
    const grant = await verifyAccessToken(admin.firestore(), token);
    if (grant && grant.uid) return grant.uid;
  } catch (e) { /* fall through */ }
  // 2) A Firebase ID token — first-party/testing path (kept so the endpoint
  //    stays directly testable without running the whole OAuth dance).
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded && decoded.uid ? decoded.uid : null;
  } catch (e) {
    return null;
  }
}

// A 401 that tells the client WHERE to authenticate (RFC 9728 discovery
// pointer). Phase 2 serves the actual metadata document at that URL.
function unauthorized(req, res) {
  // Point at the CANONICAL domain: Cloud Functions can't own the host root,
  // so glidna.com (Vercel) serves /.well-known/* and rewrites to mcpMetadata.
  res.set("WWW-Authenticate",
    `Bearer realm="Glidna", resource_metadata="${CANONICAL_BASE}/.well-known/oauth-protected-resource"`);
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized — connect your Glidna account." },
    id: null,
  });
}

// Build the MCP server for ONE request (stateless: never reused).
function buildServer(ctx, profile, db) {
  const server = new McpServer(
    { name: "glidna", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const plan = planFor(profile);
  // buildTools() already role-filters (clients never see trainer tools).
  const defs = buildTools(ctx.role).filter((t) => READ_TOOLS.has(t.name));

  for (const def of defs) {
    // The MCP SDK wants a Zod shape; our tools carry JSON Schema. Phase 1's
    // read tools take simple scalar params, so we map them generically and
    // let runTool do its own validation (it already hardens every input).
    const props = (def.input_schema && def.input_schema.properties) || {};
    const required = new Set((def.input_schema && def.input_schema.required) || []);
    const shape = {};
    for (const [key, spec] of Object.entries(props)) {
      let zt;
      switch (spec && spec.type) {
        case "number":
        case "integer": zt = z.number(); break;
        case "boolean": zt = z.boolean(); break;
        case "array": zt = z.array(z.any()); break;
        case "object": zt = z.record(z.any()); break;
        default: zt = z.string();
      }
      if (spec && spec.description) zt = zt.describe(spec.description);
      shape[key] = required.has(key) ? zt : zt.optional();
    }

    server.registerTool(
      def.name,
      {
        title: def.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        // Descriptions must stand alone: an external model has none of our
        // system prompt. aitools.js descriptions are already self-contained.
        description: def.description,
        inputSchema: shape,
        // Required for the Anthropic connector directory; also drives Claude's
        // confirmation UX. Everything in Phase 1 is a safe read.
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const charge = await chargeCall(db, ctx.callerUid, plan);
        if (!charge.ok) {
          return {
            isError: true,
            content: [{ type: "text", text:
              `Daily Glidna connector limit reached (${charge.cap} calls on the ${plan} plan). `
              + `It resets at midnight UTC. Upgrade in the app for a higher limit.` }],
          };
        }
        const result = await runTool(def.name, args || {}, ctx);
        // Keep well under Claude's ~150,000-char tool-result ceiling.
        let text = JSON.stringify(result);
        if (text.length > 120000) {
          text = JSON.stringify({
            truncated: true,
            note: "Result too large; narrow the date range or ask for fewer items.",
            preview: text.slice(0, 100000),
          });
        }
        return { content: [{ type: "text", text }] };
      },
    );
  }

  return server;
}

exports.mcp = onRequest({ cors: false, timeoutSeconds: 300 }, async (req, res) => {
  // Spec: validate Origin and reject a present-but-unknown one.
  const origin = req.get("origin");
  if (!originOk(origin)) {
    res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Forbidden origin." }, id: null });
    return;
  }
  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  // Stateless server: no persistent SSE stream to attach to, and no session to
  // delete. Answer GET/DELETE with 405 (explicitly allowed by the spec).
  if (req.method === "GET" || req.method === "DELETE") {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)." }, id: null });
    return;
  }
  if (req.method !== "POST") { res.status(405).end(); return; }

  const uid = await uidFromRequest(req);
  if (!uid) { unauthorized(req, res); return; }

  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const callerName = profile.displayName
    || [profile.firstName, profile.lastName].filter(Boolean).join(" ")
    || profile.email || (isTrainer ? "Coach" : "Client");

  // Same ctx the chat backend builds — identical access model downstream.
  const ctx = {
    callerUid: uid,
    role,
    isTrainer,
    callerName,
    today: todayLocal(),
    nowTime: nowTimeLocal(),
  };

  let server, transport;
  try {
    server = buildServer(ctx, profile, db);
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // Per-request instances (SDK's documented serverless pattern) — closing
    // them when the response ends prevents the #1994 reuse bug.
    res.on("close", () => {
      try { transport.close(); } catch (e) { /* already closed */ }
      try { server.close(); } catch (e) { /* already closed */ }
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("mcp: request failed", e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null });
    }
  }
});

// Local date/time in the app's timezone — mirrors aichat.js so "today" means
// the same day the app's local-date log keys use.
function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function nowTimeLocal() {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
