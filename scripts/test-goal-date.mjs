// The goal DATE on the Nutrition Approach card, and the pace it is derived from
// (S216).
//
// THE BUG. `SummaryTab` dated every plan at 1 lb/week:
//
//     const wksEat = hasGoal ? weeksToGoal(toLose, 3500) : null;
//     const wksAcc = hasGoal ? weeksToGoal(toLose, 3500 + weeklyBurnAll) : null;
//
// `weeklyRateOf` has been the single source of the plan's pace since S95 — the
// daily targets, the projections, the calendar and the server all read it, and
// `SimulationSummary` multiplies by it four thousand lines earlier. This card
// never was. So a client set to 2 lb/wk was told 35 lbs would take 20 weeks when
// the plan's own arithmetic says 10, four lines under a row reading
// "Your plan's pace · 2 lbs/wk · 2,069 cal". Both directions were wrong: a
// ½ lb/wk plan was promised twice the speed it had chosen.
//
// WHAT HAS TO STAY TRUE:
//   1. BOTH TIMELINES COME OFF THE PLAN'S OWN RATE. Eat-back is that rate;
//      accelerate is that rate PLUS the whole weekly training burn (cardio and
//      strength), which is what "the burn buys the date, not the food" means.
//   2. A NON-LOSING PACE HAS NO EAT-BACK DATE. weeksToGoal refuses a
//      non-positive deficit — it must keep refusing, and the card must say why
//      rather than print a dash. The old hardcoded 3,500 manufactured a
//      confident date for a maintenance plan.
//   3. THE WORDS MATCH THE NUMBER. The chooser's own description said "steady
//      ~1 lb/wk" in prose, which is the same false claim one line above the
//      false date.
//
// The helpers are LIFTED FROM THE SHIPPING SOURCE AND RUN, and every guard is
// mutated to prove this file can see the bug it guards.
//
// Run: node scripts/test-goal-date.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { stripComments, stripJsxComments } from "./lib/strip-comments.mjs";
import { TUNING as TDEE_TUNING } from "../src/observedTdee.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const CODE = stripJsxComments(APP);

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ⚠️ A BRACE-BALANCED LIFTER, NOT A LAZY REGEX (S215) — a one-line arrow const
// makes `[\s\S]*?\n\};` run on into the next declaration, and a function's
// parameter list closes its parens at depth 0.
function liftDecl(src, name) {
  const re = new RegExp("\\n([ \\t]*)(?:function " + name + "\\(|const " + name + "\\s*=)");
  const m = src.match(re);
  if (!m) throw new Error("could not lift " + name);
  const start = m.index + 1 + m[1].length;
  const isFn = src.startsWith("function", start);
  let i = start, depth = 0, opened = false;
  const skipString = () => { const qq = src[i]; for (i++; i < src.length; i++) { if (src[i] === "\\") { i++; continue; } if (src[i] === qq) return; } };
  if (isFn) {
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

const M = new Function(`
  ${liftDecl(APP, "RATE_OPTS")}
  ${liftDecl(APP, "RATE_SHORT")}
  ${liftDecl(APP, "weeklyRateOf")}
  ${liftDecl(APP, "weeksToGoal")}
  ${liftDecl(APP, "friendlyTime")}
  return { RATE_OPTS, RATE_SHORT, weeklyRateOf, weeksToGoal, friendlyTime };
`)();

// The SummaryTab body, so source assertions cannot match the rest of the file.
const SUM_A = APP.indexOf("function SummaryTab(");
const SUM_B = APP.indexOf("\nfunction ", SUM_A + 10);
ok("found the SummaryTab body", SUM_A > 0 && SUM_B > SUM_A);
const SUM = APP.slice(SUM_A, SUM_B);
const SUM_CODE = CODE.slice(CODE.indexOf("function SummaryTab("), CODE.indexOf("\nfunction ", CODE.indexOf("function SummaryTab(") + 10));

// ── 1. the card reads the pace the plan can DELIVER ────────────────────────
// ⚠️ THESE FIVE PINNED `planRateS * 3500` UNTIL S237e, AND THAT WAS ONLY HALF
// THE ANSWER. S216 fixed the card's first defect — it dated every plan at 1
// lb/week — and this suite locked in the fix by pinning its exact shape. But
// the nominal rate is not what a floored plan delivers: the 1,200 floor can
// refuse most of the deficit, and the card went on quoting the chip. Same
// assertions, one property stronger: the deficit is the plan's rate AFTER the
// floor has had its say.
ok("the deficit is the pace the plan can actually deliver",
   /const paceEat = achievablePace\(\{ \.\.\.data, deficitMode: "eatback" \}, planRateS\);/.test(SUM_CODE));
ok("...and planRateS IS weeklyRateOf", /const planRateS = weeklyRateOf\(data\);/.test(SUM_CODE));
ok("the eat-back timeline uses it", /const wksEat = hasGoal \? weeksToGoal\(toLose, paceEat\.weeklyDeficit\) : null;/.test(SUM_CODE));
// ⚠️ ACCELERATE IS THAT SAME DEFICIT PLUS THE WHOLE WEEK'S BURN — cardio AND
// strength. Dropping either half is the S215 defect in a different card. It
// rides in as achievablePace's extraWeeklyBurn so the floor prices it too.
ok("the accelerate timeline stacks the whole weekly burn on it",
   /const paceAcc = achievablePace\(\{ \.\.\.data, deficitMode: "accelerate" \}, planRateS, weeklyBurnAll\);/.test(SUM_CODE)
   && /const wksAcc = hasGoal \? weeksToGoal\(toLose, paceAcc\.weeklyDeficit\) : null;/.test(SUM_CODE));
ok("...and that burn really is cardio plus strength",
   /const weeklyBurnAll = \(totalBurn \|\| 0\) \+ \(totalStrBurn \|\| 0\);/.test(SUM_CODE));
// ⚠️ A MODE-FORCED COPY, NOT THE PLAN ITSELF. achievablePace reads deficitMode,
// and this chooser prices BOTH outcomes; passing `data` answers the active mode
// twice and the two rows agree when they should differ.
ok("each option is priced against its own mode",
   /deficitMode: "eatback" \}, planRateS\)/.test(SUM_CODE) && /deficitMode: "accelerate" \}, planRateS, weeklyBurnAll\)/.test(SUM_CODE));
