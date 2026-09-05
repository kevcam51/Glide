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

    // NOW claim it. The transaction is what stops two taps — the trainer's
    // phone and their laptop — becoming two sessions and two charges.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(inboxRef);
      let arr = [];
      try { const v = snap.exists && snap.data().value; arr = v ? JSON.parse(v) : []; } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      const found = arr.find((r) => r && r.id === requestId);
      if (!found) throw new HttpsError("not-found", "That request is gone.");
      if (found.status !== "open") throw new HttpsError("failed-precondition", "You've already answered that one.");
      const next = arr.map((r) => (r && r.id === requestId
        ? { ...r, status: "done", doneAt: Date.now(), outcome: accept ? "accepted" : "declined" }
        : r));
      tx.set(inboxRef, { k: INBOX_KEY, value: JSON.stringify(next) });
    });

    // Reopen the request if the booking itself fails. Everything that could be
    // checked has been, so this is the narrow window where Firestore is simply
    // unavailable — and leaving the item marked "accepted" with no session is
    // the one outcome nobody can recover from.
    const releaseClaim = async () => {
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(inboxRef);
          let arr = [];
          try { const v = snap.exists && snap.data().value; arr = v ? JSON.parse(v) : []; } catch { arr = []; }
          if (!Array.isArray(arr)) return;
          const next = arr.map((r) => (r && r.id === requestId
            ? { ...r, status: "open", doneAt: null, outcome: null }
            : r));
          tx.set(inboxRef, { k: INBOX_KEY, value: JSON.stringify(next) });
        });
      } catch (e) { console.error("could not reopen booking request", requestId, e && e.message); }
    };

    let sessionId = null;
    if (accept && booking) {
      const now = Date.now();
      try {
        const ref = await db.collection("sessions").add({
          participants: [uid, clientUid],
          trainerUid: uid, clientUid,
          startAt: chosenStart,
          durationMin: Number(booking.durationMin) || 60,
          status: "scheduled",
          title: "", location: "",
          priceCents,
          createdBy: uid, createdAt: now, updatedAt: now,
        });
        sessionId = ref.id;
      } catch (e) {
        await releaseClaim();
        console.error("booking accept failed after claim", requestId, e && e.message);
        throw new HttpsError("internal", "Couldn't book that session — try again.");
      }
    }

    await sendPushTo(db, clientUid, accept
      ? { title: `${trainerName} confirmed your session`,
          body: when ? `${when} — it's on your calendar.` : "It's on your calendar.",
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
    let paid = false;
    try {
      const me = (await db.doc(`users/${uid}`).get()).data() || {};
      paid = me.role === "admin"
        || (me.subscriptionStatus === "active" && TRAFFIC_AWARE_TIERS.includes(
             String(me.subscriptionTier || "base").toLowerCase()));
    } catch { /* a profile read failure just means the free estimator */ }
    const key = keyPresent && paid ? raw : null;
    const legs = {};
    for (let i = 0; i < sessions.length - 1; i++) {
      const a = sessions[i], b = sessions[i + 1];
      if (!a.location || !b.location) continue;
      const legKey = `${a.id}>${b.id}`;
      if (legs[legKey]) continue;
      try {
        legs[legKey] = await estimateDrive(db, a.location, b.location, b.startAt, key);
      } catch (e) {
        console.error("drive estimate failed:", e && e.message);
        legs[legKey] = null;   // unknown, which the feasibility pass treats as silence
      }
    }
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
    };
  },
);
