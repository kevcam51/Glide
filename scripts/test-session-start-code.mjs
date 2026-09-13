// Session start codes: Uber's "read me the number" for training sessions (S228).
//
// Kevin: "Uber would have a code that would auto generate when a driver was
// about to pick up a client to make sure that the person the uber is picking up
// is correct. We need to add this to our session's and make sure that trainers
// and clients are safe."
//
// ⚠️ THE SINGLE MOST IMPORTANT PROPERTY, AND THE ONE THE FIRST DESIGN GOT
// WRONG: the attempt counter lives on the SESSION, not on the code record.
// Putting it on the record meant lockout deleted the record, the next client
// fetch minted a fresh code with a zeroed counter, and the trainer got five
// more guesses — for ever. Several assertions below exist only to pin that.
//
// The functions under test are in functions/startCode.js, which has no
// firebase-admin and no firebase-functions import precisely so this file can
// require it and RUN every rule rather than pattern-match it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const require_ = createRequire(import.meta.url);
const S = require_(join(ROOT, "functions", "startCode.js"));

const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const SESSIONS_JS = readFileSync(join(ROOT, "src", "sessions.js"), "utf8");
const STARTCODE = readFileSync(join(ROOT, "functions", "startCode.js"), "utf8");
const SESSIONSTART = readFileSync(join(ROOT, "functions", "sessionStart.js"), "utf8");
const RULES = readFileSync(join(ROOT, "firestore.rules"), "utf8");
const SESSIONS_FN = readFileSync(join(ROOT, "functions", "sessions.js"), "utf8");
const SETTLE = readFileSync(join(ROOT, "functions", "sessionSettle.js"), "utf8");

// ⚠️ ASSERT AGAINST CODE, NOT PROSE. Every file here explains in its comments
// exactly which dangerous thing it avoids — Math.random, sendPushTo,
// require("./push") — so a naive grep for those names matches the explanation
// and reports the defect it was written to rule out. This is the S208 trap, and
// it fired on six assertions in this very suite before the strip was added.
const code = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const T = "trainer-uid", C = "client-uid", X = "stranger-uid";
const START = 1757000000000;
const sess = (over) => ({ id: "s1", trainerUid: T, clientUid: C, participants: [T, C],
  startAt: START, durationMin: 60, status: "scheduled", ...over });
const MIN = 60000;

console.log("\n  Session start codes: possession, not theatre\n");

// ── 1. The code itself ────────────────────────────────────────────────────
{
  const codes = new Set();
  let badShape = 0;
  for (let i = 0; i < 3000; i++) {
    const c = S.makeCode();
    if (!/^\d{6}$/.test(c)) badShape++;
    codes.add(c);
  }
  ok("every code is exactly six digits", badShape === 0, badShape);
  ok("codes are not repeating", codes.size > 2900, codes.size);
  // ⚠️ LEADING ZEROS ARE REAL. Storing this as a number would turn 048213 into
  // 48213 and every such code would be unusable.
  ok("a leading zero survives", S.normalizeCode("048213") === "048213");
  ok("codes are strings", typeof S.makeCode() === "string");
  // randomBytes(4) % 1e6 is biased because 2^32 is not a multiple of 10^6.
  ok("generation is rejection-sampled, not modulo", /randomInt/.test(code(STARTCODE)) && !/randomBytes/.test(code(STARTCODE)));
  ok("Math.random is not used for a credential", !/Math\.random/.test(code(STARTCODE)));
}
{
  ok("the digits people see are grouped for reading aloud", /prettyStartCode/.test(SESSIONS_JS));
  ok("a typed space still matches", S.normalizeCode("048 213") === "048213");
  ok("a typed dash still matches", S.normalizeCode("048-213") === "048213");
  ok("codes match when equal", S.codesMatch("048213", "048 213") === true);
  ok("codes do not match when different", S.codesMatch("048213", "048214") === false);
  // ⚠️ timingSafeEqual THROWS on unequal lengths, so the length check must come
  // FIRST or a short guess becomes a 500 instead of a refusal.
  ok("a short guess is refused, not a crash", S.codesMatch("048213", "0482") === false);
  ok("a long guess is refused, not a crash", S.codesMatch("048213", "04821399") === false);
  ok("an empty guess is refused", S.codesMatch("048213", "") === false);
  ok("null is refused", S.codesMatch("048213", null) === false);
  ok("letters are refused", S.codesMatch("048213", "abcdef") === false);
}

