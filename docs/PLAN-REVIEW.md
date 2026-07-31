# Plan & pricing review — working doc

Built S169 to support the "Choose your plan" rework: a free tier, re-tiering, and a
tooltip per feature. Each feature below carries a one-sentence plain-English description
written to become that tooltip, plus what the code ACTUALLY gates today.

**Read the reconciliation first.** The inventory is useful; the mismatches are urgent.
They are places the pricing page makes a promise the code does not keep, or the reverse.

Status: nutrition / coaching / platform complete. AI + training re-running (both dropped
on connection errors first pass).


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

### nutrition (30 features)

**Mismatched — page and code disagree** (6)

- GRANDFATHERED ACCOUNTS GET THE ENTIRE PAID AI NUTRITION SECTION FREE, PERMANENTLY. Matrix: every AI row is Free=false, e.g. `["Log meals by chat — just describe them", false, true, true]` and `["Photo meal logging — snap your plate", false, true, true]` (src/App.jsx:16746-16748). Code: functions/aichat.js:286 `if (!startMs) return false; // pre-trial account — grandfathered` inside trialExpiredFor() — any profile with no `trialStartedAt` never expires, so chat meal logging, photo logging, estimateFood and voice are unlocked forever. Mirrored in functions/transcribe.js:22-30 and src/profile.js:115 `isPremium` -> `return !t || !t.expired`. This is deliberate (S89) but it is a standing, unpriced free tier that the pricing page states does not exist.

- THE PUBLISHED PREMIUM AI ALLOWANCE IS ONE NUMBER OVER TWO DIFFERENT REAL ALLOWANCES, AND BOTH CAN BE SMALLER THAN THE FREE TRIAL. Matrix: `["AI conversations per day", "—", "~15", "~100"]` (src/App.jsx:16755). Code, functions/aichat.js tierFor(): line 85 `if (profile && profile.assignedTrainerId) return "assisted";` else line 86 `return "client";` — and BUDGETS at line 51 is `{ trial: 50000, client: 25000, assisted: 40000, ... }`. So a paying $14.99 Premium client linked to a trainer gets 40,000 tokens/day while an identical unlinked subscriber gets 25,000 — a 60% spread at the same price, published as a single "~15". Worse, line 84 `if (profile && profile.subscriptionStatus === "trial") return "trial";` gives the TRIAL 50,000 — so converting from trial to paid Premium HALVES the allowance (docs/PRICING.md:262 itself reads "client 25k/day ~= ~16 exchanges/day", i.e. the trial is ~32).

- SAME INVERSION ON THE COACH SIDE. Matrix: `["AI conversations per day", "—", "~40", "~100"]` (src/App.jsx:16783), with Coach Elite's section promising "Our biggest AI allowance" (:16786). Code: functions/aichat.js:75 `if (profile && profile.subscriptionStatus === "trial") return "trainerTrial";` vs :76 `return "trainer";`, and BUDGETS `trainerTrial: 200000` equals `trainerMax: 200000` while paying Coach is `trainer: 100000`. A trainer on the free trial is already on the full $79 Coach Elite allowance and drops to half of it the moment they pay $49 — the matrix presents that move as a pure upgrade.

- PAID TRACKER AI IS ENFORCED ON THE SERVER BUT ADVERTISED TO FREE USERS IN THE UI. Matrix: `["AI food estimates in the tracker", false, true, true]` and `["Photo meal logging — snap your plate", false, true, true]` (src/App.jsx:16748-16750). Code: `function MealLog({ meals, onAddMeal, ... })` (src/App.jsx:8496) takes NO `premium` prop — the "AI estimate" button (:9089) and "Add a photo" (:9095) render for everyone; the only feedback is after the tap, at :8650 `if (code.includes("permission-denied")) setAiErr("Your free trial has ended — upgrade to keep AI estimates.");`. Compare the chat, which DOES gate in the UI: src/App.jsx:18458 `{!premium ? (` swaps in the upgrade card, and :18156 `if (!premium) { setOpen(true); return; }`. No revenue leaks (functions/aichat.js:700-702 rejects), but an expired user's first contact with the paid feature is a dead-end error with no Upgrade button on that path.

