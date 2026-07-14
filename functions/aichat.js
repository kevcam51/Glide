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
const Anthropic = require("@anthropic-ai/sdk");
const { buildTools, runTool } = require("./aitools");
const { GLIDNA_KNOWLEDGE } = require("./knowledge");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const MODEL = "claude-sonnet-4-6";

// Daily token budgets (input + output) by tier — from the spec's cost-controls.
// clientMax/trainerMax are the paid "Max" tiers (S89c): PUBLISHED high
// allowances (~100 AI conversations/day) — honest fair-use ceilings, never
// marketed as "unlimited" (Kevin's call; see docs/PRICING.md).
// Admin UID (matches functions/index.js + firestore.rules) — gets an unlimited AI
// budget so Kevin can test freely without running out of tokens.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
const BUDGETS = { trial: 50000, client: 25000, assisted: 40000, trainer: 100000,
  // trainerTrial (S92): a trainer works with clients from day one, so their trial
  // usage is heavy immediately (~180k/day for an active 20–30-client roster). Give
  // the full Coach-Elite-level allowance during the trial so they never hit a wall
  // and can fully experience client management before deciding to buy.
  trainerTrial: 200000,
  clientMax: 150000, trainerMax: 200000,
  // Ultra (S92): data-triggered heavy-user tiers, surfaced via the boost upsell.
  clientUltra: 250000, trainerUltra: 400000 };

function tierFor(profile) {
  const role = (profile && profile.role) || "client";
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

Always be encouraging, clear, and concise. Avoid jargon unless the client has demonstrated familiarity.

Formatting: replies render in a narrow mobile chat. Keep them short. Use plain text with dashes for lists and **bold** for short labels. Do NOT use markdown tables, headings, or code blocks.`;

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

Formatting: replies render in a narrow mobile chat. Keep them short. Use plain text with dashes for lists and **bold** for short labels. Do NOT use markdown tables, headings, or code blocks.`;

// UTC YYYY-MM-DD key for the per-user daily usage doc.
function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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
    } else if (allowImages && images < 2 && b.type === "image" && b.source && b.source.type === "base64"
        && IMG_TYPES.has(b.source.media_type) && typeof b.source.data === "string"
        && b.source.data.length <= MAX_IMG_B64) {
      images++;
      blocks.push({ type: "image", source: { type: "base64", media_type: b.source.media_type, data: b.source.data } });
    }
  }
  return blocks.length ? blocks : null;
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
    // Images are only honored on the FINAL message (the frontend only attaches
    // one there anyway) and capped at 2 — history images would be re-billed as
    // vision input on every tool round, a crafted-payload cost hole otherwise.
    const content = sanitizeContent(m.content, i === arr.length - 1);
    if (content == null) continue;
    clean.push({ role: m.role, content });
  }
  return clean.slice(-HISTORY_MSGS);
}

const MAX_TOOL_ROUNDS = 10; // headroom for bulk actions (e.g. logging a batch of meals at once)