// ── 2. The window ─────────────────────────────────────────────────────────
ok("the code appears 30 minutes early", S.inStartWindow(sess(), START - 30 * MIN) === true);
ok("but not 31 minutes early", S.inStartWindow(sess(), START - 31 * MIN) === false);
ok("it works at the start time", S.inStartWindow(sess(), START) === true);
ok("it works mid-session", S.inStartWindow(sess(), START + 30 * MIN) === true);
// ⚠️ THE GRACE WINDOW IS THE POINT. Every list in the app filters on
// isPastSession (end <= now), so a card mounted behind one of those filters
// vanishes exactly when somebody running late reaches for it.
ok("it still works 20 minutes AFTER the end", S.inStartWindow(sess(), START + 80 * MIN) === true);
ok("but not 21 minutes after", S.inStartWindow(sess(), START + 81 * MIN) === false);
ok("a longer session carries its window with it", S.inStartWindow(sess({ durationMin: 90 }), START + 100 * MIN) === true);
ok("a session with no start time has no window", S.inStartWindow(sess({ startAt: 0 }), START) === false);
ok("no session at all has no window", S.inStartWindow(null, START) === false);

// ── 3. Who may do what, and in what ORDER ────────────────────────────────
ok("the client may fetch the code", S.startCodeDecision(sess(), C, START).ok === true);
ok("the trainer may NOT fetch the code", S.startCodeDecision(sess(), T, START).ok === false);
ok("...and is told it is not theirs", S.startCodeDecision(sess(), T, START).code === "permission-denied");
ok("a stranger may not fetch the code", S.startCodeDecision(sess(), X, START).code === "permission-denied");
ok("the trainer may submit a code", S.verifyDecision(sess(), T, START).ok === true);
ok("the client may not submit a code", S.verifyDecision(sess(), C, START).code === "permission-denied");
ok("a stranger may not submit a code", S.verifyDecision(sess(), X, START).code === "permission-denied");
ok("a cancelled session has no code", S.startCodeDecision(sess({ status: "cancelled" }), C, START).ok === false);
ok("a cancelled session cannot be started", S.verifyDecision(sess({ status: "cancelled" }), T, START).ok === false);
ok("out of window, the client is refused", S.startCodeDecision(sess(), C, START - 120 * MIN).ok === false);
ok("out of window, the trainer is refused", S.verifyDecision(sess(), T, START - 120 * MIN).ok === false);
ok("a missing session is not found", S.startCodeDecision(null, C, START).code === "not-found");
{
  // ⚠️ ROLE BEFORE EVERYTHING ELSE. A stranger asking about someone else's
  // cancelled, out-of-window session must be told "not yours" — never anything
  // that confirms the session exists or when it was.
  const cancelledOld = sess({ status: "cancelled" });
  ok("a stranger learns nothing about a cancelled session",
    S.startCodeDecision(cancelledOld, X, START - 500 * MIN).code === "permission-denied");
  ok("...on the verify side too",
    S.verifyDecision(cancelledOld, X, START - 500 * MIN).code === "permission-denied");
}
ok("an already-started session does not re-issue a code",
  S.startCodeDecision(sess({ verify: { at: START, by: T, via: "code" } }), C, START).code === "already");

