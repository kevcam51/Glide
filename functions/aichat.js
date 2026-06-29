// Glide AI chat — Stage 1 (text chat).
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
const { GLIDE_KNOWLEDGE } = require("./knowledge");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const MODEL = "claude-sonnet-4-6";

// Daily token budgets (input + output) by tier — from the spec's cost-controls.
const BUDGETS = { trial: 10000, client: 25000, assisted: 40000, trainer: 60000 };

function tierFor(profile) {
  const role = (profile && profile.role) || "client";
  if (role === "head_trainer" || role === "sub_trainer" || role === "admin") return "trainer";
  // client: trainer-assisted (linked) gets a higher budget than self-serve;
  // a still-in-trial / non-active subscription gets the trial budget.
  if (profile && profile.subscriptionStatus && profile.subscriptionStatus !== "active"
      && profile.subscriptionStatus !== "trial") return "trial";
  if (profile && profile.subscriptionStatus === "trial") return "trial";
  if (profile && profile.assignedTrainerId) return "assisted";
  return "client";
}

// Role-based system prompts (topic-restricted to health & fitness), per the spec.
const SYSTEM_CLIENT = `You are a nutrition and fitness assistant for Glide, a personal training platform.

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

const SYSTEM_TRAINER = `You are a fitness coaching assistant for Glide, a personal training platform.

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

// Allowed image media types + a base64 size cap (~7MB) for photo meal logging.
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMG_B64 = 7 * 1024 * 1024;

// Sanitize one message's content: a plain string, or an array of text/image
// blocks (photo logging). Returns a safe content value, or null to drop it.
function sanitizeContent(content) {
  if (typeof content === "string") return content.slice(0, 8000);
  if (!Array.isArray(content)) return null;
  const blocks = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") {
      blocks.push({ type: "text", text: b.text.slice(0, 8000) });
    } else if (b.type === "image" && b.source && b.source.type === "base64"
        && IMG_TYPES.has(b.source.media_type) && typeof b.source.data === "string"
        && b.source.data.length <= MAX_IMG_B64) {
      blocks.push({ type: "image", source: { type: "base64", media_type: b.source.media_type, data: b.source.data } });
    }
  }
  return blocks.length ? blocks : null;
}

// Keep only the last 10 exchanges (20 messages) to cap context cost (spec §6).
function capHistory(messages) {
  const arr = Array.isArray(messages) ? messages : [];
  const clean = [];
  for (const m of arr) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const content = sanitizeContent(m.content);
    if (content == null) continue;
    clean.push({ role: m.role, content });
  }
  return clean.slice(-20);
}

const MAX_TOOL_ROUNDS = 5;