- A DOCUMENTED PAID FOOD GATE THAT NOTHING ENFORCES AND THE MATRIX NEVER SELLS. src/profile.js:100-107: "The AI 'precise food data' feature (real database values instead of estimates) is gated on this. Keep this in sync with functions/aichat.js isProUser()." -> `export function isProUser(profile) { return profile.subscriptionStatus === "active" || (profile.entitlements && profile.entitlements.foodAccuracy === true); }`. There is no `isProUser` in functions/aichat.js, nothing in src/ imports `isProUser` or `aiFoodDbEnabled`, and the search_food_db handler (functions/aitools.js:2342) runs for any AI-enabled caller with no subscription check. So the feature is free to all AI users while the code claims it is paid — and note the dead check keys on `subscriptionStatus === "active"`, which would have excluded TRIAL users, so re-enabling it as written would silently take live FatSecret lookups away from every trial account.

- Adjacent, flagged for consistency rather than as a defect: the Elite/Coach Elite sections end with `["Hit the ceiling? Tell us — we raise it", false, false, true]` (src/App.jsx:16759, :16787), but the chat surfaces a real paid tier that is absent from the pricing page — src/App.jsx:18573 `Upgrade to ${isTrainer ? "Coach Apex — $129/mo" : "Apex — $49.99/mo"}`, with the code comment at :18556-18557 saying it is "data-triggered; it's not on the public page". Intentional, but a Max buyer who bought on the "tell us and we raise it" promise and then meets a $49.99/$129 upsell may read it as bait-and-switch.


**Missing — shipped but never advertised** (11)

- Micronutrient tracking is entirely absent from both grids. The only nutrient row is client free-section "Food, calorie & macro tracking" (src/App.jsx:16737) — nothing anywhere says vitamins, minerals, fibre, sugar or sodium. The code ships 30+ tracked nutrients with RDA progress bars per food AND a daily roll-up (src/App.jsx:6989 MICRO_DEFS, :7061 MicroBars, per-food panel :7908, daily roll-up :12008), free to everyone (no gate found in the whole 7000-12800 range). This is the single biggest un-advertised giveaway in the area.

- Food library and meal reuse — the retention feature — has no row at all. Free in code: recent + starred foods (src/App.jsx:8092 FoodLibrary, "Library" button :9535), saved WHOLE meals re-logged in one tap (:8289-8318, star at :9377), and copy-a-meal-from-another-day (:7952 CopyMealModal, link at :9395). Nothing in the free section implies any of it.

- Plan-meals-ahead is unlisted on BOTH sides of the ladder. Manual planning is free and real (src/App.jsx:8508 plan mode in MealLog, planned list :9554, multi-day/recurring writer :24499 with weekday repeats, weeks, time and place, tick-to-log). Its paid AI counterpart plan_meals (functions/aitools.js:1014, handler :2475) is also missing from the client AI section, which lists only "Log meals by chat — just describe them" (src/App.jsx:16746). Glidna sells the logging but not the planning.

- The whole coach-grade target-control cluster — all free, none advertised: editable macro targets in grams or % of calories with 1g/0.7g-per-lb protein basis chips (src/App.jsx:11864, editor :11926, chips :11912), a user-set calorie target overriding the calculation (:11700), the weight-loss pace picker with a 1,200-cal floor warning (:11647, RATE_OPTS :328), the eat-back vs accelerate Nutrition Approach card (:4765), and the "How your target is calculated" breakdown (:11589). The grid's free rows never hint that targets are adjustable at all.

- Tracker-adjusted daily calories — arguably the clearest differentiator vs MyFitnessPal — is nowhere in either grid. Code: "Use my tracker's real burn" toggle at src/App.jsx:4800, calculation wearableTdee at :14791, which rebuilds the day's target from the watch's measured burn instead of an estimate. Free.

- Adherence and compliance reporting has no row. Free in code: weekly calorie roll-up (src/App.jsx:10226), protein roll-up (:10245), workout roll-up (:10288), This Week nutrition averages vs target (:12608), and the on-track compliance card with a 10% grace band (:22443, maths :22432). The nearest matrix row, "Calendar, streaks, check-ins & water" (:16741), implies none of this.

