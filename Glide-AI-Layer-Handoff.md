# Glide — AI Layer Handoff (start-here for a fresh session)

_Last updated: end of Session 70. This is a quick-start digest; the authoritative,
blow-by-blow record is the **"Current state (built)" session log in `CLAUDE.md`
(Sessions 60–70)**. Read this first, then CLAUDE.md for detail._

---

## Where things stand: the AI layer is COMPLETE

Glide has a full conversational AI coaching assistant, live in production. Everything
below is built, deployed, and verified end-to-end:

- **Chat** — role-aware (client vs trainer), topic-restricted to health/fitness.
- **Reads real data** — "what did I eat this week?", "which clients haven't logged?"
- **Logs meals** — typed, **photo (vision)**, and a tappable **Accept/Edit card**.
- **Logs workouts & weigh-ins**, **sets targets/goal weight**, **sends client to-dos**.
- **Builds workout programs** — "dictate notes → AI drafts a program" (writes the weekly schedule).
- **Streams** replies word-by-word (SSE), with the callable as automatic fallback.
- **Prompt-cached** — ~half the cost, daily budget stretches ~4×.

**Design principle:** the AI's power = its **tools**. Every capability is one
contained, access-checked tool. A client can only ever touch their own data; a
trainer only their own verified clients (enforced **server-side**, not by the model).

---

## The code map

- **`functions/aichat.js`** — the two entry points + shared logic:
  - `aiChat` (onCall callable) and `aiChatStream` (onRequest, SSE) — share `setupChat`
    / `buildSystemPrompt` / `runToolRound`. The callable is the streaming fallback.
  - `logMeal` (onCall) — the Accept-card's direct write (no Anthropic call, Firestore only).
  - Role-based system prompts, daily token **budgets** (`BUDGETS`: trial 10k / client 25k /
    assisted 40k / trainer 60k), prompt **caching** (cache_control on the system block),
    usage accounting (`spent = input + output + cacheWrite`; cache reads ~free).
- **`functions/aitools.js`** — `buildTools(role)` + `runTool(name, input, ctx)`. All tools:
  `get_nutrition_log`, `get_nutrition_targets`, `list_clients`, `log_meal`, `propose_meal`,
  `log_workout`, `log_weigh_in`, `set_targets`, `send_client_request`, `list_exercises`,
  `set_workout_schedule`. Access enforced by `resolveTargetUid`. Mirrors the app's kv
  data model (`caliq-log-{plan}-{date}`, plan wrapper `caliq-{plan}` `{data,step}`,
  `caliq-plans` manifest, `caliq-requests`, `caliq-history-*`).
- **`functions/exercises.js`** — compact mirror of the frontend exercise catalog
  (52 cardio + 132 strength, id+label). **Extracted from `src/App.jsx`** — re-extract if
  CARDIO_GROUPS/STRENGTH_EXERCISES change.
- **`src/App.jsx`** — `AIChatPanel` (floating "✨ Ask Glide" → chat, via createPortal),
  `streamAiChat` (fetch + ReadableStream SSE), `callAiChat`/`callLogMeal`, `RichText`
  (bold + line breaks), photo helpers (`downscaleImage`/`imageBlockFromDataUrl`), the
  meal **proposal card**. Mounted in ClientHome (with `onDataChanged` refresh) and the
  trainer screens.
- **`glide-ai-meal-logging-spec.md`** — the original spec (mostly delivered).

---

## Infra essentials & hard-won gotchas (don't re-discover these)