// Build the role-aware system prompt (shared by the callable + the stream fn).
function buildSystemPrompt(role, isTrainer) {
  const baseSystem = (role === "client") ? SYSTEM_CLIENT : SYSTEM_TRAINER;
  return `${baseSystem}

Today's date is ${todayLocal()} (use it to resolve "today", "yesterday", "this week", etc.).

Dates / calendar: you can log to PAST dates and review any date. When the user mentions a different day ("I ran yesterday", "I had this for lunch on Monday", "log my Saturday weigh-in"), resolve it to a YYYY-MM-DD date and pass it as the date argument to log_meal/propose_meal/log_workout/log_weigh_in — don't assume everything is today. To review or summarize history ("what did I eat last week?", "how was my Tuesday?"), use get_nutrition_log with the right start/end dates. Confirm the date if it's ambiguous.

You have tools to read the user's real logged data — use them whenever a question depends on actual numbers (what they ate, their targets, client activity) rather than guessing. Call get_nutrition_targets to know the goals before judging whether a day was over/under. Don't expose internal ids to the user; refer to clients by name.

You can also TAKE ACTIONS for the user via tools — but you must CONFIRM the specifics first and only act after an explicit go-ahead (never act prematurely):
- Logging food: when the user describes a meal (or sends a PHOTO of food — identify the items/portions from the image), estimate calories + protein/carbs/fat, note the estimate briefly in text, then call propose_meal to show them a tappable Accept/Edit card. The card saves it — do NOT also call log_meal. Ask the meal type if unclear, and support corrections ("make it one egg") by proposing again. For photos, mention the estimate is approximate. Only use log_meal directly if the user explicitly says to log without a confirmation card.
- log_workout: mark a day as a workout day (with an optional note).
- log_weigh_in: record a body-weight weigh-in (confirm the number).
- set_targets: change the plan's protein/carbs/fat targets and/or goal weight (this edits the plan — confirm exact numbers first).
- Onboarding / personal info: if a plan is missing the basics (the dashboard shows no calorie target), offer to set it up by chat. ALWAYS call get_profile FIRST and only ask for the fields it lists as "missing" — never ask for info that's already set (don't re-ask for their weight or goal if get_profile already has them). The full set is gender, age, height, current weight, everyday activity level, and goal weight. As the user provides values, call set_personal_info to save them (you can save what they've given so far, then ask for what's still missing). Once the profile is complete, tell them their daily calorie target. Only confirm first if you'd overwrite an existing value with a different one.
- Plans / phases: a person can have several plans (e.g. a cut, a maintenance phase, a bulk), with one active. Use list_plans to see them, switch_plan to change which is active, and create_plan to START A NEW PHASE — create_plan carries over their personal stats by default so they don't re-enter them; pass goalWeightLbs for the phase's goal, then build its targets/workouts with the other tools. Confirm before creating or switching. Don't expose plan ids to the user — refer to plans by name.
- Building a workout PROGRAM: when asked to create/draft/edit a training program (e.g. a trainer dictates what they want for a client, or "build me a 4-day split"), first call list_exercises to get the real exercise ids, design a sensible balanced week, summarize it briefly in text, then call propose_workout — that shows the user a tappable Accept card to save it (don't also call set_workout_schedule for the same program). If they want changes, adjust and propose again. Only use set_workout_schedule directly if they say to set it without a card. Keep it realistic for their experience and days available. If they want a movement that isn't in list_exercises (e.g. Battle Ropes, Sled Push), call add_custom_exercise first (estimate its calories/minute) and then use the id it returns in the program — but prefer standard exercises when something fits.
${isTrainer ? "- send_client_request: send a connected client a to-do that shows on their home (e.g. log food, weigh in). For clients, first call list_clients to get the id; confirm the message before sending.\n- Proactive coaching: for cross-client questions ('who's stalled / falling behind this week?', 'who needs attention?', 'what should I change?'), call coach_summary ONCE to get every client's status (inactive / stalled / off_track / on_track / logging) with their adherence + weight trend — don't loop the per-client tools. Then call out who needs attention by NAME and give specific, concrete recommendations (e.g. nudge to log, adjust calories/protein, revisit the goal). Offer to send a to-do (send_client_request) where it helps.\nAs a trainer you can do these FOR a client by passing their clientId — use it to organize clients, nudge them, and tune their plans." : ""}
After any action, briefly confirm what you did.

${GLIDE_KNOWLEDGE}`;
}

