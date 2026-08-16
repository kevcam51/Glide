// Client → trainer requests (S90) — the other half of the to-do system.
// A client can't write into their trainer's kv under the security rules (by
// design), so this callable does it server-side after verifying the LINK:
// the caller's own profile must name the target trainer (assignedTrainerId,
// or the head above that trainer). Items land in the TRAINER's kv at
// "caliq-inbox" (same structured shape as trainer→client caliq-requests) and
// the trainer gets a push (gated by their clientRequests notification pref).
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendPushTo } = require("./push");

const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
const INBOX_KEY = "caliq-inbox";
const MAX_ITEMS = 100;      // inbox cap (newest kept)
const MAX_OPEN_PER_CLIENT = 10; // spam guard: open requests one client may have

exports.sendTrainerRequest = onCall(
  { region: "us-central1", maxInstances: 10, secrets: [VAPID_PRIVATE_KEY] },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const prompt = String((request.data && request.data.prompt) || "").trim().slice(0, 300);
    const type = String((request.data && request.data.type) || "custom").slice(0, 24);
    if (!prompt) throw new HttpsError("invalid-argument", "Say what you need first.");

    const db = admin.firestore();
    const me = (await db.doc(`users/${uid}`).get()).data() || {};
    const trainerUid = me.assignedTrainerId;
    if (!trainerUid) throw new HttpsError("failed-precondition", "You're not linked to a trainer yet.");
    const fromName = me.displayName || [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email || "A client";

    // ── A request for a TIME (S195) ────────────────────────────────────────
    // A booking request is an ordinary inbox item with structure attached, so
    // it inherits everything this path already gets right: the transactional
    // write into the trainer's kv, the open-request cap, and the push. What it
    // adds is a slot the trainer can accept in one tap.
    //
    // ⚠️ ASKING IS NOT BOOKING. Nothing here creates a session — only
    // respondToBookingRequest does, and only when the trainer accepts. A client
    // must never be able to put an appointment (and therefore a charge) on
    // someone's calendar by sending a message.
    let booking = null;
    const b = request.data && request.data.booking;
    if (b && typeof b === "object") {
      const startAt = Math.round(Number(b.startAt));
      const durationMin = Math.round(Number(b.durationMin) || 60);
      if (!Number.isFinite(startAt)) throw new HttpsError("invalid-argument", "Pick a date and time.");
      // Forward-only, and not years out. A request for a past slot is either a
      // mistake or an attempt to manufacture a billable session after the fact.
      if (startAt < Date.now() - 60000) throw new HttpsError("invalid-argument", "Pick a time in the future.");
      if (startAt > Date.now() + 365 * 86400000) throw new HttpsError("invalid-argument", "That's too far ahead.");
      if (!(durationMin > 0 && durationMin <= 480)) throw new HttpsError("invalid-argument", "Pick a sensible length.");
      booking = { startAt, durationMin };
    }

    // Read-modify-write the trainer's inbox in a TRANSACTION (the S85-deferred
    // integrity pattern — two clients sending at once must not clobber each other).
    const ref = db.doc(`users/${trainerUid}/kv/${INBOX_KEY}`);
    const item = { id: `r${Date.now()}${Math.floor(Math.random() * 1e4)}`, fromUid: uid, fromName,
      type: booking ? "booking" : type, prompt, status: "open", createdAt: Date.now(), doneAt: null,
      ...(booking ? { booking } : {}) };
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let arr = [];
      try { const v = snap.exists && snap.data().value; arr = v ? JSON.parse(v) : []; } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      const myOpen = arr.filter((r) => r && r.fromUid === uid && r.status === "open").length;
      if (myOpen >= MAX_OPEN_PER_CLIENT) {
        throw new HttpsError("resource-exhausted", "You already have several open requests — give your trainer a chance to catch up.");
      }
      tx.set(ref, { k: INBOX_KEY, value: JSON.stringify([item, ...arr].slice(0, MAX_ITEMS)) });
    });

    // Best-effort: note it in the client's own activity feed + push the trainer.
    await sendPushTo(db, trainerUid,
      { title: booking ? `${fromName} asked for a time` : `Request from ${fromName}`,
        body: prompt.slice(0, 120), tag: booking ? "booking-request" : "client-request", url: "/" },
      "clientRequests").then((r) => console.log("sendTrainerRequest push", JSON.stringify({ trainerUid, booking: !!booking, ...r })))
      .catch(() => {});
    return { ok: true, id: item.id };
  });
