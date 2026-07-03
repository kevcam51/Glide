# Fitness-tracker integration — plan

_Kevin's ask: pull **general activity (cardio/strength/type) + calories burned** from clients' fitness
trackers to feed progress. Full detailed metrics are a **future** goal; for now, activity type + calorie
burn is enough. Plus a **"tracker override"** toggle so an uploaded workout can replace a prescheduled
Glide workout's calories + title (per modality). Priority: burn number + activity type._

## Architecture decision: use a UNIFIED wearable API (don't integrate each device separately)
Integrating Fitbit, Garmin, Oura, Whoop, Strava, Google Fit, Apple Health each on their own = 7+ separate
OAuth apps, data schemas, and approval processes (Garmin/Whoop approvals are slow). Instead, use a
**"Plaid for wearables"** aggregator — ONE integration covering 500+ devices with a **normalized schema**
+ webhooks:
- **[Terra](https://tryterra.co)** (recommended) — 500+ providers, consistent schema, webhooks/streaming,
  **free monthly credits** then ~$0.005/credit. Web **Connect widget** (OAuth redirect) for
  Fitbit/Garmin/Oura/Whoop/Strava/Google Fit — **no native app needed**. Apple/Samsung Health need their
  mobile **SDK** (→ a later native/PWA wrapper).
- Alternatives: **[Vital](https://tryvital.io)**, **Rook** — similar model.

**Why this fits Glide:** small team, we're a **web app** (Vercel + Firebase), and we already have the
backend pattern (Cloud Functions + secrets + webhooks like Resend). One integration = broad coverage now,
Apple Health later when we add a native wrapper. Matches the "web-OAuth wearables first, Apple Health via
native later" call from `SECURITY-TRUST.md`/earlier notes.

## Data flow
1. **Connect:** a "Connections" screen in Glide opens Terra's Connect widget → client authorizes their
   device → Terra returns a `terraUserId` we store on the client's profile.
2. **Receive:** Terra sends **webhooks** (workouts/activity/daily) to a new Cloud Function `terraWebhook`
   (verify Terra's signature). Each workout gives us **type** (running/cycling/strength/…), **calories
   burned**, **duration**, **start time**.
3. **Map into Glide:** normalize Terra's activity type → our cardio/strength bucket; store per-day
   `caliq-log-{plan}-{date}` a `trackerWorkouts[]` (source, type, title, calories, duration) + fold the
   **calorie burn** into the day's expenditure used for progress/TDEE.
4. **Display:** show tracker workouts on the dashboard/calendar with a source badge (e.g. "via Garmin").

## The "tracker override" toggle (Kevin's design)
Per-plan setting `data.trackerOverride` (default off). When ON and a tracker uploads a workout for a day:
- **Strength** tracker workout → replaces that day's **scheduled strength** title + calories.
- **Cardio** tracker workout → replaces that day's **scheduled cardio** title + calories.
- Modality-matched (strength overrides strength, cardio overrides cardio); the other modality's scheduled
  work stays. When OFF, tracker workouts are **added alongside** the scheduled plan (no replace).
- Works for both the client (their own connection) and a trainer viewing the client.

## Security (per SECURITY-TRUST.md)
- Terra API key = **Secret Manager** (never in repo/browser). `terraUserId` on the profile is not
  sensitive, but the webhook must **verify Terra's signature** and only accept known users.
- Each client connects their **own** device; Glide only ever sees that client's data.

## Build phases
1. **Terra account + keys** (Kevin) → secrets. Pick the first device(s) to support (Garmin/Fitbit/Strava
   are common + web-OAuth).
2. **`terraWebhook` Cloud Function** — verify signature, map workouts → `caliq-log` per day.
3. **Connections screen** — Terra Connect widget + store `terraUserId`; disconnect option.
4. **Display** tracker workouts + burn on dashboard/calendar with source badge.
5. **Override toggle** (`data.trackerOverride`) + the modality-matched replace logic.
6. **Later:** Apple/Samsung Health via Terra's mobile SDK (needs a native/PWA wrapper).

## What we need from Kevin before building
- Create a **Terra** (or Vital) account → dev API key + signing secret (stored as secrets, like Resend).
- Confirm **which devices** to enable first (recommend Garmin + Fitbit + Strava — broad, web-OAuth).
- Confirm the aggregator approach + that a small per-user cost is acceptable (free tier covers early usage).

**Status: PLAN only — not started. Needs Kevin's Terra account + go-ahead on the aggregator approach.**
