// Glidna AI chat — Stage 1 (text chat).
//
// Implements the foundation of glide-ai-meal-logging-spec.md: an authenticated
// callable that selects a role-based system prompt server-side, enforces a
// per-user daily token budget, and calls the Anthropic API. Function-calling
// tools, conversational meal-writing, SSE streaming, and photo logging are
// later stages — this is the minimal working text-chat slice.
//
// The Anthropic key is a Secret Manager secret (never in the repo / VITE_*).
// Model is claude-sonnet-4-6 per the spec (Sonnet, not Opus, for cost).

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const aiusage = require("./aiusage");
const Anthropic = require("@anthropic-ai/sdk");
const { buildTools, runTool, seatCapFor, seatMonthKey } = require("./aitools");
const { GLIDNA_KNOWLEDGE } = require("./knowledge");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
// Bound so the AI's search_food_db tool can reach the SAME FatSecret proxy the
// manual food search uses (S163). Declared here, and listed on every function
// that can run the tool loop — an unbound secret leaves process.env empty and the
// tool would fail at runtime while looking perfectly fine in review.
const FATSECRET_PROXY_URL = defineSecret("FATSECRET_PROXY_URL");
const FATSECRET_PROXY_SECRET = defineSecret("FATSECRET_PROXY_SECRET");
const AI_SECRETS = [ANTHROPIC_API_KEY, FATSECRET_PROXY_URL, FATSECRET_PROXY_SECRET];

const MODEL = "claude-sonnet-4-6";

// Output token ceiling for chat replies. Raised from 1024 → 1800 (S94) so the
// assistant can give a complete, natural answer when the question deserves one
// instead of clipping mid-thought — the terse/robotic feel came partly from
// this cap plus the old hard "keep it short" prompt rules. Cost impact is small
// (only replies that actually run long cost more output tokens; most stay short).
const MAX_TOKENS = 1800;

// Daily token budgets (input + output) by tier — from the spec's cost-controls.
// clientMax/trainerMax are the paid "Max" tiers (S89c): PUBLISHED high
// allowances (~100 AI conversations/day) — honest fair-use ceilings, never
// marketed as "unlimited" (Kevin's call; see docs/PRICING.md).
// Admin UID (matches functions/index.js + firestore.rules) — gets an unlimited AI
// budget so Kevin can test freely without running out of tokens.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
// Admin is identified by UID, never by a profile-doc role: createProfile only
// ever writes "client"/"head_trainer", and index.js mirrors the admin role into
// the custom CLAIM only — so `profile.role === "admin"` is never true for a real
// doc. Anything gating on admin must go through here (matches firestore.rules
// isAdmin()), which is also why it can't be self-assigned.
function isAdminUid(uid) { return ADMIN_UIDS.includes(uid); }
// S169g client ladder (Kevin): trial and paid Premium are BOTH 100k — the trial
// shows the full product, and paying keeps it (never shrinks it). `assisted`
// (trainer-linked client) rides at the same 100k: it used to sit above the solo
// client tier, and leaving it at 40k would have inverted it to LESS.
// S179i (Kevin): client base drops to 45k, and the TRIAL MATCHES IT.
//
// The trial number is not generosity — it is the S169g rule: paying must never
// shrink the product. S179h left trial at 100k against a paid 85k, which
// re-created the exact inversion S169g removed (pay, then get 15% less). Trial
// and paid client are now the same number and must MOVE TOGETHER forever.
//
// 45k ≈ 30 conversations/day, and the ceiling earns ~$7.13 against $14.26 kept
// — the healthiest Premium has ever been. It is deliberately a base, not a
// ceiling: boosts take a user to 60k then 75k on request (see BOOST_STEP), so
// the wall is a conversation rather than a dead end, and a user who keeps
// hitting it is exactly who should hear about Elite.
const BUDGETS = { trial: 45000, client: 45000, assisted: 45000,
  // S169g (Kevin): paying must never shrink the product. The trainer trial used
  // to be 200k against a paid Coach of 100k — day 31 after paying $49, the
  // allowance HALVED. Now the trial is a taste (100k ≈ 66 conversations) and
  // paying doubles it (200k ≈ 133). Coach Elite moves to 300k so the $79 tier
  // still buys headroom over base; Apex (400k) is unchanged above it.
  trainer: 200000,
  trainerTrial: 100000,
  clientMax: 150000, trainerMax: 300000,
  // Ultra (S92): data-triggered heavy-user tiers, surfaced via the boost upsell.
  clientUltra: 250000, trainerUltra: 450000 };   // S171: Apex 400k->450k (every trainer step is now +50%)

// ── Web search (S184) ────────────────────────────────────────────────────────
// Anthropic ships web search as a SERVER-side tool on the same Messages API this
// file already calls: we declare it in `tools` and Anthropic runs the searches
// mid-turn. There is no vendor, no second key, no Cloud Function, no result
// pipeline — see docs/WEB-SEARCH.md.
//
// It is deliberately NOT an open search. Glidna sells nutrition guidance, so an
// assistant that can quote any page on the internet at someone with a medical
// condition or an eating disorder is a different risk class from summarising a
// link the user pasted themselves (fetch_link, S82). Three controls, all of
// which are load-bearing and none of which are follow-ups (Kevin, S183u):
//   1. allowed_domains — only sources a trainer would accept.
//   2. The prompt makes a client's TRAINER outrank anything found on the web.
//   3. Citations are mandatory (and cited_text/title/url are not billed).
const WEB_SEARCH_DOMAINS = [
  // Primary research + evidence reviews
  "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "cochranelibrary.com", "clinicaltrials.gov",
  "examine.com", "jissn.biomedcentral.com", "nutrition.org", "bjsm.bmj.com",
  // Government / public health
  "nih.gov", "ods.od.nih.gov", "cdc.gov", "fda.gov", "usda.gov", "fdc.nal.usda.gov",
  "who.int", "nhs.uk", "nice.org.uk", "efsa.europa.eu",
  // Clinical + professional bodies
  "mayoclinic.org", "health.harvard.edu", "nutritionsource.hsph.harvard.edu",
  "heart.org", "diabetes.org", "eatright.org", "acsm.org", "nsca.com",
  // Evidence-based training/nutrition practitioners
  "strongerbyscience.com",
];
// Cap on searches per API REQUEST — which is NOT the same as per user message.
// One message drives up to MAX_TOOL_ROUNDS + 1 requests (the model calls our
// tools, we answer, it goes again), and each request gets a fresh max_uses
// budget from Anthropic. So this alone would let one message run 3 x 11 = 33
// searches in the pathological case. We accept that (see the note above
// capTurnSearches' replacement below): the daily counter is the real ceiling,
// and enforcing a per-message one costs the user more than it saves.
const WEB_SEARCH_MAX_USES = 3;
// Per-user DAILY search allowance, beside the token budget. Search bills $10
// per 1,000 ($0.01 each) ON TOP of tokens, so an uncapped Max user could run
// ~$9/mo of search against a $29.99 plan — see docs/WEB-SEARCH.md. These are
// ceilings, not expectations: measured behaviour is that ~15% of exchanges
// search, so Premium's realistic day is ~9. Worst case at these numbers is
// ~$3.60/mo on Premium, on top of the ~$7.13/mo token ceiling, against $14.26
// kept — still positive even if someone maxes both every single day.
// This counter is also what makes the "search costs more of your allowance"
// wording in the app TRUE: you cannot honestly tell someone that if nothing is
// counting it.
const SEARCH_BUDGETS = {
  trial: 12, client: 12, assisted: 12, clientMax: 25, clientUltra: 40,
  trainerTrial: 15, trainer: 30, trainerMax: 50, trainerUltra: 70,
};
// web_search_20260318 with dynamic filtering (Claude writes code that filters
// results BEFORE they enter the context window — 4.6+ only, and this app runs
// sonnet-4-6).
//
// `response_inclusion: "excluded"` looked right at first — we never echo raw
// search content, so why pay output tokens for it? Live testing said otherwise:
// with the blocks dropped there is nothing to cite FROM. Two real searches
// returned good, current answers and an empty source list both times, because
// citations reference result blocks that no longer existed. Kevin made citation
// a headline requirement, and prose attribution alone ("a 2024 review says…")
// is not a source the reader can check. So the blocks come back, and
// collectSources() reads the URLs straight off them. The extra tokens are the
// price of the promise.
function webSearchTool() {
  return {
    type: "web_search_20260318",
    name: "web_search",
    max_uses: WEB_SEARCH_MAX_USES,
    allowed_domains: WEB_SEARCH_DOMAINS, // mutually exclusive with blocked_domains — sending both is a 400
    user_location: { type: "approximate", country: "US", timezone: "America/New_York" },
  };
}

// A complimentary tier granted as a referral reward (S181b) — OUR entitlement,
// never a change to their Stripe subscription. That is the whole safety
// property: there is no downgrade to schedule and therefore no downgrade that
// can fail, so nobody can ever be silently billed at the higher price. It
// simply lapses at rewardTierUntil.
function rewardTier(profile) {
  if (!profile || !profile.rewardTier || !profile.rewardTierUntil) return null;
  const until = typeof profile.rewardTierUntil === "number" ? profile.rewardTierUntil
    : (profile.rewardTierUntil.toMillis ? profile.rewardTierUntil.toMillis() : 0);
  return Date.now() < until ? String(profile.rewardTier) : null;
}

function tierFor(profile) {
  const role = (profile && profile.role) || "client";
  // A live reward tier stands in for the paid one while it lasts.
  const rw = rewardTier(profile);
  if (rw) {
    if (role === "head_trainer" || role === "sub_trainer" || role === "admin") {
      return /ultra/.test(rw) ? "trainerUltra" : /max/.test(rw) ? "trainerMax" : "trainer";
    }
    return /ultra/.test(rw) ? "clientUltra" : /max/.test(rw) ? "clientMax" : "client";
  }
  // Paid high tiers (the Stripe webhook stamps subscriptionTier
  // "max"/"coach_max"/"ultra"/"coach_ultra") unlock the big budgets — only
  // while the sub is active. Ultra > Max.
  const t = String((profile && profile.subscriptionTier) || "");
  const active = profile && profile.subscriptionStatus === "active";
  const isUltra = active && /ultra/.test(t);
  const isMax = active && /max/.test(t);
  if (role === "head_trainer" || role === "sub_trainer" || role === "admin") {
    if (isUltra) return "trainerUltra";
    if (isMax) return "trainerMax";
    // On trial → the fuller trainerTrial allowance (they manage clients from day
    // one). trialExpiredFor() still locks the AI once the trial actually ends.
    if (profile && profile.subscriptionStatus === "trial") return "trainerTrial";
    return "trainer";
  }
  if (isUltra) return "clientUltra";
  if (isMax) return "clientMax";
  // client: trainer-assisted (linked) gets a higher budget than self-serve;
  // a still-in-trial / non-active subscription gets the trial budget.
  if (profile && profile.subscriptionStatus && profile.subscriptionStatus !== "active"
      && profile.subscriptionStatus !== "trial") return "trial";
  if (profile && profile.subscriptionStatus === "trial") return "trial";
  if (profile && profile.assignedTrainerId) return "assisted";
  return "client";
}

