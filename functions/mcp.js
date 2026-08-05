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
const { buildTools, runTool, seatCapFor } = require("./aitools");
const { defineSecret } = require("firebase-functions/params");
const { verifyAccessToken, RESOURCE_URL, CANONICAL_BASE } = require("./mcpauth");

// search_food_db reaches FatSecret through the same proxy the app uses. The
// secrets must be bound to THIS function too: unbound, process.env is simply
// empty and the tool fails at runtime while looking perfectly correct in review
// (the exact trap noted on aichat.js).
const FATSECRET_PROXY_URL = defineSecret("FATSECRET_PROXY_URL");
const FATSECRET_PROXY_SECRET = defineSecret("FATSECRET_PROXY_SECRET");

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
  "search_food_db",   // live FatSecret label data (S165 — see the note below)
  "fetch_link",       // reads a public URL server-side; SSRF-guarded in aitools
  // NOTE: the RETIRED tool is `search_food` (S92 — the old USDA/Open Food Facts
  // lookup, no accuracy gain at 2–2.5× the tokens); buildTools filters it out, so
  // it never reaches this set. `search_food_db` is the LIVE FatSecret replacement
  // and is very much exposed — the two names are one character apart and the old
  // wording here read as though the whole food database were retired (S165).
  // trainer-only reads (buildTools already omits these for clients)
  "list_clients",
  "find_client",
  "coach_summary",
  "list_local_plans",
  "list_sub_trainers",   // head trainer's team (S116)
  // Seat confirmation (S176f). Classified as a READ deliberately: the seat
  // gate fires on READS of an unseated client too, so a read-only connection
  // must still be able to confirm a slot — otherwise a capped trainer on the
  // connector dead-ends all month (the review catch that added this line). It
  // spends a slot from the caller's own allowance but touches no user data.
  "confirm_ai_client",
]);

// ── Phase 3 (S115): WRITE tools, each behind an OAuth scope ────────────────
// The ENFORCEMENT point. A tool is only registered when the caller's token
// carries its scope, AND re-checked at call time (defence in depth). Role
// filtering still applies first via buildTools, so a client never sees the
// trainer tools regardless of what their token claims.
//
// propose_meal / propose_workout are deliberately OMITTED: they exist to render
// the in-app Accept cards. An external AI confirms conversationally and then
// calls the real write tool, so exposing them here would just add a dead step.
// That's a PRESENTATION difference, not a capability gap — the parity rule
// (§3b of docs/MCP-CONNECTOR.md) is satisfied because the underlying write
// ability is identical on both surfaces.
const SCOPE_FOR_TOOL = {
  // write:logs — day-to-day diary entries
  log_meal: "write:logs",
  log_meals: "write:logs",
  plan_meals: "write:logs",   // writes to FUTURE days, so not destructive (S165)
  remove_meal: "write:logs",
  log_workout: "write:logs",
  log_weigh_in: "write:logs",
  log_check_in: "write:logs",
  log_measurements: "write:logs",
  log_water: "write:logs",
  create_note: "write:logs",
  update_note: "write:logs",
  // write:plan — the plan's structure and settings
  set_personal_info: "write:plan",
  set_targets: "write:plan",
  set_workout_schedule: "write:plan",
  add_custom_exercise: "write:plan",
  create_plan: "write:plan",
  switch_plan: "write:plan",
  rename_plan: "write:plan",
  set_notification_prefs: "write:plan",
  // trainer — acting on a connected client
  send_client_request: "trainer",
  // Feedback to the Glidna team, not user data. Scoped to write:logs simply
  // because it is a write; a connector user who can log can also tell us what
  // is missing — which is the whole value, since it arrives with the context of
  // the moment they hit the limitation.
  send_app_request: "write:logs",
};
// Tools that DELETE or overwrite user data — flagged so Claude shows a stronger
// confirmation prompt before running them.
// destructiveHint = "may OVERWRITE or delete data that is already there", as
// opposed to adding a new entry. Claude shows a stronger confirmation for these,
// so the line matters: mark an additive tool destructive and every meal log
// nags; miss an overwriting one and it silently replaces a client's targets.
// ADDITIVE (hint stays false): log_meal(s), log_water, log_workout, log_check_in,
// log_measurements, log_weigh_in (merges into a same-day entry since S86),
// create_note, create_plan, add_custom_exercise, send_client_request.
const DESTRUCTIVE_TOOLS = new Set([
  "remove_meal",            // deletes an entry outright
  "set_workout_schedule",   // REPLACES the week for any category supplied
  "switch_plan",            // changes which plan is active
  "set_targets",            // overwrites existing macro/goal targets
  "set_personal_info",      // overwrites profile fields (weight, goal, DOB…)
  "rename_plan",            // overwrites the plan name
  "update_note",            // overwrites the note body
  "set_notification_prefs", // overwrites the existing preference set
]);

