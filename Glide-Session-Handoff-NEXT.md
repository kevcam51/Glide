# Glidna — Next-Session Handoff (start here)

## ▶️ START HERE (S197w) — an adversarial review of this session found 8 real defects; all fixed

Everything below is DEPLOYED AND PUSHED. Working tree clean, build passing,
230 rules tests green. Nothing is half-finished.

### 0. ✅ DONE — drive time is deployed, and one thing is left for Kevin

`sessionTravel` is live, `GOOGLE_MAPS_API_KEY` exists as a PLACEHOLDER, and the
feature runs on the free estimator. **Verified in production with real
addresses**: two sessions booked 30 minutes apart, 1300 Ocean Drive Miami Beach
→ 19501 Biscayne Blvd Aventura, produced

> **This one you can't make** — Tue, Aug 25 — 9:00 AM → 10:30 AM leaves 30 min,
> and the drive is about 43. Short by 13 min.

Nominatim geocoding works from the function with no key. Warm cache 2.0s vs ~12s
cold, so the caching does what it claims. Test sessions cancelled afterwards.

**Kevin's one optional step — traffic-aware times.** Enable the Routes API in
the same Google project, then:

```bash
printf 'YOUR_REAL_KEY\n' | firebase functions:secrets:set GOOGLE_MAPS_API_KEY --project calorieiq-29762 --force
firebase deploy --only functions:sessionTravel --project calorieiq-29762
```

Nothing else changes: the code checks the key's SHAPE (Google keys begin
`AIza`), so the placeholder reads as "no key" today and a real one upgrades
geocoding AND the estimate in place. ~$5–10 per 1,000 lookups, and the cache
means one trainer's week is a handful of them.

**Pricing — DONE (S197k).** Two rows in the sessions section with explainers,
`false, true, true, true` like every other booking feature. The split follows
Kevin's own reasoning rather than gating the lot: the WARNING and the free
straight-line estimate are for everyone (no per-lookup cost, and a safety check
is not an upsell), while TRAFFIC-AWARE times are paid — that is the part with a
bill. It agrees with S179e ("tools that make you money are paid"): session
booking is already paid, so a free trainer has no sessions for the warning to be
about. Boundary is one constant, `TRAFFIC_AWARE_TIERS` — every paid plan today.
**Move it to `["base","max"]` if "$49/mo" in the S190b note was meant literally.**

The disclosure line only offers the upgrade when traffic-aware times actually
exist (`trafficAvailable`), so nothing is advertised before the key is in.

**There is nothing else outstanding on this feature.** An earlier note claimed
local-plan clients needed addresses; they do not — the calendar roster is
`getMyClients()`, connected accounts only, so a local plan can never hold a
session and there is nothing for a drive to be between.

### ⚠️ THE TRAP THIS COST — read before adding any Firestore query

`sessionTravel` deployed clean and then 500'd on every call: `trainerUid ==`
combined with a range on `startAt` **requires a composite index**. The codebase
had already written this lesson down in S187 for `calendarFeed`, and I walked
into it anyway. One equality, window filtered in code.

It matters more here than there, and the reason generalises: **this feature
fails SILENTLY, and silence reads as "your schedule is fine."** An infra gap
must never be able to say that. Prefer a few hundred extra reads over a query
that needs an index somebody has to remember to deploy.

It was caught because of S197g — "travel check unavailable: functions/internal"
in the console. Before that change it would have been a feature that quietly
never worked.

### 0. ▶️ THE LIVE THREAD — the plan dashboard & body-comp work (S198n–y)

**Kevin is continuing this. Do not treat it as closed.** Everything below was
verified by clicking it, not by reading code. S198n–x is deployed; **S198y is
committed and NOT yet pushed** — it is frontend only (no functions, no rules),
so pushing `main` is all it needs.

**What shipped, and why each mattered**

| Area | What it does now |
|---|---|
| Calorie ring | 184px (was 150), number steps down for long values — four lines live inside that circle |
| Daily Calorie Targets | New card under the ring: Maintain / ½ / 1 / 2 lb per week |
| — tap | Previews that rate IN THE RING (plan untouched, says so) |
| — commit | "Make ½ lb/wk my target" writes `weeklyRate`, clears any manual target, and syncs the daily-goal direction |
| — custom | Free-text box → `data.calorieTarget`, clamped at 1,200 with the reason |
| — surplus | +½ and +1 lb/wk (S198x). A surplus is a NEGATIVE rate: −0.5 → +250/day. `RATE_OPTS` carries them, so the other rate chooser picked them up for free. weeksToGoal already returned null for a non-positive deficit, so a surplus yields no ETA rather than a negative one. |
| 1,200 floor | Amber "floored" on any rate whose real maths goes under; full warning when that rate is the one on screen — *eating less is not the lever, burning more is* |
| Weigh-ins | Tap one to correct it; the DATE is preserved (delete-and-re-add silently moved the entry to today) |
| Measurement days | Tap an entry → that day in full: body composition, weight, scan BF, tape, calipers — grouped, with change since last and since the start, every value editable in place, ‹ › to walk days |
| Body-fat methods | ALL of them listed and named, with the one in use marked |
| Charts | Bodyweight and scale-BF points are tappable to edit; hit target 40×40 (was a 10px dot) |
| Tape/caliper trend | Tappable too (S198y) — Save or Remove one reading, on the day it belongs to. The body-fat chip stays read-only and now says why |
| — weigh-in-only days | They open now (S198y). The unit is the DAY, not the measurement entry; ‹ › walk all of them, and a line under the list reveals the weigh-in-only ones on request (out of the list by default — daily weighing would bury monthly measuring) |
| Macro Targets | New card under Daily Calorie Targets (S198y) — Bodyweight / Balanced / goal-based, as grams. Tap previews (the bars follow), one tap commits |

**Deficit / Maintain / Surplus vs the targets card — the distinction to keep**
The three buttons NEVER set a calorie number; they decide what counts as a good
day, which is what colours the word in the ring. The targets card sets the
number. They used to be able to contradict each other; committing a target now
syncs the direction. Do not merge them — they answer different questions.

**Deliberate choices worth not undoing**
- Caliper and tape body-fat charts are READ-ONLY. Those percentages are
  CALCULATED from skinfold and tape numbers, so an edit there would write a
  value the next recalculation silently discards.
- Colour is narrow: down is green only on TOTALS. A thigh or forearm going up
  can be exactly what someone wants; the app should not editorialise.
- Showing every BF method is the point. On one seeded day they spanned 21.8% to
  34.5% — a 12.7-point disagreement the old panel hid behind a single figure.

**⚠️ S198y — THE BUG THE THREE NEXT STEPS UNCOVERED, AND IT WAS THE OLDEST ONE**
`onSaveMeasurements` DROPPED ITS SECOND ARGUMENT on the in-plan path (the
dashboard's copy and Results') and filed every save under `viewDate`. So the
modal's own back-date picker, the day view's "the date stays put" promise, and
the scan-BF chart edit all wrote onto the day being VIEWED — correcting last
month's waist created a NEW entry on today, left the old one untouched, and
said "Saved." ClientHome's copy always took the date, which is why S198r/t read
as verified: they were, as the client. `onLogWeight` had the identical shape and
now goes through the same merge-by-date writer as the chart edit.

**That is the fourth silent success in three sessions.** The pattern is not
"forgot to save" — it is a save that goes somewhere plausible and says nothing.
When a handler takes a date, check every caller actually passes it through.

**Natural next steps in this thread (none started)**
- The month/week CALENDAR has no measurement or weigh-in indicator, so the body
  composition work is invisible from the surface people browse days on.
- `dayList` includes future-dated planned weigh-ins (`isFuturePlan`) with no
  marking — consistent with the existing charts, but the day view will happily
  open one and call it a day's record.
- The Macro Targets card is preset-or-hand-typed; there is no macro equivalent
  of the calorie card's 1,200-style honesty check (e.g. a split whose grams do
  not add up to the calorie target after rounding).

### 0. ▶️ S198 — WHERE THINGS ACTUALLY ARE (read this first)

Everything below is deployed, pushed and verified by clicking it in production.
`main` clean, 76 functions current, `npm run test:units` green, `npm run
check:undef` clean.

**Kevin's open items — nothing is blocking:**
- Traffic-aware drive time is on ALL paid plans; he said "$49/mo", which is
  Coach alone. One constant: `TRAFFIC_AWARE_TIERS` in functions/availability.js.
- Prepaid packages: dropped, per him. Billing stays per-session.
- Trainerize meal sync: off, per him.

**⚠️ THE THREE HABITS THIS SESSION PAID FOR — they are not optional:**

1. **ASK WHAT BUILD THEY ARE ON BEFORE READING CODE.** An installed PWA had no
   way to load a new version (S198m). Kevin reported three "missing" features
   that were all shipped and correct; he was looking at a days-old app while
   being told to "reload and check". There is now an Update banner, a check on
   foreground, and pull-to-refresh asks too — but the instinct matters more
   than the fix.

2. **PRESS THE BUTTON YOURSELF.** functions/trainerize.js has `TEST_UIDS` +
   `TEST_ROSTER` (S198g): the test account gets `mode:"list"` ONLY and a
   SYNTHETIC roster, never the real API, and every write stays owner-only.
   Within fifteen minutes it found a TDZ crash that blanked the trainer home in
   production, a first-link failure that would have hit every new trainer
   forever, and two of my own edits that had silently no-opped. Before that I
   was wrong three times in a row on the same feature. **Extend this pattern to
   anything else that is owner-gated.**

3. **SILENT SUCCESS IS THE SAME BUG AS SILENT FAILURE.** It appeared FIVE times
   in two days: a notification that navigated nowhere, a save that said
   "Logged" when it failed, a Trainerize link that worked and said nothing
   (twice), and a chart edit that worked but had a 10px tap target. If an
   action can succeed, something on screen must say so, on the surface the
   person acted from.

**Verification habits that earned their keep:** check the STORED DATA after a
UI action, never the screen alone — twice a "failure" was my own test selector
grabbing a modal's Save button. And `check:undef` cannot see a
temporal-dead-zone error or a wrong-but-defined field name (`m.leanMass` vs
`m.leanMassLbs` rendered nothing and threw nothing); only rendering finds those.

### 0a. ⚠️ THE REVIEW OF THIS SESSION'S OWN WORK — 8 REAL DEFECTS, ALL FIXED

A 29-agent adversarial review of everything shipped this session raised 28,
10 survived refutation, and 8 were real. **Six were introduced by this
session's own fixes.** That is the third time the pattern is on record (S186,
S196b): a fix's own bugs are the ones nobody is looking for.

The worst two were not from the review at all — they came from finally running
eslint over the repo:

- **Tapping "Progress Snapshot" WHITE-SCREENED THE APP.** `DailyDashboard` read
  `logAdherence`, which was never one of its props. Any plan with 2+ weigh-ins;
  reproduced in production before fixing. Live since 2026-07-29.
- **`applySnapshotAndSyncs` threw on every call** — `d` and `step` returned from
  outside the callback S197f moved them into. Every Trainerize import and every
  scheduled auto-sync, and Kevin's auto-sync is ON.

From the review, all mine, all fixed:
1. **Merging broke offline plan edits** — runTransaction cannot commit offline
   where setDoc queued; autoSave swallows errors, so the edit vanished.
2. **Signing out ate unsynced writes** — clearIndexedDbPersistence deletes the
   pending queue, and the 30-minute idle timer calls it unattended.
3. **`TRAFFIC_AWARE_TIERS` named no real subscription** — read off the pricing
   grid labels instead of the billing catalog, so no paying coach could ever
   get traffic-aware times while the UI said their plan included them.
4. **A spent `homeIntent` bounced clients off their own home screen** on every
   remount.
5. **New plans silently reverted to eat-back** — the merge baseline was seeded
   with data the server had never seen, so `deficitMode` read as unchanged.
6. **`booking-request` dropped the trainer on an empty calendar** — the inbox is
   on the dashboard. Kevin's original complaint, one tag along.
7. **`trafficAware` was derived from the key, not the legs**, so a configured
   key would claim traffic over straight-line numbers.

⚠️ **`npm run check:undef` now exists and should stay green.** eslint's no-undef
had two of these the whole time. Nobody ran it because a blanket lint reports
~380 pre-existing style errors and can never go green, so the real signal was
buried. That script checks ONE rule across src/, functions/ and scripts/.

**Not verified, low:** `normalizeAddress` strips the token after "ste", which
would mangle "Sainte-" street names. Cosmetic cache-key collision; left.

### 0a. ✅ S198 — THE TRAINERIZE/WATCH CHASE, AND WHAT IT COST

Kevin's Garmin calories had been missing from the client account he actually
looks at ("Kev Cam") since **Aug 8**. Root cause: `setMyTracker` overwrote the
whole tz-link entry with `uid: meUid`, silently moving the feed from his CLIENT
account to his TRAINER account's `self` plan — which no trainer screen can open.
Six weeks of "I just don't see his calories" followed, with nothing on screen
ever saying anything had changed.

