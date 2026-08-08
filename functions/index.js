// Glide Cloud Functions
//
// Stage 1 of the Blaze security migration (see docs/BLAZE_MIGRATION.md):
// keep tamper-proof Firebase custom claims in sync with each user's profile
// doc, so server-side functions and (later) the security rules can trust
// `request.auth.token.role` instead of reading the profile on every request.
//
// Custom claims can ONLY be set by this trusted Admin-SDK code — never the
// client — which is what makes role enforcement tamper-proof.

const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const aiusage = require("./aiusage");

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

// ─── The trial fence (S178d) ───────────────────────────────────────────────
// A profile with no `trialStartedAt` is treated as GRANDFATHERED everywhere —
// permanently unlocked, full paid AI, free forever (trialExpiredFor in
// aichat.js, isPremium in src/profile.js, seatCapFor in aitools.js all agree).
// That was a deliberate courtesy to Kevin's earliest accounts, but it is also a
// hazard: any future sign-up path that forgets to stamp the field silently
// mints another free-forever paid account, and nobody would notice.
//
// createProfile (src/profile.js) does stamp it today — this is the backstop for
// when it doesn't. onDocumentCreated fires ONLY for genuinely new profile docs,
// so every pre-existing grandfathered account is untouched by construction:
// their doc was created long ago and will never fire this. That is exactly the
// line Kevin drew — fence the hazard, keep the courtesy (docs/PRICING.md S176f).
//
// The Admin SDK bypasses the S85 rules lock that stops owners writing these
// fields, which is why this has to live server-side at all.
exports.fenceNewAccountTrial = onDocumentCreated("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const snap = event.data;
  if (!snap || !snap.exists) return;
  const d = snap.data() || {};
  // Already stamped by createProfile (the normal path) — nothing to do. Also
  // leave paid/comped accounts alone: they don't need a trial.
  if (d.trialStartedAt || d.subscriptionStatus === "active"
      || (d.entitlements && d.entitlements.premium === true)) return;
  try {
    await snap.ref.set({
      trialStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      trialLengthDays: 30,
      subscriptionStatus: "trial",
      trialStampedBy: "fence",   // so a later audit can tell these apart
    }, { merge: true });
    console.warn("fenceNewAccountTrial: stamped a trial on", uid,
      "— a creation path skipped it; find and fix that path.");
  } catch (e) {
    // Never throw: a failure here must not break account creation. The account
    // simply stays grandfathered, which is the pre-S178d behaviour.
    console.error("fenceNewAccountTrial: failed for", uid, e && e.message);
  }
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
// The free roster cap (S179) — see functions/roster.js for why the join has to
// be server-side at all.
// Referral rewards (S181) — see functions/referrals.js for the solvency rule.
exports.myReferralCode = require("./referrals").myReferralCode;
exports.claimReferral = require("./referrals").claimReferral;
exports.myReferrals = require("./referrals").myReferrals;
exports.claimReferralCredit = require("./referrals").claimReferralCredit;
exports.testVestReferral = require("./referrals").testVestReferral;  // admin-only rehearsal hook
// Daily: tells a referrer their reward has vested, naming both ways to take it.
exports.referralVestNotify = require("./referrals").referralVestNotify;

exports.joinTrainerByCode = require("./roster").joinTrainerByCode;
exports.myRosterStatus = require("./roster").myRosterStatus;

exports.aiChat = require("./aichat").aiChat;
exports.aiChatStream = require("./aichat").aiChatStream;
exports.logMeal = require("./aichat").logMeal; // direct write for the meal Accept card
exports.reviewMeal = require("./aichat").reviewMeal; // trainer confirms/adjusts a tagged meal (S183g)
exports.setWorkoutSchedule = require("./aichat").setWorkoutSchedule; // workout Accept card
exports.transcribeAudio = require("./transcribe").transcribeAudio; // voice → text (Whisper)
exports.sendInvite = require("./invites").sendInvite; // email invites (Option C)
exports.trialReminders = require("./trialreminder").trialReminders; // daily reverse-trial reminder emails (S92)

// Scheduled AI automations / workflows (S92, Phase 1 backend — UI is Phase 2)
exports.saveWorkflow = require("./workflows").saveWorkflow;
exports.listWorkflows = require("./workflows").listWorkflows;
exports.toggleWorkflow = require("./workflows").toggleWorkflow;
exports.deleteWorkflow = require("./workflows").deleteWorkflow;
exports.runDueWorkflows = require("./workflows").runDueWorkflows; // hourly dispatcher
exports.trainerizeTest = require("./trainerize").trainerizeTest; // Trainerize connection test (import step 1)
exports.trainerizeImport = require("./trainerize").trainerizeImport; // Trainerize roster + snapshot importer (v1)
exports.trainerizeAutoSync = require("./trainerize").trainerizeAutoSync; // 30-min background sync of imported clients
// Session billing phase 3 step 1 (S101): card on file + the authorization
// record. Saves and removes cards; charges nothing — the per-session and
// weekly dispatchers come next and can only run against a card saved here.
exports.createSessionSetupIntent = require("./sessionBilling").createSessionSetupIntent;
exports.recordSessionConsent = require("./sessionBilling").recordSessionConsent;
exports.removeSessionCard = require("./sessionBilling").removeSessionCard;
// The settle dispatcher (S101c): hourly sweep + Kevin's manual/dry-run trigger.
exports.sessionsSettle = require("./sessionSettle").sessionsSettle;
exports.settleNow = require("./sessionSettle").settleNow;
exports.paySessionBalance = require("./sessionSettle").paySessionBalance; // pay-now retry for a declined balance (S103)
// Biometric login (Face ID / Touch ID passkeys — S87). Register while signed in;
// sign in signed-out via custom token. See functions/webauthn.js.
exports.passkeyRegisterOptions = require("./webauthn").passkeyRegisterOptions;
exports.passkeyRegisterVerify = require("./webauthn").passkeyRegisterVerify;
exports.passkeyLoginOptions = require("./webauthn").passkeyLoginOptions;
exports.passkeyLoginVerify = require("./webauthn").passkeyLoginVerify;
// AI food estimate for the manual meal tracker (S89c) — cheap direct call,
// same daily budget + trial gate as the chat. See functions/aichat.js.
exports.estimateFood = require("./aichat").estimateFood;
exports.aiSeats = require("./aichat").aiSeats; // AI-client seats view (S176f)
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
exports.onMealReviewWritten = require("./push").onMealReviewWritten; // meal tagged / trainer verdict (S183h)
// Scheduled reminder pushes (S96) — the S77 in-app nudges, delivered for real.
exports.foodReminderPush = require("./push").foodReminderPush;
exports.weighInReminderPush = require("./push").weighInReminderPush;
// Client → trainer requests (S90) — server-side write into the trainer's
// inbox (a client can't touch trainer kv under the rules). functions/requests.js.
exports.sendTrainerRequest = require("./requests").sendTrainerRequest;
// FatSecret food-search proxy (S93) — adds a curated food library to typed
// search, merged with USDA + Open Food Facts. See functions/foodsearch.js for
// the (Kevin) FatSecret account + secret setup. No-op until the secrets are set.
exports.foodSearch = require("./foodsearch").foodSearch;

// MCP connector (S112, Phase 1 — READ-ONLY): exposes Glide as a remote MCP
// server so a user's OWN Claude can read their Glide data. Stateless Streamable
// HTTP over the same aitools.js runTool the chat uses. See docs/MCP-CONNECTOR.md.
// ⭐ Parity rule: in-app AI and this connector must keep the same capabilities.
exports.mcp = require("./mcp").mcp;
// Phase 2 (S113) — the OAuth 2.1 layer that lets a user connect their Glidna
// account from their OWN Claude. Fronted by glidna.com via vercel.json rewrites
// (OAuth discovery requires /.well-known/* on the issuer's host).
exports.mcpMetadata = require("./mcpauth").mcpMetadata;   // RFC 9728 + RFC 8414 discovery
exports.mcpRegister = require("./mcpauth").mcpRegister;   // RFC 7591 dynamic client registration
exports.mcpAuthorize = require("./mcpauth").mcpAuthorize; // consent page → single-use code
exports.mcpToken = require("./mcpauth").mcpToken;         // code/refresh → opaque tokens

// Trainer TEAM management (S116) — head trainer ↔ sub-trainers. Server-side
// because firestore.rules blocks a user changing their own role. See team.js.
exports.joinTeam = require("./team").joinTeam;
exports.leaveTeam = require("./team").leaveTeam;
exports.removeSubTrainer = require("./team").removeSubTrainer;
exports.listTeam = require("./team").listTeam;

// Training sessions (S100): the "red line" — stamps completedAt on sessions
// whose end time has passed. That stamp is what Sunday billing will bill from.
exports.sessionsMarkCompleted = require("./sessions").sessionsMarkCompleted;

// ── appRequests (S140): feature requests users sent through the AI ──────────
// Admin-only, Admin-SDK reads/writes (top-level `appRequests`, no client rules —
// same shape as `workflows`). The AI writes them via the send_app_request tool.
exports.listAppRequests = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid || !ADMIN_UIDS.includes(callerUid)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const db = admin.firestore();
  const snap = await db.collection("appRequests").orderBy("createdAt", "desc").limit(200).get();
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  return { requests: rows, newCount: rows.filter((r) => r.status === "new").length };
});