// Read the caller's profile → role, budget, today's usage, system prompt, tools,
// and the tool-execution context. Shared by both entry points.
async function setupChat(uid) {
  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const tier = tierFor(profile);
  const budget = BUDGETS[tier] || BUDGETS.client;
  const usageRef = db.doc(`users/${uid}/aiUsage/${todayKey()}`);
  const used = ((await usageRef.get()).data() || {}).tokens || 0;
  const callerName = profile.displayName
    || [profile.firstName, profile.lastName].filter(Boolean).join(" ")
    || profile.email || (isTrainer ? "Coach" : "Client");
  // Cache the stable prefix (tools render before system, so a cache_control
  // breakpoint on the system block caches tools + system together). This part is
  // identical across calls within a day, so repeat messages + tool rounds pay
  // ~10% for it instead of full price (Session 67). No effect on output quality.
  const system = [{ type: "text", text: buildSystemPrompt(role, isTrainer), cache_control: { type: "ephemeral" } }];
  return {
    role, isTrainer, budget, usageRef, used, system,
    tools: buildTools(role),
    toolCtx: { callerUid: uid, role, isTrainer, today: todayLocal(), callerName },
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
  for (const tu of toolUses) {
    let out;
    try { out = await runTool(tu.name, tu.input || {}, toolCtx); }
    catch (e) { console.error("aiChat tool error:", tu.name, e && e.message); out = { error: "That action failed." }; }
    if (["log_meal", "log_workout", "log_weigh_in", "set_targets", "set_workout_schedule", "set_personal_info", "create_plan", "switch_plan", "add_custom_exercise"].includes(tu.name) && out && out.ok) wrote = true;
    if (tu.name === "propose_meal" && out && out.meal) proposal = out.meal;
    if (tu.name === "propose_workout" && out && out.workout) workoutProposal = out.workout;
    results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 60000) });
  }
  return { results, wrote, proposal, workoutProposal };
}

exports.aiChat = onCall({ secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in to use the AI assistant.");

  const messages = capHistory(request.data && request.data.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new HttpsError("invalid-argument", "Send at least one user message.");
  }

  const { budget, usageRef, used, system, tools, toolCtx } = await setupChat(uid);
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
      convo.push({ role: "assistant", content: resp.content });
      convo.push({ role: "user", content: r.results });
      resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools, messages: convo });
      addUsage(agg, resp.usage);
    }
  } catch (e) {
    console.error("aiChat Anthropic error:", e && e.message);
    throw new HttpsError("internal", "The AI assistant is temporarily unavailable. Please try again.");
  }

  // Budget counts full-price tokens (cache reads bill at ~10%, so excluded).
  const spent = agg.input + agg.output + agg.cacheWrite;
  console.log("aiUsage", JSON.stringify({ fn: "aiChat", ...agg, spent }));
  await usageRef.set({ tokens: admin.firestore.FieldValue.increment(spent),
    updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const totalUsed = used + spent;
  return {
    reply: text,
    wrote,
    proposal,
    workoutProposal,
    usage: { used: totalUsed, budget, warn: totalUsed >= budget * 0.8, breakdown: agg },
  };
});

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

    const { budget, usageRef, used, system, tools, toolCtx } = await setupChat(uid);

    // SSE response headers.
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (res.flushHeaders) res.flushHeaders();
    const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    if (used >= budget) {
      sse("error", { code: "resource-exhausted", message: "You've reached today's AI usage limit. It resets tomorrow." });
      res.end();
      return;
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const convo = messages.slice();
    const agg = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let wrote = false;
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
      sse("error", { code: "internal", message: "The AI assistant is temporarily unavailable. Please try again." });
      res.end();
      return;
    }

    const spent = agg.input + agg.output + agg.cacheWrite;
    console.log("aiUsage", JSON.stringify({ fn: "aiChatStream", ...agg, spent }));
    await usageRef.set({ tokens: admin.firestore.FieldValue.increment(spent),
      updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    const totalUsed = used + spent;
    sse("done", { wrote, usage: { used: totalUsed, budget, warn: totalUsed >= budget * 0.8, breakdown: agg } });
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
  const ctx = { callerUid: uid, role, isTrainer, today: todayLocal(), callerName };
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
  const ctx = { callerUid: uid, role, isTrainer, today: todayLocal(), callerName };
  let out;
  try { out = await runTool("set_workout_schedule", request.data || {}, ctx); }
  catch (e) { console.error("setWorkoutSchedule error:", e && e.message); throw new HttpsError("internal", "Couldn't save the program."); }
  if (out && out.error) throw new HttpsError("failed-precondition", out.error);
  return out; // { ok, replaced, updated, strengthDays, cardioDays }
});