// ⚠️ COUNTED, NOT FOUND. A bare 3,500 anywhere in this component is the same
// defect wearing a different variable name — and it is ZERO now, not one,
// because the last one WAS the bug.
ok("no bare 3,500 survives in the card",
   (SUM_CODE.match(/3500/g) || []).length === 0, (SUM_CODE.match(/3500/g) || []).length);
// ⚠️ AND THE FLOOR IS DISCLOSED, never applied silently — the 1,200 standard.
ok("a floored pace says so on the card", /paceEat\.floored \|\| paceAcc\.floored/.test(SUM_CODE));
ok("...naming the pace the plan really gives", /lbsPerWeek\.toFixed\(1\)/.test(SUM_CODE));

// ── 2. what the dates actually come out at ─────────────────────────────────
// 20 lbs to lose, no training, one plan per pace — the case named in the
// handoff: "20 weeks where the truth is 10".
const weeks = (rate, burn = 0) => M.weeksToGoal(20, M.weeklyRateOf({ weeklyRate: rate }) * 3500 + burn);
ok("2 lb/wk reaches the goal in 10 weeks, not 20", weeks(2) === 10, weeks(2));
ok("1 lb/wk is unchanged at 20 weeks", weeks(1) === 20, weeks(1));
ok("½ lb/wk is 40 weeks, not 20", weeks(0.5) === 40, weeks(0.5));
ok("an unset rate still defaults to 1 lb/wk", M.weeksToGoal(20, M.weeklyRateOf({}) * 3500) === 20);
ok("a junk rate falls back to 1 lb/wk too", M.weeksToGoal(20, M.weeklyRateOf({ weeklyRate: "banana" }) * 3500) === 20);
// ⚠️ THE CONTROL. The shipped bug dated all three the same.
ok("control: the hardcoded 3,500 really did date every pace identically",
   M.weeksToGoal(20, 3500) === 20 && weeks(2) !== 20 && weeks(0.5) !== 20);
