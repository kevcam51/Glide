# HANDOFF: USDA food-search feature is half-committed — finish it

**Written by a separate session (the calendar-adherence fix).** This note flags an
inconsistency another session left behind so it can be completed. Delete this file
once the work below is done.

## The problem

The commit **`2b40d49` "Meal log: food-database search + macro autofill (USDA)"**
committed **only the doc entries** (CLAUDE.md + AGENTS.md, +19 lines each). It did
**NOT commit the actual feature code.** The implementation lives **uncommitted in the
working tree** in `src/App.jsx` (~117 added lines):

- `searchFoods(query)` — a module-level async function (just above `MealLog`) that
  hits USDA FoodData Central (`api.nal.usda.gov/fdc/v1/foods/search`) using
  `VITE_USDA_API_KEY` or the public `DEMO_KEY`, and normalizes results to
  `{ name, brand, kcal, p, c, f }` per 100g.
- New `MealLog` state + handlers: `searchOpen`, `searchQ`, `results`, `searching`,
  `searchErr`, `picked`, `grams`; `resetSearch`, `runSearch`, `applyServing`,
  `pickFood`, `setServing`.
- A "🔍 Search food database" UI block inside the `MealLog` add-form (search input,
  results list, serving-size rescale).

So `git log` claims this feature shipped, but the code is not in any commit. A naive
`git checkout`/`reset` on `src/App.jsx` will silently destroy it (this nearly
happened — it was recovered from a backup).

## What to do to complete it

1. **Verify the code is still present:** `grep -c "async function searchFoods" src/App.jsx`
   should return `1`, and `git diff --stat src/App.jsx` should show ~117 insertions.
   If it's gone, recover it before doing anything else.
2. **Test it live** (not yet done by anyone): run `npm run dev`, open a plan's Daily
   Dashboard → Meals & Food → "🔍 Search food database", search e.g. "chicken breast",
   pick a result, adjust the serving grams, and confirm calories + macros auto-fill and
   the entry saves correctly. Check the console for errors and the network tab for the
   USDA request (DEMO_KEY is heavily rate-limited → expect occasional HTTP 429; the code
   shows a friendly "Search limit reached" message).
3. **Decide on the API key:** `DEMO_KEY` is fine for testing but rate-limited. For
   production, set a free `VITE_USDA_API_KEY` (from api.data.gov) in `.env.local` AND in
   Vercel. The key is read-only food data, so exposing it in the browser bundle is
   low-risk; it can be proxied through a Cloud Function later on Blaze.
4. **Commit the code** once verified: `git add src/App.jsx && git commit` — the doc
   entry already exists (`2b40d49`), so this commit just lands the implementation it
   describes. `npm run build` currently passes with the code in place.

## Unrelated, already done

The calendar-adherence fix (commit `26f75bf`, "Calendar: load day totals even when no
calorie target") is **complete, committed, and verified** — it is independent of this
USDA work. Don't revert it.
