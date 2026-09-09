// Glidna — the free roster cap (S179). Free trainers may manage 15 people
// (connected clients + plan files); every paid tier is unlimited.
//
// WHY THIS HAS TO BE A FUNCTION, which is the non-obvious part. The CLIENT
// writes the link — joinTrainer ends with the client updating their own
// `assignedTrainerId` — and a client cannot count a trainer's roster, because
// the S59 scoped-read rules deliberately stop them reading other people's
// profiles. So the cap simply cannot be checked where the join happens. It has
// to move server-side, where the Admin SDK can count, and firestore.rules has
// to stop clients writing the field directly or this would be decorative.
//
// LEAVING IS DELIBERATELY NOT GATED. The rules still let a client set their own
// assignedTrainerId to NULL — only setting it to a VALUE is blocked. Leaving a
// trainer should never require a server round trip, and should never be
// something we are technically able to refuse.
//
// GRANDFATHERED, per Kevin's standing rule (never a take-away): "Unlimited
// connected clients — free forever" is on the live pricing page, so trainers
// whose accounts predate the cutoff below are exempt permanently. New accounts
// only. Do not retro-apply this.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const REGION = "us-central1";
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];

// Free-tier roster size (S179c, Kevin — raised from 8).
//
// The number is set by what sits BEHIND the wall, not by generosity. A free
// trainer who wants a 9th client can only buy Connect (a plugin for their own
// Claude) or Coach (an in-app AI assistant) — neither of which is "more
// clients". So a low cap walls off a trainer who doesn't want AI and offers
// them nothing they asked for: they buy a plugin they never open and churn, or
// they leave. The wall only works when the thing behind it is what they were
// after, and today it isn't.
//
// 15 still catches the trainer worth converting — a full-time coach with 30–60
// people hits it and is a real business — while a part-timer with 10–20 is no
// longer punished for not wanting an AI plugin. It does NOT undercut Connect:
// Connect's buyer is defined by already living in Claude/ChatGPT, and for them
// the plugin is the product regardless of where the free roster stops.
//
// Cost is not a factor either way — connected clients and plan files are
// pennies. This was always a revenue lever, never a cost control.
//
// Market, for reference: Trainerize free = 1 client, Everfit free = 5.
const FREE_ROSTER_CAP = 15;

// S179b (Kevin): the cap counts PEOPLE THE TRAINER MANAGES, not just connected
// accounts. Counting only connections left the door wide open — a trainer can
// create unlimited local plan files without connecting anyone, and Kevin's own
// Trainerize imports ARE local plan files. So both count toward the 8.
const INDEX_KEY = "caliq-index";

// Accounts created BEFORE this keep unlimited, forever. Set to the S179 ship
// date. A fixed constant rather than a deploy-time value so the boundary is
// deterministic and auditable — re-deploying must never re-draw the line.
const CAP_FROM_MS = Date.parse("2026-08-07T00:00:00Z");

const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis()
  : typeof v === "number" ? v : (typeof v === "string" ? Date.parse(v) : null));

// ── S215 (Kevin): CONNECT IS CAPPED TOO ─────────────────────────────────────
//
// Connect used to be uncapped on the roster, and the pricing page said so. That
// came from S176's "limit only what we pay for" — connected clients cost pennies,
// so there was nothing to protect. Kevin's call reverses it on packaging grounds:
// Connect is the ENTRY rung, and a tier that carries an unlimited roster leaves
// the $19.99 → $49 jump selling nothing but in-app AI.
//
// ⚠️ THIS IS THE ONE CHANGE HERE THAT COULD TAKE SOMETHING AWAY, so it is dated.
// Every account that existed before the ship date keeps an unlimited roster on
// Connect forever — the same instrument CAP_FROM_MS already uses for Free, and
// the same rule teamsAllowed states as "never a take-away". A fixed constant, not
// a deploy-time value, so the boundary is deterministic and auditable.
//
// It is deliberately generous: it grandfathers by ACCOUNT age, not subscription
// age, so someone who signed up last month and buys Connect next year still keeps
// unlimited. With the real Connect population at ~zero that costs nothing, and it
// makes it impossible to cut off a paying customer by accident — which is the
// failure that actually matters. `entitlements.unlimitedRoster` is the manual
// override if one ever needs granting individually.
const CONNECT_CAP_FROM_MS = Date.parse("2026-09-09T00:00:00Z");

