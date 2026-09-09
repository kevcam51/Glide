// The "What if…" sandbox: one page, one engine, and a week of cardio that
// changes nothing (S213 · S214 · S215 · S216).
//
// Kevin's S216 asks, after using the S213 build:
//   1. "in the What if section we need to add − to the calories that are meant
//      for weight loss."
//   2. "I have no idea what the one number section is and how it is useful."
//   3. "in the text box the numbers are way too close to the arrows, can we move
//      the numbers over to the left a little bit."
//   4. "we need the cardio selection option to be for every day and… set up
//      almost exactly like it is in the weekly cardio plan section. Quick fill
//      option at the top… and all of the days listed down below that can be
//      edited separately… we can remove the how often and also burned section…
//      only thing we will need is a manual calorie entry option… this also needs
//      to be in the quick fill section as well."
//   5. "This can all honestly be on the Pick a pace page and we probably do not
//      need 3 separate tabs."
//   6. "I really like the Make up a big day option at the bottom. we can keep
//      that."
//
// WHAT THIS FEATURE PROMISES, AND THEREFORE WHAT HAS TO STAY TRUE:
//
//   1. THE MODAL WRITES NOTHING. StepCardio's every control calls
//      onChange("cardio", …); this planner is LOCAL state seeded from the same
//      week, deep-copied so an edit cannot reach data.cardio by reference. That
//      promise is the entire licence for the screen to display a typed sub-1,200
//      number at all (CLAUDE.md's floor forbids PRESCRIBING one).
//   2. ONE ARITHMETIC PATH, AND ONE LADDER. `simIntakeForRate` is
//      `planIntakeForRate` with the weekly burn substituted — on an UNTOUCHED
//      planner the two must be bit-identical at every rate, or this modal and
//      the dashboard start quoting different daily targets.
//   3. SEEDING THE PLANNER MUST NOT DOUBLE-COUNT THE PLAN'S OWN TRAINING. In
//      eat-back mode `maintain` (= intakeFor(0)) ALREADY carries the week's
//      training; subtracting the same sessions again turns a "−1 lb/wk" plan
//      into a claimed −1.8 the moment the planner is seeded from a real week.
//   4. A BLANK DAY IS THE GOAL PACE — not zero, not the mean of the typed days.
//   5. NOTHING TYPED IS CLAMPED, AND NO SUB-1,200 DAY IS HIDDEN BY A MEAN.
//   6. THE MAKE-UP DROPDOWN MUST NOT WHITE-SCREEN AGAIN (the S200r temporal
//      dead zone; `check:undef` cannot see that class).
//   7. CARDIO ONLY MEANS CARDIO ONLY — including custom STRENGTH exercises,
//      which used to reach the list through the "Custom" group.
//
// Every helper below is LIFTED FROM THE SHIPPING SOURCE AND RUN, then mutated to
// prove this file can see the bug it guards. A regex against source passes just
// as happily against `if (false)`.
//
// Run: node scripts/test-what-if-week.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ⚠️ A BRACE-BALANCED LIFTER, NOT A LAZY REGEX (S215). `const isEatback = (d) =>
// …;` is a one-liner, so a `[\s\S]*?\n\};` pattern ran on to the NEXT function's
// closing brace and swallowed 3,600 characters including a whole other
// declaration. And a function's PARAMETER list closes its parens at depth 0, so
// brace-counting from the declaration returns only the signature.
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

// ── lift the shipping helpers and RUN them ──────────────────────────────────
const CONSTS = ["DAYS", "DAY_SHORT", "REST_ST", "STRENGTH_EXERCISES", "CARDIO_GROUPS", "ALL_CARDIO",
  "ACTIVITY_LEVELS", "MIN_DAILY_CAL", "HR_ZONES", "RATE_OPTS", "OVER_TOLERANCE", "CAL_PER_LB", "SIM_MANUAL", "SIM_RATES"];
const FNS = ["calcBMR", "ageFromDob", "effectiveAge", "customOf", "findCardioEx", "hrCaloriesPerMin",
  "restingKcalPerMin", "calcBurn", "cardioExFor", "exBurn", "isEatback", "dailyDeficitOf", "weeklyRateOf",
  "planEnergy", "planIntakeForRate", "computeClientCalories",
  "simNum", "simRejected", "weekPlan", "joinDays",
  "seedSimCardio", "simSessionBurn", "simDayBurn", "simWeekBurn", "simRawIntakeForRate", "simIntakeForRate"];
const EXPORTS = ["simNum", "simRejected", "weekPlan", "joinDays", "seedSimCardio", "simSessionBurn",
  "simDayBurn", "simWeekBurn", "simRawIntakeForRate", "simIntakeForRate", "planEnergy",
  "planIntakeForRate", "computeClientCalories", "cardioExFor", "exBurn", "isEatback", "SIM_RATES",
  "SIM_MANUAL", "MIN_DAILY_CAL", "CAL_PER_LB", "DAYS", "DAY_SHORT"];
const source = () => [...CONSTS, "atLeastMinCal", ...FNS].map((n) => liftDecl(APP, n)).join("\n");
const build = (src) => new Function(`${src}; return { ${EXPORTS.join(", ")} };`)();
const M = build(source());
const { simNum, weekPlan, joinDays, simRejected, DAY_SHORT, CAL_PER_LB } = M;
// The plan's own rate list, so "the sandbox offers exactly the plan's rates" is a
// claim about the shipping constant rather than about a list retyped here.
const RATE_OPTS_FROM_APP = new Function(`${liftDecl(APP, "RATE_OPTS")}; return RATE_OPTS;`)();

// The component body, so source assertions can't accidentally match the rest of
// a 37,000-line file.
const SIM_A = APP.indexOf("function CalorieSimulator(");
const SIM_B = APP.indexOf("function DailyDashboard(", SIM_A);
ok("found the CalorieSimulator body", SIM_A > 0 && SIM_B > SIM_A);
const SIM = APP.slice(SIM_A, SIM_B);
// ⚠️ STRIP COMMENTS BEFORE ASSERTING ON WHAT RENDERS. This bit S208 three times:
// a check matched the very COMMENT that names the thing it forbids, and went
// green on a correct file — or red on one.
const codeOnly = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const SIM_CODE = codeOnly(SIM);
// The module-level sandbox helpers sit ABOVE the component; some assertions are
// about them.
const HELP_A = APP.indexOf("const SIM_MANUAL =");
const HELP = codeOnly(APP.slice(HELP_A, SIM_A));
ok("found the sandbox's module-level helpers", HELP_A > 0 && HELP_A < SIM_A);

