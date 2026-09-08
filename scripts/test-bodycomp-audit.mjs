// The S212 body-composition audit, pinned (S212d).
//
// A seven-lens adversarial sweep of every place the app computes or shows a
// weight, a body-fat percentage or a body mass. What it found was not fifty-eight
// separate bugs but a handful of rules forgotten in place after place.
//
// The S212 audit swept the weight/body-composition domain with seven lenses and
// the single loudest result was this rule, forgotten in eleven more places after
// S200c had already found it "applied in 4 places and forgotten in 14".
//
// ⚠️ THE WORST ONE FROZE CURRENT WEIGHT FOREVER. Three writers decide whether a
// new weigh-in may claim `data.weightLbs`, and all three asked "is there a later
// entry with a weight?" without excluding plotted goals. A goal is stored in the
// same `weight` slot with a FUTURE date, so one target made the answer
// permanently yes: every subsequent weigh-in recorded correctly and the chart
// moved, while the hero number, lbs-to-go, the ETA, the trainer roster and the
// BMR feeding the daily calorie target all stayed at the old value. The drift
// only grows, and nothing on screen says so.
//
// The same omission separately suppressed the Trainerize weight sync and the
// weekly weigh-in push, drew a "weigh-in" dot on a day nobody stood on a scale,
// and served a target as "Last weighed <date>" on the dashboard tile.
//
// And the completeness critic found the rule had never been enumerated against
// `data.measurements` AT ALL — no flag, no date bound — while the calendar will
// open any future day with a tape grid under it.
//
// Run: node scripts/test-bodycomp-audit.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AI = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");
const PUSH = readFileSync(join(ROOT, "functions", "push.js"), "utf8");
const TZ = readFileSync(join(ROOT, "functions", "trainerize.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

function balanced(src, startIdx) {
  let d = 0, started = false;
  for (let j = startIdx; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error("unbalanced at " + startIdx);
}
const fnOf = (src, name) => balanced(src, src.indexOf(`function ${name}(`));
// ⚠️ balanced() COUNTS BRACES, so it cannot lift a const whose value is an ARRAY
// or a bare expression — there is no `{` to close on and it runs on into the next
// block. Lift a whole statement instead: scan to the first `;` at nesting depth 0,
// ignoring strings and template literals.
function stmtOf(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error("not found: " + decl);
  let depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j], prev = src[j - 1];
    if (q) { if (c === q && prev !== "\\") q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && depth === 0) return src.slice(i, j + 1);
  }
  throw new Error("no statement end: " + decl);
}

// ── 1. all four "is this the newest weigh-in?" guards ─────────────────────
// ⚠️ COUNTED, NOT MERELY FOUND. The defect was four copies of one rule and three
// of them missing the term; an assertion that only proves ONE copy is correct
// would have stayed green through the exact bug this file exists for.
{
  const guards = [
    ["ClientHome.logWeight", APP, /\.some\(\(c\) => c && c\.date && !c\.isFuturePlan && c\.date > dayKey && Number\(c\.weight\) > 0\)/],
    ["Dashboard onLogUpdate", APP, /\.reduce\(\(a, c\) => \(c && c\.date && !c\.isFuturePlan && c\.weight != null/],
    ["AI/MCP log_weigh_in", AI, /c && c\.date && !c\.isFuturePlan && c\.date > date && Number\(c\.weight\) > 0/],
    ["Trainerize weight sync", TZ, /c && c\.date && !c\.isFuturePlan && c\.weight != null && \(!acc \|\| c\.date > acc\)/],
  ];
  for (const [name, src, re] of guards) ok(`${name} excludes plotted goals`, re.test(src));
  ok("there are exactly four such guards and no fifth unfiltered one",
     guards.length === 4);
  // The shape the bug had, so nobody reintroduces it.
  ok("NEG: no weigh-in guard still tests a bare `c.weight != null` with a date compare",
     !/\.some\(\(c\) => c && c\.date && c\.date > (dayKey|date) && Number\(c\.weight\) > 0\)/.test(APP + AI));
}

// ── 2. the flag is RE-STAMPED after every merge spread ────────────────────
// The existing entry is spread LAST, so a day that was planned first handed its
// isFuturePlan:true to the real weigh-in merged onto it — which then vanished
// from every reader that filters goals, including the four guards above.
{
  ok("ClientHome re-stamps it", /merged\.isFuturePlan = dayKey > ymdLocal\(\);/.test(APP));
  ok("the dashboard re-stamps it", /entry\.isFuturePlan = viewDate > todayKey;/.test(APP));
  ok("the AI path re-stamps it", /entry\.isFuturePlan = date > ctx\.today;/.test(AI));
  ok("NEG: each sits AFTER its spread, where it can actually win",
     APP.indexOf("...(sameDay || {}), };") < APP.indexOf("merged.isFuturePlan =")
     && AI.indexOf("...(sameDay || {}) };") < AI.indexOf("entry.isFuturePlan ="));
}

// ── 3. a goal is not displayed as a weigh-in ──────────────────────────────
ok("the calendar's weigh-in dot excludes goals",
   /weight: !!\(ci && ci\.weight && !ci\.isFuturePlan\)/.test(APP));
ok("...and the week row labels a target as planned instead of scale-marking it",
   /Planned target — not a weigh-in/.test(APP) && /\{ci\.weight\} planned/.test(APP));
ok("the dashboard weight tile will not carry a goal forward",
   /c && c\.date && c\.weight != null && !c\.isFuturePlan/.test(APP));
ok("the weekly weigh-in push ignores goals",
   /Number\(c\.weight\) > 0 && c\.date && !c\.isFuturePlan/.test(PUSH));

// ── 4. measurements: the rule the sweep found had never been applied ──────
// EXECUTABLE — mergeMeasurements is top level, so the shipping function itself
// runs here rather than a transcription of it.
{
  const src = [
    fnOf(APP, "ageFromDob"),
    balanced(APP, APP.indexOf("const effectiveAge = ")) + ";",
    fnOf(APP, "caliperBF"), fnOf(APP, "baileyBF"), fnOf(APP, "navyBF"), fnOf(APP, "whtrOf"),
    fnOf(APP, "leeMuscleMassLbs"),
    balanced(APP, APP.indexOf("const BAILEY_TARGET_BF = ")) + ";",
    fnOf(APP, "baileyCorrectWeight"),
    balanced(APP, APP.indexOf("const BAILEY_LBM_BY_HEIGHT = ")) + ";",
    fnOf(APP, "baileyLeanRange"),
    (() => { const i = APP.indexOf("const ymdLocal = ");
             return APP.slice(i, APP.indexOf(";", APP.indexOf('padStart(2, "0")}`', i)) + 1); })(),
    fnOf(APP, "weightOnDate"), fnOf(APP, "measurementMetrics"), fnOf(APP, "mergeMeasurements"),
  ].join("\n");
  const S = new Function(`${src}\nreturn { mergeMeasurements };`)();
  const ymd = (off) => { const d = new Date(Date.now() + off * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const PLAN = () => ({ gender: "male", age: "40", heightFt: 5, heightIn: 10, weightLbs: 200,
    measurements: [], checkIns: [] });

  const past = PLAN();
  ok("a measurement dated today is recorded", S.mergeMeasurements(past, { waist: 36 }, ymd(0), "client") != null
     && past.measurements.length === 1);
  const back = PLAN();
  S.mergeMeasurements(back, { waist: 38 }, ymd(-30), "client");
  ok("...and so is a back-dated one — catching up is normal", back.measurements.length === 1);

  const fut = PLAN();
  const res = S.mergeMeasurements(fut, { waist: 30, neck: 15 }, ymd(+14), "client");
  ok("a FUTURE-dated tape reading is refused", res === null, res);
  ok("...and nothing is written", fut.measurements.length === 0, fut.measurements);
  // ⚠️ THE REAL DAMAGE WAS THE SNAPSHOT, NOT THE ROW. mergeMeasurements also
  // writes d.bodyFat, so a future entry became the plan's current body fat —
  // and from there its lean mass, fat mass and derived goal weight.
  ok("...and the plan's body-fat snapshot is untouched", fut.bodyFat === undefined, fut.bodyFat);

  // Positive control: the same numbers on a past date DO move the snapshot, so
  // the assertion above is testing the date bound and not a dead code path.
  const ctl = PLAN();
  S.mergeMeasurements(ctl, { waist: 30, neck: 15 }, ymd(-1), "client");
  ok("NEG: the identical reading dated yesterday DOES set the snapshot",
     typeof ctl.bodyFat === "number", ctl.bodyFat);
}
ok("the calendar hides the tape grid on a future day", /onSaveMeasurementsFor && sel <= todayKey && \(\(\) => \{/.test(APP));
ok("the AI/MCP measurement writer refuses a future date too",
   /if \(date > ctx\.today\) \{[\s\S]{0,120}?return \{ error:/.test(AI));

// ── 5. the method choice governs everything it promises (S212d) ──────────
// "Which reading should the app trust?" is a stored choice the CHARTS honoured
// and measurementMetrics ignored — so the headline body fat, lean mass, fat
// mass, Bailey's correct weight and the derived goal weight were computed from
// a different method than the chart directly below them.
{
  const src = [
    fnOf(APP, "ageFromDob"),
    balanced(APP, APP.indexOf("const effectiveAge = ")) + ";",
    fnOf(APP, "caliperBF"), fnOf(APP, "baileyBF"), fnOf(APP, "navyBF"), fnOf(APP, "whtrOf"),
    fnOf(APP, "leeMuscleMassLbs"),
    balanced(APP, APP.indexOf("const BAILEY_TARGET_BF = ")) + ";",
    fnOf(APP, "baileyCorrectWeight"),
    balanced(APP, APP.indexOf("const BAILEY_LBM_BY_HEIGHT = ")) + ";",
    fnOf(APP, "baileyLeanRange"),
    (() => { const i = APP.indexOf("const ymdLocal = ");
             return APP.slice(i, APP.indexOf(";", APP.indexOf('padStart(2, "0")}`', i)) + 1); })(),
    fnOf(APP, "weightOnDate"), fnOf(APP, "measurementMetrics"),
  ].join("\n");
  const S = new Function(`${src}\nreturn { measurementMetrics };`)();
  const F = new Function(`${[
    fnOf(AI, "ageFromDob"),
    balanced(AI, AI.indexOf("const effectiveAge = ")) + ";",
    fnOf(AI, "caliperBF"), fnOf(AI, "baileyBF"), fnOf(AI, "navyBF"), fnOf(AI, "whtrOf"),
    fnOf(AI, "weightOnDate"), fnOf(AI, "measurementMetrics"),
  ].join("\n")}\nreturn { measurementMetrics, baileyBF };`)();

  // One man, one day, all three methods present and disagreeing — which is normal.
  const ENTRY = { date: "2026-06-10", timestamp: 1, bodyFatManual: 22,
    calChest: 12, calAbdomen: 19, calThigh: 12, waist: 36, neck: 15.5, hips: 39, forearm: 11, wrist: 7 };
  const BASE = { gender: "male", age: "40", heightFt: 5, heightIn: 10, weightLbs: 200,
    checkIns: [{ date: "2026-06-10", timestamp: 1, weight: 200 }], measurements: [ENTRY] };

  const m0 = S.measurementMetrics(BASE, ENTRY);
  ok("with no choice stored, the old most-direct precedence still answers",
     m0.bodyFatSource === "scale" && m0.bodyFatPct === 22, m0.bodyFatSource);
  const mc = S.measurementMetrics({ ...BASE, bfPrimarySource: "caliper" }, ENTRY);
  ok("choosing calipers moves the headline body fat to the caliper reading",
     mc.bodyFatSource === "caliper" && mc.bodyFatPct === m0.caliperBF, mc.bodyFatPct);
  const mt = S.measurementMetrics({ ...BASE, bfPrimarySource: "tape" }, ENTRY);
  ok("...and choosing tape moves it to the tape estimate",
     mt.bodyFatSource === "tape" && mt.bodyFatPct === m0.tapeBF, mt.bodyFatPct);
  // ⚠️ THE POINT IS THE DERIVED MASSES, NOT THE PERCENTAGE. That is what
  // disagreed with the chart underneath it.
  ok("lean mass follows the choice", mc.leanMassLbs !== m0.leanMassLbs, { scale: m0.leanMassLbs, cal: mc.leanMassLbs });
  ok("...and so do fat mass and Bailey's correct weight",
     mc.fatMassLbs !== m0.fatMassLbs && mc.baileyCorrectWeight !== m0.baileyCorrectWeight);
  ok("...and the lean-mass-derived goal weight",
     S.measurementMetrics({ ...BASE, bfPrimarySource: "caliper", goalBodyFat: "15" }, ENTRY).goalWeightFromLeanMass
     !== S.measurementMetrics({ ...BASE, goalBodyFat: "15" }, ENTRY).goalWeightFromLeanMass);
  ok("NEG: the spread the choice is worth here is pounds, not rounding",
     Math.abs(mc.leanMassLbs - m0.leanMassLbs) >= 3, { scale: m0.leanMassLbs, cal: mc.leanMassLbs });

  // A choice the day cannot honour must not blank the day.
  const tapeOnly = { date: "2026-07-01", timestamp: 2, waist: 36, neck: 15.5 };
  const mf = S.measurementMetrics({ ...BASE, bfPrimarySource: "caliper", measurements: [tapeOnly] }, tapeOnly);
  ok("a day with no reading for the chosen method falls back rather than blanking",
     mf.bodyFatPct != null && mf.bodyFatSource === "tape", mf);

  // Server parity — the assistant and the MCP connector must agree with the app.
  for (const pref of [undefined, "scale", "caliper", "tape"]) {
    const a = S.measurementMetrics({ ...BASE, bfPrimarySource: pref }, ENTRY);
    const b = F.measurementMetrics({ ...BASE, bfPrimarySource: pref }, ENTRY);
    ok(`server agrees with the app for choice ${pref || "(none)"}`,
       a.bodyFatPct === b.bodyFatPct && a.leanMassLbs === b.leanMassLbs && a.bodyFatSource === b.bodyFatSource,
       { app: a.bodyFatPct, fn: b.bodyFatPct });
  }

  // ── the mirror that drifted: Bailey's age guard ────────────────────────
  const M = { waist: 40, hips: 40, forearm: 10.75, wrist: 7 };
  ok("server baileyBF reproduces Bailey's own worked example",
     F.baileyBF({ gender: "male", age: "40" }, M) === 24, F.baileyBF({ gender: "male", age: "40" }, M));
  ok("...and REFUSES with no age, as the app's copy has since S200v",
     F.baileyBF({ gender: "male" }, M) === null, F.baileyBF({ gender: "male" }, M));
  ok("NEG: unguarded it would have answered — the under-30 coefficient at age 0",
     40 + 0.5 * 40 - 3 * 10.75 - 7 > 1);
}

// ── 6. the rest of the register, executed where it can be ────────────────
{
  const src = [
    fnOf(APP, "ageFromDob"),
    balanced(APP, APP.indexOf("const effectiveAge = ")) + ";",
    fnOf(APP, "caliperBF"), fnOf(APP, "baileyBF"), fnOf(APP, "navyBF"), fnOf(APP, "whtrOf"),
    fnOf(APP, "leeMuscleMassLbs"),
    balanced(APP, APP.indexOf("const BAILEY_TARGET_BF = ")) + ";",
    fnOf(APP, "baileyCorrectWeight"),
    balanced(APP, APP.indexOf("const BAILEY_LBM_BY_HEIGHT = ")) + ";",
    fnOf(APP, "baileyLeanRange"),
    (() => { const i = APP.indexOf("const ymdLocal = ");
             return APP.slice(i, APP.indexOf(";", APP.indexOf('padStart(2, "0")}`', i)) + 1); })(),
    stmtOf(APP, "const MEASUREMENT_FIELDS = "),
    stmtOf(APP, "const CALIPER_ALL = "),
    stmtOf(APP, "const MEASURE_BOUNDS = "),
    stmtOf(APP, "const measureBoundsFor = "),
    stmtOf(APP, "const measureInRange = "),
    stmtOf(APP, "const fmtLbs = "),
    fnOf(APP, "removeWeighIn"),
    fnOf(APP, "weightOnDate"), fnOf(APP, "measurementMetrics"), fnOf(APP, "mergeMeasurements"),
  ].join("\n");
  const S = new Function(`${src}\nreturn { measurementMetrics, mergeMeasurements, removeWeighIn, measureInRange, fmtLbs };`)();
  const PLAN = () => ({ gender: "male", age: "40", heightFt: 5, heightIn: 10, weightLbs: 200,
    measurements: [], checkIns: [{ date: "2026-06-10", timestamp: 1, weight: 200 }] });

  // A scan reading was taken verbatim and won the precedence, unbounded.
  {
    const d = { ...PLAN(), measurements: [] };
    const bad = S.measurementMetrics(d, { date: "2026-06-10", bodyFatManual: 185 });   // 18.5 mistyped
    ok("an impossible scan reading is refused, not believed", bad.bodyFatPct !== 185, bad.bodyFatPct);
    ok("...so it cannot produce a negative lean mass",
       bad.leanMassLbs == null || bad.leanMassLbs > 0, bad.leanMassLbs);
    const good = S.measurementMetrics(d, { date: "2026-06-10", bodyFatManual: 18.5 });
    ok("NEG: a plausible one still works", good.bodyFatPct === 18.5 && good.leanMassLbs === 163, good);
  }
  // lean + fat must account for the weight printed beside them.
  {
    let mismatches = 0;
    for (let bf = 3; bf <= 60; bf += 0.1) {
      for (const w of [150, 175.5, 200, 233]) {
        const m = S.measurementMetrics({ ...PLAN(), weightLbs: w, checkIns: [] },
          { bodyFatManual: Math.round(bf * 10) / 10 });
        if (m.leanMassLbs + m.fatMassLbs !== Math.round(w)) mismatches++;
      }
    }
    ok("lean + fat == the weight, at every body fat and weight tried", mismatches === 0, mismatches);
  }
  // A back-dated correction must not re-point the plan's CURRENT body fat.
  {
    const d = PLAN();
    S.mergeMeasurements(d, { waist: 34, neck: 15 }, "2026-06-10", "client");
    const after = d.bodyFat;
    ok("the newest entry sets the snapshot", typeof after === "number", after);
    S.mergeMeasurements(d, { waist: 44, neck: 15 }, "2026-01-05", "client");
    ok("...and correcting an OLDER day does not move it", d.bodyFat === after, { was: after, now: d.bodyFat });
    ok("NEG: the older entry was still recorded", d.measurements.length === 2);
  }
  // The ✕ says "weigh-in", so it must not take the day with it.
  {
    const rich = [{ timestamp: 1, date: "a", weight: 200, workedOut: true, notes: "squats felt good" }];
    const out = S.removeWeighIn(rich, 1);
    ok("a day with a workout keeps the day", out.length === 1 && out[0].weight === null, out);
    ok("...and keeps the workout and the note", out[0].workedOut === true && out[0].notes === "squats felt good");
    const bare = [{ timestamp: 1, date: "a", weight: 200, workedOut: null, mood: null, notes: "" }];
    ok("a weigh-in-only day is removed outright", S.removeWeighIn(bare, 1).length === 0);
    ok("NEG: an unknown timestamp changes nothing", S.removeWeighIn(bare, 99).length === 1);
  }
  // Bounds, in one place, for the five write paths.
  ok("a centimetre waist is out of range", !S.measureInRange("waist", 91));
  ok("...an inch waist is not", S.measureInRange("waist", 36));
  ok("a mistyped scan reading is out of range", !S.measureInRange("bodyFatManual", 185));
  ok("...and calipers keep their own mm bounds",
     S.measureInRange("calChest", 12) && !S.measureInRange("calChest", 400));
  // Pounds as a person writes them.
  ok("float subtraction is not printed raw", S.fmtLbs(185.4 - 165) === "20.4", S.fmtLbs(185.4 - 165));
  ok("...and a whole number stays whole", S.fmtLbs(200 - 175) === "25");
}

// ── 7. the register's remaining source-level fixes ───────────────────────
{
  const AICHAT = readFileSync(join(ROOT, "functions", "aichat.js"), "utf8");
  const MCP = readFileSync(join(ROOT, "functions", "mcp.js"), "utf8");
  ok("the AI prompt no longer promises ±2% precision", !/±2%/.test(AICHAT));
  ok("...and tells the model never to compare two methods",
     /NEVER compare two different methods/.test(AICHAT));
  ok("the connector marks the two overwriting log tools destructive",
     /"log_weigh_in",/.test(MCP) && /"log_measurements",/.test(MCP));
  ok("...and no longer lists them as additive",
     !/log_measurements, log_weigh_in \(merges into a same-day entry since S86\)/.test(MCP));
  ok("coach_summary skips simulations", /if \(p && p\.id && !p\.isSimulation\) candidates\.push/.test(AI));
  ok("get_measurements will not diff two different instruments",
     /latest\.bodyFatMethod !== oldest\.bodyFatMethod\) continue;/.test(AI));
  ok("...and reports the method on every entry", /out\.bodyFatMethod = m\.bodyFatSource/.test(AI));
  ok("a tracker-only day is marked, so it is not mistaken for logging",
     /cur\.wearableOnly = true/.test(TZ));
  ok("...and the coach surfaces skip those days", /async function lastRealLogDate/.test(AI)
     && (AI.match(/await lastRealLogDate\(/g) || []).length === 3);
  ok("the wearable write is transactional, not a whole-document replace",
     /async function dayLogTxn/.test(TZ) && !/log\.wearable = next;\n\s*await kvSetJSON/.test(TZ));
  ok("an AI-written body fat lands where the app actually reads it",
     (AI.match(/bodyFatManual: b \}/g) || []).length + (AI.match(/bodyFatManual: bf \}/g) || []).length === 2);
  ok("the check-in body-fat box is no longer write-only",
     /if \(bf > 0 && onSaveMeasurements && !isFuture\) onSaveMeasurements\(\{ bodyFatManual: bf \}, checkDate\);/.test(APP));
  ok("the client's own calendar offers the tape grid", /onSaveMeasurementsFor=\{\(dateKey, vals\) => saveMeasurements\(vals, dateKey\)\}/.test(APP));
  ok("the ideal-weight card asks for what it needs instead of dividing by zero",
     /gender === "male" \|\| gender === "female"\)\) \? \(/.test(APP) && /to see this/.test(APP));
  ok("one tape formula per line", /function dominantTapeSource/.test(APP)
     && (APP.match(/dominantTapeSource\(d, showBF \? entries : \[\]\)/g) || []).length === 2);
  ok("the synthesized start point is marked and not counted",
     /synthetic: true \}/.test(APP) && /sorted\.filter\(c => !c\.synthetic\)\.length/.test(APP));
}

console.log(`${checks - fails}/${checks} body-comp audit assertions passed`);
if (fails) process.exit(1);
