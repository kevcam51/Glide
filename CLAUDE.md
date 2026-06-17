# CalorieIQ — Project Guide

This file is the standing context for working on CalorieIQ. Read it at the start of every
session. Keep it updated when architecture or decisions change.

## What CalorieIQ is

A nutrition + fitness planning web app that is the foundation of a **Shopify-style SaaS
platform** for personal trainers and their clients. Kevin (the owner) runs Smooth Training, a
mobile fitness business in Miami, which serves as the flagship proof-of-concept. Independent
trainers/businesses will eventually white-label the platform under their own brand. Kevin earns
as both platform owner and an active trainer.

Existing business tooling: Smooth Training currently runs on Trainerize (coaching delivery),
Acuity (scheduling), and Stripe (post-session billing). CalorieIQ is building toward being the
unified platform that complements and eventually replaces these.

## Tech stack

- **Vite + React (JSX).** Main UI is a single large component in `src/App.jsx` (~7,500 lines).
- **Firebase**: Authentication (Email/Password, Google, Anonymous enabled) + Cloud Firestore.
- **Hosting**: Vercel. Pushing to `main` on GitHub (kevcam51/calorieiq) auto-deploys.
- Firebase project ID: `calorieiq-29762`. Firestore is in `nam5` (multi-region), Production mode.

## Key commands

- `npm run dev` — local dev server (Vite, usually http://localhost:5173).
- `npm run build` — production build; must pass before committing.
- `npm run test:rules` — Firestore security-rules tests against the Firebase emulator. The
  emulator needs Java (Temurin JDK); if missing, install it before running.

## Important files

- `src/firebase.js` — initializes Firebase; exports `auth`, `db`, `googleProvider`. Config comes
  from `VITE_FIREBASE_*` env vars (`.env.local` locally; same vars set in Vercel for prod).
- `src/storage.js` — backs `window.storage` with Firestore at `users/{uid}/kv/{key}`. The whole
  app reads/writes through this. **Do not change the `window.storage` interface**
  (get/set/delete/list) — App.jsx depends on it.
- `src/AuthGate.jsx` — gates the app behind login; captures role at signup; ensures every user
  has a profile before the app mounts.
- `src/profile.js` — user profile + role helpers (`createProfile`, `getProfile`, `joinTrainer`,
  `getMyClients`, `getMySubTrainers`, `myInviteCode`, `ROLES`).
- `firestore.rules` — security rules (access control). Tested by `npm run test:rules`.
- `docs/BLAZE_MIGRATION.md` — the planned upgrade path to Firebase custom claims (future).
- `.env.local` — Firebase config; **gitignored**, never commit. Vercel has its own copy.

## Data model

- `users/{uid}` (profile doc): `uid`, `email`, `displayName`, `role`, `assignedTrainerId`,
  `headTrainerId`, `createdAt`. Reserved for later: `trialStartedAt`, `trialLengthDays`,
  `subscriptionStatus`.
- `users/{uid}/kv/{key}` — the app's per-user data (managed via `storage.js`).
- Roles: `client`, `head_trainer`, `sub_trainer`, `admin`.

## Security model (current)

- Roles stored in the profile doc; enforced by `firestore.rules` (document `get()` checks).
- Access matrix: a user's `kv` data is read/writable by the owner, an admin, the owner's direct
  trainer (`assignedTrainerId`), or the head above that trainer. Self-promotion is blocked
  (users can't change their own `role`). Admin is hardcoded by **UID** in `isAdmin()` (admin =
  Kevin's account UID; tied to the account, not the email — changing email/password keeps admin).
- **Security rules are critical.** Any change to `firestore.rules` MUST be covered by emulator
  tests (`npm run test:rules`) — including attack cases (no self-promotion, no cross-trainer or
  cross-client access, signed-out denied) — and must pass before committing. After changing
  rules, they must be PUBLISHED in the Firebase console (or via `firebase deploy --only
  firestore:rules`) — a code push alone does not update live access control.

## Future hardening (see docs/BLAZE_MIGRATION.md)

When the project moves to the Firebase **Blaze** (pay-as-you-go) plan — which is required for
Cloud Functions, and therefore for Stripe webhooks, the AI coaching layer, and Cloud Storage —
migrate role checks to **custom claims** (tamper-proof, set by a Cloud Function, free/instant to
read in rules vs. billed `get()`s). The data model and app logic stay the same; only a Cloud
Function + a rules tweak are added. Always set a Cloud Billing budget + alerts the day Blaze is
enabled (Blaze has no default spending cap).

## Current state (built)

- Session 1: Vite project, app moved in, deployed to Vercel.
- Session 2: Firebase Auth + Firestore; storage migrated from localStorage to Firestore;
  login gate; per-user data isolation.
- Session 3: Four-role system; role chosen at signup ("trainer" → head_trainer; "client" →
  client; sub_trainer = admin-assigned for now; admin = hardcoded UID). Trainer-sees-their-
  clients access in the rules, with 29 passing emulator tests. Minimal in-app role panel
  (trainer sees invite code + linked clients; client joins via invite code). Blaze migration
  path documented.
- Invite code is currently the trainer's **UID** (MVP shortcut). A friendly short-code is a
  planned improvement.
- **Known state:** there are test accounts and test client profiles in Firestore from manual
  testing — these are not real users and can be cleared.

## Roadmap (not yet built)

- **Planned rebrand:** "CalorieIQ" and most "Cal-" prefixed names are crowded in the app stores;
  a more distinctive name/domain may replace it later. No code impact — the Firebase project ID
  stays `calorieiq-29762` regardless, so this is a UI-text + domain change whenever it happens.

- Role-aware **Trainer and Client dashboards** (real UIs; current role panel is MVP scaffolding).
- **Friendly invite codes** (short code/link instead of raw UID).
- **Two trial periods**: self-serve client trial (~7–14 days) and trainer migration trial
  (~30 days). Store trial state per-user (the reserved profile fields above); gate features at
  expiry. Anonymous auth is the frictionless entry point.
- **Head-invites-sub onboarding with consent** — deferred until Blaze/Cloud Functions (doing it
  safely needs server-side logic; client-side would create an escalation hole).
- **Stripe Connect** revenue splits (two-level tree: sub keeps 75%, head 10%, platform 15%;
  direct clients: trainer 85%, platform 15%; capped at 2 levels). Needs Blaze.
- **AI coaching layer** on the Anthropic API (server-side via Cloud Function — never expose the
  key in the browser): daily messages, AI meal tracking from photos, reminders, weekly reports.
- **Meal logging** tiers: free self-log; trainer manual-entry with AI assist; premium AI
  auto-track. Food APIs: FatSecret (primary), USDA FoodData Central, Nutritionix; wearables via
  Apple Health / Google Health Connect (Fitbit, Garmin, Whoop, Oura). Wearable data overrides
  scheduled estimates when connected.

## How to work on this project (working agreements)

- **Explain in plain language.** Kevin is building real skills but isn't a deep engineer — narrate
  what you're doing and why.
- **Pause before anything irreversible or live-affecting.** Always confirm before: committing,
  pushing to `main` (auto-deploys to prod), deleting files, or changing access rules. Show what
  you're about to do first.
- **Security-rule changes**: always write/run emulator tests and pass them before committing;
  remind Kevin to publish the rules.
- **Don't break the storage interface** or push secrets. `.env.local` stays gitignored.
- **Commit style**: clear, descriptive messages; keep unrelated changes in separate commits.
- Build (`npm run build`) should pass before committing code changes.
- Keep this file (CLAUDE.md) updated as the project evolves.
