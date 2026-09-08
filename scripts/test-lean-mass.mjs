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

// ── 9. the Full Plan can log a weight at all (S212b) ──────────────────────
// The SAME panel, opened from Results, was passed no onLogWeight — so the whole
// Weight box was absent there while the dashboard and the client's home had it.
// A third place the weight was simply missing, on the one screen whose job is
// body metrics: you could correct a past weigh-in and not record today's.
{
  const results = srcOf(APP, "Results");
  ok("the Results lift is bounded", !results.includes("function MeasurementsModal") && results.length > 5000, results.length);
  const call = results.slice(results.indexOf("showMeasureModal && "), results.indexOf("showMeasureModal && ") + 2200);
  ok("Results passes onLogWeight to the measurements panel", /onLogWeight=\{/.test(call), call.slice(0, 300));
  ok("...through the SAME writer as onEditWeighIn, so both land in one place",
     /onLogWeight=\{\(v, dateKey\) => \{ writeWeighIn\(dateKey, v\); \}\}/.test(call) && /onEditWeighIn=\{writeWeighIn\}/.test(call));
  // Every mount of the panel that can write a weigh-in must offer both, or the
  // gap just moves to whichever one was forgotten.
  const mounts = [...APP.matchAll(/<MeasurementsModal[\s\S]{0,1400}?\/>/g)].map((m) => m[0]);
  ok("NEG: there are three mounts to keep in step", mounts.length === 3, mounts.length);
  for (const [i, m] of mounts.entries()) {
    ok(`mount ${i + 1} offers both logging and correcting a weigh-in`,
       /onLogWeight=/.test(m) && /onEditWeighIn=/.test(m), m.slice(0, 160));
  }
}

// ── 10. the derived goal weight cannot jump in one tap (S212b) ────────────
// lean ÷ (1 − goal BF%) exceeds the CURRENT weight for anyone already leaner
// than their goal body fat — i.e. every client who gets there — and the button
// replaced a fat-loss goal with that larger number on a single unconfirmed tap.
{
  const modal = srcOf(APP, "MeasurementsModal");
  ok("the button now arms a confirm rather than writing", /onClick=\{\(\) => setGoalConfirm\(true\)\}/.test(modal));
  ok("...and the confirm names the goal being replaced", /Replace your goal weight of/.test(modal));
  ok("...and only the confirm calls onSetGoalWeight",
     (modal.match(/onSetGoalWeight\(suggested\)/g) || []).length === 1);
  ok("the direction against the reading's own weight is stated", /this reading was taken at/.test(modal));
  ok("being already leaner than the goal is called out, not offered in silence",
     /at or below your \{goalBf\}% goal body fat/.test(modal) && /putting fat back on/.test(modal));
  // The arithmetic that makes it a trap, stated so nobody "simplifies" the warning away.
  const LEAN = { gender: "male", age: "40", heightFt: 5, heightIn: 10, weightLbs: 190, goalBodyFat: "15",
    checkIns: [ci("2026-09-01", 190)],
    measurements: [{ date: "2026-09-01", timestamp: 1, calChest: 12, calAbdomen: 19, calThigh: 12 }] };
  const m = S.measurementMetrics(LEAN, LEAN.measurements[0]);
  ok("NEG: a client leaner than their goal derives a goal weight ABOVE their current weight",
     m.bodyFatPct < 15 && m.goalWeightFromLeanMass > 190, { bf: m.bodyFatPct, goal: m.goalWeightFromLeanMass, at: m.weightLbs });
}

// ── 11. simulations are uncapped; CONVERTING one is not (S212c) ──────────
// Kevin: "allow as many simulation plans as needed but limit the regular plans
// and connected plans... the trainer can convert the simulation to one of the
// regular plan slots". The first half already shipped in S179b — createProfile
// exempts sims and functions/roster.js countRoster filters them out. The
// conversion did not check anything, so the cap had a front door and an open
// side one: make sims all day at 15 of 15, convert them one at a time.
{
  const ROSTER = readFileSync(join(ROOT, "functions", "roster.js"), "utf8");
  ok("the server cap still ignores simulations when counting",
     /filter\(\(p\) => p && !p\.isSimulation\)/.test(ROSTER));
  ok("...and creating a simulation is still exempt client-side",
     /if \(!\(opts && opts\.isSimulation\) && rosterCap && rosterCap\.full\)/.test(APP));
  const conv = APP.slice(APP.indexOf("const convertSimulation = "), APP.indexOf("const convertSimulation = ") + 900);
  ok("converting now refuses when the roster is full",
     /if \(rosterCap && rosterCap\.full\) \{[\s\S]{0,160}setRosterBlocked\(true\)/.test(conv), conv.slice(0, 200));
  ok("...and returns BEFORE clearing the flag, so nothing is half-converted",
     conv.indexOf("return;") < conv.indexOf("isSimulation: false"));
  // ⚠️ The guard is only as fresh as the number it reads.
  ok("the cap is re-read on the REAL-plan count, not just how many profiles exist",
     /profiles\.length, profiles\.filter\(\(p\) => p && !p\.isSimulation\)\.length\]/.test(APP));
  ok("NEG: profiles.length alone cannot see a conversion",
     (() => { const before = [{ id: "a", isSimulation: true }, { id: "b" }];
       const after = before.map((p) => (p.id === "a" ? { ...p, isSimulation: false } : p));
       return before.length === after.length
         && before.filter((p) => !p.isSimulation).length !== after.filter((p) => !p.isSimulation).length; })());
}

// ── 12. a simulation is a sales projection, not a tracked person (S212c) ──
// Kevin: "nothing more than showing a potential client their potential... We
// won't allow any other real functions or inputs." The five wizard steps and the
// projection stay; everything that records a real body over time goes, and the
// AI cannot touch it. Converting is the one door out, and it spends a slot.
{
  const results = srcOf(APP, "Results");
  ok("check-ins are off on a simulation", /\{!isSimulation && \(\s*<DailyCheckIn/.test(results));
  ok("...as is the weigh-in chart and its editor",
     /\{!isSimulation && \(data\.checkIns \|\| \[\]\)\.length >= 1 &&/.test(results)
     && /\{showWeightModal && !isSimulation &&/.test(results));
  ok("...and the body-measurements panel, both its card and its modal",
     /\{onSaveMeasurements && !isSimulation && \(/.test(results)
     && /\{showMeasureModal && !isSimulation && \(\(\) => \{/.test(results));

  const dash = srcOf(APP, "DailyDashboard");
  ok("DailyDashboard is told whether it is a sim", /^function DailyDashboard\(\{[\s\S]{0,400}?isSimulation = false,/.test(dash));
  ok("...and it is actually passed one", /<DailyDashboard [^>]*isSimulation=\{activeIsSim\}/.test(APP));
  ok("the Calendar button is gone on a sim", /\{!isSimulation && \(\s*<button onClick=\{\(\) => setShowCalendar\(true\)\}/.test(dash));
  ok("...the date header stops being a second door to it",
     /onClick=\{\(\)=>\{ if \(!isSimulation\) setShowCalendar\(true\); \}\}/.test(dash));
  // ⚠️ Hiding two buttons is what a user sees; the state guard is what makes it true.
  ok("...and the calendar cannot render even if the state flips anyway",
     /if \(showCalendar && !isSimulation\) \{/.test(dash));
  ok("the weigh-in / measurements tile is gone, and so is its modal",
     /\{!tileHidden\("weight"\) && !isSimulation &&/.test(dash)
     && /\{showMeasure && onSaveMeasurements && !isSimulation && \(\(\) => \{/.test(dash));

  // A sim must not be droppable into a real client's account — converting is the
  // only door, and converting is what spends a roster slot.
  ok("the link picker no longer offers simulations",
     /profiles\.filter\(\(lp\) => lp && !lp\.isSimulation\)\.map\(\(lp\) => \(/.test(APP));
  ok("...and its empty state counts the SAME set it renders",
     /profiles\.filter\(\(lp\) => lp && !lp\.isSimulation\)\.length === 0 \? \(/.test(APP));
  ok("NEG: an all-simulation trainer is told why, not shown an empty box",
     /Only simulations here — convert one to a plan first/.test(APP));

  // The AI: refused at the ONE resolution point, so all twelve plan-data tools,
  // both Accept callables and the MCP connector are covered by one gate.
  ok("a localPlanId pointing at a simulation is refused",
     /if \(wantedRow\.isSimulation\) \{[\s\S]{0,80}?return \{ error:/.test(AI));
  ok("...at the single resolution point, not per-tool",
     (AI.match(/if \(wantedRow\.isSimulation\)/g) || []).length === 1);
  ok("...and the refusal happens BEFORE planOverride is set",
     AI.indexOf("wantedRow.isSimulation") < AI.indexOf("planOverride = wantedPid;"));
  ok("list_local_plans no longer hands out ids the tools will refuse",
     /index\.filter\(\(p\) => p && p\.id && !p\.isSimulation\)/.test(AI));
  // find_client deliberately KEEPS them — "who is Sarah?" is better answered
  // "that's a simulation" than "nobody matched" — but must not promise a write.
  ok("find_client still surfaces a simulation", /name: nm, isSimulation: !!p\.isSimulation/.test(AI));
  ok("...but no longer tells the model to write into one",
     !/Say so before writing anything into it/.test(AI) && /Do not retry with localPlanId/.test(AI));
}

console.log(`${checks - fails}/${checks} lean/muscle-mass assertions passed`);
if (fails) process.exit(1);
