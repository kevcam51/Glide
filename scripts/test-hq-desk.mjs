// Smooth Training HQ — piece 2: the owner's desk and the crew's time cards
// (S238, functions/hq.js).
//
// Two promises, both RUN rather than read:
//
//   • ONLY THE OWNER. The desk is Admin-SDK-only storage behind one callable
//     that checks the caller's uid. A signed-out caller and any other account
//     are refused before a single document is read, and firestore.rules must
//     keep having no door of its own into either collection.
//
//   • A WORKER CAN'T CHEAT THE DESK. Workers are models and their output is
//     input: they cannot file an item as already handled, back-date it, link
//     somewhere that isn't https, or bury the desk under an unbounded body.
//     And an item still waiting on the owner can never fall off the desk
//     because newer items pushed it past a query limit.
//
// Run: node scripts/test-hq-desk.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "calorieiq-29762";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const hq = require("../functions/hq.js");
const { _handleHq: handle, _sanitizeDeskItem: cleanItem, _sanitizeShift: cleanShift, postDeskItem, logShift } = hq;

const OWNER = "G7QUZ8Kat1fgyoMjdGKz4DYoVHi1";
const NOW = Date.UTC(2026, 8, 24, 16, 0, 0);

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };
async function rejects(fn, code, msg) {
  try { await fn(); ok(false, `${msg} (did not throw)`); }
  catch (e) { ok(e && e.code === code, `${msg} (got ${e && e.code}: ${e && e.message})`); }
}

// ── A Firestore double that models what hq.js relies on ─────────────────────
// ⚠️ It REFUSES an equality filter combined with an orderBy on another field,
// because real Firestore needs a composite index for that and throws until one
// is deployed. hq.js is written to never need one; a double that allowed it
// would let a future edit pass here and fail in production (S212d's lesson: the
// double has to model the thing under test).
function fakeDb() {
  const cols = new Map();
  let auto = 0, reads = 0;
  const col = (name) => { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); };
  const snap = (id, d) => ({ id, exists: d !== undefined, data: () => (d === undefined ? undefined : { ...d }) });
  const docRef = (name, id) => ({
    id,
    async get() { reads++; return snap(id, col(name).get(id)); },
    async set(obj) { col(name).set(id, JSON.parse(JSON.stringify(obj))); },
    async update(obj) {
      const cur = col(name).get(id);
      if (!cur) throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
      col(name).set(id, { ...cur, ...JSON.parse(JSON.stringify(obj)) });
    },
  });
  const query = (name, filters = [], order = null, lim = Infinity) => ({
    where(f, op, v) {
      if (op !== "==") throw new Error("fake supports == only");
      return query(name, [...filters, [f, v]], order, lim);
    },
    orderBy(f, dir = "asc") { return query(name, filters, [f, dir], lim); },
    limit(n) { return query(name, filters, order, n); },
    async get() {
      reads++;
      if (order && filters.some(([f]) => f !== order[0])) {
        throw new Error("FAILED_PRECONDITION: The query requires a composite index");
      }
      let rows = [...col(name).entries()].map(([id, d]) => ({ id, d }));
      rows = rows.filter(({ d }) => filters.every(([f, v]) => d[f] === v));
      if (order) {
        const [f, dir] = order;
        rows = rows.filter(({ d }) => f in d);               // missing field: not in an ordered query
        const rank = (v) => (v === null ? -Infinity : v);    // null sorts before numbers
        rows.sort((a, b) => (rank(a.d[f]) - rank(b.d[f])) * (dir === "desc" ? -1 : 1));
      }
      return { docs: rows.slice(0, lim).map(({ id, d }) => snap(id, d)) };
    },
  });
  return {
    collection(name) { return { ...query(name), doc: (id) => docRef(name, id || `auto${++auto}`) }; },
    cols, get reads() { return reads; },
  };
}
const item = (over = {}) => ({ worker: "bookkeeper", dept: "finance", kind: "report", title: "Monday money check", ...over });

