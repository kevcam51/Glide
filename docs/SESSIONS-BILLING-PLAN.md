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
A scheduled dispatcher (hourly/every-few-min) finds sessions whose `startAt` has passed and are still
`unsettled`, and **settles each one EXACTLY ONCE** in this strict priority order (Kevin's rule —
package first, never charge extra when credits exist):

1. **Already paid?** If the session is marked paid (Acuity `amountPaid`, or already settled by us) →
   do nothing. Never double-bill.
2. **Cancelled in time?** If cancelled before the late-cancel window → do nothing (no decrement, no charge).
3. **Package credit available?** If the client has `sessionCredits > 0` → **DECREMENT ONE CREDIT**,
   mark the session `settled: "package"`. **NO card charge.** ← this is the guarantee: a client with a
   package session in the bank is pulled from the package and charged nothing extra.
4. **Package empty (0 credits)?** → **charge the saved card for one session** (Stripe off-session
   PaymentIntent at the trainer-set price), mark `settled: "charged"`.

**Idempotency:** each session carries a `settled` flag written in the SAME transaction as the
credit-decrement / charge, so a retry or overlapping dispatcher run can never double-decrement or
double-charge. **Late-cancel/no-show policy:** cancel ≥ window (e.g. 24h) = free; no-show/late = still
settles (credit or charge) per the trainer's policy.

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

## ✅ DECISIONS (Kevin, S92)
- **Billing model: BOTH** — prepaid packs AND pay-per-session. Client can buy a pack; when it runs
  out (or if they never bought one), a scheduled session that passes auto-charges their saved card.
- **Scheduling: Acuity-import FIRST** (recommended) — keep Acuity's mature booking; Glide reads the
  sessions + layers credits/auto-charge. Native scheduling later (the unified-app goal); same billing
  code reused. Booking quality is HIGHER starting on Acuity (years of polish) vs a v1 native scheduler.
- **TRAINER-SET PRICING (core principle, Kevin):** trainers set their OWN session prices — Glide never
  presets them. This IS the Shopify-for-trainers vision (trainers run their own businesses on Glide).
  Synergy: an Acuity **appointment type already carries the trainer's price**, so import pulls each
  trainer's own pricing through automatically. Reinforces **Stripe Connect** for multi-tenant (each
  trainer's own connected account + prices + payouts; platform takes a cut). Single-tenant (Kevin) sets
  his prices in Acuity/his Stripe — no Connect needed yet.

## ✅ Acuity API — VERIFIED contract (S92, from developers.acuityscheduling.com)
Same integration shape as Trainerize (Kevin provides credentials as secrets, then we dry-run live).
- **Auth:** HTTP Basic — base64(`UserID:APIKey`) (Acuity → Integrations → API). Like Trainerize's Basic auth.
- **GET `/api/v1/appointments`** — filters `minDate`/`maxDate`, `calendarID`, `appointmentTypeID`,
  client `firstName/lastName/email/phone`, `canceled` (canceled excluded by default). `/appointments/:id`
  for one.
- **Fields we need are all present:** client (name/email/phone), `datetime`, `appointmentTypeID`,
  `calendarID`, `price` (the trainer-set appointment-type price ✓), `paid`/`amountPaid` (so we only
  auto-charge UNPAID sessions), `canceled`, and **`noShow`** (admin-marked — drives no-show billing).
- **Webhooks** (real-time triggers): `appointment.scheduled`, `appointment.rescheduled`,
  `appointment.canceled`, `appointment.changed` → POST (form-urlencoded) with action + appointment id +
  calendar id, to an https endpoint. Lets Glide react the moment a session is booked/cancelled.
- **`/appointments/:id/payments`** — Acuity's own payment records per appointment (reconciliation).
- **Verdict:** fully supports scheduling import + the "red line" auto-charge (poll `minDate=now` for
  passed unpaid sessions, or use webhooks) + trainer-set prices flowing through. Ready to build once
  Kevin supplies his Acuity API key + User ID (as Secret Manager secrets, like TRAINERIZE_*).

## Open product decisions (still need Kevin)
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
