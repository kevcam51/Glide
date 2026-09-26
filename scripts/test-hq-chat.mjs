// Smooth Training HQ — talking to the crew in the HQ (S238b, functions/hqChat.js)
// and the saved "Open in Claude" links (functions/hq.js).
//
// RUN, not read: the handler is driven with a scripted model and a Firestore
// double. What must hold:
//   • only the owner, refused before a single read;
//   • an agent can read the desk and file to it, as ITSELF, from the cloud —
//     and nothing else: no tool that writes to a client is ever offered, and
//     Glidna's reads only reach an agent whose job includes Glidna;
//   • a failed reply stores nothing of the conversation, but the money it cost
//     still lands on the agent's time card, never under the owner's uid;
//   • one time card per conversation; "new topic" starts both a fresh context
//     and a fresh card;
//   • the brief the server uses is the app's own, regenerated, never stale.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { render as renderCrew, CREW_JSON } from "./gen-hq-crew.mjs";
import { stripComments, stripJsxComments } from "./lib/strip-comments.mjs";
import { CAM_W, CAM_H, deskCamScene, writingState, blinking } from "../src/hqDeskCam.js";

const require = createRequire(import.meta.url);
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "calorieiq-29762";
const chat = require("../functions/hqChat.js");
const hq = require("../functions/hq.js");
const { HQ_SEATS } = require("../functions/hqtools.js");
const { _handleCrewChat: handle, _systemFor: systemFor, _contextOf: contextOf, CREW_CHAT } = chat;

const OWNER = "G7QUZ8Kat1fgyoMjdGKz4DYoVHi1";
const T0 = Date.UTC(2026, 8, 26, 15, 0, 0);
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };
async function rejects(fn, code, msg) {
  try { await fn(); ok(false, `${msg} (did not throw)`); }
  catch (e) { ok(e && e.code === code, `${msg} (got ${e && e.code}: ${e && e.message})`); }
}

// ── Doubles ────────────────────────────────────────────────────────────────
function fakeDb() {
  const store = new Map();
  let auto = 0, reads = 0;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const docRef = (path) => ({
    id: path.split("/").pop(),
    async get() { reads++; const d = store.get(path); return { exists: d !== undefined, id: path.split("/").pop(), data: () => (d === undefined ? undefined : copy(d)) }; },
    async set(obj, opts) { const cur = store.get(path); store.set(path, copy(opts && opts.merge && cur ? { ...cur, ...obj } : obj)); },
    async update(obj) { const cur = store.get(path); if (!cur) throw Object.assign(new Error("NOT_FOUND"), { code: 5 }); store.set(path, copy({ ...cur, ...obj })); },
  });
  const query = (col, filters = [], order = null, lim = Infinity) => ({
    where: (f, op, v) => query(col, [...filters, [f, v]], order, lim),
    orderBy: (f, dir = "asc") => query(col, filters, [f, dir], lim),
    limit: (n) => query(col, filters, order, n),
    async get() {
      reads++;
      let rows = [...store.entries()].filter(([p]) => p.startsWith(col + "/") && p.split("/").length === 2)
        .map(([p, d]) => ({ id: p.split("/")[1], d }));
      rows = rows.filter(({ d }) => filters.every(([f, v]) => d[f] === v));
      if (order) {
        const [f, dir] = order;
        rows = rows.filter(({ d }) => f in d).sort((a, b) => ((a.d[f] ?? -Infinity) - (b.d[f] ?? -Infinity)) * (dir === "desc" ? -1 : 1));
      }
      return { docs: rows.slice(0, lim).map(({ id, d }) => ({ id, exists: true, data: () => copy(d) })) };
    },
  });
  return {
    store, get reads() { return reads; },
    doc: (path) => docRef(path),
    collection: (name) => ({ ...query(name), doc: (id) => docRef(`${name}/${id || `auto${++auto}`}`) }),
    async runTransaction(fn) { return fn({ get: (ref) => ref.get(), set: (ref, d, o) => ref.set(d, o) }); },
  };
}
const usage = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const say = (text) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });
const use = (name, input, id = "tu1") => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage });
function scripted(steps) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(params) {
        calls.push(JSON.parse(JSON.stringify(params)));
        const next = steps.length > 1 ? steps.shift() : steps[0];
        if (next instanceof Error) throw next;
        return typeof next === "function" ? next(params) : next;
      },
    },
  };
}
const GLIDNA_TOOLS = ["list_clients", "coach_summary", "get_profile", "log_meal", "set_personal_info", "send_client_request", "search_food_db"]
  .map((name) => ({ name, description: name, input_schema: { type: "object", properties: {} } }));
