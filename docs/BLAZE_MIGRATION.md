# Blaze Migration Path — Role Security via Custom Claims

> **Status: documentation only. Do NOT implement this yet.** This describes how
> to upgrade CalorieIQ's role security model later, when the project moves to the
> Firebase **Blaze** (pay-as-you-go) plan for Stripe, AI, and Cloud Storage. The
> current Session-3 data model is intentionally kept compatible with this path so
> no app rebuild is needed at migration time.

## Why migrate

Today the Firestore security rules read each user's `role` and linkage
(`assignedTrainerId`, `headTrainerId`) from their `users/{uid}` document using
`get()` calls on every protected operation. That is correct and fine at small
scale, but each `get()` is a **billed document read plus latency** on every
check, and it grows with usage.

Firebase **custom claims** live inside the user's signed auth token. They:

- can be set **only** by a trusted Cloud Function via the Admin SDK, so the
  client cannot tamper with them;
- are read in rules as `request.auth.token.<claim>` — **free and instant**, with
  no document read on each protected operation.

So migrating role/linkage checks to custom claims removes per-request read cost
and latency for the hot paths.

## What stays the same (no app rebuild)

- The data model: `role` + linkage fields on `users/{uid}`.
- The app logic and UI, `src/profile.js`, and the signup flow.
- `users/{uid}/kv/{key}` per-user app data and the `window.storage` interface.

The Firestore documents remain the source of truth; custom claims become a fast,
tamper-proof **mirror** of the role/linkage used by the rules.

## What changes at migration (the actual steps)

1. **Upgrade to Blaze, then set a budget FIRST.** Blaze has **no default
   spending cap**. Before anything else, create a Cloud Billing **budget with
   email alerts** (e.g. alert at 50% / 90% / 100% of a small monthly ceiling).
   This is the cost-safety guardrail.
2. **Cloud Function to set claims.** Write an Admin SDK function that sets a
   custom claim `role` (and any needed linkage such as `headTrainerId`) on a
   user, triggered when their profile is created or their role changes. **Backfill
   existing users once** with a one-off script so everyone has claims.
3. **Update `firestore.rules` to read the token.** Replace doc-`get()` role
   checks with `request.auth.token.role` / `request.auth.token.headTrainerId`
   where possible. The `kv` trainer-access checks depend on the *client's*
   linkage (`assignedTrainerId`), so some of those may still need a single
   `get()` of the client profile — that's acceptable; just keep lookups minimal.
4. **Move sub_trainer assignment into a Cloud Function.** Sub-trainer assignment
   (and head-invites-sub onboarding) belongs server-side so it can enforce
   genuine **two-sided consent** safely. This is exactly why head-invites-sub was
   deferred out of the MVP: letting a head_trainer write another user's profile
   to make them a sub opens a privilege-escalation hole. A Cloud Function with
   the Admin SDK closes it.
5. **Tighten profile-doc read access.** Today `users/{uid}` profile docs are
   readable by *any signed-in user* (an MVP simplification so join + client-list
   queries work). Tighten to: owner + their trainer chain + admin + a limited
   public trainer directory.

## Cost-safety

- Always keep **budget alerts** on.
- Consider an automated **kill-switch** Cloud Function that disables billing once
  spend passes a defined ceiling, as a backstop against runaway cost.

## Related future improvements (also deferred)

- Friendly short **invite codes** instead of using the trainer's raw `uid`
  (a lookup collection mapping short code → trainer uid).
- Full trainer/client dashboards.
- Trial periods (`trialStartedAt`, `trialLengthDays`, `subscriptionStatus` fields
  are reserved on the profile model for this).