- **Model:** `claude-sonnet-4-6` (Sonnet for cost, per spec — not Opus). Vision-capable.
- **Firebase project:** `calorieiq-29762` (never changes — it's in `VITE_FIREBASE_*`).
  Blaze is ON (Session 56). Functions in `us-central1`, Node 22, 2nd gen.
- **Anthropic key:** Secret Manager secret `ANTHROPIC_API_KEY` (NOT in repo / not VITE_).
- **Firebase CLI token expires** → `firebase login --reauth --no-localhost` (the plain
  localhost callback fails on this machine; the code-paste flow works). CLI is
  kevin@smoothtraining.com.
- **Org-policy invoker fix is DONE:** the project is under the smoothtraining.com Workspace,
  whose "Domain restricted sharing" org policy blocked public function access. Kevin granted
  himself **Organization Policy Administrator** and overrode that policy to **Allow All for
  the calorieiq project only**. Because of this, **new functions now bind the public invoker
  on create with no drama** (no repeat of the S61 saga). NOTE: `firebase deploy` only sets the
  invoker on **create**, not update — if an existing callable ever 403s on the browser
  preflight, `firebase functions:delete <fn>` then redeploy.
- **Function runtime SA** `350381584449-compute@developer.gserviceaccount.com` needs **Cloud
  Datastore User** (Firestore) — already granted. A `7 PERMISSION_DENIED` right after a fresh
  deploy is a transient cold-start service-agent race; it self-heals (re-test).
- **Deploy:** `firebase deploy --only functions:aiChat,functions:aiChatStream,functions:logMeal --project calorieiq-29762`.
  Backend-only changes need NO Vercel rebuild; frontend changes (src/) auto-deploy on push to `main`.
- **Rules-test Java** at `~/.glide-jdk` (Temurin 21) — for `npm run test:rules` (see CLAUDE.md Key commands).

## Cost / budgets (reassured + decided)
- The **daily token budget is a hard cost cap.** Max an assisted client (40k/day) can cost ≈
  **$0.24/day**, hard-blocked at 100% (80% shows a soft warning). Realistic use ≈ $1–3/user/mo.
- Prompt caching cut a tool-heavy batch ~58% and stretches the budget ~4×. **Kevin's call (S67):
  keep the 30-day trial as-is** — caching + the hard cap keep AI-during-trial cost safe.

## Testing approach
- Drive the **preview** signed in as the test accounts (memory `test-trainer-account`):
  - trainer: `trainer.uitest@calorieiq-test.com` / `TestPass123` (head_trainer, has Casey linked)
  - client: `client.uitest@calorieiq-test.com` / `TestPass123` ("Casey Client", assisted tier 40k)
- Callables need real Firebase Auth, so test via the actual app (not REST). Casey's daily AI
  budget may be exhausted from testing — test on the trainer, or wait for the UTC-day reset.
- Verify writes **independently through the app's own read path** (dashboard/Results/calendar),
  not just the AI's confirmation.

---

## Teed-up next items (nothing is blocking; pick what you like)

1. ~~**Stale-copy quick win**~~ **DONE — Session 70.** A trainer viewing a linked client's plan now
   **live-syncs** via Firestore `onSnapshot`: the open plan's structure (`data` — weigh-ins, targets,
   goal, AI-built workout program), today's log, and the activity feed update automatically when the
   client or the AI edits concurrently — no ↻ Refresh needed. `subscribeForUser` in `clientData.js`;
   the listener effect + a completed `reloadPlanLive` (now also reloads `data`) in `App.jsx`. Guards:
   skips applying snapshots during the trainer's own debounced edit (`saveTimer.current`) and ignores
   the trainer's own echoed write (`lastRemoteWriteRef`); advances the diff baseline so no phantom
   history. **The client's own ClientHome view got the symmetric treatment too** — it subscribes to its
   own account (`subscribeForUser(meUid, …)`) for the active plan, today's log, and `caliq-requests`, so a
   trainer/AI edit or a new to-do shows on the client's home instantly (echo-suppressed via three
   `lastSelf*Write` refs). Verified live both directions (trainer viewing Casey: log "0 → 450" live, goal
   172→165 live; client Casey: goal 172→160 live, requests 2 → 3 live, and her own calorie logging still
   persists and isn't reverted; no phantom history; no console errors).
   **The trainer dashboard summary cards are now live too** (`useClientLiveRefresh` hook): TrainerDashboard
   + TrainerAnalytics watch each connected client's active-plan history doc (changes on nearly every client
   action) and debounce-re-pull the summaries — so a client logging updates the cards with no manual reload.
   Verified live (TrainerDashboard card 186→180 lbs auto-refreshed; Coaching Dashboard "lbs lost" 16→12→10
   auto-refreshed). **Live-sync is now complete across every trainer/client surface.**
2. **AI calendar management (in-app)** — back-date logs, schedule workouts by weekday, review by
   date. Same tool pattern (overlaps the plan-builder). NOT external Acuity/Google sync (separate
   bigger project). _Kevin: do later when the time comes._
3. **Fuller AI-managed profiles** — conversational onboarding (fill stats/goals — NOT account
   creation, which is sensitive), plan management (switch active plan, start a cut phase), and
   eventually **proactive** coaching ("3 clients stalled, here's what I'd change").
4. **Plan-builder v2 polish** — a tappable program card (like the meal card) instead of the
   conversational confirm; AI-set personal stats/activity as part of onboarding.

## Remember: the AI is a LIVING system
Its behavior (system prompt) and abilities (tools) are fully ours to change/extend anytime, and
we can feed it Glide-specific knowledge (the spec's GI tables, Smooth Training methodology). Model
upgrades = a one-line change as Anthropic ships better models. Each new ability is one contained,
access-checked tool — add incrementally, test, ship.