// Role-based system prompts (topic-restricted to health & fitness), per the spec.
const SYSTEM_CLIENT = `You are a nutrition and fitness assistant for Glidna, a personal training platform.

Your role is to:
- Help clients log meals through natural conversation
- Estimate calories, protein, carbs, and fat for logged meals
- Answer questions about nutrition, food, exercise, body composition, and health
- Provide coaching context (glycemic index, macros, meal timing, food quality) when relevant

You must NOT:
- Answer questions unrelated to health, fitness, nutrition, or the client's data
- Provide medical diagnoses or prescribe medications
- Discuss topics outside of health and wellness

If a user asks something outside your scope, respond:
"I'm focused on helping you with nutrition and fitness. Try asking me about your meals, macros, or training."

Be encouraging and clear. Avoid jargon unless the client has demonstrated familiarity.

Formatting: replies render in a narrow mobile chat, so write like a person texting — natural prose in short paragraphs. Match your length to the question: a quick log or fact gets a sentence or two; a real "how am I doing / what should I change" question deserves a genuine, complete answer (don't truncate a good explanation to save space). Light markdown is fine — **bold** for the occasional label, and a dash list only when you're truly listing things. Skip big markdown tables, heading syntax (#), and code blocks; they render badly here. Write clean, properly-spaced prose: always put a normal space after periods, commas, colons, and every other punctuation mark, and never run one sentence into the next — write "Nice work. Keep it up.", never "Nice work.Keep it up." Hold yourself to the same polish, spacing, and correctness you'd expect from a top-tier writing assistant.`;

const SYSTEM_TRAINER = `You are a fitness coaching assistant for Glidna, a personal training platform.

You assist trainers by:
- Summarizing client meal logs and progress data
- Identifying clients who are off track (missed logs, missed targets)
- Answering nutrition and exercise science questions
- Helping trainers make data-driven decisions for their clients

You must NOT:
- Answer questions unrelated to health, fitness, or client management
- Access or discuss data for clients not assigned to this trainer
- Make medical recommendations

If asked something outside scope, redirect: "I can help you with client nutrition data, progress tracking, and fitness questions."

Formatting: replies render in a narrow mobile chat, so write like a person texting — natural prose in short paragraphs. Match your length to the question: a quick lookup gets a sentence or two; a real coaching question (who's off track, what should I change) deserves a complete, useful answer — don't truncate real analysis to save space. Light markdown is fine — **bold** for the occasional label, and a dash list only when you're truly listing things. Skip big markdown tables, heading syntax (#), and code blocks; they render badly here. Write clean, properly-spaced prose: always put a normal space after periods, commas, colons, and every other punctuation mark, and never run one sentence into the next — write "Nice work. Keep it up.", never "Nice work.Keep it up." Hold yourself to the same polish, spacing, and correctness you'd expect from a top-tier writing assistant.`;

// YYYY-MM-DD key for the per-user daily usage doc, in the app's audience
// timezone. This was UTC until S167 — which in Eastern rolls over at 8pm, so
// the daily budget reset mid-evening and the admin dashboard's "today" silently
// dropped everything logged after it. Every other date key in the app has been
// local since S45.
function todayKey() {
  return aiusage.dayKey();
}

// Today's date in the app's audience timezone (Miami / Eastern), as YYYY-MM-DD,
// so the AI can resolve "today" / "this week" against the user's local day
// (the app keys daily logs by local date). en-CA gives ISO-style output.
function todayLocal() {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  } catch (e) {
    return todayKey();
  }
}

// Weekday name for the prompt. Changes once a day, exactly like the date it sits
// beside, so it costs no extra prompt-cache churn — and without it the model was
// resolving "last Monday" with no idea what day it currently is.
function weekdayLocal() {
  try {
    return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
  } catch (e) {
    return "";
  }
}

// Current local clock time as 24h "HH:MM" (America/New_York) — passed into the
// tool ctx as the default "when" stamped on a meal logged now (the AI omits the
// time arg for "now"). Deliberately NOT injected into the cached system prompt:
// a value that changes every minute would invalidate the prompt cache each call.
function nowTimeLocal() {
  try {
    return new Date().toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch (e) {
    return new Date().toISOString().slice(11, 16);
  }
}

// Allowed image media types + a base64 size cap (~7MB) for photo meal logging.
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMG_B64 = 7 * 1024 * 1024;

// Sanitize one message's content: a plain string, or an array of text/image
// blocks (photo logging). Returns a safe content value, or null to drop it.
function sanitizeContent(content, allowImages = false) {
  if (typeof content === "string") return content.slice(0, 8000);
  if (!Array.isArray(content)) return null;
  const blocks = [];
  let images = 0;
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") {
      blocks.push({ type: "text", text: b.text.slice(0, 8000) });
    } else if (allowImages && images < 20 && b.type === "image" && b.source && b.source.type === "base64"
        && IMG_TYPES.has(b.source.media_type) && typeof b.source.data === "string"
        && b.source.data.length <= MAX_IMG_B64) {
      images++;
      blocks.push({ type: "image", source: { type: "base64", media_type: b.source.media_type, data: b.source.data } });
    }
  }
  return blocks.length ? blocks : null;
}

// Validate a base64 image data URL into an Anthropic image block, reusing the
// same type/size rules as chat photo logging. Returns null if absent/invalid.
function sanitizeImageDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const [, mediaType, data] = m;
  if (!IMG_TYPES.has(mediaType) || data.length > MAX_IMG_B64) return null;
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

// How many recent messages to re-send to the model. The whole window is
// re-sent on every tool round, so this is the single biggest input-cost lever.
// 10 messages = ~5 exchanges — plenty for meal corrections ("make it one egg")
// and recent coaching context, while roughly halving the history input vs. the
// old 20. (The UI still PERSISTS up to 20 for scroll-back; only the API payload
// is capped here.)
const HISTORY_MSGS = 10;
function capHistory(messages) {
  const arr = Array.isArray(messages) ? messages : [];
  const clean = [];
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    // Images are only honored on the FINAL message (up to 20 — Kevin) — history
    // images would be re-billed as vision input on every tool round, a crafted-
    // payload cost hole otherwise. The per-user daily token budget bounds the
    // cost of a large photo batch.
    const content = sanitizeContent(m.content, i === arr.length - 1);
    if (content == null) continue;
    clean.push({ role: m.role, content });
  }
  return clean.slice(-HISTORY_MSGS);
}

const MAX_TOOL_ROUNDS = 10; // headroom for bulk actions (e.g. logging a batch of meals at once)

// ── Web search safety net (S184) ─────────────────────────────────────────────
// Declaring the search tool is the one change here that can fail LOUDLY rather
// than degrade: web search can be switched off for a whole organization in the
// Claude Console, and a request that declares it then fails with a 400 —
// not a soft error inside a search result. Same for a tool version an account
// can't use, or a malformed domain in the allowlist. Any of those would take
// the entire assistant down, for every user, on every message.
//
// So a 400 on a request that declared search drops the tool and retries ONCE.
// The person gets their answer; they just don't get the internet. Search is an
// enhancement — it must never be able to break chat, meal logging or coaching.
function isSearchToolRejection(e) {
  const status = (e && (e.status || e.statusCode)) || 0;
  if (status !== 400) return false;
  // The SDK JSON-stringifies the whole error body into .message, so the API's
  // own wording ("web search is not enabled for this organization",
  // "tools.N.type: Input tag 'web_search_20260318'…") is present here.
  const msg = ((e && e.message) || "").toLowerCase();
  return msg.includes("web_search") || msg.includes("web search")
    || msg.includes("allowed_domains") || msg.includes("allowed_callers")
    || msg.includes("response_inclusion");
}
function setSearchTool(state, on) {
  if (on === state.searchOn) return;
  state.searchOn = on;
  state.tools = on
    ? [...state.tools, webSearchTool()]
    : state.tools.filter((t) => t.name !== "web_search");
}
// NO mid-turn search cap — deliberately. It is tempting to withdraw the tool (or
// shrink max_uses) once a turn has searched enough, and an earlier cut of S184
// did exactly that. It is a net LOSS: any change to the `tools` array
// invalidates the whole prompt cache, because tools render before system. So the
// next request in that turn re-writes the entire ~12k-token prefix at cacheWrite
// rates instead of reading it at ~10%, and `spent = input + output + cacheWrite`
// means the USER pays that out of their daily token allowance — roughly a
// quarter of a Premium day, to save us a few cents of search. It also fires on
// exactly the turns that are already expensive (search, then a tool round).
//
// So the real per-message ceiling is max_uses x the number of requests the turn
// makes, not max_uses. That is bounded in practice by the daily counter (checked
// once per turn, which changes the tools array at most once a day per user) and
// by how rarely the model searches at all. Say the true number in the docs
// rather than enforcing a tidier one at the user's expense.
// Recover from a 400 the search tool might be responsible for — the org-wide
// switch is off, the tool version is unusable, the org's own allowlist rejects a
// domain. Without this, one such 400 breaks chat for EVERY user on EVERY
// message, so drop the tool and retry once. One attempt per request, so this can
// never loop.
function retrySearchFix(state, e) {
  if (state.retried || !isSearchToolRejection(e)) return false;
  state.retried = true;
  if (state.searchOn) {
    console.error("aiChat: web search rejected, retrying without it —", e && e.message);
    setSearchTool(state, false);
    state.searchOff = true; // stay off for the rest of the turn
    return true;
  }
  return false;
}
// One request against the model, with the recovery above folded in.
async function callModel(client, state, params) {
  state.retried = false;
  try {
    return await client.messages.create({ ...params, tools: state.tools });
  } catch (e) {
    if (!retrySearchFix(state, e)) throw e;
    return client.messages.create({ ...params, tools: state.tools });
  }
}
// Streaming variant. A 400 arrives before any token is emitted, so the retry
// can't duplicate text the user already saw.
async function streamModel(client, state, params, onText) {
  state.retried = false;
  try {
    const stream = client.messages.stream({ ...params, tools: state.tools });
    stream.on("text", onText);
    return await stream.finalMessage();
  } catch (e) {
    if (!retrySearchFix(state, e)) throw e;
    const stream = client.messages.stream({ ...params, tools: state.tools });
    stream.on("text", onText);
    return stream.finalMessage();
  }
}

