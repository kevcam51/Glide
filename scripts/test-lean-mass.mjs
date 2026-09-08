// Why a client's lean body mass never moved (S212).
//
// KEVIN: "In the same weight section, where is the muscle mass and lean mass
// coming from? How are we calculating this number? I want to make sure it is
// coming from one source and the info is consistent and correct. Currently for
// client kev cam, we measured his body composition plenty of times and his lean
// body mass has stayed the same every time. Why is that?"
//
// ⚠️ THE FORMULAS WERE RIGHT; THE WEIGHT THEY WERE FED WAS WRONG.
// measurementMetrics computed every mass from `d.weightLbs` — the plan's CURRENT
// weight — no matter which day's entry it was handed. Two consequences, and the
// second is the one Kevin saw:
//
//   1. Lean and fat mass for a measurement from three months ago were scored
//      against today's scale, and disagreed with the charts, which had always
//      used each weigh-in's OWN weight. The same day read two different lean
//      masses on two screens.
//   2. Muscle mass is Lee-2000 — weight, height, age, sex, and NOTHING from a
//      caliper or a tape. With weight pinned to one value it was arithmetically
//      IDENTICAL on every entry, forever. Not stable: frozen. No amount of
//      measuring could ever move it.
//
// Also pinned here: a plotted future GOAL is not a weigh-in (the body-comp chart
// was one of the readers that never learned that rule), and the Bodyweight chart
// keeps its card when it cannot draw a line, instead of vanishing.
//
// Run: node scripts/test-lean-mass.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AI = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Brace-balanced lift so the SHIPPING functions run here (same harness as
// test-bodyfat.mjs) — a lazy regex truncates any of these that contains a
// nested block, and a transcribed copy would pass while the real file rotted.
function balanced(src, startIdx) {
  let d = 0, started = false;
  for (let j = startIdx; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error("unbalanced at " + startIdx);
}
const fnOf = (src, name) => balanced(src, src.indexOf(`function ${name}(`));
// ⚠️ balanced() CANNOT lift a function with DESTRUCTURED PARAMS — `({ points })`
// is itself a balanced brace pair, so the lift stops at the signature and every
// assertion against the body silently matches an empty string. These components
// are read as TEXT, so slice to the next top-level declaration instead.
const srcOf = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("not found: " + name);
  const m = /\n(?:function |const |class )/.exec(src.slice(i + 10));
  return src.slice(i, m ? i + 10 + m.index : src.length);
};

const PRELUDE = (src) => [
  fnOf(src, "ageFromDob"),
  balanced(src, src.indexOf("const effectiveAge = ")) + ";",
  fnOf(src, "caliperBF"), fnOf(src, "baileyBF"), fnOf(src, "navyBF"), fnOf(src, "whtrOf"),
  fnOf(src, "weightOnDate"), fnOf(src, "measurementMetrics"),
].join("\n");

// src/App.jsx also carries the Lee model + Bailey's derived numbers.
const APP_EXTRA = [
  fnOf(APP, "leeMuscleMassLbs"),
  balanced(APP, APP.indexOf("const BAILEY_TARGET_BF = ")) + ";",
  fnOf(APP, "baileyCorrectWeight"),
  balanced(APP, APP.indexOf("const BAILEY_LBM_BY_HEIGHT = ")) + ";",
  fnOf(APP, "baileyLeanRange"),
  // ymdLocal is a module const declared far below these functions; lifted here
  // for the same reason the app can call it (module eval finishes first).
  // ⚠️ NOT via balanced() — its body is a template literal, and `${...}` braces
  // would close the lift halfway through and leave a dangling backtick.
  (() => { const i = APP.indexOf("const ymdLocal = "); return APP.slice(i, APP.indexOf(";", APP.indexOf("padStart(2, \"0\")}`", i)) + 1); })(),
].join("\n");

const S = new Function(`${APP_EXTRA}\n${PRELUDE(APP)}\nreturn { measurementMetrics, weightOnDate, leeMuscleMassLbs };`)();
const F = new Function(`${PRELUDE(AI)}\nreturn { measurementMetrics, weightOnDate };`)();

