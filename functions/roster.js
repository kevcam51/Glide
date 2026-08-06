// Glidna — the free roster cap (S179). Free trainers may connect 8 clients;
// every paid tier is unlimited.
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

// Free-tier roster size. Chosen over the market's 5 (Everfit) because free
// trainers are also the distribution engine — every client they bring is a
// potential paying CLIENT subscriber, so a tight cap buys trainer conversions
// at the cost of client inflow. 8 is the most generous free tier in the
// category (Trainerize free = 1).
const FREE_ROSTER_CAP = 8;

// Accounts created BEFORE this keep unlimited, forever. Set to the S179 ship
// date. A fixed constant rather than a deploy-time value so the boundary is
// deterministic and auditable — re-deploying must never re-draw the line.
const CAP_FROM_MS = Date.parse("2026-08-07T00:00:00Z");

const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis()
  : typeof v === "number" ? v : (typeof v === "string" ? Date.parse(v) : null));

// Is this trainer subject to the cap at all?
function capApplies(profile) {
  if (!profile) return false;
  if (profile.role === "admin" || ADMIN_UIDS.includes(profile.uid)) return false;
  if (profile.subscriptionStatus === "active") return false;          // any paid tier
  if (profile.entitlements && profile.entitlements.premium === true) return false;
  // On trial = the whole product, roster included.
  const startMs = toMs(profile.trialStartedAt);
  if (startMs && Date.now() < startMs + (profile.trialLengthDays || 30) * 86400000) return false;
  // Grandfathered: predates the cap.
  const created = toMs(profile.createdAt);
  if (created !== null && created < CAP_FROM_MS) return false;
  // No createdAt at all means an early account from before we stamped it —
  // treat as grandfathered rather than punishing a missing field.
  if (created === null) return false;
  return true;
}

async function countRoster(db, trainerUid) {
  const snap = await db.collection("users")
    .where("assignedTrainerId", "==", trainerUid).count().get();
  return snap.data().count;
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
    if (n >= FREE_ROSTER_CAP) {
      // Aimed at the CLIENT, who did nothing wrong and cannot fix it — so it
      // never blames them and never asks them to pay for something that is
      // their trainer's to sort out.
      throw new HttpsError("resource-exhausted",
        "This trainer's free plan is full, so they can't take on new clients right now. "
        + "Ask them to upgrade in Glidna and then try this code again — nothing else about your account is affected.",
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
  const count = await countRoster(db, uid);
  return { count, capped, cap: capped ? FREE_ROSTER_CAP : null, full: capped && count >= FREE_ROSTER_CAP };
});

module.exports.FREE_ROSTER_CAP = FREE_ROSTER_CAP;
module.exports.capApplies = capApplies;
