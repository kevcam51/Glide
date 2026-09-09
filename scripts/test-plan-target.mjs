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

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── lift the real thing ─────────────────────────────────────────────────────
const CONSTS = ["DAYS", "REST_ST", "STRENGTH_EXERCISES", "CARDIO_GROUPS", "ALL_CARDIO",
  "ACTIVITY_LEVELS", "MIN_DAILY_CAL", "HR_ZONES", "RATE_OPTS", "OVER_TOLERANCE", "PARTIAL_DAY_MIN"];
const FNS = ["calcBMR", "ageFromDob", "effectiveAge", "customOf", "findCardioEx", "hrCaloriesPerMin",
  "restingKcalPerMin", "calcBurn", "cardioExFor", "exBurn", "isEatback", "dailyDeficitOf", "weeklyRateOf",
  "planEnergy", "planIntakeForRate", "computeClientCalories", "overDaysFrom", "makeUpPlan"];
const grab = (re, n) => { const m = APP.match(re); if (!m) throw new Error(`could not lift ${n}`); return m[0]; };
const source = () => [...CONSTS, "atLeastMinCal", ...FNS].map((n) => liftDecl(APP, n)).join("\n");
const build = (src) => new Function(`${src}; return { planEnergy, planIntakeForRate, computeClientCalories, overDaysFrom, makeUpPlan, weeklyRateOf, OVER_TOLERANCE, atLeastMinCal };`)();
const M = build(source());

