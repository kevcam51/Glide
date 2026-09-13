// Steps and the activity ladder (S229).
//
// Kevin: "as people continue to track their movement, and if their activity
// level increases consistently, then it would make sense for their activity
// level that we have on record to also increase.. but same goes for those
// people that decrease their workout for stretches of time then we would have
// to send a notification to recommend decreasing their activity level."
//
// The ladder is the crudest input to maintenance — one rung is 0.175 x BMR,
// ~319 cal/day on a 200 lb man — and it was stated once at signup and never
// revisited. activityRungSuggestion already proposed a change, but only from
// LOGGED FOOD plus the scale, so a watch-wearer who never logs a meal was never
// asked anything.
//
// ⚠️ THREE PROPERTIES CARRY THE SAFETY OF THIS FEATURE, AND MOST OF THIS SUITE
// EXISTS TO PIN THEM:
//   1. A MISSING DAY IS NOT A ZERO-STEP DAY. Treating a patchy sync as zeros
//      would recommend a downgrade for everyone whose watch missed a week.
//   2. TRAINING DAYS ARE EXCLUDED. The multiplier describes the life around
//      training; the training itself is already priced as the eat-back burn, so
//      including workout steps counts it twice — which is exactly why the wizard
//      shows its tracker figure and refuses to auto-pick a rung from it.
//   3. STEPS ALONE MAY NEVER LOWER A RUNG. The ladder is described by JOB TYPE
//      and load ("Physical job: lifting, carrying, climbing", "or heavy
//      lifting"), so a lifter or a cyclist is genuinely Very Active on 4,000
//      steps. Cutting their food on a metric that does not describe them is the
//      one outcome this must not produce.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripJsxComments } from "./lib/strip-comments.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(here, "..", "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };
const code = (src) => stripJsxComments(src);

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

const NAMES = ["DAYS", "ACTIVITY_LEVELS", "ACTIVITY_COOLDOWN_DAYS", "PARTIAL_DAY_MIN",
  "STEP_DEADBAND", "STEP_WINDOW_DAYS", "STEP_MIN_DAYS_UP", "STEP_MIN_DAYS_DOWN",
  "STEP_MIN_COVERAGE_UP", "STEP_MIN_COVERAGE_DOWN",
  "ymdLocal", "calcBMR", "ageFromDob", "effectiveAge",
  "parseStepBand", "rungForSteps", "summariseSteps", "watchAgreesLower", "stepsActivitySuggestion"];
const M = new Function(NAMES.map((n) => liftDecl(APP, n)).join("\n") + "\nreturn { " + NAMES.join(", ") + " };")();

console.log("\n  Steps and the activity ladder\n");

// ── 1. The bands come from the strings people read ────────────────────────
// ⚠️ THE ROUND TRIP IS THE POINT. If someone edits a label and this stops
// reproducing it, the rule that acts on the number has silently kept the old
// one — the exact drift this repo has paid for three times.
{
  const fmt = (n) => n.toLocaleString("en-US");
  let mismatch = 0;
  for (const a of M.ACTIVITY_LEVELS) {
    const b = M.parseStepBand(a.steps);
    if (!b) { mismatch++; continue; }
    const back = b.lo === 0 ? `Under ${fmt(b.hi)}`
      : b.hi === Infinity ? `${fmt(b.lo)}+`
      : `${fmt(b.lo)}–${fmt(b.hi)}`;
    if (back !== a.steps) { mismatch++; console.log("      round trip:", JSON.stringify(a.steps), "->", JSON.stringify(back)); }
  }
  ok("every rung's band reproduces its own label exactly", mismatch === 0, mismatch);
  ok("all five rungs parse", M.ACTIVITY_LEVELS.every((a) => !!M.parseStepBand(a.steps)));
}
ok("Under N parses", JSON.stringify(M.parseStepBand("Under 5,000")) === JSON.stringify({ lo: 0, hi: 5000 }));
ok("an en-dash range parses", JSON.stringify(M.parseStepBand("5,000–7,500")) === JSON.stringify({ lo: 5000, hi: 7500 }));
ok("a plain hyphen also parses", JSON.stringify(M.parseStepBand("5,000-7,500")) === JSON.stringify({ lo: 5000, hi: 7500 }));
ok("an open top parses", M.parseStepBand("15,000+").hi === Infinity);
ok("junk does not parse", M.parseStepBand("lots") === null);
ok("empty does not parse", M.parseStepBand("") === null);
ok("null does not parse", M.parseStepBand(null) === null);

