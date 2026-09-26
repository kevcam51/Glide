// Smooth Training HQ — talk to the crew, in the HQ itself (S238b).
//
// Kevin: "I need to be able to communicate with my staff ... a one stop shop.
// a place that i can talk to them directly, or have a link that will take me
// directly to them in claude app when needed." An agent's profile has two
// doors: "Talk here" is this file; "Open in Claude" is a link saved per agent
// (hq.js setCrewLink) or a new Claude chat started with the agent's brief.
//
// An agent here is its brief (src/hqOrg.js agentBrief, mirrored into
// hqCrew.json by `npm run gen:hq-crew` — functions can't import the app), plus
// a note on where it is. It runs on Glidna's own Anthropic account, the same
// model as the Glidna AI. What it can do here, and nothing else:
//   • read the owner's desk, and put work on it (a new, OPEN desk item — the
//     crew rules' only write: nothing is sent, paid, published or deleted);
//   • when its job includes Glidna, read clients' progress with the same
//     read-only tools the crew's guard allows in a routine.
// Gmail, QuickBooks and Zapier live in the Claude app, so an agent that needs
// one says so and points Kevin at "Open in Claude".
//
// ⚠️ OWNER ONLY, SERVER-CHECKED, like hqApi: the uid is checked here, and
// hqChats/{seat} has no match in firestore.rules, so no browser reads it.
// ⚠️ ITS COST GOES ON THE AGENT'S TIME CARD (engine "cloud"), never through
// aiusage.recordUsage under the owner's uid, or the spending sheet counts the
// same dollars twice (S238 round 2). One card per conversation: a quiet half
// hour, or "New topic", starts the next one.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { postDeskItem, HQ_LIMITS, _sanitizeShift: sanitizeShift } = require("./hq");
const { runHqTool } = require("./hqtools");
const aiusage = require("./aiusage");
const CREW = require("./hqCrew.json").crew;

// Admin is a UID, never a profile role (S199g/h); scripts/test-target-parity.mjs
// requires every copy to match.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];

// The Glidna AI's model (aichat.js MODEL); scripts/test-hq-chat.mjs keeps them equal.
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;
const MAX_ROUNDS = 5;               // tool rounds per message, as in the Glidna AI
const KEEP = 80;                    // messages stored per agent
const CONTEXT = 20;                 // messages the model sees, after the last new topic
const TEXT_MAX = 4000;
const SESSION_GAP_MS = 30 * 60 * 1000;   // a quiet half hour closes a time card
const PRESENCE_MS = 10 * 60 * 1000;      // shown at the desk this long after a message
const TZ = "America/New_York";

// Glidna's read-only tools: the Glidna reads the crew's guard allows
// (docs/hq/crew-repo/.claude/hooks/crew-guard.sh), less the food search, which
// needs the food proxy's secrets and no crew job uses. The suite checks both
// the guard and buildTools() still name every one.
const GLIDNA_READS = new Set([
  "get_profile", "get_nutrition_log", "get_nutrition_targets", "get_measurements", "list_plans",
  "list_exercises", "list_notes", "list_clients", "find_client", "coach_summary", "list_local_plans",
  "list_sub_trainers", "list_meal_reviews",
]);

const { KINDS } = HQ_LIMITS;
const DESK_TOOLS = [
  {
    name: "hq_read_desk",
    description: "Read what is waiting on Kevin's HQ desk (open items, newest first) and the crew's latest time cards. "
      + "Use it before filing, so you don't file something already there, or when Kevin asks what's waiting.",
    input_schema: {
      type: "object",
      properties: { includeBody: { type: "boolean", description: "Include each item's full text (off by default)." } },
    },
  },
  {
    name: "hq_file_report",
    description: "Put a finished piece of work on Kevin's HQ desk: a plan, a draft for him to send himself, a "
      + "decision, a question or a heads-up. Filing sends, pays and publishes NOTHING: the desk is where Kevin "
      + "decides. Use it when he asks you to, or when you've produced something he should keep. Quote only "
      + "figures you actually read; never estimate a money figure.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: KINDS, description: "report, draft (for him to review and send himself), question (needs his answer), alert (needs attention soon) or note." },
        title: { type: "string", description: "One line, under 120 characters." },
        summary: { type: "string", description: "One to three plain sentences he reads first." },
        body: { type: "string", description: "The full piece in plain text. Short headed sections and dash lists read best." },
        headNote: { type: "string", description: "What you checked, the way your department head would, and anything he should double-check." },
      },
      required: ["kind", "title", "summary"],
    },
  },
];

