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
// One offered time per weekday is all askSlots can produce, so seven is the
// real ceiling — this bounds a hand-made payload, not the UI.
const MAX_ASK_SLOTS = 7;

// ── The booking half of a request, validated ────────────────────────────────
// Pure and exported so scripts/test-booking-slots.mjs drives THIS, not a copy
// of it. Returns { booking, droppedSlots }; throws HttpsError for anything a
// person needs to fix.
//
// ⚠️ KEEP `slots`. THIS USED TO DROP IT, AND THAT KILLED A WHOLE FEATURE IN
// SILENCE. A client can ask across several days — "Mon, Wed or Fri, whichever
// suits" — and both ends were built for it: the composer sends `slots`, the
// trainer's inbox renders a "Book this" button per time, and
// respondToBookingRequest validates the trainer's chosen time against exactly
// that list so they cannot book an hour nobody offered. But sendTrainerRequest
// is the ONLY writer of a booking inbox item and rebuilt the object from
// `startAt` and `durationMin` alone, so `slots` was always undefined in
// production: the per-slot buttons never rendered, the single Accept booked
// Monday, the request was marked done, and the client was pushed "it's on your
// calendar" while Wednesday and Friday vanished with nobody told.
function buildBooking(b, now) {
  if (!b || typeof b !== "object") return { booking: null, droppedSlots: 0 };
  const durationMin = Math.round(Number(b.durationMin) || 60);
  if (!(durationMin > 0 && durationMin <= 480)) throw new HttpsError("invalid-argument", "Pick a sensible length.");
  // Forward-only, and not years out. A request for a past slot is either a
  // mistake or an attempt to manufacture a billable session after the fact.
  // The two bounds are separate so they can say DIFFERENT things: folding them
  // into one predicate once told a client that a date in 2027 was "not in the
  // future", which is both wrong and unactionable.
  const tooLate = (ms) => ms < now - 60000;
  const tooFar = (ms) => ms > now + 365 * 86400000;
  const usable = (ms) => Number.isFinite(ms) && !tooLate(ms) && !tooFar(ms);

  const raw = Array.isArray(b.slots) ? b.slots : null;
  let slots = null, dropped = 0;
  if (raw) {
    const seen = new Set();
    slots = [];
    for (const x of raw) {
      const ms = Math.round(Number(x));
      // A time that has gone is DROPPED rather than refusing the whole ask: the
      // composer memoises its slot list and does not re-derive on a clock tick,
      // so a sheet open across 9:00 still holds 9:00, and losing the whole ask
      // over one stale Monday is the worse failure. What is dropped is COUNTED
      // and returned, so the caller can tell the client — the first version
      // dropped silently while returning ok:true, which is the same silence
      // this function exists to end.
      if (seen.has(ms)) continue;
      if (!usable(ms)) { if (Number.isFinite(ms)) dropped++; continue; }
      seen.add(ms);
      slots.push(ms);
    }
    slots.sort((x, y) => x - y);
    // askSlots offers at most one time per weekday, so seven is the real
    // ceiling; the cap bounds a hand-made payload, not the UI.
    if (slots.length > MAX_ASK_SLOTS) { dropped += slots.length - MAX_ASK_SLOTS; slots.length = MAX_ASK_SLOTS; }
  }

  // startAt is DERIVED from the survivors when there are any, so the two can
  // never disagree — a startAt naming a dropped time would still be bookable by
  // the older single-button path.
  const startAt = slots && slots.length ? slots[0] : Math.round(Number(b.startAt));
  if (!Number.isFinite(startAt)) throw new HttpsError("invalid-argument", "Pick a date and time.");
  if (tooFar(startAt)) throw new HttpsError("invalid-argument", "That's more than a year out — pick a nearer date.");
  if (tooLate(startAt)) throw new HttpsError("invalid-argument", "Pick a time in the future.");
  const booking = { startAt, durationMin };
  if (slots && slots.length > 1) booking.slots = slots;
  return { booking, droppedSlots: dropped };
}
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
    // Built by a PURE, EXPORTED function so the test can drive the real thing.
    // The first version of this test re-implemented the validation instead, and
    // a mutation proved the point: changing `slots.length > 1` to `> 99` in
    // here — which reintroduces the exact bug this exists to fix — left the
    // suite at 23/23 green, because the assertions were checking a copy.
    const { booking, droppedSlots } = buildBooking(request.data && request.data.booking, Date.now());

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
    // ⚠️ REPORT WHAT WAS DROPPED. Returning a bare ok:true after silently
    // discarding a time the client had on screen is the same silence this
    // whole change is about — the composer memoises its slot list, so a sheet
    // open across 9:00 still shows "3 sessions" while only two were sent.
    return { ok: true, id: item.id,
      offered: (booking && booking.slots) ? booking.slots : (booking ? [booking.startAt] : []),
      droppedSlots };
  });

// Exported for scripts/test-booking-slots.mjs, which must drive the real
// validation rather than a transcription of it.
exports.buildBooking = buildBooking;
exports.MAX_ASK_SLOTS = MAX_ASK_SLOTS;
