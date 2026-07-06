# Glide — Ecosystem Vision & Fitness-Platform Landscape

_Kevin's vision, stated end of Session 88 (July 2026). This is standing product strategy —
read it when scoping any integration or partnership work._

## The vision (Kevin's words, lightly edited)

> Glide must be **great as a standalone**, but it **fully thrives when other platforms work
> with Glide**. The goal: become something **all other platforms WANT their users — trainers
> and clients alike — to have, because it makes THEIR product better.**

Implications for how we build:
- **Standalone first.** Every feature must be complete without any integration (the AI coach,
  logging, plans, targets all run on Glide's own data — this is already the architecture).
- **Integrations are additive, never load-bearing.** If a partner API breaks or a platform
  blocks us, Glide keeps working (the Trainerize design proved the pattern: their data enriches
  Glide; nothing in Glide calls them at usage time).
- **Be the layer that makes other tools better**, not the tool that replaces everything.
  A Trainerize coach with Glide serves clients better; a MacroFactor user with Glide gets a
  coach on top of their tracker. That's why platforms should welcome us instead of blocking us.
- Existing pillars of this strategy: the **Trainerize connector** (S84–88), **"Glide works with
  your AI"** (docs/AI-INTEROP-VISION.md — paste-import shipped; MCP connector is the endgame),
  and the source-agnostic wearable layer (S88c).

## The landscape (knowledge snapshot, July 2026 — verify with web research before acting)

### Trainer/coach platforms — future "import your clients" connectors (like Trainerize)
TrueCoach · Everfit · TrainHeroic · My PT Hub · PTminder · Exercise.com · FitBudd.
Each importable platform = a recruiting hook ("switch to Glide, bring everything"). API access
varies; platforms without APIs fall back to CSV / AI paste-import (already shipped).

### Nutrition trackers — where clients already log food
- **MyFitnessPal** — biggest; per-food data CLOSED to third parties (confirmed via Trainerize:
  day totals only). Day-total sync already works through Trainerize.
- **Cronometer** — partner API exists; detail-oriented users.
- **MacroFactor** — fast-growing, adherence-based algorithm; study its math.
- Lose It! · Carbon Diet Coach · RP Diet (algorithmic coaching — our AI does this
  conversationally; theirs is menu-driven).

### Workout loggers — self-directed lifters
Strong · **Hevy** (has an API) · Fitbod (auto-programming) · JEFIT · Caliber · Ladder
(programs-as-content business model worth studying).

### Wearables & health platforms
- Already flowing THROUGH Trainerize: Garmin, Fitbit, Apple Watch (calorieOut + steps, S88c).
- Direct routes later: **Strava** (free API, runners/cyclists), Fitbit + Garmin (own OAuth
  APIs), WHOOP + Oura (recovery, APIs available).
- **Apple Health needs a NATIVE iPhone app** — a future App Store wrapper unlocks the single
  biggest data source in fitness. Long-term map item. (Terra aggregator: rejected — $399/mo.)

### Business tools (Kevin already runs these)
Acuity (scheduling) · Stripe (billing — next major build) · Mindbody/Calendly as later
scheduling-integration peers.

## Strategic read
Every tool above is one of:
1. a **data source** (integration target — Trainerize pattern),
2. a **feature teacher** (MacroFactor adherence, Fitbod auto-programming — absorb into our AI),
3. a **migration pool** (coaches/clients on platforms with weaker AI).

Next research step when Kevin asks: a verified, cited report — which have workable APIs today,
pricing, growth trajectories — via a web-research pass.