// Real catalog ids, taken from the file rather than typed from memory — a made-up
// id resolves to the rest entry and silently zeroes every burn in this suite.
const STRENGTH_ID = [...APP.matchAll(/id:"([a-z_0-9]+)"[^}]*cat:"/g)].map((m) => m[1])[0];
const CARDIO_ID = [...APP.matchAll(/\{ id:"([a-z_0-9]+)",\s+label:"[^"]*",\s+icon:"[^"]*",\s+met:/g)].map((m) => m[1])[0];
ok("lifted a real strength id from the catalog", !!STRENGTH_ID, STRENGTH_ID);
ok("lifted a real cardio id from the catalog", !!CARDIO_ID, CARDIO_ID);

// The reference plan: eat-back (deficitMode unset) with NON-UNIFORM training —
// the shape that made the dashboard's target swing by weekday.
const P = (over = {}) => ({
  gender: "female", age: 35, heightFt: 5, heightIn: 6, weightLbs: 170,
  activityLevel: "moderate", weeklyRate: 1,
  strength: { Monday: [{ type: STRENGTH_ID, duration: 60 }], Wednesday: [{ type: STRENGTH_ID, duration: 60 }],
    Friday: [{ type: STRENGTH_ID, duration: 60 }] },
  ...over,
});

// ── 1. one basis, shared with the five other readers ────────────────────────
{
  const plans = [
    ["flat, no training", P({ strength: {} })],
    ["eat-back, Mon/Wed/Fri", P()],
    ["accelerate", P({ deficitMode: "accelerate" })],
    ["identical every day", P({ strength: Object.fromEntries(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((dd) => [dd, [{ type: STRENGTH_ID, duration: 30 }]])) })],
    ["maintenance", P({ weeklyRate: 0 })],
    ["gaining", P({ weeklyRate: -1 })],
    ["floor-bound small frame", P({ weightLbs: 105, heightFt: 4, heightIn: 11, age: 62, activityLevel: "sedentary", weeklyRate: 2 })],
    ["with cardio", P({ cardio: { Tuesday: [{ type: CARDIO_ID, duration: 45 }] } })],
    ["with heart-rate cardio", P({ cardio: { Tuesday: [{ type: "hr", hr: 145, duration: 40 }] } })],
    ["with a met custom (S183j+)", P({ customExercises: [{ id: "cx1", type: "strength", met: 7, isCustom: true, label: "X" }], strength: { Monday: [{ type: "cx1", duration: 45 }] } })],
    ["with a legacy custom (calPerMin)", P({ customExercises: [{ id: "cx2", type: "cardio", calPerMin: 9, met: 0, isCustom: true, label: "Y" }], cardio: { Monday: [{ type: "cx2", duration: 40 }] } })],
  ];
  for (const [name, d] of plans) {
    ok(`${name}: the ladder's own rate IS the plan target`,
       M.planIntakeForRate(d, M.weeklyRateOf(d)) === M.computeClientCalories(d).target,
       { ladder: M.planIntakeForRate(d, M.weeklyRateOf(d)), target: M.computeClientCalories(d).target });
  }
}
// ⚠️ THE LADDER MUST IGNORE A MANUAL TARGET; THE JUDGING NUMBER MUST HONOUR IT.
{
  const d = P({ calorieTarget: 2000 });
  ok("a manual target does NOT move the rate ladder", M.planIntakeForRate(d, 1) === M.planIntakeForRate(P(), 1));
  ok("...but IS what a logged day is judged against", M.computeClientCalories(d).target === 2000);
  ok("...and is still floored", M.computeClientCalories(P({ calorieTarget: 800 })).target === 1200);
  ok("a zero/blank manual target does not override", M.computeClientCalories(P({ calorieTarget: 0 })).target === M.computeClientCalories(P()).target);
}

// ── 2. planEnergy stays LENIENT — this test exists to stop a tidy-up ────────
{
  const noGender = P({ gender: undefined });
  ok("planEnergy answers without a gender", M.planEnergy(noGender).tdee > 0);
  ok("...while computeClientCalories still refuses", M.computeClientCalories(noGender) === null);
  ok("...so the sandbox's pace chips keep working", M.planIntakeForRate(noGender, 1) > 0);
  ok("planEnergy survives junk", M.planEnergy(null).weeklyBurn === 0 && M.planEnergy(undefined).eatbackPerDay === 0);
  ok("accelerate mode carries no eat-back", M.planEnergy(P({ deficitMode: "accelerate" })).eatbackPerDay === 0);
  ok("eat-back spreads the WEEK over seven days",
     Math.abs(M.planEnergy(P()).eatbackPerDay - M.planEnergy(P()).weeklyBurn / 7) < 1e-9);
}

// ── 3. the day-independence that is the whole point ─────────────────────────
// Rebuild the OLD per-day expression and show it moving where the new one does not.
{
  const d = P();
  const e = M.planEnergy(d);
  const dayBurn = (day) => (d.strength[day] || []).length ? e.weeklyBurn / 3 : 0;   // 3 training days
  const oldTargetFor = (day, r) => Math.max(1200, e.tdee - Math.round((r * 3500) / 7) + dayBurn(day));
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const oldVals = [...new Set(days.map((day) => oldTargetFor(day, 1)))];
  const newVals = [...new Set(days.map(() => M.planIntakeForRate(d, 1)))];
  ok("control: the OLD per-day target really did differ by weekday", oldVals.length > 1, oldVals);
  ok("the new one is the same on every day", newVals.length === 1, newVals);
  ok("...and it sits between the training and rest values",
     newVals[0] > Math.min(...oldVals) && newVals[0] < Math.max(...oldVals), { newVals, oldVals });
}

// ── 4. which days went over, and by how much ────────────────────────────────
{
  const tgt = 2000;
  const cals = { "2026-09-01": 2100, "2026-09-02": 2000, "2026-09-03": 2101, "2026-09-04": 3000, "2026-09-05": 1500 };
  const rows = M.overDaysFrom(cals, tgt);
  // 2,100 is exactly the tolerance and must NOT be offered; 2,101 must.
  ok("a day at exactly target × 1.05 is on track", !rows.some((r) => r.date === "2026-09-01"), rows.map((r) => r.date));
  ok("one calorie past it is over", rows.some((r) => r.date === "2026-09-03"));
  ok("a day under target is never offered", !rows.some((r) => r.date === "2026-09-05"));
  // ⚠️ THE DEBT IS THE FULL EXCESS, NOT THE EXCESS ABOVE THE TOLERANCE.
  ok("the debt is measured against the target itself", rows.find((r) => r.date === "2026-09-04").over === 1000);
  ok("...not against target × 1.05", rows.find((r) => r.date === "2026-09-04").over !== 900);
  ok("newest first", rows[0].date === "2026-09-04");
  ok("no target means nothing to offer", M.overDaysFrom(cals, 0).length === 0 && M.overDaysFrom(cals, null).length === 0);
  ok("no days means nothing to offer", M.overDaysFrom({}, tgt).length === 0 && M.overDaysFrom(null, tgt).length === 0);
  ok("junk calories coerce to 0 rather than propagating NaN",
     M.overDaysFrom({ "2026-09-01": undefined, "2026-09-02": "x" }, tgt).length === 0);
  ok("capped", M.overDaysFrom(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`2026-07-${String(i % 28 + 1).padStart(2, "0")}-${i}`, 9000])), tgt).length <= 30);
}