// Real catalog ids, taken from the file rather than typed from memory — a
// made-up id resolves to the rest entry and silently zeroes every burn here.
const STRENGTH_ID = [...APP.matchAll(/id:"([a-z_0-9]+)"[^}]*cat:"/g)].map((m) => m[1])[0];
const CARDIO_ID = [...APP.matchAll(/\{ id:"([a-z_0-9]+)",\s+label:"[^"]*",\s+icon:"[^"]*",\s+met:/g)].map((m) => m[1])[0];
ok("lifted a real strength id from the catalog", !!STRENGTH_ID, STRENGTH_ID);
ok("lifted a real cardio id from the catalog", !!CARDIO_ID, CARDIO_ID);

// ── 1. one typed field → a number, or null ──────────────────────────────────
ok("a blank day is null, not zero", simNum("") === null);
ok("whitespace is blank too", simNum("   ") === null);
ok("a typed 0 IS an entry — a fast is a real answer", simNum("0") === 0);
ok("commas survive", simNum("2,100") === 2100);
ok("decimals round", simNum("2100.6") === 2101);
// ⚠️ THE ONE THE OLD CODE LET THROUGH. `Math.round(Number("1e400") || 0)` is
// Infinity, and the projection tiles rendered "Infinity lbs".
ok("1e400 is refused, not turned into Infinity", simNum("1e400") === null);
ok("letters are refused", simNum("abc") === null);
ok("negatives are refused", simNum("-500") === null);
ok("absurd numbers are refused", simNum("50001") === null);
ok("the top of the range is accepted", simNum("50000") === 50000);
ok("a real blow-out day is modellable", simNum("35000") === 35000);
ok("null/undefined are blank", simNum(null) === null && simNum(undefined) === null);

// ── 2. a blank day is the goal pace ─────────────────────────────────────────
{
  const only = [null, null, null, null, null, 3500, null];     // "Saturday is my big day"
  const wp = weekPlan(only, { fallback: 2000 });
  ok("blanks are priced at the pace, not at zero", wp.weekIntake === 2000 * 6 + 3500, wp.weekIntake);
  ok("...and NOT at the mean of the days that were typed", wp.weekIntake !== 3500 * 7);
  ok("one entry is counted as one", wp.enteredCount === 1);
  ok("the biggest day is the one that was typed", wp.hiIdx === 5);
  ok("...and the lightest is a blank day sitting on the goal", wp.loIdx === 0 && wp.effective[0] === 2000);
  ok("one heavy day against six normal ones IS a spread", wp.spread === true);
}
{
  const flat = weekPlan([null, null, null, null, null, null, null], { fallback: 2000 });
  ok("a flat week is not a spread", flat.spread === false);
}
{
  const wp = weekPlan([2000, 2000, 2000, 2000, 2000, 3500, 1500], { fallback: 2000 });
  ok("a full week sums", wp.weekIntake === 2000 * 5 + 3500 + 1500);
  ok("biggest is Sat", wp.hiIdx === 5);
  ok("lightest is Sun", wp.loIdx === 6);
  ok("that is a spread", wp.spread === true);
}
ok("a typed zero is an entry, not a blank", weekPlan([0, null, null, null, null, null, null], { fallback: 2000 }).enteredCount === 1);
ok("...and it is worth zero, not the fallback", weekPlan([0, null, null, null, null, null, null], { fallback: 2000 }).weekIntake === 2000 * 6);
ok("an empty week is seven pace days", weekPlan([], { fallback: 1800 }).weekIntake === 1800 * 7);
ok("junk input degrades to a pace week", weekPlan(null, { fallback: 1800 }).weekIntake === 1800 * 7);

// ── 3. the 1,200 floor, per day, never clamped ──────────────────────────────
{
  const wp = weekPlan([2100, 2100, 2100, 900, 900, 900, 2100], { fallback: 2000 });
  ok("the mean clears 1,200", Math.round(wp.weekIntake / 7) === 1586, Math.round(wp.weekIntake / 7));
  ok("...but the three low days are still named", wp.lowDays.join(",") === "3,4,5", wp.lowDays);
  ok("what the user typed is NEVER clamped up to the floor", wp.effective[3] === 900);
  ok("the days read as English", joinDays(wp.lowDays, DAY_SHORT) === "Thu, Fri and Sat");
}
ok("exactly 1,200 is not a violation", weekPlan([1200, 1200, 1200, 1200, 1200, 1200, 1200], { fallback: 2000 }).lowDays.length === 0);
ok("blank days count against the floor when the pace itself is at it",
   weekPlan([null, null, null, null, null, null, 900], { fallback: 1100 }).lowDays.length === 7);
ok("joinDays: one day", joinDays([3], DAY_SHORT) === "Thu");
ok("joinDays: two days", joinDays([3, 5], DAY_SHORT) === "Thu and Sat");
ok("joinDays: all seven collapses", joinDays([0, 1, 2, 3, 4, 5, 6], DAY_SHORT) === "every day");
ok("joinDays: nothing is nothing", joinDays([], DAY_SHORT) === "");

// ── 4. ONE LADDER: the sandbox's chips and the plan's target ────────────────
// ⚠️ `simIntakeForRate` EXISTS ONLY BECAUSE A {type:"manual"} SESSION PRICES TO
// ZERO THROUGH THE SHARED HELPERS, so the sandbox cannot hand a copy of the plan
// to `planIntakeForRate`. Everything else about it must be identical — and the
// only way to know that is to run both.
const P = (over = {}) => ({
  gender: "female", age: 35, heightFt: 5, heightIn: 6, weightLbs: 170,
  activityLevel: "moderate", weeklyRate: 1,
  strength: { Monday: [{ type: STRENGTH_ID, duration: 60 }], Wednesday: [{ type: STRENGTH_ID, duration: 60 }] },
  cardio: { Tuesday: [{ type: CARDIO_ID, duration: 45 }], Saturday: [{ type: CARDIO_ID, duration: 30 }] },
  ...over,
});
const PLANS = [
  ["eat-back, cardio + strength", P()],
  ["accelerate, cardio + strength", P({ deficitMode: "accelerate" })],
  ["no training at all", P({ cardio: {}, strength: {} })],
  ["cardio only", P({ strength: {} })],
  ["strength only", P({ cardio: {} })],
  ["heart-rate cardio", P({ cardio: { Tuesday: [{ type: "hr", hr: 145, duration: 40 }] } })],
  ["legacy calPerMin custom cardio", P({ customExercises: [{ id: "cx2", type: "cardio", calPerMin: 9, met: 0, isCustom: true, label: "Y" }], cardio: { Monday: [{ type: "cx2", duration: 40 }] } })],
  ["met custom cardio (S183j+)", P({ customExercises: [{ id: "cx1", type: "cardio", met: 7, isCustom: true, label: "X" }], cardio: { Monday: [{ type: "cx1", duration: 45 }] } })],
  ["floor-bound small frame", P({ weightLbs: 105, heightFt: 4, heightIn: 11, age: 62, activityLevel: "sedentary", weeklyRate: 2 })],
  ["gaining", P({ weeklyRate: -1 })],
  ["no gender (planEnergy is lenient on purpose)", P({ gender: undefined })],
  ["a manual calorie target in force", P({ calorieTarget: 2000 })],
];
{
  let bad = null, n = 0;
  for (const [name, d] of PLANS) {
    const burn = M.planEnergy(d).weeklyBurn;
    for (const r of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
      n++;
      const a = M.simIntakeForRate(d, burn, r);
      const b = M.planIntakeForRate(d, r);
      if (a !== b) { bad = { name, r, sim: a, plan: b }; break; }
    }
    if (bad) break;
  }
  ok(`an untouched planner quotes the plan's own ladder, exactly (${n} rate × plan pairs)`, !bad, bad);
  // ...and therefore the plan's target, which six other surfaces read.
  for (const [name, d] of PLANS) {
    const t = M.computeClientCalories(d);
    if (!t || d.calorieTarget) continue;   // the manual-target plan answers a different question
    ok(`${name}: the sandbox's own-rate chip IS the plan target`,
       M.simIntakeForRate(d, M.planEnergy(d).weeklyBurn, d.weeklyRate) === t.target,
       { chip: M.simIntakeForRate(d, M.planEnergy(d).weeklyBurn, d.weeklyRate), target: t.target });
  }
}
// The floor and the raw number are separate readings of the same expression.
{
  const small = P({ weightLbs: 105, heightFt: 4, heightIn: 11, age: 62, activityLevel: "sedentary" });
  const burn = M.planEnergy(small).weeklyBurn;
  ok("a floor-bound rate reads below 1,200 raw", M.simRawIntakeForRate(small, burn, 2) < 1200);
  ok("...while the chip itself never goes below it", M.simIntakeForRate(small, burn, 2) === 1200);
  ok("a comfortable rate is not floored", M.simRawIntakeForRate(small, burn, 0) >= 1200);
  ok("an unusable plan reads null rather than a number", M.simRawIntakeForRate({}, 0, 1) === null);
  ok("...and the chip degrades to 0, not to 1,200", M.simIntakeForRate({}, 0, 1) === 0);
  // ⚠️ NEGATIVE CONTROL: flooring before the comparison is exactly the S215
  // ladder bug, and it would silently stop the "floored" label ever appearing.
  const preFloored = (d2, b, r) => Math.max(1200, M.simRawIntakeForRate(d2, b, r));
  ok("control: pre-flooring would hide every floored rate", preFloored(small, burn, 2) >= 1200 && M.simRawIntakeForRate(small, burn, 2) < 1200);
}

// ── 5. seeding the planner must not double-count the plan's own training ────
// ⚠️ THE BUG THE SEEDING INVITES. The planner starts from data.cardio so it
// opens on reality — but in eat-back mode `intakeFor` ALREADY carries the whole
// week's training spread over seven days. Subtracting the planner's burn again
// would make a plan set to 1 lb/wk claim ~1.8 the moment the modal opened, with
// nothing on screen touched.
{
  // The shipping line, lifted rather than retyped.
  ok("the burn the engine subtracts is gated on the mode",
     /const burnWeek = eatback \? 0 : trainWeek;/.test(SIM_CODE));
  // ⚠️ AND IT IS THE WEEK, NOT A ROUNDED DAY TIMES SEVEN. Rounding first put
  // "Cardio this week 684" a hundred pixels above "Training burns (week) −686"
  // — two numbers for the same sessions inside one card.
  ok("...and it is the true week", /const weekBalance = weekIntake - burnWeek - maintain \* 7;/.test(SIM_CODE));
  ok("...the per-day figure is a rounding OF it, not the other way round",
     /const burnPerDay = Math\.round\(burnWeek \/ 7\);/.test(SIM_CODE));
  const engine = new Function("weekIntake", "burnWeek", "maintain", "CAL_PER_LB", `
    ${SIM_CODE.match(/const weekBalance = [^\n]*/)[0]}
    ${SIM_CODE.match(/const balance = weekBalance \/ 7;/)[0]}
    ${SIM_CODE.match(/const lbsIn = \(days\) => [^;]*;/)[0]}
    ${SIM_CODE.match(/const dir = balance [^\n]*/)[0]}
    return { balance, dir, lbs: [7, 14, 30, 60].map(lbsIn) };
  `);
  const project = (d, rate, week, doubleCount) => {
    const trainWeek = M.simWeekBurn(week, Number(d.weightLbs), d, d)
      + M.planEnergy({ ...d, cardio: {} }).weeklyBurn;
    const intakeFor = (r) => M.simIntakeForRate(d, trainWeek, r);
    const burnWeek = doubleCount ? trainWeek : (M.isEatback(d) ? 0 : trainWeek);
    const pace = intakeFor(rate);
    return engine(pace * 7, burnWeek, intakeFor(0), CAL_PER_LB);
  };
  for (const rate of [0.5, 1, 2]) {
    const d = P({ weeklyRate: rate });
    const got = project(d, rate, M.seedSimCardio(d.cardio), false);
    ok(`eat-back, untouched planner, ${rate} lb/wk: the projection IS that pace`,
       Math.abs(got.lbs[0] - rate) < 0.01, { rate, week: got.lbs[0] });
    const dbl = project(d, rate, M.seedSimCardio(d.cardio), true);
    ok(`control: double-counting the seeded week really does overstate ${rate} lb/wk`,
       Math.abs(dbl.lbs[0] - rate) > 0.2, { rate, week: dbl.lbs[0] });
  }
  // ⚠️ AND EAT-BACK MUST STAY FLAT WHEN CARDIO IS ADDED — that is what eat-back
  // MEANS. The target rises, the pace does not.
  {
    const d = P();
    const seeded = M.seedSimCardio(d.cardio);
    const heavier = { ...seeded, Thursday: [{ type: CARDIO_ID, duration: 60 }] };
    const a = project(d, 1, seeded, false), b = project(d, 1, heavier, false);
    ok("eat-back: more cardio does not change the projected pace", Math.abs(a.lbs[0] - b.lbs[0]) < 0.02, { a: a.lbs[0], b: b.lbs[0] });
    const tA = M.simIntakeForRate(d, M.simWeekBurn(seeded, 170, d, d) + M.planEnergy({ ...d, cardio: {} }).weeklyBurn, 1);
    const tB = M.simIntakeForRate(d, M.simWeekBurn(heavier, 170, d, d) + M.planEnergy({ ...d, cardio: {} }).weeklyBurn, 1);
    ok("...it raises what you can eat instead", tB > tA, { tA, tB });
  }
  // ⚠️ ACCELERATE IS THE OTHER WAY ROUND: the food target holds and the week
  // comes off the deficit. This is the arithmetic SummaryTab dates the
  // accelerate goal with (rate × 3500 + the whole weekly burn).
  {
    const d = P({ deficitMode: "accelerate" });
    const seeded = M.seedSimCardio(d.cardio);
    const heavier = { ...seeded, Thursday: [{ type: CARDIO_ID, duration: 60 }] };
    const a = project(d, 1, seeded, false), b = project(d, 1, heavier, false);
    ok("accelerate: more cardio DOES speed the projection up", b.lbs[0] > a.lbs[0] + 0.05, { a: a.lbs[0], b: b.lbs[0] });
    const burn = M.planEnergy(d).weeklyBurn;
    ok("...and the food target does not move", M.simIntakeForRate(d, burn, 1) === M.simIntakeForRate(d, burn * 3, 1));
    ok("...the whole week is counted, strength included",
       Math.abs(a.lbs[0] - (1 + M.planEnergy(d).weeklyBurn / CAL_PER_LB)) < 0.05,
       { got: a.lbs[0], want: 1 + M.planEnergy(d).weeklyBurn / CAL_PER_LB });
  }
}

// ── 6. the engine itself is unchanged ───────────────────────────────────────
// Dropping the two scalar modes removed two ways of SAYING the same sum, not a
// second sum. The lifted lines still have to behave like the scalar engine that
// shipped.
{
  const engine = new Function("weekIntake", "burnWeek", "maintain", "CAL_PER_LB", `
    ${SIM_CODE.match(/const weekBalance = [^\n]*/)[0]}
    ${SIM_CODE.match(/const balance = weekBalance \/ 7;/)[0]}
    ${SIM_CODE.match(/const lbsIn = \(days\) => [^;]*;/)[0]}
    ${SIM_CODE.match(/const dir = balance [^\n]*/)[0]}
    return { balance, dir, lbs: [7, 14, 30, 60].map(lbsIn) };
  `);
  let mismatch = null, n = 0;
  for (const maintain of [1200, 1850, 2437, 3011]) {
    for (const burnWeek of [0, 259, 684, 1498, 3500, 8638]) {
      for (let intake = 800; intake <= 6000; intake += 1) {
        const got = engine(intake * 7, burnWeek, maintain, CAL_PER_LB);
        const want = intake - burnWeek / 7 - maintain;                // one week, divided once
        n++;
        if (Math.abs(got.balance - want) > 1e-9) { mismatch = { intake, burnWeek, maintain, got: got.balance, want }; break; }
        const wantDir = want < -20 ? "lose" : want > 20 ? "gain" : "hold";
        if (got.dir !== wantDir) { mismatch = { intake, burnWeek, maintain, dir: got.dir, wantDir }; break; }
        const wantLbs = [7, 14, 30, 60].map((days) => (-want * days) / CAL_PER_LB);
        if (got.lbs.some((v, i) => Math.abs(v - wantLbs[i]) > 1e-9)) { mismatch = { intake, burnWeek, maintain, lbs: got.lbs, wantLbs }; break; }
      }
      if (mismatch) break;
    }
    if (mismatch) break;
  }
  ok(`the SHIPPED weekly engine divides one week once (${n.toLocaleString()} combinations)`, !mismatch, mismatch);
  // ⚠️ NEGATIVE CONTROL: the rounding this replaced. It is invisible on a burn
  // that divides by seven and 2 cal out on one that does not — which is exactly
  // how it survived a reading.
  const rounded = (intake, burnWeek, maintain) => intake - Math.round(burnWeek / 7) - maintain;
  ok("control: rounding to a per-day scalar first really does drift",
     rounded(2569, 684, 3069) !== engine(2569 * 7, 684, 3069, CAL_PER_LB).balance
     && rounded(2569, 700, 3069) === engine(2569 * 7, 700, 3069, CAL_PER_LB).balance);
  ok("the intake shown per day is the week divided back down", /const intake = Math\.round\(weekIntake \/ 7\);/.test(SIM_CODE));
  // ⚠️ AND THE WEEK THE ANSWER PRINTS IS THE WEEK SECTION 2 PRINTS.
  ok("the burn row quotes the planner's own week", /−\{burnWeek\.toLocaleString\(\)\} cal/.test(SIM_CODE));
  ok("...and the net subtracts the same figure", /\{\(weekIntake - burnWeek\)\.toLocaleString\(\)\} cal/.test(SIM_CODE));
}

// ── 7. the planner is SEEDED from the plan, and cannot write back to it ─────
{
  const plan = { Monday: [{ type: CARDIO_ID, duration: 45 }], Thursday: [{ type: "hr", hr: 150, duration: 30 }] };
  const seeded = M.seedSimCardio(plan);
  ok("every weekday exists in the seed", M.DAYS.every((day) => Array.isArray(seeded[day])));
  ok("a rest day seeds as an empty list", seeded.Tuesday.length === 0);
  ok("the plan's real sessions come through", seeded.Monday[0].type === CARDIO_ID && seeded.Monday[0].duration === 45);
  ok("...heart-rate ones too, shape intact", seeded.Thursday[0].hr === 150);
  // ⚠️ DEEP, NOT SHALLOW. A shared session object would let an edit inside this
  // modal reach data.cardio by reference — the promise in the subtitle broken by
  // a different route than a setter.
  ok("the seeded sessions are COPIES", seeded.Monday[0] !== plan.Monday[0]);
  seeded.Monday[0].duration = 90;
  seeded.Tuesday.push({ type: CARDIO_ID, duration: 20 });
  ok("...so editing the sandbox does not touch the plan", plan.Monday[0].duration === 45 && !plan.Tuesday);
  ok("junk seeds a clean rest week", M.DAYS.every((day) => M.seedSimCardio(null)[day].length === 0));
  // Nothing in the modal may call the plan's writer.
  ok("nothing in the simulator writes to the plan", !/onChange\(/.test(SIM_CODE));
  ok("...and no cardio setter is threaded in", !/onSetCardio|setData|onSave/.test(SIM_CODE));
  ok("the sandbox still promises it changes nothing", /Nothing here changes your plan/.test(SIM_CODE));
  ok("...and says so again where the planner lives", /your plan stays exactly as it is/.test(SIM_CODE));
}

// ── 8. the manual-calorie session — a third shape, priced here ──────────────
// Kevin: "only thing we will need is a manual calorie entry option for the
// exercise options right under the heart rate section so we can just manually
// type the calorie burn we want."
{
  const d = P();
  const wLbs = 170;
  ok("a manual session is worth exactly what was typed",
     M.simSessionBurn({ type: M.SIM_MANUAL, cal: 400 }, wLbs, d, d) === 400);
  ok("...a typed string too", M.simSessionBurn({ type: M.SIM_MANUAL, cal: "400" }, wLbs, d, d) === 400);
  ok("...and a blank is zero, not NaN", M.simSessionBurn({ type: M.SIM_MANUAL, cal: "" }, wLbs, d, d) === 0);
  ok("...a rejected number is zero, not Infinity", M.simSessionBurn({ type: M.SIM_MANUAL, cal: "1e400" }, wLbs, d, d) === 0);
  // ⚠️ THIS IS WHY IT CANNOT GO THROUGH THE SHARED HELPERS. cardioExFor falls
  // back to the Rest Day entry for an id it does not know, and exBurn then reads
  // zero — the session would silently cost nothing.
  ok("control: the shared helpers really do price a manual session at zero",
     M.exBurn(M.cardioExFor({ type: M.SIM_MANUAL, cal: 400 }, d), wLbs, 30, d) === 0);
  ok("a rest session is zero", M.simSessionBurn({ type: "rest", duration: 60 }, wLbs, d, d) === 0);
  ok("junk is zero", M.simSessionBurn(null, wLbs, d, d) === 0 && M.simSessionBurn(undefined, wLbs, d, d) === 0);
  ok("a real exercise still prices through exBurn",
     M.simSessionBurn({ type: CARDIO_ID, duration: 45 }, wLbs, d, d)
       === M.exBurn(M.cardioExFor({ type: CARDIO_ID, duration: 45 }, d), wLbs, 45, d));
  // ⚠️ THE AGE FALLBACK BELONGS TO THE RESOLVER, NOT TO exBurn (S213). A missing
  // age makes hrCaloriesPerMin return 0, so the picker priced a session the
  // projection then counted at nothing; injecting the same age into exBurn's MET
  // path instead would move the burn on every age-less plan.
  const ageless = { ...P(), age: undefined, dob: undefined };
  const withAge = { ...ageless, age: 30 };
  const hrSess = { type: "hr", hr: 150, duration: 30 };
  ok("heart-rate cardio counts once an age is assumed", M.simSessionBurn(hrSess, 170, withAge, ageless) > 0);
  ok("control: without one it would count nothing", M.simSessionBurn(hrSess, 170, ageless, ageless) === 0);
  ok("the simulator passes the aged copy to the RESOLVER",
     (SIM_CODE.match(/simWeekBurn\(simCardio, w, hrAgeData, hrData\)/g) || []).length === 1);
  ok("...and to every per-day and per-session pricing call",
     (SIM_CODE.match(/simDayBurn\(sessions, w, hrAgeData, hrData\)/g) || []).length === 1
     && (SIM_CODE.match(/simSessionBurn\(sess, w, hrAgeData, hrData\)/g) || []).length === 1);
  ok("...and the MET path is still left alone", !/exBurn\([^)]*hrAgeData\)/.test(SIM_CODE));
}
{
  const d = P();
  const week = { Monday: [{ type: CARDIO_ID, duration: 30 }, { type: M.SIM_MANUAL, cal: 250 }],
    Wednesday: [{ type: M.SIM_MANUAL, cal: 400 }], Friday: [] };
  const mon = M.simDayBurn(week.Monday, 170, d, d);
  ok("a day sums its sessions", mon === M.simSessionBurn(week.Monday[0], 170, d, d) + 250, mon);
  ok("a rest day is zero", M.simDayBurn(week.Friday, 170, d, d) === 0);
  ok("a missing day is zero, not a crash", M.simDayBurn(undefined, 170, d, d) === 0);
  ok("the week sums its days", M.simWeekBurn(week, 170, d, d) === mon + 400);
  ok("an empty week is zero", M.simWeekBurn({}, 170, d, d) === 0 && M.simWeekBurn(null, 170, d, d) === 0);
  // Only the seven real weekdays count — a stray key cannot inflate the week.
  ok("a stray key is ignored", M.simWeekBurn({ ...week, Someday: [{ type: M.SIM_MANUAL, cal: 9999 }] }, 170, d, d) === mon + 400);
}

// ── 9. minus signs on the loss paces (Kevin's first ask) ────────────────────
// ⚠️ THE SANDBOX HAD REINTRODUCED THE LAYOUT THE DASHBOARD CARD ALREADY
// REJECTED: one flat row with loss unsigned and gain "+"-prefixed, so
// "2 lbs/wk" and "+1 lb/wk" sat side by side meaning opposite things.
{
  const loss = M.SIM_RATES.filter((t) => t.group === "loss");
  const gain = M.SIM_RATES.filter((t) => t.group === "gain");
  const maint = M.SIM_RATES.filter((t) => t.group === "maintain");
  ok("three losing paces, three gaining, one maintenance", loss.length === 3 && gain.length === 3 && maint.length === 1);
  ok("every losing pace carries a minus", loss.every((t) => t.sign === "−"), loss.map((t) => t.sign));
  ok("every gaining pace carries a plus", gain.every((t) => t.sign === "+"));
  ok("maintenance carries neither", maint[0].sign === "");
  ok("a losing pace is a POSITIVE rate (the deficit direction)", loss.every((t) => t.rate > 0));
  ok("a gaining pace is a negative one", gain.every((t) => t.rate < 0));
  ok("both directions offer the same three sizes",
     loss.map((t) => Math.abs(t.rate)).join() === gain.map((t) => Math.abs(t.rate)).join());
  ok("the sandbox offers exactly the plan's rates",
     M.SIM_RATES.map((t) => t.rate).sort((a, b) => a - b).join() === [...RATE_OPTS_FROM_APP].sort((a, b) => a - b).join(),
     M.SIM_RATES.map((t) => t.rate));
  // The sign is rendered, and rendered bigger than the words beside it — the
  // same anatomy as the card that opens this modal.
  ok("the sign is rendered from the table, not from a label", /\{t\.sign \? <span/.test(SIM_CODE));
  ok("...and the direction is also stated as a heading",
     /rateHeading\("Weight loss"\)/.test(SIM_CODE) && /rateHeading\("Weight gain"\)/.test(SIM_CODE));
  // ⚠️ AND THE OLD UNSIGNED LABELS MUST BE GONE. RATE_SHORT renders loss with no
  // sign at all; leaving one call behind puts the rejected layout back on screen.
  ok("no unsigned RATE_SHORT label is left in the simulator", !/RATE_SHORT/.test(SIM_CODE));
}

// ── 10. one page, not three tabs (Kevin's fifth ask) ────────────────────────
ok("the mode toggle is gone", !/setMode\(/.test(SIM_CODE) && !/const \[mode, setMode\]/.test(SIM_CODE));
ok("...and so are its three labels", !/Pick a pace/.test(SIM_CODE) && !/One number/.test(SIM_CODE) && !/Day by day/.test(SIM_CODE));
ok("the one-number slot is gone", !/customIntake/.test(SIM_CODE));
// ⚠️ THE CAPABILITY STAYS, THE TAB GOES. "One number" meant "assume I eat the
// same N every day" — the fastest way to answer "what if I just ate 2,000 flat?"
// Kevin not recognising the label is the verdict on the label, not on the
// feature, so it is now an action that fills the seven boxes.
ok("...replaced by an action that fills all seven days", /const applyEveryDay = /.test(SIM_CODE));
ok("...which is explained rather than named", /Same every day\?/.test(SIM_CODE) && /put it on all seven days/.test(SIM_CODE));
ok("...and it really writes seven days",
   /setWeekCals\(\["", "", "", "", "", "", ""\]\.map\(\(\) => String\(everyDayNum\)\)\)/.test(SIM_CODE));
ok("...and refuses a number the parser threw away", /disabled=\{everyDayNum === null\}/.test(SIM_CODE));

// ── 11. "how often" and "also burned" are gone (Kevin's fourth ask) ─────────
// "we can remove the how often and also burned section because now that we will
// be using the full weekly cardio plan screen that will be how we manage all of
// the calorie for the week."
ok("the how-often select is gone", !/daysPerWeek/.test(SIM_CODE));
ok("the extra-burn field is gone", !/extraBurn/.test(SIM_CODE));
ok("...and neither label survives", !/how often/.test(SIM_CODE) && !/also burned/.test(SIM_CODE));
ok("the single-session picker it fed is gone too", !/const \[session, setSession\]/.test(SIM_CODE));

// ── 12. a full weekly cardio planner, inside the modal ──────────────────────
ok("all seven days are listed", (SIM_CODE.match(/DAYS\.map\(/g) || []).length >= 2);
ok("each day opens on its own", /const \[openDay, setOpenDay\]/.test(SIM_CODE));
// ⚠️ A REAL <button>, NOT A DIV WITH role="button". StepCardio's day header is a
// div; copying it would have announced a button that keyboard focus can never
// reach, which is worse than no role at all.
ok("the day header is focusable, not a div wearing a role",
   /<button type="button" style=\{dayHeadS\}/.test(SIM_CODE) && !/role="button"/.test(SIM_CODE));
ok("quick fill is at the top", SIM_CODE.indexOf("Quick Fill") < SIM_CODE.indexOf("const sessions = Array.isArray(simCardio[day])"));
ok("quick fill applies to the days that were picked", /const applyFill = /.test(SIM_CODE) && /toggleFillDay/.test(SIM_CODE));
ok("...with the wizard's presets", /"MWF"/.test(SIM_CODE) && /"All 7"/.test(SIM_CODE));
ok("...and it refuses to apply to no days", /const fillReady = fillDays\.length > 0/.test(SIM_CODE));
// ⚠️ COUNTED, NOT FOUND. The manual option has THREE homes — the quick-fill
// chooser and both branches of the per-day editor (from an exercise, and from
// heart rate). A `.test()` stays green when two of them are dropped.
ok("the manual-calorie option is offered in quick fill AND in both per-day branches",
   (SIM_CODE.match(/Just type calories/g) || []).length === 3,
   (SIM_CODE.match(/Just type calories/g) || []).length);
ok("...and it sits beside the heart-rate control, as asked",
   /By heart rate<\/button>\s*<button onClick=\{\(\) => putSession\(day, idx, \{ type: SIM_MANUAL/.test(SIM_CODE.replace(/\s+/g, " ").replace(/> </g, "><"))
   || /By heart rate[\s\S]{0,200}type: SIM_MANUAL/.test(SIM_CODE));
ok("a manual session can be turned back into an exercise", (SIM_CODE.match(/Pick an exercise instead/g) || []).length === 2,
   (SIM_CODE.match(/Pick an exercise instead/g) || []).length);
ok("sessions can be added and removed per day", /const addSession = /.test(SIM_CODE) && /const removeSession = /.test(SIM_CODE));
// ⚠️ A BLANK MANUAL SESSION IS NOT A ZERO-CALORIE ONE. Reading "0 cal, typed in"
// back off a box nobody has filled in yet states something the person did not
// say, on the one shape whose whole point is that they say it.
ok("an unfilled manual session does not claim a zero",
   /typed === null \? "No calories typed yet"/.test(SIM_CODE));
ok("a day can be set back to rest", /const restDay = /.test(SIM_CODE) && /Set as rest day/.test(SIM_CODE));
ok("the planner can be put back to the plan's own week", /Back to my plan/.test(SIM_CODE) && /setSimCardio\(seedSimCardio\(seed\)\)/.test(SIM_CODE));
// ⚠️ A SESSION OBJECT, NOT AN ID — heart rate and manual are different SHAPES,
// so every switch REPLACES the whole object. Merging `type:"hr"` onto an
// exercise leaves a session that prices as neither.
ok("switching shape replaces the session", /const putSession = /.test(SIM_CODE));
ok("...and only the fields of one shape are patched in place", /const patchSession = /.test(SIM_CODE));
ok("the week's total and the daily goal are shown together",
   /Cardio this week/.test(SIM_CODE) && /Daily goal at this pace/.test(SIM_CODE));
// ⚠️ A ROW OF ORANGE ZEROES IS NOT A SUMMARY. Most plans open this modal with an
// empty cardio week, and "Cardio this week 0 cal · 0 a day" reads as a broken
// readout rather than as an invitation.
ok("...and an empty week says so in words instead of printing zeroes",
   /\{cardioWeek > 0 \? \(/.test(SIM_CODE) && /No cardio in this week yet/.test(SIM_CODE));

// ── 13. cardio only, with all of the same options ──────────────────────────
ok("the picker is the wizard's, in cardio mode", (SIM_CODE.match(/kind="cardio"/g) || []).length === 2,
   (SIM_CODE.match(/kind="cardio"/g) || []).length);
ok("strength groups are gone from the simulator", !/STRENGTH_GROUPS/.test(SIM_CODE));
// ⚠️ THE EASY MISS. Dropping the STRENGTH_GROUPS spread while leaving the
// custom-strength line keeps every user-created lift reachable under "Custom".
ok("...and so are custom STRENGTH exercises", !/customOf\(d\.customExercises, "strength"\)/.test(SIM_CODE));
ok("the plan's custom CARDIO is still threaded in", (SIM_CODE.match(/customExercises=\{d\.customExercises\}/g) || []).length === 2);
ok("heart-rate mode is reachable from the sheet", /onPickHr=\{/.test(SIM_CODE));
ok("...and from the link beside the label", /By heart rate/.test(SIM_CODE));
ok("the heart-rate picker itself is rendered", /<HeartRatePicker/.test(SIM_CODE));
ok("durations are the wizard's list, not a free-text box", (SIM_CODE.match(/DURATIONS\.map/g) || []).length === 2);
ok("the old native optgroup select is gone", !/<optgroup/.test(SIM_CODE));
// CustomExerciseCreator WRITES to the plan; this modal promises it writes nothing.
ok("the plan-writing custom-exercise creator is NOT ported", !/CustomExerciseCreator/.test(SIM_CODE));

// ── 13b. the two duration lists still do not match ─────────────────────────
// HeartRatePicker offers a 5-minute chip; the exercise <select> (DURATIONS)
// starts at 10. Carrying a 5 across leaves the select with no matching option,
// so React selects the first — showing "10 minutes" while computing on 5.
{
  const src = liftDecl(APP, "toDuration");
  ok("the duration snap exists", /DURATIONS\.reduce/.test(src));
  const toDuration = new Function(`const DURATIONS = [10,15,20,25,30,35,40,45,50,60,75,90]; ${src}; return toDuration;`)();
  ok("5 minutes snaps to the nearest offered length", toDuration(5) === 10);
  ok("an offered length is untouched", toDuration(45) === 45 && toDuration(90) === 90);
  ok("every HR chip lands on a real option",
     [5, 10, 15, 20, 30, 40, 45, 60, 75, 90].every((m) => [10,15,20,25,30,35,40,45,50,60,75,90].includes(toDuration(m))));
  // ⚠️ COUNTED. Both ways out of heart-rate mode go through the snap: the
  // "Pick an exercise instead" link and the picker's own onChange.
  ok("both ways out of heart-rate mode go through it",
     (SIM_CODE.match(/toDuration\(Number\(sess\.duration\) \|\| 30\)/g) || []).length === 2,
     (SIM_CODE.match(/toDuration\(Number\(sess\.duration\) \|\| 30\)/g) || []).length);
}

// ── 14. the number sat under the spinner arrows (Kevin's third ask) ────────
// "in the text box the numbers are way too close to the arrows, can we move the
// numbers over to the left a little bit." The browser draws the up/down arrows
// INSIDE the box at the right edge, on top of the padding, so a right-aligned
// number with 10px of it was underneath them.
{
  const decl = SIM_CODE.match(/const numInput = \{[^}]*\};/);
  ok("there is one shared numeric-input style", !!decl);
  const pad = decl[0].match(/padding:\s*"([^"]+)"/);
  ok("...and it sets its own padding", !!pad, decl[0]);
  const [top, right, bottom, left] = pad[1].split(/\s+/);
  ok("...right-aligned text is pushed clear of the spinner", parseFloat(right) >= 26, pad[1]);
  ok("...and it is the RIGHT side that grew, not the left", parseFloat(right) > parseFloat(left), pad[1]);
  ok("...vertical padding is unchanged", top === "9px" && bottom === "9px", pad[1]);
  ok("the style is right-aligned, which is what makes the padding matter", /textAlign: "right"/.test(decl[0]));
  // ⚠️ COUNTED, NOT FOUND. FOUR number boxes take a right-aligned figure — the
  // seven day inputs, "set every day to", quick fill's calories, and a per-day
  // manual session. Fixing one and leaving three is the shape check:weak exists
  // to catch.
  ok("every numeric box in the modal uses it", (SIM_CODE.match(/\.\.\.numInput/g) || []).length === 4,
     (SIM_CODE.match(/\.\.\.numInput/g) || []).length);
  // ⚠️ ONE right-aligned style, and it is `numInput`'s own declaration. A
  // second `{...input, textAlign:"right"}` anywhere else is a box that kept the
  // 10px padding and put its digits back under the arrows.
  ok("...and no second right-aligned style was hand-rolled beside it",
     (SIM_CODE.match(/\.\.\.input, textAlign: "right"/g) || []).length === 1,
     (SIM_CODE.match(/\.\.\.input, textAlign: "right"/g) || []).length);
  // Negative control: the style this replaced really did put the digits under
  // the arrows.
  const before = { padding: "9px 10px" };
  ok("control: the old style really did leave only 10px", parseFloat(before.padding.split(" ")[1]) < 26);
}

// ── 15. the screen ─────────────────────────────────────────────────────────
ok("the days run Monday first", /DAYS\.map\(\(dayName, i\)/.test(SIM_CODE) && /DAY_SHORT\[i\]/.test(SIM_CODE));
ok("a blank day shows the pace as its placeholder", /placeholder=\{paceTarget\.toLocaleString\(\)\}/.test(SIM_CODE));
ok("...and says so in words", /on your goal/.test(SIM_CODE));
ok("the week total is shown, not just the average", /for the week/.test(SIM_CODE));
// ⚠️ COUNTED. The "check this number" warning has FOUR homes now — one per
// numeric box — and `.test()` stayed green when one was reverted to "on your
// goal", silently replacing a typed surplus with its opposite.
ok("a refused number says so on every box that takes one",
   (SIM_CODE.match(/check this number/g) || []).length === 4,
   (SIM_CODE.match(/check this number/g) || []).length);
ok("...and the reset stays reachable when the only entry was refused",
   /const anyTyped = weekCals\.some/.test(SIM_CODE) && /disabled=\{!anyTyped\}/.test(SIM_CODE));
ok("the inputs' own max matches the parser's", (SIM_CODE.match(/max="50000"/g) || []).length === 4);
// ⚠️ ONE render site for the floor warning — two would let one of them drift.
ok("the 1,200 warning has exactly one render site",
   (SIM_CODE.match(/isn&rsquo;t healthy or sustainable/g) || []).length === 1,
   (SIM_CODE.match(/isn&rsquo;t healthy or sustainable/g) || []).length);
ok("...and it names the days", /joinDays\(wp\.lowDays, DAY_SHORT\)/.test(SIM_CODE));
// ⚠️ ASSERT THE GATE, NOT JUST THE BODY. Swapping the condition to judge the
// weekly MEAN keeps the day names in the source and hides three 900-calorie days
// behind a 1,586 average — the exact defect this suite claims to guard.
ok("the floor gate counts LOW DAYS, not the mean", /\{wp\.lowDays\.length > 0 && \(/.test(SIM_CODE));
ok("...and nothing judges the floor on an average", !/weekIntake \/ 7[^\n]*< 1200/.test(SIM_CODE));
ok("burn spreading is disclosed, not assumed", /Training is spread evenly across the week/.test(SIM_CODE));
// ── the day rows must agree with the headline ─────────────────────────────
ok("holding steady includes the burn the ladder has not already paid for", /const holdSteady = maintain \+ burnPerDay;/.test(SIM_CODE));
ok("...the row colours use it", /v < holdSteady - 20 \? "var\(--green\)" : v > holdSteady \+ 20/.test(SIM_CODE));
ok("...and so does the delta printed next to them",
   /Math\.abs\(val - holdSteady\) <= 20 \? "even"/.test(SIM_CODE)
   && /val > holdSteady \? "\+" : "−"/.test(SIM_CODE));
ok("...with no stray comparison against bare maintain left in the rows", !/val - maintain/.test(SIM_CODE));
ok("...and the caption says it out loud", /\{holdSteady\.toLocaleString\(\)\}/.test(SIM_CODE));
// ⚠️ WHERE THE TRAINING WENT HAS TO BE SAID. In eat-back mode it is inside the
// numbers rather than beside them, and a week of cardio that appears to change
// nothing looks broken until somebody says why.
ok("the answer explains eat-back and accelerate differently",
   /Your plan eats the training back/.test(SIM_CODE) && /Your plan does not eat the training back/.test(SIM_CODE));
ok("the burn row only appears when there is a burn to subtract", /\{burnWeek > 0 && \(/.test(SIM_CODE));
// The destructive controls are the two explicit ones and nothing else.
ok("only the reset clears the week", (SIM_CODE.match(/setWeekCals\(\["", "", "", "", "", "", ""\]\)/g) || []).length === 1);
ok("nothing resets a slot when something else changes", !/useEffect\([\s\S]{0,400}\[(rate|simCardio)\]\)/.test(SIM_CODE));
ok("the exercise sheet's Back does not close the whole simulator", /if \(sheetCount > 0\) return;/.test(SIM_CODE));
// ⚠️ Extended_Pictographic covers the ones this repo actually ships — ⭐ ⏳ ⏱ ⓘ.
ok("no emoji in the new UI", !/\p{Extended_Pictographic}/u.test(SIM_CODE),
   (SIM_CODE.match(/\p{Extended_Pictographic}/gu) || []).join(""));
// ⚠️ INLINE STYLES, NOT THE WIZARD'S TAILWIND CLASSES. This modal is portalled
// to document.body, OUTSIDE every data-theme="pro" wrapper, so WZW's
// bg-surface2 / text-fg resolve against the LIGHT default palette and render
// white-on-black (the S27 trap).
ok("the planner does not borrow the wizard's Tailwind classes", !/WZW\.|WZ\.|wzFillDay|wzPreset/.test(SIM_CODE));
ok("...it mirrors them with the legacy tokens instead", /const dayCardS = /.test(SIM_CODE) && /var\(--s2\)/.test(SIM_CODE));

// ── 16. the white screen must not come back ────────────────────────────────
// ⚠️ THIS IS THE ONLY GUARD. `npm run check:undef` collects `no-undef` and the
// binding IS declared — just, until S213, fourteen lines too late.
{
  const refDecl = SIM.indexOf("const refEx");
  const perMin = SIM.indexOf("const perMin");
  const use = SIM.indexOf("const muMinutes");
  ok("refEx is declared", refDecl > 0);
  ok("perMin is declared", perMin > refDecl);
  ok("muMinutes reads them BOTH after they exist (the S200r white screen)", refDecl < use && perMin < use, { refDecl, perMin, use });
  const muDecl = SIM.indexOf("const mu = muPicked");
  ok("...and `mu` too", muDecl > 0 && muDecl < use);
}
ok("the make-up minutes no longer divide by a floored-to-1 burn", !/Math\.max\(1, exBurn/.test(SIM_CODE));
ok("...it refuses instead when the burn is zero", /perMin > 0 \? Math\.round\(mu\.burnPerDay \/ perMin\)/.test(SIM_CODE));
// The reference session comes from the WEEK now, not from a single picker that
// no longer exists — and a manual entry has no minutes to quote.
ok("the minutes reference comes from the planner's week", /const refSession = /.test(SIM_CODE));
ok("...and skips rest days and typed-in calories",
   /s\.type !== "rest" && s\.type !== SIM_MANUAL/.test(SIM_CODE));
// ── 17. make up a big day is kept, and still judged against the PLAN ───────
ok("the make-up section survives", /Make up a big day/.test(SIM_CODE) && /makeUpPlan\(/.test(SIM_CODE));
ok("the split slider survives", /How to split the work/.test(SIM_CODE) && /% training/.test(SIM_CODE));
ok("the floor disclosure survives", /moved to training/.test(SIM_CODE));
// ⚠️ THE REAL PLAN'S TARGET, NOT THE SANDBOX'S. Re-pricing history against a
// week somebody is imagining would judge their February against tonight's
// daydream.
ok("over-days are measured against the plan's real target",
   /const planTarget = \(computeClientCalories\(d\) \|\| \{\}\)\.target \|\| 0;/.test(SIM_CODE));
ok("...and the screen says which number that is", /the same\s*\n?\s*one the calendar colours your days with/.test(SIM_CODE));
ok("...and the sandbox's own chips do NOT feed it", !/overDaysFrom\(dayCalsAll, paceTarget/.test(SIM_CODE));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  What if…: one page, one ladder, a week that changes nothing.\n");
