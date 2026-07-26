# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Progressive web app (Vite + React), installable to the home screen. Phone-first —
most real use is one-handed on a phone, often mid-workout or standing in a kitchen —
but must hold up on desktop, where trainers do roster work.

## Users

**Two primary audiences, held to the same quality bar** (confirmed: neither subordinate
to the other; the app deliberately maintains two design registers).

- **Personal trainers** — running a coaching business. Situation: between sessions, on a
  phone, or at a desk doing weekly roster review. Job: see who is off track, adjust plans,
  log on a client's behalf, keep clients accountable, and get paid. Some run a **team**:
  a head trainer with sub-trainers under them, each carrying their own clients.
- **Clients** — everyday people, not fitness experts. Situation: about to eat, just
  weighed in, or finishing a workout; distracted, in a hurry, often one-handed. Job: log
  what they ate or did without friction, and see whether they are on track.

Kevin Cameron (Smooth Training, Miami) is both the product owner and the flagship
trainer — the app is proven against his real coaching business first.

## Product Purpose

Nutrition + fitness planning that a trainer and their client genuinely share: one plan,
one set of numbers, editable from both sides. It exists because coaching today is split
across Trainerize, Acuity, Stripe, and a spreadsheet, and none of them talk to each other.
Success is a trainer running their whole practice here, and a client logging without
thinking about it.

The longer arc: a Shopify-style platform independent trainers white-label under their own
brand.

## Positioning

Three claims a neighboring product cannot truthfully copy today:

1. **Shared plan, both sides.** Trainer and client edit the same live plan and daily log,
   with real-time sync and an activity feed — not a coach dashboard bolted onto a
   consumer tracker.
2. **Works with your AI.** Glidna is an MCP connector, so a user drives their own Claude
   ("log my lunch", "who's stalled this week?") against their real Glidna data. As of
   Jul 2026 exactly one fitness app ships an official MCP connector (Strava, read-only,
   paid) — no coaching platform ships any.
3. **The AI can actually do the work**, not just answer: log meals from text/photo/voice,
   build workout programs, set targets, onboard a client by conversation.

## Operating Context

- Existing business tooling Glidna complements and is replacing: **Trainerize** (coaching
  delivery — imports roster, meals, workouts, wearables), **Acuity** (scheduling),
  **Stripe** (payments; live, incl. per-session billing with card-on-file).
- Wearables reach Glidna through Trainerize (Garmin verified: resting/active calories,
  steps).
- Roles: `client`, `sub_trainer`, `head_trainer`, `admin`. Teams are capped at two levels.
- Clients link to a trainer with a short invite code; trainers keep local plan files and
  simulations alongside connected client accounts.
- Real usage is phone-first and frequently offline-ish (gym basements, kitchens).

## Capabilities and Constraints

**Confirmed capabilities:** daily food/water/weight logging; food database search
(FatSecret primary, USDA, Open Food Facts) + barcode scanning + AI estimation; meal
logging by text, photo (vision), or voice; body measurements with body-fat estimates
(caliper/tape/scanner) and a Lee-2000 muscle-mass estimate; weight, muscle, fat, lean and
body-fat trend charts; workout programming (cardio + strength, custom exercises,
heart-rate-based cardio via Keytel); calendar with back-dating; trainer dashboards
(roster, needs-attention, earnings); DMs; push notifications; Stripe subscriptions and
per-session billing; passkey sign-in; MCP connector with OAuth.

**Deliberate product decisions (do not re-flag in critiques):**
- The **raw calorie quick-add stays** (confirmed S117): it serves self-estimators who only
  track calories, and doubles as a what-if instrument — entering specific daily/weekly
  intakes to model outcomes. It is not a data-quality accident.
- **Over-target states get an amber grace band**: up to 10% over target renders amber
  ("close enough — no shame"); red is reserved for meaningfully over. Never red at +1 cal.