function deps(db, client, over = {}) {
  const ran = [];
  return {
    ran,
    d: {
      db, now: T0, getClient: () => client,
      buildTools: () => GLIDNA_TOOLS, runTool: async (name, input, ctx) => { ran.push({ name, input, ctx }); return { ok: true, rows: 3 }; },
      seatCapFor: () => 10, ...over,
    },
  };
}
const as = (data, uid = OWNER) => ({ auth: uid ? { uid } : undefined, data });

// ── 1. Only the owner ──────────────────────────────────────────────────────
console.log("only the owner");
{
  const db = fakeDb();
  const { d } = deps(db, scripted([say("hi")]));
  await rejects(() => handle(as({ action: "send", seat: "programs-lead", text: "hi" }, null), d), "unauthenticated", "a signed-out caller is refused");
  await rejects(() => handle(as({ action: "load", seat: "programs-lead" }, "someone-else"), d), "permission-denied", "any other account is refused");
  ok(db.reads === 0, `…before a single read (reads: ${db.reads})`);
  for (const seat of ["owner", "nobody", "__proto__", "constructor", "", null]) {
    await rejects(() => handle(as({ action: "load", seat }), d), "invalid-argument", `seat ${JSON.stringify(seat)} is refused`);
  }
  await rejects(() => handle(as({ action: "send", seat: "programs-lead", text: "   " }), d), "invalid-argument", "an empty message is refused");
  await rejects(() => handle(as({ action: "delete", seat: "programs-lead" }), d), "invalid-argument", "an unknown action is refused (there is no delete)");
}

// ── 2. A conversation ──────────────────────────────────────────────────────
console.log("a conversation");
{
  const db = fakeDb();
  const client = scripted([say("Here's where I'd start.")]);
  const { d } = deps(db, client);
  const r = await handle(as({ action: "send", seat: "programs-lead", text: "What should the Programmer ask first?" }), d);
  ok(r.reply === "Here's where I'd start." && r.messages.length === 2 && r.messages[0].role === "user" && r.messages[1].role === "assistant",
    "a reply comes back and both sides are kept");
  const call = client.calls[0];
  ok(call.model === CREW_CHAT.MODEL && call.system[0].cache_control && /Programs Lead/.test(call.system[0].text),
    "the model gets the agent's own brief, cached");
  const names = call.tools.map((t) => t.name);
  ok(names.includes("hq_read_desk") && names.includes("hq_file_report") && names.includes("list_clients") && names.includes("coach_summary"),
    "a Glidna agent can read the desk, file to it and read clients' progress");
  ok(!names.some((n) => ["log_meal", "set_personal_info", "send_client_request", "search_food_db", "hq_clock_in", "hq_log_shift"].includes(n)),
    "…and is never offered a tool that writes to a client, the food search, or the routine's clock-in");
  const card = [...db.store.entries()].find(([p]) => p.startsWith("hqShifts/chat-programs-lead-"));
  ok(card && card[1].engine === "cloud" && card[1].worker === "programs-lead" && card[1].dept === "coaching" && card[1].costCents > 0,
    `its cost goes on the agent's own time card, as cloud work (${card && card[1].costCents}¢)`);
  ok(![...db.store.keys()].some((p) => p.startsWith("users/")), "…and nothing is written under the owner's account");
  const here = db.store.get("hqActive/programs-lead");
  ok(here && here.until === T0 + CREW_CHAT.PRESENCE_MS && !here.endedAt, "the agent shows at its desk for ten quiet minutes");
  const loaded = await handle(as({ action: "load", seat: "programs-lead" }), d);
  ok(loaded.messages.length === 2, "the conversation is there when it opens again");
}