let _Anthropic = null;
const anthropicClient = (apiKey) => {
  if (!_Anthropic) _Anthropic = require("@anthropic-ai/sdk");
  return new _Anthropic({ apiKey });
};

function bad(msg) { return new HttpsError("invalid-argument", msg); }
// eslint-disable-next-line no-control-regex
const plain = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);

function seatOf(id) {
  const key = String(id || "");
  return Object.prototype.hasOwnProperty.call(CREW, key) ? { id: key, ...CREW[key] } : null;
}

// The brief ends with "Here's what I need:", written for pasting into a chat;
// its HQ paragraph tells a Claude-app chat to clock in by hand. Here both are
// replaced by where the agent actually is and what it can reach.
function systemFor(seat, now) {
  const brief = seat.brief.replace(/\n+Here's what I need:\s*$/, "")
    .replace(/\n+My HQ: when we start, clock in[^\n]*$/m, "");
  const glidna = seat.apps.includes("Glidna");
  const elsewhere = seat.apps.filter((a) => a !== "Glidna");
  const day = new Date(now).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const lines = [
    brief,
    "",
    "Where you are: I'm talking with you inside my Glidna HQ, at your desk, not in the Claude app. I often read on my phone, so keep replies short: plain sentences, a dash list at most, no tables or headings.",
    `What you can use here: hq_read_desk to see what's waiting on my desk, and hq_file_report to put a plan, a draft or a decision on it (filing sends nothing)${glidna ? ", and Glidna's read-only tools to look at clients' progress" : ""}. Clocking in and your time card happen on their own here, so there is no hq_clock_in or hq_log_shift.`,
  ];
  if (elsewhere.length) {
    lines.push(`You can't reach ${elsewhere.join(" or ")} from here. When the job needs ${elsewhere.length > 1 ? "one of them" : "it"}, say so and tell me to tap "Open in Claude" on your profile.`);
  }
  lines.push(`Today is ${day} in Miami.`);
  return lines.join("\n");
}

// The messages the model sees: everything after the last "new topic", the
// latest CONTEXT of them, starting with one of mine.
function contextOf(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let from = 0;
  list.forEach((m, i) => { if (m && m.role === "topic") from = i + 1; });
  const talk = list.slice(from).filter((m) => m && (m.role === "user" || m.role === "assistant") && m.text);
  const recent = talk.slice(-CONTEXT);
  while (recent.length && recent[0].role !== "user") recent.shift();
  return recent;
}

const shown = (messages) => (Array.isArray(messages) ? messages : []).slice(-KEEP)
  .map((m) => ({ role: m.role, text: m.text || "", at: m.at || null }));

function addUsage(agg, u) {
  agg.input += (u && u.input_tokens) || 0;
  agg.output += (u && u.output_tokens) || 0;
  agg.cacheWrite += (u && u.cache_creation_input_tokens) || 0;
  agg.cacheRead += (u && u.cache_read_input_tokens) || 0;
}

async function runCrewTool(name, input, { db, seat, ctx, runTool, now }) {
  try {
    if (name === "hq_read_desk") return await runHqTool("hq_read_desk", input || {}, { db, now });
    if (name === "hq_file_report") {
      const i = input || {};
      // The seat, its department and the engine come from here, never from
      // the model: an agent files as itself, from Glidna's cloud.
      const id = await postDeskItem(db, {
        worker: seat.id, dept: seat.room, kind: i.kind, title: i.title, summary: i.summary, body: i.body,
        headNote: i.headNote, engine: "cloud",
      }, now);
      return { ok: true, deskItemId: id, filed: "On Kevin's HQ desk, waiting for him. Nothing was sent." };
    }
    if (GLIDNA_READS.has(name) && seat.apps.includes("Glidna")) return await runTool(name, input || {}, ctx);
    return { error: `"${name}" isn't a tool you have here.` };
  } catch (e) {
    return { error: (e && e.message) || "That didn't work; nothing was changed." };
  }
}

// Presence: the agent is drawn at its desk, working, while the conversation
// lasts. `until` lets the HQ stop showing it after a quiet ten minutes.
async function atDesk(db, seat, since, now) {
  await db.collection("hqActive").doc(seat.id).set({
    worker: seat.id, dept: seat.room, task: "Talking with you in the HQ", since, until: now + PRESENCE_MS, endedAt: null,
  });
}
async function leaveDesk(db, seat, now) {
  await db.collection("hqActive").doc(seat.id).set({ endedAt: now }, { merge: true });
}

async function send(db, seat, uid, data, deps, now) {
  const text = plain(data.text, TEXT_MAX);
  if (!text) throw bad("Write something to send.");
  const ref = db.collection("hqChats").doc(seat.id);
  const snap = await ref.get();
  const thread = (snap.exists && snap.data()) || {};
  const convo = contextOf(thread.messages).map((m) => ({ role: m.role, content: m.text }));
  convo.push({ role: "user", content: text });

  const profile = ((await db.doc(`users/${uid}`).get()).data()) || {};
  const role = profile.role || "head_trainer";
  const glidna = seat.apps.includes("Glidna");
  const tools = [...DESK_TOOLS, ...(glidna ? deps.buildTools(role).filter((t) => GLIDNA_READS.has(t.name)) : [])];
  const ctx = {
    callerUid: uid, role, isTrainer: role === "head_trainer" || role === "sub_trainer" || role === "admin",
    aiOptOut: false,
    today: new Date(now).toLocaleDateString("en-CA", { timeZone: TZ }),
    nowTime: new Date(now).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }),
    callerName: profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Kevin",
    seatCap: deps.seatCapFor ? deps.seatCapFor(profile, uid) : undefined,
  };
  const system = [{ type: "text", text: systemFor(seat, now), cache_control: { type: "ephemeral" } }];
  const agg = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let reply = "";
  let failed = null;
  try {
    const client = deps.getClient();
    let resp;
    for (let round = 0; ; round++) {
      resp = await client.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, tools, messages: convo });
      addUsage(agg, resp && resp.usage);
      if (!resp || resp.stop_reason !== "tool_use" || round >= MAX_ROUNDS) break;
      convo.push({ role: "assistant", content: resp.content });
      const results = [];
      for (const b of resp.content || []) {
        if (!b || b.type !== "tool_use") continue;
        const out = await runCrewTool(b.name, b.input, { db, seat, ctx, runTool: deps.runTool, now });
        results.push({ type: "tool_result", tool_use_id: b.id, is_error: out && out.error ? true : undefined,
          content: JSON.stringify(out).slice(0, 60000) });
      }
      convo.push({ role: "user", content: results });
    }
    reply = ((resp && resp.content) || []).filter((b) => b && b.type === "text").map((b) => b.text).join("\n").trim();
    if (!reply) reply = "I looked into it but ran out of steps before I could answer. Ask me again, a little narrower.";
  } catch (e) {
    failed = e;
    console.error("hqCrewChat: the model call failed", seat.id, e && (e.status || e.code), e && e.message);
  }

  // Whatever happened, tokens spent are real money: they go on the time card.
  const micros = aiusage.costMicros(agg, MODEL);
  const spent = agg.input + agg.output + agg.cacheWrite + agg.cacheRead > 0;
  let session = thread.session || null;
  if (!session || session.closed || now - (session.lastAt || 0) > SESSION_GAP_MS) {
    session = { startedAt: now, lastAt: now, turns: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, costMicros: 0 };
  }
  session = {
    ...session, lastAt: now, turns: session.turns + (failed ? 0 : 1),
    input: session.input + agg.input, output: session.output + agg.output,
    cacheWrite: session.cacheWrite + agg.cacheWrite, cacheRead: session.cacheRead + agg.cacheRead,
    costMicros: session.costMicros + micros,
  };

  let messages = thread.messages || [];
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const t = (cur.exists && cur.data()) || {};
    messages = Array.isArray(t.messages) ? t.messages : [];
    // A failed reply stores nothing of the conversation, so resending the
    // same message doesn't leave it in the thread twice.
    if (!failed) messages = [...messages, { role: "user", text, at: now }, { role: "assistant", text: reply, at: now }].slice(-KEEP);
    tx.set(ref, { seat: seat.id, messages, session, updatedAt: now });
  });

  if (spent || !failed) {
    const turns = session.turns;
    const shift = sanitizeShift({
      worker: seat.id, dept: seat.room, engine: "cloud", status: failed ? "failed" : "done",
      startedAt: session.startedAt, endedAt: now,
      summary: `Talked with you in the HQ: ${turns} message${turns === 1 ? "" : "s"} answered.`,
      usage: { inputTokens: session.input + session.cacheWrite + session.cacheRead, outputTokens: session.output },
      costCents: session.costMicros / 10000,
    }, now);
    await db.collection("hqShifts").doc(`chat-${seat.id}-${session.startedAt}`).set({ ...shift, loggedAt: now });
  }
  if (failed) {
    throw new HttpsError("unavailable", "Couldn't reach the AI just now. Your message wasn't sent; try it again.");
  }
  await atDesk(db, seat, session.startedAt, now);
  return { reply, messages: shown(messages) };
}