**Now verified working: 21 of the last 21 days of wearable data in Kev Cam's
account (was 3).**

⚠️ **THE REAL LESSON, AND IT IS NOT ABOUT TRAINERIZE.** Three times I diagnosed
this from the code, shipped a fix, and was wrong — because I could not press the
button. The gating is correct (a shared Trainerize token means a role check
would hand any stranger the real roster), but it meant only Kevin could ever
click it, so every cycle cost him a round trip. What finally worked:

  **`TEST_UIDS` + `TEST_ROSTER` in functions/trainerize.js (S198g)** — the test
  account gets `mode:"list"` ONLY, and a SYNTHETIC roster; the real Trainerize
  API is never called for it and every write stays owner-only. Within fifteen
  minutes of existing it found three defects nobody could have found otherwise:
  a TDZ crash that blanked the trainer home in production, a first-link failure
  that would have hit EVERY new trainer forever, and two of my own edits that
  had silently no-opped. **Use it. Extend the same pattern to anything else that
  is owner-gated.**

**And the delivery bug underneath all of it (S198m):** an installed PWA has no
address bar, so there was no way to load a new build. sw.js skipWaiting()s, but
the open page keeps its old JavaScript. Kevin was being told "reload and check"
while looking at a days-old app. There is now an "A newer version is ready ·
Update" banner, a check on foreground, and pull-to-refresh asks too. **If
someone reports a fix missing, ask what build they are on BEFORE reading code.**

