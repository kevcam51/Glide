# Glide — Pricing & Unit-Cost Model (Session 89)

_Kevin's working prices (S89): **Glide Coach $49/mo** (trainers, flat) · **Glide Premium
$9.99/mo** (clients). Confirmed as "fair" pending the profitability check below. Update this doc
when prices or the cost structure change. Stripe products are created by lookup_key
(`glide_coach_monthly` / `glide_premium_monthly`) — changing a price = new price with
`transfer_lookup_key`, or edit `PRICE_CENTS` in functions/billing.js before first live use._

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

## "Unlimited AI" tier (Kevin's S89c idea — upcharge above Pro; caps NOT reduced per his call)

Measured unit: **~1¢ per chat exchange** (~1.5k budget tokens each, warm cache); photo log ≈ 1.5–2¢.
Current caps for scale: client 25k/day ≈ ~16 exchanges/day; trainer 60k ≈ ~40/day.

**What an uncapped user costs per month (every day, all month):**
| Usage pattern | Msgs/day | Cost/mo |
|---|---|---|
| Typical engaged user | 5–10 | $1.50–3 |
| Heavy daily user | 25 | ~$11 |
| Power user | 50 | ~$23 |
| Obsessive human ceiling | 150 | ~$68 |
| Literally-chatting-all-day human | 300 | ~$135 |
| **Scripted abuse (true no-limit)** | ∞ | **unbounded — $100s+/day possible** |

**Key design rule: "unlimited" must mean unlimited-for-humans, never unlimited-for-scripts.**
Every industry "unlimited" plan carries a fair-use backstop. Recommended: an INVISIBLE backstop
tier in BUDGETS (aichat.js) at **150k tokens/day (≈100 exchanges — no real human hits it in
normal use)** → worst-case COGS ≈ **$26/mo**; realistic unlimited subscriber costs $5–15/mo.
Optionally add a per-minute rate limit later for script protection.

**Recommended prices:**
- **Client Unlimited: $29.99/mo** (or an add-on: Premium + $15). Safe vs the $26 backstop
  ceiling; 50–85% margin on realistic usage; clean ladder Trial → Premium $9.99–14.99 →
  Unlimited $29.99.
- **Coach Unlimited: $79/mo** (vs $49 base; backstop 200k/day → ceiling ~$34/mo, margin ≥ $45).
  Pairs naturally with a bundled-client-seats story at this tier.

**Implementation cost when Kevin says go:** one new `subscriptionTier`/entitlement value + a
BUDGETS entry + a second Stripe price per role (lookup_key) + tier picker on the checkout —
small build; the budget system already does the enforcement.

## Competitive anchors (knowledge as of early 2026 — verify with a research pass before launch)

- MyFitnessPal Premium ≈ $19.99/mo ($79.99/yr) — no AI coach, no trainer.
- Trainerize (coach-side) ≈ $5–250/mo tiered by client count; Studio tiers ~$100+.
- TrueCoach / Everfit coach plans ≈ $20–150/mo by roster size.
- AI photo-calorie apps (Cal AI etc.) ≈ $3–10/mo — photo logging only, no coach platform.
→ $49 coach flat and $9.99 client premium sit comfortably mid-market with a stronger feature set.
docs/ECOSYSTEM.md queues a full verified pricing-research pass; run it before setting LIVE prices.
