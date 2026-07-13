# Food / Nutrition Database API Options (S93 research)

*Research date: July 2026. Prices verified from vendor primary sources where reachable; secondary
sources flagged. Prices change — re-verify before purchase. Kevin's decision after this: "research
paid DBs first" — this is that research. Verdict: **don't buy yet**; build the recents/favorites UX
(shipped S93) and keep USDA + Open Food Facts + barcode + AI-estimate. Start with FatSecret free
Basic→Premier only when branded/restaurant coverage becomes a real user complaint.*

## TL;DR

- **No paid DB will meaningfully beat what Glide already has for accuracy.** The MyFitnessPal moat is
  UX (autocomplete + saved/recent/frequent), not DB correctness — MFP's own data is crowd-sourced and
  error-prone, and **MyFitnessPal has no open API** (closed to new partners for years).
- If you *do* buy one, **FatSecret Premier Free** (free for startups <$1M revenue AND <$1M funding)
  gives the closest thing to "MFP-grade" coverage — branded foods, 90%+ barcode, autocomplete,
  restaurant data — at **$0** while small. Best coverage-per-dollar play.
- **Edamam** is the only one with transparent, self-serve, cheap paid pricing ($14–$299/mo) if you
  want a paid contract without a sales call.
- **Nutritionix** has the best US restaurant-menu coverage but is the most expensive and its real
  pricing is **not public** (contact sales).

## Comparison

| | **Nutritionix** | **FatSecret** | **Edamam** |
|---|---|---|---|
| **Library size** | ~1.9M (991k grocery + 202k restaurant) | Global, 58+ countries, "largest global"; 90%+ barcode | ~900k (790k UPC + 130k branded restaurant) |
| **Restaurant coverage** | ★★★ Best (verified US chains) | ★★ Good (per-country) | ★★ Good (130k items) |
| **Barcode/UPC** | Yes (~600k, 92%) | Yes (90%+ global) | Yes (790k) |
| **NLP endpoint** | Yes (`/natural/nutrients`) | Add-on (paid) | Vision/NLP add-on |
| **Free tier** | Gated trial only (open free discontinued) | **Basic 5k/day free; Premier Free = unlimited for startups** | Non-commercial dev tier; paid from $14/mo |
| **Price @ ~5k–50k lookups/mo** | ~$50/mo Hobby *(reported, unofficial)* | **$0** (Basic free ≈150k/mo) | **$14/mo** (Basic, 100k/mo) |
| **Price at scale** | $500–$2,000+/mo *(reported)* | Premier: **quote only (not public)** | $69–$299/mo, then custom |
| **Pricing transparency** | ✗ Contact sales | ✗ Premier by quote (Basic/Free public) | ✓ Fully public, self-serve |
| **Integration** | REST, server-side | REST+OAuth, server-side | REST, server-side; **caching restricted** |

### Nutritionix — [nutritionix.com/api](https://www.nutritionix.com/api) · [docs](https://developer.nutritionix.com/docs/v2)
~1.9M items (991k grocery + 202k restaurant menu items across hundreds of US chains — its signature
strength; ~600k UPC at ~92% match). Barcode `GET /v2/search/item?upc=`, NLP `POST /v2/natural/nutrients`
(~85% parse accuracy, weak on regional/brand), instant-search autocomplete. Open free access
**discontinued** (trial-abuse) — now gated. Pricing **NOT public**: Hobby ~$50/mo, Production
~$500–$2,000+/mo, Enterprise ~$1,850+/mo *(all secondary-source, unverified — requires sales)*.
Server-side only. Its restaurant menus are the most trustworthy of the set.