// ── 4. Attempts — the counter that survives record deletion ──────────────
ok("a fresh session has all its attempts", S.attemptVerdict(sess(), START).ok === true);
{
  let s = sess();
  const times = [];
  for (let i = 1; i <= S.MAX_ATTEMPTS; i++) {
    const at = START + i * 5000;
    const v = S.attemptVerdict(s, at);
    times.push(v.ok);
    const miss = S.nextVerifyOnMiss(s, at);
    s = { ...s, verify: { ...(s.verify || {}), ...miss.verify } };
  }
  ok("five guesses are allowed", times.every(Boolean), times);
  ok("the sixth is refused", S.attemptVerdict(s, START + 60000).ok === false);
  ok("...as locked", S.attemptVerdict(s, START + 60000).reason === "locked");
  ok("the lock is recorded on the session", !!s.verify.lockedAt);
  ok("the counter reached the cap", s.verify.attempts === S.MAX_ATTEMPTS, s.verify.attempts);
  // ⚠️ THE WHOLE POINT: the record is deleted on lockout, so if the counter
  // lived there the next fetch would mint a fresh code with a zeroed counter and
  // hand out five more guesses, for ever.
  ok("deleting the code record does NOT restore attempts",
    S.attemptVerdict(s, START + 10 * MIN).reason === "locked");
  // A reschedule moves startAt; the lock must ride along.
  ok("rescheduling does NOT restore attempts",
    S.attemptVerdict({ ...s, startAt: START + 86400000 }, START + 86400000).reason === "locked");
}
{
  // ⚠️ NEVER WRITE AN EXPLICIT null INTO verify. A merge writes nested maps
  // recursively, so omitted keys survive — but `lockedAt: null` would ERASE a
  // lock rather than leave it alone.
  const miss = S.nextVerifyOnMiss(sess(), START);
  ok("a miss writes no nulls", Object.values(miss.verify).every((v) => v !== null), miss.verify);
  ok("a miss below the cap does not set a lock", miss.verify.lockedAt === undefined);
  ok("a miss reports how many tries are left", miss.left === S.MAX_ATTEMPTS - 1, miss.left);
  const locked = S.nextVerifyOnMiss(sess({ verify: { attempts: S.MAX_ATTEMPTS - 1 } }), START);
  ok("the last miss sets the lock", typeof locked.verify.lockedAt === "number");
  ok("...and says so", locked.locked === true);
  ok("...with no tries left", locked.left === 0);
  ok("a miss never writes to the booking's updatedAt", !/updatedAt/.test(code(STARTCODE)));
}
// ⚠️ TWO INDEPENDENT GUARDS, SO EACH NEEDS ITS OWN CASE. attemptVerdict refuses
// on `lockedAt` AND on the count, and in the ordinary run they fire together —
// so a test that only exhausts the attempts passes with either one deleted.
// These two isolate them. (This is the repo's standing lesson: a guard that
// exists in two places must be COUNTED in two, not merely found.)
ok("a lock alone is enough, even with the count reset",
  S.attemptVerdict(sess({ verify: { lockedAt: START, attempts: 0 } }), START + MIN).reason === "locked");
ok("an exhausted count alone is enough, even with no lock recorded",
  S.attemptVerdict(sess({ verify: { attempts: S.MAX_ATTEMPTS } }), START + MIN).reason === "locked");
ok("guesses cannot be machine-gunned",
  S.attemptVerdict(sess({ verify: { attempts: 1, lastAttemptAt: START } }), START + 200).reason === "too-fast");
ok("but a second later is fine",
  S.attemptVerdict(sess({ verify: { attempts: 1, lastAttemptAt: START } }), START + 1500).ok === true);
ok("five tries against a million codes is a real bound", S.MAX_ATTEMPTS === 5);

// ── 5. Rotation, staleness, and what `via` means ─────────────────────────
{
  const rec = S.remintRecord(sess(), START, null);
  ok("a fresh record carries the session", rec.sessionId === "s1");
  ok("a fresh record names both parties", rec.trainerUid === T && rec.clientUid === C);
  ok("a fresh record remembers which start it was for", rec.mintedForStartAt === START);
  ok("a fresh record expires", rec.expiresAt > START);
  ok("a first mint is not a rotation", rec.rotations === 0);
  const again = S.remintRecord(sess(), START + 1000, rec);
  ok("a rotation is counted", again.rotations === 1);
  ok("a rotation changes nothing about who it is for", again.clientUid === C);
  // ⚠️ A RECORD MINTED FOR A START THE SESSION NO LONGER HAS IS A TRAP: the
  // client reads it out and the trainer is told it is wrong.
  ok("a record for the old time is stale", S.staleForStart(rec, sess({ startAt: START + 86400000 })) === true);
  ok("a record for the current time is not stale", S.staleForStart(rec, sess()) === false);
  ok("no record is not stale", S.staleForStart(null, sess()) === false);
}
{
  const byCode = S.verifiedPatch(T, START, "code");
  ok("a verified session records when", byCode.verify.at === START);
  ok("a verified session records who", byCode.verify.by === T);
  ok("a verified session records HOW", byCode.verify.via === "code");
  ok("a verified patch writes no nulls", Object.values(byCode.verify).every((v) => v !== null));
  ok("an unverified session reads as unverified", S.isVerified(sess()) === false);
  ok("a verified session reads as verified", S.isVerified({ ...sess(), ...byCode }) === true);
  ok("a session with an empty verify map is not verified", S.isVerified(sess({ verify: {} })) === false);
}

