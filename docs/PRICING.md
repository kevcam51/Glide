# Glide — Pricing & Unit-Cost Model (Session 89)

_**DECIDED & IMPLEMENTED (S89c — "run with all of these"):** the full recommended menu is live in
test mode and E2E-verified (8/8 checkout sessions audited against Stripe):
**Glide Premium $14.99/mo · $119.99/yr (33% off)** | **Glide Max $29.99/mo · $299.99/yr** |
**Glide Coach $49/mo · $490/yr** | **Coach Max $79/mo · $790/yr** (annual = "2 months free").
Implementation: `CATALOG` in functions/billing.js (lookup_keys `glide_{plan}_{monthly|annual}`;
amount changes self-heal via `transfer_lookup_key`); webhook stamps `profile.subscriptionTier`
(premium|max|coach|coach_max); Max budgets = `clientMax` 150k / `trainerMax` 200k tokens/day in
aichat.js BUDGETS; the frontend `PlanPicker` (both upgrade entry points) sells tier + interval.
**Remaining for real money:** live Stripe key swap + live webhook + liability hygiene below.
Bundled client seats: direction affirmed, build when the first outside trainer signs up._

## The one structural guarantee

**Glide cannot cost-run-away per user.** The only meaningful variable cost is the AI layer, and
every user has a HARD daily token budget enforced server-side (`functions/aichat.js` BUDGETS):
trial 10k / client 25k / assisted 40k / trainer 60k tokens/day. Budget counts input + output +
cache-writes; cache READS bill at ~10% and are excluded (S67). Photos (vision tokens) count
inside the same budget. So worst-case COGS per user is a bounded number, not a tail risk.

## Measured anchor (S67, real production traffic)

A 3-message tool-heavy batch (≈6 API rounds, warm cache): input 3,988 · output 742 · cacheRead
13,908 tokens → **2.7¢**, consuming ~4,730 budget tokens. → **≈ $0.0057 per 1,000 budget tokens**
(cache-read cost riding along included). Model `claude-sonnet-4-6` at $3/M input · $15/M output ·
$0.30/M cache-read · $3.75/M cache-write (5-min TTL).

## Worst-case monthly cost per user (maxes the cap EVERY day, 30/30 days)

| Cost line | Client Premium ($9.99) | Trainer Coach ($49) |
|---|---|---|
| AI chat/photo (typical mix, S67 ratios) | 25k/day → **~$4.35** | 60k/day → **~$10.40** |
| AI absolute ceiling (output-heavy 50/50 mix) | **~$7.40** | **~$17.80** |
| Voice transcription (Groq $0.00185/min primary; ~15×1-min/day) | ~$0.85 (OpenAI fallback: ~$2.70) | ~$0.85 |
| Firestore reads/writes (post-S85 range queries; free tier absorbs most) | ~$0.15 | ~$0.25 |
| Cloud Functions compute + invocations | pennies | pennies |
| Stripe fee (2.9% + $0.30) | $0.59 | $1.72 |
| **Worst-case total** | **~$6 (ceiling ~$11)** | **~$13 (ceiling ~$21)** |
| **Worst-case margin** | ~$4 (ceiling: ≈ break-even) | ~$36 / 73% (ceiling: ~$28 / 57%) |

**Realistic heavy user** (half the cap, ~half the days): client ≈ **$2–3.50/mo** (~70% margin);
trainer ≈ **$5–7/mo** (~87% margin). Median users cost far less.

## The one honest risk + the knobs

A client who is maximally output-heavy AND maxes the 25k cap all 30 days hits ~$11 — slightly
ABOVE $9.99. This requires deliberate abuse-like usage (the budget warning fires at 80% daily),
but "always profitable" means closing it. Pick one:
1. **Trim the client daily budget 25k → 18–20k** (ceiling drops to ~$8–9; normal users never
   notice — S67 showed a whole multi-question session ≈ 4.7k) — one number in aichat.js BUDGETS.
