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
| Trial (trainer) — trainerTrial (S92) | 200k | ~14–15 | ~50 | ~100 |
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

---

## S169g — the "paying never shrinks the product" ladder (2026-08-01, LIVE)

Kevin's rule: the trial shows the full product and paying keeps or grows it — the
allowance must never drop on day 31. Enforced in `functions/aichat.js` BUDGETS.

| Tier | $/mo | Tokens/day | ≈ conv/day |
|---|---:|---:|---:|
| Client trial (30d) | free | 100k | ~66 |
| Premium | $14.99 | 100k | ~66 |
| Client Elite | $29.99 | 150k | ~100 |
| Client Apex | $49.99 | 250k | ~166 |
| Coach trial (30d) | free | 100k | ~66 |
| Coach | $49 | 200k | ~133 |
| Coach Elite | $79 | 300k | ~200 |
| Coach Apex | $129 | 400k | ~266 |

`assisted` (trainer-linked client) rides at 100k — it used to sit ABOVE the solo
client tier; leaving it at 40k would have inverted it to less than Premium.

### Worst case: every tier maxed out every day of the month

Basis: measured live cost $3.8–6.1 per 1M budget-tokens (avg ~$4.70), ~1,500
budget-tokens ≈ one conversation ≈ 0.7¢. "Ceiling" = the cap burned all 30 days.

| Tier | Revenue | Ceiling cost/day | Ceiling cost/mo | Margin at ceiling |
|---|---:|---:|---:|---:|
| Premium 100k | $14.99 | $0.47 | ~$14 | ≈ break-even |
| Client Elite 150k | $29.99 | $0.71 | ~$21 | ~$9 |
| Client Apex 250k | $49.99 | $1.18 | ~$35 | ~$15 |
| Coach 200k | $49 | $0.94 | ~$28 | ~$21 |
| Coach Elite 300k | $79 | $1.41 | ~$42 | ~$37 |
| Coach Apex 400k | $129 | $1.88 | ~$56 | ~$73 |

Premium at its ceiling is ≈ break-even BY DESIGN — the cap is the protection, and
a client living at the cap daily is an Elite upsell (the boost flow already says
so). Typical use is a small fraction of ceiling; margins in practice are wide.

### Trainer roster scenarios (Kevin's ask)

Assumes granular per-client conversations (worst case — coach_summary reads the
whole roster in ONE conversation, and caching prices back-to-back use at the LOW
end of the range, so real cost lands below these).

| Roster | Conv/client/day | Conv/day | Tokens/day | Fits in | Cost/day | Cost/mo |
|---:|---:|---:|---:|---|---:|---:|
| 10 | 3 | 30 | 45k | Coach | $0.21 | ~$6 |
| 10 | 6 | 60 | 90k | Coach | $0.42 | ~$13 |
| 10 | 10 | 100 | 150k | Coach | $0.71 | ~$21 |
| 20 | 3 | 60 | 90k | Coach | $0.42 | ~$13 |
| 20 | 6 | 120 | 180k | Coach (90% of cap) | $0.85 | ~$25 |
| 20 | 10 | 200 | 300k | Coach Elite (at cap) | $1.41 | ~$42 |
| 30 | 3 | 90 | 135k | Coach | $0.63 | ~$19 |
| 30 | 6 | 180 | 270k | Coach Elite | $1.27 | ~$38 |
| 30 | 10 | 300 | 450k | Apex + a boost | $2.12 | ~$63 |

Read: Coach ($49) comfortably carries a 10–20-client roster at realistic AI use.
The tier ladder maps cleanly onto roster size — 20 clients used heavily lands on
Elite, 30 used heavily lands on Apex — and every cell is profitable against its
tier price. The 30×10 case exceeds even Apex's cap (450k > 400k): the cap + boost
flow handles it, and at $63 cost against $129 it is fine to allow.

---

## S169h — the full ladder with Connect tiers — **DECIDED & SHIPPED S171 (Aug 2, 2026)**

The rule this ladder is built on, in Kevin's words: **the 30-day trial is the
whole product, free**. When it ends, nobody is thrown out — they land on Free
and keep their data and every manual feature. Paying is a choice between three
kinds of value: *bring your own AI* (Connect), *our AI in the app*
(Premium/Coach), or *heavy use* (Elite, and Apex above it).

### The trial (both audiences, 30 days)

Everything unlocked: full in-app AI at the paid-tier allowance (100k/day),
full plugin speed, every feature. Card added early? Billing still starts only
when the trial ends (reverse trial, S92 — already built). The trial never
gives MORE than the tier below it any more (S169g fixed that inversion).