// ── 1. Only the owner ───────────────────────────────────────────────────────
console.log("only the owner");
{
  const db = fakeDb();
  await rejects(() => handle({ data: { action: "overview" } }, db, NOW), "unauthenticated", "a signed-out caller is refused");
  await rejects(() => handle({ auth: { uid: "someone-else" }, data: { action: "overview" } }, db, NOW),
    "permission-denied", "any other account is refused");
  await rejects(() => handle({ auth: { uid: "someone-else" }, data: { action: "resolve", id: "abc", status: "done" } }, db, NOW),
    "permission-denied", "…including when it tries to change an item");
  ok(db.reads === 0, `a refused caller reads nothing (reads: ${db.reads})`);
  const res = await handle({ auth: { uid: OWNER }, data: { action: "overview" } }, db, NOW);
  ok(Array.isArray(res.open) && Array.isArray(res.recent) && Array.isArray(res.shifts), "the owner gets the desk");
  await rejects(() => handle({ auth: { uid: OWNER }, data: { action: "delete", id: "x" } }, db, NOW),
    "invalid-argument", "there is no delete action (the crew never deletes, and neither does the desk)");

  const rules = readFileSync(join(ROOT, "firestore.rules"), "utf8");
  ok(!/hqDesk|hqShifts/.test(rules), "firestore.rules has no match for the desk's collections (Admin-SDK only)");
  ok(!/match \/\{[a-zA-Z]+=\*\*\}/.test(rules), "…and no recursive wildcard that could open them");
  const index = readFileSync(join(ROOT, "functions", "index.js"), "utf8");
  ok(/exports\.hqApi = require\("\.\/hq"\)\.hqApi;/.test(index), "index.js exports the hqApi callable");
  ok(!/exports\.(postDeskItem|logShift|_handleHq)\b/.test(index), "the write helpers are NOT exported as callable functions");
}

// ── 2. What a worker may put on the desk ────────────────────────────────────
console.log("desk items");
{
  const good = cleanItem(item());
  ok(good.title === "Monday money check" && good.summary === "" && good.body === "" && good.headNote === null
    && good.link === null && good.engine === "manual", "a minimal item gets safe defaults");
  const forged = cleanItem(item({ status: "done", createdAt: 1, resolvedAt: 2, id: "x" }));
  ok(!("status" in forged) && !("createdAt" in forged) && !("resolvedAt" in forged) && !("id" in forged),
    "a worker can't set the status, the filing time, the handled time or the id");
  for (const [over, why] of [
    [{ title: "   " }, "a blank title"],
    [{ worker: "Bookkeeper!" }, "a worker id that isn't a seat id"],
    [{ dept: "" }, "a missing department"],
    [{ kind: "email" }, "a kind the desk doesn't know"],
    [{ link: { url: "http://example.com" } }, "an http link"],
    [{ link: { url: "javascript:alert(1)" } }, "a javascript: link"],
    [{ link: { url: "not a url" } }, "a link that isn't a URL"],
    [{ link: "https://example.com" }, "a link that isn't { label, url }"],
  ]) {
    await rejects(async () => cleanItem(item(over)), "invalid-argument", `refuses ${why}`);
  }
  const linked = cleanItem(item({ link: { url: "https://mail.google.com/mail/u/0/#drafts" } }));
  ok(linked.link && linked.link.url.startsWith("https://") && linked.link.label === "Open", "an https link is kept, with a default label");
  const long = cleanItem(item({ title: "t".repeat(500), body: "b".repeat(50000), summary: "s".repeat(5000) }));
  ok(long.title.length === 120 && long.body.length === 20000 && long.summary.length === 600, "long text is capped, not refused");
  const ctrl = cleanItem(item({ title: "\u0000\u0007Hello\u001F", body: "line one\nline two\ttabbed" }));
  ok(ctrl.title === "Hello" && ctrl.body === "line one\nline two\ttabbed", "control characters go, newlines and tabs stay");
  ok(cleanItem(item({ engine: "claude" })).engine === "claude" && cleanItem(item({ engine: "gpt" })).engine === "manual",
    "a known engine is kept and an unknown one becomes \"manual\"");
}

