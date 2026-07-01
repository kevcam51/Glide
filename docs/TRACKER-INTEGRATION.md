# Fitness / meal tracker integration — design notes

_Captured from Kevin (Session 84). This is the agreed design for a FUTURE build — nothing here is
implemented yet. It records the priorities + the "override" behavior so we build the right thing._

## Priority (deliberately narrow for v1)

We do **not** need exact/rich data from wearables yet. For v1 we only need, per activity:
- **General type** — cardio vs strength (a coarse category is enough).
- **Calories burned** (the number).
- (Nice-to-have) the activity **title** from the tracker.

Why: the burn number is what feeds a client's **progress + success projection** (it adjusts their
energy balance / TDEE and their adherence picture). Rich per-set/heart-rate data is later.

## The override problem + the toggle

A client can have a **prescheduled Glide workout** (e.g. 30 min strength + 30 min cardio, each with an
estimated burn). If a **fitness tracker also uploads** a workout for that day, we must not **double-count**
the calories.

**Design: a per-user (or per-plan) "Fitness tracker override" toggle.**
- When **ON**: a tracker-uploaded workout **replaces** the matching Glide-scheduled workout **by
  modality** — a tracker **strength** workout overrides the Glide **strength** entry (its calories +
  title), and a tracker **cardio** workout overrides the Glide **cardio** entry. The unmatched modality
  keeps its Glide value. (So: tracker strength + Glide cardio → use tracker strength burn + Glide cardio
  burn.)
- When **OFF**: keep the Glide-scheduled workout as the source of truth; tracker data is shown but not
  substituted (or is ignored for the burn total) — TBD which, but it must not double-count.
- Applies to both the **trainer** and the **client** (either can set it).

Open detail: matching is by modality (cardio/strength). If a tracker uploads BOTH a strength and a
cardio session, each overrides its own modality. If it uploads two of the same modality, sum them and
override that modality's Glide entry.

## What's actually required to build it (the real work)

This is bigger than the food-DB work — it needs server-side integration (we have Blaze):
1. **Provider connections (OAuth).** Web-OAuth wearables first — **Fitbit, Garmin, Strava, Whoop, Oura**
   — they expose activity + calories burned + weight via web APIs, doable on our current stack (Cloud
   Functions). **Apple Health** (no cloud API) and **Google Health Connect** need a **native companion
   app** — later milestone.
2. **A "Connections" screen** — connect/disconnect buttons per provider, and the **override toggle**.
3. **Sync** — webhook or polling Cloud Function that pulls each day's activities (type + burn + title).
4. **Normalization/mapping** — map a provider activity → our model: cardio/strength + `burned` calories,
   written into the day's check-in / workout so it flows into the dashboard, calendar, and progress calc.
5. **Dedup + override logic** — apply the toggle above so tracker data replaces (not adds to) the
   matching Glide-scheduled modality; label imported entries with their source.
6. **Food from other apps** — most (MyFitnessPal, etc.) have **closed APIs**, so we rely on our own
   **food-database search + paste-import**, not a live sync.

## Recommended sequence (when we pick this up)

1. One provider end-to-end (Strava or Fitbit) — connect → pull activities → map burn/type → show it →
   apply the override toggle. Prove the whole pipeline on one integration.
2. Add the other web-OAuth wearables (they're variations on the same pattern).
3. Apple Health / Google Health Connect via a native wrapper — separate, larger effort.

**Status: NOT started — this doc is the spec for later.**