// ── 3. Tools ───────────────────────────────────────────────────────────────
console.log("tools");
{
  const db = fakeDb();
  const client = scripted([use("hq_file_report", { worker: "bookkeeper", kind: "report", title: "Playbook v1", summary: "Rules we decided.", engine: "claude" }), say("Filed it.")]);
  const { d } = deps(db, client);
  await handle(as({ action: "send", seat: "programs-lead", text: "Put it on my desk." }), d);
  const item = [...db.store.entries()].find(([p]) => p.startsWith("hqDesk/"));
  ok(item && item[1].worker === "programs-lead" && item[1].dept === "coaching" && item[1].engine === "cloud" && item[1].status === "open",
    "an agent files as itself, from the cloud, and the item waits open — whatever the model claims");
  const results = client.calls[1].messages.at(-1).content[0];
  ok(results.type === "tool_result" && /Nothing was sent/.test(results.content), "…and is told it's on the desk and nothing was sent");

  const db2 = fakeDb();
  const c2 = scripted([use("list_clients", {}), say("You have three.")]);
  const x = deps(db2, c2);
  await handle(as({ action: "send", seat: "programs-lead", text: "How many clients?" }), x.d);
  ok(x.ran.length === 1 && x.ran[0].name === "list_clients" && x.ran[0].ctx.callerUid === OWNER && x.ran[0].ctx.isTrainer === true,
    "a Glidna read runs as the owner, a trainer");

  // An open seat has no apps: no Glidna tools, and a call made anyway goes nowhere.
  const db3 = fakeDb();
  const c3 = scripted([use("list_clients", {}), say("I can't see that.")]);
  const y = deps(db3, c3);
  await handle(as({ action: "send", seat: "market-researcher", text: "Look at my clients." }), y.d);
  ok(!c3.calls[0].tools.some((t) => t.name === "list_clients") && y.ran.length === 0
    && /isn't a tool you have here/.test(c3.calls[1].messages.at(-1).content[0].content),
    "an agent without Glidna isn't offered its reads, and can't run one anyway");
  // Even a Glidna agent can't reach a write through a made-up call.
  const db4 = fakeDb();
  const c4 = scripted([use("log_meal", { calories: 500 }), say("Done?")]);
  const z = deps(db4, c4);
  await handle(as({ action: "send", seat: "programs-lead", text: "Log a meal." }), z.d);
  ok(z.ran.length === 0, "a write tool the model names anyway never runs");

  // A model that never stops asking for tools is cut off.
  const db5 = fakeDb();
  const c5 = scripted([use("hq_read_desk", {})]);
  const w = deps(db5, c5);
  const r5 = await handle(as({ action: "send", seat: "programs-lead", text: "Keep going." }), w.d);
  ok(c5.calls.length === 6 && /ran out of steps/.test(r5.reply), `tool rounds stop at five and it says so (${c5.calls.length} calls)`);
}

// ── 4. When the AI can't be reached ────────────────────────────────────────
console.log("failures");
{
  const db = fakeDb();
  const { d } = deps(db, scripted([Object.assign(new Error("overloaded"), { status: 529 })]));
  await rejects(() => handle(as({ action: "send", seat: "programs-lead", text: "Hello?" }), d), "unavailable", "a failed call says so");
  const thread = db.store.get("hqChats/programs-lead");
  ok(!thread || !thread.messages || thread.messages.length === 0, "…and stores nothing of the conversation, so a resend isn't doubled");
  ok(![...db.store.keys()].some((p) => p.startsWith("hqShifts/")), "…and with no tokens spent, no time card");
  ok(!db.store.get("hqActive/programs-lead"), "…and nobody is shown at the desk");
  // Tokens spent before a failure still cost money.
  const db2 = fakeDb();
  const x = deps(db2, scripted([use("hq_read_desk", {}), Object.assign(new Error("boom"), { status: 500 })]));
  await rejects(() => handle(as({ action: "send", seat: "programs-lead", text: "Check the desk." }), x.d), "unavailable", "a failure after a tool round says so");
  const card = [...db2.store.entries()].find(([p]) => p.startsWith("hqShifts/"));
  ok(card && card[1].status === "failed" && card[1].costCents > 0, "…and the tokens it already used still go on the time card, marked failed");
}