2. **Price Glide Premium at $12.99–14.99** (still far under MyFitnessPal Premium ~$20 with fewer
   features than Glide's AI coach).
3. Accept it — the ceiling user is rare and still nearly break-even; the tier exists to convert.
Recommendation: **#1 now (free, invisible), revisit #2 at launch.**

## Trial cost (unpaid users)

Trial tier is capped 10k/day → **≤ ~$1.75/mo, realistically $0.30–1** per active trial (matches
the S67 estimate). That's the customer-acquisition cost of the 30-day trial; caching + the hard
cap keep it structurally bounded. Expired trials cost $0 (AI gate, S89b).

## Fixed monthly platform costs (not per-user)

| Item | Cost |
|---|---|
| Firebase Blaze base / Firestore / Functions at current scale | ~$1–3/mo (auto-sync ~$0.25) |
| Secret Manager (~12 secrets) | <$1/mo |
| Vercel | $0 (Hobby) — **note: commercial use officially wants Pro $20/mo**; decide at launch |
| Resend email | $0 (3k emails/mo free) → $20/mo at scale |
| Trainerize API | $0 (rides Kevin's existing Studio sub; 1000 req/min throttle, no per-call fee) |
| Custom domain (when bought) | ~$15–50/yr |
| **Floor** | **~$2–45/mo → covered by the first 1–3 subscribers** |

## Break-even summary

- **Trainer plan is safely profitable at $49 under every scenario** (worst ceiling ~$21 cost).
- **Client plan is profitable at $9.99 in all realistic scenarios**; the theoretical ceiling
  (~$11) is closed by trimming the client budget to ~18–20k/day (recommended) or pricing ≥$12.99.
- Fixed costs are trivially covered by 1–3 paying users.
- **Scaling math:** costs scale linearly per user with margin baked in per tier — 100 clients +
  10 trainers at worst-case usage ≈ $730/mo cost vs $1,489/mo revenue; realistic ≈ $300 cost.

## Levers if costs ever bite (in order of pain)

1. Daily budget numbers (BUDGETS in aichat.js) — instant, per-tier.
2. Prompt-cache coverage is already maximized (S67); keep new system-prompt text INSIDE the
   cached prefix (knowledge.js pattern).
3. `MAX_TOOL_ROUNDS` (5) caps runaway tool loops.
4. Model swap is one line (`MODEL` in aichat.js) — a cheaper model tier exists (Haiku ~1/3 the
   price) but Kevin's standing decision (memory: ai-model-tier-decision) is to stay on the
   Sonnet tier for quality and monetize features, not downgrade.
5. Voice: cap already 60s/recording; could count voice-minutes against the AI budget later.

## "Max" tier — the honest high-allowance upcharge (S89c; renamed from "Unlimited" per Kevin)

**Naming decision (Kevin, S89c): NO "unlimited" branding — he won't sell a capped thing as
uncapped.** The tier is **Glide Max / Coach Max**: a PUBLISHED allowance (~100 AI conversations
/day, ~6× Premium) plus a standing promise — "if you ever hit the ceiling, tell us and we'll
raise it." Transparency is the brand play. **Liability hygiene before live mode:** allowance
stated on the pricing page (not buried), fair-use clause in the ToS, never the bare word
"unlimited" in marketing, and a one-hour attorney review of the ToS (subscriptions + health
data).

Measured unit: **~1¢ per chat exchange** (~1.5k budget tokens each, warm cache); photo log ≈ 1.5–2¢.
Current caps for scale: client 25k/day ≈ ~16 exchanges/day; trainer 60k ≈ ~40/day.

**Ceiling-boost policy (S90, LIVE — `requestBudgetBoost`):** Max users at their daily cap can
request more in-chat and are instantly approved: **+50% of base per boost; Coach Max gets 2
boosts/day, client Max gets 1** (Kevin's call + the margin math: a Coach Max maxing 400k every
day ≈ $68/mo vs $79 — still profitable; 2 boosts on client Max would put an every-day-maxer at
~$51 vs $29.99 — underwater, hence 1). Guards: only granted at ≥80% of the current effective
cap (no banking), boosts expire at the daily reset, and every grant is counted in
`users/{uid}/aiUsage/meta` → the admin dashboard flags 3+ (⚑, visibility only). Chronic
hitters = a conversation + a hand-raised standing limit, never an automatic cost leak.

**What an uncapped user costs per month (every day, all month):**
| Usage pattern | Msgs/day | Cost/mo |
|---|---|---|
| Typical engaged user | 5–10 | $1.50–3 |
| Heavy daily user | 25 | ~$11 |
| Power user | 50 | ~$23 |
| Obsessive human ceiling | 150 | ~$68 |
| Literally-chatting-all-day human | 300 | ~$135 |
| **Scripted abuse (true no-limit)** | ∞ | **unbounded — $100s+/day possible** |

**Design rule: generous-for-humans, closed-to-scripts.** Recommended: a backstop
tier in BUDGETS (aichat.js) at **150k tokens/day (≈100 exchanges — no real human hits it in
normal use — and it's DISCLOSED, not hidden)** → worst-case COGS ≈ **$26/mo**; realistic Max
subscriber costs $5–15/mo.
Optionally add a per-minute rate limit later for script protection.

**Recommended prices:**
- **Glide Max (client): $29.99/mo** (or an add-on: Premium + $15). Safe vs the $26 backstop
  ceiling; 50–85% margin on realistic usage; clean ladder Trial → Premium $9.99–14.99 →
  Max $29.99.
- **Coach Max: $79/mo** (vs $49 base; backstop 200k/day → ceiling ~$34/mo, margin ≥ $45).
  Pairs naturally with a bundled-client-seats story at this tier.

**"Glide Ultra" — the tier above Max (scoped S90, DATA-TRIGGERED, not built):** Kevin asked
whether Max should cost more or a higher tier should exist for heavy users. Decision shape:
KEEP Max at $29.99 (the ceiling loss is theoretical; realistic margin 50–85%; whales are a
flag-and-handle problem). Ship **Ultra ≈ $49.99/mo · 300k tokens/day (~200 conversations,
2× Max) · 2 boosts/day** WHEN the admin dashboard's ⚑ boost flags show 2–3 users repeatedly
boosting — that's proven demand from people already paying $29.99. Build is small (one BUDGETS
entry + one Stripe price by lookup_key + a PlanPicker row + the upsell popup off the
"already boosted today" message). Ceiling cost ~$51/mo = break-even at the absolute theoretical
max; realistic $10–25. Name deliberately avoids "unlimited" and "Max+".

**Implementation cost when Kevin says go:** one new `subscriptionTier`/entitlement value + a
BUDGETS entry + a second Stripe price per role (lookup_key) + tier picker on the checkout —
small build; the budget system already does the enforcement.

## Annual pricing (S89c)

Convention: consumer tiers get a deep discount (drives the impulse "might as well" upgrade —
MFP sells $79.99/yr vs $19.99/mo, a 67% cut); coach/business tiers get "2 months free" (~17%).
Annual also saves Stripe fees (one 2.9%+30¢ charge instead of 12 ≈ $3.30/yr saved per client sub)
and annual subscribers churn dramatically less. Stripe build: one extra `interval: "year"` price
per product — trivial.

| Plan | Monthly | **Annual** | Effective/mo | Discount | Worst-case COGS/yr | Worst / realistic profit per annual sub |
|---|---|---|---|---|---|---|
| Client Premium | $14.99 | **$119.99** | $10.00 | 33% | ~$72 (capped tier) | ~$45 / **$85–100** |
| Client Premium (if $9.99) | $9.99 | **$79.99** | $6.67 | 33% | ~$72 | ~breakeven / **$45–60** |
| Glide Max (client) | $29.99 | **$299.99** ("2 months free") | $25.00 | 17% | ~$312 ceiling (150k/day backstop) | ≈ breakeven at ceiling / **$140–240** |
| Coach | $49 | **$490** ("2 months free") | $40.83 | 17% | ~$250 | ~$240 / **$400–430** |
| Coach Max | $79 | **$790** ("2 months free") | $65.83 | 17% | ~$410 (200k/day backstop) | ~$380 / **$600–700** |

Notes: "worst case" = a user maxing their ceiling EVERY day for 365 days — theoretical; the
realistic column is what to plan on. Max annual deliberately keeps the shallow 17% discount
because its cost ceiling is real; the fat consumer discount lives on Premium where margins are
huge. Don't discount Max deeper than ~17% without lowering its fair-use backstop.

**What the revenue looks like — per 10 ANNUAL subscribers (cash collected up front):**
| Tier | Revenue/yr | Realistic cost | Profit |
|---|---|---|---|
| 10× Premium ($119.99) | $1,200 | $240–480 | **~$720–960** |
| 10× Glide Max ($299.99) | $3,000 | $600–1,800 | **~$1,200–2,400** |
| 10× Coach ($490) | $4,900 | $600–1,000 | **~$3,900–4,300** |
| 10× Coach Max ($790) | $7,900 | $1,000–2,000 | **~$5,900–6,900** |

**Illustrative year-1 (Smooth Training scale): 5 coaches annual + 35 Premium annual + 15
Max annual ≈ $11,150 ARR, ~$2–3k costs → ~$8–9k profit — collected up front.**

## Competitive anchors — VERIFIED July 8, 2026 (fetched from each vendor's live pricing page)

**Client-side (vs Glide Premium $14.99 / Max $29.99):**
- **MyFitnessPal:** Free / **Premium $19.99/mo · $79.99/yr** / Premium+ $24.99/mo · $99.99/yr
  (Premium+ = Premium + Meal Planner). ⚠️ **MFP launched an AI "Nutrition Coach" (~April 2026)** —
  included in Premium & Premium+, but it's **read-only**: it explicitly *cannot log food, cannot
  edit goals, has no weight history*, is iOS-only/English/6 countries, nutrition-topics only.
  This VALIDATES the AI-coach category at the $19.99 price point — and Glide's AI is a full tier
  beyond it (logs meals by text/photo/voice/barcode, logs workouts & weigh-ins, edits targets,
  builds programs, connects to a real trainer) at $5/mo less.
- **Cal AI:** ~$9.99/mo or $29.99/yr (heavily A/B-tested paywall — $2.99/wk variants; family
  $59.99/yr; price hidden until after onboarding). Photo scanning only; no coach, no platform.
  Note their annual is aggressively cheap — the photo-only feature is commoditizing; Glide should
  never lead marketing with "photo calorie scanning" alone.

**Coach-side (vs Glide Coach $49 / Coach Max $79, unlimited clients):**
- **ABC Trainerize:** Basic free (1 client) / Grow $9/mo (2) / **Pro from $23/mo at 5 clients,
  price scales with roster to 200** / Studio Plus $248/mo/location / Enterprise custom. Add-ons
  stack: Advanced Nutrition Coaching **+$20–45/mo**, Video +$10, Stripe payments +$10 — a
  mid-size roster with nutrition easily runs $60–120/mo.
- **TrueCoach:** Starter $26.34/mo (5 clients) / **Standard $57.99/mo (20)** / Pro $136.99/mo
  (50) / custom above. Annual = 1–2 months free (same convention Glide uses).
- **Everfit:** free (5 clients) / **Pro from $19/mo, scales 5→300+** / Studio from $105/mo.
  Add-ons stack here too (meal plans +$39/mo, automation +$29/mo). Clients never pay Everfit —
  coach-funded only (the opposite of Glide's two-sided model).

**Read-through for Glide's decided menu:**
- **Coach $49 flat with no per-client scaling is the standout anchor** — TrueCoach charges $58
  for a 20-client cap and $137 at 50; Trainerize needs paid add-ons to match Glide's built-in
  nutrition + AI. Message it as "unlimited clients, nutrition + AI included, no add-on stacking."
- **Premium $14.99 undercuts MFP Premium by $5 with a strictly more capable AI** — MFP's own
  Coach launch is free marketing for the category; the counter-position writes itself.
- One honest gap: **MFP's annual ($79.99 ≈ $6.67/mo eff.) is cheaper than Glide's $119.99
  (≈$10/mo eff.)** — fine at launch (different value class), but if annual conversion lags,
  the first lever is a launch-window annual promo, not a list-price cut.
- Verified sources: myfitnesspal.com pricing/blog + support center (Coach article), trainerize.com/pricing,
  truecoach.co/pricing, everfit.io/pricing, Cal AI paywall roundups (dynamic pricing, no public page).