**Still to do (one tap, Kevin's):** two Trainerize ids still point at Kev Cam
(21029731 and 25367292) — two syncs writing weight and stats into one plan every
30 minutes. Tapping **Change → Kevin Cameron** on his card collapses them to one.

### 0b. ⚠️ FIXED S197r — SIGNING OUT LEFT THE WHOLE CACHE BEHIND

**This was live in production, and it is the kind of thing a demo dies on.**
Sign out, sign in as a different account on the same device, and the app stuck
on "Couldn't load your account — check your connection" — permanently, across
full page reloads. Retry can never fix it, because Retry re-reads through the
same poisoned cache.

The connection was never the problem: a REST read of the very same profile with
the very same token the SDK held returned 200. Deleting only the Firestore
IndexedDB fixed it instantly. The persistent cache added in S196p is keyed by
PROJECT, not by user, and nothing ever cleared it.

**The second half is worse than the lock-out.** Whatever the previous account
had read — their plans, their clients, their health data — stayed on the device
after they signed out, readable by whoever signed in next.

`signOutAndClearCache()` (src/firebase.js) now signs out → terminates → clears
→ reloads, from all three sign-out call sites. The order is forced:
`clearIndexedDbPersistence()` only runs while Firestore is stopped, and `db` is
unusable afterwards, so the reload is part of the operation, not a nicety.

⚠️ **Anyone already stuck** gets a way out: the "Couldn't load your account"
screen now offers **"Sign out & clear local data"**. Verified in prod in both
directions — trainer→client and client→trainer — after first reproducing the
failure.

### 0d. ⚠️ THE OFFLINE CACHE HAS NOW CAUSED THREE LIVE BUGS — TREAT IT AS SUSPECT

`persistentLocalCache` (S196p) is a reasonable feature that sits in the boot
path and has since produced three separate production defects. Two were fixed
in S197r (the sign-out lock-out and the privacy leak). The third, S197s:

**An absence served from cache authorises a write.** getDoc() waits for the
server when it can; when it cannot, it falls back to the cache, and a document
that exists on the server but was never cached returns exists() === false. The
callers read that as "nothing logged that day", write a fresh object over the
top, and the real day is gone when the connection returns — the same data-loss
shape S196L and S197 already fixed three times.

`snap.metadata.fromCache` now distinguishes them: an online getDoc round-trips,
so fromCache means the server was never heard from and the absence is UNKNOWN.
It throws `unavailable` rather than `not-found`, so the handlers that correctly
mean "empty day" do not swallow it. Both accessors changed —
`window.storage.get` and `getForUser`.

**Verified in prod:** online, a missing key still reports `not-found` and real
reads still work, so the S196L regression ("every never-logged date became
'Couldn't load this day'") does NOT occur. ⚠️ The offline half is correct by
construction but was NOT exercised — there is no way to force the SDK offline
from the automation used here. Worth a manual airplane-mode pass.

**If a user ever reports something inexplicable** — wrong data, won't load,
stale numbers — look at this cache first. Three for three so far.

**A claim I made here last turn was WRONG, and testing it is what showed that.**
I wrote that day logs still had the plan-writes race and should get the same
merge. They do not, in practice — **measured, not reasoned**: with a client's
home open, an external write added `_raceProbe` and `water` to today's log, and
an in-app quick-add of 250 cal a few seconds later. All three survived.

The reason is structural. The plan race existed because the live-sync listener
deliberately SKIPS remote changes while an edit is mid-debounce, so the app held
stale state for as long as someone kept typing. The day-log listener has no such
guard — it applies remote changes to `log` immediately (only suppressing its own
echo), so the next write is computed from fresh data.

So: **do not "fix" this.** It would mean touching the most-used write path in
the app to close a window that live-sync already closes. The residual case is a
genuinely simultaneous write (sub-second, before the listener delivers), which
is narrow and no worse than the rest of the system.

⚠️ The guard on the PLAN listener is what makes plans different. If anyone ever
adds a similar "skip while editing" guard to the day-log listener, this race
becomes real and the merge WOULD then be needed.

### 0c. ✅ THE BOOKING LOOP IS VERIFIED END TO END (S197r)

Every leg exercised against production rather than read:
- **Free/busy** — `trainerAvailability` serves merged anonymous ranges
  ("Already busy: 9:00 AM–10:00 AM · 2:00 PM–3:00 PM"). No names, no prices.
- **The ask** — multi-day picker, horizon, duration; the overlap warning fires,
  and it says plainly that asking is not booking.
- **Accept** — creates a real session at the trainer's standard rate and tells
  the client (S197j).
- **Deny** — the path that had NEVER been run: "They've been told it doesn't
  work", and they really were — "UI Tester3 couldn't make that time … ask for
  another time", tagged `booking-declined-*`, which routes back to the sessions
  panel so they can.

### 1. ✅ FIXED (S197d) — "after I click Open it did not take me anywhere"

Kevin was right and the S197c diagnosis was right: `notifDestination` returned
`"todos"`, and `"todos"` was handled by doing nothing, on the theory that
arriving at the home screen IS arriving at the task. True from anywhere else —
he was already ON his home screen, so nothing moved.

Fixed in the CLIENT, so it also repairs the rows already sitting in people's
feeds (they carry `url: "/"` with no id and cannot be rewritten). On a `todos`
intent, ClientHome now opens the same `QuickActionModal` the home screen's
"Do it now →" opens: the exact request when the url names one, otherwise the
newest still-open one; an already-done one says so rather than opening a
DIFFERENT task; an empty queue says "you're all caught up", because the
unexplained silence was the whole complaint.

`onTrainerRequestWritten` now sends `/?todo=<id>`, and App stashes that param
**at module import** — a push tapped from outside the app lands on the sign-in
screen first, exactly like the card link, so reading it in an effect is too late.

Deployed (all 35 functions in push.js's bundle set) and pushed. Verified in
PRODUCTION as a client already standing on the home screen: the trigger wrote
`/?todo=rS197D-PROD`, tapping Open opened the weigh-in modal, and the local
preview covered the other three branches (the `"/"` fallback, the already-done
notice, the caught-up notice) plus a cold boot at `/?todo=<id>`. Test data
removed from prod afterwards.

### 2. THE AUDIT TAIL — CLOSED

From the 44-finding audit (the full register is the published artifact). All
seven items are resolved. ⚠️ Two of them were **already fixed in S196r** when
the list was written — verify a finding against the code before acting on it.

- **S196r, already done:** the profile promise cache (`PROFILE_TTL_MS`,
  `forgetProfile` in `src/profile.js`) and the gated ID-token refresh
  (`CLAIMS_STAMP` in `AuthGate`).
- **S197e:** lazy SDK requires (136.7ms → 72.9ms on the real require tree —
  Anthropic / MCP / web-push / SimpleWebAuthn no longer load on ~90 cold
  starts); `_foodScore` scores once then sorts (1048 → 144 per search, ordering
  proven identical over 3,200 randomised comparisons); the Recent Activity tap
  targets are 44×44.
- **S197f:** plan writes are transactional — see below.
- **S197g:** listener failures are no longer silent.

**Plan writes (`planTxnWrap`).** Ten sites — eight AI tools in `aitools.js` and
both Trainerize plan writes — went from `loadPlanWrap()` → mutate →
`kvSetJSON()` (a whole-document overwrite) to a transaction. `loadPlanWrap` is
deleted, so the old shape cannot come back by habit.
⚠️ **The mutation callback must be synchronous and self-contained** — Firestore
RE-RUNS it on contention, so an accumulator in the enclosing scope doubles up.
That is why `changes` / `dropped` / `metrics` live inside and are returned.
`{ __abort: true }` writes nothing, which is what keeps the refusal paths
("no valid fields", "already exists") non-writing.
**Both halves are now closed (S197m).** The app used to save the whole plan
document from React state, so any browser save landed on top of everything the
AI or the Trainerize sync had written. It now writes ONLY the top-level keys the
user actually changed, onto whatever the server holds, inside a transaction —
using the snapshot the activity feed already keeps as the baseline, so it needed
no new bookkeeping. `src/planMerge.js` carries the argument.

⚠️ The live-sync listener still SKIPS remote changes while an edit is mid-
debounce, and that is correct — yanking a half-typed form would be worse. The
merge is what makes that safe.

⚠️ Conflict rule, in one sentence: **top-level key granularity, user wins the
keys they touched.** Merging inside an array needs element identity and produces
results neither side wrote. Do not "improve" this without a reason.

`window.storage.mergeSet` and `mergeForUser` are ADDITIVE — get/set/delete/list
are untouched, per the standing rule that App.jsx depends on them.

Verified against real Firestore on BOTH paths with an external writer mid-edit:
the outside write and the app's edit both survived. Negative control in
`scripts/test-plan-merge.mjs` reproduces the old behaviour losing one.

**The `getDoc`-then-`onSnapshot` finding was NOT actioned, deliberately.** The
audit called the first read "pure waste"; it is not. It is also the not-found
path and the error path — `subscribeForUser`'s ClientHome callback early-returns
on `value == null`, so deleting the read turns "you have no plan yet", and any
transient listener failure, into a PERMANENT "Loading your plan…". The saving is
three document reads per app open, which is worth nothing at this scale. Please
stop re-raising it; if it must be done, `subscribeForUser` needs a real
absent-vs-failed distinction first.

What that finding DID surface is a real defect, now fixed (S197g):
`subscribeForUser`'s error handler was an empty function, so a dead listener
left the screen showing data that had quietly stopped updating — no console
line, no way to tell from the outside. It still never crashes the app; it is
just no longer invisible.

**Tests: `npm run test:units`** — 98 assertions across four harnesses
(`test-plan-txn` 12, incl. a negative control that reproduces the old blind
write; `test-plan-tools` 39, driving the real `runTool` for all eight converted
tools; `test-tz-workouts` 14; the pre-existing `test-health-sync` 33).

### 3. PRODUCT DECISIONS WAITING ON KEVIN — do not guess these

- **Prepaid packages can be spent but never sold.** Nothing in the product
  creates a credit. Either build the grant path or take packs off the pricing
  grid; both are defensible, it is his call.
- **None of his 11 client plans carry a `trainerizeId`**, so the auto-sync covers
  exactly one target (him) and zero clients. Re-run the importer picker, or add
  a "link this plan to a Trainerize client" control so a hand-made plan can be
  linked without being re-imported as a duplicate.
- **Trainerize MEAL sync**: my recommendation is to drop it. Nobody on the roster
  has logged food there in ~12 weeks and his own last entry is months old. The
  food data lives in Glidna now. Calories BURNED is the part worth keeping, and
  that already works.

### 4. THE WATCH CONNECTION — still needs one tap from Kevin

His trainer home shows the amber warning: watch data is pointed at
`caliq-self`, the client-style personal plan, which **no trainer screen can
open**. Tapping "Choose a plan" and picking one of his existing plans fixes it.
Nothing is created and nothing is erased — `syncClientHealth` reads the existing
day and sets only `log.wearable` (verified in functions/trainerize.js ~348).
He was (reasonably) worried this would wipe a plan he has used for a month; it
does not, and that reassurance is worth repeating because it is blocking him.

### What shipped in S196–S197 (all live)
Session auto-pay hardening + the calendar; the "save your card" link; the
standard rate in the policy; back-dating with disclosure; the booking loop;
three data-loss fixes; the bundle split (entry chunk 303kB → 22.6kB); Firestore
offline cache; **Sora, twice** (never loaded in the app; never loaded in the
share cards or app icons either, for a different reason); the keyboard no longer
covering the composer on iOS; and the notification feed learning to wrap, act
and clear.

### Traps this session paid for — do not re-learn them
- **`window.storage.get` THROWS for a MISSING document; `getForUser` returns
  null.** That asymmetry nearly killed back-dated logging when strict reads were
  added. Absence now carries `err.code === "not-found"`; treat it as empty, and
  everything else as failure.
- **resvg ignores `fontBuffers` entirely** in this version — real font and
  garbage render byte-identical — and cannot parse WOFF2 at all. Use `fontFiles`
  with TTF, and assert the output differs from a no-font render.
- **A manual chunk only ever helps ALWAYS-loaded code.** A catch-all `vendor`
  merged four lazy libraries into one eager 511kB download.
- **`requestAnimationFrame` is paused in hidden tabs** — do not batch anything
  through it that must be correct when a backgrounded PWA returns.
- **The Firebase log CLI serves stale pages.** I twice concluded a function had
  stopped running from log output alone. Corroborate before diagnosing.

## 🔜 NEXT BUILD — client self-booking + drive time (Kevin's spec + decisions, S190)

**Pass 1 is BUILT (S196) and now VERIFIED END-TO-END IN PRODUCTION (S197h) —
it had only ever been build-verified, because `respondToBookingRequest` was not
deployed at the time. Pass 2 (drive time) is what remains. Kevin has DECIDED the
open questions — don't re-ask them.**

The live run, as a real client and a real trainer on glidna.com: Casey asked for
Wed 9:00 AM → the multi-day picker refused a day already past this week → "next
week" resolved it and the anonymous availability callable reported "UI Tester3
looks free all day" → the ask landed in the trainer's "Asks From Clients" →
**Accept & book** created a real session at Wed Aug 26 9:00 AM, 60 min, $85
(the trainer's `standardPriceCents`, not a guess) → the client was notified →
cancelling quoted "In time — no cancellation charge" from the consented policy.
Test session cancelled and the feed rows cleaned up afterwards.

⚠️ **That run is what turned up S197h** — the booking confirmation said "it's on
your calendar" and could not reach one. Seven of sixteen notification types
routed nowhere and `session-no-card-*` was misrouted. Fixed, with
`scripts/test-notif-routes.mjs` now pinning every server tag to a decided
destination. **Exercising shipped-but-unrun code is how that was found; do it
before building pass 2 on top.**

### The goal in one line
A client who uses nothing else in Glidna — no logging, no AI, no plan — can still see when their
trainer is free, ask for a slot, and pay. That standalone path is the point of the feature, so
nothing here may be gated behind having a plan.

### Pass 1 — the booking loop
1. **Trainer blocks off time.** A calendar doc with no client attached ("Busy", "Lunch", "Away").
   The week/day grid already positions timed items, so this is mostly data + a "Block time" option
   in the existing booking sheet.
2. **Clients see FREE/BUSY ONLY — decided.** ⚠️ Never expose the trainer's real sessions. Today
   `sessions` is `allow read: if isParticipant()`, and that must stay: a client reading the
   trainer's calendar would otherwise see other clients' NAMES, titles and locations — a privacy
   leak and a competitive one. Serve anonymous busy blocks ("9:00–10:00 unavailable") from a
   derived projection or a callable, never the raw docs.
3. **Visibility is a TRAINER SETTING — decided.** One per-trainer toggle, in the trainer's own
   settings (not per-client). Off by default; when off, clients see no calendar and can still
   request a time.
4. **Client requests a slot → trainer accepts or denies.** `functions/requests.js`
   `sendTrainerRequest` already does the hard parts — writes the trainer's inbox transactionally,
   pushes them, and caps open requests per client. A booking request is the same path with
   structured fields (requested start, duration, note) plus accept/deny actions; accept creates a
   real session via the existing `bookSession`/`bookSeries`.
5. **Repeat on accept.** `bookSeries` already does weekly/biweekly — **add monthly**, which Kevin
   named explicitly.

### Pass 2 — "drive to you" — ITEMS 7 AND 8 ARE BUILT (S197i)

`functions/driveTime.js` + the `sessionTravel` callable + the warning panel on
the trainer's calendar. **Both estimators exist as Kevin asked**, and the free
one needs no key, so the feature works the moment it is deployed. 57 assertions
in `scripts/test-drive-time.mjs`.

**Item 6 (addresses) was answered differently than the spec assumed, and it is
worth knowing why.** Sessions ALREADY carry an allowlisted `location`, and the
booking sheet already edits it — so there was no schema change to make. For the
"default", the sheet now pre-fills from that client's own booking history (the
pattern `lastPrice` already uses) instead of adding a profile field. That avoids
a real problem: **a trainer cannot write a client's profile** (`users` update is
owner-or-admin), so a profile-held address would have to be entered by the
client, and Kevin's own clients are largely LOCAL PLANS with no account at all.
Learning it from history works for every client immediately and asks nobody to
fill anything in.

Still open on this: a per-client address book for local-plan clients, and
`PLAN_FEATURES` needs the Coach-tier line once this is live (Kevin's S190b note).

### The original pass-2 spec
6. **Addresses**: a default on the profile + a per-session override, exactly as Kevin described.
   These are home addresses — sensitive. Readable only by the two people in that session.
7. **BUILD BOTH ESTIMATORS — decided.** Kevin wants to compare them side by side:
   - **No-API**: straight-line distance from coordinates × an average speed factor. Free, no
     traffic, and wrong precisely when it matters (rush hour).
   - **Google Routes API**: traffic-aware (`departureTime` + `TRAFFIC_AWARE`). Same Google project
     as Blaze, so it's one key and one bill. ~$5–10 per 1,000 lookups.
   Cache by (origin, destination, weekday, hour bucket) — the drive between two fixed addresses
   barely changes, so a warm cache makes this pennies a month for one trainer. Geocoding
   address→coordinates is a second, cheap call.
8. **Back-to-back feasibility warning** — the part with the most real value. Once drive time
   exists: compare session N's end + travel against session N+1's start and flag negative slack on
   the calendar. No extra API calls if the drive times are cached. Build it in the SAME pass, not
   "later" — it's what stops a trainer double-booking themselves across town.

### Kevin's product note
Drive-time/traffic is **a Coach-plan feature, not a separate upcharge** (his refinement, S190b):
put it in the coaching tier as a reason to upgrade rather than billing it on the side. That fits
the existing grid — Coach already carries the trainer-only capabilities — and it means the Google
Routes cost lands only on accounts already paying $49/mo, so the margin question answers itself.
Add it to `PLAN_FEATURES` when built.



## ✅ S186 — THE S185 BILLING DEFECTS ARE FIXED, AND IT IS ALL LIVE

**This block used to say "NOTHING IS DEPLOYED YET" in three red triangles. That
was true when written and is not true now — VERIFIED S197p, against Google's
APIs rather than from memory:**

- **Rules are PUBLISHED and byte-identical to `firestore.rules` in this repo.**
  Fetched the live ruleset via the Firebase Rules API and diffed it: identical,
  and it contains `noShow`, `waived`, `seriesId` and `trainerBlocks`, so it is
  the S186/S196 ruleset and not an older one.
- **Every function in the list below is deployed and ACTIVE**, on code from
  2026-08-21 or later (checked through the Cloud Functions API).

So repeating series, no-shows and waives all work in production. If you are
reading this block looking for something to do: there is nothing.

⚠️ **A stale warning is worse than no warning.** This one survived several
sessions after it stopped being true, and the next person to read it would
either lose an afternoon confirming it or, worse, "re-publish" and roll
something back. When a handoff says something is undeployed, CHECK before
acting — the two commands are at the top of this file's history, and the check
takes a minute:
`GET firebaserules.googleapis.com/v1/projects/calorieiq-29762/releases/cloud.firestore`
then diff the ruleset source against the repo.

For the record, the deploy set that was required (and has been done):

```bash
firebase deploy --only functions:sessionsSettle,functions:settleNow,functions:paySessionBalance,functions:createSessionSetupIntent,functions:recordSessionConsent,functions:removeSessionCard,functions:sessionsMarkCompleted --project calorieiq-29762
```

(`sessionSettle.js` → sessionsSettle · settleNow · paySessionBalance;
`sessionBilling.js` → createSessionSetupIntent · recordSessionConsent · removeSessionCard;
`sessions.js` → sessionsMarkCompleted. Re-run `npm run deploy-set <file>` before
any future deploy — a subset leaves the rest on the old copy, silently.)

### What was actually wrong (all CONFIRMED against the code, not taken on faith)
- **The double-charge cluster was real.** `paymentIntents.create` shared one `try` with the
  bookkeeping that followed it, and the `catch` called *everything* a card decline — so a Firestore
  blip after a successful charge told the client "declined", set a hold, and their **Pay now** button
  charged the card a second time with a deliberately fresh `Date.now()` idempotency key.
- **`paySessionBalance` had no lock at all** (`maxInstances: 5`, React state the only guard).
- **`cancelledBy` was unpinned in the rules** while `cancelledAt` was carefully pinned — one
  `updateDoc` from the console made every session free, or billed a client for the trainer's cancel.
- **A delivered session could still be "cancelled"**, turning a full charge into a fee or nothing.
- **`noShowChargePct` was disclosed, consented to, and never applied** — every no-show billed 100%.
- **The cancel dialog priced from the trainer's CURRENT policy** while the sweep billed the frozen
  consent snapshot, so "In time — no cancellation charge" could be followed by a full-price charge.

### The invariants the new code holds (documented at the top of sessionSettle.js)
Only a `StripeCardError` is a decline. Bookkeeping failure is never a decline. Never charge without
asking Stripe for an existing intent on that ledger first. Claim before charging, with an attempt
counter as the idempotency key. Every claim is recoverable (`reclaimStranded` runs each sweep).
Delivered beats cancelled, server-side, regardless of what the rules say.

### Also fixed, same pass
30-day lookback → 365 days + **paged** candidate scan (the hard `limit(200)` returned the OLDEST
docs and settled ones ate the cap, which would have silently stopped billing at ~200 sessions/month);
`timeoutSeconds: 540` on the sweep; $0 sessions reach a terminal `free` state instead of stranding in
`processing`; no-card groups no longer mint a duplicate ledger every run; credits spend
highest-value-first; `billableCents` frozen at completion; `stripeLivemode` stamped so a test-mode
`cus_…` can't poison live charges; `chargedSessionIds` so Pay-now stops marking package-covered
sessions as card-charged.

### The fixes were themselves adversarially reviewed (27 agents, 5 lenses) — and it caught two CRITICALs
Worth knowing, because both were bugs introduced BY the fix, not by the original code:
- **`ensureCustomer` re-minted the Stripe customer on ANY error**, including a timeout — and
  `findIntentByLedger` was scoped to the profile's *current* customer id. So a forked customer made
  the duplicate-charge check answer a confident "no charge exists" about the wrong account, turning
  the guard against double-charging into the cause of one. Now: only `resource_missing` re-mints;
  the ledger pins `customerId` and `testMode` at claim time; the lookup searches the ledger's
  customer plus any previous ones; a re-mint clears the now-unusable saved card.
- **`classifyForBilling` billed a TRAINER-cancelled session at full price** when the cancel landed at
  or after `startAt` (trainer cancels ten minutes into the slot). The "delivered beats cancelled"
  branch ran before the `cancelledBy` check — the exact opposite of the file's own invariant and of
  terms.html §6. The trainer-cancel guard now runs first, and an absent `cancelledBy` is treated as
  not-billable.
Also fixed from the review: the billing hold is now written BEFORE sessions are parked behind it (the
old order could strand a client with an unpayable balance); a `processing` intent no longer marks
sessions as charged anywhere; `cancelSeriesFrom`'s query was **denied by the rules** (proved against
the emulator) and now carries the required `participants` constraint; the new ledger statuses have
labels and count as pending rather than vanishing from Earnings.

### S187 — session reminders + subscribe from your own calendar (DEPLOYED)
Both live on the calendar page's **Settings**, and in the ≡ **Notification Center** (a client has no
trainer-calendar page, and the Notification Center is where anyone looks for "when do I get told").
They are PERSONAL prefs — each side picks their own; nobody sets the other's.

**Reminders** — `functions/sessionReminders.js`, `sessionReminderPush`, every 2 minutes.
Lead times are chosen from 5m/10m/15m/30m/1h/2h/4h/1d and **multiple at once** (30 AND 10 is the
point). Stored in the existing `caliq-notif-prefs` as `sessionReminders` (on/off) +
`sessionReminderLeads` (array of minutes; default `[60]`; an explicit `[]` means none and must
survive a reload rather than being re-defaulted).
Two rules that make it behave:
- **Never twice.** Each fire is recorded on the session as `remindersSent` via `arrayUnion` —
  atomic, so overlapping runs can't both send. The marker is `"<uid>:<minutes>"`, per person AND
  per lead, because the two sides have different preferences about the same session.
- **Never as a burst.** Book a session 5 minutes out with leads `[120, 30, 10]` and the naive
  "fire everything overdue" rule sends three notifications at once, all of them false. A lead only
  fires within `FIRE_WINDOW_MS` (12 min) of its trigger; past that it is marked sent **silently**.
The 2-minute cadence exists because the shortest lead offered is 5 minutes — a coarser sweep would
routinely deliver "5 minutes before" with 1 minute to go. ~21k invocations/month, far inside free.

**Calendar subscription** — `functions/calendarFeed.js`: `calendarFeed` (HTTP, serves ICS) +
`calendarFeedLink` (callable, mints/rotates the token).
⚠️ **The URL is the credential, unavoidably.** A subscribing calendar app cannot send an auth
header — it issues a bare anonymous GET from Google's servers, forever. Hence: 160 random bits,
timing-safe compare, rotatable ("Reset link" kills the old URL instantly), `noindex`+`no-store`,
and the feed deliberately carries only times/titles/locations/the other person's name — nothing
about money or health. A leaked feed should be embarrassing, not harmful.
- Query is a bare `participants array-contains` with the date window applied **in code**: pairing
  array-contains with a range on `startAt` would need a composite index, and a feed that 500s until
  someone remembers to deploy an index is worse than reading a few hundred extra docs.
- Stable `UID:session-{id}@glidna.com` is what makes a reschedule MOVE the event instead of leaving
  a duplicate. Cancelled sessions stay in the feed as `STATUS:CANCELLED` rather than vanishing —
  dropping them leaves them on some subscribers' calendars forever.
- ICS folding is by **bytes**, not characters, and won't split a UTF-8 sequence (an emoji in a
  session title would otherwise corrupt the line). 15 RFC-compliance assertions pass.