// ── 2. Steps to a rung ────────────────────────────────────────────────────
ok("4,000 steps is sedentary", M.rungForSteps(4000).id === "sedentary");
ok("6,000 steps is lightly active", M.rungForSteps(6000).id === "light");
ok("9,000 steps is moderately active", M.rungForSteps(9000).id === "moderate");
ok("13,000 steps is very active", M.rungForSteps(13000).id === "very");
ok("20,000 steps is extremely active", M.rungForSteps(20000).id === "extra");
// A boundary belongs to the higher rung, matching how the labels read.
ok("exactly 7,500 is the start of moderate", M.rungForSteps(7500).id === "moderate");
ok("exactly 5,000 is the start of light", M.rungForSteps(5000).id === "light");
ok("zero is sedentary", M.rungForSteps(0).id === "sedentary");
ok("nonsense has no rung", M.rungForSteps("x") === null);
ok("a negative count has no rung", M.rungForSteps(-5) === null);

// ── 3. Summarising the ordinary days ──────────────────────────────────────
const ASOF = "2026-03-01";
const dayKey = (i) => { const d = new Date(ASOF + "T12:00:00"); d.setDate(d.getDate() - i); return d.toISOString().slice(0, 10); };
const build = (fn) => { const m = {}; for (let i = 1; i <= 28; i++) { const v = fn(i); if (v !== undefined) m[dayKey(i)] = { wearable: v }; } return m; };
const plan = (over) => ({ gender: "male", weightLbs: 200, heightFt: 5, heightIn: 10, age: 40,
  ageSetAt: Date.parse(ASOF), activityLevel: "light", cardio: {}, strength: {}, checkIns: [], ...over });

{
  const s = M.summariseSteps(build(() => ({ steps: 9000 })), plan(), ASOF, 28);
  ok("a full month of 9,000-step days reads 9,000", s.median === 9000, s && s.median);
  ok("...over 28 days", s.dayCount === 28, s && s.dayCount);
  ok("...at full coverage", s.coverage === 1, s && s.coverage);
}
{
  // ⚠️ THE TRAP. Half the days missing must NOT read as half-zero.
  const s = M.summariseSteps(build((i) => (i % 2 ? { steps: 9000 } : undefined)), plan(), ASOF, 28);
  ok("missing days are dropped, not counted as zero", s.median === 9000, s.median);
  ok("...and are not in the denominator", s.dayCount === 14, s.dayCount);
  ok("...so coverage reports the gap honestly", Math.abs(s.coverage - 0.5) < 1e-9, s.coverage);
}
{
  const s = M.summariseSteps(build(() => ({ steps: 0 })), plan(), ASOF, 28);
  ok("a stored zero is a day the watch did not report", s.dayCount === 0, s.dayCount);
  ok("...and yields no median", s.median === 0);
}
{
  const s = M.summariseSteps(build(() => ({ active: 400 })), plan(), ASOF, 28);
  ok("a wearable record with no steps is not a step day", s.dayCount === 0);
}
{
  // The median ignores one outlier in each direction; a mean would not.
  const m = build((i) => ({ steps: i === 3 ? 40000 : i === 4 ? 200 : 6000 }));
  const s = M.summariseSteps(m, plan(), ASOF, 28);
  ok("one theme-park day does not promote anyone", s.median === 6000, s.median);
}
{
  // ⚠️ TRAINING DAYS ARE EXCLUDED — the double count the wizard warns about.
  const worked = [];
  for (let i = 1; i <= 28; i += 2) worked.push({ date: dayKey(i), workedOut: true });
  const m = build((i) => ({ steps: i % 2 ? 20000 : 5000 }));   // huge on training days
  const s = M.summariseSteps(m, plan({ checkIns: worked }), ASOF, 28);
  ok("a performed workout day leaves the sample", s.median === 5000, s.median);
  ok("...and leaves the ordinary-day universe too", s.ordinaryDays === 14, s.ordinaryDays);
}
{
  // A weekday carrying scheduled training is a training day even with no check-in.
  const asOfDow = new Date(ASOF + "T12:00:00").getDay();
  const everyDay = {};
  M.DAYS.forEach((d) => { everyDay[d] = []; });
  const one = M.DAYS[(new Date(dayKey(1) + "T12:00:00").getDay() + 6) % 7];
  const sched = { ...everyDay, [one]: [{ type: "walk_flat", duration: 30 }] };
  const s = M.summariseSteps(build(() => ({ steps: 9000 })), plan({ cardio: sched }), ASOF, 28);
  ok("a scheduled training weekday is excluded", s.ordinaryDays === 24, { ordinaryDays: s.ordinaryDays, asOfDow });
}
ok("no window means no summary", M.summariseSteps({}, plan(), null, 28) === null);
ok("an empty map yields an empty sample", M.summariseSteps({}, plan(), ASOF, 28).dayCount === 0);