// Extra guidance appended to a tool's description for EXTERNAL models, which
// have none of our in-app system prompt. Batching is the important one: logging
// meal-by-meal is ~3x the database ops and burns the daily cap ~3x faster.
const MCP_DESCRIPTION_EXTRA = {
  log_meal: " For MORE THAN ONE food, use log_meals instead — one call for the whole list.",
  log_meals: " Always prefer this over repeated log_meal calls; it saves the entire list in a single operation.",
  set_workout_schedule: " This REPLACES the schedule for any category you provide. Confirm with the user before calling.",
  remove_meal: " This permanently deletes the entry. Confirm with the user first.",
  plan_meals: " These are PLANNED meals for future days, not food already eaten — they do not count"
    + " toward any day's totals until the person ticks each one off. To record food someone HAS"
    + " eaten, use log_meals instead.",
};

// JSON Schema → Zod, recursively (S165). The old mapper was flat: it collapsed
// every array to z.array(z.any()) and every object to z.record(z.any()), and its
// `default:` arm swallowed enums into a bare string. That erased exactly the
// parts an external model needs most and failed SILENTLY on both ends —
// `log_meals.meals` arrived shapeless so Claude guessed the item keys (`food`,
// `kcal`) and runTool coerced the misses to empty, while a perfectly reasonable
// mealType "Breakfast" failed runTool's exact-match check and filed a meal with
// no meal type at all. The in-app model never saw either, because it gets the
// real JSON Schema — which is precisely the drift the parity rule forbids.
function toZod(spec) {
  const s = spec || {};
  // An enum is the strongest signal there is: hand the model the exact values
  // rather than a string it has to guess the casing of.
  if (Array.isArray(s.enum) && s.enum.length && s.enum.every((v) => typeof v === "string")) {
    return z.enum(s.enum);
  }
  switch (s.type) {
    case "number":
    case "integer": return z.number();
    case "boolean": return z.boolean();
    case "array": return z.array(s.items ? toZod(s.items) : z.any());
    case "object": {
      const props = s.properties || {};
      const keys = Object.keys(props);
      if (!keys.length) return z.record(z.any());   // free-form map (e.g. micros passthrough)
      const req = new Set(s.required || []);
      const shape = {};
      for (const [k, v] of Object.entries(props)) {
        let zt = toZod(v);
        if (v && v.description) zt = zt.describe(v.description);
        shape[k] = req.has(k) ? zt : zt.optional();
      }
      return z.object(shape);
    }
    default: return z.string();
  }
}

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
// Free gets ZERO connector calls (S173, Kevin's call, replacing the 50/200
// taste). The AI layer — in-app and connector alike — is what you pay for; free
// is the whole manual product, which is genuinely most of the app.
//
// The trial does the selling instead: 30 days at the full 2,000/day, so the
// habit forms at full speed and then stops. Losing it entirely is a sharper
// prompt than having it narrowed, and "AI features are paid" is one sentence on
// a pricing page where two taste allowances were three.
//
// Kept as a named 0 rather than special-cased at the call site so every cap
// lives in one table.
const DAILY_CALLS = {
  free: 0,
  connect: 2000,
  premium: 2000,
  coach: 5000,
  max: 10000,
  ultra: 25000,
};
const TRAINER_ROLES = ["head_trainer", "sub_trainer", "admin"];
// Admin by UID (matches functions/index.js + firestore.rules isAdmin()) — a
// real profile doc never carries role "admin", so anything admin-gated must
// check the UID, not the role.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
function planFor(profile) {
  if (!profile) return "free";
  if (profile.role === "admin") return "ultra";
  if (profile.entitlements && profile.entitlements.premium === true) return "premium";
  if (profile.subscriptionStatus === "active") {
    // Order matters: check ultra before max before coach, since the coach tiers
    // are named coach_max / coach_ultra. (A plain "includes(max)" test used to
    // drop ultra/coach_ultra — the TOP tiers — down to the premium cap.)
    const t = String(profile.subscriptionTier || "").toLowerCase();
    // Connect first: "coach_connect" contains "coach", and Connect is a plugin
    // tier — it must not inherit the coach AI-tier cap by substring accident.
    if (t.includes("connect")) return "connect";
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

// Where the trial sits, for the connector's own voice (S174). The cap alone
// made the trial silent: it ran at full speed for 30 days and then hit a wall
// with no warning, so the one moment the whole model depends on — noticing what
// you are about to lose — arrived as a surprise. Read straight from the same
// two profile fields planFor uses, so the two can never disagree.
// A grandfathered account (no trialStartedAt) reports nothing; it has no trial
// to narrate and is not being sold to.
function trialState(profile) {
  const t = profile && profile.trialStartedAt;
  const startMs = t && typeof t.toMillis === "function" ? t.toMillis()
    : typeof t === "number" ? t : null;
  if (!startMs) return { known: false, onTrial: false, daysLeft: null, dayOf: null };
  const lengthDays = profile.trialLengthDays || 30;
  const endMs = startMs + (lengthDays * 86400000);
  const msLeft = endMs - Date.now();
  return {
    known: true,
    onTrial: msLeft > 0,
    lengthDays,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)),
    dayOf: Math.min(lengthDays, Math.max(1, Math.ceil((Date.now() - startMs) / 86400000))),
  };
}

