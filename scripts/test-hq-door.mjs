// Smooth Training HQ — piece 3: the crew's front door (S238,
// functions/hqtools.js + functions/mcp.js).
//
// Claude routines on the owner's own plan put their work on his HQ desk
// through the Glidna connector. The promises, RUN rather than read:
//
//   • ONLY THE OWNER'S CONNECTION HAS THE DOOR. The HQ tools are registered for
//     the admin uid and nobody else — not a trainer, not a client, whatever
//     scopes their token carries — and each call checks again.
//   • THE DOOR ONLY ADDS. A routine can file an open item, log a time card,
//     read the desk and record the plan's meter. It cannot mark its own work
//     approved, pick another department, claim another engine, or reach
//     anything else. The seat's room comes from a mirror of the org chart that
//     this suite keeps honest.
//   • IT STAYS OUT OF THE MEMBERS' TOOLSET. buildTools() — what every member's
//     assistant and connector use — never contains an hq_ tool.
//
// Run: node scripts/test-hq-door.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SEATS } from "../src/hqOrg.js";

const require = createRequire(import.meta.url);
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "calorieiq-29762";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const door = require("../functions/hqtools.js");
const mcp = require("../functions/mcp.js");
const { buildTools } = require("../functions/aitools.js");
const OWNER = "G7QUZ8Kat1fgyoMjdGKz4DYoVHi1";
const NOW = Date.UTC(2026, 8, 28, 15, 0, 0);

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };
async function rejects(fn, msg) {
  try { await fn(); ok(false, `${msg} (did not throw)`); }
  catch (e) { ok(e && e.code === "invalid-argument", `${msg} (got ${e && e.code}: ${e && e.message})`); }
}

// A Firestore double with what the door and the connector's call counter use.
function fakeDb() {
  const docs = new Map();
  let auto = 0;
  const snap = (path) => {
    const d = docs.get(path);
    return { id: path.split("/").pop(), exists: d !== undefined, data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))) };
  };
  const ref = (path) => ({
    id: path.split("/").pop(),
    async get() { return snap(path); },
    async set(obj, opts) { docs.set(path, { ...(opts && opts.merge ? docs.get(path) || {} : {}), ...JSON.parse(JSON.stringify(obj)) }); },
    async update(obj) { docs.set(path, { ...(docs.get(path) || {}), ...obj }); },
  });
  const query = (name, filters = [], order = null, lim = Infinity) => ({
    where(f, op, v) { return query(name, [...filters, [f, v]], order, lim); },
    orderBy(f, dir = "asc") { return query(name, filters, [f, dir], lim); },
    limit(n) { return query(name, filters, order, n); },
    async get() {
      let rows = [...docs.entries()].filter(([p]) => p.startsWith(`${name}/`) && p.split("/").length === 2)
        .map(([p, d]) => ({ p, d })).filter(({ d }) => filters.every(([f, v]) => d[f] === v));
      if (order) rows.sort((a, b) => ((a.d[order[0]] || 0) - (b.d[order[0]] || 0)) * (order[1] === "desc" ? -1 : 1));
      return { docs: rows.slice(0, lim).map(({ p }) => snap(p)) };
    },
  });
  return {
    docs,
    doc: (path) => ref(path),
    collection(name) { return { ...query(name), doc: (id) => ref(`${name}/${id || `auto${++auto}`}`) }; },
  };
}
const run = (name, input, db) => door.runHqTool(name, input, { db, now: NOW });
const deskItems = (db) => [...db.docs.entries()].filter(([p]) => p.startsWith("hqDesk/")).map(([, d]) => d);
const shifts = (db) => [...db.docs.entries()].filter(([p]) => p.startsWith("hqShifts/")).map(([, d]) => d);

// ── 1. The org chart mirror ─────────────────────────────────────────────────
console.log("org chart mirror");
{
  const app = Object.fromEntries(SEATS.map((s) => [s.id, s.room]));
  ok(JSON.stringify(Object.keys(door.HQ_SEATS).sort()) === JSON.stringify(Object.keys(app).sort()),
    "the door knows exactly the seats the org chart has");
  ok(Object.entries(app).every(([id, room]) => door.HQ_SEATS[id] === room), "…and every seat is in the same room");
  ok(!door.CREW_SEATS.includes("owner"), "the owner's seat can't file through the door — the crew does");
}

