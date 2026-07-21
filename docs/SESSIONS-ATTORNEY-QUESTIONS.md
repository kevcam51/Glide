# Legal review request — trainer session billing (card-on-file, auto-charge, late-cancel fees, prepaid packs)

**Prepared for:** a licensed Florida attorney (+ payments/consumer-finance counsel where noted)
**Business:** Smooth Training / Glide — a fitness SaaS platform. Owner-operator based in Miami, FL.
**Date prepared:** _[fill in before sending]_

> **How this was prepared:** the questions below were assembled from our own primary-source research
> (Florida Statutes §§ 501.012–501.019, California Civil Code §§ 1812.80–1812.97, 15 U.S.C. § 8403
> (ROSCA), and Stripe/Visa documentation). It is **not legal advice** and several points are flagged
> as unverified. We are asking you to confirm, correct, and advise. Citations are provided so you can
> go straight to the text.

---

## 1. What we are building (context)

Glide lets a personal trainer bill a client for training **sessions**, three ways:

1. **Auto-charge in arrears (our intended v1).** The trainer books sessions; after each session's
   scheduled end passes, Glide totals what's owed and charges the client's **card on file** — either
   as each session passes or in one **weekly (Sunday) batch for sessions already delivered**. No money
   is taken before a session happens.
2. **Late-cancellation / no-show fees.** If a client cancels inside the trainer's stated notice
   window (trainer-set: e.g. 24h), or no-shows, a fee (a trainer-set % of the session price) is
   charged to the card on file. A trainer-initiated cancellation is never charged.
3. **Prepaid packages (planned, not yet sold).** A client pre-pays for N sessions (e.g. 4/8/12);
   credits are consumed as sessions occur. **We have NOT launched this and will not until you clear
   it** — we understand it is the highest-risk piece.

**Card handling:** the client's card is saved via Stripe-hosted checkout (SetupIntent). Glide never
sees card numbers. Charges are off-session, card-on-file (MIT).

**What we already built for consent/evidence** (please tell us if it's sufficient or what's missing):
- A standardized cancellation-policy disclosure shown on every checkout, generated from the trainer's
  own settings (notice window, fee %, billing cadence).