// ── 6. Billing — evidence, never a gate ──────────────────────────────────
// A gate would invert the safety incentive: the trainer would want the code
// more than the client and would start collecting it in advance by text, which
// is the exact fraud it exists to prevent.
ok("a code exchange is worth something in a dispute",
  S.attendanceEvidence({ verify: { at: START, via: "code" } }).includes("confirmed"));
// ⚠️ A CLIENT TAP IS THE CLIENT SAYING SO. It proves nothing to a card network
// and must never be dressed up as evidence.
ok("a client tap is NOT evidence", S.attendanceEvidence({ verify: { at: START, via: "client-tap" } }) === "");
ok("no verification is not evidence of absence", S.attendanceEvidence(sess()) === "");
ok("a junk session yields no evidence", S.attendanceEvidence(null) === "");
// The gate that must NOT exist, checked at both places it could hide.
ok("the completion sweep knows nothing about verification", !/\bverify\b/.test(code(SESSIONS_FN)));
{
  const classify = SETTLE.slice(SETTLE.indexOf("function classifyForBilling"));
  const body = classify.slice(0, classify.indexOf("\n}\n") + 2);
  ok("billing classification knows nothing about verification", !/verify/.test(body));
}
ok("evidence is attached where a delivered session is billed", /evidence: attendanceEvidence\(s\)/.test(SETTLE));

