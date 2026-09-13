// "My trainer didn't show up" — the client's half of a no-show (S211).
//
// `noShow` has always been the TRAINER saying the CLIENT was absent. There was
// no counterpart, so the one absence a client could do nothing about was the
// one they paid full price for: the completion sweep stamps `completedAt`
// whether or not anybody turned up, and a delivered session bills.
//
// WHAT THIS FEATURE PROMISES, and therefore what has to stay true:
//
//   1. AN OPEN REPORT IS NEVER BILLED. classifyForBilling must return
//      "disputed", and runSettle must skip it WITHOUT stamping `settled` —
//      stamping it would make the session unbillable forever, which is the
//      opposite of a hold.
//   2. IT HOLDS, IT DOES NOT ZERO. The client's word alone must never settle
//      the money, or the button is free training. Only the trainer's waive
//      (agreed) or `trainerNoShowDenied` ("I was there") resolves it.
//   3. THE APP AND THE SERVER AGREE ON WHEN IT IS HELD, guard order included.
//      A copy that checked only the two report fields would tell a trainer
//      their money was held on a session that was already waived or that they
//      cancelled themselves.
//   4. THE APP AND THE RULES AGREE ON WHO MAY REPORT, AND WHEN. A button that
//      offers a write firestore.rules will refuse is a dead tap; a rule looser
//      than the button is a hole.
//   5. BOTH SIDES ARE TOLD. A held charge the trainer never hears about is
//      money that silently stops; an answer the client never hears about is a
//      charge that arrives out of nowhere.
//
// Every predicate below is LIFTED FROM THE SHIPPING SOURCE AND RUN, then
// mutated to prove this file can see the bug it guards. A regex against the
// source passes just as happily against `if (false)`.
//
// Run: node scripts/test-trainer-no-show.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { stripComments, stripJsxComments } from "./lib/strip-comments.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTLE = readFileSync(join(ROOT, "functions", "sessionSettle.js"), "utf8");
const SESSIONS = readFileSync(join(ROOT, "src", "sessions.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const RULES = readFileSync(join(ROOT, "firestore.rules"), "utf8");
const AUDIT = require(join(ROOT, "functions", "sessionAudit.js"));

// Prose that names the thing it forbids has failed three checks in this repo.
const codeOnly = (src) => stripJsxComments(src);
const APP_CODE = codeOnly(APP);

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── lift the two decisions, from two different files ────────────────────────
function liftFn(src, name) {
  const m = src.match(new RegExp(`\\n(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0].replace(/\nexport /, "\n");
}
function liftConst(src, name) {
  const m = src.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0].replace(/^export /, "");
}
const buildClassify = (body) => new Function(`${body}; return classifyForBilling;`)();
const classifyForBilling = buildClassify(liftFn(SETTLE, "classifyForBilling"));

const appPure = new Function(`
  ${liftConst(SESSIONS, "trainerNoShowHoldsBilling")}
  ${liftFn(SESSIONS, "canReportTrainerNoShow")}
  ${liftFn(SESSIONS, "trainerNoShowState")}
  return { trainerNoShowHoldsBilling, canReportTrainerNoShow, trainerNoShowState };
`)();
const { trainerNoShowHoldsBilling, canReportTrainerNoShow, trainerNoShowState } = appPure;

const NOW = Date.UTC(2026, 8, 7, 15, 0);
const HOUR = 3600000;
// A delivered, priced, unsettled session — the shape this whole feature is about.
const S = (over = {}) => ({
  id: "s1", trainerUid: "t1", clientUid: "c1", participants: ["t1", "c1"],
  startAt: NOW - 2 * HOUR, durationMin: 60, status: "scheduled",
  priceCents: 8500, billableCents: 8500, completedAt: NOW - HOUR, ...over,
});

// ── 1. an open report is never billed ───────────────────────────────────────
ok("a plain delivered session still bills (regression)", classifyForBilling(S()) === "session");
ok("an open report is DISPUTED, not billable", classifyForBilling(S({ trainerNoShow: true })) === "disputed");
ok("...and 'disputed' is not one of the billable kinds",
   !["session", "cancel"].includes(classifyForBilling(S({ trainerNoShow: true }))));

// ── 2. it holds; only the trainer resolves it ───────────────────────────────
ok("the trainer saying 'I was there' releases it", classifyForBilling(S({ trainerNoShow: true, trainerNoShowDenied: true })) === "session");
ok("the trainer agreeing (a waive) settles it as waived", classifyForBilling(S({ trainerNoShow: true, waived: true })) === "waived");
// The client marking it does not, on its own, zero anything: "disputed" is a
// hold. If this ever returns "waived" the button has become free training.
ok("a report alone never settles the money", classifyForBilling(S({ trainerNoShow: true })) !== "waived");
// Both people claiming the other was absent is a real disagreement, and a
// disagreement is exactly what must not auto-charge.
ok("client-no-show + trainer-no-show = held, not billed at the no-show rate",
   classifyForBilling(S({ noShow: true, trainerNoShow: true })) === "disputed");
// A session the trainer cancelled is already free. Calling it disputed would
// put an item in the held count that nothing can ever resolve.
ok("a trainer-cancelled session stays free, not disputed",
   classifyForBilling(S({ status: "cancelled", cancelledBy: "t1", cancelledAt: NOW - 5 * HOUR, completedAt: null, trainerNoShow: true })) === null);
// A waive is checked before everything: the trainer has already said "no
// charge", and there is nothing left to hold.
ok("a waive outranks an open report",
   classifyForBilling(S({ waived: true, trainerNoShow: true })) === "waived");

// ── 3. the app's copy of that decision agrees, guard order included ──────────
{
  const disagreements = [];
  for (const trainerNoShow of [true, false, undefined]) {
    for (const trainerNoShowDenied of [true, false, undefined]) {
      for (const waived of [true, false, undefined]) {
        for (const cancel of [null, "t1", "c1"]) {
          const s = S({
            trainerNoShow, trainerNoShowDenied, waived,
            ...(cancel ? { status: "cancelled", cancelledBy: cancel, cancelledAt: NOW - 5 * HOUR, completedAt: null } : {}),
          });
          const server = classifyForBilling(s) === "disputed";
          const app = trainerNoShowHoldsBilling(s);
          if (server !== app) disagreements.push({ trainerNoShow, trainerNoShowDenied, waived, cancel, server, app });
        }
      }
    }
  }
  ok("app and server agree on every shape about what is held", disagreements.length === 0, disagreements.slice(0, 4));
}
ok("the state a screen shows: open", trainerNoShowState(S({ trainerNoShow: true })) === "open");
ok("the state a screen shows: denied", trainerNoShowState(S({ trainerNoShow: true, trainerNoShowDenied: true })) === "denied");
ok("the state a screen shows: waived", trainerNoShowState(S({ trainerNoShow: true, waived: true })) === "waived");
ok("no report is not a state", trainerNoShowState(S()) === null);
ok("a waive with no report is not a trainer-no-show", trainerNoShowState(S({ waived: true })) === null);

// ── 4. who may report, and when — the app and the rules on the same bounds ───
ok("the client may report their own delivered session", canReportTrainerNoShow(S(), "c1", NOW));
ok("the TRAINER may not file it against themselves", !canReportTrainerNoShow(S(), "t1", NOW));
ok("a stranger may not", !canReportTrainerNoShow(S(), "x9", NOW));
ok("signed out may not", !canReportTrainerNoShow(S(), "", NOW));
// A claim about a session that hasn't started is not a claim about anything.
ok("not before it starts", !canReportTrainerNoShow(S({ startAt: NOW + HOUR, completedAt: null }), "c1", NOW));
ok("at the start time, yes", canReportTrainerNoShow(S({ startAt: NOW, completedAt: null }), "c1", NOW));
ok("not on a cancelled session — nobody was due to show", !canReportTrainerNoShow(S({ status: "cancelled" }), "c1", NOW));
// Once the money has moved a flag changes nothing; the app says "message them".
ok("not once it is settled", !canReportTrainerNoShow(S({ settled: "charged" }), "c1", NOW));
ok("not once it is settled as free either", !canReportTrainerNoShow(S({ settled: "free" }), "c1", NOW));
ok("missing session is not reportable", !canReportTrainerNoShow(null, "c1", NOW));
// ⚠️ THE LOOP THAT MUST NOT EXIST. Withdraw-and-re-file after a denial would
// re-freeze the charge every time, so a session could never be billed: report →
// "I was there" → withdraw → report. One round in the app; after that it is a
// conversation, not a flag.
ok("no re-filing once the trainer has answered",
   !canReportTrainerNoShow(S({ trainerNoShowDenied: true }), "c1", NOW));
ok("...not even after withdrawing the first one",
   !canReportTrainerNoShow(S({ trainerNoShow: false, trainerNoShowDenied: true }), "c1", NOW));

// The rules must carry the SAME four bounds. The emulator suite proves they
// work; this proves nobody removed one while leaving the button on screen.
// ⚠️ COMMENTS OUT FIRST. Slicing to the next ";" cut the rule in half the
// moment a comment inside it contained one ("one round in the app; after
// that…"), and the check below went red on a correct file — the same trap
// codeOnly() exists for elsewhere in this repo.
const RULES_CODE = RULES.replace(/\/\/[^\n]*/g, "");
const clientReportRule = (() => {
  const i = RULES_CODE.indexOf("changed().hasOnly(clientReportFields())");
  return i < 0 ? "" : RULES_CODE.slice(i, RULES_CODE.indexOf(";", i));
})();
ok("the rules have a client report rule at all", clientReportRule.length > 0);
ok("rules: pinned to the client", /request\.auth\.uid == resource\.data\.clientUid/.test(RULES_CODE.slice(RULES_CODE.indexOf("clientReportFields()"))));
ok("rules: not on a cancelled session", clientReportRule.includes("resource.data.get('status', '') != 'cancelled'"));
ok("rules: only after it has started", clientReportRule.includes("resource.data.get('startAt', 0) <= request.time.toMillis()"));
ok("rules: never once settled", clientReportRule.includes("!('settled' in resource.data)"));
ok("rules: never once the trainer has answered", clientReportRule.includes("resource.data.get('trainerNoShowDenied', false) != true"));
// ⚠️ hasOnly ALONE IS NOT ENOUGH. It passed any write whose only real change
// was `updatedAt` — which made the long-standing "CLIENT waives their own
// session" emulator assertion start SUCCEEDING, because its fixture was
// already waived. The rule must demand that the report itself moves.
ok("rules: the write must actually change the report", clientReportRule.includes("changed().hasAny(['trainerNoShow'])"));
ok("rules: the report's own timestamp is pinned to server time", clientReportRule.includes("reportStampHonest()"));
// The trainer must not be able to edit or delete the claim being made against
// them, so the client's fields stay out of bookingFields().
const bookingFields = (RULES.match(/function bookingFields\(\)[\s\S]*?\n      \}/) || [""])[0];
ok("bookingFields carries the trainer's ANSWER", bookingFields.includes("'trainerNoShowDenied'"));
for (const f of ["'trainerNoShow'", "'trainerNoShowAt'", "'trainerNoShowNote'"]) {
  ok(`bookingFields does NOT let the trainer write ${f}`, !bookingFields.includes(f));
}
ok("a booking can't be born already denied",
   RULES.includes("request.resource.data.get('trainerNoShowDenied', false) == false"));
// `startAtHistory` is the audit trail; neither participant may write it.
ok("the reschedule trail is not client-writable", !bookingFields.includes("startAtHistory"));

// ── 5. runSettle must SKIP the hold without settling it ─────────────────────
// A source check, deliberately narrow: the loop it lives in is bound to
// Firestore and can't be lifted, but the one thing that would silently break
// the feature is a `settled` stamp sneaking into this branch — which would make
// the session unbillable forever the moment the trainer answered.
{
  const i = SETTLE.indexOf('if (kind === "disputed")');
  ok("runSettle handles the disputed kind", i > 0);
  const branch = SETTLE.slice(i, SETTLE.indexOf("\n", SETTLE.indexOf("}", i)));
  ok("...and never writes `settled` for it", !branch.includes("settled"), branch);
  ok("...and counts it, so a growing hold is visible", /disputed\+\+/.test(branch));
  ok("the count reaches the log", /disputed.*unanswered trainer-no-show/.test(SETTLE));
}
// ⚠️ AND THE CLAIM MUST RE-JUDGE, NOT JUST RE-READ. The candidate scan runs
// minutes before the charge; a report filed in that gap was honoured by the
// scan and then overridden by a claim that only asked whether `settled` was
// set. The transaction re-reads each session anyway — it now re-classifies it.
{
  const i = SETTLE.indexOf("const live = billable.filter(");
  ok("the claim re-reads each session", i > 0);
  const filter = SETTLE.slice(i, i + 420);
  ok("...and re-judges it with the SAME function the scan used", filter.includes("classifyForBilling(d)"));
  ok("...keeping only what is still billable", /k === "session" \|\| k === "cancel"/.test(filter));
}

// ── 6. both sides are told ──────────────────────────────────────────────────
const N = (before, after) => AUDIT.noShowNotice(before, after);
const doc = (over = {}) => ({ trainerUid: "t1", clientUid: "c1", startAt: NOW - 2 * HOUR, ...over });
ok("filing tells the TRAINER", JSON.stringify(N(doc(), doc({ trainerNoShow: true }))) === JSON.stringify({ kind: "reported", to: "trainer" }));
ok("withdrawing tells the trainer too", JSON.stringify(N(doc({ trainerNoShow: true }), doc())) === JSON.stringify({ kind: "withdrawn", to: "trainer" }));
ok("'I was there' tells the CLIENT — before the charge, not as it",
   JSON.stringify(N(doc({ trainerNoShow: true }), doc({ trainerNoShow: true, trainerNoShowDenied: true }))) === JSON.stringify({ kind: "denied", to: "client" }));
ok("agreeing tells the client the session is free",
   JSON.stringify(N(doc({ trainerNoShow: true }), doc({ trainerNoShow: true, waived: true }))) === JSON.stringify({ kind: "confirmed", to: "client" }));
// The quiet paths. This trigger sees EVERY write to every session — the
// completion sweep, the settle engine, a reschedule — so silence is the
// common case and a chatty branch here is a notification storm.
ok("an ordinary waive, with no report, says nothing", N(doc(), doc({ waived: true })) === null);
ok("the completion stamp says nothing", N(doc(), doc({ completedAt: NOW })) === null);
ok("a billing write on a denied report says nothing again",
   N(doc({ trainerNoShow: true, trainerNoShowDenied: true }), doc({ trainerNoShow: true, trainerNoShowDenied: true, settled: "charged" })) === null);
ok("a deleted session says nothing", N(doc({ trainerNoShow: true }), null) === null);
ok("a malformed doc says nothing", N(null, { trainerNoShow: true }) === null);
ok("a create that somehow arrives reported still reaches the trainer",
   (N(null, doc({ trainerNoShow: true })) || {}).kind === "reported");
// Re-filing after a withdrawal is a new thing to hear about, not a repeat.
ok("re-filing notifies again", (N(doc({ trainerNoShow: false }), doc({ trainerNoShow: true })) || {}).kind === "reported");

// ── 7. the screens ──────────────────────────────────────────────────────────
// A promise this button cannot keep is the failure that matters here: the
// report holds a charge, it does not cancel one, and the copy must not say it
// does.

ok("the offer is gated by the shared predicate, not a hand-rolled condition",
   /canReportTrainerNoShow\(s, meUid, now\)/.test(APP_CODE));
// Two uses of one predicate: the button, and the "message them instead" line
// that stands where the button can't. Neither state may render nothing.
ok("the fallback copy is driven by the same predicate",
   (APP_CODE.match(/canReportTrainerNoShow\(s, meUid, now\)/g) || []).length === 2);
// ⚠️ COUNTED, NOT FOUND. The trainer answers from TWO screens — the Sessions
// panel and the calendar's session sheet — and a control present on one of them
// is a control half the trainers never find. `.includes()` would have stayed
// green with either copy deleted, which is the exact trap S208 paid for three
// times and S210 audited fourteen of.
const count = (needle) => (APP_CODE.split(needle).length - 1);
ok("the trainer can agree, from BOTH screens", count("They're right — no charge") === 2, count("They're right — no charge"));
ok("the trainer can disagree, from BOTH screens", count("I was there — bill it") === 2, count("I was there — bill it"));
ok("the trainer can change their mind, from both", count("Waive it after all") === 2, count("Waive it after all"));
// The client's two controls live on their Sessions panel only — the calendar is
// a trainer screen — so one occurrence is right here, and asserting the count
// says so out loud rather than leaving it to a reader to wonder.
ok("the client can withdraw", count("I got it wrong — withdraw") === 1);
ok("...and the report itself is offered once", count("My trainer didn&apos;t show up") === 1);
ok("the copy says HELD, never 'you won't be charged'",
   APP_CODE.includes("won't be billed until they answer") || APP_CODE.includes("won&apos;t be billed until they answer"));
ok("no screen promises the client a refund it cannot make",
   !/you won't be charged/i.test(APP_CODE));
// The calendar decides its own label; it must not go on saying "will be billed"
// about a session nothing is going to bill.
{
  const at = APP_CODE.indexOf("function calBillingState");
  ok("found calBillingState", at > 0);
  ok("the calendar's billing label knows about the dispute",
     at > 0 && /trainerNoShowState\(s\)/.test(APP_CODE.slice(at, at + 1400)));
}

// ── 8. negative controls — can this file see the bugs it guards? ────────────
// Every guard above is re-run against a deliberately broken copy, and a control
// that stays green is a control that proves nothing.
{
  const red = (label, body) => {
    let saw = false;
    try {
      const c = buildClassify(body);
      // the four claims that matter
      if (c(S({ trainerNoShow: true })) !== "disputed") saw = true;
      if (c(S({ trainerNoShow: true, trainerNoShowDenied: true })) !== "session") saw = true;
      if (c(S()) !== "session") saw = true;
    } catch { saw = true; }
    ok(`control: ${label} is caught`, saw);
  };
  const real = liftFn(SETTLE, "classifyForBilling");
  red("the guard removed entirely", real.replace(/\n  if \(v\.trainerNoShow === true[^\n]*\n/, "\n"));
  red("the guard disarmed (`if (false)`)", real.replace(/if \(v\.trainerNoShow === true && v\.trainerNoShowDenied !== true\)/, "if (false)"));
  red("the denial ignored, so it can never be released",
      real.replace(/&& v\.trainerNoShowDenied !== true/, ""));
  red("a truthy check instead of `=== true`, so any value holds the money",
      real.replace(/v\.trainerNoShow === true/, "!!v.trainerNoShow ").replace(/return "disputed";/, 'return "waived";'));
}
{
  // And the same for the app's mirror: drop the waive guard and the two must
  // disagree somewhere.
  const broken = new Function(`
    const trainerNoShowHoldsBilling = (s) => !!s && s.trainerNoShow === true && s.trainerNoShowDenied !== true;
    return trainerNoShowHoldsBilling;`)();
  let sawDrift = false;
  for (const s of [S({ waived: true, trainerNoShow: true }),
    S({ status: "cancelled", cancelledBy: "t1", cancelledAt: NOW - 5 * HOUR, completedAt: null, trainerNoShow: true })]) {
    if (broken(s) !== (classifyForBilling(s) === "disputed")) sawDrift = true;
  }
  ok("control: a mirror missing the waive/cancel guards is caught", sawDrift);
}
{
  // A notice function that fires on every waive would push the client a
  // "no charge" message for sessions nobody disputed.
  const chatty = (before, after) => (before && before.waived !== true && after && after.waived === true)
    ? { kind: "confirmed", to: "client" } : null;
  ok("control: a notice that fires on any waive is caught",
     chatty(doc(), doc({ waived: true })) !== null && N(doc(), doc({ waived: true })) === null);
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  Trainer no-show reports: held, resolvable, and announced both ways.\n");
