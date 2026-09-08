// "Day by day" in the What if… sandbox, and the cardio-only picker (S213).
//
// Kevin's ask, in two halves:
//   1. "Not everybody's going to eat the same exact calories every single day,
//      so we want a realistic scale of what overeating and undereating on each
//      day can do to the week." Seven Mon→Sun numbers, as an OPTION beside the
//      two modes that already ship.
//   2. "Make it be just cardio for the exercise selection… look and act just
//      like the workout burn section… I want all of the same options."
//
// WHAT THIS FEATURE PROMISES, and therefore what has to stay true:
//
//   1. THE THREE MODES SHARE ONE ARITHMETIC PATH. The week is the basis and the
//      other two are the same sum times seven, so pace and one-number must come
//      out bit-identical to what they show today. A second float path is how two
//      screens start quoting different numbers for the same person.
//   2. A BLANK DAY IS THE GOAL PACE — not zero, and not the mean of the days
//      that were typed. Zero invents a deficit nobody described; the mean turns
//      one typed 3,500 into a 3,500-a-day week, which is the opposite of the
//      answer someone came for.
//   3. NOTHING THE USER TYPES IS CLAMPED, AND NO SUB-1,200 DAY IS HIDDEN. The
//      sandbox displays rather than prescribes (CLAUDE.md's 1,200 standard), so
//      a typed 900 shows as 900 — but a mean cannot see three of them inside a
//      week that averages 1,586, so the days are NAMED.
//   4. THE MAKE-UP DROPDOWN MUST NOT WHITE-SCREEN AGAIN. `muMinutes` read
//      `pickedEx` fourteen lines above its own `const`; picking any day threw a
//      temporal-dead-zone ReferenceError and, with no error boundary anywhere in
//      src/, unmounted the whole app. `check:undef` CANNOT see it — it filters
//      on `no-undef`, and `pickedEx` IS declared. The ordering assertion below
//      is the only guard.
//   5. CARDIO ONLY MEANS CARDIO ONLY — including the custom STRENGTH exercises
//      that used to reach the list through the "Custom" group.
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

