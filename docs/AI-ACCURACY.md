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

## ⚖️ VERDICT (S92 round 2): the food-DB (search_food) is NOT worth its token cost — retire it
Kevin's question: does the extra precision actually change accuracy, or do users just burn usage for
nothing? Tested the cases Pro is SUPPOSED to help (store-brand, obscure, restaurant):
- **Store-brand (Kirkland Signature protein bar):** free estimate **190** vs label 190 = perfect. The
  food DB returned **184** — *worse* than the estimate. The model knows even Costco store brands.
- **Restaurant (Chipotle chicken bowl / Chipotle white rice):** **NOT FOUND** in the DB at all → Pro
  falls back to estimate. Restaurant items simply aren't in USDA/OFF as composed meals.
- Combined with round 1 (6 common brands ~98% accurate; Barebells not in DB): **across every category —
  common, store-brand, obscure, restaurant — the free estimate is ~98% accurate and the DB is either
  absent, crowd-sourced-and-drifting, or LESS accurate than the estimate**, at **2–2.5× the tokens**.

**Recommendation (data-backed):**
1. **Retire `search_food` as a routine behavior** — it's a pure token sink (2–2.5× cost, ≤0 accuracy
   gain) and fails exactly where it should help (restaurants). Users would "run out faster for no
   reason" (Kevin's exact concern — confirmed). Keep the code but stop routing to it (or hard-remove).
2. **Barcode scanning IS the real exact-food feature** — a direct label lookup (scan → exact values),
   ~no AI tokens, genuinely exact. Make THIS the packaged-food precision story, not the DB.
3. **Real precision investment = PORTION** (grams — the #1 error source), which is prompt/UX, not a DB.
4. **Do NOT build the restaurant-menu DB integration** — the model already estimates restaurants well
   and the free DBs don't have them. (Reverses the earlier "build restaurant menus next" idea — saved.)
5. **Reconsider the "Precision tracking" Pro toggle** — reframe around barcode + portion, or drop it.
   (This partly reverses the S92 Pro-repositioning slice — the honest data changed the answer.)

## Pro repositioning — SHIPPED slice + token cost (S92)
Pro is repositioned from "more accurate calories" (false — free estimate is ~98%) to **"Precision
tracking"**: verified DB values (USDA-first), barcode (exact), restaurant/chain items, and portion help.
Shipped this session: **USDA-first ranking** in `search_food` (was OFF-first — OFF drifts ±5%); Pro-mode
prompt now enforces **portion rigor** (state/ask the assumed serving) and **invisible-calorie awareness**
(oils/butter/dressings); toggle relabeled "Precision tracking" + honest upsell copy. **Still to build
(next):** a dedicated **restaurant/chain-menu source** (USDA/OFF cover chains only partially), photo
**reference-object scaling**, and **recipe multi-ingredient breakdown**.

**Token cost of Precision mode (measured base + overhead):**
- Non-Pro food log: **~2,300 warm / ~8,700 cold** (measured).
- Pro/Precision food log adds: search_food tool in the prefix (**~200 tok on every message**) + a
  DB search round when it looks a food up (**~1–3k**) + occasionally a portion-clarify round (~1–2k)
  → a Pro food log ≈ **~4,000–6,000 tokens (~2–2.5× a non-Pro estimate)**.
- Daily impact by tier (food logs before the cap): **Premium 25k ≈ 10 non-Pro → ~5 Pro** (Pro roughly
  halves it — a reason Pro pairs with paid tiers); **Elite 150k ≈ 25–35 Pro logs**; **Coach 100k ≈
  16–25 Pro logs**. So Precision costs real tokens — fine on Elite/Apex, tight on Premium (expected).

## Scheduled / autonomous AI tasks + user workflows (Kevin's big idea, S92)
Feasible now (Glide already runs onSchedule fns: trainerizeAutoSync, trialReminders). Vision: users build
their OWN automations that fire on a schedule.

**Engine spec (dedicated build):**
- Storage `caliq-workflows` per user = `[{id, name, schedule (preset: daily/weekly/cron), prompt,
  delivery: feed|push|email, enabled, lastRunAt}]`.
- A **dispatcher** `onSchedule` fn (hourly) scans enabled workflows, runs each due one through the
  existing AI + tools (same runTool infra), meters `spent` against the user's `aiUsage.tokens`, and
  delivers the result to the notification feed / push / email. Over budget → skip + notify.
- UI: an "Automations" screen to create/edit/toggle (gated to Elite+). Examples: client "every Sunday
  6pm summarize my week + set next week's targets"; trainer "every morning brief me on who's off track".

**Token model (every run is a COLD message — no warm-cache reuse across hours/days):**
- Client run ≈ 7.4k prefix + task/tools ~3–8k = **~10–15k tokens/run**; trainer (roster) run ≈ 10k
  prefix + ~5–10k = **~15–25k/run**.
- One DAILY workflow ≈ client 360k/mo (**~$1.8/mo**) · trainer 600k/mo (**~$3/mo**).
- Metered from the daily budget, a daily workflow eats **~12–20k of the cap before the user even
  chats** → too much for Premium/Coach base; comfortable on Elite+.

**Tier gating (Kevin: higher tiers only; consider a 4th tier for overboard users):**
| Tier | Daily budget | Scheduled workflows |
|---|---|---|
| Premium / Coach | 25k / 100k | none (too tight — one run halves/eats the cap) |
| **Elite** (client 150k) | 150k | 1 daily workflow |
| **Coach Elite** (200k) | 200k | 1–2 |
| **Apex** (client 250k) | 250k | up to 3 |
| **Coach Apex** (400k) | 400k | up to 5 |
| **4th tier — "Autopilot"** (overboard users) | 600k+ | many + optionally a SEPARATE workflow allowance |

The **4th "Autopilot" tier** is the home for users who want a fleet of background automations — price it
above Apex (rough: client ~$79 / trainer ~$199) with a big budget; or give workflows their own metered
allowance so heavy chat + heavy automation don't compete. This is the natural top-of-ladder differentiator
— "the app works for you while you sleep." Model each workflow's monthly cost (above) before launch.

## Tier naming (Kevin: "Max/Ultra remind me of iPhone")
Options to differentiate from Apple's Pro/Max/Ultra (internal tier KEYS stay the same — display only):
- **A — Elite ladder:** Premium → Plus → **Elite** ; Coach → Coach Plus → **Coach Elite**.
- **B — Apex (aspirational, fitness-y):** Premium → Elite → **Apex** ; Coach → Coach Elite → **Coach Apex**.
- **C — Glidna flight metaphor:** Glide → Soar → **Apex/Summit** (distinctive, on-brand, but less literal).
Note: "Pro" is already used for the precise-food-data feature — if a tier uses "Pro", rename that feature
(e.g. "Precise mode") to avoid collision. Recommendation: **B (…/Elite/Apex + Coach …/Elite/Apex)** — clean,
non-Apple, aspirational, and "Apex" reads as peak-performance for the heavy-user tier.