// Triage: "reviewed" (read it) or "planned"/"declined". Kept as free-form status
// so the workflow can evolve without a schema migration.
exports.setAppRequestStatus = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid || !ADMIN_UIDS.includes(callerUid)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const id = String((request.data && request.data.id) || "");
  const status = String((request.data && request.data.status) || "");
  if (!id || !["new", "reviewed", "planned", "declined"].includes(status)) {
    throw new HttpsError("invalid-argument", "id and a valid status are required.");
  }
  await admin.firestore().doc(`appRequests/${id}`).set(
    { status, reviewedAt: Date.now(), reviewedBy: callerUid }, { merge: true });
  return { ok: true, id, status };
});

// ── adminOverview (S90, Kevin's ask): every user at a glance ────────────────
// Admin-only. Server-side Admin SDK reads (no rules change needed): profile +
// subscription/trial state + today's AI usage + boost-request flags. Read-only.
exports.adminOverview = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid || !ADMIN_UIDS.includes(callerUid)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const db = admin.firestore();
  // Same keys the AI budget uses — local (Eastern) day since S167, so "today"
  // here means the same day the person had.
  const today = aiusage.dayKey();
  const month = aiusage.monthKey();
  const year = aiusage.yearKey();
  const snap = await db.collection("users").limit(500).get();
  const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : (typeof v === "number" ? v : null));
  const users = await Promise.all(snap.docs.map(async (doc) => {
    const p = doc.data() || {};
    // Four reads per user: today, this month, this year, lifetime. Rollups are
    // incremented at write time, so a year of spend costs ONE read rather than
    // 365 — that is the whole reason the month/year docs exist.
    const [u, mo, yr, m] = await Promise.all([
      db.doc(`users/${doc.id}/aiUsage/${today}`).get(),
      db.doc(`users/${doc.id}/aiUsage/${month}`).get(),
      db.doc(`users/${doc.id}/aiUsage/${year}`).get(),
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
      // Spend windows. `costMicros` is null on rows written before S167 — those
      // day docs only ever stored the budget aggregate, so their cost is
      // genuinely unknown rather than zero, and the UI says so.
      usage: {
        day: aiusage.readUsage(u),
        month: aiusage.readUsage(mo),
        year: aiusage.readUsage(yr),
        life: aiusage.readUsage(m),
      },
    };
  }));
  // Grandfathered tally (S178d). An account with no trialStartedAt is treated
  // as permanently unlocked everywhere, so Kevin needs the real number before
  // deciding the courtesy window (docs/PRICING.md S176f: count first, then a
  // ~12-month window, then free Connect for life). Computed from rows already
  // read — no extra Firestore cost. `fenced` counts accounts the S178d trigger
  // had to stamp: any non-zero value means a creation path is skipping the
  // stamp and should be found.
  const grandfathered = users
    .filter((u) => !u.trialStartedAt && u.subscriptionStatus !== "active")
    .map((u) => ({ uid: u.uid, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }));
  const fenced = snap.docs.filter((d) => (d.data() || {}).trialStampedBy === "fence").length;

  return { users, today, month, year, pricing: aiusage.PRICING[aiusage.DEFAULT_MODEL], model: aiusage.DEFAULT_MODEL,
    grandfathered: { count: grandfathered.length, accounts: grandfathered.slice(0, 100) }, fenced };
});

