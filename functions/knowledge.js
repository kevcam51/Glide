// Glidna AI — domain knowledge base (Session 77).
//
// This is the home for Glidna-specific coaching knowledge the AI should apply:
// glycemic-index context, Smooth Training methodology, food/nutrition reference
// data, etc. It is appended to the AI's system prompt (inside the CACHED prefix,
// so adding to it does NOT increase per-call cost — see aichat.js setupChat).
//
// ── HOW TO EXTEND (this is meant to grow over time) ─────────────────────────
//   • Add a new section under GLIDNA_KNOWLEDGE below (keep it concise — it's sent
//     on every call, so favor durable principles + reference tables over prose).
//   • Keep it plain text with simple dashes/tables; the model reads it as context.
//   • Client-facing vs trainer-facing nuance can live in the same text — the AI
//     already adapts tone by role.
//   • No secrets or per-user data here — this is general, shared knowledge only.
//
// Seeded from glide-ai-meal-logging-spec.md §2 (Nutritional Context). Expand as
// the Smooth Training methodology is codified.

const GLIDNA_KNOWLEDGE = `GLIDNA COACHING KNOWLEDGE (apply this context; don't recite it unprompted):

Glycemic index & resistant starch — preparation changes a starchy carb's effective GI:
- Freshly cooked, no fat: baseline (highest GI).
- Fat cooked in: moderate GI reduction.
- Cooked then refrigerated overnight: significant reduction (resistant starch / RS3 forms).
- Fat cooked in AND refrigerated: maximum reduction.
So day-old rice/potatoes/pasta reheated, especially cooked with some fat, hit blood sugar less than freshly cooked.

Mixed-meal GI blunting — eating protein and fat alongside a carb lowers the meal's effective GI. More protein/fat = lower effective GI and steadier energy. Encourage pairing carbs with protein/fat rather than eating carbs alone.

Reference GI by rice type (plain → with fat → with fat + cooled → with beef + fat + cooled):
- Jasmine: 72-80 → 55-65 → 40-50 → 25-35
- Lundberg sushi (short grain): 70-78 → 53-63 → 38-48 → 23-33
- Basmati (recommended for lower GI): 50-58 → 40-48 → 30-40 → 20-28
Don't display GI numbers by default; apply this when someone asks about blood sugar or meal optimization. Basmati is the lower-GI default rice recommendation.

Coaching principles (Smooth Training defaults):
- Protein first: aim for roughly 1 g of protein per pound of bodyweight to protect muscle in a deficit.
- Sustainable deficit: a moderate calorie deficit (around 500/day) is the durable default; very aggressive deficits risk muscle loss and adherence problems.
- Consistency over perfection: logging most days and hitting targets on average beats occasional perfect days.`;

module.exports = { GLIDNA_KNOWLEDGE };
