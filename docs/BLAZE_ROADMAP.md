# Blaze Move — Unlocking the Server-Side Features

> **Status: planning only. Nothing here is built or enabled yet.** This is the
> game plan for moving CalorieIQ to the Firebase **Blaze** (pay-as-you-go) plan,
> which is the gate for everything that needs server-side code (Cloud Functions),
> Cloud Storage, or third-party secrets. Companion doc: `BLAZE_MIGRATION.md`
> covers the *security* side (moving role checks to custom claims). This doc
> covers the *product/infra* side: what to turn on, in what order, and why.

Kevin owns the billing/enablement steps (they cost money and touch the account).
Claude can prep all the code and scaffolding; Kevin flips the switches.

---

## Why Blaze is the gate

The current app is deliberately 100% client-side (Vite + React + Firestore via
`window.storage`). The free **Spark** plan covers Auth + Firestore, which is why
the entire non-Blaze roadmap shipped without it. But these remaining features
**cannot be done safely client-side** and need Blaze:

| Feature | Why it needs Blaze |
|---|---|
| **AI coaching layer** (daily messages, weekly reports) | The Anthropic API key must never ship in the browser — it lives in a Cloud Function. |
| **Photo meal tracking** | Image upload → Cloud Storage; vision call → Cloud Function (API key). |
| **Client → trainer requests** | A client can't write into a trainer's account under the rules; needs a server-side write. |
| **Notification center** | Same: a client-created notification on the trainer's side needs server logic. |
| **In-app messaging** | A shared two-party conversation needs server-mediated writes (or risky rule changes). |
| **Stripe Connect billing** | Webhooks + secret keys + revenue splits are inherently server-side. |
| **Head-invites-sub onboarding** | Two-sided consent must be enforced server-side (else privilege-escalation hole). |
| **Tamper-proof audit trail** | Authoritative server timestamps + identity, vs. the current cooperative history. |

Everything above is **deferred by design**, not by accident — the data model
already anticipates it (see "What's already prepped").

---

## Day 1 — enablement checklist (do in this order)

1. **Set a Cloud Billing budget + alerts BEFORE enabling Blaze.** Blaze has **no
   default spending cap**. Create a budget (e.g. $25–50/mo to start) with email
   alerts at 50% / 90% / 100%. This is the #1 safety guardrail.
2. **Enable Blaze** on project `calorieiq-29762`.
3. **(Strongly recommended) billing kill-switch.** A Cloud Function subscribed to
   the budget Pub/Sub topic that disables billing if spend passes a hard ceiling —
   a backstop against a runaway loop or abuse.
4. **Initialize Cloud Functions** (`firebase init functions`, Node, 2nd-gen) and
   **Cloud Storage** (for photos). Pin a region (match Firestore `nam5`).
5. **Store secrets in Functions config / Secret Manager** — never in the repo or
   in `VITE_*` (those ship to the browser). Keys needed over time: Anthropic API
   key, Stripe secret + webhook signing secret, any food-API server keys.
6. **Add the security migration** from `BLAZE_MIGRATION.md` (custom claims) — best
   done early since later features assume server-set role claims.

---

## Recommended build order (after Blaze is on)

Sequenced by value-to-effort and dependency. Each is its own milestone.

1. **Custom-claims security migration** (`BLAZE_MIGRATION.md`) — foundation;
   makes later server writes clean and rules cheap.
2. **Client → trainer requests** — small, high-value, completes the half built in
   Session 19 (trainer→client). One callable Function that writes a structured
   request into the trainer's account. Reuses the existing request item shape.
3. **Notification center** — builds naturally on #2 (join/leave/logged events).
   Likely **FCM** for push + an in-app inbox. Trainer notify-on-client-logged ties
   into the existing activity-history events.
4. **AI coaching layer (text first)** — a Function calling the Anthropic API
   (model: latest Claude; see `claude-api` reference). Start with weekly
   summaries / daily check-in messages generated from the client's existing
   plan + logs (all already in Firestore). No new data needed.
5. **Photo meal tracking** — Cloud Storage upload + a vision Function that returns
   `{name, calories, protein, carbs, fat}` and pre-fills the **same meal-entry
   form** Session 50's food search fills. The manual + USDA-search tiers already
   exist; this is the premium auto-track tier on top.
6. **In-app messaging** — trainer ↔ client DMs, server-mediated.
7. **Stripe Connect** — last and largest: two-level revenue splits (sub 75% /
   head 10% / platform 15%; direct clients 85/15; capped at 2 levels), webhooks,
   and wiring `subscriptionStatus` to real billing (see trials below).

---

## What's already prepped in the codebase (so these are smaller than they look)

- **Trial fields are live** (Session 51): `trialStartedAt`, `trialLengthDays`,
  `subscriptionStatus` are set at signup and surfaced via `trialInfo()` + the
  side-menu banner. Stripe just needs to flip `subscriptionStatus` to `"active"`
  and the banner/gating logic already keys off it. The current trial gate is
  **soft/informational**; hard gating turns on with billing.
- **Requests are structured** (Session 19): `caliq-requests` items already carry
  `{ id, fromUid, fromName, type, prompt, status, createdAt, doneAt }` — the
  client→trainer direction just needs the reverse write path (a Function).
- **Cooperative activity history exists** (Sessions 10–11): the event feed is
  already there; the Blaze version adds authoritative server stamps + notify.
- **Meal entry form is API-ready** (Sessions 9, 50): photo auto-track fills the
  exact same `{name, calories, protein, carbs, fat}` fields the manual + USDA
  search paths fill — no new logging UI needed.
- **Food search runs client-side today** (Session 50, USDA + DEMO_KEY). On Blaze,
  proxy it through a Function so the real key isn't exposed and limits scale.

---

## Cost notes

- Functions + Firestore + Storage at this app's scale are pennies; the real cost
  driver is the **AI layer** (per-token Anthropic calls). Budget for it: cap
  message frequency, cache/reuse summaries, and consider per-tier limits.
- Keep budget alerts on permanently; revisit the ceiling as usage grows.
- Anonymous auth remains the frictionless entry point for the self-serve trial.

---

## Open product decisions to settle before #7 (Stripe)

- Final trial lengths per role (currently both 30 days; revisit).
- Hard-gate behavior at trial end (currently soft) — lock which features?
- Plan tiers/pricing for clients vs. trainers; how the revenue split is presented.
