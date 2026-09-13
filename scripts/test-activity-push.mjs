// The activity-level drift nudge, end to end (S229b).
//
// Kevin asked for a notification recommending a change when someone's movement
// shifts. The first design of it had three faults that would each have made it
// useless, and this suite exists to keep them fixed:
//
//   1. THE PASS WAS CLIENT-ONLY. `if (prof.role !== "client") continue` — so a
//      head_trainer, i.e. the one person who asked for the feature, could never
//      receive it.
//   2. IT READ THE WRONG PLAN. It resolved caliq-plans.active, the CLIENT
//      convention; a trainer's own watch-only Trainerize link writes into the
//      plan they PICKED, and functions/trainerize.js says so where it writes
//      them. The pass would have read a plan with no step data and concluded,
//      silently, that there was nothing to say.
//   3. A TAP DEAD-ENDED. Every destination that was not sessions/card sent a
//      trainer to the roster screen — which is not where the card is.
//
// ⚠️ AND THE FOURTH DECISION, WHICH IS WHY THERE IS NO MIRROR HERE: the app
// records what its own step logic found (`data.activityDrift`) and the server
// only DELIVERS it. Recomputing server-side would have been a second copy of
// five functions plus the ladder. It also makes a false push impossible — the
// notification can only describe a proposal the app actually made.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripJsxComments } from "./lib/strip-comments.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const PUSH = readFileSync(join(ROOT, "functions", "push.js"), "utf8");
const INDEX = readFileSync(join(ROOT, "functions", "index.js"), "utf8");
const TZ = readFileSync(join(ROOT, "functions", "trainerize.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };
const code = (src) => stripJsxComments(src);
const P = code(PUSH), A = code(APP);

console.log("\n  The activity-drift nudge: it reaches someone, and somewhere\n");

// ── 1. The two numbers that must not drift ────────────────────────────────
{
  const app = APP.match(/ACTIVITY_COOLDOWN_DAYS\s*=\s*(\d+)/);
  const push = PUSH.match(/ACTIVITY_COOLDOWN_DAYS_PUSH\s*=\s*(\d+)/);
  ok("the app has an answer cooldown", !!app);
  ok("the push has one too", !!push);
  // ⚠️ A PUSH ON A DIFFERENT NUMBER ASKS ABOUT A QUESTION THE CARD HAS CLOSED.
  ok("they are the same number", app && push && app[1] === push[1], { app: app && app[1], push: push && push[1] });
}

// ── 2. The pass reaches the person who asked ──────────────────────────────
// ⚠️ THE DEFAULT MUST STILL BE CLIENTS ONLY. The food and weigh-in passes pass
// no options; widening the default would start pushing those at trainers.
ok("the default is still clients only", /const CLIENTS_ONLY = \["client"\];/.test(P));
ok("the pass takes its roles from options", /const roles = o\.roles \|\| CLIENTS_ONLY;/.test(P));
ok("...and filters on them", /if \(!roles\.includes\(prof\.role\)\)/.test(P));
ok("the old hard-coded client gate is gone", !/prof\.role !== "client"/.test(P));
{
  const pass = P.slice(P.indexOf("exports.activityDriftPush"));
  ok("the activity pass includes trainers",
    /roles: \["client", "head_trainer", "sub_trainer"\]/.test(pass), pass.slice(0, 0));
  ok("...and clients", /roles: \["client"/.test(pass));
}
// The two existing passes must be untouched by the widening.
ok("the food pass did not opt into anything", (() => {
  const s = P.slice(P.indexOf("exports.foodReminderPush"));
  return !/roles:/.test(s.slice(0, s.indexOf("exports.", 10) === -1 ? s.length : s.indexOf("exports.", 10)));
})());

// ── 3. It reads the plan the steps are actually in ────────────────────────
ok("the pass can be given plan candidates", /o\.plansFor \? await o\.plansFor\(/.test(P));
ok("the default is still the manifest's active plan", /: \[active\];/.test(P));
ok("the activity pass supplies candidates", /plansFor: \(uid, active\) => activityPlanCandidates\(/.test(P));
{
  const fn = P.slice(P.indexOf("async function activityPlanCandidates"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
  ok("candidates start with the active plan", /const out = \[active\];/.test(body));
  // ⚠️ THE WATCH-ONLY LINK IS THE WHOLE POINT — it is where a trainer's own
  // step data goes, and functions/trainerize.js writes it there deliberately.
  ok("...and add the watch-only linked plan", /l\.healthOnly/.test(body) && /l\.planId/.test(body));
  ok("...only the recipient's own link", /l\.uid !== uid/.test(body));
  ok("...without duplicating the active plan", /!out\.includes\(l\.planId\)/.test(body));
  ok("a missing links doc is the ordinary case, not an error", /catch \(e\) \{/.test(body));
}
// The claim this design rests on, checked against the file that writes it.
ok("trainerize really does write watch data to the picked plan",
  /const healthPlanId = \(link && link\.planId\) \|\| clientPlanId;/.test(TZ));

// ── 4. It delivers a proposal; it does not invent one ─────────────────────
{
  const pass = P.slice(P.indexOf("exports.activityDriftPush"));
  ok("it reads what the app recorded", /const drift = d\.activityDrift;/.test(pass));
  // ⚠️ NO SECOND COPY OF THE STEP LOGIC ON THE SERVER.
  ok("it does not recompute the bands", !/parseStepBand|rungForSteps|summariseSteps/.test(P));
  ok("a stale proposal is not pushed", /DRIFT_STALE_DAYS/.test(pass));
  ok("an already-answered question is not re-asked", /d\.activityCheck/.test(pass));
  ok("...on the shared cooldown", /ACTIVITY_COOLDOWN_DAYS_PUSH/.test(pass));
  // If they already moved rung — by accepting elsewhere or editing by hand —
  // the recorded proposal is about a person who no longer exists.
  ok("a rung that already moved cancels it", /d\.activityLevel !== drift\.from/.test(pass));
  ok("the lifter opt-out is honoured server-side too", /d\.activityStepsOff === true/.test(pass));
  ok("a proposal to the same rung is not a proposal", /drift\.to === drift\.from/.test(pass));
  ok("both directions are worded", /steps have gone up/.test(PUSH) && /steps have eased off/.test(PUSH));
  // Down is the one that costs someone food; it must not read as an instruction.
  ok("the downward copy checks rather than commands", /check your calorie target still fits/.test(PUSH));
}

// ── 5. A tap lands on the card, for BOTH roles ────────────────────────────
ok("the tag has a destination", /if \(tag === "activity-drift"\) return "activity";/.test(A));
ok("a client's tap opens their plan", /homeIntent\.kind === "activity"\) openActivePlan\(\)/.test(A));
// ⚠️ THE DEAD END. Every destination that was not sessions/card fell through to
// the roster screen, which is thousands of lines from the card.
ok("a trainer's tap opens the plan it is about", /if \(dest === "activity"\) \{/.test(A));
ok("...using the plan the push carried", /const pid = bootNotifPlanRef\.current;/.test(A));
ok("...and actually opens it", /if \(pid\) \{ selectProfile\(pid\); return; \}/.test(A));
ok("the push carries that plan on the link", /nplan=\$\{encodeURIComponent\(plan\)\}/.test(PUSH));
ok("the app reads it off the url", /p\.get\("nplan"\)/.test(A));
ok("...stashes it at boot", /stashNotifPlan\(\);/.test(A));
ok("...and spends it once", /localStorage\.removeItem\(NOTIF_PLAN_STASH\)/.test(A));

// ── 6. It is switchable, and the switch gates something real ─────────────
ok("the pass is gated on a pref", /runReminderPass\(db, "activityNudges"/.test(P));
{
  // ⚠️ COUNT THE ROWS, NOT THE MENTIONS — the key appears in prose too, and a
  // pref with no row is a toggle nobody can find.
  const rows = (A.match(/key: "activityNudges"/g) || []).length;
  ok("both roles get a Notification Center row", rows === 2, rows);
}
ok("the row says what it is for", /When your steps say your activity level should change/.test(APP));
ok("the function is exported", /exports\.activityDriftPush = require\("\.\/push"\)\.activityDriftPush;/.test(INDEX));
ok("it is scheduled, not on every request", /schedule: "0 9 \* \* 3"/.test(P));
ok("...in the same timezone as the other nudges", /timeZone: "America\/New_York"/.test(P));

// ── 7. The app records what it found ─────────────────────────────────────
ok("a produced proposal is recorded", /onSetActivityDrift\(next\)/.test(A));
ok("...and cleared when there is none", /const next = stepSuggestion/.test(A));
// ⚠️ A WRITE PER RENDER IS A FIRESTORE WRITE PER DASHBOARD OPEN FOR NO NEW
// INFORMATION.
ok("it only writes on a change", /if \(!next && !cur\) return;/.test(A));
ok("...comparing what actually matters", /cur\.to === next\.to && cur\.from === next\.from && cur\.dir === next\.dir/.test(A));
ok("the writer deletes rather than storing a null", /if\(d\) x\.activityDrift=d; else delete x\.activityDrift;/.test(A));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  It reaches a trainer, reads the right plan, and lands on the card.\n");
process.exit(fails ? 1 : 0);
