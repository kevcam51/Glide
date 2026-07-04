# Glide — Next-Session Handoff (start here)

_Updated mid-**Session 84** (big session: calendar, food DB, AI food gating, barcode, email live,
PWA, nav fixes). Read this first, then `CLAUDE.md` (standing context) + the `docs/` files noted below.
Everything is pushed to `main` and live on Vercel unless noted. Firebase project `calorieiq-29762`;
prod URL `calorieiq-jet.vercel.app`. Model `claude-sonnet-4-6`._

---

## ⏭️ DO NEXT — Trainerize importer (IN PROGRESS, just starting)
Kevin wants this next. It migrates a trainer's clients **and** pulls their wearable **calories-burned**
(`healthData.calorieOut`) for free — which is why we're NOT paying for Terra (see Decisions).
- **Full API reference + plan: [docs/TRAINERIZE-API.md](docs/TRAINERIZE-API.md)** (endpoints, 1000/min
  rate limit, multi-tenant BYO-token design, security).
- **Build path:** a Cloud Function (`functions/trainerize.js`) with the **Group API token as a Secret**
  (like RESEND/ANTHROPIC — Kevin sets `TRAINERIZE_TOKEN` via `firebase functions:secrets:set`, never in
  chat/repo). Read-only importer: `getClientList` → per client `getProfile`/`bodystats`/`goal`/
  `dailyNutrition`/`program`/`healthData.getList(calorieOut)` → map into Glide's schema
  (`data`, `checkIns`, `caliq-log-{plan}-{date}.meals[]`, `data.cardio`/`strength`, a per-day burn).
  Throttle < 1000/min, page per client, dedupe on re-import, label imported source.
- **⚠️ DO FIRST with Kevin:** get the **Trainerize Studio Group API token**, confirm what it can read,
  set it as a secret, THEN build + deploy + test with his real data. (Kevin has a Studio account.)

## Also queued (Kevin's order): AI-edits-local-plans → biometric login
- **AI editing local profiles + simulations** (not just connected clients) — extend the AI tools to
  target a trainer's own local plans/sims so plans can be prepped by chat. Medium build.
- **Biometric login (Face ID/Touch ID via passkeys/WebAuthn)** — last security item. Medium build.
- **Auto sign-out on idle** — quick; do alongside biometrics.

## Decisions locked this session (don't re-litigate)
- **Terra: PAUSED — do NOT pay.** Quick Start is $399/mo; "Enterprise/custom" ≠ free (sales contract,
  possible minimum). Even if free, an unused integration is a liability. **Use Trainerize's free
  `calorieOut` for wearable data now**; revisit Terra only at real scale / for non-Trainerize clients.
  The Glide-side wearable work (store "calories burned/day", an **override toggle** so a tracker workout
  overrides a scheduled Glide one per-modality, show on progress) is **source-agnostic** — build once,
  feed from Trainerize now.
- **OpenAI transcription is NOT broken.** Whisper is billed **per second of audio, not tokens**, so
  OpenAI's "tokens" always shows 0. Verified the key works (live test, HTTP 200). Current setup:
  **Groq primary (fast) + OpenAI fallback (works, payable)** — exactly what we want.
- **Name change: still open.** Full research in [docs/NAMING.md](docs/NAMING.md). Top clean+available
  pick is **Slydra** ("SLY-druh", all domains free) but Kevin's lukewarm; one-syllable is exhausted.
  Not decided — rename is a text-swap across the app (colors unchanged; Firebase id stays).
- **AI "precise food data" (search_food, real DB values) is a Pro upsell** — server-gated by
  entitlement (`subscriptionStatus:"active"` OR `entitlements.foodAccuracy:true`) + a chat toggle; free
  users get AI estimates. Grant a test acct the entitlement to demo. (src/profile.js `isProUser`.)

## What shipped in Session 84 (all live)
- **Calendar:** client **start date** (= signup) — days before it are neutral (never "missed"); Day view
  now full dashboard parity — quick **add + reduce** calories, typed entry (+ meal type / "just
  calories"), and **water** logging.
- **Food DB:** USDA (Kevin's `VITE_USDA_API_KEY` live) **+ Open Food Facts** (free). **Barcode scanner**
  = live camera via **@zxing/browser** (works iOS Safari + Chrome), **auto-fills the product's single
  serving size** + a **g/ml** toggle.
- **AI:** `search_food` tool (USDA+OFF) — **Pro-gated** (see Decisions) + chat toggle w/ upsell.
- **Email invites LIVE:** Resend domain **`send.smoothtraining.com` verified** (SPF+DKIM+DMARC in
  Squarespace), sender `invites@send.smoothtraining.com` (+ plain-text/reply-to for deliverability).
  First sends may hit spam (new-domain reputation) → "Not spam" trains it.
- **Nav/UX:** phone **Back button closes overlays** (calendar/menu/chat/hub/modals) instead of leaving
  the app (`useBackClose` hook); **Sign out** is now a prominent, reachable bordered button.
- **Voice:** **Groq** primary transcription (fast), 60s cap with a visible **countdown**.
- **PWA:** installable home-screen app (`manifest.webmanifest`, `sw.js`, icons via `npm run gen:icons`,
  apple meta). Dismissible **"Install Glide"** prompt (auto-hides once installed). Header now clears the
  **notch/safe-area** so the title is fully visible in the installed app.
- Docs added: `TRAINERIZE-API.md`, `SECURITY-TRUST.md` (shareable customer trust page), `NAMING.md`,
  `VIDEO-LINK-INGEST.md` (Phase 1 shipped earlier).

## Gotchas (still true)
- **A background process also commits/pushes here** — `git fetch` + check `origin/main..HEAD` before
  assuming state; commit promptly. Memory `concurrent-git-commits`.
- **Deploy ALL 4 AI functions when `functions/aitools.js` changes** (aiChat, aiChatStream, logMeal,
  setWorkoutSchedule). Other fns: `sendInvite` (Resend), `transcribeAudio` (Groq/OpenAI), plus the AI set.
- **Firebase token expires** → `firebase login --reauth --no-localhost`. Secrets: set via
  `printf 'val' | firebase functions:secrets:set NAME --data-file=-` (avoids the masked prompt).
- **`src/App.jsx` ≈ 13k lines**; `css` block is a JS template literal. `npm run build` before commit.
  Push to `main` auto-deploys Vercel; **Cloud Functions need explicit `firebase deploy`** (not via push).
- Test accounts: trainer `trainer.uitest@calorieiq-test.com` / client `client.uitest@…` (Casey),
  `TestPass123`. Drive the preview signed-in for AI/callables.