- Back-dated logging (src/App.jsx:9503 day arrows, :10412 full day editor in CalendarView) and the serving-size picker with g/oz/cup/ml/servings conversion (:7659 FoodServingModal) are both free and unmentioned. "Food database search + barcode scanner" (:16738) does not imply either.

- The built-in Nutrients reference guide (src/App.jsx:5882 NutrientsTab, tab at :3852 — macros, hydration, food sources per macro, what each vitamin and mineral does) has no row.

- THE TRAINER GRID CONTAINS ZERO NUTRITION ROWS. PLAN_FEATURES.trainer's free section (src/App.jsx:16766-16772) is: connected clients, coaching analytics, to-dos/nudges, Invite Hub, local plans/simulations. A coach evaluating the $49 Coach tier is never told the food database, barcode scanner, micronutrients, meal tracker, target controls, calendar adherence and back-dated logging come with it — even though every one of those inventory items is marked audience "both" and the trainer reaches them through the same DailyDashboard/MealLog code.

- Four paid AI nutrition tools are shipped but unlisted in the AI sections: bulk log_meals (functions/aitools.js:1055), remove_meal (:1091), log_water (:1188), and search_food_db — live FatSecret label lookup from inside the chat (:948, handler :2342). The client AI section advertises only "Log meals by chat", "Photo meal logging" and "AI food estimates in the tracker".

- Trainerize nutrition history import (functions/trainerize.js:420 syncClientNutrition, a year of meal-by-meal history) is correctly absent from the trainer grid because it is admin-locked — functions/trainerize.js:67 `if (!ADMIN_UIDS.includes(uid)) {`, enforced at :684 and :763. Listed here only so it is not mistaken for a shippable Coach-tier migration feature.


**Phantom — advertised but not real** (2)

- No phantoms. Every nutrition-relevant row in PLAN_FEATURES maps to shipped code: "Food, calorie & macro tracking" -> MealLog src/App.jsx:8496; "Food database search + barcode scanner" -> :7318 searchFoods + :8807 lookupBarcode + :8827 live scanner; "Calendar, streaks, check-ins & water" -> :9878 CalendarView + :12408 hydration; "Log meals by chat" -> functions/aitools.js:990 log_meal; "Photo meal logging" -> src/App.jsx:9095 -> :8658 -> functions/aichat.js:690; "AI food estimates in the tracker" -> functions/aichat.js:678 estimateFood; "Voice logging" -> functions/transcribe.js; "Import from ChatGPT / Claude" -> src/App.jsx:18086-18094 and the composer button :18768; "Turn TikTok / IG / YouTube links into workouts & meals" -> the fetch_link tool; trainer "Log meals / weigh-ins / workouts FOR clients" and "Photo & voice meal logging" -> the same tools with clientId.

- One wording risk worth fixing, not a phantom: "Voice logging — speak instead of type" (src/App.jsx:16749) exists ONLY in the AI chat composer. MealLog (src/App.jsx:8496) has no mic — its signature carries no recording state and a scan of lines 8496-9700 finds no MediaRecorder/transcribe path. A reader of the row next to "AI food estimates in the tracker" will reasonably expect to dictate into the food log and will not find it.



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



---

## Feature inventory (tooltip copy + current gating)

### nutrition

