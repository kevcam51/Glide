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

## ⭐ S99 UPDATE — Kevin's chosen v1: SUNDAY WEEKLY BATCH billing
Kevin (Jul 19) refined the model — this supersedes per-session charging as the v1 design:

1. **Sessions on the calendar; the red line counts them.** As the current-time line passes a
   scheduled session, it's marked `completed` (a scheduled dispatcher — same machinery as the
   Trainerize 30-min auto-sync — no webhook needed for this part).
2. **One charge per week, Sunday night:** a weekly scheduled Function sums the week's completed,
   unpaid, non-package sessions per client and makes ONE off-session Stripe charge to the saved
   card. Fewer charges = fewer Stripe fees, fewer decline events, cleaner statements — strictly
   better than per-session charging.
3. **Decline → lockout + notify BOTH sides:** if the Sunday charge declines and isn't cured by the
   start of the next week, the client's account is flagged (`sessionBillingHold`) — they see a
   "cover last week's sessions to continue training" card (home screen + push), the TRAINER gets a
   notification too, and booking/attending new sessions is blocked until the balance clears (a
   retry/pay-now button hits a fresh PaymentIntent).
4. Package credits still settle FIRST (unchanged rule): Sunday only bills sessions that no credit
   covered.

**Build order stays:** scheduling layer first (Acuity import recommended; Kevin to provide API
key + User ID as secrets), then the completed-session marker, then Sunday billing + the decline
flow. Timing: after the S99 concerns batch (macro-save feedback, measurements asterisks, ID
numbers) — Kevin's call, Jul 19.

## ✅ S100 — SHIPPED: phases 1 & 2 (scheduling + the red line)

**Phase 1 — sessions model + scheduling (LIVE, rules published).**
`sessions/{sid}` = `{participants[2], trainerUid, clientUid, startAt, durationMin,
status: scheduled|cancelled, title, location, priceCents, createdBy/At, updatedAt,
cancelledBy/At, cancelReason}`. Queried via `where('participants','array-contains',uid)`
— a single-field index, so **no composite index deploy is needed**; ordering is client-side.
- Only a TRAINER books, only for a genuinely linked client (`isTrainerOf`). Either side
  cancels; a client may ONLY cancel — not reschedule, re-price, retitle, or un-cancel.
- Identity fields (participants/trainerUid/clientUid/createdBy/createdAt) immutable.
- Participants cannot DELETE (that would erase billing history) — cancel instead; admin only.
- **130 emulator tests** (was 87). Verified against PROD with raw writes that bypass the
  client-side allowlist — the first attack pass went through `updateSession`'s own field
  filter and reported false "ALLOWED", proving nothing. Always attack with raw `updateDoc`.
- UI: trainer Sessions panel per client card (book/reschedule/cancel + upcoming count);
  client NEXT SESSION card; calendar cyan dot + day-view detail block. Calendar sessions are
  scoped to the owner's own view (a trainer viewing a CLIENT's plan must not see their other
  clients' sessions painted on it).

**Phase 2 — the red line (LIVE).** `sessionsMarkCompleted` (functions/sessions.js), an
`onSchedule("every 15 minutes")` sweep, stamps `completedAt` on any session whose END time
has passed. **This stamp is what Sunday billing bills from**, so only the Admin SDK writes it.
- ⚠️ **`completedAt`, NOT `status:"completed"`** — the rules only permit a trainer update whose
  RESULTING status is scheduled|cancelled, so writing `status:"completed"` would lock the
  trainer out of their own past session and they could never waive a no-show before it bills.
  `status` = booking state (owned by the two people); `completedAt` = billing fact (server).
- Stamps the REAL end time, not when the sweep noticed. **Idempotent** — never re-stamps, so
  an overlapping run or retry cannot double-mark. Skips cancelled. 14-day lookback, range on
  ONE field (startAt) → single-field index; capped 500/run.

### ⏭️ NEXT: phase 3 — Sunday batch billing (REAL MONEY — build in Stripe TEST mode first)
Everything it needs already exists: `completedAt` (what to bill), `priceCents` (how much),
`settled`/`chargeId` (already server-only + rules-tested). Build order:
1. Card-on-file for clients (SetupIntent + saved payment method) + explicit auto-charge consent.
2. Session credits/packages — decrement BEFORE any card charge (Kevin's rule: package first).
3. The Sunday weekly Function: per client, sum sessions with `completedAt` set, `status !=
   cancelled`, `settled == null` → one off-session PaymentIntent → write `settled` +
   `chargeId` in the SAME transaction (idempotency).
4. Decline → `sessionBillingHold` + notify BOTH sides + block new sessions until cleared.
### ✅ DECIDED (Kevin, S100b) — both former open questions are now closed
**Cancellation policy — TRAINER-SET, not a Glide constant.** Each trainer/company picks
their own free-cancellation window (6h / 12h / 24h / 48h / 72h presets, or any custom
value up to 336h) and their own late-cancel charge (0-100% of the session price), plus an
optional note in their own words. Stored as `sessionPolicy` on the TRAINER's profile doc,
which clients can already read via the trainer-directory rule — so a client always sees the
exact terms their own trainer set, never a Glide-invented default.
- **Who cancels decides the fee.** A CLIENT cancelling inside the window is charged; the
  TRAINER cancelling or rescheduling is ALWAYS free, whenever they do it.
- **Disclosure is mandatory and up-front.** The policy renders permanently in the Sessions
  panel for both sides, and the exact dollar fee appears in the cancel confirmation BEFORE
  the irreversible tap (the button reads "Cancel & accept charge", not "Yes"). Must also be
  shown before any pack purchase is finalized when Checkout lands.
- **One source of truth:** the UI warning and the future billing sweep both call
  `lateCancelFeeCents()`, so what the client was warned about and what they are charged
  can never drift apart.

**Prepaid packs — YES, general options AND trainer-built.** `STARTER_PACKS` (5/10/20) ship as
starting points every trainer can enable/price/rename, and a trainer can define their own
packs. Stored as `sessionPacks` on the trainer's profile alongside the policy.

### 🔒 Security added with the decisions (rules PUBLISHED, 143 tests)
- `sessionCredits` + `sessionBillingHold` joined the owner-locked profile field set. Credits
  are money in the bank ("grant yourself 100 free sessions") and the hold is the unpaid-
  lockout flag ("clear your own hold") — both Admin-SDK-only, like subscriptionStatus (S85).
- **`cancelledAt` is pinned to server time (±5 min)** on BOTH cancel paths. Without it, a
  client cancelling an hour before could write `cancelledAt = 3 days ago` and slip outside
  the window for free — the single highest-value exploit the fee model introduces. Verified
  denied in PROD; honest cancels still work. `sessionPolicy`/`sessionPacks` are deliberately
  NOT locked (a trainer's own price list, on their own profile) but a CLIENT rewriting their
  trainer's policy is denied.
