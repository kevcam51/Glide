# Trainerize API — capabilities + how Glide can use it (logged for later)

_Kevin has a **Studio account** and pulled the full API reference (v03, ~290 pages). He wants this
logged now and built later. This is the reference + the plan — nothing implemented yet._

## ✅ CONFIRMED LIVE (Session 84) — auth + first response
- **Auth WORKS:** `Authorization: Basic base64("<GroupID>:<APIToken>")`. GroupID is a **6-digit number**;
  token ~21 chars. Stored as secrets `TRAINERIZE_GROUP_ID` + `TRAINERIZE_API_TOKEN` (Kevin's real values,
  set S84). `functions/trainerize.js` already uses this exact format.
- **`user/getClientList`** (body `{start,count}`) → `{ users:[...], total }`. Kevin's group has **13 clients**.
  Each user: `id`(number), `firstName`, `lastName`, `email`, `type`, `status`, `role`, `profileName`,
  `trainerID`, `latestSignedIn`, `profileIconUrl`, `profileIconVersion`, `trialStatus`.
- **Next:** build the importer — per client `id`, call `user/getProfile`, `bodystats/get`, `goal/get`,
  `dailyNutrition/get`, `program/get`, `healthData/getList` (calorieOut) → map into Glide (design below).

## ✅ IMPORTER v1 BUILT & VERIFIED (Session 85) — confirmed request/response shapes
The `trainerizeImport` callable (`functions/trainerize.js`) is DEPLOYED and verified end-to-end
against the live roster. **Exact endpoint contracts discovered via curl (the doc PDF param names
differ from obvious guesses — don't re-derive):**
- **`user/getProfile`** takes **`{"usersid":[id,…], "unitBodystats":"inches"}`** — an ARRAY (batch,
  one call for the whole roster) → `{usrProfile:[…]}` with `firstName`, `lastName`, `sex`
  ("male"/"female"), `birthDate` ("YYYY-MM-DD"), `height` (TOTAL inches as a string when
  unitBodystats=inches), `activeLevel` ("sedentary"/"lightlyActive"/"moderatelyActive"/
  "veryActive"/"extremelyActive"), `email`, `trainerID`, `status`. A plain `{"userID":…}` body
  404s ("Not found." = wrong params, NOT a missing user — the route exists).
- **`bodystats/get`** takes **`{"userID":id, "date":"last", "unitBodystats":"inches",
  "unitWeight":"lbs"}`** — `date:"last"` grabs the newest entry; omitting units → 406 "Unit weight
  missing". → `{date, bodyMeasures:{bodyWeight, bodyFatPercent, bodyMassIndex, restingHeartRate},
  from:"garmin"|"trainerize"|…}`. 412 = client has no body stats.
- **`goal/getList`** takes `{"userID":id, "unitWeight":"lbs", "start":0, "count":10}` →
  `{total, goals:[…]}`; goal types seen live: `weightGoal` (`{weightGoal:175.0, startWeight,
  currentWeight}`) and `nutritionGoal` (`{caloricGoal, proteinGrams, carbsGrams, fatGrams}` — maps
  to Glide `data.macroTargets`). Most clients have NO goals set — treat as optional.
- **Mapping (implemented):** profile→`firstName/lastName/gender/age (from birthDate)/heightFt+In
  (from total inches)/activityLevel (ACTIVITY_MAP)`; bodystat→`weightLbs/bodyFat` + ONE seeded
  check-in (replace-by-date) + `startWeightLbs`; weightGoal→`goalWeight`; nutritionGoal→
  `macroTargets`. Profile id is deterministic **`ctz{trainerizeId}`** + `trainerizeId` on the index
  entry (re-import UPDATES, never duplicates — verified). Imports file under a "Trainerize" folder;
  complete snapshots get `step:5` (dashboard-ready). Client email is stored on the index entry for
  future account-linking.
- **Trigger:** "Import from Trainerize" button on the trainer home (Local Plans card) → writes into
  the CALLER's account. Roster was 10 active clients at build time (was 13 in S84 — roster shrank).
- **Still v2/v3:** history (bodystats list, dailyNutrition, program), scheduled daily auto-sync,
  wearable `calorieOut`, per-trainer tokens (multi-tenant).

## Import design (decided S84) — Option A + auto-sync + rate-limit reality
- **Where clients land: Option A** — each Trainerize client becomes a **local profile in the trainer's
  Glide account** (reuses existing local-profile storage; no new user accounts). Later the trainer invites
  a client → they make a Glide login → it links. Dedupe by Trainerize `id` (store `trainerizeId` on the
  profile) so re-imports UPDATE, not duplicate.
- **v1 = roster + snapshot** (name, current weight, goal, body stats). v2 = history (check-ins, nutrition,
  program). v3 = `calorieOut` wearable burn.
- **Auto-add new clients:** a **scheduled Cloud Function** (daily) calls `getClientList`, diffs against
  imported `trainerizeId`s, imports the new ones (+ a "Sync now" button). Trainerize has no new-client
  webhook, so we poll — cheap (see rate math).
- **Multi-tenant (later):** other independent trainers connect their OWN token (per-trainer **encrypted**
  token store — NOT the single shared secret we use for Kevin now). **Sub-trainers under Kevin's ONE
  Trainerize group**: each client carries a `trainerID` → route each to the right Glide sub-trainer by
  `trainerID`; each sub-trainer can have their own Glide login and see their own imported clients.
- **RATE LIMITS — no "running out" risk:** the limit is **1000 requests/MINUTE per token** (a throttle,
  not a monthly cap). Import = ~6 calls/client → 13 clients ≈ 78 calls; even 200 clients ≈ 1,200 (spread
  over ~2 min). A daily sync is a few hundred calls once/day = negligible. **CRITICAL:** Glide's daily
  calorie targets, macros, logging, and AI are computed by **Glide from stored data — they NEVER call
  Trainerize.** Trainerize is touched only during import/sync. So core features can't "stop working" from
  API limits; even if Trainerize were fully down, Glide keeps running. (Firebase itself is Blaze
  pay-as-you-go with no request cap.)

## Basics
- **Base:** `https://api.trainerize.com/v03/…` — REST, JSON, all **POST**.
- **Auth:** HTTP **Basic** (base64), per **Group API token**. Access is scoped by credential
  (a client credential can only read its own data; a group/trainer token reads the group's clients).
- **Rate limit (Kevin's plan):** **1,000 requests / minute per Group API token**. Exceeding →
  `429 Too Many Requests` ("API Rate Limit Exceeded"). → the importer must page + throttle (stay well
  under 1000/min; batch by client).
- **Errors seen in docs:** `403 Not authorized` (credential scope), `404 User not found`, `500`.

## Endpoint map (124 endpoints) — what's useful to Glide
- **Clients:** `user/getClientList`, `user/getProfile`, `user/getClientSummary`, `user/getTrainerList`,
  `user/getSettings`, `user/getLoginToken`, `user/getSetupLink` → roster + full profiles + onboarding links.
- **Body stats:** `bodystats/get` (+ add/set/delete) → weight + measurement history, units selectable.
- **Nutrition:** `dailyNutrition/get`, `dailyNutrition/getList`, `mealPlan/get`, `dailyNutrition/getCustomFoodList`
  → logged food per day, meal plans, custom foods.
- **Workouts / programs:** `program/get`/`getList`/`getUserProgramList`/`getCalendarList`,
  `trainingPlan/*`, `workoutDef/get`, `dailyWorkout/get`, `dailyCardio/get`, `exercise/get` → full programs,
  scheduled + completed workouts, cardio detail (distance/duration), exercise library.
- **Health / wearables:** **`healthData/getList`** — `type` ∈ **step, restingHeartRate, sleep,
  bloodPressure, calorieOut** over a date range; **`healthData/getListSleep`**. Trainerize already
  aggregates clients' connected wearables → we can read **calories burned (calorieOut)** + steps + sleep
  without building our own Fitbit/Apple/Garmin OAuth.
- **Goals / adherence:** `goal/get`/`getList`/`setProgress`, `compliance/getUserCompliance`,
  `compliance/getGroupCompliance` → client goals + adherence %.
- **Photos / notes / messaging:** `photos/getList`/`getByID`, `trainerNote/*`, `message/*` → progress
  photos, coaching notes, DMs.
- **Org:** `userGroup/*`, `userTag/*`, `appointment/*`, `habits/*`, `challenge/*`.

## How Glide can use it (ranked)
1. **One-click client + history migration (headline).** `getClientList` → per client pull `getProfile`,
   `bodystats/get`, `goal/get`, `dailyNutrition/get`, `program/get` → create/populate their Glide plan
   with history intact. Removes the biggest barrier to switching off Trainerize; later a recruiting hook
   for other trainers ("import your Trainerize clients in one click").
2. **Calories-burned / activity via `healthData.calorieOut`.** Feed the already-aggregated burn + steps
   into Glide's progress/TDEE — a shortcut to the fitness-tracker goal in `TRACKER-INTEGRATION.md` without
   per-wearable OAuth. (Caveat: only for clients using Trainerize's wearable links, and while on Trainerize.)
3. **Program + exercise-library import.** Bring his templates/exercises over so he doesn't rebuild.
4. **Transitional parallel run.** Pull weigh-ins, workout completion, compliance into Glide dashboards
   during migration so he can run both.

## Multi-tenant: every trainer brings their OWN Trainerize token (Kevin's Q)
The API is **per-Group-token**, and a token only sees **its own group's clients**. So this isn't
Kevin-only — it's naturally multi-tenant:
- **Each Glide trainer connects their own Trainerize Group API token** (from their Trainerize settings)
  via a "Connect Trainerize" screen. Glide then imports **that trainer's** clients — trainer A's token
  never sees trainer B's data (Trainerize enforces the scope).
- **Rate limits are per-token** (1000/min each), so trainers don't share a budget — it scales cleanly.
- This turns migration into a **platform acquisition hook**: any incoming trainer on Trainerize can
  one-click import their roster + history into Glide.
- **Requirement:** the trainer needs **API access on their Trainerize plan** (Studio/higher tiers).
  Trainers without it fall back to CSV / manual / AI-paste import.
- **Security (important):** these are third-party credentials we'd store on the trainer's behalf. Store
  them **server-side only, encrypted / in a restricted store the browser can't read back**, decrypt only
  inside the Cloud Function, validate on connect (a test call), and let the trainer disconnect/delete.
  Do NOT store raw tokens in a client-readable Firestore field. (Kevin's single token today can be a
  Secret; the multi-tenant version needs the per-trainer encrypted store.)

## Build plan (when we pick it up — READ-ONLY importer)
- A Cloud Function (Blaze) storing the **Group API token as a Secret** (like RESEND/ANTHROPIC).
- Map Trainerize fields → Glide schema: profile→`data`, bodystats→`checkIns`/weight, goals→goal fields,
  dailyNutrition→`caliq-log-{plan}-{date}.meals[]`, program→`data.cardio`/`data.strength`,
  healthData.calorieOut→a per-day burn we fold into progress.
- Throttle to stay < 1000 req/min; page client-by-client; dedupe on re-import; label imported data's source.
- **Confirm before build:** exactly what the Studio Group API token can read (whole client group?),
  and get the token from Kevin (stored as a secret, never in the repo).

**Status: NOT started — reference + plan only. Kevin wants to build this later.**
