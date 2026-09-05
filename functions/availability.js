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

const { estimateDrive, feasibilityWarnings } = require("./driveTime");

const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
// Optional by design: with no key configured the drive estimates fall back to
// straight-line distance, which needs nothing and still catches the schedules
// that cannot work at all.
const GOOGLE_MAPS_API_KEY = defineSecret("GOOGLE_MAPS_API_KEY");
const REGION = "us-central1";
const MAX_WINDOW_DAYS = 45;     // how far ahead a client may look
// Beyond this gap between two sessions, no realistic drive makes the pair
// infeasible — so a pair further apart than this is not a "connection" worth
// reporting as unchecked. Four hours is generous: the longest drive anyone
// books across a city is well under it.
const RELEVANT_GAP_MIN = 240;
// Paid COACH plans that get traffic-aware drive times (see sessionTravel).
// Every paid plan carries session booking, so every paid plan gets the accurate
// number; the free estimator stays free for everyone.
//
// ⚠️ THESE ARE `subscriptionTier` VALUES, FROM THE CATALOG IN billing.js — not
// the tier LABELS in PLAN_FEATURES. The first version of this constant said
// ["connect", "base", "max"], which was read straight off the pricing grid and
// matches NO trainer subscription: the real values are coach-prefixed, and
// "base" is not a tier at all. Every paying coach silently got the free
// estimator while the UI told them their plan included traffic. Keep this in
// step with CATALOG (functions/billing.js) — scripts/test-drive-time.mjs
// asserts the two agree.
// Kevin's call (S198): Coach and above — the rung ABOVE Connect. Traffic-aware
// drive time is a reason to move up from the connector, not something the entry
// plan carries. Connect keeps the free straight-line estimate and the
// can't-make-it warning, which are the safety half and cost nothing per lookup.
const TRAFFIC_AWARE_TIERS = ["coach", "coach_max", "coach_ultra"];
// Admin UID (matches functions/index.js, aichat.js and firestore.rules isAdmin()).
// Identified by UID and never by a profile-doc role, because the admin role
// exists only in the custom claim — see the note at the paid check below.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
function isAdminUid(uid) { return ADMIN_UIDS.includes(uid); }
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

    // ⚠️ VALIDATE FIRST, CLAIM SECOND, AND PUT THE CLAIM BACK IF THE BOOKING
    // FAILS. The first version claimed the item up front — marking it answered
    // in a transaction — and only then checked the link, the time and the rate.
    // Every one of those checks can throw, and each throw destroyed the
    // request: permanently marked "accepted", no session created, no
    // notification sent, and no way for either side to retry. The client had
    // asked for a time and simply never heard back.
    const readItem = async () => {
      const snap = await inboxRef.get();
      let arr = [];
      try { const v = snap.exists && snap.data().value; arr = v ? JSON.parse(v) : []; } catch { arr = []; }
      return Array.isArray(arr) ? arr : [];
    };
    const preview = (await readItem()).find((r) => r && r.id === requestId);
    if (!preview) throw new HttpsError("not-found", "That request is gone.");
    if (preview.status !== "open") throw new HttpsError("failed-precondition", "You've already answered that one.");

    const clientUid = preview.fromUid;
    const booking = preview.booking || null;
    // ⚠️ WHICH slot (S197). A client may now ask for several days at once
    // ("Mon/Wed/Fri at 9, starting next week"), so accepting has to say which
    // one is being booked. The chosen time is validated against the slots the
    // CLIENT actually offered — never taken on trust — so a tampered request
    // cannot book a time nobody asked for. Absent `slots` means an older
    // single-time request, where startAt is the only answer.
    const offered = Array.isArray(booking && booking.slots) && booking.slots.length
      ? booking.slots.map(Number).filter(Number.isFinite)
      : (booking && Number.isFinite(Number(booking.startAt)) ? [Number(booking.startAt)] : []);
    const wanted = Number(d.slotStartAt);
    const chosenStart = Number.isFinite(wanted) && offered.includes(wanted) ? wanted : offered[0];
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
    const when = booking ? new Date(chosenStart).toLocaleString("en-US", {
      timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }) : "";

    // What this session will cost, decided before anything is written.
    //
    // ⚠️ NEVER BOOK AT $0 FROM AN ACCEPT. `standardPriceCents` is new and
    // defaults to 0, so on the day this ships every trainer who hasn't opened
    // the policy editor has no rate — and Accept & book is a single tap with no
    // price field on it. A $0 session books fine, gets delivered, and is then
    // frozen at `billableCents: 0` and settled `free`: terminal, unbillable,
    // and silent. The trainer would have trained someone for nothing and seen
    // only "nothing-billable" in a log they never read. Refusing is recoverable
    // (the request stays open, because the claim hasn't happened yet); a $0
    // booking is not.
    let priceCents = 0;
    if (accept && booking) {
      if (!Number.isFinite(chosenStart) || chosenStart < Date.now()) {
        throw new HttpsError("failed-precondition", "That time has already passed — book a new one instead.");
      }
      priceCents = Math.max(0, Math.min(500000, Math.round(Number((trainer.sessionPolicy || {}).standardPriceCents) || 0)));
      if (priceCents <= 0) {
        throw new HttpsError("failed-precondition",
          "Set your standard session price first (Calendar → Settings) — otherwise this books at $0 and can never be charged.",
          { reason: "no-standard-price" });
      }
    }

    // ⚠️ AND NOT ON TOP OF SOMETHING ALREADY THERE (S199d). Nothing on any
    // booking path checked this, and Accept is a SINGLE TAP with no
    // confirmation and no price field — so a trainer could put two billable
    // sessions on the same hour without either party seeing a thing. It matters
    // more now that a client can offer several days: the composer only fetches
    // free/busy for the FIRST offered day, so tapping "Book this" on Wednesday
    // books an hour nothing on either side ever looked at.
    //
    // Refused rather than warned, because a one-tap control has nowhere to put
    // a warning — and refusing is recoverable (the request stays open, the claim
    // has not happened yet) where a double-booking is not. A trainer who
    // genuinely wants an overlap can still create it from the calendar, which
    // has a real form and a confirmation.
    //
    // ⚠️ THE CHECK, THE CLAIM AND THE CREATE ARE NOW ONE TRANSACTION (S199q).
    // They used to be three steps: read the day, then claim the inbox item, then
    // add() the session. Every one of them was correct on its own and the gap
    // between them was the bug — two different requests for overlapping hours,
    // accepted in the same second, both read a clear calendar and both booked.
    // Two billable sessions, no warning to anyone. Firestore re-runs the whole
    // callback on contention, so the overlap read is re-done against the state
    // the write will actually land on.
    //
    // Reads must all precede writes inside a transaction, which is why the
    // session's id is minted up front rather than by add().
    const sessionRef = db.collection("sessions").doc();
    const now = Date.now();
    let sessionId = null;
    await db.runTransaction(async (tx) => {
      // ── reads ──────────────────────────────────────────────────────────
      const snap = await tx.get(inboxRef);
      // One equality each, window filtered in code — a range on startAt
      // alongside it needs a composite index, and this repo has been bitten by
      // that twice.
      // ⚠️ BLOCKS COUNT TOO. `trainerBlocks` is the trainer's own "I am not
      // available" — physio, lunch, the school run — and trainerAvailability
      // already MERGES it into the busy ranges a client is shown. Checking only
      // sessions meant the app told the client that hour was taken and then
      // booked it anyway, on the one path that refuses rather than asks.
      const [mine, blocks] = accept && booking
        ? await Promise.all([
            tx.get(db.collection("sessions").where("trainerUid", "==", uid)),
            tx.get(db.collection("trainerBlocks").where("trainerUid", "==", uid)),
          ])
        : [null, null];

      // ── decide, before anything is written ─────────────────────────────
      let arr = [];
      try { const v = snap.exists && snap.data().value; arr = v ? JSON.parse(v) : []; } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      const found = arr.find((r) => r && r.id === requestId);
      if (!found) throw new HttpsError("not-found", "That request is gone.");
      if (found.status !== "open") throw new HttpsError("failed-precondition", "You've already answered that one.");

      if (accept && booking) {
        const dayFrom = chosenStart - 12 * 3600000, dayTo = chosenStart + 12 * 3600000;
        const endAt = chosenStart + (Number(booking.durationMin) || 60) * 60000;
        let clash = null;
        const consider = (v, isBlock) => {
          if (clash) return;
          if (!isBlock && v.status === "cancelled") return;
          const st = Number(v.startAt) || 0;
          if (st < dayFrom || st > dayTo) return;
          const en = st + (Number(v.durationMin) || 60) * 60000;
          if (chosenStart < en && endAt > st) clash = { st, en, isBlock };
        };
        mine.forEach((doc) => consider(doc.data() || {}, false));
        blocks.forEach((doc) => consider(doc.data() || {}, true));
        if (clash) {
          const clashWhen = new Date(clash.st).toLocaleString("en-US", {
            timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit",
          });
          throw new HttpsError("failed-precondition",
            clash.isBlock
              ? `That runs into time you've blocked out at ${clashWhen}. Decline this and offer another time, or book it yourself from the calendar.`
              : `That overlaps a session you already have at ${clashWhen}. Decline this and offer another time, or book it yourself from the calendar.`,
            { reason: "overlap" });
        }
      }

      // ── writes ─────────────────────────────────────────────────────────
      const next = arr.map((r) => (r && r.id === requestId
        ? { ...r, status: "done", doneAt: Date.now(), outcome: accept ? "accepted" : "declined" }
        : r));
      tx.set(inboxRef, { k: INBOX_KEY, value: JSON.stringify(next) });

      if (accept && booking) {
        tx.set(sessionRef, {
          participants: [uid, clientUid],
          trainerUid: uid, clientUid,
          startAt: chosenStart,
          durationMin: Number(booking.durationMin) || 60,
          status: "scheduled",
          title: "", location: "",
          priceCents,
          createdBy: uid, createdAt: now, updatedAt: now,
        });
        sessionId = sessionRef.id;
      }
    });
    // No releaseClaim any more, and none is possible to need: the claim and the
    // session are the same commit, so there is no window where one exists
    // without the other. The reopen path it used to guard was itself a risk —
    // it ran AFTER a failure, on a connection that had just failed.

    await sendPushTo(db, clientUid, accept
      // Accepting ONE slot closes the whole ask, so say which one was taken and
      // that the others are released — otherwise a client who offered three
      // days is told a session is booked and is left to work out whether the
      // other two are still pending. Same failure as the decline had.
      ? { title: `${trainerName} confirmed your session`,
          body: when
            ? (offered.length > 1
                ? `${when} — it's on your calendar. The other ${offered.length - 1 === 1 ? "time you offered is" : `${offered.length - 1} times you offered are`} free again.`
                : `${when} — it's on your calendar.`)
            : "It's on your calendar.",
          tag: `booking-accepted-${requestId}`, url: "/" }
      // ⚠️ A DECLINE CLOSES EVERY OFFERED TIME, SO IT MUST NAME EVERY ONE.
      // "Can't make it" sends no chosen slot, so `chosenStart` falls back to
      // offered[0] — and a Mon/Wed/Fri ask was answered with "Mon, Sep 7 didn't
      // work", while the request was marked done and vanished from the
      // trainer's list. The client, who has no view of their own sent asks,
      // reads that as "Monday is out, the others are still pending" and waits
      // for an answer that can never come. This became wrong the moment `slots`
      // started surviving; before that there was only ever one time.
      : { title: `${trainerName} couldn't make ${offered.length > 1 ? "those times" : "that time"}`,
          body: offered.length > 1
            ? `None of the ${offered.length} times you asked for worked — ask for another.`
            : (when ? `${when} didn't work — ask for another time.` : "Ask for another time."),
          tag: `booking-declined-${requestId}`, url: "/" },
      // An ANSWER to something the client asked for, not a timed reminder — so
      // it follows the request/answer preference rather than the one that
      // controls "your session starts in an hour" (S196p). Turning off
      // reminders should not mean never hearing whether you got the slot.
      "clientRequests").catch(() => {});

    return { ok: true, accepted: accept, sessionId };
  },
);