// Build the role-aware system prompt (shared by the callable + the stream fn).
function buildSystemPrompt(role, isTrainer) {
  const baseSystem = (role === "client") ? SYSTEM_CLIENT : SYSTEM_TRAINER;
  return `${baseSystem}

Today's date is ${todayLocal()} (use it to resolve "today", "yesterday", "this week", etc.).

Dates: you can log to and review any PAST date. When the user names another day ("yesterday", "last Monday", "my Saturday weigh-in"), resolve it to YYYY-MM-DD and pass it as the date arg to log_meal/propose_meal/log_workout/log_weigh_in — don't assume today. For history ("what did I eat last week?") use get_nutrition_log with start/end dates. Confirm the date if ambiguous.

Meal times: each meal carries the clock time eaten (a "time" field like "19:45"). When the user says WHEN they ate, pass it as the time arg; else it defaults to now. get_nutrition_log returns times, so you can spot time-of-day patterns (late-night snacking, skipped breakfasts).

Read real data: use the read tools whenever a question depends on actual numbers rather than guessing; call get_nutrition_targets before judging a day over/under. For ADVICE/feedback (not a quick log or fact), first call get_nutrition_log for the recent week or two and tailor guidance to the real patterns (meal timing, day-of-week habits, adherence, weight trend) instead of generic tips — but don't over-fetch for simple logging. Don't expose internal ids; refer to clients by name.

TAKING ACTIONS: you must CONFIRM the specifics and get an explicit go-ahead before any write — never act prematurely:
- Logging food: from a description OR a PHOTO (identify items/portions from the image), estimate calories + P/C/F, then call propose_meal to show a tappable Accept/Edit card. Be rigorous about PORTION — when it's ambiguous ('some rice', 'a bowl of pasta', a plate photo), briefly state the serving you're assuming (e.g. '~1 cup / 200g') or ask, so grams aren't a blind guess. Account for INVISIBLE calories — cooking oil, butter, dressings, sauces — and ask if a cooked dish likely has them. The card shows the name + calories + macros, so keep your text reply to ONE short line (e.g. "Here's my estimate — tap to log.") — don't re-list items or repeat macros, even for a long list. The card saves it — do NOT also call log_meal. Ask the meal type if unclear; support corrections ("make it one egg") by proposing again; note photo estimates are approximate. MULTIPLE foods at once (the user lists or photographs several distinct foods/meals to log): do NOT use propose_meal — its card shows only ONE at a time and forces a tap per item. call the log_meals tool ONCE with ALL the items in its meals array — that saves every one together in a single call (no cards, no tapping). Do NOT call log_meal repeatedly and do NOT narrate ("logging all 8 now") without actually making the log_meals call — a write only happens when the tool is called. When the user has already given you the list of foods, THAT is your go-ahead: after any needed client-id lookup, immediately call log_meals in the SAME turn (don't stop after the lookup). Then give a brief one-line-per-item summary and note they can edit/remove any in "Meals & Food Today" or ask you to change one. Reserve the single propose_meal Accept card for when there is exactly ONE food/meal.
- Paste-from-another-AI: a pasted ChatGPT/Claude reply may contain several meals (and workouts/weigh-ins). Extract EVERY loggable item, summarize as a short list, and confirm. On confirm, log all: call log_meal once PER meal (right type + date if stated), plus log_workout/log_weigh_in — a single propose_meal card only when there's exactly one meal. If nothing's loggable, say so.
- log_workout: mark a day as a workout day (optional note). log_weigh_in: record a weigh-in (confirm the number).
- Tape measurements (non-scale progress): fully supported for people who prefer the tape to the scale. On shared measurements confirm the numbers then call log_measurements (inches; any subset of waist/hips/neck/thigh/calf/forearm/wrist; merges into the same date). Body-fat % + waist-to-height (goal under 0.5) compute automatically. For "how's my waist/body fat trending?" call get_measurements. Frame tape body-fat as an estimate (±2%), emphasize the TREND, and never pressure a scale-averse user to weigh. For body fat, ask for the needed fields (men: waist, hips, forearm, wrist; women: hips, thigh, calf, wrist).
- set_targets: change protein/carbs/fat targets and/or goal weight (confirm exact numbers first).
- Onboarding: if a plan lacks the basics (no calorie target), offer to set it up by chat. Call get_profile FIRST and ask ONLY for the fields it lists as missing (never re-ask for info already set). Full set: gender, age, height, current weight, everyday activity, goal weight. Save with set_personal_info as values come in; when complete, tell them their daily calorie target. Confirm first only to overwrite an existing value.
- Plans / phases: a person can have several plans (cut/maintenance/bulk), one active. list_plans to see them, switch_plan to change active, create_plan to START A PHASE (carries over their stats; pass goalWeightLbs, then build targets/workouts). Confirm before create/switch. Refer to plans by NAME, not id.
- Workout PROGRAM: to create/edit a training program, call list_exercises FIRST for the real ids, design a balanced week, summarize it briefly, then call propose_workout (a tappable Accept card — don't also call set_workout_schedule for it). Adjust and re-propose on changes. Use set_workout_schedule directly only if they say to skip the card. Keep it realistic for their experience/days. For a movement not in list_exercises (e.g. Battle Ropes, Sled Push), call add_custom_exercise first (estimate cal/min) then use the returned id — but prefer standard exercises.
- Notes: on "write this down / remember this / make a note / save a recap", use create_note (recaps → kind='recap'). A client's note is PRIVATE by default — only share (visible to trainer) if they clearly want that. A trainer using clientId writes a private about-note by default (shared=true puts it where the client sees it). Before re-recapping, call list_notes and UPDATE the existing note (update_note, append) instead of duplicating. Never reveal a client's private notes to anyone but that client.
- Links/videos (Instagram, YouTube, TikTok, blogs): when the user shares a URL to USE ("add the exercises from this", "make a program from this", "log this recipe"), call fetch_link for its title + caption, then build changes with the normal tools (workouts: list_exercises → propose_workout, add_custom_exercise as needed; food: propose_meal). Summarize what you found first and map named moves to the closest real ids. If fetch_link returns little or errors (some posts are blocked), don't guess — ask the user to paste the caption text. Adapt the content to the user's goal/days/experience, don't copy blindly.
${isTrainer ? "- send_client_request: send a connected client a to-do (e.g. log food, weigh in); call list_clients first for the id, confirm before sending.\n- Proactive coaching: for cross-client questions ('who's stalled / needs attention / what should I change?'), call coach_summary ONCE (every client's status + adherence + weight trend — don't loop per-client tools), then call out who needs attention BY NAME with concrete recommendations and offer to send a to-do. You can do any action FOR a client via their clientId.\n- LOCAL PLAN FILES: trainers also keep local plan files (imported Trainerize clients, prep/template files, simulations) separate from client accounts. When the trainer refers to one, call list_local_plans and pass its localPlanId to the other tools (never with clientId); refer to them by NAME. All the same abilities work on them. IMPORTANT: if the trainer names a person you can't find via list_clients, ALSO check list_local_plans before assuming they aren't in Glide — most of a trainer's people are local/imported/sim files, and read+edit (stats, targets, workouts, meals, weigh-ins) works FULLY on them. Never tell a trainer to 'connect' a plan you can manage locally. Only send_client_request (to-dos) and messaging truly need a connected client account — those can't reach a local/sim file because there's no login on the other end; say so plainly if asked." : ""}
After any action, briefly confirm what you did — but only AFTER the tool call actually succeeded. A write only happens when you call the tool; text alone never changes any data, so never claim you did something you didn't actually call a tool for.

Voice & tone: talk like a normal, calm human texting — NOT hyped. Minimal exclamation points (usually none). Don't narrate your internal steps ("let me pull up the client list", "got the ID, logging now") — just quietly do the work and report the result. Skip filler and hype; be warm but plain.

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

async function setupChat(uid, activeTarget) {
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
    const which = at.clientId
      ? `the CLIENT whose id is "${String(at.clientId).slice(0, 64)}" (pass it as clientId)`
      : `YOUR OWN local plan/sim whose id is "${String(at.localPlanId).slice(0, 64)}" (pass it as localPlanId)`;
    system.push({ type: "text", text:
      `ACTIVE SUBJECT for THIS conversation: you are working with ${which}. Reuse this id directly for EVERY read, log, edit, and follow-up here — do NOT call list_clients or list_local_plans again to re-find them. Only look up a different subject if the user clearly names another person/plan or asks to switch; then that becomes the new active subject.` });
  }
  return {
    role, isTrainer, budget, usageRef, used, system,
    trialExpired: trialExpiredFor(profile),
    tools: buildTools(role),
    toolCtx: { callerUid: uid, role, isTrainer, today: todayLocal(), nowTime: nowTimeLocal(), callerName },
  };
}

// Accumulate the four token counts Anthropic reports (with caching split out).
function addUsage(agg, u) {
  agg.input += (u && u.input_tokens) || 0;
  agg.output += (u && u.output_tokens) || 0;
  agg.cacheWrite += (u && u.cache_creation_input_tokens) || 0;
  agg.cacheRead += (u && u.cache_read_input_tokens) || 0;
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
    try { out = await runTool(tu.name, inp, toolCtx); }
    catch (e) { console.error("aiChat tool error:", tu.name, e && e.message); out = { error: "That action failed." }; }
    if (["log_meal", "log_meals", "remove_meal", "log_workout", "log_weigh_in", "log_check_in", "log_measurements", "log_water", "set_targets", "set_workout_schedule", "set_personal_info", "create_plan", "switch_plan", "rename_plan", "set_notification_prefs", "add_custom_exercise"].includes(tu.name) && out && out.ok) wrote = true;
    if (tu.name === "propose_meal" && out && out.meal) proposal = out.meal;
    if (tu.name === "propose_workout" && out && out.workout) workoutProposal = out.workout;
    results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 60000) });
  }
  return { results, wrote, proposal, workoutProposal, activeTarget };
}

exports.aiChat = onCall({ secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in to use the AI assistant.");

  const messages = capHistory(request.data && request.data.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new HttpsError("invalid-argument", "Send at least one user message.");
  }

  const reqTarget = (request.data && request.data.activeTarget) || null;
  const { budget, usageRef, used, system, tools, toolCtx, trialExpired } = await setupChat(uid, reqTarget);
  if (trialExpired) {
    throw new HttpsError("permission-denied", TRIAL_EXPIRED_MSG, { reason: "trial-expired" });
  }
  if (used >= budget) {
    throw new HttpsError("resource-exhausted",
      "You've reached today's AI usage limit. It resets tomorrow.");
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const convo = messages.slice();
  const agg = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let wrote = false; // a plan-changing write happened this turn → client should refresh
  let proposal = null; // a meal proposal to show as an Accept/Edit card
  let workoutProposal = null; // a workout-program proposal to show as an Accept card
  let activeTarget = reqTarget; // stays sticky across turns unless the model addresses a new subject
  let resp;
  try {
    resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools, messages: convo });
    addUsage(agg, resp.usage);
    let rounds = 0;
    while (resp.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const toolUses = (resp.content || []).filter((b) => b.type === "tool_use");
      const r = await runToolRound(toolUses, toolCtx);
      if (r.wrote) wrote = true;
      if (r.proposal) proposal = r.proposal;
      if (r.workoutProposal) workoutProposal = r.workoutProposal;
      if (r.activeTarget) activeTarget = r.activeTarget;
      convo.push({ role: "assistant", content: resp.content });
      convo.push({ role: "user", content: r.results });
      resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools, messages: convo });
      addUsage(agg, resp.usage);
    }
  } catch (e) {
    console.error("aiChat Anthropic error:", e && e.message);
    throw new HttpsError("internal", "The AI assistant is temporarily unavailable. Please try again.");
  } finally {
    // Record spend even when a later tool round throws — tokens from the
    // completed rounds were real (they used to go unbilled on any mid-turn
    // error). Best-effort: a failed usage write must not fail a good reply.
    const spent = agg.input + agg.output + agg.cacheWrite;
    if (spent > 0) {
      console.log("aiUsage", JSON.stringify({ fn: "aiChat", ...agg, spent }));
      await usageRef.set({ tokens: admin.firestore.FieldValue.increment(spent),
        updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        .catch((err) => console.error("aiUsage write failed:", err && err.message));
    }
  }

  // Budget counts full-price tokens (cache reads bill at ~10%, so excluded).
  const spent = agg.input + agg.output + agg.cacheWrite;
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const totalUsed = used + spent;
  return {
    reply: text,
    wrote,
    proposal,
    workoutProposal,
    activeTarget,
    usage: { used: totalUsed, budget, warn: totalUsed >= budget * 0.8, breakdown: agg },
  };
});

// ── runAssistantTurn: headless one-shot AI turn for scheduled workflows (S92) ──
// Reuses the SAME setup/tools/budget/tool-loop as aiChat, but driven by a stored
// prompt instead of a live user. Meters spend against the user's daily budget and
// returns the reply text (or a `skipped` reason: budget / trial-expired / error).
// Callers must bind the ANTHROPIC_API_KEY secret.
async function runAssistantTurn(uid, userText) {
  const { system, tools, toolCtx, budget, usageRef, used, trialExpired } = await setupChat(uid);
  if (trialExpired) return { skipped: "trial-expired" };
  if (used >= budget) return { skipped: "budget" };
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const convo = [{ role: "user", content: userText }];
  const agg = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let resp;
  try {
    resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools, messages: convo });
    addUsage(agg, resp.usage);
    let rounds = 0;
    while (resp.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const toolUses = (resp.content || []).filter((b) => b.type === "tool_use");
      const r = await runToolRound(toolUses, toolCtx);
      convo.push({ role: "assistant", content: resp.content });
      convo.push({ role: "user", content: r.results });
      resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools, messages: convo });
      addUsage(agg, resp.usage);
    }
  } catch (e) {
    console.error("runAssistantTurn error:", e && e.message);
    return { skipped: "error" };
  } finally {
    const spent = agg.input + agg.output + agg.cacheWrite;
    if (spent > 0) {
      console.log("aiUsage", JSON.stringify({ fn: "workflow", ...agg, spent }));
      await usageRef.set({ tokens: admin.firestore.FieldValue.increment(spent),
        updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    }
  }
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { reply: text, spent: agg.input + agg.output + agg.cacheWrite };
}
exports.runAssistantTurn = runAssistantTurn;
exports.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
exports.tierFor = tierFor;

// Streaming variant (Stage 4): same logic, but an HTTP endpoint that streams the
// reply as Server-Sent Events so it appears word-by-word. Auth is verified from
// the `Authorization: Bearer <idToken>` header (callables do this automatically;
// onRequest must do it manually). The frontend uses this first and falls back to
// the callable (aiChat) if streaming fails.
exports.aiChatStream = onRequest(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 10, cors: true },
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
    try { setup = await setupChat(uid, reqTarget); } catch (e) {
      console.error("aiChatStream setup error:", e && e.message);
      res.status(500).json({ error: "setup-failed" });
      return;
    }
    const { budget, usageRef, used, system, tools, toolCtx, trialExpired } = setup;

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
    const agg = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let wrote = false;
    let failed = false;
    let activeTarget = reqTarget; // sticky across turns unless the model addresses a new subject
    try {
      let rounds = 0;
      // Stream each model turn; run tools between turns until it stops calling them.
      for (;;) {
        const stream = client.messages.stream({ model: MODEL, max_tokens: 1024, system, tools, messages: convo });
        stream.on("text", (delta) => { if (delta) sse("delta", { text: delta }); });
        const msg = await stream.finalMessage();
        addUsage(agg, msg.usage);
        if (msg.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
          rounds++;
          const toolUses = (msg.content || []).filter((b) => b.type === "tool_use");
          const r = await runToolRound(toolUses, toolCtx);
          if (r.wrote) wrote = true;
          if (r.activeTarget) activeTarget = r.activeTarget;
          if (r.proposal) sse("proposal", r.proposal); // client shows an Accept/Edit card
          if (r.workoutProposal) sse("workoutProposal", r.workoutProposal); // program Accept card
          convo.push({ role: "assistant", content: msg.content });
          convo.push({ role: "user", content: r.results });
          continue; // next turn streams
        }
        break;
      }
    } catch (e) {
      console.error("aiChatStream error:", e && e.message);
      // Include `wrote` so a client can still refresh if a tool already saved
      // something before the failure (e.g. a logged meal on a dropped stream).
      failed = true;
      try { sse("error", { code: "internal", wrote, message: "The AI assistant is temporarily unavailable. Please try again." }); } catch { /* socket gone */ }
    } finally {
      // Record spend even on failure/disconnect — completed rounds were real
      // tokens (they used to go unbilled whenever a later round threw).
      const spent = agg.input + agg.output + agg.cacheWrite;
      if (spent > 0) {
        console.log("aiUsage", JSON.stringify({ fn: "aiChatStream", ...agg, spent }));
        await usageRef.set({ tokens: admin.firestore.FieldValue.increment(spent),
          updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
          .catch((err) => console.error("aiUsage write failed:", err && err.message));
      }
    }
    if (failed) { res.end(); return; }
    const spent = agg.input + agg.output + agg.cacheWrite;
    const totalUsed = used + spent;
    sse("done", { wrote, activeTarget, usage: { used: totalUsed, budget, warn: totalUsed >= budget * 0.8, breakdown: agg } });
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
  const ctx = { callerUid: uid, role, isTrainer, today: todayLocal(), nowTime: nowTimeLocal(), callerName };
  let out;
  try { out = await runTool("log_meal", request.data || {}, ctx); }
  catch (e) { console.error("logMeal error:", e && e.message); throw new HttpsError("internal", "Couldn't save the meal."); }
  if (out && out.error) throw new HttpsError("failed-precondition", out.error);
  return out; // { ok, logged, dayTotals }
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
  const ctx = { callerUid: uid, role, isTrainer, today: todayLocal(), nowTime: nowTimeLocal(), callerName };
  let out;
  try { out = await runTool("set_workout_schedule", request.data || {}, ctx); }
  catch (e) { console.error("setWorkoutSchedule error:", e && e.message); throw new HttpsError("internal", "Couldn't save the program."); }
  if (out && out.error) throw new HttpsError("failed-precondition", out.error);
  return out; // { ok, replaced, updated, strengthDays, cardioDays }
});

// AI food estimate for the MANUAL meal tracker (S89c, Kevin's ask): the user
// types a food the library search doesn't have → one cheap direct model call
// returns estimated calories + macros to pre-fill the form (the user tweaks,
// then taps Add). No tools, no chat system prompt — a few hundred tokens per
// call. Rides the SAME daily token budget + trial gate as the chat, so it
// can't be farmed and it locks with the AI layer at trial expiry.
exports.estimateFood = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const desc = String((request.data && request.data.food) || "").trim().slice(0, 200);
    if (!desc) throw new HttpsError("invalid-argument", "Describe the food first.");
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
          + '{"calories":int,"protein":int,"carbs":int,"fat":int,"assumed":"short serving you assumed"}. '
          + "Macros in grams. If no quantity is given, assume ONE typical realistic serving and say what "
          + "you assumed (e.g. \"1 medium bowl, ~350g\"). Use common US portions.",
        messages: [{ role: "user", content: `Estimate: ${desc}` }],
      });
    } catch (e) {
      console.error("estimateFood API error:", e && e.message);
      throw new HttpsError("internal", "Couldn't estimate right now. Please try again.");
    }
    // Bill against the daily budget exactly like the chat (input+output+cacheWrite).
    const u = msg.usage || {};
    const spent = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
    usageRef.set({ tokens: admin.firestore.FieldValue.increment(spent),
      updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      .catch((e) => console.error("estimateFood usage write failed:", e && e.message));
    const text = ((msg.content || []).find((b) => b.type === "text") || {}).text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let out = null;
    try { out = jsonMatch && JSON.parse(jsonMatch[0]); } catch { /* fall through to error below */ }
    const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
    if (!out || n(out.calories) == null) {
      throw new HttpsError("internal", "Couldn't estimate that one — try rephrasing it.");
    }
    return {
      calories: n(out.calories),
      protein: n(out.protein) || 0, carbs: n(out.carbs) || 0, fat: n(out.fat) || 0,
      assumed: String(out.assumed || "").slice(0, 120),
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
const BOOST_FRACTION = 0.5;
// Boosts per day by tier (Kevin, S90): Coach Max absorbs 2 boosts and stays
// profitable at the absolute ceiling (~$68 worst-case vs $79); client Max
// gets 1 (2 would put an every-day-maxer underwater vs $29.99). Chronic
// hitters surface via the ⚑ flag → Kevin can raise a standing limit by hand.
const BOOSTS_PER_DAY = { trainerMax: 2, clientMax: 1, trainerUltra: 2, clientUltra: 1 };
exports.requestBudgetBoost = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const tier = tierFor(profile);
  const isBoostable = tier === "clientMax" || tier === "trainerMax"
    || tier === "clientUltra" || tier === "trainerUltra";
  const isMaxTier = tier === "clientMax" || tier === "trainerMax"; // Max, not yet Ultra
  const isAdmin = profile.role === "admin"; // lets Kevin exercise the flow
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
  const boost = (usage.boost || 0) + Math.round(base * BOOST_FRACTION);
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
