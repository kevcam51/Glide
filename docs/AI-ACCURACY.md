# AI Food Accuracy — Pro (food DB) vs non-Pro (estimate) + roadmap (S92)

## The test (S92, live)
Ran 6 branded foods as meal-logs on a NON-Pro account (real AI estimate = "Pro-OFF"), captured the
estimate card, and compared to published label values. "Pro-ON" = what `search_food` (USDA + Open
Food Facts) returns, checked directly against the same DBs. Token cost from `aiUsage` logs.

| Food (serving) | Label cal / P/C/F | Pro-OFF estimate | Cal error | Pro-ON (DB) result |
|---|---|---|---|---|
| Quest Choc-Chip bar (60g) | 200 / 21/22/9 | 190 / 21/25/8 | −5% | OFF: ~190 cal (≈label, crowd-sourced) |
| Clif Bar Choc Chip (68g) | 260 / 10/44/5 | 270 / 11/44/6 | +4% | OFF: ~250 cal (−4% vs label) |
| Premier Protein shake (11oz) | 160 / 30/4/3 | 160 / 30/5/3 | 0% | in DB, exact |
| Chobani plain nonfat (5.3oz) | 90 / 16/6/0 | 90 / 16/6/0 | 0% | in DB, exact |
| Nature Valley O&H (2 bars) | 190 / 4/29/7 | 190 / 4/29/7 | 0% | in DB, exact |
| Barebells Salty Peanut (55g) | 201 / 20/16/9 | 200 / 20/20/7 | 0% | **NOT in DB → falls back to estimate** |

## Findings (honest, and a little surprising)
1. **The free AI estimate is already ~98–99% accurate on CALORIES for branded foods** — avg calorie
   error across the 6 was **~1.5%**. These products are in the model's training data, so it just knows
   them. Protein was near-perfect throughout.
2. **The real estimate weakness is the CARB/FAT SPLIT**, not calories — Quest (+14% carb) and Barebells
   (+25% carb, −22% fat) show the model guessing the macro split of less-common items. Calories still right.
3. **The food DB (Pro-ON) is NOT reliably better for common foods** — Open Food Facts is crowd-sourced
   and was itself **±4–5%** vs the label (Quest 190 vs 200, Clif 250 vs 260), i.e. *no better than the
   estimate*. USDA entries are authoritative and exact, but OFF (the fallback) varies.
4. **Coverage gaps:** Barebells wasn't in the DB at all → Pro silently falls back to the estimate. So
   for exactly the obscure products where Pro *should* help most, it often can't.
5. **Token cost:** Pro-OFF meal-log measured **~2,300 warm / ~8,700 cold**. Pro-ON adds the search_food
   tool to the prefix (~200 tok on EVERY message) **plus a search round (~1–3k tok) whenever it looks a
   food up** → roughly **+50–100% tokens on a branded-food log**, for a ~1–2 point calorie-accuracy gain.

## Conclusion: Pro's food DB is oversold as an "accuracy" feature
For **common** branded foods the free estimate already wins on cost and ties on accuracy. Pro's food DB
genuinely helps only for: (a) **exact macro splits** when the item is in **USDA** specifically, (b)
**barcode scanning** (truly exact — already built), and (c) obscure products that happen to be in the DB.
**Reposition Pro** around *guaranteed exactness / barcode / macro precision*, not "more accurate calories."

## The BIGGER accuracy wins (Kevin — address these; higher ROI than the food DB)
Ranked by real-world impact:
1. **Portion estimation** — the #1 real error source. People (and photos) misjudge grams far more than
   the model misjudges a known food's per-100g values. Wins: reference-object scaling in photos ("card
   for scale"), portion clarifying-questions, common-portion presets. This dwarfs branded-food DB gains.
2. **Restaurant / chain-menu nutrition** — a real gap (Chipotle, Chick-fil-A, Starbucks, Panera…). A
   chain-menu source makes "burrito bowl with chicken, rice, beans" exact instead of estimated. High value.
3. **USDA-first, OFF-second** — prefer authoritative USDA data; only fall back to crowd-sourced OFF.
   Cheap change to `search_food` ranking; improves Pro's actual precision.
4. **Barcode → exact** — already built; surface/push it harder as THE exact path for packaged foods.
5. **Body composition** — Bailey/Navy tape body-fat (shipped S92) is the non-food accuracy analog.
6. **Recipe / multi-ingredient breakdown** — parse a home recipe into ingredients × amounts for a real
   total instead of one gestalt guess.
7. **Cooking-method & prep awareness** — oils/butter/dressing are invisible in photos; prompt for them
   (the meal-photo tips already nudge this — extend it).

## Scheduled / autonomous AI tasks + user workflows (Kevin's big idea, S92)
Feasible now (Glide already runs onSchedule fns). Vision: users build their OWN workflows that fire on a
schedule (e.g. "every Sunday 6pm, summarize my week + suggest next week's targets"; trainer "every
morning, brief me on who's off track"). Build path: a workflow = {trigger schedule, a saved prompt,
delivery (feed/push/email)}; a dispatcher onSchedule fn runs due workflows through the existing AI+tools.
**PRICING CONCERN (Kevin, real):** every scheduled run is a COLD message (~10–15k tokens) — no warm cache
reuse across hours/days. So autonomous workflows are the *most expensive* usage pattern. Guardrails:
- Meter scheduled runs against the user's daily budget (a heavy workflow user → naturally routed to Ultra).
- Cap workflows-per-tier (e.g. Max: 1 scheduled workflow; Ultra: 3–5; a future "Ultra+/Autopilot" tier: more).
- This is the natural **Ultra / Ultra+ differentiator** — the app working for you while you sleep.
- Model the cost per workflow before launch: 1 daily cold run ≈ 10–15k/day ≈ 300–450k/mo ≈ $1.5–2.5/mo each.

## Tier naming (Kevin: "Max/Ultra remind me of iPhone")
Options to differentiate from Apple's Pro/Max/Ultra (internal tier KEYS stay the same — display only):
- **A — Elite ladder:** Premium → Plus → **Elite** ; Coach → Coach Plus → **Coach Elite**.
- **B — Apex (aspirational, fitness-y):** Premium → Elite → **Apex** ; Coach → Coach Elite → **Coach Apex**.
- **C — Glidna flight metaphor:** Glide → Soar → **Apex/Summit** (distinctive, on-brand, but less literal).
Note: "Pro" is already used for the precise-food-data feature — if a tier uses "Pro", rename that feature
(e.g. "Precise mode") to avoid collision. Recommendation: **B (…/Elite/Apex + Coach …/Elite/Apex)** — clean,
non-Apple, aspirational, and "Apex" reads as peak-performance for the heavy-user tier.
