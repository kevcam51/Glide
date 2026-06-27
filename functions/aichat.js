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

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");
const { buildTools, runTool } = require("./aitools");

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

exports.aiChat = onCall({ secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in to use the AI assistant.");

  const messages = capHistory(request.data && request.data.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new HttpsError("invalid-argument", "Send at least one user message.");
  }

  const db = admin.firestore();
  const profile = (await db.doc(`users/${uid}`).get()).data() || {};
  const role = profile.role || "client";
  const tier = tierFor(profile);
  const budget = BUDGETS[tier] || BUDGETS.client;

  // Daily token budget: read usage, block at 100%.
  const usageRef = db.doc(`users/${uid}/aiUsage/${todayKey()}`);
  const used = ((await usageRef.get()).data() || {}).tokens || 0;
  if (used >= budget) {
    throw new HttpsError("resource-exhausted",
      "You've reached today's AI usage limit. It resets tomorrow.");
  }

  const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
  const baseSystem = (role === "client") ? SYSTEM_CLIENT : SYSTEM_TRAINER;
  const system = `${baseSystem}

Today's date is ${todayLocal()} (use it to resolve "today", "yesterday", "this week", etc.).

You have tools to read the user's real logged data — use them whenever a question depends on actual numbers (what they ate, their targets, client activity) rather than guessing. Call get_nutrition_targets to know the goals before judging whether a day was over/under. Don't expose internal ids to the user; refer to clients by name.

You can also TAKE ACTIONS for the user via tools — but you must CONFIRM the specifics first and only act after an explicit go-ahead (never act prematurely):
- log_meal: estimate calories + protein/carbs/fat from a described meal, show the breakdown, ask the meal type if unclear, support corrections ("make it one egg"), then log it. If the user sends a PHOTO of food, identify the items and portions from the image, then estimate + confirm + log the same way (note out loud that photo estimates are approximate).
- log_workout: mark a day as a workout day (with an optional note).
- log_weigh_in: record a body-weight weigh-in (confirm the number).
- set_targets: change the plan's protein/carbs/fat targets and/or goal weight (this edits the plan — confirm exact numbers first).
${isTrainer ? "- send_client_request: send a connected client a to-do that shows on their home (e.g. log food, weigh in). For clients, first call list_clients to get the id; confirm the message before sending.\nAs a trainer you can do these FOR a client by passing their clientId — use it to organize clients, nudge them, and tune their plans." : ""}
After any action, briefly confirm what you did.`;

  const callerName = profile.displayName
    || [profile.firstName, profile.lastName].filter(Boolean).join(" ")
    || profile.email || (isTrainer ? "Coach" : "Client");
  const tools = buildTools(role);
  const toolCtx = { callerUid: uid, role, isTrainer, today: todayLocal(), callerName };
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

  // Function-calling loop: the model may call tools (which read Firestore with
  // server-side access checks), we feed results back, repeat until it answers.
  // Bounded by MAX_TOOL_ROUNDS to cap latency/cost; usage accumulates for the
  // daily budget.
  const MAX_TOOL_ROUNDS = 5;
  const convo = messages.slice();
  let spent = 0;
  let wrote = false; // a meal was logged this turn → tell the client to refresh
  let resp;
  try {
    resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools, messages: convo });
    spent += (resp.usage && (resp.usage.input_tokens + resp.usage.output_tokens)) || 0;
    let rounds = 0;
    while (resp.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const toolUses = (resp.content || []).filter((b) => b.type === "tool_use");
      const results = [];
      for (const tu of toolUses) {
        let out;
        try { out = await runTool(tu.name, tu.input || {}, toolCtx); }
        catch (e) { console.error("aiChat tool error:", tu.name, e && e.message); out = { error: "That action failed." }; }
        if (["log_meal", "log_workout", "log_weigh_in", "set_targets"].includes(tu.name) && out && out.ok) wrote = true;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 60000) });
      }
      convo.push({ role: "assistant", content: resp.content });
      convo.push({ role: "user", content: results });
      resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools, messages: convo });
      spent += (resp.usage && (resp.usage.input_tokens + resp.usage.output_tokens)) || 0;
    }
  } catch (e) {
    console.error("aiChat Anthropic error:", e && e.message);
    throw new HttpsError("internal", "The AI assistant is temporarily unavailable. Please try again.");
  }

  await usageRef.set({ tokens: admin.firestore.FieldValue.increment(spent),
    updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const totalUsed = used + spent;
  return {
    reply: text,
    wrote,
    usage: { used: totalUsed, budget, warn: totalUsed >= budget * 0.8 },
  };
});