// ── A real shape: one man, four caliper readings, a scale that moved ────────
const ci = (date, weight, extra = {}) => ({ date, timestamp: new Date(date + "T12:00:00").getTime(), weight, ...extra });
const KEV = {
  gender: "male", age: "40", heightFt: 5, heightIn: 10,
  weightLbs: 190,                       // "current" = the newest weigh-in
  checkIns: [ci("2026-01-10", 220), ci("2026-03-10", 210), ci("2026-06-10", 200), ci("2026-09-01", 190)],
  measurements: [
    { date: "2026-01-10", timestamp: 1, calChest: 18, calAbdomen: 30, calThigh: 18 },
    { date: "2026-03-10", timestamp: 2, calChest: 16, calAbdomen: 26, calThigh: 16 },
    { date: "2026-06-10", timestamp: 3, calChest: 14, calAbdomen: 22, calThigh: 14 },
    { date: "2026-09-01", timestamp: 4, calChest: 12, calAbdomen: 19, calThigh: 12 },
  ],
};
const metricsFor = (e) => S.measurementMetrics(KEV, e);

// ── 1. the weight is resolved per DAY, from real observations only ──────────
ok("a measurement day with its own weigh-in uses that day's weight",
   S.weightOnDate(KEV, "2026-03-10").lbs === 210 && S.weightOnDate(KEV, "2026-03-10").source === "sameDay",
   S.weightOnDate(KEV, "2026-03-10"));
ok("a day between weigh-ins carries the last one BACK, and says so",
   S.weightOnDate(KEV, "2026-04-01").lbs === 210 && S.weightOnDate(KEV, "2026-04-01").source === "carriedBack",
   S.weightOnDate(KEV, "2026-04-01"));
ok("a day BEFORE any weigh-in uses the earliest real one, not today's",
   S.weightOnDate(KEV, "2025-12-01").lbs === 220 && S.weightOnDate(KEV, "2025-12-01").source === "carriedForward",
   S.weightOnDate(KEV, "2025-12-01"));
ok("no date at all (the live preview, as you type) falls back to current weight",
   S.weightOnDate(KEV, null).lbs === 190 && S.weightOnDate(KEV, null).source === "current");
ok("no weigh-ins at all falls back to current weight",
   S.weightOnDate({ weightLbs: 175 }, "2026-03-10").lbs === 175);
ok("...and with neither, it refuses rather than returning 0 lbs",
   S.weightOnDate({}, "2026-03-10").lbs === null, S.weightOnDate({}, "2026-03-10"));

// ⚠️ A PLOTTED GOAL IS NOT A WEIGH-IN. It lives in the same `weight` slot with
// isFuturePlan:true, and a mass computed from it describes a body that does not
// exist yet.
{
  const withGoal = { ...KEV, checkIns: [...KEV.checkIns, ci("2027-01-01", 175, { isFuturePlan: true })] };
  ok("a future plotted target is excluded from the weight resolution",
     S.weightOnDate(withGoal, "2027-06-01").lbs === 190, S.weightOnDate(withGoal, "2027-06-01"));
  ok("NEG: without the isFuturePlan filter it would have returned the target",
     withGoal.checkIns.some((c) => c.isFuturePlan && c.weight === 175));
}

// ── 2. THE REPORTED BUG: the numbers now move ───────────────────────────────
const muscles = KEV.measurements.map((e) => metricsFor(e).muscleMassLbs);
const leans = KEV.measurements.map((e) => metricsFor(e).leanMassLbs);
const fats = KEV.measurements.map((e) => metricsFor(e).fatMassLbs);
ok("muscle mass is different on every measurement day", new Set(muscles).size === 4, muscles);
ok("...and falls as he loses weight, because Lee-2000 tracks weight",
   muscles[0] > muscles[3], muscles);
ok("lean mass differs on every day too", new Set(leans).size === 4, leans);
ok("fat mass falls across the four readings", fats[0] > fats[1] && fats[1] > fats[2] && fats[2] > fats[3], fats);

// The exact defect, reproduced: feed the OLD code path (current weight for every
// entry) and watch muscle mass freeze. This is the control — without it the four
// assertions above could pass for the wrong reason.
{
  const frozen = KEV.measurements.map((e) => S.leeMuscleMassLbs(KEV, Number(KEV.weightLbs)));
  ok("NEG: computed from the plan's current weight, muscle mass is IDENTICAL every time",
     new Set(frozen).size === 1, frozen);
  ok("NEG: ...and the error at the oldest entry is real pounds, not rounding",
     Math.abs(frozen[0] - muscles[0]) >= 5, { old: frozen[0], fixed: muscles[0] });
}
// Lee has no body-fat term at all — the reason measuring harder could never move it.
{
  const a = S.leeMuscleMassLbs({ ...KEV, bodyFat: 30 }, 200);
  const b = S.leeMuscleMassLbs({ ...KEV, bodyFat: 10 }, 200);
  ok("Lee-2000 ignores body fat entirely (so the UI must say so)", a === b, { a, b });
  ok("...but responds to weight", S.leeMuscleMassLbs(KEV, 220) !== S.leeMuscleMassLbs(KEV, 190));
}

