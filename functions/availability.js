// Client self-booking, pass 1 (S195) — see the handoff's "NEXT BUILD" spec.
//
// Two calls: what times a trainer is unavailable, and the trainer's answer to a
// client who asked for one. The goal Kevin set is that a client who uses nothing
// else in Glidna — no plan, no logging, no AI — can still see when their trainer
// is free, ask for a slot, and pay. So nothing here reads a plan.
//
// ⚠️ FREE/BUSY ONLY, AND WHY IT MUST BE A CALLABLE.
// `sessions` is `allow read: if isParticipant()` and that has to stay: a client
// reading their trainer's calendar directly would see other clients' NAMES,
// titles and locations — a privacy leak and a competitive one. `trainerBlocks`
// is owner-read for the same reason ("Physio", "Dentist" is nobody's business).
// So availability is DERIVED here and stripped to bare time ranges before it
// ever leaves the server.
//
// The ranges are also MERGED. Three back-to-back sessions and one long block
// look identical from outside — which is the point: an unmerged list leaks how
// many clients a trainer has and how long each appointment runs, which is most
// of what the raw documents would have said anyway.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendPushTo } = require("./push");

const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
const REGION = "us-central1";
const MAX_WINDOW_DAYS = 45;     // how far ahead a client may look
const INBOX_KEY = "caliq-inbox";

// Is `trainerUid` really this client's trainer? Mirrors firestore.rules
// isTrainerOf exactly: the direct trainer, or the head ABOVE that trainer.
async function isMyTrainer(db, clientProfile, trainerUid) {
  const direct = clientProfile && clientProfile.assignedTrainerId;
  if (!direct) return false;
  if (direct === trainerUid) return true;
  const t = (await db.doc(`users/${direct}`).get()).data();
  return !!t && t.headTrainerId === trainerUid;
}

