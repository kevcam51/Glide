// Push-notification DELIVERY (S90) — the Notification Center finally sends.
//
// Raw Web Push (VAPID) rather than the FCM console flow: we own the keypair
// (private half in Secret Manager as VAPID_PRIVATE_KEY; the public half is
// public by design and lives here + in src/push.js), and it works on
// Chrome/Android/desktop plus iOS 16.4+ when Glidna is installed to the home
// screen. Subscriptions live at users/{uid}/pushSubs/{hash} — written ONLY via
// the callables below (Admin SDK), so no firestore.rules change is needed and
// trainers can never read a client's push endpoints.
//
// v1 triggers: a new DM (threads/*/msgs) notifies the recipient; a new
// trainer→client to-do (kv caliq-requests) notifies the client. Every send is
// gated by the recipient's caliq-notif-prefs (master + the matching type), so
// the Notification Center toggles govern delivery too.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const webpush = require("web-push");
const crypto = require("crypto");

const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
const VAPID_PUBLIC_KEY = "BMJwuoE8hBDthTSE74g_FiqShOWhr68N05rmHdzLkz53nMUBQ_Mzt63U5Q7Pbz8_9Y3Z0vkGexBJ8BS1zIwFaDI";
const VAPID_SUBJECT = "mailto:kevin@smoothtraining.com";

const subHash = (endpoint) => crypto.createHash("sha1").update(String(endpoint)).digest("hex").slice(0, 24);

// ── subscription management (called from src/push.js) ───────────────────────
exports.savePushSub = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const sub = request.data && request.data.sub;
  if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")
      || !sub.keys || typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string") {
    throw new HttpsError("invalid-argument", "Not a valid push subscription.");
  }
  const db = admin.firestore();
  await db.doc(`users/${uid}/pushSubs/${subHash(sub.endpoint)}`).set({
    sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    ua: String((request.data && request.data.ua) || "").slice(0, 160),
    createdAt: Date.now(),
  });
  return { ok: true };
});

exports.removePushSub = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const endpoint = request.data && request.data.endpoint;
  if (typeof endpoint !== "string") throw new HttpsError("invalid-argument", "Missing endpoint.");
  await admin.firestore().doc(`users/${uid}/pushSubs/${subHash(endpoint)}`).delete().catch(() => {});
  return { ok: true };
});

// ── send helper (exported for other functions, e.g. client→trainer requests) ─
async function notifPrefsOf(db, uid) {
  try {
    const d = (await db.doc(`users/${uid}/kv/caliq-notif-prefs`).get()).data();
    const p = d && d.value ? JSON.parse(d.value) : {};
    return p && typeof p === "object" ? p : {};
  } catch { return {}; }
}
const prefOn = (p, key) => p.master !== false && (!key || p[key] !== false);

// Bell feed (S90b): every notification-worthy event ALSO lands in the user's
// in-app feed doc (kv caliq-notif-feed {items[], seenTs}) — one source of
// truth with push. Written unconditionally (the bell is history, not a nudge);
// the push below still respects the user's Notification Center prefs.
// Transactional append, capped 50, best-effort.
async function appendFeed(db, uid, payload) {
  const ref = db.doc(`users/${uid}/kv/caliq-notif-feed`);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let cur = {};
      try { cur = snap.exists ? JSON.parse(snap.data().value || "{}") : {}; } catch { cur = {}; }
      const items = Array.isArray(cur.items) ? cur.items : [];
      items.unshift({
        id: `n${Date.now()}${Math.floor(Math.random() * 1e4)}`,
        tag: String(payload.tag || ""),
        title: String(payload.title || "").slice(0, 80),
        // 300, not 140 (S197b, Kevin: "the text gets chopped off"). A push
        // notification is a headline the OS truncates anyway, but the FEED is
        // where someone goes to actually read what they missed — cutting it at
        // 140 characters meant the bell held a permanently half-finished
        // sentence, with no way to see the rest.
        body: String(payload.body || "").slice(0, 300),
        // ⚠️ WHERE IT GOES. The feed stored no destination, so every row was
        // inert: a to-do could say "please add a payment card" and tapping it
        // did nothing at all. The push payload has always carried a `url`; it
        // simply was not kept. Stored now so a row can take you to the thing it
        // is about.
        url: String(payload.url || "") || undefined,
        ts: Date.now(),
      });
      tx.set(ref, { k: "caliq-notif-feed", value: JSON.stringify({ ...cur, items: items.slice(0, 50) }) });
    });
  } catch (e) { /* feed is best-effort */ }
}