### Client ladder

| | Free (post-trial) | Connect $7.99 | Premium $14.99 | Elite $29.99 | Apex $49.99† |
|---|---|---|---|---|---|
| All manual tracking* | ✔ | ✔ | ✔ | ✔ | ✔ |
| Trainer connection, to-dos, DMs | ✔ | ✔ | ✔ | ✔ | ✔ |
| Plugin (their Claude/ChatGPT) | taste: 25 calls/day | **2,000/day** | 2,000/day | 2,000/day | 2,000/day |
| In-app AI (chat/photo/voice) | — | — | 100k/day ≈ 66 conv | 150k ≈ 100 | 250k ≈ 166 |
| Scheduled AI automations | — | — | — | 1/day | 3/day |
| Allowance boosts on request | — | — | — | ✔ | ✔ |
| Annual (2 months free) | — | $79.99 | $119.99 | $299.99 | $499.99 |

*The audit's full list: food log, database search, barcode, servings, macros &
micros, targets, water, weight, measurements, calendar, streaks, progress
charts, plans/phases, workout builder, custom exercises — all 60+ non-AI
features stay free forever.
†Apex stays data-triggered (boost upsell), not on the public grid.

### Trainer ladder

| | Free (post-trial) | Coach Connect $24.99 | Coach $49 | Coach Elite $79 | Coach Apex $129† |
|---|---|---|---|---|---|
| Full coaching platform* | ✔ | ✔ | ✔ | ✔ | ✔ |
| Plugin (their Claude/ChatGPT) | taste: 25 calls/day | **2,000/day** | 2,000/day | 2,000/day | 2,000/day |
| In-app AI | — | — | 200k/day ≈ 133 conv | 300k ≈ 200 | 400k ≈ 266 |
| Scheduled AI automations | — | — | — | 2/day | 5/day |
| Allowance boosts on request | — | — | — | ✔ | ✔ |
| Annual (2 months free) | — | $249 | $490 | $790 | $1,290 |

*Dashboards, analytics, unlimited connected clients, to-dos, DMs, Invite Hub,
local plans & sims, sessions/booking/earnings, Trainerize import — free forever.

### Why Connect doesn't eat Coach

A Coach Connect trainer's true monthly spend is $24.99 + ~$20 (their own
Claude/ChatGPT) ≈ $45 — nearly Coach's $49. Connect captures people already
paying another AI company who won't switch interfaces; it does not undercut
the all-in-one tier. Coach keeps real exclusives: in-app chat/photo/voice on
the phone, automations (run on OUR key — a Connect user's AI can't schedule
itself), boosts, and no dependence on a second subscription.

### Cost & margin at the ceiling (every day maxed, 30 days)

| Tier | Revenue | Ceiling cost | Margin |
|---|---:|---:|---:|
| Client Connect | $7.99 | ~5¢ | ~$7.94 (~99%) |
| Coach Connect | $24.99 | ~7¢ | ~$24.92 (~99%) |
| Premium | $14.99 | ~$14 | ≈ break-even (cap = protection) |
| Elite / Coach / Coach Elite / Apex | — | — | see S169g table above |

### What changes on approval (the build list)

1. `functions/mcp.js` — DAILY_CALLS becomes {free: 25, connect: 2000,
   paid: 2000}; tier read from subscriptionTier; trial counts as paid. This
   CLOSES the current hole where expired-trial accounts keep 200 plugin
   calls/day for free.
2. `functions/billing.js` — CATALOG + planFor gain connect / coach_connect;
   Stripe products auto-create by lookup_key on first checkout (no manual
   dashboard work, same as every existing tier).
3. `PLAN_MENU` + `PLAN_FEATURES` — Connect column + plugin rows in both grids;
   picker copy.
4. Webhook — no change (tier rides metadata already).
5. docs/PRICING.md — mark this section DECIDED.

Open numbers Kevin can veto line-by-line: the 25/day free taste, $7.99,
$24.99, both annuals, and whether automations belong at Elite+ (they are
currently Elite+ in code: WORKFLOW_CAP has no base-tier allowance).

### S169i — fitness-market connector research (the recovered angle)