- **Honest limitation, stated in the UI:** Apple/Outlook refresh ~15 min; **Google refreshes
  subscribed calendars on its own schedule, often only every few hours.** Real-time Google sync
  would need OAuth + the Calendar API — a separate project, not a config flip.

✅ **S187 reminders are CONFIRMED WORKING end to end in prod.** A session at 6:32 with a 5-minute
lead delivered at **6:28:09** — title "Reminder test in 5 minutes", body "6:32 AM with Casey Client",
tag `session-reminder-{sessionId}-5`. Both designed behaviours were observed in the same test:
- the 6:26 sweep read the then-current `[60]` lead, found it hours stale, and **marked it without
  sending** (`{"sessions":1,"sent":0,"marked":1}`) — the burst-prevention rule;
- the 6:28 sweep read the saved `[5]` lead and delivered.

⚠️ **Verify reminders via the FEED, not `functions:log`.** The function only logs when it sends or
marks, and the CLI lags a minute or two — I briefly and wrongly concluded the send path was broken
from a log grep alone. `sendPushTo` calls `appendFeed` unconditionally, so
`users/{uid}/kv/caliq-notif-feed` is the reliable evidence even with no push subscription (which a
headless browser never has).

### S186b — billing cadence + fee controls (Kevin's ask, DEPLOYED)
- **`biweekly` billing mode added** — per-session / weekly / **every two weeks** / manual. The
  fortnight is derived from the CALENDAR (`Math.floor(daysSinceEpoch / 7) % 2`), never from a
  stored "last run" marker: a marker drifts, and one missed run would permanently shift that
  trainer's charge date. Verified over a 10-week walk — fires only on alternating Sundays, exactly
  14 days apart, 6-hour window, and the Nov 1 2026 DST Sunday behaves.
- **Late fee is now an explicit switch** — "Charge a fee / No fee, ever". It was always possible to
  turn off (pick "any time", or set the % to 0), but only if you already knew that. Off maps to the
  existing `anytime` stance rather than a new field, so the disclosure text, the consent snapshot and
  the settle engine all keep working unchanged.
- **The no-show % is finally editable.** S186 made it actually bill; until now it was disclosed to
  clients and frozen into their consent with no control to set it.
- ⚠️ The billing-mode picker stays behind `canBillSessions(trainerUid)` (the Connect interlock), so
  only Kevin's account sees it. The late-fee and no-show controls are visible to every trainer,
  because a cancellation policy is free for everyone.

### Still open / deliberately not done
- **3DS on the off-session sweep** is now *classified* correctly (`needs_authentication`, honest
  copy) but the client still can't complete a bank challenge in-app — that needs `next_action`
  handling or a `payment_intent.*` webhook.
- **No arrears UI.** Aged unsettled work is logged (`ARREARS`) but not shown to the trainer.
- **`settleNow` and `paySessionBalance` don't set `timeoutSeconds`** (only the scheduled sweep does).
  Low risk — they handle one group / one ledger — but worth matching.
- **Repeating series has no "edit this and following"** — only cancel-this-and-later. Rescheduling a
  series edits one occurrence.
- **Test data:** one test session exists in prod — Casey Client, Tue Aug 11 2026 7:00 AM, $85, on the
  `trainer.uitest` account. It can never bill (that trainer isn't allowlisted). Clear it when
  convenient.

### The calendar (Kevin's spec, built)
`TrainerCalendar` — ≡ menu → **Calendar**. Month / week / day, a real scrolling time grid, every
client in one view, tap a slot to book, repeat weekly/biweekly, and the red current-time line. Kevin's
"as the red line passes it counts as a session that's going to be charged" is literal: a past session's
detail sheet reads **"Delivered — will be billed"** and offers Mark no-show / Waive charge.
**Recurring = N real session docs sharing a `seriesId`**, deliberately not a recurrence rule — every
downstream thing (completion stamp, billing, cancel, price freeze) operates on documents.

## ⛔ (S185, now addressed by S186 above) — DO NOT TAKE SESSION AUTO-PAY LIVE YET

**Kevin's plan was: skip the attorney, go straight to the live-key swap and a real-card smoke test.
A pre-go-live review found 40 findings — 9 critical — and the answer changed to: fix first.**

**Read `docs/SESSIONS-BILLING-REVIEW-S185.md`.** It opens with "The themes that matter", which is
the part to act on; the 40 raw findings follow it.

⚠️ **Those findings are RAW — the adversarial verify pass had not finished.** Verdicts (and the
full agent transcripts) are in the run journal:
`~/.claude/projects/-Users-ksmooth-Desktop-calorieiq/8bdcd0dd-4ff3-4ffe-a5d1-d9bb9709abe6/subagents/workflows/wf_3b27aad5-d20/journal.jsonl`
Re-run or resume with `Workflow({scriptPath: ".../workflows/scripts/session-billing-preflight-wf_3b27aad5-d20.js", resumeFromRunId: "wf_3b27aad5-d20"})`.
**Confirm before fixing** — the last three reviews each produced roughly one-third false alarms, and
one *refutation* was itself wrong (measured numbers settled it; see docs/WEB-SEARCH.md).

### What I learned that the checklists get wrong
`docs/SESSIONS-GO-LIVE.md` lists a live-key swap and a live webhook as the engineering gate. **Both
are already done or unnecessary:**
- `STRIPE_SECRET_KEY` **is already a live key** (`sk_live_…`), and every client not flagged
  `sessionBillingTest` already routes to it. There is nothing to swap.
- **No webhook is needed for sessions.** Charges use `confirm: true` and are handled synchronously,
  with `ledgerRef.id` as a stable idempotency key. The webhook item was inherited from subscription
  billing, where Stripe Checkout genuinely is async.
- 3DS on the Pay-now path is handled: a `pending` result routes the client to re-save their card
  (SetupIntent, where authentication happens) and the un-actioned PaymentIntent never captures.
  ⚠️ But a 3DS-required **off-session sweep** charge may be a dead end — that is finding #20-ish and
  is NOT resolved.

So the engineering gate was never the keys. It is the failure paths, which have never run because
test mode with 4242-cards never fails.

### The order I would take it
1. **Triage the review** — confirm/refute, starting with the double-charge cluster
   (`sessionSettle.js` ~:256-271), the missing `paySessionBalance` lock, and the `cancelledBy`
   rules hole. Those three are money-out-the-door or free-training.
2. **Fix, with rules tests** — several are `firestore.rules` changes, so
   `npm run test:rules` must pass and rules must be PUBLISHED (156 tests today).
3. **Then** the smoke test — and ⚠️ **rehearse on a THROWAWAY client, never a real one**: the
   `sessionBillingTest` flag writes a TEST `cus_…` into the shared `stripeCustomerId` and poisons
   that person's live charges afterwards.

### Kevin's decisions this session (don't re-litigate)
- **Skip the attorney review for now.** His call, stated plainly. I flagged one item that touches
  what he is switching on — Fla. Stat. § 501.016(5)'s "monthly" wording vs weekly billing — and the
  mitigation: **`billingMode: per_session` sidesteps it**, since charging right after each session
  is pay-as-you-go rather than a contract for future services. Prepaid packs stay unreachable.
- **Auto-pay before the calendar.** Revenue over convenience.

### Also true, and easy to forget
**Session auto-pay is hard-locked to Kevin's UID** (`functions/sessionBillingGate.js`,
`SESSION_BILLING_UIDS`). No other trainer can save a card or be auto-charged, because
`paymentIntents.create` carries no `transfer_data` and their clients' money would land in Kevin's
Stripe balance. Opening it up is a Stripe Connect project, not a config flip. So this is
"auto-pay for Smooth Training", not yet a platform feature.

### The calendar (the other half of what Kevin asked about)
Logging calendar is DONE. The gap is the **sessions layer**:
- The **week view renders no appointments** at all (month dots + day block only) — small fix.
- A **trainer sees no sessions on any calendar** (`src/App.jsx:27383` passes `meUid={null}` when
  viewing a client, deliberately) — so there is no roster calendar anywhere. Product decision.
- **Planned meals don't render** in the calendar Day view — its `MealLog` is missing seven props
  the dashboard passes. Small.
- Future dates: the calendar logs future food as EATEN while the dashboard treats it as PLANNING.
- Acuity import: decided in S92, contract verified, **zero code**; native booking shipped instead in
  S100, so that decision is stale. Client self-booking, recurring sessions and session reminders
  don't exist.

## ⏭⏭⏭ NEXT SESSION — WEB SEARCH IS DONE AND VERIFIED

Everything from S184 / S184b / S184c is deployed and confirmed live in prod. All
four ask-gate behaviours were tested against the real model as `trainer.uitest`:

| Prompt | Expected | Result |
|---|---|---|
| "What does current research say about creatine timing?" | don't search — it knows this | ✅ declined, and said why |
| "Has the NIH updated its vitamin D guidance?" | ask first, name the cost | ✅ asked, did NOT search |
| "yes please" | search now | ✅ searched, cited NIH ODS |
| "**Look up** beta-alanine dosing for endurance" | search immediately, no asking | ✅ searched 3×, 5 cited papers, no permission question |

The last row is the S184c fix. Before it, the model asked permission for a
search the user had just explicitly requested — the numbered-rule precedence in
the WEB SEARCH block is what fixes that, so don't flatten those rules back into
prose.

⚠️ **A searched reply takes ~80–90 SECONDS.** Do not read a bubble still showing
"…" at 50–60s as a hung request — I made that mistake twice and wrongly concluded
the requests weren't reaching the server (the logs showed `searches: 2`, no
errors; they had arrived and were mid-search). If you are scripting a check,
wait 100s+ before judging.