async function sendPushTo(db, uid, payload, prefKey) {
  await appendFeed(db, uid, payload);
  const prefs = await notifPrefsOf(db, uid);
  if (!prefOn(prefs, prefKey)) return { skipped: "prefs" };
  const subs = await db.collection(`users/${uid}/pushSubs`).limit(10).get();
  if (subs.empty) return { skipped: "no-subs" };
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.value());
  let sent = 0, pruned = 0;
  await Promise.all(subs.docs.map(async (d) => {
    try {
      await webpush.sendNotification(d.data().sub, JSON.stringify(payload), { TTL: 86400 });
      sent++;
    } catch (e) {
      // 404/410 = the browser dropped the subscription — prune it.
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { pruned++; await d.ref.delete().catch(() => {}); }
    }
  }));
  return { sent, pruned };
}
exports.sendPushTo = sendPushTo;
exports.appendFeed = appendFeed; // feed-only delivery (no push/secret) — used by workflows (S92)
exports.VAPID_PRIVATE_KEY = VAPID_PRIVATE_KEY; // so other fns (workflows) can list it in `secrets`

// ── trigger: new direct message → notify the recipient ──────────────────────
exports.onDmCreated = onDocumentCreated(
  { document: "threads/{tid}/msgs/{mid}", region: "us-central1", secrets: [VAPID_PRIVATE_KEY], maxInstances: 10 },
  async (event) => {
    const msg = event.data && event.data.data();
    if (!msg || !msg.from) return;
    // S183h: a POINTER message (a tagged meal, a to-do) is mirrored into chat
    // alongside the kv write that is the real record — and that kv write has
    // its own trigger. Without this guard each one notifies TWICE for a single
    // action. The dedicated notifier always says something more useful than a
    // bare DM ("already in their log; confirm or correct it" vs the raw text),
    // so it wins and this one stands down.
    //
    // The to-do half of this was pre-existing: onTrainerRequestWritten has
    // buzzed for caliq-requests while this fired for the chat mirror ever since
    // S124 put to-dos in the conversation.
    if (msg.kind === "meal" || msg.kind === "todo") return;
    const db = admin.firestore();
    const thread = (await db.doc(`threads/${event.params.tid}`).get()).data();
    if (!thread || !Array.isArray(thread.participants)) return;
    const to = thread.participants.find((u) => u !== msg.from);
    if (!to) return;
    const sender = (await db.doc(`users/${msg.from}`).get()).data() || {};
    const name = sender.displayName || [sender.firstName, sender.lastName].filter(Boolean).join(" ") || "New message";
    const r = await sendPushTo(db, to,
      { title: name, body: String(msg.text || "").slice(0, 120), tag: `dm-${event.params.tid}`, url: "/" },
      "messages");
    console.log("onDmCreated push", JSON.stringify({ to, ...r }));
  });

// ── trigger: new trainer→client to-do → notify the client ───────────────────
// Literal path segment = this only fires for the caliq-requests doc, not every
// kv write. The request list is a JSON array in the doc's `value`; diff
// before/after by id and notify only for genuinely NEW open items.
exports.onTrainerRequestWritten = onDocumentWritten(
  { document: "users/{uid}/kv/caliq-requests", region: "us-central1", secrets: [VAPID_PRIVATE_KEY], maxInstances: 10 },
  async (event) => {
    const uid = event.params.uid;
    const parse = (snap) => {
      try {
        const d = snap && snap.data();
        const a = d && d.value ? JSON.parse(d.value) : [];
        return Array.isArray(a) ? a : [];
      } catch { return []; }
    };
    const before = parse(event.data && event.data.before);
    const after = parse(event.data && event.data.after);
    const oldIds = new Set(before.map((r) => r && r.id));
    const fresh = after.filter((r) => r && r.status === "open" && !oldIds.has(r.id));
    if (!fresh.length) return;
    const db = admin.firestore();
    const first = fresh[0];
    const r = await sendPushTo(db, uid,
      { title: `To-do from ${first.fromName || "your trainer"}`,
        body: fresh.length > 1 ? `${fresh.length} new to-dos` : String(first.prompt || "").slice(0, 120),
        // "/" used to be the whole destination, which meant a client already
        // on their home screen tapped the notification and nothing moved
        // (S197d). The id lets the app open the exact task. Feed rows written
        // before this still carry "/" — the client falls back to the newest
        // open to-do for those, so both shapes land somewhere real.
        tag: "trainer-todo", url: first.id ? `/?todo=${encodeURIComponent(first.id)}` : "/" },
      "trainerReminders");
    console.log("onTrainerRequestWritten push", JSON.stringify({ uid, fresh: fresh.length, ...r }));
  });