- A checkbox consent line authorizing the saved-card charges, captured with a **server-side
  timestamp + IP + user-agent + a frozen snapshot of the exact policy text and version** the client
  agreed to (so a later policy edit can't retroactively change what was agreed).
- Dispute-evidence generation that spells out the cancellation-lateness arithmetic.
- Self-serve cancellation in the app. **No "no chargebacks" clause anywhere** (we understand that is
  unenforceable and violates card-network rules).

**The two go/no-go decisions we need:**
- **(A)** Can we turn on the **auto-charge / late-fee** model (item 1–2) for our own Florida clients,
  and what must our Terms of Service say first?
- **(B)** Can we ever sell **prepaid packages** (item 3), and under what structure (e.g. a service
  window)?

---

## 2. Questions — Florida (highest priority)

1. Does selling a prepaid multi-session package cause a mobile personal trainer to fail
   **§ 501.0125's condition (c)** ("does not accept payment for services that are to be rendered more
   than 30 days after the date of payment"), thereby making them a regulated "health studio"?
2. Does a pack with a **30-day expiry** stay inside condition (c)? Does (c) look at the contractual
   right to future service, or at actual redemption timing? Is a pack fully redeemable within 30 days
   but in practice used later still compliant?
3. If a trainer becomes a health studio, does a **mobile** trainer have a "business location" to
   register under § 501.015, and what address is used? Is the $300 fee per client location, per
   vehicle, per home office?
4. Does **§ 501.016(5)'s** exemption for studios that "collect direct payment on a **monthly** basis"
   cover our **weekly** Sunday-in-arrears billing? If not, can billing be restructured to qualify
   (e.g. monthly instead of weekly)?
5. Is a **late-cancellation fee** itself a "contract for future health studio services," or a
   separate service charge outside the Act?
6. What are the penalties for operating unregistered/unbonded in Florida, and **is the consumer
   contract void or voidable**?
7. Does **in-app written notice** satisfy § 501.017's "written notice to the health studio"
   cancellation requirement?

## 3. Questions — platform status (first-order)

8. Is **Glide itself** "engaged in the sale of services for instruction, training…" under § 501.0125
   — i.e. does the **platform** need its own registration and bond — or does the obligation sit solely
   with each trainer?
9. Does Glide take on liability by **authoring the contract templates and consent flow** that trainers
   rely on? Should the terms be Glide-authored, trainer-authored, or co-branded?
10. Should Glide's ToS disclaim responsibility for trainers' compliance, and is such a disclaimer
    effective against a **consumer** (as opposed to against the trainer)?

## 4. Questions — multi-state (for future non-Florida trainers/clients)

11. Which states should be cleared before we let out-of-state trainers or clients use this, and should
    pack sales be **geo-gated** until each state is reviewed?
12. Does California's Health Studio Services Contract Law (Civ. Code §§ 1812.80–1812.97) have a
    personal-trainer carve-out comparable to Florida's? (It reportedly applies to clubs "of any size.")
13. Which **state auto-renewal laws** apply to a weekly variable charge, and do any require
    click-to-cancel-style mechanics independent of the (vacated) federal rule?
    **Note — remote clients:** our clients can be virtual and reside in a different state than the
    trainer. Whose law governs the sale — the client's state of residence, or the trainer's? This is
    the single point we could not resolve and it drives our whole design.

## 5. Questions — billing & consent

14. Is a conditional late-cancellation fee a "**negative option** feature" subject to negative-option
    rules, or pre-authorized one-off billing?
15. Is our consent record (timestamp, IP, terms version + hash, frozen policy snapshot) sufficient to
    prove assent to a **specific version** of a **specific trainer's** policy?
16. What must happen when a trainer **changes** their cancellation policy — is affirmative re-consent
    required for existing clients, and can prior consent cover future modified terms?
17. Is there exposure in our **decline → account hold → blocked from booking** flow (e.g.
    debt-collection or unfair-practices characterization)?
18. Are there **caps** on what a late-cancellation fee may be, or does a 100%-of-price fee risk being
    an unenforceable **penalty** rather than liquidated damages?

## 6. Questions — structure / payments

19. Does **Stripe Connect direct charges** (trainer as merchant of record) meaningfully limit Glide's
    liability for a trainer's cancellation practices — or only its card-network loss allocation?
20. Does the **Stripe Connect Platform Agreement** make Glide liable for connected-account losses even
    under direct charges?
21. Should trainers be required to **carry insurance**, or to **indemnify Glide**, as a condition of
    using session billing?

---

## 7. Primary sources (so you can go straight to the text)

**Florida (primary):**
- § 501.0125 — https://www.flsenate.gov/Laws/Statutes/2025/501.0125
- § 501.015 — https://www.flsenate.gov/Laws/Statutes/2025/501.015
- § 501.016 — https://www.flsenate.gov/Laws/Statutes/2025/501.016
- § 501.017 — https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.017.html
- FDACS Health Studio Registration Application Guide (PDF) — https://ccmedia.fdacs.gov/content/download/116042/file/Health-Studio-Registration-Application-Guide.pdf

**California:**
- DCA Legal Guide W-10 — https://www.dca.ca.gov/publications/legal_guides/w_10.shtml
- Civ. Code Title 2.5 (2025) — https://law.justia.com/codes/california/code-civ/division-3/part-4/title-2-5/

**Federal / payments:**
- 15 U.S.C. § 8403 (ROSCA) — https://www.law.cornell.edu/uscode/text/15/8403
- Stripe — Merchant of record in Connect — https://docs.stripe.com/connect/merchant-of-record
- Stripe — Disputes on Connect platforms — https://docs.stripe.com/connect/disputes
- Visa Compelling Evidence 3.0 (PDF) — https://usa.visa.com/content/dam/VCOM/regional/na/us/support-legal/documents/compelling-evidence-3.0-merchant-readiness-mar2023.pdf

---

*This document contains research findings and questions only. It is not legal advice and was
prepared with AI assistance from primary sources; please verify independently. Full underlying
research is available on request (internal doc: `docs/LEGAL-SESSIONS.md`).*