// ── 3. ONE SOURCE: the day view and the charts agree ────────────────────────
// The chart builds each row from the weigh-in's own weight; the day view builds
// it from weightOnDate. On a day that has both, those must be the same number —
// that equality IS the fix.
for (const c of KEV.checkIns) {
  const e = KEV.measurements.find((x) => x.date === c.date);
  const m = metricsFor(e);
  const chartLean = Math.round(c.weight * (1 - m.bodyFatPct / 100));
  const chartMuscle = S.leeMuscleMassLbs(KEV, c.weight);
  ok(`day view lean == chart lean on ${c.date}`, m.leanMassLbs === chartLean, { view: m.leanMassLbs, chart: chartLean });
  ok(`day view muscle == chart muscle on ${c.date}`, m.muscleMassLbs === chartMuscle, { view: m.muscleMassLbs, chart: chartMuscle });
}

// ── 4. the numbers stay arithmetically true ────────────────────────────────
{
  const m = metricsFor(KEV.measurements[1]);
  ok("lean + fat == the weight it was computed from",
     Math.abs(m.leanMassLbs + m.fatMassLbs - m.weightLbs) <= 1, m);
  ok("the metrics report WHICH weight and which day", m.weightLbs === 210 && m.weightDate === "2026-03-10", m);
  ok("...and which body-fat method produced the percentage", m.bodyFatSource === "caliper", m.bodyFatSource);
  ok("lean mass is weight × (1 − BF%)",
     m.leanMassLbs === Math.round(210 * (1 - m.bodyFatPct / 100)), m);
}
// The derived goal weight rides the same lean mass, so it must move too.
{
  const withGoal = { ...KEV, goalBodyFat: 15 };
  const g = withGoal.measurements.map((e) => S.measurementMetrics(withGoal, e).goalWeightFromLeanMass);
  ok("the lean-mass-derived goal weight is no longer constant", new Set(g).size > 1, g);
}
// A scale reading beats calipers beats tape, and it is the weight — not the
// precedence — that this change touched.
{
  const e = { date: "2026-03-10", calChest: 16, calAbdomen: 26, calThigh: 16, bodyFatManual: 24 };
  const m = S.measurementMetrics(KEV, e);
  ok("a typed scale reading still wins", m.bodyFatSource === "scale" && m.bodyFatPct === 24, m);
  ok("...and lean mass follows it off that day's weight", m.leanMassLbs === Math.round(210 * 0.76), m);
}

// ── 5. the server mirror answers the same ──────────────────────────────────
for (const e of KEV.measurements) {
  const a = S.measurementMetrics(KEV, e), b = F.measurementMetrics(KEV, e);
  ok(`aitools agrees with the app on ${e.date}`,
     a.leanMassLbs === b.leanMassLbs && a.bodyFatPct === b.bodyFatPct && a.weightLbs === b.weightLbs,
     { app: a.leanMassLbs, fn: b.leanMassLbs });
}
ok("the assistant no longer defends a ±2% precision the app denies",
   !/±2%/.test(AI.slice(AI.indexOf("get_measurements"), AI.indexOf("get_measurements") + 3000)));
ok("...and reports the weight its lean mass came from",
   /leanMassFromWeightLbs/.test(AI) && /leanMassFromWeighInDate/.test(AI));

