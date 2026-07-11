# Non-Scale Metrics — formulas, verdicts, and build plan

_Created S92 (Jul 2026). Kevin's ask: clients who hate the scale need real ways to measure
progress. Source thread: Covert Bailey's "The Ultimate Fit or Fat" (Kevin's book) + verified web
sources. This doc is the canonical formula reference — don't re-research these._

## The core insight

Calories control energy balance → change in total body MASS. The scale measures mass directly,
which is why calories→weight is a clean formula. Waist size, shape, and body-fat % are
*downstream* of mass change — related but not tied to calories by one universal equation (fat-loss
location varies by genetics/sex/hormones). So: keep calories as the engine that PREDICTS fat loss;
measure RESULTS in whatever metric the client prefers; where possible learn each client's personal
conversion from their own data (same least-squares regression as `weightTrend`).

## Formula inventory (verified Jul 2026)

### Group 1 — tape measure ONLY (no scale, no height) ✅ THE CENTERPIECE

**Covert Bailey** (The Ultimate Fit or Fat, 1999). All measurements in INCHES at the widest point
(wrist at the narrowest). Accuracy ~±2% vs hydrostatic weighing for most people.

| Who | Body fat % = |
|---|---|
| Men ≤30 | waist + 0.5×hips − 3×forearm − wrist |
| Men >30 | waist + 0.5×hips − 2.7×forearm − wrist |
| Women ≤30 | hips + 0.8×thigh − 2×calf − wrist |
| Women >30 | hips + thigh − 2×calf − wrist |

Logic: waist/hips/thigh grow with fat; forearm/calf/wrist reflect frame+muscle; subtracting frame
from fat-prone areas ≈ body fat %. The ONLY method needing neither scale nor height → the formula
for scale-averse clients. Age+gender variants auto-selected from plan data.

### Group 2 — tape + height (no scale) ✅ THE CROSS-CHECK

**U.S. Navy method** (DoD fitness standard; most-validated circumference method). Inches, log₁₀:
- Men: BF% = 86.010×log₁₀(waist − neck) − 70.041×log₁₀(height) + 36.76
- Women: BF% = 163.205×log₁₀(waist + hips − neck) − 97.684×log₁₀(height) − 78.387
  (⚠️ the trailing constant is MINUS 78.387 — one web source printed "+", which yields ~187%
  for a typical woman; sanity-check any re-derivation with real numbers)

Height is already in every plan. Show Bailey + Navy side by side and AVERAGE them — smooths each
method's bias; more trustworthy than either alone.

### Group 3 — tape + weight ⚠️ keep in engine, don't headline

**YMCA:** BF% = [(4.15×waist − 0.082×weight − C) ÷ weight] × 100, C = 98.42 men / 76.76 women.
**Modified YMCA (women):** BF% = [(0.268×weight − 0.318×wrist + 0.157×waist + 0.245×hips −
0.434×forearm − 8.987) ÷ weight] × 100.
Needs the scale → useless for the scale-averse client, but a free extra estimate for clients who
do weigh. Low priority; can join the multi-method average later.

### Group 4 — BMI-based ❌ SKIP as a metric

Adult men BF% = 1.20×BMI − 0.23×age − 16.2; women − 5.4 (child variants exist). Derived FROM
weight (the scale in a costume) and least accurate (muscular clients read "fat"). BMI already
shows in the wizard; don't elevate it.

### Group 5 — caliper/skinfold (Jackson/Pollock 3/4/7, Parrillo, Durnin/Womersley) 🅿️ PARKED (v2)

Not client-self-serve. BUT a trainer-side "caliper entry" (trainers own calipers, take skinfolds
at check-ins) would replace the paper card — differentiator vs Trainerize. Phase-2; pull exact
Jackson/Pollock coefficients when building.

### Group 6 — derivatives (the system layer) ✅ BUILD

1. **Fat mass** = BF% × weight · **Lean mass** = weight − fat mass
2. **Bailey goal weight** = lean mass ÷ (1 − target BF%). Example: 200 lbs @30% → 140 lean →
   at 20% target: 140 ÷ 0.80 = 175 lbs. A physiologically derived goal instead of a guess; plugs
   into the existing calories-to-goal ETA math. (Scale-averse client weighs ONCE at start — or
   trainer records it — then lives on tape trends; the goal is re-expressed as a BF% target.)
3. **Waist-to-height ratio (WHtR)** = waist ÷ height. Validated health flag: >0.5 = elevated
   risk; goal = get under 0.5. Scale-free, reframes success as health not vanity.

### Honest limitations (say them in-app)

- All circumference methods drift a few % for very muscular / very lean people. Absolute number
  = estimate ±2%; the TREND is rock solid — coach on the trend.
- Rule-of-thumb "≈1 inch of waist per ~8 lbs fat" varies ~5–12 lbs/person; prefer the client's
  own learned ratio (regression) over the universal number.

## Build plan

**v1 (build now):** log 7 tape measurements (waist, hips, neck, thigh, calf, forearm, wrist —
any subset), dated, replace-by-date like check-ins, stored on the plan (`data.measurements[]` —
rides the existing save/live-sync). Auto-compute Bailey + Navy + average + WHtR from whatever
fields exist. Trend chart (reuse ProgressChart) + history list with delete. Surfaced on
ClientHome + Results. Client picks a primary metric.

**v1.5 (with v1):** Bailey goal-weight-from-lean-mass shown when weight+BF% known, one-tap "use
as goal weight" (writes goalWeight; goalBodyFatPct field already exists — S72/S77). AI tools:
`log_measurements` + `get_measurements` (server mirrors the formulas; same access model as every
tool; deploy ALL FOUR AI fns — aitools.js is shared).

**v2 (parked):** trainer caliper entry (Jackson/Pollock), personal learned lbs-per-inch ratios,
YMCA in the multi-method average, progress photos.

Sources: owlcalculator.com/health/body-fat-calculator (full coefficient set),
corahealth.app Bailey method, fat2fittools.com/tools/cbbf, aleanlife.com/body-fat-calculator
(method list), The Ultimate Fit or Fat (Covert Bailey, 1999).