// Does this tier string mean a Connect plan? Connect / Coach Connect.
// ⚠️ ORDER-FREE ON PURPOSE. Everywhere else in the codebase this ladder is a
// chain of includes() where "coach_connect" contains "coach" and the connect
// test MUST come first (the mcp.js planFor hazard, PRICING.md S171). Asking the
// one question directly cannot be reordered wrong by a later edit.
function isConnectTier(tier) {
  return String(tier || "").toLowerCase().includes("connect");
}

// Is this trainer subject to the cap at all?
function capApplies(profile) {
  if (!profile) return false;
  if (profile.role === "admin" || ADMIN_UIDS.includes(profile.uid)) return false;
  if (profile.entitlements && profile.entitlements.premium === true) return false;
  if (profile.entitlements && profile.entitlements.unlimitedRoster === true) return false;
  const created = toMs(profile.createdAt);
  // Grandfathered against the ORIGINAL free cap: predates it, or predates our
  // stamping createdAt at all (never punish a missing field).
  if (created === null || created < CAP_FROM_MS) return false;
  if (profile.subscriptionStatus === "active") {
    // Coach and above: uncapped, unchanged. Connect: capped, unless the account
    // predates the day Connect became a capped tier.
    if (!isConnectTier(profile.subscriptionTier)) return false;
    return created >= CONNECT_CAP_FROM_MS;
  }
  // On trial = the whole product, roster included.
  const startMs = toMs(profile.trialStartedAt);
  if (startMs && Date.now() < startMs + (profile.trialLengthDays || 30) * 86400000) return false;
  return true;
}

// ── S215 (Kevin): SESSION BOOKING IS COACH AND ABOVE ────────────────────────
//
// Connect is the plugin tier — bring your own AI, run your roster from it. It
// used to carry booking as well, which is the other half of why the jump to
// Coach had little left to sell. Scheduling is now Coach+.
//
// ⚠️ Booking, NOT BILLING. Taking card payments is a separate question governed
// by sessionBillingGate.js, which is an allowlist of one and has nothing to do
// with tiers. Nothing here changes who can charge; this decides who can put a
// session on a calendar at all.
//
// ⚠️ AND NOT RETROACTIVELY. Same dated grandfather as the roster cap, for the
// same reason: a trainer with sessions already on their calendar must never open
// the app to find they cannot book the next one. Mirrored in firestore.rules
// mayBook() — the app only hides the entry points, the rules are the gate.
const BOOKING_FROM_MS = CONNECT_CAP_FROM_MS;

function bookingAllowed(profile) {
  if (!profile) return false;
  if (profile.role === "admin" || ADMIN_UIDS.includes(profile.uid)) return true;
  if (profile.entitlements && profile.entitlements.premium === true) return true;
  const created = toMs(profile.createdAt);
  if (created === null || created < BOOKING_FROM_MS) return true;   // never a take-away
  if (profile.subscriptionStatus === "active") {
    if (isConnectTier(profile.subscriptionTier)) return false;      // Connect: no booking
    return String(profile.subscriptionTier || "").toLowerCase().includes("coach");
  }
  // Trial = the whole product, so a trialling trainer can book.
  const startMs = toMs(profile.trialStartedAt);
  if (startMs && Date.now() < startMs + (profile.trialLengthDays || 30) * 86400000) return true;
  return false;   // free
}

