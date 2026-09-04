// Observed (adaptive) TDEE — what the person's body ACTUALLY burns, measured
// from what they ate and what the scale did, instead of predicted from a
// formula (S199).
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The app's target already adapts to BODYWEIGHT: computeClientCalories runs
// Mifflin-St Jeor off data.weightLbs, and every weigh-in updates that field, so
// each pound lost lowers the estimate by ~4.5 cal on its own. That is not the
// gap. The gap is everything the formula cannot see:
//
//   • The ACTIVITY MULTIPLIER is a guess made once at signup and never revisited
//     — the crudest input in the whole calculation, and the one most likely to
//     be wrong by hundreds of calories.
//   • METABOLIC ADAPTATION is real: expenditure falls FURTHER than bodyweight
//     alone predicts (~-92 +/- 110 kcal/day after a large loss, and it persists
//     after the loss stops). A formula-only target therefore drifts steadily too
//     HIGH as someone succeeds, which is a large part of the classic plateau.
//   • CHRONIC UNDER-LOGGING is invisible to a formula but shows up here
//     immediately — see the warning below, because it cuts both ways.
//
// ── THE IDENTITY ───────────────────────────────────────────────────────────
// Energy balance, rearranged. Over a window:
//
//     intake - expenditure = stored energy
//     expenditure = mean daily intake - (weight change in lbs * 3500 / days)
//
// Eat 2,200/day for a fortnight and hold weight -> expenditure is ~2,200.
// Lose 0.3 lb/week on that -> ~2,050. No model, no multiplier, no guess.
//
// ⚠️ AND THE SAME PROPERTY IS THE DANGER. This estimator cannot distinguish a
// low expenditure from an under-reported intake — they are arithmetically
// identical. Someone logging 60% of what they eat measures as someone with a
// very low TDEE. If that number were allowed to drive the target DOWN
// automatically, the app would respond to under-logging by prescribing less
// food, and then measure the result and prescribe less again. THAT SPIRAL IS
// THE CENTRAL RISK OF THE WHOLE FEATURE. This module therefore:
//   • never returns a number it cannot stand behind (it returns a reason instead),
//   • reports `confidence` and the coverage behind it so a caller can refuse,
//   • and exposes `clampToFormula` so a caller can bound how far the observed
//     number is permitted to move the target away from the formula.
// The decision of whether it may move a target at all belongs to the CALLER,
// not here. This module measures; it does not prescribe.
//
// Pure and dependency-free on purpose: every input is passed in, so it is
// directly testable (scripts/test-observed-tdee.mjs) and can run on the server
// or be mirrored on the client without dragging Firestore along.

// 3,500 kcal per pound of body mass. A linear simplification — real tissue is a
// mix of fat and lean and the true figure drifts — but it is the convention
// every consumer of this number already assumes, and being consistent with the
// rest of the app matters more here than being marginally more precise.
const CAL_PER_LB = 3500;

// ── Tunables ───────────────────────────────────────────────────────────────
// Deliberately named constants: these are the numbers most likely to be revised
// once the feature meets real data, and every one of them should be a one-line
// change rather than an archaeology exercise.
const TUNING = {
  // How far back to look. 28 days is long enough for a real trend to separate
  // from water-weight noise (a single bad weigh-in moves a 14-day slope roughly
  // twice as much as a 28-day one) and short enough to still be describing the
  // person's CURRENT metabolism rather than last season's.
  WINDOW_DAYS: 28,
  // The shortest window that can produce anything at all. Below two weeks, day
  // to day fluctuation in water and gut content dominates the actual trend.
  MIN_SPAN_DAYS: 14,
  // Logged days needed inside the window. Fourteen of twenty-eight is already
  // generous; the mean is only meaningful if it is a mean of most of the days.
  MIN_LOGGED_DAYS: 14,
  // ...and they must cover enough OF the window. 14 logged days clustered in
  // one week paired with a weight trend spanning four is a mismatched
  // comparison: the intake describes one period and the weight change another.
  MIN_COVERAGE: 0.5,
  // Weigh-ins needed, and how far apart. The slope is the noisy half of this
  // calculation, so it gets the stricter bar.
  MIN_WEIGH_INS: 4,
  MIN_WEIGH_IN_SPAN_DAYS: 10,
  // A day below this is a forgotten log, not a fast. Counting it as a real
  // ~200 kcal day would drag the mean down and read as a low expenditure —
  // the under-logging spiral arriving through the back door.
  MIN_REAL_DAY_CAL: 800,
  // Physiological sanity. Outside this the input is wrong, not the person.
  PLAUSIBLE_MIN: 1000,
  PLAUSIBLE_MAX: 6000,
  // How far the observed number may sit from the formula before it is reported
  // as `diverged`. Not a rejection — a large gap is often the true finding, and
  // is exactly what a stale activity multiplier looks like — but it is the
  // point at which a human should look before anything acts on it.
  //
  // 15% is set FROM the thing it is meant to catch: one wrong step on the
  // activity ladder is a 10-15% swing (sedentary 1.2 -> lightly active 1.375 is
  // 15%; moderate 1.55 -> very 1.725 is 11%). A looser bar would sail past the
  // single most common reason the formula is wrong, which is the whole point of
  // measuring. On a 2,900 formula this trips at ~435 cal/day — the difference
  // between losing a pound a week and holding.
  DIVERGENCE_FLAG: 0.15,
  // High confidence wants a fuller window than the bare minimum.
  HIGH_CONF_LOGGED_DAYS: 21,
  HIGH_CONF_COVERAGE: 0.75,
  HIGH_CONF_WEIGH_INS: 8,
};