// ── 3. Time cards ───────────────────────────────────────────────────────────
console.log("time cards");
{
  const bare = cleanShift({ worker: "bookkeeper", dept: "finance" }, NOW);
  ok(bare.status === "done" && bare.endedAt === NOW && bare.startedAt === NOW, "a bare shift defaults to done, ending now");
  const flipped = cleanShift({ worker: "bookkeeper", dept: "finance", startedAt: NOW - 1000, endedAt: NOW - 5000 }, NOW);
  ok(flipped.startedAt === flipped.endedAt, "a shift can't start after it ended");
  const ancient = cleanShift({ worker: "bookkeeper", dept: "finance", startedAt: Date.UTC(2020, 0, 1), endedAt: NOW + 7 * 86400000 }, NOW);
  ok(ancient.endedAt === NOW && ancient.startedAt === NOW, "timestamps from before the HQ or from next week are replaced");
  const many = cleanShift({ worker: "bookkeeper", dept: "finance", actions: [...Array(50)].map((_, i) => `step ${i} ${"x".repeat(400)}`).concat(["", null]) }, NOW);
  ok(many.actions.length === 30 && many.actions.every((a) => a.length <= 200), "actions are capped at 30 lines of 200 characters");
  const refs = cleanShift({ worker: "bookkeeper", dept: "finance", deskItems: ["abc123", "bad id!", ...Array(20).fill("x")] }, NOW);
  ok(refs.deskItems[0] === "abc123" && !refs.deskItems.includes("bad id!") && refs.deskItems.length === 10, "desk references are ids only, at most 10");
  const money = cleanShift({ worker: "bookkeeper", dept: "finance", usage: { inputTokens: -5, outputTokens: 12.6 }, costCents: 3.456 }, NOW);
  ok(money.usage.inputTokens === 0 && money.usage.outputTokens === 13 && money.costCents === 3.46, "usage can't go negative and cost rounds to a hundredth of a cent");
  ok(cleanShift({ worker: "bookkeeper", dept: "finance", costCents: -1 }, NOW).costCents === null, "a negative cost is dropped");
  ok(cleanShift({ worker: "bookkeeper", dept: "finance", status: "hacked" }, NOW).status === "done", "an unknown shift status becomes done");
  await rejects(async () => cleanShift({ worker: "", dept: "finance" }, NOW), "invalid-argument", "a shift with no worker is refused");
}

// ── 4. The desk, end to end ─────────────────────────────────────────────────
console.log("the desk");
{
  const db = fakeDb();
  const owner = (data) => handle({ auth: { uid: OWNER }, data }, db, NOW);

  // One old item still waiting, then plenty of newer ones already handled.
  const oldId = await postDeskItem(db, item({ title: "An old question", kind: "question" }), NOW - 40 * 86400000);
  const handled = [];
  for (let i = 0; i < 30; i++) handled.push(await postDeskItem(db, item({ title: `Report ${i}` }), NOW - (30 - i) * 3600000));
  for (const id of handled) await handle({ auth: { uid: OWNER }, data: { action: "resolve", id, status: "done" } }, db, NOW - 1000);
  const newId = await postDeskItem(db, item({ title: "Fresh draft", kind: "draft", status: "done" }), NOW - 60000);
  const stored = db.cols.get("hqDesk").get(newId);
  ok(stored.status === "open" && stored.createdAt === NOW - 60000 && stored.resolvedAt === null, "a posted item lands open, stamped by the server");

  const view = await owner({ action: "overview" });
  ok(view.open.map((x) => x.id).join() === `${newId},${oldId}`, "the desk shows every waiting item, newest first");
  ok(view.open.some((x) => x.id === oldId), "an old item still waiting is never pushed off the desk by newer ones");
  ok(view.recent.length === 25 && view.recent.every((x) => x.status !== "open"), "recently handled shows the last 25 handled items, none open");

  const done = await owner({ action: "resolve", id: newId, status: "done" });
  const after = db.cols.get("hqDesk").get(newId);
  ok(done.ok && after.status === "done" && after.resolvedAt === NOW, "Mark done files it as done, now");
  await owner({ action: "resolve", id: newId, status: "open" });
  const back = db.cols.get("hqDesk").get(newId);
  ok(back.status === "open" && back.resolvedAt === null, "Undo puts it back on the desk and clears the handled time");
  await rejects(() => owner({ action: "resolve", id: newId, status: "deleted" }), "invalid-argument", "an unknown status is refused");
  await rejects(() => owner({ action: "resolve", id: "../users/x", status: "done" }), "invalid-argument", "a malformed id is refused");
  await rejects(() => owner({ action: "resolve", id: "nope", status: "done" }), "not-found", "an id that isn't on the desk is not-found");

  await logShift(db, { worker: "bookkeeper", dept: "finance", engine: "claude", startedAt: NOW - 7200000, endedAt: NOW - 7000000, summary: "older" }, NOW);
  await logShift(db, { worker: "front-desk", dept: "front", engine: "claude", startedAt: NOW - 600000, endedAt: NOW - 500000, summary: "newer" }, NOW);
  const withShifts = await owner({ action: "overview" });
  ok(withShifts.shifts.map((s) => s.summary).join() === "newer,older", "time cards come back newest first");
  ok(withShifts.shifts.every((s) => s.loggedAt === NOW), "each time card is stamped when it was logged");
}

console.log(`\n${checks - fails}/${checks} HQ desk checks passed`);
if (fails) process.exit(1);