- A future **compliance tracker** (how consistently the user hits their calorie goal,
  fused with burn, projecting time-to-goal) is the intended replacement for leading the
  daily screen with weight — and it must be **hideable by the user or trainer** (some
  people don't want numeric success-tracking).

**Constraints that shape design:**
- Calorie, macro, body-fat and muscle numbers are **estimates from published formulas**
  (Mifflin-St Jeor, Bailey/Navy, Jackson-Pollock, Keytel, Lee 2000). They must be
  presented as estimates with their basis available — never as measurements.
- Two calorie philosophies coexist and must both stay legible: **eat-back** (exercise
  raises today's target) vs **accelerate** (exercise speeds the goal date).
- Local dates, never UTC: a day's log belongs to the user's local day.
- The main UI is one very large React file mixing two styling systems — Tailwind + brand
  tokens on newer screens, an older CSS-variable block on the in-plan screens. Both
  render on-brand; refactoring is not a prerequisite for design work, and **working UI is
  never broken merely to restyle it.**

**Explicitly undecided:** whether the MCP connector is gated to paid tiers at launch
(leaning Premium/Max with a free read-only taste); legal review pending on the training
waiver, session-billing terms, and AI-connector privacy language.

## Brand Commitments

- **Name:** Glidna. Wordmark is two-tone — `GLI` in brand cyan, `DNA` in the foreground
  color. Never emoji-substituted, never restyled per screen.
- **Colors:** near-black surfaces + brand cyan `#08DCE0`, sampled from the Smooth Training
  logo. Light and dark themes both ship and both must stay legible — **no color may be
  hardcoded such that it breaks in one theme.**
- **Type:** Sora for display/headings, DM Sans for in-plan body copy.
- **Iconography:** the house icon set in `src/icons.jsx`. **New features use these icons,
  never emoji** (a standing rule).
- **Voice:** plain English over jargon. The app teaches rather than assumes — "The one
  number that matters", "The fancy words, translated". Encouraging without being cute;
  never shames a missed day.

## Evidence on Hand

- A real coaching business (Smooth Training, Miami) with real clients, real Trainerize
  data, and live Stripe revenue — the app is dogfooded daily.
- Measured AI cost data and competitor pricing research in `docs/PRICING.md`;
  connector market research in `docs/MCP-CONNECTOR.md`.
- **Absences future work must not fabricate:** no testimonials, no user counts, no press,
  no case studies, no benchmarks, no third-party endorsements. Do not invent client names
  or before/after results — the test accounts (Casey Client, etc.) are fictional fixtures,
  not customers.

## Product Principles

1. **Credible first, always.** This is health and money. Numbers are honest, estimates are
   labeled as estimates, and nothing overpromises. Trust is never traded away — when
   credibility collides with speed or magic, credibility wins.
2. **Effortless in the daily loop.** Logging food, weight and workouts must be fast enough
   to do while distracted. Within the credibility floor, speed beats completeness on the
   surfaces people touch every day.
3. **AI as the signature layer, not the foundation.** Conversation, photo and connector
   access are what make Glidna different — layered on top of a trustworthy base, never a
   replacement for a working manual path. Anything the AI can do must also be doable by hand.
4. **Two registers, one product.** Client surfaces are calm, simple and encouraging;
   trainer surfaces are dense, fast and powerful. Both are held to the same craft bar;
   neither is a stripped-down version of the other.
5. **Never break working UI to improve it.** The app is in daily production use by real
   paying clients. Refinement preserves behavior; restyling is not a reason to regress.

## Accessibility & Inclusion

**Committed standard: WCAG 2.2 AA.**

- 4.5:1 contrast minimum on body text (3:1 for large text and meaningful UI boundaries),
  in **both** light and dark themes.
- Minimum 44×44px touch targets — the app is used one-handed, in a hurry, sometimes with
  sweaty hands.
- `prefers-reduced-motion` honored (already implemented app-wide).
- Visible focus states and full keyboard navigability on desktop trainer surfaces.
- Real form labels; never placeholder-as-label.
- Never encode meaning in color alone — over/under target, on-track/off-track and
  goal-direction states need a word or icon as well as a hue.
- Audience note: clients are not fitness experts and are frequently distracted; trainers
  may be reviewing a roster at speed. Neither should have to decode jargon or hunt for the
  primary action.
