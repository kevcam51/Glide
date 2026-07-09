# Glide — Next-Session Handoff (start here)

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
**QUEUED AFTER STRIPE (Kevin's yes, Jul 8): the notification-FEED bell.** A bell icon in the
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