// ── 2. Filing a report ──────────────────────────────────────────────────────
console.log("filing");
{
  const db = fakeDb();
  const res = await run("hq_file_report", {
    worker: "bookkeeper", dept: "ops", engine: "cloud", status: "done", createdAt: 1,
    kind: "report", title: "Monday money check", summary: "Money in held steady.",
    body: "Full report", headNote: "Totals match QuickBooks.",
    link: { label: "Open P&L", url: "https://app.qbo.intuit.com/app/reportv2" },
    shift: { startedAt: "2026-09-28T14:55:00Z", status: "done", actions: ["Read the P&L", "Checked who owes you"] },
  }, db);
  const [item] = deskItems(db);
  ok(res.ok && res.deskItemId && res.shiftId, "a report comes back with its desk item and time card");
  ok(item.status === "open" && item.resolvedAt === null, "it lands OPEN, waiting on the owner, whatever the routine claimed");
  ok(item.dept === "finance", "the department comes from the seat, not from the caller (who said \"ops\")");
  ok(item.engine === "claude", "the engine is the owner's Claude plan, not what the caller said");
  ok(item.createdAt === NOW, "it is filed now, not back-dated");
  ok(item.link && item.link.url.startsWith("https://"), "an https link is kept");
  const [shift] = shifts(db);
  ok(shift.worker === "bookkeeper" && shift.dept === "finance" && shift.engine === "claude", "the time card matches the seat and engine");
  ok(shift.startedAt === Date.parse("2026-09-28T14:55:00Z") && shift.endedAt === NOW, "the shift runs from its ISO start to now");
  ok(JSON.stringify(shift.deskItems) === JSON.stringify([res.deskItemId]), "the time card points at what it filed");
  ok(shift.actions.length === 2, "the steps are kept");

  await rejects(() => run("hq_file_report", { worker: "owner", kind: "report", title: "x", summary: "y" }, fakeDb()), "the owner's seat can't file");
  await rejects(() => run("hq_file_report", { worker: "accountant", kind: "report", title: "x", summary: "y" }, fakeDb()), "a seat that doesn't exist can't file");
  await rejects(() => run("hq_file_report", { worker: "bookkeeper", kind: "payment", title: "x", summary: "y" }, fakeDb()), "a kind the desk doesn't have is refused");
  await rejects(() => run("hq_file_report", { worker: "bookkeeper", kind: "report", title: "", summary: "y" }, fakeDb()), "an item needs a title");
  await rejects(() => run("hq_file_report", { worker: "bookkeeper", kind: "report", title: "x", summary: "y", link: { url: "http://evil.example" } }, fakeDb()),
    "a link that isn't https is refused");
  const odd = fakeDb();
  await run("hq_file_report", { worker: "front-desk", kind: "draft", title: "Reply to an inquiry", summary: "In Gmail drafts.", shift: { startedAt: "not a date" } }, odd);
  ok(shifts(odd)[0].startedAt === NOW, "a start time that isn't a time falls back to now");
  ok(deskItems(odd)[0].dept === "front", "the Front Desk files into the Front Office");
}

// ── 3. The rest of the door ─────────────────────────────────────────────────
console.log("time cards, reading, the meter");
{
  const db = fakeDb();
  const r = await run("hq_log_shift", { worker: "front-desk", summary: "No new inquiries.", status: "skipped", startedAt: "2026-09-28T14:58:00Z" }, db);
  ok(r.ok && shifts(db).length === 1 && deskItems(db).length === 0, "a quiet shift logs a time card and files nothing");
  ok(shifts(db)[0].status === "skipped", "…with its status");

  await run("hq_file_report", { worker: "bookkeeper", kind: "report", title: "Older", summary: "a", body: "old body" }, db);
  db.docs.set("hqDesk/handled", { status: "done", title: "Handled", createdAt: NOW + 5 });
  await door.runHqTool("hq_file_report", { worker: "bookkeeper", kind: "question", title: "Newer", summary: "b" }, { db, now: NOW + 10 });
  const desk = await run("hq_read_desk", {}, db);
  ok(desk.waiting === 2, "the desk reports what is waiting, not what was handled");
  ok(desk.items[0].title === "Newer", "newest first");
  ok(!("body" in desk.items[0]), "bodies stay out unless asked for");
  const withBody = await run("hq_read_desk", { includeBody: true }, db);
  ok(withBody.items[1].body === "old body", "…and come back when asked");
  ok(Array.isArray(desk.recentShifts) && desk.recentShifts.length === 3, "the latest time cards come along");

  const m = await run("hq_record_plan_usage", {
    plan: "Max", windows: [{ label: "5-hour limit", percentUsed: 12.34, resetsAt: "2026-09-28T19:00:00Z" },
      { label: "Weekly · all models", percentUsed: 180 }, { label: "", percentUsed: 4 }],
  }, db);
  const meter = db.docs.get("hqPlanUsage/latest");
  ok(m.ok && meter.windows.length === 2, "a reading is recorded, and a window with no label is dropped");
  ok(meter.windows[0].percentUsed === 12.3 && meter.windows[1].percentUsed === 100, "percentages are rounded and held to 0–100");
  ok(meter.capturedAt === NOW && meter.source === "claude", "it says when and where it came from");
  await rejects(() => run("hq_record_plan_usage", { windows: [] }, db), "a reading with no windows is refused");
  await rejects(() => run("hq_delete_item", {}, db), "there is no delete through the door");
}

