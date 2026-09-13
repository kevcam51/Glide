// One basis for "what does this plan let you eat", and for judging a logged day (S214).
//
// THE BUG THIS EXISTS FOR. `CalorieSimulator` was handed the DASHBOARD's
// per-day chain — `todayTarget={target}` and `intakeFor={targetForRate}` — and
// both follow `viewDate` through `dayIdx → burnShown` and through the viewed
// day's log → `wearableTdee`. So:
//   • every historical logged day was judged against whichever day happened to
//     be on screen. On the reference plan below, the same 2,050-calorie day was
//     "fine" while a training day was open and "402 over" on a rest day, and
//     the make-up plan then prescribed 4.3× the repayment for it. No navigation
//     was needed — opening the app on a Monday rather than a Tuesday did it.
//   • the typed and day-by-day projections moved with it too: 2,200/day read
//     −407/day or −98/day, 5.3 lbs apart on the 2-month tile, for an input
//     nobody touched.
//
// WHAT HAS TO STAY TRUE:
//   1. ONE BASIS, SHARED. `planIntakeForRate(d, weeklyRateOf(d))` IS
//      `computeClientCalories(d).target` on every non-manual plan. Six surfaces
//      quote it — the calendar month tint, the week rows, the stored
//      `hitTarget`, the check-in auto-answer, Progress Snapshot's adherence,
//      and the server's nutritionTargets.
//   2. `planEnergy` IS DELIBERATELY MORE LENIENT than computeClientCalories —
//      no gender gate, no bmr gate — because the Daily Calorie Targets card
//      renders its pace chips on `isFinite(tdee) && tdee > 0`. A later tidy-up
//      that "unifies" the gates would silently zero those chips.
//   3. MEMBERSHIP USES THE 5% TOLERANCE, THE DEBT DOES NOT.
//   4. THE LADDER IGNORES a manual `data.calorieTarget`; the JUDGING target
//      honours it. Two questions, two answers, both unchanged from before.
//
// Everything below is LIFTED FROM THE SHIPPING SOURCE AND RUN, then mutated to
// prove this file can see the bug it guards.
//
// Run: node scripts/test-plan-target.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
// planEnergy now prices through planMaintenance, whose read clamp reads the
// estimator's own ceiling (S228). Passing the REAL TUNING in — rather than
// letting the sandbox work only because no fixture here carries a fit — keeps
// the next fitted fixture from failing with a bare ReferenceError.
import { TUNING as TDEE_TUNING } from "../src/observedTdee.js";
import { stripJsxComments } from "./lib/strip-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

