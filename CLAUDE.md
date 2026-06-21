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
- Session 4: **Friendly invite codes.** Trainers now get a short, readable code (7 chars, no
  ambiguous O/0/I/1/L, displayed as `XXX-XXXX`) stored on their profile (`inviteCode` field);
  clients link by entering it and it's resolved back to the trainer's uid at join time. Raw-uid
  entry still works as a fallback for codes shared under the old scheme, and `joinTrainer` now
  validates the target is actually a trainer before linking. No `firestore.rules` change was
  needed (lookup uses the already-open signed-in read; the code is written by the trainer to
  their own profile). Helpers added to `profile.js`: `ensureInviteCode`, `formatInviteCode`.
- Session 5: **Display names, leave/switch trainer, and one-click invite links.**
  (1) **Display name** is now captured at signup (a name field on the signup form and the
  one-time role chooser) — **required for trainers**, optional for clients — and editable
  anytime from the role panel. Stored in the profile's `displayName`; the client view shows the
  trainer's name (falling back to email, then uid). (2) **Leave / switch trainer:** clients get
  a "Leave trainer" button that clears `assignedTrainerId`; switching is leave-then-join-a-new-
  code. (3) **Invite links:** trainers can copy a `…/?invite=CODE` link; when a client opens it
  and signs up/in (and isn't already linked), the app auto-links them and confirms on screen
  (guarded to clients only, never overrides an existing link, and the code is stripped from the
  URL after). All three are owner self-writes, so **no `firestore.rules` change** was needed.
  Helpers added to `profile.js`: `setDisplayName`, `leaveTrainer`.
- Session 6: **Name refinements + leave confirmation.** Names are now captured as separate
  **first / last** fields (stored as `firstName`, `lastName`, plus the combined `displayName`
  for back-compat) on signup, the role chooser, and the role-panel editor; both required for
  trainers. The "Leave trainer" button now asks for an inline **Confirm / Cancel** before
  unlinking, to prevent accidental leaves. Helpers added to `profile.js`: `setName`, `splitName`
  (and `splitName` falls back to splitting an older single `displayName`). Still owner
  self-writes — no `firestore.rules` change.
- Session 7: **Trainer overview dashboard (Phase 1, non-Blaze).** Trainers now land on a new
  **Dashboard** home tab: a per-client overview card showing weight → goal (with "lbs to go"),
  the daily calorie target (computed with the SAME formula as the Results "Target calories" row),
  last activity (most recent daily log), and a plan-status badge (complete / in progress / needs
  setup), plus a sort (needs attention / last active / name) and a summary line. A two-tab toggle
  (**Dashboard | All clients**) flips to the existing profile/folder manager, which is unchanged.
  Built entirely on existing per-profile data + daily logs (`computeClientCalories` reuses the
  in-file calc functions; one `storage.list("caliq-log-")` call gets last-active). New in App.jsx:
  `computeClientCalories`, `TrainerDashboard`; App now reads the user's `role` to default trainers
  into the dashboard. No data-model change, no `firestore.rules` change, no Blaze. The card shows
  weight → goal with "N lbs to go" (larger/brighter text, `lbs` on every number), plus a **progress
  bar** that fills using the client's *earliest weigh-in check-in* as the starting baseline — the
  bar only appears once there's at least one weigh-in to measure against, so it's never misleading.
- Session 8 (in progress): **Connecting accounts to profiles — linking (Phase 1, non-Blaze).**
  First slice of the "two kinds of client" work. New file `src/clientData.js` adds cross-account
  kv access (`getForUser`/`setForUser`/`deleteForUser`/`listForUser`) — a separate accessor that
  takes a target uid and works ONLY where `firestore.rules` already grant trainer→client access;
  it does NOT touch the `window.storage` interface. In the role panel, each linked client now
  shows a plan status ("✓ Plan linked" / "No plan yet") and a **Link a profile** action: the
  trainer picks one of their own saved profiles and its data is copied into the *client's* account
  under the key `caliq-self` (so both can later edit the single shared copy). Both actions are
  guarded by inline confirmations — "Link [profile] to [client]?" and a red **Unlink** with "Unlink
  [client]'s plan? This removes it from their account." No `firestore.rules` change (relies on the
  existing trainer↔client kv access; verified by a real linked test account).
  **Client home added:** a signed-in **client** now lands on a `ClientHome` screen (role panel +
  an "Open my plan" button) instead of the trainer's profile manager; opening it runs
  `selectProfile("self")`, which reuses the existing editor on the key `caliq-self` (since
  `profileKey("self")` === `caliq-self`) in the client's *own* storage — so the plan a trainer
  linked is the very same file the client opens and edits (one shared copy; created on the client's
  first save if none was linked). Header buttons relabel for clients ("My Home" / "← Home").
  **Part C done:** the trainer can now OPEN a linked client's plan and edit it live. Each linked
  client with a plan shows an **"Open plan"** button in the role panel; it calls `openClientPlan(uid)`,
  which loads the client's `caliq-self` via `getForUser` into the normal editor and sets a new
  `activeRemoteUid` state. `autoSave` branches on `activeRemoteUid`: when set, edits save via
  `setForUser(uid, "caliq-self", …)` straight into the client's account (and skip the local index
  update); when null, it's the existing local-profile behavior. `selectProfile`, `createProfile`,
  and `goToProfiles` all reset `activeRemoteUid` to null so local editing is never misrouted. So the
  trainer and client now edit one shared copy from both sides. **Still optional:** an explicit
  auto-create of `caliq-self` on join (today it's created on first edit), and enriching ClientHome
  with a plan summary. Assumption: one shared "self" plan per client (multiple plans per client is a
  later roadmap item).
- Session 9: **Manual meal / food logging (free self-log tier, non-Blaze).** The Daily Dashboard now
  has a **"Meals & Food Today"** section (new `MealLog` component): an itemized list of foods logged
  today (each with optional name, optional meal type Breakfast/Lunch/Dinner/Snack, required calories,
  and optional protein/carbs/fat), with per-item delete. Entries roll into the day's calorie + macro
  totals (Kevin chose **Option A** — additive: the existing quick-add buttons stay, and meals add on
  top; both feed the total). Each entry can be a full named food, a by-meal estimate (type + calories,
  no name), or a quick calorie number. Stored as a `meals[]` array inside the existing per-day log
  (`caliq-log-{id}-{date}`). New App handlers `onAddMeal`/`onRemoveMeal` adjust meals + totals.
  **Daily log is now remote-aware:** `logRead`/`logWrite`/`persistLog` route the daily log to the
  linked client's account when a trainer has a client's plan open (`activeRemoteUid`), so trainer-on-
  behalf logging lands in the client's account (fixes a gap from Part C); the load effect now also
  depends on `activeRemoteUid`. **Forward-compatible with the food-library API (Blaze, later):** that
  API will simply auto-fill these same fields instead of typing them. No `firestore.rules` change.
- Session 10: **Edit history / activity log (cooperative tier, non-Blaze).** Every meaningful
  change to a plan is recorded as an append-only event — **who** (uid + role + name), **when**
  (timestamp), **what** (plain-English action). Tracks BOTH logging actions (meals added/removed,
  weight logged, calorie/water quick-adds) and plan-structure edits (goal weight, workouts, notes,
  check-ins, etc., via a `describePlanChanges` diff run after each debounced save). Stored newest-
  first under `caliq-history-{id}` (capped at 250), routed remote-aware like the daily log, so a
  linked client's history lives in their account and both sides see the same feed. New: App state
  `history`/`historyRef`/`lastSnapshotRef` + `meName`/`meUid`; helpers `appendHistory`,
  `recordPlanEdits`, and module-level `describePlanChanges` + `timeAgo`; `selectProfile`/
  `openClientPlan`/`createProfile` seed the diff baseline; the daily-log effect loads history. UI:
  a collapsible **🕓 Recent Activity** feed (`ActivityFeed`) on the Daily Dashboard (name + role
  badge + action + relative time). This is the *cooperative* tier (each side records its own
  actions; not tamper-proof) — the hardened, server-stamped version comes with Blaze. No
  `firestore.rules` change.
- Session 11: **Logging UX fixes, editable entries, activity feed upgrades, and the local↔shared
  profile model.**
  (1) **No more save-on-keystroke:** water / weight / "Add Calories" now commit only on **Enter or
  a "Log" button** (controlled drafts in `DailyDashboard`), fixing bogus history like "logged 1 lbs"
  while typing. (2) **Editable log entries:** each meal/food has a **✎ edit** (new `onEditMeal`) that
  re-opens the entry pre-filled and adjusts totals by the diff; plus delete. (3) **Activity feed:**
  trainer vs client **name colors** (`histNameColor`), a full-screen **"View all changes"** overlay
  with a **search** box (date / month / name / action), and a **↻ Refresh** (`reloadPlanLive`) that
  re-pulls log + history (the shared plan isn't live-synced; real-time would need Blaze). (4) Opening
  a linked client via **"Open plan"** now lands on the **Daily Dashboard** (where logging + activity
  live) and shows a **"🔗 Shared client plan"** banner so the trainer knows they're in the client's
  account. (5) **Local↔shared profile model (Kevin's design):** linking a local file now **moves** the
  plan into the client's account and **removes the local duplicate** (`removeLocalProfileById`); a new
  **"Copy to local file"** snapshots a client's plan into a fresh local file for sims/templates/backups
  (`copyClientToLocal`); **Unlink** first saves a local copy then removes the client's plan (no data
  loss). The trainer home is relabeled **"Local Plans Overview"** (local-only); connected clients live
  in the role panel's "Your clients" with Open plan / Copy to local / Unlink. **Deferred:** showing
  connected clients (live data) in the dashboard overview itself — currently the overview is local
  plans only. No `firestore.rules` change in this session.
- Session 12: **Connected clients in the dashboard + local-plan rename.**
  (1) The trainer **Dashboard** now has a **"🔗 Your Connected Clients"** card above the local plans:
  it loads `getMyClients()` and reads each client's SHARED plan (`getForUser(uid, "caliq-self")`) plus
  their logs (`listForUser(uid, "caliq-log-self-")`) to show **live** weight→goal, daily calorie
  target, and last-active — tap a card to open their shared plan. So the overview reflects real
  client data, not a stale local copy. (2) **Rename local plans:** a new `customName` field on the
  profile index (helper `renameProfile`) with a **✎** control on both the dashboard local cards and
  the All-clients `ProfileCard`; display is `customName || name`, and `autoSave` preserves it. Good
  for naming sims/templates/backups. No `firestore.rules` change.
- Session 13: **Client Dashboard (the client's own home view, non-Blaze).** The signed-in client's
  landing screen (`ClientHome`) is now a real dashboard instead of just a "Open my plan" button. It
  reads the client's own `caliq-self` plan + today's log and shows: a greeting, a **🎯 Weight & goal**
  card (current weight → goal, "lbs to lose/gain", **previous** weigh-in with the delta, and "▼ X lbs
  lost since start"), and a **🍽️ Today** card (calories consumed vs. target with a left/over indicator).
  **Quick-log right on the dashboard:** add **or remove** calories (clamped at 0), and **✎ Log** today's
  weight inline — both commit on Log/Enter (not per keystroke). A subtle **↻ Refresh** re-pulls the
  shared plan (not live-synced; real-time needs Blaze). **Weight tracking + progress chart:** logging a
  weight updates the plan's current weight (so the card, "lbs to go", and the weight-based calorie
  target all re-derive) and records a **check-in** in `data.checkIns` (the app's standard weight-history
  source — feeds the existing `ProgressChart` and the trainer view). Per Kevin's choice, **every weigh-in
  is its own point** (not one-per-day). A **📈 Progress** popup reuses `ProgressChart` (new opt-in props
  `showValues` = value label at each dot, and `pxPerPoint` = fixed per-point spacing + a horizontal-scroll
  frame so many weigh-ins flow sideways instead of cluttering); value labels are placed on the outside of
  each vertex with a dark halo and pushed clear of the goal line, and the goal label is drawn last with a
  halo so nothing covers it. The popup also lists the weigh-ins with a **✕ delete** (fixes a mistaken
  entry; re-points current weight to the latest remaining weigh-in, or back to the starting weight).
  Implementation notes: weight writes go through an **in-memory plan ref** (`planWrapRef`) updated
  synchronously before the async Firestore write, so rapid logs each append a point instead of racing the
  network (the earlier bug). New plan field `startWeightLbs` (baseline, captured on first weigh-in;
  display-only — chart synthesizes a "start → now" segment until there are 2+ real points). Quick-logs
  still append to `caliq-history-self` so the trainer's activity feed reflects them. No `firestore.rules`
  change. **Deferred from this session:** a confirm step before deleting a weigh-in (currently immediate),
  and the weight-range feature + page cleanup below.
- **Known state:** there are test accounts and test client profiles in Firestore from manual
  testing — these are not real users and can be cleared. The Session-13 testing also left **test
  weigh-ins/check-ins** in the test client's `caliq-self` — also clearable.

## Roadmap (not yet built)

- **Weight range / goal band (Kevin's idea).** Instead of a single goal number, let the trainer or
  client set a **healthy weight range** (e.g. 190–198) — people rarely hold one exact weight and tend
  to fluctuate several lbs up/down with consistency, so a band is a more realistic goal. Should be
  settable **at profile creation** and **easily addable/editable later**. Display it subtly under the
  Weight & goal card (small, not bold), and it could shade a band on the progress chart; logging within
  range could count as "on target." Data-model + UI change (new `goalRangeLow`/`goalRangeHigh` fields on
  the plan); no Blaze. Good candidate for the next session.
- **UI cleanup pass on the other pages.** The new Client Dashboard set the visual bar (clean, card-based,
  clear CTAs); bring the older screens (the full plan editor / Results, trainer pages) up to the same
  look. Cosmetic only; no Blaze. Kevin flagged this as a later task.

- **Planned rebrand:** "CalorieIQ" and most "Cal-" prefixed names are crowded in the app stores;
  a more distinctive name/domain may replace it later. No code impact — the Firebase project ID
  stays `calorieiq-29762` regardless, so this is a UI-text + domain change whenever it happens.

- Role-aware dashboards: **Trainer overview shipped (Session 7).** Still to do: the **Client
  Dashboard** (a client's own home view) and connecting a linked client *account* to a managed
  nutrition *profile* (the "two kinds of client" gap — in progress; one shared "self" plan in the
  client's account, both can edit; no Blaze).
- **Multiple plans per client (later enhancement).** Default is one plan per client; this adds the
  option of several, with one marked active. Useful cases: diet/training **phases** (cut →
  maintenance → bulk; or hypertrophy → strength → peak/power mesocycles); **goal-specific**
  programs (marathon training vs. strength); **seasonal/periodized** (off-season vs. contest prep,
  incl. peak week); **draft vs. active** (prep next month's plan while they follow the current one);
  **history** (keep finished plans as records instead of overwriting); **injury/rehab** modified
  program during recovery; **travel/vacation** lighter or bodyweight-only block; **reverse-diet**
  after a cut; **progression templates** (beginner → intermediate → advanced); **split variants**
  (push/pull/legs vs. upper/lower) to switch between; **reusable plan templates / a plan library**
  the trainer clones across clients; **medical/dietary-restriction variants**; and **A/B approaches**
  to see what works for a given client. No Blaze needed — it's a data-model + UI change (a list of
  plans per client with an "active" flag).
- **Requests / to-dos between trainer and client (Kevin's idea).** Either side can send the other a
  small actionable request that surfaces on the recipient's home screen. Trainer → client examples:
  "enter your name," "log today's food," "record your workout," "do a weigh-in." It pops up as a
  task card on the client's home; the client fills it in. Client → trainer examples: "please enter
  this for me," "record this food/workout for me." Trainer-side display: a little request badge next
  to that client's folder; requests from **non-clients** (not linked) collect under a "Requests"
  section on the trainer home. Trainers can **turn off receiving requests**, especially from
  non-clients. Notifications are a later add-on (see notification center). **Blaze split:** the
  **trainer → client** direction is doable **non-Blaze** (the trainer already has write access to the
  client's account, so the request is written into the client's kv, e.g. `caliq-requests`). The
  **client → trainer** direction is NOT possible safely without server-side logic — a client can't
  write into the trainer's account under the current rules — so it needs **Cloud Functions / Blaze**
  (same constraint as notifications/messaging). Recommend building the trainer→client half now and
  the client→trainer half with Blaze. Store requests as structured items (id, from, to, type,
  prompt, status open/done, timestamps).
- **Edit history / activity log (who-changed-what).** Since both trainer and client edit the same
  shared plan, track every meaningful change as an append-only event: **who** (uid + role + name),
  **when** (timestamp), **what** (e.g. "added a meal," "logged 182 lbs," "changed goal to 160,"
  "edited Tuesday cardio"), and ideally the before→after. Surface it as a **timeline/feed** on the
  profile or dashboard. Value: accountability + coaching insight (is the client logging daily?),
  and it resolves the "who overwrote whom" risk of shared editing (could later enable revert). It
  also feeds the future **notification center** (notify trainer when a client logs). Store as
  structured events (not raw diffs) for readability, and log meaningful actions rather than every
  keystroke. **Two tiers:** a basic *cooperative* history can be done **non-Blaze** (each side
  writes its own events into the shared plan's history) — but it's not tamper-proof (a writer could
  forge/omit entries). A **trustworthy, tamper-resistant** audit trail (authoritative server
  timestamps, can't fake another user's identity) needs **Cloud Functions → Blaze**. Recommend the
  basic version alongside the shared-editing work, with the hardened version arriving with Blaze.
- **Calendar view (Kevin's idea).** A calendar that toggles **daily / weekly / monthly** (Google-
  Calendar style) showing a client's past, current, and future scheduled workouts — and a place to
  **log food + workouts** both now AND in the past (back-dated entries). Coaching value: a trainer
  can show a client their historical food/workout logs to explain why results did or didn't happen,
  reinforcing why following the program matters. Needs the ability to **edit/log on past dates**
  (the daily log is already keyed by date `caliq-log-{id}-{YYYY-MM-DD}`, so back-dated logging is a
  natural extension). No Blaze needed for the manual version. Likely a big UI step; plan carefully.
- **"Simulation" tab (Kevin's idea).** A separate mode where a trainer (or client) builds/simulates
  a complete workout + nutrition program and sees an **estimated results projection** — saved
  **separately from the client's real plan** (a sandbox, not their active program). Use cases:
  a sales tool to show a prospect their potential results and convert them, or a motivation tool for
  existing clients. Builds on the app's existing projection math (weeksToGoal, etc.). No Blaze.
- **Consistency-based time-to-goal estimate** — as the trainer (or client) logs weight + body-fat
  % over time, use the *actual* observed rate of change (not just the theoretical 1 lb/wk deficit
  the app currently assumes) to project a realistic ETA to goal weight / goal BF%. Builds on the
  existing check-in/daily-log data. Could feed a real progress bar on the dashboard card (Kevin:
  progress bar is optional/aesthetic — only worth it if it improves the look; "lbs to go" is fine
  on its own for now). No Blaze needed.
- **Navigation side menu** — a hamburger (≡) menu in the top corner that opens a slide-out
  panel for editing your profile and moving around the app. Its own UI step (App.jsx is one
  large component, so navigation restructuring should be planned carefully). No Blaze needed.
  Candidate home for the **Recent Activity** feed (Kevin: the activity list will get long; for
  now it's a compact tile showing the latest 3 with "View all" → scrollable; later it could move
  into the side menu and/or get its own full-page view).
- **Notification center** — notify a trainer when a client joins or leaves (and similar events).
  Deferred until Blaze/Cloud Functions: a client safely creating a notification on the trainer's
  side needs server-side logic (client-side writes would require opening up the rules unsafely).
- **In-app messaging** — direct messages between a trainer and their clients. Deferred until
  Blaze/Cloud Functions: a shared conversation between two users needs server-side writes (or
  carefully designed new rules) to stay secure.
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
