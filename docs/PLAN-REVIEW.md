# Plan & pricing review — working doc

Built S169 for the "Choose your plan" rework: a free tier, re-tiering, and a tooltip per
feature. Every feature below carries a one-sentence plain-English description written to
become that tooltip, plus the gate the CODE actually applies today.

**Read the reconciliation first.** The inventory is useful; the mismatches are urgent —
they are places the pricing page promises something the code does not keep, or the reverse.

Coverage: 109 features across ai, coaching, nutrition, platform. AI reconcile + the training area still outstanding.

---

## ⚠️ Decide before the first real charge

### 1. Paying for the base tier HALVES the AI allowance vs the free trial

Enforced today (`functions/aichat.js` BUDGETS), at the measured ~1.5k budget-tokens per exchange:

| Tier | Tokens/day | Real conversations/day | Page says |
|---|---:|---:|---:|
| Client · free trial | 50,000 | 33 | (not shown) |
| Client · Premium $14.99 (no trainer) | 25,000 | 16 | ~15 |
| Client · Premium $14.99 (has a trainer) | 40,000 | 26 | ~15 |
| Client · Elite $29.99 | 150,000 | 100 | ~100 |
| Trainer · free trial | 200,000 | 133 | (not shown) |
| Trainer · Coach $49 | 100,000 | 66 | ~40 |
| Trainer · Coach Elite $79 | 200,000 | 133 | ~100 |

A client on trial gets 33/day and drops to 16/day the moment they pay. A trainer on
trial gets 133/day and drops to 66/day. **In both cases paying buys you less than the
trial did**, and the page never discloses it. That is a refund-and-chargeback generator
independent of whether it is legally defensible.

It is also why the trial feels generous and the paid product feels worse — the exact
opposite of the intended conversion story.

Three ways out, all Kevin's call: raise the paid base allowances to at least the trial
level, lower the trial to the paid level, or keep both and say plainly on the page what
the trial includes and for how long.

### 2. One published number, two enforced allowances

Premium publishes "~15" but a client WITH a trainer actually gets 40k (~26). Same tier,
same price, different product depending on whether they are linked to a coach.

### 3. Coach is undersold, not oversold

The page claims Coach → Coach Elite is 2.5× (~40 → ~100); the code is exactly 2×
(100k → 200k). The real Coach allowance is ~66/day, not ~40. Under-promising is the safe
direction, but it makes the $49 tier look weaker than it is.

### 4. "Unlimited connected clients" vs a 60-client cap

The trainer grid sells unlimited clients, and there is genuinely no cap on the roster.
But the paid whole-roster AI check (`coach_summary`) stops at 60 clients. Nobody hits
that yet; it becomes a broken promise at scale.

### 5. A data promise with no mechanism

The matrix footer says "even if you cancel, you keep your account and every bit of your
data". There is no client-facing export anywhere in the code — export/import exists only
on the trainer side. Either build the client export or reword the promise; with the
attorney review still pending, this is the line most worth getting right.

### 6. Grandfathered accounts have the entire paid AI layer, free, permanently

Legacy accounts (no `trialStartedAt`) are treated as unlocked forever. Intentional at the
time; worth deciding whether it stays true once real money is involved.



---

## Reconciliation — page vs code

### nutrition (32 features)

**Mismatched — page and code disagree** (3)

- TRAINER ROW OVERSTATES THE PAYWALL — the matrix implies a restriction the code does not enforce. MATRIX: `["Log meals / weigh-ins / workouts FOR clients", false, true, true]` (src/App.jsx:16776), listed under section "AI assistant — everything in Free, plus:" with a dash in the Free column. CODE: logging for a client manually is completely free — `const logRead = async (key) => { if (activeRemoteUid) { const r = await getForUser(activeRemoteUid, key); ... } }` and the matching `logWrite` (src/App.jsx:24185-24191) route a trainer's edits into the CLIENT's account with no premium/trial check, the dashboard is mounted with `isRemote={!!activeRemoteUid}` (:25017), and `function MealLog({ meals, onAddMeal, ... })` (:8496) takes no `premium` prop at all. Its sibling rows say "by chat" ("Build client programs by chat" :16775, "Set targets & manage client plans by chat" :16777); this one does not, so it reads as a capability gate on behalf-logging that no code enforces. Fix the label ("…FOR clients by chat") or it invites a refund argument.

- GRANDFATHERED ACCOUNTS GET EVERY PAID NUTRITION AI FEATURE FOREVER. MATRIX: `["AI food estimates in the tracker", false, true, true]` and `["Photo meal logging — snap your plate", false, true, true]` (src/App.jsx:16748, :16746) — dash in Free. CODE: the only gate is `if (trialExpiredFor(profile)) { throw new HttpsError("permission-denied", TRIAL_EXPIRED_MSG, { reason: "trial-expired" }); }` (functions/aichat.js:700), and `trialExpiredFor` ends with `const t = profile.trialStartedAt; ... if (!startMs) return false; // pre-trial account — grandfathered` (functions/aichat.js:278-287, mirrored in src/profile.js isPremium and functions/transcribe.js:25). Any profile without `trialStartedAt` is permanently treated as paid — free tracker AI estimates, free photo estimates, free voice, free chat logging. Deliberate for legacy/test accounts, but it is an unbounded, self-perpetuating free tier the pricing page says does not exist; any future account-creation path that forgets to stamp `trialStartedAt` silently mints a free-forever Premium user.

- PAID TRACKER FEATURES ARE PRESENTED AS FREE IN-PRODUCT (enforcement is right, the UI is not). MATRIX: AI estimates and photo logging are dashed out of Free (:16746, :16748). CODE: inside the meal tracker both buttons render unconditionally — `<button onClick={() => runAiEstimate()} disabled={aiBusy}>` … `AI estimate` (src/App.jsx:9086-9090) and `<button onClick={() => photoInputRef.current && photoInputRef.current.click()}` … `Add a photo` (:9095-9101) — because MealLog never receives the `premium` flag (:8496). A free user taps, waits, and gets a red error string: `if (code.includes("permission-denied")) setAiErr("Your free trial has ended — upgrade to keep AI estimates.");` (:8650) with no upgrade button. Contrast AIChatPanel, which does it properly: `function AIChatPanel({ role, onDataChanged, premium = true, ... })` (:17227) → `{!premium ? (` renders the lock card with a Checkout CTA (:18458). Same paywall, two very different conversion outcomes; the tracker path burns the moment of intent. Related copy risk: "Photo meal logging — snap your plate" sits inside the "AI coach" section, so buyers may not realise it also lives in the manual tracker.


**Missing — shipped but never advertised** (9)

- MICRONUTRIENT TRACKING (~30 nutrients w/ progress bars) — src/App.jsx:11997 (Macros & Micros panel) + :7061 (bars). The matrix's closest row is `["Food, calorie & macro tracking", true, true, true]` (src/App.jsx:16736), which stops at MACROS. Nowhere in PLAN_FEATURES does the string "micro", "fibre/fiber", "sodium", or "vitamin" appear. Micros come free from the food DB/barcode path (foodsearch micros + _offMicros at src/App.jsx:~8820) with no gate — MyFitnessPal charges for this. Biggest unadvertised giveaway in the area.

