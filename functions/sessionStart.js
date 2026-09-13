// Glidna — session start codes: the two callables (S228).
//
// The rules all live in ./startCode, which has no firebase imports so the test
// suite can require it and RUN them. These two functions are read → pure →
// write shells, deliberately thin.
//
// ⚠️ NO PUSH NOTIFICATIONS, AND THIS FILE MUST NEVER require("./push").
// sendPushTo writes the notification title and body verbatim into the
// recipient's kv feed, and a client's kv is readable by their trainer — so
// pushing a code would hand it to the one person it defends against. Both
// people are physically together by construction and both screens are already
// live on subscribeMySessions, so there is nothing a push would add.
//
// ⚠️ NO firestore.rules CHANGE IS NEEDED, and this is not an oversight.
// `sessionStartCodes` has no rules block, so Firestore denies every client;
// only the Admin SDK reaches it. The `verify` map is written onto the session by
// this server, and it is absent from bookingFields() — exactly the `onMyWay`
// precedent (S202). Every client update rule gates on changed().hasOnly(...),
// and a key nobody edits never appears in that diff, while a client who DID
// touch it would be refused for being on no allowlist.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const S = require("./startCode");

const CODES = "sessionStartCodes";
const region = "us-central1";

const db = () => admin.firestore();
const fail = (d) => { throw new HttpsError(d.code === "already" ? "failed-precondition" : d.code, d.message); };

// ── The CLIENT asks for their code ──────────────────────────────────────────
// Mints on first ask inside the window, returns the same code on every ask
// after that, and re-mints when the session has been moved.
exports.sessionStartCode = onCall({ region }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const sessionId = String((request.data && request.data.sessionId) || "").trim();
  if (!sessionId) throw new HttpsError("invalid-argument", "Which session?");
  const rotate = !!(request.data && request.data.rotate);
  const now = Date.now();

  const sref = db().collection("sessions").doc(sessionId);
  const snap = await sref.get();
  const session = snap.exists ? { id: snap.id, ...snap.data() } : null;
  const d = S.startCodeDecision(session, uid, now);
  if (!d.ok) {
    // "Already started" is a normal answer, not an error the client should see
    // as a failure — their card is about to re-render as confirmed anyway.
    if (d.code === "already") return { ok: false, already: true, verify: session.verify || null };
    fail(d);
  }

  const rref = db().collection(CODES).doc(sessionId);
  const rsnap = await rref.get();
  let rec = rsnap.exists ? rsnap.data() : null;
  // A record minted for a start time the session no longer has is not a code,
  // it is a trap: the client reads it out and the trainer is told it is wrong.
  if (rec && S.staleForStart(rec, session)) rec = null;

  // ⚠️ ROTATION IS REFUSED ONCE LOCKED. Otherwise "get a new code" is a reset
  // button on the attempt cap, which is the whole defence.
  const verdict = S.attemptVerdict(session, now);
  if (rotate && !verdict.ok && verdict.reason === "locked") {
    throw new HttpsError("resource-exhausted",
      "Too many wrong codes were entered for this session. Use the other option to start it.");
  }

  if (!rec || rotate) {
    rec = S.remintRecord(session, now, rec);
    await rref.set(rec);
  }
  return { ok: true, code: rec.code, mintedAt: rec.mintedAt,
    attemptsLeft: Math.max(0, S.MAX_ATTEMPTS - (Number((session.verify || {}).attempts) || 0)),
    locked: !verdict.ok && verdict.reason === "locked" };
});