// ── 4. The proposal ───────────────────────────────────────────────────────
const sum = (over) => ({ median: 9000, dayCount: 20, ordinaryDays: 24, coverage: 20 / 24, windowDays: 28, ...over });
const ask = (over) => M.stepsActivitySuggestion({
  summary: sum(), data: plan(), activityCheck: null, now: Date.parse(ASOF), watchAgrees: false, ...over });

{
  // Lightly Active on profile, 9,000 typical steps → Moderately Active.
  const r = ask();
  ok("a sustained higher step count proposes a higher rung", !!r && r.dir === "up", r);
  ok("...to the rung the steps actually fall in", r.to.id === "moderate", r && r.to.id);
  ok("...from the rung on the profile", r.from.id === "light");
  ok("...and reports what it measured", r.median === 9000 && r.dayCount === 20);
}
ok("steps inside the current band change nothing", ask({ summary: sum({ median: 6000 }) }) === null);
// ⚠️ THE DEADBAND. Light runs 5,000-7,500, so 8,000 is over the edge but inside
// the 1,000-step gap; 8,500 clears it. The round trip between rungs is 2,000.
ok("just over the edge is not enough", ask({ summary: sum({ median: 8000 }) }) === null);
ok("clear of the deadband is enough", !!ask({ summary: sum({ median: 8500 }) }));
ok("the deadband is a round 1,000", M.STEP_DEADBAND === 1000);
ok("too few days to act on", ask({ summary: sum({ median: 9000, dayCount: 9 }) }) === null);
ok("too sparse a sync to act on", ask({ summary: sum({ median: 9000, dayCount: 10, ordinaryDays: 26, coverage: 10 / 26 }) }) === null);
ok("no steps at all, no proposal", ask({ summary: sum({ median: 0 }) }) === null);
ok("no summary, no proposal", ask({ summary: null }) === null);
// The same 14-day answer cooldown the food-driven proposal honours.
ok("a recent answer silences it",
  ask({ activityCheck: { at: Date.parse(ASOF) - 3 * 86400000, to: "moderate", decision: "dismissed" } }) === null);
ok("an old answer does not", !!ask({ activityCheck: { at: Date.parse(ASOF) - 30 * 86400000 } }));
ok("it shares the ladder's cooldown constant", M.ACTIVITY_COOLDOWN_DAYS === 14);
ok("switched off, it says nothing", ask({ data: plan({ activityStepsOff: true }) }) === null);

// ── 5. Downward — the direction that can do harm ──────────────────────────
const low = { summary: sum({ median: 3000, dayCount: 20, ordinaryDays: 24, coverage: 20 / 24 }), data: plan({ activityLevel: "very" }) };
// ⚠️ THE LIFTER. Very Active on the profile, 3,000 steps, no corroboration:
// the ladder counts lifting and carrying, which a step count cannot see.
ok("STEPS ALONE NEVER LOWER A RUNG", M.stepsActivitySuggestion({ ...low, now: Date.parse(ASOF), watchAgrees: false }) === null);
ok("with the watch's own burn agreeing, it proposes down", (() => {
  const r = M.stepsActivitySuggestion({ ...low, now: Date.parse(ASOF), watchAgrees: true });
  return !!r && r.dir === "down";
})());
ok("...to the rung the steps fall in", (() => {
  const r = M.stepsActivitySuggestion({ ...low, now: Date.parse(ASOF), watchAgrees: true });
  return r.to.id === "sedentary";
})());
// Down is held to a stricter bar than up, for the asymmetry reason.
ok("down needs more days than up", M.STEP_MIN_DAYS_DOWN > M.STEP_MIN_DAYS_UP);
ok("down needs better coverage than up", M.STEP_MIN_COVERAGE_DOWN > M.STEP_MIN_COVERAGE_UP);
ok("a thin window cannot lower a rung", M.stepsActivitySuggestion({
  summary: sum({ median: 3000, dayCount: 12, ordinaryDays: 24, coverage: 12 / 24 }),
  data: plan({ activityLevel: "very" }), now: Date.parse(ASOF), watchAgrees: true }) === null);
ok("a patchy sync cannot lower a rung", M.stepsActivitySuggestion({
  summary: sum({ median: 3000, dayCount: 14, ordinaryDays: 26, coverage: 14 / 26 }),
  data: plan({ activityLevel: "very" }), now: Date.parse(ASOF), watchAgrees: true }) === null);
// ⚠️ THE DEADBAND APPLIES GOING DOWN TOO, and it needs its own case: a fixture
// far below the band passes with or without it, so it proves nothing about the
// gap. Very Active runs 11,000-15,000, so dropping out needs under 10,000.
ok("just under the band edge is not enough to drop a rung", M.stepsActivitySuggestion({
  summary: sum({ median: 10500, dayCount: 20, ordinaryDays: 24, coverage: 20 / 24 }),
  data: plan({ activityLevel: "very" }), now: Date.parse(ASOF), watchAgrees: true }) === null);
