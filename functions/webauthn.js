// Glide — biometric login (Face ID / Touch ID / Windows Hello) via WebAuthn
// passkeys (S87). Firebase Auth has no native WebAuthn provider, so the flow is:
//
//   SET UP (signed in):  passkeyRegisterOptions → browser creates a passkey
//                        (Face ID prompt) → passkeyRegisterVerify stores the
//                        credential's PUBLIC key.
//   SIGN IN (signed out): passkeyLoginOptions → browser asserts with the passkey
//                        (Face ID prompt) → passkeyLoginVerify checks the
//                        signature against the stored public key and mints a
//                        Firebase CUSTOM TOKEN → the app signs in with it.
//
// Storage (Admin-SDK only — no client rules exist for these collections, so
// clients are denied by default):
//   webauthnCreds/{credentialId}  { uid, publicKey, counter, transports, createdAt }
//   webauthnChallenges/{id}       { challenge, uid|null, createdAt } (one-shot, ~5 min TTL)
//
// Passkeys are BOUND TO THE DOMAIN (rpID): moving to a custom domain later means
// users re-register there (old passkeys keep working on the old domain only).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

// Origins allowed to run the ceremony; rpID is the origin's hostname.
const ALLOWED_ORIGINS = [
  "https://glidna.com",
  "https://calorieiq-jet.vercel.app", // legacy origin — passkeys are domain-bound; users re-register on glidna.com
  "http://localhost:5173", // local dev
];
function rpFromOrigin(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) return null;
  return { rpID: new URL(origin).hostname, origin };
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function saveChallenge(db, challenge, uid) {
  const ref = db.collection("webauthnChallenges").doc();
  await ref.set({ challenge, uid: uid || null, createdAt: Date.now() });
  return ref.id;
}
// One-shot: read + delete. Returns null if missing/expired/uid-mismatched.
async function takeChallenge(db, id, uid) {
  if (!id || typeof id !== "string") return null;
  const ref = db.collection("webauthnChallenges").doc(id);
  const snap = await ref.get();
  await ref.delete().catch(() => {});
  if (!snap.exists) return null;
  const c = snap.data();
  if (Date.now() - (c.createdAt || 0) > CHALLENGE_TTL_MS) return null;
  if ((c.uid || null) !== (uid || null)) return null;
  return c.challenge;
}

// ── Registration (requires a signed-in user) ────────────────────────────────
exports.passkeyRegisterOptions = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first to set up Face ID.");
  const rp = rpFromOrigin(String(request.data && request.data.origin || ""));
  if (!rp) throw new HttpsError("invalid-argument", "Unrecognized app origin.");
  const db = admin.firestore();

  const user = await admin.auth().getUser(uid).catch(() => null);
  const existing = await db.collection("webauthnCreds").where("uid", "==", uid).get();
  const options = await generateRegistrationOptions({
    rpName: "Glide",
    rpID: rp.rpID,
    userName: (user && (user.email || user.displayName)) || uid,
    userDisplayName: (user && user.displayName) || (user && user.email) || "Glide user",
    attestationType: "none",
    // Discoverable credential so sign-in needs NO username — just Face ID.
    // authenticatorAttachment "platform" = the DEVICE'S OWN sensor (Face ID /
    // Touch ID / Windows Hello) — without it browsers also offer QR-code /
    // security-key flows at setup, which confused the first device test.
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
    excludeCredentials: existing.docs.map((d) => ({ id: d.id, transports: d.data().transports || undefined })),
  });
  const challengeId = await saveChallenge(db, options.challenge, uid);
  return { options, challengeId };
});

exports.passkeyRegisterVerify = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const rp = rpFromOrigin(String(request.data && request.data.origin || ""));
  if (!rp) throw new HttpsError("invalid-argument", "Unrecognized app origin.");
  const db = admin.firestore();

  const expectedChallenge = await takeChallenge(db, request.data && request.data.challengeId, uid);
  if (!expectedChallenge) throw new HttpsError("failed-precondition", "That setup attempt expired — try again.");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: request.data && request.data.attResp,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    console.error("passkeyRegisterVerify:", e && e.message);
    throw new HttpsError("invalid-argument", "Couldn't verify that passkey. Try again.");
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpsError("invalid-argument", "Passkey verification failed.");
  }
  const { credential } = verification.registrationInfo;
  await db.collection("webauthnCreds").doc(credential.id).set({
    uid,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter || 0,
    transports: credential.transports || [],
    rpID: rp.rpID,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// ── Sign-in (NO auth — this IS the login) ───────────────────────────────────
exports.passkeyLoginOptions = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const rp = rpFromOrigin(String(request.data && request.data.origin || ""));
  if (!rp) throw new HttpsError("invalid-argument", "Unrecognized app origin.");
  const db = admin.firestore();
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "required", // the biometric IS the factor
  });
  const challengeId = await saveChallenge(db, options.challenge, null);
  return { options, challengeId };
});

exports.passkeyLoginVerify = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const rp = rpFromOrigin(String(request.data && request.data.origin || ""));
  if (!rp) throw new HttpsError("invalid-argument", "Unrecognized app origin.");
  const db = admin.firestore();

  const asseResp = request.data && request.data.asseResp;
  if (!asseResp || typeof asseResp.id !== "string") throw new HttpsError("invalid-argument", "No passkey response.");
  const expectedChallenge = await takeChallenge(db, request.data && request.data.challengeId, null);
  if (!expectedChallenge) throw new HttpsError("failed-precondition", "That sign-in attempt expired — try again.");

  const credSnap = await db.collection("webauthnCreds").doc(asseResp.id).get();
  if (!credSnap.exists) throw new HttpsError("not-found", "No Face ID set up for this device — sign in with your password, then enable it in the menu.");
  const cred = credSnap.data();
  if (cred.rpID && cred.rpID !== rp.rpID) throw new HttpsError("failed-precondition", "This passkey belongs to a different Glide domain.");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: asseResp,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: asseResp.id,
        publicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter || 0,
        transports: cred.transports || undefined,
      },
    });
  } catch (e) {
    console.error("passkeyLoginVerify:", e && e.message);
    throw new HttpsError("permission-denied", "Face ID sign-in failed. Try again or use your password.");
  }
  if (!verification.verified) throw new HttpsError("permission-denied", "Face ID sign-in failed.");

  await credSnap.ref.update({ counter: verification.authenticationInfo.newCounter || 0,
    lastUsedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  const token = await admin.auth().createCustomToken(cred.uid);
  return { token };
});
