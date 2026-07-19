# Glide — Next-Session Handoff (start here)

## ⚡⚡⚡ S97o (Jul 18): Kevin approved the API queue; confetti + skeletons SHIPPED
_Pushed @ `34b9fe5`. Read `docs/EXTERNAL-APIS.md` — Part 2 top has **⭐ KEVIN'S PICKS**
(his approved API queue). Confetti-on-goal + skeleton loaders are LIVE (pick #3, done)._

### ✅ S97p+q (same day): #4 streaks + photo harness BOTH DONE (@ `71d5097`)
- **#4 Streak milestones SHIPPED**: first-log-of-day truly increments the streak (fixed the
  stale Math.max(s,1) tile bug in all 3 log paths); DailyDashboard watcher fires small confetti
  + toast when the streak RISES to 3/7/14/30/50/100/365 (arm-on-mount, no double-fire — E2E'd
  as Casey: 6→7 fired, second log silent, test data restored). **foodReminderPush streak-aware push: DEPLOYED ✓**
- **Photo accuracy harness SHIPPED**: `scripts/photo-eval.mjs` (production-path eval vs
  Nutrition5k ground truth) + `docs/AI-PHOTO-EVAL.md`. Baseline: MAPE 58.9%, and the error is
  SYSTEMATIC (correct food ID, portions over-called on small plates). **Next: add portion-size
  calibration to the vision block in functions/aichat.js prompt, deploy, re-run to measure.**

### ⏭️ Remaining approved picks
1. **#7 TTS coach voice** (small, unblocked): Groq Orpheus primary / OpenAI fallback, mirror
   `functions/transcribe.js`; `speakText` callable + speaker button in chat; premium-gate.
2. ~~Vision-prompt portion tuning~~ **DONE (S97r)** — photo error 59%→30%, bias corrected,
   8/8 dishes now estimate. Deployed. Re-measure any time: `node scripts/photo-eval.mjs 8`
   (regression-tests the vision prompt against lab ground truth before/after any prompt change).
3. **BLOCKED ON KEVIN:** firebase reauth (above) · Stripe Tax (live-mode swap) · Acuity
   (API key + tier) · Twilio SMS (account + A2P lead time).
NOT picked (reference only in the doc): recipe JSON-LD, weather tool, calendar-aware coaching.

### Notes
- `crossedGoal()`/`celebrate()`/`SkeletonCard` are module-level in App.jsx (top, ~L14).
- canvas-confetti is lazy-imported; honors reduced motion; body-level canvas (transform-trap safe).
- Casey's test data restored (weight 183). Exercise-demo prototype results: EXTERNAL-APIS.md.

---

## ⚡⚡⚡ S97g–m (Jul 18): the ICON SYSTEM + the emoji rule, settled
_Pushed through `7438683`. The emoji question Kevin kept reopening is now CLOSED —
read this before touching any icon._

### 📌 THE RULE (Kevin, final)
- **App UI = 100% our own icons, ZERO emoji.** Verified: 0 emoji left in the UI.
- **Outgoing text we SEND (share card, marketing copy) = emoji are FINE and intended.**
  That string lands in iMessage/WhatsApp/email as PLAIN TEXT where SVG can't travel.
  `handleShare` carries a comment saying exactly this — don't "fix" it.
- `Showcase.jsx` still has emoji: dev-only style page (`/?showcase=1`), never user-facing.

### 🎨 HOW TO ADD/FIX AN ICON (the hard-won lesson)
**Geometric/abstract things** (stairs, barbell, chart, target, clipboard, leaf, alert)
→ hand-draw as OUTLINE line art. They read fine at 18px.
**Organic/detailed things** (a flexed arm, a person rowing, a rower, a kicker)
→ NEVER hand-draw as line art; it turns to mush at 18px. Pull a **FILLED silhouette**
from a permissive set and render it filled. This is why 3 hand-drawn muscle attempts
failed and Delapouite's "Biceps" looked professional instantly.

**Sources (all commercial-safe, credited in `CREDITS.md` — keep it updated):**
- **game-icons.net** (CC BY 3.0 — attribution required) — 4,000+ silhouettes, best for
  figures. Raw: `raw.githubusercontent.com/game-icons/icons/master/<author>/<name>.svg`.
  Their grid is 512×512 → strip the `M0 0h512…` background path, keep the figure path,
  and wrap with `transform="scale(0.046875)"` (24/512).
- **Tabler** (MIT), **Phosphor** (MIT), **Lucide** (ISC), **Material Symbols** (Apache-2.0
  — Material is on a `0 -960 960 960` grid → `transform="translate(0,24) scale(0.025)"`).
- AVOID Flaticon/Iconscout (paid / attribution-gated). NOT legal advice, but these
  licenses explicitly permit commercial use with notice retained.

**Filled glyphs must be listed in the ALWAYS-FILL set in `src/icons.jsx`** or the Icon
component strokes their silhouette contour and they look like noise.
`Icon` returns **null** for an unknown name → a typo renders an invisible button, no error.

### ✅ Shipped S97g–m
- Every strength movement pattern has its own figure: vertical push (Strong man),
  vertical pull (hand-built FILLED pull-up — no free set has one), horizontal pull
  (Pull), lower pull (Weight-lifting-down), core (Muscular torso), lower accessory
  (Female legs), upper accessory (Biceps), carry, total-body. Horizontal/Lower Push
  keep the barbell ON PURPOSE (bench + squat ARE barbell lifts — semantic, not fallback).
- Cardio: stairs (solid staircase), jump rope, high kick (martial arts/kickboxing),
  roller skate (rollerblading), rowing (Material, filled).
- **Platform emoji sweep 70 → 3** (the 3 = share text). Back arrows on every overlay.
- **2 real bugs found+fixed by the sweep:** Timeline tab rendered NO icon (TAB_ICONS key
  `"🎯 Timeline"` never matched the plain `"Timeline"` tab — label IS the key now); and
  export/import FAILURES rendered green-as-success (`msg.startsWith("")` is always true
  — both status messages now use structured `{tone,text}` state).


## ⚡⚡⚡ S97 (Jul 17): tile bottom sheets + food-library tabs + default-target + back arrows + MEALS
_All pushed (`origin/main` @ `3293afa`) + deployed. Firebase `calorieiq-29762`; model `claude-sonnet-4-6`.
Kevin gave a big UX batch; built in 2 commits (`99d385d` UX, `3293afa` Meals) — all verified live on
client.uitest (Casey)._

