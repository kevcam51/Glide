// Tests for the observed (adaptive) TDEE estimator — S199.
//
// The rules being pinned:
//   • The identity is right in BOTH directions: losing weight means the body
//     burned more than was eaten, gaining means less.
//   • It NEVER returns a number it cannot stand behind. Every refusal carries a
//     reason a person could act on, because "not enough data" tells nobody what
//     to do about it.
//   • The refusal bars actually bite: too few logged days, days bunched into one
//     corner of the window, too few weigh-ins, weigh-ins too close together.
//   • A forgotten log (a 200-cal day) is not counted as a real day's eating —
//     that is the under-logging spiral arriving through the back door.
//   • The downward clamp is TIGHTER than the upward one, on purpose.
//   • Noise in a single weigh-in must not swing the answer wildly, which is why
//     the trend is a regression and not an endpoint subtraction.
//
// Run: node scripts/test-observed-tdee.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const FN = join(dirname(fileURLToPath(import.meta.url)), "..", "functions") + "/";
const O = require(FN + "observedTdee.js");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

// ── helpers to build a plausible month ──────────────────────────────────────
const DAY = 86400000;
const key = (offsetFromStart) => {
  const d = new Date(Date.UTC(2026, 0, 1) + offsetFromStart * DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
// n days of a fixed intake, starting at day 0.
const evenDays = (n, cal) => Array.from({ length: n }, (_, i) => ({ date: key(i), calories: cal }));
// Weigh-ins on a perfectly linear trend: `perWeek` lbs per week from `startLbs`.
const linearWeights = (n, everyDays, startLbs, perWeek) =>
  Array.from({ length: n }, (_, i) => ({
    date: key(i * everyDays),
    weight: Math.round((startLbs + (perWeek / 7) * (i * everyDays)) * 10) / 10,
  }));

const LAST = key(27);   // the 28-day window ends here

// ── the identity, both directions ───────────────────────────────────────────
{
  // Held weight exactly, eating 2,200. Expenditure IS 2,200.
  const r = O.estimateObservedTdee({
    days: evenDays(28, 2200), weighIns: linearWeights(8, 4, 200, 0), asOf: LAST,
  });
  ok("holding weight measures expenditure as the intake", near(r.tdee, 2200, 5), r);
  ok("...and reports the flat trend", near(r.trendLbsPerWeek, 0, 0.02), r.trendLbsPerWeek);
}
{
  // Lost 1 lb/week on 2,200. 1 lb/wk = 500 cal/day, so expenditure is ~2,700.
  const r = O.estimateObservedTdee({
    days: evenDays(28, 2200), weighIns: linearWeights(8, 4, 200, -1), asOf: LAST,
  });
  ok("losing 1 lb/wk on 2,200 measures ~2,700", near(r.tdee, 2700, 15), r);
  ok("...and the trend is reported as negative", r.trendLbsPerWeek < 0, r.trendLbsPerWeek);
}
{
  // Gained 0.5 lb/week on 3,000 -> expenditure is ~250 below intake.
  const r = O.estimateObservedTdee({
    days: evenDays(28, 3000), weighIns: linearWeights(8, 4, 180, 0.5), asOf: LAST,
  });
  ok("gaining 0.5 lb/wk on 3,000 measures ~2,750", near(r.tdee, 2750, 15), r);
}
{
  // The headline case: a stale activity multiplier. Formula says 2,900, the
  // scale and the food log together say 2,300.
  const r = O.estimateObservedTdee({
    days: evenDays(28, 2300), weighIns: linearWeights(8, 4, 200, 0), asOf: LAST, formulaTdee: 2900,
  });
  ok("a 600-cal gap against the formula is reported", near(r.deltaVsFormula, -600, 10), r.deltaVsFormula);
  ok("...and flagged as diverged", r.diverged === true, r);
}

// ── it refuses, with a reason, rather than guessing ─────────────────────────
{
  const r = O.estimateObservedTdee({ days: [], weighIns: [] });
  ok("nothing logged returns null, not a number", r.tdee === null, r);
  ok("...with a reason", typeof r.reason === "string" && r.reason.length > 0, r.reason);
}
{
  const r = O.estimateObservedTdee({
    days: evenDays(9, 2200), weighIns: linearWeights(8, 4, 200, -1), asOf: LAST,
  });
  ok("too few logged days refuses", r.tdee === null, r);
  ok("...and says how many are needed", /logged days/.test(r.reason || ""), r.reason);
}
{
  // 14 logged days, but all inside the first week — the intake describes one
  // period and the weight trend another.
  const bunched = Array.from({ length: 14 }, (_, i) => ({ date: key(i % 7), calories: 2200 }));
  const r = O.estimateObservedTdee({
    days: bunched, weighIns: linearWeights(8, 4, 200, -1), asOf: LAST,
  });
  ok("logged days bunched into one corner refuse", r.tdee === null, r);
}
{
  const r = O.estimateObservedTdee({
    days: evenDays(28, 2200), weighIns: linearWeights(2, 4, 200, -1), asOf: LAST,
  });
  ok("too few weigh-ins refuses", r.tdee === null, r);
  ok("...and says so", /weigh-in/.test(r.reason || ""), r.reason);
}
{
  // Four weigh-ins, but all within 3 days of each other.
  const clustered = [0, 1, 2, 3].map((i) => ({ date: key(i), weight: 200 - i * 0.1 }));
  const r = O.estimateObservedTdee({
    days: evenDays(28, 2200), weighIns: clustered, asOf: LAST,
  });
  ok("weigh-ins spanning only a few days refuse", r.tdee === null, r);
  ok("...naming the span", /span/.test(r.reason || ""), r.reason);
}
{
  // Every weigh-in on ONE date — a slope is undefined, not zero.
  const sameDay = [{ date: key(10), weight: 200 }, { date: key(10), weight: 201 }];
  const r = O.estimateObservedTdee({ days: evenDays(28, 2200), weighIns: sameDay, asOf: LAST });
  ok("all weigh-ins on one day refuse rather than reading as flat", r.tdee === null, r);
}

// ── the under-logging back door ─────────────────────────────────────────────
{
  // 14 real days at 2,200 plus 14 forgotten 150-cal days. Counting the stubs
  // would halve the mean and read as a starvation-level expenditure.
  const withStubs = [...evenDays(14, 2200),
    ...Array.from({ length: 14 }, (_, i) => ({ date: key(14 + i), calories: 150 }))];
  const r = O.estimateObservedTdee({
    days: withStubs, weighIns: linearWeights(8, 4, 200, 0), asOf: LAST,
  });
  ok("a 150-cal day is treated as a forgotten log, not a fast", near(r.tdee, 2200, 20), r);
  ok("...and is not counted toward the logged-day bar", r.loggedDays === 14, r.loggedDays);
}
{
  // Implausible output is refused rather than shown.
  const r = O.estimateObservedTdee({
    days: evenDays(28, 900), weighIns: linearWeights(8, 4, 200, 3), asOf: LAST,
  });
  ok("a physiologically implausible result is refused", r.tdee === null, r);
}

// ── noise: a regression, not an endpoint subtraction ────────────────────────
{
  const clean = linearWeights(8, 4, 200, -1);
  // One weigh-in 2 lbs high — a salty meal, a different scale, a bad morning.
  const noisy = clean.map((w, i) => (i === 3 ? { ...w, weight: w.weight + 2 } : w));
  const a = O.estimateObservedTdee({ days: evenDays(28, 2200), weighIns: clean, asOf: LAST });
  const b = O.estimateObservedTdee({ days: evenDays(28, 2200), weighIns: noisy, asOf: LAST });
  ok("one noisy weigh-in moves the answer by less than 150 cal",
     Math.abs(a.tdee - b.tdee) < 150, [a.tdee, b.tdee]);
  // The endpoint method is what we are avoiding: prove it would be worse if the
  // noise landed on the LAST reading.
  const noisyEnd = clean.map((w, i) => (i === clean.length - 1 ? { ...w, weight: w.weight + 2 } : w));
  const c = O.estimateObservedTdee({ days: evenDays(28, 2200), weighIns: noisyEnd, asOf: LAST });
  const endpointSwing = Math.abs(((clean[clean.length - 1].weight + 2) - clean[0].weight)
    - (clean[clean.length - 1].weight - clean[0].weight)) * 3500 / 28;
  ok("...and less than the same noise would move an endpoint calculation",
     Math.abs(a.tdee - c.tdee) < endpointSwing, [a.tdee, c.tdee, Math.round(endpointSwing)]);
}

// ── confidence ──────────────────────────────────────────────────────────────
{
  const full = O.estimateObservedTdee({
    days: evenDays(28, 2200), weighIns: linearWeights(14, 2, 200, -1), asOf: LAST,
  });
  ok("a full window of daily logs and frequent weigh-ins is high confidence",
     full.confidence === "high", full);
  const thin = O.estimateObservedTdee({
    days: evenDays(15, 2200), weighIns: linearWeights(4, 6, 200, -1), asOf: LAST,
  });
  ok("a bare-minimum window is low confidence, not high", thin.confidence === "low", thin);
  ok("...but still produces a number", thin.tdee > 0, thin);
}

// ── window boundaries ───────────────────────────────────────────────────────
{
  // Data from three months ago must not leak into the window.
  const old = Array.from({ length: 28 }, (_, i) => ({ date: key(i - 90), calories: 4000 }));
  const r = O.estimateObservedTdee({
    days: [...old, ...evenDays(28, 2200)], weighIns: linearWeights(8, 4, 200, 0), asOf: LAST,
  });
  ok("days outside the window are excluded", near(r.tdee, 2200, 20), r);
  ok("...and do not inflate the logged-day count", r.loggedDays === 28, r.loggedDays);
}
{
  // Duplicate dates collapse, last wins — the app's replace-by-date rule.
  const dupes = [...evenDays(28, 2200), { date: key(5), calories: 9000 }];
  const r = O.estimateObservedTdee({ days: dupes, weighIns: linearWeights(8, 4, 200, 0), asOf: LAST });
  ok("a duplicate date does not double-count", r.loggedDays === 28, r.loggedDays);
  ok("...and the last value wins", r.meanIntake > 2200, r.meanIntake);
}
{
  // Junk input is survived, not thrown on.
  const r = O.estimateObservedTdee({
    days: [null, { date: "nonsense", calories: 2000 }, { date: key(1), calories: "abc" }, ...evenDays(28, 2200)],
    weighIns: [null, { date: key(2), weight: 0 }, ...linearWeights(8, 4, 200, 0)], asOf: LAST,
  });
  ok("malformed rows are skipped rather than thrown on", r.tdee > 0, r);
}

// ── the clamp, and its deliberate asymmetry ─────────────────────────────────
{
  const down = O.clampToFormula(1800, 2600);          // 31% below
  ok("a big drop is clamped", down.clamped === true && down.direction === "down", down);
  ok("...to 10% below the formula", down.value === 2340, down);
  const up = O.clampToFormula(3400, 2600);            // 31% above
  ok("a big rise is clamped", up.clamped === true && up.direction === "up", up);
  ok("...but to a looser 20% above", up.value === 3120, up);
  ok("the downward bound is tighter than the upward one, on purpose",
     (2600 - down.value) < (up.value - 2600), [down.value, up.value]);
  const inside = O.clampToFormula(2500, 2600);
  ok("a plausible number passes through untouched",
     inside.clamped === false && inside.value === 2500, inside);
  ok("no formula to compare against yields nothing rather than a guess",
     O.clampToFormula(2500, 0).value === null);
}

// ── dates are local keys, and DST cannot shift a day ────────────────────────
{
  ok("a local date key parses to a stable day number",
     O.dayNum("2026-03-08") + 1 === O.dayNum("2026-03-09"));   // US DST spring-forward
  ok("...and so does the autumn one",
     O.dayNum("2026-11-01") + 1 === O.dayNum("2026-11-02"));
  ok("a malformed date is rejected, not coerced", O.dayNum("8 March") === null);
  ok("a Date object is rejected rather than silently stringified", O.dayNum(new Date()) === null);
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
