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

- **Vite + React (JSX).** Main UI is a single large component in `src/App.jsx` (~13,500 lines),
  styled by its own injected `<style>` block + inline styles.
- **Tailwind CSS v4** (`@tailwindcss/vite`) is installed for **new** components (preflight is
  intentionally OFF so existing screens are untouched). Design tokens live in `src/index.css`
  (`@theme`) + `src/themes.css` (swappable `[data-theme]` looks). See Session 25 below.
- **Brand:** Smooth Training = **black + cyan `#08DCE0`** (sampled from the logo). The app's
  accent was recolored from the old lime `#e8ff4f` to this cyan.
- **Firebase**: Authentication (Email/Password, Google, Anonymous enabled) + Cloud Firestore.
- **Hosting**: Vercel. Pushing to `main` on GitHub (kevcam51/calorieiq) auto-deploys.
- Firebase project ID: `calorieiq-29762`. Firestore is in `nam5` (multi-region), Production mode.

## Key commands

- `npm run dev` — local dev server (Vite, usually http://localhost:5173).
- `npm run build` — production build; must pass before committing.
- `npm run test:rules` — Firestore security-rules tests against the Firebase emulator. The
  emulator needs Java (Temurin JDK). A local JDK is installed at `~/.glide-jdk` (Temurin 21, no
  brew/sudo on this machine) — run with it via:
  `JAVA_HOME="$HOME/.glide-jdk/jdk-21.0.11+10/Contents/Home" PATH="$JAVA_HOME/bin:$PATH" npm run test:rules`
  (61 tests currently pass).

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
- `docs/BLAZE_ROADMAP.md` — the product/infra game plan for the Blaze move (what to enable + build order).
- `glide-ai-meal-logging-spec.md` — **the canonical spec for the AI chat / conversational meal-logging +
  coaching-assistant layer** (Kevin-authored). When building the AI Chat, follow this: Anthropic API via
  Cloud Functions (Blaze-gated), `claude-sonnet-4-6`, role-based system prompts + tools, per-user daily token
  budgets, function-calling for data-aware queries, photo logging (paid tier), SSE streaming, custom React
  chat component. **Reconcile its richer meal schema (`components`/`totals`/`giEstimate`, top-level docs) with
  the app's current kv meal storage (`meals[]` inside `caliq-log-{id}-{date}`) so AI-logged meals show up in
  the existing dashboard / calendar / weekly cards.**
- `.env.local` — Firebase config (+ optional `VITE_USDA_API_KEY` for food search); **gitignored**, never
  commit. Vercel has its own copy.

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

> **RESUME-HERE SUMMARY (keep this updated; it's the fast path for a fresh chat).**
> _Last updated: Session 85. `Glide-Session-Handoff-NEXT.md` is the primary entry point; this block
> is the quick digest._
> - **App = Glide** (rebranded from CalorieIQ, S53; name change still OPEN — see docs/NAMING.md).
>   Brand near-black + cyan `#08DCE0`, Tailwind "pro" theme everywhere. PWA installable (S84).
> - **Blaze is ENABLED (S56) and the whole AI layer is LIVE (S60–82):** streaming chat with role-based
>   prompts + per-user daily token budgets + prompt caching; data-aware tools; meal logging by text /
>   PHOTO (vision) / VOICE (Groq whisper primary, OpenAI fallback) / barcode scanner; Accept/Edit cards;
>   workout-program builder; onboarding; plan management; proactive coaching; link ingest. Model
>   `claude-sonnet-4-6`.
> - **Also live:** food DB search (USDA + Open Food Facts), email invites via Resend
>   (`invites@send.smoothtraining.com`), Invite Hub (QR/share/referrals), Trainerize importer v1
>   (admin-only button on the trainer home), custom exercises end-to-end, live-sync (onSnapshot) on all
>   trainer/client surfaces, Notification Center, 30-day trials (soft).
> - **Security:** profile reads scoped (S59), billing/trial fields locked to admin (S85), invite codes
>   un-harvestable (S85). **61 emulator rules tests** — run before ANY rules change and PUBLISH after.
> - **Still NOT built:** Stripe billing (biggest gap — trials aren't enforced), client→trainer
>   requests/messaging, push-notification delivery, custom claims in rules (deliberately skipped, S57).
> - **Key gotchas:** `.page-transition` keeps a CSS transform → any fixed overlay must
>   `createPortal(…, document.body)` (S27/S30). Local-date keys via `ymdLocal`/`useTodayKey` — never
>   UTC "today" (S45/S85). kv range queries use the `""` ESCAPE (raw char breaks silently, S85).
>   When `functions/aitools.js` changes deploy ALL FOUR AI fns. Firebase CLI token expires —
>   `firebase login --reauth --no-localhost`.
> - **Next up (Kevin's queue):** AI-edits-local-plans → biometric login + idle sign-out. Then
>   Trainerize v2 (history/auto-sync) and Stripe.

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
- Session 14: **Weight range / goal band (non-Blaze).** A plan can now carry an optional healthy
  **weight range** (low–high) in addition to the single goal weight — people rarely hold one exact
  weight, so a band is a more realistic target. Entered as **low + high bounds** (Kevin's choice; most
  flexible, can be off-center from the goal) in the plan's **Goal Weight** step (new fields
  `goalRangeLow`/`goalRangeHigh` on `data`, so it's set at creation AND editable later there; they ride
  the normal save — no storage change). Display: the Client Dashboard's **🎯 Weight & goal** card shows
  **"Range: 190–198 lbs · ✅ in range"** (green) or **"X lbs below/above range"** (amber) based on the
  current weight; `ProgressChart` gained `rangeLow`/`rangeHigh` props that **shade the band** behind the
  line (shown in both the dashboard popup and the full-plan Results chart). Fully optional — blank =
  unchanged behavior. No `firestore.rules` change.
- Session 15: **Realistic time-to-goal + one-entry-per-date consolidation (non-Blaze).**
  (1) **Time to goal:** a new **⏳ Time to goal** card on the Client Dashboard projects an ETA from the
  client's **actual logged trend**, not the theoretical 1 lb/wk. Module helpers `weightTrend(checkIns)`
  (least-squares regression of weight vs. time → `ratePerWeek`; needs 2+ weigh-ins spread over ≥3 days,
  so same-day logs don't produce a bogus rate) and `etaWeeks(current, target, rate)` (null if trending
  away). Shows the observed rate, a projected **date to reach the goal** (reusing `friendlyTime`), and a
  date to reach the **range** edge if set; honest fallbacks for not-enough-data / trending-away / at-goal;
  ETAs over ~5 yrs are suppressed. (2) **One weigh-in per date everywhere:** the check-in editor now
  **replaces** an existing same-date entry instead of appending (`onSaveCheckIn` filters out the same
  `date` before adding), and selecting a date **pre-fills** the form from its existing entry so you can
  edit it; the old yellow "already exists" warning is now a friendly green "editing this entry" note. The
  dashboard quick weight-log was changed to match — it replaces today's weigh-in (and clears same-day
  duplicates) instead of adding a point per tap (reverses the Session-13 "every log a dot" choice, per
  Kevin, to stop clutter). (3) **Bug fix:** `.mood-btn` (the check-in Yes/No/Rest-Day buttons) had no
  `color`, so the text fell back to the browser's dark default and was invisible on the dark theme —
  added `color:var(--text)`. No `firestore.rules` change.
- Session 16: **Check-in calendar with highlighted logged dates (non-Blaze).** The check-in date
  picker (`DailyCheckIn`) replaced the native `<input type="date">` with a custom month calendar
  (`CheckInCalendar`): dates that already have a check-in are **highlighted green with a dot**, today
  is outlined, the selected date is filled, and ‹ › navigate months (any past/future date reachable).
  Tapping a day selects it — which, via the Session-15 pre-fill, loads any existing entry for editing.
  Pure UI; reads `data.checkIns`. No `firestore.rules` change.
- Session 17: **Shared weight-progress popup in Results, too (non-Blaze).** The full-screen
  weight-progress popup (the value-labeled, horizontally-scrollable `ProgressChart` plus a list of
  weigh-ins each with a **✕ delete**) was extracted out of the Client Dashboard into a single reusable
  component, `WeightChartModal`, and is now ALSO available from the full-plan **Results → Pro Tracking**
  chart: a "Tap chart to add / remove weigh-ins" hint sits under the chart, and tapping it opens the same
  popup the client sees. New `onDeleteCheckIn` handler on `Results` (wired in App) removes a weigh-in by
  timestamp and re-points current weight to the latest remaining weigh-in, or back to `startWeightLbs` if
  none remain — matching the client-side `deleteWeighIn`. `WeightChartModal` takes an optional
  `startWeight` (draws a "start → now" segment when only one real weigh-in exists) and an optional
  `onDelete(timestamp)` (omit for read-only). ClientHome's old inline modal was replaced by the shared
  component (its `deleteWeighIn` passed as `onDelete`). Pure refactor + one new handler; trainer and
  client now manage weigh-ins from the exact same UI. No `firestore.rules` change.
- Session 18: **UI polish pass (smoothness + cleanup, non-Blaze).** A cosmetic-only sweep to make
  the app feel more polished and cohesive; no logic or data changes. (1) **Page transitions:** a
  reusable `.page-transition` class (reuses the house `fadeUp` keyframe, .28s) replays a subtle
  fade-slide on every screen change — wizard steps, Dashboard ↔ Full Plan, and the trainer/client
  home screens (`.prof-screen` roots). The main-app flow wraps the step content in a `key`ed
  `<div className="page-transition">` (key = step / dashboard-vs-results) so it animates on
  navigation but NOT on every keystroke/save. Honors `prefers-reduced-motion` (disables animations
  + smooth scroll). (2) **Scroll-to-top on navigation:** a `useEffect` keyed on
  `[screen, step, showDash, homeTab]` jumps to the top on any view change so screens start clean
  instead of mid-page. (3) **Removed vestigial wizard chrome:** the leftover step-dots row no longer
  renders once past the wizard (it was showing as a faint dash row atop the Daily Dashboard and Full
  Plan). (4) **Cleaner disabled states:** disabled primary buttons (`.btn-p:disabled`) and the
  check-in Save button (`.checkin-submit:disabled`) now use a neutral surface + muted text instead of
  a 30%-opacity accent (which read as a muddy olive). (5) **Slimmer No-Cardio Daily Breakdown:** in
  the Results "No Cardio" tab, the per-day 4-cell target grid was removed — it repeated the same
  numbers on every day (identical to the Daily Targets card above; `tdee` isn't per-day in that tab).
  Day cards are now compact rows (day + cardio summary + burn + tap-to-edit); the **+Cardio** tab's
  grid, which IS per-day meaningful (`floor(tdee - t.cut + burned)`), is unchanged. Spacing was
  reviewed and left as-is — the app is already on a consistent 640px-container / 16px-card-gap rhythm,
  so a blanket change was judged higher-risk than its worth. No `firestore.rules` change. A throwaway
  test trainer account (`trainer.uitest@calorieiq-test.com`) + a "Test Client" local plan were created
  in Firebase during this session for visual testing; clearable. `.claude/launch.json` was added (dev
  server preview config).
- Session 19: **Trainer → client requests (non-Blaze).** A trainer can send a linked client a small
  actionable to-do that surfaces on the client's home screen. **Storage:** an append-only array in the
  CLIENT's account under `caliq-requests` (item shape `{ id, fromUid, fromName, type, prompt,
  status:"open"|"done", createdAt, doneAt }`, newest-first, capped 100). The trainer already has write
  access to the client's kv via `firestore.rules` (trainer↔client), so **no rules change**. **Trainer
  side** (`TrainerDashboard` connected-clients card): a **✉️ Send request** button opens a composer with
  4 quick templates (`REQUEST_TEMPLATES`: log food / weigh-in / record workout / enter info) **plus a
  custom free-text** message; sends via `getForUser`→`setForUser` (read-append-write) and drops a note
  into the client's `caliq-history-self` so the activity feed reflects it. Each client card shows a
  **📬 N open** badge, the open requests (each with a ✕ to cancel), and a collapsible "N completed"
  list. New props `meUid`/`meName`/`meRole` passed to `TrainerDashboard`; new module-level
  `REQUEST_TEMPLATES`, `REQUEST_KEY`, `readRequestsFor`. **Client side** (`ClientHome`): open requests
  render as task cards at the very TOP of the home (above the plan, so "enter your info" works before a
  plan exists) — each with **"Do it now →"** and **"✓ Mark done"** (sets status=done, writes back to
  their own `caliq-requests`, logs to history). **"Do it now" opens a type-specific quick-action popup**
  (`QuickActionModal`) so the client completes the task without leaving home: **weigh-in** → weight
  input (reuses `logWeight`), **log food** → calories input (reuses `adjustCalories`), **record
  workout** → optional note that sets `workedOut=true` on today's check-in (new `markWorkoutToday`
  helper); each auto-marks the request done, shows a ✓, and auto-closes after ~1s. **Enter-info /
  custom** requests need the full editor, so their popup offers an "Open my plan →" jump instead.
  (`logWeight`/`adjustCalories` were refactored to accept an optional explicit value and return a
  success boolean.) The reverse direction (client → trainer)
  needs server-side writes and waits for **Blaze**. Verified end-to-end with a second test account
  (`client.uitest@calorieiq-test.com`, "Casey Client", auto-linked to the test trainer via the invite
  link): send → receive → mark done → trainer sees completed. No `firestore.rules` change.
- Session 20: **Simulation tab — sandbox what-if plans (non-Blaze).** A trainer can build a complete
  what-if program and show its projected results, kept separate from real client plans (a sales /
  motivation tool). **A simulation is just a local plan flagged `isSimulation: true`** on its index
  entry — it reuses the entire wizard + the existing projection engine; no new storage namespace, no
  Blaze. `createProfile(folderId, {isSimulation})` sets the flag; `autoSave`'s `{...p}` index rebuild
  preserves it. **Merged listing (per Kevin):** since a simulation IS just a flagged local plan, the
  dashboard shows ONE **"📋 Local Plans"** card listing both, with **filter chips (All / Plans / 🧪 Sims)**,
  the existing sort chips, **🧪 SANDBOX** tags + purple tint on simulation cards, **"+ Plan"** and
  **"+ 🧪 Simulation"** create buttons, and a **Delete** action (inline confirm, via
  `removeLocalProfileById`) on every card. `ProfileSelector` (All-clients) still filters sims out.
  **Connected Clients** got the same sort chips (needs-attention / last-active / name; shown when 2+
  clients) since those are the real people to track. **Editor banner:** when the open plan is a sim (`activeIsSim`
  computed from the index in App, passed to `Results`), a "🧪 Simulation — sandbox projection, not a
  real client plan" banner shows above the wizard/Results. **Sales summary:** new `SimulationSummary`
  card at the top of a simulation's Results — a before→after projection ("220 → 190 · Lose 30 lbs in
  ~7 months · on track by January 2027"), reusing `weeksToGoal`/`friendlyTime` (diet, and diet + the
  plan's weekly cardio burn). **Convert to client plan:** `convertSimulation(id)` clears the flag so the
  sim moves out of Simulations into Local Plans (ready to link to a client via the existing flow);
  guarded by an inline confirm. Verified end-to-end (create → wizard → projection → convert). No
  `firestore.rules` change. **Note:** `AGENTS.md` (OpenAI Codex's project-guide file, created when Kevin
  installed Codex) is kept as a synced copy of this CLAUDE.md so Codex and Claude share context.
- Session 21: **Multiple plans per client (non-Blaze, trainer + client both manage).** A connected
  client account can now hold several plans (cut/maintain/bulk phases, drafts, templates) with one
  marked **active**; the active plan drives the client's home + the trainer's overview. **Key insight:**
  the storage was already plan-id-keyed — a plan's data/log/history live at `caliq-{id}` /
  `caliq-log-{id}-{date}` / `caliq-history-{id}`, and the original single plan is just id **"self"** — so
  multiple plans only needed a **manifest** + UI, not a storage rewrite. New manifest per client account:
  `caliq-plans = { active, plans:[{id,name,createdAt}] }` (module helpers `readPlansManifest`/
  `writePlansManifest` take a get/set pair so the SAME code works for the client via `window.storage`
  and the trainer via `getForUser`/`setForUser`; `normalizePlans` synthesizes a default `{active:"self",
  plans:[{id:"self",name:"Main plan"}]}` so **existing single-plan clients migrate transparently** — no
  data touched). New key helpers `planDataKey`/`planLogPrefix`/`planHistoryKey`. **Client side**
  (`ClientHome`): a plan switcher chip ("🗂️ Main plan · N plans") that lists plans (switch / rename /
  delete / **+ New plan**); all the hardcoded `"self"` keys were generalized to `activePlanId`
  (load/logWeight/adjustCalories/markWorkoutToday/deleteWeighIn/appendHistory + the quick-action
  popups). **Trainer side** (`TrainerDashboard`): each connected-client card got a **🗂️ Plans** manager
  — list with the active (●) marked, **Make active**, **Open** (per plan), rename, delete, and **+ New
  plan** (writes into the client's account via the manifest helpers; `loadClients` now reads each
  client's active plan + plans list). **App:** `openClientPlan(clientUid, planId)` opens a specific (or
  the active) plan and sets `activeId` to the plan id; `autoSave`'s remote write, `copyClientToLocal`,
  `linkPlan`, and `unlinkPlan` all generalized from `"caliq-self"` to the active plan's key (so per-plan
  logs/history route correctly for the trainer too). Verified end-to-end: back-compat load, trainer
  create/switch/active, client switch with fully separate per-plan data. No `firestore.rules` change.
- Session 22: **Calendar view — month / week / day + back-dated logging (non-Blaze).** A full calendar
  over a plan's daily logs + check-ins, reached via a **📅 Calendar** button on the Daily Dashboard
  (`CalendarView` component; works for the client AND a trainer viewing a client because it goes through
  the existing remote-aware log I/O). **Three views** via a Month/Week/Day toggle: **Month** = grid with
  per-day indicator dots (🟢 food logged · 🔵 weigh-in · 🟠 workout · ◦ scheduled-workout-that-weekday),
  today outlined, tap a day → Day view; **Week** = the 7 days of a week with per-day summaries; **Day** =
  one date's detail with **back-dated logging** — calories (quick +100/+250/+500/Clear) + meals (reuses
  `MealLog`), **weight** (`WeightDayLogger`, commits on Log/Enter), and **mark workout done**, plus the
  recurring schedule for that weekday (`data.cardio`/`data.strength`, keyed by full day name). **Data
  plumbing:** date keys are UTC `YYYY-MM-DD` to match existing log keys; new App callbacks `onReadDay`/
  `onWriteDay`/`onListLoggedDays` (built on the remote-aware `logRead`/`logWrite` + a new `logList`) read/
  write/list `caliq-log-{activeId}-{date}`; weight/workout write to `data.checkIns` via the existing
  `onSaveCheckIn` (replace-by-date) so they feed the progress chart too. Verified end-to-end: logged
  food + weight + a workout on a PAST date, indicators appeared in month + week, all three views correct.
  Known minor: two check-in writes in the SAME tick (e.g. weight + workout before a re-render) can
  overwrite since each rebuilds the full entry from current `data` — fine for normal tapping. No
  `firestore.rules` change. **Roadmap note:** this builds the broader calendar the Session-16 highlighted-
  date check-in picker hinted at; daily/weekly/monthly are all shipped here.
- Session 23: **Navigation side menu (non-Blaze).** A hamburger (**≡**, fixed top-left) on every screen
  opens a slide-out **`SideMenu`** drawer (left, with a dimming backdrop, .28s transform). Contents: the
  CALORIEIQ brand + ✕, an **identity card** (name · role badge · email) with inline **name editing**
  (first/last → the existing `setName` from profile.js; updates `meName`), role-aware **navigation**
  (🏠 Home, and for trainers 📊 Dashboard + 👥 All clients — each calls `goToProfiles`/`setHomeTab` and
  closes the menu), and **🚪 Sign out** (`signOut(auth)`). **Architecture:** to put it on every screen,
  App computes a `chrome` element (hamburger + `<SideMenu>`) once and injects `{chrome}` into all four
  return paths (ClientHome / TrainerDashboard / ProfileSelector / main app) — `isTrainerHome` was hoisted
  out of the profiles branch for this. New App state `menuOpen` + `meEmail` (set alongside meName/meUid).
  **AuthGate** no longer renders its floating white "Sign out" button for the signed-in app (it clashed
  with the dark theme); sign-out now lives only in the menu (the button still shows on the login / role-
  chooser screens). New imports in App: `auth` (./firebase) + `signOut` (firebase/auth). Verified:
  hamburger on all screens, nav works + closes, name edit pre-fills/saves. No `firestore.rules` change.
- Session 24: **Declutter pass — sleeker app via the side menu (non-Blaze).** Now that Session 23
  added the menu, this pass pulls secondary chrome OFF the screens and INTO it. (1) **Slim top bar:**
  the tall logo+tagline `.header` is now a thin bar (logo 2.2→1.5rem, padding 22→13px, tagline
  `display:none`), recovering vertical space on every screen; the fixed hamburger sits in its left
  gutter. (2) **Invite → menu:** the trainer's invite-code/copy-link card was removed from the home
  and rebuilt in `SideMenu` under **📨 Invite clients** (loads the code via `ensureInviteCode`, Copy
  code + Copy invite link); RolePanel's trainer branch is now a one-line pointer. (3) **Removed
  redundant nav:** dropped the Dashboard/All-clients toggle (trainer Dashboard + All-clients views)
  and the duplicate "All Clients/My Home" button in the in-plan header — the menu's Dashboard / All
  clients cover it; the contextual "← Back" stays. (4) **Trainer role card removed:** the leftover
  "TRAINER · invite pointer" `RolePanel` card is gone from both trainer screens (identity + invite are
  in the menu), so the trainer home leads straight with **Connected Clients** and the All-clients view
  with **Client Profiles**. **Client side of #4 was intentionally NOT done** (Kevin's call): the
  client's "your trainer / Leave / join-by-code" panel stays on the client home because it's useful
  account info AND it carries the **invite auto-link** side effect (a client opening `?invite=CODE`
  gets linked there) — moving it would mean relocating that auto-link, higher risk for low reward.
  **Bug fix (same session):** `Results` read `ACTIVITY_LEVELS.find(...).multiplier` with no fallback,
  so opening the Full Plan of an **incomplete plan** (no `activityLevel`) threw "Cannot read properties
  of undefined (reading 'multiplier')" and blanked the screen — now falls back to `ACTIVITY_LEVELS[0]`
  (matching `computeClientCalories` / App's `computedTdee`). This was a pre-existing latent bug exposed
  by multi-plan + tap-to-open (a client's active plan can be an empty one). No `firestore.rules` change.
- Session 25: **Tailwind v4 adoption + theming + brand recolor (per `CalorieIQ-Tailwind-Design-Brief.md`).**
  **Part 1 — Tailwind v4 (careful, additive):** installed `tailwindcss` + `@tailwindcss/vite` (4.3.1);
  added the Vite plugin; `src/index.css` imports Tailwind's theme + utilities layers but **deliberately
  excludes preflight** (the global reset) so the existing inline-styled app is untouched (utilities only
  emit for classes used in markup; `@theme` tokens are inert until referenced). Imported once in
  `main.jsx`. Tailwind is for **new** components only — no wholesale rewrite. **Part 2 — theme system +
  showcase:** `index.css` `@theme` defines semantic tokens (`--color-bg/surface/surface2/border/fg/muted/
  primary/primaryfg/accent/success/warn/danger`, `--font-sans/display`, `--radius-card`) → Tailwind
  utilities (`bg-surface`, `text-primary`, `font-display`, `rounded-card`, …). `src/themes.css` holds
  swappable looks as `[data-theme]` blocks that override the token names **directly** (an indirection var
  resolves at `:root` and won't re-skin per subtree — important gotcha). Four themes built: Clean/Minimal,
  Bold/Energetic, Warm/Friendly, **Dark/Pro**. `src/Showcase.jsx` is a **dev-only** style showcase + live
  theme switcher (palette, buttons, inputs, cards, progress ring + stat tiles, mini dashboard); reached at
  **`/?showcase=1`** (main.jsx renders it INSTEAD of the app for that URL — fully isolated, no login).
  **Part 3 — brand direction chosen:** Kevin picked **Dark/Pro**, tuned to the **Smooth Training** brand
  (black + cyan `#08DCE0`, sampled from `Second Logo Option Banner.png`): near-black surfaces (`#060809`,
  not pure black for depth), cyan primary with near-black text on it (high-contrast CTAs), sky-blue accent,
  green/amber/red kept semantic. **Live-app recolor (quick win):** swapped the app's lime accent
  (`#e8ff4f` / `rgba(232,255,79,…)`) → brand cyan (`#08dce0` / `rgba(8,220,224,…)`) throughout `App.jsx`
  (~88 refs) — color-only, no functionality/layout change, so the whole live app is now on-brand cyan.
  **Deferred (Option 3, later):** gradually rebuild real screens in Tailwind + the brand theme, screen by
  screen, only when already working in that area (never break working UI). No `firestore.rules` change.
- Session 26: **Client Dashboard redesigned in Tailwind + brand theme (Option 3 begins).** First real
  screen migrated to the new system per the brief. `ClientHome`'s render was rewritten with Tailwind
  utilities wrapped in `data-theme="pro"` (brand near-black + cyan), keeping **all logic/handlers/state
  identical** (weight log, plan switcher, trainer requests, quick-log, progress chart, time-to-goal,
  modals) — purely a visual layer swap. Design improvements (Part 3): the **current weight is now the
  hero** (Sora display, text-5xl), clear card hierarchy with cyan section headers, consistent 16px rhythm
  (`flex flex-col gap-4` — note: `space-y-*` was unreliable here), lifted card surfaces so they pop off
  the near-black bg, and the TODAY quick-log restructured (input full-width over the −Remove/+Add row) so
  it doesn't overflow on phones. Local style-object consts (`field`/`logBtn`/`miniBtn`/…) became Tailwind
  class-string consts (`cardCls`/`inputCls`/`primaryBtnCls`/`ghostBtnCls`/`miniBtnCls`). The brand **pro**
  theme tokens were tuned for card contrast (`--color-bg #05080a`, `--color-surface #121b1e`, brighter
  `--color-border`). The header is a min-h-[54px] brand bar that clears the fixed hamburger. **Not yet
  migrated (later passes):** the modals (`WeightChartModal`/`QuickActionModal`) and `RolePanel` still use
  the old styles (they render fine, just slightly different) — safe to do next. Verified: renders with
  real data, interactions work (weight-log toggle etc.), no console errors. No `firestore.rules` change.
- Session 27: **Finished the Client screen — modals + RolePanel migrated to Tailwind + brand theme.**
  Closed out Session 26's deferred items (Option 3, client screen done). The three components that still
  used old inline styles inside `ClientHome` were rewritten with Tailwind utilities + the semantic tokens
  (`bg-surface`/`text-fg`/`text-muted`/`border-border`/`bg-primary`/`text-primaryfg`/`rounded-card`/
  `bg-danger`), **logic/handlers/state untouched** (pure visual swap). (1) **`WeightChartModal`** and
  (2) **`QuickActionModal`** each got their **own `data-theme="pro"` wrapper** on the overlay root, so
  they're self-contained — important for `WeightChartModal`, which is ALSO opened from the old-styled
  **Results** page (no `pro` wrapper there); previously a token-based modal would have fallen back to the
  light default `@theme` and rendered white-on-dark. Now it looks identical from the Client Dashboard and
  Results. (3) **`RolePanel`** (the client's "🙋 Client / linked-trainer / Leave / join-by-code" card)
  was converted from the old `card`/`card-title`/`card-sub` classes + inline style objects to Tailwind
  class-string consts (`fieldCls`/`btnCls`/`subCls`); it renders inside `ClientHome`'s `pro` wrapper so no
  own `data-theme` is needed. The Leave-trainer confirm uses `bg-danger`. **`ProgressChart`** got an
  optional `surfaceless` prop (passed from `WeightChartModal`) that drops its old `.card` purple
  background/border so the chart blends into the brand modal's near-black surface; the Results "Pro
  Tracking" chart keeps its normal card styling (prop omitted there). **Pre-existing bug fixed while
  here:** both modals used `position:fixed; inset:0` with no portal, so when opened from the **Results**
  page they anchored to the `.page-transition` wrapper (Session 18) — which keeps a CSS `transform`,
  making it the containing block for `fixed` descendants — instead of the viewport, rendering mis-sized
  and unusable. Fixed by rendering both modals through a **`createPortal(…, document.body)`** so they
  escape the transformed ancestor (new import: `createPortal` from `react-dom`). This was broken since
  Session 18, only surfaced now because the modal is normally opened from the Client Dashboard (where the
  trap didn't apply), not Results. Verified live from BOTH entry points (logged in as `client.uitest` for
  the dashboard and `trainer.uitest` → Casey's shared plan → Full Plan → Pro Tracking for Results): the
  modal anchors to the viewport (375×812 at 0,0), renders on-brand, weigh-in delete list works, no console
  errors, `npm run build` passes. No `firestore.rules` change.
- Session 28: **Trainer home (`TrainerDashboard`) redesigned in Tailwind + brand theme (Option 3 continues).**
  The trainer's landing screen was migrated to the new system — the second real screen after the Client
  Dashboard. **Logic/handlers/state/data-loading all untouched** (loadClients, link/unlink/copy, request
  composer, multi-plan manager, sims, sort/filter) — purely the render + the inline style-object consts
  were swapped to Tailwind. The whole return is wrapped in `data-theme="pro"` with the slim brand header bar
  (`min-h-[54px]`, clears the fixed hamburger) and the same `max-w-[640px]` container as ClientHome. The old
  `.header`/`.tagline` and the `card`/`card-title`/`card-sub` classes were replaced; per-element inline
  styles became Tailwind class-string consts (`cardCls`/`sectionTitleCls`/`subCls`/`mBtnCls`/`mPrimaryCls`/
  `dangerBtnCls`/`dangerGhostCls`/`inputCls` + `chip(active)`/`purpleChip(active)` helpers for the
  sort/filter chips). Semantic tokens throughout (`bg-surface`/`bg-surface2`/`bg-bg`/`text-fg`/`text-muted`/
  `border-border`/`bg-primary`/`text-primaryfg`/`bg-danger`). **Sims keep their established purple identity**
  (🧪 SANDBOX tag, purple-tinted card, "+ 🧪 Simulation" button, purple filter chip) via arbitrary values
  (`#b57bff` / `rgba(181,123,255,…)`) since the brand palette has no purple — purple = "sandbox, not a real
  client" is meaningful color. Cyan tints (connected-client border, active-plan row, open-request pills)
  use brand-cyan arbitrary rgba (`rgba(8,220,224,…)`). The dead `tabBtn` const (leftover from the Session-24
  nav removal) was deleted. Verified live as `trainer.uitest` (has Casey connected + 2 local plans + 1 sim):
  header, Connected Clients card, client card, request composer, plans manager, Local Plans cards/chips all
  render on-brand; no console errors; `npm run build` passes. **Not yet migrated (later passes):** the
  All-clients `ProfileSelector`, the setup wizard, and the full-plan/Results editor. No `firestore.rules` change.
- Session 29: **All-clients screen (`ProfileSelector`) redesigned in Tailwind + brand theme (Option 3 continues).**
  The trainer's "All clients" view (local profile + folder manager + data import/export) was migrated — this
  completes the trainer-facing screens. **All logic/handlers/state untouched** (drag-and-drop move, folder
  create/rename/delete, profile rename/delete-confirm, clipboard copy/paste, file export/import, recover) —
  only the markup/styling changed. This screen was heavier than the dashboards because it relied on a large
  set of shared `css`-block classes (`.prof-card`/`.prof-avatar`/`.folder-section`/`.folder-header`/
  `.folder-act-btn`/`.dash-stat`/`.save-bar-btn` …) that don't pick up the brand tokens, so it needed a real
  markup rewrite rather than a wrapper. Wrapped in `data-theme="pro"` with the slim brand header + `max-w-[640px]`
  container; class-string consts (`cardCls`/`sectionTitleCls`/`subCls`/`primaryBtnCls`/`ghostBtnCls`/`inputCls`).
  **Drag-and-drop visuals** were ported from the old `.drag-ghost`/`.drag-over` classes to conditional Tailwind
  (`opacity-40` on the dragged card; `border-primary bg-[rgba(8,220,224,.06)]` cyan highlight on the drop-target
  folder); the folder chevron rotates via `rotate-0`/`-rotate-90`. Stat tiles use semantic colors
  (`text-primary`/`text-success`/`text-warn`); the green "Copy to Clipboard" CTA uses `border-success`/`text-success`.
  Avatars are cyan (`bg-primary text-primaryfg`). Verified live as `trainer.uitest` (3 unfiled clients): header,
  stat tiles, folder/unfiled sections, profile cards, New-Folder input, and the full Data Management section all
  render on-brand; no console errors; `npm run build` passes. **Not yet migrated:** the setup wizard and the
  full-plan/Results editor (the two biggest screens). No `firestore.rules` change.
- Session 30: **Setup wizard (all 5 steps + shared chrome) → Tailwind + brand theme (Option 3 — the in-plan
  flow).** Kevin chose to migrate the whole in-plan flow (wizard + Results) together for visual consistency.
  **Useful context:** the in-plan screens were already dark+cyan from the Session-25 accent recolor, so this
  is more a consistency/polish migration (brand tokens + Sora headings + surface shades) than a dramatic
  reskin — and even a partially-migrated wizard reads coherently (old + new both dark+cyan). **Done:**
  (1) `BottomNav` — self-contained `data-theme="pro"` fixed bar. (2) Shared module-level helpers: `WZ` (class
  strings card/title/sub/label/hint/input/err/tip), `wzGbtn(active)` (gender toggle), `wzAbtn(active)` (large
  selection row), and `WZW` + `wzFillDay`/`wzPreset` for the workout steps (quick-fill panels, per-day cards,
  selects). (3) **All 5 steps** — `StepPersonal`, `StepGoalWeight`, `StepActivity`, `StepCardio` (step 4),
  `StepStrength` (step 5) — rewritten with brand tokens; **all logic/validation/calcs/handlers untouched**
  (input filtering, BF%/BMI math, quick-fill, movement combos, per-day sessions). Each step root carries its
  own `data-theme="pro"`. The Movement Combos toggle keeps its distinct **green** (`text-success`) identity;
  the sim banner keeps **purple**. (4) **Shared App chrome** (in App's main return, shared with Results):
  `.app` got `data-theme="pro"`; the `.header`/`.prof-header-bar`/`.steps-wrap` step-progress were rewritten
  to the brand header bar + cyan back-button + token-based step icons/label/dots (the `.app`/`.container`
  classes kept for layout). Verified live (trainer.uitest → new client → walked all 5 steps): header, back-bar,
  step indicator, every step body + quick-fill/combo panels/day-cards render on-brand; no console errors;
  `npm run build` passes. **Still old-styled (acceptable interim, render dark+cyan):** the `SearchableSelect`
  and `CustomExerciseCreator` sub-components inside the workout steps. **Next:** the **~3,000-line `Results`**
  component (its own multi-pass effort) — the chrome around it is already branded; only its body remains. The
  step-5 `DailyDashboard` (in-plan daily view) is also still old. **Bug fixed (same session):** the fixed
  `BottomNav` was anchoring to the `.page-transition` wrapper (its retained `transform: matrix(...)` becomes
  the containing block for `position:fixed`) instead of the viewport, so the bar floated mid-page and covered
  the last lines of long steps (e.g. the Activity disclaimer). Fixed by rendering `BottomNav` through
  `createPortal(…, document.body)` — same transform-trap fix used for the modals (Session 27). This was
  pre-existing (the old `.bottom-nav` was trapped too). Verified: nav now sits at the viewport bottom and no
  content is covered on any step. No `firestore.rules` change.
- Session 31: **In-plan flow finished on-brand via a token retune (Results + Daily Dashboard) — Option 3
  done.** Instead of a risky ~3,000-line Tailwind rewrite of `Results`, the key insight: the in-plan screens
  are built on the **old `:root` CSS variables** (in App.jsx's `css` block), which after the Session-25
  recolor were dark **but purple-tinted** (`--bg #0d0d18`, `--surface #16162a`, purple `--border`/`--text`/
  `--muted`) with the accent already brand cyan. So the only "off-brand" thing was the **purple cast**.
  Fixed by **retuning the old neutral tokens to the brand `pro` values** (`--bg #05080a`, `--surface #161f24`,
  `--s2 #1e2a2e`, `--s3 #28383a`, `--border #2e4241`, `--border-light #3a5250`, `--text #eafcfc`,
  `--text-secondary #c4dede`, `--muted #7e9a9a`, `--muted-light #9bb8b8`) and aligning the semantic
  `--green/--yellow/--red` to brand (`#2fe0a8`/`#fbbf24`/`#f87171`); `--accent` unchanged (already cyan);
  `--orange`/`--purple`/`--blue` kept. ~12 lines, **zero markup change**, so no regression risk — and it
  brings ALL remaining old-var screens on-brand at once: the full `Results` (Basic + Pro, all 8 tabs), the
  `DailyDashboard`, `MealLog`, `ActivityFeed`, `AICoach`, and the exercise pickers. Mirrors the values in
  `src/themes.css [data-theme="pro"]`. Login/`AuthGate` is unaffected (its own styling, mounts before the
  css block). Verified live (trainer.uitest → Test Client → Results Basic + Pro, and the Daily Dashboard):
  purple cast gone, near-black + cyan throughout, no console errors, `npm run build` passes. **Remaining
  stylistic holdover (minor, left intentionally):** in-plan card titles still use Bebas Neue (the `.card-title`
  class) vs Sora (`font-display`) on the Tailwind-rebuilt screens — reads fine as a display font; a later
  polish pass could unify it. **Net:** every screen is now on-brand. No `firestore.rules` change.
- Session 32: **Unified the heading font — Bebas Neue → Sora across the in-plan screens.** The last
  stylistic holdover from Session 31: the in-plan css-block classes (`.card-title`, `.wb-title`, `.hero-val`,
  `.lb-val`, `.wc-val`, `.ibw-title`, stat values, the old `.logo`/`.btn`, etc.) hardcoded
  `font-family:'Bebas Neue'`, while the Tailwind-rebuilt screens use **Sora** (`--font-display` in the `pro`
  theme). Replaced all **111** `'Bebas Neue',sans-serif` occurrences with `'Sora',sans-serif` (Sora is
  already loaded globally via `src/themes.css`). **Visible effect:** Bebas is a caps-only condensed display
  face, so title-case text *appeared* uppercase (e.g. "IDEAL BODY WEIGHT"); in Sora it now renders in its
  real case ("Ideal Body Weight") — cleaner and matching the rebuilt screens. Big stat numbers (e.g. the
  Daily Dashboard "2365 cal remaining" ring, Results "2,865") are now Sora, mirroring ClientHome's hero
  weight; the in-plan "Hey Test" greeting now matches ClientHome's "Hi, Casey 👋" exactly. Small uppercase
  labels (via `text-transform`/letter-spacing) are unchanged, preserving the heading→label hierarchy. The
  font-load `@import` (line ~175) still pulls Bebas Neue but only **DM Sans** (the in-plan body font) is now
  used from it — left as-is. Verified live (Results Basic + Pro, Daily Dashboard): headings render in Sora,
  no overflow, no console errors, `npm run build` passes. The app's typography is now consistent everywhere.
  No `firestore.rules` change.
- Session 33: **Activity-log search now understands relative time.** The "View all changes" overlay's search
  (`ActivityFeed`) previously matched only the literal name/action/date text. Added a module-level
  `relativeTimeMatch(eventDate, q)` that recognizes time phrases — `today`, `yesterday`, `this/last week`,
  `this/last month`, and `N day(s)/week(s)/month(s) [ago]` (incl. abbreviations `d`/`w`/`mo`/`m`) — and
  filters events by age. Wired into `matches` as an additive OR after the text-haystack check (so typing an
  action word still works); days = exact day, weeks = ±3-day window around N×7, months = that calendar month.
  Placeholder updated to hint the new capability. Logic unit-tested (15 cases) + verified live: "today" shows
  today's entries (incl. ones with no "today" in their text), "2 days ago" shows only the 2-days-ago entries.
  Filters live as you type. No `firestore.rules` change.
- Session 34: **Trainer analytics dashboard (coaching command center) — the side-menu 📊 Dashboard is now a
  real screen.** Previously the side menu's "📊 Dashboard" item duplicated "🏠 Home" for trainers (both set
  `homeTab="dashboard"` → the connected-clients/local-plans `TrainerDashboard`). Added a third `homeTab`
  value **`"analytics"`** and pointed "📊 Dashboard" at it (Home still → `"dashboard"`, All clients →
  `"clients"`). New `TrainerAnalytics` component (rendered in App when `isTrainerHome && homeTab==="analytics"`):
  loads `getMyClients()` then each client's ACTIVE plan (`getForUser` via the plans manifest) + logged dates
  (`listForUser`) + requests (`readRequestsFor`), and surfaces, on-brand (Tailwind + `data-theme="pro"`):
  (1) **summary tiles** — clients / active this week / need attention / open requests; (2) **⚠️ Needs
  attention** — clients with no logs in `ATTENTION_DAYS` (3)+ days, sorted quietest-first, tap to open;
  (3) **📬 Open requests** — every open trainer→client request across all clients, tap to open that client;
  (4) **📈 Progress** — aggregate total lbs lost + on-track count (`weightTrend`/`etaWeeks`), and per-client
  lbs lost (start weigh-in → current) with an on-track/off-track badge. Tapping any row calls
  `openClientPlan(uid)`. Reuses existing helpers (`computeClientCalories` not needed here; `weightTrend`,
  `etaWeeks`, `readPlansManifest`, `planDataKey`/`planLogPrefix`, `getForUser`/`listForUser`,
  `readRequestsFor`). No new data model, no Blaze, no `firestore.rules` change. Verified live as
  `trainer.uitest` (Casey connected): tiles, needs-attention (Casey at 3 days), open-requests empty state,
  and progress all render; no console errors; `npm run build` passes.
- Session 35: **Redesign loose ends — last two sub-components + dead font import.** Closed out the brand
  redesign. (1) `SearchableSelect` (the exercise type-ahead in the workout steps) and (2)
  `CustomExerciseCreator` (the "⭐ Create Custom Exercise" panel) were the last components still on old inline
  styles / `.quick-fill-*` classes. Rewrote both with Tailwind + the shared `WZ`/`WZW` helper class strings
  (`WZ.input`/`WZ.label`/`WZ.hint`), so they match the rest of the wizard exactly — note these reference the
  module-level `WZ`/`WZW` consts defined *later* in the file, which is fine since the components are only
  called at render time (after module eval). `CustomExerciseCreator` keeps its distinct **purple** identity
  (toggle, panel border, Save button) signalling "user-created / non-standard", consistent with how sims use
  purple. (3) Removed **Bebas Neue** from the css-block `@import` (line ~175) — it was unused after the
  Session-32 font unification; only DM Sans (the in-plan body font) is still pulled from it. Zero Bebas refs
  remain in the file. Verified live (Strength step → Custom Exercise panel renders on-brand, purple Save
  button); no console errors; `npm run build` passes. The whole app is now consistently on the brand system.
- Session 36: **Daily macro totals in the meal log.** The `MealLog` (Daily Dashboard "🍽️ Meals & Food
  Today") captured protein/carbs/fat grams per food but never summed them — the footer only showed calories.
  Added day totals computed from the `meals` prop already passed in (no new data, no plumbing): `totP`/
  `totC`/`totF` + a reusable `MacroSummary` chip row (colour-coded — protein cyan `--accent`, carbs
  `--yellow`, fat `--orange`). Shows in the open-view footer (left of the cal/items total; when no macros
  are logged it shows a "add macros to track…" tip instead) AND under the collapsed header so it's glanceable
  without expanding. Display-only, kept the component's existing inline-style approach (brand-aligned since
  the Session-31 token retune). Verified live: logged "Chicken & rice 600cal 45p/70c/12f" → footer shows
  "45g protein · 70g carbs · 12g fat · 600 cal". No `firestore.rules` change. (Bug caught + fixed during the
  edit: a duplicated `</div>` in the header broke the build; the live console showed stale Vite HMR errors
  from that moment — the clean `npm run build` + a fresh reload confirmed the file is healthy.)
- **Known state:** there are test accounts and test client profiles in Firestore from manual
  testing — these are not real users and can be cleared. The Session-13/14 testing also left **test
  weigh-ins/check-ins** (incl. some old same-day duplicates from before the Session-15 one-per-date
  change) in the test client's `caliq-self` — clearable via the 📈 Progress list's ✕ or by re-saving
  that date.

## Roadmap (not yet built)

- **"Glide works with your AI" — interop with Claude / ChatGPT / any AI (Kevin's idea, S80).** Brand thesis:
  Glide should COLLABORATE with outside AI tools, not compete. Users keep their favorite AI but bring its
  output home to Glide as their organized fitness hub. **Honest constraint:** those platforms don't expose a
  user's chat history to third parties, so auto-sync isn't possible — the play is effortless *user-initiated*
  transfer + being a tool their AI plugs into. Phased: (1) **Paste-to-import (do first, low effort, high
  leverage)** — a "Paste from any AI" box where the user pastes a ChatGPT/Claude reply and **Glide's own AI
  parses it into structured logs** via the EXISTING tools (`log_meal` etc.); works with every AI day-one since
  they all output text. (2) **Two-way "Glide format"** — a small prompt users add to their AI's custom
  instructions so it formats fitness data Glide-importable, plus a Glide→AI export (paste your week into Claude
  for analysis). (3) **Glide as an MCP connector (flagship endgame)** — expose Glide as an MCP/connector so a
  user's own Claude/ChatGPT can read/write their Glide data natively with permission; needs an OAuth'd hosted
  endpoint (have Blaze/Cloud Functions). Genuine differentiator — nobody in fitness is doing this. Recommend
  shipping #1 soon, #3 on the roadmap as the marquee "works with your AI" feature.
- ~~**Trainer analytics dashboard (Kevin's idea, planned).**~~ **BUILT — Session 34** (`TrainerAnalytics`).
  The side-menu "📊 Dashboard" is now a real coaching command center (active this week, needs attention,
  open requests across clients, aggregate progress + on-track), distinct from the home and All-clients.
  Possible future enhancements: configurable attention threshold, per-client mini sparklines, week-over-week
  deltas, filter/sort the lists. No Blaze.
- **Continue the Tailwind redesign (Option 3, in progress).** Client Dashboard is done (Session 26).
  Next candidates, one at a time, only when already in that area: the modals + RolePanel (finish the
  client screen), then the trainer home, the wizard, and the full-plan/Results view. Never break working
  UI to restyle it.

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
- **Requests / to-dos between trainer and client (Kevin's idea).** **Trainer→client half BUILT
  (Session 19)** — see the build log above; the **client→trainer** half below still needs Blaze.
  Either side can send the other a
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
  **Kevin's refinement (the highlighted-date check-in picker is now BUILT — Session 16):** the
  broader full calendar (daily/weekly/monthly toggle, back-dated food + workout logging) is still
  roadmap.
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
- **Notification center / preferences (Kevin's vision, S71).** A dedicated place where a user sees the
  kinds of nudges & reminders the app can send and controls them: a **master on/off** plus **per-type
  toggles** (e.g. trainer to-dos, food-logging reminders, weigh-in reminders, AI coaching nudges, and
  later trainer-side events like "a client logged"). **Why (Kevin):** Glide should be a place people can
  use for *just one thing* — someone who only wants the AI chat for fitness advice shouldn't be nagged by
  food-tracking reminders. Granular control lets each user keep the features/nudges they want and silence
  the rest. **Status: BUILT — Session 76** (the central screen). The `SideMenu` "🔔 Notifications" section has a
  **master switch + per-type toggles**, backed by one unified `caliq-notif-prefs` `{master, trainerReminders,
  sentReminders}` lifted to App and synced with the inline home/dashboard toggles. (S71 shipped the first per-type
  toggles; S76 consolidated them into the Notification Center + master, exactly the "consolidate into one
  notificationPrefs object" build path.) **Only one notification TYPE exists today** (trainer to-dos) — adding more
  (food-logging, weigh-in, AI nudges, later "client logged") is now just one new key + one row + one gate.
  Pure display-pref toggles are **non-Blaze**; actual *push/delivery* notifications (and the trainer-side "client
  joined/logged" events below) still need **Blaze/Cloud Functions**.
- **Notification center (delivery side)** — notify a trainer when a client joins or leaves (and similar
  events). Deferred until Blaze/Cloud Functions: a client safely creating a notification on the trainer's
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
- Session 37: **Macro targets + progress bars in the Daily Dashboard.** The dashboard already had macro
  logging with protein (1g/lb) and fat (28% of cal) targets, but **carbs had no target** ("fills remaining
  after P & F") and the macro summary bar showed only the consumed *split* (proportional), not progress vs
  goal. Computed the three targets once (`proteinTarget` = `weightLbs`×1, `fatTarget` = `target`×0.28/9,
  `carbsTarget` = remaining cals ÷4) and: (1) carbs log-row now shows "Target: ~Ng"; (2) replaced the
  proportional split bar with **per-macro logged-vs-target progress bars** (protein pink / carbs yellow /
  fat blue, fill capped 100%, turns `--orange` + ⚠️ when over, ✓ when at/over goal), keeping the "cal from
  macros · targets are estimates" caption. Display-only (commit path unchanged); reads `dailyLog.protein/
  carbs/fat`. Verified live (Test Client): targets show 200g/225g/74g for a 200lb client; bars render
  45/200, 70/225, 12/74 from logged macros. No `firestore.rules` change. **Note:** macro split uses common
  coaching defaults (1g/lb protein, 28% fat) — easily adjustable; could become trainer-editable later.
- Session 38: **One-tap re-add of recently logged foods (meal log).** Repetitive food entry is the #1
  friction in self-logging, so named foods are now remembered for instant re-add. New remote-aware store
  `caliq-foods-{activeId}` (a list of `{name, calories, protein, carbs, fat}`, deduped by lowercased name —
  latest macros win — newest-first, capped 24). App: `recentFoods` state + `recentFoodsRef`; loaded in the
  daily-log effect; `upsertRecentFood(m)` called from `onAddMeal` and `onEditMeal` (only when the food has a
  name); written via the existing remote-aware `logWrite` so a trainer logging for a client builds the
  CLIENT's list. Threaded `recentFoods` → `DailyDashboard` → `MealLog`. In `MealLog`'s add-form (new entries
  only, not when editing), a **"RECENT — TAP TO ADD"** pill row shows the last 8 foods; tapping one calls
  `onAddMeal` with that food's name+cals+macros tagged to the meal type being added, then closes the form
  (one tap). Verified live end-to-end (Test Client): logged "Oatmeal 300", reopened the Dinner form → chip
  appeared → tapped it → total went 900→1,200 cal (3 items), form closed. The calendar back-dated day-logger
  reuses `MealLog` without `recentFoods` (no chips there — fine). No `firestore.rules` change (the foods key
  rides the existing trainer↔client kv access).
- Session 39: **Editable macro targets (coach or client).** The Session-37 macro targets were computed-only;
  now they're overridable per plan. Stored as `data.macroTargets = {protein, carbs, fat}` (grams) — rides
  the existing remote-aware plan save, so a coach editing a client's plan AND the client on their own
  dashboard can both set them. `DailyDashboard` now prefers `data.macroTargets` over the auto estimates
  (protein 1g/lb, fat 28% cal, carbs remainder); `macrosCustom` flags which is active. New App handler
  `onSetMacroTargets(t|null)` (set via `setDataAndSave`; `null` deletes the key → back to auto). UI: in the
  expanded macro section, an **"✎ Edit targets"** link opens inline Protein/Carbs/Fat g inputs (pre-filled
  with current effective values) + **Save targets** and (when custom) **Reset to auto**; the disclaimer line
  shows "Custom targets set by you" vs "Estimates from bodyweight & calorie goal". Verified live (Test
  Client): set protein 200→180 → log-row + progress bar updated to 180g, "Custom" label shown; Reset to auto
  → back to computed 200g. No `firestore.rules` change. Defaults unchanged (1g/lb, 28% fat) — now adjustable.
- Session 40: **"This Week" nutrition summary on the Daily Dashboard.** A coaching-glance card showing the
  last 7 days' nutrition averaged over the days actually logged: avg calories + avg protein/carbs/fat, each
  next to its target. App computes it in the daily-log load effect (a dedicated 7-day `logRead` loop — the
  streak loop can't be reused since it breaks on the first gap) into `weekSummary` state {days, avgCal,
  avgP, avgC, avgF}, passed → `DailyDashboard`. Rendered (when ≥1 logged day) as a 2×2 tile grid (Sora
  numbers, macro colours, "avg/day · target N") under the meal log, with "avg over N logged days" and a
  "reflects saved logs" note (it's computed at load, not live — fine for a weekly average). Remote-aware via
  the existing `logRead`, so a trainer viewing a client sees the client's week. Verified live (Test Client,
  1 logged day): shows 1,200 cal / 45p / 70c / 12f vs targets 2,365 / 200 / 225 / 74. No `firestore.rules`
  change. **Nutrition arc (S36–40) now covers:** per-food macros + daily totals, macro targets + progress
  bars, editable targets (coach or client), one-tap recent-food re-add, and weekly averages.
- Session 41: **Daily Dashboard UX tweaks (meal-log discoverability + section grouping).** Two small
  requests from Kevin. (1) **Meal logging was not obviously tappable:** the "🍽️ Meals & Food Today" header
  now shows a clear cyan pill — "＋ Log food" (empty) / "＋ Add food" (has items) / "▾ Close" (open) — instead
  of a bare ▸ chevron, and the per-meal "+ Add food to {Meal}" buttons were upgraded from faint dashed ghosts
  to solid accent-bordered, accent-tinted, larger buttons so it's obvious where to enter meals. (2) **"This
  Week" moved out of the entry flow:** it was sandwiched between data-entry rows (calories/meals → weekly
  summary → water/weight); relocated it below the workout section under a new **"📈 Progress & Insights"**
  `sec-title`, grouping it with the Recent Activity feed (the display/insight area) and separating it from the
  entry controls. Pure UI; no logic/data change. Verified live (Test Client): pill + prominent add buttons
  render, This Week sits under Progress & Insights. No `firestore.rules` change.
- Session 42: **Calendar — per-day calorie-adherence tinting (month view).** The calendar (`CalendarView`,
  S22) showed indicator dots but no sense of whether a day hit its calorie goal. Each month-view day cell is
  now tinted by adherence: **green** (`rgba(47,224,168,.13)`) if that day's logged calories were at/under
  target, **amber** (`rgba(251,191,36,.13)`) if over (>target×1.05); untinted if nothing logged; selected day
  keeps its cyan bg. Target = `computeClientCalories(data).target` (same formula as dashboard/Results). New
  `dayCals` state + an effect that reads logged-day calorie totals **for the visible month only** (bounded ≤31
  reads, cached so re-visiting a month doesn't re-read) via the remote-aware `onReadDay`. Added the two tint
  swatches to the legend (only when a target exists) and a per-cell tooltip ("X cal · target Y"). Verified
  live (Test Client): the under-target logged day tinted green with its food dot; legend shows the swatches.
  No `firestore.rules` change. Also (same session): added a **RESUME-HERE SUMMARY** block at the top of this
  "Current state" section — a fast-path digest (brand redesign done, nutrition tier done, analytics done, the
  page-transition/createPortal gotcha, Blaze line) so a fresh chat can get oriented without reading every
  session entry. Keep it updated.
- Session 43: **Coaching Dashboard — one-tap "Nudge" from needs-attention rows.** Trainer workflow win on
  `TrainerAnalytics` (S34): each "⚠️ Needs attention" client row now has a **📤 Nudge** button that sends a
  "Please log today's food…" request straight to that client without opening their plan — same write path as
  `TrainerDashboard.sendRequest` (append to the client's `caliq-requests` via `setForUser` + a
  `caliq-history-self` note). New `sendNudge(uid)` + transient `nudged`/`nudgeBusy` state; the button shows
  "📤 Nudge" → "…" → "✓ Nudged" (disabled once sent). The row name still taps to open the plan (split the
  click targets). After sending, `load()` refreshes so the new request shows in the "📬 Open requests" card +
  the OPEN REQUESTS tile. Verified live (Casey, 3 days): nudge → "✓ Nudged", tile 0→1, request listed under
  Open requests (and it'll appear on the client's home). No `firestore.rules` change (rides existing
  trainer↔client kv access).
- Session 44: **Calendar week view — adherence accent + weekly calorie roll-up.** Completes the S42 month
  adherence story in the week view. Each week-view day row now shows its logged calorie total (green if
  at/under target, amber/`--yellow` if over) with a matching coloured **left-accent border**; days with no
  calories keep the "🍽️ logged / — " summary. A footer **roll-up** shows "N/7 days logged · avg X cal/day ·
  target Y". Refactored the month-only cals loader into a shared `loadCals(keys)` (reads only logged +
  uncached dates, merges into `dayCals`); added a second effect that loads the visible week's 7 days (they
  can cross a month boundary, so loaded separately from the month effect). Verified live (Test Client): Wed 24
  shows "1,200 cal" green w/ accent, footer "1/7 day logged · avg 1,200 · target 2,365". No `firestore.rules`
  change.
- Session 45: **Timezone bug fix — daily-log "today" keys are now LOCAL, not UTC.** The app keyed every
  daily log + check-in + "today" off `new Date().toISOString().slice(0,10)`, which is **always UTC**. For
  our Eastern-time audience (Smooth Training is in Miami), after ~8pm local the UTC date is already
  tomorrow, so **evening food/calorie/weight logs landed under tomorrow's date** and the calendars marked
  the wrong day as "today" (e.g. at 8:50pm EDT on Jun 24 the check-in calendar highlighted the 25th). This
  **reverses the deliberate Session-22 "keys are UTC YYYY-MM-DD" choice** — that decision was the source of
  the bug. **Fix:** added a module-level `ymdLocal(d=new Date())` helper (returns local `YYYY-MM-DD` from
  `getFullYear/getMonth/getDate`) and replaced **every "now → date key" computation** with it across all
  sites: `CalendarView`/`CheckInCalendar`/`DailyCheckIn` "today", `ClientHome.todayKey`, the main-App
  daily-log effect `todayKey`, the streak loop + 7-day "This Week" loop (was `new Date(); setDate(-i);
  toISOString()`), `StreakBadges` (today/yesterday + the streak walk), and the trainer dashboard's 7-day
  consistency strip (was `setUTCDate`). **Left as-is on purpose:** pure grid-string generators that build
  keys from explicit y/m/d via `Date.UTC(...).toISOString()` (deterministic, tz-independent — `keyOf`, the
  week math, the `+"T00:00:00Z"`/`+"T12:00:00"` key→timestamp parsers) and the cosmetic backup-file name.
  **Existing data: fix-forward, NO migration (Kevin's call).** Historical UTC-keyed logs stay where they
  are (daytime ones were already correct; evening ones remain off-by-one, as they already were) — a precise
  auto-migration isn't safe because meal entries don't all carry a timestamp to tell mis-dated from correct.
  Only new logs use local keys. Verified **live in the actual evening bug window** (browser tz
  America/New_York, `now_local`=2026-06-24 vs `now_utc`=2026-06-25): Daily Dashboard header reads
  "WEDNESDAY, JUNE 24" and the month calendar outlines **24** as today (pre-fix it outlined 25); `npm run
  build` passes, no console errors. No `firestore.rules` change.
- Session 46: **UI polish + Coaching Dashboard tools (non-Blaze).** (1) **UI polish:** on the trainer home
  the "📋 Local Plans" actions had inverted weight — the *primary* "+ Plan" was a faint ghost while the
  *secondary* "+ 🧪 Simulation" was a bold filled purple; now "+ Plan" is the filled cyan primary
  (`mPrimaryCls`) and Simulation is a purple **outline** (keeps its sandbox-purple identity, reads as
  secondary). Also pluralized count labels ("1 check-in"/"1 weigh-in" instead of "1 check-ins"/"1 weigh-ins")
  in the `StreakBadges` bar and the `WeightChartModal` header. (2) **`TrainerAnalytics` (Coaching Dashboard):**
  the "needs attention" threshold (`ATTENTION_DAYS`, was hardcoded 3) is now **coach-configurable** via
  2/3/5/7-day chips, persisted to the trainer's OWN account under `caliq-coach-prefs` (`{attnDays}`, read in
  `load()`, written by `saveAttn`) so it sticks across visits and drives the list + the "Need attention" tile +
  the copy. And each needs-attention row now shows a **7-day logging-consistency strip** (`Last7` — 7 dots,
  6 days ago → today, filled green = logged that day, today ringed) computed from the per-client logged-dates
  already loaded (no extra reads, no schema change) so a coach sees HOW sparse the logging is before nudging.
  (3) **Progress pace:** each row in the 📈 Progress card now also shows the client's **observed weekly rate**
  (e.g. "▼ 7.8/wk") next to net lbs lost + on-track badge, from the `weightTrend(checkIns).ratePerWeek` already
  computed for the on-track calc (added `ratePerWeek` to the row; rendered when |rate| ≥ 0.05 lb/wk).
  Verified live (trainer.uitest → Coaching Dashboard): switching to 5d dropped Casey (logged 3 days ago) and
  zeroed the tile; survived a reload; strip renders. `npm run build` passes; no console errors. **Note:** this
  work was authored alongside the Session-45 timezone fix and got bundled into that single pushed commit
  (`77bc27b`) by the background task that landed the date fix — it's live, just co-committed. No
  `firestore.rules` change.
- Session 47: **Coaching Dashboard "This week" card + calendar workout adherence (non-Blaze).** Three
  trainer/calendar enhancements. (1) **"🗓️ This week" roster card** (`TrainerAnalytics`, between Needs-
  attention and Open-requests): EVERY connected client with a plan, **least-active first**, each row showing
  the 7-day logging strip (the `Last7` dots, reused), an "N/7" count, and a **week-over-week weight delta**.
  (2) **Week-over-week weight delta** (`wowDelta` on each client row in `load()`): the trailing-7-day weight
  change = latest weigh-in minus the most recent weigh-in ≥7 days older (▼ green = lost, ▲ amber = gained;
  "—" when <2 weigh-ins or none ≥7 days apart). Deliberately kept OFF the 📈 Progress rows (which already
  show net lbs lost + the all-data `ratePerWeek` from S46) and put on the "This week" card so the two cards
  stay distinct: This week = recent activity + recent scale move; Progress = overall trend + on-track.
  (3) **Calendar week-view workout adherence** (`CalendarView.weekView`): past **scheduled-but-not-done** days
  now show "✗ missed workout" (red) instead of "◦ N scheduled"; a **weekly workout roll-up** below the S44
  calorie roll-up shows `{done}/{scheduled} scheduled done` (green if on pace, amber if behind) or, when the
  plan has no scheduled workouts, `{done} done this week`. Computed from `scheduledFor(k)` + `ciByDate[k]
  .workedOut` (no new reads). Verified live (trainer.uitest → Casey): "This week" shows Casey 1/7 · ▼ 8 lb;
  marking a workout done on Wed 24 made the day show "🏋️ done" and the roll-up read "1 done this week"; no
  console errors; `npm run build` passes. **Deferred:** per-day **macro adherence** in the calendar (needs a
  per-day macro load alongside `dayCals`, a bigger change) and live-testing the "✗ missed"/`/N scheduled`
  branches (test client has no scheduled workouts; logic is build-verified). No `firestore.rules` change.
- Session 48: **Calendar per-day macro (protein) adherence — the Session-47 deferred item (non-Blaze).**
  The calendar week view now surfaces protein adherence alongside the calorie (S42/S44) and workout (S47)
  views. New `dayProt` state (date → logged protein g) is filled by the SAME `loadCals` read that already
  fetches per-day calories (one read, now returns `[k, calories, protein]`), so no extra Firestore reads.
  A daily **protein target** `protTarget` mirrors the dashboard default (`data.macroTargets.protein` if set,
  else ~1 g/lb bodyweight). UI: (1) each week-view day row shows a **🍗 {logged}g/{target}** chip when protein
  was logged that day — green when at/over target, muted when under; (2) a **weekly protein roll-up** box
  (avg logged protein/day vs target) sits directly below the calorie roll-up, green when the average meets
  target. Month view left as calorie-tinted (a cell can only tint by one metric; the detailed macro/workout
  breakdown lives in the week view). Verified live on the **local Test Client plan** (logged a 650-cal/55g
  meal → day row showed "650 cal · 🍗 55g/200", protein roll-up "avg 50g/day · target 200g"); `npm run build`
  passes, no console errors. **Known pre-existing limitation (NOT introduced here):** the calendar's
  adherence roll-ups (calorie AND protein) don't populate when a **trainer views a REMOTE client's** calendar
  — the per-day `loadCals` reads via `getForUser` don't surface in the week/month within a session (the
  client's own calendar on local `window.storage` works fine; the Day view's single remote read works too).
  This affects the S42/S44 calorie adherence the same way; flagged for a separate fix. No `firestore.rules` change.
- Session 49: **Calendar adherence roll-ups now populate for incomplete plans (the S48 "remote" limitation —
  actually a misdiagnosis) (non-Blaze).** The S48 note blamed the remote read path for the calorie/protein
  roll-ups not showing when a trainer views a connected client's calendar. **Live debugging showed the remote
  read path is fine** — `onListLoggedDays`→`listForUser` correctly returned Casey's logged days and
  `onReadDay`→`getForUser` correctly returned each day's calories/protein. The real root cause: both
  `loadCals` effects in `CalendarView` early-returned on `if (!calTarget) return;`, and `calTarget` =
  `computeClientCalories(data).target` is **null whenever the plan lacks gender/age/height** (that function
  returns null on `!d.gender`). The test client Casey's plan has weight + goal but empty gender/age/height, so
  `calTarget` was null → the effects bailed → `dayCals`/`dayProt` stayed empty → every logged day showed
  "🍽️ logged" instead of "N cal" and no roll-ups rendered. The real differentiator was **complete vs incomplete
  plan**, not remote vs local — the local Test/Prospect plans just happen to be fully filled in. **Fix:** removed
  the `!calTarget` guard (and the now-unused `calTarget` dep) from both per-day load effects (the month-visible
  loop and the week's-7-days loop) so the totals load regardless of whether a calorie goal exists. The target is
  only needed for the green/amber **adherence tint** (month) and the "· target N" suffix (roll-ups), and those
  render paths already guard with `calTarget && …`, so they degrade gracefully: an incomplete plan shows the
  totals in neutral green with no over/under judgement (honest — you can't assess adherence without a goal),
  while a complete plan is unchanged (the guard never fired for it, so behavior is identical). Verified live as
  trainer.uitest: (1) **remote Casey** (incomplete plan) week view now shows Wed 24 = "700 cal" + "🍗 60g/188",
  calorie roll-up "1/7 day logged · avg 700 cal/day", protein roll-up "avg 60g/day · target 188g"; (2) **local
  Prospect Pat** (complete plan, target 2,569) regression-checked — logged 250 cal showed green with the green
  left-accent and roll-up "avg 250 cal/day · target 2,569". Clean console (the dep-array warnings seen mid-edit
  were HMR buffer artifacts — gone after a fresh server start). `npm run build` passes. No `firestore.rules` change.
- Session 50: **Food-database search + macro autofill in the meal log (non-Blaze — roadmap item).** Removes the
  #1 self-logging friction (hand-typing calories + macros). New module-level `searchFoods(query)` calls the
  **USDA FoodData Central** API (`api.nal.usda.gov/fdc/v1/foods/search`) — free, **CORS-enabled so it works
  from the browser with no server**, good generic-food relevance. Key: `import.meta.env.VITE_USDA_API_KEY ||
  "DEMO_KEY"` — works out of the box on the public DEMO_KEY (rate-limited ~30/hr/IP); set a free api.data.gov
  key in `.env.local` + Vercel for production limits. The key is read-only food data so browser exposure is
  low-risk; proxy it via a Cloud Function once on Blaze. `searchFoods` normalizes each hit to per-100g
  `{name, brand, kcal, p, c, f}` (prefers the KCAL "Energy" entry over the kJ one; title-cases the ALL-CAPS
  USDA descriptions; drops 0-kcal rows). **UI (in `MealLog`'s add-form, new entries only):** a "🔍 Search food
  database" toggle → search box (Enter or button) → tappable results list (name · brand · "N cal · Pp/Cc/Ff
  /100g"); tapping a result remembers its per-100g macros (`picked`) and fills the name + calories + macros at
  a **serving size** (`grams`, default 100) via `applyServing(food, g)`; a grams input rescales live
  (`setServing`). The user can still tweak the filled numbers or enter everything manually — search is purely
  additive. New `MealLog` state: `searchOpen/searchQ/results/searching/searchErr/picked/grams`; `resetSearch`
  folded into `resetFields`. Verified live (trainer.uitest → Casey's plan → Lunch): searched "grilled chicken
  breast"/"salmon" → relevant USDA results with macros → picked Salmon (139cal/15p/3c/8f per 100g) → set serving
  200g → form rescaled to 278cal/30p/6c/16f → Add logged "Salmon (30p/6c/16f)" + activity "added Lunch: Salmon
  (278 cal)". No console errors; `npm run build` passes. **Note:** this is the manual/self-log tier of the
  roadmap's "meal logging" — the AI photo auto-track tier still needs Blaze. No `firestore.rules` change.
- Session 51: **Trial periods (non-Blaze v1) — roadmap item.** Both roles now get a **30-day free trial** at
  signup (Kevin's call to start both at 30; revisit per-role later). `createProfile` (profile.js) now sets the
  reserved fields `trialStartedAt: serverTimestamp()`, `trialLengthDays: 30`, `subscriptionStatus: "trial"`.
  New exported helper `trialInfo(profile)` → `{ lengthDays, startMs, endMs, daysLeft, expired, active }` or
  **null** when there's no trial to show (paid `subscriptionStatus:"active"`, admin, or a **legacy account with
  no `trialStartedAt`** — so existing/test accounts are grandfathered and show nothing). A `toMillis()` helper
  normalizes Firestore Timestamp / Date / number / ISO. **UI:** the side menu (`SideMenu`) shows a soft,
  **informational** trial banner under the identity card (new `trial` prop, fed from App's `meTrial` =
  `trialInfo(prof)` set in the profile-load effect): during the trial "⏳ N days left in your trial · 30-day
  free trial" (cyan, turns **amber** at ≤5 days); after expiry "⚠️ Your trial has ended" + a role-aware
  "reach out / contact your trainer to continue" line (red). **Soft only — no hard lock or feature gating**
  (per Kevin); real enforcement + upgrade flow waits for **Stripe/Blaze**. Verified live (trainer.uitest, via a
  temporary forced mock since the test accounts predate the fields): both the active ("⏳ 23 days left") and
  expired ("⚠️ Your trial has ended…") banners render on-brand in the menu; mock reverted. `npm run build`
  passes. No `firestore.rules` change (the new fields are owner-written on the existing profile doc; reads use
  the already-open profile access).
- Session 52: **Blaze move — planning doc (`docs/BLAZE_ROADMAP.md`).** Wrote the product/infra game plan for
  moving to the Firebase Blaze plan, the gate for all remaining server-side features. Complements the existing
  `BLAZE_MIGRATION.md` (which covers the *security* side — custom-claims). Covers: why Blaze is required
  (AI coaching, photo meal tracking, client→trainer requests, notifications, messaging, Stripe — each needs
  Cloud Functions/Storage/secrets that can't ship in the browser); a **Day-1 enablement checklist** (budget +
  alerts FIRST, enable Blaze, kill-switch, init Functions/Storage, secrets in Secret Manager not `VITE_*`); a
  **recommended build order** (claims migration → client→trainer requests → notifications → AI text → photo
  track → messaging → Stripe); **what's already prepped** so each is smaller than it looks (live trial fields,
  structured requests, cooperative history, API-ready meal form, client-side food search to proxy); cost notes
  (AI is the real driver); and open product decisions before Stripe. **Doc only — no code, nothing enabled.**
  Kevin owns the billing/enablement steps. No `firestore.rules` change.
- Session 53: **Rebrand — "CalorieIQ" → "Glide".** Kevin chose the new name **Glide**. Applied across all
  user-visible surfaces: the header wordmark on every screen (was the two-tone `CALORIE`+colored `IQ` span,
  now a single cyan **GLIDE** wordmark — `Glide` doesn't split, so dropped the inner span; ~6 header spots +
  the side-menu `.logo`), the login + role-chooser brand (`AuthGate` `<h1>`), the page `<title>` (now "Glide"),
  `package.json` name (`glide`), the shareable plan-card branding ("CALORIEIQ — Powered by Science" → "GLIDE —
  …", "CALORIEIQ" → "GLIDE"), all prose/disclaimers/welcome/share-text/backup-message/placeholder strings, the
  dev `Showcase` logo, and internal comments in firebase/storage/profile/themes. **The Firebase project ID
  stays `calorieiq-29762`** (it's in `VITE_FIREBASE_*` env, not the display name) — no infra/config change, so
  this was purely a UI-text swap, exactly as the roadmap anticipated. Backup files are now named
  `Glide-Backup-{date}.json` (old `CalorieIQ-Backup-*.json` still import fine — import doesn't check the name).
  Verified live: header renders "GLIDE" in cyan, `document.title` = "Glide", no "CalorieIQ"/"CALORIEIQ" strings
  remain in `src/` or `index.html`, no console errors, `npm run build` passes. **Domain swap is separate** (a
  Vercel/DNS change Kevin makes when ready). No `firestore.rules` change.
- Session 54: **Two-tone Glide wordmark + `BrandLogo` component.** Kevin wanted the flat all-cyan **GLIDE**
  to carry some white, mirroring the old `CALORIE`(cyan)+`IQ`(white) treatment. Split it **GLI** (brand cyan
  `text-primary`) + **DE** (white `text-fg`). Centralized the header wordmark into a new module-level
  **`BrandLogo`** component (`GLI<span class="text-fg">DE</span>`) and replaced the 5 identical header spans
  (TrainerDashboard, TrainerAnalytics, ClientHome, ProfileSelector, App main) with `<BrandLogo />` so the
  treatment lives in one place. The side-menu `.logo` got the same split inline (`GLI<span>DE</span>` — the
  existing `.logo span{color:var(--text)}` rule already renders the inner span white). `AuthGate` (login/role
  chooser) and the dev `Showcase` were left as-is for now (their own brand markup). Verified live (header +
  menu both render GLI cyan + DE white), no console errors, `npm run build` passes. No `firestore.rules` change.
- Session 55: **Renamed GitHub repo + Vercel project to Glide (dev-side); custom domain deferred.**
  Kevin renamed the **GitHub repo** `calorieiq` → **`Glide`** (case-insensitive; local `origin` updated to
  `https://github.com/kevcam51/Glide.git`, push/fetch verified). Renamed the **Vercel project** `calorieiq` →
  `glide` via `vercel project rename` and redeployed prod, so Vercel auto-created glide-branded production
  aliases (`glide-kevcam51s-projects.vercel.app`). **Current public URL is still `calorieiq-jet.vercel.app`**
  (Vercel pins the original production domain on rename; the glide aliases exist but sit behind **Deployment
  Protection / Vercel Authentication**). The **local folder stays `~/Desktop/calorieiq`** (renaming it
  mid-session would break the running tooling — do it later when closed: `mv ~/Desktop/calorieiq
  ~/Desktop/glide`). **Firebase project ID stays `calorieiq-29762`** (never change — it's in `VITE_FIREBASE_*`).
  **DEFERRED (do after the Blaze work):** (1) buy a clean custom domain (e.g. `glide.app` / `getglide.com`) and
  add it in Vercel → Settings → Domains + DNS; (2) optionally, for a free interim glide URL, flip Vercel
  → Settings → Deployment Protection → Vercel Authentication to "Only Preview Deployments" so
  `glide-kevcam51s-projects.vercel.app` serves publicly. No code/`firestore.rules` change.
- Session 56: **Blaze ENABLED + first Cloud Functions (custom-claims migration, Stage 1 — security hardening).**
  Kevin upgraded the Firebase project to **Blaze** (budget set). Built the first server-side code in new
  `functions/` (Node 22, `us-central1`, firebase-functions v6): **`syncRoleClaims`** (Firestore trigger on
  `users/{uid}` — mirrors `role` + `assignedTrainerId`/`headTrainerId` into tamper-proof Auth **custom
  claims**; admin role is forced by UID `G7QUZ8…`, never self-assigned) and **`backfillRoleClaims`** (admin
  callable to claim existing users). `firebase.json` gained a `functions` block. **Deployed + VERIFIED LIVE:**
  a profile write fires the trigger and sets the claim (confirmed `trainer.uitest` →
  `{"role":"head_trainer",…}` via `firebase auth:export`).
  **⚠️ HARD-WON SETUP GOTCHAS (don't re-litigate):** first 2nd-gen deploy needed retries while Eventarc
  service-agent perms propagated. The build kept failing until **three IAM roles were granted to the project's
  Compute Engine default service account** (`350381584449-compute@developer.gserviceaccount.com`, which 2nd-gen
  builds + the function runtime use): **Cloud Build Service Account** (`roles/cloudbuild.builds.builder`, to
  build), **Firebase Authentication Admin** (`roles/firebaseauth.admin`, so the function can `setCustomUserClaims`),
  and **Cloud Datastore User** (`roles/datastore.user`, so it can read Firestore). A partial early deploy left
  `syncRoleClaims` stuck as an `https` stub → had to `firebase functions:delete syncRoleClaims` then redeploy.
  The `firebase functions:shell` REPL was unreliable for a manual backfill (lazy module load → admin app /
  creds context issues). Firebase CLI is logged in as **kevin@smoothtraining.com**; tokens expire — if calls
  say "credentials no longer valid", run **`firebase login --reauth --no-localhost`** (the plain localhost
  callback failed; the code-paste flow works).
  **Backfill status:** the trigger claims any user on their next profile write; `trainer.uitest` done; the
  others (kevin admin, `client.uitest`, `kevincameron51`) will claim when next written. **NOT a blocker** —
  Stage D rules keep a doc-`get()` fallback so unclaimed users are never locked out.
  **Remaining (next):** Stage C — app forces `getIdToken(true)` on load so new claims reach live sessions;
  Stage D — switch `firestore.rules` to `request.auth.token.role` **with a doc-get fallback** (emulator-tested
  incl. attack cases via `npm run test:rules`, then Kevin PUBLISHES). The AI chat does NOT depend on any of
  this (the spec reads role from the Firestore profile).
- Session 57: **Claims Stage C (token refresh) + Java/rules-test harness set up + profile-read hardening
  scoped.** (1) **Stage C done:** `AuthGate` now forces `user.getIdToken(true)` once on sign-in so custom
  claims set server-side land in the session token without a re-login (committed `16ec3ca`; verified app still
  renders, no console errors). (2) **Test harness unblocked:** no brew/sudo on this machine, so installed a
  local **Temurin 21 JDK at `~/.glide-jdk`**; `npm run test:rules` now runs (see Key commands for the
  `JAVA_HOME=…` incantation) — **baseline 29/29 pass**. This unblocks ALL future `firestore.rules` work.
  (3) **Stage D reconsidered → profile-read hardening.** Key finding: the *current* rules barely benefit from
  custom claims — `isAdmin()` is already UID-based (optimal), and the kv trainer/head checks read the
  **target** user's linkage (not the requester's role), so the requester's claims can't replace those
  `get()`s. So a claims-substitution rules rewrite is low-value + adds lockout risk; **skipped.** The genuinely
  valuable hardening (migration-doc step 5) is **locking down profile-doc reads** (today `allow read: if
  isSignedIn()` lets ANY signed-in user read ANY profile). **It's a multi-file refactor, not a rules tweak**,
  because `profile.js` relies on broad `users` queries: invite-code resolution `where('inviteCode','==',code)`
  (run by a not-yet-linked client) and client lists `where('assignedTrainerId'|'headTrainerId','==',uid)`.
  **Planned increments (all gated by the now-working emulator tests; Kevin must PUBLISH rules after):**
  (a) ADD an `inviteCodes/{code}` lookup collection (trainer writes own code→uid; public/signed-in read) — purely
  additive, no risk; (b) switch `profile.js` invite resolution to read that collection (drop the broad
  inviteCode query); (c) tighten `users` read to owner + admin + trainer-chain + the constrained client-list
  queries, with full attack-case tests. **NOT yet started** — deferred as focused work (security-critical;
  avoid rushing at the end of a long session). Claims foundation (A/B-partial/C) remains live + safe.
- Session 58: **Profile-read hardening — steps (a) + (b) DONE & LIVE; (c) scoped, deliberately deferred.**
  (a) **`inviteCodes/{code}` lookup collection** added (doc id = code, data `{trainerUid}`): rules allow signed-in
  read, **create only when pointing at yourself**, **update only by the owning trainer** (no code hijacking),
  delete by owner/admin. `profile.js` mirrors codes best-effort (`writeInviteCodeMirror`), incl. backfilling
  existing trainers when they open their invite panel. **Rules PUBLISHED** (`firebase deploy --only
  firestore:rules`) — additive, existing `users`/`kv` rules untouched. Emulator suite now **36 pass** (added 7
  invite-code cases incl. hijack attacks). **Verified LIVE against prod** via authenticated Firestore REST as
  `trainer.uitest`: claim-pointing-to-self → 200, hijack (point to someone else) → **403**, read → 200, owner
  delete → 200. (b) **join-resolution switched to the lookup**: `joinTrainer` reads `inviteCodes/{code}` first
  (legacy users-query kept as fallback for un-mirrored codes); `ensureInviteCode` checks uniqueness against the
  lookup. Verified live: a `client.uitest` read of the trainer's mirrored code resolves to the correct trainer
  uid. Committed + pushed (`cb46058`, `8a44d5f`). The only remaining `where("inviteCode")` is the join fallback;
  the other users-queries are just the client/sub-trainer lists.
  **(c) — the actual profile-read lockdown — NOT yet done (highest-risk; do fresh):** today `users` is
  `allow read: if isSignedIn()` (any signed-in user reads ANY profile). **Design:** split by `resource.data.role`
  — **trainer** profiles (`head_trainer`/`sub_trainer`) stay readable by any signed-in user (the "directory":
  needed for join validation + showing the client their trainer's name), while **client** profiles are limited
  to owner + admin + their trainer-chain. Use **`resource.data`** (the doc being read) not `get()` so the
  **`list` queries stay valid** — `getMyClients` (where `assignedTrainerId == me`) and `getMySubTrainers` (where
  `headTrainerId == me`) are *queries*; a wrong `list` rule silently returns nothing and breaks the trainer
  dashboards. **Before implementing (c): enumerate EVERY profile read/list path** (getProfile, joinTrainer's
  trainer read, ClientHome trainer-name read, getMyClients, getMySubTrainers, dashboards) and cover each with
  emulator allow-tests + cross-client/attack denials; then Kevin PUBLISHES. Steps (a)/(b) are safe to leave live
  indefinitely without (c).
- Session 59: **Profile-read lockdown — step (c) DONE, PUBLISHED & verified live (hardening complete).**
  The `users` read rule is no longer `allow read: if isSignedIn()`. Now scoped to: **owner** + **admin** +
  **trainer directory** (`resource.data.role in ['head_trainer','sub_trainer']` — trainer profiles stay
  readable so a client can resolve/validate a trainer at join + show their trainer's name, and so
  `getMySubTrainers` lists) + **a trainer's direct clients** (`resource.data.assignedTrainerId == request.auth.uid`
  — powers `getMyClients`) + **a head's tree** (`resource.data.headTrainerId == request.auth.uid`). Uses
  `resource.data` (NOT `get()`) so the constrained `list` queries stay valid. **Net win: a client can no longer
  read another client's profile.** `joinTrainer` now guards its profile reads in try/catch (a denied read on the
  scoped rules falls through to the friendly "didn't match" error). **Emulator: 47 pass** (added scoped-read +
  list-query allow/deny cases incl. cross-client read denial, cross-trainer list denial, unconstrained-list
  denial). **Rules PUBLISHED** (`firebase deploy --only firestore:rules`). **Verified LIVE in prod** (authed
  REST + the running app): trainer dashboard's Connected Clients still loads Casey (getMyClients ✓), ClientHome
  loads (own + trainer reads ✓), client→trainer read 200, trainer→own-client read 200, **client unconstrained
  `users` list → 403**, no console errors either side, `npm run build` passes. Committed `1a80b24`. **Profile-read
  hardening (a+b+c) is complete.** (Note: the admin account's profile is role `head_trainer`, so it's a readable
  directory entry — not a client-data leak; expected.) The custom-claims migration's optional remaining bits
  (full backfill of the 4 existing users; the claims-into-rules substitution) were intentionally skipped as
  low-value — see Sessions 57/58. **Blaze server-side foundation + security hardening are now in place; next up
  is the AI chat** (per `glide-ai-meal-logging-spec.md`), which uses the working Cloud Functions infra.
- Session 60: **AI chat Stage 1 — backend DEPLOYED & LIVE (text chat). ⭐ RESUME HERE.** Built the first AI
  function per `glide-ai-meal-logging-spec.md`. **`functions/aichat.js`** exports the **`aiChat` callable**
  (wired into `index.js` as `exports.aiChat = require("./aichat").aiChat`): verifies Firebase Auth → reads
  `role` from the profile → selects a **role-based system prompt** (client vs trainer, topic-restricted to
  health/fitness per the spec) → enforces a **per-user daily token budget** (`users/{uid}/aiUsage/{date}`,
  tiers in `BUDGETS`: trial 10k / client 25k / assisted 40k / trainer 60k; blocks at 100%, returns a `warn`
  flag at 80%) → calls Anthropic **`claude-sonnet-4-6`** (Sonnet per the spec, NOT Opus — cost) with the last
  ≤10 exchanges → returns `{reply, usage}`. SDK: **`@anthropic-ai/sdk` ^0.106** in `functions/`. The
  **`ANTHROPIC_API_KEY` is a Secret Manager secret** (Kevin set it via `firebase functions:secrets:set
  ANTHROPIC_API_KEY --project calorieiq-29762`); deploy auto-granted the compute SA `secretAccessor` on it.
  **Deployed** (`firebase deploy --only functions:aiChat`; the first 2nd-gen create attempt flaked on build
  propagation as before — a retry succeeded; it's now `v2 callable us-central1`). Committed `d6d848d`.
  **⚠️ NOT yet tested with a real call, and there is NO client UI yet.**
  **NEXT SESSION — do in order:** (1) **Build the Stage-1 client chat panel** — a custom React component (the
  spec wants it collapsible with a floating button; SSE streaming is a later stage, so Stage 1 just awaits the
  full reply). The app does **not** currently import `firebase/functions` — add it (`getFunctions(app, 'us-central1')`
  + `httpsCallable(functions, 'aiChat')`), calling with `{ messages: [{role:'user'|'assistant', content}] }`
  and rendering `result.data.reply`. Wire it into `ClientHome` (client) and/or the trainer screens. Test it by
  driving the preview as a signed-in user (callables need the Firebase Auth context, so the REST/functions-shell
  tricks used for the claims work won't carry auth — use the actual app). Verify: a real reply comes back, the
  off-topic redirect fires, and `users/{uid}/aiUsage/{date}.tokens` increments. (2) **Stage 2 — function-calling
  tools** (`get_meal_logs`, `get_calorie_targets`, `get_trainer_clients`, `get_client_last_log` per the spec) so
  it can answer "what did I eat this week?". (3) **Stage 3 — conversational meal logging:** parse → confirm card
  → **write into the EXISTING `caliq-log-{id}-{date}` kv meal store** (reconcile the spec's richer
  `components`/`totals`/`giEstimate` schema with the app's current `meals[]` so AI-logged meals show in the
  dashboard/calendar/weekly cards). (4) **Stage 4 — SSE streaming** (needs an `onRequest` HTTP function, not the
  callable), then **photo logging** (paid tier, vision). **Reminders:** firebase CLI reauth if creds expire =
  `firebase login --reauth --no-localhost`; rules-test Java at `~/.glide-jdk` (S57); model id `claude-sonnet-4-6`.
- Session 61: **AI chat Stage 1 — client UI built + LIVE end-to-end (client AND trainer), four infra gates fixed. ⭐ RESUME HERE.**
  Built the custom React chat per `glide-ai-meal-logging-spec.md` §9 and got the whole chain working in production.
  **Frontend:** `src/firebase.js` now exports `functions = getFunctions(app,"us-central1")`; `App.jsx` imports
  `httpsCallable` and defines module-level `callAiChat = httpsCallable(functions,"aiChat")` + a new **`AIChatPanel`**
  component (floating "✨ Ask Glide" button → collapsible chat, self-themed `data-theme="pro"`, rendered via
  `createPortal(…, document.body)` to escape the page-transition transform trap; role-aware empty-state suggestions;
  maps callable error codes → friendly messages incl. `resource-exhausted` = daily-limit; sends `{messages:[{role,
  content}]}` and renders `reply`). Mounted for the **client** (inside `ClientHome`) AND **trainers** (added
  `<AIChatPanel role={role}/>` to the TrainerDashboard / TrainerAnalytics / ProfileSelector return fragments) — the
  backend already selects the client-vs-trainer system prompt + budget tier by the caller's profile role, so trainers
  on a (future) pro plan get the coaching assistant with the 60k tier. **Deliberately NOT mounted in the in-plan
  wizard/Results editor** (would overlap the fixed `BottomNav`). New module-level **`RichText`** renders **bold** +
  line breaks so replies read cleanly in the narrow chat (no full markdown/tables); both system prompts in
  `functions/aichat.js` were tuned to "keep it short, plain text, dashes for lists, **bold** labels, NO markdown
  tables/headings/code blocks" and redeployed. **Fixed the long-broken `AICoach`** ("AI Coaching Insights" in
  Results→Pro): it used to call `api.anthropic.com` directly from the browser with NO key (never worked) — rewired
  to `callAiChat` (secure, budgeted, role-based) returning free-form text rendered via `RichText` (replaced the old
  JSON-parse render). **VERIFIED LIVE** (preview, signed in as `client.uitest` and `trainer.uitest`): real replies
  from `claude-sonnet-4-6`, multi-turn context, the off-topic redirect fires, role-correct prompts (trainer reply is
  client-management framed), budget accounting increments `users/{uid}/aiUsage/{date}` (client got the **assisted**
  40k tier via `assignedTrainerId`; trainer gets 60k), clean formatting, `npm run build` passes, no console errors.
  (AICoach itself is build-verified + reuses the proven callAiChat/RichText path; spot-check it in a *completed*
  plan's Results→Pro since the test plans are incomplete.)
  **⚠️ FOUR PROD INFRA GATES had to be fixed before the live call worked — all done, but know them for any new
  callable:** (1) **Org policy blocked public invoker.** The project is under the `smoothtraining.com` Google
  Workspace, whose **Domain restricted sharing** org policy (`iam.allowedPolicyMemberDomains`) refuses the `allUsers`
  Cloud-Run invoker grant every Firebase callable needs → browser preflight got `OPTIONS 403`. Kevin granted himself
  **Organization Policy Administrator** at the **org** scope (he was already Organization Administrator, which can
  *view* but not *edit* org policies), then **overrode the policy to "Allow All" for the `calorieiq` project only**.
  (2) **Invoker binding only set on CREATE, not UPDATE** — `firebase deploy` of an existing callable does NOT
  re-apply the public-invoker IAM, so the S60 first-deploy flake left it unset; fix = `firebase functions:delete
  aiChat` then deploy fresh (after the org-policy fix the create succeeds with no IAM error). (3) **The S60
  `ANTHROPIC_API_KEY` secret was invalid** (a corrupted 538-char paste; a real key is ~108 chars `sk-ant-api03-…`) →
  function threw, surfaced as 500/`internal`. Kevin re-set it via `firebase functions:secrets:set ANTHROPIC_API_KEY`
  (now version 2, ENABLED) — verify a key with a direct `curl https://api.anthropic.com/v1/messages` (HTTP 200). (4)
  **Function's runtime service account lacked Firestore access** — `350381584449-compute@developer.gserviceaccount.com`
  was missing **Cloud Datastore User**, so the Admin-SDK profile/usage reads threw `7 PERMISSION_DENIED` (the S56
  note that it was granted was stale — it wasn't on the account). Kevin added **Cloud Datastore User** to that SA in
  project IAM (no redeploy needed; IAM is read at runtime). **Diagnosis tip:** `OPTIONS 403` = invoker/org-policy;
  `POST 500 internal` = inside the function (read its `console.error` via `firebase functions:log`, but it lags 1–2
  min — also test the key with curl and the SA roles in IAM). **Committed:** _(pending Kevin's go-ahead to commit +
  push; pushing `main` auto-deploys the UI to Vercel)._
  **NEXT:** Stage 2 — function-calling tools (`get_meal_logs`/`get_calorie_targets`/`get_trainer_clients`/
  `get_client_last_log` per the spec) so it answers "what did I eat this week?" / "which clients haven't logged?".
  Then Stage 3 (conversational meal-write into `caliq-log-{id}-{date}`), Stage 4 (SSE streaming via an `onRequest`
  HTTP fn), photo logging (paid/vision). Minor polish backlog: pro-plan subscription gate on the chat button (waits
  for Stripe; budget tiers already role-based server-side), align the AI daily-budget date to local tz (currently
  UTC in `aichat.js` `todayKey` — correct/un-spoofable for a budget, but resets ~8pm ET).
- Session 62: **AI chat Stage 2 — data-aware tools (function calling) DEPLOYED & LIVE.** The AI can now read REAL
  logged data, so it answers "what did I eat this week?" / "which clients haven't logged?" with actual numbers
  instead of guessing. New **`functions/aitools.js`** exports `buildTools(role)` + `runTool(name,input,ctx)`, wired
  into `aichat.js` via an Anthropic function-calling loop (bounded to `MAX_TOOL_ROUNDS = 5`; token usage accumulates
  across all rounds for the daily budget). Three tools: **`get_nutrition_log`** (per-day calories/macros + the foods
  eaten + weigh-in + workedOut, for a date range — one Firestore range query over `caliq-log-{plan}-{date}`, capped at
  31 days), **`get_nutrition_targets`** (calorie + macro targets + current/goal weight), and **`list_clients`**
  (trainers only — each client's last-log date + days-since, via getMyclients-style `where(assignedTrainerId==me)` +
  a per-client log range query). System prompt now injects **today's date** (computed in `America/New_York` so
  "today"/"this week" resolve to the user's local day, matching the S45 local-date log keys).
  **⚠️ SECURITY — enforced server-side in `aitools.js`, NOT by the model (this is the whole point):** a **client**
  caller's data tools ALWAYS use `request.auth.uid` — clients don't even get a `clientId` param, so the model cannot
  target another user. A **trainer/admin** caller may pass a `clientId` (from `list_clients`) but `resolveTargetUid`
  verifies that client's `assignedTrainerId`/`headTrainerId` == caller (or admin) BEFORE returning data; an
  unauthorized id returns `{error}` to the model, never data. So "ask the AI to read someone else's logs" structurally
  can't leak.
  **Data-model reconciliation:** ported `computeClientCalories` (Mifflin-St Jeor BMR × activity − 500, min 1200) + the
  dashboard macro defaults (protein 1g/lb, fat 28% cal, carbs remainder; `data.macroTargets` overrides) into the
  function so server-side targets match the app. The scheduled-exercise calorie add-back is intentionally omitted
  (small; zero for all-rest-days plans) — `get_nutrition_targets` notes the target is the baseline diet target.
  kv reads mirror `src/storage.js` exactly: `users/{uid}/kv/{encodeURIComponent(key)}` docs with a JSON-string
  `value` field; prefix listing uses a Firestore range query `where('k','>=',prefix).where('k','<=',prefix+'')`.
  **Deployed** (`firebase deploy --only functions:aiChat`; backend-only — NO Vercel redeploy needed). **VERIFIED LIVE**
  (preview): trainer.uitest asked "which clients haven't logged + what's Casey eating" → it called all three tools and
  returned Casey's ACTUAL logged days (Jun 21 700cal/weigh-in 188; Jun 24 Chicken bowl 700cal/60g + workout; Jun 25
  Salmon 278cal/30p/6c/16f), missing-day list, and the 188g protein target. client.uitest (Casey) asked "what did I
  eat this week + am I hitting protein?" → real numbers from HER OWN log only (Thu 30g vs 188g target). No console
  errors; no tool errors in `firebase functions:log`. (One transient `7 PERMISSION_DENIED` right after the deploy =
  the same cold-start service-agent propagation race seen in S60/S61 on a fresh revision; both live tests AFTER it
  succeeded — self-heals.) Committed (this session).
  **NEXT:** Stage 3 — conversational meal LOGGING (parse a described meal → confirm card → WRITE into the existing
  `caliq-log-{plan}-{date}` `meals[]` store via a new write tool / callable, reconciling the spec's richer
  `components`/`totals`/`giEstimate` with the app's `meals[]` so AI-logged meals show in the dashboard/calendar/weekly
  cards). Then Stage 4 — SSE streaming (needs an `onRequest` HTTP fn, not the callable) — and photo logging (paid/
  vision). Same reminders: model `claude-sonnet-4-6`; firebase reauth = `firebase login --reauth --no-localhost`.
- Session 63: **AI chat Stage 3 — conversational meal LOGGING (the AI can now WRITE meals). DEPLOYED & LIVE.**
  The headline feature: a user describes food in plain language, the AI estimates macros, shows the breakdown,
  confirms, then writes it straight into the existing daily-log store so it shows on the dashboard/calendar/weekly
  cards — no form. New **`log_meal`** tool in `functions/aitools.js` (both roles): inputs `name, mealType
  (breakfast|lunch|dinner|snack), calories, protein, carbs, fat, date?, clientId?`. It appends a meal item with the
  EXACT shape `App.onAddMeal` uses (`{id, name, type, calories, protein, carbs, fat}`) to `caliq-log-{activePlan}-
  {date}.meals[]`, rolls the values into the day's `calories/protein/carbs/fat` totals (Option-A additive, matching
  the app), and best-effort appends an activity-feed event to `caliq-history-{plan}` with the same `{id,uid,role,
  name,action,ts}` shape so AI logs show in the feed. Date defaults to **today in `America/New_York`** (passed as
  `ctx.today` from `aichat.js`) to match the S45 local-date keys. New kv helper `kvSetJSON` (mirrors storage.js
  `{k,value}`). **Security is the same server-side model as the read tools:** a client logs only to their OWN account
  (no `clientId`); a trainer may log FOR a client only after `resolveTargetUid` verifies the client is theirs — so a
  trainer can log on a client's behalf (the manual-entry tier) and nobody can write into a stranger's log.
  **Confirm-before-write:** the system prompt instructs the AI to estimate → show the breakdown → get an explicit
  go-ahead → ONLY THEN call `log_meal` (and to support corrections first, e.g. "make it one egg"). Verified it does
  NOT write prematurely. **Live refresh:** the callable now returns `wrote: true` when a `log_meal` succeeded;
  `AIChatPanel` gained an `onDataChanged` prop, and `ClientHome` passes `() => load(activePlanId)` so the dashboard
  behind the chat reloads and shows the new meal immediately. (Trainer screens mount the panel without the callback —
  fine; their own loaders refresh on next view.) **Frontend changed → `npm run build` passes; pushing redeploys
  Vercel.** Backend `firebase deploy --only functions:aiChat` done. **VERIFIED LIVE end-to-end as client.uitest
  (Casey):** "I had grilled chicken + a cup of rice + broccoli for lunch" → AI estimated ~520 cal / 48p/55c/6f, showed
  it, asked to confirm (no write yet); "yes, log it as lunch" → AI called `log_meal` → "Logged! ✅". **Independently
  confirmed through the app's OWN read path** (not the AI): the in-plan Daily Dashboard shows **"520 LOGGED SO FAR"**,
  target 1,200, **"680 CAL REMAINING"**, and the Meals & Food Today card lists the chicken meal with 48g/55g/6g — so
  the AI write landed exactly where the dashboard/calendar/weekly cards read. No console or tool errors. Committed
  (this session).
  **NEXT:** Stage 4 — SSE streaming (replies word-by-word; needs an `onRequest` HTTP fn + EventSource client, not the
  callable) and **photo meal logging** (paid tier: base64 image → Anthropic vision → macro estimate → same `log_meal`
  confirm/write path). Optional polish: a UI **Accept/Edit confirm card** (the spec's §9 card) instead of the current
  conversational confirm; richer meal schema (`components`/`giEstimate`) if wanted. Model `claude-sonnet-4-6`.
- Session 64: **AI chat — coaching-assistant ACTION tools (workout / weigh-in / targets / client requests). DEPLOYED & LIVE.**
  Extended the AI from "logs meals" to "does the trainer's busywork" by adding four write tools to `functions/aitools.js`,
  all following the SAME confirm-before-write + server-side access model as `log_meal` (clients act only on themselves;
  a trainer acts on a client only after `resolveTargetUid` verifies the client is theirs). New tools:
  • **`log_workout`** (both roles) — marks a day as a workout day (find-or-create today's `data.checkIns` entry, set
    `workedOut=true` + optional note); feeds the streak/calendar. • **`log_weigh_in`** (both roles) — records a weigh-in
    (replace-by-date check-in, updates `data.weightLbs` + `startWeightLbs`), mirroring `ClientHome.logWeight` exactly.
  • **`set_targets`** (both roles, mainly trainers) — edits the plan's `data.macroTargets` (protein/carbs/fat g, merged
    over current/computed defaults) and/or `data.goalWeight`. • **`send_client_request`** (trainers only) — writes a
    `{id,fromUid,fromName,type,prompt,status:"open",createdAt,doneAt}` item to the client's `caliq-requests` (+ a
    `caliq-history-self` note), exactly like `TrainerDashboard.sendRequest`, so it pops up on the client's home.
  New helpers in aitools: `loadPlanWrap` (read-modify-write the full `caliq-{plan}` `{data,step}` wrapper),
  `appendHistory` (shared activity-feed writer), `checkInTimestamp`. All check-in/target writes go through the plan
  wrapper; meal writes still go to `caliq-log-{plan}-{date}`. `aichat.js`: the `wrote:true` refresh flag now also fires
  for `log_workout`/`log_weigh_in`/`set_targets` (so the client's dashboard reloads); system prompt expanded to list the
  action tools with a hard "confirm specifics, then act — never prematurely" rule, plus trainer guidance to use
  `clientId` to act on a client's behalf. **Backend-only — no frontend change, no Vercel rebuild.** Deploy needed a
  `firebase login --reauth --no-localhost` (token expired). **VERIFIED LIVE end-to-end:** as client.uitest (Casey)
  "I weighed 186 + did an upper-body workout" → confirmed → both logged; **app's own dashboard independently showed
  weight 188→186** ("Previous: 188 lbs (−2 lbs)"). As trainer.uitest "set Casey's protein to 200g + send her a dinner
  request" → it called `list_clients`, confirmed, did both; **independently confirmed:** Casey's home showed the
  "🍽️ Please log your dinner tonight" request, and a fresh read of her plan returned protein target **200g**. Access
  control held (trainer→Casey allowed because she's their client). No console/tool errors. Committed (this session).
  **DEFERRED (Kevin's call):** full plan-STRUCTURE editing (create/rebuild programs) — future idea is "trainer dictates
  notes for a client → AI drafts a program from them"; not needed now. **Reminders:** model `claude-sonnet-4-6`;
  firebase reauth = `firebase login --reauth --no-localhost`; the AI's powers = the tool set, each new ability is one
  contained, access-checked tool.
- Session 65: **AI chat — PHOTO meal logging (vision). DEPLOYED & LIVE.** Snap a meal → the AI (Claude vision) identifies
  the food, estimates macros, confirms, and logs it via the existing `log_meal` path — the spec's premium photo tier.
  **Frontend (`AIChatPanel`):** a **📷 button** + hidden `<input type="file" accept="image/*" capture="environment">`
  (opens the camera on mobile); `downscaleImage()` canvases the chosen photo to a ≤1024px JPEG data URL (caps upload +
  vision-token cost); a pending-photo thumbnail + ✕ in the composer; Send enabled with just a photo. `send()` builds the
  API payload with an Anthropic image content block (`imageBlockFromDataUrl`) **only on the most recent message** (older
  turns go as text — bounds token cost); the user bubble renders the photo thumbnail. New module helpers
  `downscaleImage`/`imageBlockFromDataUrl`. **Backend (`aichat.js`):** `capHistory` now accepts array content via a new
  `sanitizeContent()` that keeps text blocks + validates image blocks (base64, media_type in jpeg/png/webp/gif, ≤7MB);
  system prompt gained a line telling it to identify food from a photo then estimate→confirm→log like a described meal
  (noting photo estimates are approximate). `claude-sonnet-4-6` is vision-capable. **Not paywalled yet** — gated by the
  per-user daily token budget (image tokens count against it, so cost stays bounded); the real pro-plan gate attaches
  with Stripe. **Frontend changed → `npm run build` passes; pushing redeploys Vercel.** Backend deployed. **VERIFIED LIVE
  (client.uitest / Casey):** injected a synthetic egg+toast-on-a-plate photo through the file input → AI correctly said
  "1 fried egg + 1 slice of toast", estimated ~230 cal / 8p/20c/11f, flagged it's approximate, asked the meal type;
  "it's breakfast, log it" → logged. **Independently confirmed via the app's own Daily Dashboard** (Sat Jun 27):
  "230 LOGGED SO FAR" and the Meals & Food Today card shows the meal at 8g/20g/11g. No console/tool errors. Committed.
  **NEXT (AI roadmap remaining):** Stage 4 **SSE streaming** (replies word-by-word; needs an `onRequest` HTTP fn +
  EventSource client, not the callable) and the optional **Accept/Edit confirm card** (spec §9) instead of the
  conversational confirm. Plan-structure builder still deferred. Model `claude-sonnet-4-6`.
- Session 66: **AI chat Stage 4 — SSE STREAMING (replies appear word-by-word). DEPLOYED & LIVE.** Replaced the
  "Thinking… then full reply" wait with token-by-token streaming. **New `aiChatStream` HTTP function** (`onRequest`,
  `cors:true`, in `functions/aichat.js`, exported via `index.js`) — callables can't stream, so this is a plain HTTP/SSE
  endpoint. It **verifies the Firebase ID token manually** from the `Authorization: Bearer` header (callables do this
  automatically; onRequest must), then runs the SAME role/budget/tools logic and **streams** via
  `client.messages.stream()` → writes `event: delta` SSE frames on each text chunk, runs the tool loop between turns,
  and ends with `event: done {wrote, usage}` (or `event: error {code}`). Refactored the shared bits out of the callable
  into `buildSystemPrompt` / `setupChat` / `runToolRound` so `aiChat` (callable) and `aiChatStream` share one code path;
  the callable is KEPT as an automatic fallback. **Frontend (`App.jsx`):** module-level `AI_STREAM_URL`
  (`https://us-central1-${VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/aiChatStream`) + `streamAiChat(apiMsgs,{onDelta,
  onDone})` — uses `fetch` + `response.body.getReader()` (NOT EventSource, which can't set the auth header) and parses
  SSE frames. `AIChatPanel.send()` now streams first (appending each delta to the in-progress assistant message) and
  **falls back to the `aiChat` callable on any stream failure** (network/CORS/server), so it can never regress; the
  daily-limit (`resource-exhausted`) case shows the limit message without falling back. "Thinking…" now hides once
  streamed text starts. The `wrote` flag rides the `done` event → still triggers the `onDataChanged` dashboard refresh.
  **Deploy: the NEW `aiChatStream` created cleanly with the public invoker set** (the Session-61 org-policy "Allow All"
  override now lets new functions bind `allUsers` on create — no repeat of the S61 invoker saga). **Frontend changed →
  `npm run build` passes; pushing redeploys Vercel.** **VERIFIED LIVE (client.uitest / Casey):** (1) plain Q ("3
  high-protein breakfasts") streamed incrementally (text length grew 100→145→239→393→445 across polls); (2) a
  data-read ("what did I eat this week") called `get_nutrition_log` then streamed Casey's REAL week (Wed chicken bowl +
  workout, Thu salmon, Fri grilled chicken, Today the photo egg+toast); (3) a write ("log a protein bar 200cal/20g") →
  confirm-before-write held even on "just do it" → "yes" → logged, and the app's own Daily Dashboard refreshed to
  "430 LOGGED SO FAR · 2 items · 28g protein". No console/function errors. Committed.
  **AI roadmap status:** chat · read-data · log meals (typed + photo/vision) · log workouts/weigh-ins · set targets ·
  send client requests · STREAMING — all live. **Remaining (optional):** the spec §9 **Accept/Edit confirm card**
  (tappable card under a meal estimate instead of typing "yes"); **plan-structure builder** (deferred — Kevin's future
  idea: trainer dictates notes → AI drafts a program). Model `claude-sonnet-4-6`.
- Session 67: **AI chat — PROMPT CACHING (cut AI cost ~half, stretch the daily budget ~4×). DEPLOYED & LIVE.**
  The fixed instruction+tools prefix (~2,300–2,400 tokens for clients, slightly more for trainers) was being re-sent at
  full price on EVERY API call and every tool round, which is what drained the per-user daily token budget so fast.
  Added Anthropic **prompt caching**: `setupChat` now returns `system` as a cacheable block array
  `[{type:"text", text, cache_control:{type:"ephemeral"}}]` — tools render before system, so one breakpoint on the
  system block caches **tools + system** together. Identical across calls within a day, so repeat messages + tool
  rounds (within the 5-min cache TTL) pay ~10% for that prefix instead of full price. **Zero effect on output quality**
  — the model receives the identical prompt; only billing/processing of the cached prefix changes (and TTFT is a touch
  faster). New `addUsage()` accumulates the four token counts Anthropic reports (`input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`); both the callable and the stream now log an `aiUsage` line
  + return `usage.breakdown`. **Budget accounting updated:** `spent = input + output + cacheWrite` (cache READS bill at
  ~10%, so excluded) — so cached messages barely dent the budget, which is why the daily allowance now stretches ~4×.
  **Backend-only — no frontend change** (App.jsx net-unchanged; temporary `window.__gu` measurement hooks were added
  then removed). **MEASURED LIVE** (trainer.uitest, 3-message batch: 1 plain Q + 2 tool queries, ~6 internal API rounds,
  cache warm so cacheWrite=0): tokens were **input 3,988 · output 742 · cacheRead 13,908**. Cost compared apples-to-
  apples from the SAME run (same prompts, billed both ways): **WITHOUT caching ≈ 6.5¢** (the 13,908 cache-read tokens
  would be full-price input) **vs WITH caching ≈ 2.7¢ → ~58% cheaper** for this tool-heavy batch (~45% with a cold-start
  cache write amortized in). Budget tokens for the batch dropped from ~18,600 → ~4,700 (**~4× less**), so the
  "almost at your limit" warning now fires far later. **Note for later (trial periods):** the hard daily cap + caching
  keeps even a long AI-using trial bounded to ~$1–2/user over a 30-day trial — revisit trial length per-role when
  Stripe lands, but cost runaway is structurally prevented. Model `claude-sonnet-4-6`.
  **Kevin confirmed (S67):** keep the 30-day trial as-is — caching + the hard cap make AI-during-trial cost safe.
- Session 68: **AI chat — Accept/Edit meal CARD (spec §9). DEPLOYED & LIVE.** Replaced "type yes to confirm" with a
  tappable confirmation card under the AI's meal estimate. New **`propose_meal`** tool (in `aitools.js`, both roles):
  it does NOT write — it normalizes + echoes the meal `{name,mealType,calories,protein,carbs,fat,date,clientId?}` so
  the client renders a card; for a trainer+clientId it `resolveTargetUid`-verifies first. `runToolRound` now returns
  `{results, wrote, proposal}`; the **callable** includes `proposal` in its response and the **stream** emits an SSE
  `event: proposal`. New **`logMeal` callable** (no Anthropic secret — Firestore only) is the **Accept** button's
  direct write: it rebuilds the tool ctx and calls `runTool("log_meal", …)`, reusing the SAME write + access checks —
  so tapping Accept saves **instantly with zero AI tokens** (cheap, per the S67 cost focus). System prompt now tells
  the AI to `propose_meal` for described/photo meals (card saves it; don't also `log_meal`) and reserve `log_meal` for
  explicit "log it without a card". **Frontend (`AIChatPanel`):** `callLogMeal` callable; `streamAiChat` gained an
  `onProposal` handler; new `proposal`/`editDraft` state; the card renders between the thread and composer with
  **✓ Log it / Edit / ✕** — Edit opens pre-filled name + meal-type chips + cal/P/C/F number inputs → **Save & log**;
  states are pending → saving → "✓ Logged"; a new message clears any pending card. `index.js` exports `logMeal`.
  **Frontend changed → `npm run build` passes; pushing redeploys Vercel.** Functions deployed (logMeal created clean
  with public invoker). **VERIFIED LIVE (trainer.uitest):** "turkey sandwich + apple for lunch" → AI estimated in text
  AND a LUNCH card appeared (395 cal · 25P/55C/7F) with the three buttons; tapped **Edit** → inputs pre-filled →
  changed calories 395→420 → **Save & log** → "✓ Logged"; **independently confirmed** by asking the AI to read today's
  log → "Lunch — Turkey sandwich & apple — **420 cal**" (the EDITED value persisted). No console/function errors.
  Committed. **AI roadmap: COMPLETE** — chat · read-data · log meals (typed + photo + **card confirm**) · workouts/
  weigh-ins · targets · client requests · streaming · prompt caching. **Only future item:** the deferred plan-structure
  builder (trainer notes → AI drafts a program). Model `claude-sonnet-4-6`.
- Session 69: **AI plan-structure builder — the AI now WRITES workout programs ("dictate notes → AI drafts a program"). DEPLOYED & LIVE.**
  Kevin's exciting one: a trainer (or client) describes what they want and the AI builds a real weekly training program
  into the plan. New **`functions/exercises.js`** — a compact MIRROR of the frontend exercise catalog (52 cardio +
  132 strength: `id`+`label`, strength tagged by movement `cat`), **generated by extracting from `src/App.jsx`
  CARDIO_GROUPS/STRENGTH_EXERCISES** (regex over the source — re-extract if the catalog changes). Two new tools in
  `aitools.js`: **`list_exercises`** (static; returns the catalog grouped by movement pattern so the AI uses REAL ids)
  and **`set_workout_schedule`** (writes `data.cardio`/`data.strength` as day-keyed `{type,duration}` arrays, matching
  the wizard exactly; validates every `type` against `CARDIO_IDS`/`STRENGTH_IDS` and **drops unknown ids** — reported
  back so the AI can tell the user; `replace` default true = sets the whole week for a provided category, unlisted days
  → rest; only categories actually provided are touched). Same server-side access model (a client programs their own
  plan; a trainer programs a verified client via `clientId`). `aichat.js`: system prompt tells the AI to call
  list_exercises → design a balanced week → lay it out for approval → then set_workout_schedule; `set_workout_schedule`
  added to the `wrote` refresh list. **Backend-only — no frontend** (the program renders in the existing Results
  Strength tab + calendar). **VERIFIED LIVE:** trainer.uitest "build Casey a 2-day strength program — Monday upper,
  Thursday lower" → AI called list_clients + list_exercises, laid out a real program (real exercises), confirmed, wrote
  it; **independently confirmed via Casey's OWN fresh plan load** (Results → Strength): "**2 training days/week ·
  3,542 cal/week burned**" with the program's exercises (Bench/Row/Lat = upper, Squat/Deadlift = lower) — valid ids
  drove a real MET burn calc (dropped ids would show 0 days). **Known caveat (pre-existing, NOT this feature):** a
  trainer's "Open plan" shows a **stale cached** copy of the client's plan loaded at dashboard render — so right after
  the AI edits a client's plan the trainer must hit **↻ Refresh** (or reopen) to see it; the CLIENT sees it on their
  next load. The shared plan isn't live-synced (would need Blaze realtime). No console/function errors. Committed.
  **Scope note:** v1 builds the WORKOUT program (the exciting core). Not yet: AI-set personal stats/activity onboarding
  (AI can't create user accounts — sensitive), a tappable program card (conversational confirm for now). Model
  `claude-sonnet-4-6`.
- Session 70: **Live-sync — a trainer's view of a linked client's plan now updates in real time (non-Blaze, the
  S69 "stale cached copy" caveat — fixed).** Previously a trainer *already viewing* a client's plan had to tap
  **↻ Refresh** to see a concurrent client/AI edit — and Refresh only re-pulled the daily log + history, NOT the
  plan structure (`data`), so AI-built workout programs / weigh-ins / target changes never appeared without
  reopening. **Fix:** Firestore `onSnapshot` real-time listeners. New `subscribeForUser(uid, key, cb)` in
  `src/clientData.js` (wraps `onSnapshot` on `users/{uid}/kv/{encodeURIComponent(key)}`, swallows errors, returns
  unsubscribe). In `App.jsx`, a new effect (keyed `[activeRemoteUid, activeId, todayKey]`, runs ONLY when a trainer
  views a remote client) subscribes to three docs and live-updates state: (1) the plan wrapper `caliq-{plan}` →
  `data` (rebuilt via a new module-level `buildMergedData` helper — same name-migration + cardio/strength-default
  merge as `openClientPlan`), (2) `caliq-log-{plan}-{today}` → `dailyLog`, (3) `caliq-history-{plan}` → `history`.
  **Clobber guards** so the trainer's own edits aren't lost: the `data` listener skips applying a snapshot while a
  local edit is mid-debounce (`saveTimer.current`, now nulled in autoSave's `finally`) and ignores the trainer's own
  echoed write (new `lastRemoteWriteRef`, set in autoSave's remote branch); it also advances `lastSnapshotRef` so
  the live update generates **no phantom history**. `reloadPlanLive` (the manual Refresh, kept as a fallback) was
  completed to ALSO reload `data` (it previously didn't). **The client side got the symmetric treatment:**
  `ClientHome` now subscribes to its OWN account (`subscribeForUser(meUid, …)`) for the active plan's wrapper, today's
  log, and `caliq-requests` — so when the trainer/AI edits a client's plan, sends a to-do, or logs for them, the
  client's home updates live too (a new trainer request appears instantly). Echo-suppression there uses three
  `lastSelf*Write` refs (data/log/requests) set at each client write site — important because it stops an echo from
  resetting the race-sensitive `planWrapRef` mid weight-log. **The trainer dashboard summary cards are live too:**
  a module-level `useClientLiveRefresh(clients, reload)` hook (used by both `TrainerDashboard` and `TrainerAnalytics`)
  subscribes to each connected client's active-plan **history** doc (`caliq-history-{activePlanId}` — it changes on
  nearly every client action: meals, weigh-ins, calorie/workout logs, AI-logged entries) and debounce-re-runs the
  loader (1.5s), so the cards refresh when a client logs without a manual reload. Each subscription skips its initial
  snapshot (no reload on subscribe) and calls the latest `reload` via a ref (no stale closure); keyed on the
  `uid:activePlanId` signature so it only re-subscribes when the client set changes (no loop). TrainerAnalytics rows
  gained `activePlanId` for the key. **Live-sync now covers every trainer/client surface** (open plan, client home,
  both dashboards). No new Firestore reads of note
  (≤3 listeners per open plan; real-time is standard/cheap — no meaningful cost, no Blaze billing concern).
  **Verified live** (preview, via the actual app): (trainer viewing Casey) a concurrent today-log write → Daily
  Dashboard **0 → 450 "logged so far" with no Refresh**, a concurrent `goalWeight` 172→165 recomputed "21.0 lbs to
  go" **live**, deletion/restore reflected live, **no phantom trainer history**; (client Casey's own home) a
  concurrent `goalWeight` 172→160 **live**, a concurrent new request **2 → 3 to-dos live**, removals reflected; and
  the client's OWN calorie logging still writes + persists and is **not reverted** by the echo (900 cal logged via
  the UI); (trainer dashboards) a client weight change auto-refreshed the TrainerDashboard connected-client card
  (**186 → 180 lbs**) and the Coaching Dashboard "lbs lost" (**16 → 12 → 10**) with no manual reload. **No console
  errors** anywhere; `npm run build` passes. No `firestore.rules` change (uses existing owner + trainer↔client kv
  read access).
- Session 71: **Connected-clients to-do reminders — trainer toggle + timestamps (non-Blaze).** Two small UX asks
  from Kevin on the TrainerDashboard "🔗 Your Connected Clients" card. (1) **Toggle the sent-to-do notifications
  on/off:** a trainer found the per-client request reminders ("📬 Please log your dinner tonight") noisy on their
  own dashboard, so a **"🔔 To-do reminders: On / 🔕 Off"** button (under the section subtitle) hides/shows the whole
  sent-requests display on the client cards — the "📬 N open" badge, the open list, AND the "N completed" list — all
  gated on a new `showReqs` state. Persisted to the trainer's own `caliq-coach-prefs` doc as `showRequests` (default
  ON; only an explicit `false` hides). **Important:** both writers of that shared doc now **read-merge-write** —
  `saveShowReqs` (new, TrainerDashboard) and `saveAttn` (TrainerAnalytics's attention-threshold, which previously
  overwrote the whole doc with just `{attnDays}`) — so the two prefs don't clobber each other. (2) **Date/time
  stamps:** completed requests now show **"Completed {Mon D, h:mm AM/PM}"** (from `doneAt`) and open requests show
  **"Sent …"** (from `createdAt`), via a new module-level `fmtStamp(ts)` helper (`toLocaleString` month/day/time).
  Pure UI + the one pref field; no data-model/schema change, no Blaze. **Verified live** (trainer.uitest): toggle Off
  hid the badge + lists, survived a reload (stored `{attnDays:3, showRequests:false}` — attnDays preserved), toggling
  back On restored them; completed/open stamps render ("Completed Jun 21, 3:39 PM", "Sent Jun 27, 4:51 PM"); no
  console errors; `npm run build` passes. No `firestore.rules` change.
  **(3) Client-side toggle (same session, Kevin's follow-up):** the CLIENT can now also hide the trainer to-do
  reminders on their own home — the app should be usable for just one thing (e.g. only the AI chat for fitness
  advice) without being nagged by to-do nudges. `ClientHome` gained a `showReminders` state persisted to the
  client's own **`caliq-client-prefs`** doc as `showTrainerReminders` (default ON; merge-write so future client
  prefs won't clobber). The "📬 From your trainer" card got a **🔕 Hide** control; when hidden it collapses to a
  compact **"🔕 N trainer reminders hidden · Show"** line (data still arrives — requests aren't deleted, just not
  shown — and there's always a path back to re-enable). **Verified live** (client.uitest / Casey): Hide collapsed
  the card + stored `{showTrainerReminders:false}`, survived a reload, Show restored it; no console errors; build
  passes. This is the lightweight first step toward the **Notification Center** roadmap item below (the only
  notification surface today is the trainer to-do list, so one toggle covers the current need).
- Session 72: **AI conversational onboarding — the AI can now fill in a plan's personal stats (fuller AI profiles,
  increment 1). DEPLOYED & LIVE.** First slice of the roadmap's "fuller AI-managed profiles" (Kevin's S71 pick).
  Until now the AI could set *targets* and build *workout programs* but NOT the core stats the calorie math needs, so
  a plan stayed "incomplete" (no calorie target) until someone ran the wizard. Two new tools in `functions/aitools.js`
  (both roles, same server-side access model as every other tool — a client edits only their own profile; a trainer
  only a `resolveTargetUid`-verified client): **`get_profile`** (read — returns name/gender/age/height/weight/goal/
  activity/body-fat + a `missing` list of the required fields for a calorie target + `complete` + the computed
  `calorieTarget`) and **`set_personal_info`** (write — sets any of firstName/lastName, gender (male|female), age,
  heightFeet+heightInches, weightLbs, activityLevel (sedentary|light|moderate|very|extra), goalWeightLbs, bodyFatPct,
  goalBodyFatPct into the plan wrapper `data`, clamped to sane ranges, with an activity-feed history note; returns the
  refreshed `profileSummary`). New `profileSummary(d)` helper mirrors the wizard's field names + the `nutritionTargets`
  calc. `aichat.js`: `set_personal_info` added to the `wrote` refresh list (client dashboard reloads when the AI
  completes a profile), and the system prompt gained an **onboarding** instruction — if the dashboard shows no calorie
  target, call `get_profile` FIRST, ask only for the fields it lists as *missing* (never re-ask for info already set),
  save via `set_personal_info`, then report the daily target. **Backend-only — no frontend change** (the existing
  `onDataChanged`/`wrote` path already refreshes). Deployed `aiChat`+`aiChatStream` (needed a `firebase login --reauth
  --no-localhost` first — token had expired). **Verified live end-to-end** (preview, signed in as client.uitest /
  Casey, whose plan was missing gender/age/height): told the AI "female, 30, 5'6", weight 186, goal 172, moderately
  active" → it called `set_personal_info` → **independently confirmed via the app's own read path**: data written
  correctly and the Daily Dashboard now shows the **1,950 cal** target (matches Mifflin-St Jeor female × moderate −
  500). Then reset the 3 fields and re-tested the prompt fix: the AI called `get_profile` first and asked **only** for
  the missing gender/age/height ("I already have your weight 186, goal 172, activity moderate"), no longer re-asking
  for known info. No console/function errors. So a brand-new user can complete their whole plan by chat — no wizard.
  **NEXT increments of "fuller AI profiles":** plan MANAGEMENT (switch active plan, start a cut/maintenance phase via a
  new tool over the `caliq-plans` manifest), then **proactive coaching** ("3 clients stalled this week, here's what I'd
  change"). Same pattern: one access-checked tool at a time. Model `claude-sonnet-4-6`.
- Session 73: **AI plan management — list / switch / create plans & phases (fuller AI profiles, increment 2).
  DEPLOYED & LIVE.** Builds on S72: the AI can now manage the multi-plan setup conversationally, so a user can start a
  cut/maintenance/bulk phase by chat. Three new tools in `functions/aitools.js` (both roles, same `resolveTargetUid`
  access model — a client manages only their own plans; a trainer only a verified client's): **`list_plans`** (read —
  the `caliq-plans` manifest: each plan's id/name + which is active), **`create_plan`** (write — adds a new plan to the
  manifest + creates its `caliq-{id}` wrapper; **carries over the person's personal stats by default** via the new
  `PERSONAL_FIELDS` list so they don't re-enter gender/age/height/weight/activity; `goalWeightLbs` sets the phase goal;
  `makeActive` default true; workouts/targets/logs start fresh), and **`switch_plan`** (write — points the manifest's
  `active` at an existing planId). New manifest helpers `normalizeManifest`/`readManifest`/`writeManifest` mirror
  `src/App.jsx` exactly (default "self" plan, valid active id) so the AI manages plans identically to the UI. `aichat.js`:
  `create_plan`+`switch_plan` added to the `wrote` refresh list (dashboard reloads on the active-plan change), and the
  system prompt gained a plan/phases instruction (list → switch → create-new-phase; carries stats; confirm before
  create/switch; never expose plan ids — refer to plans by name). **Backend-only — no frontend change.** Deployed
  `aiChat`+`aiChatStream`. **Verified live end-to-end** (preview, client.uitest / Casey): "start a cut phase called
  Summer Cut, goal 165" → AI called `list_plans`+`get_profile`, **confirmed before creating**, then `create_plan` →
  **independently confirmed via the app's read path**: a new "Summer Cut" plan became active with the stats carried over
  (female/30/5'6"/186/moderate) + goalWeight 165 + a 1,950 cal target; then "switch back to my Main plan" → confirmed →
  `switch_plan` set active back to "self". Test "Summer Cut" plan cleaned up afterward. No console/function errors.
  **NEXT (fuller AI profiles, increment 3): proactive coaching** — e.g. a trainer asks "who's stalled / what should I
  change?" and the AI synthesizes across `list_clients` + each client's logs/trend (read tools already exist; this is
  mostly prompt + maybe a cross-client summary tool). Model `claude-sonnet-4-6`.
- Session 74: **AI proactive coaching — cross-client `coach_summary` tool (fuller AI profiles, increment 3 — the arc is
  COMPLETE). DEPLOYED & LIVE.** A trainer can now ask "who's stalled / who needs attention / what should I change?" and
  the AI answers across ALL their clients in ONE tool call instead of looping the per-client tools (which would burn the
  5-round tool cap + tokens for trainers with many clients). New **`coach_summary`** tool (trainers only) in
  `functions/aitools.js`: loops the trainer's clients (`where assignedTrainerId == caller`, capped 60), and for each
  builds a coaching snapshot — days logged in the window (default 7, max 31), true days-since-last-log (one
  `orderBy("k","desc").limit(1)` query on the log prefix — default single-field index, no composite needed), calorie &
  protein adherence (avg logged vs target via the ported `nutritionTargets`), latest weight + **weight trend lbs/week**
  (ported `weightTrend` least-squares + `etaWeeks` on-track check, matching `src/App.jsx`), open-request count, and a
  derived **status** (inactive / stalled / off_track / on_track / logging). Returns the clients **sorted most-concerning
  first** + status `counts`. Same server-side access model (a trainer only ever sees their OWN clients — the query is
  scoped to `assignedTrainerId == callerUid`). System prompt (`aichat.js`) gained a proactive-coaching instruction: for
  cross-client questions call `coach_summary` once, then call out who needs attention BY NAME with concrete
  recommendations and offer to `send_client_request`. **Backend-only — no frontend change.** Deployed
  `aiChat`+`aiChatStream`. **Verified live** (preview, trainer.uitest): "which clients need attention this week + what
  should I change?" → the AI called `coach_summary` and returned a named, data-driven readout on Casey (flagged the
  calorie/protein gap, the aggressive −5.5 lb/wk rate from her real weigh-ins, 4 days logged, 2 pending requests) with
  specific recommendations and an offer to send a nudge. Function logs clean (no tool/index/permission errors); no
  console errors. **"Fuller AI profiles" is DONE:** onboarding (S72) + plan management (S73) + proactive coaching (S74).
  Model `claude-sonnet-4-6`.
- Session 75: **AI plan-builder confirmation CARD — tappable Accept for a drafted workout program. DEPLOYED & LIVE.**
  The remaining AI polish item (handoff #4): the program builder used a conversational "yes" confirm; now the AI's
  drafted weekly program renders as a tappable Accept card (mirroring the S68 meal Accept card) so it saves in one tap.
  **Backend (`functions/`):** new **`propose_workout`** tool (both roles) in `aitools.js` — validates + builds the week
  (reusing the extracted module-level `buildWorkoutWeek` helper that `set_workout_schedule` now also uses; `EX_LABEL`
  map + `weekWithLabels` attach display labels) and echoes back `{shown, workout:{strength,cardio (labeled), replace,
  droppedInvalidIds, raw, clientId?}}` WITHOUT writing; `raw` is the validated id-only program the Accept callable
  writes. New **`setWorkoutSchedule` callable** (`aichat.js`, exported in `index.js`) — the Accept write, runs
  `runTool("set_workout_schedule", raw, ctx)` with the SAME server-side access checks (a client programs their own plan;
  a trainer a `resolveTargetUid`-verified client) and **no Anthropic call** (instant, zero tokens). `runToolRound` relays
  `workoutProposal`; the callable returns it and the stream emits an SSE `workoutProposal` event. System prompt: the
  program-builder now calls `propose_workout` (card) instead of `set_workout_schedule` directly (kept for "set it without
  a card"). **Frontend (`App.jsx`):** `callSetWorkout` callable; `streamAiChat` gained `onWorkoutProposal` + the
  `workoutProposal` SSE branch; `AIChatPanel` gained a `workout` state + `acceptWorkout` handler + a program card (days
  with 💪/🏃 + real exercise labels, scrollable, "N days/week", **✓ Save program** / dismiss, "want changes? tell me in
  chat", dropped-id warning), cleared on a new message, with the non-stream fallback reading `res.data.workoutProposal`;
  Accept → `callSetWorkout(raw)` → `onDataChanged` refresh. **Frontend changed → `npm run build` passes; push redeploys
  Vercel.** Functions deployed (`setWorkoutSchedule` created clean with the public invoker — the S61 org-policy "Allow
  All" holds). **Verified live BOTH entry points:** (trainer.uitest) "build Casey a 2-day full-body program" → card with
  Mon/Thu (real exercises) → Save → **Casey's plan strength went Mon 6/Thu 6 → Mon 7/Thu 7** (written cross-account to
  the verified client); (client.uitest / Casey) "build me a 3-day full body program, show the card" → 3-day card → Save →
  her own plan strength became **Mon/Wed/Fri 6 each**. No console/function errors. **AI plan-builder is now card-confirmed
  like meals.** Model `claude-sonnet-4-6`.
  **Also S75 — AI calendar management (handoff #2):** the date tools already existed (log_meal/propose_meal/log_workout/
  log_weigh_in take a `date`; get_nutrition_log takes a range), so back-dating + review-by-date already worked
  mechanically — added a system-prompt block telling the AI to resolve "yesterday / last Monday / last week" to a
  YYYY-MM-DD and pass it (vs assuming today). Verified live (client.uitest): "log my 30-min strength workout for yesterday"
  → AI resolved it to **2026-06-27**, confirmed, and the check-in landed on that date (`workedOut:true`), not today. NOT
  external Acuity/Google sync; NOT one-off future scheduled events (those need a data-model + calendar-UI change).
  **The AI roadmap is now fully worked through:** chat · data reads · meal logging (typed/photo/card) · workouts/weigh-ins/
  targets/requests · workout-program builder (card-confirmed) · streaming · prompt caching · onboarding · plan management ·
  proactive coaching · calendar/date-aware logging.
- Session 76: **Notification Center — central master + per-type toggles in the side menu (non-Blaze).** Built the
  Notification Center Kevin envisioned (S71): a **"🔔 Notifications"** section in the `SideMenu` with a **master
  "All notifications" switch** + **per-type toggles**, so a user can silence everything or pick by type — the goal
  being someone can use Glide for just one thing (e.g. only the AI chat) without unwanted nudges. **One unified pref
  doc `caliq-notif-prefs` `{master, trainerReminders, sentReminders}` lifted to App** (state + `onSetNotifPrefs(patch)`
  merge-writer + load in the profile effect), threaded to `SideMenu`, `ClientHome`, and `TrainerDashboard` so the
  central screen AND the existing inline toggles read/write the SAME state and **stay in sync live** (no reload).
  Replaced the S71 per-component prefs: ClientHome's `showReminders`/`caliq-client-prefs` and TrainerDashboard's
  `showReqs`/`caliq-coach-prefs.showRequests` are gone — both now derive from `notifPrefs` (`master && trainerReminders`
  for the client's "📬 From your trainer" card; `master && sentReminders` for the trainer's sent-to-do display). The
  per-type toggle in the menu is disabled when master is off; the menu's master-off hides everything (even the client's
  collapsed "N hidden" line). Inline re-enable also clears master (`{master:true, …:true}`). `attnDays` stays in
  `caliq-coach-prefs` (untouched — separate doc). Only ONE notification type exists today (trainer to-dos), so the
  master ≈ that type for now; the structure is ready for more (food/weigh-in/AI nudges) — each new type = one row +
  one gate. Pure front-end display prefs (no Blaze); actual push/delivery still needs Blaze (see roadmap). **Verified
  live BOTH roles** (client.uitest + trainer.uitest): menu toggles sync to the inline home/dashboard instantly and
  vice-versa, master-off silences all, everything persists across reload, no console errors, `npm run build` passes.
  No `firestore.rules` change.
- Session 77: **AI polish (knowledge base + chat persistence) + notification nudges + 100% AI profile coverage. LIVE.**
  Four things, all shipped. (1) **Glide knowledge base** — new `functions/knowledge.js` exports `GLIDE_KNOWLEDGE`
  (GI / resistant-starch context, rice GI tables, Smooth Training coaching principles), appended to the AI system
  prompt **inside the cached prefix** in `aichat.js buildSystemPrompt`, so it adds **zero per-call token cost** and is
  meant to grow over time (the "living system" idea — just add sections). Verified live: "does day-old reheated rice
  affect blood sugar?" → the AI applied the resistant-starch knowledge and recommended **basmati** (the file's lower-GI
  default). (2) **Conversation persistence** — `AIChatPanel` saves the thread to the user's own `caliq-ai-chat`
  (text-only, photos stripped, capped 20) and restores it on reopen; a `loadedRef` guards against clobbering the saved
  thread with the initial empty state. **No AI cost change** — `capHistory` already caps the API payload to the last
  ~20 messages either way; persistence only adds a tiny Firestore read/write. Verified live (save + restore across a
  full reload). (3) **Home notification nudges (client)** — three NEW notification TYPES on `ClientHome`: food-logging
  reminder (nothing logged + past local noon), weigh-in reminder (7+ days since last weigh-in, or none yet), and a
  rotating **daily AI coaching tip** (`COACH_TIPS`, picked by `getDate()`); each is a gentle dismissible card, gated by
  `notifPrefs` (master + its type) + a session dismiss, shown only when relevant. The **Notification Center** (S76) now
  renders these as per-type rows — client has 4 (trainer to-dos, food, weigh-in, coaching tips), trainer keeps 1 (sent
  to-dos); `notifPrefs` defaults extended (`foodReminders/weighInReminders/coachingNudges`, default on via `!== false`).
  Verified live (client.uitest): all three render, each gates by its toggle, master-off silences all. (4) **100% AI
  profile coverage** — `set_personal_info` now also sets the optional **weight-range band** (`goalRangeLowLbs/HighLbs`,
  auto-sorted low≤high) and **trainer notes** (`trainerNotes`); `get_profile`/`profileSummary` return them. Verified
  live (trainer set Casey's range 165–172 + a coaching note via chat). **So the AI can now fill EVERY plan field the
  app uses** — stats, goal, weight-range band, activity, body-fat, macro targets, the full workout program, and trainer
  notes — entirely by conversation. **Custom exercises were intentionally SKIPPED:** `data.customExercises` is written
  by the wizard's `CustomExerciseCreator` but **never read** by the schedule pickers (`<select>` lists only
  `STRENGTH_EXERCISES`/`STRENGTH_GROUPS`) or the burn calc (`allStrEx = [REST_ST, ...STRENGTH_EXERCISES]`, no custom) —
  so AI-writing it would be dead data; wiring custom exercises into the pickers + burn lookup (+ then the AI tool) is a
  separate small task (see roadmap). Frontend verified + pushed; backend (`aiChat`+`aiChatStream`) deployed. No console
  errors; `npm run build` passes. No `firestore.rules` change. Model `claude-sonnet-4-6`.
- Session 78: **Custom exercises — wired end-to-end (frontend) + AI-creatable (the S77-scoped item). LIVE.** Closes the
  "100% coverage" gap. **Step A (frontend, benefits everyone):** `data.customExercises` was written by the wizard's
  `CustomExerciseCreator` but **read nowhere** (dead data). Now custom exercises work everywhere. New module-level
  helpers in `src/App.jsx`: `customOf(list, type)`, `findCardioEx(id, custom)` / `findStrengthEx(id, custom)` (resolve a
  custom OR standard id), `exBurn(ex, weightLbs, min)` (**custom burns by `calPerMin × minutes`; standard by MET** — note
  custom exercises store `calPerMin` with `met:0`), and a `<CustomOptGroup>` dropdown component. Folded custom exercises
  into EVERY exercise lookup + burn site (~20: wizard StepStrength/StepCardio, all Results tabs, DailyDashboard,
  `computeClientCalories`, the App-level computed day data) by replacing the inline `ALL_CARDIO.find(...)||fallback` /
  `[REST_ST,...STRENGTH_EXERCISES]` + `calcBurn/calcStrengthBurn(ex.met,…)` pattern with `findCardioEx`/`findStrengthEx`
  (or `[…STRENGTH_EXERCISES, ...customOf(data.customExercises,"strength")]`) + `exBurn`. Added a "⭐ Custom" optgroup to
  all schedule `<select>`s and merged custom into the `SearchableSelect` type-aheads. Verified live (Prospect Pat, 220
  lbs): standard Bench 45m → **412 cal** (MET, regression OK); custom Sled Push 30m @10 cal/min → **exactly 300 cal**,
  correct label, no console errors. **Step B (AI):** new **`add_custom_exercise`** tool (both roles, access-checked) in
  `aitools.js` creates a custom exercise (AI estimates `calPerMin`, deduped by label+type) and returns its id;
  `propose_workout`/`set_workout_schedule` now fold the plan's custom ids into the valid-id sets (via `customExerciseSets(data)`)
  so they're not dropped, and into the card's label map (`weekWithLabels(week, labelMap)`) so the card shows the name.
  Verified live (trainer→Casey): "add Battle Ropes ~12 cal/min, program it Monday 20m, show card" → `add_custom_exercise`
  + `propose_workout` → card "Monday — Battle Ropes (~240 cal)" → Accept → Casey's Monday strength holds the custom id.
  **⚠️ DEPLOY GOTCHA (hit + fixed):** `aitools.js` is shared by `aiChat`, `aiChatStream`, `logMeal`, AND `setWorkoutSchedule`
  (the Accept callables). Deploying only `aiChat`/`aiChatStream` left `setWorkoutSchedule` on stale `aitools.js`, which
  dropped the custom id on Accept (empty schedule, but "saved" shown). **When `aitools.js` changes, deploy ALL FOUR
  functions.** Frontend + backend both pushed/deployed. `npm run build` passes. No `firestore.rules` change. Model
  `claude-sonnet-4-6`.
- Session 79: **Voice input for the AI chat — speak instead of type (Whisper; OpenAI now, Groq-ready). DEPLOYED & LIVE.**
  A **🎤 mic button** in the chat composer records via the browser `MediaRecorder`, sends the audio to a new
  **`transcribeAudio`** Cloud Function, and drops the transcribed text into the input for the user to review/send.
  **`functions/transcribe.js`** (`transcribeAudio` onCall, secrets `OPENAI_API_KEY` + `GROQ_API_KEY`, auth required,
  ~3-min/10MB-b64 size cap): **PROVIDER-AGNOSTIC** — OpenAI and Groq both expose an OpenAI-compatible
  `/audio/transcriptions` multipart endpoint, so ONE code path serves both (only url/model/key differ). `VOICE_PRIMARY
  = "openai"` (available now), `VOICE_FALLBACK = "groq"` (best-effort; Groq's PAID tier is currently gated by high
  demand, so OpenAI is the day-one provider — flip `VOICE_PRIMARY` to "groq" when it reopens: cheaper + faster). Builds
  the multipart `FormData`/`Blob` in Node 22 (global fetch/FormData/Blob) and returns `{text, provider}`. **Frontend
  (`App.jsx` `AIChatPanel`):** `callTranscribe` callable; a mic button that toggles record/stop (picks a supported
  mime via `MediaRecorder.isTypeSupported` — webm/mp4/ogg), `blobToBase64`, `recording`/`transcribing` states + a
  pulsing red stop button, friendly errors (mic blocked / unsupported browser); on result `setDraft(prev + text)` so
  the user reviews before sending; photo/send disabled while recording. New module helper `blobToBase64`. **Cost:**
  ~$0.006/min (Whisper) — pennies; the transcribed text then runs through the normal **budgeted** chat, so the endpoint
  itself just needs auth + the size cap. **Keys:** `OPENAI_API_KEY` + `GROQ_API_KEY` are Secret Manager secrets (Kevin
  provided both; stored via `firebase functions:secrets:set`). **Deploy:** `firebase deploy --only
  functions:transcribeAudio` (independent — doesn't share `aitools.js`). **Verified end-to-end:** a macOS `say`-generated
  clip ("Hello, this is a Glide voice test, log my breakfast") → (1) direct `curl` to OpenAI Whisper transcribed it
  exactly (key valid), (2) through the DEPLOYED `transcribeAudio` callable from the browser (real auth) → **HTTP 200,
  exact text, provider "openai"** (validates the Node FormData→Whisper path + the provider abstraction); the mic button
  renders in the composer. **Real mic capture is device-tested by Kevin** — the headless preview has no microphone, but
  the recording path is standard `MediaRecorder` → the proven callable. `npm run build` passes. No `firestore.rules`
  change. **Optional later:** voice OUTPUT (TTS — also cheap); a pro-plan gate (waits for Stripe); promote Groq to
  primary when its paid tier reopens.
- Session 80: **Custom icon system + OG share-card foundation + Paste-from-AI import.** (Details live in
  `Glide-Session-Handoff-NEXT.md` history + `docs/AI-INTEROP-VISION.md`.) Highlights: new `src/icons.jsx`
  (`<Icon>` cyan line-icon family) swept across the app; static OG card `public/og.png` (`npm run gen:og` via
  `scripts/gen-og.mjs` + resvg + Sora) + og/twitter meta in `index.html`; Paste-from-AI import box in the chat.
- Session 81: **Personalized "[Name] invited you" share card (Option B) — builds on the S80 OG foundation.**
  Trainer invite links are now **`…/i/CODE?n=FirstName`** (was `…/?invite=CODE`; old links still work), built in
  the side-menu invite section from `meName`. Two NEW Vercel serverless functions (the repo's first `api/` +
  first `vercel.json`): **`api/invite.js`** serves HTML whose OG/Twitter meta say "**{Name} invited you to
  Glide**" with `og:image` → `/api/og?n={Name}`, then redirects real browsers to `/?invite=CODE&n=Name`
  (crawlers read the meta; humans bounce into the app; name HTML-escaped, code sanitized — XSS-tested);
  **`api/og.js`** renders the personalized 1200×630 PNG (resvg + Sora, like `gen-og.mjs`) and **302s to the
  static `/og.png` on ANY error** (can only improve the unfurl, never break it). `vercel.json` rewrites
  `/i/:code → /api/invite` + `includeFiles` for `api/_fonts/` (Sora 700/400 copied there); `@resvg/resvg-js`
  moved to `dependencies` (function runtime). In-app: `AuthGate` notice + `App.jsx` `?n=` reader/cleaner greet
  the invitee by the inviter's name. **Verified locally** (build passes; both handlers tested in Node — valid
  PNG, correct meta, XSS sanitization; preview shows the personalized notice; no console errors). **The
  Vercel-runtime bits (resvg on Vercel, the rewrite, font bundling) are only confirmable post-deploy** — test
  the unfurl at opengraph.xyz/Slack after the push; static fallback covers the worst case. No `firestore.rules`
  change. Also wrote **`docs/VIDEO-LINK-INGEST.md`** answering Kevin's question about ingesting Instagram/
  YouTube/video links to improve a program (feasible; YouTube auto-fetch + universal paste-the-caption fallback,
  reusing the existing AI tools; deep video/vision is a later premium tier).
- Session 82: **Video/link ingest — the AI can now READ a shared link (Phase 1 of `docs/VIDEO-LINK-INGEST.md`).
  DEPLOYED & LIVE.** Kevin's question ("send an Instagram/YouTube/video link to Glide to improve/complement a
  program") shipped as a new **`fetch_link`** AI tool (`functions/aitools.js`, both roles, no account target).
  When the user pastes a URL in chat, the AI calls `fetch_link` → it fetches the page server-side (Blaze
  outbound) and extracts **title + description/caption** (og/twitter/`<title>`/meta-description, plus a
  best-effort pull of YouTube's full description from the watch-page `"shortDescription"` JSON) → the AI turns
  it into program changes via the existing tools (`propose_workout` / `add_custom_exercise` / `propose_meal`).
  **The workout is almost always in the caption text, so we read text — we don't download or "watch" the
  video** (cheap; deep vision is a later premium tier). **Guards (in the helper, not the model):** http(s)
  only; **SSRF denylist** (blocks localhost / 127.*/10.*/192.168.*/172.16-31.* / 169.254.* / cloud-metadata /
  no-TLD / IPv6 loopback); 8s timeout; 1MB read cap + 4MB content-length cap; content-type filter; non-2xx
  handled. **Universal fallback:** Instagram/TikTok usually block server fetches (they 403 or hide captions) —
  the tool returns a hint and the AI asks the user to paste the caption, which just works as text. **No YouTube
  Data API key needed** for the MVP (reads the watch-page description directly); a key later would add full
  transcripts. UA is a plain browser string (Wikipedia 403s the facebookexternalhit UA — switched). System
  prompt (`aichat.js`) got a "Links / videos" block. Frontend: chat placeholder + empty-state suggestions hint
  "paste a workout/recipe link" (no new callable — a URL rides normal chat). **Deployed all four AI functions**
  (`aiChat`, `aiChatStream`, `logMeal`, `setWorkoutSchedule` — `aitools.js` is shared, per the standing gotcha).
  **Verified:** `fetch_link` unit-tested in Node (real YouTube → full title+description; SSRF/protocol/invalid
  all blocked; Wikipedia → title, empty desc → AI asks for paste); build passes; and **live end-to-end** in the
  preview (signed in as Casey, the AI read a real YouTube link and summarized its actual content, no console/
  function errors). `docs/VIDEO-LINK-INGEST.md` Phase 1 marked shipped. No `firestore.rules` change. Model
  `claude-sonnet-4-6`. **NEXT:** back to the plan — **Option C (in-app/email invites + referral)** → **calendar
  back-dating**. Video-ingest Phase 2 (oEmbed caption auto-fetch for IG/TikTok) / Phase 3 (transcript + vision,
  premium) remain optional per the doc.
- Session 83: **Option C — Invites & referrals (Invite Hub). LIVE (email pending Kevin's key).** Built a
  dedicated **`InviteHub`** modal (≡ menu → "Invite clients", full-screen `createPortal`, `data-theme="pro"`)
  replacing the old inline invite expander. It has: (1) the personalized invite link (`/i/CODE?n=First` from
  S81) + Copy; (2) **native Share** (Web Share API with copy fallback); (3) a **QR code** for in-person
  signups (new `qrcode` dependency, rendered dark-on-white for scannability); (4) **email invitations**; and
  (5) **referral stats** — clients joined / invites sent / invites joined. **Referral tracking uses NO new
  infra:** email invites are recorded in the trainer's own `caliq-invites` kv (owner write), and an invite is
  marked "joined" **client-side** by matching its email against connected clients' emails (`getMyClients`
  returns full profiles incl. email) — so no Cloud Function trigger. **Email:** new **`sendInvite`** callable
  (`functions/invites.js`, trainer-only, verifies role) sends a branded HTML email with the personalized link
  via **Resend** (`RESEND_API_KEY` + `RESEND_FROM` secrets; ≤20 recipients, email-format validated). The
  function only sends — the client records the invite locally. **(Update S84: DEPLOYED & LIVE — Resend secrets set, `send.smoothtraining.com` verified SPF/DKIM/DMARC, sender `invites@send.smoothtraining.com`.)** **Verified live**
  as trainer.uitest: Invite Hub renders on-brand, referral stats correct (1 client joined = Casey), personalized
  link + QR generate, email path shows the friendly fallback; `npm run build` passes; no console errors. Frontend
  pushed (Vercel auto-deploys); no other functions changed (`aitools.js` untouched this session). No
  `firestore.rules` change. **NEXT:** calendar back-dating.
- Session 85: **Trainerize importer v1 (LIVE) + full optimization/security sweep (LIVE).**
  (1) **Importer:** `trainerizeImport` callable (`functions/trainerize.js`) — pages `getClientList`, batch
  `user/getProfile` (`usersid` ARRAY — non-obvious param), per-client `bodystats/get {date:"last"}` +
  `goal/getList`; maps profile→`firstName/lastName/gender/age/heightFt+In/activityLevel`, last bodystat→
  `weightLbs/bodyFat` + ONE seeded check-in + `startWeightLbs`, weightGoal→`goalWeight`, nutritionGoal→
  `macroTargets`. Writes LOCAL PROFILES into the CALLER's kv (Option A): deterministic ids `ctz{trainerizeId}`
  + `trainerizeId` on the index entry (re-import UPDATES — verified no dupes), filed under a "Trainerize"
  folder, complete snapshots get step 5 (dashboard-ready), client email kept on the index entry for future
  account-linking. Frontend: "Import from Trainerize" button on the trainer home Local Plans card; **visible
  AND callable ONLY by the admin UID** — the shared group token would otherwise hand any self-signed-up
  "trainer" Kevin's client PII (reviewer catch, fixed + redeployed same session). Verified live with the real
  roster (**10 active clients** — the S84 "13" shrank on Trainerize's side) via the test trainer, then cleaned
  up; Kevin imports by tapping the button in his own account. Confirmed endpoint contracts in
  `docs/TRAINERIZE-API.md` — read that before v2. v2/v3 (history, scheduled auto-sync, calorieOut,
  multi-tenant per-trainer tokens) still roadmap.
  (2) **Sweep** (3 parallel review agents over App.jsx / functions / support files; every fix applied,
  smoke-tested live, deployed):
  • **Read-cost:** `storage.js list()` + `clientData.js listForUser()` now use `where("k",">=",prefix)` range
  queries (they downloaded the ENTIRE kv collection — every daily log with full values — per call, per client,
  per dashboard visit); AI `list_clients` uses `orderBy("k","desc").limit(1)` + a 60-client cap (was reading
  every log doc per client); the in-plan streak loop reads days in parallel batches of 7 with a cache the
  week-summary reuses (was up to ~365 serial round-trips per plan open); TrainerDashboard/TrainerAnalytics
  per-client reads parallelized; the dashboard details effect keys on an `id:lastSaved` signature (a rename no
  longer re-reads every plan); nudge no longer double-reloads. **⚠️ Gotcha:** keep the range upper bound as
  the ESCAPE sequence `""` in source — a raw pasted char silently became an empty string once and made
  `listForUser` return nothing (caught in the live smoke test, not the build).
  • **Security:** `firestore.rules` — owner updates can no longer touch `subscriptionStatus`/`entitlements`/
  `trialStartedAt`/`trialLengthDays` (they drive the AI budget tier + the Pro food gate = a self-serve upgrade
  hole) and creates can't start "active"/with entitlements; `inviteCodes` split `allow get` (signed-in) vs
  `allow list` (admin only — no harvesting every code→trainer mapping) + create restricted to
  `hasOnly(['trainerUid','createdAt'])`. **61 emulator tests pass** (was 47; +14 attack cases). **Rules
  PUBLISHED.** `fetch_link` follows redirects MANUALLY, re-checking the SSRF denylist on every hop (≤3 hops);
  `sendInvite` capped **50 emails/day/trainer** (`users/{uid}/inviteUsage/{day}`).
  • **Correctness:** new module hook `useTodayKey()` (used by App + ClientHome) — today's date key is STATE
  that rolls over at midnight (1-min timer + visibilitychange) and the daily-log effect depends on it, fixing
  a real corruption: a dashboard left open past midnight kept writing yesterday's running totals into the new
  day's key. AuthGate now distinguishes "profile read FAILED" (retry screen) from "no profile" (a flaky read
  used to route an EXISTING user into the RoleChooser, whose re-createProfile wiped their trainer link and
  restarted their trial; `createProfile` is now also non-destructive when a profile exists). `joinTrainer`'s
  legacy inviteCode users-query is try/caught (denied under the S59 scoped rules → typo'd codes crashed raw
  instead of the friendly error). `logWrite` failures now surface via console (the fire-and-forget promise
  rejection was fully swallowed — a failed save looked saved forever). aiChat/aiChatStream record token usage
  in a `finally` (a mid-turn tool-round error used to leave all prior rounds unbilled) and the stream's
  `setupChat` failure returns a clean JSON 500 (was an unhandled rejection); stream error frames now carry
  `wrote`. Chat images are only honored on the FINAL message, max 2 (history images would re-bill vision
  tokens every tool round). Hard timeouts on ALL outbound fetches (Trainerize 15s — errors now return non-ok
  instead of killing the import mid-loop — USDA/OFF 8s, Whisper 30s, Resend 10s).
  • **Misc:** PWA `sw.js` re-caches the offline shell on every successful navigation (the install-time copy
  went stale after any deploy — its hashed asset URLs 404'd, so offline fallback was a white screen);
  `themes.css` prod font import trimmed to **Sora only** (Bebas/Inter/Nunito/DM-Sans moved to
  `showcase-fonts.css`, imported only by the dev Showcase — five families were render-blocking every prod
  load); `qrcode` lazy-loaded via dynamic import (same pattern as the barcode scanner).
  **Deferred (listed in the handoff):** kv read-modify-write transactions (log_meal / send_client_request /
  optimistic app writes), AI budget transactional pre-reserve, assignedTrainerId consent validation, semantic
  tool-result truncation, ProfileCard hoist (rename caret jump), per-uid live-refresh scoping. All 8 functions
  redeployed; rules published; frontend pushed (Vercel).
- Session 86: **Trainerize client PICKER + PWA safe-area fixes + round-2 sweep (math/data-integrity + mobile).**
  Kevin ran the v1 import (all 10 worked), then asked for selective import, reported two installed-PWA bugs, and
  requested a second sweep. (1) **Selective import:** `trainerizeImport` gained `{mode:"list"}` (roster preview +
  already-imported flags, no writes) and `{clientIds:[…]}` (import only those); the trainer-home button now opens
  a **picker** (checkboxes, All/New-only/None, "✓ in Glide" tags, Import-N-selected; guard message if the backend
  hasn't deployed yet). (2) **PWA bugs (root cause found by review agent):** the in-plan header was the ONLY one of
  five without `env(safe-area-inset-top)` padding (dropped in the S30 Tailwind rebuild) → title hid under the
  iPhone status bar and the fixed hamburger overlapped the back row — fixed (+ min-h 64px to match the rest);
  `.prof-save-badge` got the safe-area term; `html,body{background:#05080a}` kills the white overscroll flash.
  (3) **Round-2 sweep (3 agents: domain math, newer features, docs-vs-reality) — fixes applied:**
  • **AI ↔ app target agreement:** server `nutritionTargets` now adds scheduled-exercise burn via new
  `weeklyPlanBurn` + a **MET map regenerated into functions/exercises.js** (185 ids, parity-checked: bench 45m
  @220lbs = 412 cal both sides) — the AI/`coach_summary` used to run ~a-day's-burn lower than every app screen
  and mis-score faithful clients as "over target". `set_targets` now pins ONLY explicitly-asked macros (used to
  freeze all three at server-baseline numbers).
  • **Weigh-in integrity:** AI `log_weigh_in` + ClientHome quick-log now MERGE into a same-day check-in (used to
  wipe a same-day workout/notes/body-fat); the in-plan Daily Dashboard weight box now writes a REAL check-in +
  updates `weightLbs`/`startWeightLbs` (was a dead end only the day-log saw — verified live: log 198.5 → check-in
  created, current weight + target recompute); new `syncWeightFromCheckIns` helper makes check-in SAVES re-point
  current weight like deletes already did (3 handlers).
  • **Consistency:** calendar Day view judges food against the same deficit target as month/week (was raw TDEE —
  same day looked "over" in month and "under" when opened); Summary + Nutrients tabs respect `data.macroTargets`
  (used to show recomputed defaults); SharePlanCard target includes strength burn (was cardio-only); AICoach
  trend filters+sorts weigh-ins (used to narrate "null lbs" after a workout-only check-in or back-dated edit).
  • **AI chat robustness:** stream-failure fallback no longer re-sends once ANY event arrived (a mid-stream drop
  after a tool write could log a meal TWICE); mic released on panel close/unmount/constructor failure (was left
  hot); chat persistence won't clobber the saved thread after a failed load; meal-edit "Save & log" double-tap
  guarded.
  (4) **Docs audit applied (12 items):** RESUME-HERE rewritten (was frozen at S41), duplicate S26 entry removed,
  S83 sendInvite "NOT deployed" corrected, voice = Groq primary (S84), 29→61 tests, ~7.5k→~13.5k lines,
  trainerize/invites/transcribe headers fixed, `AGENTS.md` → pointer (was a stale S60 copy), 3 stale root
  handoffs → `docs/archive/`.
  **(Same-session follow-up: Kevin re-authed → ALL five functions DEPLOYED; picker E2E-verified — select 2 →
  exactly 2 imported, "✓ in Glide" tags on reopen. Header bug ROOT CAUSE round 2: global
  `*{box-sizing:border-box}` makes `min-h` classes INCLUDE the safe-area padding — all five headers now use
  explicit `minHeight: calc(74px + env(safe-area-inset-top,0px))` and the hamburger sits at `top: calc(17px +
  inset)`, centered in the band, 17px above the border. Remember for any new header/fixed element. Wearables
  CONFIRMED live: `healthData/getList` returns real Garmin daily calorieOut {restingEnergy, activeEnergy} +
  steps through the existing token → Trainerize v3 is unblocked.)**
  **Deferred:** ~~projection double-count~~ (RESOLVED S86c — Kevin chose BOTH modes, see below), maskable PWA
  icon, dead-CSS cleanup (`.header`/`.steps-wrap`/`.prof-header-bar` blocks), plan-delete orphaning per-date
  log docs, linkPlan re-link without backup, mixed check-in timestamp bases (harmless today).
- Session 86c (same session): **Trainerize MEAL SYNC + dual "Nutrition Approach" — DEPLOYED & LIVE.**
  (1) **Meal sync (Trainerize v2 nutrition):** `syncClientNutrition` in `functions/trainerize.js` — every
  import/re-import also pulls the client's last **365 days** of `dailyNutrition` into
  `caliq-log-{pid}-{date}`. **Trainerize-native days = full meal detail** (meal name→Glide type via
  MEAL_TYPE_MAP, clock time from `mealTime`, one Glide meal per food with macros); **MFP/Fitbit days = one
  "<Source> day total" entry** (those apps don't share per-food data — this is an MFP policy, not a Glide
  gap). Imported ids `tz{nutritionId}-{i}` → re-sync REPLACES prior imports (E2E-verified idempotent),
  never touches Glide-logged meals, and day totals adjust by delta. `dailyNutrition/get` detail calls fire
  ONLY for source==="trainerize" entries (getList summaries already carry MFP/Fitbit totals). Confirmed
  endpoint contracts: `dailyNutrition/getList {userID, startDate/endDate "YYYY-MM-DD HH:MI:SS"}` →
  `{nutrition:[{id, date, source: "mFP"|"fitbit"|"trainerize", calories, proteinGrams, carbsGrams,
  fatGrams, …}]}`; `/get {id, userID}` → adds `meals:[{name, mealTime, foods:[{name, calories, proteins,
  carbs, fat, amount, unit}]}]` + micronutrients. E2E: 2 clients → 43 day logs, verified against raw API.
  (2) **Nutrition Approach — Kevin's call on the projection double-count: have BOTH.** New plan field
  `data.deficitMode`: **"eatback"** (default; scheduled burn is ADDED to the daily calorie target — easier
  diet, steady ~1 lb/wk) vs **"accelerate"** (target stays TDEE−500 — the burn speeds up the goal date
  instead). Module helper `isEatback(d)` routes EVERY surface: `computeClientCalories`, the DailyDashboard
  per-day target, SummaryTab, NutrientsTab, SharePlanCard, SimulationSummary, and server
  `nutritionTargets` (aitools.js); the AI sets it via `set_personal_info.deficitMode` and `get_profile`
  reports it. **Chooser:** Full Plan → Summary → "Nutrition Approach" card — both options with live
  cal/day + goal date + ✓ ACTIVE, one tap to switch (persists via `onSetDeficitMode` → setDataAndSave);
  the timeline card and SimulationSummary now show BOTH paces honestly labeled (the old "faster with
  cardio" line that contradicted the eat-back target is gone). Verified live: 1,148 cal/wk plan —
  Eat More 2,733/day → Jan 2027 vs Faster 2,569/day → Dec 2026; switching flips share card, timeline, and
  dashboard target. All five functions redeployed (aitools shared); frontend pushed.
- Session 86d (same session): **Trainerize AUTO-SYNC — every 30 minutes, DEPLOYED & LIVE.** Kevin asked for
  real-time transfer; **Trainerize has no webhooks** (poll-only platform), so the closest-possible:
  **`trainerizeAutoSync`** (`onSchedule "every 30 minutes"`, first scheduled function in the project —
  Cloud Scheduler auto-provisioned cleanly on deploy). Each run re-syncs every ALREADY-imported client
  (`trainerizeId` on Kevin's index) — fresh weight/body-stats/goals + last 14 days of nutrition — so a
  weigh-in, meal, or wearable-sourced body stat that lands in Trainerize appears in Glide within ~30 min,
  hands-free. New Trainerize clients are NOT auto-added (selective picker stays the gate). Refactor:
  shared `runImport(db, uid, auth, {clientIds, nutritionDays})` + `fetchRoster(auth)` back both the
  callable (picker/manual = 365-day nutrition) and the schedule (14-day window). **Semantics note:**
  imported (ctz*) profiles now treat Trainerize as source of truth — manual Glide edits to
  weight/goals/stats are overwritten by the next sync. Single-tenant: the schedule targets ADMIN_UIDS[0]
  (Kevin); multi-tenant token store changes this later. Trainerize v3 (wearable calorieOut/steps) should
  ride this same schedule. **S86e (session close):** owner-only toggle on the trainer home —
  "🔄 Trainerize auto-sync: On/Off" → `caliq-tz-autosync {enabled}` in Kevin's kv, checked at the top of
  every scheduled run (missing/true = ON; explicit false = the run no-ops, resume is instant). Cost:
  ~1,500 invocations/mo vs a 2M free tier + ≈$0.20/mo Firestore writes — effectively free.
- Session 87: **AI edits LOCAL plans/simulations by chat — DEPLOYED & LIVE.** The queue's next item.
  New trainer-only tool **`list_local_plans`** (caller's `caliq-index` → localPlanId, name,
  isSimulation, importedFromTrainerize, weight/goal, daysSinceSaved) + optional **`localPlanId`** on all
  12 plan-data tools (get_profile/set_personal_info/get_nutrition_log/get_nutrition_targets/log_meal/
  propose_meal/log_workout/log_weigh_in/set_targets/add_custom_exercise/propose_workout/
  set_workout_schedule — NOT the manifest tools). **Security shape:** localPlanId is validated against
  the CALLER's own index and only ever applied to uid === callerUid — it can't widen access; clientId
  and localPlanId are mutually exclusive. Plumbing: `activePlanId/activePlanData/loadPlanWrap` gained a
  `planOverride` arg resolved ONCE centrally in runTool; **`touchLocalIndex`** updates the index entry
  (name/weight/goal/lastSaved) after every local-plan write so trainer-home cards stay correct;
  meal/workout PROPOSALS echo `localPlanId` so the Accept-card callables write to the same file; App
  passes `onDataChanged={reloadProfilesIndex}` (new helper, also reused by the Trainerize import) to the
  trainer screens' AIChatPanel so Local Plans cards refresh live after AI writes. System prompt: trainer
  section instructs list_local_plans + refer to files by NAME. **E2E-verified live** (trainer.uitest):
  listing worked (names + sim flags); "set Prospect Pat's goal weight to 185" → plan data 185 + index
  185 + the dashboard card live-refreshed with no reload; no console errors. All four AI fns redeployed;
  frontend pushed. Also answered Kevin: Trainerize API calls are free (Studio plan; 1000/min is a
  throttle) — the only cost is Firebase compute/writes (~pennies, on the existing Google bill).
- Session 87b: **Biometric login (Face ID/Touch ID passkeys) — DEPLOYED; + Trainerize auto-sync turned OFF
  (Kevin's call, re-enable via the toggle).** Firebase Auth has no WebAuthn provider, so passkeys ride
  **custom tokens**: new `functions/webauthn.js` (`@simplewebauthn/server` v13) — `passkeyRegisterOptions/
  Verify` (signed-in setup) and `passkeyLoginOptions/Verify` (signed-out → verify assertion → `admin.auth()
  .createCustomToken` → app `signInWithCustomToken`). Credentials `webauthnCreds/{credId}` {uid, publicKey
  (base64url), counter, transports, rpID}; one-shot `webauthnChallenges` (5-min TTL, uid-matched) — both
  collections have NO client rules → Admin-SDK only. **Origin allowlist** (`ALLOWED_ORIGINS`): prod +
  localhost:5173; rpID = origin hostname. ⚠️ **Passkeys are domain-bound** — when a custom domain lands, add
  it to ALLOWED_ORIGINS and users re-register there. Discoverable credentials (`residentKey:"required"`,
  `userVerification:"required"`) = usernameless one-glance sign-in (pairs with the 30-min idle sign-out).
  Frontend (`@simplewebauthn/browser`): SideMenu "🔐 Set up Face ID / Touch ID" row (register; localStorage
  hint `glide-passkey`); AuthGate "🔐 Sign in with Face ID / Touch ID" (login mode, highlighted once hinted;
  user-cancel silent; no-credential → friendly "set it up in the menu" pointer). **Verified in preview:**
  options callable returns valid challenge/rpId, full button round-trip completes with the graceful fallback
  (headless Chrome has no authenticator); menu row renders; build passes; console clean. **Real biometric
  prompt = Kevin device-test** (like the S79 mic): sign in → ≡ → Set up Face ID → sign out → Face ID button.
  Auto-sync off: wrote `caliq-tz-autosync {enabled:false}` to Kevin's kv via Firestore REST (CLI creds).
- **Saved-for-later roadmap (Kevin's calls, Sessions 68–69):**
  - **AI calendar management (in-app):** let the AI back-date logs, schedule workouts on specific weekdays, and review
    by date — same tool pattern (overlaps the plan-builder). **NOT** external calendars (Acuity/Google) — that's a
    separate integration project for much later. Kevin: "implement in the future when the time comes."
  - **Fuller AI-managed profiles:** onboarding by conversation (fill personal stats/goals — but NOT account creation),
    plan management (switch active plan, start a cut/maintenance phase), and eventually PROACTIVE coaching ("3 clients
    stalled this week, here's what I'd change"). Build incrementally, one access-checked tool at a time.
  - **The AI is a living system, not stagnant:** its behavior (system prompt) and abilities (tools) are fully ours to
    change/extend anytime; we can also feed it Glide-specific knowledge (the spec's GI tables, coaching methodology).
    Model upgrades are a one-line change as Anthropic ships better models. Framed for Kevin S68 — keep this in mind
    when scoping future AI work. **The knowledge base now exists (`functions/knowledge.js`, S77) — keep growing it.**
  - ~~**Custom exercises — wire them end-to-end**~~ **DONE — Session 78** (frontend pickers/burn + AI `add_custom_exercise`).
    _(Original scoping below, for reference.)_ Today `data.customExercises` is written
    by the wizard's `CustomExerciseCreator` (StepStrength/StepCardio) but **read nowhere**: the schedule `<select>`s
    list only `STRENGTH_EXERCISES`/`ALL_CARDIO`, and every burn calc uses `[REST_ST, ...STRENGTH_EXERCISES]` /
    `ALL_CARDIO` (no custom). Plan: (a) merge `data.customExercises` into the pickers (add a "Custom" optgroup) AND the
    burn-lookup arrays (`allStrEx`/`ALL_CARDIO` everywhere they're built — wizard StepStrength ~2377, the Results burn
    calcs, the dashboard) so a custom id renders + computes a MET-based burn; (b) ensure the custom shape carries a
    `met` (the creator already collects one) + a `cat`/type; (c) THEN add an AI `add_custom_exercise` tool + let
    `set_workout_schedule`/`propose_workout` accept the plan's custom ids (load them into the valid-id set by type).
    Small but touches several burn-calc sites — do (a)/(b) first (makes custom exercises actually work for everyone),
    then (c) is the easy AI bolt-on. Non-Blaze.
  - ~~**Voice input for the AI chat**~~ **DONE — Session 79** (`transcribeAudio`, Whisper; S84 flipped to **Groq primary, OpenAI fallback**).
    _(Original scoping below.)_ Speak instead of type. Claude has no
    speech-to-text, so add a transcription step. **Path B chosen (Claude-app quality):** browser `MediaRecorder` →
    a new transcription Cloud Function → Whisper-class model → feed text into the existing chat. Cost is tiny
    (~$0.006/min OpenAI Whisper; Groq whisper-large-v3 similar/cheaper) → ~$1–2/mo even for heavy users → great margin
    as a premium feature. Build: a mic button + recording UI in `AIChatPanel`, a `transcribeAudio` Cloud Function
    (onCall or onRequest), an OpenAI/Groq key as a Secret Manager secret. Needs Blaze (have it). Optional later: voice
    OUTPUT (TTS) — also cheap. (Path A = browser Web Speech API: free but lower/inconsistent quality, flaky on iOS —
    rejected for the premium feel.)