// ── adminUserUsage (S167): one user's spend history, for the detail view ────
// Kept separate from adminOverview because it is the expensive read (a day doc
// per day, a month doc per month). Fetching this for every user on every
// dashboard load is what the month/year rollups exist to avoid.
exports.adminUserUsage = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid || !ADMIN_UIDS.includes(callerUid)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const uid = String((request.data && request.data.uid) || "");
  if (!uid) throw new HttpsError("invalid-argument", "Which user?");
  const days = Math.min(90, Math.max(1, Number((request.data && request.data.days) || 30)));
  const db = admin.firestore();
  const col = db.collection(`users/${uid}/aiUsage`);

  const dayIds = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayIds.push(aiusage.dayKey(d));
  }
  const monthIds = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setDate(1);                 // pin to the 1st BEFORE stepping months back,
    d.setMonth(d.getMonth() - i); // or the 31st rolls into the wrong month
    monthIds.push(aiusage.monthKey(d));
  }
  const [dayDocs, monthDocs, profDoc] = await Promise.all([
    Promise.all(dayIds.map((id) => col.doc(id).get())),
    Promise.all(monthIds.map((id) => col.doc(id).get())),
    db.doc(`users/${uid}`).get(),
  ]);
  const p = profDoc.data() || {};
  return {
    uid,
    name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || uid.slice(0, 8),
    email: p.email || "",
    days: dayIds.map((id, i) => ({ key: id, ...aiusage.readUsage(dayDocs[i]) })),
    months: monthIds.map((id, i) => ({ key: id.slice(2), ...aiusage.readUsage(monthDocs[i]) })),
  };
});