// ─── 3. Can I actually make it from one session to the next? ────────────────
// Pass 2 of the booking spec (S197i). The trainer asks about a date range; they
// get back a drive estimate for each adjacent pair and a warning where the
// schedule does not survive the drive.
//
// ⚠️ TRAINER-ONLY, AND ONLY THEIR OWN SESSIONS. The reply contains client
// ADDRESSES — the whole point is the drive between them — so it is scoped to
// sessions where the caller is the trainer, never merely a participant. A
// client calling this would otherwise learn where the trainer's other clients
// live, which is the exact leak `trainerAvailability` exists to prevent.
//
// Costs nothing to call repeatedly: every estimate is cached by
// (origin, destination, weekday, hour), so an unchanged week is all cache hits.
exports.sessionTravel = onCall(
  { region: REGION, maxInstances: 10, secrets: [GOOGLE_MAPS_API_KEY] },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const d = request.data || {};
    const from = Number(d.from), to = Number(d.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      throw new HttpsError("invalid-argument", "Give a from/to range in ms.");
    }
    // A bounded window, for the same reason trainerAvailability has one: an
    // unbounded range is an unbounded read.
    if (to - from > 45 * 86400000) throw new HttpsError("invalid-argument", "That range is too wide.");

    const db = admin.firestore();
    // ⚠️ ONE EQUALITY, NO RANGE — the window is applied in CODE. Combining
    // `trainerUid ==` with a range on `startAt` needs a composite index, and a
    // feature that 500s until someone remembers to deploy one is worse than a
    // few hundred extra reads. This is the same call S187 made for calendarFeed,
    // and for a stronger reason here: this feature's failure mode is SILENCE,
    // and silence reads as "your schedule is fine". An infra gap must never be
    // able to say that. (Revisit if a single trainer's session history passes a
    // few thousand documents; then an index, deployed with the function, wins.)
    const snap = await db.collection("sessions").where("trainerUid", "==", uid).get();

    const sessions = [];
    snap.forEach((doc) => {
      const s = doc.data() || {};
      if (s.status === "cancelled") return;
      const st = Number(s.startAt) || 0;
      if (st < from || st > to) return;
      sessions.push({ id: doc.id, startAt: Number(s.startAt) || 0,
        durationMin: Number(s.durationMin) || 0, location: String(s.location || ""),
        status: s.status || "scheduled" });
    });
    sessions.sort((a, b) => a.startAt - b.startAt);

    // Estimate each adjacent pair ONCE, up front, so the pure feasibility pass
    // stays synchronous and testable.
    // Google API keys are 39 chars beginning "AIza". Checking the SHAPE means a
    // placeholder (the secret has to exist for the deploy to succeed) behaves as
    // "no key" — falling back to straight-line — instead of as a broken key,
    // which would fail geocoding and silently remove every warning.
    const raw = (GOOGLE_MAPS_API_KEY.value() || "").trim();
    const keyPresent = raw.startsWith("AIza");

    // ── Who gets TRAFFIC-AWARE times (S197k) ────────────────────────────────
    // Kevin's S190b note says drive time is "a Coach-plan feature, not a
    // separate upcharge... it means the Google Routes cost lands only on
    // accounts already paying, so the margin question answers itself."
    //
    // Split along the line his own reasoning draws, rather than gating the
    // whole feature:
    //   • The WARNING and the free straight-line estimate: everyone. It costs
    //     nothing per lookup, PLAN_FEATURES says in as many words that the
    //     coaching workspace is free, and this is a safety check — telling
    //     someone they cannot make it across town is not an upsell.
    //   • TRAFFIC-AWARE times: paid plans only. That is the part with a real
    //     per-lookup bill attached, which is exactly the cost Kevin wanted to
    //     land on paying accounts.
    // The boundary is one constant. Move it if he wants Routes reserved for
    // Coach and above rather than every paid plan.
    // ⚠️ ADMIN IS A UID, NEVER A PROFILE ROLE (S199g). This read
    // `me.role === "admin"` from the profile DOC — and createProfile only ever
    // writes "client" or "head_trainer", while index.js mirrors the admin role
    // into the custom CLAIM alone. So that condition is false for every real
    // document, including the owner's: the one account meant to bypass the tier
    // gate never did, and the owner saw straight-line estimates plus an upgrade
    // prompt for a feature he had paid Google for and enabled himself. The
    // trap is documented verbatim in functions/aichat.js:54-58; this was the
    // one gate that did not go through it.
    let paid = isAdminUid(uid);
    if (!paid) {
      try {
        const me = (await db.doc(`users/${uid}`).get()).data() || {};
        paid = me.subscriptionStatus === "active" && TRAFFIC_AWARE_TIERS.includes(
          String(me.subscriptionTier || "base").toLowerCase());
      } catch { /* a profile read failure just means the free estimator */ }
    }
    const key = keyPresent && paid ? raw : null;
    const legs = {};
    // Pairs we could have checked, pairs we could not estimate, and pairs with
    // no address to work from — three different things the UI must not merge.
    let checkable = 0, unknown = 0, noAddress = 0;
    for (let i = 0; i < sessions.length - 1; i++) {
      const a = sessions[i], b = sessions[i + 1];
      // ⚠️ COUNT WHAT COULD NOT BE CHECKED. An unknown drive produces no
      // warning, which is right — a warning nobody can act on trains people to
      // ignore the ones that matter — but it left "checked, all clear" and "six
      // of seven legs failed" BYTE-IDENTICAL on screen, on a feature whose
      // failure mode is silence and whose silence reads as "your schedule is
      // fine". These two counts are what let the panel tell the difference.
      // ⚠️ ONLY PAIRS WHERE A DRIVE COULD POSSIBLY MATTER. Counting every
      // adjacent pair in a 21-day window meant sessions a DAY apart — which no
      // drive can ever make infeasible — were reported on screen as
      // "back-to-back sessions" we could not check. Two consequences, both bad:
      // a permanent "this isn't an all-clear" on schedules that are entirely
      // fine, and a permanent, undismissable "add a location" for the majority
      // of trainers who never fill a location in at all. A panel that is always
      // on is a panel nobody reads, which is how the real warning gets missed.
      // ⚠️ THE CEILING BOUNDS THE COUNTERS, NOT THE ESTIMATE. Placing this
      // `continue` above the estimate meant a pair more than four hours apart
      // got no leg AND no count — so a genuinely impossible long drive produced
      // no warning and no coverage note, a blank calendar on a schedule the
      // same code would have called infeasible one commit earlier. That is a
      // silent all-clear, which is the one thing this feature may never do.
      // feasibilityWarnings has no ceiling of its own, so the estimate must
      // still run for every pair; only the "did we manage to check it" counting
      // is bounded, because a pair a day apart is not a connection anyone needs
      // reassuring about.
      const gapMin = (b.startAt - (a.startAt + (Number(a.durationMin) || 0) * 60000)) / 60000;
      const counts = gapMin < RELEVANT_GAP_MIN;
      if (!a.location || !b.location) { if (counts) noAddress++; continue; }
      if (counts) checkable++;
      const legKey = `${a.id}>${b.id}`;
      if (legs[legKey]) continue;
      try {
        legs[legKey] = await estimateDrive(db, a.location, b.location, b.startAt, key);
      } catch (e) {
        console.error("drive estimate failed:", e && e.message);
        legs[legKey] = null;   // unknown, which the feasibility pass treats as silence
      }
      if (!legs[legKey] && counts) unknown++;
    }
    // ⚠️ DO NOT NAG SOMEONE WHO DOES NOT USE ADDRESSES. Location is optional and
    // is only ever pre-filled from an earlier session that had one, so a trainer
    // who has never typed one never gets one — and every back-to-back pair they
    // ever book would report "no address to measure between", permanently, with
    // nothing wrong and nothing they asked for. Bounding by gap cut that from 74
    // to 60 on a normal week, which is not a fix. The honest signal is whether
    // they use locations AT ALL: if none of their sessions has one, this feature
    // is not something they are using and the panel has nothing to tell them.
    if (!sessions.some((s) => s.location)) noAddress = 0;
    // Looked up by the exact pair that was estimated — never by address, which
    // would collide as soon as one client is visited twice in a day.
    const warnings = feasibilityWarnings(sessions, (a, b) => legs[`${a.id}>${b.id}`] || null);

    return {
      warnings,
      legs: Object.entries(legs).filter(([, v]) => v).map(([k, v]) => ({
        pair: k, minutes: v.minutes, miles: v.miles != null ? Math.round(v.miles * 10) / 10 : null,
        source: v.source, cached: !!v.cached,
      })),
      // ⚠️ DERIVED FROM THE LEGS, NOT FROM THE KEY (S197w). This used to report
      // `!!key`, but routesLive falls back to the straight line whenever Routes
      // fails or a geocode misses — so a configured key made the UI announce
      // "Drive times include current traffic" over numbers that knew nothing
      // about traffic. Say it only when something actually came back that way.
      trafficAware: Object.values(legs).some((v) => v && v.source === "routes"),
      // Why it is not, when it is not — so the UI can tell the difference
      // between "your plan does not include this" and "nobody has one yet".
      trafficAvailable: keyPresent,
      // What the answer is worth. `unknownPairs > 0` means the panel must NOT
      // read as an all-clear, and `pairsWithoutAddress` is separately
      // actionable — the fix for that one is typing an address, not retrying.
      checkedPairs: checkable,
      unknownPairs: unknown,
      pairsWithoutAddress: noAddress,
    };
  },
);
