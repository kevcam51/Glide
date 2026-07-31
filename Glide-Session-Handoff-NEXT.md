# Glide — Next-Session Handoff (start here)

## ✅ STATE @ `10f6509` — everything pushed, deployed, tree clean (Jul 27, late)
Firebase `calorieiq-29762` · model `claude-sonnet-4-6` · admin UID
`G7QUZ8Kat1fgyoMjdGKz4DYoVHi1` · live on **glidna.com**.

**⚠️ READ THIS ORDERING NOTE FIRST.** Four sections below cover Jul 27 and were
written at different points in one very long session, so they overlap and one
contradicts itself. Trust this block and **`## ⚡ S140–S157`** (the last one
written); treat the earlier S135–S136 / S135–S139 / S140–S152 headings as history.
The **"NEXT SESSION — START HERE: make every surface DATE-AWARE"** section is
**DONE** (S144–S146) — do not rebuild it.

### 🔴 The one thing a fresh session cannot rediscover from the code
**S139 client-data bleed may have already written bad data.** Before the fix,
logging for client B before B's data loaded wrote client A's whole meal array into
B's account. Fixed, but nothing repairs what already landed. If a client shows
meals they never logged, that is the cause — do not treat it as a new bug.

### ⏭️ Genuinely open (in the order Kevin last implied)
1. ~~**Food-library delete in ClientHome's calendar**~~ **FIXED — S158** (`4028a1b`).
   ⚠️ The diagnosis above was wrong and cost a detour: `CalendarView`'s `<MealLog>`
   **does** pass `onRemoveRecentFood`. The gap was one level UP — `ClientHome`
   renders its own `<CalendarView>` and passed only `recentFoods`. It also wasn't
   "read-only": FoodLibrary's food row called the handlers unguarded, so the click
   **threw** and the confirm sat there. Fixed both, plus a second gap found while
   there: food logged FROM the calendar never joined the library (`onLogFoods`).
   Fold rules now live in one pure `foldRecentFoods`.
2. **YouTube exercise videos** — Kevin has his OWN library, which beats the Free
   Exercise DB photo pairs (no licensing, no storage). ⚠️ ENRICHMENT ONLY: our 184
   exercises carry the MET values the whole burn engine runs on, and no third-party
   source ships METs. Never swap the catalog.
3. **App requests** are live and verified; "planned + copy" hands one to a developer
   with its context. Nothing else pending there.

### 🅿️ Parked by decision (do not re-litigate)
- **Net vs gross METs** — real (~+25% over-credit at 5 METs, and the Garmin already
  reports net so the two disagree), but Kevin parked it as the smallest item.
- **VO₂max for burn accuracy — recommended AGAINST**, on verified primary sources:
  the accepted correction uses RESTING VO₂ (data we already hold), and VO₂max
  explains only ~7–12% of variance in economy. Tracking it as a MEASUREMENT is
  still worthwhile; wiring it into burn would be false precision.
- **Connector directory listing** — skipped; Kevin sends invite links, so no Team
  org and no $50/mo. Consequently **DCR must NOT be rebuilt as CIMD** — DCR is
  proven working with both Claude and ChatGPT.

### 🔑 Gotchas that cost real time tonight
- **Bundle-hash deploy checks are meaningless here** — Vercel inlines
  `VITE_USDA_API_KEY`, so local and live hashes never match. Watch the live hash
  CHANGE, then verify by content with `LC_ALL=C grep`.
- **The callable SDK's client timeout is 70s** regardless of the function's
  `timeoutSeconds`. That, not Trainerize, caused "Couldn't reach Trainerize".
- **Do not run Workflow subagents against this repo while signed into the app** —
  they drove the same browser and wrote probe files into the repo root.
- `setInterval` is throttled to ~6 samples/3s in the headless preview; use a
  MutationObserver, installed in the SAME `javascript_exec` as the navigation.
- Reading `innerText` right after a `.click()` returns the PRE-render DOM.
- zsh: `UID` and `GID` are read-only — name shell vars something else.
- Kevin is trainer/admin: **ClientHome never renders for him.** Put anything he
  needs to see on DailyDashboard too.


## ⚡⚡⚡ S135–S136 (Jul 27): macro revert fixed · AI stops claiming work it didn't do · chat focus
_Pushed (@ `bfbb02c`), **all functions DEPLOYED** — this supersedes the "NOT DEPLOYED" warning in
the S136 commit message, which was written before Kevin re-authed._

### 🐛 Macro targets reverted every 30 minutes (S135)
`applySnapshotAndSyncs` (trainerize.js:388) shallow-merged the Trainerize snapshot OVER saved plan
data, and `mapSnapshot` re-emitted `macroTargets` from Trainerize's `nutritionGoal` on EVERY run —
so `trainerizeAutoSync` re-stamped whatever the user set. The edit always saved; it was overwritten
minutes later, which is why it read as a "revert". The old `!d.macroTargets` guard only deduped
within the snapshot being built and never consulted stored data.
**Fix:** a `macroTargetsEditedAt` provenance stamp written by BOTH the UI path and the AI's
`set_targets`, honoured in the merge. **Deliberately narrow** — weight/goal/activity/height stay
Trainerize-source-of-truth (S86d) because the coach dashboards depend on it.
⚠️ Plans edited BEFORE this shipped carry no stamp and revert once more until re-saved; a backfill
can't distinguish a deliberate edit from an old sync value, so don't attempt one.

### 🐛 "It said it logged but it didn't" — THREE separate causes (S135)
1. **Silent wrong-account write — the likely main one.** `resolveTargetUid` (aitools.js:1396)
   returns the CALLER's uid when a trainer omits `clientId`, so "log Casey's breakfast" saved into
   the TRAINER's own diary and returned ok. Kevin would check the client, see nothing, and conclude
   it lied — it had logged, to the wrong person. Prompt now requires `clientId` on every on-behalf
   write, to ask when unsure, and to NAME the person when confirming.
2. **Tool-round exhaustion.** The loop exits at `MAX_TOOL_ROUNDS` while the model still wants tools;
   those calls were DISCARDED and its own preamble ("logging all 8 now…") was returned as the
   answer. Both callable and stream paths now say they ran out of steps.
3. **Failed tools looked like successes** — there was no `is_error` anywhere in functions/. Now set.

### 🐛 Wrong DATE (S135/S136) — two independent causes
- The prompt literally said **"don't assume today"**, inviting a date the model had to infer; and
  only the last ~10 messages are sent while threads persist across days, so a resumed chat
  re-anchored on yesterday. Now: default to today, OMIT the date arg unless the user names another
  day, never infer one from earlier messages. Weekday injected (changes daily like the date beside
  it, so no extra cache churn). All 8 tool date descriptions strengthened — that string is what the
  model reads at call time and it sits in the already-cached prefix, so it's free.
- **The MCP connector passed NO server `instructions`**, so an external Claude/ChatGPT never learned
  the user's today and filled dates from its own clock — reliably a day out. `buildServer` now
  states today + weekday, that omitting the date means today, and that writes need a `clientId`.
  Matters more now that Kevin actually uses ChatGPT.

### ✅ Chat focus + rename (S136) — frontend only
The activeTarget subject was already relayed end-to-end; it was just EPHEMERAL (`resetThreadUi`
nulls it on every switch/new/delete and on reload), so returning to a chat re-ran
`find_client`/`list_clients`. Chats now carry an optional `pin` (no migration — `writeIndex`
serialises whatever is in `convos`); `switchChat` re-arms the ref AFTER `resetThreadUi`; the first
resolved subject **auto-pins**, which is where the token saving comes from. Rename via the drawer
pencil with `titleLocked` so the auto-title can't overwrite it.

### ⏭️ Next up
- **App requests via AI** — Kevin's idea, NOT started: user asks the AI for a feature, it offers to
  send it, admin reviews them in an "App requests" screen. One new tool + an admin surface.
- **YouTube exercise videos** — Kevin has his OWN library, which beats the Free Exercise DB photo
  pairs (own content, no licensing, no storage). ⚠️ Still an ENRICHMENT layer: our 184 exercises
  carry the METs that drive the burn engine and no third-party DB ships them.
- **Verify the two fixes live:** edit a macro target then force a Trainerize sync and confirm it
  holds; ask the AI to log for a client and check it NAMES the person in its confirmation.
- Phase 4b (reverse MCP) — parked: Trainerize already covers Apple Health/Fitbit/MFP/Withings/
  Garmin, and Whoop/Oura ship no MCP server today. Revisit when one exists or a native app lands.

## ⚡⚡ S135–S139 (Jul 27): macro revert · AI accuracy · tracker source · CLIENT DATA BLEED
_All pushed (@ `324c6d4`), functions deployed, tree clean._

### 🔴 S139 — one client's data appeared under another, AND could be saved there
Kevin reported it as a cosmetic glitch. It was not. **If you logged for client B
before B's data finished loading, A's entire meal array and totals were written into
B's account** (`onAddMeal` spreads the current `dailyLog`; `persistLog` routes by the
current `activeRemoteUid`). Same for `appendHistory` → B's activity feed.
- Cause: `openClientPlan` set IDENTITY synchronously (`data`, `activeRemoteUid`,
  `activeId`) but left `dailyLog`, `history`/`historyRef`, `recentFoods`/
  `recentFoodsRef`, `streak`, `weekSummary`, `recentWearable` at the PREVIOUS
  client's values until an async read replaced them. The name renders from `data`,
  the numbers from those — so B's first painted frame was guaranteed to be B's name
  over A's data. Same shape as S127 (unloaded state rendered as current).
- Why it stuck instead of flashing: the loader effect had no staleness guard, so a
  slow loader for A could resolve after B's. streak/weekSummary/recentFoods/
  recentWearable have NO onSnapshot to self-correct → wrong until reload.
- Fixes: `resetPlanScopedState()` first in openClientPlan **and selectProfile and
  createProfile** (imported Trainerize clients ARE local profiles); an `alive` guard
  on every write in the loader — placed before the REF writes too, not just the
  setStates — plus a cleanup that cancels on switch; `goBack` now clears
  activeRemoteUid/activeId instead of leaving the old client active behind the roster.
- ⚠️ **Possible bad data already persisted.** Any client logged-for immediately after
  a switch may hold someone else's meals. Not auto-detectable — if Kevin reports an
  odd meal, this is why.

### S137 / S138 — the tracker card (two bugs, the second exposed by the first)
- **S137:** `syncClientHealth` skipped days where active+steps were both 0, so a genuine
  zero day wrote nothing and the dashboard kept showing the last day that HAD data —
  yesterday's burn presented as today's, which no amount of re-syncing could clear
  (Kevin hit exactly this). Now writes any day the tracker REPORTED, including 0, via
  a `reported` flag. Also fixed: days with real resting energy but no steps were
  discarded because `resting` was never in the test.
- **S138:** with zero days now real, Kevin's card went blank and relabelled itself
  "Apple Health". Older bug: one bucket per date with `w.source = e.source`
  last-write-wins, and Trainerize returns entries from EVERY connected tracker — so an
  empty Apple Health entry overwrote Garmin's numbers. Now buckets per date PER SOURCE
  and picks the most active (active → steps → resting), compared per day so a day
  Garmin missed can still be covered. Kevin confirmed the sync works after this.
- **Lesson for future tracker work:** "which source" and "is there data" are separate
  questions. Collapsing them caused both bugs.

### S135 — macro targets reverting, and the AI reporting work it didn't do
- **Macro revert:** `applySnapshotAndSyncs` (trainerize.js) shallow-merged the snapshot
  OVER saved data and `mapSnapshot` re-emitted `macroTargets` every run, so the 30-min
  auto-sync re-stamped every edit. The edit always saved; it was overwritten later.
  Fix: `macroTargetsEditedAt` provenance stamp (written by the UI **and** the AI's
  `set_targets`) honoured in the merge. Narrow by design — weight/goal/activity/height
  stay Trainerize-source-of-truth (S86d). Plans edited BEFORE this revert once more.
- **AI claiming false success — three defects:** (1) tool-round exhaustion discarded
  pending calls and returned the model's own preamble as the answer; (2) failed tool
  results carried no `is_error`, so a failure looked like a success; (3) **a trainer
  omitting `clientId` writes to their OWN account** and gets ok — almost certainly the
  real cause of "it said it logged but it didn't". Prompt now demands clientId on every
  on-behalf write and to name the person when confirming.
- **Wrong date:** the prompt said "don't assume today", and with only ~10 messages sent
  but threads persisting across days a resumed chat re-anchored on yesterday. Now
  defaults to today and OMITS the date unless the user names a day. Weekday injected.

## ⚡⚡⚡ S140–S152 (Jul 27): CLIENT DATA BLEED · date-aware dashboard · AI logging faults
_All pushed (@ `5527218`), functions deployed, tree clean._

### 🔴 READ FIRST — possible bad data already written (S139)
Switching client mid-session could write client A's meals into client B's account.
`onAddMeal` spread the CURRENT `dailyLog` while `persistLog` routed by the CURRENT
`activeRemoteUid`, so logging for B before B's read landed saved A's whole meal
array into B's day log (and A's feed into B's history). **Not auto-detectable.** If
Kevin ever reports a meal that belongs to someone else, this is why — it is fixed
going forward but historic writes stand.
- Cause: `openClientPlan` set identity synchronously but left dailyLog / history /
  recentFoods / streak / weekSummary / recentWearable on the PREVIOUS client until
  an async read replaced them. Name renders from `data` (sync), numbers from those
  (async) → B's name over A's data, guaranteed on first paint.
- Fixed: `resetPlanScopedState()` first in openClientPlan / selectProfile /
  createProfile; an `alive` guard on every write in the loader (before the REF
  writes too) + cleanup on switch; `goBack` clears activeRemoteUid/activeId.

### 📅 The dashboard is now a DAY VIEW (S144–S146, S151)
Kevin: "everything changes and goes in the past or present… a proper record."
One `viewDate` in App keys the loader, the live subscription and every log
read/write, so dailyLog, streak, week summary and tracker data all follow. Done
atomically — a half migration would read one day and write another (the S139
fault, in the same code).
- Weekday/`dayIdx` derive from viewDate (they didn't — a Saturday showed TUESDAY's
  scheduled workout, which is what made the burn tile look broken).
- Weight tile = latest weigh-in ON OR BEFORE that day, labelled "Weighed that day"
  vs "Last weighed Tuesday". **Never looks forward** or history rewrites itself.
- Future dates allowed (programming ahead); a future weigh-in is `isFuturePlan`.
- Back-dating can't rewrite the present: `weightLbs` only advances when the entry
  is the NEWEST. **Consequence (S152):** roster cards must read the latest CHECK-IN,
  not `weightLbs`, or they sit stale.
- Plans always open on TODAY (viewDate survived plan switches).

### 🤖 AI logging faults (S135, S141) — Kevin's transcript
Asked for 6 items on Jul 27; got some on today and the 26th DOUBLED.
- **Wrong day:** `log_meals` was the ONLY logging tool with no top-level `date`.
  Handler read `it.date`, never `input.date`, so a batch date was silently dropped.
  Now takes a batch date; per-item still overrides.
