// Glide — trainer TEAM management (head trainer ↔ sub-trainers), S116.
// ===========================================================================
// This is the long-deferred "head-invites-sub onboarding with consent" roadmap
// item. It needed server-side logic because `firestore.rules` deliberately
// blocks a user from changing their own `role` (no self-promotion) — so the
// role/link change has to happen in trusted Admin-SDK code, never client-side.
//
// THE BUG THIS FIXES: `getMySubTrainers()` and the rules' isHeadOfTrainer()
// both key off a sub-trainer's `headTrainerId`, but NOTHING in the app ever set
// that field (createProfile only sets it for a head pointing at itself, and
// joinTrainer only ever wrote assignedTrainerId). So the whole second tier was
// unreachable: a head could not see or manage anyone under them.
//
// The access RULES were already correct and emulator-tested for this shape
// ("head reads/writes kv of client assigned to his sub" passes; a DIFFERENT
// head is denied) — the data was simply never linked. No rules change needed.
//
// CONSENT MODEL: the sub-trainer initiates by entering the head's invite code,
// so joining is always the sub's own act. A head can remove someone from their
// team, and a sub can leave at any time — neither can force a link.
// ===========================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
const TRAINER_ROLES = new Set(["head_trainer", "sub_trainer", "admin"]);

// Invite codes are stored uppercase without separators (mirrors normalizeCode
// in src/profile.js — keep the two in step).
function normalizeCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function requireTrainer(db, uid) {
  const prof = (await db.doc(`users/${uid}`).get()).data();
  if (!prof) throw new HttpsError("not-found", "Profile not found.");
  const role = ADMIN_UIDS.includes(uid) ? "admin" : (prof.role || "client");
  if (!TRAINER_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Only trainer accounts can use team features.");
  }
  return { prof, role };
}

// ── Join a head trainer's team (called BY the joining trainer) ──────────────
// Sets headTrainerId AND normalizes the joiner's role to sub_trainer. Both are
// blocked to the client by the rules, which is exactly why this is server-side.
exports.joinTeam = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const { prof, role } = await requireTrainer(db, uid);

  const code = normalizeCode(request.data && request.data.code);
  if (!code) throw new HttpsError("invalid-argument", "Enter your head trainer's invite code.");

  // Resolve the code → head uid via the inviteCodes lookup collection.
  const codeSnap = await db.doc(`inviteCodes/${code}`).get();
  const headUid = codeSnap.exists ? codeSnap.data().trainerUid : null;
  if (!headUid) throw new HttpsError("not-found", "That code didn't match any trainer.");
  if (headUid === uid) throw new HttpsError("invalid-argument", "You can't join your own team.");

  const headProf = (await db.doc(`users/${headUid}`).get()).data();
  if (!headProf) throw new HttpsError("not-found", "That trainer no longer exists.");
  const headRole = ADMIN_UIDS.includes(headUid) ? "admin" : (headProf.role || "client");
  if (headRole !== "head_trainer" && headRole !== "admin") {
    throw new HttpsError("failed-precondition", "That code belongs to a sub-trainer. Teams are only one level deep — ask the head trainer for their code.");
  }
  // Two levels only (the documented cap): someone who already has people under
  // them can't also sit under someone else, or access chains get ambiguous.
  // NOTE: a head trainer's OWN headTrainerId points at itself (createProfile),
  // so this query always returns the caller's own doc — filter it out or the
  // guard fires for everyone and nobody can ever join a team.
  const subs = await db.collection("users").where("headTrainerId", "==", uid).limit(5).get();
  if (subs.docs.some((d) => d.id !== uid)) {
    throw new HttpsError("failed-precondition", "You already have trainers on your own team. Teams are limited to two levels.");
  }

  await db.doc(`users/${uid}`).update({
    headTrainerId: headUid,
    role: role === "admin" ? role : "sub_trainer",
  });
  return {
    ok: true,
    headTrainerId: headUid,
    headName: headProf.displayName || [headProf.firstName, headProf.lastName].filter(Boolean).join(" ") || headProf.email || "your head trainer",
  };
});

// ── Leave the team (called BY the sub-trainer) ─────────────────────────────
// Restores them to an independent head_trainer. Their own clients (who point at
// them via assignedTrainerId) are untouched — they keep them.
exports.leaveTeam = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const { prof } = await requireTrainer(db, uid);
  if (!prof.headTrainerId || prof.headTrainerId === uid) {
    throw new HttpsError("failed-precondition", "You're not on anyone's team.");
  }
  await db.doc(`users/${uid}`).update({ headTrainerId: uid, role: "head_trainer" });
  return { ok: true };
});

// ── Remove a sub-trainer from MY team (called BY the head) ─────────────────
exports.removeSubTrainer = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  await requireTrainer(db, uid);
  const subUid = String((request.data && request.data.subTrainerId) || "");
  if (!subUid) throw new HttpsError("invalid-argument", "subTrainerId is required.");

  const subProf = (await db.doc(`users/${subUid}`).get()).data();
  if (!subProf) throw new HttpsError("not-found", "That trainer no longer exists.");
  // Only the head they actually report to can remove them.
  if (subProf.headTrainerId !== uid) {
    throw new HttpsError("permission-denied", "That trainer isn't on your team.");
  }
  await db.doc(`users/${subUid}`).update({ headTrainerId: subUid, role: "head_trainer" });
  return { ok: true };
});

// ── List my team (called BY the head) ──────────────────────────────────────
exports.listTeam = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  await requireTrainer(db, uid);
  const snap = await db.collection("users")
    .where("headTrainerId", "==", uid).limit(100).get();
  const team = [];
  for (const doc of snap.docs) {
    if (doc.id === uid) continue; // a head's own headTrainerId points at itself
    const p = doc.data();
    // How many clients does this sub-trainer carry?
    const clients = await db.collection("users")
      .where("assignedTrainerId", "==", doc.id).limit(200).get();
    team.push({
      subTrainerId: doc.id,
      name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Trainer",
      email: p.email || null,
      role: p.role || "sub_trainer",
      clientCount: clients.size,
    });
  }
  return { team, count: team.length };
});
