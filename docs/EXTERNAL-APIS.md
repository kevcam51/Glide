# External APIs, marketplaces & the exercise-demo plan

_Written S97 (Jul 2026) after Kevin asked whether RapidAPI is safe, what it costs,
and how an exercise database could improve Glidna. Reference doc — nothing here is
built yet._

---

## 1. RapidAPI — safe, but only under rules

**What it is:** a marketplace/proxy. You subscribe to a third-party API through
RapidAPI, they issue you one key, your requests route through *their* gateway to
the API author, and they handle metering + billing.

**Is it safe?** Legitimate and long-running. The risks are practical:

| Risk | Mitigation |
|---|---|
| Key leaks if it's in the browser bundle | **Server-side only** — Secret Manager + Cloud Function, exactly like `ANTHROPIC_API_KEY` / `FATSECRET_*` / `STRIPE_SECRET_KEY` |
| Your request data passes through Rapid's proxy | Never send client PII/health data through it. Static lookups (exercise names) only |
| API authors are often solo devs — uptime/quality/legality varies | Prefer official or open-source sources; cache aggressively so an outage can't break us |
| **Overage is automatic with no hard stop** | Alerts fire at 85%/100% but their docs warn "speed may prevent timely delivery" — we must enforce our OWN cap in the function |
| Unofficial wrappers may scrape a service they don't own | Check that the listing is the official provider before relying on it |

### How billing actually works
1. Subscribe to a specific API's plan with a card (billing is **per-API**, not one flat RapidAPI fee).
2. Receive an `X-RapidAPI-Key`; send it as a request header.
3. Every call is metered against the plan's monthly quota.
4. Past quota, **per-request overage bills automatically**.
5. RapidAPI also takes **25% of revenue** from API *sellers* (+2.9% + $0.30 processing) — baked into buyer prices.

**Shape of the cost** (illustrative, varies per API): a tier includes N requests
for $X/mo, then ~$0.001–$0.01 per extra call. Example: plan includes 500 calls at
$10/mo, $0.01 overage → 600 calls = **$10 + $1 = $11**.

⚠️ ExerciseDB's free tier on RapidAPI is now **~10 requests/day** — effectively
unusable for real work, so any real use means a paid tier.

---

## 2. Alternatives (saved for future use)

### If we want a marketplace
| Option | Why consider it |
|---|---|
| **Postman API Network** | Free listing, 40M+ devs, no revenue share |
| **APILayer** | Broad catalog, cleaner unified billing |
| **Zyla API Hub** | Closest direct competitor to Rapid |
| **Apify** | Turns any site into an API (scraping/automation focus) |
| **Kong Konnect** | Self-run gateway + portal; you own billing, keep 100% |
| **AWS / Azure / GCP Marketplace** | Consolidates into existing cloud billing + governance |

### Going direct (usually better for us)
- **Nutrition/food** — already direct: **FatSecret** (own proxy VM), **USDA FoodData Central**, **Open Food Facts**. No marketplace needed.
- **Wearables** — **Terra API**, or **Apple Health** / **Google Health Connect** natively. (Today we get wearable data via Trainerize.)
- **Exercise data** — see §3.

---

## 3. Exercise database — the real opportunity

### The candidates
| Source | License | Contents |
|---|---|---|
| **Free Exercise DB** (yuhonas) | **Public domain** ✅ | ~800 exercises + images |
| **exercisedb-api** (open source) | Open source | 11,000+ exercises, video/GIF/images, step-by-step |
| **wger** | Catalog **CC-BY-SA 4.0** ⚠️ | Full REST API, self-hostable |
| **exercisedb.dev / AscendAPI** | Direct (paid) | Hosted, skips Rapid's markup |

⚠️ **wger is share-alike**: commercial use is fine *with attribution*, but derivative
**datasets** must be published under the same license. For a commercial SaaS that's a
real constraint. **Free Exercise DB is public domain — no attribution, no strings** —
so it's the safest starting point. (Same licensing diligence we applied to the icons;
see `CREDITS.md`.)

### ⛔ The critical technical catch — READ BEFORE BUILDING
**Our exercise list is NOT replaceable.** Every one of our ~184 exercises carries a
**MET value**, and MET drives the entire calorie-burn engine (`exBurn`, the wizard's
weekly burn, `weeklyPlanBurn` server-side, the eat-back target, projections). Third-party
exercise databases ship demos, instructions and muscle groups — **but not METs.**

So the correct integration is an **enrichment layer, not a replacement**:

> Keep our curated 184 exercises + MET values as the source of truth.
> Match them to the external DB **only** to attach a demo GIF, instructions,
> and muscle-group data.

Swapping in an 11,000-exercise catalog wholesale would silently break calorie math
and bury a curated list in unvetted noise. More exercises is *not* better here.