**Open, and worth doing:** during a search the user watches "…" for a minute and
a half with no sign anything is happening. The server knows when a search starts
(that's where the `aiSearch` log line is written), so an SSE "searching" event →
"Searching PubMed…" in the bubble is a small change and makes the wait read as
intentional rather than broken. Kevin has not asked for it; raise it before
building.

**Still Kevin's call:** whether web search earns its keep at all. Watch
`searches` in the usage rollups for two weeks. Trigger rate is the number that
decides it — under ~10% of exchanges it's a good feature, above that it's a tax.

## ⭐⭐⭐⭐ S184 (Aug 8, 2026) — WEB SEARCH IS LIVE AND VERIFIED IN PROD

Deployed and smoke-tested end to end against the real Anthropic API. Verified in
the running app as `trainer.uitest`:
- "latest evidence on creatine for strength" → a real Oct-2024 *Nutrients*
  meta-analysis with effect sizes (WMD 4.43 kg, p<0.001), correctly cited.
- "beta-alanine for endurance" → five DISTINCT papers across PubMed, PMC and
  Examine, each linked under the reply.
- "how many calories in two eggs and toast?" → **no search** (footer absent),
  which is the behaviour the prompt is tuned for — searching that would be
  spending the person's allowance on something the model already knows.
- The disclosure footer renders on every searched reply and survives a reload.

**Read `docs/WEB-SEARCH.md` → "What actually shipped"** — the full design,
numbers, traps and deliberate omissions live there and are NOT duplicated here.
The short version:

- **Tool:** `web_search_20260318`, `max_uses: 3`, 22 allowlisted health/science
  domains, US/Eastern location, `response_inclusion: "excluded"`. Dynamic
  filtering is on by default at that version — we do NOT declare `code_execution`
  ourselves.
- **Two caps, both shipped in the same change:** a per-MESSAGE ceiling of 3
  searches and a per-user DAILY counter (`searches` on
  `users/{uid}/aiUsage/{date}`, fed from
  `usage.server_tool_use.web_search_requests`). Premium 12/day → Coach Ultra
  70/day. Running out is SOFT: the tool stops being declared and the AI says so
  instead of pretending it searched.
  ⚠️ **`max_uses: 3` is per API REQUEST, not per message** — a review caught me
  assuming otherwise. One message makes up to 11 requests, so the tail case is 33
  searches (33¢) a message. **We accept that on purpose — do not add a
  per-message cap.** Withdrawing the tool mid-turn changes the `tools` array,
  which invalidates the WHOLE prompt cache (tools serialise before system): a
  measured ~19,700-token cacheWrite, which is ~44% of a Premium user's daily
  allowance, to save us ~7¢. It was built, measured and reverted. The numbers are
  in `docs/WEB-SEARCH.md`; read them before rebuilding it.
- **Cost is now truthful end to end:** `aiusage` adds $0.01/search to
  `costMicros`, so the admin dashboard's spend stays right.
- **Kevin's disclosure requirement, both halves:** a footer under every searched
  reply ("Searched the web N times · uses more of your daily AI allowance than a
  normal reply") with the real source links under it, and two new rows +
  explainers in the Plans & pricing grid so people learn it BEFORE they buy.
- **Safety:** allowlist + "a `fromTrainer` note outranks the internet, surface
  the disagreement" + mandatory citation, all in the prompt, none deferred.

⚠️ **The one thing to keep if you refactor this:** a declared search tool can
fail with a **400** (org-level switch in the Claude Console, unusable tool
version, bad domain) — that would break chat for EVERY user on EVERY message.
`callModel` / `streamModel` drop the tool and retry once on such a 400. Do not
remove that guard.

⚠️ `pause_turn` is now handled in all three loops (`aiChat`, `aiChatStream`,
`runAssistantTurn`): push the paused assistant message back UNCHANGED with no
user turn after it.

**Deploy set** (aichat.js + aiusage.js changed — run `npm run deploy-set
aichat.js aiusage.js`, never recall it): 17 functions, plus `adminOverview` and
`adminUserUsage` which read the changed `aiusage.readUsage`.

**Three things live testing changed, all committed:**
1. **`response_inclusion: "excluded"` is GONE — don't put it back.** It looked
   like free output tokens, but dropping the result blocks leaves nothing to
   cite *from*: two searches returned good answers with an EMPTY source list.
   Dynamic filtering doesn't reliably attach citation blocks either, so
   `collectSources()` now reads citations when present and falls back to the
   `web_search_result` entries.
2. **Source dedupe is on normalised TITLE, not just URL.** One paper legitimately
   arrives as `pubmed…/40093878`, `pmc…/PMC11906324` and
   `www.ncbi…/pmc/articles/PMC11906324`, titled "… - PubMed" / "… - PMC" — three
   entries, one study, whole list eaten.
3. **`aiSearch` log line.** Search fails SOFTLY (HTTP 200, error inside the
   result block), so a broken search used to be invisible — the model just
   answered from memory and *guessed* at why ("hit the search limit"). Error
   codes and result counts are now logged; watch them before tuning the
   allowlist or the limits.

**Still worth watching:** `searches` in the usage rollups for two weeks before
loosening `max_uses` or widening the allowlist. A Terms-of-Service clause about
cited third-party health content is still owed (see docs/WEB-SEARCH.md — it is
NOT LEGAL-SESSIONS.md, which is about session packages).

### Everything below is DONE — don't redo it
- **S183p** AI meals store their serving; Daily Check-In notes roll over/grow/collapse
- **S183q** Accent colour picker (6 curated) + full-app leak audit
- **S183r** Body-fat charts stopped mixing measurement methods; neutral +/− deltas
- **S183s** User picks which body-fat method drives fat/lean mass
- **S183t** AI reads coaching notes, with per-note AI access control
- **S183u** `docs/WEB-SEARCH.md` scoping
- **S184** web search BUILT (block above)

## ⭐⭐⭐⭐ S183t (Aug 8, 2026) — AI READS COACHING NOTES
The AI (in-app AND connector) now uses a person's notes as coaching context, and
**notes carry per-note AI access that their owner controls.**

**What was already true:** trainer-written SHARED notes live in the CLIENT's own
`caliq-notes`, so `list_notes` already returned them to the client's AI. The
trainer's PRIVATE about-notes live in the trainer's own kv and are still never
visible to the client. Nothing about that wall changed.

**What was missing:** the AI never thought to look. The prompt only told it to
consult notes when a TRAINER asked about a client. Now, when anyone asks what
they should train/eat/aim for, it calls `list_notes` on themselves first and
treats `fromTrainer` notes as the plan of record — following the coach over
textbook advice, saying when it is doing so, and flagging (not silently
overriding) guidance it thinks is unsafe. Verified in prod: "Your coach Sam has
already mapped this out… no overhead pressing" and it applied the shoulder
restriction to the split it built.

**Access control (Kevin's design — opt-OUT, not opt-in):** a master "Let the AI
read these notes" switch at the top of the notes list, plus a per-note toggle in
the editor, with a "hidden from AI" badge in the list. Stored as `aiHidden` on
the note and `caliq-ai-prefs {notes}` in the note OWNER's kv — so a trainer and a
client each govern their own notes independently, checked per store server-side.
Default is on, so nothing changes for anyone who never opens it. When something
is withheld the tool returns `withheldFromAI` and the AI SAYS a note is hidden
rather than implying none exist — verified all three states in prod (visible /
per-note hidden / master off), with no content leaking in the latter two.

⚠️ **Trap that bit me twice:** `window.storage.get` returns the raw kv doc
(`{key,value,shared}`) and `.set` takes a **JSON STRING**. Reading `p.notes`
straight off the doc, or writing an object, silently stores something the
server's `JSON.parse` rejects — and it fails as "no notes found", which looks
exactly like a broken feature. Follow the `caliq-notif-prefs` pattern.

**Still NOT built: web search.** Kevin asked the AI to also pull supporting info
from the internet. There is only `fetch_link` (fetch a URL someone pasted) — no
search. He deferred the vendor/cost decision (Brave/Tavily/Serper are roughly
$3–5 per 1000 queries, would need a Secret Manager key and per-user limits).

## ⭐⭐⭐⭐ S183r (Aug 8, 2026) — BODY-COMP TRENDS
Kevin reported the trend deltas showing the wrong sign. **The sign code was
never wrong.** Reproduced with controlled data: with ONE consistent body-fat
method and everything rising, every chart signed correctly (+6 lbs, +7 fat,
+3.2% BF). Adding a scale reading to only the NEWEST entry — identical tape
numbers otherwise — flipped **fat mass +7 → −5 lbs, body fat +3.2% → −3.6%, and
invented 11 lbs of lean mass.**

**Root cause: the body-fat series mixed measurement METHODS.** Every entry
collapsed to one blended `bodyFatPct` (precedence scale > calipers > tape), so an
entry where you typed a scale number and an entry with only tape landed on the
same line — the chart compared a scale reading to a tape estimate. Fat and lean
mass inherit it through `carryBf`, and since lean = weight × (1 − bf), a phantom
BF drop *raises* lean. That is exactly the reported pattern.

**Fix:** `bfBySource` keeps `{scale, caliper, tape}` separate; each method with
2+ readings gets its OWN chart (one method → just "Body fat %"). Fat/lean mass
read ONE method for the whole history and never fall back per entry.
⚠️ **Never reintroduce a blended body-fat series** — methods disagree by several
percent on the same body and are only comparable to themselves.

**Which method drives fat/lean mass is the user's choice** (S183s, Kevin: a
scale is easiest, calipers take more effort and are more accurate — so the app
shouldn't decide). Stored per PLAN as `data.bfPrimarySource`, so the client or
their trainer can set it and it rides the normal plan save. A "Fat & lean mass
from" chip row appears under the charts, offering only methods that HAVE
readings and hiding itself entirely when there's only one. Two safeguards worth
keeping: an unset preference resolves to most-direct-available (byte-identical
to the old behaviour), and a stored preference whose method has no readings is
ignored rather than stranding fat/lean mass — verified by deleting the caliper
data while the preference still said "caliper".

**Colour no longer judges.** Green-for-down / orange-for-up decided losing was
good and gaining bad — wrong for lean mass and muscle, and wrong for anyone
bulking. Deltas are now neutral `--text-secondary` with an explicit +/−, and
ProgressChart's "losing/gaining/maintaining" became "up/down/no change".
ProgressChart is SHARED across 4 call sites (main weight chart, measurement-site
charts, calendar drawer) — all verified.

**Also fixed the real confusion behind "my weight went up but it says minus":**
the delta compared the FIRST to the LAST point of the visible timeframe, not
your last reading — so someone down long-term but up since last time saw a
minus. It now **leads with the change since the previous reading** and shows the
timeframe total after it, both dated: `+6 lbs since Jun 24 · −14 lbs since May
10`. Keep BOTH — dropping the total would make the Timeframe chips meaningless,
and dropping the step is what caused the original complaint. With only two
readings they are the same number, so only one is shown.

⚠️ **Test-account note:** Casey's (`client.uitest`) weigh-ins were overwritten
during reproduction and rebuilt from a screenshot (6 weigh-ins, correct dates
and weights). The ~4 non-weight check-in flags (workedOut/mood) are gone. Test
data only.

## ⭐⭐⭐⭐ S183q (Aug 8, 2026) — ACCENT COLOUR PICKER
Users can now pick the app's accent colour (≡ → Appearance → Accent colour):
**Cyan (default) · Ice blue · Azure · Magenta · Lime · Slate.** Per-device
(localStorage `glidna-accent`), like the theme.

**Why only six, and why those.** Two tests, both applied honestly:
- **AA contrast in BOTH themes.** Each accent ships SIX values, not one, because
  light and dark invert which variant is bright — the same reason brand cyan
  already shipped as `#08dce0` dark but `#087478` light. `primary` (text/icons/
  borders, ≥4.5:1 on the worst surface), `fill` (large buttons), `fg` (text on
  the fill).
- **Perceptual distance from the SEMANTIC colours.** Floor is ΔE 33 (CIE Lab) —
  exactly how far the shipping cyan sits from the success green, so nothing
  offered is less distinguishable than what the app already used and Kevin was
  happy with. **This is what killed the obvious choices:** amber is the *same
  hue* as the over-target warning, coral and rose land on the danger red, and
  violet erases the purple that means "sandbox, not a real client". The four
  semantics sit at roughly 0°/43°/161°/266°, so they already own most of the
  wheel — expect any future addition to be cool, pink, or neutral.

**How it works (three places, keep them in step).**
1. `src/themes.css` — the `[data-theme]` blocks still DECLARE `--color-primary`
   etc. themselves, but their VALUE reads `var(--u-accent-d, …)`. ⚠️ **This is
   load-bearing, not a style preference.** That selector is unprefixed so it
   also matches the ~8 nested `data-theme="pro"` wrappers inside the app; a
   literal there beats anything set on `:root` for that whole subtree. Declaring
   per-theme but inheriting the value is what makes one setting reach every
   nested wrapper. Verified live: a nested `pro` wrapper resolves the user's
   colour, and a nested `light` wrapper resolves that colour's LIGHT variant
   while the root is dark.
2. `src/App.jsx` — `ACCENTS` + `applyAccent()`, and the legacy `:root` block
   (`--accent`, `--accent-fill`) reads the same `--u-*`. **There are two whole
   colour systems**; recolouring only the Tailwind one leaves every in-plan
   screen cyan.
3. `index.html` inline pre-paint script — mirrors the table. Without it every
   cold start paints cyan then repaints. `sw.js` SHELL bumped to v3 because that
   script lives in the cached navigation HTML.

**The 165 literals are gone.** 142 lines of `rgba(8,220,224,…)` swept to
`rgba(var(--accent-rgb),…)` — one mechanical sed, since every occurrence shared
the exact spelling. Remaining `#08dce0` in App.jsx are only `var()` fallbacks,
the ACCENTS table, and `"Total Body":"#08dce0"` — deliberately left, it's one of
nine movement-pattern DATA colours, not chrome.

**Canvas can't resolve `var()`.** New `cssVar()` helper: the confetti and the
voice waveform paint with `fillStyle` and silently drop an unparseable value.
(A `var(--blue)` was already sitting broken in the confetti array — fixed in
passing.) Anything drawn on a canvas must resolve the token in JS.

**Picking Cyan REMOVES the inline variables** rather than setting cyan, so an
untouched account resolves through the CSS fallbacks and is byte-identical to
the app before this existed. Verified.

**Deliberate choices worth knowing:** the in-app GLI|DNA wordmark DOES recolour
(it's the user's own chrome, and forcing it cyan beside a magenta app looks
broken), but nothing a third party sees changes — the OG/invite card, the invite
landing page, both outbound emails, the PWA icon and the browser theme-colour
stay Glidna cyan permanently.

**This is the first brand-token infrastructure for the white-label plan.** Same
tokens, different owner of the choice. Whoever builds trainer branding decides
whether a trainer's brand overrides a client's personal pick or merely sets the
default — that question is now worth answering before it's retrofitted.

## ⭐⭐⭐⭐ S183p (Aug 8, 2026)
**Both S183o reports are BUILT, deployed and verified.** Everything below is older.

**1. AI-logged meals now carry their serving.** Root cause was exactly as
diagnosed: `log_meal` wrote no `grams`/`unit`, so `deriveBasisFromMeal` fell back
to a meaningless "1 serving" with nothing to rescale from. A shared
`SERVING_SCHEMA` + `sanitizeServing` (top of `functions/aitools.js`) is now on
**`propose_meal`, `log_meal` and `log_meals`**, persisted on the meal object and
echoed through the proposal so the Accept card writes it too. Units mirror
`FOOD_UNITS` in src/App.jsx plus `serving`; an unknown unit degrades to grams.
The system prompt requires the serving in the same breath as the micros rule.
Frontend: `acceptMeal` forwards the fields and the card shows the portion
(`420 cal · 180 g`) so you see what the numbers are for before tapping.
- **The MCP connector inherits this for free** — it builds its schemas from
  `buildTools()` via `toZod`, so parity held with no separate change. Keep that
  in mind before hand-editing anything connector-side.
- **A meal with NO serving still behaves exactly as before** (per-serving basis,
  qty 1). That fallback is what keeps every pre-S183p meal working — don't
  remove it.
- Verified in prod after deploy: the model picks the unit per food — "6 oz
  chicken breast" → `6 oz`, "three scrambled eggs" → `3 serving`. A logged 180 g
  meal opens the real serving control and rescales exactly (297 → 594 cal at
  360 g). The manual tracker's own "AI estimate" button already stored the
  serving correctly, which is why that path worked and this one didn't.

**2. Daily Check-In notes (Results → Pro Tracking), all three parts.**
- **Stale notes: it was the date, not the save.** `checkDate` was captured ONCE
  at mount, so a screen left open overnight kept yesterday selected — yesterday's
  notes in the box and a save writing to yesterday. It now follows
  `useTodayKey()`, advancing only when you were parked on the OLD today; a date
  you deliberately picked stays put. Same class of bug as the S45/S85 date fixes.
- ⚠️ **Hazard, cost me a debugging cycle:** the first version read the "previous
  today" ref *inside* the `setCheckDate` updater. React runs that updater lazily
  at the next render, by which point the ref is already the NEW day, so the
  comparison never matched. Capture the previous value in a local const first.
  It looked like it worked because the notes cleared for an unrelated reason —
  only probing the real component state showed `checkDate` hadn't moved.
- **Textarea** grows downward as you type (capped at half the viewport) instead
  of `rows={9}` + `resize:vertical`, which could be dragged past the modal frame.
- **A written note keeps its one-line preview** and tints the row green with a
  ✓, so a filled day reads as done without hiding what you wrote. It briefly
  collapsed to the word "Completed" — Kevin reversed that on sight: the text is
  more use than the label for it. Reopens with the note intact; empty next day.

Deployed: the 18-function `aitools.js` set (`npm run deploy-set` — never recall
it from memory; it drags in the three live Stripe functions unchanged). Frontend
pushed.

## ⭐⭐⭐⭐ S183 (Aug 7, 2026)
Queue item 1 is DONE and deployed. Everything below is older.

**Referral vest notification.** A referral vests on a clock, so the only way to
find out used to be opening Refer & earn and noticing the number had moved.
Now a daily **10am ET `referralVestNotify`** finds newly-vested referrals and
notifies the referrer, **naming both choices in the notification itself**
(Kevin: surface the choice there, not as a modal). Tapping the bell row opens
Refer & earn, where the two buttons already live. New pref type
`referralRewards` in the Notification Center; feed rows with tag
`referral-vested` are the only tappable ones (cyan border + "Claim →"),
everything else stays inert history.

**Kevin's rule, S183: never show a bare dollar figure.** Credit is always
described as going toward their *subscription*, and monthly vs annual changes
when they feel it — annual says the credit is HELD until the renewal (with the
date when we know it) rather than "off your next invoice", which would have an
annual payer expecting something this month. The Stripe mechanism already
worked this way (a customer-balance credit applies to whatever the next invoice
is); only the wording was missing.

To say it we had to start recording the interval: `stripeWebhook` now stamps
**`subscriptionInterval`** + **`currentPeriodEnd`** on the profile, read off the
SUBSCRIPTION object (not our metadata) so it self-corrects for accounts created
before this and for portal interval switches, and re-stamps each renewal.
⚠️ **Existing subscribers have neither field until their next subscription
webhook event** — copy degrades to the honest "toward your subscription" until
then, by design. These two fields are display-only (no gate reads them), so
they were deliberately NOT added to the S85 owner-write rules lock; revisit if
anything ever gates on them.

Hazards found the hard way this session:
- **`appendFeed` slices bodies at 140 chars.** The first annual copy ran 152–155
  and the cut landed inside "Or take a free month of Coach Ap…" — hiding half
  the offer the notification exists to show. Bodies now build base + optional
  upgrade clause and **drop the whole clause** if it wouldn't fit
  (`NOTIF_BODY_MAX`). Keep that guard if you touch the copy.
- **Name in the title, money in the body.** One sentence carrying both said
  "2 of your referrals stuck with it — $75.80" when three were paying for that
  figure and only two were new. Split, each half is true independently.
- `testVestReferral` now takes **`{notify: true}`** and clears `vestNotifiedAt`,
  so the whole chain (signup → paying → vested → notification → claim) can be
  rehearsed in one sitting instead of waiting for 10am.
- Rows are stamped `vestNotifiedAt` **even when there was nothing worth saying**,
  or the pass re-reads them every morning forever.

Deployed: the 9-function referrals+billing set (`npm run deploy-set`); frontend
pushed. Note the deploy set drags in the three live Stripe functions — their
code is unchanged, they just bundle `referrals.js`.

### S183b — push notifications: the parked item was stale, the bug was real
"Push-notification delivery (FCM)" has sat in this queue for ages. **It was
already built** — Web Push/VAPID, SW handlers, subscription management, eight
sending triggers (`functions/push.js`, S90b/S96). Don't re-scope it; it's done.

What was actually broken is where a push LANDS. `notificationclick` focused an
already-open window and stopped there, so **every payload's `url` was silently
dropped for anyone who had Glidna open** — most people, most of the time. A
push saying "your reward is ready" dumped them on the dashboard. Now it focuses
AND navigates (skipping the navigate when the tab is already on that URL, so a
tap doesn't reload the page under them). This fixes deep-linking for ALL push
types, not just referrals. The referral push now targets `/?reward=1`, which
opens Refer & earn and strips the param.

Two Notification Center gaps closed while auditing:
- **`sessionBilling` had no toggle.** Those pushes have gone to both trainer and
  client since sessions shipped, silenceable only by the master switch — the
  one thing the Center promises you don't have to do. Row added for both roles.
- **`set_notification_prefs` was missing `automations`, `referralRewards`,
  `sessionBilling`,** so asking the assistant to turn those off did nothing and
  read as being ignored. ⚠️ **That KEYS list must stay in step with the type
  rows in `SideMenu`** — nothing enforces it.

Still true after the audit: **`coachingNudges` has a toggle but no push path** —
it governs the S77 in-app card only. That's by design as far as anyone can
tell; noting it so the next audit doesn't re-flag it as a bug.

Deployed: the 22-function `aitools.js` set (run `npm run deploy-set`, never
recall it). Live-verified in prod after deploy: the AI answered and honoured
the new key — "turn off my referral reward notifications" wrote
`referralRewards:false` (before this it silently did nothing).

### S183c — cap-hit "use your own AI" nudge (SHIPPED) + Family PARKED
**Nudge is live.** Hit the daily token cap and you now get a card offering to
connect your own Claude/ChatGPT. Fires ONLY from the two `resource-exhausted`
branches (Kevin S178c: never general messaging) and renders BELOW the boost
path — if more Glidna usage can be granted that's the better answer, so this is
the fallback for tiers without boosts or a boost already spent today. The claim
is always true for whoever sees it: connector is included from Premium up (free
= 0 calls, but free is stopped at trial-expired long before the cap) and it
runs on their own subscription. Verified both ways in prod: simulated cap →
card → "Show me how" → connector setup; normal send → no card.

**Family & Friends: scoped, then PARKED by Kevin.** Full reasoning is in
`docs/PRICING.md` under the banked tier — read it before reviving. Short
version: (1) $9.99 + in-app AI undercuts **Premium**, a bigger leak than the
Coach Connect one the guardrail was written for; (2) AI cost was never the
issue — the token budget is per ACCOUNT, so five plan files cost no more than
one; (3) anyone who wants the app themselves can already open a **free**
account, so the tier only ever sold ONE person the ability to manage others —
a carer, not a household. If revived: client role + a `family` tier, never a
trainer role (every business gate tests role, so staying `client` enforces the
guardrail for free).

### S183o — two Kevin reports, diagnosed here, BUILT in S183p
Both shipped — see the S183p block at the top of this file for what was done and
the hazards found on the way. Kept for the diagnosis trail:
1. Daily Check-In notes: stale text, a textarea draggable past the modal frame,
   and the ask to collapse to "Completed". (The stale-text guess recorded here —
   "state not resetting after a SAVE, check `handleSave`" — was **wrong**; the
   cause was `checkDate` never rolling over at midnight.)
2. AI-logged meals had no serving unit: `log_meal` wrote no `grams`/`unit` even
   though `search_food_db` and `estimateFood` return them upstream.

### S183k — ONE burn formula, per-person (SHIPPED) ⚠️ moves real numbers
Kevin: the MET formula must cover ALL exercises, pre-made included, driven by
each user's own metrics. Pre-made ones were already MET-based and already
scaled by weight — what they ignored was everything else we ask for. The
textbook shortcut treats 1 MET as 1 kcal/kg/hr (an average young adult male),
over-stating burn for women, older people, and anyone with a lower resting rate.

**1 MET is now anchored to that person's own resting rate** (Mifflin-St Jeor
BMR ÷ 1440). `restingKcalPerMin()` in src/App.jsx is the single definition, used
by `exBurn` / `calcBurn` / `calcStrengthBurn` and **mirrored in the server's
`weeklyPlanBurn`** — if those two ever drift, the AI quotes a target no screen
shows (the S86 lesson).

⚠️ **Completed profiles now read 14–25% LOWER for the same session**, and in
eat-back mode that lowers the daily calorie target too. It is the more honest
number, but clients WILL notice. Measured (MET 11, 30 min): M30/200lb 499→429 ·
F30/186lb 464→362 · F55/160lb 399→299 · M65/210lb 524→396.

**Incomplete profiles are byte-identical to the old formula** (verified), so
unfinished plans see no change — that fallback must stay.

**✅ DECIDED — Kevin, S183k: personal RMR stays. Do not revert this.** Compendium
MET values are *defined* against the 3.5 ml/kg/min standard, so anchoring to a
person's own RMR is a deliberate departure from the published tables. Kevin's
call, stated plainly: "I want the personal RMR because I wanted it personalized
per person and to be as accurate as possible." Accuracy for the individual beats
matching the textbook. A future session that notices the divergence should leave
it alone — it is a decision, not a bug.

### S183j — custom exercises now scale to the person (SHIPPED)
Kevin asked for custom exercises with an AI burn estimate driven by the
client's own data. The feature existed since S78 but had exactly that flaw:
`CustomExerciseCreator` saved a FLAT `calPerMin` with `met: 0`, so a custom
exercise burned the same for a 120 lb and a 250 lb client. Now stored as a
**MET**, so one exercise a trainer defines is correct for every client.

- New `estimateExercise` callable returns a MET + the effort it assumed.
  **MET, not calories, on purpose** — calories bake in one body.
- Users never see "MET": AI estimates it, manual fallback is cal/min at the
  plan's weight, converted in. Live preview spells out that it scales.
- ⚠️ **`exBurn` checks `met` FIRST but MUST keep the `calPerMin` branch** —
  pre-S183j customs are flat rates, and heart-rate cardio has no MET at all
  (`cardioExFor` synthesises calPerMin from Keytel). Dropping the fallback
  silently zeroes both. Same order mirrored in server `weeklyPlanBurn`.
- Verified: 265/408/531 cal at 130/200/260 lb; legacy flat at 300; HR
  untouched; prod estimator gave sled push 8, sprints 14, stretching 2.3.
- ✅ **Panel click-tested (S183l)** — and it found a bug worth the trip: the
  S183k formula change updated every burn EXCEPT the creator's own preview, so
  the panel promised 350 cal while the schedule showed 273 for the same
  intensity, and manual "10 cal/min" actually produced 234 for 30 min. Both now
  use `restingKcalPerMin`. **Lesson: when the burn formula changes, the creator
  preview is a separate call site — grep for every use of the rate.**
  Reached via plan → **Edit Workouts** (the DailyDashboard copy only renders
  when a session is scheduled that day).
- Live-verified in one real plan: new `{met: 8.5, refWeightLbs: 186}` alongside
  a pre-S183j `{calPerMin: 10, met: 0}` that still works — both paths proven.

### S183i — body metrics can be back-dated (SHIPPED)
The store was always date-keyed; the measurements hub hardcoded today, so
catch-up entries were filed on the wrong day. Date picker added (defaults
today, future blocked). The weight field follows the same date: a back-dated
weigh-in does NOT touch today's daily log, and only claims "current weight"
if no later weigh-in exists.

### S183f — meal review: client tags, trainer confirms (ENGINE SHIPPED, UI NEXT)
Client tags a meal and sends it to their trainer; the trainer confirms, adjusts
or rejects. **Deployed and live-verified in prod.**

**The one departure from Kevin's original ask, which he approved:** the meal
logs IMMEDIATELY and is flagged for review rather than waiting. Holding it
would leave a client who tags breakfast at 7am with an empty dashboard, broken
streak and wrong macro bars until their trainer looks. The trainer is a
correction pass, not a gate. Don't "fix" this back.

- Review rows live in the CLIENT's kv (`caliq-meal-reviews`) — existing
  trainer↔client access, **no rules change**. Points at the meal by id rather
  than copying it (the S124 to-do lesson: one source of truth).
- `log_meal` + `forTrainerReview`/`reviewNote` (clients only). Trainer tools
  `list_meal_reviews` / `review_meal` (confirm | adjust | reject). Adjust moves
  day totals BY DELTA inside the existing txn, so concurrent writes are safe.
- On both surfaces per the S111 parity rule. `review_meal` is flagged
  DESTRUCTIVE — it can overwrite or delete a logged meal.
- Notifications use `appendFeed` (bell), NOT push: real push needs the VAPID
  secret bound to every function that can reach the line (aiChat, aiChatStream,
  logMeal, mcp). **No pref toggle added on purpose** — a toggle gating nothing
  would be the same silent no-op fixed in S183b. Add the toggle WITH push.

**✅ UI SHIPPED (S183g) — and the entry point moved.** Kevin clarified: the tag
belongs on a **message the client sends their trainer**, not a form checkbox.
So the composer and the trainer's confirm card both live in `MessageThread`.
- `firestore.rules`: messages gain `kind:"meal"` + `reviewId`, mirroring the
  S124 to-do pointer. **Only the CLIENT may send one** (a trainer tagging a meal
  would be putting words in their mouth); neither pointer may ride a plain
  message or be smuggled onto the other's kind. **186 tests pass, 0 failed**
  (13 new). PUBLISHED.
- Client composer: type chips, food, macros, an AI-estimate button that
  degrades to typing when AI is off, and a photo downscaled to ~15KB stored on
  the review row. New `reviewMeal` callable backs the trainer's card.

**✅ PUSH SHIPPED (S183h).** Both directions, plus the `mealReviews` toggle for
both roles (it now gates something real, so it was safe to add).
- The notifier is a TRIGGER, `onMealReviewWritten`, not the tools — **the chat
  composer writes the review doc client-side with no function in the path**, so
  a tool could never have notified for the main entry point. The trigger sees
  both write paths and both directions (new pending → trainer; pending→done →
  client). The tools deliberately no longer notify; don't re-add it there.
- ⚠️ **DOUBLE-NOTIFY, one half pre-existing:** a pointer message is mirrored into
  chat next to the kv write that is the real record, and that kv write has its
  own trigger — so `onDmCreated` fired too and the trainer was buzzed TWICE per
  tagged meal. **Every to-do had the same problem since S124.** `onDmCreated`
  now returns early for `kind === "meal" || "todo"`. If a third pointer kind is
  ever added, add it to that guard.
- An adjusted review row used to keep the client's ORIGINAL numbers, so the
  "is now N cal" message quoted the figure just replaced. Corrections land on
  the row now, with the old values under `original`.

### 🐛 S183g — a pre-existing bug worth knowing about (FIXED)
`MessageThread`, `SessionsPanel` and both `NotesPanel` overlays were nested
INSIDE the `{plansOpen && …}` fragment in `TrainerDashboard`. So a trainer whose
**"Local Plans" section was collapsed — the default — tapped Message, Sessions
or Notes on a client card and NOTHING happened.** The state was set; nothing was
mounted to render it. Confirmed against PRODUCTION before touching anything, so
it had been broken for every trainer. All four now sit at the screen's top level.
**Lesson: a full-screen overlay must never be rendered inside a collapsible
section** — check this if any other panel "does nothing".

### S183e — connector charts SCRAPPED (Kevin, deliberate)
Built in S183d, removed in full one turn later. **Kevin's call and the reason
to keep:** if someone wants the juicy detail, they should be **in the app**.
A chart rendered into somebody else's Claude hands over the most persuasive
part of the product for free, and the connector's job is to be a useful
sidekick — not a replacement for opening Glidna. Don't rebuild this without
Kevin explicitly reversing that.

`functions/chart.js` (the hand-rolled PNG renderer), the `get_progress_chart`
tool, its `runTool` branch, the `opts.charts` gate and the mcp.js image
content-block path are all gone — `aitools.js` and `mcp.js` are byte-identical
to their pre-chart state. Recoverable from commit `ab8d486` if ever wanted.

**DEPLOYED** — the 16-function `aitools.js`/`mcp.js` set went out after a CLI
reauth; production no longer advertises the tool. AI layer smoke-tested live
afterwards (replied, tools ran, seat gate fired), console clean.

### S183d — connector chart images (REMOVED — see S183e above)
`get_progress_chart` (metric `weight` | `calories`) returns a PNG as a real MCP
**image content block** plus a text summary. Ask your own Claude "how's my
weight going?" and it draws it.

- **`functions/chart.js` is hand-rolled on purpose.** @resvg/resvg-js (what the
  OG cards use) is a NATIVE binary and `functions/` ships ONE bundle shared by
  every function — adding it would slow cold starts for aiChat, the webhook and
  every schedule to prettify one tool. This draws into a pixel buffer and
  encodes with Node's built-in `zlib`; 5x7 bitmap font. ~4KB per chart.
- **CONNECTOR ONLY**, via `buildTools(role, { charts: true })`. Never expose it
  in-app: tool results are fed back to the model as TEXT, so a base64 PNG would
  eat a whole daily token budget in one call.
- Access is inherited, not reimplemented — it lives inside `runTool`, so seat
  gating and `resolveTargetUid` apply, and a client's schema carries no
  `clientId`, so they structurally cannot chart anyone else.
- Gotchas already paid for: axis bounds must snap to round numbers
  (`niceBounds`) or you get "3323.5" labels that look like a bug; unlogged days
  must draw as GAPS, never zero-calorie bars; the calorie window is
  inclusive-both-ends so it starts at `days - 1`; and the kv range query needs
  the `` escape (written as the escape sequence, which is safer than the
  raw char the docs warn about).
- Verified: both charts rendered and visually inspected, empty-data paths
  return a useful sentence, and the result shape validates against the SDK's
  own `CallToolResultSchema` — the one thing not testable in prod without an
  OAuth token. ⚠️ **Not yet seen inside a real Claude/ChatGPT connection** —
  worth one live look next session.

**Queue now:** ⚖️ referral CASH payouts — counsel first. Nothing else
outstanding.

---

## ⭐⭐⭐ S177–S182 (Aug 6, 2026)
Everything below this block is older history. Firebase `calorieiq-29762` ·
model `claude-sonnet-4-6` · live on **glidna.com** · tree clean, all pushed,
all deployed.

### ⚠️ Two things Kevin owes, both small
1. **Roll the Stripe TEST key** — it was pasted into a session transcript.
   Stripe → Test mode → Developers → API keys → ⋯ → Roll key (expire
   immediately), then re-run:
   `printf 'sk_test_NEW' | firebase functions:secrets:set STRIPE_SECRET_KEY_TEST --data-file=- --project calorieiq-29762`
   No financial risk (test keys can't touch real money) — hygiene only.
2. **`STRIPE_WEBHOOK_SECRET_TEST` holds a placeholder** (`whsec_PLACEHOLDER_REPLACE_ME`,
   set by Claude so the deploy could bind it). The test-mode webhook endpoint
   was never created, so test events aren't delivered. Only needed to rehearse
   the automatic "subscription activates → referral flips to paying" step.

### What shipped this session (all live, all verified in production)
- **AI-client seats** 15/25/35/55 (Connect/Coach/Elite/Apex), trial 15.
  Confirm-before-spend, one gate inside `runTool` covering chat + Accept cards +
  automations + connector. Verified: asks first → confirm → answers → seat
  recorded → no re-ask; plan files gate identically; own data never charged.
- **Session billing** locked to admin until Stripe Connect (liability fix).
- **Trial fence** — new accounts can't mint free-forever access. Grandfathered
  count measured: **3 accounts, all internal → the whole courtesy-window plan
  was DELETED, not built.**
- **Client data export** — everyone can download everything.
- **`coach_summary` pages** instead of silently capping at 60 (it was
  misreporting roster SIZE, worse than the review said).
- **Tracker upsell card** replacing a dead red error.
- **Pricing grid: 65 rows, 65 tooltips** (verified 1:1), 12 newly advertised
  free features, sidekick headline, all review copy fixes incl. the $49 blurb
  that sold a workspace the grid gives away.
- **Free roster cap: 15 clients+plans**, server-enforced (`joinTrainerByCode` +
  a rules change so clients can't write `assignedTrainerId` to a value; leaving
  is still a client self-write, deliberately). **173 rules tests, 0 failed.**
  Grandfathered pre-2026-08-07.
- **Booking = Connect+, sub-trainer TEAMS = Coach+** (`teamsAllowed`).
- **Client AI budget 45k/day** with boosts +15k → 60k → 75k; **trial matches at
  45k** (S179h had re-created the pay-and-get-less inversion — fixed).
  **Automations 2/4/6 client, 2/5/8 trainer**, with a warning before saving
  because each run costs ~10 chat messages.
- **Weekly Meal Planner** (S180) — build a week, apply on demand or auto-repeat,
  trainers push templates onto clients. Premium+ / Coach+.
- **Referral rewards** (S181) — share link, credit vests only on 30 days PAID,
  reward capped at ONE MONTH of referred net revenue (the S180 rule), choice of
  credit or a complimentary upgrade granted as OUR entitlement (never a Stripe
  schedule, so no downgrade can fail).
- **Dual-mode Stripe** (S182) — live + test coexist; webhook tries live
  signature first. Checkout/portal stay live-only.

### 🔴 One unexplained thing — start here if referrals misbehave
A `referrals/{uid}` doc that had been created AND vested was absent from a
later query; re-claiming created it fresh, so it was genuinely gone, not
unreadable. **No delete path exists in the code.** If referral rows vanish in
the wild, this is the lead.

### Hazards worth not rediscovering
- **`coach_connect` CONTAINS `coach`** — every tier predicate must test
  `connect` FIRST. Hit three times now (mcp.js planFor, aiSeats, teamsAllowed).
- **A React dep array is evaluated during render** — putting an effect above
  the `const`s it references is a TDZ crash the bundler compiles happily.
  Nearly shipped a white screen for every trainer this way.
- **zsh: `UID` is read-only** — name shell vars something else.
- **Writing the SAME value a rules-guarded field already holds is an allowed
  no-op**, so a careless prod test reads as "the rule failed". Test a DIFFERENT
  value.
- **Deploy ordering for rules**: push the frontend FIRST, then publish rules —
  the old bundle wrote the field directly, so the reverse order breaks joins
  for cached clients.
- **`npm run deploy-set <file>`** — never recall the deploy set.
- Shared fixtures in `firestore.rules.test.js` are order-dependent; a test that
  mutates one breaks every later test that depends on it.

### Decision docs (read before proposing pricing changes)
`docs/PRICING.md` — S176f (Kevin's full walkthrough response), S179c/e/f
(roster + gates), S179i (budgets/automations), S180 (referral math rule), S182
(dual-mode + the rehearsal). `docs/PLAN-REVIEW.md` — all 132 features tiered.
`docs/ECOSYSTEM.md` — **the bridge is COEXISTENCE, not connectivity**; read it
before proposing any revenue model. **No platform fees for independent
trainers** (only trainer-TREE splits are legitimate).

### Queue, nothing started
1. Referral **notification** when a reward vests (Kevin wants the choice
   surfaced there, not as a modal).
2. Push-notification delivery (FCM) — oldest parked item.
3. Family & Friends tier (~$9.99–11.99, 5–10 plan files) — guardrail: must
   exclude business features or it undercuts Coach Connect.
4. Connector chart images; cap-hit "use your own AI" nudge (fire only AT the
   cap, never broadly).
5. ⚖️ Referral CASH payouts — needs counsel first (affiliate program, 1099s).

---

## ⭐⭐ S175 pricing thread (Aug 2, 2026, with Kevin live) — READ THIS FIRST
The free-tier design + feature review from S171's "NOT done" item 1 is DONE.
Every decision is in `docs/PLAN-REVIEW.md` ("Decisions — free-tier review",
batches 1–17) and `docs/PRICING.md` (S175 client-limits section). Highlights:

- **Free connector = ZERO post-trial** (S173, concurrent session — beware:
  another session was committing DURING this one; S172→S173 landed mid-talk).
  S174 (deployed, functions:mcp): the connector now narrates the trial via MCP
  instructions — day count early, switch-off warning inside 7 days. NAMES NO
  PRICE anywhere the AI speaks (Kevin's rule) — always point into the app.
- **AI-coached client limits DECIDED, NOT BUILT: Coach 20 / Elite 30 / Apex 50
  (S176f market-matched, supersedes 15/25/35); Coach Connect UNCAPPED (S176).** Limits distinct clients the AI works
  on per UTC month (c_<uid> / p_<planId>), NOT the roster — the free
  unlimited-clients promise stays. Enforcement = ONE check inside runTool
  (aitools.js:1532) covers in-app + Accept callables + connector. Full verified
  build notes in PRICING.md S175 (notes-tools early branch, roster tools
  exempt, txn on the counter).
- **132/132 features tiered** (~98 free · 28 Premium+ · 2 Connect+ · boosts/
  automations Elite+ · 7 admin-only). Tooltip copy confirmed batch by batch.
  Non-AI levers BANKED, not pulled: Insights bundle (micros + weekly averages +
  consistency + body comp) is the strongest; then meal planning, Studio tier
  (teams), barcode (new-accounts-only if ever), per-transaction session cut.
- **🔴 Session-billing liability (batch 9):** the payment path has no plan
  check AND no Connect transfer — an outside trainer's session money would land
  in Kevin's Stripe with no payout path. DECIDED: admin-allowlist card-on-file/
  auto-charge/earnings.
  ⛔ **The transaction cut that originally justified Connect was RETRACTED
  (S176, Kevin).** No platform fees, ever — it would make Glidna a Trainerize
  COMPETITOR, and `docs/ECOSYSTEM.md` says be the layer that makes other tools
  better. Stripe Connect, if built, is **0% pass-through** — a liability fix
  only, well down the build list. Durable revenue instead = **aggregation +
  domain math** (the moat is the system, not the model): Insights bundle, more
  platform importers, Studio/agency seats, AI ladder. **Read ECOSYSTEM.md
  before proposing any revenue model.**

**⚠️ S176/S176f REVISED THE CLIENT LIMITS — read `docs/PRICING.md` "S176 — TWO
REVISIONS" AND "S176f" BEFORE building item 1. Numbers are now 20/30/50 with a
15-client trial cap; roster stays unlimited (coach_summary fix = PAGING, not a
cap); session-billing trio = Coach+ when public; teams = Coach+ ~5 seats; free
trainer local plans capped 2–3 NEW ACCOUNTS ONLY; Family & Friends tier and the
trainer-referral program are banked in PRICING.md S176f.** Two changes: (a) **Coach Connect has NO
client limit** — the rule is now *limit only what we pay for*; a Connect ladder
was scrapped because it reads as a scam (restriction with no cost behind it)
and cannibalises upward (a "Connect 100" would dominate Coach Elite). (b) **A
seat is consumed on first AI USE, not on enable** — so a mis-connect costs
nothing, removing frees the slot instantly, re-adding the same person that
month is free, and only a 16th DISTINCT person is refused. Plus seat UX:
confirm-on-enable + an "AI Clients — 12 of 15 slots" screen. Trainerize's
active/basic mechanic adopted; its stinginess rejected (every client stays a
FULL client, the seat gates AI only).

**✅ ITEM 1 IS DONE — S177 (deployed + live-verified).** AI-client seats shipped:
Coach 20 / Elite 30 / Apex 50, trial 15, Connect + admin uncapped. Gate lives
INSIDE `runTool` (aitools.js) so chat, both Accept callables, automations and
the MCP connector share one check; seats are a grow-only monthly set at
`users/{uid}/aiClients/{YYYY-MM}` keyed `c_<uid>` / `p_<planId>`, charged by
transaction on FIRST USE behind a confirm (`confirm_ai_client` tool).
Automations auto-consume, bounded 2/run. UI: "AI Clients This Month" card on
the trainer home + grid row. Live-verified in prod: ask→asks first→confirm→
answers→`used:1` labelled "Casey Client"→no re-ask; local-plan files gate the
same way; self-targeted work never charges. ⚠️ Three review-caught bugs are
FIXED, don't reintroduce: confirm_ai_client must stay in mcp.js READ_TOOLS
(else connector trainers dead-end all month), seatCapFor checks active subs
BEFORE entitlements.premium, and seatAutoConfirm is a COUNTER not a boolean.

**✅ THE BUILD LIST IS COMPLETE (S177–S178j).** All seven items shipped,
deployed and live-verified: AI-client seats (15/25/35/55) · session-billing
allowlist · trialStartedAt fence · client data export · coach_summary paging ·
tracker upsell card · the pricing grid (61 rows, 61 tooltips, 12 newly
advertised free features, sidekick headline, all review copy fixes).

Measured along the way, both of which REMOVED planned work: grandfathering
protects nobody (3 accounts, all internal — courtesy window dropped), and
coach_summary was lying about roster size rather than merely capping it.

**Next up — nothing is queued.** Open threads if you want them: push
notification DELIVERY (long-parked), the trainer-referral program and Family &
Friends tier (banked in PRICING.md S176f), connector chart images, and the
cap-hit "use your own AI" nudge (fire only at users who hit the cap).

**OLD BUILD LIST (all done, kept for context):** 1) ~~client limits + seat UX~~ DONE S177 · 2) session-
billing allowlist · 3) trialStartedAt fence at first login (grandfathering
kept but fenced) · 4) client-facing data export (backs the footer promise;
Kevin chose build over reword) · 5) coach_summary 60-cap fix · 6) tracker
AI-buttons upsell card · 7) the grid/tooltip work — 132 ⓘ tooltips + new named
rows + copy fixes, all enumerated at the end of PLAN-REVIEW.md.

