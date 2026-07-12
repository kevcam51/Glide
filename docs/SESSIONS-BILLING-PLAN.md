# Session scheduling + auto-charge ("red line" billing) — plan (S92)

Kevin's ask (from Equinox): a client with a scheduled training session on the calendar and NO
remaining prepaid sessions gets **auto-charged for one session when the current-time line crosses
that session's slot**. Great for clients who only want to pay per session they actually have.

**Strategic fit:** this is the **Acuity (scheduling) + Stripe (post-session billing)** replacement in
Glide's platform vision — a core pillar, not a side feature.

## What it takes (three parts)

### 1. Scheduling / appointments subsystem (NEW — Glide doesn't have this yet)
Glide's current calendar is nutrition/workout LOGGING, not trainer↔client APPOINTMENTS. Need:
- A `sessions` model: `{trainerId, clientId, startAt, durationMin, status: scheduled|completed|
  cancelled|charged, price, chargeState}`.
- A scheduling UI (trainer books a session with a client; client sees their upcoming sessions).
- **Build vs integrate:** native scheduling is the platform-vision goal (bigger); OR import
  sessions from **Acuity** to start (Kevin already uses it) — faster, and the auto-charge layer
  works the same on imported sessions. **Open decision.**

### 2. Session credits / packages
- Client buys a pack of N sessions (one-time Stripe payment → prepaid credits), OR pays per session.
- Each completed session decrements a credit; at 0 credits the auto-charge kicks in.
- Store credits on the client (`sessionCredits`) + a ledger of purchases/decrements.

### 3. The auto-charge trigger ("the red line")
- A scheduled dispatcher (hourly/every-few-min) finds sessions whose `startAt` has passed and
  `chargeState` is unsettled.
- If the client has a credit → decrement it (no charge). If 0 credits → **charge their saved card
  for one session** (Stripe off-session PaymentIntent), mark `charged`.
- Respect a **late-cancel window** (e.g. cancel ≥24h before = no charge; no-show/late = charged).

## The key insight that de-risks payments
Charging a CLIENT's card per session = money moving from the client to a trainer, with a platform
cut. For OTHER trainers' clients that needs **Stripe Connect** (the revenue-split system, explicitly
a "later phase"). **BUT for Kevin's OWN clients (single trainer, flagship), it does NOT** — Kevin can
charge his clients directly through his existing Standard Stripe account via **off-session
PaymentIntents on saved cards** (client saves a card once, authorizes future charges). So:
- **Phase 1–3 for Smooth Training (Kevin's clients)** → no Connect needed. Build now-ish.
- **Multi-tenant (other trainers charge their clients)** → Stripe Connect, later (already roadmapped).

## Recommended phasing
1. **Sessions model + scheduling** (native, or Acuity import) + a calendar UI showing upcoming
   sessions with the current-time line.
2. **Session packs** (buy N via Checkout → credits) + **auto-decrement** when a session passes.
   This alone delivers most of the value with the LEAST payment risk (no card-on-file charges yet).
3. **Pay-per-session auto-charge** (saved card + off-session PaymentIntent when credits = 0) —
   single-tenant via Kevin's Stripe; the "red line charges them" behavior he described.
4. **Multi-tenant** via Stripe Connect (revenue splits) — the roadmapped later phase.

## Open product decisions (need Kevin)
- **Scheduling: build native, or import from Acuity to start?**
- **Billing model: pay-per-session, prepaid packs, or both?** (Kevin leaned pay-per-session.)
- **Late-cancel/no-show window** (24h? charge on no-show?).
- **Card-on-file requirement** for clients (needed for auto-charge).
- **Connect now or later** (single-tenant first is the safe path).

## Notes / risks
- Real money moving = highest-care area; test in Stripe TEST mode, clear consent/authorization at
  card save (auto-charge disclosure, like the trial ToS clause), refund/dispute handling.
- Timezone matters for "when the line crosses" — store `startAt` as UTC, schedule in the trainer's tz.
- This is a multi-session build; do NOT start until the scheduling source + billing model are decided.