Only ONE fitness platform has an official AI connector: **Strava** (June 2026) —
read-only MCP, bundled free with its $11.99/mo subscription, free tier gets
nothing; Strava also moved plain API access behind that same sub. Everyone else:
**MyFitnessPal/Peloton/WW/AllTrails** ship free partner apps inside ChatGPT
Health (Jan 2026, OpenAI's directory — a distribution channel to note for the
roadmap); **Hevy** gates its API behind Pro $2.99/mo; **Whoop/Oura** gate theirs
behind membership; **Trainerize** sells API access only at Studio $275+/mo;
**Cronometer** has no purchasable API at all.

What this changes: nothing in the numbers, everything in the positioning.
Strava's model (bundle with sub, nothing on free) is the market's answer and
matches the proposal. Glidna would still be FIRST in fitness on three counts:
first read+WRITE connector (Strava's is read-only — theirs reports, ours logs
meals and builds workouts), first connector-priced tier anywhere (Connect), and
first coaching-platform connector (Trainerize's closest thing costs $275/mo and
isn't AI). Re-synthesis with fitness folded in kept $4.99 / $19.99 recommended.

### S170 — client-comp verification (Aug 2, 2026, live sources)

**MyFitnessPal ACQUIRED Cal AI** (closed Dec 2025, announced Mar 2, 2026 —
globenewswire/TechCrunch). Cal AI: 15M downloads, ~$30M ARR, built by two
teenagers; keeps running standalone, now wired to MFP's 20M-food database. MFP
also bought meal-planner Intent and is a first-party ChatGPT Health partner.
The client market is consolidating around one owner.

**Cal AI** ($9.99/mo, ~$29.99/yr, dynamic paywall down to $2.99/wk): photo
scanning + basic search/barcode on free. No AI chat, no coach platform, no
connector. **MacroFactor** ($11.99/mo, $71.99/yr ≈ $5.99/mo): excellent
algorithmic coaching, AI photo + describe-to-log, 1.36M-food DB. No AI chat
coach, no trainer side, no connector/API.

**Read-through for the decided ladder:**
- Monthly holds everywhere: Free ≥ Cal AI's free; Connect $4.99 undercuts both
  ($9.99/$11.99); Premium $14.99 sits $5 under MFP with a writable AI none of
  the three has at any price. No monthly change recommended.
- **Annual is the honest sore spot**: Glidna $119.99 vs MFP $79.99, MacroFactor
  $71.99, Cal AI ~$29.99 — the most expensive annual in the set. Hold list
  price; if annual conversion lags at launch, the lever is a first-year promo
  (~$79–89), not a list cut (S90's conclusion, now with two more data points).
- Post-acquisition, differentiation cannot be price or photo-scanning (MFP owns
  that lane end to end). It is the two-sided trainer platform + the writable
  connector — which MFP does not offer even after buying everyone.

---

## S171 — DECIDED & LIVE (Aug 2, 2026)

Kevin approved the ladder. Shipped: Connect tiers, Apex 450k, plugin gating.

| Client | $/mo | $/yr | In-app AI | Plugin |
|---|---:|---:|---|---|
| Free | 0 | — | — | 25/day |
| **Connect** | **4.99** | 49.99 | — | 2,000/day |
| Premium | 14.99 | 119.99 | 100k ≈ 66 conv | 2,000/day |
| Elite | 29.99 | 299.99 | 150k ≈ 100 | 2,000/day |
| Apex† | 49.99 | 499.99 | 250k ≈ 166 | 2,000/day |

| Trainer | $/mo | $/yr | In-app AI | Plugin |
|---|---:|---:|---|---|
| Free | 0 | — | — | 25/day |
| **Coach Connect** | **19.99** | 199 | — | 2,000/day |
| Coach | 49 | 490 | 200k ≈ 133 conv | 2,000/day |
| Coach Elite | 79 | 790 | 300k ≈ 200 | 2,000/day |
| Coach Apex† | 129 | 1,290 | **450k ≈ 300** | 2,000/day |

† data-triggered, not on the public grid. Trial (30d, both): in-app AI 100k/day
+ full plugin, then Free — never a locked account.

**Free gets ZERO connector calls (S173).** It was 200/day for everyone — never
a decision, just a default — so an expired trial kept a full working allowance
forever. A 50/200 taste was built and then replaced: the AI layer, in-app and
connector alike, is what you pay for, and free is the whole manual product.

**The trial does the selling.** 30 days at the full 2,000/day, then nothing.
Losing it entirely is a sharper prompt than having it narrowed, and "AI
features are paid" is one line on a pricing page where two taste allowances
were three. The denial message names the price ($4.99 / $19.99) rather than
saying "upgrade", and does NOT say "resets at midnight" — for a free user that
would be a lie they act on.

**Substring hazard, recorded:** mcp.js planFor() must test `connect` BEFORE
`coach`, because "coach_connect" contains "coach" and would otherwise inherit
the 5,000-call coach cap. Same class of bug as the S90 ultra/max ordering.

**Ceiling economics** (measured ~$4.70/1M budget-tokens): Apex 450k ≈ $63/mo
worst case against $129. Connect tiers ~100% margin — the user's own AI pays
for inference. Every tier profitable at its cap.

**Open:** annual is the weak spot (119.99 vs MFP 79.99 / MacroFactor 71.99).
Lever is a first-year promo, not a list cut. FatSecret barcode needs a
`/barcode` route on the proxy (verified missing). Free-tier feature depth and
per-feature ⓘ tooltips still to design — docs/PLAN-REVIEW.md has all 109
features with tooltip copy ready.

---

## S175 — AI-coached client limits per trainer tier — DECIDED (Aug 2, 2026; build queued)

Kevin's call, made with the competitive research on record. **Not built yet** —
deliberately queued behind the free-tier feature review so it ships in the same
pricing update as whatever that surfaces.

| Trainer tier | AI-coached clients / month |
|---|---:|
| Free | 0 (no AI) |
| Coach Connect $19.99 | **15** (inherits Coach) |
| Coach $49 | **15** |
| Coach Elite $79 | **25** |
| Coach Apex $129 | **35** |

**What is limited:** distinct clients the AI works on per UTC month — connected
accounts AND local plan files (Trainerize imports are local plans; they count).
**What is NOT limited:** the platform roster. "Unlimited connected clients —
free forever" stays true; dashboards/to-dos/DMs are untouched. Client #16
connects fine — the wall appears only when the AI is asked to work on them,
which is the upgrade moment.

**Why (honest version):** the limits do NOT change worst-case cost — the token
caps already bound that. They price big rosters proportionally (the market
standard: TrueCoach $58/20 · $137/50, PTDistinction $59.90/25 · $89.90/50,
FitBudd $79/20, Trainerize slider to ~$225/200 — verified Aug 2, 2026, official
pages) and they guarantee headroom inside a tier: 15 clients x 6 conv/day =
135k tokens, leaving a Coach trainer ~43 conversations of personal use under
the 200k cap. Kevin chose 15/25/35 over the market-anchored 15/30/50 for
stronger upgrade pressure; revisit if side-by-side shopping ever bites.

**Connector loophole: closed by architecture, not policy.** Every surface —
in-app chat/stream, both Accept callables (logMeal, setWorkoutSchedule), and
the MCP connector — funnels through `runTool` (functions/aitools.js:1532). One
check there covers everything; Coach Connect at $19.99 hits the same wall as
Coach at $49. This also satisfies the standing AI↔connector-parity rule.

**Build notes (from the S175 code inspection — trust these, they were verified
against the source):**
- Charge INSIDE `runTool`, keyed `c_<uid>` (connected) / `p_<planId>` (local
  plan). Keying on resolved uid alone is WRONG — `resolveTargetUid` maps every
  localPlanId to callerUid, which would collapse all plan files into one slot.
- The notes tools validate `localPlanId` in their own early branch
  (aitools.js ~:1961) and return before the shared planOverride block (~:2066)
  — either charge there too or hoist the planOverride block above notes.
- Roster-overview tools (`list_clients`, `find_client`, `coach_summary`) have
  no per-client target and stay EXEMPT — otherwise one coach_summary burns the
  month.
- Storage: `users/{uid}/aiClients/{YYYY-MM}` `{ targets: {key: ts}, count,
  plan }` — existing key = allow with no write; new key = transaction
  (count < cap) then merge. Idempotent across propose/Accept re-calls.
- Use a transaction, unlike mcpUsage's read-then-write, or accept 1–2 overshoot
  from parallel tool calls.
- Grid: keep the unlimited-roster row; add "AI-coached clients" row per tier.
  Denial copy points at the app's plan grid, names no price (S174 rule).
- Open detail (default, flag to Kevin at build time): trial = no client limit,
  consistent with "the trial is the whole product".

**Client packs** (PTDistinction-style +$/client overage) noted as a proven
later mechanism for 100-client connector rosters; not in scope now.

---

## S176 — TWO REVISIONS to the above (Aug 2, 2026, Kevin) — read before building

### 1. Coach Connect has NO client limit. The rule is: limit only what we pay for.

Supersedes the "Coach Connect $19.99 → 15 (inherits Coach)" row above.

| | What it sells | AI-coached client limit |
|---|---|---|
| Coach / Elite / Apex | **We provide the AI** (chat, photo, voice, in-app) | 15 / 25 / 35 |
| Coach Connect | **They bring the AI** (their Claude, their bill) | **none** |

Kevin's two objections, both correct and both fatal to the old row:
- **It reads as a scam.** The client limit exists because in-app AI costs us
  money. On Connect it costs us ~nothing. A restriction with no cost behind it
  is arbitrary, and customers work that out.
- **A Connect ladder cannibalises UPWARD.** A hypothetical "Coach Connect 100"
  would strictly dominate Coach Elite ($79, 25 clients) — the proposal would
  have undercut the tiers it existed to protect. Scrapped.

The new rule — *we limit what we pay for* — is printable on the pricing page,
defensible to anyone, and makes Connect vs Coach a choice of AXIS (whose AI is
this?) rather than rungs on one ladder. Consequence accepted: a 100-client
solo trainer can sit on Connect at $19.99 (~99% margin, ~$19 profit). That is
fine — they were never going to buy Coach Elite, and their 100 clients are a
distribution channel into the app.

### 2. Seat model — how a slot is consumed (fixes a real flaw in the monthly-touch design)

The original design would have let an accidental connection lock a slot for up
to 30 days. Kevin flagged it as business-damaging; he is right. Revised:

**A slot is consumed the first time the AI actually DOES something for that
person in a calendar month — not when the switch is flipped.**

| Situation | Result |
|---|---|
| Connect the wrong person, notice, disconnect | **free** — the AI never ran |
| Full at 15, need to swap someone in | remove → slot frees **immediately**, add now |
| Remove someone, want them back this month | **free** — already in the month's set |
| Shuffle AI across 25 plans to dodge the limit | blocked at the 16th DIFFERENT person |

So every genuine coaching move is instant and free; only reaching a 16th
distinct person in one month is refused. Nobody ever waits out a cooldown.

**Seat UX (build list):**
- Confirm on enable: "Turn on AI coaching for Sarah? This uses 1 of your 15 AI
  client slots."
- **AI Clients screen**: "12 of 15 slots used" + the list + add/remove.
- Denial copy points into the app's plan grid, names no price (S174 rule).

**Trainerize's active/basic split — mechanic adopted, stinginess rejected.**
Their "basic" clients lose everything but messaging/calendar. Every Glidna
client stays a FULL client (tracking, plans, charts, DMs — the 98 free
features); the seat gates AI coaching only. Familiar mechanic, none of the
resentment, and consistent with "unlimited connected clients, free forever".

### Strategic frame recorded (Kevin, S176) — the reason this matters

Kevin: *"the only way to make the tiers worth it is to make the app more
valuable than the AI alone. Because the AI is the driving force we are in a
tight spot."* The diagnosis is right, with one correction: the app IS already
more valuable than the AI (98 free features, incl. a MET burn engine no
third-party source can supply). The tight spot is that ALL of it is free and
the paywall sits only on the one thing the industry is racing to commoditise.

Therefore: **monetise the platform, not the intelligence.** Three legs, in
order of durability —
1. **Session transaction cut** (batch 9, decided-but-unbuilt). A trainer
   running $3k/mo at ~15% = **$450/mo from one trainer** — 9 Coach subs, from
   someone who may pay $0 in subscription. Scales with THEIR success, immune to
   AI getting cheaper. This is the "big money" Kevin worries about missing, and
   it is not in higher subscription tiers. Caveat: 15% is aggressive vs
   Trainerize/TrueCoach passing Stripe through — expect to defend or tune.
2. **AI subscriptions** (today's ladder) — on a commoditisation clock.
3. **Studio / agency seats** — the teams capability currently given away.

**Connect is a WEDGE, not an annuity.** Expect a major (MyFitnessPal is already
a first-party ChatGPT Health partner) to bundle a connector free within ~18–24
months. Qualifier: what goes free will be READ access — Strava's is read-only,
MFP's health integration is the same shape. Glidna's WRITES, which needs the
platform underneath, so the window is longer than it looks but is still a
window. Price Connect to spread, not to milk. **Lock early Connect subscribers'
rate for life** (Kevin's instinct, endorsed): costs nothing now, real loyalty
asset when the price falls.

**The metric that tells you if Connect is working:** not revenue per Connect
user — whether Connect trainers' CLIENTS end up in the app. If they do, it is a
growth engine. If they don't, it is a leak.
