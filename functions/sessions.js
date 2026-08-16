// Training-session lifecycle (S100, docs/SESSIONS-BILLING-PLAN.md phase 2).
//
// "The red line": every 15 minutes this sweeps sessions whose end time has
// passed and stamps them `completedAt`. That stamp is what the Sunday billing
// pass will later bill from — so it is written ONLY here, by the Admin SDK.
// firestore.rules rejects completedAt from both the trainer and the client.
//
// ⚠️ Why a separate field instead of status:"completed" — the rules let a
// trainer update a session only when the RESULTING status is scheduled or
// cancelled. Writing status:"completed" would lock the trainer out of their
// own past session, so they could never waive a no-show before it bills.
// `status` stays the booking state (owned by the two people); `completedAt`
// is the billing fact (owned by the server). They are different questions.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { sendPushTo, VAPID_PRIVATE_KEY } = require("./push");

// How far back to look. The sweep runs every 15 min, so this is enormous slack
// for a scheduler outage. The range stays on ONE field (startAt) so a
// single-field index serves it and no composite index has to be deployed.
//
// ⚠️ IT ALSO BOUNDS BACK-DATING (S195). A trainer may add a session up to
// BACKDATE_MAX_DAYS (14) in the past, and nothing bills until this sweep stamps
// `completedAt` — so a window of exactly 14 days would race: a session booked
// at the limit falls out of range in the fifteen minutes before the next run,
// and would sit booked, unstamped and never paid. 21 leaves a week of margin.
// If the back-date cap in src/sessions.js ever grows, this must grow first.
const LOOKBACK_DAYS = 21;
const MAX_PER_RUN = 500;

// Mark every finished session. Exported so a future settle pass can reuse it.
async function markCompletedSessions(db, nowMs) {
  const now = nowMs || Date.now();
  const since = now - LOOKBACK_DAYS * 86400000;
  const snap = await db.collection("sessions")
    .where("startAt", ">=", since)
    .where("startAt", "<=", now)
    .orderBy("startAt", "desc")
    .limit(MAX_PER_RUN)
    .get();

  let marked = 0, skipped = 0;
  const batch = db.batch();
  snap.forEach((docSnap) => {
    const s = docSnap.data() || {};
    // Already stamped, or cancelled — never re-stamp (idempotent: a retry or an
    // overlapping run cannot double-mark, which matters because this stamp is
    // what money will later key off).
    if (s.completedAt || s.status === "cancelled") { skipped++; return; }
    const endMs = Number(s.startAt || 0) + Number(s.durationMin || 60) * 60000;
    if (endMs > now) { skipped++; return; } // still in progress
    batch.update(docSnap.ref, {
      completedAt: endMs,        // when it ACTUALLY ended, not when we noticed
      // Freeze the price at the moment the obligation was created. `priceCents`
      // stays trainer-editable (they may need to fix a typo on an upcoming
      // session), but in weekly mode up to seven days pass between delivery and
      // the charge — and the sweep used to read the price live, so an edit in
      // that window silently re-priced work the client had already received, or
      // a cancellation fee they had already been quoted. This is the number
      // that bills. (S186)
      billableCents: Math.max(0, Number(s.priceCents) || 0),
      completedVia: "auto",
      updatedAt: now,
    });
    marked++;
  });
  if (marked) await batch.commit();
  return { scanned: snap.size, marked, skipped };
}

exports.markCompletedSessions = markCompletedSessions;

// ─── A session added in the PAST tells the client (S195) ───────────────────
//
// Kevin's decision was "warn the trainer, then notify the client — and no
// separate charge-now button". This is the second half, and it is the half that
// matters legally: a charge for a session the client never saw booked is the
// most disputable thing this system can produce, and "the trainer said they'd
// mention it" is not a record. The write IS the event, so this is a TRIGGER
// rather than a call from the app — a client that crashed, lost signal or is
// three versions behind still gets told.
//
// Only genuinely back-dated bookings qualify. A session booked for later today
// is ordinary, and the few seconds between the browser's clock and the server's
// must never read as back-dating, hence the grace window.
const BACKDATE_NOTIFY_GRACE_MS = 5 * 60000;

exports.onSessionBackdated = onDocumentCreated(
  { document: "sessions/{sid}", region: "us-central1", secrets: [VAPID_PRIVATE_KEY], maxInstances: 5 },
  async (event) => {
    const s = (event.data && event.data.data()) || {};
    const startAt = Number(s.startAt) || 0;
    // `createdAt` is written by the browser, so it is the client's clock — but
    // it is also the only stamp that says when the BOOKING happened, and the
    // rules already pin the fields that decide money. The event's own server
    // timestamp is the fallback, and a wildly wrong browser clock only ever
    // costs an extra notification, never a missing one.
    const eventMs = event.time ? Date.parse(event.time) : NaN;
    const createdAt = Number(s.createdAt) || (Number.isFinite(eventMs) ? eventMs : Date.now());
    if (!startAt || !s.clientUid || !s.trainerUid) return;
    if (startAt >= createdAt - BACKDATE_NOTIFY_GRACE_MS) return;   // normal forward booking

    const db = admin.firestore();
    const trainer = (await db.doc(`users/${s.trainerUid}`).get()).data() || {};
    const name = trainer.displayName
      || [trainer.firstName, trainer.lastName].filter(Boolean).join(" ")
      || "Your trainer";

    // Their own local time, not the server's. A session named in the wrong
    // timezone is a session the client can't recognise — and an unrecognisable
    // charge is a disputed one (the S193 lesson, applied to money).
    const when = new Date(startAt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    const price = Number(s.priceCents) > 0 ? ` · $${(Number(s.priceCents) / 100).toFixed(2)}` : "";

    await sendPushTo(db, s.clientUid, {
      title: `${name} added a past session`,
      // Say the charge out loud. A notification that only says "a session was
      // added" invites the client to ignore it and dispute the charge later.
      body: `${when}${price}. It'll be billed under the terms you agreed to — open Sessions if that's not right.`,
      tag: `session-backdated-${event.params.sid}`,
      url: "/",
    }, "sessionBilling").catch(() => {});
    console.log("onSessionBackdated", JSON.stringify({
      sid: event.params.sid, daysBack: Math.round((createdAt - startAt) / 86400000 * 10) / 10,
    }));
  },
);

exports.sessionsMarkCompleted = onSchedule(
  { schedule: "every 15 minutes", region: "us-central1", timeZone: "America/New_York" },
  async () => {
    const db = admin.firestore();
    try {
      const r = await markCompletedSessions(db);
      if (r.marked) console.log(`sessionsMarkCompleted: marked ${r.marked} (scanned ${r.scanned}, skipped ${r.skipped})`);
    } catch (e) {
      console.error("sessionsMarkCompleted failed:", e && e.message);
      throw e; // let the scheduler record the failure + retry
    }
  },
);