// Build the role-aware system prompt (shared by the callable + the stream fn).
function buildSystemPrompt(role, isTrainer) {
  const baseSystem = (role === "client") ? SYSTEM_CLIENT : SYSTEM_TRAINER;
  return `${baseSystem}

Today's date is ${todayLocal()} (${weekdayLocal()}) — use it to resolve "today", "yesterday", "this week", etc.

log_meals takes ONE date for the whole batch (its top-level date arg) — use that when the user names a single day for everything; a date on an individual item overrides it for that item only.

Dates: DEFAULT TO TODAY. If the user does not name a day, OMIT the date argument entirely — the tools already default to the user's today, which is more reliable than a date you work out yourself. Only pass date when they explicitly name another day ("yesterday", "last Monday", "my Saturday weigh-in"); resolve that to YYYY-MM-DD. Never infer a date from earlier messages in this conversation — it may have been started on a different day. For history ("what did I eat last week?") use get_nutrition_log with start/end dates.

Meal times: each meal carries the clock time eaten (a "time" field like "19:45"). When the user says WHEN they ate, pass it as the time arg; else it defaults to now. get_nutrition_log returns times, so you can spot time-of-day patterns (late-night snacking, skipped breakfasts).

Read real data: use the read tools whenever a question depends on actual numbers rather than guessing; call get_nutrition_targets before judging a day over/under. For ADVICE/feedback (not a quick log or fact), first call get_nutrition_log for the recent week or two and tailor guidance to the real patterns (meal timing, day-of-week habits, adherence, weight trend) instead of generic tips — but don't over-fetch for simple logging. Don't expose internal ids; refer to clients by name.

TAKING ACTIONS — DO WHAT THE USER ASKED, FIRST TIME (Kevin, S102e): when someone tells you to log something, LOG IT in that same turn. "log my breakfast", "add 2 eggs", "put that in", "log it" — that IS the go-ahead; you do not need a second one. Never reply asking whether to proceed with something they just told you to do, and never say you logged something without actually calling the tool — a write happens ONLY on the tool call. If a detail is missing (meal type, portion), make your best reasonable assumption, LOG IT, and say what you assumed — everything is editable afterwards in "Meals & Food Today" or by asking you to change it. Prefer acting-then-correcting over asking-then-acting; the cost of a wrong guess is one edit, the cost of not logging is lost data. Only pause for a genuine confirmation when the action is hard to undo or spends money: creating/switching a PLAN, changing TARGETS or goal weight, sending a client a to-do, or writing to a DIFFERENT person's account. Details per action:
- Logging food — READ THIS FIRST: if the user TOLD you to log it ("log a chicken salad for lunch", "add 2 eggs", "put that in", "log it"), you CALL log_meal (or log_meals for several) IMMEDIATELY in this same turn. No card, no asking, no waiting. Estimate anything missing, save it, then confirm in ONE line what you saved and what you assumed ("Logged — grilled chicken salad, 420 cal, assuming ~150g chicken and light dressing. Ask me to change it if that's off."). A card is NOT a substitute for doing what they asked. ONLY when the user merely DESCRIBES food without asking you to log it ("I had a burger earlier") do you estimate and call propose_meal to show the tappable Accept/Edit card. From a description OR a PHOTO (identify items/portions from the image), estimate calories + P/C/F. Be rigorous about PORTION — when it's ambiguous ('some rice', 'a bowl of pasta', a plate photo), briefly state the serving you're assuming (e.g. '~1 cup / 200g') or ask, so grams aren't a blind guess. PHOTO PORTION CALIBRATION (measured: photo estimates skew HIGH because standard restaurant servings get assumed for what are often much smaller real portions): do NOT default to a standard serving. Read the portion off the image geometry first — a dinner plate is ~26-28cm and a bowl ~15cm across, so use the food's width as a fraction of the plate AND its pile height to size it, then convert to grams (most single-plate restaurant-style servings of a cooked starch or protein land ~110-220g, and a plate that is half-empty or thinly covered is far less). Food is usually FLATTER and lighter than it looks from overhead. State the gram estimate you derived. When there is no clear scale reference in frame, choose the LOWER end of your plausible range rather than the middle. Always commit to a numeric estimate — never reply asking for the portion instead of proposing one; if truly unsure, propose your best low-leaning estimate and say it's approximate so the user can correct it on the card. Account for INVISIBLE calories — cooking oil, butter, dressings, sauces — and ask if a cooked dish likely has them. ALWAYS estimate MICRONUTRIENTS too: pass the micros object on every meal you log (propose_meal / log_meal / log_meals) with the meal's totals — always include sodium, potassium, fiber, sugar, saturated fat, cholesterol, calcium, and iron, plus notable vitamins/minerals for the foods involved (units: g for fiber/sugar/fats, mg or µg per the field). These feed the daily micronutrient bars, so don't leave them out (a logged meal with 0 sodium is wrong for almost any real food). ALWAYS pass the SERVING too — the grams + unit fields, carrying the very portion you just estimated (e.g. grams 180 unit "g", or grams 2 unit "serving" for 2 eggs). Without them the person can't adjust the portion afterwards and have the calories rescale, so a meal logged without a serving is a meal they're stuck with. The card shows the name + calories + macros, so keep your text reply to ONE short line (e.g. "Here's my estimate — tap to log.") — don't re-list items or repeat macros, even for a long list. The card saves it — do NOT also call log_meal. Ask the meal type if unclear; support corrections ("make it one egg") by proposing again; note photo estimates are approximate. MULTIPLE foods at once (the user lists or photographs several distinct foods/meals to log): do NOT use propose_meal — its card shows only ONE at a time and forces a tap per item. call the log_meals tool ONCE with ALL the items in its meals array — that saves every one together in a single call (no cards, no tapping). Do NOT call log_meal repeatedly and do NOT narrate ("logging all 8 now") without actually making the log_meals call — a write only happens when the tool is called. When the user has already given you the list of foods, THAT is your go-ahead: after any needed client-id lookup, immediately call log_meals in the SAME turn (don't stop after the lookup). Then give a brief one-line-per-item summary and note they can edit/remove any in "Meals & Food Today" or ask you to change one. Reserve the single propose_meal Accept card for when there is exactly ONE food/meal AND the user hasn't already said to log it — if they DID say log/add/put it in, skip the card and call log_meal (or log_meals) straight away, then confirm in one line what you saved and what you assumed.
- Food DATABASE lookups (search_food_db) — OPT-IN ONLY: use it when the user ASKS for the database ("look it up", "use the food database", "find the real numbers", "what does the label say"), or when they name a specific packaged/branded product and want it exact. Otherwise DON'T call it — estimate as normal. Your estimates are good, and every lookup puts a list of candidate foods into the conversation, which costs the user more for no gain on a home-cooked meal. When you do use it: pick the closest match, SCALE it to what they actually ate (the numbers come back per the serving shown, not per their portion), say which entry you used and its serving, and log with source:"database". If nothing matches well, say so and fall back to your own estimate rather than forcing a bad match — a wrong database entry is worse than a sensible estimate.
- Paste-from-another-AI: a pasted ChatGPT/Claude reply may contain several meals (and workouts/weigh-ins). Extract EVERY loggable item, summarize as a short list, and confirm. On confirm, log all: call log_meal once PER meal (right type + date if stated), plus log_workout/log_weigh_in — a single propose_meal card only when there's exactly one meal. If nothing's loggable, say so.
- log_workout: mark a day as a workout day (optional note). log_weigh_in: record a weigh-in (confirm the number).
- Tape measurements (non-scale progress): fully supported for people who prefer the tape to the scale. On shared measurements confirm the numbers then call log_measurements (inches; any subset of waist/hips/neck/thigh/calf/forearm/wrist; merges into the same date). Body-fat % + waist-to-height (goal under 0.5) compute automatically. For "how's my waist/body fat trending?" call get_measurements. Frame tape body-fat as an estimate (±2%), emphasize the TREND, and never pressure a scale-averse user to weigh. For body fat, ask for the needed fields (men: waist, hips, forearm, wrist; women: hips, thigh, calf, wrist).
- set_targets: change protein/carbs/fat targets and/or goal weight (confirm exact numbers first).
- Onboarding: if a plan lacks the basics (no calorie target), offer to set it up by chat. Call get_profile FIRST and ask ONLY for the fields it lists as missing (never re-ask for info already set). Full set: gender, age, height, current weight, everyday activity, goal weight. Save with set_personal_info as values come in; when complete, tell them their daily calorie target. Age: accept a plain age OR, ONLY if the user volunteers their birthday, a date of birth (dob, YYYY-MM-DD) which keeps their age current automatically — dob is optional, never pressure for it. Confirm first only to overwrite an existing value.
- Plans / phases: a person can have several plans (cut/maintenance/bulk), one active. list_plans to see them, switch_plan to change active, create_plan to START A PHASE (carries over their stats; pass goalWeightLbs, then build targets/workouts). Confirm before create/switch. Refer to plans by NAME, not id.
- Workout PROGRAM: to create/edit a training program, call list_exercises FIRST for the real ids, design a balanced week, summarize it briefly, then call propose_workout (a tappable Accept card — don't also call set_workout_schedule for it). Adjust and re-propose on changes. Use set_workout_schedule directly only if they say to skip the card. Keep it realistic for their experience/days. For a movement not in list_exercises (e.g. Battle Ropes, Sled Push), call add_custom_exercise first (estimate cal/min) then use the returned id — but prefer standard exercises.
- Notes are context, not just storage. Before advising on a SPECIFIC person — how to adjust their plan, why they are struggling, what to say to them — call list_notes for them first. THIS INCLUDES SOMEONE ASKING ABOUT THEMSELVES: when a client asks what they should be training, eating or aiming for, call list_notes for themselves BEFORE answering. Notes marked fromTrainer were written by their coach for them — treat that as the plan of record and build your answer on it rather than offering generic best-practice that contradicts it. If their coach's guidance and the textbook answer differ, follow the coach and say you are ("your coach has you on push/pull/legs, so…"); if you genuinely think the guidance is unsafe, say why and suggest they raise it with their trainer rather than quietly overriding it. If there is no trainer guidance on a topic, answer normally — don't stall waiting for a note that doesn't exist. Injuries, preferences, schedule constraints, what was already tried and what they reacted badly to all live there, and advice that ignores them reads as though you never met the person. Do NOT call it on every turn: a general nutrition question needs no notes, and the reads cost the user's daily allowance. Use what you find silently — reference the substance ("since your knee has been flaring") rather than announcing that you read a note. NEVER repeat a trainer's private note back to a client; list_notes already excludes what the caller may not see, so simply use what it returns.
- Notes: on "write this down / remember this / make a note / save a recap", use create_note (recaps → kind='recap'). A client's note is PRIVATE by default — only share (visible to trainer) if they clearly want that. A trainer using clientId writes a private about-note by default (shared=true puts it where the client sees it). Before re-recapping, call list_notes and UPDATE the existing note (update_note, append) instead of duplicating. Never reveal a client's private notes to anyone but that client.
- WEB SEARCH: you can search the internet, but only across a fixed allowlist of vetted health, nutrition and exercise-science sources (PubMed, Examine, NIH/ODS, CDC, USDA, Mayo Clinic, Harvard Health, WHO/NHS, ACSM/NSCA, the Academy of Nutrition and Dietetics, and similar). A search costs the person real money and eats their daily AI allowance faster than a normal reply, so treat it as spending THEIR money, not yours.
  ASK BEFORE YOU SEARCH. Do not call web_search on your own initiative. When a question genuinely needs current or specific information you should not state from memory — a recent study or guideline, a supplement's evidence base, a nutrient or drug-nutrient interaction, a product or standard that may have changed — do NOT search yet. Say what you'd need to look up, say plainly that searching the web uses more of their daily AI allowance than a normal reply, and ask whether they want you to. Then STOP and wait for their answer. Give them what you can from your own knowledge in the same message where it's useful, so the choice is "want me to check the current research too?" rather than a blank refusal.
  THEIR YES IS THE GO-AHEAD, AND SO IS ASKING IN THE FIRST PLACE. If they already told you to search — "look it up", "search for it", "what does the current research say, check it", "find me a source" — that IS consent: search immediately, do not ask a second time. Once they have agreed to a search in this conversation, you may keep searching on that same topic without re-asking; ask again only when you're moving to a genuinely different subject. Never ask twice for the same thing, and never nag.
  DON'T SEARCH AT ALL for what you already know well: everyday macros and calories, portion estimates, training principles, how to structure a week, or anything answerable from the person's own logged data (use the read tools for that). Don't offer a search for those either — offering costs them attention, and taking them up on it costs them allowance.
  WHEN THE PERSON'S OWN COACH HAS SPOKEN, THE COACH OUTRANKS THE INTERNET: never use a search result to quietly override guidance in a fromTrainer note — if a source and their coach disagree, say so plainly and tell them to raise it with their trainer, rather than switching them to what you found.
  ALWAYS CITE: name the source in your reply ("per Examine's review…", "the NIH fact sheet says…") whenever you used a search, so the person can see where it came from; never present a searched claim as your own unattributed assertion. The allowlist is narrow on purpose — if it turns up nothing relevant, SAY the vetted sources did not cover it and answer from your own knowledge (flagged as such), rather than stretching a weak result. Never search for anything outside health, fitness and nutrition.
- Links/videos (Instagram, YouTube, TikTok, blogs): when the user shares a URL to USE ("add the exercises from this", "make a program from this", "log this recipe"), call fetch_link for its title + caption, then build changes with the normal tools (workouts: list_exercises → propose_workout, add_custom_exercise as needed; food: propose_meal). Summarize what you found first and map named moves to the closest real ids. If fetch_link returns little or errors (some posts are blocked), don't guess — ask the user to paste the caption text. Adapt the content to the user's goal/days/experience, don't copy blindly.
${isTrainer ? "- ONE specific person (cost — Kevin, S110d): when the user asks about a SINGLE named client, call find_client to resolve just that person's id, then use the data tools on THAT client only. Do NOT call list_clients (it loads EVERY client) or coach_summary (every client's full snapshot) for a single-person question — that wastes work and money searching people you don't need. A '#' code the user quotes comes in TWO forms — a 4-character ref like #KEM2, or a small number like #6 (the permanent number on the trainer's home screen) — and the home numbers CONNECTED CLIENTS AND THE TRAINER'S OWN LOCAL PLAN FILES from one shared counter, so a '#' code may be either. find_client searches BOTH pools in ONE call — connected accounts AND the trainer's own plan files — matching names, emails and both code forms, so you never need a second lookup to 'also check' the local files. Each match says which it is: `kind:\"client\"` → use `clientId`, `kind:\"local_plan\"` → use `localPlanId`. Both carry `ref` and `num`. When you name someone back, prefer their NAME, and if you cite a code use the same form they used. Once you have the id it becomes the active subject; reuse it, don't look it up again. Use list_clients only to LIST the whole roster, and coach_summary only for genuinely across-all-clients questions.\n- SAME NAME (Kevin, S110e): if find_client returns MORE THAN ONE match (two people with the same/similar name), do NOT guess or pick the first — ASK the user which one, telling them apart by a HUMAN detail from the match (their short ID code, email, current weight, or last-log date), NEVER the raw internal id. Same for local plans: if two plans/sims share a name, distinguish them by their ref code, weight/goal, sim tag, or when they were last updated. Only after the user picks do you act on that id.\n- SHORT ID CODES: every client and plan shows a short code in the app (e.g. \"#7K2M\", the `ref` field). The user may identify someone by it — pass a code to find_client just like a name (it matches the code), and match a plan code against list_local_plans' `ref`. When you refer back to a specific person or plan and it could be ambiguous, include their #code so the user knows exactly which one you mean.\n- send_client_request: send a connected client a to-do (e.g. log food, weigh in); use find_client for the id, confirm before sending.\n- Proactive coaching: for cross-client questions ('who's stalled / needs attention / what should I change?' across everyone), call coach_summary ONCE (every client's status + adherence + weight trend — don't loop per-client tools), then call out who needs attention BY NAME with concrete recommendations and offer to send a to-do. You can do any action FOR a client via their clientId.\n- LOCAL PLAN FILES ARE PEOPLE: a trainer's local plan file (imported Trainerize client, prep file, even a sim) is usually a REAL, paying client — one who simply doesn't want to install the app or make a login. Being 'connected' is not what makes someone a client. Most of a trainer's people are these files. So treat a `local_plan` match exactly like a client: pass its localPlanId (never together with clientId) to any tool, refer to them by NAME, and never suggest 'connecting' or 'inviting' them as though the plan were a lesser thing — read and edit (stats, targets, workouts, meals, weigh-ins, measurements, water, check-ins) all work FULLY on them. Use list_local_plans to LIST these files; find_client already covers them for one named person. Two real limits, worth stating plainly if asked: send_client_request (to-dos) and messaging need a real login on the other end, so they can't reach a local file. And if a match is flagged `isSimulation`, it's a sandbox projection rather than someone's live plan — say so before writing into it." : ""}
${isTrainer ? `- AI-CLIENT SLOTS (S176f): paid plans include a monthly allowance of distinct people the AI works on (connected clients AND plan files both count; your own data never does). When a tool refuses with "isn't one of this month's AI clients yet", relay it plainly: working on this person uses one of the monthly slots (the error says how many are used). Get the user's explicit yes, call confirm_ai_client with the SAME id, then retry the original action — never confirm silently, and never call confirm_ai_client unprompted. Someone already in this month's set never re-asks. If the limit is reached, say the AI has hit this month's client allowance, that everything manual still works for everyone and existing AI clients keep working, and that Plans & pricing in the app shows the options — do NOT quote prices.` : ""}
After any action, briefly confirm what you did — but only AFTER the tool call actually succeeded. A write only happens when you call the tool; text alone never changes any data, so never claim you did something you didn't actually call a tool for. If a tool comes back with an error, SAY it failed and what you'll try instead — never report success for a call that errored. If you were mid-way through several actions and ran out of steps, say which ones you completed and which you did not.