### What it unlocks (the product win)
Today we list "Barbell Bent-Over Row" with **no visual instruction at all** — a client
training alone has no idea what good form looks like. Adding demos would give us:
1. **Form demo (GIF/video) per exercise** — the big one; closes our largest gap for
   clients following a plan without the trainer present.
2. **Step-by-step text cues** — pairs naturally with the AI coach.
3. **Primary/secondary muscle data** — could power a real "muscle balance" view
   (are we hitting everything?), complementing the existing Muscle tab.
4. **Custom-exercise creation** — users building their own exercise could search the
   catalog for a demo + icon (ties into `CUSTOM_EX_ICONS`).

### Cost to actually do it: ~$0
Exercise data is **static**. We'd fetch each exercise **once**, cache the media in
Firebase Storage, and serve our own copy forever.
- One-time: ~1,300 fetches (a single month of any paid tier would cover it — or $0 with the public-domain dataset).
- Storage: ~1,300 × ~1.5 MB GIF ≈ **2 GB ≈ $0.05/mo** ($0.026/GB).
- Bandwidth: ~$0.12/GB — e.g. 100 users × 30 demo views × 1.5 MB ≈ 4.5 GB ≈ **$0.54/mo**.
- Convert GIF → **WebP/MP4** to cut both by roughly an order of magnitude.

**Conclusion: paying a marketplace markup for static data we fetch once makes little
sense. Self-host the public-domain set.**

### Prototype results (S97, tested live)
Kevin asked to SEE it. Built a live prototype in the preview: 4 of our exercises
(Bench Press, Bent-Over Row, Squat, Deadlift) rendered with Free Exercise DB's
photo pairs animated at ~850 ms (start ↔ end position reads as the movement),
target-muscle badge, numbered form cues. **It looks real** — actual gym
photography, pro-quality instructions.

**Measured auto-match rate vs our list:** 132 strength exercises → 73 strong +
19 partial = **~70% automatic**; the 40 misses are mostly naming variants
("Dumbbell Chest Press" vs their "Dumbbell Bench Press", "Skull Crushers" vs
"Lying Triceps Press") that a one-time human-reviewed synonym pass resolves →
realistic coverage **~90%+**. Kevin's direction: keep TWO libraries — ours stays
the calorie/MET engine; a separate client-facing workout library (demos, cues)
comes later. **Not a priority right now** — this section is the saved plan.

### Suggested build order (when we pick this up)
1. Pull the Free Exercise DB JSON; **fuzzy-match its names to our 184** (one-time
   mapping pass, human-reviewed — names differ, e.g. "Barbell Bent-Over Row").
2. Store the mapping as `demoId` on each exercise; leave METs untouched.
3. Cache media to Firebase Storage (convert to WebP/MP4), serve our own URLs.
4. UI: a "How to do this" control on an exercise → demo + cues.
5. Only then consider expanding the catalog — and if we do, **new exercises need MET
   values assigned** or their burn math is wrong.

---

# Part 2 — API opportunity report (deep research, S97/Jul 2026)

_13-agent research pass over fitness + non-fitness APIs; every pricing claim adversarially_
_re-verified against vendor sites (2 verify agents died mid-run — their claims kept but
flagged lower-confidence: weather + food-nutrition groups). Decision-ready; nothing built._

# Glidna API Opportunity Report — Decision Summary

Synthesized from verified vendor-pricing research (Jul 2026). Costs are as-verified; anything uncertain is flagged. Ordered for a cost-conscious, Cloud-Functions-proxied, PWA-first stack.

---

## 1. Top 10 by value-per-effort