// The note the external model reads. Two registers on purpose: for most of the
// trial the job is to get them USING it (an unused trial converts nobody), and
// in the last week it flips to naming what happens and what it costs. Told to
// mention it once rather than every turn — a connector that nags on every tool
// call is worse than one that stays quiet.
// Deliberately names NO price (Kevin, S174). A price quoted here goes stale the
// day the ladder changes and we would never know the model was still saying it,
// and it pulls the decision out of the app — away from the plan grid that is the
// only place the tiers are actually explained. Every path points back inside.
function trialNote(profile, isTrainer) {
  const tr = trialState(profile);
  if (!tr.known || !tr.onTrial) return "";
  const d = tr.daysLeft;
  const dayWord = `${d} day${d === 1 ? "" : "s"}`;
  if (d > 7) {
    return ` This account is on day ${tr.dayOf} of a ${tr.lengthDays}-day Glidna trial, and the `
      + `connector is running at full speed — ${dayWord} left. Say so once when it fits naturally, `
      + `not every turn, and when you do, push them to actually lean on it: log meals through you `
      + `instead of typing them, ask for the week's numbers, have it build the workouts. The trial `
      + `is only worth anything if they finish it knowing what it saved them.`;
  }
  return ` This account's Glidna trial ends in ${dayWord}, and the connector switches off when it `
    + `does. Tell them once at the start of a conversation, warmly and without pressure: everything `
    + `they have logged stays theirs, the app and all manual tracking stay free, and they can open `
    + `the Glidna app and choose a subscription to keep you connected after the trial ends. Do not `
    + `quote a price — the app shows the current plans.`;
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
async function grantFromRequest(req) {
  const h = req.get("authorization") || req.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return null;
  const token = m[1];
  // 1) An OAuth access token we issued (how Claude and every real MCP client
  //    authenticates — opaque, hashed in Firestore, audience-bound). Its
  //    granted scopes decide which write tools get exposed.
  try {
    const grant = await verifyAccessToken(admin.firestore(), token);
    if (grant && grant.uid) return { uid: grant.uid, scope: grant.scope || "read" };
  } catch (e) { /* fall through */ }
  // 2) A Firebase ID token — first-party/testing path (kept so the endpoint
  //    stays directly testable without running the whole OAuth dance). This is
  //    the account owner's own session, so it carries every scope their ROLE
  //    allows; buildTools still role-gates the trainer tools on top.
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded && decoded.uid
      ? { uid: decoded.uid, scope: "read write:logs write:plan trainer" }
      : null;
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
function buildServer(ctx, profile, db, scopes) {
  const server = new McpServer(
    { name: "glidna", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      // Without this the external model has NO idea what day it is for this
      // user and fills date arguments from its own clock — reliably a day out.
      // The in-app assistant gets the same fact via its system prompt.
      instructions:
        `Glidna is ${ctx.callerName ? ctx.callerName + "'s" : "the user's"} fitness and nutrition app. `
        + `Today is ${ctx.today} (${ctx.weekday || "today"}) in the user's timezone. `
        + `When logging or reading, OMIT any date argument to mean today — only pass an explicit `
        + `date when the user names a different day, and say the date back to them when you do. `
        + `Writes go to the signed-in account unless you target someone else, so when acting on `
        + `behalf of a client always pass their id. A trainer's people live in TWO places: connected `
        + `accounts (pass clientId) and the trainer's own plan files (pass localPlanId, never both at `
        + `once) — a plan file is usually a real client who simply has no app account, and every read `
        + `and write works the same on them. find_client searches both in one call and tells you which `
        + `kind each match is.`
        + (ctx.isTrainer && ctx.seatCap !== null
          ? ` Paid plans include a monthly allowance of distinct people the AI works on. If a tool `
            + `refuses because someone "isn't one of this month's AI clients yet", tell the user it `
            + `will use one of their monthly slots, get their explicit yes, call confirm_ai_client `
            + `with the same id, then retry. Never confirm silently. If the monthly limit is reached, `
            + `say so plainly — manual features and existing AI clients keep working — and point to `
            + `Plans & pricing in the Glidna app without quoting a price.`
          : ``)
        + trialNote(profile, ctx.isTrainer),
    },
  );

  const plan = planFor(profile);
  const granted = new Set(Array.isArray(scopes) ? scopes : String(scopes || "read").split(/\s+/));
  // Two gates, in order: (1) buildTools role-filters, so a client never sees a
  // trainer tool; (2) the token's scopes decide which writes are exposed.
  const defs = buildTools(ctx.role).filter((t) => {
    if (READ_TOOLS.has(t.name)) return granted.has("read");
    const need = SCOPE_FOR_TOOL[t.name];
    return need ? granted.has(need) : false; // unlisted tools are never exposed
  });

  for (const def of defs) {
    // The MCP SDK wants a Zod shape; our tools carry JSON Schema.
    const props = (def.input_schema && def.input_schema.properties) || {};
    const required = new Set((def.input_schema && def.input_schema.required) || []);
    const shape = {};
    for (const [key, spec] of Object.entries(props)) {
      let zt = toZod(spec);
      if (spec && spec.description) zt = zt.describe(spec.description);
      shape[key] = required.has(key) ? zt : zt.optional();
    }

    // confirm_ai_client rides READ_TOOLS for EXPOSURE (read-only connections
    // must be able to seat someone) but is not annotated read-only — it spends
    // a slot, and the hint should be honest.
    const isRead = READ_TOOLS.has(def.name) && def.name !== "confirm_ai_client";
    const needScope = SCOPE_FOR_TOOL[def.name] || null;
    server.registerTool(
      def.name,
      {
        title: def.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        // Descriptions must stand alone: an external model has none of our
        // system prompt. aitools.js descriptions are already self-contained;
        // MCP_DESCRIPTION_EXTRA adds the batching/confirmation guidance the
        // in-app system prompt would otherwise supply.
        description: def.description + (MCP_DESCRIPTION_EXTRA[def.name] || ""),
        inputSchema: shape,
        // Required for the Anthropic connector directory; also drives Claude's
        // confirmation UX (a destructive tool gets a stronger prompt).
        annotations: {
          readOnlyHint: isRead,
          destructiveHint: DESTRUCTIVE_TOOLS.has(def.name),
          openWorldHint: false,
        },
      },
      async (args) => {
        // Defence in depth: re-check scope at CALL time, not just at
        // registration. A client that somehow invokes an unregistered tool
        // still can't write.
        if (needScope && !granted.has(needScope)) {
          return {
            isError: true,
            content: [{ type: "text", text:
              `Permission "${needScope}" was not granted for this connection. `
              + "Reconnect Glidna in your AI assistant's settings and approve the additional permission." }],
          };
        }
        const charge = await chargeCall(db, ctx.callerUid, plan);
        if (!charge.ok) {
          // Two different failures wearing one message before S173. A paid user
          // who ran out today resets tonight; a free user never does, and
          // telling them to wait for midnight would be a lie they act on. The
          // free case is also the moment the whole trial was building toward,
          // so it names the price instead of saying "upgrade".
          const isTrainer = !!ctx.isTrainer;
          const text = charge.cap === 0
            ? `Your Glidna free trial has ended, so the connector is switched off. `
              + `Everything you have logged is safe, and manual tracking in the app stays free forever. `
              + `To keep using Glidna from ${isTrainer ? "your AI across your whole roster" : "your own AI"}, `
              + `open the Glidna app and upgrade your subscription — the connector turns back on as `
              + `soon as you do, with full access to everything you had during the trial. `
              + `Don't quote a price; the app shows the current plans.`
            : `Daily Glidna connector limit reached (${charge.cap} calls on the ${plan} plan). `
              + `It resets at midnight UTC. Upgrade in the app for a higher limit.`;
          return { isError: true, content: [{ type: "text", text }] };
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

exports.mcp = onRequest({ cors: false, timeoutSeconds: 300,
  secrets: [FATSECRET_PROXY_URL, FATSECRET_PROXY_SECRET] }, async (req, res) => {
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

  const grant = await grantFromRequest(req);
  if (!grant) { unauthorized(req, res); return; }
  const uid = grant.uid;

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
    aiOptOut: profile.aiOptOut === true,
    callerName,
    today: todayLocal(),
    weekday: weekdayLocal(),
    nowTime: nowTimeLocal(),
    // AI-client seat cap (S176f) — same profile-derived cap the in-app chat
    // attaches, so runTool's seat gate treats both surfaces identically. Admin
    // by UID: the profile role is never "admin" on a real doc.
    seatCap: ADMIN_UIDS.includes(uid) ? null : seatCapFor(profile),
  };

  let server, transport;
  try {
    server = buildServer(ctx, profile, db, grant.scope);
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
function weekdayLocal() {
  try {
    return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
  } catch (e) { return ""; }
}

function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function nowTimeLocal() {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
