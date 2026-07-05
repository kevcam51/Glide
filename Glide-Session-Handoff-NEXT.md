# Glide — Next-Session Handoff (start here)

_Updated **Session 86**. Read this first, then `CLAUDE.md` (standing context) and
the `docs/` files noted below. Everything is pushed to `main` and live on Vercel unless noted. Firebase
project `calorieiq-29762`; prod URL `calorieiq-jet.vercel.app`. AI model `claude-sonnet-4-6`._

---

## 🔴 DO FIRST (S86 leftover): deploy the pending Cloud Functions
The Firebase CLI token expired mid-S86 and Kevin hadn't re-authed by session end. Once
`firebase login --reauth --no-localhost` (as kevin@smoothtraining.com) succeeds, deploy:
`firebase deploy --only functions:aiChat,functions:aiChatStream,functions:logMeal,functions:setWorkoutSchedule,functions:trainerizeImport --force`
That ships (already written + syntax-checked, NOT live): (1) the **Trainerize selective-import
backend** (`{mode:"list"}` roster preview + `{clientIds:[…]}` filter — the frontend picker is live and
shows "importer is mid-update" until this lands; note: pressing it against the OLD backend triggers a
harmless full re-import); (2) **aitools.js round-2 fixes** — server calorie target now includes
scheduled-exercise burn (`weeklyPlanBurn` + the new `MET` map in exercises.js) so the AI/coach_summary
finally MATCH the app screens; `set_targets` pins only explicitly-provided macros; `log_weigh_in`
merges into same-day check-ins instead of wiping workouts. Then verify: ask the AI "what's my calorie
target?" for a client with a workout program → must equal their dashboard number; picker: select 2
clients → import → only those 2.

## ⏭️ THEN (Kevin's queue): AI-edits-local-plans → biometrics
Also pending a KEVIN DECISION (flagged S86): the Results/Simulation **projection timelines
double-count exercise** — the calorie target eats back the burn (diet+cardio deficit is still ~3,500
cal/wk), but `weeksToGoal(toLose, 3500 + totalBurn)` promises a faster date a client following the
plan-as-written structurally can't hit. Options: project at 3,500/wk ("cardio lets you eat more, not
lose faster") or stop adding burn back into the target. Product/sales call — don't silently change.

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