// ── 7. The leak this feature must not open ───────────────────────────────
// ⚠️ A CLIENT'S kv IS READABLE BY THEIR TRAINER, and sendPushTo writes the
// notification body verbatim into that feed BEFORE any preference check — so a
// pushed code would be handed to the one person it defends against.
ok("the code path sends no pushes", !/require\(["']\.\/push["']\)/.test(code(SESSIONSTART)));
ok("...and never calls sendPushTo", !/sendPushTo/.test(code(SESSIONSTART)));
ok("the pure module sends no pushes either", !/sendPushTo|require\(["']\.\/push["']\)/.test(code(STARTCODE)));
// ⚠️ AND THE CODE IS NOT ON THE SESSION DOCUMENT. Firestore read rules are
// per-document, so a `code` field there is one console read from the trainer.
// Anchored to the DECLARATION, not to the name: `sessionStartCodes` appears in
// several places, so a bare match stays green when one of them is broken.
ok("the code lives in its own collection", /const CODES = "sessionStartCodes";/.test(code(SESSIONSTART)));
ok("...and every code read goes through that one name",
  (code(SESSIONSTART).match(/collection\(CODES\)/g) || []).length >= 3,
  (code(SESSIONSTART).match(/collection\(CODES\)/g) || []).length);
ok("sessionStartCodes has NO rules block — Admin SDK only", !/sessionStartCodes/.test(RULES));
{
  // The onMyWay precedent: a server-written field absent from bookingFields()
  // needs no rules change, because changed() only sees keys a client edited.
  const bf = RULES.slice(RULES.indexOf("function bookingFields()"));
  const list = bf.slice(0, bf.indexOf("}"));
  ok("verify is not a client-writable booking field", !/verify/.test(list));
  ok("...and neither is anything code-shaped", !/startCode/.test(list));
}
ok("the client API never receives the code from the session doc", !/s\.startCode|session\.code/.test(code(APP)));

// ── 8. The client and the server must agree on the window ───────────────
{
  const num = (src, name) => {
    const m = src.match(new RegExp(name + "\\s*=\\s*(\\d+)"));
    return m ? Number(m[1]) : null;
  };
  ok("the lead time matches the server",
    num(SESSIONS_JS, "START_CODE_LEAD_MIN") === S.START_CODE_LEAD_MIN,
    { app: num(SESSIONS_JS, "START_CODE_LEAD_MIN"), server: S.START_CODE_LEAD_MIN });
  ok("the grace time matches the server",
    num(SESSIONS_JS, "START_CODE_GRACE_MIN") === S.START_CODE_GRACE_MIN,
    { app: num(SESSIONS_JS, "START_CODE_GRACE_MIN"), server: S.START_CODE_GRACE_MIN });
}
{
  // ⚠️ AND THE CLIENT PREDICATE IS NOT `!isPastSession`. Run the app's own
  // canShowStartCode against the server's window across the whole span.
  const canShow = new Function("SESSION_DEFAULT_MIN", "START_CODE_LEAD_MIN", "START_CODE_GRACE_MIN",
    "startCodeState",
    SESSIONS_JS.slice(SESSIONS_JS.indexOf("export function canShowStartCode"))
      .slice(0, SESSIONS_JS.slice(SESSIONS_JS.indexOf("export function canShowStartCode")).indexOf("\n}\n") + 2)
      .replace("export function", "function")
    + "\nreturn canShowStartCode;")(60, S.START_CODE_LEAD_MIN, S.START_CODE_GRACE_MIN,
      (s) => ({ verified: !!(s && s.verify && s.verify.at) }));
  let drift = 0;
  for (let m = -200; m <= 200; m++) {
    const t = START + m * MIN;
    if (canShow(sess(), t) !== S.inStartWindow(sess(), t)) drift++;
  }
  ok("the app and the server open the same window", drift === 0, drift);
  ok("a verified session offers no code", canShow(sess({ verify: { at: START } }), START) === false);
  ok("a cancelled session offers no code", canShow(sess({ status: "cancelled" }), START) === false);
  // The grace window is reachable from the app side too — this is the exact
  // case a `past` guard would have silently removed.
  ok("the app still offers the code after the session ended", canShow(sess(), START + 70 * MIN) === true);
}

// ── 9. Where it is mounted ──────────────────────────────────────────────
// Count CALL SITES. A card that exists but is never rendered is not a feature.
{
  const mounts = (APP.match(/<SessionStartCode /g) || []).length;
  ok("the card is mounted on every session surface", mounts >= 4, mounts);
  // ⚠️ NOT BEHIND A `past` GUARD. The sweep above compares the window to
  // itself and is structurally blind to a mount that never renders.
  ok("the panel mount is not gated on past",
    /\{!opts\.cancelled && \(\s*<SessionStartCode/.test(APP));
  ok("the calendar mount is not gated on past",
    /\{s\.status !== "cancelled" && \(\s*<SessionStartCode/.test(APP));
  ok("the client home uses its own grace-aware session, not nextSession",
    /startCodeSession && \(/.test(APP) && /canShowStartCode\(s, codeNow\)/.test(APP));
  ok("the trainer sees exactly one session at a time",
    (APP.match(/\.sort\(\(a, b\) => Math\.abs\(a\.startAt - codeNow\) - Math\.abs\(b\.startAt - codeNow\)\)\[0\]/g) || []).length === 2);
}
ok("the trainer's success state reads `via`, not its own return", /const via = r && r\.data && r\.data\.via/.test(APP));
ok("the client's fetch is keyed on the start time, not just mount", /s && s\.startAt\]/.test(APP));
ok("a misrouted code is named rather than counted", /belongs to a different session/.test(SESSIONSTART));
ok("the misroute lookup uses one equality filter — no composite index",
  /where\("trainerUid", "==", uid\)\.limit\(20\)/.test(SESSIONSTART));
ok("rotation is refused once locked", /rotate && !verdict\.ok/.test(SESSIONSTART));
ok("the copy is an instruction, not a guarantee", /Read this to/.test(code(APP)) && !/proves you/.test(code(APP)));
ok("the client can see their session was started", /confirmed your code at/.test(APP));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  A code proves possession — and says so, rather than promising more.\n");
process.exit(fails ? 1 : 0);
