// Glide Cloud Functions
//
// Stage 1 of the Blaze security migration (see docs/BLAZE_MIGRATION.md):
// keep tamper-proof Firebase custom claims in sync with each user's profile
// doc, so server-side functions and (later) the security rules can trust
// `request.auth.token.role` instead of reading the profile on every request.
//
// Custom claims can ONLY be set by this trusted Admin-SDK code — never the
// client — which is what makes role enforcement tamper-proof.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Admin is hardcoded by UID (matches isAdmin() in firestore.rules). The claim
// is derived server-side, so the admin role can never be self-assigned.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];

// The minimal claim set mirrored from a profile doc. Kept small (claims have a
// ~1000-byte budget and every change forces the user's token to refresh).
function claimsFromProfile(uid, data) {
  const role = ADMIN_UIDS.includes(uid) ? "admin" : (data && data.role) || "client";
  return {
    role,
    assignedTrainerId: (data && data.assignedTrainerId) || null,
    headTrainerId: (data && data.headTrainerId) || null,
  };
}

function sameClaims(a, b) {
  if (!a) return false;
  return a.role === b.role
    && (a.assignedTrainerId || null) === (b.assignedTrainerId || null)
    && (a.headTrainerId || null) === (b.headTrainerId || null);
}

// Set claims on a single uid if they differ from what's already on the token.
// Returns "set" | "skip" | "missing" (no matching auth user).
async function applyClaims(uid, profileData) {
  const next = claimsFromProfile(uid, profileData);
  let user;
  try {
    user = await admin.auth().getUser(uid);
  } catch (e) {
    return "missing";
  }
  if (sameClaims(user.customClaims, next)) return "skip";
  await admin.auth().setCustomUserClaims(uid, next);
  return "set";
}

// Keep custom claims in sync whenever a profile doc is created or changes.
// No write-back to the doc (that would re-trigger this) — clients pick up new
// claims by force-refreshing their ID token (handled app-side on load).
exports.syncRoleClaims = onDocumentWritten("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const after = event.data && event.data.after && event.data.after.exists
    ? event.data.after.data() : null;
  if (!after) return; // profile deleted — leave any existing claims untouched
  const result = await applyClaims(uid, after);
  if (result === "set") console.log("syncRoleClaims: updated claims for", uid);
  else if (result === "missing") console.warn("syncRoleClaims: no auth user for", uid);
});

// One-off backfill so every EXISTING user gets claims. Admin-only. Invoke once
// after deploy (see deploy notes), then it can be left in place harmlessly.
exports.backfillRoleClaims = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid || !ADMIN_UIDS.includes(callerUid)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const snap = await admin.firestore().collection("users").get();
  let set = 0, skip = 0, missing = 0;
  for (const doc of snap.docs) {
    const r = await applyClaims(doc.id, doc.data());
    if (r === "set") set++;
    else if (r === "skip") skip++;
    else missing++;
  }
  return { total: snap.size, set, skip, missing };
});

// AI chat — defined in ./aichat.js. Required after initializeApp() above so it
// shares the initialized Admin app. aiChat = callable (fallback); aiChatStream =
// HTTP/SSE streaming endpoint (primary, replies appear word-by-word).
exports.aiChat = require("./aichat").aiChat;
exports.aiChatStream = require("./aichat").aiChatStream;
exports.logMeal = require("./aichat").logMeal; // direct write for the meal Accept card
exports.setWorkoutSchedule = require("./aichat").setWorkoutSchedule; // workout Accept card
exports.transcribeAudio = require("./transcribe").transcribeAudio; // voice → text (Whisper)
exports.sendInvite = require("./invites").sendInvite; // email invites (Option C)
exports.trainerizeTest = require("./trainerize").trainerizeTest; // Trainerize connection test (import step 1)
exports.trainerizeImport = require("./trainerize").trainerizeImport; // Trainerize roster + snapshot importer (v1)
exports.trainerizeAutoSync = require("./trainerize").trainerizeAutoSync; // 30-min background sync of imported clients
// Biometric login (Face ID / Touch ID passkeys — S87). Register while signed in;
// sign in signed-out via custom token. See functions/webauthn.js.
exports.passkeyRegisterOptions = require("./webauthn").passkeyRegisterOptions;
exports.passkeyRegisterVerify = require("./webauthn").passkeyRegisterVerify;
exports.passkeyLoginOptions = require("./webauthn").passkeyLoginOptions;
exports.passkeyLoginVerify = require("./webauthn").passkeyLoginVerify;
// AI food estimate for the manual meal tracker (S89c) — cheap direct call,
// same daily budget + trial gate as the chat. See functions/aichat.js.
exports.estimateFood = require("./aichat").estimateFood;
// Stripe billing v1 (S89) — simple subscriptions; webhook is the only writer
// of profile.subscriptionStatus. See functions/billing.js for setup steps.
exports.createCheckoutSession = require("./billing").createCheckoutSession;
exports.createPortalSession = require("./billing").createPortalSession;
exports.stripeWebhook = require("./billing").stripeWebhook;
// Max-tier same-day allowance boost (S90) — instant-approve, once/day, logged
// to aiUsage/meta for the admin dashboard's flags. See functions/aichat.js.
exports.requestBudgetBoost = require("./aichat").requestBudgetBoost;
// Push-notification delivery (S90) — Web Push/VAPID; see functions/push.js.
exports.savePushSub = require("./push").savePushSub;
exports.removePushSub = require("./push").removePushSub;
exports.onDmCreated = require("./push").onDmCreated;
exports.onTrainerRequestWritten = require("./push").onTrainerRequestWritten;
// Client → trainer requests (S90) — server-side write into the trainer's
// inbox (a client can't touch trainer kv under the rules). functions/requests.js.
exports.sendTrainerRequest = require("./requests").sendTrainerRequest;

// ── adminOverview (S90, Kevin's ask): every user at a glance ────────────────
// Admin-only. Server-side Admin SDK reads (no rules change needed): profile +
// subscription/trial state + today's AI usage + boost-request flags. Read-only.
exports.adminOverview = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid || !ADMIN_UIDS.includes(callerUid)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const db = admin.firestore();
  // Same day key the AI budget uses (UTC — matches aichat.js todayKey).
  const d = new Date();
  const today = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const snap = await db.collection("users").limit(500).get();
  const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : (typeof v === "number" ? v : null));
  const users = await Promise.all(snap.docs.map(async (doc) => {
    const p = doc.data() || {};
    const [u, m] = await Promise.all([
      db.doc(`users/${doc.id}/aiUsage/${today}`).get(),
      db.doc(`users/${doc.id}/aiUsage/meta`).get(),
    ]);
    const usage = u.data() || {};
    const meta = m.data() || {};
    return {
      uid: doc.id,
      name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || "",
      email: p.email || "",
      role: p.role || "client",
      assignedTrainerId: p.assignedTrainerId || null,
      subscriptionStatus: p.subscriptionStatus || null,
      subscriptionTier: p.subscriptionTier || null,
      trialStartedAt: toMs(p.trialStartedAt),
      trialLengthDays: p.trialLengthDays || null,
      createdAt: toMs(p.createdAt),
      aiTokensToday: usage.tokens || 0,
      boostToday: usage.boost || 0,
      boostCount: meta.boostCount || 0,
      lastBoostAt: meta.lastBoostAt || null,
    };
  }));
  return { users, today };
});