// ── trigger: meal tagged for review, and the trainer's verdict (S183h) ──────
// One trigger covers BOTH directions and, more importantly, both write paths:
// the chat composer writes this doc straight from the client (no function
// involved), while the AI writes it through log_meal. A trigger on the document
// is the only place that sees both — which is why the notification lives here
// rather than inside the tools, and why the tools no longer send it themselves.
//   new pending row      → tell the CLIENT'S TRAINER there's something to check
//   pending → done       → tell the CLIENT what their coach decided
exports.onMealReviewWritten = onDocumentWritten(
  { document: "users/{uid}/kv/caliq-meal-reviews", region: "us-central1", secrets: [VAPID_PRIVATE_KEY], maxInstances: 10 },
  async (event) => {
    const clientUid = event.params.uid;
    const parse = (snap) => {
      try {
        const d = snap && snap.data();
        const a = d && d.value ? JSON.parse(d.value) : [];
        return Array.isArray(a) ? a : [];
      } catch { return []; }
    };
    const before = parse(event.data && event.data.before);
    const after = parse(event.data && event.data.after);
    const wasById = new Map(before.filter((r) => r && r.id).map((r) => [r.id, r]));
    const db = admin.firestore();

    const fresh = after.filter((r) => r && r.status === "pending" && !wasById.has(r.id));
    const decided = after.filter((r) => r && r.status === "done"
      && wasById.get(r.id) && wasById.get(r.id).status === "pending");
    if (!fresh.length && !decided.length) return;

    const client = (await db.doc(`users/${clientUid}`).get()).data() || {};
    const clientName = client.displayName
      || [client.firstName, client.lastName].filter(Boolean).join(" ") || "A client";

    if (fresh.length) {
      const trainerUid = client.assignedTrainerId;
      if (trainerUid) {
        const first = fresh[0];
        const r = await sendPushTo(db, trainerUid, {
          title: fresh.length > 1
            ? `${clientName} tagged ${fresh.length} meals`
            : `${clientName} tagged a ${first.mealType || "meal"}`,
          // Says plainly that nothing is blocked on them — the whole design is
          // that the meal is already counted.
          body: fresh.length > 1
            ? "Already in their log — confirm or correct them."
            : `${first.name || "Meal"} — ${first.calories || 0} cal. Already in their log; confirm or correct it.`,
          tag: "meal-review", url: "/",
        }, "mealReviews");
        console.log("onMealReviewWritten → trainer", JSON.stringify({ trainerUid, fresh: fresh.length, ...r }));
      }
    }

    if (decided.length) {
      const d = decided[0];
      const verb = d.decision === "confirm" ? "confirmed"
        : d.decision === "adjust" ? "adjusted" : "removed";
      const r = await sendPushTo(db, clientUid, {
        title: `Your coach ${verb} your ${d.mealType || "meal"}`,
        body: d.decision === "reject" ? `${d.name || "That meal"} was taken off your log.`
          : d.decision === "adjust" ? `${d.name || "Meal"} is now ${d.calories || 0} cal.`
          : `${d.name || "Meal"} looks good — no changes.`,
        tag: "meal-review", url: "/",
      }, "mealReviews");
      console.log("onMealReviewWritten → client", JSON.stringify({ clientUid, decided: decided.length, ...r }));
    }
  });

// ── scheduled reminder pushes (S96) ─────────────────────────────────────────
// The S77 food/weigh-in nudges were in-app cards only — visible ONLY with the
// app open, which defeats a reminder. These deliver the same nudges as real
// pushes when the app is closed. Only users who turned on "Push to this
// device" are even considered (enumerated via their pushSubs — nobody else
// pays a read), prefs are checked BEFORE sendPushTo so a turned-off type never
// spams the bell feed, and both are client-role-only (mirroring the in-app
// cards, which render only on ClientHome). Times are America/New_York — same
// canonical tz as the AI's "today" (S62) and the local-date log keys (S45).

async function kvJSON(db, uid, key) {
  try {
    const d = (await db.doc(`users/${uid}/kv/${encodeURIComponent(key)}`).get()).data();
    return d && d.value ? JSON.parse(d.value) : null;
  } catch { return null; }
}
const ymdET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

// Every uid with at least one push subscription (deduped).
async function pushCapableUids(db) {
  const subs = await db.collectionGroup("pushSubs").limit(2000).get();
  const uids = new Set();
  subs.docs.forEach((d) => { const u = d.ref.parent.parent; if (u) uids.add(u.id); });
  return [...uids];
}