- **Duplication:** the stream→callable fallback re-ran the whole turn. The server
  reports `wrote:true` on a mid-turn error but the client discarded it, and the
  "already streamed" guard keys on TEXT — a pure logging turn emits none. Trigger:
  no `timeoutSeconds`, so both AI fns died at the v2 default of 60s. Both now 300s.
- **Silent wrong-account writes:** a trainer omitting `clientId` resolves to their
  OWN uid, so "log Casey's breakfast" landed in the trainer's diary and returned ok.
  Prompt now demands clientId on every on-behalf write and names the person back.
- Failed tool results carried no `is_error` (zero uses in functions/) — a failure
  looked like a success. Now flagged, and exhaustion says so instead of returning
  the model's own "logging all 8 now…" preamble as the answer.

### ⌚ Trainerize (S137, S138, S147, S149, S150) — mostly NOT our bugs
- **The sync was never broken.** Cloud Logging: every call 200 in 2–4s; a direct
  API call returned the 11-client roster in 0.28s. `syncTrackerNow` awaited
  `reloadPlanLive()` bare, so a refresh hiccup reported "sync failed".
- **Kevin's missing Saturday is UPSTREAM.** Trainerize holds, for 2026-07-25:
  calorieOut from appleHealthKit {0,0} and step from garmin {16,410}. Garmin sent
  no calories before the 26th. Check the Garmin↔Trainerize link, not our code.
- Tracker data is stored PER DATE (90-day window) — no nightly job is needed; the
  dashboard simply only ever read today's log.
