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

## ⚠️ COLD-START CORRECTION (S92) — the S67 anchor above is the WARM case only

The S67 "2.7¢ / ~4,730 budget" number was a **warm-cache** batch (messages within 5 min, so the
big instruction+tools prefix rode along as a cheap cache-READ, excluded from budget). Real usage
is mostly COLD: meals are logged hours apart, so each one re-writes the full prefix at full price.

**Measured prefix size (S92 — client MEASURED from a live call, trainer calibrated to it):**
- **Client prefix ≈ 8,912 tokens** = tool defs **5,941** + system prompt 2,971 (27 tools)
- **Trainer prefix ≈ 12,300 tokens** = tool defs **8,950** + system prompt 3,380 (31 tools)
- → **the TOOL DEFINITIONS are ~⅔–¾ of the prefix** — the #1 shrink target.

A message is COLD if >5 min (Anthropic's cache TTL) since the last one. Meal-by-meal logging =
every message cold. The 1-hour cache extension does NOT fix this (meals are >1 hr apart).

**Corrected per-message economics:**

| Message | Our $ cost | Budget tokens |
|---|---|---|
| COLD client chat / meal-log | ~4–5¢ | ~11,000 |
| COLD trainer roster query (20+ clients) | ~8–10¢ | ~18,000 |
| WARM (within cache window) | ~1.5¢ | ~2,500 |

So a cold message is **3–4× a warm one** in both dollars and budget. Cold-adjusted personas:

| Persona | Cold msgs/day | Budget/day | Our cost/mo | Right tier | Margin |
|---|---|---|---|---|---|
| Casual client (1–2 chat logs, rest manual) | 2–3 | ~30k | $2–4 | Premium $14.99 | ✅ strong |
| Heavy client (logs every meal + Qs by chat) | 8–10 | ~100k | ~$13 | **Max $29.99** (blows Premium 25k) | ✅ ~55% |
| Active trainer, 20–30 clients across the day | 12–15 | ~180k | ~$25–30 | **Coach Max $79** (blows Coach 100k) | ✅ ~65% |

**Verdict:** the PRICES still hold (heaviest users cost $13–30 vs $30–79 tiers) because the per-tier
CAP routes heavy users up the ladder where the margin is — the cap is the margin guarantee. But the
caps are **mismatched to conversational reality**: trial 10k ≈ 1 cold message (broken); Premium 25k
≈ 2 cold chats/day (too stingy for chat-logging → forces Max). **Biggest lever = shrink the prefix**
(mostly the tool defs): 9k→~5.5k client / 12k→~8k trainer cuts EVERY cold message ~35–40%, ~doubling
experience-per-cap on every tier and cutting heavy-user cost (~$13→~$8 client, ~$28→~$18 trainer).
Quality-safe if we trim verbose wording only (not remove tools/rules) + test. See METRICS-PLAN-style
task: prefix-shrink plan.

**✅ SHIPPED S92 (from the above):** (1) **Trial budget 10k→50k** — one cold message no longer
maxes the trial; a reverse-trial user gets a genuinely full daily experience (worst-case trial cost
still ≤~$4 over 30 days). (2) **Coach base 60k→100k** — a heavy ~20-client trainer clears a normal
heavy day without hitting the cap. (3) **Prefix shrink** — client 8,912→~7,360 tok, trainer
12,332→~10,150 tok (**~17–18%**, not the hoped 35%: most of the prefix is irreducible STRUCTURE —
tool names/params/enums — and cutting further means removing abilities, which we won't do). Every
cold message is ~18% cheaper on every tier. Quality-preserved (trimmed wording only, regression-safe).

**✅ DECISION S92 — client-management AI stays in Coach; rely on the cap (Kevin).** Roster-wide
client-management (coach_summary etc.) is the biggest token cost, but the per-tier CAP already routes
heavy roster users from Coach ($49/100k) up to Coach Max ($79/200k) where the margin is — no feature
wall needed. Explicitly chose NOT to gate coach_summary to Max or strip client-mgmt from Coach (would
gut the Coach tier's value). Revisit only if real usage shows the cap isn't doing the job.

## Measured per-message economics + messages-per-tier (S92, LIVE prod data)

Purpose: reference data for deciding later whether to raise tier limits. **Per-message cost is
TIER-INDEPENDENT** — a message costs the same whether the account is trial, Premium, Coach, or Max;
the tier only sets the daily cap. So message-count-per-tier = per-message cost ÷ the tier's budget.

**Raw measured data points** (from `aiUsage` logs, aiChatStream, real prod calls; "spent" = the
budget-counted tokens = input + output + cacheWrite, cache-reads excluded):
- Trainer COLD, simple Q, 1 tool round: input 2290 · output 257 · cacheWrite 7698 → **spent 10,245**
- Trainer COLD, larger first turn: cacheWrite 10,390 → **spent 12,746**
- Trainer WARM, simple follow-up: **spent 1,075**
- Trainer WARM, 2 tool rounds (data read): cacheRead 15,396 → **spent 2,335**
- (Client per-message costs measured the same shape — cold ~9–11k, warm ~1–2.5k.)

**Per-message cost by type (measured, use for planning):**

| Message type | Budget tokens | Examples |
|---|---|---|
| COLD simple question (first of a session) | ~10,000–13,000 | "high-protein breakfast ideas?", "how do I structure a cut?" |
| COLD data/roster query (big tool result) | ~13,000–18,000 | "which clients need attention?", "what did I eat this week?" (cold) |
| WARM simple follow-up (≤5 min since last) | ~1,000 | "make it two burritos", quick clarifications |
| WARM with tool call | ~2,300–2,500 | mid-conversation meal log / data read |

**COLD vs WARM is the whole story** — a cold message costs ~10× a warm one because it re-pays the
~7–8k instruction+tools prefix. Cold = messages spread apart (meal logged every few hours). Warm =
staying in one active conversation. So "messages/day to hit the cap" is a RANGE by usage style:

| Tier | Daily cap | Spread-out (cold) | Realistic mix (few sittings) | Rapid burst (warm) |
|---|---|---|---|---|
| Trial (client) | 50k | ~5 | ~12–18 | ~25–35 |
| Premium (client) | 25k | ~2–3 | ~6–9 | ~12–18 |
| Assisted (linked client) | 40k | ~4 | ~10–14 | ~20–28 |
| **Client Max** | **150k** | **~13–14** | **~40–50** | **~100** |
| Trial (trainer) = Coach base | 100k | ~7–9 | ~18–28 | ~40–50 |
| Coach base | 100k | ~7–9 | ~18–28 | ~40–50 |
| **Coach Max (trainer)** | **200k** | **~14–15** | **~50** | **~100** |

(The Max "rapid burst ~100" matches the published "~100 AI conversations/day" allowance — that grid
number is honest.) Client Max and Coach Max numbers are EXTRAPOLATED from the tier-independent
per-message costs above (not re-run live — re-running yields identical per-message data at ~350k
tokens of cost).

**Planning note (Kevin, S92):** expectation is most users lean on the AI to manage their own account
AND (trainers) their clients' accounts — i.e. usage skews toward the pricier cold data/roster queries,
not cheap warm chatter. Watch real `aiUsage` totals over time; if a meaningful share of PAID users
regularly hit their cap, that's the signal to raise limits (each +50k/day ≈ ≤$7/mo worst-case cost).

### Hypothetical HIGHER trainer caps (250k–400k) — extrapolated messages + cost (S92)

Messages/day to cap (same tier-independent per-message costs: cold ~14k roster-heavy, realistic ~4k,
warm ~2k) AND absolute worst-case monthly cost IF a trainer maxes the cap EVERY day (cost/budget-token
measured: cold-fill ≈ $4.1/M, warm-fill ≈ $5.8/M — warm-fill is the pricier worst case). Margin vs the
current **Coach Max $79/mo**:

| Trainer cap | Cold msgs | Realistic | Warm burst | Worst-case $/mo (maxed daily) | Margin @ $79 |
|---|---|---|---|---|---|
| 200k (current) | ~14–15 | ~50 | ~100 | $25–35 | 56–68% |
| 250k | ~18 | ~62 | ~125 | $31–44 | 44–61% |
| 300k | ~21 | ~75 | ~150 | $37–53 | 33–53% |
| 350k | ~25 | ~87 | ~175 | $43–61 | 23–46% |
| 400k | ~28–29 | ~100 | ~200 | $49–70 | **11–38%** |

**Read:** (1) In EXPECTATION, raising the cap is cheap — almost nobody maxes daily; the cap is a
ceiling, not the bill. A typical active trainer spends $5–15/mo regardless of cap; a higher cap only
costs more for the few who push into the new headroom. (2) But the WORST-CASE margin is the guardrail,
and at **400k on the $79 price it thins to ~11–38%** (a heavy all-day warm user). So 250k–300k is
comfortably safe at $79; **350k–400k ideally pairs with a higher price or a new "Coach Ultra" tier**
rather than being given away on Coach Max. Same shape applies to Client Max (÷ its own price).

## Ultra tier (S92 — BUILT & deployed, data-triggered)

The heavy-user rung above Max, priced so a genuine power user is profitable at 400k/250k. **NOT on
the public pricing page** — surfaced only to users who prove they're heavy (the boost-upsell below).

| Tier | Allowance | Price | Worst-case cost/mo | Margin |
|---|---|---|---|---|
| **Coach Ultra** (trainer) | 400k/day | **$129/mo · $1,290/yr** | $49–70 | 46–62% |
| **Ultra** (client) | 250k/day | **$49.99/mo · $499.99/yr** | $31–44 | 12–38% (see note) |

Ladder: Coach $49 → Coach Max $79 → **Coach Ultra $129**; Premium $14.99 → Max $29.99 → **Ultra $49.99**.
Client Ultra margin is thinner on the paranoid warm-fill worst case, but a heavy *client* is almost
always meal-logging (cold ≈ 38% margin) and the tier is RARE by design — fine as an outlier valve.

**Data-triggered upsell (Kevin's design, BUILT):** Max users can still `requestBudgetBoost` (+50% →
Coach Max 200k boosts to 300k; client Max 150k→225k). Every boost increments a cumulative
`aiUsage/meta.boostCount`. On the **3rd boost and every 3rd after (6, 9…)**, `requestBudgetBoost`
returns `suggestUltra:true` and the chat shows an Ultra upsell card → Checkout `{tier:"ultra"}`. Ultra
users can also boost (to ~600k/375k for a spike) but are never upsold further. Implemented:
`BUDGETS.clientUltra/trainerUltra` + `tierFor` (`/ultra/` beats `/max/`) in aichat.js; `CATALOG`
`ultra`/`coach_ultra` + `planFor(role, level)` in billing.js; webhook already stamps
`subscriptionTier` → unlocks the budget; `AIChatPanel` Ultra card (role-aware copy).

**Selling points (Kevin, use in the upsell + marketing):**
- **Coach Ultra:** run your WHOLE roster through the AI every day — manage more clients, review
  everyone's data, and let the AI do the heavy client-management work (this is where the priciest,
  highest-value transactions live, so it's the natural pro upsell).
- **Client Ultra:** deep AI profile management, research across all your own data, pulling in outside
  info, and effortless logging by photo / voice / links — without ever running low.

**Future rung:** if trainers need >400k, that's a 4th tier or a custom Studio/Enterprise quote (see
Enterprise section) — not Ultra. Scheduled/autonomous AI tasks (weekly reports, proactive digests)
are a strong future Ultra+ differentiator (see docs — feasible via Cloud Scheduler + a per-user AI job).

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

## Enterprise (scoped S90 — SELL ON PAPER, build on the first real prospect)

Two segments, two models (Kevin's ask: gyms + corporate wellness):

**Glide Studio (gyms/studios): $249/mo per location** ($2,490/yr, 2 months free) — 10 coach
seats included (full Coach + AI), **+$19/mo per extra coach**, unlimited free-tier members,
optional member-AI packs (~$6/member/mo in blocks of 50 vs $14.99 retail). Anchored directly at
Trainerize Studio Plus ($248/mo/location, verified Jul 2026) with AI included. Margin: 10 coaches
at realistic AI usage ≈ $50–150/mo COGS vs $249. The head→sub→client role tree already models a
gym; themes.css was built for white-label.

**Glide at Work (corporate wellness): $4 PEPM, $500/mo minimum** — every employee gets the app
with AI (trimmed allowance ~10 convos/day). The hard AI caps make PEPM structurally safe:
~20–35% typical activation → 1,000 employees = $4k/mo revenue vs ~$250–500 real AI cost.
**Non-negotiables:** employer sees AGGREGATE ANONYMIZED stats only (never individual health
data — legal + the #1 objection), and the human-trainer layer (Smooth Training coaches for
employees who want one) is the differentiator nobody else offers at this price.

**Build gates (don't pre-build):** org entity + seat admin, aggregate reporting, white-label
theming pass, SSO later. Cheap now: an "Enterprise — let's talk" line on the pricing surface.
Custom-quote above ~25 coaches / ~2,500 employees; offer 3-month department pilots.

**Worked examples — Glide Studio at $249/mo, 10 seats included, +$19/extra coach** (per-trainer
effective cost; compared to buying that many standalone Coach $49 seats):

| Gym size | Monthly | Per trainer | vs. individual Coach seats |
|---|---|---|---|
| 5 trainers  | $249 | $49.80 | $245 — basically the same, NO volume discount |
| 10 trainers | $249 | $24.90 | $490 — half price |
| 15 trainers | $344 | $22.93 | $735 — big discount |
| 30 trainers | $629 | $20.97 | $1,470 — huge discount (past ~25 → custom quote/annual) |

**Honest flaw to resolve before selling boutiques:** the 10-included base front-loads the price,
so below ~10 trainers there's NO discount vs individual Coach subs — a 5-trainer studio pays
$49.80/trainer either way; Studio's only value there is the admin/white-label/aggregate layer, not
price. The model shines at 10+ coaches (~$21–25/trainer, ~half standalone). **Open decision — the
shape** (depends on whether 5–8-trainer boutiques are a target segment):
- **Keep current** ($249/10-included): great for 10+; tell small gyms to use individual Coach seats
  + a light "team view." Simple story, but a 5-coach studio has no price reason to pick Studio.
- **Clean per-seat** (~$29/coach, 5-coach min): 5→$145, 15→$435, 30→$870. Fair to small gyms,
  linear, easy to explain; leaves money on the table at big gyms, loses the "one price/location"
  anchor vs Trainerize.
- **Hybrid** ($149 base / 5 included, +$19/extra): 5→$149 ($29.80/trainer), 15→$339, 30→$624.
  Real discount for small gyms AND keeps the location anchor.

**DECISION (Kevin, this session): go with the HYBRID shape for small boutique gyms** — $149 base
covering 5 seats, +$19/extra coach. Reason: it gives 5–8-trainer studios a genuine per-trainer
discount (~$30 vs the standalone $49) so they have a real reason to pick Studio, while still
scaling cheaply for bigger gyms and keeping the clean "one price per location" anchor. Still
sell-on-paper (no build until a real gym prospect); this just fixes the "small gyms get no
discount" flaw in the original $249/10-included anchor.

Note: the "location/coach-count" axis is DIFFERENT from the standalone per-CLIENT axis
(TrueCoach/Trainerize scale a single trainer by their client count; Studio scales a gym by its
coach count). See "Per-client pricing — considered & deferred" below for why standalone stays flat.

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

## Per-client pricing (standalone Coach) — considered & DEFERRED, keep flat

Every coach-side competitor (TrueCoach, Trainerize, Everfit) charges a single trainer MORE as
their client count grows (bands: 5 / 20 / 50 / 200+). Question raised: should standalone Glide
Coach do the same? **Decision: no — keep Coach $49 / Coach Max $79 FLAT with unlimited clients.**

Why flat wins for us specifically:
- **It's our sharpest differentiator.** "Unlimited clients, nutrition + AI included, no add-on
  stacking" is the exact line that beats TrueCoach ($58 for a 20-client cap, $137 at 50) and
  Trainerize (needs +$20–45 nutrition add-ons). Per-client bands would throw that away.
- **Our marginal cost per extra client is ~nothing.** Unlike their infra, everything but AI runs
  on our own data; AI is ~1¢/exchange and hard-capped per user per day. We don't NEED per-client
  pricing to stay profitable — it'd be a pure revenue play.
- **Zero paying trainers yet** → designing a client-count band matrix now is guessing at a
  distribution we can't see.

If we ever want more revenue from big solo trainers, scale the **AI budget** (Max already does
this: 100k → 200k tokens/day), NOT client caps — a client cap directly contradicts our own
marketing. **Revisit trigger:** real trainers signed up + evidence that big-roster (50+ client)
solo trainers are (a) showing up and (b) worth a dedicated tier. Coach-count scaling for gyms is a
separate axis and IS in scope — see Glide Studio above. (Budget note: base Coach raised 60k→100k
tokens/day this session so a heavy ~20-client trainer doesn't hit the cap on a normal heavy day;
worst-case cost ≤$7/mo/heavy-trainer, ~70% margin held.)