// Sub-trainer TEAMS are a Coach-tier capability (S179f, Kevin — raised from
// Connect+). Managing people who work under you is an agency-scale thing, and
// the market prices it that way (My PT Hub's $215 tier exists largely for 5
// seats). It also gives the $49 jump a second thing to sell: Connect already
// carries booking, unlimited clients and the plugin, so without this Coach was
// only "+ in-app AI" for +$29.
//
// ⚠️ ORDER MATTERS: "coach_connect" CONTAINS "coach", so connect must be tested
// FIRST or the Connect tiers inherit team access by substring accident. Same
// bug class as the mcp.js planFor ordering hazard — see PRICING.md S171.
function teamsAllowed(profile) {
  if (!profile) return false;
  if (profile.role === "admin" || ADMIN_UIDS.includes(profile.uid)) return true;
  if (profile.subscriptionStatus === "active") {
    const t = String(profile.subscriptionTier || "").toLowerCase();
    if (t.includes("connect")) return false;   // Connect / Coach Connect — booking yes, teams no
    return t.includes("coach");                // coach | coach_max | coach_ultra
  }
  // Trial = the whole product, and pre-cutoff accounts keep what they had
  // (never a take-away) — both mirror capApplies() exactly.
  const startMs = toMs(profile.trialStartedAt);
  if (startMs && Date.now() < startMs + (profile.trialLengthDays || 30) * 86400000) return true;
  const created = toMs(profile.createdAt);
  if (created === null || created < CAP_FROM_MS) return true;
  return false;
}

// Connected accounts + the trainer's own plan files. Both are "a person I
// manage", and only counting one of them would be a cap in name only.
async function countRoster(db, trainerUid) {
  const [connSnap, idxSnap] = await Promise.all([
    db.collection("users").where("assignedTrainerId", "==", trainerUid).count().get(),
    db.doc(`users/${trainerUid}/kv/${encodeURIComponent(INDEX_KEY)}`).get(),
  ]);
  const connected = connSnap.data().count;
  let plans = 0;
  try {
    const arr = JSON.parse((idxSnap.exists && idxSnap.data().value) || "[]");
    // Simulations are sandbox projections, not people — they don't count.
    if (Array.isArray(arr)) plans = arr.filter((p) => p && !p.isSimulation).length;
  } catch (e) { /* unreadable index — count it as zero rather than block a join */ }
  return { connected, plans, total: connected + plans };
}

// Tell the TRAINER when someone was turned away. Kevin's rule: the client must
// never be the one handling the trainer's billing, so the client gets a neutral
// message and the actionable one lands in the trainer's own inbox — the same
// caliq-inbox their client asks already use, so it shows up with no new UI.
async function notifyTrainerRosterFull(db, trainerUid, whoName) {
  const ref = db.doc(`users/${trainerUid}/kv/${encodeURIComponent("caliq-inbox")}`);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let arr = [];
      try { arr = JSON.parse((snap.exists && snap.data().value) || "[]"); } catch (e) { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      // Don't stack duplicates if several people try in a row.
      if (arr.some((r) => r && r.type === "roster-full" && r.status === "open")) return;
      arr.unshift({
        id: `r${Date.now()}${Math.floor(Math.random() * 1e4)}`,
        fromUid: null, fromName: whoName || "Someone",
        type: "roster-full",
        prompt: `${whoName || "Someone"} tried to connect, but your free plan is full at ${FREE_ROSTER_CAP} clients and plans. Upgrade in Plans & pricing to take them on — they weren't told anything about your plan.`,
        status: "open", createdAt: Date.now(), doneAt: null,
      });
      tx.set(ref, { k: "caliq-inbox", value: JSON.stringify(arr.slice(0, 100)) }, { merge: true });
    });
  } catch (e) { /* notification is best-effort — never block the join path on it */ }
}