FEATURE REQUESTS: if they wish Glidna did something it doesn't, or hit a limit they want changed, offer once to pass it to the team ("want me to send that to the Glidna team?") and call send_app_request only if they say yes. Summarise it clearly and include what they were doing when it came up. Confirm it was passed on — never promise it will be built, and never imply a timeline. If they're reporting that DATA looks wrong, that's not a feature request: check their actual data first.

WHOSE ACCOUNT: a write with no clientId and no localPlanId goes to YOUR OWN account. So when you are logging or editing on behalf of someone else, you MUST pass their id on EVERY such call — clientId for a connected account, localPlanId for one of your own plan files — resolving it first with find_client, which returns either kind and tells you which. Two silent failures to avoid, both of which look like success: saving someone's meal into your own diary, and saving it against the wrong person because a partial name matched somebody else. So if find_client returns more than one person — especially one connected account AND one plan file — ask which before writing. When you confirm, name the person ("logged for Casey"), not just the action.

Voice & tone: talk like a warm, knowledgeable coach texting someone they actually like — relaxed and human, never robotic or clipped. Sound like a person, not a form: it's fine to react naturally ("nice, that's a solid day"), reason out loud a little when it helps, and give a real answer when the question calls for one. Warmth comes from the words, not punctuation — keep exclamation points rare (usually none) and skip corporate filler and hype. Don't narrate your internal steps ("let me pull up the client list", "got the ID, logging now") — just quietly do the work and report the result plainly.

