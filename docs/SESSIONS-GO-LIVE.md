# Sessions billing — go-live checklist

Status of the trainer↔client **training-session billing** feature (card-on-file auto-charge +
late-cancel fees + prepaid packs). Built through S104; live in **Stripe TEST mode**, E2E-verified,
**not taking real money**. This is the path to real money.

**The key framing (from `docs/LEGAL-SESSIONS.md`):** the two remaining tracks are **not equally
blocked.** The **auto-charge-in-arrears** model (bill for sessions already delivered) is the
*legally safer* one — it's the **prepaid packs** that pull a trainer into health-studio regulation.
So **#4 (go live on auto-billing) is much closer than #3 (packs).** Recommended order: ship #4 first,
hold #3 until an attorney clears it.

Attorney questions are broken out in **`docs/SESSIONS-ATTORNEY-QUESTIONS.md`** (send that to counsel).

Legend: `[ ]` = to do · `[x]` = done · `[~]` = partially done · 🔒 = attorney-gated

---

## Already built & verified (test mode)

- [x] Scheduling: book / reschedule / cancel; billing fields server-only in rules
- [x] Completed-session sweep (`sessionsMarkCompleted`, every 15 min)
- [x] Card on file via Stripe SetupIntent (Glide never sees card numbers)
- [x] Settle dispatcher (`sessionsSettle`): package credits first, then per-session / weekly / manual
- [x] Decline → account hold → notify both sides; **PAY NOW** to clear a hold
- [x] Cancellation disclosure on every checkout; timestamped consent snapshot (policy version frozen)
- [x] Dispute-evidence generation; self-serve cancel; **no "no-chargeback" clause**
- [x] Trainer **Earnings** ledger view (S105)
- [x] Client-state risk **scaffolding** — informational only, not a gate (S105b)
- [x] **156 emulator rules tests** pass; rules published

---

## #4 — Go live with session AUTO-BILLING (the closer one)

### 🔒 Attorney / counsel — the real gate
- [ ] **Write real Terms of Service.** `public/terms.html` today has **no** card-on-file, auto-charge,
      off-session, recurring-billing, or late-cancel-fee language. ROSCA requires these material terms
      disclosed **before** a card is saved, with express informed consent. **Nothing may store a real
      card until this exists.** → attorney Qs 9, 10, 14–18.
- [ ] **Merchant-of-record decision.** Charging other trainers' clients on *Glide's* Stripe account
      makes Glide liable for their disputes + dispute-rate exposure. Decide: Glide-as-MoR vs Stripe
      Connect direct charges (trainer as MoR). → attorney Qs 19–21. _(For Kevin's OWN clients only,
      this matters less; it's a white-label question.)_
- [ ] **Florida billing-cadence confirmation.** Confirm weekly Sunday-in-arrears billing is fine, or
      whether § 501.016(5)'s "monthly" wording means we should bill monthly. → attorney Q4.

### Engineering (small — mostly done)
- [ ] **Confirm the LIVE `STRIPE_SECRET_KEY` charge path** end-to-end. Today test clients route to
      `STRIPE_TEST_SECRET_KEY` (via `sessionBillingTest`); the live branch (`functions/sessionSettle.js`,
      `functions/sessionBilling.js`) needs a real exercise. Ensure the live-mode webhook is wired
      (same one-command Stripe API creation used for subscription billing in S89b).
- [ ] **Real-card smoke test** (Kevin): book → let a session pass → Sunday settle → confirm the charge
      lands + shows in the Earnings view. Then a real late-cancel fee once.
- [ ] **Remove test-only affordances**: the `sessionBillingTest` routing + any test hooks, once live
      is confirmed.
- [ ] Clear leftover **Stripe test-mode customers** (Stripe Dashboard → Test mode → "Delete test
      data"). _(Firestore test residue already verified clean, S105.)_

---

## #3 — Prepaid PACK purchases (hold until counsel clears it)

### 🔒 Attorney — hard gate (do NOT sell packs until answered)
- [ ] **The Florida 30-day question.** Does selling *any* prepaid pack blow § 501.0125(c)'s
      personal-trainer exemption (→ registered "health studio": $300/yr + $25k bond, 3-day cooling-off,
      36-month cap, mandatory contract language)? Does a pack sold with a ≤30-day **service window**
      stay exempt? Does (c) look at the contractual right or actual redemption? → attorney Qs 1, 2, 5.
- [ ] **Registration/bond mechanics for a mobile trainer** if a pack does trigger it. → attorney Q3.
- [ ] **Which client states** packs can be sold into + geo-gating + the remote-client choice-of-law
      question. → attorney Qs 11, 12, 13.

### Engineering (only AFTER the FL question clears)
- [ ] Build the **buy side**: Stripe Checkout (payment mode) → on success grant
      `sessionCredits[trainerUid] += N`. _(The consume side already works — settle spends credits first.)_
- [ ] Wire the S105b `packWindowRisk` / `packWindowNote` into the pack editor so the service window is
      enforced/warned at sale (currently the model exists but has no UI consumer).
- [ ] Keep the whole pack feature behind a flag until the opinion lands.

---

## Suggested sequence

1. Send `docs/SESSIONS-ATTORNEY-QUESTIONS.md` to a Florida attorney (+ payments counsel).
2. In parallel, do the #4 **engineering** items (live-key path, webhook) so you're ready the moment
   the ToS is written.
3. Attorney returns → finalize ToS → real-card smoke test → **go live on auto-billing (#4).**
4. Only once the FL 30-day question is answered favorably → build & flag-on **prepaid packs (#3).**