// ── 5. Time cards, topics ──────────────────────────────────────────────────
console.log("time cards and topics");
{
  const db = fakeDb();
  const client = scripted([say("One."), say("Two."), say("Three."), say("Four.")]);
  const run = (text, now) => handle(as({ action: "send", seat: "automations-lead", text }), { ...deps(db, client).d, now });
  await run("first", T0);
  await run("second", T0 + 5 * 60000);
  let cards = [...db.store.entries()].filter(([p]) => p.startsWith("hqShifts/chat-automations-lead-"));
  ok(cards.length === 1 && /2 messages answered/.test(cards[0][1].summary), "two messages minutes apart share one time card");
  await run("third", T0 + 5 * 60000 + CREW_CHAT.SESSION_GAP_MS + 1);
  cards = [...db.store.entries()].filter(([p]) => p.startsWith("hqShifts/chat-automations-lead-"));
  ok(cards.length === 2, "a quiet half hour starts a new one");
  const nt = await handle(as({ action: "newTopic", seat: "automations-lead" }), { ...deps(db, client).d, now: T0 + 3600000 });
  ok(db.store.get("hqActive/automations-lead").endedAt === T0 + 3600000, "a new topic walks the agent off the desk");
  const again = await handle(as({ action: "newTopic", seat: "automations-lead" }), { ...deps(db, client).d, now: T0 + 3600001 });
  ok(nt.messages.at(-1).role === "topic" && again.messages.filter((m) => m.role === "topic").length === 1, "…and is marked once, however often it's tapped");
  await run("fourth", T0 + 3600002);
  const sent = client.calls.at(-1).messages;
  ok(sent.length === 1 && sent[0].content === "fourth", "after a new topic the AI sees only the new conversation");
  cards = [...db.store.entries()].filter(([p]) => p.startsWith("hqShifts/chat-automations-lead-"));
  ok(cards.length === 3, "…on a new time card");
  const end = await handle(as({ action: "end", seat: "automations-lead" }), { ...deps(db, client).d, now: T0 + 3600100 });
  ok(end.ok && db.store.get("hqActive/automations-lead").endedAt === T0 + 3600100, "closing the chat walks the agent off the desk at once");
  // 31 alternating messages: the latest twenty would begin with a reply, so the
  // guard that drops a leading reply has something to do.
  const many = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}`, at: i }));
  const ctx = contextOf(many);
  ok(ctx.length <= CREW_CHAT.CONTEXT && ctx[0].role === "user", "the AI sees at most the latest twenty messages, starting with one of Kevin's");
}

// ── 6. The brief, and where the agent is ───────────────────────────────────
console.log("the brief");
{
  const crew = JSON.parse(readFileSync(CREW_JSON, "utf8")).crew;
  ok(readFileSync(CREW_JSON, "utf8") === renderCrew(), "functions/hqCrew.json matches hqOrg.js (npm run gen:hq-crew)");
  const seatIds = Object.keys(HQ_SEATS).filter((s) => s !== "owner").sort();
  ok(JSON.stringify(Object.keys(crew).sort()) === JSON.stringify(seatIds) && seatIds.every((id) => crew[id].room === HQ_SEATS[id]),
    "every crew seat the door knows has a brief here, in the same room");
  const auto = systemFor({ id: "automations-lead", ...crew["automations-lead"] }, T0);
  ok(!/Here's what I need:/.test(auto) && !/clock in with Glidna's hq_clock_in/.test(auto), "the paste-into-a-chat parts of the brief are left out");
  ok(/can't reach Zapier from here/.test(auto) && /Open in Claude/.test(auto), "an agent whose job needs Zapier says it lives in the Claude app");
  ok(/Saturday, September 26, 2026/.test(auto), "…and knows the date in Miami");
  const open = systemFor({ id: "market-researcher", ...crew["market-researcher"] }, T0);
  ok(!/Glidna's read-only tools/.test(open) && !/can't reach/.test(open), "an agent with no apps is promised no Glidna reads");
  const onb = systemFor({ id: "onboarding", ...crew.onboarding }, T0);
  ok(/The one thing you may send is/.test(onb) && /can't reach Zapier from here/.test(onb),
    "the Onboarding Specialist keeps its one send, and learns it happens in the Claude app, not here");
}

// ── 7. Wiring ──────────────────────────────────────────────────────────────
console.log("wiring");
{
  const aichat = readFileSync(new URL("../functions/aichat.js", import.meta.url), "utf8");
  ok(new RegExp(`const MODEL = "${CREW_CHAT.MODEL}";`).test(aichat), "the crew talks on the same model as the Glidna AI");
  const guard = readFileSync(new URL("../docs/hq/crew-repo/.claude/hooks/crew-guard.sh", import.meta.url), "utf8");
  const allowed = new Set((guard.match(/# Glidna: reading clients' progress only\.\n\s*([^)]+)\)/) || [, ""])[1].split("|").map((s) => s.trim()));
  ok([...CREW_CHAT.GLIDNA_READS].every((t) => allowed.has(t)), "every Glidna read offered here is one the crew's guard allows in a routine");
  const { buildTools } = require("../functions/aitools.js");
  const real = new Set(buildTools("head_trainer").map((t) => t.name));
  const missing = [...CREW_CHAT.GLIDNA_READS].filter((t) => !real.has(t));
  ok(missing.length === 0, `…and every one is a real Glidna tool${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  ok(!/hqChats|crewLinks/.test(rules), "firestore.rules has no door into the conversations or the links");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  ok(/exports\.hqCrewChat = require\("\.\/hqChat"\)\.hqCrewChat;/.test(index), "the function is exported");
  const src = readFileSync(new URL("../functions/hqChat.js", import.meta.url), "utf8");
  ok(!/recordUsage/.test(src.replace(/^\s*\/\/.*$/gm, "")), "the cost never goes through recordUsage under the owner's uid");
}

