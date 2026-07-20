# Legal & compliance research — session packages, card-on-file, late-cancellation fees

**Status:** research findings, NOT legal advice. Neither the author nor the reader is a lawyer.
Everything here requires review by a licensed Florida attorney (and payments counsel) before
Glide takes real money under the sessions-billing model.

**Scope:** the S100 phase-3 build in `docs/SESSIONS-BILLING-PLAN.md` — (a) prepaid session packs,
(b) card on file auto-charged off-session by the Sunday batch sweep, (c) trainer-set late-cancellation
fees. Base of operations: Miami, FL (mobile personal training). Later: white-label to trainers in
other states.

**Research date:** July 2026. Several areas below are fast-moving; re-verify before launch.

**Coverage honesty:** the Florida analysis and the Stripe/FTC/ROSCA items are verified against
primary or named sources. Several other areas were cut short and are marked
**UNVERIFIED / NEEDS FOLLOW-UP**. An honest gap is more useful than a confident invention — do not
treat the gaps as "probably fine."

---

## 1. Executive summary — top risks ranked by severity

### 🔴 RISK 1 — Prepaid session packs likely destroy Florida's personal-trainer exemption (HIGHEST)

This is the single most important finding of the research, and it cuts directly against the
currently planned feature set.

Florida's Health Studio Act excludes "an individual acting as a personal trainer" from the
regulated definition of "health studio" — **but the exclusion is conditional on three tests, and
the third one is about advance payment.** A trainer only qualifies as an exempt "personal trainer"
if they are someone:

> "(c) Who does not accept payment for services that are to be rendered more than 30 days after the date of payment"