- MEAL PLANNING AHEAD (future days + repeat every Mon/Wed/Fri for weeks, then tick off as eaten) — src/App.jsx:9309 (plan-ahead mode), :9554 (today's planned list), :24501 (`onPlanDays` multi-day writer, ungated). No row in either the client or trainer matrix mentions planning, prepping, or future days. `["Calendar, streaks, check-ins & water", true, true, true]` (:16740) reads as retrospective logging only.

- FOOD & MEAL REUSE SUITE — all free, none named: saved/starred foods library (src/App.jsx:8092), previously-logged foods per meal (:8092 + opened at :9062), saved & previous WHOLE meals (:8202, :8394), copy a meal from another day (CopyMealModal :7952, button :9394), move a logged food between meals (:9016). The only adjacent row is `["Food database search + barcode scanner", true, true, true]` (:16737) — search is not the same as a personal library, saved meals, or copy-from-another-day (a paid feature at MFP).

- THE CALORIE-TARGET ENGINE — pace picker with a safe-floor warning (src/App.jsx:11646), "Set your own target" override (:11700), eat-back vs accelerate chooser (:11344 and Full Plan → Summary :4778), daily goal direction deficit/maintain/surplus (:11213). All ungated, none named. `["Food, calorie & macro tracking", ...]` (:16736) advertises TRACKING; nothing advertises that Glidna computes, explains, and lets you override the target — and eat-back vs accelerate has no competitor equivalent.

- CUSTOM MACRO TARGETS + PROTEIN BASIS — set your own P/C/F in grams or % of calories with recommended splits (src/App.jsx:11930), and choose 1 g vs 0.7 g protein per lb (:11912). Free. The matrix never distinguishes custom targets from automatic ones; "macro tracking" (:16736) implies neither.

- NUTRITION INSIGHT / ADHERENCE SURFACES — "This Week" 7-day averages vs target (src/App.jsx:12602), on-track consistency % feeding a realistic goal date (ComplianceTracker :22443), calendar green/amber adherence tinting + weekly calorie & protein roll-ups (:9938-9960). Free. The matrix only offers `["Calendar, streaks, check-ins & water", true, true, true]` (:16740) and `["Weight, progress charts & goal timeline", true, true, true]` (:16738) — "streaks" is checked (StreakBadges :13043 is genuinely covered) but nutrition reporting/adherence analytics are not.

- NUTRIENTS GUIDE IN THE FULL PLAN (macro targets at several deficit levels, bodyweight-based water target, micronutrient reference with food sources, food picks to hit macros) — src/App.jsx:5882 (NutrientsTab, no `premium` prop). And the PLAIN-ENGLISH DAILY CHECKLIST / Simple view (protein in palm-sized portions, cups of water, the one number that matters) — src/App.jsx:3534 (SimplePlanView). Neither is mentioned; both are exactly the "is this app for beginners?" objection-handlers a pricing page should sell.

- SERVING SIZE & UNIT PICKER (g / oz / cups / ml / "1 serving", live rescale of calories + macros + micros) — src/App.jsx:7659 (FoodServingModal). Free, and the practical reason the free food search is actually usable. Folded silently into `["Food database search + barcode scanner", ...]` (:16737).

- TRAINER SIDE: the entire trainer free section (src/App.jsx:16765-16771) never mentions food or nutrition at all — its five rows are clients, analytics, to-dos, Invite Hub, local plans. A coach on Free gets the complete tracker for their own plan AND for every connected client (remote-aware log I/O at src/App.jsx:24185; DailyDashboard mounted with `isRemote` at :25017; MealLog takes no `premium` prop, :8496). Nothing tells a prospective coach the nutrition tooling is included.


**Phantom — advertised but not real** (1)

- CLEAN — no phantom nutrition rows. Every nutrition-related row in PLAN_FEATURES resolves to shipped code: `["Food database search + barcode scanner", ...]` (:16737) → functions/foodsearch.js `exports.foodSearch` + src/App.jsx:8807 Open Food Facts barcode lookup; `["Log meals by chat — just describe them", ...]` (:16745) → functions/aitools.js log_meal/propose_meal/log_meals; `["Photo meal logging — snap your plate", ...]` (:16746) → src/App.jsx:8663/9095 tracker photos + chat vision; `["Voice logging — speak instead of type", ...]` (:16747) → functions/transcribe.js (trial gate at :95); `["AI food estimates in the tracker", ...]` (:16748) → functions/aichat.js `exports.estimateFood` (:678); `["Turn TikTok / IG / YouTube links into workouts & meals", ...]` (:16750) → functions/aitools.js fetch_link (tool def :1393, handler :1573); `["Import from ChatGPT / Claude", ...]` (:16751) → src/App.jsx:18086/18497 paste-from-AI. Trainer equivalents (:16776, :16778, :16779) hit the same code.



### coaching (20 features)

**Mismatched — page and code disagree** (6)

- THE MONEY ONE — the $49 card contradicts the grid directly beneath it, and the code sides with the grid. Pricing card: `{ tier: "base", name: "Glidna Coach", month: "$49", ... blurb: "The full coaching workspace + AI assistant. Unlimited clients, flat price." }` (App.jsx:16717-16718). Grid, same modal, scrolled slightly down: section "The basics — free forever" with `["Unlimited connected clients + live dashboards", true, true, true]`, `["Coaching analytics — who needs attention", true, true, true]`, `["To-dos, nudges & shared plan editing", true, true, true]`, `["Invite Hub — link, QR, email invites, referrals", true, true, true]`, `["Local plans, templates & sales simulations", true, true, true]` (App.jsx:16766-16770). Code: the ONLY subscription gate in the entire product is the AI layer — functions/aichat.js:700 `if (trialExpiredFor(profile)) {` and the mirrored copy in functions/transcribe.js:95. No coaching screen, callable, or rule consults a plan. So $49 buys the AI assistant and nothing else; the blurb sells a workspace that the grid gives away and the code never withholds.

- "Log meals / weigh-ins / workouts FOR clients", false, true, true (App.jsx:16776) implies a paid-only capability, but the code does not restrict it. Every neighbouring row in that section is explicitly scoped to the AI — "Build client programs by chat" (16775), "Set targets & manage client plans by chat" (16777), "Send client to-dos straight from chat" (16781) — while this row omits the qualifier. A free trainer opens the client's plan (App.jsx:15749) and logs meals, weigh-ins and workouts by hand; the only check is firestore.rules:123 `allow read, write: if canAccessUserData(uid);` via `isDirectTrainer(ownerUid) || isHeadOfTrainer(ownerUid)` (firestore.rules:47-55). Add "by chat" or the row is a restriction that does not exist.

- One published Premium number, two enforced budgets. Matrix: `["AI conversations per day", "—", "~15", "~100"]` (App.jsx:16755). Code: `const BUDGETS = { trial: 50000, client: 25000, assisted: 40000, ... clientMax: 150000 ...}` (functions/aichat.js:51-53) with `if (profile && profile.assignedTrainerId) return "assisted";` (functions/aichat.js:85). Two clients paying the identical $14.99 get 25,000 vs 40,000 tokens/day depending purely on whether they happen to be linked to a trainer — a silent ~60% difference behind a single advertised "~15". The adjacent Elite claim `["6× bigger daily AI allowance", false, false, true]` (16758) is arithmetically true only against the unlinked 25k base (150000/25000 = 6); against the assisted 40k it is 3.75×.

- The trainer ladder publishes 2.5× and enforces 2×. Matrix: `["AI conversations per day", "—", "~40", "~100"]` (App.jsx:16783). Code: `trainer: 100000, ... trainerMax: 200000` (functions/aichat.js:51-53). 100k→200k is exactly double, sold as 40→100. Compounding it, the same "~100" figure is published for clientMax (150,000) and trainerMax (200,000) — one budget, two budgets, one number; at most one of the two can be accurate. Given the deliberate liability-hygiene posture in the comment at App.jsx:16726-16728 ("the AI daily allowance is published right in the grid... disclosed, never 'unlimited'"), these should be re-derived from BUDGETS rather than left as round marketing numbers.

- Minor, but it is an overclaim of exactly the kind the file says it avoids: "Our biggest AI allowance — built for all-day use" (App.jsx:16786) and "Our biggest allowance — around 100 AI conversations a day" (App.jsx:16714) are not true of the code — `clientUltra: 250000, trainerUltra: 400000` (functions/aichat.js:58) are strictly larger and are live tiers, honoured by `tierFor` (functions/aichat.js:67-80) and by `BOOSTS_PER_DAY = { trainerMax: 2, clientMax: 1, trainerUltra: 2, clientUltra: 1 }` (functions/aichat.js:793). Ultra is not purchasable (absent from PLAN_MENU, App.jsx:16709-16721), so the claim holds for anyone shopping — it breaks only for a granted Ultra user. "Our biggest purchasable allowance" would be exact.

- CLEAN, verified rather than assumed: the Elite-only rows `["Hit the ceiling? Tell us — we raise it", false, false, true]` (App.jsx:16761, 16789) are correctly enforced — functions/aichat.js:800-802 `const isBoostable = tier === "clientMax" || tier === "trainerMax" || tier === "clientUltra" || tier === "trainerUltra";`. And "Unlimited connected clients" is genuinely unlimited. Those rows need no change.


**Missing — shipped but never advertised** (12)

- Direct messages with clients — the single biggest omission. Neither ladder has a messaging row; the closest client-side row is ["Trainer connection, app install & Face ID", true, true, true] (App.jsx:16741) and the closest trainer row is ["To-dos, nudges & shared plan editing", true, true, true] (App.jsx:16768). Code gates DMs on a real trainer link, never a plan: firestore.rules:165 `&& isTrainerOf(request.resource.data.trainerUid, request.resource.data.clientUid)`. A full two-way DM system with unread badges (App.jsx:15743, 19562, 21088) is shipped and unadvertised.

- Requests from clients (the trainer inbox) — the matrix only advertises the trainer→client direction ("To-dos, nudges & shared plan editing", App.jsx:16768). The reverse — a client sending an ask that lands in "Asks From Clients" (App.jsx:15598) — appears on neither ladder. Backend check is link-only: functions/requests.js:30 `if (!trainerUid) throw new HttpsError("failed-precondition", "You're not linked to a trainer yet.")`.

- Session booking — no row on either ladder. Trainer creates bookings (App.jsx:15765), client sees them live (App.jsx:19577), panel at App.jsx:21260. Rules restrict creation to the linked trainer (firestore.rules:265-266), never to a tier.

- Cancellation policy — no row. Trainer sets notice period + late fee once (App.jsx:21347 savePolicy) and every client sees the exact terms plus a fee warning before confirming (App.jsx:21498). Editing gated only by `{isTrainer && (` (App.jsx:21507).

- Card on file for sessions — no row. Clients save a card and consent to the policy (App.jsx:21322 startCardSave; functions/sessionBilling.js:105). Gate is link-only: functions/sessionBilling.js:115-117 `if (!(await isTrainerOfClient(db, trainerUid, profile))) { throw new HttpsError("permission-denied", "You're not linked to that trainer.") }`.

- Automatic session charging — no row, and this is the most valuable unadvertised thing in the app. Finished sessions are swept every 15 min (functions/sessions.js:62) and charged hourly (functions/sessionSettle.js:294). `grep -n "premium|subscriptionStatus|entitlement|trialExpired|tier" functions/sessions.js functions/sessionBilling.js functions/sessionSettle.js` returns ZERO hits — no plan check exists anywhere in the payment path. Note also that `stripe.paymentIntents.create` (sessionSettle.js:249, :365) carries no `transfer_data` or `application_fee_amount`, so funds settle into the platform account: Kevin is running payment collection, Stripe fees and the payout obligation for trainers who pay him nothing.

- Earnings — no row. Month-to-date and lifetime session revenue with a per-charge ledger (App.jsx:16540 TrainerEarnings), reachable from the menu with only `{isTrainer && onEarnings && ...}` (App.jsx:23096).

- Team of sub-trainers — no row. A head trainer recruits sub-trainers by code and manages their rosters (App.jsx:22657; functions/team.js). Gate is role-only: functions/team.js:39-41 `if (!TRAINER_ROLES.has(role)) { throw new HttpsError("permission-denied", "Only trainer accounts can use team features.") }`. This is the multi-seat/agency capability, given away with no mention.

- Client notes with private/shared visibility — no row. App.jsx:15762 (entry) and App.jsx:21788 (panel).

- Personal notebook — no row on either ladder, and it is available to both audiences (trainer: App.jsx:23214; client: App.jsx:19557, unconditional).

- Folders for organising clients — only partially implied. The nearest row is ["Local plans, templates & sales simulations", true, true, true] (App.jsx:16770), which covers local plan files but not the drag-and-drop folder organisation of CONNECTED clients (App.jsx:20035, 20197). Minor compared with the others.

- NOT missing, deliberately: Trainerize import and background sync is absent from the matrix and should stay absent — it is admin-only in both layers (App.jsx:14941 `const tzIsOwner = meUid === OWNER_UID;` gating App.jsx:15918, and functions/trainerize.js:67-69 `if (!ADMIN_UIDS.includes(uid))`). Do not 'fix' this one.


**Phantom — advertised but not real** (3)

- None. Every coaching-area row in PLAN_FEATURES maps to shipped, working code. Checked one by one: "Unlimited connected clients + live dashboards" (App.jsx:16766) — roster at App.jsx:15626, and no cap exists anywhere (no MAX_CLIENTS / client-limit constant in src or functions; the only `clients.length >=` guards are the AI roster read caps at functions/aitools.js:1883,1909, which are tool-output truncation, not a product limit); "Coaching analytics — who needs attention" (16767) — TrainerAnalytics at App.jsx:16233; "To-dos, nudges & shared plan editing" (16768) — App.jsx:15740, 16253/16436, 15771-15781; "Invite Hub — link, QR, email invites, referrals" (16769) — App.jsx:20527, 20591, 20570-20573; "Local plans, templates & sales simulations" (16770) — App.jsx:15516-15524, 16006.

- One wording caveat that is NOT a phantom but is loose: "templates" in "Local plans, templates & sales simulations" (App.jsx:16770) has no distinct feature behind it — the reality is local plan files plus "Save a copy to my files" (App.jsx:15778). It is reusable-in-practice, so the claim is defensible, but there is no template object in the code if anyone ever asks.

- Unrelated dead code worth a footnote, not a matrix row: `isProUser` / `entitlements.foodAccuracy` (src/profile.js:103-106) is exported and referenced by nothing outside its own comment — the food-DB gate it describes was retired (functions/aichat.js:320-324).



### platform (22 features)

**Mismatched — page and code disagree** (6)

- FREE = "—" FOR AI IS NOT WHAT THE CODE ENFORCES (grandfathering). Matrix: `["24/7 AI coach chat (knows YOUR data)", false, true, true]` (App.jsx:16744) and `["AI conversations per day", "—", "~15", "~100"]` (App.jsx:16755). Code: functions/aichat.js:278 `function trialExpiredFor(profile)` ends with `if (!startMs) return false; // pre-trial account — grandfathered` — any profile lacking `trialStartedAt` is permanently premium at $0, forever. src/profile.js:115 `isPremium()` mirrors it (`const t = trialInfo(profile); return !t || !t.expired;`). Deliberate (S89b legacy grandfathering) and limited to pre-trial accounts, but the published grid says Free gets zero AI while a whole account class gets all of it free.

- PAYING FOR THE BASE TIER HALVES THE AI ALLOWANCE vs THE FREE TRIAL — never disclosed on the page. Matrix publishes only `Free "—" | Premium "~15" | Elite "~100"` (App.jsx:16755) and `Free "—" | Coach "~40" | Coach Elite "~100"` (App.jsx:16783), with no trial column. Code: functions/aichat.js:51-59 `const BUDGETS = { trial: 50000, client: 25000, assisted: 40000, trainer: 100000, trainerTrial: 200000, clientMax: 150000, trainerMax: 200000, ... }` plus tierFor() App.jsx-side equivalents functions/aichat.js:75 `if (profile && profile.subscriptionStatus === "trial") return "trainerTrial";` and :84 `if (profile && profile.subscriptionStatus === "trial") return "trial";`. So: client trial 50k → paid Premium 25k (HALVED on purchase). Trainer trial 200k → paid Coach 100k (HALVED), and the trial budget is IDENTICAL to Coach Elite's 200k — a trainer's free trial is Elite-grade and paying $49 cuts it in half. docs/PRICING.md:113-117 documents exactly this. The ladder on the page reads Free < Premium < Elite; the lived sequence is Trial > Premium. This is the highest-risk money-facing row: the most likely churn/complaint trigger is the first day after checkout.

- "6× BIGGER DAILY AI ALLOWANCE" IS ONLY TRUE FOR CLIENTS WITH NO TRAINER. Matrix: `["6× bigger daily AI allowance", false, false, true]` (App.jsx:16758). Code: `client: 25000` → `clientMax: 150000` = 6× ✓, BUT functions/aichat.js:85 `if (profile && profile.assignedTrainerId) return "assisted";` with `assisted: 40000` (aichat.js:51). For a trainer-linked client — the platform's core audience — the real jump is 40k → 150k = **3.75×**, not 6×. docs/PRICING.md:113 lists "Assisted (linked client) | 40k" so it is known internally and simply not reflected in the claim. A quantified multiplier on a paid upgrade row is the kind of statement that should match the constant.

- "WHOLE-ROSTER CHECK" IS CAPPED AT 60 CLIENTS WHILE THE PAGE SELLS UNLIMITED CLIENTS. Matrix: `["Unlimited connected clients + live dashboards", true, true, true]` (App.jsx:16766) and the paid row `["Whole-roster check: \"who's stalled this week?\"", false, true, true]` (App.jsx:16774). Code: functions/aitools.js:1826 `const MAX = 60;` inside coach_summary (with `let truncated = false;` on the next line), and functions/aitools.js:1636 `const MAX_LIST = 60; // same roster cap as coach_summary`. Connected clients really are unlimited; the paid AI's view of them is not. Partially mitigated — the tool returns a truncation flag so the assistant can say so — but the grid row promises whole-roster coverage without qualification.

- PAGE PROMISE WITH NO CLIENT-FACING MECHANISM: the matrix footer tooltip states "even if you cancel, you keep your account and every bit of your data" (App.jsx:16838). There is no client export path anywhere in the code — export/import/clipboard live exclusively on the ProfileSelector screen (App.jsx:20319, 20386 "Export All Clients", 24021 `exportAllData`), which clients never reach: App.jsx:24886 `if (role === ROLES.CLIENT) {` returns ClientHome instead. Clients keep their data in the sense that it is not deleted, but they cannot take it anywhere. If that sentence is meant as portability, the code does not back it for the audience it is shown to.

- DIRECTION CHECK — MATRIX RESTRICTS BUT CODE DOES NOT: none in this area. There is no platform row showing a dash for Free that the code actually lets Free users through on. Every mismatch here runs the other way (unlisted-and-free, or paid-claim-overstated). Separately, the admin-only items in the inventory (Trainerize import App.jsx:16016 / functions/trainerize.js:684 `await requireAdmin(uid);`, auto-sync functions/trainerize.js:736 `const uid = ADMIN_UIDS[0];`, sync-now, My watch data, Admin dashboard functions/index.js:212, App requests functions/index.js:180) are correctly absent from the matrix — they are gated to OWNER_UID, so nothing is being given away. One adjacency worth Kevin's attention: PLAN_MENU's Coach blurb reads "The full coaching workspace + AI assistant" (App.jsx:16716) while a paying $49 Coach cannot use the Trainerize importer at all. That is a blurb, not a matrix row, so it is advisory rather than a broken grid promise.


**Missing — shipped but never advertised** (5)

- WEARABLE / TRACKER — the entire capability is unadvertised. PLAN_FEATURES (src/App.jsx:16733-16792) contains no row mentioning a watch, tracker, wearable, Garmin, or measured burn. The only occurrence of the word is `["AI food estimates in the tracker", false, true, true]` (App.jsx:16748), where "tracker" means the manual food tracker. Free and ungated in code: (a) tracker readings on the dashboard + calendar Day view (App.jsx:11481, 10405 — `const todayW = hasWearable(dailyLog.wearable) ? dailyLog.wearable : null;` App.jsx:11489, no tier check); (b) manual entry of the watch's number (App.jsx:12152, panel rendered unconditionally inside the burn sheet); (c) `"Use my tracker's real burn"` (App.jsx:4803) — verified the toggle is always rendered, the only condition is the plan's own field: `const wearOn = !!data.wearableAdjust;`. A calorie target derived from measured burn instead of an estimate is a headline differentiator and appears nowhere on the pricing page.

- NOTIFICATIONS — six shipped, free, ungated capabilities, zero matrix rows. `grep -inE "notif|push|remind" ` over PLAN_FEATURES returns only the trainer row `["To-dos, nudges & shared plan editing", true, true, true]` (App.jsx:16768), which describes a trainer SENDING a to-do — not delivery. The client ladder never mentions notifications at all. Unadvertised: Notification Center (App.jsx:23133), push-to-phone (App.jsx:23163 + functions/push.js — `grep -nE "premium|trialExpired|subscriptionStatus|entitlement|Tier" functions/push.js` returns NOTHING; the only check is `if (!uid) throw new HttpsError("unauthenticated", ...)` functions/push.js:33), the notification bell + feed (App.jsx:24840, 22010 — rendered in shared chrome for every role), automatic 3pm food + Monday weigh-in reminders (functions/push.js:233, 256), message & to-do push alerts (functions/push.js:116, 138), and home-screen nudge cards (App.jsx:19788). Competitors charge for push; Glidna ships it silently.

- ACCOUNT / DEVICE / PRIVACY — four free capabilities, no rows: auto sign-out when idle (App.jsx:23257 toggle, 23627 `if (!idleSignOut) return; // toggled off — no timer armed`), Light/Dark/Auto appearance (App.jsx:23224), customise dashboard tiles (App.jsx:11456 `{onSetHiddenTiles && (`), and — most conspicuous — the AI data consent switch (App.jsx:23278). The page devotes two whole sections to selling AI but never says the user can switch it off, even though the code enforces the refusal server-side (functions/aitools.js:1503 `if (ctx.aiOptOut) return { error: AI_OPTED_OUT_SELF };`). That is a privacy selling point being given away silently.

- TRAINER LADDER UNDER-SELLS vs THE CLIENT LADDER. The client basics include `["Trainer connection, app install & Face ID", true, true, true]` (App.jsx:16741), but the trainer basics block (App.jsx:16765-16771) has no equivalent row — despite the code being role-agnostic (install banner App.jsx:14159 `if (standalone || dismissed) return null;`; Face ID setup row App.jsx:23248; AuthGate button src/AuthGate.jsx:286 gated only on `passkeySupported`). Trainers get PWA install and Face ID identically and are told neither.

- BACK UP AND MOVE YOUR DATA (App.jsx:20319 Data Management, 20386 "Export All Clients", 24021 `exportAllData`, 24103 `clipboardExport`) — a genuine trainer-retention feature (full JSON backup, clipboard transfer, non-destructive import: "Import loads a backup file and merges it with your current profiles — no data is overwritten", App.jsx:20407). The trainer basics section has no row for it.


**Phantom — advertised but not real** (1)

- None. Every platform-touching row in PLAN_FEATURES maps to real, shipped code — I verified each rather than inferring from the inventory's silence: `["Trainer connection, app install & Face ID"]` (16741) → install banner App.jsx:14159 + SideMenu setup row 23248 + AuthGate button src/AuthGate.jsx:286; `["Invite Hub — link, QR, email invites, referrals"]` (16769) → real (S83); `["To-dos, nudges & shared plan editing"]` (16768) → real. I also spot-checked the adjacent rows most likely to have gone stale and they are all live: `["Import from ChatGPT / Claude"]` (16751) → App.jsx:17316 `pasteOpen` / 18497 "Paste from another AI"; `["Past chats — save, revisit & continue"]` (16754) → App.jsx:17427 `CHATS_INDEX_KEY = "caliq-ai-chats"`; `["Food database search + barcode scanner"]` (16737) → App.jsx:8543 `scanOpen` / 8807 `lookupBarcode`. The matrix's header comment ("Every row is a REAL shipped feature (no vaporware)") still holds. This area is clean — no manufactured finding.



### ai (35 features)

**Mismatched — page and code disagree** (0)


**Missing — shipped but never advertised** (0)


**Phantom — advertised but not real** (0)


_Not yet reconciled against PLAN_FEATURES._


---

## Feature inventory (tooltip copy + current gating)

### nutrition

| Feature | What it does (tooltip copy) | Gated today | For |
|---|---|---|---|
| Meal & food logging | Log what you eat into Breakfast, Lunch, Dinner or Snack, with calories and protein, carbs and fat for each item, and edit or delete anything you logged. | `free` | both |
| Food database search | Search a database of hundreds of thousands of foods — brand-name products and whole foods — and the calories and macros fill in for you. | `free` | both |
| Barcode scanner | Point your phone camera at a product's barcode and the food, calories and macros are looked up and filled in automatically. | `free` | both |
| Serving size & unit picker | Set exactly how much you ate — grams, ounces, cups, millilitres or "1 serving" — and the calories and macros rescale instantly. | `free` | both |
| AI food estimate from a description | Type a meal in plain words — "chicken burrito with rice and beans" — and get an instant calorie and macro estimate for anything the database doesn't have. | `premium-or-trial` | both |
| Photo meal estimate | Snap a photo of the plate (or several angles, plus a note about anything the camera can't see) and get calories and macros back without typing the food out. | `premium-or-trial` | both |
| Micronutrient tracking | See the day's fibre, sodium, iron, calcium, vitamins and 25 other nutrients from the foods you logged, each as a bar filling toward a normal daily amount. | `free` | both |
| Macro targets with progress bars | Protein, carbs and fat each get a daily target and a progress bar, so you can see at a glance what's still left to eat. | `free` | both |
| Custom macro targets | Set your own protein, carb and fat targets in grams or as a percentage of calories, with one-tap recommended splits — or reset back to the automatic ones. | `free` | both |
| Protein target basis | Choose whether protein is set at 1 gram or 0.7 grams per pound of bodyweight, and the daily target updates. | `free` | both |
| Daily calorie target with pace picker | Pick how fast you want to lose weight and see the exact calories you'd eat each day for that pace, with an honest warning if it would drop below a safe floor. | `free` | both |
| Set your own calorie target | Override the calculated number with whatever daily calorie target you or your coach prefer, and the macros adjust to match. | `free` | both |
| Count workout burn toward eating (eat-back vs. accelerate) | Decide whether a workout earns you extra food that day or instead speeds up your goal date, and see both real numbers before you choose. | `free` | both |
| Daily goal direction (deficit / maintain / surplus) | Set whether today should be under, at, or over maintenance calories, and the ring tells you whether the day matched. | `free` | both |
| Saved foods library | Star the foods you eat all the time so they're always one tap away, kept forever and across every plan. | `free` | both |
| Previously logged foods | Everything you've logged lately is remembered per meal, so re-adding yesterday's breakfast takes one tap instead of retyping it. | `free` | both |
| Saved & previous whole meals | Save a whole combination of foods as one meal and log the entire thing again in a single tap. | `free` | both |
| Copy a meal from another day or meal | Browse your recent days and copy any past breakfast, lunch or dinner straight into today's meal. | `free` | both |
| Move a logged food between meals | Logged something under the wrong meal? Move it from dinner to lunch without re-entering it. | `free` | both |
| Plan meals ahead | Plan meals for future days — including repeating them every Monday, Wednesday and Friday for weeks — then tick each one off as you actually eat it. | `free` | both |
| Quick Add calories | In a hurry? Punch in a bare calorie number, or tap +100 / +250 / +500, without naming the food. | `free` | both |
| Water tracking | Log water in ounces against a daily hydration goal based on bodyweight, with a progress bar and quick-add buttons. | `free` | both |
| Calendar with back-dated logging | Flip through your food history by month, week or day and add or fix meals on any past date — no more "I forgot to log Tuesday". | `free` | both |
| Calendar adherence colouring & weekly roll-ups | Days are shaded green or amber depending on whether calories landed under or over target, with weekly averages for calories and protein. | `free` | both |
| Step back a day on the meal card | Arrows on the meal card walk back through recent days so you can log yesterday's dinner without opening the calendar. | `free` | both |
| This Week nutrition averages | See average daily calories, protein, carbs and fat over the last seven logged days, each next to its target. | `free` | both |
| On-track consistency tracker | Shows what percentage of your logged days actually hit the calorie goal, and what that consistency means for your realistic goal date. | `free` | both |
| Logging streak & badges | A running streak of consecutive days logged, plus milestone badges for 7 and 30 day streaks, 10 and 50 days logged, and 80%+ adherence. | `free` | both |
| Nutrients guide in the full plan | A full nutrition breakdown for the plan — macro targets at different deficits, a daily water target, a micronutrient reference with food sources, and food picks to hit the macros. | `free` | both |
| Plain-English daily checklist | A jargon-free version of the plan: the one calorie number that matters, protein in palm-sized portions, cups of water, and workout days. | `free` | both |
| Log food by chat, voice or photo with Ask Glidna | Describe, speak or photograph a meal in the assistant and it works out the macros, shows a tap-to-accept card, and saves it to the right day and meal. | `premium-or-trial` | both |
| Log food on a client's behalf | Open any connected client's day and log or fix their meals, macros, water and targets for them — everything you change appears on their phone straight away. | `trainer-only` | trainer |

### coaching

| Feature | What it does (tooltip copy) | Gated today | For |
|---|---|---|---|
| Connected client roster | See every client linked to you on one screen — their current weight, goal, daily calorie target and how long since they last logged — and tap any card to open their plan. | `trainer-only` | trainer |
| Coaching Dashboard | A single overview of your whole roster: who trained this week, who has gone quiet, what you have asked people for, and how much weight each client has actually lost. | `trainer-only` | trainer |
| Nudge a quiet client | One tap sends a "please log your food" reminder to any client who has stopped logging, without opening their plan. | `trainer-only` | trainer |
| Send a client a to-do | Send a client a small task — log today's food, do a weigh-in, record a workout, or anything you type — and it appears on their home screen and in your chat with them, where they tick it off. | `trainer-only` | both |
| Requests from clients (inbox) | Clients can send you a short ask — "can you log yesterday's dinner for me" — and it lands in an inbox on your home screen that you mark done or dismiss. | `free` | both |
| Direct messages with clients | A private chat between you and each client, with unread badges on both sides, so coaching conversations live in the app instead of scattered across texts. | `free` | both |
| Client notes | Keep notes on each client — injuries, preferences, what worked last block — and choose whether each note stays private to you or is shared so the client can read it. | `trainer-only` | trainer |
| Personal notebook | A private notebook for anything that isn't about one particular client. | `free` | both |
| Invite link, share sheet and QR code | Get a personal invite link and a QR code so a client can join and be linked to you in one tap, in person or over any app you already use. | `trainer-only` | trainer |
| Email invitations | Email an invitation straight from the app — your client gets a branded message with your personal join link and is linked to you automatically when they sign up. | `trainer-only` | trainer |
| Referral stats | See how many clients have joined you, how many invitations you have sent, and which ones haven't signed up yet. | `trainer-only` | trainer |
| Team of sub-trainers | Build a team — other trainers join you with your invite code, and you can see how many clients each one carries or remove them from your team. | `trainer-only` | trainer |
| Session booking | Book training sessions with a client — date, length, location and price — and you both see the schedule update live, with either side able to cancel. | `trainer-only` | both |
| Cancellation policy | Set your own notice period and late-cancel fee once, and every client sees those exact terms on their sessions screen — including the fee warning before they confirm a late cancellation. | `trainer-only` | both |
| Card on file for sessions | Clients save a card once and agree to your policy, so session fees and late-cancel charges are collected for you instead of you chasing payments. | `free` | both |
| Automatic session charging | Once a session has finished, its charge goes through on the client's saved card by itself — no invoicing step and nothing to remember. | `free` | both |
| Earnings | See what you've earned from training sessions this month and overall, with every charge listed — what it was for, when, and whether it went through. | `trainer-only` | trainer |
| Assign and manage a client's plans | Hand a client one of your plan files, keep several plans per client with one marked active, save yourself a copy, or take a plan back. | `trainer-only` | trainer |
| Folders for organising clients | Group connected clients, plan templates and simulations into folders you name, and drag any card between them. | `trainer-only` | trainer |
| Trainerize import and background sync | Bring an existing Trainerize client list — their stats, goals, meals, workouts and watch data — into the app, and keep it refreshing in the background every half hour. | `admin-only` | trainer |

### platform

| Feature | What it does (tooltip copy) | Gated today | For |
|---|---|---|---|
| Import clients from Trainerize | Pick clients from your Trainerize roster and bring their stats, goals and history into Glidna without retyping anything. | `admin-only` | trainer |
| Trainerize auto-sync (every 30 minutes) | Once a client is imported, their new weigh-ins, meals, workouts and watch data keep flowing into Glidna on their own, about every half hour. | `admin-only` | trainer |
| Sync from Trainerize now | Tap once to pull the very latest data from Trainerize instead of waiting for the next automatic refresh. | `admin-only` | trainer |
| My watch data | Point your own fitness tracker at the plan you already use, so your calories burned and steps land there automatically — nothing else about your plan is touched. | `admin-only` | trainer |
| Tracker readings on your dashboard | See the calories you actually burned and your step count for the day right alongside what you ate. | `free` | both |
| Type in your watch's calorie burn | No connected tracker? Read the number off your watch and type it in, and Glidna treats it exactly like synced data. | `free` | both |
| Use my tracker's real burn | Switch this on and your daily calorie target is built from what your watch actually measured that day instead of an estimate. | `free` | both |
| Notification Center | One place to turn every nudge and reminder on or off — all at once, or one type at a time. | `free` | both |
| Push notifications to your phone | Get alerts on your phone even when Glidna is closed, and turn them off per device whenever you like. | `free` | both |
| Notification bell | A running list of everything that happened since you last looked — messages, to-dos and client requests — with an unread count on the bell. | `free` | both |
| Automatic logging & weigh-in reminders | Glidna nudges your clients on their phone if they haven't logged food by mid-afternoon, and each Monday if it's been a week since they weighed in. | `free` | client |
| Message & to-do alerts | A new message from your trainer, or a new to-do they send you, pops up on your phone right away. | `free` | both |
| Home-screen nudges | Gentle reminder cards on your home screen when you haven't logged today, haven't weighed in for a week, or when there's a coaching tip for the day. | `free` | client |
| Install to your home screen | Add Glidna to your phone's home screen so it opens full-screen like a normal app and starts up fast. | `free` | both |
| Face ID / Touch ID sign-in | Set up your face or fingerprint once and sign in with a glance instead of typing a password. | `free` | both |
| Auto sign-out when idle | Glidna signs you out after 30 minutes of inactivity — handy on a shared or gym device — and you can switch it off on your own phone. | `free` | both |
| AI data consent switch | Decide whether AI can read your information at all — turn it off and neither Glidna's assistant nor any AI your trainer connects can touch your account, while logging and plans keep working. | `free` | both |
| Light, Dark or Auto appearance | Choose a light or dark look, or let Glidna follow whatever your phone is set to. | `free` | both |
| Customise your dashboard tiles | Hide the numbers you don't care about — like water or weight — and bring them back whenever you want. | `free` | both |
| Back up and move your data | Download a full backup of every client and plan, or copy it across to another device, and load it back in without overwriting anything. | `trainer-only` | trainer |
| Admin dashboard (all users) | A private overview of everyone on the platform — their plan, trial status and AI usage — with a tap-through to any one person's spend history. | `admin-only` | trainer |
| App requests inbox | A private list of feature ideas users sent in through the AI, with the context of what they were trying to do at the time. | `admin-only` | trainer |

### ai

| Feature | What it does (tooltip copy) | Gated today | For |
|---|---|---|---|
| Ask Glidna (AI chat) | Chat with a coach that already knows your numbers, and see the answer appear word by word as it's written. | `premium-or-trial` | both |
| Log a meal by describing it | Say what you ate in plain words and it works out the calories and macros and saves it to the food diary. | `premium-or-trial` | both |
| Tap-to-confirm meal card | Every meal the assistant estimates comes back as a card you can accept or correct before anything is saved. | `premium-or-trial` | both |
| Log a whole day of food in one go | List everything you ate and it saves the entire list at once instead of one item at a time. | `premium-or-trial` | both |
| Photo meal logging in chat | Snap up to twenty photos of a plate and it identifies the food, estimates the portion, and logs it. | `premium-or-trial` | both |
| Voice logging (speak instead of type) | Hold the mic and talk — it turns your speech into text so you can log a meal or ask a question without typing. | `premium-or-trial` | both |
| Hands-free "Talk to Glidna" | Tap once to talk while the page you're looking at stays on screen, then confirm who the note is about before it sends. | `premium-or-trial` | both |
| AI food estimate in the food tracker | Type any food the database doesn't have and the assistant fills in the calories and macros for you, right inside the normal logging form. | `premium-or-trial` | both |
| Photo estimate in the food tracker | Add photos of your meal in the normal logging form and it reads the plate and fills in the numbers. | `premium-or-trial` | both |
| Ask questions about your own logged data | Ask what you ate this week or whether you're hitting your protein, and it answers from your real logs and targets, not guesses. | `premium-or-trial` | both |
| Log workouts, weigh-ins, water and measurements by chat | Mention a workout, a weight, how much water you drank or your tape measurements and it records them on the right day. | `premium-or-trial` | both |
| Log for a past day | Say "yesterday" or name a date and it files the meal, workout or weigh-in on that day instead of today. | `premium-or-trial` | both |
| Meal planning for future days | Ask for a meal plan and it fills in the days ahead with meals to tick off, without those meals counting against any day until you eat them. | `premium-or-trial` | both |
| Food-database lookup on request | Ask it to "look that up" and it pulls the real label numbers from the food database instead of estimating. | `premium-or-trial` | both |
| Set up a plan by conversation | Answer a few questions in chat — height, age, weight, goal, how active you are — and it fills in the plan and works out your daily targets. | `premium-or-trial` | both |
| AI workout program builder | Describe the week you want and it drafts a real training program as a card you approve with one tap. | `premium-or-trial` | both |
| Custom exercises by chat | Name a movement that isn't in the exercise library and it creates it, with a calorie burn, ready to put in a program. | `premium-or-trial` | both |
| Start and switch training phases by chat | Say "start a cut" and it creates a new plan with your details carried over, and can switch or rename plans later. | `premium-or-trial` | both |
| Notes and session recaps by chat | Tell it to write something down or save a recap and it files a note you can read later, kept private unless you share it. | `premium-or-trial` | both |
| Read a shared link | Paste a YouTube, Instagram, TikTok or recipe link and it reads the content and turns it into a workout or a logged meal. | `premium-or-trial` | both |
| Paste from another AI | Already asked ChatGPT or Claude about your meals? Paste its reply and Glidna turns it into real logged entries. | `premium-or-trial` | both |
| Past chats | Your conversations are saved, so you can jump back into an old one, rename it, or start a fresh one any time. | `premium-or-trial` | both |
| Pin a chat to one client | Start a conversation about a specific client so everything you log or change in it goes to their file, never yours by mistake. | `trainer-only` | trainer |
| Ask about any of your clients by name | Name a client and it finds them — whether they have an app login or are just a plan file you keep — and works on their numbers. | `trainer-only` | trainer |
| "Who needs attention?" roster review | Ask who's stalled or off track and it reviews every client at once — days logged, calorie and protein adherence, weight trend — and tells you who to chase and what to change. | `trainer-only` | trainer |
| Send a client a to-do from the chat | Ask it to nudge a client and the to-do lands on that client's home screen without you leaving the conversation. | `trainer-only` | trainer |
| Change your reminder settings by chat | Tell it to turn a type of reminder on or off and it changes your notification settings for you. | `premium-or-trial` | both |
| Send the team a feature request | Wish the app did something it doesn't? Tell the assistant and it passes the request to the Glidna team with the context of what you were doing. | `premium-or-trial` | both |
| Daily AI allowance | Each plan comes with a daily amount of AI use, and it grows as you move up — you get a heads-up as you approach it and it resets the next day. | `premium-or-trial` | both |
| Request more usage today (allowance boost) | On the top plans, if you run out of AI for the day you can ask for more and get it straight away. | `pro-entitlement` | both |
| Automations (scheduled AI runs) | Set your AI coach to run on a schedule — a daily or weekly check-in on your real data that lands in your notifications without you opening the app. | `pro-entitlement` | both |
| Connect your own AI (Claude, ChatGPT) | Link Glidna to the AI assistant you already use, so you can log meals, check progress and build workouts from inside it and it writes straight into your account. | `free` | both |
| Choose what your outside AI may do | When you connect an outside assistant you approve exactly what it can do — read only, log for you, or change your plan — and you can disconnect any time. | `free` | both |
| Turn AI off for your account | Switch off AI entirely and no assistant — yours or your trainer's — can touch your data, while everything else in the app keeps working. | `free` | both |
| AI usage and spend dashboard | See every account's AI use and cost for the day, month and year in one place. | `admin-only` | trainer |

---

## Decisions — free-tier review with Kevin (S175, Aug 2 2026)

Standing rule (Kevin): free = every non-AI feature; the AI layer (in-app + connector)
is what you pay for. Non-AI paid levers are being scouted per batch for LATER use —
AI-only paywalls are a structural risk (a user could bring their own AI instead).

### Batch 1 — food-logging core (confirmed)
| Feature | Tier | Note |
|---|---|---|
| Meal & food logging | FREE | front door, non-negotiable |
| Food database search | FREE | unusable tracker = no trial starts |
| Barcode scanner | FREE **(banked lever #1)** | MFP's famous Premium gate. If ever gated: NEW accounts only, never a take-away. NOT promised free forever — deliberately unbanked. |
| Serving size & unit picker | FREE | part of search, not a separate feature |
| AI food estimate (description) | PREMIUM+ | correctly enforced today; UI bug: button shows for free users and errors instead of upselling — build list |

### Batch 2 — targets & macros (confirmed)
| Feature | Tier | Note |
|---|---|---|
| Micronutrient tracking (~30 nutrients) | FREE **(banked lever #2 — strongest)** | MFP charges $19.99/mo for this; appeals to serious users (the ones who pay). Currently not even advertised — fix in grid work. |
| Macro targets with progress bars | FREE | table stakes everywhere |
| Custom macro targets (g or %) | FREE (lever #3 — weak) | MFP paywalls gram-level goals, but trainers set these on client plans — gating client-side while coaches set them is confusing. |
| Protein target basis (1g/0.7g per lb) | FREE | preference toggle, too small to sell |

### Batch 3 — calorie-target engine (confirmed)
| Feature | Tier | Note |
|---|---|---|
| Daily calorie target + pace picker | FREE | MacroFactor's whole $11.99/mo product; ours feeds the AI upsell. ADD NAMED GRID ROW. |
| Set your own calorie target | FREE | trainer-entangled like custom macros |
| Eat-back vs accelerate | FREE | NO competitor equivalent at any price; too wired-in to ever gate → its only value is marketing. ADD NAMED GRID ROW ("nobody else has it"). |
| Daily goal direction (deficit/maintain/surplus) | FREE | same engine |

Grid action from this batch: the target engine gets named rows — today the only
nutrition row is "Food, calorie & macro tracking", which sells none of it.

### Batch 4 — food reuse suite (confirmed)
| Feature | Tier | Note |
|---|---|---|
| Saved foods library | FREE | retention mechanic |
| Previously logged foods | FREE | friction removal |
| Saved & previous whole meals | FREE | same cluster |
| Copy a meal from another day | FREE (lever #4 — weakest) | paid at MFP, but overlaps 3 free reuse paths — wouldn't bite as a gate |
| Move a food between meals | FREE | charging to fix a mistake is hostile |

Principle made explicit this batch (Kevin confirmed): HABIT features (anything that
increases logging frequency) stay free — logging frequency keeps people in the app
long enough to want AI. ANALYSIS features (micros) are the levers.

### Batch 5 — planning, quick add, water, calendar (confirmed)
| Feature | Tier | Note |
|---|---|---|
| Plan meals ahead | FREE **(banked lever #5 — moderate)** | market prices planning premium (MFP Premium+ $24.99, bought Intent; Everfit $24-39 add-on). ADD GRID ROW. |
| Quick Add calories | FREE | habit feature (MFP paywalls quick-add-with-macros; not worth imitating) |
| Water tracking | FREE | free everywhere |
| Calendar + back-dated logging | FREE | fixing your history = data ownership, per ToS promise |
| Adherence colouring & roll-ups | FREE | analysis-adjacent but it's the streak payoff; deeper analysis surfaces are the better candidates |

### Batch 6 — insights & guidance (confirmed — NUTRITION AREA COMPLETE, 32/32)
| Feature | Tier | Note |
|---|---|---|
| Step back a day on meal card | FREE | habit |
| This Week averages | FREE **(Insights bundle lever)** | with micros + consistency = a coherent future premium module (MFP "Reports" is Premium-only) |
| On-track consistency tracker | FREE (Insights bundle, gate LAST) | the realistic goal date does conversion work where it sits |
| Logging streak & badges | FREE — never gate | purest habit mechanic; (streak REPAIR noted as a cute future micro-lever) |
| Nutrients guide in full plan | FREE | reference content, beginner objection-handler |
| Plain-English daily checklist | FREE | signup argument, not a paid feature |
| Log food by chat/voice/photo (Ask Glidna) | PREMIUM+ | the AI rule |
| Log food on a client's behalf (manual) | FREE trainer capability | GRID FIX: row must say "…by chat" — manual behalf-logging is free and ungated |

**Banked non-AI levers after nutrition (strength order):** #2 micros (strongest,
+ This Week + consistency as an "Insights" bundle) · #5 meal planning ahead
(moderate) · #1 barcode (proven but backlash-prone; new accounts only) ·
#3 custom macros (weak, trainer-entangled) · #4 copy-from-day (weakest).

### Batch 7 — roster core (confirmed; coaching area framing set)
Area framing (Kevin re-confirmed): whole coaching platform stays the free wedge
for now — trainers are the acquisition channel. TrueCoach charges $26-137/mo for
less. Coach $49 blurb ("full coaching workspace + AI assistant") must be fixed to
match: it sells the workspace the grid gives away.
| Feature | Tier | Note |
|---|---|---|
| Connected client roster | FREE | the wedge itself |
| Coaching Dashboard | FREE **(trainer-side analysis lever)** | TrueCoach's equivalent is $58+; same shape as client Insights bundle |
| Nudge a quiet client | FREE | client-habit mechanic |
| Send a client a to-do | FREE | already a grid row |
| Requests from clients (inbox) | FREE | unadvertised — grid row copy: "to-dos, nudges & asks BOTH WAYS" |

### Batch 8 — communication & invites (confirmed)
| Feature | Tier | Note |
|---|---|---|
| Direct messages with clients | FREE | biggest omission on the page — ADD NAMED ROW, BOTH ladders. Retention moat. |
| Client notes (private/shared) | FREE | workspace basics |
| Personal notebook | FREE | grid footnote at most |
| Invite link / share / QR | FREE | acquisition engine — never tax |
| Email invitations | FREE | same |
| Referral stats | FREE | same |

### Batch 9 — the money cluster (confirmed — TWO MOVES, one is a liability fix)
| Feature | Tier | Note |
|---|---|---|
| Session booking | FREE | scheduling = workspace; Acuity charges $16+/mo for this alone — grid row material |
| Cancellation policy | FREE | only matters attached to billing |
| Card on file for sessions | **ADMIN-ALLOWLIST until Stripe Connect** | liability control, not revenue |
| Automatic session charging | **ADMIN-ALLOWLIST until Stripe Connect** | payment path has NO plan check AND no transfer_data/application_fee — an outside trainer's client money would land in Kevin's Stripe account, Kevin eats the fees and owes a manual payout with no mechanism. Invisible today only because Kevin is the sole real trainer. |
| Earnings | **ADMIN-ALLOWLIST until Stripe Connect** | rides the same gate |

DECIDED (Kevin): session billing is NEVER subscription-gated. Long-term
monetization = per-transaction cut via Stripe Connect (roadmap splits ~15%
platform) — scales with trainer success, pays the Stripe fees, and makes
FREE-tier trainers revenue-positive: the second revenue leg, the structural
answer to "we can't only sell AI".

BUILD LIST addition: admin allowlist on the session-billing trio (card save,
auto-charge, earnings) — ships with the client-limit work.

### Batch 10 — teams & organization (confirmed — COACHING AREA COMPLETE, 20/20)
| Feature | Tier | Note |
|---|---|---|
| Team of sub-trainers | FREE **(banked: Studio-tier anchor — strongest trainer lever)** | multi-seat agency capability; My PT Hub charges $215/mo partly for 5 seats. Future Studio tier = teams + big connector rosters + Connect revenue splits (head 10%/platform 15%). Build when the first real agency arrives. |
| Assign & manage client plans | FREE | core workspace |
| Folders | FREE | organization is never worth gating |
| Trainerize import & sync | ADMIN-ONLY, stays off the page | runs on Kevin's personal token; review says do not "fix". Coach blurb rewrite (batch 7) covers the adjacency. |

### Batch 11 — wearables + admin rows (confirmed)
| Feature | Tier | Note |
|---|---|---|
| Trainerize import / auto-sync / sync-now / My watch data (4 rows) | ADMIN-ONLY, off the page | ride Kevin's personal token |
| Tracker readings on dashboard | FREE | — |
| Type in watch's burn | FREE | manual on-ramp |
| Use my tracker's real burn | FREE + **named grid row** | headline differentiator, unadvertised; too wired-in to gate — "Your watch sets your calorie target" |

### Batch 12 — notification cluster (confirmed)
All six FREE (Notification Center, push delivery, bell, auto logging/weigh-in
reminders, message & to-do alerts, home-screen nudges). Verdict: notifications
are the DELIVERY SYSTEM for the free habit mechanics — gating delivery breaks
retention. Trainerize charging for reminder automations = our ammunition, not a
model. Grid: one named row per ladder — client "Phone reminders & nudges";
trainer "Your clients get automatic logging reminders".

### Batch 13 — account, device & privacy (confirmed — PLATFORM AREA COMPLETE, 22/22)
| Feature | Tier | Note |
|---|---|---|
| Install to home screen | FREE | + add to TRAINER basics row (currently client-only row) |
| Face ID / Touch ID | FREE | security is never paid; add to trainer row too |
| Auto sign-out when idle | FREE | same principle |
| AI data consent switch | FREE + **named row BOTH ladders** | server-side enforced, covers even the trainer's connector; "your data, your switch" — a trust argument nobody in fitness makes |
| Light/Dark/Auto | FREE | — |
| Customise dashboard tiles | FREE | — |
| Back up & move your data (trainer) | FREE | trust feature. BUILD LIST: client-facing JSON export to back the footer promise ("you keep every bit of your data") — Kevin chose BUILD over reword, attorney review pending |
| Admin dashboard / App requests inbox | ADMIN-ONLY, off page | stamps |

### Batch 14 — the premium-or-trial block (confirmed)
All 28 premium-or-trial AI rows CONFIRMED at Premium+ (4 of them also
trainer-role-gated), tooltips as drafted. Verified: the urgent-list allowance
mismatches (trial>paid inversion, ~15 vs two budgets, 2.5x vs 2x) were fixed by
S169g/S171 — current published numbers match BUDGETS. No action.

GRANDFATHERING DECIDED (Kevin): keep legacy accounts unlocked as an earned
courtesy, but FENCE it — BUILD LIST: any account missing trialStartedAt gets one
stamped at first login going forward, closing the free-forever minting hazard.

### Batch 15 — final rows (confirmed — CATALOGUE COMPLETE, 109/109)
| Feature | Tier | Note |
|---|---|---|
| Allowance boost | ELITE+ | matches ladder |
| Automations (scheduled AI) | ELITE+ | 1/3 client, 2/5 trainer per day |
| Connect your own AI | **CONNECT+** | inventory said `free` — STALE post-S173 (free = 0 calls). Tooltip updated to "on any paid plan". |
| Choose what your outside AI may do | CONNECT+ | rides the connector |
| Turn AI off for your account | FREE | duplicate of the consent switch (batch 13) — dedupe to one grid row |

**FINAL SCOREBOARD:** ~75 free (whole manual product + coaching workspace +
notifications + privacy) · 28 Premium+ (AI layer) · 2 Connect+ · boosts &
automations Elite+ · 7 admin-only off-page · session-billing trio allowlisted.

**CONSOLIDATED BUILD LIST** (from the whole review): 1) AI-coached client
limits 15/25/35 (see PRICING.md S175) · 2) session-billing admin allowlist ·
3) trialStartedAt fence at first login · 4) client-facing data export ·
5) coach_summary 60-cap fix · 6) tracker AI-buttons upsell card for free users ·
7) the grid/tooltip work itself: 109 ⓘ tooltips + new named rows (target
engine, eat-back/accelerate, meal planning, DMs both ladders, wearable target,
notifications, AI consent switch, micros, session booking) + copy fixes
("…by chat", "asks both ways", trainer basics get install/Face ID, Coach blurb
rewrite) + Connect-row gating notes.