// Resolve an invite code (or raw uid) to a trainer uid. Mirrors the client-side
// resolution in src/profile.js so a code that worked before still works.
async function resolveTrainer(db, raw) {
  const code = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code) {
    const snap = await db.doc(`inviteCodes/${code}`).get();
    if (snap.exists && snap.data().trainerUid) return snap.data().trainerUid;
    const legacy = await db.collection("users").where("inviteCode", "==", code).limit(1).get();
    if (!legacy.empty) return legacy.docs[0].id;
  }
  const asUid = String(raw || "").trim();
  if (asUid) {
    const direct = await db.doc(`users/${asUid}`).get();
    if (direct.exists) return asUid;
  }
  return null;
}

exports.joinTrainerByCode = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const raw = String((request.data && request.data.code) || "").trim();
  if (!raw) throw new HttpsError("invalid-argument", "Enter your trainer's invite code first.");

  const db = admin.firestore();
  const trainerUid = await resolveTrainer(db, raw);
  if (!trainerUid) {
    throw new HttpsError("not-found", "That code didn't match any trainer. Double-check it and try again.");
  }
  if (trainerUid === uid) {
    throw new HttpsError("failed-precondition", "You can't link to your own account.");
  }

  const tProf = (await db.doc(`users/${trainerUid}`).get()).data();
  if (!tProf || (tProf.role !== "head_trainer" && tProf.role !== "sub_trainer")) {
    throw new HttpsError("not-found", "That code doesn't belong to a trainer account.");
  }

  // The cap. Counted at join time rather than tracked on the profile, so it can
  // never drift out of sync with reality (a client leaving frees a slot for
  // free, with nothing to decrement).
  if (capApplies({ ...tProf, uid: trainerUid })) {
    const n = await countRoster(db, trainerUid);
    if (n.total >= FREE_ROSTER_CAP) {
      // The client is told NOTHING about the trainer's plan or billing (Kevin):
      // that is between us and the trainer, and a client should never be put in
      // the position of chasing their coach about a subscription. They get a
      // neutral "can't right now"; the actionable message goes to the trainer.
      const me = (await db.doc(`users/${uid}`).get()).data() || {};
      const myName = me.displayName || [me.firstName, me.lastName].filter(Boolean).join(" ")
        || me.email || "Someone";
      await notifyTrainerRosterFull(db, trainerUid, myName);
      throw new HttpsError("resource-exhausted",
        "This trainer can't take on new connections right now. They've been let know you tried — "
        + "check with them directly. Nothing else about your account is affected.",
        { reason: "trainer-roster-full" });
    }
  }

  await db.doc(`users/${uid}`).set({ assignedTrainerId: trainerUid }, { merge: true });
  return { ok: true, trainerUid };
});

// What a trainer sees about their own cap — powers the roster banner and the
// "invites are paused" state. Cheap: one aggregate count, no document reads.
exports.myRosterStatus = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const db = admin.firestore();
  const prof = (await db.doc(`users/${uid}`).get()).data() || {};
  const capped = capApplies({ ...prof, uid });
  const n = await countRoster(db, uid);
  return {
    count: n.total, connected: n.connected, plans: n.plans,
    capped, cap: capped ? FREE_ROSTER_CAP : null,
    // Which PLAN the cap belongs to, so the banner can name it instead of always
    // saying "the free plan" — Connect is capped too since S215.
    cappedPlan: capped ? (isConnectTier(prof.subscriptionTier) ? "Coach Connect" : "the free plan") : null,
    booking: bookingAllowed({ ...prof, uid }),
    teamsLocked: !teamsAllowed({ ...prof, uid }),
    full: capped && n.total >= FREE_ROSTER_CAP,
    remaining: capped ? Math.max(0, FREE_ROSTER_CAP - n.total) : null,
  };
});

module.exports.FREE_ROSTER_CAP = FREE_ROSTER_CAP;
module.exports.CONNECT_CAP_FROM_MS = CONNECT_CAP_FROM_MS;
module.exports.capApplies = capApplies;
module.exports.teamsAllowed = teamsAllowed;
module.exports.bookingAllowed = bookingAllowed;
module.exports.isConnectTier = isConnectTier;
