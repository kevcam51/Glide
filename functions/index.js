// Glide Cloud Functions
//
// Stage 1 of the Blaze security migration (see docs/BLAZE_MIGRATION.md):
// keep tamper-proof Firebase custom claims in sync with each user's profile
// doc, so server-side functions and (later) the security rules can trust
// `request.auth.token.role` instead of reading the profile on every request.
//
// Custom claims can ONLY be set by this trusted Admin-SDK code — never the
// client — which is what makes role enforcement tamper-proof.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Admin is hardcoded by UID (matches isAdmin() in firestore.rules). The claim
// is derived server-side, so the admin role can never be self-assigned.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];

// The minimal claim set mirrored from a profile doc. Kept small (claims have a
// ~1000-byte budget and every change forces the user's token to refresh).
function claimsFromProfile(uid, data) {
  const role = ADMIN_UIDS.includes(uid) ? "admin" : (data && data.role) || "client";
  return {
    role,
    assignedTrainerId: (data && data.assignedTrainerId) || null,
    headTrainerId: (data && data.headTrainerId) || null,
  };
}

function sameClaims(a, b) {
  if (!a) return false;
  return a.role === b.role
    && (a.assignedTrainerId || null) === (b.assignedTrainerId || null)
    && (a.headTrainerId || null) === (b.headTrainerId || null);
}

// Set claims on a single uid if they differ from what's already on the token.
// Returns "set" | "skip" | "missing" (no matching auth user).
async function applyClaims(uid, profileData) {
  const next = claimsFromProfile(uid, profileData);
  let user;
  try {
    user = await admin.auth().getUser(uid);
  } catch (e) {
    return "missing";
  }
  if (sameClaims(user.customClaims, next)) return "skip";
  await admin.auth().setCustomUserClaims(uid, next);
  return "set";
}

// Keep custom claims in sync whenever a profile doc is created or changes.
// No write-back to the doc (that would re-trigger this) — clients pick up new
// claims by force-refreshing their ID token (handled app-side on load).
exports.syncRoleClaims = onDocumentWritten("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const after = event.data && event.data.after && event.data.after.exists
    ? event.data.after.data() : null;
  if (!after) return; // profile deleted — leave any existing claims untouched
  const result = await applyClaims(uid, after);
  if (result === "set") console.log("syncRoleClaims: updated claims for", uid);
  else if (result === "missing") console.warn("syncRoleClaims: no auth user for", uid);
});

// One-off backfill so every EXISTING user gets claims. Admin-only. Invoke once
// after deploy (see deploy notes), then it can be left in place harmlessly.
exports.backfillRoleClaims = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid || !ADMIN_UIDS.includes(callerUid)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const snap = await admin.firestore().collection("users").get();
  let set = 0, skip = 0, missing = 0;
  for (const doc of snap.docs) {
    const r = await applyClaims(doc.id, doc.data());
    if (r === "set") set++;
    else if (r === "skip") skip++;
    else missing++;
  }
  return { total: snap.size, set, skip, missing };
});