### ✅ What S97 shipped
- **Tile editors are now BOTTOM SHEETS** (new reusable `BottomSheet`, module-level) — slide up IN FRONT
  of the user, dim the rest, dedicated **back arrow top-right** (Kevin's placement). Fixes the "panel
  expanded below the fold, I got lost" complaint. All 4 tiles (`STAT_SHEET_META` maps title/icon).
- **"Use Glidna's default target (N cal)" button** in the Today's Target sheet whenever a custom target
  is set (was buried in the edit flow). Verified reset 1,750 → 1,929.
- **Food library = two INDEPENDENT lists** — saving a food no longer removes it from Previously logged
  (dropped the `!isSaved` filter). Added **meal-type filter tabs** (All/Breakfast/Lunch/Dinner/Snack) to
  both Saved and Previously-logged.
- **MEALS feature** (`3293afa`) — a meal = a named combo of foods. New per-user store `caliq-meals-saved`
  (`SAVED_MEALS_KEY` + `mealSignature` dedup). **Star next to each meal section** (B/L/D/S) in MealLog
  saves that whole meal. Food library gained a **Foods | Meals** switch; in Meals: Saved | Previously-
  logged (DERIVED from last ~14 logged days, grouped by section, de-duped, hides already-saved) + the
  meal-type filter. **Tap a meal → batch-logs all its foods** (`onLogMeal`→`onAddMeals`). Props threaded
  App→DailyDashboard→MealLog→FoodLibrary. Verified: star saved "Breakfast · Greek Yogurt Bowl" → Meal
  library Saved(1); Previously-logged(4) derived; tapping a Lunch meal logged 320→840.
- **Back arrow (top-right)** on the daily-workflow overlays: FoodLibrary, FoodServingModal,
  WeightChartModal, MeasurementsModal, CalendarView, + the sheet. New `back` icon in `src/icons.jsx`.
- **Emoji sweep** in the dashboard/food surfaces (macro rows/bars → colored dots; workout Confirmed/
  Remove, target edit/tip, library Added/star cleaned).

### ✅ S97b — BOTH big emoji jobs DONE (`48b3ba3` pickers, `012b5bf` full sweep) — the app is emoji-free
- **ExercisePicker** replaced ALL 9 native exercise `<select>`s (wizard quick-fills + day cards, Results
  cardio ×2 + strength, dashboard editor ×2): trigger button (icon+label) → BottomSheet with search +
  grouped rows + real icons. Dead SearchableSelect + CustomOptGroup deleted. 8 NEW activity pictograms
  (walk stairs row boxing ball jumprope mountain dance — Apple/Garmin category style, visually iterated).
  `exerciseCategory()` maps every catalog family + honors `ex.iconName` first.
- **Custom exercises: user-picked icons** (Kevin's future-proofing ask) — 16-icon chooser grid in
  CustomExerciseCreator, stored as `iconName`, renders everywhere via exerciseCategory. E2E: "Sled Push"
  + mountain icon → picker shows it under YOUR CUSTOM EXERCISES with the mountain glyph.
  ⚠️ Backend `add_custom_exercise` (aitools.js) does NOT yet accept iconName — small follow-up if the AI
  should set icons (falls back to category regex → fine today).
- **Full emoji sweep**: rendered UI is 100% house icons / colored dots / plain text. Kept: plain-text
  clipboard share strings, typographic ♂♀✓⚑, unused data fields (emoji:/icon: keys — never rendered;
  TABS strings still carry emoji as IDENTITY KEYS with icons rendered via TAB_ICONS — do NOT strip them).
  Verified: all 8 Results tabs + dashboard + wizard + client home = zero rendered emoji.
- Test residue: Casey's plan gained custom exercise "Sled Push" (10 cal/min, mountain) — harmless demo.

### ⏭️ (superseded — kept for reference) two BIG emoji jobs Kevin DECIDED
Kevin answered both via AskUserQuestion (S97, end):
1. **Rebuild the exercise pickers as CUSTOM icon-capable lists** (he chose this over strip-to-text or
   keep-emoji). ~250 emoji live in native `<select><option>`/optgroup labels (CARDIO_GROUPS +
   STRENGTH_EXERCISES data, `icon:"🏃"` etc.) where SVG can't render. The job: replace the native
   `<select>`s in StepCardio, StepStrength, the DailyDashboard workout editor, and the calendar day-view
   with a custom dropdown/list that renders real `<Icon>`s. **Needs an exercise→Icon MAPPING** (icons.jsx
   has run/bike/swim/yoga/dumbbell/muscle/flame/water/moon… — map each exercise or each optgroup/category
   to one). A `SearchableSelect` (custom, icon-capable) ALREADY exists — likely extend/reuse it as the
   picker everywhere and drop the parallel native `<select>`. Big: touches every workout picker + a data
   mapping. Do it in its own session.
2. **Check-in mood/buttons → our icons: DONE** (`31dc4ed`) — Yes/No→check/close, worked-out/rest→
   muscle/moon, mood faces→a 1–5 Low→High scale (mood was already an index, no data change).

### ⏭️ Remaining decorative emoji (convertible chrome — mechanical, do alongside #1)
Share card (🏋️📊🎯🔥⚖️📤📈), wizard/onboarding (⭐ custom-exercise, 💡 tips, ⚠️ warnings, 👋 wave,
🔒 lock, ♂♀ gender, 📌 past/future), AICoach (🤖🔄), push (📲), role chips (🧑‍🏫 Trainer / 🙋 Client),
request templates (they carry BOTH `icon:"🍽️"` AND `iconName:"meal"` — just render `iconName`), streak
🔥, "✓ Saved!/Sent" flashes. All convertible to `<Icon>`/text (unlike the native-select ones). ~30 spots.

### ✅ S97 sweep DONE (this session, committed `592c163`+`31dc4ed`)
- **Back arrows on ALL major overlays** (Copy-prev-meal, All-Activity, AI chat panel, Invite Hub,
  Automations, Plan picker, Notes, Notif feed, Admin + the daily-workflow ones from S97). Inline
  dismiss/remove `✕` → house close icon (14 spots). Only 2 `✕` left, both in comments.
- **Daily-visible emoji → icons**: calendar month/week cells + day-view/roll-up labels, LogBtn, check-in.
  Verified live: calendar week view = back arrow + inline icons, no emoji, no console errors.

### ⏭️ S97 REMAINING (Kevin's batch — NOT done, do next)
- **iPad "Ask Glidna" button scrolls** — could NOT reproduce in Chromium (it's correctly
  `position:fixed` portaled to body and holds on scroll). iOS-Safari-specific. **NEED FROM KEVIN:**
  Safari or installed PWA? Does it scroll away completely or drift+snap-back? (Likely the iOS
  momentum-scroll fixed-detach quirk.)
- **Full back-arrow + emoji sweep on SECONDARY screens** — invite hub, messaging, admin dashboard, the
  AI chat panel, calendar-CELL emojis (🍽️🍗⚖️🏋️🎯💧 in CalendarView month/week, ~L8930+), DailyCheckIn
  (client-home) emojis (🍽️💧⚖️🏋️), LogBtn "Logged ✓". ~25 `✕` close buttons remain across the app
  (grep `>✕<|✕ Close`). Mechanical but broad — do carefully.
- **Meals polish**: not wired into the CalendarView day-view MealLog (CalendarView doesn't receive the
  meal props); no rename-a-saved-meal; the "Copy a previous meal" modal still uses a `✕` (not back arrow).
- **Test residue** (client.uitest / Casey, throwaway acct): today (Jul 17) has 2 logged meals (~840 cal) +
  1 saved meal "Breakfast" — consistent valid data, clearable.

---

## ⚡⚡⚡ S96 (Jul 17): dashboard restructure DONE + push delivery COMPLETED + per-client default view
_All pushed (`origin/main` @ `def17ea`) + deployed (Vercel bundle flipped, verified) + all 7 touched
Cloud Functions deployed clean. Firebase `calorieiq-29762`; model `claude-sonnet-4-6`._

### ✅ What S96 shipped (all verified live)
- **Dashboard restructure (the S95 START-HERE, second half) — DONE** (`dd0dbee`). Kevin confirmed
  full-collapse via AskUserQuestion. The Daily Dashboard is now just the tile grid + Progress &
  Insights: **Logged So Far** panel = Quick Add + presets + "Add macros manually" toggle (the old
  macro rows) + the Macros & Micros dropdown + `<MealLog>`; **Workout Burn** panel = the full
  workout editor + Add Cardio/Strength + custom-exercise creator; **oz Water** panel = the only
  water entry; NEW full-width **Today's Weight** tile (`gridColumn:"1 / -1"`) shows current weight
  → opens `MeasurementsModal`. Quick Log + standalone Today's Workout sections DELETED. JSX moved,
  state untouched. Done via a deterministic Python script over exact line ranges (backup in
  scratchpad), NOT hand edits — verified all 5 tiles live (+250 quick-add wrote through, reset to
  0 after; Casey's account clean).
- **Push delivery completed** (`e5d10ce`) — Kevin's "FCM" queue item, read as coverage (the S90
  Web Push/VAPID transport already works; real FCM SDK is only needed for a future NATIVE app).
  New scheduled fns in `functions/push.js`: **`foodReminderPush`** (daily **3pm ET**; nothing
  logged today → push) + **`weighInReminderPush`** (Mondays **9am ET**; 7+ days since a weigh-in
  → push). Both: client-role only (mirrors the S77 ClientHome cards), enumerate via
  `collectionGroup("pushSubs")` so only push-enabled users cost reads, prefs checked BEFORE
  `sendPushTo` (a turned-off type never spams the bell feed). **Automations now PUSH** (were
  feed-only): `runDueWorkflows` → `sendPushTo(..., "automations")`; new "Automation results" row
  in the Notification Center (both roles). push.js exports `VAPID_PRIVATE_KEY` for other fns'
  `secrets` lists. Deployed: foodReminderPush + weighInReminderPush (created, scheduler
  auto-provisioned, confirmed `scheduled` in functions:list) + runDueWorkflows + savePushSub +
  removePushSub + onDmCreated + onTrainerRequestWritten.
  **✅ Both crons VERIFIED firing** (force-ran both scheduler jobs via gcloud after Kevin reauthed):
  `foodReminderPush {"candidates":1,"sent":0,"skipped":1}` + `weighInReminderPush
  {"candidates":1,"sent":0,"skipped":1}`. So the pipeline works: cron fires → `pushCapableUids`
  found the 1 real subscription (Kevin's device from the S90 test) → the client-role gate correctly
  SKIPPED it (Kevin = head_trainer). The ONLY unproven leaf is the final
  `webpush.sendNotification` to a device, which needs a **push-subscribed CLIENT** as a candidate =
  the standing S90 device test (install PWA on a client acct → "Push to this device" ON → force-run
  or wait for 3pm ET → expect `sent:1` + a real notification).
  Force-run cmd: `gcloud scheduler jobs run firebase-schedule-foodReminderPush-us-central1
  --project calorieiq-29762 --location us-central1` (gcloud needs periodic interactive reauth:
  `gcloud auth login --no-launch-browser`). Logs: `gcloud logging read '...service_name=
  "foodreminderpush"' --freshness=10m` (firebase functions:log lags more).
- **Per-client default plan view** (`def17ea`) — queue small item. `data.planViewDefault`
  ('simple'|'detailed'); trainer viewing a REMOTE client's Full Plan gets a "Client's default
  view" chip row under the Simple|Detailed pill (`onSetPlanViewDefault` passed only when
  `activeRemoteUid`). Precedence: client's own localStorage choice > trainer-set default > role
  default (clients Simple). Verified: set Detailed → survived full reload via the app's own read
  path → restored to Simple.

### ⏭️ Kevin's queue (what's left — the autonomous items are DONE)
- **Stripe LIVE-mode swap** — BLOCKED ON KEVIN: real-card smoke test + attorney pass (ToS/Privacy).
- **Acuity sessions + auto-charge** — BLOCKED ON KEVIN: his Acuity API key + User ID
  (`docs/SESSIONS-BILLING-PLAN.md`).
- Small: grow `functions/knowledge.js` (content — get Kevin's direction); swipe-left-to-delete on
  food rows (deliberately SKIPPED in S95, don't build unasked).
- Verify the reminder crons fired (above) + Kevin device-tests a real push receipt.

---

## ⚡⚡⚡ S95 (Jul 16-17): automations fixed, Trainerize sync fixed, food library, light/dark, pace picker
_All pushed (`origin/main` @ `96f3ed5`) + deployed + live on glidna.com. Firebase `calorieiq-29762`;
model `claude-sonnet-4-6`; admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`._

### ~~⏭️ START HERE — the dashboard restructure Kevin asked for~~ ✅ DONE IN S96 (see above)
Kevin's ask, in his words: make "Today's Target" and "Logged So Far" more editable, and collapse the
Quick Log section into the tiles. **DONE: the pace picker + the ring's deficit line (`96f3ed5`).
NOT DONE: the layout moves.** I ran out of context; nothing is half-edited (working tree clean) —
the moves below simply haven't been started.

Remaining, all inside `DailyDashboard` (App.jsx ~L9300–9700), driven by the existing
`expandedStat` tile-panel pattern (tiles ~L9328, panels ~L9399):
1. **"Logged So Far" panel** (`expandedStat === "logged"`, ~L9566) — move IN: the "Add Calories" row
   + its macro rows (currently the Quick Log section ~L9660), the **Macros & Micros** dropdown, and
   **`<MealLog>`** (~L9533 in the sec-title flow). The panel ALREADY has a "Quick Add" calories input
   (~L9582) — reconcile, don't duplicate.
2. **"oz Water" tile panel** — move the water row out of Quick Log into it; the tile becomes the only
   place water is entered.
3. **NEW big "Today's Weight" tile** under Workout Burn + oz Water — same target as the Quick Log
   weight row: opens `MeasurementsModal` (weight + body fat + measurements). NOTE the dash-cta-grid is
   `1fr 1fr`; a full-width tile needs `gridColumn:"1 / -1"`.
4. **"Workout Burn" panel** — move "Today's Workout" into it (tracker line already renders there).
5. **DELETE the Quick Log section** once 1–4 are moved (`<div className="sec-title">Quick Log</div>`
   ~L9660). Kevin's framing: "see if it looks cleaner using just the clickable tiles".
Watch: `calDraft`/`commitCal`/`LogBtn`/`showMacros`/`weightDraft` live in DailyDashboard state and are
shared by the rows being moved — move the JSX, not the state. **`.page-transition` transform trap
still applies to any new fixed overlay (portal it).**

### ✅ What S95 shipped (all verified live, in order)
- **Automations (workflow Phase 2) — the UI already existed since S93; the BLOCKER was gating** (`0949640`).
  `capFor` checked `profile.role === "admin"`, which is NEVER true (createProfile only writes
  client/head_trainer; admin lives in a custom CLAIM) → Kevin saw the "upgrade to Elite" upsell on his
  own app. Now UID-based via new exported `aichat.isAdminUid()`. Same dead check fixed in
  `requestBudgetBoost`. **Also fixed: hour-0 scheduling** — `Number(hour) || 8` treated midnight UTC as
  missing, so an 8:00 PM ET automation fired at 4:00 AM. E2E-verified: created via UI at 8PM → stored
  hour 0 → dispatcher force-run → real tool-backed AI answer → notification feed → rescheduled to 8PM.
- **Trainerize auto-sync was a NO-OP on Kevin's account** (`139f7f7`) — logged "no imported Trainerize
  clients in the index" every 30 min for as long as logs go back. It built its client list ONLY from
  local profiles with `index.trainerizeId`, but LINKING a client deletes the local profile
  (`linkPlan`→`removeLocalProfileById`), so linking silently removed them from sync forever;
  `caliq-tz-links` (S93) was never consulted. Fixed via shared `syncTargetIds()` = imported ∪ linked.
  Added **manual "Sync now"** (`trainerizeImport {mode:"sync"}`, 14d window) on BOTH the dashboard
  tracker card and trainer home, owner-gated. **Kevin confirmed: "yes the sync works."**
  Workout Burn tile stays TODAY-only (never misreport today's effort); its expanded breakdown now shows
  the last real reading labeled "yesterday (today hasn't synced)".
- **Food library** (`4636e28`) — new `FoodLibrary` page (Meals header "Library" + per-meal "Previously
  logged & saved"; the chip pile-up is gone). Saved = **`caliq-foods-saved` on the USER's account**
  (follows them across plans); recents stay **plan-scoped** (`caliq-foods-{planId}`) so a trainer sees
  the CLIENT's recents. One identity (base name + meal type) → no duplicates at two servings; re-logging
  updates the amount in place, in the saved copy too. Tap = log with last serving. Rows show macros.
  Whole logged row is now the edit target; move/delete are ~40px. Kept tap-to-move over drag-and-drop
  (Kevin's call — DnD needs hand-rolled pointer dragging on touch).
- **Light/dark/auto theme** (`7f26fce`) — ≡ → Appearance. **Default dark**, so nobody's app changes.
  Per-device localStorage (`glidna-theme`) because it must resolve before first paint + before sign-in.
  Both token systems flip together: `themes.css [data-theme="light"]` (Tailwind `--color-*`) AND
  `App.jsx :root[data-theme="light"]` (old `--bg/--text/--accent`, which drive in-plan + inline styles).
  34 hardcoded `data-theme="pro"` wrappers removed → everything inherits from `<html>`.
- **Selectable weekly pace** (`96f3ed5`) — `data.weeklyRate` 0/0.5/1/2 lb/wk → 0/250/500/1000 cal/day.
  Replaced a hardcoded −500 in **8 places + the server**. Unset = 1 lb/wk = today's behavior.
  Ring shows "CAL REMAINING" + "−N deficit" (vs MAINTENANCE, hidden until something's logged).
  "Count workout burn" writes the EXISTING `data.deficitMode` (one setting, two places).

### S95 gotchas (don't re-learn)
- **`Number(null) === 0` bit us TWICE** (automation hour, weekly rate). Where **0 is a legitimate
  value**, `Number(x) || default` is a trap — and `null` is what this codebase passes for "reset to
  auto" (`onSetMacroTargets`). Screen `null`/`undefined`/`""` BEFORE trusting a 0.
- **`{0 && <div/>}` renders a literal "0" in JSX.** `hasMacros = a || b || c` is the NUMBER 0 for a
  macro-less food. Bit the food library; the same latent bug existed in the meal row.
- **Icon returns null for unknown names** → a typo'd glyph renders an invisible button, no error.
  Check `src/icons.jsx` before using a name. (Added S95: book, star, trash, sun, phone.)
- **const TDZ blanks the whole screen**: `todayDeficit` read `logged` above its declaration → white
  page, build passed. Only driving the app catches this class.
- **Firebase + gcloud creds expire constantly** — `npx firebase-tools login --reauth --no-localhost`
  (code-paste; the localhost callback fails). `firebase functions:log` lags MINUTES-to-hours; verify via
  the app's own read path (or the doc) instead of waiting on logs.
- Deploy ALL 4 AI fns when `aitools.js` changes (aiChat/aiChatStream/logMeal/setWorkoutSchedule).
- **AuthGate (login) has its own hardcoded light palette** and never used tokens → stays light in both
  themes. Pre-existing; would need its own pass.
- Vercel lags ~20-30s: poll `curl -s https://glidna.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'` until the
  hash changes before telling Kevin to act. The FIRST poll can hit a stale CDN edge — re-check before
  concluding something didn't ship.

### Test residue / notes
- `trainer.uitest` lost **1 local plan + 1 simulation** to a bad delete-test selector of mine (portal
  ordering grabbed the first "Delete" on the page — a plan card's). Test account only, unrecoverable.
- Casey's plan weeklyRate was set to 2 lb/wk during testing and **restored to 1**.
- Theme verified on prod: no stored pref → `data-theme="pro"`, identical to before.

### ⏭️ Kevin's queue after the restructure
- **FCM push delivery** (he said "next we will do FMC" = FCM) — Notification Center + Web Push exist (S90).
- Stripe LIVE-mode swap (real-card smoke + attorney pass on ToS/Privacy).
- Acuity session scheduling + auto-charge (`docs/SESSIONS-BILLING-PLAN.md`; needs his API key + User ID).
- Small: default NEW clients to Simple view; per-client default view; grow `functions/knowledge.js`;
  swipe-left-to-delete on food rows (deliberately skipped in S95).

---

## ⚡⚡⚡ S94 (Jul 15 — MARATHON): food-logging UX overhaul, body-fat/measurements hub, AI micros
_Everything below is committed + pushed (`origin/main` clean at `caa5ac5`) + deployed. Firebase
`calorieiq-29762`; domain **glidna.com**; model `claude-sonnet-4-6`; admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`.
Long session — a LOT shipped. Every item below is LIVE + verified in-app on the test trainer
(`trainer.uitest` → Casey's shared plan)._

### ✅ What S94 shipped (all committed `e19d34c`…`caa5ac5`, deployed)
- **Ask Glidna warmer** (`e19d34c`): loosened both system prompts' formatting rules (natural prose,
  match length to the question, light markdown OK), warmed the tone, `MAX_TOKENS` 1024→1800. Deployed
  aiChat + aiChatStream. Kevin approved the tone; said don't constrain further.
- **Macro targets by % ** (`cc387bc`): grams⇄% toggle + recommended splits (bodyweight/balanced/goal),
  stored as `data.macroTargets` grams. In DailyDashboard.
- **Food-logging overhaul** (`b63280b`, `3e52905`): new **`FoodServingModal`** bottom-sheet — tap a search
  result → pick serving (units: serving/g/oz/lb/kg exact + cup/tbsp/tsp/floz "approx", DEFAULTS to exact) →
  fine-tune cal/macros → Add. Editing a logged food (✎) reopens it with the serving restored (rescales).
  Search box **auto-focuses**; **no negative servings**; multi-highlight bug gone. **Recent foods scoped
  per-meal + deduped by base name** (last amount wins; per-client; trainer sees them; deletable via "Edit").
  **AI estimate** (`estimateFood`, now returns `grams`+`unit`) opens the SAME serving popup (type exact ml/g,
  switch units). **Editable "Today's Target"** — tap it → "Set your own target" (`data.calorieTarget`,
  overrides calc + tracker everywhere via `computeClientCalories`).
- **FatSecret is PRIMARY** (`e5d47a6`…`a3f10d4`): searchFoods queries FatSecret + USDA in parallel, FatSecret
  ranks first (`_foodScore` fatsecret +55), OFF is now fallback. **Realistic servings**: FatSecret `v3`
  search is **premier-scope-gated** (returns error as HTTP-200) — so we use **`food.get.v4`** (Basic-tier ✓)
  lazily on tap for its real household servings + micros. **USDA generic foods** (`dde6370`): search has no
  portions, so a lazy **`fetchUsdaPortion(fdcId)`** hits USDA's detail endpoint (`/fdc/v1/food/{id}`, CORS-ok)
  for `foodPortions` → opens at "1 cup"/"1 slice" not 100 g. Both raced vs 2.5s timeout, session-cached,
  graceful 100 g fallback.
- **Meal-log batch** (`fcb80e1`): **move a logged item between meals** (tap the ⇄ icon → pick section);
  **copy a previous day's meal** ("Copy a previous <meal>" → sheet of recent days → tap to copy in; new
  `onAddMeals` batch handler); **MacroFactor-style micro BARS** (grouped by family, color-coded: B-vits red,
  C purple, minerals green, fat-vits amber, fiber/fats blue); deletable recent chips. New icons move/copy.
- **AI meals now log MICRONUTRIENTS** (`2cfb573`): `micros` object on propose_meal/log_meal/log_meals schemas
  (keys/units mirror frontend `MICRO_DEFS`) + `sanitizeMicros` + prompt says ALWAYS estimate them. Verified:
  AI-logged salted chips → daily bars showed Sodium 149 mg (was ~0). **Per-meal section view**: meal log is
  `viewMode` null|section|"all" — pill opens ONE meal, header opens all. Now **collapsed on load** (`caa5ac5`,
  removed the auto-expand).
- **Log-confirmation feedback** (`d3e4a48`): water/weight/cal quick-logs clear the input, grey the button to
  "Logged ✓" ~1.1s, and pop a bottom toast (portal). `lastCommit` ref stops the draft-sync re-populating.
- **Body-fat & measurements HUB** (`520a101`, `b05000b`): opens from **"Today's Weight"** (+ a "Body fat % &
  measurements" link) on the dashboard, now wired into DailyDashboard too. Adds: **manual scale/scanner BF %
  box** (`bodyFatManual`), **JP3 skinfold calipers** (`caliperBF`; male chest/abdomen/thigh, female
  triceps/suprailiac/thigh — non-sensitive), **weight logger in the modal**. Effective BF = **scale > caliper
  > tape** (Bailey/Navy). **"Where to measure?"** guidance per site + technique; **LIVE auto-calc** as you type
  (drafts-only `measurementMetrics` preview); **every individual number** (each caliper site + tape site + BF%)
  is a chartable metric in the side-scrolling `ProgressChart`, saved per date.
- **Workout Burn defaults to tracker** (`bc7b584`): tile shows `dailyLog.wearable.active` (⌚ + "· tracker")
  when today's tracker synced, else the scheduled-workout estimate. Target math unchanged (still `wearableAdjust`).
- **Macros & Micros dropdown** (`bc7b584`): the "Macro Targets" card is now a collapsible dropdown holding the
  macro bars + edit AND the day's micro bars; the meal-log micro roll-up is hidden on the dashboard
  (`hideMicros` prop) but kept in the calendar Day view.

### S94 gotchas (IMPORTANT — don't re-learn these)
- **`foods.search.v3` needs PREMIER scope** — Basic tier gets `{"error":{"code":14,...}}` as **HTTP 200**, so
  status-code checks miss it. Use **`food.get.v4`** for FatSecret detail (Basic ✓). Proxy (`proxy/server.js`)
  falls back v3→v1 by inspecting the BODY; has a **`/food?id=`** endpoint now.
- **The FatSecret proxy VM is `fatsecret-proxy` in ZONE `us-west1-a`** (NOT us-central1-a — the deploy.sh
  default is stale). Static IP `35.247.125.182`. To update: `gcloud compute scp proxy/server.js
  fatsecret-proxy:/tmp/server.js --zone us-west1-a` then ssh `sudo cp … && sudo systemctl restart
  fatsecret-proxy`. **gcloud token expired mid-session → Kevin ran `gcloud auth login --no-launch-browser`**
  (the browser-callback flow fails; code-paste works). gcloud lives at `~/google-cloud-sdk`, `CLOUDSDK_PYTHON=$(uv python find 3.12)`.
- **`VITE_USDA_API_KEY` is ALREADY set in Vercel (Preview+Production, ~14d old)** — prod uses the real key.
  It's marked **"Sensitive"**, so Vercel WON'T let it be added to the **Development** env (that's expected, not
  a bug). Local `npm run dev` therefore falls back to **DEMO_KEY** (30/hr/IP shared — I hit its limit while
  testing; USDA 429s drop CORS headers → "Failed to fetch" locally). To test USDA locally, drop the key in
  `.env.local`. Live app is unaffected.
- **Deploy ALL 4 AI fns when `functions/aitools.js` changes** (aiChat, aiChatStream, logMeal, setWorkoutSchedule);
  the system prompt lives in `aichat.js` (aiChat + aiChatStream only). `estimateFood` is separate. `foodSearch`
  is separate. Backtick chars inside the `aichat.js` prompt template literal break it (bit me once).
- **Vercel frontend deploy lags ~30s** — poll `curl -s https://glidna.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'`
  until the bundle hash changes before telling Kevin to act.

### Test-account residue (test data — clearable)
- Casey (`client.uitest`) has: a real **weigh-in 183 lbs** (S94k weight-logger test), 2 tape-measurement
  entries (Jul 9/11 from S92), water 40 oz today. Harmless test data.

### ⏭️ NEXT (Kevin's standing queue — unchanged from S93, none started in S94)
- **Stripe LIVE-mode swap** (prices decided/built in test mode; needs live key + live webhook + attorney pass).
- **Acuity session scheduling + auto-charge** (fully specced in `docs/SESSIONS-BILLING-PLAN.md`; needs Kevin's
  Acuity API key + User ID → live dry-run like Trainerize).
- **Workflow Phase 2** (Automations UI + E2E; backend deployed S92).
- **Push-notification delivery (FCM)**, **client→trainer requests**.
- Small: default NEW clients to Simple view; per-client default view; grow `functions/knowledge.js`.

---

## ⚡⚡⚡ S93 (Jul 14 — MARATHON): food DB, FatSecret LIVE, AI fixes, Trainerize linked-client sync
_Everything below is committed + pushed (`origin/main` clean at `d87cb4f`) + deployed. Firebase
`calorieiq-29762`; domain **glidna.com**; model `claude-sonnet-4-6`; admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`._

### ⏭️ NEXT SESSION — two tasks Kevin queued (context ran out before starting them)
1. **Make Ask Glidna feel like the Claude app (less "robotic/clunky").** The replies feel terse/stiff
   because the system prompts hard-constrain them: `functions/aichat.js` SYSTEM_CLIENT (~L66) +
   SYSTEM_TRAINER (~L86) + the shared appended block both end with *"Keep them short. Use plain text with
   dashes… NO markdown tables/headings/code."* and I added a *"Voice & tone: talk like a calm human, minimal
   exclamation points, no step-narration"* line (~L207). Also `max_tokens: 1024` on every `messages.create`/
   `.stream` (aiChat, aiChatStream, runAssistantTurn) clips longer answers. **Levers:** loosen the formatting
   rules (allow natural prose + light markdown), warm the tone guidance (conversational, not clipped), bump
   max_tokens (e.g. 1500–2000). Keep sonnet (cost). Deploy aiChat + aiChatStream; test iteratively in the app
   (streaming smoother `makeStreamSmoother` already gives Claude-like typing). Don't lose the good S93 wins
   (it now actually CALLS log_meals for batches + doesn't over-narrate — keep those, just make prose warmer).
2. **Macro targets by PERCENTAGE.** Kevin wants the macro card to (a) show a RECOMMENDED protein/carb/fat
   *percentage* split from the person's stats (height/age/weight/gender — really goal+bodyweight; height/age/
   gender feed the calorie target via BMR, so the "%" is a sensible default split he can lean on), and (b) let
   the user set targets EITHER by manual grams (exists) OR by entering %s that convert to grams (% × calorie
   target ÷ 4 for P/C, ÷ 9 for F). Today (App.jsx DailyDashboard macro card ~L8170): protein = `proteinBasisOf`
   × weight (1.0/0.7 chips), fat = 28% cal, carbs = remainder; custom `data.macroTargets` (grams) overrides;
   "✎ Edit targets" + "Reset to auto" already there. **Add a %-mode** to that card (a grams⇄% toggle):
   show the current split as %s, let them edit %s (auto-normalize to 100, convert to grams against the calorie
   target), store as `data.macroTargets` grams (or add `data.macroPct`). Keep it consistent across DailyDashboard
   + Results SummaryTab (~L4043) + NutrientsTab (~L5291) via the shared helpers. Confirm with Kevin exactly what
   "% based on height/age/weight/gender" should recommend (a fixed sensible split like 30P/40C/30F, or
   goal-derived) — he may just want a good default shown + fully editable by % or grams.

### What S93 shipped (all LIVE + verified)
- **FatSecret food DB is LIVE** via a fixed-IP proxy: `proxy/` (tiny Node relay on a GCE e2-micro, static IP
  `35.247.125.182`, whitelisted in FatSecret; ~$4/mo for the IP). `functions/foodsearch.js` = the `foodSearch`
  callable (Firebase-auth'd) → proxy → FatSecret; **FALLBACK-ONLY** (searchFoods in App.jsx only calls it when
  USDA/OFF come up short) + every FatSecret result FLAGGED. Secrets `FATSECRET_CLIENT_ID/SECRET/PROXY_URL/
  PROXY_SECRET`. gcloud is now installed at `~/google-cloud-sdk` + authed as kevin@ (owner) — can drive GCE/
  Firestore-REST directly. **Rotate FatSecret secret when convenient** (it's in this chat log; harmless — IP-gated).
- **Food UX:** search ranking rewritten (generic whole-foods rank above branded oddities — "egg" no longer →
  Mars chocolate egg; USDA pulls Foundation/SR Legacy + Branded, ranked by name+brand match); **realistic
  serving sizes** (USDA servingSize/householdServingFullText + OFF serving_quantity + FatSecret per-serving
  "1 scoop"/"1 container" with a Servings stepper instead of a flat 100g); **brand shown under the food name**
  (e.g. "General Mills"); **search is the default** when adding food; **edit a logged food via library search**
  (not just retype); **AI-estimate servings stepper**; macro input boxes now **labeled** Protein/Carbs/Fat.
- **Protein basis = user choice** (1 g/lb vs 0.7 g/lb chips on the macro card; `data.proteinPerLb`; consistent
  across dashboard + Results via `proteinBasisOf`). **Importer sanity-checks** an implausible Trainerize macro
  goal (drops protein >1.6 g/lb etc. so a stale 280g goal doesn't show).
- **Calorie ring goes NEGATIVE + RED** when over target ("-431 CAL OVER").
- **AI-logged meals were invisible** (lowercase "breakfast" ≠ section "Breakfast") — sections now match
  case-insensitively + "Other" is a true catch-all; meal list auto-opens when a meal is added.
- **AI batch logging FIXED** (was narrating "logging all 8!" without calling the tool): the AI now actually
  emits log_meal for every item in one turn (prompt: "the list IS the go-ahead; text ≠ action; MUST call the
  tool"); MAX_TOOL_ROUNDS 5→10. New **`remove_meal`** tool (undo/correct by name). **AI remembers the active
  client/plan per conversation** (setupChat injects a "reuse this id, don't re-list" block from a relayed
  `activeTarget`; runToolRound captures it; frontend holds it in a ref, resets on new/switched chat) — verified
  it stops re-running list_clients every message. **Admin (Kevin's UID) = unlimited AI budget** for testing.
- **Passkeys** now allow `www.glidna.com` too (rpID = "glidna.com" for both apex+www) — retry Face ID if that
  was the block.
- **Trainerize linked-client sync (the big one):** a Trainerize client linked to a real Glide account now syncs
  straight into THAT account (watch/wearable + meals + workouts), not a dead local profile. `functions/
  trainerize.js`: `runImport` reads `caliq-tz-links` {trainerizeId: clientUid} and routes each client via a new
  `applySnapshotAndSyncs` helper (linked → client's active plan; else → local ctz profile). App.jsx `linkPlan`
  now (1) records the mapping **FIRST** (before any write, so a partial link self-heals via auto-sync),
  (2) migrates/merges the imported day-logs incl. wearable into the client, (3) kicks an immediate
  `trainerizeImport({clientIds:[tzId]})`. The picker marks linked clients as already-imported. **Verified live:
  Kev Cam's 45 days of Garmin data now in the client account; tracker card shows.** ⚠️ Tracker card = TODAY's
  wearable only (Garmin→Trainerize lags ~a day; use Calendar Day view for past days). Auto-sync is ON.

### S93 gotchas
- **Deploy ALL 4 AI fns when aitools.js changes** (aiChat/aiChatStream/logMeal/setWorkoutSchedule); prompt lives
  in aichat.js (aiChat+aiChatStream only). Trainerize.js → trainerizeImport+trainerizeAutoSync. foodsearch → foodSearch.
- **Vercel frontend deploy lags the functions deploy by ~1-2 min** — this bit Kevin twice (he re-linked before
  the app finished deploying → old code ran). After pushing, poll `curl -s https://glidna.com/ | grep index-*.js`
  until the bundle hash changes before telling him to act on a frontend change.
- Verifying signed-in: the food-search MealLog UI is only on the in-plan Daily Dashboard (trainer → open a plan),
  NOT ClientHome (simple quick-log). dev-verify launch config (port 5199 `--strictPort`) added/removed per test.

## ⚡⚡ S92 (Jul 12 — MARATHON): trials, tiers, Ultra, workflow engine, Pro retired, sessions spec
_Everything below is committed + pushed (`origin/main` clean) + deployed. Firebase `calorieiq-29762`;
domain **glidna.com**; model `claude-sonnet-4-6`. Read the relevant docs/*.md for depth._

### AI budgets / trials (all LIVE)
- **Trial budgets:** client **50k** (was 10k); **trainer 200k** (new `trainerTrial` tier — a trainer
  works with clients day one, so they get the full Coach-Elite-level experience during the 30-day
  trial and don't hit a wall). `tierFor` in aichat.js returns `trainerTrial` for a head/sub_trainer on
  `subscriptionStatus:"trial"`; `trialExpiredFor` still locks the AI at trial end.
- **Coach base 60k→100k**; **prefix shrink ~17–18%** (client 8.9k→7.4k, trainer 12.3k→10.2k — measured;
  the rest is irreducible tool-name/param structure, so not the hoped 35%). Portion rigor + invisible-
  calorie awareness are now DEFAULT in the prompt (cheap accuracy, everyone).
- **BUDGETS (aichat.js):** trial 50k · client 25k · assisted 40k · trainer 100k · **trainerTrial 200k** ·
  clientMax 150k · trainerMax 200k · clientUltra 250k · trainerUltra 400k.

### Reverse trial + card option (LIVE) — Kevin chose this over card-upfront-only
- No card to start → full AI 30 days → locks to free tier at expiry (basics always free). Fairness:
  `createCheckoutSession` sets `subscription_data.trial_end` so upgrading EARLY doesn't waste free days.
  Reverse-trial messaging on the SideMenu banner + chat lock ("Full AI free for N days · add a card
  anytime"). **`trialReminders`** scheduled fn (daily) emails a nudge 1–3 days out + at expiry.
  ToS §3 updated with the auto-renewal disclosure. **Still: Kevin's real-card smoke test + attorney pass.**

### Tier rename + Ultra tier (LIVE) — display only, internal keys unchanged
- **Max→Elite, Ultra→Apex** (Premium→Elite→Apex; Coach→Coach Elite→Coach Apex). billing.js CATALOG
  names + App.jsx PlanPicker/FeatureMatrix/upsell/banner. Internal `tier`/BUDGETS keys stay (max/ultra).
- **Ultra tier (data-triggered, NOT on the public page):** Coach Ultra 400k **$129/mo**, Client Ultra
  250k **$49.99/mo**. Surfaced via the boost upsell: `requestBudgetBoost` returns `suggestUltra:true` on
  a Max user's **3rd cumulative boost + every 3rd after** (`aiUsage/meta.boostCount`); AIChatPanel shows
  a role-aware Ultra card → Checkout `{tier:"ultra"}`. Live-checkout page = part of the pending smoke test.

### Pro "precise food data" RETIRED (data-driven) — see docs/AI-ACCURACY.md
- Tested: the FREE estimate is ~98% accurate on branded/store-brand/restaurant foods; the food DB was
  absent (Chipotle NOT in DB), crowd-sourced, or LESS accurate (Kirkland DB 184 vs estimate 190 vs
  label 190), at 2–2.5× tokens. So `search_food` is retired (filtered out; tool def kept dead), the
  "Precision tracking" toggle removed, **portion + invisible-calorie rigor now default for all**.
  Barcode stays the exact path. **Do NOT build the restaurant-menu integration** (model already wins).

### Body measurements (LIVE) — docs/METRICS-PLAN.md
- Tape → body-fat (Covert Bailey + US Navy, no scale), waist-to-height, lean-mass, goal-weight-from-lean-
  mass. `MeasurementsModal` in ClientHome + Results. **Optional "estimate body fat %" toggle** (`data.
  hideBodyFat`) → plain measurement tracker when off. AI `log_measurements`/`get_measurements`.

### Scheduled AI workflow engine — Phase 1 BACKEND deployed (UI = Phase 2 next)
- `functions/workflows.js`: top-level `workflows` collection (**Admin-SDK-only, no rules change**).
  Callables `saveWorkflow` (tier-gated: Elite 1 / Coach Elite 2 / Apex 3 / Coach Apex 5) / `listWorkflows`
  / `toggleWorkflow` / `deleteWorkflow`; **`runDueWorkflows`** onSchedule hourly runs each due automation
  via new `aichat.runAssistantTurn(uid,prompt)` (headless AI turn, metered against the daily budget),
  delivers to the notif feed (`push.appendFeed`). Times UTC in Phase 1. **⚠️ Not E2E-tested — needs an
  Elite+ account (can't grant entitlement from CLI). Phase 2 = the Automations UI + that verification.**

### Session scheduling + auto-charge ("red line") — FULLY SPECCED, docs/SESSIONS-BILLING-PLAN.md
- Kevin's Equinox feature: when a scheduled session's time passes, **pull from the client's package
  first (decrement a credit, no charge); only if 0 credits, auto-charge their saved card**. Decisions:
  **scheduling = Acuity-import first** (native later), **billing = BOTH packs + pay-per-session**,
  **TRAINER-SET PRICING** (Shopify-for-trainers; Acuity appointment-type price flows through; Connect for
  multi-tenant). **Acuity API VERIFIED** (Basic auth UserID:APIKey; GET /appointments w/ price/paid/
  noShow; webhooks scheduled/rescheduled/canceled/changed). Settlement is transactional/idempotent
  (`settled` flag). **NEXT: Kevin supplies his Acuity API key + User ID → live dry-run (like Trainerize).**

### Pricing analysis (docs/PRICING.md — lots added)
- Cold-start correction + measured per-message economics (cold ~10–18k budget tokens, warm ~1–2.5k;
  **tier-independent**) + messages-per-tier grid for every tier incl. hypothetical 250–400k trainer caps
  (250–300k safe @ $79; 350–400k needs a higher price / "Coach Ultra"). Enterprise Glide Studio worked
  examples + **hybrid $149/5-seats decision for boutiques**. Per-client-bands **deferred, keep flat**.
  Decision: **client-mgmt AI stays in Coach — rely on the cap** (heavy roster users route to Coach Elite).
  Memory: `ai-token-usage-tracking` (track real aiUsage → raise limits when paid users regularly cap).

### Gotchas reaffirmed this session
- **Deploy ALL 4 AI fns when aitools.js changes** (aiChat/aiChatStream/logMeal/setWorkoutSchedule); the
  system prompt lives in aichat.js (only aiChat/aiChatStream). New fns this session: trialReminders,
  saveWorkflow/listWorkflows/toggleWorkflow/deleteWorkflow/runDueWorkflows.
- Firebase-log flush lags several min (per-message aiUsage). Can't grant entitlements/Elite from CLI (no
  gcloud; rules block owner writes) — so Ultra/workflow/Pro happy-paths need a real Elite+ test account.
- **NEXT SESSION QUEUE:** (1) Kevin's Acuity API creds → dry-run → build sessions feature; (2) workflow
  Phase 2 (Automations UI + E2E); (3) Kevin's standing items — real-card Stripe smoke, attorney pass
  (ToS+Privacy), Trainerize re-import. Product/pricing is deeply worked; execution + real-money testing remain.

## ⚡ S91b (Jul 11): AI chat polish + an OPEN pricing decision to resume
_(↑ The "OPEN DECISION" below is RESOLVED in S92: Coach base bumped 60k→100k; the efficiency/tool-result
truncation fix was deferred per Kevin's quality concern; Claude-Pro framing added to docs/PRICING.md.)_
- **Smooth typewriter streaming SHIPPED** (`makeStreamSmoother` in App.jsx): streamed replies
  reveal at a steady ~1000 cps via requestAnimationFrame instead of jumpy network bursts.
  Robustness: rAF pauses on a backgrounded tab, so the wait races a 1500ms timeout + force-stop
  so a stalled frame can never hang `busy` or revert text. Also shipped earlier same session:
  animated typing dots (`.glidna-typing`, replaced static "Thinking…"). Both prod-verified.
- **⚠️ OPEN DECISION — heavy-trainer AI capacity (Kevin has NOT chosen yet).** Kevin worried a
  20-client trainer using AI daily could hit the 60k Coach cap (real: a roster-wide query is
  ~4-6k tokens, so a heavy day ~70k > 60k). I modeled it: raising base Coach 60k→100k costs us
  ≤$7/mo/heavy-trainer (worst case) and holds 65% margin; the efficiency fix (trim big tool
  results — the S85-deferred "semantic tool-result truncation") makes rosters ~2-3x cheaper with
  no quality loss if done "summary + detail-on-demand". My rec: do BOTH; heavy daily users are
  Coach Max ($79/200k) buyers. **Kevin was still deciding when we paused — resume here: does he
  want the budget bump, the efficiency fix, both, or leave as-is?** (options were laid out via
  AskUserQuestion; his answer was "explain the tradeoffs first," which I did.)
- **Claude-Pro pricing framing (offered, not yet done):** I explained why Glide Max stays $29.99
  (not $20 "unlimited") — Anthropic itself throttles Pro by messages, never sells tokens; our
  caching makes a message ~1¢ so ~100/day at $29.99 keeps 50-85% margin. **Offered to add this
  framing to docs/PRICING.md as marketing/objection-handling ammo — Kevin didn't answer before
  wrap. Ask if he wants it.** Model pricing CONFIRMED current via claude-api skill: Sonnet tier
  = $3/M in, $15/M out (matches PRICING.md).

## ⚡ S91 (Jul 9): NOTES SHIPPED (see docs/NOTES-PLAN.md header) + Android scroll root-caused
- **Notes LIVE**: privkv owner-only store (rules published, 96/96 tests), NotesPanel ×3
  contexts, client/trainer entries, AI list/create/update_note (privacy invariant in code).
  Prod-verified: trainer 403 on client privkv; AI appends, no dupes.
- **Android scroll freeze root-caused** (S90b): html+body were BOTH scroll containers since
  day 1; overscroll-behavior blocked the chain → body now overflow-x:clip only, html default.
  useBodyScrollLock is ref-counted; the in-flow calendar no longer locks.
- **Queue now:** Kevin's three (real-card smoke · attorney pass ToS+Privacy · Trainerize
  re-import) → then native-app decision / small-fry (Simple Daily Dashboard, custom exercises
  per-person, in-app account deletion). Product backlog is essentially CLEAR.

## ✅ CUSTOM DOMAIN LIVE: **glidna.com** (S90, Jul 8) — rename sweep is the NEXT SESSION
Kevin chose **Glidna** (slydra.com turned out to be in redemption; glidna.com+.app were clean)
and bought BOTH via Vercel (~$11.25/yr each, auto-DNS). DONE: domains attached to the project
(www + glidna.app 308→apex), Firebase Auth authorizedDomains updated via API, ALLOWED_ORIGINS
(billing + webauthn) lead with glidna.com (legacy vercel.app kept during transition),
invite-email links + OG meta → glidna.com. VERIFIED: app serves on glidna.com, sign-in works,
live checkout returns to glidna.com. **⚠️ Passkeys are domain-bound: Kevin re-registers
Face ID on glidna.com (≡ → Set up Face ID), old-domain passkeys keep working there only.**
**NEXT SESSION = the Glide → Glidna RENAME SWEEP** (same shape as S53's CalorieIQ→Glide):
BrandLogo/wordmark (decide the two-tone split: GLID|NA or GLI|DNA), every UI string, AuthGate,
page title, package.json, share-card + OG card text (`npm run gen:og`) + icons if lettering
changes (G glyph still fits!), manifest name, docs. Then: notification-feed bell (queued),
Kevin's real-card smoke test, ToS items.

## ⚡ S90 LATE-SESSION AUTONOMOUS RUN (Kevin away): the whole "ready to build" backlog SHIPPED
1. **In-app messaging** — LIVE (rules published, 87/87 tests; see docs/MESSAGING-PLAN.md header).
2. **Push delivery (Web Push/VAPID)** — LIVE: `functions/push.js` (savePushSub/removePushSub +
   onDmCreated + onTrainerRequestWritten triggers, notif-pref gated, 410-pruned), sw.js push +
   notificationclick handlers, "Push to this device" toggle in the Notification Center.
   VAPID private key = Secret Manager `VAPID_PRIVATE_KEY`; public key in src/push.js.
   **⚠️ KEVIN DEVICE TEST**: ≡ → Notifications → "Push to this device" ON (on the installed PWA),
   then have someone DM you / send a to-do with the app closed — headless E2E verified the whole
   pipeline except the final device receipt. iPhone needs the home-screen install first.
3. **Client→trainer requests** — LIVE: `sendTrainerRequest` callable (link-verified, transactional,
   spam-capped) → trainer's kv `caliq-inbox`; "Ask your trainer" composer on the client role panel;
   live "Client Requests" inbox card on the trainer home (Done/Dismiss/Clear); `clientRequests`
   notif type + push. E2E: request appeared live on the trainer dashboard, full lifecycle.
4. **Data-integrity hardening** — kvTxnJSON transactions on all append-style AI writes (meals,
   history, requests; prod-verified: 2 concurrent logMeal calls both survived) + plan-delete now
   cleans orphaned day-log/history/foods docs. Still deferred: AI-budget pre-reserve,
   assignedTrainerId consent (needs a joinTrainer callable — design), ProfileCard caret jump.
**NEXT: Stripe live-mode swap + custom-domain/name decision (Kevin's ordering).** Also pending
Kevin: re-import chosen Trainerize clients (picker), admin-dashboard look, ~~Android icon~~ ✓ (confirmed good).
**✅ DONE Jul 9 (S90b): the bell, the Privacy Policy, and the goal-aware Simple view** —
bell = fixed header button (mirrors hamburger) + NotifFeed overlay + kv `caliq-notif-feed`
written by push.js appendFeed (one source of truth with push; E2E: live badge → feed → clear).
privacy.html linked from ToS §6 + SideMenu. Simple view: clients DEFAULT to Simple (trainers
Detailed), `data.fitnessGoal` chooser (lose/build/health) reshapes target + copy, **1,200 hard
floor** pivots advice to training-over-restriction. Follow-ups: teach the AI tools fitnessGoal
(set_personal_info/get_profile), feed entries for non-push events (joins/leaves).
~~QUEUED AFTER STRIPE (Kevin's yes, Jul 8): the notification-FEED bell.~~ A bell icon in the
header opening a chronological feed of everything since last look — new messages, completed
to-dos, client requests, client joins/leaves, boost grants (admin) — tap-to-jump, per-type
rows respect the existing notifPrefs, unseen-count badge on the bell. Design note: back it
with a per-user kv doc (`caliq-notif-feed`, capped ~50, written by the same server paths that
already send pushes — sendPushTo callers — so feed + push stay one source of truth) plus
client-side writers for non-push events; live via the owner's kv onSnapshot like caliq-inbox.

_Updated end of **Session 89 (a/b/c — one marathon)**: wearable-adjusted targets, Trainerize workout
sync, STRIPE BILLING v1 live in test mode, trial enforcement, AI meal-tracker estimates, the full
pricing/cost analysis, and the GitHub-key security incident closed. Read "⏭️ NEXT SESSION" below
FIRST, then `CLAUDE.md` (S89/S89b/S89c entries). Everything is committed, pushed, and deployed.
Firebase project `calorieiq-29762`; prod URL `calorieiq-jet.vercel.app`. AI model `claude-sonnet-4-6`.
**STANDING RULE (Kevin): new features use `src/icons.jsx` house icons — never emoji.**_

---

## ✅ STRIPE IS LIVE (S90, Jul 8) — real money enabled
Kevin activated his existing Smooth Training Stripe account (ex-TrueCoach; his own Standard
account — TrueCoach access revoked, bank + descriptor checked). Live setup fully scripted:
8 live prices by lookup_key, live webhook `we_1Tr5Vu…` (whsec piped straight to Secret
Manager), **portal config `bpc_1Tr5VX…`** = cancel at period end + SELF-SERVE PLAN SWITCHING
(upgrades prorated now, downgrades at renewal — Kevin's fairness call). 3 billing fns
redeployed; VERIFIED: real `cs_live_` checkout URL generated. **Enterprise "let's talk"
lead line live in PlanPicker.**
**REMAINING (Kevin):** (1) one real-card smoke test — Upgrade on a test account, see the
charge, cancel via Manage subscription (portal now shows plan-switch options too), refund
from the Stripe dashboard; (2) liability: fair-use clause in ToS + attorney pass BEFORE
marketing the paid tiers. NOTE: when the custom domain lands, add it to billing.js
ALLOWED_ORIGINS (+ webauthn ALLOWED_ORIGINS + api/invite links + Stripe checkout return).

## ⏭️ (superseded) NEXT SESSION — start here: go LIVE with Stripe (pricing is DECIDED & BUILT)

**Kevin decided (Jul 7): "run with all of these" — the full recommended menu.** It is IMPLEMENTED
and E2E-VERIFIED in test mode (8/8 checkout sessions audited via the Stripe API; webhook tier
stamping verified; PlanPicker UI verified live):
- **Glide Premium $14.99/mo · $119.99/yr (33% off)** — lookup_keys glide_premium_monthly (price
  TRANSFERRED from the $9.99 placeholder) / glide_premium_annual
- **Glide Max $29.99/mo · $299.99/yr** — clientMax budget 150k tokens/day (~100 conversations)
- **Glide Coach $49/mo · $490/yr** | **Coach Max $79/mo · $790/yr** — trainerMax 200k/day
- Implementation: `CATALOG` in functions/billing.js; checkout takes {plan:{tier:"base"|"max",
  interval:"month"|"year"}} (price always server-side); webhook stamps `profile.subscriptionTier`
  → aichat.js `tierFor()` unlocks the Max budgets; frontend `PlanPicker` (SideMenu banner + chat
  lock card) sells tier+interval. Bundled client seats: direction affirmed, build with the first
  outside trainer. **Max is NEVER "unlimited"** (Kevin's liability call — published allowance).

**What remains for real money (the actual next-session work):**
1. Kevin gets his LIVE Stripe key (dashboard, live mode, sk_live_…) →
   `printf 'sk_live_…' | firebase functions:secrets:set STRIPE_SECRET_KEY --data-file=-`
2. Create the LIVE webhook via the API (same one-command flow as S89b — the create response's
   `secret` goes straight into STRIPE_WEBHOOK_SECRET) → redeploy the 3 billing fns.
3. First real checkout smoke (Kevin, small real card or 100%-off promo code, then refund/cancel).
4. **Liability hygiene (before/at launch):** ~~allowances disclosed on the pricing page~~ (DONE S90 —
   published in the FeatureMatrix grid), fair-use clause in the ToS, no "unlimited" anywhere in
   marketing, attorney pass on the ToS.
5. **Stripe customer-portal configuration (Kevin's ask, S90): enable PLAN SWITCHING** so subscribers
   can downgrade/upgrade between the 4 prices themselves (cancel already works in the default portal).
   One API call per mode: create/update a portal configuration with
   `features.subscription_update = { enabled: true, default_allowed_updates: ["price"], products: [the
   2 role products with their monthly+annual prices] }` — do it in test AND live when swapping keys.
5. ~~Offer first: the competitor-pricing deep-research pass~~ **DONE Jul 8** — all anchors
   verified from live vendor pages (see docs/PRICING.md "Competitive anchors — VERIFIED").
   Headline: MFP shipped a READ-ONLY AI "Nutrition Coach" in its $19.99 Premium (~Apr 2026) —
   validates the category; Glide's AI does strictly more at $14.99. Coach $49 flat beats
   TrueCoach ($58/20 clients) and Trainerize (+$20–45 nutrition add-on). Pricing menu stands.

### Also pending / loose ends
- **Verify one auto-sync summary line:** auto-sync is back ON (S89c re-enabled it directly after
  Kevin's toggle tap didn't save) and the scheduler fires every 30 min (confirmed 18:58/19:28 runs
  Jul 7) — but the `trainerizeAutoSync {synced, mealDays, workoutDays}` console line wasn't captured
  yet: `firebase functions:log --only trainerizeAutoSync` next session.
- **GitHub key incident is CLOSED** (redacted, history audited clean, key API-restricted to 6 APIs,
  app verified working, alert dismissed). If Storage or push notifications ever 403 → re-check that
  API on the key's restriction list in Cloud Console.
- After billing goes live, the next big builds: **push-notification delivery** (FCM — Notification
  Center exists, nothing sends), then client→trainer requests; name/custom-domain decision
  (docs/NAMING.md) matters before scale because passkeys are domain-bound.

## ✅ S89c (this conversation): meal-tracker AI estimates + pricing work + security
- **`estimateFood`** callable + "AI estimate" button in `MealLog` — type any food the library
  doesn't have → AI fills calories/macros with an "assumed serving" note (E2E: "chicken burrito
  with rice and beans" → 850 cal / 42p/95c/28f). Budget + trial-gated like the chat, ~1¢/call.
- **docs/PRICING.md** = the canonical cost/pricing model (measured ~1¢/exchange; worst cases
  client $6 / trainer $13 / trial ≤$2 per month; annual tables; Max-tier design + backstops).
- Trial gate + Kevin's own Stripe test purchase verified in prod; all test residue cleaned.

---

## ✅ S89: BOTH queued builds shipped (deployed + E2E-verified)
1. **Wearable burn adjusts the daily target (opt-in).** Plan field `data.wearableAdjust` (default
   false) + `wearableTdee(d, log)` helper (App.jsx, next to `isEatback`): ON + eat-back + day log has
   `wearable.resting > 0` → that day's target = **max(1200, resting + active − 500)** (the watch's
   measured TDEE replaces the estimate AND the scheduled-burn add-back — never added on top).
   Accelerate ignores it by promise; no-tracker days keep normal math. Wired: DailyDashboard target +
   "How Your Target Is Calculated" breakdown + tracker-card note, calendar Day-view per-date target
   (month/week aggregates deliberately stay on the estimate), macros follow automatically. Toggle =
   third row in the Nutrition Approach card (Full Plan → Summary), watch icon, ON/OFF. AI:
   `set_personal_info.wearableAdjust` + `get_profile` + a `get_nutrition_targets` note (all four AI
   fns redeployed). Verified live: injected resting 2100/active 900 → 2,569 → **2,500** on dashboard +
   Day view, breakdown "3,000 − 500", persists, OFF regression clean, AI set it by chat (independently
   confirmed via the app's own read). Test data cleaned up.
2. **Trainerize completed workouts → Glide check-ins (`syncClientWorkouts`).** ONE
   **`calendar/getList`** call/client `{userID, startDate, endDate, unitDistance:"miles",
   unitWeight:"lbs"}` → dated items, `status` "tracked" = completed; types
   `workoutInterval`/`workoutRegular`/`workoutVideo` (title = workout name) + `cardio` (time secs).
   Tracked days → same-date check-in gets `workedOut:true` + a replaceable `"Trainerize: A + B"` notes
   segment — **merge, never wholesale-replace** (hand notes/weights survive; re-sync idempotent —
   verified: re-run marks 0, zero duplicate segments). 90-day cap (`WORKOUT_DAYS_MAX`). Runs inside
   `runImport` → both the picker import AND the 30-min auto-sync carry it; result line + auto-sync log
   report "N workout days". Also fixed: body-stat check-in seeding now merges (was replace-by-date —
   could wipe a workedOut on re-import). E2E: John Mason import → 40 workedOut days with real names;
   temp test-uid gate reverted, admin-only denial re-verified; all test PII deleted (118 log docs).
   Full endpoint contract added to `docs/TRAINERIZE-API.md` (§S89).

---

## ✅ S86 follow-up (same session): everything DEPLOYED + picker E2E-verified
Kevin re-authed → all five pending functions deployed (aiChat/aiChatStream/logMeal/
setWorkoutSchedule/trainerizeImport). **Selective-import picker verified end-to-end** (via a
temporary test-uid gate, reverted + redeployed admin-only after): list shows all 10 with emails,
"Import 2 selected" wrote EXACTLY those 2, reopening showed them "✓ in Glide" with only the 8 new
ones pre-checked. **Header/hamburger PWA bug round 2 (the real root cause):** the app's global
`*{box-sizing:border-box}` means `min-h-[64px]` INCLUDES the safe-area padding — on a notched
iPhone the header only grew to inset+logo, so the border line crossed the fixed hamburger and the
button overlapped the back row. Fix: ALL FIVE headers now use explicit
`minHeight: calc(74px + env(safe-area-inset-top,0px))` (guaranteed 74px band below the notch, line
at inset+74) and the hamburger moved to `top: calc(17px + inset)` (vertically centered in the band,
17px above the line). Remember this for ANY new fixed/header element: min-h classes + safe-area
padding don't compose under border-box.
**Wearables via Trainerize: CONFIRMED with real data.** `healthData/getList` returns Kevin's
Garmin daily `calorieOut` (`{restingEnergy, activeEnergy}` per date) and `step` counts through the
existing group token — so Trainerize v3 (pull clients' daily burn/steps into Glide dashboards +
progress, per docs/TRAINERIZE-API.md) is fully unblocked and is the natural NEXT Trainerize build,
alongside v2 (workout/program history via program/get + dailyWorkout/get).

## ✅ S86c (same session): Trainerize MEAL SYNC + dual Nutrition Approach — LIVE
1. **Meal sync (Trainerize v2 nutrition):** every import/re-import now also pulls the client's last
   365 days of `dailyNutrition` into the profile's day logs (`caliq-log-{pid}-{date}`).
   **Trainerize-native days = FULL detail** (meal name→type, clock time, every food with macros —
   verified: "Avocados raw · snack · 17:56 · 240 cal"); **MFP/Fitbit days = one "<Source> day total"
   entry** (those apps don't share per-food data — verified: "MyFitnessPal day total 540 cal").
   Imported meals carry ids `tz{nutritionId}-{i}`; re-sync REPLACES them (verified idempotent) and
   never touches Glide-logged meals; day totals adjust by delta. Detail calls only fire for
   TZ-native entries (cheap). E2E-verified: 2 clients → 43 day logs.
2. **Nutrition Approach (the S86 "projection double-count" decision — Kevin chose BOTH):** new plan
   field `data.deficitMode`: **"eatback"** (default — burn added to the daily target, steady
   ~1 lb/wk) vs **"accelerate"** (target stays TDEE−500, burn speeds the goal date). Module helper
   `isEatback(d)`; wired through computeClientCalories, DailyDashboard per-day target, SummaryTab,
   NutrientsTab, SharePlanCard, SimulationSummary, and server `nutritionTargets`; AI can set it via
   `set_personal_info.deficitMode` and reads it in `get_profile`. **Chooser UI:** Full Plan →
   Summary → "Nutrition Approach" card shows BOTH options with their real cal/day + goal date and a
   ✓ ACTIVE marker; the timeline card shows both paces honestly; SimulationSummary headlines the
   active mode and footnotes both. Verified live: 220-lb plan with 1,148 cal/wk of training —
   Eat More 2,733/day → Jan 2027 vs Faster 2,569/day → Dec 2026; switching flips the share card,
   timeline, and Daily Dashboard target (and persists on the plan).

## ✅ S86d (same session): Trainerize AUTO-SYNC every 30 minutes — LIVE
Kevin asked for real-time transfer. **Trainerize has NO webhooks** (nothing can push events to us —
polling is the only mechanism, confirmed in their API reference), so the closest-possible was built:
**`trainerizeAutoSync`** (`onSchedule "every 30 minutes"`, functions/trainerize.js) re-syncs every
ALREADY-IMPORTED client (index entries with `trainerizeId`) in Kevin's account: fresh
weight/body-stats/goals snapshot + the last **14 days** of nutrition. New Trainerize clients are NOT
auto-added (respects the selective picker); the manual import button still does the full 365-day
nutrition pull. Refactor: the per-client sync now lives in shared `runImport(db, uid, auth,
{clientIds, nutritionDays})` + `fetchRoster(auth)` — used by both the callable and the schedule.
~3-4 API calls/client/run ≈ nothing against the 1000/min cap. NOTE: for imported (ctz*) profiles
Trainerize is the source of truth — a manual Glide edit to weight/goals gets overwritten by the next
sync (same documented re-import semantics, now automatic). Verify on next session: `firebase
functions:log --only trainerizeAutoSync` should show runs every 30 min with `{synced, mealDays}`.

## ✅ S86e (session close): auto-sync TOGGLE + cost answer
The trainer home (owner account only) now shows "🔄 Trainerize auto-sync: On/Off — every 30 min…
tap to pause" under the import buttons. It writes `caliq-tz-autosync {enabled}` in Kevin's kv;
`trainerizeAutoSync` checks it at the top of every run (missing/true = ON, explicit false = skip —
the schedule keeps firing but no-ops, so resuming is instant). Cost answer given to Kevin: ~1,500
invocations/mo (free tier 2M), scheduler job free tier, Firestore writes ≈ $0.20–0.25/mo at 10
clients — effectively free.

## ✅ S87: AI-edits-local-plans — DEPLOYED & LIVE
The AI can now read/edit the trainer's OWN local plan files and simulations (imported Trainerize
clients, prep files, sims) by chat. **How:** new trainer-only tool **`list_local_plans`** (reads the
caller's `caliq-index` → localPlanId/name/isSimulation/importedFromTrainerize) + an optional
**`localPlanId`** param on all 12 plan-data tools (never combined with clientId; validated against
the caller's own index — can only ever reach the caller's own kv). Central plumbing in aitools.js:
`activePlanId/activePlanData/loadPlanWrap` take a `planOverride`; `touchLocalIndex` updates the
index entry (name/weight/goal/lastSaved) after every local write so the dashboard cards stay right;
proposals (meal/workout Accept cards) carry `localPlanId` through to the `logMeal`/
`setWorkoutSchedule` callables; App passes `onDataChanged={reloadProfilesIndex}` to the trainer
screens' AIChatPanel so the Local Plans cards refresh live. Manifest tools (list/create/switch_plan)
deliberately DON'T take localPlanId. System prompt: trainer section tells it to resolve local files
by name via list_local_plans. **E2E-verified live** (trainer.uitest): "what local plan files do I
have?" listed them with sim flags; "set Prospect Pat's goal weight to 185" → plan data 185, index
185, dashboard card live-refreshed to "→ 185 lbs" with no reload; console clean.

## ✅ S87b: Biometric login (Face ID / Touch ID passkeys) — DEPLOYED (device-test pending Kevin)
Four new callables in **functions/webauthn.js** (`@simplewebauthn/server` v13): passkeyRegisterOptions/
Verify (signed-in setup) + passkeyLoginOptions/Verify (signed-out login → **Firebase custom token** →
`signInWithCustomToken`). Credentials in `webauthnCreds/{credId}` {uid, publicKey, counter, rpID};
one-shot challenges in `webauthnChallenges` (5-min TTL) — both Admin-SDK-only (no client rules =
denied). **Origin allowlist** `calorieiq-jet.vercel.app` + `localhost:5173`; rpID = hostname —
⚠️ passkeys are DOMAIN-BOUND: a future custom domain means users re-register (add the new origin to
ALLOWED_ORIGINS then). Discoverable credentials (residentKey required) → usernameless: the login
button needs NO email typed. UI: SideMenu "🔐 Set up Face ID / Touch ID" (localStorage hint
`glide-passkey` marks the device); AuthGate "🔐 Sign in with Face ID / Touch ID" (login mode only,
highlighted once hinted; cancel = silent, no-passkey → friendly pointer to set it up). Verified in
preview: options callable returns challenge/rpId/userVerification correctly, full click round-trip
shows the graceful fallback (headless browser has no authenticator) — **the real Face ID prompt needs
Kevin's phone/Mac**: sign in → menu → Set up Face ID → sign out → "Sign in with Face ID".
**Also S87b:** Trainerize auto-sync turned OFF at Kevin's request (wrote `caliq-tz-autosync
{enabled:false}` via Firestore REST with CLI creds) — he re-enables anytime via the trainer-home
toggle.

## ✅ S88: idle sign-out is now a USER TOGGLE + passkey setup forces the built-in sensor
Kevin's feedback after the laptop test: (1) the 30-min auto sign-out should be optional → new ≡-menu
row "⏱️ Auto sign-out when idle (30 min): ON/OFF" (default ON; stored `caliq-security-prefs
{idleSignOut}`; the App timer effect keys on it; OFF shows a personal-device warning; verified live —
persists across reload). (2) His laptop offered a QR-code/security-key dialog instead of a
fingerprint — two causes: he tapped SIGN IN before ever registering (browser had no local passkey →
cross-device flow, which is normal WebAuthn), and registration didn't request the platform
authenticator. Fixed: `authenticatorSelection.authenticatorAttachment: "platform"` on
passkeyRegisterOptions (redeployed) = setup now uses the device's OWN Touch ID/Face ID/Windows
Hello; plus a first-time caption under the login button ("sign in with your password, then enable
Face ID from the menu"). Cost answered: passkeys are free (device+browser native; only the usual
tiny function invocations). Kevin still needs to device-test: sign in → ≡ → Set up Face ID →
sign out → Face ID button.

## ✅ S88c: Trainerize v3 — WEARABLES INTO GLIDE (deployed + E2E-verified)
`syncClientHealth` in functions/trainerize.js: every import (and the auto-sync, when re-enabled)
pulls `healthData/getList` calorieOut ({restingEnergy, activeEnergy}) + step per client into the
day logs as `wearable: {active, resting, steps, source}` (cap 90 days back — one doc/day).
**Display (house `watch` icon, no emoji):** Daily Dashboard card "Tracker (garmin): N cal active ·
N steps" when today has data; calendar Day view shows the same line per date. **Display-only — the
tracked burn does NOT change the calorie target** (deliberate; whether it should adjust the
eat-back target is an open product call tied to deficitMode). E2E-verified with Kevin's real
Garmin: import → 86 days of tracker data → day log Jul 4 = {active:703, resting:2337, steps:10010,
source:"garmin"} → calendar Day view renders "Tracker (garmin): 703 cal active · 10,010 steps".
Import result line now reports "N days of tracker data". NOTE: today's tile only fills once
Garmin→Trainerize has synced that day (lags a day for inactive users).
**Passkey post-mortem (S88b, same session):** the laptop "setup failed" was actually a SUCCESS +
a sign-in 500: `createCustomToken` needs `iam.serviceAccounts.signBlob` → granted **Service
Account Token Creator** to the compute SA on itself (IAM, via owner creds). InvalidStateError
(duplicate passkey) now reads as "already set up". Kevin should just tap "Sign in with Face ID" —
his passkey exists. New house icons: fingerprint, sync, pause, watch (emoji swapped out of all
S86–88 features per Kevin's icon rule — NEW FEATURES MUST USE src/icons.jsx ICONS, NOT EMOJI).

## ✅ S89b (historical — superseded by the NEXT SESSION section at the top): Stripe billing v1
**Everything below is DONE and verified; kept for the implementation details.** The Upgrade tap
(item 1 at the bottom) was ALSO done — Kevin completed a real test purchase in his browser and the
webhook flipped his test account to active. Only LIVE mode remains (needs the pricing decision).
Kevin's decisions are LOCKED (don't re-ask): both audiences pay, simple subscriptions (Connect splits
later), trial expiry locks premium / basics stay free, flat monthly (placeholder $49 coach / $9.99
client — confirm before LIVE mode). Code is committed: premium gate (profile.js `isPremium` +
server `trialExpiredFor` in aichat.js/transcribe.js + AIChatPanel lock card), functions/billing.js
(createCheckoutSession / createPortalSession / stripeWebhook), SideMenu Upgrade + Manage rows,
`?billing=success` return polling.
**✅ DONE (post-reauth, same session):** all six functions DEPLOYED (billing callables created clean
with public invokers); secrets `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` exist as
**PLACEHOLDERS** (`sk_test_placeholder_replace_me` — checkout fails gracefully until replaced).
**Trial gate E2E-VERIFIED against prod:** privileged write set trialStartedAt 40d ago on
trainer.uitest → lock card + Upgrade button rendered from real data, aiChat callable
permission-denied/trial-expired, stream SSE error trial-expired, transcribeAudio denied; fields
removed → unlocked, AI replied. Test profile restored to grandfathered.
**✅ ALL DONE (same session — Kevin provided the TEST key):** real key set; **webhook endpoint
created programmatically via the Stripe API** (`we_1TqL3O…` — no dashboard step; signing secret
captured straight into Secret Manager); 3 billing fns redeployed. **E2E-verified against prod:**
checkout URL created (role-priced, products auto-created by lookup_key `glide_coach_monthly` /
`glide_premium_monthly`); signed checkout.session.completed → profile `active` + Manage-subscription
row in the app; a REAL API-created $49 test subscription canceled → **Stripe's own delivery** flipped
the profile to `canceled` via metadata.uid. Trial gate separately E2E'd (lock card + all 3 endpoints
deny + unlock loop). All test residue cleaned (Stripe customer deleted, profile fields removed).
**Remaining (small):**
1. Kevin taps **Upgrade** once on a test/expired account in prod — the only untested link is Stripe's
   hosted checkout PAGE in a real browser (the preview can't leave localhost). Test card
   4242 4242 4242 4242, any future expiry/CVC.
2. **LIVE mode when Kevin's ready:** confirm real prices ($49 coach / $9.99 client are placeholders —
   change PRICE_CENTS in functions/billing.js or create new lookup_key prices), set the LIVE
   `sk_live_…` key + create the live-mode webhook (same one-command API call), redeploy the 3 fns.
3. Later phase: Stripe Connect revenue splits (sub 75 / head 10 / platform 15) — deliberately not v1.

### Also pending
- **NEW STANDING STRATEGY DOC: `docs/ECOSYSTEM.md`** (S88 close) — Kevin's north star: Glide great
  standalone, thriving via integrations other platforms WANT their users to have; includes the
  fitness-platform landscape (coach platforms, trackers, wearables) for future connectors. Kevin may
  ask for a verified web-research report on it — offer the deep-research pass.
- Kevin device-tests Face ID sign-in (his passkey IS registered; the IAM fix is live).
- Trainerize auto-sync is OFF (Kevin's toggle) — wearables/meals/workouts refresh only on manual
  import until he re-enables it.
- **GitHub secret-scanning alert (S89, resolved — one loose end):** the alert was the Firebase WEB
  API key in the archived S2 handoff doc — public-by-design (it ships in the client bundle), NOT a
  real secret. Handled: key redacted from `docs/archive/CalorieIQ-Session2-Firebase-Handoff.md`
  (still in old git history — deliberately not rewritten), full history audited (NO real secrets ever
  committed), and Kevin **API-restricted the key in Cloud Console** to 6 APIs (Identity Toolkit,
  Token Service, Firestore, Installations + Storage/FCM-Registration for the roadmap) — sign-in/
  refresh/reads verified working after. **Loose end: Kevin still needs to dismiss the GitHub alert**
  (repo → Security → Secret scanning → close as "False positive"). If Storage or push notifications
  ever 403, the fix is re-checking that API on the key's restriction list.

## ✅ Session 85 shipped (all LIVE): Trainerize importer v1 + full optimization/security sweep
1. **Trainerize importer v1 — DONE, deployed, verified with the real roster** (10 active clients at
   import time, down from 13 in S84 — the Trainerize roster itself changed). `trainerizeImport`
   callable + an "Import from Trainerize" button on the trainer home (Local Plans card, **visible +
   callable ONLY for Kevin's admin account** — the shared group token must not be trainer-wide).
   Confirmed endpoint contracts + mapping in `docs/TRAINERIZE-API.md` (read it before touching v2 —
   the param names are non-obvious: `getProfile` takes a `usersid` ARRAY, `bodystats/get` needs
   `date:"last"` + units). Kevin runs it by tapping the button in HIS account; re-runs update
   (dedupe by `trainerizeId`, deterministic profile ids `ctz{id}`).
2. **Optimization/security sweep** (3 parallel reviewers over App.jsx / functions / support files;
   all fixes applied, tested, deployed — details in CLAUDE.md Session 85):
   - **Firestore read-cost**: `storage.list()`/`listForUser()` now use range queries (were
     full-collection downloads per call, per client); `list_clients` tool uses limit(1) desc;
     streak reads batched 7-parallel + reused by the week summary; trainer loaders parallelized;
     details effect deduped; nudge double-reload removed.
   - **Security**: rules now block self-granting `subscriptionStatus`/`entitlements`/trial fields
     (was a self-serve Pro/AI-budget upgrade hole); inviteCodes LIST is admin-only (no code
     harvesting); Trainerize fns admin-gated; `fetch_link` SSRF re-validates every redirect hop;
     `sendInvite` capped 50/day/trainer. **61 rules tests pass** (was 47) — rules PUBLISHED.
   - **Correctness**: midnight-rollover fix (`useTodayKey` — a dashboard left open past midnight
     no longer writes yesterday's totals into today); AuthGate no longer routes an existing user
     into the RoleChooser on a flaky profile read (was silently unlinking trainer + restarting
     trial; `createProfile` is now also non-destructive if a profile exists); `joinTrainer` legacy
     query wrapped (was a raw permission crash on typo'd codes); AI token usage now recorded even
     when a tool round fails (was unbilled) + stream errors return clean frames; images only
     honored on the final chat message (cost hole); all outbound fetches have hard timeouts.
   - **Misc**: PWA offline shell now refreshes per navigation (was frozen at install → white
     screen offline); dev-showcase fonts no longer load in prod (only Sora); qrcode lazy-loaded.
   - **⚠️ Gotcha for future edits**: the kv range queries use `prefix + ""` — keep it as the
     ESCAPE SEQUENCE in source; a raw pasted char silently became an empty string once and made
     `listForUser` return nothing (caught in live smoke test).

## ⏭️ DO NEXT (Kevin's queue): AI-edits-local-plans → biometrics
(unchanged from S84 — the importer is done)

## Sweep leftovers (deliberately deferred, noted for later)
- **kv read-modify-write races**: `log_meal` / `send_client_request` (functions) and the app's own
  optimistic writes aren't transactional — concurrent same-doc writes can clobber (e.g. client taps
  +250 cal the same second the AI logs a meal). Needs `db.runTransaction` on the two function paths
  first. Real but rare; design it, don't rush it.
- **AI budget pre-reserve**: budget check is check-then-act — N parallel requests can overshoot the
  daily cap (scripted abuse only; caching keeps the cost small).
- **assignedTrainerId consent**: a malicious user can still self-assign to any trainer uid directly
  (spam/noise vector only — fold into a later rules pass; joinTrainer already validates client-side).
- **Tool-result truncation**: 60KB mid-string `.slice()` on JSON tool results → lower + truncate
  semantically when coach rosters grow.
- **ProfileCard defined inside ProfileSelector render** — rename input caret jumps to end per
  keystroke; hoist to module scope with props when next in that area.
- **useClientLiveRefresh** still reloads ALL clients on any one client's action (cheap now that
  list() is range-queried; scope per-uid if trainer rosters get big).
- **Trainerize v2/v3**: history import (bodystats list, dailyNutrition, program), scheduled daily
  auto-sync, `calorieOut` wearable burn, multi-tenant per-trainer encrypted tokens.

## Previous DO-NEXT (done): Build the Trainerize importer (connection was LIVE & proven)
The Trainerize connection **works** and the design is locked. ~~This is the #1 next build.~~ **BUILT — see above.**
- **Confirmed live (S84):** auth = `Authorization: Basic base64("<GroupID>:<APIToken>")`. Kevin's real
  secrets `TRAINERIZE_GROUP_ID` (6-digit) + `TRAINERIZE_API_TOKEN` are SET. `user/getClientList`
  `{start,count}` → `{ users:[...], total }`; **Kevin's group has 13 clients**. Each user has
  `id`(number), `firstName`, `lastName`, `email`, `type`, `status`, `role`, `profileName`, `trainerID`,
  `latestSignedIn`, `trialStatus`. `functions/trainerize.js` (`trainerizeTest`) is deployed and returns
  this. **Full endpoint map + confirmed details + design: [docs/TRAINERIZE-API.md](docs/TRAINERIZE-API.md).**
- **DESIGN (decided with Kevin):**
  - **Option A** — each Trainerize client becomes a **local profile in the trainer's Glide account**
    (reuse existing local-profile storage; no new user accounts). Dedupe by storing `trainerizeId` on the
    profile so re-imports UPDATE, not duplicate. Later: invite client → they make a Glide login → link.
  - **v1 = roster + snapshot** (name, current weight, goal, body stats) → Kevin sees all 13 in Glide.
    v2 = history (check-ins/`bodystats`, `dailyNutrition`, `program`). v3 = `healthData` `calorieOut`
    (wearable burn → progress).
  - **Auto-add:** a **scheduled daily Cloud Function** polls `getClientList`, imports new clients (+ a
    "Sync now" button). **Multi-tenant later:** other trainers connect their OWN token (per-trainer
    ENCRYPTED store, not the shared secret); sub-trainers routed by each client's `trainerID`.
  - **Rate limits are a non-issue:** 1000 req/**minute** (throttle, not a cap). Import ≈ 6 calls/client
    (13 ≈ 78). **Glide's daily targets/logging/AI never call Trainerize** — they run on Glide's own data,
    so nothing "runs out" or breaks if Trainerize is slow/down. (Told Kevin this — it was his main worry.)
- **BUILD STEPS (v1):** (1) investigate Glide's local-profile storage format (the profiles index + how
  `caliq-{id}` data/plans are created — see `ProfileSelector`/`createProfile`/`selectProfile` in App.jsx);
  (2) extend `functions/trainerize.js` with a `trainerizeImport` callable (trainer-only) that loops
  `getClientList` → per client `getProfile`+`bodystats/get` → maps to Glide's plan `data` shape → writes
  into the CALLER's kv as local profiles (via the Admin SDK, mirroring `src/storage.js`
  `users/{uid}/kv/{encodeURIComponent(key)}` with a JSON-string `value`); (3) frontend "Import from
  Trainerize" button (trainer screens) + progress/result UI; (4) deploy + test against the real 13
  clients; (5) then v2/v3 + the scheduled sync. **Careful — it WRITES into Kevin's real account; test the
  mapping first (can dry-run via direct curl like we verified getClientList).**

## Also queued (Kevin's order, after Trainerize): AI-edits-local-plans → biometrics
- **AI editing local profiles + simulations** (not just connected clients) — extend the AI tools to target
  a trainer's own local plans/sims so plans can be prepped by chat. Medium build, fully in our control.
- **Biometric login (Face ID/Touch ID via WebAuthn/passkeys)** + **auto sign-out on idle** (quick). Last
  security items.

## Decisions locked (don't re-litigate)
- **Terra: NOT used** — $399/mo, and Trainerize gives wearable `calorieOut` for free. Wearable Glide-side
  work (store burn/day, an **override toggle** so a tracker workout overrides a scheduled Glide one
  per-modality) is source-agnostic — build once, feed from Trainerize.
- **Name change: OPEN.** Full research in [docs/NAMING.md](docs/NAMING.md); top clean+available = **Slydra**
  ("SLY-druh"), but undecided. Rename = a text-swap across the app (colors unchanged; Firebase id stays).
- **OpenAI transcription is fine** (Whisper billed per-second, not tokens → dashboard shows 0). Setup:
  **Groq primary (fast) + OpenAI fallback**. Voice capped at 60s with a countdown.
- **AI "precise food data" (search_food) = Pro upsell** — server-gated by `subscriptionStatus:"active"`
  OR `entitlements.foodAccuracy:true` + a chat toggle; free users get AI estimates. (src/profile.js
  `isProUser`.) Grant a test acct the entitlement to demo.

## Shipped in Session 84 (all live)
Calendar **start date** (pre-join days neutral) + Day-view dashboard parity (add/**reduce**/typed calories +
meal type + **water**). Food DB: USDA (Kevin's key live) **+ Open Food Facts**. **Barcode scanner** (live
camera, @zxing/browser, iOS+Chrome) with **auto serving size + g/ml**. AI **search_food** (Pro-gated) +
upsell toggle. **Email invites LIVE** (Resend, `send.smoothtraining.com` verified SPF/DKIM/DMARC, sender
`invites@send.smoothtraining.com`). **Back button closes overlays**; **Sign out** prominent/reachable.
**Groq** transcription. **PWA** (installable, manifest/sw/icons via `npm run gen:icons`, "Install Glide"
prompt, **notch/safe-area** header fix, taller header so the menu button clears the underline). Docs:
`TRAINERIZE-API.md`, `SECURITY-TRUST.md` (shareable), `NAMING.md`.

## Gotchas
- **Background process also commits/pushes here** — `git fetch` + check `origin/main..HEAD` first.
- **Deploy ALL 4 AI fns when `functions/aitools.js` changes** (aiChat, aiChatStream, logMeal,
  setWorkoutSchedule). Other fns: sendInvite, transcribeAudio, trainerizeTest.
- **Firebase token expires** → `firebase login --reauth --no-localhost`. Set secrets via
  `printf 'val' | firebase functions:secrets:set NAME --project calorieiq-29762 --data-file=-` (masked
  prompt trips Kevin up). **Never `GID=` in zsh** (special var → "operation not permitted"); use another name.
- To test a secret-backed API without a UI: `firebase functions:secrets:access NAME` into a curl (don't
  print the secret) — how we proved Trainerize + OpenAI.
- **`src/App.jsx` ≈ 13k lines**; `css` block is a JS template literal. `npm run build` before commit; push
  `main` auto-deploys Vercel; **Cloud Functions need explicit `firebase deploy`** (NOT via push).
- Test accounts: trainer `trainer.uitest@calorieiq-test.com` / client `client.uitest@…` (Casey),
  `TestPass123`. Drive the preview signed-in for callables/AI.