### FatSecret Platform — [platform.fatsecret.com/api-editions](https://platform.fatsecret.com/api-editions)
Global: 58+ verified country datasets, 26 languages, 90%+ UPC/EAN barcode, 19k recipes, brand +
restaurant + allergen data, 700M+ calls/month served. **Basic (free, self-signup):** 5,000 calls/day
(~150k/mo), US only, search + autocomplete + barcode + diaries, attribution required. **Premier Free
(free, verification):** startups <$1M revenue AND <$1M funding → **unlimited calls + all Premier
features** (advanced brand categorization, allergens/dietary, food images, global recipe DB), US
dataset, attribution required. **Premier (paid):** priced by market/country, **quote only** — validate
the eventual price with sales *before* architecting around it. REST + OAuth, server-side. Curated/
moderated (better than pure crowd-source).

### Edamam Food Database — [developer.edamam.com/food-database-api](https://developer.edamam.com/food-database-api)
~900k foods (790k UPC + 130k branded restaurant + generics), 70+ diet/allergy filters. Transparent
self-serve pricing: **Basic $14/mo** (100k calls, 50 Vision/day), **Core $69/mo** (750k), **Plus
$299/mo** (5M, 10k Vision/mo), Unlimited custom. **Caching is contractually restricted** — you may only
cache calories/protein/fat/net-carbs/foodId/label, behind the user's password (a real constraint for a
logging app). Built-in Vision meal recognition — but Glide already has its own AI estimate. Mixed
provenance; fine for generics, variable for branded.

## Context (free, already in Glide)

- **USDA FoodData Central** (in use): 300k+ foods incl. Global Branded Food Products DB (monthly).
  Free data.gov key, **1,000 req/hour**. Authoritative for generics; branded coverage patchier /
  label-transcription-based (S93 note: searching "egg" surfaced a Mars *chocolate* egg — coverage
  quality is imperfect, which is why the AI estimate matters). [api-guide](https://fdc.nal.usda.gov/api-guide/)
- **Open Food Facts** (in use): 3M+ products, 200+ countries, largest barcode-indexed open DB. Fully
  crowd-sourced → **no accuracy guarantees**; US coverage thinner than EU. Barcode fallback with
  sanity-filtering. [data](https://world.openfoodfacts.org/data)
- **Spoonacular**: recipe-focused (~365k recipes), not food-item logging; from $99/mo. Wrong tool.
- **MyFitnessPal**: **no usable public/partner API** — official API closed for years; only an
  Enterprise health-data-sync request form. You cannot license the MFP food DB. Scrapers are
  unofficial/ToS-risky.

## Recommendation

**A paid food DB is a "nice to have," not a "need" — and probably not worth a paid contract yet.**

1. **Glide's accuracy gap is already covered.** USDA + Open Food Facts + barcode + an AI food-estimate
   that tests ~98% accurate (see `docs/AI-ACCURACY.md`) is a *stronger* accuracy stack than MFP's
   crowd-sourced DB. A paid DB adds coverage breadth, not correctness — and the AI estimate already
   fills the "food not in any DB" gap.
2. **The MFP magic is UX, not data.** Autocomplete + saved/recent/frequent/"log again" is what makes
   MFP effortless. None of these APIs give you that; you build it on *any* data source. **Shipped in
   S93:** saved foods store the serving, a large history (~400), a type-ahead over your saved foods,
   and Enter-to-recall the exact past entry.
3. **If/when you add a licensed DB, best coverage-per-dollar = FatSecret, starting free.** Premier Free
   = unlimited + full features at $0 for a sub-$1M startup (attribution required, US-focused, real
   Premier price is quote-only — confirm with sales first). Edamam ($14/mo) if you want a transparent
   no-sales-call contract. Nutritionix only if US chain-restaurant menu logging becomes a headline
   feature (its one clear win) — otherwise the most expensive and least transparent.

**Bottom line:** Don't buy yet. Keep USDA + OFF + AI-estimate + the new saved-foods UX. When branded/
restaurant coverage becomes a real complaint, start with **FatSecret Basic (5k/day free) → Premier
Free** — zero cost, best coverage — and only revisit Nutritionix/Edamam if FatSecret's US-centric data
or eventual Premier quote doesn't fit.

*Caveat: Nutritionix's and FatSecret Premier's actual prices are not published — both require a sales
conversation, so any Nutritionix dollar figures above are secondary-source estimates, not quotes.*
