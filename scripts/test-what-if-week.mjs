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
  "ACTIVITY_LEVELS", "MIN_DAILY_CAL", "HR_ZONES", "RATE_OPTS", "OVER_TOLERANCE", "CAL_PER_LB", "SIM_MANUAL", "SIM_RATES", "SIM_HORIZONS"];
const FNS = ["calcBMR", "ageFromDob", "effectiveAge", "customOf", "findCardioEx", "hrCaloriesPerMin",
  "restingKcalPerMin", "calcBurn", "cardioExFor", "exBurn", "isEatback", "dailyDeficitOf", "weeklyRateOf",
  "planEnergy", "planIntakeForRate", "computeClientCalories",
  "simNum", "simRejected", "weekPlan", "joinDays",
  "seedSimCardio", "simSessionBurn", "simDayBurn", "simWeekBurn", "simRawIntakeForRate", "simIntakeForRate", "simBudgetRows", "simBankRows", "simHoldDay", "simProject",
  "ymdLocal", "simWeekdayIdx", "simDateAt", "simScenarioDay"];
const EXPORTS = ["simNum", "simRejected", "weekPlan", "joinDays", "seedSimCardio", "simSessionBurn",
  "simDayBurn", "simWeekBurn", "simRawIntakeForRate", "simIntakeForRate", "simBudgetRows", "simBankRows", "simHoldDay", "planEnergy",
  "planIntakeForRate", "computeClientCalories", "cardioExFor", "exBurn", "isEatback", "SIM_RATES",
  "SIM_MANUAL", "MIN_DAILY_CAL", "CAL_PER_LB", "DAYS", "DAY_SHORT", "atLeastMinCal", "simProject",
  "simWeekdayIdx", "simDateAt", "simScenarioDay", "SIM_HORIZONS"];
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
// ── 3 · The daily budget (S219, Kevin) ──────────────────────────────────────
// "Think about someone's daily calorie intake as their budget … food … expenses
// … exercise … extra income."
//
// The budget is a DECOMPOSITION of simIntakeForRate, so the only two things that
// can go wrong are arithmetic ones, and both are silent: the rows stop adding up,
// or the total forks from the number every other surface prints. Swept, not
// spot-checked — and simBudgetRows is LIFTED AND RUN, not retyped (S199k).
{
  let notClosing = null, forked = null, badFloor = null, phantom = null, n = 0;
  for (const [name, d] of PLANS) {
    const planBurn = M.planEnergy(d).weeklyBurn;
    for (const burn of [0, planBurn, 1200, 4200]) {
      for (const r of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
        for (const ov of [undefined, 1800, 2400, 3600]) {
          n++;
          const b = M.simBudgetRows(d, burn, r, ov);
          // 1. the ledger adds up, every time
          if (b.tdee - b.cut + b.train !== b.sub) notClosing = { name, burn, r, ov, ...b };
          // 2. and its total is the SAME call every other surface makes
          const canon = M.simIntakeForRate(d, burn, r, ov);
          if (b.budget !== canon) forked = { name, burn, r, ov, budget: b.budget, canon };
          // 3. the floor is applied at the end and flagged, never silently
          if (b.budget !== Math.max(M.MIN_DAILY_CAL, b.sub)) badFloor = { name, r, ...b };
          if (b.floored !== (b.sub < M.MIN_DAILY_CAL)) badFloor = { name, r, flag: b.floored, sub: b.sub };
          // 4. ⚠️ IN ACCELERATE MODE TRAINING IS NOT INCOME. Printing a positive
          //    row there would misstate the prescription — that mode's promise is
          //    that the burn buys the goal DATE, not food.
          if (!M.isEatback(d) && b.train !== 0) phantom = { name, burn, r, train: b.train };
          if (notClosing || forked || badFloor || phantom) break;
        }
        if (notClosing || forked || badFloor || phantom) break;
      }
      if (notClosing || forked || badFloor || phantom) break;
    }
    if (notClosing || forked || badFloor || phantom) break;
  }
  ok(`the budget ledger always adds up (${n} plan × burn × rate × override cases)`, !notClosing, notClosing);
  ok("...and its total never forks from simIntakeForRate", !forked, forked);
  ok("...the 1,200 floor lands on the total and is flagged, never silent", !badFloor, badFloor);
  ok("...and accelerate mode shows no training income at all", !phantom, phantom);
}
{
  // In eat-back the training row IS the week spread over seven days — the number
  // the section claims to be showing.
  const d = PLANS.find(([nm]) => nm === "eat-back, cardio + strength")[1];
  let worst = 0;
  for (const burn of [0, 700, 1400, 2800, 4200]) {
    for (const r of [0, 0.5, 1, 2]) {
      const b = M.simBudgetRows(d, burn, r);
      worst = Math.max(worst, Math.abs(b.train - Math.round(burn / 7)));
    }
  }
  // ⚠️ WITHIN ONE CALORIE, NOT EQUAL. The row absorbs the rounding so the ledger
  // closes; that is the whole reason it is derived rather than computed.
  ok("eat-back's training row is the week over seven days, to the calorie", worst <= 1, worst);
  // Negative control: the naive row would NOT always close, or the derivation
  // above is decoration.
  let naiveBreaks = 0;
  for (const tdee of [1801, 2399.5, 2400.5, 3603]) {
    for (const burn of [1000, 1500, 2500]) {
      const cut = Math.round((1 * 3500) / 7);
      const sub = Math.round(tdee - cut + burn / 7);
      if (Math.round(tdee) - cut + Math.round(burn / 7) !== sub) naiveBreaks++;
    }
  }
  ok("(control) a naively-rounded training row really does fail to close", naiveBreaks > 0, naiveBreaks);
}
// ── The budget section's own wiring ─────────────────────────────────────────
// ⚠️ THE BUDGET MOUNTS THE REAL MealLog, IT DOES NOT REBUILD IT (S219b, Kevin:
// "I wanted to have everything that the regular meal logging section has except
// for the saved meals and the previously logged").
//
// ⚠️ AND REBUILDING IT HAD ALREADY COST A BUG. The hand-rolled search here had no
// sequence guard, so the slower of the two food providers re-opened the results
// list AFTER the user had added a food and watched it clear — measured live, eight
// buttons still up 2.5s later. MealLog has carried `searchSeqRef` for exactly that
// since S50. Reimplementing a solved component reintroduced its solved problem.
ok("the budget mounts the real MealLog with local handlers",
   /<MealLog meals=\{expenses\} onAddMeal=\{budAdd\} onAddMeals=\{budAddMany\}/.test(SIM_CODE)
   && /onRemoveMeal=\{budRemove\} onEditMeal=\{budEdit\} premium=\{premium\}/.test(SIM_CODE));