Training area sweep: running (S175) — was never catalogued (agents died on
output size); results append below when decided.

### Batches 16–17 — training area (confirmed — CATALOGUE FULLY COMPLETE, 132/132)
Training area swept S175 (two capped agents — the output-cap fix worked; the
full 23-feature tables with tooltip copy live in the S175 session transcript
and below in compact form). ALL 23 FREE — manual, non-AI, habit/workspace.

Building (13, all free): weekly cardio planner · weekly strength planner ·
Quick Fill · movement combos · exercise library (50+ cardio/130+ strength) ·
search picker · custom exercises · MET burn estimates · heart-rate cardio
sessions · heart-rate zones · weekly burn totals · EPOC afterburn · edit
workouts from plan.

Progress (10, all free): daily check-ins · weight chart · goal range ·
start weight & lbs lost · time-to-goal projection · measurements & body-fat ·
body-composition timeline · workout-done tracking · IBW card · share card.

Decisions on top: THREE new differentiator grid rows — heart-rate training
(sessions + zones; no consumer tracker plans cardio by bpm), EPOC afterburn,
body-composition timeline ("dropping fat or losing muscle?"). Body measurements
+ body-comp timeline ADDED to the banked Insights bundle (now: micros + weekly
averages + consistency + body comp — meaty enough to be a real module).

**FINAL: 132/132 features decided.** ~98 free · 28 Premium+ · 2 Connect+ ·
boosts/automations Elite+ · 7 admin-only · session-billing trio allowlisted.
