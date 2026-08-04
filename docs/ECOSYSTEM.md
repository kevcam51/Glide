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

---

## ⚠️ Kevin's refinement (S176e, Aug 2 2026) — read before using the surfaces below

**The bridge is coexistence, not connectivity.** Kevin: the other platforms do
NOT need to connect to Glidna. The value is that a trainer or client benefits
from having their existing platform AND Glidna side by side — what we built
works hand-in-hand with whatever they already run, as a **sidekick** to it.
Connectivity comes "way down the road, once our brand becomes a clear benefit
to all of these other companies."

Practical meaning: pitch and design for *"keep what you use, add Glidna
beside it"* — never *"integrates with"*. The surfaces below are the future
accelerants, not the strategy; nothing in the sidekick play requires a single
one of them. (Paste-from-AI and type-in-your-watch's-burn are the pattern:
zero-integration bridges that already ship.)

## Verified integration surfaces (S176, Aug 2 2026 — web-researched, per-platform confidence noted)

_This is the "verified, cited report" the line above asked for. Openings ranked by how real they are today._

### Coach platforms
| Platform | Surface (verified) | The complement play |
|---|---|---|
| **Everfit** | Public REST API, read+write, webhooks (HIGH confidence — official docs) | The realest partner opening in the set: new client there → AI nutrition profile here, insights flow back |
| **TrueCoach** | 15-field client CSV export + Zapier read/write; API keys exist but undocumented (MED) | One-click roster import; be the AI/nutrition layer they lack |
| **PT Distinction** | Zapier app verified (add client, assign package); raw API unverified (MED) | Zapier handoff automation |
| **My PT Hub** | Nothing verifiable publicly (LOW) | Paste/CSV import only |
| **Trainerize** | Already built (private-token importer: profiles, meals, wearables, workouts) | The proven pattern the others should follow |

### Nutrition apps — all bridges here are IMPORT-shaped (their exports → us)
| Platform | Surface | The complement play |
|---|---|---|
| **MyFitnessPal** | Partner API CLOSED to new requests; Premium-only CSV diary export | Accept the CSV; day totals already flow via Trainerize |
| **Cronometer** | User CSV export incl. PER-FOOD servings + biometrics | Import it — Glidna becomes the analysis/coaching layer over their logging |
| **MacroFactor** | Quick + Granular CSV export (emailed); no API | Same — plus trainer oversight over their expenditure data |
| **Cal AI** | No API; syncs to Apple Health/Google Fit | Reachable only via a future native Health app |

### Loggers & wearables — the only real WRITE paths outside AI directories
| Platform | Surface | The complement play |
|---|---|---|
| **Strava** | Free API, read+WRITE (activity upload); review past 10 athletes | Post Glidna cardio to Strava; read activities as verified burn for eat-back |
| **Hevy** | API read+write but requires the USER's Hevy Pro sub | Push AI-built Glidna programs in as routines; pull logged sets back for coach review |
| **Whoop** | Free self-serve API, OAuth + webhooks, READ-only | Recovery/strain tunes daily calorie + training-load targets |
| **Oura** | OAuth2, READ-only, >10 users needs approval | Readiness gates hard training days; under-recovery flags to trainers |
| **Strong** | CSV export only, no API | Accept the upload |

### AI distribution channels
| Channel | Surface | Note |
|---|---|---|
| **ChatGPT apps** | Apps SDK = MCP; FREE listing; verified developer identity required (HIGH) | Glidna's existing MCP tools are listable — first writable fitness app there |
| **Claude connectors** | Free remote MCP; directory submission needs a Team/Enterprise org | Directory previously skipped (no Team org, S-era decision); invite-link distribution works today |
| **Apple Health** | Needs a native iOS app ($99/yr + App Review), read+write per-type | The single biggest data source in fitness; unlocks Cal AI users too |

**Shape of the whole map:** bridges into coach platforms and nutrition apps are
import-shaped (their exports/CSVs → us) because almost nobody accepts writes;
the genuine write paths are Strava, Hevy, and the AI directories — which is
where "first writable fitness connector" does its work.