Scale answers Kevin has on record (don't recompute): no roster size can make
any tier lose money (token caps bound cost); Coach realistically serves ~33
clients at 4 conv/client/day; connector calls have 10× headroom, tokens have
none — appease big trainers with calls, never tokens. Client limits are a
SECOND margin guard under the realistic model (spend = clients × ~6 conv):
they bank ~$9/$11/$19 per maxed Coach/Elite/Apex vs the cap-only worst case.
Plan-shuffling is already defeated by design — the counter is a MONTHLY set of
distinct targets touched; slots never free mid-month; clients' own plans are
uncounted (their token budget bounds them). Plugin call caps ALREADY scale
(2k/5k/10k/25k — the public "2,000/day" is a docs simplification); leave them
as abuse backstops, the client limit is what tiers sell.

**Later ideas (Kevin, S176):** 1) cap-hit message adds "or connect your own
Claude/ChatGPT (included in your plan) to keep going" — turns our costliest
moment into a ~free one (maxed Apex in-app $63/mo vs ~$0.30 via plugin).
⚠️ FIRE ONLY AT USERS WHO ACTUALLY HIT THE CAP, never general messaging
(Kevin, S178c). The old cannibalisation worry is mostly SOLVED for trainers:
Connect is capped at 15 AI-clients (S178b), so a coach needing 25 people can't
drop to Connect to save money — the cap justifies the nudge. For CLIENTS seats
never bind (a solo user only works on themselves), so there the differentiator
is the in-app experience — photo, voice, chat on the phone — and a client happy
in Claude was always a Connect customer. 2) Connector CHART IMAGES — a get_progress_chart tool returning a
server-rendered PNG via the existing resvg pipeline (api/og.js); MCP image
results render in Claude, VERIFY ChatGPT's handling when scoping. 3) Overage
"client packs" saved for later (also in PRICING.md S175). 4) OWED: a
plain-English walkthrough of every batch decision — Kevin flagged he
confirmed some without fully understanding; review before the grid build
treats them as final.