// ── 4. Who sees the door ────────────────────────────────────────────────────
console.log("who sees the door");
{
  const ALL = "read write:logs write:plan trainer";
  const ctxFor = (uid, role) => ({
    callerUid: uid, role, isTrainer: role !== "client", callerName: "Test", today: "2026-09-28",
    weekday: "Monday", nowTime: "11:00", seatCap: null,
  });
  const toolsFor = (uid, role, scopes, profile = { role }) => {
    const server = mcp._buildServer(ctxFor(uid, role), profile, fakeDb(), scopes);
    return server;
  };
  const names = (server) => Object.keys(server._registeredTools || {});
  const hqNames = door.HQ_TOOLS.map((t) => t.name);

  const owner = toolsFor(OWNER, "head_trainer", ALL);
  ok(hqNames.every((n) => names(owner).includes(n)), "the owner's connection gets all four HQ tools");
  const ownerRead = toolsFor(OWNER, "head_trainer", "read");
  ok(names(ownerRead).includes("hq_read_desk") && !names(ownerRead).some((n) => ["hq_file_report", "hq_log_shift", "hq_record_plan_usage"].includes(n)),
    "a read-only owner connection can read the desk but not file to it");
  for (const [who, role] of [["a trainer", "head_trainer"], ["a sub-trainer", "sub_trainer"], ["a client", "client"]]) {
    const other = toolsFor(`not-${role}`, role, ALL);
    ok(!names(other).some((n) => n.startsWith("hq_")), `${who} never sees an HQ tool, even with every scope`);
  }
  // A profile claiming admin by role changes nothing: admin is a uid.
  const pretender = toolsFor("someone", "admin", ALL, { role: "admin" });
  ok(!names(pretender).some((n) => n.startsWith("hq_")), "a profile that says \"admin\" is not the owner");

  // The call itself: the owner's filing works end to end through the connector.
  const db = fakeDb();
  const server = mcp._buildServer(ctxFor(OWNER, "head_trainer"), { role: "head_trainer" }, db, ALL);
  const out = await server._registeredTools.hq_file_report.handler({ worker: "bookkeeper", kind: "report", title: "Via the connector", summary: "ok" }, {});
  ok(!out.isError && JSON.parse(out.content[0].text).ok === true, "a filing through the connector succeeds");
  ok(deskItems(db).length === 1 && deskItems(db)[0].title === "Via the connector", "…and lands on the desk");
  const badCall = await server._registeredTools.hq_file_report.handler({ worker: "nobody", kind: "report", title: "x", summary: "y" }, {});
  ok(badCall.isError && /crew's seats/.test(badCall.content[0].text), "a bad filing comes back as a readable error");
  ok(db.docs.has(`users/${OWNER}/mcpUsage/${new Date().toISOString().slice(0, 10)}`), "HQ calls count against the connection's daily allowance");
  // Defence in depth: a handler asks again at call time, so even a server built
  // for the owner refuses the moment the connection isn't the owner's.
  const ctx = ctxFor(OWNER, "head_trainer");
  const db2 = fakeDb();
  const built = mcp._buildServer(ctx, { role: "head_trainer" }, db2, ALL);
  ctx.callerUid = "someone-else";
  const refused = await built._registeredTools.hq_file_report.handler({ worker: "bookkeeper", kind: "report", title: "x", summary: "y" }, {});
  ok(refused.isError && deskItems(db2).length === 0, "a call that isn't the owner's is refused at call time and files nothing");
}

// ── 5. Out of the members' toolset ──────────────────────────────────────────
console.log("out of the members' toolset");
{
  for (const role of ["client", "head_trainer", "sub_trainer", "admin"]) {
    ok(!buildTools(role).some((t) => /^hq_/.test(t.name)), `buildTools("${role}") has no HQ tool`);
  }
  const src = readFileSync(join(ROOT, "functions", "mcp.js"), "utf8");
  const listed = src.slice(src.indexOf("const READ_TOOLS"), src.indexOf("const DESTRUCTIVE_TOOLS"));
  ok(!/hq_/.test(listed), "no HQ tool is listed among the members' read or write tools");
  ok(/if \(isAdminUid\(ctx\.callerUid\)\) \{\n\s+for \(const def of HQ_TOOLS\)/.test(src), "the HQ tools are registered only inside the owner check");
  ok(/if \(!isAdminUid\(ctx\.callerUid\) \|\| !granted\.has\(def\.scope\)\) \{/.test(src), "…and every call checks the owner and the scope again");
  const aitools = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");
  ok(!/hqtools|hq_file_report/.test(aitools), "the members' tool layer never loads the door");
}

console.log(`\n${checks - fails}/${checks} HQ door checks passed`);
if (fails) process.exit(1);