async function newTopic(db, seat, now) {
  const ref = db.collection("hqChats").doc(seat.id);
  let messages = [];
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const t = (cur.exists && cur.data()) || {};
    messages = Array.isArray(t.messages) ? t.messages : [];
    // Nothing to close off: a second "new topic" in a row changes nothing.
    if (messages.length && messages[messages.length - 1].role !== "topic") {
      messages = [...messages, { role: "topic", text: "", at: now }].slice(-KEEP);
    }
    const session = t.session ? { ...t.session, closed: true } : null;
    tx.set(ref, { seat: seat.id, messages, session, updatedAt: now });
  });
  await leaveDesk(db, seat, now);
  return { messages: shown(messages) };
}

async function handleCrewChat(request, deps) {
  const { db, now = Date.now() } = deps;
  const uid = request && request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!ADMIN_UIDS.includes(uid)) throw new HttpsError("permission-denied", "The HQ is only open to the owner.");
  const data = (request && request.data) || {};
  const action = String(data.action || "load");
  const seat = seatOf(data.seat);
  if (!seat) throw bad("seat must be one of the crew's seats.");
  if (action === "load") {
    const snap = await db.collection("hqChats").doc(seat.id).get();
    return { messages: shown(snap.exists ? (snap.data() || {}).messages : []) };
  }
  if (action === "send") return send(db, seat, uid, data, deps, now);
  if (action === "newTopic") return newTopic(db, seat, now);
  if (action === "end") { await leaveDesk(db, seat, now); return { ok: true }; }
  throw bad(`Unknown action "${action}".`);
}

// Declared once in aichat.js; the same secret, mounted here too.
const { ANTHROPIC_API_KEY } = require("./aichat");

exports.hqCrewChat = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1", maxInstances: 5, timeoutSeconds: 120 },
  (request) => {
    const { buildTools, runTool, seatCapFor } = require("./aitools");
    return handleCrewChat(request, {
      db: admin.firestore(), buildTools, runTool, seatCapFor,
      getClient: () => anthropicClient(ANTHROPIC_API_KEY.value()),
    });
  },
);

// For the suite.
exports._handleCrewChat = handleCrewChat;
exports._systemFor = systemFor;
exports._contextOf = contextOf;
exports.CREW_CHAT = { MODEL, GLIDNA_READS, DESK_TOOLS, KEEP, CONTEXT, SESSION_GAP_MS, PRESENCE_MS, TEXT_MAX };
