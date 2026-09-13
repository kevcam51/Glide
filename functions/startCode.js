// Glidna — session start codes: the pure half (S228).
//
// Kevin: "Uber would have a code that would auto generate when a driver was
// about to pick up a client to make sure that the person the uber is picking up
// is correct. We need to add this to our session's and make sure that trainers
// and clients are safe."
//
// ── WHAT IT HONESTLY PROVES ─────────────────────────────────────────────────
// That the person in front of me is holding a phone signed into the other
// party's Glidna account. It is a POSSESSION factor, not an identity factor: a
// code read out over the phone in advance produces an identical stamp. What
// makes the guarantee real is the client withholding the digits until the
// trainer is actually in front of them, which is why the on-screen copy is an
// instruction rather than a claim.
//
// It is worth most where it is needed most: a trainer arriving at an address
// they have never been to, a client opening their door to someone they have
// only messaged, a first session in a gym lobby. On session forty with someone
// you know by face it protects nothing — so it must not nag.
//
// ── WHY THE CODE CANNOT LIVE ON THE SESSION DOCUMENT ────────────────────────
// ⚠️ firestore.rules `sessions/{sid}`: `allow read: if isParticipant()`.
// Firestore read rules are per-DOCUMENT — there is no field-level read control —
// so a `startCode` field there is one console read away from the trainer, who
// could then verify from their car. That is not a weakened feature; it is a
// feature that provably does nothing while telling both people it did
// something. The code lives in `sessionStartCodes/{sessionId}`, a top-level
// collection with NO rules block, which Firestore denies to every client by
// default — the same Admin-SDK-only pattern as calendarFeedTokens,
// mealInboxTokens and webauthnCreds.
//
// ⚠️ AND IT CANNOT TRAVEL IN A NOTIFICATION. A client's whole kv subtree is
// readable by their trainer, and sendPushTo writes the title and body verbatim
// into the client's notification feed BEFORE any preference check — so pushing
// the code would hand it to exactly the person it defends against. This feature
// therefore sends no pushes at all, and does not require ./push. Both people are
// physically together by construction, and both screens are already live on
// subscribeMySessions, so every push here would have been redundant anyway.
//
// This module is deliberately dependency-free — no firebase-admin, no
// firebase-functions — so scripts/test-session-start-code.mjs can require it and
// RUN every rule rather than pattern-match it.

const crypto = require("crypto");

// How early the code appears, and how long after the end it still works.
// Deliberately far tighter than ON_MY_WAY_LEAD_MIN (240): that one is about
// travel, this is a live credential.
const START_CODE_LEAD_MIN = 30;
const START_CODE_GRACE_MIN = 20;
// Per SESSION, ever — not per code and not per window, so a rotation or a
// reschedule cannot farm a fresh budget. 5 in 1,000,000 is 1 in 200,000, and a
// trainer who cannot type six digits in five tries has a different problem.
const MAX_ATTEMPTS = 5;
// Hygiene, not the defence — the cap above is the defence.
const MIN_ATTEMPT_GAP_MS = 1000;
// A record outlives its window by a day so a late arrival is not punished for
// the sweep's timing; the TTL policy on expiresAt reaps the orphans.
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MIN = 60;
const sessionEndMs = (s) => (Number(s && s.startAt) || 0) + (Number(s && s.durationMin) || DEFAULT_MIN) * 60000;

// ⚠️ randomInt, NOT Math.random and NOT randomBytes(4) % 1e6. 2^32 is not a
// multiple of 10^6, so the modulo form is measurably biased toward low codes,
// and there is no reason to accept bias in a credential. randomInt is
// rejection-sampled.
function makeCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// Digits only, so "048 213" typed with the space shown on screen still matches.
const normalizeCode = (v) => String(v == null ? "" : v).replace(/\D/g, "");

// ⚠️ THE LENGTH CHECK MUST COME FIRST. timingSafeEqual THROWS
// "Input buffers must have the same byte length" on unequal lengths, so without
// it a wrong-length guess becomes a 500 instead of a refusal.
function codesMatch(a, b) {
  const x = normalizeCode(a), y = normalizeCode(b);
  if (x.length !== 6 || y.length !== 6) return false;
  return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y));
}

// Is this session inside its code window?
function inStartWindow(session, now) {
  const s = session || {};
  const start = Number(s.startAt) || 0;
  if (!start) return false;
  const t = Number(now) || 0;
  return t >= start - START_CODE_LEAD_MIN * 60000
    && t <= sessionEndMs(s) + START_CODE_GRACE_MIN * 60000;
}

// A record minted for a start time the session no longer has. The server knows
// only "no usable record" and must not assert a cause it cannot know, so this
// is reported as its own state rather than folded into "no code yet".
function staleForStart(rec, session) {
  if (!rec) return false;
  return Number(rec.mintedForStartAt) !== Number(session && session.startAt);
}

const isVerified = (session) => !!(session && session.verify && session.verify.at);

