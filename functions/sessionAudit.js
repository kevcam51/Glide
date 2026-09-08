// Glidna — the session audit trail (S211).
//
// Two facts about a session that nobody could see, both fixed the same way: by
// having the SERVER notice the write rather than asking either participant to
// record it about themselves.
//
//   1. RESCHEDULES LEFT NO TRACE. `updateSession` overwrites `startAt`, so a
//      session moved three times looked exactly like one booked once, at the
//      last time it happened to land on. Kevin's ledger asks for the moves, and
//      a charge for "Tuesday" that was booked for Thursday is the sort of thing
//      that has to be answerable months later. `startAtHistory` records every
//      previous start time, appended here.
//
//   2. A CLIENT'S "MY TRAINER DIDN'T SHOW UP" HAD TO REACH THE TRAINER. The
//      report holds the charge (functions/sessionSettle.js classifyForBilling),
//      so a trainer who never hears about it is a trainer whose money quietly
//      stops — and a client who is told nothing when the trainer answers has no
//      idea a charge is coming back. Both directions are announced here.
//
// ⚠️ WHY A TRIGGER AND NOT A CALL FROM THE APP. The write IS the event. A
// browser that crashed mid-save, a client three versions behind, a console
// write, the AI tools — all of them move a session, and none of them can be
// relied on to also file the paperwork. The trigger sees every one.
//
// ⚠️ WHY THE TRAIL IS SERVER-WRITTEN. `startAtHistory` is deliberately absent
// from firestore.rules' bookingFields(), so neither participant can write,
// edit, or delete it. An audit trail either side can forge is worth less than
// no audit trail at all, because it looks like evidence.
//
// ⚠️ THIS TRIGGER WRITES BACK TO THE DOCUMENT IT WATCHES, so it re-fires on its
// own write. That is safe by construction, not by luck: the history append only
// happens when `startAt` CHANGED, and its own write never touches `startAt`.
// The same is true of onSessionBackdated in sessions.js, which ignores writes
// that leave startAt alone.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { sendPushTo, VAPID_PRIVATE_KEY } = require("./push");

// A session moved more times than this is pathological (a script, a stuck
// retry). Capping keeps the doc bounded — and it keeps the FIRST entry, which
// is the originally booked time and the one anybody asking about this session
// actually wants, alongside the most recent moves.
const MAX_TRAIL = 20;

// Should this write record a previous start time, and which one? Pure and
// exported so the branching can be RUN rather than read — every branch here is
// a case that decides whether a real reschedule is remembered.
// Returns null (nothing to record) or the previous startAt in ms.
function rescheduleTrail(before, after) {
  if (!before || !after) return null;              // a create has no previous time; a delete has no doc
  const from = Number(before.startAt);
  const to = Number(after.startAt);
  if (!Number.isFinite(from) || from <= 0) return null;
  if (!Number.isFinite(to) || to <= 0) return null;
  if (from === to) return null;                    // every other write to a session lands here
  return from;
}

// Who needs to be told what, when a no-show report changes hands.
// Returns null or { kind, to } where `to` is "trainer" or "client".
//
// ⚠️ THE ORDER MATTERS AND IS NOT ARBITRARY. The report's own on/off is checked
// FIRST, because a write can both file a report and change something else; and
// the two answers below it are only reachable while a report is actually live,
// so an ordinary waive on a session nobody disputed stays silent.
function noShowNotice(before, after) {
  if (!after || !after.clientUid || !after.trainerUid) return null;
  const b = before || {};
  const was = b.trainerNoShow === true;
  const is = after.trainerNoShow === true;
  if (!was && is) return { kind: "reported", to: "trainer" };
  if (was && !is) return { kind: "withdrawn", to: "trainer" };
  if (!is) return null;                            // no live report — nothing to answer
  // "I was there." Lifts the billing hold, so the client hears it BEFORE the
  // charge rather than as the charge.
  if (b.trainerNoShowDenied !== true && after.trainerNoShowDenied === true) return { kind: "denied", to: "client" };
  // The trainer agreed and waived it. Waiving is the existing control, so this
  // is the only place that can tell the client their report was accepted.
  if (b.waived !== true && after.waived === true) return { kind: "confirmed", to: "client" };
  return null;
}

