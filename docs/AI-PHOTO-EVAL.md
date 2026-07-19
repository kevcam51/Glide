# AI photo-logging accuracy — Nutrition5k eval (2026-07-19)

Production path (deployed `aiChat`, model per backend) vs lab-measured ground truth.
6/8 dishes returned an estimate.

| Metric | Value |
|---|---|
| Mean abs % error (calories) | **58.9%** |
| Median abs % error | **79.7%** |
| Within 20% of truth | 1/6 |
| Within 30% of truth | 2/6 |
| Protein MAE | 5.9 g (4 dishes) |

| Dish | Truth cal | Est cal | % err | Est name |
|---|---|---|---|---|
| dish_1561662216 | 301 | 620 | 106% | Grilled pork belly, brown rice & mixed g |
| dish_1562862493 | 198 | 280 | 41% | Scrambled eggs with paprika/veg (3 eggs, |
| dish_1563996485 | 178 | 320 | 80% | Arugula & mixed greens salad with roaste |
| dish_1558724959 | 581 | 430 | 26% |  |
| dish_1566502505 | 455 | — | error: fetch failed | |
| dish_1560360055 | 363 | 300 | 17% |  |
| dish_1563568338 | 632 | — | error: no estimate in reply | |
| dish_1563464480 | 229 | 420 | 83% | Bacon, home fries & fruit salad |

Notes: overhead cafeteria photos (no scale reference, mixed plates) — a hard,
honest test. Re-run: `node scripts/photo-eval.mjs [count]`. Tune the vision
guidance in `functions/aichat.js` / the S90 photo-tips, then re-run to compare.

## Baseline analysis (first run — the headline finding)

**The error is not random: it's a systematic OVERESTIMATE on small plates.**
4 of 6 scored dishes were over-called (620 vs 301, 280 vs 198, 320 vs 178,
420 vs 229) — the model identifies the FOOD well (pork belly + rice + salad,
scrambled eggs, bacon + home fries were all correct reads) but assumes
standard restaurant/home portions, while Nutrition5k plates are small
cafeteria portions (e.g. 193 g total for that 301-cal plate).

**Concrete tuning lever:** the vision guidance (functions/aichat.js photo
block + the S90 photo-tips) should calibrate portion size from plate
geometry — "estimate the FRACTION of a standard plate covered and the pile
height; food often covers less of the plate than it appears" — and lean
low when no scale reference is visible. Re-run this harness after the prompt
change to measure the delta (needs a functions deploy).

Caveats: n=6 scored (1 transient fetch failure, 1 reply asked a question
instead of estimating — itself a finding: the prompt should always commit to
an estimate when asked). Overhead-only camera angle is harder than the
user-guided angles the in-app photo tips coach. Treat this as the honest
floor, not the ceiling.