// Overlapping/touching ranges become one. Sorted, so a single pass does it.
function mergeRanges(ranges) {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

// ─── 1. When is my trainer busy? ────────────────────────────────────────────
exports.trainerAvailability = onCall(
  { region: REGION, maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const d = request.data || {};
    const trainerUid = String(d.trainerUid || "").trim();
    if (!trainerUid) throw new HttpsError("invalid-argument", "Missing trainer.");

    const db = admin.firestore();
    const me = (await db.doc(`users/${uid}`).get()).data() || {};
    if (!(await isMyTrainer(db, me, trainerUid))) {
      throw new HttpsError("permission-denied", "You're not linked to that trainer.");
    }

    const trainer = (await db.doc(`users/${trainerUid}`).get()).data() || {};
    // Off by default (Kevin's decision: one per-trainer toggle, not per-client).
    // When it's off the client can still ASK for a time — they just do it
    // blind, which is how booking worked before this existed.
    if (trainer.availabilityPublic !== true) return { visible: false, busy: [] };

    const now = Date.now();
    const from = Math.max(now, Number(d.from) || now);
    const to = Math.min(from + MAX_WINDOW_DAYS * 86400000, Number(d.to) || (from + 14 * 86400000));
    if (!(to > from)) return { visible: true, busy: [], from, to };

    // Both queries are single-field (`participants array-contains` /
    // `trainerUid ==`) with the time window applied in code — deliberately, and
    // for the same reason as the calendar feed: pairing either with a range on
    // startAt needs a composite index, and a booking screen that 500s until
    // someone remembers to deploy one is worse than reading a few extra docs.
    const [sessSnap, blockSnap] = await Promise.all([
      db.collection("sessions").where("participants", "array-contains", trainerUid).get(),
      db.collection("trainerBlocks").where("trainerUid", "==", trainerUid).get(),
    ]);

    const ranges = [];
    sessSnap.forEach((doc) => {
      const s = doc.data() || {};
      // Only what this trainer is DELIVERING. A trainer who is also somebody's
      // client (Kevin trains with another coach) would otherwise publish their
      // own training as unavailability — true, but not theirs to share here.
      if (s.trainerUid !== trainerUid) return;
      if (s.status === "cancelled") return;
      const start = Number(s.startAt) || 0;
      const end = start + (Number(s.durationMin) || 60) * 60000;
      if (end > from && start < to) ranges.push({ start, end });
    });
    blockSnap.forEach((doc) => {
      const b = doc.data() || {};
      const start = Number(b.startAt) || 0;
      const end = start + (Number(b.durationMin) || 60) * 60000;
      if (end > from && start < to) ranges.push({ start, end });
    });

    // Nothing but times leaves this function.
    return { visible: true, from, to, busy: mergeRanges(ranges) };
  },
);

// ─── 2. The trainer answers a request for a time ────────────────────────────
//
// Accept creates the session; deny doesn't. Either way the client is TOLD —
// which is the whole reason this is a callable and not two client-side writes.
// A request that silently becomes an appointment, or silently doesn't, is a
// request the client has to chase.
exports.respondToBookingRequest = onCall(
  { region: REGION, maxInstances: 10, secrets: [VAPID_PRIVATE_KEY] },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const d = request.data || {};
    const requestId = String(d.requestId || "").trim();
    const accept = d.accept === true;
    if (!requestId) throw new HttpsError("invalid-argument", "Which request?");

    const db = admin.firestore();
    const inboxRef = db.doc(`users/${uid}/kv/${INBOX_KEY}`);

    // Claim the item in a TRANSACTION before doing anything else. Two taps on
    // Accept — or the trainer's phone and laptop both answering — must not
    // produce two sessions and two charges. Whoever wins the claim books.
    let item = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(inboxRef);
      let arr = [];
      try { const v = snap.exists && snap.data().value; arr = v ? JSON.parse(v) : []; } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      const found = arr.find((r) => r && r.id === requestId);
      if (!found) throw new HttpsError("not-found", "That request is gone.");
      if (found.status !== "open") throw new HttpsError("failed-precondition", "You've already answered that one.");
      item = found;
      const next = arr.map((r) => (r && r.id === requestId
        ? { ...r, status: "done", doneAt: Date.now(), outcome: accept ? "accepted" : "declined" }
        : r));
      tx.set(inboxRef, { k: INBOX_KEY, value: JSON.stringify(next) });
    });

    const clientUid = item.fromUid;
    const booking = item.booking || null;
    if (!clientUid) throw new HttpsError("failed-precondition", "That request has no sender.");
    // Accepting something that never named a time can't book anything — and the
    // client would be told "it's on your calendar" about a session that doesn't
    // exist. Ordinary requests are finished with Done, not with this.
    if (accept && !booking) throw new HttpsError("failed-precondition", "That request didn't ask for a time.");

    // The link is re-checked HERE, not taken from the stored item: the request
    // may have been sitting in the inbox since before the client left.
    const client = (await db.doc(`users/${clientUid}`).get()).data() || {};
    if (!(await isMyTrainer(db, client, uid))) {
      throw new HttpsError("permission-denied", "That client isn't linked to you any more.");
    }

    const trainer = (await db.doc(`users/${uid}`).get()).data() || {};
    const trainerName = trainer.displayName
      || [trainer.firstName, trainer.lastName].filter(Boolean).join(" ") || "Your trainer";
    const when = booking ? new Date(booking.startAt).toLocaleString("en-US", {
      timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }) : "";

    let sessionId = null;
    if (accept && booking) {
      // Still in the future? A request accepted three days late would otherwise
      // create a session that is already delivered and therefore already
      // billable — a charge from a tap the trainer read as "yes, let's do it".
      if (Number(booking.startAt) < Date.now()) {
        throw new HttpsError("failed-precondition", "That time has already passed — book a new one instead.");
      }
      const policy = trainer.sessionPolicy || {};
      const priceCents = Math.max(0, Math.min(500000, Math.round(Number(policy.standardPriceCents) || 0)));
      const now = Date.now();
      const ref = await db.collection("sessions").add({
        participants: [uid, clientUid],
        trainerUid: uid, clientUid,
        startAt: Number(booking.startAt),
        durationMin: Number(booking.durationMin) || 60,
        status: "scheduled",
        title: "", location: "",
        // The trainer's STANDARD rate — the number their clients agreed to. A
        // session created from an accept must not be born at $0 (unbillable) or
        // at some price nobody stated.
        priceCents,
        createdBy: uid, createdAt: now, updatedAt: now,
      });
      sessionId = ref.id;
    }

    await sendPushTo(db, clientUid, accept
      ? { title: `${trainerName} confirmed your session`,
          body: when ? `${when} — it's on your calendar.` : "It's on your calendar.",
          tag: `booking-accepted-${requestId}`, url: "/" }
      : { title: `${trainerName} couldn't make that time`,
          body: when ? `${when} didn't work — ask for another time.` : "Ask for another time.",
          tag: `booking-declined-${requestId}`, url: "/" },
      "sessionReminders").catch(() => {});

    return { ok: true, accepted: accept, sessionId };
  },
);