| Feature | What it does (tooltip) | Gated today | Audience |
|---|---|---|---|
| Meal-by-meal food log | Log everything eaten under Breakfast, Lunch, Dinner, Snack or a quick entry, and see each meal's calorie subtotal and the day's running total. | `free` | both |
| Food database search | Type a food name and pull real calories and macros straight from a large food library, so nothing has to be typed in by hand. | `free` | both |
| Barcode scanner | Point the phone camera at a packaged food's barcode and the product's nutrition fills in automatically. | `free` | both |
| Serving-size picker | Adjust a food to the amount actually eaten — grams, ounces, cups, millilitres or number of servings — and the calories and macros rescale instantly. | `free` | both |
| AI food estimate from a description | For any food the database doesn't have, describe it in plain words and the AI fills in the calories and macros along with the serving it assumed. | `premium-or-trial` | both |
| AI food estimate from meal photos | Snap up to twenty photos of a plate and the AI reads them, names the food and estimates the calories and macros — photos are never stored. | `premium-or-trial` | both |
| Micronutrient tracking | See the vitamins, minerals, fibre, sugar, sodium and fats in each food and across the whole day, with bars showing how close each one is to a normal daily amount. | `free` | both |
| Daily macro totals and progress bars | Watch protein, carbs and fat add up through the day against each one's target, with bars that flag when a macro is met or gone over. | `free` | both |
| Editable macro targets | Set a client's protein, carb and fat targets yourself — in grams or as a percentage of their calories — or pick 1 g or 0.7 g of protein per pound, and reset to the automatic numbers any time. | `free` | both |
| Set your own calorie target | Override the calculated daily calorie number with one you choose, and the macros adjust to it — or switch back to the calculated figure. | `free` | both |
| Weight-loss pace picker | Choose maintenance, half a pound, one pound or two pounds a week and see the actual calories each pace means, with an honest warning if a pace would drop below the 1,200-calorie floor. | `free` | both |
| Nutrition approach: eat back or go faster | Decide whether workout calories get added to the daily target for an easier diet, or kept back so the goal arrives sooner — each option shows its calories and its goal date. | `free` | both |
| Tracker-adjusted daily calories | On days a connected watch reports what was really burned, the daily calorie target is built from that measured burn instead of an estimate. | `free` | both |
| How your target is calculated | An open breakdown showing daily burn, the deficit and workout calories adding up to today's number, so the target never feels like a black box. | `free` | both |
| Food library — recent and starred foods | Every food logged before is kept and searchable, and anything eaten often can be starred so it's one tap to log again. | `free` | both |
| Saved and previously logged whole meals | Save a complete meal — every food in it — and re-log the whole thing in one tap, or pull back any meal eaten in the last two weeks. | `free` | both |
| Copy a meal from another day | Copy any recent breakfast, lunch, dinner or snack straight into today's meal instead of re-entering it. | `free` | both |
| Quick add calories | Add a bare calorie number in a hurry — typed or with +100/+250/+500 buttons — when there's no time to name the food. | `free` | both |
| Water tracking | Log water in ounces with quick +8/+16/+32 buttons and see the day's hydration as a percentage of the recommended amount. | `free` | both |
| This Week nutrition averages | A single card showing average daily calories, protein, carbs and fat over the last seven logged days, each next to its target. | `free` | both |
| Calendar with month, week and day views | See the whole month at a glance with each day shaded green or amber by whether calories landed under target, then drill into a week or a single day. | `free` | both |
| Weekly adherence roll-ups | Per week, see how many days were logged, the average calories and protein against target, and how many scheduled workouts actually got done. | `free` | both |
| Back-dated food logging | Step back to any past day — from the dashboard arrows or the calendar — and log or fix the food, water and weight for that date. | `free` | both |
| Plan meals ahead | Plan meals for future days — optionally repeating on chosen weekdays for weeks at a time, with a time and place — then tick each one off as it's eaten and it logs itself. | `free` | both |
| Edit, move or delete a logged food | Tap any logged food to fix its serving or macros, move it to a different meal, or delete it with a single confirm. | `free` | both |
| On-track calorie compliance card | Shows what share of logged days actually landed at or under the calorie target, with a 10% grace band so a rounding error never reads as a failure. | `free` | both |
| Nutrients reference guide | A built-in guide to daily macros, hydration, food sources for hitting each macro, and what every key vitamin and mineral does. | `free` | both |
| Log meals by chatting with the AI | Describe a meal, speak it, or send a photo in the chat and the AI works out the numbers, shows a card to accept or edit, and files it into the right meal on the right day. | `premium-or-trial` | both |
| AI meal plans by chat | Ask the AI to plan meals for the week ahead and it writes them onto the right days for the client to tick off as they eat. | `premium-or-trial` | both |
| Trainerize nutrition history import | Pulls a year of a client's existing food logs across from Trainerize, meal by meal, so their history isn't lost when they move over. | `admin-only` | trainer |

### coaching

| Feature | What it does (tooltip) | Gated today | Audience |
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

| Feature | What it does (tooltip) | Gated today | Audience |
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