// ── 8. Links to each agent's chat in the Claude app (hq.js) ─────────────────
console.log("links to Claude");
{
  const db = fakeDb();
  const call = (data, now = T0) => hq._handleHq({ auth: { uid: OWNER }, data }, db, now);
  const saved = await call({ action: "setCrewLink", seat: "programs-lead", url: "https://claude.ai/project/0199-abc" });
  ok(saved.links["programs-lead"] === "https://claude.ai/project/0199-abc", "a claude.ai link is saved for an agent");
  for (const url of ["http://claude.ai/project/x", "https://claude.ai.evil.com/x", "https://evil.com/?claude.ai", "javascript:alert(1)", "not a link"]) {
    await rejects(() => call({ action: "setCrewLink", seat: "programs-lead", url }), "invalid-argument", `refused: ${url}`);
  }
  await rejects(() => call({ action: "setCrewLink", seat: "owner", url: "https://claude.ai/new" }), "invalid-argument", "the owner has no agent link");
  const listed = await call({ action: "crewLinks" });
  ok(listed.links["programs-lead"] && Object.keys(listed.links).length === 1, "the links come back for the profiles");
  const cleared = await call({ action: "setCrewLink", seat: "programs-lead", url: "" });
  ok(!("programs-lead" in cleared.links), "an empty link clears it");
  await rejects(() => hq._handleHq({ auth: { uid: "someone-else" }, data: { action: "setCrewLink", seat: "programs-lead", url: "https://claude.ai/x" } }, db, T0),
    "permission-denied", "nobody else can save one");
  // Presence: a chat's `until` ends its time at the desk.
  await db.collection("hqActive").doc("programs-lead").set({ worker: "programs-lead", since: T0, until: T0 + 600000, endedAt: null });
  const during = await call({ action: "overview" }, T0 + 60000);
  const after = await call({ action: "overview" }, T0 + 600001);
  ok(during.active.some((a) => a.worker === "programs-lead") && !after.active.some((a) => a.worker === "programs-lead"),
    "an agent talking in the HQ shows at its desk until ten quiet minutes pass");
  ok(Array.isArray(during.shifts) && typeof during.links === "object", "the overview carries the links");
}

