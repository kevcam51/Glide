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

- **Vite + React (JSX).** Main UI is a single large component in `src/App.jsx` (~7,500 lines),
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
  (29 tests currently pass).

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
> _Last updated: Session 41._
> - **Brand redesign (Tailwind + "pro" theme): DONE.** Every screen is on-brand near-black + cyan
>   (`#08DCE0`). Client/Trainer dashboards, All-clients, the wizard, and the in-plan Results/Daily
>   Dashboard are all migrated (Tailwind for the rebuilt screens; the in-plan screens use the old
>   `:root` CSS vars which were retuned to brand values in S31, headings unified to Sora in S32).
> - **Nutrition tier (free self-log): DONE (S36–40).** Per-food macros + daily totals, macro targets +
>   progress bars, **editable** macro targets (coach or client, `data.macroTargets`), one-tap re-add of
>   recent foods (`caliq-foods-{planId}`), and a weekly averages card ("This Week").
> - **Trainer analytics dashboard: DONE (S34).** Side-menu 📊 Dashboard = `TrainerAnalytics` (needs-
>   attention, open requests, aggregate progress). `homeTab` is `"dashboard"|"analytics"|"clients"`.
> - **Key gotcha:** the `.page-transition` wrapper keeps a CSS transform → it becomes the containing
>   block for `position:fixed`. Modals + `BottomNav` are rendered via `createPortal(…, document.body)`
>   to escape it (S27/S30). Any new fixed overlay must do the same.
> - **Still NON-Blaze roadmap:** calendar enhancements, more trainer tools, deeper nutrition.
>   **Blaze-gated (not yet):** AI coaching/photo meal tracking, client→trainer messaging/requests,
>   notifications, Stripe. See the roadmap section below.
> - **In progress now:** general calendar + trainer-tools improvements (Kevin gave open-ended latitude).

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
  the live update generates **no phantom history**. `reloadPlanLive` (the manual Refresh, still wired for the client
  side / as a fallback) was completed to ALSO reload `data` (it previously didn't). **Scope:** trainer→client view
  only — the explicit S69 pain point; the client's own ClientHome (separate component, own loaders + AI
  `onDataChanged`) and the trainer dashboard *summaries* (load once on mount) are unchanged (possible follow-ups).
  No new Firestore reads of note (3 listeners per open plan; real-time is standard/cheap — no meaningful cost, no
  Blaze billing concern). **Verified live** (preview, signed in as trainer.uitest viewing Casey via the actual app):
  a concurrent write to Casey's today-log via `setForUser` made the Daily Dashboard go **0 → 450 "logged so far"
  with no Refresh click**; a concurrent `goalWeight` 172→165 change recomputed "21.0 lbs to go" **live**; deletion/
  restore reflected live too; recent history showed **no phantom trainer entry**; **no console errors**;
  `npm run build` passes. No `firestore.rules` change (uses the existing trainer↔client kv read access).
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
    when scoping future AI work.