| # | Opportunity | What it does for Glidna | Pricing (honest) | Effort |
|---|---|---|---|---|
| 1 | **Recipe JSON-LD parsing** (extend existing `fetch_link`) | Paste any recipe URL → structured meal import with exact macros; zero AI parsing tokens. ~50 lines of Node on infra that already exists | **$0** forever (open web standard) | Small |
| 2 | **NWS Weather API** (`get_weather` AI tool) | Miami heat-index / thunderstorm-aware workout coaching; fixed trusted host, no SSRF surface | **$0**, commercial OK, no key today (User-Agent header; key system someday) | Small |
| 3 | **canvas-confetti** (milestones) | Goal hit, streaks, first log, trial→paid — 2-3 lines per existing handler; auto-escapes the `.page-transition` transform trap (own body-level canvas) | **$0** (ISC, ~few KB, no service) | Small |
| 4 | **Skeleton loaders** (Tailwind `animate-pulse`) | Perceived-perf win on every Firestore-loading surface (dashboards, calendar); Tailwind v4 already installed | **$0**, zero new deps | Small |
| 5 | **Trainer outbound webhooks** (Zapier/Make/n8n) | "Glidna works with your stack" — fan-out from the existing activity-history writes; biggest white-label differentiator | **$0** to Glidna; trainers on Make/n8n free, Zapier raw-webhook needs their paid plan (~$20/mo, theirs) | Small |
| 6 | **Stripe Tax nexus monitoring** | Flip on free threshold monitoring the same session as the queued live-mode swap; never get surprised by SaaS sales tax | **$0** until registered somewhere, then 0.5%/taxed txn (no-code Checkout path) | Small |
| 7 | **Acuity Scheduling sync** | Kevin's real sessions in the Glidna calendar + trainer dashboard; exact Trainerize-importer pattern (poll + webhook → Cloud Function → kv) | API calls **free**; requires Acuity **Premium $61/mo ($49 annual)** — verify which tier Smooth Training already pays for | Small |
| 8 | **TTS coach voice** (Groq Orpheus primary / OpenAI fallback) | Coach speaks replies — completes the voice loop; both keys already in Secret Manager, mirror `transcribe.js` provider pattern; gate behind Premium/Max | **$22/1M chars** ≈ 1.7¢ per typical reply | Small |
| 9 | **DIY streaks + milestone push nudges** | The proven logging-retention lever (~60% lift per Trophy's own data); computed from existing `caliq-log` keys + StreakBadges + rides the queued push delivery | **$0** (vs Trophy $99–299/mo for the same logic) | Medium |
| 10 | **Twilio SMS reminders** | Reaches clients who never installed the PWA or denied push — the one channel gap left after push ships | ~**$9–17/mo** all-in at solo-trainer volume ($0.0083/seg + $0.0035–0.005 carrier + $1.15 number + A2P: $4–44 brand, ~$15 vetting, $1.50–10/mo campaign) | Small |

---

## 2. Triage

### Do soon (aligns with the current queue: Stripe live-mode → push delivery → Acuity)

- **Stripe Tax (free monitoring)** — one config-level change; do it in the same session as the live-key swap so nexus tracking starts on day one of real revenue.
- **Acuity sync** — already the planned scheduling move; reuses the proven Trainerize importer shape, zero new vendor. First step: confirm Smooth Training's current Acuity tier (API needs Premium, $61/mo).
- **Recipe JSON-LD in `fetch_link`** — directly upgrades a shipped feature (S82 link ingest) at $0; highest value-per-dollar item found.
- **NWS `get_weather` tool** — one small tool in `aitools.js`, follows the existing pattern, very Miami.
- **Streaks/badges + milestone nudges** — build it to land WITH the queued push delivery so the first pushes are delightful ("7-day streak"), not just functional.
- **Confetti + skeletons** — bundle as one polish session; honor `prefers-reduced-motion` (app already does; library has the option).
- **TTS `speakText` callable** — small, keys exist, on the CLAUDE.md roadmap already (S79/S84 "optional later"); premium-gate to protect margin.

### Do later (named trigger, not speculative)

- **Twilio SMS** — after push delivery ships; SMS then covers only the remainder (uninstalled/denied), and A2P registration takes lead time. Budget ~$10/mo.
- **Trainer webhooks → listed Zapier public integration** — raw webhooks first (free); publish the directory app when 2+ white-label trainers exist (it's free to publish and makes triggers work on trainers' free Zapier plans + doubles as SEO).
- **Garmin Health API (direct)** — when retiring the Trainerize bridge or on the first Garmin client who isn't in Trainerize; free, webhook push beats 30-min polling.
- **Google Health API (Fitbit/Pixel)** — build on the NEW API at first Fitbit demand; legacy Fitbit API dies Sept 2026 so never touch the old one. Budget for the Restricted-scope review (possible paid CASA assessment).
- **WHOOP / Oura direct** — free, small-medium; per client demand (WHOOP needs a membership to dev/test).
- **Google Calendar** — free at any realistic volume; do it together with calendar-aware coaching (see below) to amortize the one-time OAuth sensitive-scope review.
- **Spoonacular ($29/mo Cook)** — only when JSON-LD misses + restaurant-item + GI demand stack up; it back-fills four gaps for one cheap vendor.
- **NIH DSLD supplements** — free; when supplement-logging requests arrive (likely soon with a trainer audience — protein powder/pre-workout is a real FatSecret/OFF hole).
- **Liability waivers** — $0 clickwrap (checkbox + typed name + timestamp/IP in Firestore) with white-label trainer onboarding; SignWell (25 free docs/mo, then $0.85/doc) only for trainers who want countersigned PDFs.
- **CSV earnings export** — near-zero effort from Stripe data; ship before tax season or with Connect splits.
- **Grocery list** — Phase 1 is $0 and API-free (AI consolidates the meal plan into a shareable list); Kroger cart later (free API, but thin in Miami — Publix territory, no Publix API); watch for Instacart's developer program reopening (it pays affiliate commissions — revenue, not cost).
- **Spanish** — do the $0 version now (a language pref that tells the AI coach to reply in Spanish — one prompt change); full UI i18n of a 13,500-line App.jsx is a multi-session extraction project, only on real demand. DeepL batch translate of extracted strings is ~$5–15 one-time when that day comes.
- **GI static datasets → `knowledge.js`** — free, rides the cached prompt prefix at zero per-call cost; opportunistic.
- **DiceBear avatars / bundled Lottie assets / Nutrition5k eval** — free, opportunistic polish and tuning.
- **Image CDN (Cloudinary free tier)** — only when progress photos or white-label branding actually ships; Firebase Storage (already on Blaze) is cheaper for plain storage.

### Skip (with the reason)

- **Strava** — 2026 API Agreement §5.3 explicitly bans feeding data to AI ("ingestion into a context window") — legally incompatible with the Claude tool layer; Garmin covers the athletes anyway.
- **Nutritionix** — best restaurant data, but ~$1,850/mo enterprise-gated; Spoonacular + Claude estimates now.
- **Terra / Spike aggregators** — $5.4–6k/yr minimum, and still can't reach Apple Health from a PWA; direct free APIs cover the actual device list.
- **OneSignal** — the shipped raw web-push is $0 at any scale; OneSignal adds per-subscriber cost and a PII processor for tooling not needed yet.
- **Trophy / Beamer** — $99–299/mo and $59+/mo respectively for logic the data model and card system already express; build both.
- **Tenor / GIPHY** — Tenor is dead to new clients (2026); GIPHY production keys are sales-negotiated; also collides with the "house icons, no emoji" brand rule. Bundle 5–10 brand-style Lottie assets instead if reactions are ever wanted.
- **Spotify API** — structurally unavailable (5-user dev cap; production access needs 250k MAU + registered business). Curated playlist deep links deliver ~95% of the value for $0.
- **Calendly** — solves the Acuity problem but worse, and requires each trainer to buy seats.
- **Cal.com Platform** — the credible long-term native-booking path, but $299/mo is out of proportion now; park until multiple paying white-label trainers.
- **Open-Meteo free tier** — non-commercial only; NWS is the free-and-legal US option (OpenWeatherMap free 1M/mo as the international fallback later).
- **Algolia/Typesense, Zestful, ElevenLabs** — search is already covered client-side; Claude normalizes ingredient strings for free; ElevenLabs is 4–8x Groq TTS.

---

## 3. Three most creative non-obvious ideas

1. **Calendar-aware coaching (Google Calendar busy-density → workout dosing).** A `get_calendar_busy` AI tool lets the coach say "you're back-to-back Tue/Wed — here's a 20-minute hotel-room circuit" and push scheduled workout days onto the client's real calendar. No competitor has this, it's free at Glidna's volume (under 1M req/day), and it fits the existing one-access-checked-tool-at-a-time pattern exactly. The only real cost is Google's one-time OAuth sensitive-scope review.
2. **Nutrition5k as a photo-logging eval harness.** Not a runtime API at all: ~5,000 real plates with ground-truth mass/calories/macros. Run the existing Claude-vision photo logger against known answers, measure macro error, and tune the vision prompt + the S90 photo-tips guidance with data instead of vibes. Free, offline, and turns "our AI estimates meals" into a defensible accuracy claim.
3. **Recipe JSON-LD as a zero-token structured importer.** Google forces virtually every recipe site to embed schema.org Recipe JSON-LD for rich results — so the SEO industry has already done Glidna's data-entry work. Parsing it in the existing `fetch_link` function converts "the AI reads the caption" into "the app imports the exact ingredient list and per-serving macros" while *reducing* Anthropic spend per import.

---

## 4. PWA constraints (what genuinely needs native)

- **Apple HealthKit / Google Health Connect: hard wall.** Both are on-device frameworks with no cloud API; no web page can read them, and paid aggregators only reach them by embedding a mobile SDK in a native app. Apple Watch–only and Samsung-watch users are unreachable until Glidna ships a thin native wrapper (e.g., Capacitor shell around the existing React app + HealthKit/Health Connect plugins — Apple $99/yr, Google Play $25 one-time). Defer until white-label demand justifies app-store presence anyway; the wrapper then unlocks both stores and both health frameworks in one move. Until then, Trainerize's native app remains the only Apple Health bridge.
- **Everything else clears the PWA bar:** Garmin/WHOOP/Oura/Google Health are pure cloud OAuth + webhooks/polling into Cloud Functions; TTS is standard `<audio>` playback; web push, SMS, webhooks, and all food/weather/calendar APIs are server-side.
- **One scoping caveat:** Google Maps route features work fine for *planning* (static polylines cacheable in Firestore), but live GPS run-tracking is unreliable in iOS PWAs — never promise Strava-style tracking without the native wrapper.