— Fla. Stat. § 501.0125, verified at
[leg.state.fl.us](https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&Search_String=&URL=0500-0599/0501/Sections/0501.0125.html)
and independently at [flsenate.gov](https://www.flsenate.gov/Laws/Statutes/2025/501.0125).

**A 10- or 20-session prepaid pack is, by design, payment today for sessions rendered months from
now.** On a plain reading that appears to blow condition (c), which would mean the trainer is no
longer an exempt "personal trainer" and instead *is* a regulated "health studio" — triggering
registration, a surety bond, the 3-day cooling-off right, the 36-month cap, and mandatory contract
language.

The `STARTER_PACKS` (5/10/20 sessions) already designed in `SESSIONS-BILLING-PLAN.md` are precisely
the feature that creates this exposure. **This needs an attorney opinion before packs ship.**

### 🟠 RISK 2 — Glide would be shipping the non-compliance to every trainer, at scale

Kevin's flagship exposure is one business. But the platform's design decisions (trainer-set
`sessionPolicy`, `sessionPacks`, the auto-charge sweep) get replicated across every white-label
trainer in every state. A defective consent flow or a missing cooling-off notice is not one bad
contract — it is one bad contract *template* multiplied by the tenant count, in states whose
statutes Glide has not yet reviewed. Several states appear to make non-compliant contracts **void
or unenforceable with attorney's-fee exposure** (see §3).

### 🟠 RISK 3 — The current Terms of Service does not cover this model at all

`public/terms.html` is 118 lines and contains **no** card-on-file, auto-charge, off-session,
recurring-billing, or late-cancellation-fee language. Under ROSCA the material terms must be
disclosed *before* billing information is obtained, and express informed consent must be captured.
Today there is nothing to consent to. This must be written before a single card is saved.

### 🟡 RISK 4 — A late-cancellation fee is a hostile chargeback profile

A conditional, non-obvious charge that fires *after* the client decided not to attend is close to
the textbook "surprise charge" dispute. Critically, **Visa's Compelling Evidence 3.0 does not apply
to cancellation or service disputes** — it is limited to fraud code 10.4 (see §7). The strongest
remedy is evidentiary and operational (advance notice, timestamped policy consent, self-serve
cancel), not contractual.

### 🟡 RISK 5 — Charging clients on Glide's own Stripe account makes Glide the merchant of record

Under Stripe Connect, destination charges and separate charges/transfers put dispute liability on
the **platform's** balance; direct charges put it on the **connected account's**. If Glide bills
other trainers' clients on Glide's account, Glide absorbs those trainers' cancellation-fee disputes
and their effect on Glide's dispute-rate monitoring (see §8).

### 🟢 RISK 6 — Federal rule uncertainty is real but is *not* a safe harbor

The FTC "click-to-cancel" rule was vacated in July 2025, and the FTC moved toward new rulemaking in
January 2026. But ROSCA and FTC Act § 5 are untouched and fully enforceable, and state
auto-renewal laws are independent. The vacatur changes very little about what Glide must actually
build (see §5).

### ⭐ The strategic insight worth acting on

Florida's bond requirement has an exemption for studios that **collect on an ongoing periodic basis
rather than in advance** (§ 501.016(5), quoted in §2 below). Kevin's chosen v1 — the **Sunday
weekly batch that bills for sessions already delivered** — is structurally the *safer* model. It is
the **prepaid packs**, not the auto-charge, that drag the business into health-studio regulation.

**If the goal is to take money soonest with least legal exposure, ship Sunday post-payment billing
first and hold the prepaid packs until an attorney clears them.** That is close to the opposite of
the instinct to "sell packages up front," and it is the most actionable conclusion in this document.

---

## 2. Florida Health Studio Act — Fla. Stat. §§ 501.012–501.019

**Citation note:** the request referenced "ch. 501, Part IV." The health-studio sections
501.012–501.019 appear in the codification under **Part I (General Provisions)** of chapter 501, per
the Justia breadcrumb for the 2024 statutes. Confirm the correct part designation with counsel; the
section numbers are the reliable reference.

### 2.1 Definition of "health studio"

> "any person who is engaged in the sale of services for instruction, training, or assistance in a program of physical exercise or in the sale of services for the right or privilege to use equipment or facilities in furtherance of a program of physical exercise."

— Fla. Stat. § 501.0125.
[leg.state.fl.us](https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&Search_String=&URL=0500-0599/0501/Sections/0501.0125.html)
· [flsenate.gov](https://www.flsenate.gov/Laws/Statutes/2025/501.0125)

Note the first prong: **"sale of services for instruction, training, or assistance in a program of
physical exercise."** No facility is required for that prong. A mobile trainer selling training
services falls inside the definition on its face — the only thing pulling them out is the
personal-trainer carve-out below. **Confidence: HIGH** (two independent primary sources).

### 2.2 The personal-trainer exclusion — the pivotal provision

> "The term does not include an individual acting as a personal trainer."

Qualifying as a "personal trainer" requires meeting **all three** conditions:

> "(a) Who does not have an established place of business for the primary purpose of the conducting of physical exercise"
>
> "(b) Whose provision of exercise equipment is incidental to the instruction provided"
>
> "(c) Who does not accept payment for services that are to be rendered more than 30 days after the date of payment"

— Fla. Stat. § 501.0125. **Confidence: HIGH** (verified verbatim at both leg.state.fl.us and
flsenate.gov).

**Application to Glide's model:**

| Condition | Mobile trainer, pay-as-you-go | Mobile trainer selling 10-session packs |
|---|---|---|
| (a) no established place of business | ✅ likely met (mobile) | ✅ likely met |
| (b) equipment incidental | ✅ likely met | ✅ likely met |
| (c) no payment for services >30 days out | ✅ met — billed after delivery | ❌ **likely fails** |
| **Result** | Likely exempt | **Likely a regulated health studio** |

The Sunday-batch model bills *after* sessions are delivered, so nothing is paid for services more
than 30 days in the future. Prepaid packs are the opposite.

**Open question for counsel:** does a pack sold with, say, a 30-day expiry stay inside (c)? Does
(c) look at the *contractual right* to future service or at *actual* redemption timing? Is a pack
that is fully redeemable within 30 days but in practice used later compliant? **UNVERIFIED —
NEEDS FOLLOW-UP.** No case law or FDACS guidance on this point was located before research was cut
short.

### 2.3 Registration

> "Each health studio shall: (1) Register each of its business locations with the department in a form and manner as required by the department."
>
> "(2) Remit an annual registration fee of $300 to the department at the time of registration for each of the health studio's business locations."

Also required: file security under § 501.016, post the proof-of-registration certificate at the
registration/front desk, and **"Include the registration number issued by the department in all
printed advertisements, contracts, and publications."**

Fee waivers exist for honorably discharged veterans, active-duty military, spouses and surviving
spouses, and majority-owned business entities.

— Fla. Stat. § 501.015, [flsenate.gov](https://www.flsenate.gov/Laws/Statutes/2025/501.015).
**Confidence: HIGH.**

The registration-number-in-all-contracts-and-advertisements requirement has a direct product
implication: **if a trainer is a registered health studio, their registration number must appear in
Glide-generated contracts and marketing.** That is a per-tenant data field Glide does not currently
have.

**Note:** the fetched text of § 501.015 did **not** contain penalty provisions or any statement about
contract voidability for unregistered operation. **UNVERIFIED — NEEDS FOLLOW-UP:** what are the
consequences of operating unregistered in Florida, and is the consumer contract voidable? This is a
material question and was not resolved.

### 2.4 Surety bond / security

> "The principal sum of the bond must be $25,000."

Reduced amount available:

> "the department may reduce the principal amount of the surety bond ... to a sum of at least $10,000"

where aggregate outstanding contracts are less than $5,000 (annual membership report required).

Claims: **"submitted to the department within 120 days after an alleged injury has occurred."**

**The exemption that matters most:**

> "A health studio that sells contracts for future health studio services and collects direct payment on a monthly basis for those services is exempt from the security requirements"

— provided **"any service fee charged is reasonable and fair"** and **"the number of monthly payments in such a contract must be equal to the number of months in the contract."**

A "reasonable and fair service fee" is defined as **no more than 10 percent of the total contract
price**.

— Fla. Stat. § 501.016, [flsenate.gov](https://www.flsenate.gov/Laws/Statutes/2025/501.016);
definition of the fee cap at § 501.0125(5).
**Confidence: HIGH** on the quoted amounts and the existence of the monthly-payment exemption.

**Application:** this exemption is built for pay-as-you-go, not prepayment. Glide's Sunday weekly
batch bills in arrears, which is *directionally* what this exemption rewards — **but the statute
says "on a monthly basis," and Glide bills weekly.** Whether weekly-in-arrears satisfies a
"monthly" exemption is **UNVERIFIED — NEEDS FOLLOW-UP** and is a specific question for counsel
(§10). Do not assume weekly qualifies just because it is more consumer-friendly than monthly.

### 2.5 Contract requirements — cooling-off, term, refunds

| Requirement | Statutory text / value |
|---|---|
| Cooling-off period | **"3 days, exclusive of holidays and weekends"** for penalty-free cancellation on written notice |
| Refund deadline | **"A refund shall be issued within 30 days after receipt of the notice of cancellation"** |
| Max initial term | **"The initial contract will not be for a period in excess of 36 months, and thereafter shall only be renewable annually."** |
| Renewal timing | **"A renewal contract may not be executed and the fee therefor paid until 60 days or less before the previous contract expires."** |
| Cancellation method | **"written notice to the health studio"** via mailing or delivery |
| Prepayment warning (exempt studios) | **"SHOULD YOU (THE BUYER) CHOOSE TO PAY FOR MORE THAN 1 MONTH OF THIS AGREEMENT IN ADVANCE, BE AWARE THAT YOU ARE PAYING FOR FUTURE SERVICES..."** |

— Fla. Stat. § 501.017,
[leg.state.fl.us](https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&Search_String=&URL=0500-0599/0501/Sections/0501.017.html).
**Confidence: HIGH** on these values; **MEDIUM** on completeness — the fetch summarized rather than
reproducing every required contract provision. The full required-provisions list (including any
typeface/font requirements and death/disability/relocation cancellation rights) should be read in
full from the statute before drafting. **NEEDS FOLLOW-UP.**

Two product consequences if a trainer is a regulated health studio:

1. **A 3-business-day cooling-off right applies to pack purchases.** Glide's Checkout flow must
   present the required notice and support penalty-free cancellation with a refund inside 30 days.
   Nothing in the current build does this.
2. **"Written notice" is the statutory cancellation channel.** A cancel button is good practice but
   may not be sufficient on its own — counsel should confirm whether in-app written notice
   satisfies § 501.017.

### 2.6 Does the Act reach Glide itself, or only the trainer?

**UNVERIFIED — NEEDS FOLLOW-UP.** The definition reaches "any person who is engaged in the sale of
services for instruction, training..." Whether a SaaS platform that hosts the offer, captures
consent, stores the card, and initiates the charge is "engaged in the sale" — or is merely a
technology provider — was **not** resolved by this research. This is a first-order question for
counsel because the answer determines whether Glide needs its own registration and bond, or whether
the obligation sits entirely with each trainer.

### 2.7 Recent amendments

**UNVERIFIED — NEEDS FOLLOW-UP.** No check for 2024–2026 amendments to §§ 501.012–501.019 was
completed. The statutes were read from the 2025 compilation.

---

## 3. Other states' health-club statutes

**⚠️ COVERAGE WARNING:** research was cut short here. **Only California was verified.** The
multi-state survey (NY, TX, IL, MD, OH, MA, NJ, PA, MI, WA, VA, GA, NC, AZ, CO) was **not
completed.** The table below deliberately contains only what was actually checked. Do not
white-label into any state not listed here without a state-specific review.

### California — verified

California's Health Studio Services Contract Law, **Cal. Civ. Code §§ 1812.80–1812.97**:

| Item | Finding |
|---|---|
| Cooling-off | **5 business days** (longer than Florida's 3) |
| Written notice of the right | Required at time of contract |
| Refund deadline | **10 days** after receiving cancellation notice |
| Max term | **36 months** |
| Refund on cancellation | Pro rata over the contract term; consumer liable only for the portion available for use |
| Death / disability | Contract must allow cancellation |
| Relocation | Cancellable if member moves **>25 miles**; cancellation fee capped at **$100** ($50 if more than half the contract has run) |
| Consequence of non-compliance | Reported to render member agreements **void**, with exposure to significant damages **and attorney's fees** |

Sources: [CA DCA Legal Guide W-10](https://www.dca.ca.gov/publications/legal_guides/w_10.shtml) ·
[Cal. Civ. Code § 1812.85 (FindLaw)](https://codes.findlaw.com/ca/civil-code/civ-sect-1812-85/) ·
[2025 Civ. Code Title 2.5 (Justia)](https://law.justia.com/codes/california/code-civ/division-3/part-4/title-2-5/) ·
[leginfo.legislature.ca.gov](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=CIV&division=3.&title=2.5.&part=4.)

**Confidence: MEDIUM-HIGH.** The statutory citation and the DCA guide are authoritative; the
"void + attorney's fees" consequence came from a law-firm summary
([Crown LLP](https://crownllp.com/blog/health-club-contracts-compliance-with-the-california-health-studio-services-contract-law/))
and is **secondary** — verify against primary text.

**Critically:** the California source states the law applies to health clubs **"of any size"**
wishing to enter term membership agreements. Whether California has a personal-trainer carve-out
comparable to Florida's § 501.0125 was **NOT determined. NEEDS FOLLOW-UP** — this is the single
most important open item for the second state Glide enters.

### The general pattern (from the two states verified + widely reported structure)

Recurring elements across health-club statutes appear to be: a mandatory cooling-off period
(3–5 business days), a maximum contract term (commonly 36 months), prepayment limits, registration
and/or surety bond or trust-account requirements, mandatory cancellation rights on death,
disability, relocation and facility closure, required contract disclosure language (sometimes with
typeface requirements), and automatic-renewal restrictions.

**Confidence: LOW-MEDIUM as a generalization.** Two states is not a survey. Treat this paragraph as
a hypothesis to test, not a finding.

### Not researched — explicit gaps

- **NY, TX, IL, MD, OH** and all other states: **NOT RESEARCHED.**
- **Which states are strictest:** **NOT DETERMINED.** The request asked for this and it was not
  reached.
- **State automatic-renewal laws (ARLs)** — including California's ARL and any 2025/2026 amendments,
  and New York's GBL provisions: **NOT RESEARCHED.** These may bite harder than the fitness statutes
  for an auto-charge model and should be a priority in the next research pass.
- **Whether other states' definitions require physical premises** (the crux for mobile trainers):
  **NOT DETERMINED** outside Florida.

---

## 4. Stripe card-on-file / off-session (merchant-initiated) requirements

### 4.1 Mechanics

- Save a card **without** an immediate payment: **SetupIntents API**, `usage: off_session`.
- Save a card **during** a payment: `setup_future_usage: off_session` on the PaymentIntent.
- When the flow is set up correctly, "Stripe marks any subsequent off-session payment as a
  merchant-initiated transaction (MIT) to reduce the need to authenticate."
- Authenticate the card **at save time**, then flag later charges as off-session.

Sources: [Setup Intents API](https://docs.stripe.com/payments/setup-intents) ·
[CITs and MITs](https://docs.stripe.com/payments/cits-and-mits) ·
[on-session vs off-session](https://support.stripe.com/questions/what-is-the-difference-between-on-session-and-off-session-and-why-is-it-important)
**Confidence: HIGH** (Stripe primary docs).

### 4.2 The mandate — what Stripe requires you to disclose

> "Merchant-initiated transactions require an agreement (also known as a mandate) between you and your customer. Add terms to your website or application on how you plan to process payments that your customer can opt into."

Stripe's stated minimum for those terms:

> "At a minimum, make sure that your terms cover the following: The customer's permission for you to initiate a payment or a series of payments on their behalf · The anticipated frequency of payments (that is, one-time or recurring)"

— [docs.stripe.com/payments/cits-and-mits](https://docs.stripe.com/payments/cits-and-mits).
**Confidence: HIGH.**

**This is the concrete requirement Glide currently fails.** There is no mandate text anywhere in the
product today. At minimum Glide must present, and record consent to, terms covering: permission to
initiate charges, the frequency (weekly, on Sundays), how the amount is determined (sessions
completed × trainer-set price, plus any late-cancellation fee at the trainer's stated percentage),
and how to cancel.

### 4.3 Variable / conditional amounts

The planned charge is variable (N sessions × price) and partly conditional (late-cancel fee fires
only on a qualifying cancellation). Stripe's documented minimum covers permission and frequency but
the research **did not locate specific Stripe guidance on conditional or variable-amount mandate
disclosure**. **UNVERIFIED — NEEDS FOLLOW-UP.** Practically, disclosing *how the amount is
determined* (not just that charges will occur) is the conservative approach and aligns with ROSCA's
"all material terms."

### 4.4 Not researched

- Stripe's **legal agreement** language (as distinct from docs) on platform/merchant obligations:
  **NOT RESEARCHED.**
- Whether Stripe treats **prepayment for future services** as elevated risk affecting reserves or
  payouts: **NOT RESEARCHED** — this matters for the packs feature and should be checked.
- SCA/3DS relevance for a US-only business: **NOT RESOLVED** (largely EU-facing, but unconfirmed).

---

## 5. FTC Negative Option / "click-to-cancel" status in 2026, and ROSCA

### 5.1 Timeline

- **July 8, 2025** — the **Eighth Circuit vacated** the FTC's revised Negative Option Rule
  ("click-to-cancel," 16 CFR Part 425), days before the compliance deadline. The stated ground was
  procedural: the FTC's failure to conduct a **preliminary regulatory analysis** of costs, benefits
  and alternatives as required under **Section 22 of the FTC Act** — described as a "fatal" error.
- **January 30, 2026** — the FTC announced it had submitted a draft **Advance Notice of Proposed
  Rulemaking (ANPRM)** on negative option plans to OIRA/OMB. Expected sequence: publication, then a
  60–90 day comment period, then a further 30–90 day comment period on proposed regulatory text.
- **As of this research (July 2026):** the vacated rule is **not in effect**, and any replacement is
  still at the pre-proposal stage.

Sources (all **secondary** — law-firm client alerts):
[WilmerHale](https://www.wilmerhale.com/en/insights/client-alerts/20250801-eighth-circuit-vacates-the-ftcs-click-to-cancel-rule-but-federal-and-state-regulators-likely-to-remain-active) ·
[Crowell (vacatur)](https://www.crowell.com/en/insights/client-alerts/eighth-circuit-cancels-click-to-cancel) ·
[Crowell (revival/ANPRM)](https://www.crowell.com/en/insights/client-alerts/clicking-all-the-right-boxes-ftc-moves-to-revive-click-to-cancel-rule-following-eighth-circuit-vacatur) ·
[Latham](https://www.lw.com/en/insights/eighth-circuit-vacates-ftc-click-to-cancel-rule-days-before-compliance-deadline) ·
[Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/07/click-to-cancelled-eighth-circuit-vacates-federal-trade-commissions-revised-negative-option-rule) ·
[DLA Piper](https://www.dlapiper.com/en-us/insights/publications/2025/07/ftcs-click-to-cancel-rule-voided)

**Confidence: HIGH** on the vacatur and its date/reasoning (six independent firms agree).
**Confidence: MEDIUM** on the January 2026 ANPRM detail — sourced from one firm alert; the
**case name and citation were not captured**, and the ANPRM was **not confirmed against ftc.gov or
the Federal Register**. **NEEDS FOLLOW-UP.**

### 5.2 What still binds regardless — ROSCA

ROSCA (15 U.S.C. § 8403) is untouched by the vacatur. It requires marketers to:

1. **"provide text that clearly and conspicuously discloses all material terms of the transaction before obtaining the consumer's billing information"**
2. **"obtain a consumer's express informed consent before charging the consumer's credit card, debit card, bank account, or other financial account"**
3. **"provide simple mechanisms for a consumer to stop recurring charges"**

Supporting standards from FTC guidance:

- *Clear and conspicuous* — disclosures "should stand out," be "on the same webpage... in close
  proximity to the triggering representation, and viewable without requiring the consumer to scroll
  up, down or sideways."
- *Express informed consent* — the consumer "was presented with the material terms in a clear and
  conspicuous manner and then took an affirmative action unambiguously manifesting agreement to
  those specific terms."
- *Simple cancellation* — "cancellation should be at least as easy as signup," without
  "unreasonable delays."

Sources: [15 U.S.C. § 8403 (Cornell LII)](https://www.law.cornell.edu/uscode/text/15/8403) ·
[Federal Register — Negative Option Rule](https://www.federalregister.gov/documents/2023/04/24/2023-07035/negative-option-rule) ·
[deceptive.design ROSCA §4](https://deceptive.design/laws/section-4-of-rosca-15-u-s-c-ss-8403/)
**Confidence: HIGH** on the three statutory requirements; **MEDIUM** on the gloss, which came partly
from secondary compliance guides.

Also live: **FTC Act § 5** and state UDAP statutes.

### 5.3 Does this even apply to a late-cancellation fee?

**GENUINELY UNSETTLED — flagged rather than resolved.** A late-cancellation fee is not a classic
subscription: it is a pre-authorized, conditional, event-triggered charge. Whether that is a
"negative option feature" / continuity plan, or better characterized as pre-authorized one-off
billing, was **not resolved by this research** and no source addressed it directly.

The conservative reading — and the one to build to — is that ROSCA's three requirements
(disclose materially before taking billing info, capture express informed consent, provide a simple
stop mechanism) are cheap to satisfy and should be satisfied regardless of how the charge is
classified. **Confidence in the conservative approach: HIGH. Confidence in the classification
question: NONE — needs counsel.**

---

## 6. E-SIGN and enforceable checkbox agreements

### 6.1 What makes a clickwrap enforceable

Courts evaluate **(1) reasonable notice of the terms** and **(2) unambiguous manifestation of
assent**. Practical requirements reported: conspicuous, accessible terms; clear fonts and
contrasting colors; plain language; terms available **before** assent; an affirmative act (checking
a box, clicking an "I agree" button) that is unambiguous.

The clickwrap (affirmative click, generally enforceable) vs browsewrap (buried link, often
unenforceable) distinction is the central one. UETA (adopted by 49 states) and the federal E-SIGN
Act (2000) establish that electronic records and signatures are equivalent to paper "provided they
demonstrate intent to sign."

Sources (**secondary** — vendor and law-firm guidance):
[Ironclad — 6 components of clickwrap enforceability](https://ironcladapp.com/journal/contract-management/6-components-of-clickwrap-enforceability) ·
[Goodwin — recent decisions on electronic contracts](https://www.goodwinlaw.com/en/insights/publications/2022/08/08_10-recent-court-decisions-shed-light) ·
[Caldwell — wrap agreements across jurisdictions](https://caldwelllaw.com/news/enforceability-online-wrap-agreements-us-uk-japan/) ·
[Oklahoma Bar Association](https://www.okbar.org/barjournal/apr2017/obj8811wedmanrother/)

**Confidence: MEDIUM.** The doctrine is stated consistently across sources, but **no leading case
was captured with a name, citation and date**, and **the E-SIGN Act text (15 U.S.C. § 7001) was not
quoted or verified.** In particular the § 7001(c) consumer-consent-to-electronic-records
requirement — which has specific disclosure preconditions — was **NOT researched.**
**NEEDS FOLLOW-UP.**

### 6.2 Evidence to retain

> "Courts have ruled that without proof of who accepted which version of your terms, the agreement is not enforceable, requiring comprehensive backend records tracking each user's acceptance timestamp, agreement version, and acceptance data."

Reported best practice: detailed logs of user interactions including **timestamps and IP addresses**.
— [Ironclad](https://ironcladapp.com/journal/contract-management/6-components-of-clickwrap-enforceability),
secondary.

**Recommended record shape for Glide** (engineering judgment, informed by the above — not a legal
standard):

| Field | Why |
|---|---|
| `uid` | who agreed |
| `agreedAt` (server timestamp) | when — must be server-side, not client-supplied |
| `ip`, `userAgent` | corroboration |
| `termsVersion` (e.g. `sessions-billing-v1`) | which text |
| `termsHash` (SHA-256 of exact rendered text) | proves the text was not altered later |
| `renderedSnapshot` or immutable versioned copy | reproduces what they actually saw |
| `policySnapshot` (the trainer's `sessionPolicy` at that moment) | **critical** — trainer policies are mutable; the fee terms consented to must be frozen |
| `consentSurface` (which screen/flow) | context |

**The `policySnapshot` point deserves emphasis.** `sessionPolicy` and `sessionPacks` live on the
trainer's profile and are deliberately editable by the trainer (per `SESSIONS-BILLING-PLAN.md`). If
a trainer changes their late-cancel window or fee percentage after a client consented, the client
consented to *different terms than they are billed under*. Glide should snapshot the policy into
the consent record and into each session, and re-consent on material change.

**E-SIGN retention/reproducibility requirements** (whether the consumer must be able to retain the
record): **NOT RESEARCHED. NEEDS FOLLOW-UP.**

---

## 7. Non-waivable rights and defending a late-cancellation-fee dispute

### 7.1 Rights that a terms checkbox cannot waive

**Card-network chargeback rights and Regulation Z billing-error rights run between the *cardholder
and their issuer*, not between merchant and cardholder.** A merchant's terms of service is not a
contract the issuer is party to and cannot extinguish the cardholder's right to dispute.

**Confidence: MEDIUM — stated as the well-established general principle, but NOT verified against
primary sources in this research.** Specifically:

- **Reg Z § 1026.13 (billing error resolution)** and **§ 1026.12(c) (claims and defenses)** — the
  regulatory text, timeframes, and the dollar/distance limitations on § 1026.12(c) were
  **NOT researched or quoted. NEEDS FOLLOW-UP.**

Do not rely on this section as written; it needs a proper pass.

### 7.2 The Compelling Evidence 3.0 trap — an important correction

A natural assumption is that Visa's Compelling Evidence 3.0 helps defend these disputes. **It does
not apply here.**

> "CE3.0 applies only to disputes marked with Visa reason code 10.4: Other Fraud: Card-Absent Environment."
>
> CE 3.0 "does not apply to product disputes, service disputes, processing errors, cancellations, or non-fraud related chargeback categories."

Visa began automatically qualifying transactions for CE3.0 using Visa Secure or Visa Data Only
across all major regions from **October 17, 2025**.

Sources: [Visa — Compelling Evidence 3.0 Merchant Readiness (PDF)](https://usa.visa.com/content/dam/VCOM/regional/na/us/support-legal/documents/compelling-evidence-3.0-merchant-readiness-mar2023.pdf) ·
[Checkout.com](https://www.checkout.com/blog/visa-compelling-evidence-3-0) ·
[Chargeback Gurus](https://www.chargebackgurus.com/blog/visa-compelling-evidence-3-0)
**Confidence: MEDIUM-HIGH** on the scope limitation (consistent across sources incl. a Visa PDF);
**LOW** on 2026 currency — the Visa document is dated March 2023 and network rules change.

**A late-cancellation-fee dispute is a cancellation/service dispute, so the CE3.0 safety net is
unavailable.** Defense rests entirely on ordinary representment evidence.

**Specific reason codes** (Visa 13.x family, Mastercard equivalents) for cancelled recurring /
services-not-provided were **NOT confirmed. NEEDS FOLLOW-UP** — a search for code 13.7 specifically
returned no authoritative confirmation.

### 7.3 Documentation that best defends the fee (engineering recommendation)

Not verified against network rulebooks — this is a build recommendation derived from the consent and
evidence principles above:

1. The timestamped consent record with `termsHash` and `policySnapshot` (§6.2).
2. Proof the cancellation policy was disclosed **at booking** and **again at purchase** — Glide
   already renders the policy in the Sessions panel for both sides.
3. The booking record with its creation timestamp.
4. The **server-pinned `cancelledAt`** relative to the policy window. `SESSIONS-BILLING-PLAN.md`
   already pins `cancelledAt` to server time ±5 min — that control was built as an anti-fraud
   measure and doubles as the single most important piece of dispute evidence.
5. Proof the exact dollar fee was shown **before** the irreversible tap (the "Cancel & accept
   charge" button already does this) — ideally a stored snapshot of that confirmation.
6. Advance notice/reminders sent before the Sunday charge, with delivery evidence.
7. Card-on-file mandate acceptance record.
8. Evidence of prior successful sessions/usage by the same client.

### 7.4 Chargeback monitoring thresholds

**NOT RESEARCHED. NEEDS FOLLOW-UP.** Current Visa VAMP / Mastercard ECP ratio thresholds for
2025–2026 were not confirmed. Stripe's Connect docs do note that when the platform is merchant of
record, "card networks such as Visa and Mastercard monitor your dispute rates. If you exceed their
thresholds, you could enter monitoring programs that might impose fines"
([Stripe](https://docs.stripe.com/connect/disputes)).

### 7.5 Operational mitigations (highest-leverage, lowest-cost)

Advance notice before every charge; itemized receipts; a clear statement descriptor naming the
trainer; genuinely self-serve cancellation; a grace period; and a refund-first posture on
good-faith complaints. For this business model these will prevent far more loss than any contract
clause.

---

## 8. Platform vs merchant liability — Stripe Connect

### 8.1 Verified liability allocation

| Charge type | Merchant of record | Who is debited for a dispute |
|---|---|---|
| **Direct charges** | The **connected account** (the trainer) | "Stripe debits the disputed amount from the connected account's balance, **not your platform's balance**" |
| **Destination charges** | The **platform** | "your platform balance is automatically debited for the disputed amount and fee" |
| **Separate charges & transfers** | The **platform** | Same as destination |

> "Direct charges make your connected accounts the merchant of record and allow them to handle their own refunds and disputes."

> "Your platform is ultimately liable for chargebacks and related costs for both destination charges and separate charges and transfers."

Sources: [Disputes on Connect platforms](https://docs.stripe.com/connect/disputes) ·
[Merchant of record in a Connect integration](https://docs.stripe.com/connect/merchant-of-record) ·
[Understand how charges work in Connect](https://docs.stripe.com/connect/charges) ·
[Recommended Connect integrations and charge types](https://docs.stripe.com/connect/integration-recommendations)
**Confidence: HIGH** (Stripe primary docs).

### 8.2 What this means for Glide

**For the white-label multi-tenant phase, direct charges on each trainer's connected account is the
structure that most limits Glide's exposure** to that trainer's cancellation practices: the trainer
is merchant of record, holds the customer relationship, and absorbs their own disputes and dispute-rate
monitoring.

The trade-off is that direct charges give Glide less control over the checkout experience and mean
the trainer's name (not Glide's) appears on the statement — which is arguably *correct* here anyway,
since the client contracted with the trainer for training, and it makes the statement descriptor
match the client's expectation (itself a dispute-reduction win).

**Important caveat:** dispute *liability* allocation is not the same as *regulatory* liability. Even
with direct charges, Glide designed the flow, wrote the consent text, and initiated the charge. §5's
ROSCA obligations and §2's health-studio questions are not obviously solved by charge-type
selection. **Whether the charge structure affects Glide's exposure under consumer-protection law
(as opposed to card-network loss allocation) is UNVERIFIED and is a question for counsel.**

### 8.3 Not researched

- **Stripe Connect Platform Agreement / Services Agreement** language on platform obligations to
  monitor connected accounts and platform liability for connected-account losses and negative
  balances: **NOT RESEARCHED. NEEDS FOLLOW-UP.** There is widely-reported language making platforms
  ultimately responsible for connected-account losses even under direct charges; this was **not
  verified** and materially affects the §8.2 conclusion.
- Onboarding/KYC and Connect account-type implications (Standard vs Express vs Custom): not covered.

### 8.4 The single-tenant phase

Per `SESSIONS-BILLING-PLAN.md`, phase 3 is single-tenant: Kevin charging his own clients on his own
Stripe account. No Connect, no platform-vs-merchant question — Kevin is simply the merchant. **The
Connect analysis above only becomes load-bearing at multi-tenant.** That sequencing is helpful: it
buys time to get §8.3 verified before it matters.

---

## 9. "Must do before taking real money" checklist

### Blocking — do not charge a card until these are done

- [ ] **Attorney review of the Florida personal-trainer exemption question (§2.2)** — specifically
      whether prepaid packs break condition (c). This gates whether packs can ship at all.
- [ ] **Decide the launch scope.** Strong recommendation from this research: **ship Sunday
      post-payment billing first; hold `STARTER_PACKS` until cleared.** Post-payment billing does not
      obviously implicate the >30-day advance-payment condition.
- [ ] **Write session-billing terms** covering, at minimum: permission to initiate charges, the
      weekly Sunday frequency, how the amount is determined (sessions × trainer price), the
      trainer's late-cancellation window and fee, decline/lockout consequences, and how to cancel.
      Stripe's mandate minimum (§4.2) and ROSCA's material-terms requirement (§5.2) both demand this.
- [ ] **Build the consent record** with the fields in §6.2 — server timestamp, IP, `termsVersion`,
      `termsHash`, and a **`policySnapshot` of the trainer's `sessionPolicy` at consent time.**
- [ ] **Disclose all material terms BEFORE the card is collected**, not after — ROSCA is explicit
      that disclosure precedes obtaining billing information.
- [ ] **Build a simple, self-serve cancellation mechanism** at least as easy as signup (ROSCA).
- [ ] **Implement SetupIntent with `usage: off_session`** and authenticate at save time (§4.1).
- [ ] **Re-consent on material policy change** — a trainer editing their fee or window must not
      silently rebind existing clients.

### Strongly recommended before launch

- [ ] Advance notice before each Sunday charge (email/push, with delivery evidence retained).
- [ ] Itemized receipt after each charge showing each session billed.
- [ ] Statement descriptor that names the trainer/business the client recognizes.
- [ ] Store the cancel-confirmation snapshot (the screen showing the exact fee) alongside the session.
- [ ] Keep everything in **Stripe TEST mode** until the terms and consent record are live and reviewed.
- [ ] Add a `registrationNumber` field per trainer (§2.3) — required in contracts and advertisements
      for registered health studios.

### Before white-labeling to a second state

- [ ] Complete the multi-state survey that this research did not finish (§3) — at minimum the
      trainer's own state before onboarding them.
- [ ] Research state automatic-renewal laws (§3, not researched).
- [ ] Determine whether each target state has a personal-trainer carve-out comparable to Florida's.
- [ ] Decide Connect charge type — **direct charges** appear to best limit platform dispute
      liability (§8.2), pending §8.3 verification.
- [ ] Consider gating pack sales by state until each state is cleared.

### Follow-up research owed (gaps in this document)

- [ ] Reg Z § 1026.12(c) / § 1026.13 primary text (§7.1)
- [ ] E-SIGN 15 U.S.C. § 7001, especially § 7001(c) (§6.1)
- [ ] FTC ANPRM confirmation on ftc.gov / Federal Register + the Eighth Circuit case citation (§5.1)
- [ ] Stripe Connect legal agreement on platform liability for connected accounts (§8.3)
- [ ] Florida penalties for unregistered operation / contract voidability (§2.3)
- [ ] Full § 501.017 required-provisions list (§2.5)
- [ ] Visa/Mastercard reason codes for cancelled recurring; VAMP/ECP thresholds (§7.2, §7.4)
- [ ] 2024–2026 amendments to §§ 501.012–501.019 (§2.7)

---

## 10. Questions for a licensed attorney

**Florida — highest priority**

1. Does selling a prepaid multi-session package cause a mobile personal trainer to fail
   § 501.0125's condition (c) ("does not accept payment for services that are to be rendered more
   than 30 days after the date of payment"), thereby making them a regulated "health studio"?
2. Does a pack with a **30-day expiry** stay inside condition (c)? Does (c) look at the contractual
   right to future service, or at actual redemption timing?
3. If a trainer is a health studio, does a **mobile** trainer have a "business location" to register
   under § 501.015, and what address is used? Is the $300 fee per client location, per vehicle, per
   home office?
4. Does § 501.016(5)'s exemption for studios that "collect direct payment on a **monthly** basis"
   cover Glide's **weekly** Sunday-in-arrears billing? If not, can billing be restructured to
   qualify?
5. Is a **late-cancellation fee** itself a "contract for future health studio services," or a
   separate service charge outside the Act?
6. What are the penalties for operating unregistered/unbonded in Florida, and **is the consumer
   contract void or voidable**? (Not resolved by this research.)
7. Does in-app written notice satisfy § 501.017's "written notice to the health studio" cancellation
   requirement?

**Platform status — first-order**

8. Is Glide itself "engaged in the sale of services for instruction, training..." under § 501.0125
   — i.e. does the **platform** need its own registration and bond — or does the obligation sit
   solely with each trainer?
9. Does Glide take on liability by **authoring the contract templates and consent flow** that
   trainers rely on? Should the terms be Glide-authored, trainer-authored, or co-branded?
10. Should Glide's ToS disclaim responsibility for trainers' compliance, and is such a disclaimer
    effective against a *consumer* (as opposed to against the trainer)?

**Multi-state**

11. Which states should be cleared before white-label launch, and should pack sales be
    geo-gated until each is reviewed?
12. Does California's Health Studio Services Contract Law have a personal-trainer carve-out
    comparable to Florida's? (California reportedly applies to clubs "of any size.")
13. Which state auto-renewal laws apply to a weekly variable charge, and do any require
    click-to-cancel-style mechanics independent of the vacated federal rule?

**Billing & consent**

14. Is a conditional late-cancellation fee a "negative option feature" subject to negative-option
    rules, or pre-authorized one-off billing? (Genuinely unsettled — §5.3.)
15. Is Glide's proposed consent record (timestamp, IP, `termsVersion`, `termsHash`,
    `policySnapshot`) sufficient to prove assent to a *specific version* of a *specific trainer's*
    policy?
16. What must happen when a trainer changes their cancellation policy — is affirmative re-consent
    required for existing clients, and can prior consent cover future modified terms?
17. Is there exposure in the **decline → `sessionBillingHold` → blocked from booking** flow (e.g.
    debt-collection or unfair-practices characterization)?
18. Are there caps on what a late-cancellation fee may be, or does a 100%-of-price fee risk being an
    unenforceable **penalty** rather than liquidated damages?

**Structure**

19. Does Stripe Connect **direct charges** (trainer as merchant of record) meaningfully limit
    Glide's liability for a trainer's cancellation practices — or only its card-network loss
    allocation?
20. Does the Stripe Connect Platform Agreement make Glide liable for connected-account losses even
    under direct charges? (Unverified — §8.3.)
21. Should trainers be required to carry insurance, or to indemnify Glide, as a condition of using
    session billing?

---

## Appendix — source list

**Florida statutes (primary)**
- [§ 501.0125 — leg.state.fl.us](https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&Search_String=&URL=0500-0599/0501/Sections/0501.0125.html)
- [§ 501.0125 — flsenate.gov](https://www.flsenate.gov/Laws/Statutes/2025/501.0125)
- [§ 501.015 — flsenate.gov](https://www.flsenate.gov/Laws/Statutes/2025/501.015)
- [§ 501.016 — flsenate.gov](https://www.flsenate.gov/Laws/Statutes/2025/501.016)
- [§ 501.017 — leg.state.fl.us](https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&Search_String=&URL=0500-0599/0501/Sections/0501.017.html)
- [FDACS Health Studio Registration Application Guide (PDF)](https://ccmedia.fdacs.gov/content/download/116042/file/Health-Studio-Registration-Application-Guide.pdf)

**California**
- [CA DCA Legal Guide W-10](https://www.dca.ca.gov/publications/legal_guides/w_10.shtml)
- [Cal. Civ. Code § 1812.85 (FindLaw)](https://codes.findlaw.com/ca/civil-code/civ-sect-1812-85/)
- [Cal. Civ. Code Title 2.5, 2025 (Justia)](https://law.justia.com/codes/california/code-civ/division-3/part-4/title-2-5/)

**Federal**
- [15 U.S.C. § 8403 — ROSCA (Cornell LII)](https://www.law.cornell.edu/uscode/text/15/8403)
- [Federal Register — Negative Option Rule](https://www.federalregister.gov/documents/2023/04/24/2023-07035/negative-option-rule)

**Stripe (primary docs)**
- [Setup Intents API](https://docs.stripe.com/payments/setup-intents)
- [CITs and MITs](https://docs.stripe.com/payments/cits-and-mits)
- [Disputes on Connect platforms](https://docs.stripe.com/connect/disputes)
- [Merchant of record in Connect](https://docs.stripe.com/connect/merchant-of-record)
- [How charges work in Connect](https://docs.stripe.com/connect/charges)
- [Recommended Connect integrations](https://docs.stripe.com/connect/integration-recommendations)

**Card networks**
- [Visa — Compelling Evidence 3.0 Merchant Readiness (PDF, Mar 2023)](https://usa.visa.com/content/dam/VCOM/regional/na/us/support-legal/documents/compelling-evidence-3.0-merchant-readiness-mar2023.pdf)

**Secondary — law firm alerts (FTC rule)**
- [WilmerHale](https://www.wilmerhale.com/en/insights/client-alerts/20250801-eighth-circuit-vacates-the-ftcs-click-to-cancel-rule-but-federal-and-state-regulators-likely-to-remain-active)
- [Crowell — vacatur](https://www.crowell.com/en/insights/client-alerts/eighth-circuit-cancels-click-to-cancel)
- [Crowell — revival/ANPRM](https://www.crowell.com/en/insights/client-alerts/clicking-all-the-right-boxes-ftc-moves-to-revive-click-to-cancel-rule-following-eighth-circuit-vacatur)
- [Latham](https://www.lw.com/en/insights/eighth-circuit-vacates-ftc-click-to-cancel-rule-days-before-compliance-deadline)
- [Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/07/click-to-cancelled-eighth-circuit-vacates-federal-trade-commissions-revised-negative-option-rule)
- [DLA Piper](https://www.dlapiper.com/en-us/insights/publications/2025/07/ftcs-click-to-cancel-rule-voided)

**Secondary — clickwrap / chargebacks**
- [Ironclad — clickwrap enforceability](https://ironcladapp.com/journal/contract-management/6-components-of-clickwrap-enforceability)
- [Goodwin — electronic contract decisions](https://www.goodwinlaw.com/en/insights/publications/2022/08/08_10-recent-court-decisions-shed-light)
- [Checkout.com — Visa CE 3.0](https://www.checkout.com/blog/visa-compelling-evidence-3-0)
- [Chargeback Gurus — Visa CE 3.0](https://www.chargebackgurus.com/blog/visa-compelling-evidence-3-0)

---

*Research findings only. Not legal advice. Requires review by licensed counsel before Glide accepts
payment under this model.*