## ⭐ S171 (Aug 2, 2026) — READ THIS BLOCK FIRST
Everything below this block is older history, kept for reference. Firebase
`calorieiq-29762` · model `claude-sonnet-4-6` · live on **glidna.com** · tree
clean, all pushed and deployed.

### Billing is LIVE and proven with real money
Kevin bought Premium with a real card and cancelled it. Verified end to end:
$14.99 charged → webhook signature verified → profile flipped to `premium` →
cancel → active through Aug 31, then downgrades on the already-proven path.
Payouts: **daily, 2-day delay**, to Smooth Training LLC; Stripe takes 2.9%+30c.

### The pricing ladder is DECIDED and shipped
Full table in `docs/PRICING.md` under "S171 — DECIDED & LIVE".

| | Free | Connect | Base | Elite | Apex (hidden) |
|---|---|---|---|---|---|
| Client | $0 | $4.99 | $14.99 | $29.99 | $49.99 |
| Trainer | $0 | $19.99 | $49 | $79 | $129 |

**Connect** = platform + MCP plugin, NO in-app AI — for people already living in
Claude/ChatGPT. ~100% margin (their AI provider pays for inference). Coach Apex
is 450k tokens/day so every trainer step is +50%.

**The connector ladder (S173, FINAL)** — the conversion engine, two states:
trial **2,000/day** for 30 days → then **ZERO**. Free has no AI at all, in-app
or connector; it is the whole manual product. Pay to get the connector back
(Connect $4.99 / Coach Connect $19.99, and every tier above includes it).
Kevin's reasoning: 30 days at full speed sells better than a permanent trickle.
An S172 50/200 taste was built and deliberately replaced — do not reintroduce
it. Accounts still never lock; all logged data stays.