ok("...and no second food search was hand-rolled beside it",
   !/searchFoods\(/.test(SIM_CODE));
// ⚠️ THE RULE IS "NO WRITER", NOT "NO HISTORY" (S220, Kevin: "for a connected
// client I think we can allow the food previously logged section to be there …
// so they can look at things that they're eating, the things that they've
// tracked, to see how it affects their bank account"). His S219b instruction
// kept previously-logged out because this sheet must not SAVE anything — and
// READING that list does not save anything. What must never be threaded is a
// writer: FoodLibrary gates its star and delete controls on exactly these
// props, so their absence is the whole mechanism keeping the panel read-only.
ok("no writer into the real food history is threaded in, anywhere",
   !/onRemoveRecentFood=|savedFoods=|savedMeals=|onToggleSaveFood=|onToggleSaveMeal=|onRemoveSavedFood=|onRemoveSavedMeal=|onLogMeal=/.test(SIM_CODE));
// ⚠️ AND WHAT A TAPPED RECENT FEEDS IS LOCAL STATE. `budAdd` appends to
// `expenses`, which dies with the sheet — the real list is written by App's own
// onAddMeal, which this mount never uses.
ok("...so tapping a previously-logged food lands in local state only",
   (SIM_CODE.match(/<MealLog meals=\{expenses\} onAddMeal=\{budAdd\}/g) || []).length === 2
   && !/onAddMeal=\{(?!budAdd)/.test(SIM_CODE));
// ⚠️ THE BUDGET PANEL KEEPS ITS OPT-OUT; ONLY THE BANK PAGE OPENS THE DOOR, and
// only with a plan behind it — a standalone sandbox has no history to offer.
ok("previously-logged reaches the bank page, gated on there being a client",
   /recentFoods=\{standalone \? undefined : recentFoods\} hideLibrary \/>/.test(SIM_CODE));
// ⚠️ AND THE HEADER "Library" PILL STAYS HIDDEN ON BOTH PANELS. It opens the
// whole saved library unscoped, which is the half Kevin did not ask for; the
// in-form "Previously logged" button is a different control, gated only on
// having something to show. Both mounts therefore keep hideLibrary.
ok("...without reopening the saved library pill",
   (SIM_CODE.match(/<MealLog [^>]*hideLibrary \/>/g) || []).length === 2
   && !/hideLibrary=\{/.test(SIM_CODE));
ok("...and the budget panel still opts out entirely",
   /title=\{standalone \? "What they eat in a day"[\s\S]{0,120}?hideLibrary \/>/.test(SIM_CODE));
{
  // ⚠️ A TAB THAT CANNOT EVER FILL IS A DEAD END. Handing over recents without
  // the saved list must not leave a permanently-empty "Saved" tab behind.
  const LIB = codeOnly(APP.slice(APP.indexOf("function FoodLibrary("), APP.indexOf("function MealLog(")));
  ok("the library hides a Saved tab it has no way to fill",
     /\.filter\(\(\[k\]\) => k !== "saved" \|\| \(mode === "meals"/.test(LIB)
     && /\? \(!!onToggleSaveMeal \|\| savedMealsList\.length > 0\)/.test(LIB)
     && /: \(!!onToggleSave \|\| saved\.length > 0\)\)/.test(LIB));
  ok("...and its star and delete controls were already gated on their handlers",
     /\{onToggleSave && \(/.test(LIB)
     && /\{!\(inSavedTab \? onRemoveSaved : onRemoveRecent\) \? null :/.test(LIB));
  // The Foods/Meals switch is gated on onToggleSaveMeal, so a recents-only
  // caller gets a foods-only panel and never reaches the meal-derivation reads.
  ok("...so a recents-only caller gets a foods-only library",
     /\{onToggleSaveMeal && \(/.test(LIB));
  // ⚠️ AND THE COPY MAY NOT NAME A CONTROL THAT ISN'T THERE. Without a save
  // handler the rows render no star, so the "tap the star" line would be
  // instructions for a button that does not exist.
  ok("...and the footer stops naming a star it is not rendering",
     /\? \(onToggleSave\s*\n?\s*\? `Recent foods roll over as you log new ones/.test(LIB)
     && /: `These are the foods already logged on this plan\.`\)/.test(LIB));
}
{
  // The button may only name the half it can actually open onto.
  const MEAL2 = APP.slice(APP.indexOf("function MealLog("), APP.indexOf("\nfunction ", APP.indexOf("function MealLog(") + 20));
  ok("the library button names only what is behind it",
     /onToggleSaveFood \|\| \(savedFoods \|\| \[\]\)\.length \? "Previously logged & saved" : "Previously logged"/.test(MEAL2));
}
// Both plan-backed mounts hand the list down; the standalone one has no plan.
ok("the two plan-backed mounts pass the client's own history",
   (APP.match(/<CalorieSimulator[\s\S]{0,260}?recentFoods=\{recentFoods\}/g) || []).length === 2
   && /<CalorieSimulator standalone planRate=\{1\} premium=\{mePremium\} onClose=/.test(APP));
// ⚠️ THE TWO NEW MealLog PROPS DEFAULT TO TODAY'S BEHAVIOUR, so every real meal
// log is untouched by this. `title` falls back to "Meals & Food Today"; the
// Library button hides ONLY where hideLibrary is asked for — the budget, which
// records nothing and would otherwise offer a drawer onto a history it never
// writes.
{
  const MEAL = APP.slice(APP.indexOf("function MealLog("), APP.indexOf("\nfunction ", APP.indexOf("function MealLog(") + 20));
  ok("MealLog's new props are optional and default to what it already did",
     /onEditMeal, title, hideLibrary = false,/.test(MEAL)
     && /\(title \|\| "Meals & Food Today"\)/.test(MEAL));
  ok("...and the Library button is gated on the opt-out, not removed",
     /\{!hideLibrary && \(/.test(MEAL) && /Icon name="book"/.test(MEAL));
  // Negative control: the real meal log must NOT be opting out.
  // ⚠️ TWO, NOT ONE, SINCE S220 — the budget panel and the bank page, which are
  // the same sandbox asking two questions. Every mount OUTSIDE this sheet must
  // still be absent from the list, which is what this count is really guarding.
  const realMounts = (APP.match(/<MealLog [^>]*hideLibrary/g) || []);
  ok("(control) only this sheet opts out of the library", realMounts.length === 2, realMounts.length);
  ok("...and both of them are inside the simulator",
     (SIM_CODE.match(/<MealLog [^>]*hideLibrary/g) || []).length === 2);
}
ok("the budget names itself rather than claiming to be today",
   /title=\{standalone \? "What they eat in a day"/.test(SIM_CODE) && /hideLibrary \/>/.test(SIM_CODE));
ok("the premium gate reaches it rather than defaulting open",
   /premium = true, recentFoods \}\) \{/.test(SIM_CODE) && /premium=\{premium\}/.test(SIM_CODE));

// ── The bank account (S220, Kevin) ──────────────────────────────────────────
// "Treat their daily calorie intake as if it's their bank account … whatever we
// select will be their base bank account number … exercise … extra 'money' …
// food … the bank account losing money … shows them how much debt they're in
// and how much body weight they're gonna gain."
//
// Two numbers, two questions, and the dangerous one is the SECOND: being over
// budget is not the same as gaining weight, and a page that conflates them tells
// every deficit client the opposite of the truth. simBankRows is LIFTED AND RUN
// rather than retyped (S199k).
{
  let notClosing = null, forked = null, wrongNet = null, badKept = null, n = 0;
  for (const [name, d] of PLANS) {
    const planBurn = M.planEnergy(d).weeklyBurn;
    for (const burn of [0, planBurn, 1200, 4200]) {
      for (const food of [0, 900, 1800, 2600, 4000]) {
        for (const r of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
          for (const ov of [undefined, 1800, 2400, 3600]) {
            n++;
            const b = M.simBankRows(d, burn, r, ov, food);
            // 1. the statement closes on the number the pace chips print
            if (b.body + b.deposit - b.cut - b.kept !== b.sub) notClosing = { name, burn, r, ov, food, ...b };
            if (b.earned !== b.body + b.deposit) notClosing = { name, burn, r, ov, food, ...b };
            // 2. the account is the budget less the food, and the budget is the
            //    SAME call every other surface makes
            if (b.balance !== M.simIntakeForRate(d, burn, r, ov) - food) {
              forked = { name, burn, r, ov, food, balance: b.balance, canon: M.simIntakeForRate(d, burn, r, ov) };
            }
            // 3. the scale answers to the body, never to the budget
            if (b.net !== b.earned - food) wrongNet = { name, burn, r, ov, food, ...b };
            // 4. accelerate keeps the deposit back; eat-back spends it
            const wantKept = M.isEatback(d) ? 0 : b.deposit;
            if (b.kept !== wantKept) badKept = { name, burn, r, ov, kept: b.kept, wantKept };
            if (notClosing || forked || wrongNet || badKept) break;
          }
          if (notClosing || forked || wrongNet || badKept) break;
        }
        if (notClosing || forked || wrongNet || badKept) break;
      }
      if (notClosing || forked || wrongNet || badKept) break;
    }
    if (notClosing || forked || wrongNet || badKept) break;
  }
  ok(`the statement always closes on the chip (${n} plan × burn × food × rate × override cases)`, !notClosing, notClosing);
  ok("...and the balance never forks from simIntakeForRate", !forked, forked);
  ok("...the saving is earned minus eaten, always", !wrongNet, wrongNet);
  ok("...and accelerate pays the deposit in and keeps it back", !badKept, badKept);
  // ⚠️ AND THE DERIVED `body` ROW AGREES WITH simBudgetRows' OWN tdee TODAY —
  // pinned rather than assumed, because it is the fact that makes deriving it
  // free. A mutation swapping the derivation for `b.tdee` stays green, and that
  // is an EQUIVALENCE, not a gap in the suite (the S214 lesson). If a future
  // change to how `sub` rounds broke it, the closure check above goes red.
  let bodyGap = null;
  for (const [name, d] of PLANS) {
    for (const burn of [0, 1400, 4200]) {
      for (const r of [-1, 0, 1, 2]) {
        const b = M.simBankRows(d, burn, r, undefined, 2000);
        if (b.body !== b.tdee) bodyGap = { name, burn, r, body: b.body, tdee: b.tdee };
      }
    }
  }
  ok("(pin) the derived body row equals the ladder's own tdee", !bodyGap, bodyGap);
}
{
  // ⚠️ THE SAME BODY EARNS THE SAME AMOUNT EITHER WAY. deficitMode is a
  // prescription, not physiology — if `earned` or `net` moved with it, one person
  // would get two different answers about the scale depending on which approach
  // their coach happened to pick. Only the BUDGET, and so the balance, may move.
  const eb = PLANS.find(([nm]) => nm === "eat-back, cardio + strength")[1];
  const ac = PLANS.find(([nm]) => nm === "accelerate, cardio + strength")[1];
  let gap = null, budgetsEverDiffer = 0;
  for (const burn of [0, 1400, 2800, 4200]) {
    for (const r of [0, 0.5, 1, 2]) {
      for (const food of [0, 1800, 3000]) {
        const a = M.simBankRows(eb, burn, r, undefined, food);
        const b = M.simBankRows(ac, burn, r, undefined, food);
        if (a.earned !== b.earned || a.net !== b.net) gap = { burn, r, food, eb: a, ac: b };
        if (a.balance !== b.balance) budgetsEverDiffer++;
      }
    }
  }
  ok("what the body earns does not depend on which approach the plan took", !gap, gap);
  // Control: if the mode changed NOTHING here, the toggle on this page would be
  // decoration and the "kept back" row a lie.
  ok("(control) but the budget — and so the balance — really does move", budgetsEverDiffer > 0, budgetsEverDiffer);
}
{
  // ⚠️ THE PACE MOVES THE BUDGET, NEVER THE BODY. The page says this in so many
  // words, and the bank projection deliberately omits `rate` from its deps on
  // the strength of it. If it were false, every horizon tile would be stale.
  const d = PLANS.find(([nm]) => nm === "eat-back, cardio + strength")[1];
  let moved = null;
  for (const burn of [0, 1400, 4200]) {
    for (const food of [1200, 2200, 3500]) {
      const nets = [-2, -1, -0.5, 0, 0.5, 1, 2].map((r) => M.simBankRows(d, burn, r, undefined, food).net);
      if (new Set(nets).size !== 1) moved = { burn, food, nets };
    }
  }
  ok("the pace moves the budget, never what the scale does", !moved, moved);
}
{
  // ⚠️ ALL THREE BRANCHES OF THE RECONCILIATION HAVE TO BE REACHABLE, or one of
  // them is prose nobody will ever see and the other two are hiding a wrong case.
  // The middle one is the whole reason this page reports two numbers: overdrawn
  // AND still losing is the ORDINARY state of a client on a deficit plan.
  const d = PLANS.find(([nm]) => nm === "eat-back, cardio + strength")[1];
  const burn = M.planEnergy(d).weeklyBurn;
  const seen = { saving: 0, overButLosing: 0, debt: 0 };
  for (let food = 400; food <= 5000; food += 50) {
    const b = M.simBankRows(d, burn, 1, undefined, food);
    if (b.balance >= 0 && b.net > 20) seen.saving++;
    if (b.balance < 0 && b.net > 20) seen.overButLosing++;
    if (b.balance < 0 && b.net < -20) seen.debt++;
  }
  ok("inside the budget and losing is reachable", seen.saving > 0, seen);
  ok("...over budget and STILL losing is reachable — the case a one-number page gets wrong",
     seen.overButLosing > 0, seen);
  ok("...and real debt, where the weight actually goes on, is reachable", seen.debt > 0, seen);
  // The balance and the saving are only the same number when nothing is set
  // aside — which is exactly when the page says so.
  const atMaintain = M.simBankRows(d, burn, 0, undefined, 2000);
  ok("at Maintain on an eat-back plan the two numbers coincide",
     atMaintain.balance === atMaintain.net && atMaintain.cut === 0 && atMaintain.kept === 0);
  const atPace = M.simBankRows(d, burn, 1, undefined, 2000);
  ok("(control) and at a losing pace they do not", atPace.balance !== atPace.net);
}
{
  // The floor keeps its own row here too (CLAUDE.md): a floored budget still
  // drives the balance, and the gap it paid in is a positive, visible amount.
  const d = PLANS.find(([nm]) => nm === "floor-bound small frame")[1];
  const b = M.simBankRows(d, 0, 2, undefined, 1500);
  ok("a floored plan still balances against the floored budget",
     b.floored && b.budget === M.MIN_DAILY_CAL && b.balance === M.MIN_DAILY_CAL - 1500, b);
  ok("...and the floor's own row is a real, positive number", M.MIN_DAILY_CAL - b.sub > 0, b.sub);
  // ⚠️ AND THE SCALE STILL ANSWERS TO THE BODY, not to the floored prescription
  // — deriving weight from a number the arithmetic did not produce would promise
  // a result the plan cannot deliver.
  ok("...while the saving is still measured against what the body burns",
     b.net === b.earned - 1500 && b.net !== b.balance, b);
}
{
  // Food is normalised the same way the panel above reads it, so the two pages
  // can never print totals a calorie apart.
  ok("food is read as a number, and nothing is read as NaN",
     M.simBankRows(PLANS[0][1], 0, 1, undefined, undefined).food === 0
     && M.simBankRows(PLANS[0][1], 0, 1, undefined, "1800").food === 1800);
}

// ── The bank page's own wiring ──────────────────────────────────────────────
{
  const BANK = SIM_CODE.slice(SIM_CODE.lastIndexOf('{page === "bank" && ('));
  ok("the bank is its own page with its own button",
     /const \[page, setPage\] = useState\("plan"\)/.test(SIM_CODE)
     && /\[\["plan", "Plan", "chart"\], \["bank", "Bank account", "receipt"\]\]\.map\(/.test(SIM_CODE));
  // ⚠️ KEVIN ASKED FOR THE TWO NOT TO BE JAMMED TOGETHER, so the plan page's own
  // tools — seven day boxes, the year calendar, the budget panel, the answer —
  // are gated OFF the bank page rather than merely pushed below it.
  ok("...and the plan page's tools are gated off it",
     (SIM_CODE.match(/\{page === "plan" && \(<>/g) || []).length === 2);
  ok("...and switching pages lands at the top of the sheet",
     /sheetRef\.current\?\.scrollTo\(\{ top: 0 \}\)/.test(SIM_CODE) && /className="sim-sheet" ref=\{sheetRef\}/.test(SIM_CODE));
  // Kevin: "anytime there's calorie burning from exercise or the clients number
  // that they've selected … will automatically stay green and every time we add
  // things like food or if their calorie number goes below their maintenance …
  // it starts turning red and it's negative."
  ok("income reads green and food reads red",
     /MONEY \(CAL\) IN/.test(BANK) && /MONEY \(CAL\) OUT/.test(BANK)
     && /color: "var\(--green\)" \}\}>\{calN\(bank\.body\)\}/.test(BANK)
     && /color: "var\(--red\)" \}\}>−\{calN\(bank\.food\)\}/.test(BANK));
  // Kevin, S220c: "whenever money is stated in this section can we make sure in
  // () we put cal next to it." One helper renders it, so no row can drop it.
  ok("...and every amount carries its unit",
     /const calN = \(v\) => \(/.test(SIM_CODE)
     && (BANK.match(/calN\(/g) || []).length >= 12
     && !/\{bank\.(body|earned|deposit|cut|kept)\.toLocaleString\(\)\}/.test(BANK));
  ok("...and an overdrawn account turns red, headline included",
     /bankCredit \? "var\(--green\)" : "var\(--red\)"/.test(BANK) && /Overdrawn/.test(BANK) && !/Overdrawn by|In the red by/.test(BANK));
  // ⚠️ THE SIGN OF THE WEIGHT COMES FROM `bankDir`, WHICH IS `net`. Taking it
  // from `bankCredit` would print "the weight goes on" for every client who is
  // over budget and still comfortably losing — S217's bug, one screen along.
  ok("the scale is driven by the burn, not by the budget",
     /const bankDir = bank\.net > 20 \? "lose" : bank\.net < -20 \? "gain" : "hold"/.test(SIM_CODE)
     && /bankDir === "lose" \? "−" : "\+"/.test(BANK)
     && !/bankCredit \? "−" : "\+"/.test(BANK));
  ok("...and it reconciles the two out loud when they disagree",
     /over\s+\n?\s*the goal, but still/.test(BANK) && /just slower than this pace asked for/.test(BANK)
     && /That is the debt:/.test(BANK));
  ok("...including the case where the budget IS the burn",
     /\{bankSame && </.test(BANK) && /const bankSame = bank\.cut === 0 && bank\.kept === 0 && !bank\.floored/.test(SIM_CODE));
  // The deposit is visible on both sides in accelerate — hiding it would delete
  // the one thing this page teaches from half the plans.
  ok("accelerate shows the deposit paid in and then kept back",
     /Training pays in/.test(BANK) && /Training kept back for a sooner goal/.test(BANK));
  ok("the 1,200 floor keeps its own row here too",
     /Held at the 1,200 floor/.test(BANK) && /MIN_DAILY_CAL - bank\.sub/.test(BANK));
  // Displaying a sub-1,200 day is correct; prescribing one is not (CLAUDE.md).
  ok("...and a sub-1,200 day is shown and named, never clamped",
     /is under 1,200 for the day/.test(BANK) && !/Math\.max\(MIN_DAILY_CAL/.test(BANK));
  ok("nothing on the bank page writes anything",
     !/onChange\(|onSetCardio|setData\(|onSave/.test(BANK));
  // The projection is the SAME engine the plan page walks, and it deliberately
  // does not list `rate` — proven above that `net` cannot move with it.
  ok("the bank projection reuses simProject and the plan's own weekHold",
     /simProject\(\{ days: n\[0\], startLbs: w, weekHold, dayIntake: \(\) => bankSpend \}\)/.test(SIM_CODE));
  ok("...and it halts rather than projecting a body through zero",
     /bankEndLbs\(days\) > 0 \?/.test(BANK) && /off the scale/.test(BANK));
}

// ── Money made today, the two bars, and the streak (S220c, Kevin) ───────────
// "We can add the deficit section in the earned today section … that should be
// a positive number because that is money going in the bank … Money (cal) Made
// Today: the deficit number + the training payment number."
//
// ⚠️ HIS SECOND WORKED EXAMPLE BANKS THE DEFICIT TWICE. $3,000 maintain + $250
// deficit + $250 cardio − $3,100 eaten reads as $400 saved, but the body burned
// 3,250 and took in 3,100, so 150 is what actually went in. A deficit is only
// money once it goes UNSPENT — so it is shown as a + into savings, and the
// total it feeds is what today banks IF the goal is met, not what is already
// in the account. The savings that drive the scale stay `net`.
{
  let bad = null, flooredSeen = 0, n = 0;
  for (const [name, d] of PLANS) {
    const planBurn = M.planEnergy(d).weeklyBurn;
    for (const burn of [0, planBurn, 1400, 4200]) {
      for (const r of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
        for (const ov of [undefined, 1800, 2400, 3600]) {
          n++;
          const b = M.simBankRows(d, burn, r, ov, 2000);
          const made = b.earned - b.budget;
          const floorGap = Math.max(0, M.MIN_DAILY_CAL - b.sub);
          if (floorGap > 0) flooredSeen++;
          // The savings ladder closes: deficit + kept-back, less whatever the
          // 1,200 floor handed back.
          if (made !== b.cut + b.kept - floorGap) bad = { name, burn, r, ov, made, ...b, floorGap };
          if (bad) break;
        }
        if (bad) break;
      }
      if (bad) break;
    }
    if (bad) break;
  }
  ok(`money made today is the deficit plus what is kept back (${n} cases)`, !bad, bad);
  // ⚠️ AND THE COMPONENT MUST DERIVE IT THE SAME WAY. The sweep above proves the
  // IDENTITY; only this pins the expression the screen actually prints. Written
  // as `cut + kept` it would over-report what a floored plan banks — a row
  // claiming savings the 1,200 floor already handed back.
  ok("...and the screen derives it from the two totals, not by re-adding",
     /const bankMade = bank\.earned - bank\.budget;/.test(SIM_CODE)
     && !/const bankMade = bank\.cut \+ bank\.kept/.test(SIM_CODE));
  ok("(control) and the floored case was actually exercised", flooredSeen > 0, flooredSeen);
  // ⚠️ KEVIN'S FORMULA IS THE ACCELERATE CASE. On an eat-back plan the training
  // is inside the goal and therefore EATEN, not banked, so "deficit + training"
  // would over-report what the day puts away. Deriving it from the two totals
  // gets both modes right without a branch.
  const eb = PLANS.find(([nm]) => nm === "eat-back, cardio + strength")[1];
  const ac = PLANS.find(([nm]) => nm === "accelerate, cardio + strength")[1];
  const day = Math.round(2800 / 7);
  const a = M.simBankRows(eb, 2800, 1, undefined, 2000);
  const c = M.simBankRows(ac, 2800, 1, undefined, 2000);
  ok("eat-back banks the deficit alone — the training is eaten, not saved",
     a.earned - a.budget === a.cut, { made: a.earned - a.budget, cut: a.cut });
  ok("...and accelerate banks the deficit PLUS the training, which is Kevin's formula",
     c.earned - c.budget === c.cut + day, { made: c.earned - c.budget, want: c.cut + day });
}
{
  // ⚠️ THE STREAK TOTAL IS THE WALK'S OWN, NOT `net × days`. The body re-prices
  // as the weight comes off, and this is the one screen built to invite reading
  // a year off it — S217 measured the flat rule overstating a year by ~40%.
  const d = PLANS.find(([nm]) => nm === "eat-back, cardio + strength")[1];
  const burn = M.planEnergy(d).weeklyBurn;
  const food = 1700;
  const weekHold = (lbs) => {
    const dw = { ...d, weightLbs: lbs };
    if (M.simRawIntakeForRate(dw, burn, 0, undefined) === null) return null;
    return M.simIntakeForRate(dw, burn, 0, undefined) * 7 + (M.isEatback(dw) ? 0 : burn);
  };
  const p = M.simProject({ days: 365, startLbs: 170, weekHold, dayIntake: () => food });
  const walked = Math.round(p.spent - p.eaten);
  const flat = (M.simBankRows(d, burn, 0, undefined, food).net) * 365;
  ok("a year of the streak is walked, not multiplied", walked > 0 && walked < flat, { walked, flat });
  // Negative control: if the two agreed, the adaptive engine would be doing
  // nothing here and the assertion above would be decoration.
  ok("(control) and the flat number really is the optimistic one",
     flat - walked > 1000, { walked, flat, gap: flat - walked });
  // The pounds and the calories have to tell the same story.
  ok("...and the pounds come from the same walk",
     Math.abs(p.lost - walked / M.CAL_PER_LB) < 0.05, { lost: p.lost, walked });
  const short = M.simProject({ days: 7, startLbs: 170, weekHold, dayIntake: () => food });
  ok("...while a single week is still essentially the flat answer",
     Math.abs(Math.round(short.spent - short.eaten) - M.simBankRows(d, burn, 0, undefined, food).net * 7) < 60);
}
{
  const BANK = SIM_CODE.slice(SIM_CODE.lastIndexOf('{page === "bank" && ('));
  // Kevin: "Balance, which we should be called goal, then a bar under that says
  // limit, which will be the total Earned today number."
  ok("the food list sits over two bars, goal then limit",
     /bankBar\("GOAL", bank\.budget, bankGoalPct, bankOverGoal,/.test(BANK)
     && /bankBar\("LIMIT", bank\.earned, bankLimitPct, bankOverLimit,/.test(BANK));
  // ⚠️ THE BARS ARE WHAT MAKE THE TWO NUMBERS LEGIBLE AT A GLANCE: goal red
  // while limit is still green IS "over budget but still losing". So each must
  // colour from its OWN comparison, never from the shared balance.
  ok("...each judged against its own number",
     /const bankOverGoal = bank\.food > bank\.budget;/.test(SIM_CODE)
     && /const bankOverLimit = bank\.food > bank\.earned;/.test(SIM_CODE));
  ok("...and one helper draws both, so they cannot drift apart",
     /const bankBar = \(label, total, pct, over, note\) => \(/.test(SIM_CODE)
     && /background: over \? "var\(--red\)" : "var\(--green\)"/.test(SIM_CODE)
     && /color: over \? "var\(--red\)" : "var\(--muted\)"/.test(SIM_CODE));
  // The deficit is a PLUS, under its own heading — his ask, without letting it
  // read as a term in the limit.
  ok("the deficit reads as money going in, not as a cost",
     /STRAIGHT TO SAVINGS \(CAL\)/.test(BANK)
     && /<span>Deficit &mdash; lose \{budPaceLbl\}<\/span>/.test(BANK)
     && /color: "var\(--green\)" \}\}>\+\{calN\(bank\.cut\)\}/.test(BANK));
  ok("...and the limit is named as what it is",
     /Earned today &mdash; the limit/.test(BANK)
     && /Everything \{they\} can spend today without the weight going on/.test(BANK));

  // ── Same every day ──────────────────────────────────────────────────────
  ok("a day can be typed instead of built out of foods",
     /Same every day &mdash; type one number instead/.test(BANK)
     && /const bankSpend = bankEveryNum !== null \? bankEveryNum : spent;/.test(SIM_CODE));
  // ⚠️ TWO SOURCES FOR ONE NUMBER IS HOW A SCREEN STARTS DISAGREEING WITH
  // ITSELF. Typed wins, and it says so rather than silently dropping a food
  // list somebody had already filled in.
  ok("...and it says which source is in force",
     /bankEveryNum !== null && expenses\.length > 0 && \(/.test(BANK)
     && /being\s*\n?\s*ignored while that is set/.test(BANK));
  ok("...and every reader of the day uses the same one",
     !/simBankRows\(d, trainWeek, rate, mNum, spent\)/.test(SIM_CODE)
     && /dayIntake: \(\) => bankSpend/.test(SIM_CODE));

  // ── Plan further out ────────────────────────────────────────────────────
  ok("the streak is a savings balance over a horizon",
     /Plan further out/.test(BANK) && /SIM_HORIZONS\.map/.test(BANK)
     && /const bankBanked = bankLong \? Math\.round\(bankLong\.spent - bankLong\.eaten\) : 0;/.test(SIM_CODE));
  ok("...and it is the walk's own total, never net times days",
     !/bank\.net \* bankHorizon|bank\.net \* days/.test(SIM_CODE));
  // ⚠️ THE "ROOM TO SPEND LATER" FRAMING ONLY HOLDS WITH SOMETHING IN THE
  // ACCOUNT. Offering a blowout to somebody already in debt is S217's bug.
  ok("...and the spend-it-later offer is gated on there being savings",
     /bankBanked > CAL_PER_LB/.test(BANK)
     && /this is the account running down rather/.test(BANK));
  ok("...and it says when the walk stopped rather than projecting past it",
     /bankLong\.halted > 0 && \(/.test(BANK));
  // ⚠️ AND THE HEADER NAMES THE PERIOD THE WALK COVERED, not the one that was
  // asked for. "Banked over 1 year" above a 308-day figure is a label
  // disagreeing with the number beside it.
  ok("...and the header names the period actually walked",
     /\{bankLong\.halted > 0\s*\n?\s*\? `\$\{bankLong\.halted\} days`/.test(BANK));
}

// ── How fast, and where it comes from (S220d, Kevin) ────────────────────────
// "I don't see much change when I click on each button" … "can a user click on
// another 1/2, 1, and 2 pound loss option within this … and decide if they want
// to lose 1/2, 1 or 2 pounds based on what they choose and the calories burned
// during exercise."
{
  // ⚠️ THE NOTE ON SCREEN MAKES A CLAIM, SO THE CLAIM GETS PINNED. "With no
  // training in the week these two give the same numbers" must be TRUE, or the
  // fix for a control that looks broken is itself a lie. Every number the modes
  // can reach is swept at zero burn.
  let differs = null, n = 0;
  for (const [name, base] of PLANS) {
    const eb = { ...base, deficitMode: "eatback", cardio: {}, strength: {} };
    const ac = { ...base, deficitMode: "accelerate", cardio: {}, strength: {} };
    for (const r of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
      for (const ov of [undefined, 1800, 2400, 3600]) {
        n++;
        const a = M.simBankRows(eb, 0, r, ov, 2000);
        const b = M.simBankRows(ac, 0, r, ov, 2000);
        for (const k of ["tdee", "cut", "sub", "budget", "earned", "body", "deposit", "kept", "balance", "net"]) {
          if (a[k] !== b[k]) differs = { name, r, ov, k, eatback: a[k], accelerate: b[k] };
        }
        if (differs) break;
      }
      if (differs) break;
    }
    if (differs) break;
  }
  ok(`with no training the two modes are byte-identical (${n} cases)`, !differs, differs);
  // Control: the moment there IS training they must separate, or the buttons
  // would be decoration everywhere rather than only on an empty week.
  const p = P();
  const withBurn = ["budget", "earned", "kept"].some((k) =>
    M.simBankRows({ ...p, deficitMode: "eatback" }, 2800, 1, undefined, 2000)[k]
    !== M.simBankRows({ ...p, deficitMode: "accelerate" }, 2800, 1, undefined, 2000)[k]);
  ok("(control) and they separate the moment a session is added", withBurn);
}
{
  // ⚠️ THE SPLIT IS A DECOMPOSITION OF `earned − budget`, NOT A SECOND SUM. Food
  // plus movement has to equal the total, at every pace, in both modes, floored
  // or not — otherwise the row says the loss comes from somewhere it doesn't.
  let bad = null, n = 0;
  for (const [name, d] of PLANS) {
    for (const burn of [0, 1400, 2800, 4200]) {
      for (const r of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
        for (const ov of [undefined, 1800, 2400, 3600]) {
          n++;
          const b = M.simBankRows(d, burn, r, ov, 2000);
          const made = b.earned - b.budget;
          const fromFood = made - b.deposit;
          // The same daily deficit reached WITHOUT going through `earned`: what
          // the body really spends (tdee plus the week over seven) less what the
          // plan lets them eat. If the split and this ever diverge, the rows are
          // attributing the loss to somewhere it did not come from.
          const independent = b.tdee + Math.round(burn / 7) - b.budget;
          if (fromFood + b.deposit !== independent) bad = { name, burn, r, ov, fromFood, dep: b.deposit, made, independent };
          if (bad) break;
        }
        if (bad) break;
      }
      if (bad) break;
    }
    if (bad) break;
  }
  ok(`food plus movement is the whole deficit (${n} cases)`, !bad, bad);
  // ⚠️ AND AS DISPLAYED. The rows are flipped on a surplus so the column closes;
  // this runs that same arithmetic over every pace in both directions.
  let openLedger = null;
  for (const [name, d] of PLANS) {
    for (const burn of [0, 1400, 4200]) {
      for (const r of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
        const b = M.simBankRows(d, burn, r, undefined, 2000);
        const made = b.earned - b.budget;
        const sign = made >= 0 ? 1 : -1;
        const shownFood = (made - b.deposit) * sign;
        const shownTrain = b.deposit * sign;
        if (shownFood + shownTrain !== Math.abs(made)) openLedger = { name, burn, r, shownFood, shownTrain, made };
      }
    }
  }
  ok("...and the two shares add to the total exactly as printed", !openLedger, openLedger);
  // Control: the check above must be capable of failing. Attribute a calorie of
  // the food share to movement and it has to notice.
  ok("(control) and a mis-attributed calorie would be caught", (() => {
    const b = M.simBankRows(P(), 2800, 1, undefined, 2000);
    const made = b.earned - b.budget;
    return (made - b.deposit - 1) + b.deposit !== b.tdee + Math.round(2800 / 7) - b.budget;
  })());

  // ⚠️ THE IDENTITY THAT MAKES THE MODES MEAN SOMETHING, and the answer to "how
  // much faster is Faster loss": eat-back lands on EXACTLY the pace that was
  // picked, accelerate lands above it by the training. Anything else and one of
  // the two buttons is mis-sold.
  // ⚠️ FLOORED PLANS ARE EXCLUDED BECAUSE THE IDENTITY IS FALSE THERE, NOT
  // BECAUSE IT IS AWKWARD. A plan held at 1,200 banks LESS than the pace asked
  // for, and the screen is required to say so — asserted separately below.
  const p = P({ cardio: {}, strength: {} });
  let paceOff = null, accelOff = null;
  for (const burn of [0, 700, 2800, 4200]) {
    for (const r of [0, 0.5, 1, 2]) {
      const eb = M.simBankRows({ ...p, deficitMode: "eatback" }, burn, r, undefined, 2000);
      const ac = M.simBankRows({ ...p, deficitMode: "accelerate" }, burn, r, undefined, 2000);
      const day = Math.round(burn / 7);
      const ebRate = ((eb.earned - eb.budget) * 7) / M.CAL_PER_LB;
      const acRate = ((ac.earned - ac.budget) * 7) / M.CAL_PER_LB;
      if (Math.abs(ebRate - r) > 0.01) paceOff = { burn, r, ebRate };
      if (Math.abs(acRate - (r + (day * 7) / M.CAL_PER_LB)) > 0.01) accelOff = { burn, r, acRate };
    }
  }
  ok("More food lands on exactly the pace that was picked", !paceOff, paceOff);
  ok("...and Faster loss lands above it by whatever the training burns", !accelOff, accelOff);
  // ⚠️ AND ON A FLOORED PLAN IT LANDS SHORT. The identity above holds only
  // while the floor is not binding; a plan pinned at 1,200 delivers less than
  // the chip promises, and printing "you land on exactly the pace you picked"
  // there would promise a result the plan cannot produce (CLAUDE.md's floor
  // clause). Reached with the small-frame fixture at 2 lb/wk.
  const fl = PLANS.find(([nm]) => nm === "floor-bound small frame")[1];
  const fb = M.simBankRows({ ...fl, deficitMode: "eatback" }, 0, 2, undefined, 2000);
  const flRate = ((fb.earned - fb.budget) * 7) / M.CAL_PER_LB;
  ok("(reachable) a floored plan lands SHORT of the pace, not on it",
     fb.floored && fb.budget === M.MIN_DAILY_CAL && flRate < 2 - 0.01, { floored: fb.floored, flRate });

  // The awkward case the copy has to name: an eat-back plan whose training
  // out-earns the pace means eating ABOVE the base burn, with movement carrying
  // all of it. If it were unreachable the branch would be dead prose.
  const hot = M.simBankRows({ ...p, deficitMode: "eatback" }, 4200, 0.5, undefined, 2000);
  ok("(reachable) training can out-earn the pace, so food goes the other way",
     (hot.earned - hot.budget) - hot.deposit < 0, { made: hot.earned - hot.budget, dep: hot.deposit });
}
{
  const SIM = SIM_CODE;
  ok("the empty week says so instead of leaving a dead control",
     /trainWeek === 0 && \(/.test(SIM) && /these two give the/.test(SIM)
     && /opacity: trainWeek > 0 \? 1 : 0\.7/.test(SIM));
  // ⚠️ AND THE DIM MAY NOT PUT THE LABEL UNDER AA. 0.55 blended var(--text-secondary)
  // onto var(--s2) at 4.2:1, below the 4.5 this text size needs; 0.7 measures
  // 5.9:1. Measured in the browser, not estimated.
  ok("...at an opacity that still passes contrast", /: 0\.7 \}\}>/.test(SIM));
  // ⚠️ NOT `disabled`: the two modes still MEAN different things on an empty
  // week, and the sentence underneath is where that is explained.
  ok("...but stays clickable, so the explanation is still reachable",
     !/disabled=\{!?trainWeek/.test(SIM));
  // Kevin: "can a user click on another 1/2, 1, and 2 pound loss option within
  // this?" — the same `rate`, rendered twice. A second pace state is how this
  // sheet would start quoting two different goals.
  ok("the loss paces are reachable without scrolling back up",
     /HOW FAST, AND WHERE IT COMES FROM/.test(SIM)
     && /SIM_RATES\.filter\(\(t\) => t\.group === "maintain" \|\| t\.group === "loss"\)\.map/.test(SIM));
  // ⚠️ READ FROM THE TABLE, NOT RE-SPELLED. A copied literal would leave two
  // spellings of the same paces in one sheet the day SIM_RATES changes, and
  // nothing would fail. Proven by RUNNING the filter, not just matching it.
  ok("...and the labels are the pace table's own",
     !/\[\[0, "Maintain"\]/.test(SIM) && /\{t\.sign\}\{t\.lbl\}/.test(SIM));
  {
    // ── ONE PACE TABLE IN THE WHOLE FILE (S220g) ──────────────────────────
    // The Daily Calorie Targets card — the surface whose own button opens this
    // sheet — carried a byte-for-byte copy of SIM_RATES. Two spellings of one
    // list, a tap apart, either free to drift with nothing failing. It reads the
    // shared table now, and this COUNTS the literals so a fourth copy cannot
    // appear quietly: `group:` is the shape's fingerprint, and the other pace
    // tables in this file (the per-day `targets` and the `paces` strip) carry
    // neither it nor a gain direction, so they are left alone on purpose.
    const tally = (g) => (APP.match(new RegExp(`group:\\s*"${g}"`, "g")) || []).length;
    ok("only one table in src/App.jsx is shaped like SIM_RATES",
       tally("maintain") === 1 && tally("loss") === 3 && tally("gain") === 3,
       { maintain: tally("maintain"), loss: tally("loss"), gain: tally("gain") });
    // ...and the count is of the LITERAL, so it has to match what SIM_RATES
    // actually holds, or the guard is watching a number nobody maintains.
    ok("...and those counts are SIM_RATES' own",
       M.SIM_RATES.filter((t) => t.group === "maintain").length === 1
       && M.SIM_RATES.filter((t) => t.group === "loss").length === 3
       && M.SIM_RATES.filter((t) => t.group === "gain").length === 3);
    // The card must be READING it, not merely not-declaring its own.
    ok("the Daily Calorie Targets card reads the shared table",
       /\{SIM_RATES\.filter\(\(t\)=>t\.group===g\)\.map\(\(t\)=>rateBtn\(t\)\)\}/.test(APP)
       && /\{SIM_RATES\.filter\(\(t\)=>t\.group==="maintain"\)\.map\(\(t\)=>rateBtn\(t, true\)\)\}/.test(APP)
       && /rateName\(SIM_RATES\.find\(r=>Math\.abs\(r\.rate-previewRate\)<0\.01\)\)/.test(APP));
    // ⚠️ THE CARD FILTERS BY GROUP AND FINDS BY RATE, so only the order WITHIN
    // each group is load-bearing — pinned here because "SIM_RATES is already in
    // that order" was an assumption worth checking rather than trusting.
    ok("...and the within-group order it renders is the one SIM_RATES carries",
       M.SIM_RATES.filter((t) => t.group === "loss").map((t) => t.rate).join(",") === "0.5,1,2"
       && M.SIM_RATES.filter((t) => t.group === "gain").map((t) => t.rate).join(",") === "-0.5,-1,-2",
       M.SIM_RATES.map((t) => t.group + ":" + t.rate));
    // ── ONE SPELLING OF EACH PACE (S220g, Kevin: "unify the spelling to lbs") ──
    // Two pounds takes the plural; a half and a one do not. RATE_SHORT printed
    // "2 lb/wk" in prose on the Daily Dashboard while the chips a few lines above
    // said "2 LBS/WK" — one pace spelled two ways without scrolling.
    // ⚠️ SCANNED WITH COMMENTS STRIPPED. This file narrates old bugs in its own
    // comments ("a client set to 2 lb/wk was told 20 weeks"), and a guard that
    // could not tell prose from history would either fire on the past or have to
    // be loosened until it saw nothing — the S208 trap, where a check matched the
    // very comment naming the thing it forbids.
    const strings = codeOnly(APP);
    ok("no pace is spelled with a singular pound after a plural number",
       !/2 lb\/(wk|week)/.test(strings),
       (strings.match(/.{0,34}2 lb\/(wk|week).{0,10}/g) || []).slice(0, 3));
    // Control: the plural spelling really is what is there, so the check above is
    // not passing because the labels vanished.
    ok("(control) and two pounds is spelled out in both forms",
       /2 lbs\/wk/.test(strings) && /2 lbs\/week/.test(strings));
    // ...and a half and a one stay singular, which is the other half of the rule.
    ok("...while a half and a one keep the singular",
       !/(½|0\.5|\b1) lbs\/(wk|week)/.test(strings));

    const four = M.SIM_RATES.filter((t) => t.group === "maintain" || t.group === "loss");
    ok("(run) the filter really yields Maintain and the three losing rungs, in order",
       four.length === 4 && four.map((t) => t.rate).join(",") === "0,0.5,1,2"
       && four.map((t) => t.sign + t.lbl).join("|") === "Maintain|−½ lb/wk|−1 lb/wk|−2 lbs/wk",
       four.map((t) => t.sign + t.lbl));
  }
  ok("...and they set the SAME rate the chips at the top do",
     /onClick=\{\(\) => setRate\(t\.rate\)\}/.test(SIM)
     && (SIM.match(/useState\(RATE_OPTS\.includes\(planRate\)/g) || []).length === 1);
  // ⚠️ FOUR UNLIT BUTTONS OVER A SPLIT THAT NAMES NO VISIBLE PACE READS AS
  // BROKEN — the same complaint that started S220d, one control along.
  // ⚠️ AND THE WAY BACK SITS BESIDE THE CONTROL IT REVERTS. It had drifted to
  // the far side of the split block, a screenful below the two buttons whose
  // choice it undoes.
  ok("the mode-revert link is next to the modes, not below the split",
     SIM.indexOf("Back to {th} plan&rsquo;s approach") < SIM.indexOf("HOW FAST, AND WHERE IT COMES FROM")
     && SIM.indexOf("Back to {th} plan&rsquo;s approach") > SIM.indexOf("WHAT THE TRAINING BUYS"));
  ok("...and a gaining pace says why none of them is lit",
     /\{rate < 0 && \(/.test(SIM) && /a gaining\s*\n?\s*pace, which is why none of these is lit/.test(SIM));
  ok("the split is derived from the statement's own total",
     /const paceTrainDay = bank\.deposit;/.test(SIM)
     && /const paceFromFood = bankMade - paceTrainDay;/.test(SIM)
     && /const paceLbsWk = \(bankMade \* 7\) \/ CAL_PER_LB;/.test(SIM));
  ok("...and the screen says what the rate actually works out to",
     /Math\.abs\(paceLbsWk\) < 0\.05/.test(SIM) && /a week\.<\/>\}/.test(SIM));
  // ⚠️ EVERY CLAUSE GATED ON THE STATE THAT MAKES IT TRUE. An adversarial pass
  // found three sentences here that were composed for a losing, unfloored,
  // eat-back plan and left running on every other — the S217 shape. Each gate
  // is pinned, because the suite stayed green while all three were wrong.
  ok("...and names the case where movement is carrying it alone",
     /\{bankMade > 0 && paceTrainDay > 0 && paceFromFood < 0 && \(/.test(SIM)
     && /above \{th\} body&rsquo;s own burn/.test(SIM));
  ok("...so it cannot credit training on a plan that has none",
     !/\{paceFromFood < 0 && \(/.test(SIM));
  // A floored plan lands SHORT of the pace, so it may not be told it landed on it.
  ok("the floor speaks before the pace promise does",
     /\{flooredAtRate\(rate\)\s*\n?\s*\? <> The 1,200 floor is holding the goal up/.test(SIM)
     && SIM.indexOf("floor is holding the goal up") < SIM.indexOf("land on exactly the"));
  // ⚠️ "FASTER" IS FALSE ON A GAIN PACE — accelerate makes a gain plan SLOWER.
  ok("...and accelerate only calls itself faster where it is",
     /: rate > 0\s*\n?\s*\? <> The training lands on TOP of the pace/.test(SIM)
     && /: rate === 0/.test(SIM)
     && /comes off the surplus and \{they\} gain\s*\n?\s*more slowly/.test(SIM));
  // The row label describes what the number IS, in both directions.
  ok("the food row renames itself when food is going the other way",
     /\{paceFromFood >= 0 \? "From eating less" : "From eating more"\}/.test(SIM));
  // ⚠️ AND THE THREE NUMBERS HAVE TO CLOSE AS PRINTED. The shares are
  // contributions to a DEFICIT; on a gain pace the total is a surplus, so
  // without the flip the column read −620 / +120 over a total of 500 — a ledger
  // that visibly does not add up, which is the S215 bug in miniature. Found by
  // reading a gain pace on screen, not by any assertion here.
  ok("...and the column is oriented to the direction it totals in",
     /const paceSign = bankMade >= 0 \? 1 : -1;/.test(SIM)
     && /const paceFoodShown = paceFromFood \* paceSign;/.test(SIM)
     && /const paceTrainShown = paceTrainDay \* paceSign;/.test(SIM)
     && /\{paceFoodShown >= 0 \? "\+" : "−"\}/.test(SIM)
     && /\{paceTrainShown >= 0 \? "\+" : "−"\}/.test(SIM));
  // The sessions live ABOVE this block; "below" pointed at the budget panel.
  ok("the empty-week note points at the planner, which is above it",
     /Add a session above and they separate/.test(SIM));
  // ⚠️ AND THE MODE COPY MAY NOT PROMISE A LOSS AN EMPTY WEEK CANNOT PRODUCE.
  // "Training at Maintain now shows a real loss below" sat directly under the
  // note saying the two modes are identical — the box contradicting itself.
  ok("...and neither mode claims a result it needs training for",
     /\{trainWeek > 0 && <> Eating the Maintain number means no loss/.test(SIM)
     && /\{trainWeek > 0 && <> Training at Maintain now shows a real loss below\.<\/>\}/.test(SIM));
}

// ── The nutrition mode is answerable in the sandbox (S219b) ─────────────────
// ⚠️ null MEANS "FOLLOW THE PLAN". An untouched sandbox must stay byte-identical
// to the plan's ladder, which the parity sweep above already asserts — this pins
// the shape that keeps it true.
ok("the sandbox can ask the other mode without touching the plan",
   /const \[simEat, setSimEat\] = useState\(null\);/.test(SIM_CODE)
   && /const d = simEat === null \? dPlan : \{ \.\.\.dPlan, deficitMode: simEat \? "eatback" : "accelerate" \};/.test(SIM_CODE));
{
  // ⚠️ AND THE TWO MODES REALLY DO DIVERGE, or the toggle is decoration. Kevin's
  // case: maintenance + cardio. Eat-back holds weight by definition; accelerate
  // turns the same cardio into a real deficit.
  const base = PLANS.find(([nm]) => nm === "eat-back, cardio + strength")[1];
  const burn = 2100;                       // 300 cal a day of training
  const eat = M.simIntakeForRate({ ...base, deficitMode: "eatback" }, burn, 0);
  const acc = M.simIntakeForRate({ ...base, deficitMode: "accelerate" }, burn, 0);
  ok("at Maintain, eat-back's number carries the training and accelerate's does not",
     eat - acc === Math.round(burn / 7) || Math.abs((eat - acc) - burn / 7) <= 1, { eat, acc, perDay: burn / 7 });
  // The projection: eating Maintain while training. Eat-back nets zero, which is
  // what Maintain MEANS there; accelerate nets the whole week of training.
  const holdEat = eat + 0;                 // eat-back folds the burn into the target
  const holdAcc = acc + Math.round(burn / 7);
  ok("...so eating Maintain nets zero in eat-back", eat - holdEat === 0);
  ok("...and nets the training in accelerate", holdAcc - acc === Math.round(burn / 7));
}


// ⚠️ THE PROSE FOLLOWS deficitMode, NOT JUST THE NUMBERS. The intro read
// "training pays a little back in" for everyone, which is false on an accelerate
// plan and contradicted the panel immediately below it — S217's mistake, where
// five caveats written for someone losing sat under a surplus.
ok("the budget's training income row is gated on eat-back",
   /\{eatback && trainWeek > 0 && \(/.test(SIM_CODE));
ok("...accelerate gets the opposite line instead", /\{!eatback && trainWeek > 0 && \(/.test(SIM_CODE));
ok("...and the intro sentence is gated too, not written for one mode",
   /\{eatback \? " training pays a little back in," : ""\}/.test(SIM_CODE)
   && /\{!eatback && " ?Training doesn/.test(SIM_CODE));
// ⚠️ WRITES NOTHING, like the rest of the sheet — the promise that licenses it
// to show a day under 1,200 without prescribing one.
ok("the budget's expenses are local state and reach no writer",
   /const \[expenses, setExpenses\] = useState\(\[\]\);/.test(SIM_CODE)
   && !/setExpenses[\s\S]{0,400}?(storage\.set|setForUser|onAddMeal|logWrite)/.test(SIM_CODE));

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

// ── 4b. a TYPED daily burn (S217, Kevin) ───────────────────────────────────
// "What if I just meet someone on the street and wanna give them a general
// estimate of maintenance calories that I put in and then of course the app
// itself can create the deficit and surplus automatically."
//
// ⚠️ THE WHOLE POINT IS THAT IT IS THE SAME LADDER. A second one for the
// no-plan case is how two screens start quoting different numbers for the same
// person — which is the defect S214 and S215 were both about.
{
  // The no-override case must be BIT-IDENTICAL, and every falsy shape has to
  // fall through: Number(undefined) is NaN, Number(null) and Number("") are 0.
  let bad = null, n = 0;
  for (const [name, d] of PLANS) {
    const burn = M.planEnergy(d).weeklyBurn;
    for (const r of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
      for (const fall of [undefined, null, "", 0, "abc", -5, NaN, false]) {
        n++;
        const a = M.simIntakeForRate(d, burn, r, fall);
        const b = M.planIntakeForRate(d, r);
        if (a !== b) { bad = { name, r, fall: String(fall), sim: a, plan: b }; break; }
      }
      if (bad) break;
    }
    if (bad) break;
  }
  ok(`an absent or unusable override changes nothing (${n} plan × rate × falsy pairs)`, !bad, bad);

  // ...and a real one moves the answer, or the sweep above proves nothing.
  const d = P();
  const burn = M.planEnergy(d).weeklyBurn;
  ok("control: a typed burn DOES move the ladder",
     M.simIntakeForRate(d, burn, 1, 2000) !== M.simIntakeForRate(d, burn, 1),
     { typed: M.simIntakeForRate(d, burn, 1, 2000), plan: M.simIntakeForRate(d, burn, 1) });

  // ⚠️ IT REPLACES `tdee`, NOT `tdee + eatback`. If it froze the whole base,
  // adding cardio would stop moving the chips — while the answer panel one
  // section below still said "More cardio means more food at the same pace".
  const eat = P();                                   // eat-back by default
  ok("with a typed burn, more cardio still buys more food in eat-back mode",
     M.simIntakeForRate(eat, 2100, 1, 2400) > M.simIntakeForRate(eat, 700, 1, 2400),
     { more: M.simIntakeForRate(eat, 2100, 1, 2400), less: M.simIntakeForRate(eat, 700, 1, 2400) });
  ok("...by exactly the extra week, divided once",
     M.simIntakeForRate(eat, 2100, 1, 2400) - M.simIntakeForRate(eat, 700, 1, 2400) === Math.round(2400 + 2100 / 7 - 500) - Math.round(2400 + 700 / 7 - 500));
  const acc = P({ deficitMode: "accelerate" });
  ok("...and in accelerate mode the typed number IS maintenance, exactly",
     M.simIntakeForRate(acc, 2100, 0, 2400) === 2400 && M.simIntakeForRate(acc, 0, 0, 2400) === 2400);
  // ⚠️ NEGATIVE CONTROL: the base-replacing version really would freeze it.
  const frozen = (base, r) => M.atLeastMinCal(base - Math.round((r * 3500) / 7));
  ok("control: replacing the whole base really would stop cardio moving the chips",
     frozen(2400, 1) === frozen(2400, 1) && M.simIntakeForRate(eat, 2100, 1, 2400) !== frozen(2400, 1));

  // A plan too incomplete to compute is exactly what the typed number rescues.
  ok("an unusable plan still answers once a burn is typed",
     M.simIntakeForRate({}, 0, 1) === 0 && M.simIntakeForRate({}, 0, 1, 2400) === 1900,
     { without: M.simIntakeForRate({}, 0, 1), with: M.simIntakeForRate({}, 0, 1, 2400) });
  ok("...and the floor still binds on a typed number",
     M.simIntakeForRate({}, 0, 2, 1300) === 1200 && M.simRawIntakeForRate({}, 0, 2, 1300) === 300);
  // ⚠️ NOTHING TYPED IS CLAMPED — the band is a WARNING, not a refusal, because
  // this sandbox displays rather than prescribes.
  ok("an implausible burn is used exactly as typed", M.simIntakeForRate({}, 0, 0, 9000) === 9000);
}

// ── 4b2. whose plan is this? (S217) ────────────────────────────────────────
// ⚠️ FOUND BY SIGNING IN AS A CLIENT AND READING IT BACK. The third-person copy
// written for the street demo — "their plan eats that back" — was being shown to
// a client looking at THEIR OWN plan. Half the user base is clients, and the rest
// of this app has addressed them in the second person for sessions ("Nothing here
// changes YOUR plan" is the subtitle directly above).
// ⚠️ AN HTML ENTITY INSIDE AN INTERPOLATED JS STRING RENDERS AS ITSELF. JSX
// decodes &rsquo; in TEXT only, so "they&rsquo;d" appeared on screen verbatim.
// Scanned rather than spot-checked, because the next such string will be written
// by someone who has never hit it.
{
  const strings = (SIM_CODE.match(/"[^"\n]*"/g) || []).concat(SIM_CODE.match(/`[^`\n]*`/g) || []);
  const bad = strings.filter((x) => /&(rsquo|lsquo|mdash|ndash|hellip|middot|amp|nbsp|asymp);/.test(x));
  ok("no HTML entity is trapped inside a JS string literal", bad.length === 0, bad);
  ok("...the pronoun helper uses the real character", /"they\u2019d" : "you\u2019d"/.test(SIM_CODE) || /they’d/.test(SIM_CODE));
}
ok("the pronoun is decided once, from the mode",
   /const th = standalone \? "their" : "your";/.test(SIM_CODE)
   && /const Th = standalone \? "Their" : "Your";/.test(SIM_CODE)
   && /const they = standalone \? "they" : "you";/.test(SIM_CODE)
   && /const theyd = standalone \? "they’d" : "you’d";/.test(SIM_CODE));
// ⚠️ AND NO RENDERED STRING MAY HARDCODE EITHER SIDE OF IT. A single missed
// literal is the whole bug back, on whichever screen happens to hit that line.
{
  const rendered = SIM_CODE
    .replace(/const th = [^\n]*/, "").replace(/const Th = [^\n]*/, "")
    .replace(/const they = [^\n]*/, "").replace(/const theyd = [^\n]*/, "");
  const stray = (rendered.match(/(?:"|>|\s)[Tt]heir\b/g) || []);
  ok("no rendered string hardcodes the third person", stray.length === 0, stray);
  ok("...nor the second person, which would break the street demo",
     !/>[^<]*\byour plan&rsquo;s number/.test(rendered) && !/"Start with your daily burn"/.test(rendered));
}
// The subtitle already worked this way and must keep doing so.
ok("the subtitle still switches on the same mode",
   /standalone \? "Nothing is saved\." : "Nothing here changes your plan\."/.test(SIM_CODE));

// ── 4c. the screen around the typed burn ───────────────────────────────────
ok("the modal takes a standalone mode", /function CalorieSimulator\(\{ data, weightLbs, planRate, dayCalsAll, onClose, standalone = false, premium = true, recentFoods \}\)/.test(SIM_CODE));
ok("...and an unusable plan or a bare sandbox opens on the burn question",
   /const usable = burnOpened \|\| planUsable;/.test(SIM_CODE) && /\{!usable \? \(/.test(SIM_CODE));
// ⚠️ THE OPENER MAY NOT VANISH WHILE SOMEBODY IS TYPING IN IT. Kevin, on his
// phone: "as soon as i type it kicks me out and the curser is no longer allowing
// me to type." `usable` was derived from the LIVE parsed field, so the first
// digit made simNum("2") valid, flipped the branch, UNMOUNTED the input being
// typed into and dropped focus after one keystroke.
//
// ⚠️ AND NO TEST IN THIS FILE COULD HAVE SEEN IT, WHICH IS THE LESSON. The unit
// suites lift pure functions and grep source — they cannot see React. The live
// verification set the field with ONE synthetic event carrying the FINAL value
// ("2400"), so it never passed through the intermediate "2" that breaks it. Any
// defect that depends on an intermediate state, on focus, or on element identity
// across renders is invisible to both techniques. What CAN be pinned is the
// shape: the branch condition must not be a function of the live field.
ok("...and the branch is NOT a function of the live field",
   !/const usable = [^\n]*mNum/.test(SIM_CODE));
ok("...leaving the opener is an explicit commit",
   /const commitBurn = \(\) => \{ if \(mNum !== null\) \{ setBurnOpened\(true\); setEditBurn\(true\); \} \};/.test(SIM_CODE)
   && /<button onClick=\{commitBurn\} disabled=\{mNum === null\}/.test(SIM_CODE));
// ⚠️ THE SAME BUG HAD A SECOND HOME, AND THE FIRST FIX DID NOT REACH IT. The
// pencil panel one section down was gated `(editBurn || mNum !== null)`, so a
// user who had already committed a number, then selected it and backspaced it
// away, flipped mNum to null mid-edit and UNMOUNTED the input under their
// cursor — Kevin's exact report, one panel lower, reachable without ever seeing
// the opener. It also made the pencil a dead control: with a number in play both
// toggle states rendered the same panel, so tapping it did nothing.
//
// A BRANCH THAT MOUNTS A FIELD MAY NOT BE A FUNCTION OF THAT FIELD'S LIVE VALUE.
// The gate is the committed flag alone; the commit sets it explicitly.
const MOUNT_GATES = (SIM_CODE.match(/^\s*\{[^\n]*&&\s*\($/gm) || []).map((l) => l.trim());
// ⚠️ THE SPINNER IS REMOVED, NOT PADDED AROUND (Kevin, S218: "the example numbers
// are being cut off by the up and down arrow in the box"). S216 answered the same
// complaint with 26px of symmetric padding, which is what CAUSED this: the arrows
// eat the right end of the box and the padding then eats both ends, leaving 74px
// of content for an 80px placeholder. Measured after the fix: 0 of 10 boxes clip
// their placeholder, all still centred, and the widest legal value still fits.
ok("...and the sandbox sheet drops the native number spinner",
   /\.sim-sheet input\[type="number"\]::-webkit-inner-spin-button/.test(APP)
   && /\.sim-sheet input\[type="number"\] \{ -moz-appearance: textfield; appearance: textfield; \}/.test(APP)
   && /className="sim-sheet"/.test(SIM_CODE));
ok("...so the padding that dodged it is gone, and every box still reads one object",
   /const numInput = \{ \.\.\.input, textAlign: "center", padding: "9px 12px" \};/.test(SIM_CODE)
   && !/padding: "9px 26px"/.test(SIM_CODE)
   && (SIM_CODE.match(/\.\.\.numInput/g) || []).length === 8,
   (SIM_CODE.match(/\.\.\.numInput/g) || []).length);
ok("...and the pencil panel's gate is the committed flag alone",
   MOUNT_GATES.includes("{editBurn && (")
   && !MOUNT_GATES.some((g) => /editBurn/.test(g) && /mNum/.test(g)),
   MOUNT_GATES.filter((g) => /editBurn/.test(g)));
// Negative control: the shape that shipped must be caught by that check. (The
// button's three COLOUR keys still read mNum and are left alone — a colour
// mounts nothing, and "an override is in play" is worth showing while shut.)
ok("...(control) the old gate would be caught",
   ["{(editBurn || mNum !== null) && ("].some((g) => /editBurn/.test(g) && /mNum/.test(g)));
// The gates that MAY read the live field are the ones that mount no field of
// their own — a warning line, a revert button and a note. Enumerated rather than
// described, so a fourth one has to be argued for rather than slipped in.
{
  const liveGates = (SIM_CODE.match(/^\s*\{[^\n]*(?:mNum|wNum|mOverride|wOverride)[^\n]*&&\s*\($/gm) || [])
    .map((l) => l.trim());
  const expected = [
    "{simBurnOdd(mNum) && (",
    "{mNum !== null && (",
    "{mNum !== null && eatback && trainWeek > 0 && (",
  ];
  ok("...and every other live-field gate mounts nothing typeable",
     liveGates.length === expected.length && expected.every((g, i) => liveGates[i] === g),
     liveGates);
}
ok("...which Enter also does, because the phone keyboard's key is right there",
   /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); commitBurn\(\); \}/.test(SIM_CODE));
// ⚠️ ONE-WAY. If clearing the field could flip `usable` back, the pencil panel
// would bounce a standalone sandbox to the opener mid-edit — the same bug
// pointing the other way. Only the explicit Clear may reopen it.
ok("...and only the explicit start-over reopens it",
   (SIM_CODE.match(/setBurnOpened\(false\)/g) || []).length === 1
   && /if \(!planUsable\) setBurnOpened\(false\);/.test(SIM_CODE),
   (SIM_CODE.match(/setBurnOpened\(false\)/g) || []).length);
ok("...and nothing else writes that flag",
   (SIM_CODE.match(/setBurnOpened\(/g) || []).length === 2,
   (SIM_CODE.match(/setBurnOpened\(/g) || []).length);
ok("...where planUsable is the plan's OWN tdee, not the override",
   /const planUsable = isFinite\(baseTdee\) && baseTdee > 0;/.test(SIM_CODE)
   && /const baseTdee = planEnergy\(d\)\.tdee;/.test(SIM_CODE));
// ⚠️ ONE FIELD, TWO PLACES — the opener and the pencil. Two copies would drift
// in their validation, and the validation is the interesting part.
ok("the burn field is defined once and rendered twice",
   (SIM_CODE.match(/const burnField = \(label\) =>/g) || []).length === 1
   && (SIM_CODE.match(/\{burnField\(/g) || []).length === 2,
   (SIM_CODE.match(/\{burnField\(/g) || []).length);
// ⚠️ A SIBLING, NOT A CHILD. The chip is a <button> acting as a radio; nesting
// a second button inside it is invalid HTML and the inner one swallows the
// outer's click on some browsers. Asserted by lifting rateBtn and showing the
// pencil is not in it.
ok("the Maintain chip carries a pencil", /aria-label=\{`Change \$\{th\} daily burn`\}/.test(SIM_CODE));
ok("...which is not nested inside the chip", !/setEditBurn/.test(liftDecl(APP, "rateBtn")));
// ⚠️ THE WEIGHT MUST SURVIVE THE OPENER (found by driving it, not by reading).
// Typing the burn replaces the opener with the full screen, and the weight field
// went with it — leaving no route to the one number that unlocks real exercises
// and the "what they'd weigh" line, short of clearing the burn to get the opener
// back. Written once, shown in both places.
ok("the weight field is written once and reachable after the opener",
   (SIM_CODE.match(/const weightField = \(/g) || []).length === 1
   && (SIM_CODE.match(/\{weightField\}/g) || []).length === 1
   && /\{standalone && weightField\}/.test(SIM_CODE),
   (SIM_CODE.match(/\{weightField\}/g) || []).length);
ok("...and one tap puts the plan's own number back",
   /setMOverride\(""\); setEditBurn\(false\);/.test(SIM_CODE) && /Back to \$\{th\} plan's number/.test(SIM_CODE));
// ⚠️ EAT-BACK MAKES "MAINTAIN" AND "THEIR BURN" TWO DIFFERENT NUMBERS. Typing
// 2,400 and reading 2,492 one line above looks like a bug unless it is named.
ok("the gap between the typed burn and the Maintain chip is disclosed",
   /mNum !== null && eatback && trainWeek > 0 && \(/.test(SIM_CODE) && /which \{th\} plan eats back/.test(SIM_CODE));
// ⚠️ A PICKER THAT ACCEPTS INPUT AND SILENTLY DISCARDS IT. restingKcalPerMin
// opens `if (!w) return 0`, so with no weight a 45-minute run prices at zero and
// the day header — which only renders a burn when burned > 0 — shows NOTHING.
ok("the exercise pickers are gated on knowing whose body it is",
   /const canPrice = w > 0;/.test(SIM_CODE)
   && /const fillKindEff = canPrice \|\| fillKind === "rest" \? fillKind : SIM_MANUAL;/.test(SIM_CODE));
// ⚠️ REST IS NOT AN EXERCISE, so it is NOT gated on knowing a weight — clearing a
// day needs no body to price. Only the two shapes that DO get forced to manual.
ok("...but clearing a day is not, because it needs no body",
   /canPrice \|\| fillKind === "rest"/.test(SIM_CODE));
ok("...quick fill uses the gated value, not the raw state",
   !/fillKind === SIM_MANUAL \?/.test(SIM_CODE) && /fillKindEff === SIM_MANUAL \?/.test(SIM_CODE));
ok("...a new session defaults to the shape that can be priced",
   /canPrice \? \{ type: "outdoor_jog", duration: 30 \} : \{ type: SIM_MANUAL, cal: "" \}/.test(SIM_CODE));
// ⚠️ COUNTED. TWO places drop the pickers — quick fill and the per-day editor —
// and a note in only one of them leaves the other looking broken.
ok("...and the reason is written once and shown in both places",
   (SIM_CODE.match(/const noWeightNote = /g) || []).length === 1
   && (SIM_CODE.match(/\bnoWeightNote\b/g) || []).length === 3,
   (SIM_CODE.match(/\bnoWeightNote\b/g) || []).length);
// ⚠️ THE BACKDROP IS onClick={onClose}. One mis-tap used to bin a fully typed
// week; it now holds seven days, a week of cardio and a typed burn.
ok("a stray backdrop tap cannot discard a typed scenario",
   /<div onClick=\{askClose\}/.test(SIM_CODE) && /const askClose = \(\) => \{ if \(dirtyRef\.current\) setConfirmClose\(true\); else onClose\(\); \};/.test(SIM_CODE));
ok("...device Back goes through the same guard", /if \(sheetCount > 0\) return; askClose\(\);/.test(SIM_CODE));
// ⚠️ AND THE CONFIRM HAS TO BE WHERE THEY CAN SEE IT. It is the last child of an
// 88vh scroll box holding paces, a week of cardio, seven days and a year of
// calendar — measured at 2,072px in a 630px viewport, so a backdrop tap from the
// top rendered the question ~1,440px below the fold. The modal just did not
// close, with no visible reason.
ok("...and the discard question is brought to them",
   /const confirmRef = useRef\(null\);/.test(SIM_CODE)
   && /useEffect\(\(\) => \{ if \(confirmClose\) confirmRef\.current\?\.scrollIntoView\(\{ block: "center" \}\)/.test(SIM_CODE)
   && /\{confirmClose && \(\s*<div ref=\{confirmRef\}/.test(SIM_CODE));
// ⚠️ A PAINTED YEAR IS THE MOST EXPENSIVE THING THIS MODAL CAN HOLD, so the
// scenario overrides have to be in the flag too — otherwise the one state worth
// guarding is the one the guard cannot see.
ok("...the dirty flag covers every input the modal holds",
   /dirtyRef\.current = anyTyped \|\| cardioChanged \|\| mNum !== null \|\| wNum !== null\s*\n?\s*\|\| Object\.keys\(dayOverrides\)\.length > 0 \|\| expenses\.length > 0\s*\n?\s*\|\| String\(bankEveryDay \|\| ""\)\.trim\(\) !== "";/.test(SIM_CODE));
ok("...and the close button keeps its direct path",
   /<button onClick=\{onClose\} aria-label="Close"/.test(SIM_CODE));
// ⚠️ NEVER re-price somebody's logged history against a number invented on a
// street corner. planTarget stays the PLAN's.
ok("the make-up section is still judged by the plan's own target",
   /const planTarget = \(computeClientCalories\(d\) \|\| \{\}\)\.target \|\| 0;/.test(SIM_CODE)
   && !/computeClientCalories\([^)]*mNum/.test(SIM_CODE));
// The plausible band is observedTdee's, imported rather than copied.
ok("the plausible band comes from observedTdee, not a second opinion",
   /TUNING as TDEE_TUNING/.test(APP) && /TDEE_TUNING\.PLAUSIBLE_MIN/.test(SIM_CODE) && /TDEE_TUNING\.PLAUSIBLE_MAX/.test(SIM_CODE));

// ── 4d. the three doors ────────────────────────────────────────────────────
// ⚠️ CONDITIONALLY MOUNTED, NEVER GIVEN AN `open` PROP. useBodyScrollLock(true)
// and useBackClose(true, …) are unconditional inside the modal, so an
// always-mounted copy would lock the page's scroll and swallow the device Back
// button for the whole session.
ok("the standalone mount is conditional", /\{showWhatIf && \(\s*\n?\s*<CalorieSimulator standalone/.test(codeOnly(APP)));
ok("...and is not handed an open prop", !/<CalorieSimulator[^>]*\bopen=/.test(codeOnly(APP)));
// ⚠️ planRate={1} so a prospect's first read is a real deficit rather than
// "That holds your weight steady."
ok("...and opens on a real pace", /<CalorieSimulator standalone planRate=\{1\}/.test(codeOnly(APP)));
ok("the side menu offers it to every role, not just trainers",
   /onWhatIf && onWhatIf\(\), 0\); \}\}>/.test(codeOnly(APP))
   && !/isTrainer && onWhatIf/.test(codeOnly(APP)));
ok("...through the same deferred open Refer & earn uses (the drawer sits under the sheet)",
   /onClose\(\); setTimeout\(\(\) => onWhatIf && onWhatIf\(\), 0\);/.test(codeOnly(APP)));
ok("the trainer's home carries it too", /onWhatIf=\{\(\)=>setShowWhatIf\(true\)\}/.test(codeOnly(APP)));
ok("a client's own home opens it PLAN-BOUND, not blank",
   /\{showWhatIfC && \(/.test(codeOnly(APP)) && /planRate=\{weeklyRateOf\(planData \|\| \{\}\)\}/.test(codeOnly(APP)));
ok("...and hands it the days the compliance strip already built",
   /dayCalsAll=\{Object\.fromEntries\(compDays\.map\(\(x\) => \[x\.date, x\.calories\]\)\)\}/.test(codeOnly(APP)));
// The in-plan button is untouched — Kevin: "of course, keep it under specific clients."
ok("the in-plan entry point survives", /<button onClick=\{\(\)=>setShowSim\(true\)\}/.test(codeOnly(APP)));

// ── Break-even is measured, not prescribed (S220e, found by review) ─────────
// The sheet had TWO break-even numbers the moment the bank page printed an
// honest one: section 4 compared intake against the PRESCRIBED maintain, which
// the 1,200 floor lifts, so on a small client it compared 1,200 against itself
// and reported "holds your weight steady" while she gained.
{
  // ⚠️ IDENTICAL WHEREVER THE FLOOR DOES NOT BIND — which is nearly every plan,
  // so this change has to be invisible there or it is not a fix, it is a
  // rewrite. Math.round is exactly what atLeastMinCal does above 1,200.
  let drift = null, n = 0, flooredSeen = 0;
  for (const [name, d] of PLANS) {
    const planBurn = M.planEnergy(d).weeklyBurn;
    for (const burn of [0, planBurn, 1400, 4200]) {
      for (const ov of [undefined, 1800, 2400, 3600]) {
        n++;
        const hold = M.simHoldDay(d, burn, ov);
        const prescribed = M.simIntakeForRate(d, burn, 0, ov);
        if (hold !== null && hold < M.MIN_DAILY_CAL) { flooredSeen++; continue; }
        if (hold !== prescribed) drift = { name, burn, ov, hold, prescribed };
      }
    }
  }
  ok(`the measured burn matches the prescribed maintain wherever the floor is not binding (${n} cases)`, !drift, drift);
  ok("(control) and the floor-binding case was actually reached", flooredSeen > 0, flooredSeen);

  // ⚠️ THE CASE THE FIX EXISTS FOR. A 105 lb, 62-year-old, sedentary client
  // burns ~1,130; the floor will not let the plan prescribe under 1,200; eating
  // 1,200 is a real surplus. The old basis called that "holds steady".
  const fl = PLANS.find(([nm]) => nm === "floor-bound small frame")[1];
  const hold = M.simHoldDay(fl, 0, undefined);
  const prescribed = M.simIntakeForRate(fl, 0, 0, undefined);
  ok("a body whose burn is under 1,200 is reported at its real burn",
     hold < M.MIN_DAILY_CAL && prescribed === M.MIN_DAILY_CAL, { hold, prescribed });
  // The old line: intake priced at the pace, compared against the FLOORED
  // maintain, is exactly zero — break-even by construction, for any pace.
  const pace = M.simIntakeForRate(fl, 0, 2, undefined);
  ok("(control) the old basis reported break-even no matter the pace",
     pace * 7 - prescribed * 7 === 0, { pace, prescribed });
  ok("...while the real one reports the surplus it is", pace - hold > 0, { pace, hold });

  // ⚠️ ONE BREAK-EVEN NUMBER FOR THE WHOLE SHEET. `holdSteady` (section 4) and
  // `bank.earned` (the bank page's LIMIT) are now the same figure by identity,
  // not by coincidence — swept so they cannot drift apart again.
  let split = null, m = 0;
  for (const [name, d] of PLANS) {
    for (const burn of [0, 1400, 2800, 4200]) {
      for (const ov of [undefined, 1800, 2400, 3600]) {
        m++;
        const holdD = M.simHoldDay(d, burn, ov) ?? 0;
        const burnPerDay = Math.round((M.isEatback(d) ? 0 : burn) / 7);
        const earned = M.simBankRows(d, burn, 1, ov, 2000).earned;
        if (holdD + burnPerDay !== earned) split = { name, burn, ov, holdSteady: holdD + burnPerDay, earned };
      }
    }
  }
  ok(`section 4 and the bank page agree on break-even (${m} cases)`, !split, split);
  // Source pins, so the two readers keep using the shared expression.
  ok("...and both read it from the same place",
     /const holdDay = simHoldDay\(d, trainWeek, mNum\) \?\? 0;/.test(SIM_CODE)
     && /const holdSteady = holdDay \+ burnPerDay;/.test(SIM_CODE)
     && /\{\(holdDay \* 7\)\.toLocaleString\(\)\} cal/.test(SIM_CODE));
  // ⚠️ AND THE INTAKE SIDE IS STILL FLOORED, which is what CLAUDE.md's floor
  // clause actually governs — a projection must eat the number the plan will
  // really prescribe.
  ok("the walk still EATS the floored target", /const paceAtWeight = \(lbs\) => simIntakeForRate\(/.test(SIM_CODE));
  ok("...while it BURNS the measured one",
     /const hold = simHoldDay\(dw, tw, mNum\);/.test(SIM_CODE)
     && !/return simIntakeForRate\(dw, tw, 0, mNum\) \* 7/.test(SIM_CODE));
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
  ok("...and it is the true week", /const weekBalance = weekIntake - burnWeek - holdDay \* 7;/.test(SIM_CODE));
  ok("...the per-day figure is a rounding OF it, not the other way round",
     /const burnPerDay = Math\.round\(burnWeek \/ 7\);/.test(SIM_CODE));
  // ⚠️ `lbsIn` IS DELIBERATELY NOT LIFTED ANY MORE. Since S217 it reads the
  // projector rather than multiplying the balance, and the old `[^;]*` pattern
  // silently returned HALF of its new body — the S211 "slice to the next
  // semicolon" trap. What this block is about is the weekly BALANCE; the flat
  // reference below is what the projector must reproduce at day 0, and
  // scripts/test-what-if-week.mjs proves that separately by running simProject.
  const engine = new Function("weekIntake", "burnWeek", "holdDay", "CAL_PER_LB", `
    ${SIM_CODE.match(/const weekBalance = [^\n]*/)[0]}
    ${SIM_CODE.match(/const balance = weekBalance \/ 7;/)[0]}
    ${SIM_CODE.match(/const dir = balance [^\n]*/)[0]}
    const lbsIn = (days) => (-balance * days) / CAL_PER_LB;
    return { balance, dir, lbs: [7, 14, 30, 60].map(lbsIn) };
  `);
  const project = (d, rate, week, doubleCount) => {
    const trainWeek = M.simWeekBurn(week, Number(d.weightLbs), d, d)
      + M.planEnergy({ ...d, cardio: {} }).weeklyBurn;
    const intakeFor = (r) => M.simIntakeForRate(d, trainWeek, r);
    const burnWeek = doubleCount ? trainWeek : (M.isEatback(d) ? 0 : trainWeek);
    const pace = intakeFor(rate);
    return engine(pace * 7, burnWeek, M.simHoldDay(d, trainWeek), CAL_PER_LB);
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

// ── 5b. the projector: the same formula, re-run as the weight moves (S217) ──
// Kevin: "Can we still have the same formulas to kind of estimate how many
// calories someone will burn for a couple weeks. Months or a year."
//
// ⚠️ THE FLAT RULE IS WRONG OVER A YEAR AND WRONG IN THE FLATTERING DIRECTION.
// Everything below is RUN against the shipping simProject.
{
  // The flat reference: what the screen showed before, and what the walk must
  // still produce whenever the burn cannot follow the body.
  const flat = (holdPerDay, intake, days) => ((holdPerDay - intake) * days) / CAL_PER_LB;

  // ── it reduces to the flat model when nothing can move ──────────────────
  {
    let bad = null, n = 0;
    for (const hold of [1800, 2400, 3055, 4200]) {
      for (const intake of [1200, 1900, 2555, 3000, 5000]) {
        for (const days of [7, 14, 30, 60, 90, 182, 365]) {
          n++;
          const p = M.simProject({ days, startLbs: 0, weekHold: () => hold * 7, dayIntake: () => intake });
          const want = flat(hold, intake, days);
          if (Math.abs(p.lost - want) > 1e-9) { bad = { hold, intake, days, got: p.lost, want }; break; }
        }
        if (bad) break;
      }
      if (bad) break;
    }
    ok(`a constant hold reproduces the flat arithmetic exactly (${n} combinations)`, !bad, bad);
  }

  // ── the invariant that makes this safe to ship: an UNTOUCHED screen ──────
  // A blank day is priced at the pace, and the pace re-prices with the weight,
  // so the daily deficit stays exactly `cut` at every weight.
  {
    const cut = 500;
    let worst = 0;
    for (const start of [105, 140, 170, 220, 300]) {
      for (const days of [7, 14, 30, 60]) {
        // hold falls with weight; the pace falls with it, keeping the gap at `cut`
        const holdAt = (lbs) => Math.round(1200 + lbs * 9) * 7;
        const p = M.simProject({ days, startLbs: start, weekHold: holdAt,
          dayIntake: (i, lbs) => holdAt(lbs) / 7 - cut });
        worst = Math.max(worst, Math.abs(p.lost - (cut * days) / CAL_PER_LB));
      }
    }
    ok("...and a re-pricing pace keeps the deficit exactly at the chosen rate", worst < 1e-9, worst);
  }

  // ── where it moves is where the flat rule is wrong ──────────────────────
  // 220 lb man, moderate, eating a FIXED 2,555 — the shape a typed calendar
  // models. The app's own equations, run.
  {
    const dM = { gender: "male", age: 35, heightFt: 6, heightIn: 0, weightLbs: 220, activityLevel: "moderate" };
    const holdAt = (lbs) => M.planEnergy({ ...dM, weightLbs: lbs }).tdee * 7;
    const walk = (days) => M.simProject({ days, startLbs: 220, weekHold: holdAt, dayIntake: () => 2555 });
    const flatAt = (days) => flat(M.planEnergy(dM).tdee, 2555, days);
    ok("a week is the same either way", Math.abs(walk(7).lost - flatAt(7)) < 0.02, { walk: walk(7).lost, flat: flatAt(7) });
    ok("two months is already 5% apart", flatAt(60) / walk(60).lost > 1.04 && flatAt(60) / walk(60).lost < 1.07,
       { walk: +walk(60).lost.toFixed(1), flat: +flatAt(60).toFixed(1) });
    ok("a year is ~40% apart, and the walk is the smaller number",
       walk(365).lost < flatAt(365) && flatAt(365) / walk(365).lost > 1.3,
       { walk: +walk(365).lost.toFixed(1), flat: +flatAt(365).toFixed(1) });
    // ⚠️ THE SENTENCE THIS EXISTS FOR: 167.9 vs 182.9 for the same man.
    ok("...which is 15 lbs of bodyweight at twelve months",
       Math.abs((220 - flatAt(365)) - 167.9) < 0.3 && Math.abs(walk(365).end - 182.9) < 0.3,
       { flatEnd: +(220 - flatAt(365)).toFixed(1), walkEnd: +walk(365).end.toFixed(1) });
    ok("the end weight IS the start minus the pounds", Math.abs(walk(60).end - (220 - walk(60).lost)) < 1e-9);
  }

  // ── it refuses rather than guessing, and halts rather than inventing ─────
  ok("an unusable plan returns null, not a number",
     M.simProject({ days: 30, startLbs: 180, weekHold: () => null, dayIntake: () => 2000 }) === null);
  ok("...and a NaN hold is refused too",
     M.simProject({ days: 30, startLbs: 180, weekHold: () => NaN, dayIntake: () => 2000 }) === null);
  {
    // A runaway burn used to state a NEGATIVE bodyweight as fact.
    const p = M.simProject({ days: 365, startLbs: 180, weekHold: () => 2000 * 7, dayIntake: () => 0 });
    ok("an impossible scenario halts instead of projecting a negative body", p.halted > 0 && p.end > 0, p);
    ok("...within the first weeks, not after a year of walking", p.halted < 365, p.halted);
  }
  {
    // With no starting weight the pounds still answer — that needs no body.
    const p = M.simProject({ days: 60, startLbs: 0, weekHold: () => 2400 * 7, dayIntake: () => 1900 });
    ok("no starting weight still answers in pounds", Math.abs(p.lost - flat(2400, 1900, 60)) < 1e-9);
    ok("...and never halts, because there is no body to run out of", p.halted === 0);
  }
  ok("a surplus comes back negative, the same sign convention as before",
     M.simProject({ days: 30, startLbs: 180, weekHold: () => 2000 * 7, dayIntake: () => 2500 }).lost < 0);
  ok("a partial final week is not counted as a whole one",
     Math.abs(M.simProject({ days: 10, startLbs: 0, weekHold: () => 2100 * 7, dayIntake: () => 1600 }).lost
              - flat(2100, 1600, 10)) < 1e-9);
  ok("it also reports what was eaten and spent, for the burn total",
     M.simProject({ days: 7, startLbs: 0, weekHold: () => 2100 * 7, dayIntake: () => 1600 }).eaten === 1600 * 7);

  // ── NEGATIVE CONTROLS ───────────────────────────────────────────────────
  // A walk that never re-reads the hold is the flat model wearing a loop.
  const frozen = (days, startLbs, holdAt, intake) => {
    const hold = holdAt(startLbs); let w = startLbs;
    for (let i = 0; i < days; i += 7) { const c = Math.min(7, days - i); w -= ((hold / 7) * c - intake * c) / CAL_PER_LB; }
    return startLbs - w;
  };
  {
    const dM = { gender: "male", age: 35, heightFt: 6, heightIn: 0, weightLbs: 220, activityLevel: "moderate" };
    const holdAt = (lbs) => M.planEnergy({ ...dM, weightLbs: lbs }).tdee * 7;
    ok("control: a frozen hold really does overstate the year",
       frozen(365, 220, holdAt, 2555) > M.simProject({ days: 365, startLbs: 220, weekHold: holdAt, dayIntake: () => 2555 }).lost + 10);
    ok("control: ...and is indistinguishable at a week",
       Math.abs(frozen(7, 220, holdAt, 2555) - M.simProject({ days: 7, startLbs: 220, weekHold: holdAt, dayIntake: () => 2555 }).lost) < 0.02);
  }
}

// ── 5c. the walk is wired into ALL FOUR render sites ────────────────────────
// ⚠️ `lbsIn(days)` APPEARED THREE TIMES INSIDE ONE TILE — the number, the
// "off the scale" guard and the projected weight. Rewiring the obvious one
// leaves a tile reading "−3.1" above "205.7 lbs" on a 210 lb plan, and no
// regression test can see it, because both expressions are equal by
// construction whenever nothing is typed. So it is COUNTED.
ok("nothing multiplies the flat balance out to pounds any more",
   !/\(-balance \* days\) \/ CAL_PER_LB/.test(SIM_CODE));
ok("the pounds come from the walk", /const lbsIn = \(days\) => \{ const p = projAt\[days\] \|\| projFor\(days\); return p \? p\.lost : 0; \};/.test(SIM_CODE));
ok("...and so does the projected weight, rather than a subtraction",
   /const endLbs = \(days\) =>/.test(SIM_CODE)
   && (SIM_CODE.match(/endLbs\(days\)/g) || []).length === 2,   // the guard and the value
   (SIM_CODE.match(/endLbs\(days\)/g) || []).length);
ok("...so no tile still subtracts the pounds off the start weight",
   !/w - lbsIn\(days\)/.test(SIM_CODE));
ok("the four horizons are memoised, not walked per render",
   /const projAt = useMemo\(/.test(SIM_CODE));
// ⚠️ THE WALK'S HOLD MUST BE THE SAME TERM `weekBalance` SUBTRACTS, or the card
// carries two break-even numbers. The body's MEASURED burn, times seven, plus
// the training the ladder has not already paid for.
// ⚠️ IT USED TO READ `simIntakeForRate(…, 0, …)` — the PRESCRIBED maintain,
// which the 1,200 floor lifts. On a plan whose true burn is under 1,200 that
// walked a body burning 1,200 while feeding it 1,200, so it could only ever
// report "steady" (S220e).
ok("the walk holds steady on the same expression the answer panel does",
   /const hold = simHoldDay\(dw, tw, mNum\);/.test(SIM_CODE)
   && /return hold \* 7 \+ \(isEatback\(dw\) \? 0 : tw\);/.test(SIM_CODE));
ok("...and a blank day is the pace AT THAT WEIGHT, which is what keeps it inert",
   /const paceAtWeight = \(lbs\) => simIntakeForRate\(atWeight\(lbs\), trainWeekAt\(lbs\), rate, mNum\);/.test(SIM_CODE));
// ⚠️ WITH NO BODY TO RE-PRICE IT GOES CONSTANT ON PURPOSE — a typed daily burn
// has no BMR behind it, and no weight means no MET can be priced.
ok("it only follows the body when there is a body to follow",
   /const canFollow = w > 0 && mNum === null && planUsable;/.test(SIM_CODE));
ok("...and says which of those it is doing",
   /This holds \$\{th\} burn at/.test(SIM_CODE) && /Add \$\{th\} weight and it can follow the burn down/.test(SIM_CODE));
// ⚠️ THE OLD FOOTNOTE BECAME FALSE. It said the projection "drifts optimistic",
// which is exactly what it no longer does — prose contradicting the number four
// inches above it is the S216b SummaryTab bug in advance.
ok("the footnote no longer claims the drift it just fixed",
   !/drifts optimistic/.test(SIM_CODE) && /doesn&rsquo;t drift the way a flat calculator does/.test(SIM_CODE));

// ── 5d. the long scenario: a month to a year (S217, Kevin) ─────────────────
// "…allow a trainer or a client to run a scenario by entering the calories for
// every single day for 1 month 2 months or even up to a year."
//
// ⚠️ 365 EMPTY INPUTS IS THE FEATURE FAILING. Every day is already filled from
// the seven boxes; the calendar is an EXCEPTION LAYER, and these run the real
// resolver to prove the layering order.
{
  ok("the horizons run from a month to a year",
     M.SIM_HORIZONS.map(([n]) => n).join() === "30,60,90,182,365", M.SIM_HORIZONS.map(([n]) => n));

  // ⚠️ DAY 0 IS TODAY, WHATEVER WEEKDAY THAT IS. `parsed[i % 7]` priced day 0 as
  // MONDAY, so on a Wednesday a heavy Saturday landed on the projection's
  // Thursday — right numbers, wrong days, and no total could reveal it.
  ok("Monday is box 0", M.simWeekdayIdx("2026-09-07") === 0);
  ok("Sunday is box 6", M.simWeekdayIdx("2026-09-13") === 6);
  ok("...every weekday maps to its own box, exactly once",
     new Set(["2026-09-07","2026-09-08","2026-09-09","2026-09-10","2026-09-11","2026-09-12","2026-09-13"]
       .map(M.simWeekdayIdx)).size === 7);
  ok("...and the box order IS the label order",
     M.DAY_SHORT[M.simWeekdayIdx("2026-09-09")] === "Wed");
  // control: the old expression really did put day 0 on Monday
  ok("control: `i % 7` really did ignore what day it is", (0 % 7) === 0 && M.simWeekdayIdx("2026-09-09") === 2);

  // Walking dates forward, in LOCAL time — the S45 rule.
  ok("day 0 is the start itself", M.simDateAt("2026-09-09", 0) === "2026-09-09");
  ok("...and it walks", M.simDateAt("2026-09-09", 1) === "2026-09-10");
  ok("...across a month boundary", M.simDateAt("2026-09-30", 1) === "2026-10-01");
  ok("...across a year boundary", M.simDateAt("2026-12-31", 1) === "2027-01-01");
  ok("...across a leap day", M.simDateAt("2028-02-28", 1) === "2028-02-29");
  ok("...and a full year lands a year later", M.simDateAt("2026-09-09", 365) === "2027-09-09");
  // Noon is the house convention for parsing a date key (every other helper in
  // this file uses T12:00:00), and it is kept for consistency with them.
  // ⚠️ BUT IT IS NOT WHAT MAKES THIS CORRECT, AND SAYING SO WOULD BE A FALSE
  // RATIONALE: measured under America/New_York and under America/Santiago —
  // which moves its clocks AT midnight — a midnight base walks 400 days
  // identically, because setDate preserves the wall clock. What actually has to
  // hold is the property below, so that is what is asserted.
  {
    let bad = null;
    for (let i = 0; i < 400; i++) {
      const k = M.simDateAt("2026-01-01", i);
      if (M.simDateAt(k, 1) !== M.simDateAt("2026-01-01", i + 1)) { bad = { i, k }; break; }
    }
    ok("400 consecutive days step cleanly, DST included", !bad, bad);
  }

  // ── the layering order, which is the whole design ───────────────────────
  {
    const week = [null, 2000, null, null, null, 3500, null];   // Tue 2000, Sat 3500
    const ovr = { "2026-09-12": 4200 };                        // that Saturday only
    ok("an override wins over its weekday box",
       M.simScenarioDay("2026-09-12", ovr, week, 1900) === 4200);
    ok("...a weekday box wins over the pace",
       M.simScenarioDay("2026-09-08", ovr, week, 1900) === 2000);
    ok("...and an untouched day is the pace",
       M.simScenarioDay("2026-09-09", ovr, week, 1900) === 1900);
    ok("a LATER Saturday still follows the box, not the one-off",
       M.simScenarioDay("2026-09-19", ovr, week, 1900) === 3500);
    // ⚠️ A TYPED ZERO IS AN ANSWER, NOT AN ABSENCE — a fast is a real thing to
    // model, and `??`/`||` confusion here would silently price it at the pace.
    ok("a typed zero survives as zero, in both layers",
       M.simScenarioDay("2026-09-12", { "2026-09-12": 0 }, week, 1900) === 0
       && M.simScenarioDay("2026-09-09", {}, [0,null,null,null,null,null,null], 1900) === 1900
       && M.simScenarioDay("2026-09-07", {}, [0,null,null,null,null,null,null], 1900) === 0);
    ok("junk degrades to the pace", M.simScenarioDay("2026-09-09", null, null, 1900) === 1900);
  }

  // ── it feeds the SAME walk, so the stretch cannot disagree with the tiles ─
  {
    const hold = 2400 * 7;
    const week = [null, null, null, null, null, null, null];
    const plain = M.simProject({ days: 30, startLbs: 0, weekHold: () => hold,
      dayIntake: (i) => M.simScenarioDay(M.simDateAt("2026-09-09", i), {}, week, 1900) });
    ok("an untouched stretch is just the pace, every day", plain.eaten === 1900 * 30);
    // One 4,200 day changes the total by exactly the difference — no more.
    const one = M.simProject({ days: 30, startLbs: 0, weekHold: () => hold,
      dayIntake: (i) => M.simScenarioDay(M.simDateAt("2026-09-09", i), { "2026-09-12": 4200 }, week, 1900) });
    ok("...and one painted day moves it by exactly that day", one.eaten - plain.eaten === 4200 - 1900);
    ok("...which is 0.66 lb of the loss", Math.abs((plain.lost - one.lost) - (4200 - 1900) / CAL_PER_LB) < 1e-9);
    // A painted stretch of seven.
    const ovr7 = {};
    for (let i = 0; i < 7; i++) ovr7[M.simDateAt("2026-09-24", i)] = 3200;
    const holiday = M.simProject({ days: 60, startLbs: 0, weekHold: () => hold,
      dayIntake: (i) => M.simScenarioDay(M.simDateAt("2026-09-09", i), ovr7, week, 1900) });
    const base60 = M.simProject({ days: 60, startLbs: 0, weekHold: () => hold,
      dayIntake: (i) => M.simScenarioDay(M.simDateAt("2026-09-09", i), {}, week, 1900) });
    ok("a painted holiday week costs exactly seven days of the difference",
       holiday.eaten - base60.eaten === (3200 - 1900) * 7);
    // ⚠️ AND A STRETCH PAINTED OUTSIDE THE HORIZON MUST NOT COUNT.
    const far = {}; for (let i = 0; i < 7; i++) far[M.simDateAt("2027-06-01", i)] = 3200;
    const outside = M.simProject({ days: 60, startLbs: 0, weekHold: () => hold,
      dayIntake: (i) => M.simScenarioDay(M.simDateAt("2026-09-09", i), far, week, 1900) });
    ok("...and days beyond the stretch change nothing", outside.eaten === base60.eaten);
  }

  // ── the training total, which is the half of the ask nothing provided ────
  {
    const p = M.simProject({ days: 28, startLbs: 200, weekHold: () => 2400 * 7,
      dayIntake: () => 2000, weekTrain: () => 1400 });
    ok("the training burn accumulates across the stretch", Math.abs(p.train - 1400 * 4) < 1e-9, p.train);
    ok("...and is absent, not zero-by-accident, when nothing is passed",
       M.simProject({ days: 28, startLbs: 200, weekHold: () => 2400 * 7, dayIntake: () => 2000 }).train === 0);
    // ⚠️ IT IS A STATEMENT, NOT A TERM IN THE BALANCE — in eat-back mode it is
    // already inside `hold`, so adding it would double-count the whole stretch.
    const withT = M.simProject({ days: 28, startLbs: 200, weekHold: () => 2400 * 7, dayIntake: () => 2000, weekTrain: () => 1400 });
    const without = M.simProject({ days: 28, startLbs: 200, weekHold: () => 2400 * 7, dayIntake: () => 2000 });
    ok("...and it does not touch the pounds", withT.lost === without.lost);
  }
}

// ── 5e. the calendar on screen ─────────────────────────────────────────────
ok("it is collapsed until asked for", /const \[calOpen, setCalOpen\] = useState\(false\);/.test(SIM_CODE)
   && /Plan further out &mdash; a month to a year/.test(SIM_CODE));
ok("...and offers a month to a year", /SIM_HORIZONS\.map\(\(\[days, label\]\) =>/.test(SIM_CODE));
// ⚠️ CAPTURED ON MOUNT. ymdLocal() per render rolls the whole scenario forward a
// day at midnight and every typed date silently means a different day.
ok("the scenario's day 0 is captured once", /const \[startKey\] = useState\(\(\) => ymdLocal\(\)\);/.test(SIM_CODE));
ok("...and every day price goes through the one resolver",
   /const dayIntake = \(i, lbs\) => simScenarioDay\(simDateAt\(startKey, i\), dayOverrides, parsed, paceAtWeight\(lbs\)\);/.test(SIM_CODE));
ok("...so nothing prices a day by position in the week any more", !/parsed\[i % 7\]/.test(SIM_CODE));
// ⚠️ A CELL OUTSIDE THE STRETCH SHOWS NO NUMBER AND TAKES NO TAP — a number
// there invites a value no total counts, which is the silent swallow as a grid.
ok("days outside the stretch are inert",
   /const inRange = k >= startKey && k <= endKey;/.test(SIM_CODE) && /disabled=\{!inRange\}/.test(SIM_CODE));
ok("the grid is Monday-first, like the app's own calendar",
   /const startPad = \(first\.getDay\(\) \+ 6\) % 7;/.test(SIM_CODE) && /DAY_SHORT\.map\(\(dn\) =>/.test(SIM_CODE));
ok("a stretch is painted forward from the day you tapped", /paintDays\(editDate, editSpan, n2\)/.test(SIM_CODE));
ok("...a day can be put back to normal", /paintDays\(editDate, editSpan, null\)/.test(SIM_CODE));
ok("...and one step of undo exists", /setDayOverrides\(undoSnap\); setUndoSnap\(null\);/.test(SIM_CODE));
// ⚠️ THE FLAT COMPARISON IS THE SAME WALK WITH THE BODY FROZEN, so the selling
// point can never drift from the number it is selling against.
ok("the flat comparison is the same engine, frozen",
   /weekHold: \(\) => weekHold\(w\), dayIntake: \(i\) => dayIntake\(i, w\)/.test(SIM_CODE));
ok("...and is only shown once it is worth a pound",
   /Math\.abs\(horizonFlat\.lost - horizonProj\.lost\) >= 1/.test(SIM_CODE));
ok("the training total is reported over the stretch", /weekTrain: trainWeekAt/.test(SIM_CODE)
   && /Training over that stretch/.test(SIM_CODE));
// ⚠️ THE HONESTY ESCALATES WITH THE HORIZON — a line that is true at a month is
// not true at a year.
ok("what the screen says about itself scales with the stretch",
   /horizon >= 365/.test(SIM_CODE) && /horizon >= 90/.test(SIM_CODE)
   && /Use it to compare two ways of eating, not to promise a number/.test(SIM_CODE));
// ⚠️ AND IT DESCRIBES WHAT THE ENGINE IS ACTUALLY DOING, NOT WHAT IT DOES AT ITS
// BEST. With a typed burn — the street case, i.e. the one a prospect sees — there
// is no body to follow and the walk is flat, so a line claiming "this follows the
// burn down" would be false in exactly that configuration.
ok("...and never claims to follow a body it does not have",
   /\{!canFollow\s*\n?\s*\? <>\{mNum !== null/.test(SIM_CODE)
   && /A real burn \{gaining \? "rises as weight goes on" : "falls as weight comes off"\}/.test(SIM_CODE));

// ── 5f. the caveats follow the DIRECTION, not just the horizon (S217) ──────
// Kevin: "if I select calorie numbers that put clients in a surplus I would like
// to see the estimated amount of… overall weight that they'll be gaining."
// ⚠️ THE PROJECTION ALWAYS WORKED IN BOTH DIRECTIONS — `dir` and `fmtLbs` have
// handled a surplus since S198z. What did NOT was the PROSE: "a real burn falls
// as weight comes off" is false for somebody gaining, and it sat directly under
// a "+8.6 lbs" tile.
ok("the direction is taken from the projection, not the pace chip",
   /const gaining = balance > 20;/.test(SIM_CODE));
// ⚠️ SAME ±20 DEAD BAND AS `dir`, or the headline and the caveat under it can
// disagree about which way somebody is going.
ok("...on the same dead band as the headline", /const dir = balance < -20 \? "lose" : balance > 20 \? "gain"/.test(SIM_CODE));
// ⚠️ COUNTED. Five caveats name a direction; one left hardcoded is a false
// sentence under a true number, which is the S216b SummaryTab shape again.
ok("every direction-dependent caveat reads from it",
   (SIM_CODE.match(/\{gaining \?/g) || []).length === 6,
   (SIM_CODE.match(/\{gaining \?/g) || []).length);
ok("...and none of them still hardcodes losing",
   !/burn falls as \{they\} get lighter/.test(SIM_CODE)
   && !/A real burn falls as weight comes off,/.test(SIM_CODE)
   && !/re-worked as the weight\s*\n?\s*comes off/.test(SIM_CODE));
// The projection itself is unchanged and still answers both ways.
{
  const gain = M.simProject({ days: 30, startLbs: 150, weekHold: () => 2400 * 7, dayIntake: () => 2900 });
  ok("a surplus comes back as a gain", gain.lost < 0 && Math.abs(gain.lost + (500 * 30) / CAL_PER_LB) < 1e-9, gain.lost);
  ok("...and the end weight goes UP", gain.end > 150);
  ok("...and it never halts on the way up", gain.halted === 0);
}
ok("...and a year is flagged in the warning colour", /horizon >= 365 \? "var\(--yellow\)" : "var\(--muted\)"/.test(SIM_CODE));
ok("a scenario that runs off the scale says so rather than asserting a body",
   /horizonProj\.halted > 0 && \(/.test(SIM_CODE));
// It still writes nothing.
ok("the calendar writes nothing either", !/onChange\(/.test(SIM_CODE) && !/storage\./.test(SIM_CODE));

// ── 6. the engine itself is unchanged ───────────────────────────────────────
// Dropping the two scalar modes removed two ways of SAYING the same sum, not a
// second sum. The lifted lines still have to behave like the scalar engine that
// shipped.
{
  // ⚠️ `lbsIn` IS DELIBERATELY NOT LIFTED ANY MORE. Since S217 it reads the
  // projector rather than multiplying the balance, and the old `[^;]*` pattern
  // silently returned HALF of its new body — the S211 "slice to the next
  // semicolon" trap. What this block is about is the weekly BALANCE; the flat
  // reference below is what the projector must reproduce at day 0, and
  // scripts/test-what-if-week.mjs proves that separately by running simProject.
  const engine = new Function("weekIntake", "burnWeek", "holdDay", "CAL_PER_LB", `
    ${SIM_CODE.match(/const weekBalance = [^\n]*/)[0]}
    ${SIM_CODE.match(/const balance = weekBalance \/ 7;/)[0]}
    ${SIM_CODE.match(/const dir = balance [^\n]*/)[0]}
    const lbsIn = (days) => (-balance * days) / CAL_PER_LB;
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
  // ⚠️ AND NEITHER SENTENCE MAY NAME A PLAN THAT DOES NOT EXIST (S217). With
  // nobody attached, "starts from the week already in your plan" promises a seed
  // there is none of, and "nothing here changes your plan" reassures about a
  // plan there is none of. Found by opening the standalone modal, not by reading.
  ok("...and both sentences are mode-aware",
     /standalone \? "Nothing is saved\." : "Nothing here changes your plan\."/.test(SIM_CODE)
     && /:\s*standalone\s*\n?\s*\? <>Add the training \{theyd\} actually do/.test(SIM_CODE));
  // ⚠️ AND THE BANK PAGE GETS ITS OWN, because "starts from the week already in
  // your plan" is not what that page is asking about.
  ok("...and the bank page reframes the same planner as income",
     /page === "bank"\s*\n?\s*\? <>Every session \{they\} do is money in/.test(SIM_CODE));
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
// ⚠️ A UNIVERSAL REST BUTTON IS THE OTHER HALF OF QUICK FILL (Kevin, S217: "I
// want to be able to show calories burned if I want to and also immediately
// remove all of the exercises or calories burned so they can see the
// difference"). The whole point is the A/B — put 200 a day on Mon–Fri, show the
// numbers, wipe it, show them again — and wiping was seven visits to seven cards.
ok("quick fill can clear days, not only fill them",
   /<button onClick=\{\(\) => setFillKind\("rest"\)\} aria-pressed=\{fillIsRest\}/.test(SIM_CODE));
// ⚠️ REST IS AN EMPTY DAY, NOT A {type:"rest"} SESSION. A session would render a
// day card with a picker in it, summarised as "Rest Day · 30m"; an empty list is
// what "no training" actually is, and it is what seedSimCardio produces.
ok("...and clearing writes an empty day, not a rest-shaped session",
   /out\[day\] = fillIsRest \? \[\] : \[\{ \.\.\.sess \}\];/.test(SIM_CODE));
ok("...and the button says which of the two it will do",
   /\{fillIsRest \? "Clear" : "Apply to"\}/.test(SIM_CODE));
ok("...and it needs no calorie or exercise field", /\{fillIsRest \? \(/.test(SIM_CODE));
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
  // ⚠️ CENTRED SINCE S217, WHICH SUPERSEDES THE RIGHT-PADDING FIX. What has to
  // stay true is unchanged and is the thing Kevin described twice: the digits are
  // not jammed against the browser's spinner arrows. Centring achieves it by
  // putting them in the middle rather than by pushing them off one edge.
  const parts = pad[1].split(/\s+/);
  const [top, side] = parts;
  ok("...the padding is symmetric, so the optical centre is honest", parts.length === 2, pad[1]);
  // ⚠️ NO LONGER "GENEROUS ENOUGH TO CLEAR THE SPINNER" (S218). That assertion
  // demanded >= 24px, and the 26px it was pinning is exactly what clipped the
  // placeholders: 126px box - 52px padding = 74px of content for an 80px
  // "e.g. 2,400". The spinner is removed at the sheet now, so the requirement
  // inverts — the padding must be SMALL enough to leave the text its room.
  ok("...and small enough to leave the placeholder room, now nothing overlaps it",
     parseFloat(side) <= 14, pad[1]);
  ok("...vertical padding is unchanged", top === "9px", pad[1]);
  ok("the digits sit in the middle of the box", /textAlign: "center"/.test(decl[0]));
  // ⚠️ AND EVERY BOX IS WIDE ENOUGH FOR THE WIDEST LEGAL VALUE. Centring costs
  // the padding on BOTH sides, so a five-digit 35,000 — simNum's own ceiling —
  // clipped in the 108px day boxes. Measured in the browser, not reasoned about.
  {
    // ⚠️ PADDING IS READ FROM THE DECLARATION, NOT HARDCODED. This said
    // `26 * 2`, and S218 changed numInput to 12px — so the check had been
    // computing against a padding the app no longer uses and was over-strict by
    // 28px. It kept passing only because every existing box had room to spare.
    // A constant that restates the thing it is testing goes stale in silence.
    const pad = parseFloat(side) * 2, border = 2, digit = 8.4;   // .88rem DM Sans, measured
    const widths = [...SIM_CODE.matchAll(/\.\.\.numInput, width: "(\d+)px"/g)].map((m) => Number(m[1]));
    ok("every numeric box is declared with a width", widths.length >= 6, widths);
    ok("...and all of them fit five digits", widths.every((w) => w - pad - border >= digit * 5), widths);
  }
  // ⚠️ SCOPED TO INPUT STYLES. Three things in this sheet are legitimately
  // right-aligned and must stay so: the +/− delta beside each day row, and the
  // two link rows ("Reset to my pace", "Back to my plan's week"). An over-broad
  // scan fails on somebody else's correct code.
  ok("...and no INPUT is right-aligned any more", !/\.\.\.input, textAlign: "right"/.test(SIM_CODE));
  // ⚠️ COUNTED, NOT FOUND. FOUR number boxes take a right-aligned figure — the
  // seven day inputs, "set every day to", quick fill's calories, and a per-day
  // manual session. Fixing one and leaving three is the shape check:weak exists
  // to catch.
  // ⚠️ SEVEN: the seven day inputs share one, plus "set every day to",
  // quick fill's calories, a per-day manual session, the typed daily burn and
  // the typed weight. Fixing one and leaving five is the shape check:weak exists
  // to catch — this count is the only thing that notices.
  ok("every numeric box in the modal uses it", (SIM_CODE.match(/\.\.\.numInput/g) || []).length === 8,
     (SIM_CODE.match(/\.\.\.numInput/g) || []).length);
  // ⚠️ ONE alignment style, and it is `numInput`'s own declaration. A second
  // hand-rolled `{...input, textAlign: …}` anywhere else is a box that kept the
  // default padding and put its digits back under the arrows.
  ok("...and no second alignment was hand-rolled beside it",
     (SIM_CODE.match(/\.\.\.input, textAlign:/g) || []).length === 1,
     (SIM_CODE.match(/\.\.\.input, textAlign:/g) || []).length);
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
   (SIM_CODE.match(/check this number/g) || []).length === 8,
   (SIM_CODE.match(/check this number/g) || []).length);
ok("...and the reset stays reachable when the only entry was refused",
   /const anyTyped = weekCals\.some/.test(SIM_CODE) && /disabled=\{!anyTyped\}/.test(SIM_CODE));
ok("the inputs' own max matches the parser's", (SIM_CODE.match(/max="50000"/g) || []).length === 5);
// ⚠️ AND THE TWO TIGHTER FIELDS PASS THEIR CEILING TO BOTH HALVES. simRejected
// called simNum with the DEFAULT 50,000 cap, so a burn typed above 20,000 would
// be refused by the parser and then render no warning — the silent swallow this
// suite already guards, one layer down.
ok("the typed burn parses and warns at the SAME ceiling",
   /simNum\(mOverride, SIM_BURN_MAX\)/.test(SIM_CODE)
   && (SIM_CODE.match(/simRejected\(mOverride, SIM_BURN_MAX\)/g) || []).length === 2,
   (SIM_CODE.match(/simRejected\(mOverride, SIM_BURN_MAX\)/g) || []).length);
ok("...and so does the typed weight",
   /simNum\(wOverride, 2000\)/.test(SIM_CODE) && /simRejected\(wOverride, 2000\)/.test(SIM_CODE));
// ⚠️ TWO RENDER SITES SINCE S217, AND THEY ARE DIFFERENT STATEMENTS: one about
// the seven-day week, one about the chosen stretch. Counted so a third cannot
// appear unnoticed, and each is pinned to its own PER-DAY list below — an
// average cannot see a dozen 900-calorie days inside a stretch that means 1,900.
ok("the 1,200 warning has exactly two render sites, the week and the stretch",
   (SIM_CODE.match(/isn&rsquo;t healthy or sustainable/g) || []).length === 2,
   (SIM_CODE.match(/isn&rsquo;t healthy or sustainable/g) || []).length);
ok("...the week one names the days", /joinDays\(wp\.lowDays, DAY_SHORT\)/.test(SIM_CODE));
ok("...the stretch one counts them", /\{lowDates\.length > 0 && \(/.test(SIM_CODE));
ok("...and neither is judged on an average",
   !/weekIntake \/ 7[^\n]*< 1200/.test(SIM_CODE) && !/horizonProj\.(eaten|lost)[^\n]*MIN_DAILY_CAL/.test(SIM_CODE));
// ⚠️ ASSERT THE GATE, NOT JUST THE BODY. Swapping the condition to judge the
// weekly MEAN keeps the day names in the source and hides three 900-calorie days
// behind a 1,586 average — the exact defect this suite claims to guard.
ok("the floor gate counts LOW DAYS, not the mean", /\{wp\.lowDays\.length > 0 && \(/.test(SIM_CODE));
ok("...and nothing judges the floor on an average", !/weekIntake \/ 7[^\n]*< 1200/.test(SIM_CODE));
ok("burn spreading is disclosed, not assumed", /Training is spread evenly across the week/.test(SIM_CODE));
// ── the day rows must agree with the headline ─────────────────────────────
ok("holding steady includes the burn the ladder has not already paid for", /const holdSteady = holdDay \+ burnPerDay;/.test(SIM_CODE));
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