// ── The TRAINER submits what the client read out ────────────────────────────
exports.verifySessionStart = onCall({ region }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const sessionId = String((request.data && request.data.sessionId) || "").trim();
  if (!sessionId) throw new HttpsError("invalid-argument", "Which session?");
  const now = Date.now();
  const clientTap = !!(request.data && request.data.clientTap);
  const submitted = S.normalizeCode(request.data && request.data.code);

  const sref = db().collection("sessions").doc(sessionId);
  const snap = await sref.get();
  const session = snap.exists ? { id: snap.id, ...snap.data() } : null;

  // The CLIENT may start their own session without a code — the "my trainer is
  // here, my phone is flat, just start it" path. It is recorded as a different
  // kind of fact (via "client-tap") and never counts as evidence.
  if (clientTap) {
    if (!session) fail({ code: "not-found", message: "That session no longer exists." });
    if (uid !== session.clientUid) {
      throw new HttpsError("permission-denied", "Only the client can start a session this way.");
    }
    if (session.status === "cancelled") {
      throw new HttpsError("failed-precondition", "That session was cancelled.");
    }
    if (!S.inStartWindow(session, now)) {
      throw new HttpsError("failed-precondition", "That session is outside its start window.");
    }
    if (S.isVerified(session)) {
      return { ok: true, already: true, at: session.verify.at, via: session.verify.via };
    }
    await sref.set(S.verifiedPatch(uid, now, "client-tap"), { merge: true });
    await db().collection(CODES).doc(sessionId).delete().catch(() => {});
    return { ok: true, at: now, via: "client-tap" };
  }

  const d = S.verifyDecision(session, uid, now);
  if (!d.ok) fail(d);
  // ⚠️ AN IDEMPOTENT RETURN MUST NOT LET ANY CODE "SUCCEED". The trainer's
  // success state renders from the returned `via`, never from "my submit came
  // back ok" — otherwise typing 000000 after a client tap would read as a
  // verified code exchange.
  if (S.isVerified(session)) {
    return { ok: true, already: true, at: session.verify.at, via: session.verify.via };
  }
  if (submitted.length !== 6) throw new HttpsError("invalid-argument", "Enter the six digits.");

  const verdict = S.attemptVerdict(session, now);
  if (!verdict.ok) {
    if (verdict.reason === "too-fast") throw new HttpsError("resource-exhausted", "One moment — try again.");
    throw new HttpsError("resource-exhausted",
      "Too many wrong codes for this session. Ask your client to start it from their own app instead.");
  }

  const rref = db().collection(CODES).doc(sessionId);
  const rsnap = await rref.get();
  const rec = rsnap.exists ? rsnap.data() : null;
  if (!rec) {
    throw new HttpsError("failed-precondition",
      "No code has been generated yet — ask your client to open Glidna.");
  }
  if (S.staleForStart(rec, session)) {
    await rref.delete().catch(() => {});
    throw new HttpsError("failed-precondition",
      "That code is out of date because the session moved — ask your client for the new one.");
  }

  if (!S.codesMatch(rec.code, submitted)) {
    // ⚠️ A MISROUTED CODE MUST NOT SPEND AN ATTEMPT. A 30-minute lead plus a
    // 20-minute grace means an hourly trainer always has two live sessions, so
    // reading the right code into the wrong session is the ordinary mistake,
    // not an attack. ONE equality filter, so this uses the automatic
    // single-field index — no composite index and no deploy.
    const others = await db().collection(CODES).where("trainerUid", "==", uid).limit(20).get();
    for (const o of others.docs) {
      if (o.id !== sessionId && S.codesMatch(o.data().code, submitted)) {
        throw new HttpsError("failed-precondition",
          "That code belongs to a different session — check which client you are starting.");
      }
    }
    const miss = S.nextVerifyOnMiss(session, now);
    await sref.set({ verify: miss.verify }, { merge: true });
    throw new HttpsError("permission-denied", miss.locked
      ? "That code is wrong, and this session is now locked. Ask your client to start it from their own app."
      : `That code is wrong — ${miss.left} ${miss.left === 1 ? "try" : "tries"} left.`);
  }

  await sref.set(S.verifiedPatch(uid, now, "code"), { merge: true });
  await rref.delete().catch(() => {});
  return { ok: true, at: now, via: "code" };
});