ok("...and really did double the wait on a 2 lb/wk plan",
   M.weeksToGoal(20, 3500) - weeks(2) === 10);
// Accelerate adds the training burn to whatever the pace already is.
ok("training speeds a 2 lb/wk plan up further", weeks(2, 1400) < weeks(2));
ok("...and the two approaches differ by the burn, at every pace",
   [0.5, 1, 2].every((r) => weeks(r, 1400) < weeks(r)));

// ── 3. a non-losing pace has no eat-back date, and says why ────────────────
// ⚠️ weeksToGoal REFUSES a non-positive deficit. That refusal is the honest
// answer for a maintenance plan and the old literal papered over it.
ok("maintenance has no eat-back date", weeks(0) === null);
ok("a gaining pace has none either", weeks(-1) === null && weeks(-2) === null);
ok("...but training alone can still get there", weeks(0, 1400) !== null && weeks(0, 1400) > 0);
ok("friendlyTime renders a missing date as a dash rather than crashing", M.friendlyTime(null) === "—");
ok("the card explains a missing date instead of leaving the dash bare",
   /\{!wksEat && \(/.test(SUM_CODE) && /so eating alone never reaches/.test(SUM_CODE));
ok("...and names the pace that caused it", /RATE_SHORT\[planRateS\] \|\| "maintenance"/.test(SUM_CODE));
ok("...and points at the approach that still works when it does",
   /wksAcc \? " Faster Results gets there on the training burn alone\." : " Pick a losing pace to see a date\."/.test(SUM_CODE));

// ── 4. the words have to match the number ──────────────────────────────────
// The chooser's own description said "steady ~1 lb/wk" in prose — the same false
// claim as the date, one line above it, and it would have survived a fix aimed
// only at the arithmetic.
ok("the Eat More description no longer hardcodes 1 lb/wk", !/steady ~1 lb\/wk/.test(SUM_CODE));
ok("...it says the plan's own pace", /easier diet, \$\{pacePhrase\}/.test(SUM_CODE));
{
  const phrase = new Function("planRateS", `
    ${liftDecl(APP, "RATE_SHORT")}
    ${liftDecl(APP, "pacePhrase").replace(/^const pacePhrase = /, "return ")}
  `);
  // ⚠️ TWO POUNDS TAKES THE PLURAL (S220g, Kevin: "unify the spelling to lbs").
  // RATE_SHORT used to say "2 lb/wk" here while the chips on the same dashboard
  // said "2 LBS/WK". This assertion is what caught the change in a second
  // surface — which is the point of pinning the string rather than the shape.
  ok("2 lbs/wk reads as itself", phrase(2) === "a steady ~2 lbs/wk", phrase(2));
  ok("1 lb/wk is unchanged", phrase(1) === "a steady ~1 lb/wk", phrase(1));
  ok("half a pound reads properly", phrase(0.5) === "a steady ~½ lb/wk", phrase(0.5));
  // ⚠️ "steady ~Maintain" is not English — RATE_SHORT[0] is a NOUN.
  ok("maintenance gets a sentence, not a label", phrase(0) === "holding your weight steady", phrase(0));
  ok("a gaining pace keeps its plus", phrase(-1) === "a steady ~+1 lb/wk", phrase(-1));
  ok("...and a gaining two takes the plural too", phrase(-2) === "a steady ~+2 lbs/wk", phrase(-2));
  // The other half of the rule: a half and a one stay singular in both directions.
  ok("...while a half and a one stay singular",
     [0.5, 1, -0.5, -1].every((r) => !/lbs\//.test(phrase(r))), [0.5, 1, -0.5, -1].map(phrase));
  ok("every offered rate produces English", M.RATE_OPTS.every((r) => !/undefined|Maintain/.test(phrase(r))),
     M.RATE_OPTS.map(phrase));
}

// ── 5. the card that already got this right is untouched ───────────────────
// SimulationSummary has multiplied by weeklyRateOf since S95; this fix must not
// have "tidied" it in the other direction.
{
  // ⚠️ THE COMMENT-STRIPPED COPY, like SUM_CODE above. The raw slice was fine
  // while every assertion here was POSITIVE; the moment one said "no bare 3,500
  // survives", it matched the comment EXPLAINING that there is no bare 3,500.
  // Sixth time in this repo — strip comments before asserting an absence.
  const SIM_A = CODE.indexOf("function SimulationSummary(");
  const SIM = CODE.slice(SIM_A, CODE.indexOf("\nfunction ", SIM_A + 10));
  ok("SimulationSummary still uses the plan's rate",
     /const simRate = weeklyRateOf\(data\);/.test(SIM));
  // ⚠️ AND IT IS FLOOR-AWARE TOO (S237e). This card is shown to a PROSPECT, so
  // it was the worst place in the app to headline a date four times faster than
  // the plan delivers. It had the same unfloored nominal-rate arithmetic the
  // paragraph above congratulates it for having got right in S95.
  ok("...and prices it through the floor",
     /const paceEat = achievablePace\(\{ \.\.\.data, deficitMode: "eatback" \}, simRate\);/.test(SIM)
     && /const paceAcc = achievablePace\(\{ \.\.\.data, deficitMode: "accelerate" \}, simRate, weeklyBurnAll\);/.test(SIM));
  ok("...and the sales card discloses a floored pace", /paceEat\.floored \|\| paceAcc\.floored/.test(SIM));
  ok("...with no bare 3,500 left in it", (SIM.match(/3500/g) || []).length === 0, (SIM.match(/3500/g) || []).length);
}

// ── 6. the floored client, run rather than pattern-matched (S237e) ─────────
//
// ⚠️ EVERY ASSERTION ABOVE IS A REGEX, AND A REGEX CANNOT TELL YOU THE DATE IS
// RIGHT. This section lifts achievablePace and the energy ladder out of the
// shipping file and RUNS them on the client the defect was found on, so a
// change that keeps the shape and breaks the arithmetic goes red.
{
  const NAMES = ["CAL_PER_LB", "FLOOR_NOISE_CAL", "MIN_DAILY_CAL", "ACTIVITY_LEVELS", "DAYS", "REST_ST",
    "STRENGTH_EXERCISES", "CARDIO_GROUPS", "ALL_CARDIO", "HR_ZONES", "PARTIAL_DAY_MIN",
    "calcBMR", "ageFromDob", "effectiveAge", "customOf", "findCardioEx", "hrCaloriesPerMin",
    "restingKcalPerMin", "calcBurn", "cardioExFor", "exBurn", "isEatback", "atLeastMinCal",
    "MAINT_STALE_DAYS", "maintBasis", "maintenanceK", "planMaintenance", "planEnergy",
    "planIntakeForRate", "achievablePace"];
  const R = new Function("TDEE_TUNING",
    NAMES.map((n) => liftDecl(APP, n)).join("\n") + "\nreturn { achievablePace, planEnergy, MIN_DAILY_CAL, CAL_PER_LB, FLOOR_NOISE_CAL };")(TDEE_TUNING);

  // The client this was found on: 45, 5'2", 135 lbs, sedentary, wants 120.
  // A real and common roster profile, which is why it matters.
  const her = { gender: "female", age: 45, heightFt: 5, heightIn: 2, weightLbs: 135,
    goalWeight: 120, activityLevel: "sedentary", cardio: {}, strength: {}, checkIns: [] };
  const toLose = 15;
  const maint = R.planEnergy(her).tdee;
  ok("(fixture) she burns about 1,450 a day", Math.abs(maint - 1453) < 15, Math.round(maint));

  const wksAt = (rate) => M.weeksToGoal(toLose, R.achievablePace({ ...her, deficitMode: "eatback" }, rate).weeklyDeficit);
  const nominalWks = (rate) => M.weeksToGoal(toLose, rate * 3500);

  // ⚠️ THE DEFECT, AS ARITHMETIC. A 2 lb/wk plan floors to ~0.51, so the honest
  // date is ~6.8 months where the card printed ~1.7 — four times too fast.
  {
    const p = R.achievablePace({ ...her, deficitMode: "eatback" }, 2);
    ok("a 2 lb/wk plan floors her target at 1,200", p.target === R.MIN_DAILY_CAL, p.target);
    ok("...and is flagged as floored", p.floored === true);
    ok("...delivering about half a pound a week, not two", Math.abs(p.lbsPerWeek - 0.51) < 0.05, p.lbsPerWeek);
    ok("...so the honest date is ~6.8 months", Math.abs(wksAt(2) / 4.345 - 6.8) < 0.4, wksAt(2) / 4.345);
    // The control: what the card used to say, and how far out it was.
    ok("(control) the old nominal date was ~1.7 months", Math.abs(nominalWks(2) / 4.345 - 1.7) < 0.2, nominalWks(2) / 4.345);
    ok("(control) ...so the fix moves this date by a factor of ~4",
       wksAt(2) / nominalWks(2) > 3.5 && wksAt(2) / nominalWks(2) < 4.5, wksAt(2) / nominalWks(2));
  }
  // ⚠️ AND A PACE THE PLAN CAN AFFORD MUST NOT MOVE AT ALL. If the fix changed
  // un-floored dates it would be a regression dressed as a correction — this is
  // the assertion that says the other 90% of plans see nothing.
  {
    const p = R.achievablePace({ ...her, deficitMode: "eatback" }, 0.5);
    ok("her ½ lb/wk pace is NOT floored", p.floored === false, p);
    ok("...and its date is unchanged by the fix",
       Math.abs(wksAt(0.5) - nominalWks(0.5)) < 0.15, { now: wksAt(0.5), before: nominalWks(0.5) });
  }
  // A bigger body has room for the whole deficit, so nothing moves there either.
  {
    const him = { ...her, gender: "male", weightLbs: 240, heightFt: 5, heightIn: 11, age: 35, activityLevel: "moderate" };
    const p = R.achievablePace({ ...him, deficitMode: "eatback" }, 2);
    ok("a 240 lb moderately-active man is not floored at 2 lb/wk", p.floored === false, p);
    ok("...and still dates at the full 2 lb/wk", Math.abs(p.lbsPerWeek - 2) < 0.02, p.lbsPerWeek);
  }
  // ⚠️ A FIXTURE WITH NO TRAINING NEVER EXERCISES THE ACCELERATE PATH, and a
  // mutation that deleted `+ extra` from achievablePace stayed GREEN through
  // every assertion above because weeklyBurnAll was 0 in all of them. The
  // training burn is the whole difference between the two rows this card
  // compares, so one fixture has to actually train.
  //
  // ⚠️ AND IT HAS TO BE AN UNFLOORED BODY, which the first version of this got
  // wrong. Once the floor binds, the two approaches are ALGEBRAICALLY THE SAME
  // deficit — eat-back is (tdee + burn/7 − 1200)·7 and accelerate is
  // (tdee − 1200)·7 + burn, which are one expression — so a floored fixture
  // cannot tell a working `+ extra` from a deleted one. That identity is real
  // and worth its own assertion, below.
  const TRAIN = { Monday: [{ type: "walk_flat", duration: 45 }],
                  Wednesday: [{ type: "walk_flat", duration: 45 }],
                  Friday: [{ type: "walk_flat", duration: 45 }] };
  {
    const him = { ...her, gender: "male", weightLbs: 240, heightFt: 5, heightIn: 11,
                  age: 35, activityLevel: "moderate", cardio: TRAIN };
    const burn = R.planEnergy(him).weeklyBurn;
    ok("(fixture) he actually trains", burn > 300, Math.round(burn));
    ok("(fixture) and he is NOT floored", R.achievablePace({ ...him, deficitMode: "eatback" }, 1).floored === false);
    const eat = R.achievablePace({ ...him, deficitMode: "eatback" }, 1);
    const acc = R.achievablePace({ ...him, deficitMode: "accelerate" }, 1, burn);
    ok("the accelerate pace is faster than the eat-back one", acc.weeklyDeficit > eat.weeklyDeficit + 1,
       { eat: Math.round(eat.weeklyDeficit), acc: Math.round(acc.weeklyDeficit) });
    // ⚠️ THE CONTROL FOR THE MUTATION THAT GOT THROUGH: drop `+ extra` and the
    // two rows collapse onto one number, which is exactly what this forbids.
    // ⚠️ THE SAME ROUNDING SLACK THE FLAG USES, AND FOR THE SAME REASON: the
    // target is rounded to a whole calorie and eatbackPerDay is a weekly burn
    // over seven, so the two modes land a few calories apart from arithmetic
    // alone. Asserting "< 1" here is what exposed the `floored` flag's own
    // 1-calorie tolerance, so this reuses the constant rather than a new magic
    // number — if one moves, so does the other.
    ok("...by the training burn, within rounding",
       Math.abs((acc.weeklyDeficit - eat.weeklyDeficit) - burn) <= R.FLOOR_NOISE_CAL,
       { gap: Math.round(acc.weeklyDeficit - eat.weeklyDeficit), burn: Math.round(burn) });
    ok("...so it reaches the goal sooner",
       M.weeksToGoal(toLose, acc.weeklyDeficit) < M.weeksToGoal(toLose, eat.weeklyDeficit));
  }
  // ⚠️ THE IDENTITY THE BROKEN FIXTURE REVEALED, PINNED ON PURPOSE. For a
  // floored client the nutrition approach cannot change the pace: the target is
  // held at 1,200 either way and the training burn is energy out regardless. A
  // future change that made these two differ for a floored plan would be
  // promising a choice that does not exist.
  {
    const t = { ...her, cardio: TRAIN };
    const burn = R.planEnergy(t).weeklyBurn;
    const eat = R.achievablePace({ ...t, deficitMode: "eatback" }, 2);
    const acc = R.achievablePace({ ...t, deficitMode: "accelerate" }, 2, burn);
    ok("(fixture) she is floored even with training", eat.floored && acc.floored);
    ok("a floored plan gives the same pace either way",
       Math.abs(acc.weeklyDeficit - eat.weeklyDeficit) < 0.01,
       { eat: eat.weeklyDeficit, acc: acc.weeklyDeficit });
  }
  // ⚠️ THE FLOOR NEVER MAKES A PLAN LOOK FASTER. Whatever the body, the
  // floor-aware deficit is at most the nominal one — a fix that let any plan
  // date EARLIER than before would be a new bug, not this one fixed.
  {
    let worst = 0;
    for (const w of [110, 125, 135, 150, 175, 200, 240, 300]) {
      for (const rate of [0.5, 1, 1.5, 2]) {
        for (const act of ["sedentary", "light", "moderate", "very"]) {
          const p = R.achievablePace({ ...her, weightLbs: w, activityLevel: act, deficitMode: "eatback" }, rate);
          worst = Math.max(worst, p.weeklyDeficit - rate * R.CAL_PER_LB);
        }
      }
    }
    ok("across 128 bodies the floor never inflates the deficit", worst <= 1, worst);
  }
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  Goal date: the plan's own pace, or an honest refusal.\n");
