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

async function sendPushTo(db, uid, payload, prefKey) {
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

// ── trigger: new direct message → notify the recipient ──────────────────────
exports.onDmCreated = onDocumentCreated(
  { document: "threads/{tid}/msgs/{mid}", region: "us-central1", secrets: [VAPID_PRIVATE_KEY], maxInstances: 10 },
  async (event) => {
    const msg = event.data && event.data.data();
    if (!msg || !msg.from) return;
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
        tag: "trainer-todo", url: "/" },
      "trainerReminders");
    console.log("onTrainerRequestWritten push", JSON.stringify({ uid, fresh: fresh.length, ...r }));
  });