// ⚠️ A BRACE-BALANCED LIFTER, NOT A LAZY REGEX. `const isEatback = (d) => …;` is
// a one-liner, so a `[\s\S]*?\n\};` pattern ran on to the NEXT function's
// closing brace — 3,600 characters, including a whole other declaration, which
// is a SyntaxError the moment both are lifted.
// ⚠️ AND A FUNCTION'S PARAMETER LIST MUST BE SKIPPED FIRST. Its parens close at
// depth 0, and `function makeUpPlan({ over, days, … })` even closes a BRACE
// there — counting body braces from the declaration returned the signature and
// nothing else.
function liftDecl(src, name) {
  // Indentation-tolerant: these are sometimes module-level and sometimes
  // declared inside a component body.
  const re = new RegExp("\\n([ \\t]*)(?:function " + name + "\\(|const " + name + "\\s*=)");
  const m = src.match(re);
  if (!m) throw new Error("could not lift " + name);
  const start = m.index + 1 + m[1].length;
  const isFn = src.startsWith("function", start);
  let i = start, depth = 0, opened = false, q = null;
  const skipString = () => { const qq = src[i]; for (i++; i < src.length; i++) { if (src[i] === "\\") { i++; continue; } if (src[i] === qq) return; } };
  if (isFn) {                          // step over the parameter list
    while (i < src.length && src[i] !== "(") i++;
    let pd = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
      if (c === "(") pd++;
      else if (c === ")") { pd--; if (pd === 0) { i++; break; } }
    }
  }
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (isFn) {
      if (c === "{") { depth++; opened = true; }
      else if (c === "}") { depth--; if (opened && depth === 0) return src.slice(start, i + 1); }
    } else {
      if ("([{".indexOf(c) >= 0) depth++;
      else if (")]}".indexOf(c) >= 0) depth--;
      else if (c === ";" && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unterminated " + name);
}

// ── lift the real thing ─────────────────────────────────────────────────────
const CONSTS = ["CAL_PER_LB", "TIMELINE_PACE_DEFS", "DAYS", "REST_ST", "STRENGTH_EXERCISES", "CARDIO_GROUPS", "ALL_CARDIO",
  "ACTIVITY_LEVELS", "MIN_DAILY_CAL", "HR_ZONES", "RATE_OPTS", "OVER_TOLERANCE", "PARTIAL_DAY_MIN"];
const FNS = ["calcBMR", "ageFromDob", "effectiveAge", "customOf", "findCardioEx", "hrCaloriesPerMin",
  "restingKcalPerMin", "calcBurn", "cardioExFor", "exBurn", "isEatback", "dailyDeficitOf", "weeklyRateOf",
  "MAINT_STALE_DAYS", "maintBasis", "maintenanceK", "planMaintenance", "planEnergy", "planIntakeForRate", "computeClientCalories", "overDaysFrom", "makeUpPlan", "achievablePace", "timelinePaces", "leanBulkBudget", "surplusNetPerDay"];
const grab = (re, n) => { const m = APP.match(re); if (!m) throw new Error(`could not lift ${n}`); return m[0]; };
const source = () => [...CONSTS, "atLeastMinCal", ...FNS].map((n) => liftDecl(APP, n)).join("\n");
const build = (src) => new Function("TDEE_TUNING", `${src}; return { planEnergy, planIntakeForRate, computeClientCalories, overDaysFrom, makeUpPlan, weeklyRateOf, OVER_TOLERANCE, atLeastMinCal, achievablePace, MIN_DAILY_CAL, CAL_PER_LB, timelinePaces, TIMELINE_PACE_DEFS, leanBulkBudget, surplusNetPerDay, STRENGTH_EXERCISES, exBurn };`)(TDEE_TUNING);
const M = build(source());


let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ⚠️ SLICE TO THE NEXT TOP-LEVEL FUNCTION, NEVER A BYTE COUNT. A fixed window
// (26,000 chars) stopped ~200 lines short of MuscleTab's own table, so a
// mutation that rebuilt the bug in that table sailed through green. If the
// component cannot be found, THROW — a component that silently slices to
// nothing makes every assertion about it vacuously true.
const component = (name) => {
  const start = APP.indexOf("function " + name + "(");
  if (start < 0) throw new Error("no component " + name);
  const next = APP.indexOf("\nfunction ", start + 1);
  return stripJsxComments(APP.slice(start, next < 0 ? APP.length : next));
};

console.log("\n  A pace is not a promise until the plan can prescribe it (S236)\n");

// ⚠️ THE FIXTURE THAT MATTERS IS SMALL, NOT BIG. Every profile in this repo's
// other suites is a 200+ lb man, and he is CORRECT at all three paces — which is
// exactly why TimelineTab charted a 2 lb/wk line for two years without anyone
// noticing. The bug lives on light, older, sedentary clients.
const SMALL  = { gender:"female", weightLbs:135, heightFt:5, heightIn:2, age:45, activityLevel:"sedentary", goalWeight:120 };
const MID    = { gender:"female", weightLbs:150, heightFt:5, heightIn:4, age:30, activityLevel:"sedentary", goalWeight:130 };
const BIG    = { gender:"male",   weightLbs:220, heightFt:5, heightIn:10, age:40, activityLevel:"moderate", goalWeight:190 };

const maintOf = (d) => { const e = M.planEnergy(d); return e.tdee + e.eatbackPerDay; };

// ── 1. the headline defect ──────────────────────────────────────────────────
{
  const a = M.achievablePace(SMALL, 2);
  ok("a 2 lb/wk pace is refused for a client the floor binds", a.floored === true, a);
  ok("...and the real pace is reported, not the label", a.lbsPerWeek < 0.6, a.lbsPerWeek);
  ok("...priced exactly off the 1,200 floor", a.target === M.MIN_DAILY_CAL, a.target);
  // The number from the bug report, recomputed from the shipping source.
  const overstated = (2 / a.lbsPerWeek - 1) * 100;
  ok("...which is the ~295% overstatement that was being charted", overstated > 250 && overstated < 340, Math.round(overstated));
}

// ── 2. it must NOT fire where the plan is fine ──────────────────────────────
// A check that flags everything is as useless as one that flags nothing.
for (const r of [0.5, 1, 2]) {
  const a = M.achievablePace(BIG, r);
  ok(`a big client is untouched at ${r} lb/wk`, a.floored === false && Math.abs(a.lbsPerWeek - r) < 0.01, a);
}
ok("and a small client is untouched at the gentlest pace", M.achievablePace(SMALL, 0.5).floored === false);

// ── 3. the arithmetic agrees with the ladder every screen already uses ──────
// If these two ever disagree, the chart and the dashboard are quoting different
// plans to the same person.
for (const d of [SMALL, MID, BIG]) {
  for (const r of [0.5, 1, 2]) {
    const a = M.achievablePace(d, r);
    const expect = (maintOf(d) - M.planIntakeForRate(d, r)) * 7;
    ok(`pace matches planIntakeForRate (${d.weightLbs}lb @ ${r})`, Math.abs(a.weeklyDeficit - expect) < 0.5, [a.weeklyDeficit, expect]);
  }
}

// ── 4. an unfloored pace is EXACTLY the flat answer ─────────────────────────
// ⚠️ THIS IS THE ASSERTION THAT STOPS AN OVER-CORRECTION. While a pace is
// prescribable the target re-prices with the weight, the deficit holds and flat
// 3,500 is right. A previous investigation claimed these tabs were 40% wrong and
// wanted them all routed through an adaptive walk; doing that would have put an
// error INTO the correct cases. This test fails if anyone tries.
for (const d of [SMALL, MID, BIG]) {
  for (const r of [0.5, 1, 2]) {
    const a = M.achievablePace(d, r);
    if (a.floored) continue;
    ok(`unfloored stays flat (${d.weightLbs}lb @ ${r})`, Math.abs(a.weeklyDeficit - r * M.CAL_PER_LB) < 0.5, a.weeklyDeficit);
  }
}

// ── 5. extra burn is added, and does not lower the plate ────────────────────
{
  const noBurn = M.achievablePace(SMALL, 2, 0);
  const burn   = M.achievablePace(SMALL, 2, 1400);
  ok("a weekly burn raises the deficit", Math.abs(burn.weeklyDeficit - (noBurn.weeklyDeficit + 1400)) < 0.5, [burn.weeklyDeficit, noBurn.weeklyDeficit]);
  ok("...without moving the floored plate", burn.target === noBurn.target, [burn.target, noBurn.target]);
}

// ── 6. no body to price → no invented limit ─────────────────────────────────
{
  const a = M.achievablePace({}, 2);
  ok("an empty plan is not declared floored", a.floored === false, a);
  ok("...and hands back the nominal pace", Math.abs(a.lbsPerWeek - 2) < 0.01, a.lbsPerWeek);
}

// ── 7. the pace table the tab renders, RUN rather than grepped ─────────────
// ⚠️ THIS SECTION REPLACED TWO DECORATIVE ASSERTIONS. They matched
// /achievablePace\(data, p\.rate\)/ and /flooredPaces/, so reverting the pace to
// a hardcoded literal and emptying the disclosure list BOTH stayed green — the
// mutation survived because the test read the source instead of running it.
{
  const { paces, floored } = M.timelinePaces(SMALL);
  ok("three paces come back", paces.length === 3, paces.length);
  // The one that matters: the tab's own number, not the label's.
  const two = paces.find((p) => p.id === "two");
  ok("the 2 lb/wk row carries the ACHIEVABLE deficit", two.dietCutPerWeek < 2 * M.CAL_PER_LB - 1, two.dietCutPerWeek);
  ok("...which is what the ladder says", Math.abs(two.dietCutPerWeek - (maintOf(SMALL) - M.planIntakeForRate(SMALL, 2)) * 7) < 0.5, two.dietCutPerWeek);
  ok("...and it is marked floored", two.floored === true);
  ok("...and appears in the disclosure list", floored.some((p) => p.id === "two"), floored.map((p) => p.id));
  const half = paces.find((p) => p.id === "half");
  ok("the gentle pace is untouched and undisclosed", half.floored === false && Math.abs(half.dietCutPerWeek - 0.5 * M.CAL_PER_LB) < 0.5, half.dietCutPerWeek);

  // A big client must produce an EMPTY disclosure list, or the banner would cry
  // wolf on every plan that is perfectly fine.
  const big = M.timelinePaces(BIG);
  ok("a big client discloses nothing", big.floored.length === 0, big.floored.map((p) => p.id));
  ok("...and all three of his paces are the flat answer",
     big.paces.every((p, i) => Math.abs(p.dietCutPerWeek - [0.5, 1, 2][i] * M.CAL_PER_LB) < 0.5), big.paces.map((p) => p.dietCutPerWeek));

  // The defs themselves must stay free of pre-computed deficits.
  ok("the pace DEFS carry a rate, never a calorie literal",
     M.TIMELINE_PACE_DEFS.every((d) => typeof d.rate === "number" && d.dietCutPerWeek === undefined), M.TIMELINE_PACE_DEFS);
}
{
  // The component must READ the shared table rather than rebuild one.
  const tab = component("TimelineTab");
  ok("TimelineTab reads timelinePaces", /timelinePaces\(data\)/.test(tab));
  // Reading p.dietCutPerWeek is the point; ASSIGNING one is the bug coming back.
  const built = (tab.match(/dietCutPerWeek\s*:/g) || []).length;
  ok("and builds no pace of its own", built === 0, built);
}


// ── 8. a lean bulk must never be priced below maintenance (S236) ───────────
// ⚠️ THE BUG: MuscleTab read `tdee + surplus`, adding back only the CARDIO burn
// while the strength burn sat on the same screen as a headline stat. On a real
// lifting plan the "Lean Bulk Target" landed BELOW the app's own maintenance
// while the tab projected months of muscle AND fat gain.
{
  const STRENGTH_ID = [...APP.matchAll(/id:"([a-z_0-9]+)"[^}]*cat:"/g)].map((m) => m[1])[0];
  const plan = (w, sessions, mins) => {
    const strength = {};
    ["Monday","Tuesday","Wednesday","Thursday","Friday"].slice(0, sessions)
      .forEach((d) => { strength[d] = [{ type: STRENGTH_ID, duration: mins }]; });
    return { gender:"male", weightLbs:w, heightFt:5, heightIn:10, age:30,
      activityLevel:"moderate", cardio:{}, strength };
  };
  // Straight from the measured bug report, recomputed from the shipping source.
  for (const [w, sess, mins] of [[200,4,60],[220,5,60],[260,5,60],[180,3,45],[135,3,45]]) {
    const d = plan(w, sess, mins);
    const e = M.planEnergy(d);
    const b = M.leanBulkBudget({ tdee: e.tdee, totalStrBurn: e.weeklyBurn, avgBurnPerDay: 0,
      includeCardio: false, surplus: 250 });
    const trueMaint = e.tdee + Math.round(e.weeklyBurn / 7);
    ok(`a bulk target is above maintenance (${w}lb ${sess}x${mins})`, b.target > trueMaint, [b.target, trueMaint]);
    ok(`...by exactly the surplus (${w}lb)`, b.target - trueMaint === 250, b.target - trueMaint);
    // The old formula, kept as a negative control: it must FAIL these plans, or
    // the assertion above proves nothing about the bug that was fixed.
    const oldTarget = e.tdee + 250;
    if (Math.round(e.weeklyBurn / 7) > 250) {
      ok(`...and the OLD formula really was below it (${w}lb)`, oldTarget < trueMaint, [oldTarget, trueMaint]);
    }
  }
  // Lifting always counts; cardio only when the toggle includes it.
  const base = { tdee: 2500, totalStrBurn: 1400, avgBurnPerDay: 300, surplus: 250 };
  const off = M.leanBulkBudget({ ...base, includeCardio: false });
  const on  = M.leanBulkBudget({ ...base, includeCardio: true });
  ok("lifting is in the budget with cardio off", off.maintenance === 2500 + 200, off.maintenance);
  ok("cardio is added only when included", on.maintenance - off.maintenance === 300, [on.maintenance, off.maintenance]);
  ok("an empty plan does not invent a burn", M.leanBulkBudget({ tdee: 2000, surplus: 200 }).target === 2200);
}

// ── 9. the surplus offset counts lifting, not just cardio ──────────────────
{
  // A strength-only client: cardio 0, lifting 408/day. The old code offset by
  // cardio alone, i.e. by nothing, and declared the whole overage un-offset.
  ok("lifting offsets an overage", M.surplusNetPerDay(400, 0, 408, true) === 0, M.surplusNetPerDay(400, 0, 408, true));
  ok("...where cardio alone would not have", M.surplusNetPerDay(400, 0, 0, true) === 400);
  ok("cardio and lifting add up", M.surplusNetPerDay(500, 200, 150, true) === 150);
  ok("never negative", M.surplusNetPerDay(100, 300, 300, true) === 0);
  ok("and the toggle off means no offset at all", M.surplusNetPerDay(400, 200, 200, false) === 400);
}

// ── 10. the tabs read the shared budgets rather than rebuilding one ────────
{
  const muscle = component("MuscleTab");
  ok("MuscleTab prices through leanBulkBudget", /leanBulkBudget\(\{/.test(muscle));
  // COUNT: the table's Total Cals column repeated the bug independently, so one
  // fixed site is not enough.
  ok("no tdee + surplus is rebuilt anywhere in the tab",
     (muscle.match(/tdee \+ r\.surplus|tdee \+ buildSurplus/g) || []).length === 0,
     (muscle.match(/tdee \+ r\.surplus|tdee \+ buildSurplus/g) || []));
  ok("the cardio-only netting is gone", !/s - avgBurnPerDay/.test(muscle));
  // A positive control on the slice itself: if this string is missing, the
  // window never reached the table and the assertions above proved nothing.
  ok("the MuscleTab slice reaches its own table", /mt-label-col/.test(muscle), muscle.length);
  // ⚠️ THE CAPTION MUST ADD UP TO THE HERO. It read "Maintenance {tdee} +
  // surplus" beside a target priced against tdee + training, so the two numbers
  // on one line disagreed by the whole training burn.
  ok("the maintenance caption quotes the same maintenance the target uses",
     /Maintenance \{maintenanceWithTraining/.test(muscle));
  ok("...and no longer quotes the bare tdee there",
     !/Maintenance \{tdee/.test(muscle));
  const surplusTab = component("SurplusTab");
  ok("SurplusTab offsets through surplusNetPerDay", /surplusNetPerDay\(/.test(surplusTab));
  ok("...and no longer gates on cardio alone", !/hasCardio = totalBurn > 0/.test(surplusTab));
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED`); process.exit(1); }
console.log("  A charted pace is one the plan will actually prescribe.\n");