ok("clear of the deadband does drop a rung", !!M.stepsActivitySuggestion({
  summary: sum({ median: 9500, dayCount: 20, ordinaryDays: 24, coverage: 20 / 24 }),
  data: plan({ activityLevel: "very" }), now: Date.parse(ASOF), watchAgrees: true }));
// The round trip between two rungs is therefore 2,000 steps, which is what
// stops someone near a boundary being asked, answering, and asked the opposite.
ok("moving up and back needs 2,000 steps between them", (() => {
  const upAt = 7500 + M.STEP_DEADBAND;     // light -> moderate
  const downAt = 7500 - M.STEP_DEADBAND;   // moderate -> light
  return upAt - downAt === 2 * M.STEP_DEADBAND;
})());

// ── 6. The corroborator, run ──────────────────────────────────────────────
{
  const p = plan({ activityLevel: "very" });
  const bmr = M.calcBMR("male", 200, 5, 10, 40);
  const sed = M.ACTIVITY_LEVELS[0];
  // Whole-day burn well under the target rung's maintenance.
  const lowBurn = build(() => ({ resting: Math.round(bmr * 0.95), active: 120 }));
  ok("a watch reading well under the lower rung agrees",
    M.watchAgreesLower(lowBurn, p, ASOF, sed, 28) === true);
  // A real athlete's whole-day burn does not.
  const highBurn = build(() => ({ resting: Math.round(bmr * 0.95), active: 1400 }));
  ok("a watch reading a real burn does NOT agree",
    M.watchAgreesLower(highBurn, p, ASOF, sed, 28) === false);
  // ⚠️ A HALF-SYNCED DAY READS LOW FOR A REASON THAT IS NOT THE PERSON. The
  // same partial-day gate wearableTdee uses keeps those out.
  const partial = build(() => ({ resting: Math.round(bmr * 0.3), active: 50 }));
  ok("a part-day reading is not evidence of anything",
    M.watchAgreesLower(partial, p, ASOF, sed, 28) === false);
  ok("no watch data is not agreement", M.watchAgreesLower({}, p, ASOF, sed, 28) === false);
  ok("one or two days is not agreement",
    M.watchAgreesLower({ [dayKey(1)]: { wearable: { resting: Math.round(bmr * 0.95), active: 10 } } }, p, ASOF, sed, 28) === false);
  ok("a hand-entered whole-day total counts",
    M.watchAgreesLower(build(() => ({ total: 1800 })), p, ASOF, sed, 28) === true);
  ok("no target rung, no agreement", M.watchAgreesLower(lowBurn, p, ASOF, null, 28) === false);
}

// ── 7. Wiring ─────────────────────────────────────────────────────────────
const C = code(APP);
ok("the summary is computed from the map already loaded", /summariseSteps\(byDate, data, viewDate, STEP_WINDOW_DAYS\)/.test(C));
ok("no second Firestore read was added for it", !/listForUser\([^)]*steps/i.test(C));
ok("the proposal is rendered", /stepSuggestion && \(\(\) => \{/.test(C));
// ⚠️ THE FOOD-DRIVEN ANSWER WINS WHEN BOTH SPEAK — two proposals to move one
// field, possibly in opposite directions, is a contradiction, not a feature.
ok("it yields to the food-driven proposal", /activitySuggestion \? null : stepsActivitySuggestion\(/.test(C));
ok("accepting writes through the existing handler", (C.match(/onSetActivityLevel\(stepSuggestion\.to\.id\)/g) || []).length === 1);
ok("Not now writes the shared cooldown stamp", /onDismissActivitySuggestion\(stepSuggestion\.to\.id\)/.test(C));
ok("the proposal says what it costs", /fewer calories a day to eat/.test(APP));
ok("...in both directions", /more calories a day to eat/.test(APP));
ok("it quotes the number actually in force", /const inForce = planMaintenance\(data\)\.tdee/.test(C));
ok("...and the number after the change", /planMaintenance\(\{ \.\.\.data, activityLevel: stepSuggestion\.to\.id \}\)\.tdee/.test(C));
ok("the lifter can opt out", /My activity isn&rsquo;t about steps/.test(APP));
ok("...and opt back in", /Use my steps again/.test(APP));
ok("the opt-out is honoured", /if \(d\.activityStepsOff === true\) return null;/.test(C));
ok("the card explains why training days are left out", /counting their steps here would count them twice/.test(APP));
// House rule: icons, never emoji. `walk` exists in src/icons.jsx.
ok("the card uses a house icon", /<Icon name="walk"/.test(C));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  Steps can raise a rung on their own; lowering one needs more than footfalls.\n");
process.exit(fails ? 1 : 0);