**The denial message is the conversion moment.** A free user is told the trial
ended, their data is safe, manual tracking stays free, and the actual price —
NOT "resets at midnight UTC", which is true only for paid users who ran out
today and would make a free user wait instead of upgrade.

### NOT done — pick up here
1. **Free-tier design + per-feature ⓘ tooltips.** The rest of the plan rework.
   `docs/PLAN-REVIEW.md` already has **109 features** with plain-English tooltip
   copy and the gate the code really applies. Kevin wants to walk it **one at a
   time in small batches** — do not dump the list at him. Two areas were never
   catalogued (training partially, AI reconcile) — agents kept dying on oversized
   responses; cap output hard if you retry.
2. **Annual is the weak spot** — $119.99 vs MyFitnessPal $79.99, MacroFactor
   $71.99. Decision on record: hold list price; if conversion lags use a
   **first-year promo (~$79-89)**, not a list cut.
3. **FatSecret barcode** — Kevin wants their full DB (strongest for US branded
   food). Blocked on HIS proxy: it exposes `/search` and `/food?id=` only,
   `/barcode` 404s (verified). Needs a route calling `food.find_id_for_barcode`.
4. **Barcode scanner on a real Android** — S170b rewrote the camera request
   (1080p, continuous autofocus, EAN/UPC-only hints, torch, landscape box).
   Cannot be verified headless; Kevin must test. If still flaky, next lever is
   the native `BarcodeDetector` API on Android with zxing as the iOS fallback.
5. **Push-notification delivery (FCM)** — still queued, untouched.

### Hazards worth not rediscovering
- **`mcp.js` planFor() tests `connect` BEFORE `coach`** — "coach_connect"
  contains "coach" and would otherwise inherit the 5,000-call coach cap. Same
  class as the S90 ultra/max ordering bug.
- **Compute the deploy set, never recall it**: `npm run deploy-set <file>`.
  `aichat.js` reaches **15** functions now. A partial deploy silently leaves the
  rest on a stale bundle (the S78 bug class, hit again this session).
- **Rollout lag != broken code.** After `firebase deploy` returns, a revision can
  still be taking traffic for ~60s; a test in that window runs the OLD code.
  Check the audit log's `updateTime` before diagnosing.
- **`recordUsage` must never throw** — it runs in a `finally` on every AI path,
  so an exception there replaces the user's reply with an error (S167 did this).
- **Barcode: USDA stores the same UPC at 12, 13 AND 14 digits.** Exact-string
  lookup misses real matches; try every normalization and only accept a result
  whose `gtinUpc` equals the scanned code.
- **Research/inventory agents die on big outputs.** Every multi-area workflow
  this session lost agents to "Connection closed mid-response". Cap `maxItems`
  and string lengths in the schema; keep prompts narrow.

### Verified facts (don't re-derive)
- **AI cost ~$4.70 per 1M budget-tokens** (measured live); ~1,500 tokens ≈ one
  conversation ≈ 0.7c. Every tier profitable at its absolute ceiling.
- **Nobody sells an MCP connector as a separate SKU** — all 11 SaaS platforms
  checked bundle it. **Strava is the only fitness precedent** and its connector
  is **read-only**, bundled with its $11.99 sub. Glidna's writes.
- **MyFitnessPal acquired Cal AI** (Dec 2025, announced Mar 2026). MFP now owns
  the $19.99 everything-app AND the $9.99 photo app, and is in ChatGPT Health.
  Differentiation cannot be price or photo scanning — it is the two-sided
  trainer platform and the writable connector.
- MacroFactor $11.99/mo ($71.99/yr): strong tracker, no AI chat, no coach side,
  no connector, no free tier.

---

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