// What the attempt counter says RIGHT NOW.
// ⚠️ IT READS THE SESSION, NOT THE CODE RECORD. The counter lived on the record
// in the first design, and the record is deleted on lockout — so the next fetch
// minted a fresh code with a zeroed counter and handed out five more guesses,
// for ever. On the session it survives deletion, rotation and reschedule.
function attemptVerdict(session, now) {
  const v = (session && session.verify) || {};
  if (v.lockedAt) return { ok: false, reason: "locked" };
  const attempts = Number(v.attempts) || 0;
  if (attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  const last = Number(v.lastAttemptAt) || 0;
  if (last && (Number(now) || 0) - last < MIN_ATTEMPT_GAP_MS) return { ok: false, reason: "too-fast" };
  return { ok: true, attempts };
}

// May this caller see the code for this session?
// ⚠️ ORDER MATTERS: not-found, then ROLE, then cancelled, then window. A
// stranger asking about somebody else's cancelled out-of-window session must be
// told "not yours", never anything that confirms the session exists or when it
// was.
function startCodeDecision(session, uid, now) {
  if (!session) return { ok: false, code: "not-found", message: "That session no longer exists." };
  if (uid !== session.clientUid) {
    return { ok: false, code: "permission-denied",
      message: "Only the client can get the session code." };
  }
  if (session.status === "cancelled") {
    return { ok: false, code: "failed-precondition", message: "That session was cancelled." };
  }
  if (isVerified(session)) {
    return { ok: false, code: "already", message: "This session has already started." };
  }
  if (!inStartWindow(session, now)) {
    return { ok: false, code: "failed-precondition",
      message: `The code appears ${START_CODE_LEAD_MIN} minutes before your session.` };
  }
  return { ok: true };
}

// Same order, same reasoning, for the trainer submitting a code.
function verifyDecision(session, uid, now) {
  if (!session) return { ok: false, code: "not-found", message: "That session no longer exists." };
  if (uid !== session.trainerUid) {
    return { ok: false, code: "permission-denied",
      message: "Only the trainer can start a session with a code." };
  }
  if (session.status === "cancelled") {
    return { ok: false, code: "failed-precondition", message: "That session was cancelled." };
  }
  if (!inStartWindow(session, now)) {
    return { ok: false, code: "failed-precondition",
      message: "That session is outside its start window." };
  }
  return { ok: true };
}

// A fresh record. `rotations` carries across so a rotation is visible.
function remintRecord(session, now, prev) {
  return {
    sessionId: session.id, trainerUid: session.trainerUid, clientUid: session.clientUid,
    code: makeCode(), mintedAt: now, mintedForStartAt: Number(session.startAt) || 0,
    expiresAt: sessionEndMs(session) + START_CODE_GRACE_MIN * 60000 + RECORD_TTL_MS,
    rotations: (prev && Number(prev.rotations) || 0) + (prev ? 1 : 0),
  };
}

// What to write after a WRONG guess.
// ⚠️ ONLY THE KEYS IT MEANS TO CHANGE. A merge writes nested maps recursively,
// so omitted keys survive — which is what we want — but an explicit
// `lockedAt: null` would actively ERASE a lock. Never write a null in here.
function nextVerifyOnMiss(session, now) {
  const attempts = (Number(((session && session.verify) || {}).attempts) || 0) + 1;
  const out = { attempts, lastAttemptAt: Number(now) || 0 };
  if (attempts >= MAX_ATTEMPTS) out.lockedAt = Number(now) || 0;
  return { verify: out, locked: attempts >= MAX_ATTEMPTS, attempts,
    left: Math.max(0, MAX_ATTEMPTS - attempts) };
}

// What to write on success.
// ⚠️ `via` IS LOAD-BEARING AND MUST NEVER BE COLLAPSED. "code" means two devices
// exchanged a secret. "client-tap" means one person asserted it. Those are
// different facts, the UI says which, and only "code" is worth anything as
// evidence in a card dispute.
const verifiedPatch = (uid, now, via) => ({ verify: { at: Number(now) || 0, by: uid, via } });

// What a delivered session can say about itself if the charge is ever disputed.
// Deliberately silent unless a CODE was exchanged: a client tap is the client
// saying so, which proves nothing to a card network, and a session with no
// verification at all must not read as evidence of absence — most sessions will
// never use this feature.
function attendanceEvidence(session) {
  const v = (session && session.verify) || {};
  if (v.via !== "code" || !v.at) return "";
  return `Client confirmed the session start code in-app at ${new Date(Number(v.at)).toISOString()}.`;
}

module.exports = {
  START_CODE_LEAD_MIN, START_CODE_GRACE_MIN, MAX_ATTEMPTS, MIN_ATTEMPT_GAP_MS, RECORD_TTL_MS,
  sessionEndMs, makeCode, normalizeCode, codesMatch, inStartWindow, staleForStart,
  isVerified, attemptVerdict, startCodeDecision, verifyDecision,
  remintRecord, nextVerifyOnMiss, verifiedPatch, attendanceEvidence,
};
