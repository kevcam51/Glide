# Trial model — spec + what shipped (S92)

## ✅ DECISION (Kevin, S92): REVERSE TRIAL + card option (not card-upfront-only)
Concern with pure card-upfront: it walls the funnel (~60–75% fewer trial starts). Since Glide's
basics are free forever, a reverse trial gives the best of both — max signups, nobody locked out.

**What shipped this session (LIVE):**
- The reverse-trial mechanic was already live (no-card signup → 30 days full AI → locks to the free
  tier at expiry; basics stay free). The webhook already treats Stripe `trialing` as unlocked.
- **Fairness added:** `createCheckoutSession` now sets `subscription_data.trial_end` to the user's
  `trialStartedAt + trialLengthDays` when they're still inside the free trial — so upgrading EARLY
  no longer wastes free days (no charge until the promised trial end; ≥48h-out guard). Past expiry →
  no trial_end → billed now. Verified: a mid-trial `cs_live_` session was created with no error.
- **Reverse-trial messaging:** SideMenu banner + chat lock card reframed — "Full AI access — free
  for N more days · add a card anytime to keep your AI coach after — no charge until your free days
  are up. Logging & data stay free either way." Expired: "Add a card to switch your AI back on."
  Buttons: "Keep my AI coach" / "Turn my AI back on". House icons (sparkle/alert), no emoji.

**Still to build (when greenlit):**
- **End-of-trial reminder email** (~3 days out) via Resend — currently only the in-app banner nudges.
- **Optional card-required path for self-serve** (the section below) if you later want to tighten
  conversion; keep the reverse trial for trainer-invited clients. Build with an `onboardingPath` flag.
- **ToS disclosure copy + attorney pass** (auto-renewal law) before marketing paid tiers.
- Real-card smoke test (Kevin) — the only way to confirm the day-30 auto-charge end-to-end.

---

# Card-Upfront Auto-Converting Trial — spec (reference for the optional tighter path)

Kevin's ask: move to the proven model where a user **picks a plan + enters a card before the trial
starts**, gets full access for the trial, and is **auto-charged when the trial ends unless they
cancel**. Cancel during the trial → access until the trial ends, then locked + prompted to pick/pay.

## Why (the business case)
Opt-OUT (auto-convert) beats opt-IN ("trial ended, come back and pay") by a wide margin — most
subscription revenue is people who simply don't cancel. A card upfront also filters for intent.
Trade-off: **fewer people start** the trial (card friction), but **each converts far better** — net
revenue almost always wins. We already run Stripe live, so this is mostly wiring, not new infra.

## Stripe does this natively — no custom trial clock
Use a **subscription with `trial_period_days: 30`** (or `trial_end`):
- Checkout collects the card, creates the subscription in status **`trialing`** → full access, $0 now.
- On day 30 Stripe **auto-charges** the plan's price and flips to `active`.
- Cancel during trial (`cancel_at_period_end` via the portal) → stays `trialing` until day 30, then
  **`canceled`** with NO charge → app locks, prompts to pick/pay. **Exactly Kevin's flow.**
- Stripe fires the same webhooks we already handle (`customer.subscription.updated`/`deleted`,
  `invoice.paid`) — our `stripeWebhook` already stamps `subscriptionStatus`. Add handling for
  `trialing` → treat as active (unlocked); `trial_will_end` (3 days out) → trigger the reminder.

## What changes in our code (small)
1. **`createCheckoutSession` (functions/billing.js):** add `subscription_data: { trial_period_days: 30 }`
   to the Checkout Session. Card is collected but not charged. (Optionally `trial_settings.end_behavior
   .missing_payment_method: 'cancel'` — moot since we require the card.)
2. **`stripeWebhook`:** map `trialing` → unlocked (same as active) in the `subscriptionStatus` logic;
   handle `customer.subscription.trial_will_end` to send the pre-charge reminder (see guardrails).
3. **profile.js `isPremium`/gate:** already unlocks on `subscriptionStatus === "active"`; add `"trialing"`.
   The server gate (aichat.js `trialExpiredFor`) currently keys off `trialStartedAt` (our own 30-day
   clock) — for card-upfront users, trust Stripe's status instead (trialing/active = unlocked). Keep
   the legacy self-clock for any no-card path.
4. **Onboarding flow:** signup → **plan picker (PlanPicker already exists)** → Checkout (card) →
   `trialing`. The app already polls `?billing=success`.

## Two paths — decide the mix
- **Self-serve signups → card-upfront** (the money model). Highest conversion.
- **Trainer-invited clients → keep NO-card trial** (lower friction; the trainer's already vouching/
  paying and onboarding them — don't add a card wall to the client's first run). These keep the
  existing `trialStartedAt` self-clock + soft/hard gate.
  → Gate logic branches on how the account was created (invited vs self-serve). Store an
  `onboardingPath` flag on the profile at signup.

## Guardrails (legal + trust — REQUIRED before launch)
- **Clear disclosure at signup:** "Your 30-day free trial starts today. On [DATE] you'll be charged
  $X/mo unless you cancel. Cancel anytime." (US auto-renewal / "click-to-cancel" laws require this
  clarity + easy cancel — folds into the attorney ToS pass already queued.)
- **Pre-charge reminder email** ~2–3 days before (drive off `trial_will_end`) via the existing Resend
  sender — reduces chargebacks + angry cancels.
- **Dead-simple cancel:** the Stripe customer portal (already live) — one click, no dark patterns.
- **No "unlimited" language** anywhere (existing rule).

## Build order (when greenlit)
1. Add `trial_period_days` + `trialing` handling to billing.js/webhook (test mode first).
2. Signup → PlanPicker → Checkout wiring; profile `onboardingPath` flag; branch the gate.
3. `trial_will_end` reminder email (Resend).
4. ToS disclosure copy + attorney pass.
5. Test-mode E2E: start trial (card, no charge) → verify `trialing` unlocks → fast-forward/clock to
   trial end → verify auto-charge → verify cancel-during-trial → access-till-end → lock. (Stripe test
   clocks simulate the 30-day jump.)
6. Live-mode swap.

## Open decisions for Kevin
- Trial length per path (30 both? shorter self-serve, e.g. 14 days, to speed conversion?).
- Which plan(s) selectable at signup (all tiers, or just Premium/Coach with upsell to Max later?).
- Do we also keep a fully free no-card tier at all (basics free forever + AI gated), or is the trial
  the only entry? (Current model: basics free forever, AI gated — keep that; the card-trial gates AI.)