// ── lift the shipping helpers and RUN them ──────────────────────────────────
const liftFn = (name) => {
  const m = APP.match(new RegExp(`\\n(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
};
const M = new Function(`
  ${liftFn("simNum")}
  ${liftFn("weekPlan")}
  ${liftFn("joinDays")}
  ${liftFn("simRejected")}
  return { simNum, weekPlan, joinDays, simRejected };
`)();
const { simNum, weekPlan, joinDays, simRejected } = M;

// The component body, so source assertions can't accidentally match the rest of
// a 36,000-line file.
const SIM_A = APP.indexOf("function CalorieSimulator(");
const SIM_B = APP.indexOf("function DailyDashboard(", SIM_A);
ok("found the CalorieSimulator body", SIM_A > 0 && SIM_B > SIM_A);
const SIM = APP.slice(SIM_A, SIM_B);
// ⚠️ STRIP COMMENTS BEFORE ASSERTING ON WHAT RENDERS. This bit S208 three times:
// a check matched the very COMMENT that names the thing it forbids, and went
// green on a correct file — or red on one. Two of the assertions below
// ("CustomExerciseCreator is not ported", "no emoji") are about rendered output
// and MUST run against code with the prose removed; the ⚠️ markers this repo
// writes in comments are not UI.
const codeOnly = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const SIM_CODE = codeOnly(SIM);

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAL_PER_LB = 3500;

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
// The cap is generous on purpose: a sandbox that only DISPLAYS should let
// somebody model a genuine blow-out day, and 35,000 was being thrown away.
ok("a real blow-out day is modellable", simNum("35000") === 35000);
ok("null/undefined are blank", simNum(null) === null && simNum(undefined) === null);

// ── 2. a blank day is the goal pace ─────────────────────────────────────────
{
  const only = [null, null, null, null, null, 3500, null];     // "Saturday is my big day"
  const wp = weekPlan(only, { fallback: 2000 });
  ok("blanks are priced at the pace, not at zero", wp.weekIntake === 2000 * 6 + 3500, wp.weekIntake);
  // ⚠️ NOT THE MEAN OF WHAT WAS TYPED. That would make one 3,500 entry assume
  // 3,500 every day — 24,500 for the week.
  ok("...and NOT at the mean of the days that were typed", wp.weekIntake !== 3500 * 7);
  ok("one entry is counted as one", wp.enteredCount === 1);
  // ⚠️ RANKED OVER THE WEEK THAT IS SHOWN, not over the days that were typed.
  // Ranking only typed days made this line plainly false: type your two heavy
  // days on a loss plan and it named the lighter of THOSE as the week's
  // lightest, while five untouched days sat lower still.
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
  // The case a scalar check cannot see: the mean clears the floor, three days
  // do not.
  const wp = weekPlan([2100, 2100, 2100, 900, 900, 900, 2100], { fallback: 2000 });
  ok("the mean clears 1,200", Math.round(wp.weekIntake / 7) === 1586, Math.round(wp.weekIntake / 7));
  ok("...but the three low days are still named", wp.lowDays.join(",") === "3,4,5", wp.lowDays);
  ok("what the user typed is NEVER clamped up to the floor", wp.effective[3] === 900);
  ok("the days read as English", joinDays(wp.lowDays, DAY_SHORT) === "Thu, Fri and Sat");
}
ok("exactly 1,200 is not a violation", weekPlan([1200, 1200, 1200, 1200, 1200, 1200, 1200], { fallback: 2000 }).lowDays.length === 0);
// A pace target at the floor makes every BLANK day a floor day — it must count.
ok("blank days count against the floor when the pace itself is at it",
   weekPlan([null, null, null, null, null, null, 900], { fallback: 1100 }).lowDays.length === 7);
ok("joinDays: one day", joinDays([3], DAY_SHORT) === "Thu");
ok("joinDays: two days", joinDays([3, 5], DAY_SHORT) === "Thu and Sat");
ok("joinDays: all seven collapses", joinDays([0, 1, 2, 3, 4, 5, 6], DAY_SHORT) === "every day");
ok("joinDays: nothing is nothing", joinDays([], DAY_SHORT) === "");

// ── 4. ONE arithmetic path — the two shipped modes may not move ─────────────
// ⚠️ LIFTED FROM THE SOURCE, NOT RETYPED. An earlier version of this block swept
// 106,015 combinations of two expressions written in THIS FILE — which proves an
// identity of integer arithmetic and nothing whatsoever about src/App.jsx. Six
// mutations of the real engine left it green. The engine's own lines are pulled
// out and executed now, so breaking one fails here.
{
  const grab = (re, what) => { const m = SIM.match(re); if (!m) throw new Error(`could not lift ${what}`); return m[0]; };
  const engine = new Function("weekIntake", "burnPerDay", "maintain", "ready", "CAL_PER_LB", `
    ${grab(/const weekBalance = [^\n]*/, "weekBalance")}
    ${grab(/const balance = ready \? [^\n]*/, "balance")}
    ${grab(/const lbsIn = \(days\) => [^;]*;/, "lbsIn")}
    ${grab(/const dir = balance [^\n]*/, "dir")}
    return { balance, dir, lbs: [7, 14, 30, 60].map(lbsIn) };
  `);
  // And the mode wiring, so "weekIntake = intake * 7 in the scalar modes" is a
  // claim about the shipping line rather than about this test.
  ok("the scalar modes derive the week as intake * 7", /const weekIntake = mode === "week" \? wp\.weekIntake : intake \* 7;/.test(SIM_CODE));
  ok("...and balance divides the week back down by 7", /const balance = ready \? weekBalance \/ 7 : 0;/.test(SIM_CODE));

  let mismatch = null, n = 0;
  for (const maintain of [1200, 1850, 2437, 3011]) {
    for (const burnPerDay of [0, 37, 214, 500, 1234]) {
      for (let intake = 800; intake <= 6000; intake += 1) {
        const got = engine(intake * 7, burnPerDay, maintain, true, CAL_PER_LB);
        const old = intake - burnPerDay - maintain;                   // the shipped scalar engine
        n++;
        if (got.balance !== old) { mismatch = { intake, burnPerDay, maintain, got: got.balance, old }; break; }
        const wantDir = old < -20 ? "lose" : old > 20 ? "gain" : "hold";
        if (got.dir !== wantDir) { mismatch = { intake, burnPerDay, maintain, dir: got.dir, wantDir }; break; }
        const wantLbs = [7, 14, 30, 60].map((days) => (-old * days) / CAL_PER_LB);
        if (got.lbs.some((v, i) => v !== wantLbs[i])) { mismatch = { intake, burnPerDay, maintain, lbs: got.lbs, wantLbs }; break; }
      }
      if (mismatch) break;
    }
    if (mismatch) break;
  }
  ok(`the SHIPPED weekly engine is bit-identical to the old scalar one (${n.toLocaleString()} combinations)`, !mismatch, mismatch);

  // Negative control: the rounding trap the comment warns about. Multiplying an
  // UNROUNDED weekly burn instead of the rounded per-day scalar shifts tiles.
  const naive = (intake, burn7, maintain) => (intake * 7 - burn7 - maintain * 7) / 7;
  ok("control: multiplying an unrounded weekly burn really does drift",
     naive(2000, 214.4 * 7, 2450) !== engine(2000 * 7, Math.round(214.4), 2450, true, CAL_PER_LB).balance);
}

// ── 4b. a rejected number is not a blank ────────────────────────────────────
// ⚠️ THE SILENT SWALLOW. A fat-fingered 60000 parses to null, and null is the
// sentinel for "they didn't say" — so the box kept showing 60000 while the row
// beside it read "on your goal" and the week counted the GOAL for that day. A
// typed surplus was replaced by its opposite with nothing on screen saying so.
ok("a blank is not a rejection", simRejected("") === false && simRejected("   ") === false);
ok("an out-of-range number IS a rejection", simRejected("60000") === true);
ok("letters are a rejection", simRejected("abc") === true);
ok("a negative is a rejection", simRejected("-5") === true);
ok("1e400 is a rejection", simRejected("1e400") === true);
ok("a good number is not a rejection", simRejected("2100") === false && simRejected("0") === false);
// ⚠️ COUNTED, NOT FOUND (the check:weak rule). The warning has TWO render
// sites — the day row and the one-number field — and `.test()` stayed green
// when one of them was reverted to "on your goal".
ok("the screen says so rather than claiming the goal, on BOTH inputs that take a number",
   (SIM_CODE.match(/check this number/g) || []).length === 2,
   (SIM_CODE.match(/check this number/g) || []).length);
ok("...and the burn field flags it too", /simRejected\(extraBurn\) \? "check this"/.test(SIM_CODE));
ok("...and the reset stays reachable when the only entry was refused",
   /const anyTyped = weekCals\.some/.test(SIM_CODE) && /disabled=\{!anyTyped\}/.test(SIM_CODE));
ok("the input's own max matches the parser's", /max="50000"/.test(SIM_CODE));

// ── 4c. the day rows must agree with the headline ───────────────────────────
// Once cardio is added, breaking even for a day is maintain + burnPerDay. The
// rows compared against `maintain` alone, so every day could be painted amber
// ("over") while the answer underneath said LOSING.
ok("holding steady includes the cardio that was added", /const holdSteady = maintain \+ burnPerDay;/.test(SIM_CODE));
ok("...the row colours use it", /v < holdSteady - 20 \? "var\(--green\)" : v > holdSteady \+ 20/.test(SIM_CODE));
// ⚠️ AND SO DOES THE NUMBER BESIDE THEM. Colouring against holdSteady while
// printing a delta against `maintain` made one row say two contradictory
// things — a green "+550". Found in a browser, not by reading.
ok("...and so does the delta printed next to them",
   /Math\.abs\(val - holdSteady\) <= 20 \? "even"/.test(SIM_CODE)
   && /val > holdSteady \? "\+" : "−"/.test(SIM_CODE));
ok("...with no stray comparison against bare maintain left in the rows",
   !/val - maintain/.test(SIM_CODE));
ok("...and the caption says it out loud", /\{holdSteady\.toLocaleString\(\)\}/.test(SIM_CODE));

// ── 4d. the two duration lists do not match ─────────────────────────────────
// HeartRatePicker offers a 5-minute chip; the exercise <select> (DURATIONS)
// starts at 10. Carrying a 5 across left the select with no matching option, so
// React selected the first — showing "10 minutes" while computing on 5.
{
  const src = APP.match(/const toDuration = \(m\) =>[\s\S]*?DURATIONS\[0\]\)\);/);
  ok("the duration snap exists", !!src);
  const toDuration = new Function(`const DURATIONS = [10,15,20,25,30,35,40,45,50,60,75,90]; ${src[0]}; return toDuration;`)();
  ok("5 minutes snaps to the nearest offered length", toDuration(5) === 10);
  ok("an offered length is untouched", toDuration(45) === 45 && toDuration(90) === 90);
  ok("every HR chip lands on a real option",
     [5, 10, 15, 20, 30, 40, 45, 60, 75, 90].every((m) => [10,15,20,25,30,35,40,45,50,60,75,90].includes(toDuration(m))));
  ok("both ways out of heart-rate mode go through it",
     (SIM_CODE.match(/goExercise/g) || []).length === 3, (SIM_CODE.match(/goExercise/g) || []).length);
}

// ── 4e. heart rate: one assumption about a missing age ──────────────────────
// HeartRatePicker defaults a missing age to 30 and printed a calorie estimate;
// hrCaloriesPerMin returns 0 without an age, so the projection counted nothing
// for the very same session and hid the Cardio row.
ok("one age assumption feeds both halves", /const hrAgeData = effectiveAge\(hrData\) > 0 \? hrData/.test(SIM_CODE));
ok("...the picker gets it", /<HeartRatePicker data=\{hrAgeData\}/.test(SIM_CODE));
ok("...and so does the burn resolution", /cardioExFor\(session, hrAgeData\)/.test(SIM_CODE));
// The MET path must NOT get an injected age — restingKcalPerMin reads it, and
// that would move burn numbers on every age-less plan.
ok("the MET path is left alone", /exBurn\(pickedEx, w, dur, hrData\)/.test(SIM_CODE));

// ── 5. the white screen must not come back ──────────────────────────────────
// ⚠️ THIS IS THE ONLY GUARD. `npm run check:undef` collects `no-undef` and
// `pickedEx` IS declared — just, until S213, fourteen lines too late.
{
  const decl = SIM.indexOf("const pickedEx");
  const use = SIM.indexOf("muMinutes");
  ok("pickedEx is declared", decl > 0);
  ok("muMinutes exists", use > 0);
  ok("pickedEx is declared BEFORE muMinutes reads it (the S200r white screen)", decl < use, { decl, use });
}
// The divisor floor turned a zero-burn exercise into "≈ 833 min of Rest Day" —
// raw calories printed as minutes. Rest Day is now the DEFAULT state.
ok("the make-up minutes no longer divide by a floored-to-1 burn", !/Math\.max\(1, exBurn/.test(SIM_CODE));
ok("...it refuses instead when the burn is zero", /perMin > 0 \? Math\.round\(mu\.burnPerDay \/ perMin\)/.test(SIM_CODE));

// ── 6. cardio only, with all of the same options ────────────────────────────
ok("the picker is the wizard's, in cardio mode", /kind="cardio"/.test(SIM_CODE));
ok("strength groups are gone from the simulator", !/STRENGTH_GROUPS/.test(SIM_CODE));
// ⚠️ THE EASY MISS. Dropping the STRENGTH_GROUPS spread while leaving the
// custom-strength line keeps every user-created lift reachable under "Custom".
ok("...and so are custom STRENGTH exercises", !/customOf\(d\.customExercises, "strength"\)/.test(SIM_CODE));
ok("the plan's custom CARDIO is still threaded in", /customExercises=\{d\.customExercises\}/.test(SIM_CODE));
// "All of the same options" — each element of StepCardio's cardio session block.
ok("heart-rate mode is reachable from the sheet", /onPickHr=\{goHr\}/.test(SIM_CODE));
ok("...and from the link beside the label", /By heart rate/.test(SIM_CODE));
ok("...and there is a way back out", /Pick an exercise instead/.test(SIM_CODE));
ok("the heart-rate picker itself is rendered", /<HeartRatePicker/.test(SIM_CODE));
ok("durations are the wizard's list, not a free-text box", /DURATIONS\.map/.test(SIM_CODE));
ok("the old minutes free-text box is gone", !/setExMin/.test(SIM_CODE));
ok("the old native optgroup select is gone", !/<optgroup/.test(SIM_CODE));
// exBurn's 4th argument anchors 1 MET to this person's BMR; dropping it makes
// the modal disagree with every other screen.
ok("exBurn is called with the plan data", (SIM_CODE.match(/exBurn\(pickedEx, w, [a-z0-9]+, hrData\)/g) || []).length === 2,
   (SIM_CODE.match(/exBurn\(pickedEx, w, [a-z0-9]+, hrData\)/g) || []).length);
// A heart-rate session is a SHAPE. Every switch replaces the whole object.
ok("switching to heart rate replaces the session", /\{ type: "hr", hr: 0, duration: s2\.duration \|\| 30 \}/.test(SIM_CODE));
ok("the HR picker's emit is wrapped with the type", /setSession\(\{ type: "hr", hr, duration \}\)/.test(SIM_CODE));
// CustomExerciseCreator WRITES to the plan; this modal promises it writes nothing.
ok("the plan-writing custom-exercise creator is NOT ported", !/CustomExerciseCreator/.test(SIM_CODE));
ok("the sandbox still promises it changes nothing", /Nothing here changes your plan/.test(SIM_CODE));

// ── 7. the screen ───────────────────────────────────────────────────────────
ok("all three modes are offered", /\["pace", "Pick a pace"\], \["typed", "One number"\], \["week", "Day by day"\]/.test(SIM_CODE));
ok("the days run Monday first", /DAYS\.map\(\(dayName, i\)/.test(SIM_CODE) && /DAY_SHORT\[i\]/.test(SIM_CODE));
ok("a blank day shows the pace as its placeholder", /placeholder=\{paceTarget\.toLocaleString\(\)\}/.test(SIM_CODE));
ok("...and says so in words", /on your goal/.test(SIM_CODE));
ok("the week total is shown, not just the average", /for the week/.test(SIM_CODE));
// ⚠️ ONE render site for the floor warning — two would be the check:weak shape,
// and would let one of them drift.
ok("the 1,200 warning has exactly one render site",
   (SIM_CODE.match(/isn&rsquo;t healthy or sustainable/g) || []).length === 1,
   (SIM_CODE.match(/isn&rsquo;t healthy or sustainable/g) || []).length);
ok("...and in week mode it names the days", /joinDays\(wp\.lowDays, DAY_SHORT\)/.test(SIM_CODE));
// ⚠️ ASSERT THE GATE, NOT JUST THE BODY. The day-name expression lives INSIDE
// the warning; swapping the condition to judge the weekly MEAN keeps it in the
// source and hides three 900-calorie days behind a 1,586 average — the exact
// defect this suite's header claims to guard, passing green.
ok("the week-mode floor gate counts LOW DAYS, not the mean",
   /isWeek \? wp\.lowDays\.length > 0 : intake > 0 && intake < 1200/.test(SIM_CODE));
ok("...and nothing judges the floor on an average", !/weekIntake \/ 7[^\n]*< 1200/.test(SIM_CODE));
ok("burn spreading is disclosed, not assumed", /Cardio is spread evenly across the week/.test(SIM_CODE));
// Switching mode must change only which slot is READ. The toggle's handler is
// exactly setMode and nothing else, and no effect is keyed on `mode` — either
// would silently discard seven typed days on a mis-tap.
ok("the mode toggle only sets the mode", /onClick=\{\(\) => setMode\(v\)\}/.test(SIM_CODE));
ok("...and nothing resets the other slots when it changes",
   !/useEffect\([\s\S]{0,400}\[mode\]\)/.test(SIM_CODE));
ok("the only destructive control is the explicit reset",
   (SIM_CODE.match(/setWeekCals\(\["", "", "", "", "", "", ""\]\)/g) || []).length === 1);
ok("the exercise sheet's Back does not close the whole simulator", /if \(sheetCount > 0\) return;/.test(SIM_CODE));
// ⚠️ THE NARROW RANGE MISSED THE ONES THIS REPO ACTUALLY SHIPS — ⭐ (S35/S78,
// the custom-exercise UI this very change touches), ⏳ (S51), ⏱ (S88), ⓘ (S90).
// Extended_Pictographic covers the lot.
ok("no emoji in the new UI", !/\p{Extended_Pictographic}/u.test(SIM_CODE),
   (SIM_CODE.match(/\p{Extended_Pictographic}/gu) || []).join(""));

// ── 8. negative controls — can this file see the bugs it guards? ────────────
// Each returns a plausible value rather than throwing, so a green result cannot
// come from the harness falling over (the S202 lesson).
{
  // Blanks as ZERO — invents a deficit nobody described.
  const naiveZero = (vals, fb) => vals.map((x) => (x === null ? 0 : x)).reduce((a, b) => a + b, 0);
  const only = [null, null, null, null, null, 3500, null];
  ok("control: pricing blanks at zero is caught",
     naiveZero(only, 2000) !== weekPlan(only, { fallback: 2000 }).weekIntake);
  // Blanks as the MEAN OF ENTERED — the rejected semantic.
  const naiveMean = (vals) => { const e = vals.filter((x) => x !== null); const m = e.reduce((a, b) => a + b, 0) / e.length; return vals.map((x) => (x === null ? m : x)).reduce((a, b) => a + b, 0); };
  ok("control: pricing blanks at the mean of entered days is caught",
     naiveMean(only) === 24500 && weekPlan(only, { fallback: 2000 }).weekIntake === 15500);
  // The floor evaluated on the MEAN — silent on three 900-calorie days.
  const naiveFloor = (vals, fb) => (weekPlan(vals, { fallback: fb }).weekIntake / 7 < 1200 ? ["mean"] : []);
  const hidden = [2100, 2100, 2100, 900, 900, 900, 2100];
  ok("control: checking the floor on the mean is caught",
     naiveFloor(hidden, 2000).length === 0 && weekPlan(hidden, { fallback: 2000 }).lowDays.length === 3);
  // The old parser.
  const oldNum = (x) => Math.round(Number(x) || 0);
  ok("control: the old parser really did produce Infinity",
     oldNum("1e400") === Infinity && simNum("1e400") === null);
  ok("control: the old parser really did read a blank as zero",
     oldNum("") === 0 && simNum("") === null);
  // The old make-up divisor.
  const oldMu = (burn, per) => Math.round(burn / Math.max(1, per));
  ok("control: the floored divisor really did print calories as minutes",
     oldMu(833, 0) === 833);
  // A mirror of the TDZ ordering check that would pass on the broken file.
  const brokenOrder = "const muMinutes = mu && pickedEx;\nconst pickedEx = 1;";
  ok("control: the ordering assertion goes red on the shipped-broken shape",
     !(brokenOrder.indexOf("const pickedEx") < brokenOrder.indexOf("muMinutes")));
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  Day by day: one engine, blanks on the goal, no hidden low days, no white screen.\n");