// ── 5. the tolerance is ONE constant, read in six places ────────────────────
// COUNTED, not found (the check:weak rule): reverting any single reader to a
// bare 1.05 must go red, and `.test()` would not see that.
{
  const uses = (APP.match(/\* OVER_TOLERANCE/g) || []).length;
  ok("five judging readers plus overDaysFrom all use the named tolerance", uses === 6, uses);
  // ⚠️ AGAINST CODE, NOT PROSE — the comment above OVER_TOLERANCE names the very
  // string it forbids, and matching that is the S208 trap this repo keeps paying.
  const APP_CODE = APP.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  ok("no bare `* 1.05` comparison is left", !/\* 1\.05/.test(APP_CODE));
  // fmtLbs's `>= 1.05` is a singular/plural threshold, NOT this tolerance.
  ok("fmtLbs's own 1.05 was left alone", /Math\.abs\(n\) >= 1\.05/.test(APP));
}

// ── 6. the simulator no longer receives the contaminated props ──────────────
{
  const SIM_A = APP.indexOf("function CalorieSimulator(");
  const SIM_B = APP.indexOf("function DailyDashboard(", SIM_A);
  const SIM = APP.slice(SIM_A, SIM_B);
  const code = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const SIM_CODE = code(SIM);
  // ⚠️ ASSERT THE ABSENCE, NOT THE WHOLE SIGNATURE. Pinning the exact parameter
  // list made this fail the moment a legitimate prop was added (S217's
  // `standalone`), which trains the next reader to "fix" it by pasting in the
  // new list — and a paste is exactly how `todayTarget` would come back.
  {
    const sig = APP.match(/function CalorieSimulator\(\{[^}]*\}\)/)[0];
    ok("the simulator still takes the plan, not the dashboard's per-day chain",
       /\bdata\b/.test(sig) && /\bweightLbs\b/.test(sig) && /\bplanRate\b/.test(sig) && /\bdayCalsAll\b/.test(sig), sig);
    ok("...and neither contaminated prop is back in the signature",
       !/todayTarget/.test(sig) && !/intakeFor/.test(sig), sig);
  }
  ok("todayTarget is gone from the component", !/todayTarget/.test(SIM_CODE));
  ok("...and from the element that mounts it", !/todayTarget=/.test(APP));
  ok("...as is the injected intakeFor", !/intakeFor=\{/.test(APP));
  // ⚠️ S216: the sandbox now carries its own WEEK OF CARDIO, so its ladder is
  // `planIntakeForRate` with that week substituted for data.cardio — it cannot
  // call planIntakeForRate on a copy, because a {type:"manual"} session prices
  // to zero through the shared helpers. What matters here is unchanged: the
  // ladder is a property of the PLAN, never of the day on screen.
  // scripts/test-what-if-week.mjs runs both and requires them bit-identical on
  // an untouched planner.
  // ⚠️ S217 added a FOURTH argument — a typed daily burn, which is how a coach
  // runs the numbers for someone who has no plan at all. What matters here is
  // unchanged and is the whole point of S214: the ladder is a property of the
  // PLAN (or of a number a human typed), never of the day on screen.
  ok("the sandbox builds its ladder from the plan, not from the viewed day",
     /const intakeFor = \(r\) => simIntakeForRate\(d, trainWeek, r, mNum\);/.test(SIM_CODE));
  ok("...and the override is a TYPED number, never a per-day one",
     /const mNum = simNum\(mOverride, SIM_BURN_MAX\);/.test(SIM_CODE)
     && !/mNum = [^\n]*(dayIdx|burnShown|wearableTdee|todayTarget)/.test(SIM_CODE));
  ok("...and that ladder is planIntakeForRate's own arithmetic",
     /function simRawIntakeForRate\(d, weeklyBurn, r, tdeeOverride\) \{[\s\S]*?planEnergy\(d\)\.tdee[\s\S]*?Math\.round\(\(\(Number\(r\) \|\| 0\) \* 3500\) \/ 7\)[\s\S]*?isEatback\(d\)/.test(code(APP)));
  // ⚠️ AND THE OVERRIDE REPLACES `tdee`, NOT `tdee + eatback`. Freezing the whole
  // base would stop the chips moving when cardio is added in section 2 — while
  // the line one section below still read "More cardio means more food at the
  // same pace", directly under the control it had just stopped describing.
  ok("...with the override standing in for tdee alone",
     /const tdee = ov > 0 \? Math\.round\(ov\) : planEnergy\(d\)\.tdee;/.test(code(APP)));
  ok("...and judges history by the plan target", /const planTarget = \(computeClientCalories\(d\) \|\| \{\}\)\.target \|\| 0;/.test(SIM_CODE));
  ok("the over-day memo calls the shared rule", /overDaysFrom\(dayCalsAll, planTarget\)/.test(SIM_CODE));
  ok("...with plain-value deps", /\[dayCalsAll, planTarget\]/.test(SIM_CODE));
  ok("the make-up plan prices from the same target", /makeUpPlan\(\{ over: muPicked\.over, days: muDays, share: muShare \/ 100, target: planTarget \}\)/.test(SIM_CODE));
  ok("the screen states which number it judged by", /Measured against your plan/.test(SIM));
  // overDaysFrom must sit ABOVE the component or test-what-if-week's slice swallows it.
  ok("overDaysFrom is module-level, above the component", APP.indexOf("function overDaysFrom(") < SIM_A);
  // The floored label the launching card has had since S198z.
  ok("a floored pace chip says so", /const low = flooredAtRate\(t\.rate\);/.test(SIM_CODE) && /floored/.test(SIM));
}

// ── 7. custom exercises describe themselves honestly ────────────────────────
{
  // Same generic lifter as above — ageFromDob is a `function`, effectiveAge a
  // `const` arrow, and hardcoding either shape breaks the moment one changes.
  const one = (n) => {
    const m = APP.match(new RegExp(`\\n(?:const ${n} = \\([\\s\\S]*?\\n\\};|function ${n}\\([\\s\\S]*?\\n\\})`));
    if (!m) throw new Error(`could not lift ${n}`);
    return m[0];
  };
  const sub = new Function(["calcBMR", "ageFromDob", "effectiveAge", "restingKcalPerMin", "exBurn", "customExerciseSubtitle"]
    .map(one).join("") + "; return customExerciseSubtitle;")();
  const D = { gender: "male", age: 40, heightFt: 5, heightIn: 10, weightLbs: 200 };
  const shapes = {
    "met only (S183j+)": sub({ isCustom: true, met: 8 }, D),
    "legacy calPerMin": sub({ isCustom: true, calPerMin: 10, met: 0 }, D),
    "both": sub({ isCustom: true, met: 8, calPerMin: 10 }, D),
    "neither": sub({ isCustom: true }, D),
    "no weight": sub({ isCustom: true, met: 8 }, {}),
    "no data": sub({ isCustom: true, met: 8 }, null),
  };
  // ⚠️ DO NOT ASSERT /undefined/. JSX drops an undefined child, so the live bug
  // rendered "Custom ·  cal/min" — a hole and a double space — and a test
  // looking for the word "undefined" passes against it.
  for (const [name, out] of Object.entries(shapes)) {
    ok(`custom subtitle is complete: ${name}`, !!out && !/undefined|MET 0|  /.test(out), out);
  }
  ok("a met custom quotes a real burn", /≈ \d+ cal for 30 min/.test(shapes["met only (S183j+)"]));
  ok("a legacy custom still works", /≈ \d+ cal for 30 min/.test(shapes["legacy calPerMin"]));
  ok("without a weight it falls back to the intensity", shapes["no weight"] === "Custom · 8 MET");
  ok("with nothing at all it just says Custom", shapes.neither === "Custom");
  ok("the render no longer reads calPerMin directly", !/Custom · \{ex\.calPerMin\} cal\/min/.test(APP));
  // Every mount must pass data, or it silently degrades to the MET line.
  const mounts = (APP.match(/<ExercisePicker/g) || []).length;
  let withData = 0;
  const lines = APP.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("<ExercisePicker")) continue;
    let j = i; while (!lines[j].includes("/>")) j++;
    if (/\bdata=\{/.test(lines.slice(i, j + 1).join("\n"))) withData++;
  }
  ok("every ExercisePicker mount is given data", mounts > 0 && withData === mounts, { mounts, withData });
}

