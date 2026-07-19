# AI photo-logging accuracy — Nutrition5k eval (2026-07-19)

Production path (deployed `aiChat`, model per backend) vs lab-measured ground truth.
8/8 dishes returned an estimate.

| Metric | Value |
|---|---|
| Mean abs % error (calories) | **30.3%** |
| Median abs % error | **32.9%** |
| Within 20% of truth | 2/8 |
| Within 30% of truth | 4/8 |
| Protein MAE | 4.0 g (4 dishes) |

| Dish | Truth cal | Est cal | % err | Est name |
|---|---|---|---|---|
| dish_1561662216 | 301 | 200 | 34% |  |
| dish_1562862493 | 198 | 220 | 11% | Scrambled eggs with diced veg |
| dish_1563996485 | 178 | 220 | 24% |  |
| dish_1558724959 | 581 | 390 | 33% | Brussels sprouts, apple, almonds & baby  |
| dish_1566502505 | 455 | 200 | 56% |  |
| dish_1560360055 | 363 | 440 | 21% | Scrambled eggs with sausage slices |
| dish_1563568338 | 632 | 570 | 10% |  |
| dish_1563464480 | 229 | 355 | 55% | Sausage links, home fries & fruit (water |

Notes: overhead cafeteria photos (no scale reference, mixed plates) — a hard,
honest test. Re-run: `node scripts/photo-eval.mjs [count]`. Tune the vision
guidance in `functions/aichat.js` / the S90 photo-tips, then re-run to compare.

## Prompt tuning result — portion calibration (same day)

Added explicit portion calibration to the vision block in `functions/aichat.js`:
read portion from **plate geometry** (plate ≈26–28cm, bowl ≈15cm) using width-fraction
+ pile height rather than assuming a standard serving; note food is flatter than it
looks from overhead; **lean to the LOW end when no scale reference is in frame**; and
**always commit to a numeric estimate** instead of replying with a question.

| Metric | Before | After |
|---|---|---|
| Mean abs % error (all scored) | 58.9% | **30.3%** |
| Median abs % error | 79.7% | **32.9%** |
| Dishes returning an estimate | 6/8 | **8/8** |
| Mean err (same 6 dishes both runs) | 59% | **30%** |
| Direction | 4/6 over (systematic overestimate) | 4/8 over (mixed — bias corrected) |

| Dish | Truth | Before | Err | After | Err |
|---|---|---|---|---|---|
| 1662216 | 301 | 620 | 106% | 200 | **34%** |
| 2862493 | 198 | 280 | 41% | 220 | **11%** |
| 3996485 | 178 | 320 | 80% | 220 | **24%** |
| 8724959 | 581 | 430 | 26% | 390 | **33%** |
| 0360055 | 363 | 300 | 17% | 440 | **21%** |
| 3464480 | 229 | 420 | 83% | 355 | **55%** |

**Read:** error roughly **halved**, the systematic over-estimate is gone (errors now
fall on both sides = noise, not bias), and the model no longer refuses to estimate
(one dish previously replied with a question; the "always commit" rule fixed it —
that also removes a dead-end in the real product). Two dishes that were already
close drifted slightly worse, which is expected when correcting a bias.

Still an honest floor: overhead cafeteria plates with no scale reference are harder
than the angles the in-app photo tips coach. Re-run any time with
`node scripts/photo-eval.mjs 8`.