${GLIDNA_KNOWLEDGE}`;
}

// Read the caller's profile → role, budget, today's usage, system prompt, tools,
// and the tool-execution context. Shared by both entry points.
// Hard premium gate (Stripe v1, S89): the AI layer locks when a trial has
// EXPIRED and no subscription is active. Accounts with no trialStartedAt
// (created before trials existed, incl. admin/test accounts) are grandfathered.
// Keep the semantics in sync with src/profile.js isPremium() and the copy in
// functions/transcribe.js.
function trialExpiredFor(profile) {
  if (!profile) return false;
  if (profile.subscriptionStatus === "active") return false;
  if (profile.role === "admin") return false;
  if (profile.entitlements && profile.entitlements.premium === true) return false;
  const t = profile.trialStartedAt;
  const startMs = t && typeof t.toMillis === "function" ? t.toMillis()
    : typeof t === "number" ? t : null;
  if (!startMs) return false; // pre-trial account — grandfathered
  return Date.now() >= startMs + (profile.trialLengthDays || 30) * 86400000;
}
const TRIAL_EXPIRED_MSG = "Your free trial has ended — upgrade to keep using Glidna AI. Your data and manual logging stay free.";

// Carry the human NAME across turns (S165). runToolRound learns the subject's id
// from the tool call, which has no name attached, so echoing it bare would strip
// the label the app sent — and the next turn would be back to an opaque id with
// nothing to call the person.
function keepName(next, prev) {
  if (!next || !prev || !prev.name) return next;
  const sameId = (next.clientId && next.clientId === prev.clientId)
    || (next.localPlanId && next.localPlanId === prev.localPlanId);
  return sameId ? { ...next, name: prev.name } : next;
}

async function setupChat(uid, activeTarget, noSearch) {
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const tier = tierFor(profile);
  const usageRef = db.doc(`users/${uid}/aiUsage/${todayKey()}`);
  const usageDoc = (await usageRef.get()).data() || {};
  const used = usageDoc.tokens || 0;
  // S90: an approved same-day boost (requestBudgetBoost) raises the cap. The
  // boost lives on the DAY's usage doc, so it expires automatically at reset.
  // Admin (Kevin) gets an effectively-unlimited budget so testing never hits a wall.
  const budget = ADMIN_UIDS.includes(uid)
    ? 100000000
    : (BUDGETS[tier] || BUDGETS.client) + (usageDoc.boost || 0);
  // Daily WEB SEARCH allowance, counted separately from tokens (S184). Once it's
  // gone we simply stop declaring the tool — the assistant keeps working and
  // answers from its own knowledge instead of erroring, which is the right
  // failure for a feature that is an enhancement rather than the product.
  const searchBudget = ADMIN_UIDS.includes(uid)
    ? 1000000
    : (SEARCH_BUDGETS[tier] || SEARCH_BUDGETS.client);
  const searchesUsed = usageDoc.searches || 0;
  // `noSearch` is set by callers that must never search: the AI Coaching
  // Insights card (a one-shot read of the person's OWN data, with no UI to
  // carry the "this searched the web" disclosure or the citations) and
  // scheduled automations (nobody is watching, so the disclosure has nowhere
  // to appear). Both would otherwise spend the allowance invisibly.
  const searchAllowed = !noSearch && searchesUsed < searchBudget;
  const callerName = profile.displayName
    || [profile.firstName, profile.lastName].filter(Boolean).join(" ")
    || profile.email || (isTrainer ? "Coach" : "Client");
  // (S92) The food-DB search_food tool was RETIRED — measured no accuracy gain
  // over the AI's own estimate (~98% on branded foods) at 2–2.5× the tokens, and
  // it missed restaurant/obscure items entirely. See docs/AI-ACCURACY.md. Portion
  // rigor + invisible-calorie awareness (the parts that DO help) are now default
  // for everyone; barcode scanning remains the exact-packaged-food path.
  // Cache the stable prefix (tools render before system, so a cache_control
  // breakpoint on the system block caches tools + system together). This part is
  // identical across calls within a day, so repeat messages + tool rounds pay
  // ~10% for it instead of full price (Session 67). No effect on output quality.
  const system = [{ type: "text", text: buildSystemPrompt(role, isTrainer), cache_control: { type: "ephemeral" } }];
  // Per-conversation "active subject" (S93): once the model resolves a client (or a
  // trainer's local plan), the client app relays that id back each turn so we can
  // remind the model to REUSE it instead of re-running list_clients/list_local_plans
  // every message. Kept as a SEPARATE, uncached block so it never busts the cached
  // prefix above. resolveTargetUid still validates the id on every tool call.
  const at = activeTarget || {};
  if (isTrainer && (at.clientId || at.localPlanId)) {
    // The NAME, when the app knows it (S165). Without it the model has an opaque
    // id and nothing to call the person — it answered "I don't have a name for
    // the local plan file we're working with" while holding that very person's
    // plan. Sanitised: this is user-typed text landing in the system prompt.
    const who = String(at.name || "").replace(/[\r\n]+/g, " ").trim().slice(0, 60);
    const named = who ? `${JSON.stringify(who)} — ` : "";
    const which = at.clientId
      ? `${named}the CLIENT whose id is "${String(at.clientId).slice(0, 64)}" (pass it as clientId)`
      : `${named}one of YOUR OWN plan files, id "${String(at.localPlanId).slice(0, 64)}" (pass it as localPlanId). Treat them as a real client — most plan files are people without an app account`;
    system.push({ type: "text", text:
      `ACTIVE SUBJECT for THIS conversation: you are working with ${which}. Reuse this id directly for EVERY read, log, edit or removal in this conversation.`
      + (who ? ` Refer to them by name (${who}), never by the id.` : ``)
      + (at.pinned
        ? ` This chat is PINNED to them: every request here is about this same person unless the user explicitly names someone else, so do NOT call find_client / list_clients / list_local_plans here — you already have the id.`
        : ``) });
  }
  // The cached prompt tells the model it can search. Whenever it actually
  // can't, say so HERE rather than letting it believe otherwise and claim a
  // search it never ran. Kept as a separate block AFTER the cache breakpoint so
  // it can't invalidate the cached prefix.
  if (!searchAllowed) {
    system.push({ type: "text", text: noSearch
      ? "WEB SEARCH IS UNAVAILABLE in this context — the tool is not loaded here. This OVERRIDES the ask-before-you-search rule: do not offer to search, do not ask whether they want you to, and never say or imply that you looked anything up on the internet. Answer from your own knowledge and the person's own data."
      : "WEB SEARCH IS UNAVAILABLE for the rest of today: this person's daily web-search allowance is used up (it resets tomorrow). This OVERRIDES the ask-before-you-search rule — do NOT offer a search or ask whether they want one, because you could not run it if they said yes; offering something you cannot deliver is worse than not offering. If they ask you to look something up, say plainly that today's search allowance is used up and resets tomorrow, then answer from your own knowledge and flag it as such. Never imply you searched when you did not." });
  }
  // The server search tool rides alongside the normal (client-side) tools. Note
  // this changes the `tools` prefix, which is what prompt caching keys on — but
  // it's stable for a whole day per user, so the only churn is the single call
  // where the daily search allowance runs out.
  const tools = buildTools(role);
  if (searchAllowed) tools.push(webSearchTool());
  return {
    role, isTrainer, budget, usageRef, used, system,
    searchBudget, searchesUsed, searchAllowed,
    trialExpired: trialExpiredFor(profile),
    tools,
    toolCtx: { callerUid: uid, role, isTrainer, aiOptOut: profile.aiOptOut === true,
      today: todayLocal(), nowTime: nowTimeLocal(), callerName,
      seatCap: isAdminUid(uid) ? null : seatCapFor(profile) },
  };
}

// Accumulate the four token counts Anthropic reports (with caching split out).
function addUsage(agg, u) {
  agg.input += (u && u.input_tokens) || 0;
  agg.output += (u && u.output_tokens) || 0;
  agg.cacheWrite += (u && u.cache_creation_input_tokens) || 0;
  agg.cacheRead += (u && u.cache_read_input_tokens) || 0;
  // Server-tool usage (S184). Each web search is billed separately from tokens
  // ($10/1,000), so it has to be accumulated separately too — this is the number
  // the daily search allowance and the cost rollups are built on. Errored
  // searches are not billed and are not reported here.
  agg.searches += (u && u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
}

// Web search fails SOFTLY: the API returns HTTP 200 and puts the failure inside
// the result block, where `content` is a single error object instead of a list
// of results (too_many_requests, max_uses_exceeded, query_too_long, unavailable,
// …). Nothing throws, so without this a broken search is invisible on our side —
// all anyone sees is the model quietly answering from memory and guessing at why.
// Log the codes, and how many results actually came back, so the allowlist and
// the limits can be tuned against evidence rather than vibes.
function logSearchOutcome(content, fn) {
  const errors = [];
  let ok = 0, results = 0;
  for (const b of content || []) {
    if (!b || b.type !== "web_search_tool_result") continue;
    const c = b.content;
    if (Array.isArray(c)) { ok++; results += c.length; }
    else if (c && c.error_code) errors.push(c.error_code);
    else if (c && c.type === "web_search_tool_result_error") errors.push(c.error_code || "unknown");
  }
  if (errors.length || ok) {
    console.log("aiSearch", JSON.stringify({ fn, ok, results, errors }));
  }
}

// Pull the web-search citations off an assistant message so the app can show
// where an answer came from. Anthropic's terms require citing sources when API
// output is shown to end users, and cited_text/title/url are not billed — so
// there is no reason not to. Deduped by URL, newest-first, capped.
function collectSources(content, into) {
  // Dedupe on TITLE as well as URL. The same paper legitimately comes back under
  // several addresses (pubmed.ncbi.nlm.nih.gov/40093878, pmc.ncbi.nlm.nih.gov/
  // articles/PMC11906324, www.ncbi.nlm.nih.gov/pmc/articles/PMC11906324 are all
  // one study), and URL-only dedupe filled the whole list with three papers
  // wearing six names.
  // Normalise away the site suffix search engines append, so "Title - PubMed"
  // and "Title - PMC" are recognised as the one paper they are.
  const key = (t) => String(t || "").toLowerCase()
    .replace(/\s+[-–|]\s+[^-–|]{1,30}$/, "")
    .replace(/\s+/g, " ").trim();
  const add = (url, title) => {
    if (!url || into.length >= 6) return;
    const k = key(title);
    if (into.some((s) => s.url === url || (k && key(s.title) === k))) return;
    into.push({ url: String(url).slice(0, 300), title: String(title || url).slice(0, 160) });
  };
  for (const b of content || []) {
    if (!b || typeof b.type !== "string") continue;
    // What Claude actually cited, when citation blocks are present.
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) {
        if (c && c.type === "web_search_result_location") add(c.url, c.title);
      }
    // Otherwise the results themselves. Dynamic filtering consumes results
    // inside code execution and does not always attach citation blocks, so
    // without this fallback the source list is empty on most searched replies —
    // which is exactly what live testing showed.
    } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r && r.type === "web_search_result") add(r.url, r.title);
      }
    }
  }
}

// Execute one round of tool calls (server-side access checks live in runTool).
// Returns the tool_result blocks + whether a plan-changing write happened.
async function runToolRound(toolUses, toolCtx) {
  const results = [];
  let wrote = false;
  let proposal = null; // a propose_meal call → relay the meal so the client shows a card
  let workoutProposal = null; // a propose_workout call → relay the program for a card
  let activeTarget = null; // last client/plan the model actually addressed → remember it
  for (const tu of toolUses) {
    let out;
    const inp = tu.input || {};
    if (inp.clientId) activeTarget = { clientId: String(inp.clientId) };
    else if (inp.localPlanId) activeTarget = { localPlanId: String(inp.localPlanId) };
    let toolFailed = false;
    try { out = await runTool(tu.name, inp, toolCtx); }
    catch (e) {
      console.error("aiChat tool error:", tu.name, e && e.message);
      out = { error: "That action failed — nothing was saved." };
      toolFailed = true;
    }
    // A tool returning {error} did NOT do the thing. Mark it, or the model reads
    // an ordinary-looking result and tells the user it logged something it didn't.
    if (out && out.error) toolFailed = true;
    if (["log_meal", "log_meals", "plan_meals", "remove_meal", "log_workout", "log_weigh_in", "log_check_in", "log_measurements", "log_water", "set_targets", "set_workout_schedule", "set_personal_info", "create_plan", "switch_plan", "rename_plan", "set_notification_prefs", "add_custom_exercise"].includes(tu.name) && out && out.ok) wrote = true;
    if (tu.name === "propose_meal" && out && out.meal) proposal = out.meal;
    if (tu.name === "propose_workout" && out && out.workout) workoutProposal = out.workout;
    results.push({ type: "tool_result", tool_use_id: tu.id, is_error: toolFailed || undefined,
      content: JSON.stringify(out).slice(0, 60000) });
  }
  return { results, wrote, proposal, workoutProposal, activeTarget };
}

exports.aiChat = onCall({ secrets: AI_SECRETS, region: "us-central1", maxInstances: 10,
  timeoutSeconds: 300 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in to use the AI assistant.");

  const messages = capHistory(request.data && request.data.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new HttpsError("invalid-argument", "Send at least one user message.");
  }

  const reqTarget = (request.data && request.data.activeTarget) || null;
  const { budget, usageRef, used, system, tools, toolCtx, trialExpired,
    searchBudget, searchesUsed, searchAllowed } = await setupChat(uid, reqTarget,
      request.data && request.data.noSearch === true);
  if (trialExpired) {
    throw new HttpsError("permission-denied", TRIAL_EXPIRED_MSG, { reason: "trial-expired" });
  }
  if (used >= budget) {
    throw new HttpsError("resource-exhausted",
      "You've reached today's AI usage limit. It resets tomorrow.");
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const convo = messages.slice();
  // Mutable per-turn tool state: carries the search allowance so capTurnSearches
  // can withdraw the tool once this message has had its share, and lets callModel
  // recover if a request rejects the tool (see retrySearchFix).
  const state = { tools, searchOn: searchAllowed, searchesUsed, searchBudget };
  const agg = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0 };
  const paused = []; // text written before a pause_turn — same turn, kept (see below)
  let wrote = false; // a plan-changing write happened this turn → client should refresh
  let proposal = null; // a meal proposal to show as an Accept/Edit card
  let workoutProposal = null; // a workout-program proposal to show as an Accept card
  let activeTarget = reqTarget; // stays sticky across turns unless the model addresses a new subject
  const sources = []; // web-search citations to show under the reply
  let resp;
  try {
    resp = await callModel(client, state, { model: MODEL, max_tokens: MAX_TOKENS, system, messages: convo });
    addUsage(agg, resp.usage);
    collectSources(resp.content, sources);
    logSearchOutcome(resp.content, "aiChat");
    let rounds = 0;
    while ((resp.stop_reason === "tool_use" || resp.stop_reason === "pause_turn") && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      // A long server-tool turn (web search) can stop with pause_turn. There is
      // nothing for US to run — the continuation is simply the paused assistant
      // message sent back UNCHANGED, with no user turn after it. Handling this
      // is not optional once a server tool is declared: without it the turn ends
      // silently mid-search and the user gets a truncated answer.
      if (resp.stop_reason === "pause_turn") {
        // A pause CONTINUES the same assistant turn, so anything already written
        // is the first half of one answer — the model does not repeat it. Keep
        // it, or the reply comes back starting mid-thought with citations
        // attached to text the user never saw. (Deliberately not done for the
        // tool_use branch below, where a dropped preamble is what we want.)
        paused.push(...(resp.content || []).filter((b) => b.type === "text").map((b) => b.text));
        convo.push({ role: "assistant", content: resp.content });
        resp = await callModel(client, state, { model: MODEL, max_tokens: MAX_TOKENS, system, messages: convo });
        addUsage(agg, resp.usage);
        collectSources(resp.content, sources);
        logSearchOutcome(resp.content, "aiChat");
        continue;
      }
      const toolUses = (resp.content || []).filter((b) => b.type === "tool_use");
      const r = await runToolRound(toolUses, toolCtx);
      if (r.wrote) wrote = true;
      if (r.proposal) proposal = r.proposal;
      if (r.workoutProposal) workoutProposal = r.workoutProposal;
      if (r.activeTarget) activeTarget = keepName(r.activeTarget, activeTarget);
      convo.push({ role: "assistant", content: resp.content });
      convo.push({ role: "user", content: r.results });
      resp = await callModel(client, state, { model: MODEL, max_tokens: MAX_TOKENS, system, messages: convo });
      addUsage(agg, resp.usage);
      collectSources(resp.content, sources);
      logSearchOutcome(resp.content, "aiChat");
    }
  } catch (e) {
    console.error("aiChat Anthropic error:", e && e.message);
    throw new HttpsError("internal", "The AI assistant is temporarily unavailable. Please try again.");
  } finally {
    // Record spend even when a later tool round throws — tokens from the
    // completed rounds were real (they used to go unbilled on any mid-turn
    // error). Best-effort: a failed usage write must not fail a good reply.
    await aiusage.recordUsage(admin.firestore(), uid, { ...agg, model: MODEL }, "aiChat");
  }

  // Budget counts full-price tokens (cache reads bill at ~10%, so excluded).
  const spent = agg.input + agg.output + agg.cacheWrite;
  let text = [...paused, ...(resp.content || []).filter((b) => b.type === "text").map((b) => b.text)]
    .filter(Boolean).join("\n");
  // If we stopped because we hit MAX_TOOL_ROUNDS while the model still wanted to
  // call tools, those calls were DISCARDED — and its preamble ("logging all 8
  // now…") would otherwise be returned as if the work had happened.
  if (resp.stop_reason === "tool_use") text += "\n\n(I ran out of steps before finishing that — some of it may not have been saved. Please check, and ask me again for anything missing.)";
  else if (resp.stop_reason === "pause_turn") text += "\n\n(I ran out of steps while searching, so that answer is incomplete — ask me again and I'll pick it up.)";
  const totalUsed = used + spent;
  return {
    reply: text,
    wrote,
    proposal,
    workoutProposal,
    activeTarget,
    searches: agg.searches,
    sources,
    usage: { used: totalUsed, budget, warn: totalUsed >= budget * 0.8, breakdown: agg,
      searchesUsed: searchesUsed + agg.searches, searchBudget },
  };
});

// ── runAssistantTurn: headless one-shot AI turn for scheduled workflows (S92) ──
// Reuses the SAME setup/tools/budget/tool-loop as aiChat, but driven by a stored
// prompt instead of a live user. Meters spend against the user's daily budget and
// returns the reply text (or a `skipped` reason: budget / trial-expired / error).
// Callers must bind the ANTHROPIC_API_KEY secret.
async function runAssistantTurn(uid, userText) {
  const { system, tools, toolCtx, budget, usageRef, used, trialExpired } = await setupChat(uid, null, true);
  // Headless run: nobody can answer a seat confirm, and configuring an
  // automation that names its people IS the consent — so new AI-client seats
  // auto-consume here, bounded to 2 new seats per run so a broad prompt can't
  // burn the month unattended (still refused at the cap; S176f).
  toolCtx.seatAutoConfirm = 2;
  if (trialExpired) return { skipped: "trial-expired" };
  if (used >= budget) return { skipped: "budget" };
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const convo = [{ role: "user", content: userText }];
  // Scheduled automations do NOT get web search (S184) — setupChat(…, true)
  // above both withholds the tool and tells the model so. Nobody is watching a
  // headless run, so the "this searched the web and costs more of your
  // allowance" line that every interactive reply carries has nowhere to appear,
  // and an allowance quietly drained every morning by a summary the user never
  // asked to be researched is exactly the dishonesty the disclosure exists to
  // prevent.
  const state = { tools, searchOn: false };
  const agg = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0 };
  let resp;
  try {
    resp = await callModel(client, state, { model: MODEL, max_tokens: MAX_TOKENS, system, messages: convo });
    addUsage(agg, resp.usage);
    let rounds = 0;
    while ((resp.stop_reason === "tool_use" || resp.stop_reason === "pause_turn") && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      if (resp.stop_reason === "pause_turn") { // paused mid web search — resume unchanged (S184)
        convo.push({ role: "assistant", content: resp.content });
        resp = await callModel(client, state, { model: MODEL, max_tokens: MAX_TOKENS, system, messages: convo });
        addUsage(agg, resp.usage);
        continue;
      }
      const toolUses = (resp.content || []).filter((b) => b.type === "tool_use");
      const r = await runToolRound(toolUses, toolCtx);
      convo.push({ role: "assistant", content: resp.content });
      convo.push({ role: "user", content: r.results });
      resp = await callModel(client, state, { model: MODEL, max_tokens: MAX_TOKENS, system, messages: convo });
      addUsage(agg, resp.usage);
    }
  } catch (e) {
    console.error("runAssistantTurn error:", e && e.message);
    return { skipped: "error" };
  } finally {
    await aiusage.recordUsage(admin.firestore(), uid, { ...agg, model: MODEL }, "workflow");
  }
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { reply: text, spent: agg.input + agg.output + agg.cacheWrite };
}
exports.runAssistantTurn = runAssistantTurn;
exports.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
exports.tierFor = tierFor;
exports.isAdminUid = isAdminUid;

// Streaming variant (Stage 4): same logic, but an HTTP endpoint that streams the
// reply as Server-Sent Events so it appears word-by-word. Auth is verified from
// the `Authorization: Bearer <idToken>` header (callables do this automatically;
// onRequest must do it manually). The frontend uses this first and falls back to
// the callable (aiChat) if streaming fails.
exports.aiChatStream = onRequest(
  { secrets: AI_SECRETS, region: "us-central1", maxInstances: 10, cors: true,
    timeoutSeconds: 300 },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

    // Verify the Firebase ID token.
    let uid;
    try {
      const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
      if (!m) throw new Error("missing token");
      uid = (await admin.auth().verifyIdToken(m[1])).uid;
    } catch (e) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    const messages = capHistory(req.body && req.body.messages);
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      res.status(400).json({ error: "Send at least one user message." });
      return;
    }

    // A transient Firestore failure here must surface as a clean JSON 500 (the
    // frontend then falls back to the callable) — unwrapped, it was an
    // unhandled rejection with no response at all.
    const reqTarget = (req.body && req.body.activeTarget) || null;
    let setup;
    try { setup = await setupChat(uid, reqTarget, req.body && req.body.noSearch === true); } catch (e) {
      console.error("aiChatStream setup error:", e && e.message);
      res.status(500).json({ error: "setup-failed" });
      return;
    }
    const { budget, usageRef, used, system, tools, toolCtx, trialExpired,
      searchBudget, searchesUsed } = setup;

    // SSE response headers.
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (res.flushHeaders) res.flushHeaders();
    const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    if (trialExpired) {
      sse("error", { code: "trial-expired", message: TRIAL_EXPIRED_MSG });
      res.end();
      return;
    }
    if (used >= budget) {
      sse("error", { code: "resource-exhausted", message: "You've reached today's AI usage limit. It resets tomorrow." });
      res.end();
      return;
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const convo = messages.slice();
    const state = { tools, searchOn: setup.searchAllowed, searchesUsed, searchBudget };
    const agg = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0 };
    let wrote = false;
    let failed = false;
    let activeTarget = reqTarget; // sticky across turns unless the model addresses a new subject
    const sources = []; // web-search citations to show under the reply
    try {
      let rounds = 0;
      // Stream each model turn; run tools between turns until it stops calling them.
      for (;;) {
        const msg = await streamModel(client, state, { model: MODEL, max_tokens: MAX_TOKENS, system, messages: convo },
          (delta) => { if (delta) sse("delta", { text: delta }); });
        addUsage(agg, msg.usage);
        collectSources(msg.content, sources);
        logSearchOutcome(msg.content, "aiChatStream");
        // Paused mid web search (S184): resume by sending the paused assistant
        // message back UNCHANGED, with no user turn after it, and keep streaming.
        if (msg.stop_reason === "pause_turn" && rounds < MAX_TOOL_ROUNDS) {
          rounds++;
          convo.push({ role: "assistant", content: msg.content });
          continue;
        }
        if (msg.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
          rounds++;
          const toolUses = (msg.content || []).filter((b) => b.type === "tool_use");
          const r = await runToolRound(toolUses, toolCtx);
          if (r.wrote) wrote = true;
          if (r.activeTarget) activeTarget = keepName(r.activeTarget, activeTarget);
          if (r.proposal) sse("proposal", r.proposal); // client shows an Accept/Edit card
          if (r.workoutProposal) sse("workoutProposal", r.workoutProposal); // program Accept card
          convo.push({ role: "assistant", content: msg.content });
          convo.push({ role: "user", content: r.results });
          continue; // next turn streams
        }
        // Still wanting tools but out of rounds: those calls are DISCARDED, and
        // the text already streamed may claim work that never happened. Say so.
        if (msg.stop_reason === "tool_use") {
          sse("delta", { text: "\n\n(I ran out of steps before finishing that — some of it may not have been saved. Please check, and ask me again for anything missing.)" });
        } else if (msg.stop_reason === "pause_turn") {
          sse("delta", { text: "\n\n(I ran out of steps while searching, so that answer is incomplete — ask me again and I'll pick it up.)" });
        }
        break;
      }
    } catch (e) {
      console.error("aiChatStream error:", e && e.message);
      // Include `wrote` so a client can still refresh if a tool already saved
      // something before the failure (e.g. a logged meal on a dropped stream).
      failed = true;
      // Searches that already ran were BILLED and counted against the daily
      // allowance in the finally below, so they have to be disclosed even
      // though the turn failed — otherwise a dropped stream is the one path
      // where we spend someone's search allowance and never tell them.
      try { sse("error", { code: "internal", wrote, searches: agg.searches, sources,
        message: "The AI assistant is temporarily unavailable. Please try again." }); } catch { /* socket gone */ }
    } finally {
      // Record spend even on failure/disconnect — completed rounds were real
      // tokens (they used to go unbilled whenever a later round threw).
      await aiusage.recordUsage(admin.firestore(), uid, { ...agg, model: MODEL }, "aiChatStream");
    }
    if (failed) { res.end(); return; }
    const spent = agg.input + agg.output + agg.cacheWrite;
    const totalUsed = used + spent;
    sse("done", { wrote, activeTarget, searches: agg.searches, sources,
      usage: { used: totalUsed, budget, warn: totalUsed >= budget * 0.8, breakdown: agg,
        searchesUsed: searchesUsed + agg.searches, searchBudget } });
    res.end();
  }
);

// Direct meal write for the Accept/Edit confirmation card (Session 68). The card
// already has the macros (from propose_meal), so Accept saves WITHOUT another AI
// call — instant and free of tokens. Reuses the same log_meal write + the same
// server-side access checks (a client logs to themselves; a trainer to a verified
// client). No Anthropic secret needed — this only touches Firestore.
exports.logMeal = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in to log a meal.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const callerName = profile.displayName
    || [profile.firstName, profile.lastName].filter(Boolean).join(" ")
    || profile.email || (isTrainer ? "Coach" : "Client");
  const ctx = { callerUid: uid, role, isTrainer, today: todayLocal(), nowTime: nowTimeLocal(), callerName,
    seatCap: isAdminUid(uid) ? null : seatCapFor(profile) };
  let out;
  try { out = await runTool("log_meal", request.data || {}, ctx); }
  catch (e) { console.error("logMeal error:", e && e.message); throw new HttpsError("internal", "Couldn't save the meal."); }
  if (out && out.error) throw new HttpsError("failed-precondition", out.error);
  return out; // { ok, logged, dayTotals }
});

// Trainer taps confirm/adjust/reject on a meal a client tagged (S183g). Same
// pattern as logMeal: no Anthropic call, so it is instant and costs no tokens,
// and it runs through runTool so the access checks, the delta arithmetic on the
// day's totals and the client's notification are the ones already tested.
exports.reviewMeal = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const callerName = profile.displayName
    || [profile.firstName, profile.lastName].filter(Boolean).join(" ")
    || profile.email || "Coach";
  const ctx = { callerUid: uid, role, isTrainer, today: todayLocal(), nowTime: nowTimeLocal(), callerName,
    seatCap: isAdminUid(uid) ? null : seatCapFor(profile) };
  let out;
  try { out = await runTool("review_meal", request.data || {}, ctx); }
  catch (e) { console.error("reviewMeal error:", e && e.message); throw new HttpsError("internal", "Couldn't save that review."); }
  if (out && out.error) throw new HttpsError("failed-precondition", out.error);
  return out; // { ok, decision, dayTotals? }
});

// Direct workout-program write for the Accept card (Session 75). The card holds
// the validated program (from propose_workout); Accept writes it WITHOUT another
// AI call. Reuses the same set_workout_schedule write + server-side access checks
// (a client programs their own plan; a trainer a verified client's). No Anthropic
// secret — Firestore only.
exports.setWorkoutSchedule = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in to set a workout program.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const callerName = profile.displayName
    || [profile.firstName, profile.lastName].filter(Boolean).join(" ")
    || profile.email || (isTrainer ? "Coach" : "Client");
  const ctx = { callerUid: uid, role, isTrainer, today: todayLocal(), nowTime: nowTimeLocal(), callerName,
    seatCap: isAdminUid(uid) ? null : seatCapFor(profile) };
  let out;
  try { out = await runTool("set_workout_schedule", request.data || {}, ctx); }
  catch (e) { console.error("setWorkoutSchedule error:", e && e.message); throw new HttpsError("internal", "Couldn't save the program."); }
  if (out && out.error) throw new HttpsError("failed-precondition", out.error);
  return out; // { ok, replaced, updated, strengthDays, cardioDays }
});

// AI-client seats for the app's "AI clients this month" view (S176f). Reads the
// caller's own month doc + cap — Firestore only, no secret, no rules change
// (Admin SDK). Trainers only; clients have no seats to see.
exports.aiSeats = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  if (!(role === "head_trainer" || role === "sub_trainer" || role === "admin" || isAdminUid(uid))) {
    return { trainer: false };
  }
  const cap = isAdminUid(uid) ? null : seatCapFor(profile);
  const month = seatMonthKey();
  const cur = (await db.doc(`users/${uid}/aiClients/${month}`).get()).data() || {};
  const targets = Object.entries(cur.targets || {})
    .map(([key, v]) => ({ key, label: (v && v.label) || null, ts: (v && v.ts) || null }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { trainer: true, month, cap, used: cur.count || targets.length, targets };
});

// AI food estimate for the MANUAL meal tracker (S89c, Kevin's ask): the user
// types a food the library search doesn't have → one cheap direct model call
// returns estimated calories + macros to pre-fill the form (the user tweaks,
// then taps Add). No tools, no chat system prompt — a few hundred tokens per
// call. Rides the SAME daily token budget + trial gate as the chat, so it
// can't be farmed and it locks with the AI layer at trial expiry.
// Estimate the INTENSITY of a made-up exercise, as a MET (S183j).
//
// Why a MET and not calories: a MET is intensity per kilogram, so the same
// number produces the right burn for a 120 lb client and a 250 lb one through
// the formula every built-in exercise already uses. Asking the model for
// "calories per minute" would bake in one body and be wrong for everyone else —
// which is exactly how custom exercises behaved before this.
exports.estimateExercise = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const name = String((request.data && request.data.name) || "").trim().slice(0, 80);
    const type = (request.data && request.data.type) === "cardio" ? "cardio" : "strength";
    const notes = String((request.data && request.data.notes) || "").trim().slice(0, 300);
    if (!name) throw new HttpsError("invalid-argument", "Name the exercise first.");
    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    if (trialExpiredFor(profile)) {
      throw new HttpsError("permission-denied", TRIAL_EXPIRED_MSG, { reason: "trial-expired" });
    }
    const usageRef = db.doc(`users/${uid}/aiUsage/${todayKey()}`);
    const usageDoc = (await usageRef.get()).data() || {};
    const used = usageDoc.tokens || 0;
    const budget = (BUDGETS[tierFor(profile)] || BUDGETS.client) + (usageDoc.boost || 0);
    if (used >= budget) {
      throw new HttpsError("resource-exhausted", "You've reached today's AI usage limit. It resets tomorrow.");
    }
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    let msg;
    try {
      msg = await client.messages.create({
        model: MODEL, max_tokens: 200,
        system: "You estimate exercise intensity using the MET scale (Compendium of Physical Activities). "
          + 'Reply with ONLY a JSON object, no prose: {"met":number,"assumed":"short description of the effort you assumed"}. '
          + "MET is metabolic equivalent: 1 = sitting still, 3 = light effort, 6 = moderate, 8-10 = vigorous, "
          + "12+ = very hard (sprint intervals, competitive sport). Reference points: walking 3mph = 3.5, "
          + "weight training moderate = 5, cycling 14mph = 10, running 7mph = 11, burpees = 8, rowing hard = 12. "
          + "Strength work is usually 3-6 unless it is circuit or explosive. Be realistic and slightly "
          + "conservative — over-estimating burn makes someone eat more than they should. "
          + "Range 1-20. `assumed` says what effort level you pictured, e.g. 'steady moderate pace'.",
        messages: [{ role: "user", content: `${type} exercise: ${name}${notes ? `\nDetail: ${notes}` : ""}` }],
      });
    } catch (e) {
      console.error("estimateExercise API error:", e && e.message);
      throw new HttpsError("internal", "Couldn't estimate right now. Please try again.");
    }
    const u = msg.usage || {};
    await aiusage.recordUsage(db, uid, {
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
      model: MODEL,
    }, "estimateExercise").catch((e) => console.error("estimateExercise usage write failed:", e && e.message));
    const text = ((msg.content || []).find((b) => b.type === "text") || {}).text || "";
    const m = text.match(/\{[\s\S]*\}/);
    let out = null;
    try { out = m && JSON.parse(m[0]); } catch { /* handled below */ }
    const met = out && Number(out.met);
    if (!Number.isFinite(met) || met <= 0) {
      throw new HttpsError("internal", "Couldn't estimate that one — try describing it differently.");
    }
    return {
      met: Math.min(20, Math.max(1, Math.round(met * 10) / 10)),
      assumed: String((out && out.assumed) || "").slice(0, 120),
    };
  });

exports.estimateFood = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const desc = String((request.data && request.data.food) || "").trim().slice(0, 200);
    // Free-text context alongside a photo (S161, Kevin): what's in it, where it
    // came from, anything the camera can't show — cooking oil, a restaurant's
    // known portioning, "half of this was my kid's". Kept separate from `food` so
    // the logged entry keeps a short clean NAME while the model still gets the
    // detail. Longer cap than the name: this is prose, not a label.
    const notes = String((request.data && request.data.notes) || "").trim().slice(0, 600);
    // Optional meal PHOTO (S99): a base64 data URL. Validated through the same
    // rules as the chat's photo logging (sanitizeContent) — never store it, it
    // goes straight to the model and is discarded with the request.
    const rawImgs = Array.isArray(request.data && request.data.images)
      ? request.data.images : [(request.data && request.data.image) || ""];
    const imgBlocks = rawImgs.slice(0, 20).map(sanitizeImageDataUrl).filter(Boolean);
    const imgBlock = imgBlocks.length > 0; // legacy truthiness for the checks below
    if (!desc && !notes && !imgBlock) throw new HttpsError("invalid-argument", "Describe the food or add a photo first.");
    const db = admin.firestore();
    const profile = (await db.doc(`users/${uid}`).get()).data() || {};
    if (trialExpiredFor(profile)) {
      throw new HttpsError("permission-denied", TRIAL_EXPIRED_MSG, { reason: "trial-expired" });
    }
    const usageRef = db.doc(`users/${uid}/aiUsage/${todayKey()}`);
    const usageDoc = (await usageRef.get()).data() || {};
    const used = usageDoc.tokens || 0;
    const budget = (BUDGETS[tierFor(profile)] || BUDGETS.client) + (usageDoc.boost || 0);
    if (used >= budget) {
      throw new HttpsError("resource-exhausted", "You've reached today's AI usage limit. It resets tomorrow.");
    }
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    let msg;
    try {
      msg = await client.messages.create({
        model: MODEL, max_tokens: 250,
        system: "You estimate nutrition for foods and meals. Reply with ONLY a JSON object, no prose: "
          + '{"name":"short food name","calories":int,"protein":int,"carbs":int,"fat":int,"assumed":"short serving you assumed","grams":number,"unit":"g"|"ml"}. '
          + "`name` is a short label for the food (e.g. \"Chicken burrito\"). "
          + "Macros in grams. `grams` = the weight (or volume for a drink) of the serving you assumed, and "
          + "`unit` is \"g\" for solids or \"ml\" for liquids — this lets the user rescale by exact amount. "
          + "If no quantity is given, assume ONE typical realistic serving and say what you assumed (e.g. "
          + "\"1 medium bowl, ~350g\" with grams:350, unit:\"g\"; or \"1 cup, 240ml\" with grams:240, unit:\"ml\"). "
          + "Use common US portions."
          + (imgBlock ? ` The user attached ${imgBlocks.length > 1 ? `${imgBlocks.length} PHOTOS` : "a PHOTO"} of the food`
            + (imgBlocks.length > 1 ? " (different angles or parts of the SAME meal — estimate it ONCE as one meal, don't double-count)" : "")
            + ". Identify what is on the plate and "
            + "estimate the portion from visual size cues (plate/bowl/utensil scale). Set `assumed` to "
            + "what you saw and the portion you judged (e.g. \"chicken breast + rice, ~1.5 cups\"). "
            + "Include invisible cooking fats/oils and dressings in the calorie estimate." : "")
          // The user's own note outranks the photo wherever the two disagree:
          // they know the restaurant, the recipe and what they actually ate.
          // A photo cannot show cooking oil, a protein scoop, or that half the
          // plate went uneaten — that is exactly what the note is for.
          + (notes ? " The user also wrote a description of this meal. TRUST IT over what the "
            + "image appears to show wherever they conflict — they know what was in it, where it "
            + "came from and how much they actually ate. Use it for anything not visible "
            + "(oils, sauces, brands, restaurant portions, leftovers) and reflect it in `assumed`." : ""),
        messages: [{
          role: "user",
          content: imgBlock
            ? [...imgBlocks, { type: "text", text: "Estimate this meal."
                + (desc ? ` The user says it is: ${desc}` : "")
                + (notes ? `\nTheir description: ${notes}` : "") }]
            : `Estimate: ${desc}${notes ? `\nDetails: ${notes}` : ""}`,
        }],
      });
    } catch (e) {
      console.error("estimateFood API error:", e && e.message);
      throw new HttpsError("internal", "Couldn't estimate right now. Please try again.");
    }
    // Bill against the daily budget exactly like the chat (input+output+cacheWrite).
    const u = msg.usage || {};
    // Awaited, unlike the pre-S167 single write it replaces: a callable's
    // instance can be frozen the moment it returns, and a fire-and-forget write
    // that never lands is a call the user got for free. Costs ~50ms.
    await aiusage.recordUsage(db, uid, {
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
      model: MODEL,
    }, "estimateFood").catch((e) => console.error("estimateFood usage write failed:", e && e.message));
    const text = ((msg.content || []).find((b) => b.type === "text") || {}).text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let out = null;
    try { out = jsonMatch && JSON.parse(jsonMatch[0]); } catch { /* fall through to error below */ }
    const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
    if (!out || n(out.calories) == null) {
      throw new HttpsError("internal", "Couldn't estimate that one — try rephrasing it.");
    }
    const g = Number(out.grams);
    return {
      name: String(out.name || "").slice(0, 60),
      calories: n(out.calories),
      protein: n(out.protein) || 0, carbs: n(out.carbs) || 0, fat: n(out.fat) || 0,
      assumed: String(out.assumed || "").slice(0, 120),
      grams: Number.isFinite(g) && g > 0 ? Math.round(g) : null,
      unit: out.unit === "ml" ? "ml" : "g",
    };
  }
);

// ── requestBudgetBoost (S90, Kevin's design) ────────────────────────────────
// Max-tier users who hit the daily AI ceiling can request more usage from the
// chat and get INSTANTLY approved: a +50% same-day boost, once per day. The
// boost rides the day's aiUsage doc (expires automatically at the daily reset)
// and every grant is recorded to users/{uid}/aiUsage/meta — boostCount /
// boostDates feed the admin dashboard so chronic ceiling-hitters are VISIBLE
// (flagged for awareness, never auto-punished — Kevin's call). Only granted
// when genuinely near the cap (≥80% spent) so boosts can't be stockpiled.
// S179i: fixed +15k steps for the client base instead of a flat percentage, so
// the ladder is predictable and matches what Kevin specified: 45k base → 60k on
// the first ask → 75k on the second, which is the ceiling. Higher tiers keep
// the proportional +50% (a percentage of 150k/250k is the sensible unit there).
const BOOST_FRACTION = 0.5;
const BOOST_STEP_BASE = 15000;   // client/assisted/trial: 45k → 60k → 75k
// Boosts per day by tier (Kevin, S90): Coach Max absorbs 2 boosts and stays
// profitable at the absolute ceiling (~$68 worst-case vs $79); client Max
// gets 1 (2 would put an every-day-maxer underwater vs $29.99). Chronic
// hitters surface via the ⚑ flag → Kevin can raise a standing limit by hand.
// S179i: the base tiers get boosts too (previously Elite+ only). A lower base
// only works if hitting it starts a conversation instead of ending the day.
const BOOSTS_PER_DAY = {
  client: 2, assisted: 2, trial: 2, trainer: 2,
  trainerMax: 2, clientMax: 1, trainerUltra: 2, clientUltra: 1,
};
exports.requestBudgetBoost = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const tier = tierFor(profile);
  const isBoostable = tier === "clientMax" || tier === "trainerMax"
    || tier === "clientUltra" || tier === "trainerUltra";
  const isMaxTier = tier === "clientMax" || tier === "trainerMax"; // Max, not yet Ultra
  const isAdmin = isAdminUid(uid); // lets Kevin exercise the flow
  if (!isBoostable && !isAdmin) return { granted: false, reason: "not-max" };
  const base = BUDGETS[tier] || BUDGETS.client;
  const ref = db.doc(`users/${uid}/aiUsage/${todayKey()}`);
  const usage = (await ref.get()).data() || {};
  const boostsUsed = usage.boosts || (usage.boost ? 1 : 0);
  const maxBoosts = BOOSTS_PER_DAY[tier] || 1;
  if (boostsUsed >= maxBoosts) return { granted: false, reason: "already-boosted" };
  // "Near the limit" is measured against the CURRENT effective cap (base +
  // any prior boost), so a second boost can't be banked early.
  if ((usage.tokens || 0) < (base + (usage.boost || 0)) * 0.8) return { granted: false, reason: "not-near-limit" };
  // Base client tiers step by a fixed 15k (45→60→75); bigger tiers scale by %.
  const step = (tier === "client" || tier === "assisted" || tier === "trial" || tier === "trainer")
    ? BOOST_STEP_BASE
    : Math.round(base * BOOST_FRACTION);
  const boost = (usage.boost || 0) + step;
  await ref.set({ boost, boosts: boostsUsed + 1, boostAt: Date.now() }, { merge: true });
  // Cumulative boost counter (Kevin's Ultra-upsell trigger): a Max user who
  // keeps needing boosts is a heavy user who belongs on Ultra — prompt them on
  // the 3rd boost and every 3rd after (6th, 9th…). Ultra users don't get upsold.
  const metaRef = db.doc(`users/${uid}/aiUsage/meta`);
  const priorCount = ((await metaRef.get()).data() || {}).boostCount || 0;
  const newCount = priorCount + 1;
  await metaRef.set({
    boostCount: admin.firestore.FieldValue.increment(1),
    lastBoostAt: Date.now(),
    boostDates: admin.firestore.FieldValue.arrayUnion(todayKey()),
  }, { merge: true });
  const suggestUltra = isMaxTier && newCount % 3 === 0;
  console.log("budgetBoost granted", JSON.stringify({ uid, tier, boost, newCount, suggestUltra }));
  return { granted: true, boostTokens: boost, boostCount: newCount, suggestUltra };
});