// ── 8. negative controls — each must go red against the real defect ─────────
// ⚠️ EACH CONTROL ASSERTS THE PROPERTY ITS MUTATION ACTUALLY BREAKS. The first
// draft of this block checked PARITY against every mutation — but planEnergy
// feeds BOTH sides, so doubling the eat-back share moved the ladder and the
// target together and parity held. A control that cannot go red proves nothing
// (the S202 lesson), so they are now one property each, verified red.
{
  const FLOOR_PLAN = P({ weightLbs: 105, heightFt: 4, heightIn: 11, age: 62, activityLevel: "sedentary", weeklyRate: 2 });
  const red = (label, mutate, probe) => {
    let saw = false;
    try { saw = !probe(build(mutate(source()))); } catch { saw = true; }
    ok(`control: ${label} is caught`, saw);
  };
  // The property, checked against the REAL source first — a control is only
  // meaningful if the unmutated code passes it.
  const props = {
    parity: (m) => m.planIntakeForRate(P(), m.weeklyRateOf(P())) === m.computeClientCalories(P()).target,
    floor: (m) => m.planIntakeForRate(FLOOR_PLAN, 2) === 1200,
    eatback: (m) => {
      const e = m.planEnergy(P());
      return Math.abs(m.planIntakeForRate(P(), 1) - m.planIntakeForRate(P({ deficitMode: "accelerate" }), 1) - e.weeklyBurn / 7) < 1.01;
    },
    lenient: (m) => m.planEnergy(P({ gender: undefined })).tdee > 0,
    membership: (m) => !m.overDaysFrom({ a: 2100 }, 2000).length,
    debt: (m) => (m.overDaysFrom({ b: 3000 }, 2000)[0] || {}).over === 1000,
  };
  for (const [name, probe] of Object.entries(props)) ok(`the real code satisfies "${name}"`, probe(M));

  red("computeClientCalories deriving its target a second way",
      (s2) => s2.replace("const auto = planIntakeForRate(d, weeklyRateOf(d));",
                         "const auto = Math.max(1200, Math.round(e.tdee - dailyDeficitOf(d) + e.eatbackPerDay * 1.02));"),
      props.parity);
  red("the 1,200 floor replaced by a plain round",
      (s2) => s2.replace("return atLeastMinCal(e.tdee -", "return Math.round(e.tdee -"), props.floor);
  red("the eat-back share doubled",
      (s2) => s2.replace("eatbackPerDay: isEatback(dd) ? weeklyBurn / 7 : 0", "eatbackPerDay: isEatback(dd) ? (weeklyBurn * 2) / 7 : 0"),
      props.eatback);
  red("eat-back spread over the wrong divisor",
      (s2) => s2.replace("eatbackPerDay: isEatback(dd) ? weeklyBurn / 7 : 0", "eatbackPerDay: isEatback(dd) ? weeklyBurn / 5 : 0"),
      props.eatback);
  red("a gender gate pushed down into planEnergy",
      (s2) => s2.replace("function planEnergy(d) {\n  const dd = d || {};",
                         "function planEnergy(d) {\n  const dd = d || {};\n  if (!dd.gender) return { bmr: 0, tdee: 0, weeklyBurn: 0, eatbackPerDay: 0 };"),
      props.lenient);
  red("the tolerance dropped from membership",
      (s2) => s2.replace("x.cals > tgt * OVER_TOLERANCE", "x.cals > tgt"), props.membership);
  red("the debt forgiven the tolerance too",
      (s2) => s2.replace("over: Math.round(c - tgt)", "over: Math.round(c - tgt * OVER_TOLERANCE)"), props.debt);
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  One plan basis: shared with the calendar, blind to which day is on screen.\n");
