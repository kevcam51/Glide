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
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
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
//
// ⚠️ PAGED, NOT CAPPED (the S186 lesson, which this function had not learned).
// This was one query with `.orderBy("startAt","desc").limit(500)`. Descending
// means NEWEST first, so the oldest sessions in the window sort last — and
// already-stamped documents still occupy the cap, because "already settled" can
// only be filtered in code. Once a busy window held 500 sessions, the oldest
// ones were silently dropped every run, forever: delivered, never stamped,
// therefore never billed and never visible as a problem. Back-dated sessions
// land at exactly that end of the sort, so the feature this commit adds is the
// one most likely to be starved by it.
//
// Paging removes the cliff. MAX_PER_RUN stays as a per-page size rather than a
// total, with a generous absolute ceiling so a runaway can't spin forever.
const MAX_PAGES = 40;   // 40 × 500 = 20,000 sessions per run, far past any real book

async function markCompletedSessions(db, nowMs) {
  const now = nowMs || Date.now();
  const since = now - LOOKBACK_DAYS * 86400000;

  const docs = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = db.collection("sessions")
      .where("startAt", ">=", since)
      .where("startAt", "<=", now)
      .orderBy("startAt", "asc")     // oldest first: the ones nearest falling out of the window
      .limit(MAX_PER_RUN);
    if (cursor) q = q.startAfter(cursor);
    const page$ = await q.get();
    if (page$.empty) break;
    page$.forEach((d) => docs.push(d));
    cursor = page$.docs[page$.docs.length - 1];
    if (page$.size < MAX_PER_RUN) break;
    if (page === MAX_PAGES - 1) {
      // Never truncate in silence — that is the whole defect being fixed here.
      console.warn(`markCompletedSessions: hit the ${MAX_PAGES}-page ceiling; some sessions were not scanned this run`);
    }
  }
  let marked = 0, skipped = 0;
  // ⚠️ A Firestore batch holds at most 500 writes. The old single-query version
  // could never exceed that (it read at most 500 docs), but a PAGED scan can —
  // and a batch that overflows throws, which would abandon the entire run's
  // stamps rather than just the excess. So the writes are chunked.
  const BATCH_LIMIT = 450;   // headroom under the hard 500
  let batch = db.batch(), inBatch = 0;
  const flush = async () => {
    if (!inBatch) return;
    await batch.commit();
    batch = db.batch(); inBatch = 0;
  };

  for (const docSnap of docs) {
    const s = docSnap.data() || {};
    // Already stamped, or cancelled — never re-stamp (idempotent: a retry or an
    // overlapping run cannot double-mark, which matters because this stamp is
    // what money will later key off).
    if (s.completedAt || s.status === "cancelled") { skipped++; continue; }
    const endMs = Number(s.startAt || 0) + Number(s.durationMin || 60) * 60000;
    if (endMs > now) { skipped++; continue; } // still in progress
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
    marked++; inBatch++;
    if (inBatch >= BATCH_LIMIT) await flush();
  }
  await flush();
  return { scanned: docs.length, marked, skipped };
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

// ⚠️ WRITTEN, NOT CREATED. This started as an onDocumentCreated trigger, which
// left a hole the size of the feature: a trainer can also RESCHEDULE an
// existing session into the past, and the booking sheet promises "they'll be
// told you moved it here" — a promise nothing could keep, because no create
// ever happened. A session moved backwards becomes billable at a time the
// client never had one, which is the same disputable charge the create path
// exists to disclose, so it gets the same disclosure.
//
// Every other write to a session (completedAt from the sweep, settled/chargeId
// from the settle engine, noShow/waived from the trainer) leaves startAt alone
// and is filtered out below, so this stays quiet on the busy paths.
// Should this write tell the client, and as what? Pure and exported so the
// branching can be tested directly — it decides whether a real charge gets
// disclosed, and every branch below is a case someone will eventually hit.
// Returns null (say nothing) or { kind: "created" | "moved" }.
function backdateNotice(before, after, writtenAt) {
  if (!after) return null;                                  // deleted
  const startAt = Number(after.startAt) || 0;
  if (!startAt || !after.clientUid || !after.trainerUid) return null;

  const isCreate = !before;
  // A move only counts if startAt actually moved. Without this the trigger
  // would re-fire on every billing write to an already-back-dated session
  // (completedAt from the sweep, settled/chargeId from the settle engine,
  // noShow/waived from the trainer).
  if (!isCreate && Number(before.startAt) === startAt) return null;
  // Cancelled work isn't billable as delivered, so it isn't this notice.
  if (after.status === "cancelled") return null;

  const cutoff = writtenAt - BACKDATE_NOTIFY_GRACE_MS;
  if (startAt >= cutoff) return null;                       // ordinary forward booking/move
  // A session ALREADY in the past, merely moved within the past (correcting
  // yesterday's time by an hour), was disclosed when it first landed there.
  if (!isCreate && Number(before.startAt) < cutoff) return null;
  return { kind: isCreate ? "created" : "moved" };
}
exports.backdateNotice = backdateNotice;

exports.onSessionBackdated = onDocumentWritten(
  { document: "sessions/{sid}", region: "us-central1", secrets: [VAPID_PRIVATE_KEY], maxInstances: 5 },
  async (event) => {
    const before = (event.data && event.data.before && event.data.before.data()) || null;
    const after = (event.data && event.data.after && event.data.after.data()) || null;

    // ⚠️ SERVER TIME DECIDES, NOT THE DOCUMENT. `createdAt` is written by the
    // browser and the rules do not pin it on create, so keying the disclosure
    // off it let a trainer suppress the notification by stamping an old
    // createdAt — i.e. exactly the person the disclosure protects against could
    // switch it off. The event's own timestamp is when the write really landed.
    const eventMs = event.time ? Date.parse(event.time) : NaN;
    const writtenAt = Number.isFinite(eventMs) ? eventMs : Date.now();

    const notice = backdateNotice(before, after, writtenAt);
    if (!notice) return;
    const isCreate = notice.kind === "created";
    const startAt = Number(after.startAt) || 0;

    const db = admin.firestore();
    const trainer = (await db.doc(`users/${after.trainerUid}`).get()).data() || {};
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
    const price = Number(after.priceCents) > 0 ? ` · $${(Number(after.priceCents) / 100).toFixed(2)}` : "";

    await sendPushTo(db, after.clientUid, {
      title: isCreate ? `${name} added a past session` : `${name} moved a session into the past`,
      // Say the charge out loud. A notification that only says "a session was
      // added" invites the client to ignore it and dispute the charge later.
      body: `${when}${price}. It'll be billed under the terms you agreed to — open Sessions if that's not right.`,
      // Per WRITE, not per session: a session moved twice is two things the
      // client needs to know about, and a shared tag would collapse them.
      tag: `session-backdated-${event.params.sid}-${isCreate ? "new" : startAt}`,
      url: "/",
    }, "sessionBilling").catch(() => {});
    console.log("onSessionBackdated", JSON.stringify({
      sid: event.params.sid, kind: isCreate ? "created" : "moved",
      daysBack: Math.round((writtenAt - startAt) / 86400000 * 10) / 10,
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
