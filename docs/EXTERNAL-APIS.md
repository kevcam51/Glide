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

### Suggested build order (when we pick this up)
1. Pull the Free Exercise DB JSON; **fuzzy-match its names to our 184** (one-time
   mapping pass, human-reviewed — names differ, e.g. "Barbell Bent-Over Row").
2. Store the mapping as `demoId` on each exercise; leave METs untouched.
3. Cache media to Firebase Storage (convert to WebP/MP4), serve our own URLs.
4. UI: a "How to do this" control on an exercise → demo + cues.
5. Only then consider expanding the catalog — and if we do, **new exercises need MET
   values assigned** or their burn math is wrong.