// ── 6. the Bodyweight chart no longer disappears in silence ────────────────
// It rendered null under 2 points, so with one weigh-in and two body-fat
// readings the stack drew every OTHER chart and left the weight out with no
// word about why — read, correctly, as "this app doesn't chart my weight".
{
  const mlc = srcOf(APP, "MetricLineChart");
  const bccPre = srcOf(APP, "BodyCompCharts"), modalPre = srcOf(APP, "MeasurementsModal");
  // ⚠️ A LIFT THAT OVERRUNS MAKES EVERY TEXT ASSERTION BELOW TRIVIALLY TRUE —
  // if srcOf swallowed the rest of the file, "the string is present somewhere"
  // proves nothing about where. Bound each one first.
  ok("the MetricLineChart lift stops before the next component",
     !mlc.includes("function BodyCompCharts") && mlc.length > 800 && mlc.length < 9000, mlc.length);
  ok("the BodyCompCharts lift is bounded",
     !bccPre.includes("function MeasurementsModal") && bccPre.length > 2000, bccPre.length);
  ok("the MeasurementsModal lift is bounded",
     !modalPre.includes("function AICoach") && modalPre.length > 20000, modalPre.length);
  ok("NEG: a string that is NOT in these blocks is not matched",
     !/leeMuscleMassLbs\(d, wi\.weight\)/.test(mlc));
  ok("MetricLineChart takes an emptyHint", /function MetricLineChart\(\{[^}]*emptyHint/.test(mlc));
  ok("...and renders the card instead of null when it has one",
     /if \(!emptyHint\) return null;/.test(mlc), mlc.slice(0, 400));
  const bcc = srcOf(APP, "BodyCompCharts");
  ok("the Bodyweight chart always supplies a hint", /key: "weight",[\s\S]{0,400}?hint:/.test(bcc));
  ok("...as do fat and lean, naming the body-fat reading they need",
     (bcc.match(/hint: haveWeighIns \? "Needs a body-fat reading/g) || []).length === 2);
  ok("...and muscle, naming height/age/gender", /hint: haveWeighIns \? "Needs height, age and gender/.test(bcc));
  ok("the hint is actually passed to the chart", /emptyHint=\{c\.hint\}/.test(bcc));
  ok("the body-comp weigh-in source drops future plotted targets",
     /Number\(c\.weight\) > 0 && !c\.isFuturePlan/.test(APP.slice(APP.indexOf("const bodyCompData"), APP.indexOf("const bodyCompData") + 2500)));
}

// ── 7. the saved-day list and the day itself show the weight ───────────────
{
  const modal = srcOf(APP, "MeasurementsModal");
  const sum = modal.slice(modal.indexOf("const summarize = "), modal.indexOf("const summarize = ") + 1200);
  ok("the day summary leads with that day's weigh-in", /x\.ci && Number\(x\.ci\.weight\) > 0/.test(sum), sum.slice(0, 200));
  ok("...and is passed the DAY, not just the measurement entry", /\{summarize\(x\)\}/.test(modal));
  ok("the day detail no longer bails out when there is no same-day weigh-in",
     !/if \(!ci && scan == null\) return null;/.test(modal));
  ok("...and shows the weight the day's masses were built from",
     /no weigh-in this day/.test(modal));
  ok("the day detail shows muscle mass alongside lean and fat",
     /muscle \{m\.muscleMassLbs\} lbs/.test(modal));
  ok("...and names the weight and method behind them",
     /weighed that day/.test(modal) && /Lee-2000 estimate from height, weight, age and sex/.test(modal));
  ok("the headline readout is dated, so it cannot read as 'now'",
     /Latest reading/.test(modal));
}

// ── 8. mutation checks — break the fix, watch these fail ───────────────────
// Each rebuilds measurementMetrics with the defect restored and asserts the
// suite would have caught it. Without these, section 2 could be green against
// code that never changed.
{
  const broken = fnOf(APP, "measurementMetrics")
    .replace("const wSrc = weightOnDate(d, m && m.date);", "const wSrc = { lbs: Number(d.weightLbs) || 0, date: null, source: 'current' };");
  ok("NEG: the mutation actually applied", broken.includes("source: 'current'"));
  const B = new Function(`${APP_EXTRA}\n${PRELUDE(APP).replace(fnOf(APP, "measurementMetrics"), broken)}\nreturn { measurementMetrics };`)();
  const bm = KEV.measurements.map((e) => B.measurementMetrics(KEV, e).muscleMassLbs);
  ok("NEG: with current-weight restored, muscle mass freezes again", new Set(bm).size === 1, bm);
  const bl = KEV.measurements.map((e) => B.measurementMetrics(KEV, e).leanMassLbs);
  ok("NEG: ...and lean mass disagrees with the chart it must match",
     bl[0] !== Math.round(220 * (1 - B.measurementMetrics(KEV, KEV.measurements[0]).bodyFatPct / 100)), bl);
}

console.log(`${checks - fails}/${checks} lean/muscle-mass assertions passed`);
if (fails) process.exit(1);