// The append itself, pure, so the two things that make it safe can be RUN:
// idempotency across a redelivered trigger, and a bounded document.
//
// ⚠️ IDEMPOTENT ON THE EVENT ID, NOT ON THE VALUE. Firestore delivers triggers
// AT LEAST ONCE, so this can run twice for one move — and deduping on the
// timestamp instead would ALSO swallow a genuine move back to a slot this
// session has held before, which is exactly the shuffling a ledger is asked to
// explain. `event.id` is stable across retries and different for every real
// event.
//
// ⚠️ TRIMMED FROM THE MIDDLE. Dropping the oldest entries would throw away the
// originally booked time, which is the one thing anyone asking about a moved
// session wants to know; dropping the newest would make the trail stop
// updating. So the first entry and the most recent MAX_TRAIL-1 survive.
function appendTrail(trail, entry, max = MAX_TRAIL) {
  const cur = Array.isArray(trail) ? trail.filter((e) => e && typeof e === "object") : [];
  if (entry.eid && cur.some((e) => e.eid === entry.eid)) return null;   // already recorded
  const next = [...cur, entry];
  return next.length > max ? [next[0], ...next.slice(-(max - 1))] : next;
}

exports.appendTrail = appendTrail;
exports.rescheduleTrail = rescheduleTrail;
exports.noShowNotice = noShowNotice;
exports.MAX_TRAIL = MAX_TRAIL;

const displayName = (u, fallback) => (u && (u.displayName
  || [u.firstName, u.lastName].filter(Boolean).join(" "))) || fallback;

// The client's own words for when, not the server's — a session named in the
// wrong timezone is one nobody recognises (the S193 lesson).
const whenText = (ms) => new Date(ms).toLocaleString("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

exports.onSessionAudit = onDocumentWritten(
  { document: "sessions/{sid}", region: "us-central1", secrets: [VAPID_PRIVATE_KEY], maxInstances: 5 },
  async (event) => {
    const before = (event.data && event.data.before && event.data.before.data()) || null;
    const after = (event.data && event.data.after && event.data.after.data()) || null;
    const sid = event.params.sid;
    const db = admin.firestore();

    // ── 1. the reschedule trail ─────────────────────────────────────────────
    const movedFrom = rescheduleTrail(before, after);
    if (movedFrom !== null) {
      const eid = String(event.id || "").slice(0, 60);
      // ⚠️ A TRANSACTION, NOT arrayUnion. The dedupe has to read what is
      // actually stored — the redelivered event carries the doc as it was
      // BEFORE our own write, so deciding from the event payload would append
      // the same move a second time.
      await db.runTransaction(async (tx) => {
        const ref = db.doc(`sessions/${sid}`);
        const snap = await tx.get(ref);
        if (!snap.exists) return;                  // deleted underneath us
        const next = appendTrail((snap.data() || {}).startAtHistory, { from: movedFrom, at: Date.now(), eid });
        if (next) tx.update(ref, { startAtHistory: next });
      }).catch((e) => console.error("sessionAudit: trail append failed", sid, e && e.message));
    }

    // ── 2. the no-show dispute ──────────────────────────────────────────────
    const notice = noShowNotice(before, after);
    if (!notice) return;

    const [trainerSnap, clientSnap] = await Promise.all([
      db.doc(`users/${after.trainerUid}`).get(), db.doc(`users/${after.clientUid}`).get(),
    ]);
    const trainerName = displayName(trainerSnap.data(), "Your trainer");
    const clientName = displayName(clientSnap.data(), "Your client");
    const when = whenText(Number(after.startAt) || 0);

    const msg = {
      reported: {
        uid: after.trainerUid,
        title: `${clientName} says you didn't show up`,
        // Say the money consequence out loud in both directions. The trainer
        // needs to know it is holding, and that answering is what releases it.
        body: `${when}. It won't be billed while this is open — open Sessions to waive it or say you were there.`,
      },
      withdrawn: {
        uid: after.trainerUid,
        title: `${clientName} withdrew their no-show report`,
        body: `${when}. It'll be billed as normal.`,
      },
      denied: {
        uid: after.clientUid,
        title: `${trainerName} says they were there`,
        body: `${when}. This session will be billed under the terms you agreed to — reply to ${trainerName} in Messages if that's not right.`,
      },
      confirmed: {
        uid: after.clientUid,
        title: `${trainerName} agreed — no charge`,
        body: `${when} won't be billed.`,
      },
    }[notice.kind];
    if (!msg) return;

    // Per KIND, not per session: a report filed, withdrawn and re-filed is
    // three things the other side needs to see, and one shared tag would
    // collapse them into the first.
    await sendPushTo(db, msg.uid, {
      title: msg.title, body: msg.body,
      tag: `session-noshow-${notice.kind}-${sid}`,
      url: "/?notif=session-noshow",
    }, "sessionBilling").catch(() => {});
    console.log("onSessionAudit", JSON.stringify({ sid, kind: notice.kind, to: notice.to }));
  },
);