// Shared walk: for each push-capable CLIENT with the pref on, decide() reads
// their data and returns a payload (or null to skip). Returns counts for logs.
async function runReminderPass(db, prefKey, decide) {
  const uids = await pushCapableUids(db);
  let sent = 0, skipped = 0;
  for (const uid of uids) {
    try {
      const prefs = await notifPrefsOf(db, uid);
      if (!prefOn(prefs, prefKey)) { skipped++; continue; }
      const prof = (await db.doc(`users/${uid}`).get()).data() || {};
      if (prof.role !== "client") { skipped++; continue; }
      const manifest = await kvJSON(db, uid, "caliq-plans");
      const plan = (manifest && manifest.active) || "self";
      const payload = await decide(uid, plan);
      if (!payload) { skipped++; continue; }
      await sendPushTo(db, uid, payload, prefKey);
      sent++;
    } catch (e) { skipped++; }
  }
  return { candidates: uids.length, sent, skipped };
}

// Daily 3pm ET: nothing logged today → nudge. Max once/day by construction.
// Streak-aware (S97, Kevin's pick #4): when the user has an active streak on
// the line, the push SAYS so — the single most effective retention copy in
// fitness apps. Streak = consecutive logged days ending yesterday, walked in
// one batched read (only for users already past the prefs/role/not-logged
// gates, so the extra reads stay tiny).
const STREAK_LOOKBACK = 30; // cap the walk; "30+-day streak" is plenty of urgency
async function streakEndingYesterday(db, uid, plan, today) {
  const d0 = new Date(today + "T12:00:00");
  const keys = Array.from({ length: STREAK_LOOKBACK }, (_, i) => {
    const d = new Date(d0); d.setDate(d.getDate() - (i + 1));
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  });
  const logs = await Promise.all(keys.map((k) => kvJSON(db, uid, `caliq-log-${plan}-${k}`)));
  let n = 0;
  for (const log of logs) {
    if (log && ((Number(log.calories) || 0) > 0)) n++;
    else break;
  }
  return n;
}
exports.foodReminderPush = onSchedule(
  { schedule: "0 15 * * *", timeZone: "America/New_York", region: "us-central1",
    secrets: [VAPID_PRIVATE_KEY], timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    const db = admin.firestore();
    const today = ymdET();
    const r = await runReminderPass(db, "foodReminders", async (uid, plan) => {
      const log = await kvJSON(db, uid, `caliq-log-${plan}-${today}`);
      const logged = log && ((Number(log.calories) || 0) > 0 || (Array.isArray(log.meals) && log.meals.length > 0));
      if (logged) return null;
      const streak = await streakEndingYesterday(db, uid, plan, today);
      if (streak >= 3) {
        return { title: `Your ${streak}${streak >= STREAK_LOOKBACK ? "+" : ""}-day streak is on the line`,
          tag: "food-reminder", url: "/",
          body: "Nothing logged yet today — one quick add keeps it alive." };
      }
      return { title: "Log today's food", tag: "food-reminder", url: "/",
        body: "Nothing logged yet today — a quick add keeps your streak alive." };
    });
    console.log("foodReminderPush", JSON.stringify(r));
  });

// Mondays 9am ET: no weigh-in in the last 7 days (or ever) → nudge.
exports.weighInReminderPush = onSchedule(
  { schedule: "0 9 * * 1", timeZone: "America/New_York", region: "us-central1",
    secrets: [VAPID_PRIVATE_KEY], timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    const db = admin.firestore();
    const r = await runReminderPass(db, "weighInReminders", async (uid, plan) => {
      const wrap = await kvJSON(db, uid, `caliq-${plan}`);
      const checkIns = (wrap && wrap.data && Array.isArray(wrap.data.checkIns)) ? wrap.data.checkIns : [];
      const weighTs = checkIns
        .filter((c) => c && Number(c.weight) > 0 && c.date)
        .map((c) => new Date(c.date + "T12:00:00").getTime())
        .filter((t) => Number.isFinite(t));
      const latest = weighTs.length ? Math.max(...weighTs) : null;
      if (latest && Date.now() - latest < 7 * 86400e3) return null;
      return { title: "Time for a weigh-in", tag: "weighin-reminder", url: "/",
        body: latest ? "It's been a week since your last weigh-in — hop on the scale." :
          "Log your first weigh-in to start tracking your trend." };
    });
    console.log("weighInReminderPush", JSON.stringify(r));
  });