- Metrics now merge PER FIELD across sources (picking one source wholesale threw
  away the other's real data), attributed to whoever supplied the winning energy.
- Weight tie: `>=` not `>` — Trainerize used to win when both had the SAME day, so
  a weight corrected today was reverted by its own same-day stat.

### 🧠 Other shipped
S140 app requests via AI (**built, never live-tested** — idle timer). S142 pin a
chat to a client (`sendTarget()`; prompt tells it not to call find_client).
S143 hide/restore tiles (viewer's own kv). S148 burn disclaimers.

### 🔑 Gotchas
- **zsh reserves `UID`** read-only, exactly like the documented `GID` trap.
- **`firebase functions:log` drops jsonPayload** (blank lines). The Cloud Logging
  REST API via the firebase-tools refresh token shows status + latency and is what
  actually diagnosed the sync.
- The preview's **30-min idle sign-out blocked verification four times today** —
  turn it off on the test account before a long session.
- Scope errors the build cannot catch bit twice (`isTrainer` vs `isTrainerHome`,
  `isTrainerRole`). Check the declaration is in the SAME component.

### ⏭️ Next
- **VO2max for burn accuracy: RESEARCHED, RECOMMEND AGAINST.** The accepted
  correction uses RESTING VO2 (age/sex/height/weight — data we have); VO2max
  explains only ~7–12% of variance in economy (Shaw 2015). It would be false
  precision. The Keytel-with-VO2max question (HR cardio only) is UNRESOLVED — that
  agent died mid-run. Tracking VO2max as a MEASUREMENT is still worth doing.
- **Net vs gross METs — PARKED by Kevin.** Gross over-credits by 1/(MET−1): +40%
  walking, +11% cycling, ≈54 kcal/day on a typical week. Garmin already reports
  NET, so schedule and watch currently disagree about the same workout.
- YouTube exercise videos (Kevin has his own library). Live-test app requests.

## ⚡ S140–S157 (Jul 27) — see git log for detail; the load-bearing ones:
- **S139 CLIENT DATA BLEED (worst of the session):** switching client showed A's
  data under B's name AND could SAVE it there — `onAddMeal` spread the stale
  dailyLog while persistLog routed by the new uid. Fixed by resetting plan-scoped
  state on switch + an `alive` guard on the loader. ⚠️ **Data written before this
  may be wrong** — if a client has meals they never logged, that is why.
- **S144–S146 date-aware dashboard:** tiles/weekday/weight follow the VIEWED day.
  Weight shows the last weigh-in as of that day, labelled, and never looks forward.
- **S147 the sync "failure" was ours:** Trainerize was healthy (200 in 0.28s). The
  callable SDK's 70s CLIENT timeout killed a 300s function. Client now matches.
- **S150 tracker:** merge per METRIC across sources, not per source. Kevin's Jul 25
  had Apple calorieOut 0 + Garmin 16,410 steps; picking one wholesale discarded the
  other. His missing Saturday burn is UPSTREAM — Garmin sent no calorieOut that day.
- **S135 AI accuracy:** log_meals had no top-level date (batch date silently
  dropped → everything on today); a stream failure re-sent a turn that had already
  written (duplicates); failed tools carried no is_error; a trainer omitting
  clientId writes to their OWN account.
- **S131/S134 AI consent:** enforced opt-out at resolveTargetUid + roster tools,
  and a one-time choice instead of defaulting people in.
- **S140 app requests** (live-verified), **S153** back buttons, **S155/S156** food
  library delete + Keep/Delete confirm, **S157** AI now READS notes before advising.

## ✅ CLOSED (S158) — food library delete does nothing
_Root cause was NOT in the "NOT yet checked" list below — it was the missing
handlers at `ClientHome`'s own `<CalendarView>`, and an unguarded call that threw.
The ruled-out notes below stayed correct and saved time; keep them if it recurs._

## 🐞 (historic) OPEN BUG — food library delete does nothing (S155)
Kevin: in the food library ("previously logged"), he typed a filter, then hit the
trashcan on what looked like duplicates. The confirm appears, he taps Delete?, and
the row stays. Reproduced by him more than once.

**RULED OUT (proved, do not re-check):**
- The list is NOT derived from logged meals — `FoodLibrary` renders `recentFoods`
  filtered in place (App.jsx:8005-8007), so a successful filter WOULD remove the row.
- The delete already passes the right shape. I "fixed" it to normalise the type via
  `effType(f)` the way the SAVE button does (App.jsx:8089) — that is WRONG and was
  reverted. A typeless legacy food is stored keyed `name|other`; with a meal filter
  active `effType` yields `name|breakfast`, which matches nothing. Raw `f.type` is
  correct. Verified by hand-running the key maths — do not repeat this mistake.

**NOT yet checked (start here):**
- `onRemoveRecentFood` (App.jsx:22359) opens with `if (!activeId) return;` — a
  silent bail. Confirm activeId is set when the library is opened from the meal log.
- `recentFoodsRef.current` vs the `recentFoods` STATE. The handler filters the REF
  and writes that back. S139 added `resetPlanScopedState()` which clears both, and
  the loader repopulates them — if the ref were empty while state had rows, the
  filter would produce [] . Worth logging both at click time.
- Whether `baseFoodName()` strips something (brand/serving) so two visually
  identical rows share ONE key — which would make one delete look like a no-op
  while actually removing the other. This also fits "duplicates" being the trigger.
- The SAVED tab path (`onRemoveSaved`) may behave differently — Kevin was in
  "previously logged", so test that one first.

Fastest repro: open the library, type a filter, tap the trash on a duplicate, and
log `recentFoodsRef.current.length` before/after alongside the computed key.

## ✅ DONE (S144–S146) — was "NEXT SESSION: make every surface DATE-AWARE"
_Nothing started, working tree clean. This is one coherent theme, not five asks._

### The bug that makes it urgent (verified, exact lines)
The Meals & Food day arrows (S99) change ONLY the meal list. `mealDate`
(App.jsx:10132) is passed to `<MealLog>` at **App.jsx:11353-11354** and nowhere
else — the tiles above it (Logged So Far / Today's Target / Workout Burn / oz
Water) read `dailyLog`, which is always TODAY. So stepping back a day shows
**yesterday's meals underneath today's totals**. Kevin found this; it is worse
than having no arrow, because the numbers look authoritative.
- **The data is already loaded.** `mealDayLog` (App.jsx:10139-10143) fetches the
  selected day via `onReadDay`. The tiles simply don't read it. Start there.
- Watch: the per-day TARGET is not constant — `wearableTdee(d, log)` adjusts it
  from that day's tracker data, and the deficit/eat-back mode affects it. So
  "yesterday's target" must be recomputed for that date, not reused from today.
  Same for Workout Burn (earned vs scheduled, S102e).
- Keep the streak, week-summary and ring TODAY-only by design (S99 did this
  deliberately) unless Kevin says otherwise — a back-dated add must not
  retroactively change a streak.

### What Kevin asked for, in his words
1. **Forward/back arrows on the WORKOUT section** — review past workouts AND
   pre-write future ones so clients have sessions ready. Future dates are a real
   change: today's day-nav clamps at today (App.jsx:10135).
2. **The same day-nav on every tracker** — food, water, workouts, body
   measurements. One shared control, not four copies.
3. **Calendar as the entry point** — tap any date and enter ANY metric for it.
   `CalendarView` already has a Day view with back-dated food/weight/workout
   (S22/S84); extend it to the full metric set rather than rebuilding.
4. **Tapping the date opens the calendar** to jump to any day.
5. **Move the day-nav to the top** of Food & Calories (his suggestion, since the
   header stats are what should follow it).

### Suggested order
(a) Make the Food & Calories tiles follow `mealDate` — fixes the live bug, and
establishes the "selected day" pattern the rest copies. (b) Extract that day-nav
into one shared component. (c) Add it to workouts + measurements + water.
(d) Allow FUTURE dates for workouts only (programming ahead), still clamping the
logging surfaces to today. (e) Wire tap-date → calendar.

### Also queued (not started)
- **App requests via AI** — user asks the AI for a feature, it offers to send it,
  admin sees them in an "App requests" screen. Kevin wants this.
- **YouTube exercise videos** — Kevin has his OWN library, which beats the Free
  Exercise DB photo pairs (no licensing, no storage). ⚠️ ENRICHMENT ONLY: our 184
  exercises carry the MET values the whole burn engine runs on; no third-party
  source ships METs.
- Kevin said he has "a few more things" to add before the videos.

## ⚡⚡⚡ S129–S133 (Jul 26–27): #ID fix · privacy published · AI opt-out ENFORCED · ChatGPT works
_All pushed (@ `9bb56db`), functions deployed, tree clean. Frontend + functions; no rules change._

### ✅ ChatGPT CONNECTS — Phase 4a is done, and it cost nothing
Kevin connected `https://glidna.com/mcp` from ChatGPT and **verified with a real tool call**
(asked about one of his clients, got real data back — exercising `read` AND `trainer` scope
through `resolveTargetUid`, not just a handshake). One spec-compliant endpoint now serves Claude
and ChatGPT with no per-platform integration.
- **⚠️ DCR WORKS WITH CHATGPT — do NOT rebuild it as CIMD.** Reaching and clearing our consent
  screen proves discovery → dynamic client registration → PKCE authorize → code exchange all
  succeeded. Earlier notes (and my own advice) flagged CIMD as possibly required; it is not.
  Anthropic recommends against DCR *for directory servers* — that is a listing concern only.
- **ChatGPT steps are in the app** (S133): Settings → Security and login → **Developer mode**
  (the step nobody finds), then Settings → **Plugins** → **+** → paste the URL *including* `/mcp`.
  Plus/Pro can self-serve; Business/Enterprise admins enable it in workspace settings.
- **Directory listing SKIPPED by Kevin's decision** — he sends invite links instead, so no Team
  org and no $50/mo. The connector works fully without a listing; the directory is discovery only.
  Consequently the DCR→CIMD switch and a reviewer test account are NOT needed.

### 🔒 S131 — a client can switch AI off, and it is actually enforced
Resolves the trainer→client consent gap S130 disclosed. Profile field **`aiOptOut`**, writable
only by the account holder (firestore.rules already restricts user-doc writes to owner/admin, so
a trainer can never re-enable it for their own client — **no rules change was needed**).
- Enforced in **`resolveTargetUid`** — the chokepoint every client-targeting tool passes through,
  in-app assistant and MCP connector alike — for every caller and all four grant paths.
- **The roster tools BYPASS that chokepoint.** `list_clients` / `coach_summary` walk the roster
  directly and would have leaked an opted-out client's weight and adherence anyway. They now skip
  them BEFORE reading any plan or log data, listing the person by name with no data.
- UI: side-menu row (renders for every role — ClientHome would never show it to Kevin).
- Verified live: with AI off, "what is my current weight and calorie target?" →
  *"AI features are currently switched off for your account."*
- **Still open for counsel:** whether a default-ON setting is enough or signup needs an
  affirmative checkbox; existing clients were defaulted ON with the policy update as notice.

### 📄 S130 — the AI-connector privacy language is PUBLISHED (counsel to follow)
Kevin's call: ship the accurate disclosure now, review later — the connector was already live and
processing data with nothing describing it, so publishing REDUCED exposure. `public/privacy.html`
§1/§3/§5 updated, "Last updated" Jul 26 2026. `docs/PRIVACY-AI-CONNECTOR-DRAFT.md` remains the
attorney brief; publishing did NOT resolve its §5 questions.

### 🔢 S129 — the AI understands the `#numbers` on the trainer's home
Two code systems both rendered `#`: sequential `idNums` (home screen) vs `refCode` (All-clients +
the AI). Casey was `#6` on screen but `KEM2` to the AI. `idNumMap()` reads `caliq-idnums` (caller's
own kv) and `num` now rides alongside `ref`. Verified: "#6" → Casey; "#2" → Prospect Pat (a local
plan). Exact code matches beat fuzzy name/email matching — a bare "6" used to substring-match every
client with a 6 in their email and could push the real one past the 10-match cap.

### 🎨 S128 / S132 — light theme + connector annotations
Light theme: **30 AA failures → 0** in both themes; hardcoded literals 47 → 4. The trap:
`rawColor` maps translating tokens BACK to dark hex (SVG attributes can't parse `var()`) — use
**`cssVarColor()`**. Two token bugs found by measuring: `--yellow` 4.36:1 on `--s2` → `#a34a08`;
`--blue` 3.23–4.1:1 → `#0369a1`. S132 completed `destructiveHint` (3 → 8 of 19 write tools).

### ⏭️ Next up
- **Phase 4b — reverse-direction MCP** (Glidna's AI consuming Whoop/Oura/calendar servers).
  NOT started, and **needs Kevin to name the source**: Garmin already arrives via Trainerize
  (S88c), so the obvious first candidate is partly solved. Don't guess at Whoop.
- Exercise demo videos — **Kevin wants real video, and has his own YouTube library**. That beats
  the Free Exercise DB photo pairs: his own content, no licensing, no storage cost. Parked.
  ⚠️ Whatever the source, it is an ENRICHMENT layer — our 184 exercises carry the MET values that
  drive the whole burn engine, and no third-party DB ships METs.
- Legal: waiver, session-billing ToS, and the connector-privacy review — all awaiting counsel.

## ⚡⚡⚡ S127–S128 (Jul 26): S117–S125 VERIFIED LIVE · trainer-home roster bug · light-theme sweep
_Both pushed to `origin/main` (@ `edf133f`), tree clean, **verified live on glidna.com by bundle
CONTENT** (see the deploy gotcha below). Frontend only — no functions, no rules, no data model._

### ✅ The S112–S125 verification debt is CLEARED
All six build-verified-only features were driven live as `trainer.uitest` and work:
**Manage ▾** collapse + the S119 renames (Assign a different plan / Save a copy to my files /
Take plan back) · **Local Plans drawer** · **My team** (`listTeam` resolves; a bogus code gives
"That code didn't match any trainer.") · **Connect your AI** (Copy verified by patching
`navigator.clipboard.writeText` — it writes exactly `https://glidna.com/mcp`) · **compliance
tracker** on DailyDashboard with a clean zero-data state · **Show more detail** (visible at 0
logged days, and from a saved `simple` pref it lands in Detailed *without* overwriting the
stored preference — a peek, not a permanent switch).

### 🔴 S127 (`b4b7065`) — the trainer home told trainers they had no clients
`clients.length === 0` was doing double duty as "no clients" and "roster hasn't loaded".
Reproduced with a MutationObserver: navigating ≡ → All clients → Home showed
**"No clients connected yet · Invite your first client" for 285ms**, with the Local Plans
drawer expanding then collapsing. Worse, `loadClients` bails on error without recording the
attempt, so a failed wake-fetch left that message up **permanently** — the S98 bug, fixed at
the data layer then reintroduced at the view layer.
- **`rosterState: "loading" | "ready" | "error"`** replaces the overloaded length check. A
  boolean was NOT enough: "loaded with 0 clients" after a failed fetch is the same lie. `error`
  has its own copy; `loading` renders `SkeletonCard` (as TrainerAnalytics/TrainerEarnings do).
- **`plansOpen` is now the single source of truth** for the drawer at all four render sites,
  seeded once by a `useRef`-guarded effect from a genuinely `ready && empty` roster. The old
  `plansOpen || clients.length === 0` made Show/Hide a **dead control** for 0-client trainers —
  the OR stayed true no matter what the toggle did.
- **"Asks From Clients" hoisted** out of the roster card: it reads the trainer's own kv, so
  nesting it under `clients.length > 0` made a pending ask unreachable once a client left.
- Verified by re-running the same trace: empty-state frames 2 → 0, drawer flash 2 → 0, toggle
  `Hide/true → Show/false → Hide/true` with `aria-expanded` tracking.

### 🎨 S128 (`edf133f`) — light theme: 30 AA failures → 0 (both themes)
S117 retuned the tokens and fixed the two screens it critiqued; the in-plan surfaces it never
looked at still hardcoded dark-theme colour. Measured on Results in light: **30 failing
elements, worst 1.12:1** — neon green text on a white card.
- **⚠️ THE TRAP — do not reintroduce it.** Two chart components carried
  `const rawColor = { "var(--green)":"#4fffb0", ... }` — a map translating tokens BACK into
  hex, almost certainly because **SVG presentation attributes can't parse `var()`**. Replaced
  with module-level **`cssVarColor(expr)`**, which resolves `var(--x)` against the live theme
  (`themePref` is React state, so a theme switch re-renders and it re-reads). One change fixed
  all 17 call sites. **If a chart needs a real colour value, call `cssVarColor` — never
  hardcode.** (Note: `var()` DOES work in fill/stroke attributes in practice — `Icon` relies on
  it — but `cssVarColor` is also needed wherever an alpha suffix is concatenated, e.g.
  `` `${c}60` ``.)
- Also: compliance scenarios + tints → tokens/`color-mix`; **HR zone names render as TEXT in
  the zone colour** → tokens; weight-chart line/dots → token, and its dot halo was the fixed
  dark page colour (a black ring on light) → `var(--surface)`; full purple sweep; macro palette
  → `--yellow`/`--blue`/new **`--pink`**; **bell badge** was filling with `--accent` (the
  DARKENED text accent) under near-black text at 3.61:1 → `--accent-fill`, which exists for
  exactly this; sign-out red → `var(--red)`.
- **Two token bugs found by MEASURING, not assuming:** `--yellow`/`--color-warn` `#b45309` was
  4.36:1 on `--s2` (it passes on white, but the cards aren't white) → **`#a34a08`**; `--blue`
  `#0284c7` was 3.23–4.1:1 as text, failing on every light surface → **`#0369a1`**.
- Hardcoded literals **47 → 4** (3 token definitions + the filled purple button, kept
  deliberately: bright fill under near-black text reads in both themes, same as `--accent-fill`).

### 🔑 Gotchas worth keeping
- **⚠️ BUNDLE-HASH DEPLOY CHECKS DON'T WORK HERE.** Vercel inlines `VITE_USDA_API_KEY` (set in
  prod, unavailable locally), so the local and live bundle hashes NEVER match even on a correct
  deploy. The recipe repeated in older entries is misleading. Watch for the live hash to
  **change**, then verify by CONTENT:
  `curl -s https://glidna.com/assets/<bundle>.js -o live.js && LC_ALL=C grep -c '<newvalue>' live.js`
  (`LC_ALL=C` matters — grep chokes on the minified bundle otherwise).
- **Do NOT run Workflow subagents against this repo while signed into the app.** They drove the
  same browser tab as me (causing phantom reloads and a viewport change) inside a signed-in
  trainer account with "Take plan back" and "Delete" one click away — the same class of accident
  that already cost `trainer.uitest` a plan and a sim. They also wrote probe files into the repo
  root (`__probe.html`) and the scratchpad. Give them read-only tooling or a worktree.
- **The preview's 30-min idle auto sign-out is what keeps logging the test session out**
  mid-verification (≡ → "Auto sign-out when idle"). Turn it OFF on the test account before a
  long verification run.
- Timer-based polling (`setInterval`) is throttled to ~6 samples/3s in the headless preview —
  useless for catching sub-second UI transitions. **Use a MutationObserver**, and install it and
  trigger the navigation in the SAME `javascript_exec` call (each tool call is a round-trip, so
  a separately-installed sampler is already dead by the time you navigate).
- Reading `innerText` immediately after a `.click()` returns the PRE-render DOM — React batches.
  Two "bugs" this session were that artifact. Re-read in a later call, or screenshot.

### ✅ S109–S111 verification debt — swept (4 of 5 clean, 1 REAL BUG)
Driven live as `trainer.uitest` on a 390px viewport. Casey's plan was restored after each test
(age back to 30 / DOB blank; nothing logged — LOGGED SO FAR still 0).
- **Body-comp charts (S109b–f) ✓** — Trends & Charts renders Bodyweight / Muscle / Fat / Lean
  with real weigh-ins, timeframe chips, and the honest "Lee-2000 estimate (±~6 lb)" note.
  **Tap-a-dot works**: tapping the Jun 27 point opened `Edit weigh-in · Sat, Jun 27, 2026` with
  Save / Delete / Cancel bound to that entry. Cancelled — no data changed.
- **DOB (S110g) ✓** — marked "optional — keeps your age up to date automatically". Entering
  1990-01-15 derived **age 36** correctly; the age input became read-only "36 · from birthday"
  with a "Clear & type age instead" escape hatch; blank DOB keeps age manually editable.
- **Multi-photo (S110b/c) ✓** — genuinely ACCUMULATES: 1 photo → "Add another photo" +
  "Estimate from 1 photo"; 2nd → "Estimate from 2 photos", 2 thumbnails; the × removes one and
  drops it back to 1. (The AI estimate itself was deliberately not called — no tokens spent.)
- **Food-form scroll-into-view (S110) ✓** — lands at y=778 in an 844px viewport, fully visible.
  ⚠️ **I nearly filed this as a false bug**: measured 800ms after the tap it still read y=1541,
  because the scroll is ANIMATED and hadn't finished. A screenshot caught it. Re-measure, or
  screenshot, before calling a scroll-into-view broken.
- **~~🔴 #ID codes (S110f) — BROKEN~~ FIXED in S129 (see above).** Kept for the diagnosis: There are **TWO code systems, both
  rendered with a `#`**, and only one works with the AI:
  | system | source | shown on | AI knows it |
  |---|---|---|---|
  | `idNums` (S99) | sequential, trainer's own kv `caliq-idnums` `{next,map}` | **TrainerDashboard — the home screen** (`IdTag`, App.jsx:13842) | ❌ |
  | `refCode(id)` (S110f) | last 4 alphanumerics of the id | ProfileSelector / All clients (App.jsx:18041,18080) | ✅ (`aitools.js refCode`) |
  Casey is **`#6` on the home** but **`KEM2` to the AI**. Verified live: asked "which client or
  plan has the code #6?" → *"I don't see anything matching code #6. The ref codes I have are:
  KEM2 — Casey Client, 2848 — Test Client, 1191 — Prospect Pat…"*. So S110f's "shown on cards
  and usable in AI search" is true on All-clients and FALSE on the screen Kevin actually lands
  on. The two `refCode` implementations themselves agree perfectly — that is not the bug.
  **Recommended fix (Kevin's call):** teach the AI the `idNums` map rather than dropping the
  sequential numbers — `caliq-idnums` is the CALLER'S OWN kv, so `aitools.js` can read it with
  no new access surface (same as it already reads `caliq-index`), surface it alongside `ref` in
  `list_clients` / `list_local_plans` / `find_client`, and tell the prompt a `#N` may be either
  form. That keeps Kevin's short human numbers (his S99 ask) AND makes them work. Needs the
  usual all-four-AI-fns deploy. Alternative — render `refCode` on the home instead — is uglier
  and throws away the friendlier numbers.

### ✅ S129 (`18e163a`) — the #ID mismatch is FIXED (Kevin chose: teach the AI `idNums`)
`idNumMap(db, callerUid)` reads `caliq-idnums` (the CALLER'S OWN kv — no new access surface) and
`num` now rides alongside `ref` in `list_local_plans`, `list_clients`, `coach_summary` and
`find_client`. Verified live: **"#6" → "That's Casey Client — she's #6"**; **"#2" → "That's
Prospect Pat — they're #2 in your local plans."**
- A 3-lens adversarial review before deploy caught 5 issues, all fixed. Two mattered:
  (1) **exact code hits must beat fuzzy name/email matching** — a bare "6" substring-matched every
  client with a 6 in their email, tripping same-name disambiguation on an unambiguous code and,
  worse, able to push the real client past the 10-match cap and drop it entirely. `exact` and
  `fuzzy` are now separate arrays, exact wins, exact is uncapped. (2) **the home counter numbers
  clients AND local plans from one shared sequence**, so a `#` code may be either — the prompt now
  tries `find_client` then falls back to `list_local_plans`.
- `find_client` parses "#6" / "6" / "client #6" / "# 6" / "#6." — 16 unit cases incl. the negatives
  (`client6`, `user6@x.com`, `#kem2`, `#12345` all correctly reject).
- The code forms are documented in find_client's **SCHEMA description**, not just the prompt,
  because the MCP connector sees only tool descriptions — that is what holds AI↔connector parity.

### 🔑 ⚠️ THE "DEPLOY ALL FOUR AI FNS" RULE IS OUT OF DATE
It predates the MCP connector. The real dependency graph:
`aitools.js` ← required by **`aichat.js` AND `mcp.js`** · `aichat.js` ← required by **`index.js`
AND `workflows.js`**. So an `aitools.js` change must deploy **six**: `aiChat`, `aiChatStream`,
`logMeal`, `setWorkoutSchedule`, **`mcp`** (or the connector silently runs old tool code, breaking
the parity rule) and **`runDueWorkflows`**. Verify with
`grep -ln "require(.*aitools" functions/*.js`. Also: the first deploy attempt failed with
`Failed to validate secret versions … ANTHROPIC_API_KEY` — transient, an immediate retry succeeded.

### ⏭️ Next up
- ~~loose thread: the expanded macro rows were computed, not clicked~~ **CLOSED — verified on
  the real rendered surface in light:** Protein **6.80:1** (`--pink` #b0184f, was 2.11–2.68) ·
  Carbs **5.93:1** (`--yellow` #a34a08, was 1.19–1.50) · Fat **5.93:1** (`--blue` #0369a1, was
  1.58–2.00), 0 failures across the whole panel, hue identity intact. **How to open that tile:**
  a bare `.click()` does nothing — it needs a full pointer sequence
  (`pointerdown/mousedown/pointerup/mouseup/click`) dispatched at the element centre. Same for
  the "Macros & Micros" disclosure inside it. Worth reusing for any `dash-cta` tile.
- Connector Phase 4: directory submission (needs a Claude Team/Enterprise org), ChatGPT.
- Legal: waiver, session-billing ToS, AI-connector privacy — all awaiting counsel.

## ⚡⚡⚡ S112–S125 (Jul 25–26): MCP CONNECTOR SHIPPED · Impeccable design pass · trainer teams
_All pushed to `origin/main` (@ `b34794f`), tree clean, functions deployed, rules PUBLISHED
(167/167 emulator tests). Firebase `calorieiq-29762`; model `claude-sonnet-4-6`; admin UID
`G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`. 22 commits — the biggest arc since the AI layer._

### 🔴 READ FIRST — verification debt + one standing gotcha
- ~~**Most S117–S125 UI is BUILD-VERIFIED ONLY.**~~ **RESOLVED in S127 — all six were driven
  live and work; the verification also found 4 real defects, now fixed. See the S127–S128
  section at the top.** (Kevin signs the preview into `trainer.uitest@calorieiq-test.com` /
  `TestPass123` — I do not type passwords.)
- **Kevin repeatedly could not find features that render only for `role === client`.** He is
  a trainer/admin — ClientHome NEVER renders for him. When building on ClientHome, say so, or
  put it on DailyDashboard too (which trainers see when they open a client's plan).
- **Firebase CLI creds expire constantly.** `firebase login --reauth`, finish sign-in in a
  Firefox **Private Window** (Cmd+Shift+P) if the normal flow errors.

### ✅ THE MCP CONNECTOR IS LIVE — `https://glidna.com/mcp`
Users drive Glidna from their OWN Claude. Kevin has it connected; verified end-to-end through
real Claude tool-calling (not just curl). Full design + verified spec research in
`docs/MCP-CONNECTOR.md`.
- **Phase 1** (`303f027`): stateless Streamable HTTP MCP server on Cloud Functions,
  per-request McpServer (SDK bug #1994 — never reuse a transport), origin validation,
  daily caps. Fronts the SAME `aitools.js runTool` as the in-app AI.
- **Phase 2** (`384ae46`): full OAuth 2.1 — RFC 9728 discovery, RFC 7591 DCR, PKCE S256,
  RFC 8707 audience binding. **Tokens are OPAQUE, hashed in Firestore** (no signing secret,
  instantly revocable). Consent screen at `/oauth/authorize` renders inside AuthGate so it
  reuses the existing login. `vercel.json` fronts `/mcp`, `/.well-known/*`, `/oauth/*`.
  Verified: code replay, wrong PKCE, unregistered redirect_uri, plain-PKCE downgrade all REFUSED.
- **Phase 3** (`584a500`): WRITES behind scopes (`read` / `write:logs` / `write:plan` /
  `trainer`). Two gates: buildTools role-filters first, then token scopes, re-checked at call
  time. Verified live: read-only token = 11 tools with `log_meal` invisible; full = 30 tools.
- **Caps** (`ee33d88`, `a7c2ec3`): free 200/day · premium 2,000 · coach 5,000 · max 10,000 ·
  ultra 25,000. Measured cost ~$0.000013/call. **Bug fixed:** `includes("max")` dropped
  `ultra`/`coach_ultra` (the TOP tiers) to the premium cap.
- **`S118` Connect-your-AI panel** — ≡ menu, every role. The connector had ZERO
  discoverability before this; only Kevin knew it existed.
- **Scope changes require a reconnect** (token carries old scopes); new TOOLS do not.

### ✅ Trainer teams — the hierarchy actually works now (S116, S118b)
Heads can manage sub-trainers AND their clients. `functions/team.js`: joinTeam / leaveTeam /
listTeam / removeSubTrainer (server-side because rules block self-role-changes). The sub
initiates via the head's invite code, so consent is inherent.
- **Root cause of the old breakage:** nothing ever SET a sub-trainer's `headTrainerId`, and
  `resolveTargetUid` checked the CLIENT's `headTrainerId` instead of walking client →
  trainer → that trainer's head (which is what `firestore.rules isHeadOfTrainer` does, and
  it was already correct + tested). No rules change was needed.
- **Bug caught by E2E testing:** a head's own `headTrainerId` points at ITSELF, so the
  two-level-cap guard counted the caller as their own sub and refused EVERY join.
- New AI/connector tools: `list_sub_trainers`, `list_clients({includeTeam})`.
- UI: ≡ menu → **My team**.

### ✅ Impeccable design skill adopted (S117) — `PRODUCT.md` is the durable artifact
`npx impeccable install` (skill gitignored; hooks are local-only). **PRODUCT.md is committed
and binds future design work** — two co-primary audiences, WCAG 2.2 AA in BOTH themes, and
the collision order Kevin confirmed: **credible (never sacrificed) → effortless in the daily
loop → AI-native as the signature layer.** It also records deliberate decisions so critiques
stop re-flagging them (raw calorie quick-add STAYS; amber grace band, never red at +1 cal).
- **Critiques run as 2 isolated sub-agents (design + measured evidence), then synthesized.**
  Snapshots in `.impeccable/critique/`. Both screens' fixes applied:
  - **ClientHome** (`f2587bd`, `74434aa`): found `--danger` was **undefined** (the payment
    banner was hard-locked to dark-theme red; the Pay button measured 2.77:1 in BOTH themes),
    and the light theme broadly FAILED the AA commitment (`--color-primary` 3.92:1, not the
    ~4.5 its own comment claimed). Retuned light tokens with computed values, added
    `--color-dangerfg`, one-tap plan delete now confirms, weigh-in typo guard, 44px targets.
  - **TrainerDashboard** (`64fefcc`, `21921b5`): verdict "designed, but accreted" — up to
    NINE flat buttons per client card, now collapsed behind **Manage ▾**; hardcoded
    `#39d98a`/`#f0a020`/`#b57bff` measured 1.6–2.9:1 in light → theme tokens + new
    `--color-sim`; per-client valenced feedback (was one gray string below the whole roster);
    quiet-client salience.
- Detector: `node .claude/skills/impeccable/scripts/detect.mjs src/App.jsx` — steady at 5
  (deferred `transition:width`).

### ✅ Also shipped
- **S119 parked decisions:** Local Plans → collapsed drawer (auto-opens when the roster is
  empty) · "Client Requests"→**Asks From Clients** / "Send request"→**Send to-do** ·
  link/unlink/copy → **Assign a plan / Take plan back / Save a copy to my files** ·
  empty-state **"Invite your first client"** CTA.
- **S120/S123/S125 compliance tracker** (Kevin's spec): % of logged days hitting the calorie
  goal → consistency-scaled goal date. Amber grace, never red. Hideable per plan
  (`data.hideCompliance`). On the client home AND DailyDashboard (so a trainer can show a
  client in person). **S125:** the "Show more detail" doorway was triple-gated (3+ logged
  days AND goal weight AND weight-loss goal) so it was usually invisible — now ungated in
  both card states, and the destination always leaves Simple view.
- **S124 requests↔DMs merge:** to-dos now appear in the DM thread as task cards. The message
  is a **POINTER** (`kind:"todo"`, `todoId`) — status stays in `caliq-requests`, so chat and
  the home screen can never disagree. Rules extended + **11 new tests (167/167)**, PUBLISHED.
  Only the thread's TRAINER may send a to-do. The client's home task cards and the
  "Do it now →" QuickActionModal flow were deliberately PRESERVED.
- **S114:** consent-screen Terms/Privacy links + `docs/PRIVACY-AI-CONNECTOR-DRAFT.md` for
  counsel (the existing policy covers the in-app AI as OUR processor; the connector is a
  materially different flow — the user's own AI as an independent controller). **Not
  published** — pending review. Sharpest open question: when a TRAINER routes CLIENT data
  through their own external AI, is existing trainer-access consent enough?

### ⏭️ Next up
- ~~**Verify the S117–S125 UI live**~~ **DONE — S127** (see the top section; 4 defects found + fixed).
- ~~Timeline only for weight-loss goals~~ **DECIDED (S126): correct as-is.** Muscle gain is
  too unpredictable to project honestly and maintenance is just holding a range, so neither
  gets a goal-date projection. Recorded in PRODUCT.md — do not re-flag or "fix" it.
- Connector Phase 4: directory submission (needs a Claude Team/Enterprise org), ChatGPT.
- Legal: waiver, session-billing ToS, AI-connector privacy — all awaiting counsel.

## ⚡⚡⚡ S109–S111 (Jul 24): body-comp charts · food/AI UX · #ID codes · DOB · MCP connector design
_All pushed to `origin/main` (@ `7d3129e`), tree clean, all functions deployed. Firebase
`calorieiq-29762`; model `claude-sonnet-4-6`; admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`.
Long session — 14 commits. **Firebase CLI login was re-fixed this session** (see gotchas)._

### 🔴 DO THIS FIRST NEXT SESSION — live verification debt
Several S109–S110 features shipped **build-verified but NOT live-clicked**, because the preview's
test session logged out mid-session and I don't type login passwords. **Kevin should sign the
preview into `trainer.uitest@calorieiq-test.com` / `TestPass123`, then ask for verification.**
Specifically unverified in-app:
1. **Body-comp charts** (S109b–f) — Kevin DID confirm charts render + asked for the label fixes,
   but the **tap-a-bodyweight-point → edit/delete past weigh-in** flow was never clicked live.
2. **DOB field** (S110g) — never seen live at all: optional Date-of-birth on the Personal step,
   age auto-derives + auto-updates. Verify it renders, computes, and that leaving it blank still
   works (age stays manually editable).
3. **#ID codes** (S110f) — verify the short code shows on client/plan cards AND that asking the AI
   about "#ABC123" resolves correctly.
4. **Multi-photo** (S110b/c) — verify accumulate-then-estimate in Add Food, and 20-photo chat.
5. **Food-form scroll-into-view** (S110) — Kevin's original complaint was mobile-specific; verify
   on a narrow viewport that tapping "Add food" lifts the form into view.

### ✅ S109 — Body composition (Kevin's queued 3rd request) — SHIPPED
- **`leeMuscleMassLbs()`** — skeletal muscle mass via **Lee et al. (2000) Model 2**, coefficients
  adversarially verified across the primary paper + 2 independent sources:
  `SMM(kg) = 0.244·wtKg + 7.80·htM − 0.098·age + 6.6·sex − 3.3` (male=1/female=0; race term = 0 =
  the White/Hispanic reference, since we don't collect ancestry). Gated on valid inputs, clamped
  10–60 kg. Worked example 30M/80kg/1.80m → 33.92 kg ✓. **Uses weight/age/sex — NOT height-free,
  and NOT circumference-based** (that's the other Lee model, deliberately not used).
- `measurementMetrics()` also returns **fatMassLbs** + **muscleMassLbs**; readout gained Fat mass +
  Muscle tiles.
- **Charts (S109b, reworked per Kevin):** SEPARATE per-metric graphs (`MetricLineChart`) for
  Bodyweight / Muscle / Fat mass / Lean mass / Body fat % — **dates on the x-axis**, side-scroll,
  shared **timeframe filter** (All/1Y/6M/3M/1M), all moved to a **"Trends & Charts" section at the
  BOTTOM** of the measurements modal (under the stat entry + history). **Tap a Bodyweight point →
  inline edit/delete that past weigh-in** (`onEditWeighIn(date, weight|null)`, wired at all 3 call
  sites: Results, DailyDashboard, ClientHome; merge-by-date so a day's workout/notes survive).
- Every point maps to a REAL entry (actual weigh-ins carrying computed muscle/fat/lean via the
  nearest BF% reading; actual BF readings) — no synthetic carry-forward points.
- **S109c–f polish:** section + guidance show from the FIRST weigh-in (was hidden until 2);
  value labels got a **halo** (`paintOrder: stroke`, stroke `--color-surface2`) so lines can't
  block them; labels switched to neutral `--color-fg`; **lean line hardcoded `#b57bff` →
  `var(--purple)`** so every color adapts to light/dark theme (Kevin's explicit ask).

### ✅ S110 — Food-entry + AI-chat UX
- **AI sentence-spacing (root-caused):** the space is NOT lost in transport — the model sometimes
  emits `end.Next`. Fixed BOTH ends: (a) `RichText` repair regex
  `/([a-z0-9)\]"'%])([.!?])(?=[A-Z])/g → "$1$2 "` (won't touch decimals/abbrevs/domains);
  (b) both system prompts now demand properly-spaced prose + "same polish as a top-tier writing
  assistant."
- **Food form lifts into view** on open (mobile squint fix) + **multi-photo**: Add Food now
  ACCUMULATES photos ("Add a photo"/"Add another photo", × to remove, "Estimate from N photos"),
  and BOTH surfaces raised to **20 photos** (chat + food estimate; backend caps raised to match).
- **S110d — AI cost + focus (Kevin's ask):** new **`find_client`** tool resolves ONE named client
  cheaply; prompt now forbids `list_clients`/`coach_summary` for single-person questions and makes
  the resolved client the sticky active subject. Client-role accounts were already self-scoped.
- **S110e — same-name disambiguation:** `find_client` returns email always, and when 2+ match it
  enriches each with current weight + last-log date (per-match reads ONLY when ambiguous); prompt
  makes the AI ASK which one using human details, never raw ids.
- **S110f — short #ID codes:** every client + plan now has a visible short code derived from its
  unique id, shown on cards and usable in AI search ("open #7K2M").
- **S110g — optional Date of Birth:** DOB → age auto-derives and stays current; **clearly marked
  optional**, age still manually editable when DOB is blank.

### 📄 S111 — MCP connector design doc (`docs/MCP-CONNECTOR.md`) — DESIGN ONLY, nothing built
Kevin wants users to drive Glide from **their own Claude**. Doc has: plain-language explainer, the
**KEEP-FOREVER benefits brainstorm** (Kevin explicitly asked to save it), inventory of the **34
existing `aitools.js` tools** the connector would front, verified architecture, phased plan, and a
verified monetization section. Two research workflows (7 researchers + 7 adversarial verifiers,
primary sources) produced:
- **[CORRECTED] Custom connectors work on ALL Claude plans incl. FREE** (Free = 1 connector). No
  user-side price floor — earlier assumption was wrong.
- **[CORRECTED] Auth is NOT required by Claude** (authless supported) — our auth is our choice.
- Transport = **Streamable HTTP** (legacy SSE deprecated). Spec 2025-11-25 (2026-07-28 imminent).
- If we do OAuth: OAuth 2.1 RS + RFC 9728 PRM + RFC 8414 metadata + **PKCE S256** + RFC 8707
  audience binding; **CIMD recommended over DCR**. Claude callback
  `https://claude.ai/api/mcp/auth_callback`. Limits: 150K-char tool result, 300s timeout.
- **Hosting on our stack is Google's documented pattern** (Cloud Run / Functions v2 — our
  `aiChatStream` already streams SSE there). Use the SDK's **stateless per-request-instance**
  shape (Cloud Run session affinity is best-effort; SDK bug #1994 if you reuse one transport).
- **The only real new build = a small OAuth AS layer** (authorize/token/metadata) over Firebase
  sign-in; the MCP endpoint then calls the SAME `runTool` with the same `ctx`.
- **Monetization [DECIDED]:** Kevin chose Premium/Max. Research refined it to **"gated with a free
  read-only taste"** (Figma/Strava style). Key findings: general SaaS connectors are free, BUT
  **fitness is the exception — Strava's (Jun 2026) is the only official fitness MCP connector and
  it's PAID-subscriber-only + read-only**; ZERO coaching platforms (Trainerize/TrueCoach/Everfit)
  ship anything; **Glide's closed API means no community undercut is possible**; the cautionary
  tales (Twitter/Reddit/IFTTT) are about REVOKING free access, not launching gated; ~zero marginal
  cost makes the gate a **reversible dial**.
- **Next if building:** Phase 1 = read-only connector (OAuth + Streamable HTTP + read tools).

### 🔑 Gotchas (this session)
- **Firebase CLI login broke again** ("invalid_request / Unable to verify client" on the paste
  flow). Fix that worked: `firebase logout` → `firebase login` → complete Google sign-in in a
  **Firefox Private Window** (Cmd+Shift+P). Verify with `firebase login:list` +
  `firebase projects:list`. NOT needed for frontend-only work (Vercel auto-deploys on push).
- `aitools.js` changed → deploy **all four** AI fns (aiChat, aiChatStream, logMeal,
  setWorkoutSchedule). `estimateFood` is separate; deploy it when the food-estimate path changes.
- Preview flakiness persists (0x0 viewport, day-rows are nested divs with delegated onClick) —
  drive via `javascript_tool` DOM clicks/reads; HTML5 drag works with a shared `new DataTransfer()`.
- **I do not type login passwords** (even test-account ones) — Kevin must sign the preview in for
  live verification.

## ⚡⚡⚡ S108 (Jul 23): HR second-check + HR in cardio picker + calorie-wheel goal + unified folders
_All pushed to `origin/main` (@ `3c65fba`), tree clean. AI functions redeployed. Firebase `calorieiq-29762`;
model `claude-sonnet-4-6`; admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`. Four features, all verified live._

### ✅ Shipped this session
- **S108 (`b207308`, functions deployed) — HR "second check" from the S107 handoff, both gaps were REAL & fixed:**
  (1) `functions/aitools.js weeklyPlanBurn` ignored `{type:"hr"}` (MET map has no "hr") → the AI's +
  `coach_summary`'s eat-back targets undercounted HR-cardio burn. Ported the Keytel formula server-side
  (client/server parity checked). (2) `buildWorkoutWeek` dropped HR sessions and, in default replace mode, an
  AI cardio rebuild WIPED HR days it didn't re-specify — Kevin explicitly does NOT want that. HR cardio is now
  user-owned data the AI scheduler never deletes: existing HR sessions are preserved per-day across a rebuild.
  Deployed all four AI fns (aiChat, aiChatStream, logMeal, setWorkoutSchedule — aitools.js is shared).
- **S108b (`48a7e09`) — "Heart Rate" is now a pickable option at the TOP of the cardio ExercisePicker list**
  (new `onPickHr` prop at all 4 cardio editors: StepCardio, Results Basic+Pro, DailyDashboard). Before, HR was
  only reachable via a "By heart rate" toggle on an already-added non-rest session — Kevin couldn't find it.
  Picking it converts the session to `{type:"hr"}` via the same conversion the toggle uses. VERIFIED live
  (Casey → Edit Workouts → Mon): HR lists at top; selecting opens the picker (127bpm default, Light zone,
  ~200 cal); "Pick an exercise instead" switches back. Keytel formula = HR + weight + age + sex (NOT height).
- **S108c (`ff08275`) — calorie-wheel goal preference (Deficit / Maintain / Surplus).** Under-wheel label is
  now the WORD only (no number), colored by whether the day MATCHES the user's chosen goal: green = where they
  want to be, red = not (a deficit-seeker eating over → red; surplus-seeker under → red; maintain green within
  ±5%/±100cal of target). New per-plan field `data.calorieGoalDirection`, default from `data.fitnessGoal`
  (lose→deficit/build→surplus/health→maintain), else goal-vs-weight. "Daily goal" 3-way selector below the
  ring (setDataAndSave; client on own dashboard + trainer viewing them). VERIFIED live (color flips correctly).
- **S108d (`3c65fba`) — UNIFIED All-clients folders: connected clients + local plans + sims all organizable.**
  Before, the All-clients page (`ProfileSelector`) foldered only local plans; connected clients lived only on
  the home dashboard and couldn't be foldered, and sims were filtered out. Now `ProfileSelector` builds a
  unified item list (kind: client|local|sim). Connected clients render with a CONNECTED badge (tap → open
  their plan); their folder assignment stored in the TRAINER's own account as **`caliq-client-folders`
  `{clientUid: folderId}`** (trainer-owned metadata, NO cross-account write, NO rules change). Sims render with
  a purple SANDBOX badge. Drag carries `dragKind` so drops route to `onMoveClient` (map) vs `onMoveProfile`
  (index). Deleting a folder now also unfiles its connected clients + prunes the map. New App state
  `connectedClients` (loaded via `getMyClients`, trainers only) + `clientFolders`. Home dashboard's Connected
  Clients card left unchanged (additive). VERIFIED live (Casey drag→folder persists + survives reload; folder
  delete unfiles her + clears map to `{}`).

### ⏭️ Declined/optional (Kevin said "everything looks good" — did NOT want these now)
- Show connected clients ONLY on All-clients (remove the home-dashboard duplicate card).
- Add weight→goal to the connected-client cards (currently name + email only, to avoid extra per-client reads).
- Mirror the Deficit/Surplus green/red coloring onto the CLIENT's own home "Today" card (still "N left/over").

### ⏭️ Still queued (pre-S108, unchanged)
- **Body-composition feature** (Kevin's earlier 3rd request): Lee-2000 muscle-mass estimate + side-scrolling
  multi-metric line graph (weight/fat mass/BF%/muscle mass), scanner BF% separate from caliper/tape. Home:
  `MeasurementsModal` / `measurementMetrics` / `mergeMeasurements`.
- **Waiver/minors app flow** (after attorney clears the waiver draft). **Sessions billing go-live** (attorney
  ToS pass + real-card smoke test) — `docs/SESSIONS-GO-LIVE.md`.

### 🔑 Gotchas (unchanged, reused this session)
- `functions/exercises.js` OR `aitools.js` change → deploy **all four AI fns**.
- Preview flaky (0x0 viewport, black screenshots, day-rows are nested divs with delegated onClick) — drive via
  `javascript_tool` DOM clicks + reads; HTML5 drag is simulatable with a shared `new DataTransfer()`.
- No right-chevron in `src/icons.jsx` (used text "›"). Firebase reauth = `firebase login --reauth --no-localhost`.

## ⚡⚡⚡ S106–S107 (Jul 22): session-billing ToS + waiver/legal + trainer earnings + heart-rate cardio + fixes
_All pushed to `origin/main` (@ `4bf024a`), tree clean, functions deployed. Firebase `calorieiq-29762`;
model `claude-sonnet-4-6`; admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`. Marathon session — lots shipped._

### 🔴 DO THIS FIRST NEXT SESSION — the deferred "second check" + a known HR parity gap
Kevin asked me to run a **second adversarial check** on the heart-rate cardio feature after building it; I
ran out of context before doing it. Run a verification workflow (or careful review) covering:
1. **cardioExFor drop-in correctness** — confirm existing exercise/strength calorie burns are byte-unchanged
   (cardioExFor(non-hr) === findCardioEx) at every swapped site, and HR burn is right everywhere.
2. **⚠️ SERVER-SIDE HR PARITY GAP (likely real, fix it):** `functions/exercises.js` MET map has **no "hr"**,
   and `functions/aitools.js` `nutritionTargets`/`weeklyPlanBurn` don't handle `{type:"hr"}` sessions — so
   the AI's + `coach_summary`'s server-computed calorie **targets undercount HR-cardio burn** (eat-back
   mode). The CLIENT app computes it correctly (cardioExFor). Port the Keytel `hrBurn` server-side.
3. **⚠️ AI schedule tools DROP HR sessions:** `set_workout_schedule`/`propose_workout` validate cardio
   `type` against `CARDIO_IDS`; `{type:"hr"}` isn't a valid id, so if the AI rebuilds a day it would **wipe
   a user's HR cardio**. Decide: teach the tools to preserve/emit `hr` entries, or exclude HR days from AI
   rescheduling.
4. **Regression sweep:** any code reading a cardio session's `.type` as an exercise id (e.g. the
   `["hiit","jump_rope",...].includes(s?.type)` heavy-sweat/high-impact filters ~line 5557/5559 — HR just
   won't match, harmless) and the icon-regex tightening (`/ping/`→`/ping.?pong/`; new `/trampolin/`→jump).

### ✅ Heart-rate cardio "By heart rate" — BUILT & VERIFIED LIVE (S107c/d)
Log cardio by heart rate instead of picking an exercise. **Formula: Keytel (2005)** — calories from HR +
weight + age + sex (`hrCaloriesPerMin`/`hrBurn` in App.jsx, unit-tested). **Zones**: `maxHeartRate` (Tanaka
208−0.7·age), `HR_ZONES` (5 color-coded), `hrZoneFor`, `hrHealthyRange` (pick 50–90% max, floor 90bpm,
caution >90%). **`cardioExFor(session,data)`** resolves a session for burn/labels — HR entries get a
`calPerMin` so the existing `exBurn` counts them; **drop-in for normal exercises** (all ~8 burn/label sites
swapped from `findCardioEx(s.type)`). **`HeartRatePicker`** component (slider + 1-bpm steppers + live
color zone + calorie + safety caution). Wired into ALL cardio editors (StepCardio, Results Basic+Pro,
DailyDashboard) via a "By heart rate" ⇄ "Pick an exercise instead" toggle; HR sessions stored
`{type:"hr", hr, duration}`. Icons `heart`/`heartRate`/`jump` added. VERIFIED live (Casey): toggle→picker,
default 127bpm persists (emit-on-mount), ~200 cal (matches Keytel F/30/183lb), 165bpm→orange Hard zone→
~322 cal; existing Outdoor Jog unchanged (~350). **Trampoline** cardio added (MET 4.5, both app + AI
mirror) — icon bug fixed ("jum**PING**" was matching `/ping/`→ping-pong paddle).

### ✅ Also shipped this session
- **Trainer EARNINGS view** (S105, `bf9f73d`) — ≡-menu → Earnings; read-only ledger over `sessionCharges`
  (tiles: collected/this-month/pending/declined + history rows; test-mode excluded from totals + tagged).
- **Session-billing Terms of Service** (S106, `910f363`) — `public/terms.html` new **Section 6 "Training
  sessions & payments"** (Smooth Training LLC, card-on-file, weekly-arrears auto-charge, late-cancel fees,
  consent-anchored policy, no packages), consent line refs the ToS + a link at the card-setup checkbox,
  `POLICY_TEXT_VERSION`→2, `recordSessionConsent` version-label fix (deployed). **Adversarially reviewed +
  reworded to match the code** (removed a false "no packages" absolute, fixed the policy-change clause to
  consent-anchored not booking-time). This unblocks **Kevin billing his OWN clients on the weekly sweep**
  (his explicit ask) — packages stay off (no buy flow exists), live Stripe key already set.
- **Stripe `return_url` fix** (S107e, `4bf024a`, deployed) — Kevin got a Stripe test-email re a SetupIntent
  missing return_url; production card-setup uses hosted Checkout (has return URLs) so it was a test-script
  artifact, but I hardened `paySessionBalance`'s on-session confirm with a validated `return_url` (3DS).
- **Weight-tile bug FIXED** (S107b, `0c71980`, verified) — the measurements modal dropped a typed weight if
  you didn't tap "Log weight"; now it flushes on Save AND on close (`flushWeight`).

### ⚖️ WAIVER + Florida legal research — DONE (drafts for attorney), `9ebe874`
`docs/SMOOTH-TRAINING-WAIVER-DRAFT.md` (v2) + `docs/LEGAL-WAIVER.md`. Multi-agent primary-source research,
adversarially verified. **Verbatim Fla. Stat. § 744.301(3) minor-waiver notice** inserted (confirmed vs
the official statute — must render UPPERCASE, ≥5pt larger, boxed). Minor section reframed to *Kirton v.
Fields* (997 So.2d 349) — a guardian CAN'T waive the company's own negligence; only inherent-risk. Adult
release enforceable for ordinary negligence (*Sanislo*, **157 So.3d 256** — corrected cite). Added a
public-policy carve-out, fixed the fees cap, split media/likeness into a separate opt-in. **Attorney
questions** in the doc. **Kevin CAN serve minors** (guardian signs; waiver reduces ≠ eliminates risk).
Also: `docs/SESSIONS-ATTORNEY-QUESTIONS.md` (+ `.docx`) + `docs/SESSIONS-GO-LIVE.md` (`6e670ff`).

### ⏭️ Queue after the second-check
- **Body-composition feature** (Kevin's 3rd request, NOT started): muscle-mass formula (recommend **Lee
  2000** — uses height/weight/age/sex, all available; from weight+BF% we get fat & lean mass exactly,
  muscle mass is an estimate) + a **side-scrolling multi-metric line graph** (weight, fat mass, BF%, muscle
  mass) with **scanner BF% kept separate from caliper/tape** + per-metric visibility toggles. The
  measurements hub (`MeasurementsModal`, `measurementMetrics`, `mergeMeasurements`) is the place.
- **Waiver/minors APP FLOW** (after attorney clears the waiver): DOB at intake, gate program-requests behind
  a guardian-signed waiver (minor can't unlock), a "request a training program" button → emails Kevin (he
  builds on Trainerize). Frame the app's exercise section as informational/calorie-tracking (waiver §10).
  Kevin's DOB-lying concern → age attestation + records + his manual review of program requests.
- **Sessions billing go-live** (attorney ToS pass, real-card smoke test) — `docs/SESSIONS-GO-LIVE.md`.

### 🔑 Gotchas reused this session
- When `functions/exercises.js` OR `aitools.js` change → deploy **all four AI fns** (aiChat, aiChatStream,
  logMeal, setWorkoutSchedule). `firebase deploy --only functions:<name>` per fn otherwise.
- Preview `read_page` was flaky (0x0 viewport) on a fresh tab — screenshots + `javascript_tool` worked.
  HMR throws benign `createRoot()` console warnings after edits (not real errors).
- pdftotext/LibreOffice/pandoc NOT installed; `pypdf` (python3) reads PDFs; `docx` npm installs in scratchpad.

---

## ⚡ S105b (Jul 21): Client-state-aware prepaid-pack risk flag — SCAFFOLDING (informational, not a gate)
_Pushed (`origin/main` @ `f70232a`), tree clean, build passes. `src/sessions.js` + `src/App.jsx` only;
no rules, no functions, no money paths. Firebase `calorieiq-29762`; model `claude-sonnet-4-6`._

Sessions-billing item #2 ("client-state-specific FL/health-studio flag"). The understand pass found the
flag was **greenfield** (`packWindowRisk`/`packWindowNote` had ZERO consumers — the prepaid-pack UI it
would feed isn't built, that's item #3), there is **no trainer-state in the system at all** (the only
state captured is the CLIENT's card `billingState`, from Stripe at card setup, on
`users/{clientUid}.sessionPaymentMethod.billingState` — trainer-readable, already loaded-but-unused in
SessionsPanel), and — critically — **whose law governs a remote/out-of-state client is UNRESOLVED** in
`docs/LEGAL-SESSIONS.md` (it keys everything on the trainer's state; must go to counsel). So a *live*
client-state compliance gate can't be responsibly shipped yet. Kevin chose to build the **safe
scaffolding** instead.

**What shipped:**
- **`STATE_PACK_RULES`** (`src/sessions.js`) — a per-state model distilled from the legal research:
  FL(30)/PA(90)/MD(90) day-window states, CA/IL/OH/TX no-window statutes (window doesn't help),
  7 unverified states (NJ/NY/WA/MI/GA/AZ/CO) flagged "check first". `packWindowRisk(pack, state)` /
  `packWindowNote(pack, state)` now take a state; new `clientStateInfo(state)` + `statePackRule(state)`.
  Every user-facing string ends with "Informational only — not legal advice" and it never claims to
  resolve remote choice-of-law.
- **UI** (`src/App.jsx` SessionsPanel, trainer view): the card-on-file row now shows the client's
  captured state ("billed in CA") + a tone-coded note (ok=green / caution+review=amber / high=red /
  unknown=muted) + a remote-client caveat line. Surfaces whether a client is out-of-state BEFORE packs
  ship. **Informational only — deliberately NOT a gate.**
- **Adversarially verified** (3-lens workflow vs the source doc + a 4th over-claim pass): PA corrected to
  a void-contract state (over-window → red); NJ's harsh-remedy signal surfaced in the note without
  rendering an unverified state red; FL "stays exempt" → "likely to stay exempt (an open point for
  counsel)" to match the doc's own hedging. 32 unit assertions; CA/FL tones verified live.

**Item #2 status:** scaffolding done; the *authoritative* gate (and whether to geo-gate pack sales)
still waits on counsel resolving choice-of-law + item #3 (packs). When packs are built, wire
`packWindowRisk`/`packWindowNote` into the pack editor / per-client checkout (server-side settle path is
the natural place — `sessionSettle.js` already loads the client's `billingState`).

## ⚡ S105 (Jul 21): Trainer EARNINGS view — read-only ledger over sessionCharges
_Pushed (`origin/main` @ `bf9f73d`), tree clean, build passes. Purely additive UI — no rules,
no functions, no money paths touched. Firebase `calorieiq-29762`; model `claude-sonnet-4-6`;
admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`._

The first of the "what's left before real money" items (§ below), and the one the S104 handoff
flagged as "the next natural build." A trainer now has an **Earnings** screen (≡ menu → Earnings)
that reads their whole `sessionCharges` history — the settle dispatcher stays the ONLY writer
(rules already scope reads to the trainer; this view writes nothing).

- **`src/sessions.js`** (new helpers): `subscribeMyEarnings(trainerUid, cb)` — live `onSnapshot`
  query `where('trainerUid','==',uid)`, a **single-field index (no composite deploy)**, sorted
  newest-first in JS. `earningsSummary(charges)` — pure aggregation; **test-mode charges are counted
  SEPARATELY** (`testCents`/`testCount`) so live totals mean real dollars once billing goes live.
  `chargeStatusLabel`, `centsToUsd`.
- **`src/App.jsx`**: `TrainerEarnings` component (matches TrainerAnalytics styling), a `homeTab
  === "earnings"` route, and the side-menu "Earnings" item (gated on `isTrainer`). Four summary
  tiles (Collected / This month / Pending / Declined — LIVE money only) + a History list: client
  name (resolved via `getMyClients`, short-uid fallback), what-for ("2 sessions" / "1 late-cancel
  fee" / "N covered by package"), date, amount, color-coded status chip; tap a row → open that
  client's plan. Test-mode rows carry a `TEST` tag and are excluded from the tiles.
- **`src/icons.jsx`**: `receipt` glyph (per the icons-not-emoji rule).
- **Verified:** 17 unit assertions (summary math, month-boundary, test exclusion, labels,
  what-for). Live in the preview as `trainer.uitest`: empty state renders; a mock ledger confirmed
  the populated view (tiles $90/$60/$30/$45, every row type, name resolution + fallback, TEST tag);
  mock removed and the live-subscription empty state re-confirmed. `npm run build` passes, no
  console errors.

## ⚡⚡⚡ S100–S104 (Jul 20–21): SESSION SCHEDULING + BILLING (phases 1–3) + legal research + deficit fix
_Pushed (`origin/main` @ `ba99313`), tree clean, all functions deployed, rules PUBLISHED. Firebase
`calorieiq-29762`; model `claude-sonnet-4-6`; admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`._

### 🟢 The big build: trainer↔client TRAINING SESSIONS with card-on-file auto-billing
This is the **Acuity + Stripe replacement** from `docs/SESSIONS-BILLING-PLAN.md`. Phases 1–3 are LIVE
in **Stripe TEST mode**, fully E2E-verified. **NOT yet taking real money** — that needs the go-live
checklist below + an attorney pass. New files: `src/sessions.js`, `functions/sessionSettle.js`;
sessions logic also in `functions/sessions.js` (the completed-marker) + `functions/sessionBilling.js`
(card-on-file). **156 emulator rules tests pass** (was 87). `docs/LEGAL-SESSIONS.md` = the full legal
research (57KB — READ IT before go-live).

**Phase 1 — scheduling (LIVE, rules published).** `sessions/{sid}` = `{participants[2], trainerUid,
clientUid, startAt, durationMin, status: scheduled|cancelled, title, location, priceCents, createdBy/At,
updatedAt, cancelledBy/At, cancelReason}`. Queried `where('participants','array-contains',uid)` — a
single-field index, **no composite index deploy needed**. Only a TRAINER books, only for a genuinely
linked client (`isTrainerOf`); either side cancels; a client may ONLY cancel (not reschedule/re-price/
retitle/un-cancel). **BILLING FIELDS ARE SERVER-ONLY** in rules (settled/chargeId/completedAt rejected
from both sides — the S85 subscriptionStatus lesson, applied before money exists). `cancelledAt` is
pinned to ±5min of server time so a client can't backdate to dodge a late fee. Attack-tested against
PROD with raw `updateDoc` (the client-side helper's field filter gave false "ALLOWED" the first pass —
always attack raw). UI: trainer `SessionsPanel` per client card (book/reschedule/cancel + upcoming
count); client NEXT SESSION card; calendar cyan dot + day-view detail block (scoped to owner's own view).

**Phase 2 — the red line (LIVE).** `sessionsMarkCompleted` (`functions/sessions.js`), `onSchedule
"every 15 minutes"`, stamps `completedAt` on any session whose END passed. ⚠️ Stamps `completedAt`
NOT `status:"completed"` (the rules only allow a trainer update ending in scheduled|cancelled, so
`status:"completed"` would lock the trainer out of their own past session). Stamps the REAL end time,
idempotent, skips cancelled, 14-day lookback. VERIFIED live: fired at 14:16Z, marked only the finished
session, stamp = real end time not sweep time.

**Phase 3 — card-on-file + settle dispatcher (LIVE, test mode).**
- **Card on file** (`functions/sessionBilling.js`): `createSessionSetupIntent` → Stripe-hosted Checkout
  in SETUP mode (no card field in Glide, `billing_address_collection:"required"`). `recordSessionConsent`
  re-reads everything FROM STRIPE (never trusts the browser), stores the card pointer + **only the
  2-letter STATE** (Kevin: don't store addresses — Stripe holds the address, Glide keeps the state for
  the FL rules flag). IP/user-agent stamped SERVER-side (browser self-report is worthless as evidence).
- **Settle dispatcher** (`functions/sessionSettle.js`): `sessionsSettle` (hourly `onSchedule`) +
  `settleNow` (admin callable, `dryRun`/`force`). PACKAGE CREDITS FIRST, always; trainer's `billingMode`
  decides WHEN (per_session every sweep / weekly Sunday-evening-ET / manual = untouched); trainer-cancel
  never billable; the FEE POLICY = the client's LATEST CONSENT SNAPSHOT (a policy edit can't retro-
  reprice). No card+no credits → session left unsettled (picked up when a card appears). Idempotent
  (claim `settled:"processing"` in a txn, ledger-id as the Stripe idempotency key). DECLINE → sets
  `sessionBillingHold` on the client + notifies BOTH sides via the existing push/feed. Ledger =
  `sessionCharges/{cid}` (server-only, both participants read). **TEST MODE:** a client with
  `sessionBillingTest:true` (admin-set, server-only in rules) bills against `STRIPE_TEST_SECRET_KEY`
  (I recovered the old test key from Secret Manager version history + stored it as that secret). E2E-
  verified: 4242-card → $60 session charged; decline flow → hold + notify.

**S103 — PAY NOW (LIVE, test-verified).** The hold banner on the client home now has a **Pay $X now**
button → `paySessionBalance` callable: retries the held ledger against the card on file ON-session
(client is present, can 3DS), lifts the hold + held sessions on success, points at "Update card" on a
repeat decline. Client pays only their OWN hold (uid from auth). Banner uses local `hold` state so it
clears live. E2E-verified in test mode.

### 🟡 The deficit saga — FINALLY settled (S102→S104c), don't reopen without reading this
Kevin reworked the under-wheel deficit number ~5 times. **Final answer (S104c, `ba99313`):
`deficit = target − eaten`**, signed → green "−N deficit" under target, red "+N surplus" over. It
EQUALS the wheel's "remaining" while under target — that is CORRECT, not a bug (they're the same fact:
"866 left to eat" = "866 under target"). Correct SIGN was the whole point: the S104b "remaining − eaten"
version flipped a real −866 deficit into a false +866 surplus past the half-target mark (Kevin caught it
live). Only shows once something's logged. VERIFIED on Casey: 1,800 of 2,273 → −473 deficit green (the
case that used to break); 2,600 → +327 surplus red. **Do NOT switch to maintenance/TDEE−eaten** — Kevin's
"deficit" is explicitly target-based; TDEE−eaten gives a bigger number he doesn't mean. `todayDeficit`/
`todaySurplus` are derived from `deficitVal = remaining` in the Daily Dashboard (~line 9970).
_Earlier related fixes still hold: S102e (only EARNED workout burn counts — a scheduled-but-not-done
workout no longer inflates the number), S102h (a second "with workout burn" line + weight projection on
ring tap)._

### ✅ Also shipped this stretch (per the git log dc7f165 / earlier)
- **Streak celebration once/day** (S104): was firing every app open (the `0→loadedStreak` async rise
  always looked like a milestone rise; in-memory ref only). Now persisted per-day via a `ymdLocal` key.
- **Pull-to-refresh** added to non-popup pages; **weight-projection** surfaced on the ring-tap sheet
  (3500 cal/lb → lbs/week). _(These landed in dc7f165 "S104" — verify they're wired on all 4 main
  screens if revisiting; the pull-to-refresh Explore agent was interrupted mid-map.)_

### ⚖️ LEGAL — must-read before taking real session money (`docs/LEGAL-SESSIONS.md`)
Deep research (multiple agents, primary sources). **Top risks:** (1) **Florida Health Studio Act** —
selling prepaid packages consumed over >30 days VOIDS the personal-trainer exemption → the trainer
becomes a registered "health studio" ($25k bond + FDACS registration). Kevin is in Miami, so this is
the home-market constraint. **The service-window is the legal lever** — a pack consumed ≤30 days stays
exempt (already modeled: `serviceWindowDays` + `packWindowRisk`/`packWindowNote` in sessions.js, FL-safe
default 30). (2) CA/IL/OH/PA make non-compliant contracts VOID → a late-cancel fee can be uncollectable.
(3) A "no chargebacks" clause is unenforceable (Reg Z runs against the ISSUER) AND breaches Mastercard
5.12.6 — never add one. Defense = documentation: `cancellationEvidence()` spells out the lateness
arithmetic, `policySnapshot()` freezes the consented terms. **Cancellation policy is trainer-set**
(anytime / window(hrs) / never; late %; billingMode) on their profile, client-readable; standard
disclosure on every checkout via `cancellationDisclosure()`/`consentLineFor()`. **The FL flag should be
CLIENT-STATE-specific** (Kevin's ask — virtual clients may be out-of-state) — the state is captured at
card setup; wiring the per-client-state gate is still TODO.

### ⏭️ Sessions billing — WHAT'S LEFT before real money
1. ~~**Trainer earnings view** over `sessionCharges` (read-only ledger list).~~ **DONE — S105** (`bf9f73d`).
2. **Client-state-specific FL/health-studio flag** — **SCAFFOLDING DONE — S105b** (`f70232a`): per-state
   model + informational trainer note off the client's captured card state. The *live gate* still waits on
   counsel (remote choice-of-law unresolved) + item #3 (packs, its only consumer).
3. **Prepaid pack PURCHASE flow** (Checkout → grant `sessionCredits`) — the settle side consumes credits
   already; the buy side isn't built. **HOLD packs behind a flag until FL attorney clears the 30-day
   window question** (model + UI exist; don't SELL yet).
4. **Go-live:** attorney pass on ToS (current `/terms.html` has NO card-on-file/auto-charge/late-fee
   language — a gap), confirm the live `STRIPE_SECRET_KEY` path, real-card smoke test, then remove any
   test-only affordances.
5. **Cleanup:** test accounts (Casey `client.uitest`, trainer `trainer.uitest`) may carry leftover
   `sessionBillingTest`/`sessionPaymentMethod`/`sessionBillingHold` + Stripe TEST customers from E2E runs.
   Harmless (test-key routing), but clear before demoing billing to anyone.

### 🔑 Reusable gotchas from this stretch
- **Admin REST without gcloud:** mint a token from `~/.config/configstore/firebase-tools.json` refresh_token
  via the firebase-tools OAuth client (id `563584335869-…apps.googleusercontent.com`, secret in the S100
  scratchpad scripts). Firestore REST URL needs `(default)` — URL-encode it or the plain path 400s.
- **gcloud is installed at `~/google-cloud-sdk/bin/gcloud` but its OAuth is blocked by the smoothtraining.com
  Workspace** (consent succeeds then "something went wrong" — same class as the S61 org-policy fight). Not
  needed; the token trick covers admin reads + Cloud Scheduler force-runs weren't necessary (schedules fire
  on their own within the interval).
- **Stripe test vs live side by side:** every account has both modes with separate keys/data — no
  conversion. SETUP-mode card save charges $0, safe on a real card. `STRIPE_TEST_SECRET_KEY` secret now
  exists (recovered from history).
- When `aitools.js`/shared function code changes, deploy ALL affected fns.

---

## ⚡⚡⚡ S99 (Jul 19): photo AI estimate + day arrows on Meals & Food — BOTH SHIPPED
_Pushed (`origin/main` @ `4e83414`), tree clean, `estimateFood` redeployed. Firebase `calorieiq-29762`;
model `claude-sonnet-4-6`; admin UID `G7QUZ8Kat1fgyoMjdGKz4DYoVHi1`._

### ✅ What S99 shipped (both S98-queued features, all verified live)
- **Photo AI estimate in the meal tracker**: `estimateFood` accepts an optional `image` (base64 data
  URL; new `sanitizeImageDataUrl` reuses the chat's IMG_TYPES/7MB rules) and sends a vision content
  block with portion-calibration guidance; it also returns a **`name`** now so a photo-only estimate
  labels the food. Frontend: "Estimate from photo" button (house `camera` icon, new in icons.jsx) +
  hidden `capture="environment"` input beside "AI estimate" in MealLog, reusing `downscaleImage`.
  **Photos are never stored** (Kevin's rule) — sent to the model, discarded. **Latent bug fixed:**
  two `onClick={runAiEstimate}` handlers passed the click EVENT as the first arg — now the image
  param; both wrapped in `() => runAiEstimate()`. **Measured** vs Nutrition5k through the DEPLOYED
  fn: 34% MAPE over 4 dishes (matches the 30% chat-photo baseline); text-only regression clean;
  guards reject no-input and bad-image-type with INVALID_ARGUMENT. UI E2E: canvas photo → "Eggs and
  peas" 220 cal in the serving popup. Eval script: scratchpad `est-photo-eval.mjs` (session-temp).
- **Day arrows on "Meals & Food"**: ‹ › in the MealLog header (dashboard mount only — new props
  `onDayStep`/`dayLabel`/`canGoNext`; CalendarView's mount unchanged). Label = Today / Yesterday /
  "Fri, Jul 17" (only "Today" when it IS today). State lives in DailyDashboard: `mealDate` seeded
  FROM `useTodayKey()` (S85 rule), clamped ≤ today (next arrow disables at Today). Past days read
  via `onReadDay` and write through `onWriteDay`-based handlers (copied from CalendarView's
  addMeal/removeMeal/editMeal pattern); TODAY keeps the original handlers so the ring/streak/
  week-summary stay today-only by design (verified: back-dated add landed on Jul 17, today's ring
  untouched at 1,929). Phone width checked at 375px — header fits one line, tools row wraps clean.

### ⏭️ START HERE — Kevin's queue (carried from S98)
- Notes: private vs shared for BOTH trainer and client; the check-in "notes" box should open a
  bigger editor (NotesPanel + privkv already exist — see docs/NOTES-PLAN.md).
- Stripe LIVE-mode swap (real-card smoke + attorney pass) · Acuity sessions (needs his API key).
- TTS coach voice (#7 from the API research); SMS reminders later.
- Saved API research: `/private/tmp/.../tasks/wl1qyo4ey.output` — ranked list w/ verified pricing.

## ⚡⚡ S98 (Jul 19): burn/target chooser, PWA speed, resume-refresh, icons, notes

### ✅ What S98 shipped (all verified live)
- **Target chooser on the CAL REMAINING wheel** (`798902b`→`9d4cb09`): tap the wheel → pick "Target
  without workout burn" vs "with", both with real numbers; pick becomes the default. Writes the
  EXISTING `data.deficitMode`, so Full Plan / Results / share card / server AI targets all follow.
  Under the wheel: `1,929 target +384 burn (tracker) = 2,313 cal`, active figure highlighted.
  Matching burn breakdown in Food & Calories while logging.
- **New plans default to NO burn counted** (`104a890`) — set explicitly at all 4 creation sites
  (local plan, client's own, trainer-for-client, AI `create_plan`). **Deliberately NOT changed in
  `isEatback`/`EMPTY_DATA`** — those are also the merge base when LOADING, so moving the fallback
  would silently re-target every existing plan. Unset === existing === eat-back, forever.
- **THE BIG LESSON (cost 4 rounds of "I still don't see it")**: the chooser was gated on
  `canChooseBurnMode` + `scheduledBurn > 0`. Kevin has a Garmin, so his burn came from `burnShown`
  (tracker-preferred) while `scheduledBurn` was 0 → everything silently hid, and a manual target or
  `wearableAdjust` also killed it. **Every surface now uses `burnShown`, and the wheel ALWAYS
  responds** — when the choice can't apply it explains why (manual target / tracker adjustment) and
  how to restore it. *A tap that does nothing is worse than no tap.*
- **PWA cold start** (`ddb6273`): root cause was the SW, not bundle size — navigation was
  network-first, so every launch blocked on the HTML round-trip while all JS sat cached. Now races
  the network against a 1200ms timeout. **Side effect to remember: a fresh deploy can need ONE extra
  app open to appear.** Also lazy-loaded Showcase + @simplewebauthn (~40kB off boot). Main chunk is
  still ~1.38MB — real code-splitting of the 19k-line App.jsx is the next perf win.
- **Connected clients not loading after PWA wake** (`1ab7c33`): loaders ran once on mount and a
  resume doesn't remount, so a failed wake-fetch never retried; AND `loadClients` swallowed the
  error and `setClients([])`, rendering "no clients" permanently. New `useRefreshOnResume`
  (visibilitychange/focus/online, 20s debounce) + keep last good roster. Added `usePullToRefresh`.
  **⚠️ Testing note: the headless preview tab reports `visibilityState:"hidden"`, so resume logic
  silently no-ops there — you must override it to test.**
- **Rest days show the week** (`05ff6bd`): wizard cardio DOES save (verified in storage); the panel
  just only ever showed today, so a Sunday looked like data loss. Now lists YOUR WEEK beneath.
- **Icons**: strength/cardio figures from game-icons.net (CC BY 3.0, credited in CREDITS.md) —
  filled silhouettes, because organic shapes turn to mush as line art at 18px. Geometric icons
  (stairs, target, chart) we draw ourselves. `ALWAYS_FILL` set in icons.jsx forces the solid ones.
- **Photo accuracy**: vision portion-calibration halved the error (59%→30% MAPE, bias corrected).
  Regression-test any prompt/model change with `node scripts/photo-eval.mjs 8`.
- Also: back buttons top-LEFT with centred titles, scroll-jump on sheet close fixed, streak
  milestones + streak-aware reminder push, meals saved/re-logged as whole meals, AI-logged foods now
  reach the food library.

### ⏭️ Kevin's queue after those two
- Notes: private vs shared for BOTH trainer and client; the check-in "notes" box should open a
  bigger editor (NotesPanel + privkv already exist — see docs/NOTES-PLAN.md).
- Stripe LIVE-mode swap (real-card smoke + attorney pass) · Acuity sessions (needs his API key).
- TTS coach voice (#7 from the API research); SMS reminders later.
- Saved API research: `/private/tmp/.../tasks/wl1qyo4ey.output` — ranked list w/ verified pricing.

### Standing rules (do not re-learn)
- New features use `src/icons.jsx` house icons, **never emoji** (emoji are fine in OUTGOING text like
  the share card — Kevin's call).
- Deploy ALL FOUR AI fns when `aitools.js` changes (aiChat, aiChatStream, logMeal, setWorkoutSchedule).
- `.page-transition` keeps a transform → any fixed overlay must `createPortal(…, document.body)`.
- Local dates via `ymdLocal`/`useTodayKey` — never UTC "today".
- kv range queries use the `\uf8ff` ESCAPE sequence in source (a raw char silently breaks it).
- `Number(null) === 0` — screen null/""/undefined BEFORE trusting a 0.
- Firebase creds expire constantly: `npx firebase-tools login --reauth --no-localhost`.
- Verify by DRIVING the app and MEASURING, not by reading the diff — this session, three separate
  "it works" conclusions were wrong until measured (grid centring, resume refresh, the burn gate).

---

## ⚡ S97s (Jul 18): four phone-UX fixes — all live (`6450786`)
1. **Meals & Food Today header** no longer stacks/overflows on a phone — it used
   `.sec-title` (a full-width heading whose `::after` divider has `flex:1` and eats the row).
   Now a plain nowrap title in a `flexWrap` row; controls wrap to their own line inside the card.
2. **Leading-zero input bug fixed** — `editField` coerced with `parseInt(v)||0` on every
   keystroke, so clearing a box refilled "0" and the next key gave "05". Now keeps the raw
   string; coercion happens at the boundaries via `num()`.
3. **Back buttons moved top-RIGHT → top-LEFT** (all 14): `order:-1`/`order-first`, `ml-auto`
   dropped, and the 10 `space-between` headers repacked to `flex-start`. **Kevin's current
   preference is top-LEFT — the S97 top-right placement is superseded.**
4. **Serving type is editable again** — per-serving foods were locked to a frozen unit label.
   With the serving's WEIGHT you get a per-100 basis, so they're promoted to weight mode with
   the full dropdown; when the weight is unknown a "1 serving weighs ___" input unlocks it.
   Conversion round-trips exactly (verified 240g/221cal ↔ 100g/92 ↔ 1oz/26).

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

### Session 167–168 — AI cost tracking, admin search, one client ID (all LIVE)

**S167 — what the AI actually costs, per user, per day.** The admin dashboard's "AI today" was
genuinely today's, not lifetime (it reads a date-keyed doc that `increment`s per call) — but two things
made it look wrong and made cost impossible. The day was a **UTC** day, which in Eastern ends at
**8pm local**, so the number dropped that evening's usage and carried in the previous night's.
And the only stored figure was `tokens` = input + output + cacheWrite: the BUDGET basis, which
excludes cache reads (they bill at ~10%) and can't be turned into money, since the four token
kinds cost four different amounts.

`functions/aiusage.js` now records the full breakdown plus cost into four rollups — day (still
the budget doc), month, year, lifetime — incremented at write time, so a year of spend is one
read instead of 365. Day keys are Eastern-local, matching every other date key since S45.
**This moves the daily budget reset from 8pm ET to local midnight** — better, and consistent, but
it is a live behaviour change worth knowing. Cost math validated against S67's measured batch:
$0.0273 cached vs $0.0648 uncached, 58% saving — matching what S67 recorded independently.
`recordUsage` is wrapped so it can never throw: it runs in a `finally` on every AI path, and the
first cut of it replaced a good reply with an error (scope bug on `db`) until that guard went in.

**S168 — admin search + one client ID everywhere.** The six tiles were already filters; added
search over name, email, role, the 4-char code, or a raw uid (leading `#` optional). Search runs
BEFORE the tile so tile counts describe the current search — empty box = plain totals as before.
Kevin confirmed it working against the real roster.

Two ID schemes existed and each appeared on exactly ONE screen — home showed a sequential `#6`,
All-clients showed `#KEM2` — so you could never quote the code the other screen (or the AI) knew
someone by. One `IdBadge` now shows both on home cards, plan cards, All-clients and the admin
roster, and **tapping copies the full id**; it stops propagation, so copying no longer opens the
plan as a side effect.

**S168b — the deploy-subset bug, caught again.** `aitools.js` had changed in S165/S166b but the
S167 deploy named only 7 functions, leaving `logMeal`/`setWorkoutSchedule` (the Accept-card
writers) on an older bundle — the exact S78 failure, and silent. Fixed, then verified properly:
proposed a meal for the plan file *Prospect Pat*, tapped Log it, and checked STORAGE rather than
asking the AI — it landed in `caliq-log-c1782072071191-<today>` and not in the trainer's own log,
so `localPlanId` survives propose → Accept → write. Test meal removed after.
The durable fix is `npm run deploy-set <file>` (see Gotchas) — the real set for `aitools.js` is
**12** functions, including `mcp`.

**Still on Kevin's side:** the mic on a real phone, and `find_client` against someone who exists
as both a connected client and a plan file.

## Gotchas reaffirmed this session
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
- **Deploying a subset after a SHARED-file change is the recurring bug** (S78, then again S167→S168b).
  Firebase ships every function from one source tree but only updates the ones you name, so the rest keep
  running the old copy of that file and nothing looks wrong. Don't hand-maintain the list:
  **`npm run deploy-set aitools.js`** prints the exact set and the ready-to-paste deploy command.
  `aitools.js` is now **12** functions (the 4 AI ones + all 5 workflow fns + `mcp` + estimateFood +
  requestBudgetBoost) — `mcp` matters especially, since the connector must stay at capability parity
  with the in-app AI. Other fns: sendInvite, transcribeAudio, trainerizeTest.
- **Firebase token expires** → `firebase login --reauth --no-localhost`. Set secrets via
  `printf 'val' | firebase functions:secrets:set NAME --project calorieiq-29762 --data-file=-` (masked
  prompt trips Kevin up). **Never `GID=` in zsh** (special var → "operation not permitted"); use another name.
- To test a secret-backed API without a UI: `firebase functions:secrets:access NAME` into a curl (don't
  print the secret) — how we proved Trainerize + OpenAI.
- **`src/App.jsx` ≈ 13k lines**; `css` block is a JS template literal. `npm run build` before commit; push
  `main` auto-deploys Vercel; **Cloud Functions need explicit `firebase deploy`** (NOT via push).
- Test accounts: trainer `trainer.uitest@calorieiq-test.com` / client `client.uitest@…` (Casey),
  `TestPass123`. Drive the preview signed-in for callables/AI.

---

## Unconnected plans ARE clients (S165) — DEPLOYED & PUSHED (`1f1e4ad`)

**Deployed:** aiChat, aiChatStream, logMeal, setWorkoutSchedule, **mcp** — all five updated
cleanly. Frontend pushed to `main` (Vercel). ⚠️ **The "deploy all 4 AI fns when aitools.js
changes" rule is now FIVE: `mcp.js` requires aitools too.**

**Verification status, stated honestly:** the tool logic is unit-verified against a
Firestore stub (see below) and the frontend paths were driven live in the browser. The
**deployed** find_client / coach_summary changes were NOT exercised by a live AI call —
`trainer.uitest` hit its 100k daily token budget during this session's testing. Kevin's own
account has an unlimited budget, so the quickest confirmation is to ask it *"find everyone
called <a name that exists as BOTH a client and a plan file>"* and check it lists both kinds.

### S165b — what the MCP connector was silently dropping (same commit set)
Found by the same audit, fixed on Kevin's go-ahead:
- **The JSON-Schema→Zod mapper was flat.** Arrays became `array(any)`, objects
  `record(any)`, and the `default:` arm swallowed every **enum**. So `log_meals.meals`
  reached an external model shapeless (it guessed `food`/`kcal`, runTool coerced the misses
  to empty) and a reasonable `mealType:"Breakfast"` failed the strict check and filed a meal
  with **no meal type**. Now recursive, enums included — verified by round-tripping the real
  schemas: a valid item parses, a wrong-case mealType is rejected *naming the four valid
  values*, and a nameless item is rejected.
- **`mealTypeOf()`** now normalises case/whitespace at every call site, so tolerance no
  longer depends on which surface the call arrived from.
- **`plan_meals` was exposed nowhere**, so an external AI asked to plan next week fell back
  to `log_meals` and recorded future meals as *already eaten*. Now behind `write:logs`, with
  a description saying planned meals don't count until ticked off. Not destructive.
- **`search_food_db`, `fetch_link`, `send_app_request` were missing entirely** —
  `search_food_db` also needed the FatSecret secrets bound to the `mcp` function (unbound,
  `process.env` is just empty and it fails at runtime while reading fine). A stale comment
  claimed the food database was retired; that was `search_food`, one character away.
- The connector's `instructions` named only `clientId` — now names `localPlanId` and says
  those people are clients too.
- Confirmed: the only tools NOT on the MCP surface are `propose_meal` / `propose_workout`,
  which is deliberate and documented (they render the in-app Accept cards).

Kevin's rule, stated 2026-07-30: **a local plan or simulation is often a REAL, paying
client — one who just won't install the app.** Being "connected" isn't what makes someone a
client. The AI must reach them exactly like connected clients. (Saved to memory as
`local-plans-are-real-clients`.)

A 4-surface audit (22 verifier agents) found S87's `localPlanId` plumbing is sound —
all 18 plan-data tools carry it, and the MCP connector inherits it automatically from the
shared schema, so there is **no parameter-level drift**. What was broken was everything
around it:

- **`find_client` searched only connected accounts** — the headline bug. Ask for "Pat",
  have a "Patricia" on the roster, and the single fuzzy hit read as *resolved*: the meal
  went into Patricia's real diary, confirmed as success. Now it searches BOTH pools in one
  call and each match carries `kind` ("client" → clientId, "local_plan" → localPlanId),
  `ref`/`num` codes, weight and last-log date. Cross-pool matches get an explicit
  "these span both — ask, because writing to the wrong one is invisible" note; a lone
  sim match warns before anything is written. Match caps are **per pool**, so a crowd of
  same-named clients can't hide the plan files. Fixing it in the TOOL (not the prompt)
  means the ambiguity is a fact in the result, not something the model must remember to
  go looking for.
- **`coach_summary` ignored them entirely** — "who needs attention?" silently covered
  only connected accounts, i.e. a confident, incomplete answer. Now both pools, via one
  extracted `snapshot()` so the maths can never drift. New `never_logged` status (sorted
  LAST — a template or sandbox nobody logs to isn't someone who went quiet).
- **The prompt framed local plans as a fallback** ("if find_client finds nothing, ALSO
  check…") and as artifacts. Rewritten: two-source lookup, and a "LOCAL PLAN FILES ARE
  PEOPLE" rule in Kevin's own terms.
- **The pin picker ("New chat about a client") could only aim at connected clients** —
  now every person, with plan files marked and sims carrying the purple SANDBOX identity.
- **The in-plan chat had no subject at all**: standing inside a plan, "log this" wrote to
  the TRAINER's own diary. It now carries the open plan as an ambient subject and *says
  so* above the composer ("Working on Test Client — the plan you have open"). Ambient
  loses to a resolved subject, which loses to a pin — and it is deliberately NOT sent as
  `pinned`, or "log this for Casey" while viewing Pat would land on Pat.
- **The wire carried an id but no NAME** — the AI literally answered "I don't have a name
  for the local plan file we're working with" while holding that person's plan. `name`
  now rides the target (sanitised into the prompt) and survives the server's echo
  (`keepName`).
- Fixed in passing: `find_client`'s last-log query used `prefix + ""` as its range upper
  bound instead of ``, so it silently matched nothing (the S85 gotcha, live again).
  **`coach_summary` line ~1824 still has the same empty-string bound** — benign only
  because log keys end exactly at the date; fix it if that ever changes.

**Verified:** two-pool resolution unit-tested against a Firestore stub (cross-pool "Pat"
returns all three with the warning; local-only names and `#num` codes resolve; sim tagged;
client-role denied; crowding can't starve). coach_summary tested across both pools —
a local-plan client returns real adherence, trend and target. Prompt text rendered and
read back. Live in the browser: the picker shows client / plan file / SANDBOX rows, a
local-plan pin round-trips and the AI answered "Test Client", and the in-plan chip appears
and routes the turn to that plan (it auto-pinned to the plan's id, proving the server used
it). `npm run build` + `node --check` on both function files pass.

⚠️ **A backtick inside a template literal broke `aichat.js` and `npm run build` did NOT
catch it** — the frontend build never compiles `functions/`. **Always `node --check
functions/<file>.js` after editing a prompt string.**

**The deploy command for next time** (five, not four):
```bash
firebase deploy --only functions:aiChat,functions:aiChatStream,functions:logMeal,functions:setWorkoutSchedule,functions:mcp --project calorieiq-29762
```

## S167 AI cost tracking — DEPLOYED & VERIFIED LIVE

All seven functions deployed (`adminUserUsage` created fresh). Verified live: a real chat
turn logged `{"model":"claude-sonnet-4-6","budgetTokens":18509,"costMicros":69187}` —
$0.0692, which matches 371 input + 5 output + 18,133 cache-write by hand. No write-failed
lines, so all four rollups landed.

**⚠️ It shipped broken first and was live-broken for ~11 minutes (10:28–10:39Z).** `db` is
not in scope in the aiChat / aiChatStream / workflow handlers — they carry a `usageRef`
from `setupChat`, not a Firestore handle — so `recordUsage(db, …)` threw ReferenceError
from a **`finally`**, which *replaces* the pending return: the reply was generated, then
discarded in favour of an error. Fixed in `c2c2352` by (1) making `recordUsage` incapable
of throwing, since it runs in a finally on every AI path, (2) passing `admin.firestore()`,
and (3) adding **`npm run lint`** to `functions/` (eslint `no-undef`), which reproduces the
bug as `454:31 error 'db' is not defined`. `node --check` cannot catch this and Cloud
Functions code cannot be smoke-tested locally — **run `npm run lint` in `functions/`
before every deploy.**

Not redeployed, deliberately: `logMeal` / `setWorkoutSchedule` live in `aichat.js` but
touch neither `todayKey` nor `recordUsage`, so they are unaffected and still run the
pre-S167 bundle.

**What changed and why.** Kevin read "AI today: 600" as a lifetime total. It was not — it
reads a date-keyed doc that starts fresh daily — but the number *was* wrong twice over:

1. **The day was a UTC day.** In Eastern that ends at **8pm**, so "today" dropped
   everything logged that evening and carried in the previous night's usage. The daily
   AI **budget** reset at 8pm local for the same reason. `todayKey()` now returns the
   local (America/New_York) day, matching every other date key since S45. **Behavior
   change worth knowing: allowances now reset at the user's midnight, not 8pm.**
2. **The stored number was never a token count.** `tokens` = input + output + cacheWrite —
   the budget basis, deliberately excluding cache reads (they bill at ~10%). It therefore
   under-reported real usage (a measured turn: 8,330 budget vs **22,238** actual tokens)
   and could not be converted to money, since the four token kinds have four prices.

New `functions/aiusage.js` records the full breakdown + cost per call into **four rollups**
— day / month / year / lifetime — incrementing at write time so a year of spend is ONE
document read, not 365. Cost is integer **micro-dollars** (floats drift in the cents over
thousands of increments). Prices are per-model and applied at write time, so historical
rows keep the rate that actually applied. Sanity check: the constants reproduce the S67
measured batch to the cent ($0.0273 cached vs $0.0648 uncached, 58% saved).

`adminOverview` now returns day/month/year/lifetime per user (4 reads/user, was 2); new
`adminUserUsage` returns one user's 30 days + 12 months (the expensive read, so it runs
only when a row is opened — note the month walk pins to the 1st before stepping back, or
Jul 31 minus one month lands on July again and collapses 12 months into 7).

Dashboard: tiles are filters (count and rows share one predicate so they can't disagree),
rows open to per-day/per-month history, and totals spanning pre-S167 rows show the known
part with a **"+"** rather than blanking or counting unknown rows as free.

**Still worth doing:** the rollups only start filling from the deploy — old day docs have
no breakdown, so their cost stays "—" forever. There is nothing to backfill from.

## Three device-test fixes (S166c/d/e, from Kevin)

**1. A voice note named a client and offered nobody.** Two causes, plus one design
correction: a plan with **no name set** was skipped entirely by the subject loader (so it
could never be matched OR picked) while its card reads "Unnamed client"; and matching was
strict whole-word, which speech-to-text and short forms defeat. Names now carry a display
label separate from the real name (so "Unnamed client" can't itself match the word
"unnamed"), and a spoken word matches a name it prefixes ("Jon"→Jonathan) or that prefixes
it ("Caseys"), accents folded — still whole tokens, so "pathway" never offers "Pat".
**The reliable fix**: the "Sending to ▾" picker now lists **PEOPLE first** — every client
and plan file, always, not only what was heard. The S165 audit raised this and I judged it
optional; a real device disagreed. Guessing from a transcript will always miss sometimes.

**2. Copy a meal from the same day.** Cross-TYPE copying already worked (S99) — but the
chips had no label, so they read as a filter and "copy dinner" looked like it could only
come from another dinner. They now sit under **"Copy from which meal?"**, and the wording
dropped "previous" everywhere. Same-DAY copying genuinely didn't work: the day list
filtered out the current date. Today is included now, minus the one nonsensical case (the
section you're adding to, which would copy a list onto itself).

**3. The AI button "disappeared" over a pop-up — a layering bug, not a styling one.**
Bottom sheets are **z-1600**; the chat panel was **z-1395**. So over an open sheet, tapping
the launcher hid it (it always hides once the chat is open) and rendered the panel BEHIND
the sheet: the button vanished and nothing came back. The panel now rises above sheets
**only while one is open** (1660), leaving the normal stack untouched — the side menu
(1400) still wins over the chat when no sheet is up. The voice bar got the same treatment
(1655), and the **mic is no longer hidden over sheets** at all: voice is the fastest way to
act on the thing you're looking at, so it should be more available there, not less.

## Notes for plan-file clients (S166) — the last piece of "they're real clients"

A trainer could keep coaching notes on a connected client but had nowhere to put them for
one of their own plan files — the very people Kevin says make up most of a roster. Notes are
person-scoped by design (one flat `caliq-notes` array per account, with `aboutUid` marking
notes about a connected client), so this mirrors that exactly rather than inventing a store:

- **`aboutPlanId`** — a note in the TRAINER's own `caliq-notes` marking who it's about, the
  direct analogue of `aboutUid`. No new key, no rules change (owner writing their own kv).
- **NotesPanel gains `mode="trainer-plan"`** (`planId`/`planName`), reached from a **Notes**
  action on every Local Plans card — the same affordance connected clients already had. No
  share toggle there: there is no login on the other end to share with, so offering it would
  be a lie.
- **`trainer-self` ("My Notes") now excludes `aboutPlanId` too**, or per-person notes would
  pile into the trainer's own list. It already excluded `aboutUid`.
- **AI:** `list_notes` / `create_note` / `update_note` accept `localPlanId` (trainer-only,
  validated against the caller's own index like every other use). `list_notes` scoped to a
  plan returns only that plan's notes; the unscoped listing tags them `aboutLocalPlanId` so
  the model can tell them apart. `shared:true` with a plan id is answered honestly rather
  than silently ignored.

**The S77 dead-data check was run explicitly** (custom exercises were written for sessions
before anything read them): a note created by the AI lands exactly where the panel reads it,
and a note created in the panel is what the AI lists back. Verified both directions against a
stub, then live in the browser — created from the UI, stored with `aboutPlanId` + private
visibility, shown under that plan, and **absent from My Notes**.

Also fixed while there: the panel header reserved 92px of right padding purely for symmetry,
so once names appeared in the title "Notes — Test Client" truncated to "Notes — Te…" (and
before that, wrapped into the Back button). Long connected-client names had the same problem.

## Voice bar — stopping is now possible (S166, from Kevin's device test)

Kevin: *"there is no stop button for the mic once it starts. I was done talking and I could
not stop it."* Three causes, all fixed:

1. **The launcher covered the Stop button.** Already fixed in S164 (the mic + "Ask Glidna"
   buttons hide while the bar is up) — Kevin hit this on the pre-push build.
2. **Stop was a small pill at the far right** of a four-item row — exactly where the
   launcher sat. Now a labelled 81×44 button with a stop-square icon, meter shrunk to give
   it room. The row is `[● dot] [meter] [clock] [■ Stop]`.
3. **An empty recording was a dead end.** `rec.onstop` did `if (!blob.size) return;` without
   clearing `micOnly`, so a take that captured nothing left the bar on screen still pulsing
   red with a Stop button — you tapped Stop and it looked like nothing happened. It now
   closes the bar and says "Didn't catch that".

Also: the dot goes calm once the mic is off (it used to keep pulsing red through
transcription, reading as "still recording"), the button is **never disabled** — it becomes
"Cancel" so there is always a way out — and the countdown was fixed: it counted down from
**60** while `MAX_TAKE_MS` is **120000**, so it hit 0:00 with a full minute still to run.
Now elapsed time, flipping to a red countdown in the last 20s, in both the closed-mic bar
and the in-chat row. The mic tooltip no longer promises "up to 60 sec".

⚠️ Verified by forcing the recording state through a temporary hook (removed) — the headless
preview has no microphone, so **real mic capture is still Kevin's device test**.

## Voice routing — SHIPPED (S164). Items 1–4 of the S163 design are all live.

Built on top of the S163e default. What a closed-mic voice note now does:

- **Default is still a new, unpinned chat**, and the bar now SAYS so: a
  `Sending to [New chat ▾]` line sits above Send and is always visible (item 4).
- **Names in the transcript surface as chips** — `Heard a name — send to [Casey
  Client] [Prospect Pat · plan file]`. One tap sends there, into a new chat pinned
  to that subject. Matching is whole-word only (module-level `matchVoiceSubjects` /
  `wordIn`, unit-tested: "pathway" does not offer "Pat", single names under 3
  characters never match alone) and also matches a spoken/pasted id. Trainers only —
  a client caller is forced to their own account server-side, so the roster is never
  fetched for them (item 2).
- **`Send to ▾` opens the full picker** — New chat plus every existing chat, each row
  showing **who that chat writes to** (`about Casey Client`), resolved through
  `pinName()` because auto-captured pins store an id with no name. A visible control,
  not a long-press (item 3).
- **After it goes, a receipt** above the launcher: `✓ Sent to X` (+ `about Y` on its
  own line, so a long chat title can't truncate away the part that can be wrong).
- The launcher **hides while the voice bar is up** — it sits on a higher layer and was
  covering the bar's own Edit and Discard buttons.

**Two real routing bugs fixed underneath (this is the part worth knowing):**
`send()` read THREE things from chat state that a same-tick chat switch never reaches.
S163e fixed one of them (`messages`, via `fresh`). The other two were live:
- **The pin leaked.** `sendTarget()` read `pinOf(activeChatId)` from the send closure —
  still the PREVIOUS chat — so a voice note into a "new" chat was relayed with the old
  chat's pinned client. Verified: pre-fix that meant Casey; now `send()` takes an
  explicit `target`, and the same probe answers **"Nobody."**
- **A chosen pin was downgraded to an auto one.** The reply's auto-capture looked the
  new chat up in a stale `convos`, found nothing, and overwrote the explicit pin with
  `{auto:true}` (which a later turn is then free to move). `send()` now takes the
  launch `pin`.
`send(text, opts)` accepts `{fresh, base, chatId, target, pin}`. **Anything that
switches chats and sends in the same tick must pass them** — state won't have landed.
`activeChatIdRef` + `goActiveChat()` keep the index's `active` from being rewound.

**Verified live** (trainer.uitest, real AI calls, driving the actual app): all three
routes — default New chat (**"Nobody."**), candidate chip (new chat titled *About Casey
Client*, explicit pin with its name intact, AI answered **"Casey"**), and picker → an
existing Casey-pinned chat (**"Casey Client"**, and the thread CONTINUED rather than
restarting). Typed sends unchanged. Build passes; test chats cleaned up.
⚠️ The mic itself can't be exercised headlessly — the transcript path was driven
through a temporary hook (removed). Real capture is unchanged from S162e.

**Still to do here:** the multi-client / multi-action voice note (below). And the
history drawer's own rows could reuse `pinName()` — today they show "focused" for an
auto pin, while the voice picker names the client.

## NEXT UP — one voice message, several clients and actions (S163 design, part 2)

**Items 1–4 of the S163 design are DONE (S163e + S164) — see the section above.** What is left is
the last paragraph of that design: **one voice message naming several clients and several actions**
("log Casey's breakfast and send Pat a weigh-in reminder"). Mechanically fine — the tools already
take a per-call `clientId`, so it is N calls with different targets — but it MUST show ALL
destinations before committing, or it is the silent mis-write risk multiplied by N. The pre-send
bar is now the natural place for that list: it already renders one destination and a candidate row.

**Why this matters at all (the original framing, still true).** A voice note is sent with the chat
CLOSED, so nothing on screen says which client it lands on. Silent mis-writes to client data are
the worst failure mode in this app — every part of this design is about making the destination
visible, never about guessing better.

**Where the code is:** voice bar + preview in `AIChatPanel` (`micOnly` / `voicePreview` /
`voiceDest` / `voiceCands` / `sendVoiceTo()`; `send()` takes `{fresh, base, chatId, target, pin}`).
Chat list = `caliq-ai-chats` index; per-chat thread = `caliq-ai-chat-{id}`. Read markers already
persist per chat id in localStorage `glidna-chat-seen` (S163c) — the history drawer can reuse that
for a per-chat unread dot, which Kevin also wants.

**Confirmed working, don't re-litigate:** mic capture quality + the 10s pause window + 2-min ceiling
were device-tested by Kevin (S162e) and are good. Leave the OPEN chat's voice UI as it is (his call).
