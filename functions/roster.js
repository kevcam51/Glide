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
    full: capped && n.total >= FREE_ROSTER_CAP,
    remaining: capped ? Math.max(0, FREE_ROSTER_CAP - n.total) : null,
  };
});

module.exports.FREE_ROSTER_CAP = FREE_ROSTER_CAP;
module.exports.capApplies = capApplies;