// ── 9. The screens ─────────────────────────────────────────────────────────
console.log("the desk camera");
{
  const inBounds = (rects) => rects.every(([x, y, w, h, fill]) => [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0
    && x >= 0 && y >= 0 && x + w <= CAM_W && y + h <= CAM_H && typeof fill === "string" && fill.length > 0);
  let all = true;
  for (let t = 0; t < 20000; t += 37) {
    for (const writing of [true, false]) if (!inBounds(deskCamScene({ t, writing }))) all = false;
  }
  ok(all && inBounds(deskCamScene({ still: true })), "every frame of the desk camera stays on its canvas, writing or not");
  const penX = (t) => { const f = deskCamScene({ t, writing: true }); return f.find(([, , w, h, fill]) => fill === "#FBBF24" && w === 2 && h === 6)[0]; };
  ok(penX(100) !== penX(600), `while it writes, the pen moves across the page (${penX(100)} → ${penX(600)})`);
  const idlePen = (t) => deskCamScene({ t, writing: false }).find(([, , w, h, fill]) => fill === "#FBBF24" && w === 2 && h === 6)[0];
  ok(idlePen(100) === idlePen(600), "…and rests when it isn't writing");
  // The eyes sit in the visor, below the antenna (which shares their cyan).
  const eyes = (t) => deskCamScene({ t }).filter(([, y, w, , fill]) => fill === "#08DCE0" && w === 4 && y > 20);
  ok(blinking(50) && !blinking(1000) && eyes(50).every((r) => r[3] === 1) && eyes(1000).every((r) => r[3] === 3),
    "it blinks now and then");
  ok(JSON.stringify(deskCamScene({ t: 0, writing: true, still: true })) === JSON.stringify(deskCamScene({ t: 9999, writing: true, still: true }))
    && eyes(0).length === 2,
    "with reduced motion it holds one still picture");
  ok(writingState(0).lines === 0 && writingState(900 * 2 + 10).lines === 2, "the page fills a line at a time");
}

console.log("the screens");
{
  const APP = stripJsxComments(stripComments(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")));
  ok(/const HQCrewPicker = lazy\(\(\) => import\("\.\/HQCrewPicker\.jsx"\)\);/.test(APP)
    && !/import\s+[^;]*from\s+["']\.\/(HQCrewPicker|HQCrewChat)\.jsx["']/.test(APP) && !/from\s+["']\.\/hqDeskCam\.js["']/.test(APP),
    "App.jsx loads the agents list lazily, never statically, and never the chat or the camera");
  const passed = [...APP.matchAll(/<AIChatPanel [^>]*?agents=\{([^}]*)\}/g)].map((m) => m[1]);
  ok(passed.length === 6 && passed.every((v) => v === "isOwnerUid") && /const isOwnerUid = meUid === OWNER_UID;/.test(APP),
    `the Agents button is switched on only for the owner's uid (${passed.length} places)`);
  ok(!/<AIChatPanel role=\{role\} premium=\{premium\} onDataChanged=\{\(\) => load\(activePlanId\)\}[^>]*agents=/.test(APP),
    "…and never on a client's home");
  ok((APP.match(/\{agents && \(/g) || []).length === 2 && /\{agentsOpen && \(\s*<Suspense fallback=\{null\}><HQCrewPicker /.test(APP),
    "the button and the shortcut render only with `agents`, and the list only once asked for");
  const HQ = stripJsxComments(stripComments(readFileSync(new URL("../src/HQ.jsx", import.meta.url), "utf8")));
  ok(/onClick=\{\(\) => onTalk\(seat\.id\)\}>Talk here<\/button>/.test(HQ), "every agent's profile has Talk here");
  ok(/href=\{link \|\| claudeNewChatUrl\(brief\)\}/.test(HQ) && /\{link \? "Open their chat in Claude" : "Start a chat in Claude"\}/.test(HQ),
    "…and a way into the Claude app: their saved chat, or a new one with the brief typed in");
  ok(/\{talkSeat && \(\s*<HQCrewChat/.test(HQ) && /preview=\{!!sample\}/.test(HQ), "the conversation opens over the profile, and the preview never calls the server");
  const CHAT = readFileSync(new URL("../src/HQCrewChat.jsx", import.meta.url), "utf8");
  const { claudeNewChatUrl } = { claudeNewChatUrl: (b) => `https://claude.ai/new?q=${encodeURIComponent(b || "")}` };
  ok(/export const claudeNewChatUrl = \(brief\) => `https:\/\/claude\.ai\/new\?q=\$\{encodeURIComponent\(brief \|\| ""\)\}`;/.test(CHAT)
    && decodeURIComponent(claudeNewChatUrl("A & B?\nC").split("?q=")[1]) === "A & B?\nC",
    "a new Claude chat carries the brief whole, however it's written");
  ok(/window\.addEventListener\("keydown", onKey, true\)/.test(CHAT) && /e\.stopPropagation\(\);\s*closeRef\.current\(\);/.test(CHAT),
    "Escape closes the conversation first, not the profile under it");
  ok(/setMessages\(before\);\s*setDraft\(text\);/.test(CHAT), "a message that didn't go through is put back in the box");
  ok(/callChat\(\{ action: "end", seat: seat\.id \}\)/.test(CHAT), "closing the conversation walks the agent off the desk");
}

console.log(`\n${checks - fails}/${checks} HQ chat checks passed`);
if (fails) process.exit(1);
