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
const admin = require("firebase-admin");

// How far back to look. The sweep runs every 15 min, so a 14-day window is
// enormous slack — it only matters if the scheduler was down for days. The
// range stays on ONE field (startAt) so a single-field index serves it and no
// composite index has to be deployed.
const LOOKBACK_DAYS = 14;
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
      completedVia: "auto",
      updatedAt: now,
    });
    marked++;
  });
  if (marked) await batch.commit();
  return { scanned: snap.size, marked, skipped };
}

exports.markCompletedSessions = markCompletedSessions;

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