// ── date helpers ───────────────────────────────────────────────────────────
// Dates arrive as LOCAL "YYYY-MM-DD" keys (the app has used local keys since
// S45 — never UTC "today"). Everything here works on the string form and a
// midday timestamp, so a DST boundary inside the window cannot shift a day.
function dayNum(dateKey) {
  if (typeof dateKey !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

// Least-squares slope of y over x, in y-units per x-unit. Null when the x
// values do not vary (every reading on one day cannot describe a trend).
function slope(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let num = 0, den = 0;
  for (const p of points) { const dx = p.x - mx; num += dx * (p.y - my); den += dx * dx; }
  if (!(den > 0)) return null;
  return num / den;
}

/**
 * Measure expenditure from logged intake and the weight trend.
 *
 * @param {object} input
 *   days      [{ date: "YYYY-MM-DD", calories: number }]  — one entry per logged day.
 *                                                           Planned/future days must be
 *                                                           filtered out by the caller.
 *   weighIns  [{ date: "YYYY-MM-DD", weight: number }]     — one per date.
 *   asOf      "YYYY-MM-DD"   — the window's last day. Defaults to the newest input date.
 *   formulaTdee number|null  — the current formula estimate, used only to report divergence.
 *   tuning    object         — overrides for TUNING, for tests and for later tuning.
 *
 * @returns {object} Always an object, never a throw.
 *   tdee            number|null — the measured expenditure, or null when it cannot be measured.
 *   reason          string|null — WHY it is null, in words fit to show a person.
 *   confidence      "high"|"low"|null
 *   meanIntake, loggedDays, windowDays, coverage, weighIns, spanDays
 *   trendLbsPerWeek number|null — negative = losing.
 *   diverged        boolean     — sits more than DIVERGENCE_FLAG from formulaTdee.
 *   deltaVsFormula  number|null
 */
function estimateObservedTdee(input) {
  const inp = input || {};
  const T = Object.assign({}, TUNING, inp.tuning || {});
  const out = {
    tdee: null, reason: null, confidence: null, meanIntake: null,
    loggedDays: 0, windowDays: T.WINDOW_DAYS, coverage: 0, weighIns: 0, spanDays: 0,
    trendLbsPerWeek: null, diverged: false, deltaVsFormula: null,
  };

  const rawDays = Array.isArray(inp.days) ? inp.days : [];
  const rawWeights = Array.isArray(inp.weighIns) ? inp.weighIns : [];

  // Normalise, drop anything unusable, and collapse duplicate dates (last wins,
  // matching the app's replace-by-date rule for both logs and weigh-ins).
  const dayMap = new Map();
  for (const d of rawDays) {
    if (!d) continue;
    const n = dayNum(d.date);
    const cal = Number(d.calories);
    if (n == null || !isFinite(cal)) continue;
    dayMap.set(n, cal);
  }
  const wMap = new Map();
  for (const w of rawWeights) {
    if (!w) continue;
    const n = dayNum(w.date);
    const lbs = Number(w.weight);
    if (n == null || !(lbs > 0)) continue;
    wMap.set(n, lbs);
  }

  // The window ends on asOf, or on the newest thing we were given.
  const allNums = [...dayMap.keys(), ...wMap.keys()];
  if (!allNums.length) { out.reason = "Nothing logged yet."; return out; }
  const end = dayNum(inp.asOf) != null ? dayNum(inp.asOf) : Math.max(...allNums);
  const start = end - (T.WINDOW_DAYS - 1);

  // Intake: only days that look like a real day's eating.
  const inWindowDays = [];
  for (const [n, cal] of dayMap) {
    if (n < start || n > end) continue;
    if (cal < T.MIN_REAL_DAY_CAL) continue;   // a forgotten log, not a fast
    inWindowDays.push({ x: n, y: cal });
  }
  out.loggedDays = inWindowDays.length;
  out.coverage = Math.round((inWindowDays.length / T.WINDOW_DAYS) * 100) / 100;

  // Weight: every weigh-in in the window.
  const inWindowW = [];
  for (const [n, lbs] of wMap) {
    if (n < start || n > end) continue;
    inWindowW.push({ x: n, y: lbs });
  }
  inWindowW.sort((a, b) => a.x - b.x);
  out.weighIns = inWindowW.length;
  out.spanDays = inWindowW.length >= 2 ? inWindowW[inWindowW.length - 1].x - inWindowW[0].x : 0;

  // ── The bars. Each returns a sentence a person can act on, because "not
  // enough data" tells nobody what to do about it. ──────────────────────────
  if (out.loggedDays < T.MIN_LOGGED_DAYS) {
    out.reason = `Needs ${T.MIN_LOGGED_DAYS} logged days in the last ${T.WINDOW_DAYS} — there are ${out.loggedDays}.`;
    return out;
  }
  if (out.coverage < T.MIN_COVERAGE) {
    out.reason = "Your logged days are too bunched together to compare against the scale.";
    return out;
  }
  if (out.weighIns < T.MIN_WEIGH_INS) {
    out.reason = `Needs ${T.MIN_WEIGH_INS} weigh-ins in the last ${T.WINDOW_DAYS} days — there are ${out.weighIns}.`;
    return out;
  }
  if (out.spanDays < T.MIN_WEIGH_IN_SPAN_DAYS) {
    out.reason = `Your weigh-ins only span ${out.spanDays} days — too short to read a trend from.`;
    return out;
  }

  const lbsPerDay = slope(inWindowW);
  if (lbsPerDay == null) { out.reason = "Your weigh-ins are all on one day."; return out; }
  out.trendLbsPerWeek = Math.round(lbsPerDay * 7 * 100) / 100;

  const meanIntake = inWindowDays.reduce((s, d) => s + d.y, 0) / inWindowDays.length;
  out.meanIntake = Math.round(meanIntake);

  // The identity. Losing (negative slope) means the body burned MORE than was
  // eaten, so the subtraction adds it back.
  const tdee = Math.round(meanIntake - lbsPerDay * CAL_PER_LB);

  if (!(tdee >= T.PLAUSIBLE_MIN && tdee <= T.PLAUSIBLE_MAX)) {
    out.reason = "The numbers don't add up yet — check for a mis-typed weigh-in or a missed day.";
    return out;
  }
  out.tdee = tdee;

  const f = Number(inp.formulaTdee);
  if (f > 0) {
    out.deltaVsFormula = tdee - Math.round(f);
    out.diverged = Math.abs(tdee - f) / f > T.DIVERGENCE_FLAG;
  }

  out.confidence = (out.loggedDays >= T.HIGH_CONF_LOGGED_DAYS
    && out.coverage >= T.HIGH_CONF_COVERAGE
    && out.weighIns >= T.HIGH_CONF_WEIGH_INS) ? "high" : "low";

  return out;
}

/**
 * Bound how far a measured number may pull a target away from the formula.
 *
 * ⚠️ THE UNDER-LOGGING SPIRAL LIVES HERE. A person who logs 60% of what they
 * eat measures as a person with a very low expenditure, and the honest response
 * to a low expenditure is less food — which is precisely the wrong prescription
 * for someone who is already eating more than they think. Bounding the
 * DOWNWARD movement more tightly than the upward one is deliberate and
 * asymmetric: being wrong upward feeds someone slightly too much for a while,
 * being wrong downward starves someone who is already mis-measuring themselves.
 */
function clampToFormula(observed, formulaTdee, opts) {
  const o = opts || {};
  const downPct = o.maxDropPct != null ? o.maxDropPct : 0.10;   // at most 10% below the formula
  const upPct = o.maxRisePct != null ? o.maxRisePct : 0.20;     // up to 20% above it
  const f = Number(formulaTdee);
  const v = Number(observed);
  if (!(f > 0) || !isFinite(v)) return { value: null, clamped: false, direction: null };
  const lo = f * (1 - downPct), hi = f * (1 + upPct);
  if (v < lo) return { value: Math.round(lo), clamped: true, direction: "down" };
  if (v > hi) return { value: Math.round(hi), clamped: true, direction: "up" };
  return { value: Math.round(v), clamped: false, direction: null };
}

module.exports = { estimateObservedTdee, clampToFormula, dayNum, slope, TUNING, CAL_PER_LB };
