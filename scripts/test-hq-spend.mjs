// Smooth Training HQ — the spending sheet (S238, functions/hqSpend.js +
// src/HQSpend.jsx).
//
// Kevin: "can we make that based on every month? And if we click on it, can we
// show weekly? Bi-weekly ... and monthly, and also possibly look at a year".
// The promises, RUN rather than read:
//
//   • THE CALENDAR IS THE APP'S, NOT UTC'S. A day is an Eastern day (the S45
//     lesson: a UTC day ends at 8pm in Miami), daylight saving included, and
//     weeks run Monday to Sunday like the app's own week views.
//   • EVERY DOLLAR IS A RECORD. Glidna AI is the sum of what each member's AI
//     requests cost as recorded (aiusage.js); a day with usage but no recorded
//     cost is reported as untracked, never priced at zero.
//   • A FINISHED DAY IS SUMMED ONCE. Past days are cached and never re-read per
//     member; today is always fresh — a cache that kept today would freeze the
//     number the owner is watching.
//   • ONLY THE OWNER, and the new collections have no door in firestore.rules.
//
// Run: node scripts/test-hq-spend.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { stripComments } from "./lib/strip-comments.mjs";

const require = createRequire(import.meta.url);
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "calorieiq-29762";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const spend = require("../functions/hqSpend.js");
const { _handleHq: handle } = require("../functions/hq.js");
const D = spend._dates;
const OWNER = "G7QUZ8Kat1fgyoMjdGKz4DYoVHi1";

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
async function rejects(fn, code, msg) {
  try { await fn(); ok(false, `${msg} (did not throw)`); }
  catch (e) { ok(e && e.code === code, `${msg} (got ${e && e.code}: ${e && e.message})`); }
}

// ── A Firestore double with what hqSpend.js uses ────────────────────────────
// Paths are flat strings ("users/u1/aiUsage/2026-09-24"). Every document read
// is counted by collection, so the suite can prove the cache actually spares
// the per-member reads.
function fakeDb() {
  const docs = new Map();
  const reads = {};
  const countRead = (path) => {
    const parts = path.split("/");
    const col = parts.length > 2 ? parts[parts.length - 2] : parts[0];
    reads[col] = (reads[col] || 0) + 1;
  };
  const snap = (path) => {
    const d = docs.get(path);
    return { id: path.split("/").pop(), exists: d !== undefined, data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))) };
  };
  const ref = (path) => ({
    id: path.split("/").pop(), path,
    async get() { countRead(path); return snap(path); },
    async set(obj, opts) {
      const cur = opts && opts.merge ? docs.get(path) || {} : {};
      docs.set(path, { ...cur, ...JSON.parse(JSON.stringify(obj)) });
    },
  });
  const query = (name, filters = []) => ({
    where(f, op, v) {
      if (![">=", "<", "=="].includes(op)) throw new Error("fake supports >=, < and ==");
      return query(name, [...filters, [f, op, v]]);
    },
    async get() {
      const rows = [...docs.entries()].filter(([p]) => p.startsWith(`${name}/`) && p.split("/").length === 2)
        .filter(([, d]) => filters.every(([f, op, v]) => (op === ">=" ? d[f] >= v : op === "<" ? d[f] < v : d[f] === v)));
      rows.forEach(([p]) => countRead(p));
      return { docs: rows.map(([p]) => snap(p)) };
    },
  });
  return {
    docs, reads,
    doc: (path) => ref(path),
    collection(name) {
      return {
        ...query(name),
        doc: (id) => ref(`${name}/${id}`),
        async listDocuments() {
          const ids = new Set();
          for (const p of docs.keys()) if (p.startsWith(`${name}/`)) ids.add(p.split("/")[1]);
          return [...ids].map((id) => ref(`${name}/${id}`));
        },
      };
    },
    async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); },
    resetReads() { for (const k of Object.keys(reads)) delete reads[k]; },
  };
}

// 2026-09-24 12:00 Eastern (EDT, UTC-4) — a Thursday.
const NOW = Date.UTC(2026, 8, 24, 16, 0, 0);

// ── 1. The calendar ─────────────────────────────────────────────────────────
console.log("dates");
{
  eq(D.ymdInTz(Date.UTC(2026, 8, 25, 2, 30)), "2026-09-24", "10:30pm in Miami is still that day, though UTC has moved on");
  eq(D.zonedMidnightMs("2026-09-24"), Date.UTC(2026, 8, 24, 4, 0), "midnight in summer is 04:00 UTC");
  eq(D.zonedMidnightMs("2026-01-15"), Date.UTC(2026, 0, 15, 5, 0), "midnight in winter is 05:00 UTC");
  eq(D.zonedMidnightMs("2026-03-08"), Date.UTC(2026, 2, 8, 5, 0), "the day clocks spring forward still starts on standard time");
  eq(D.zonedMidnightMs("2026-03-09"), Date.UTC(2026, 2, 9, 4, 0), "…and the next day starts on daylight time");
  eq(D.zonedMidnightMs("2026-11-01"), Date.UTC(2026, 10, 1, 4, 0), "the day clocks fall back starts on daylight time");
  eq(D.zonedMidnightMs("2026-11-02"), Date.UTC(2026, 10, 2, 5, 0), "…and the next day on standard time");
  const today = "2026-09-24";
  eq(D.periodRange("week", 0, today), { start: "2026-09-21", end: "2026-09-27", unit: "day" }, "this week runs Monday to Sunday");
  eq(D.periodRange("week", -1, today), { start: "2026-09-14", end: "2026-09-20", unit: "day" }, "last week");
  eq(D.periodRange("2weeks", 0, today), { start: "2026-09-14", end: "2026-09-27", unit: "day" }, "two weeks is last week plus this one");
  eq(D.periodRange("2weeks", -1, today), { start: "2026-08-31", end: "2026-09-13", unit: "day" }, "…stepping back fourteen days at a time");
  eq(D.periodRange("month", 0, today), { start: "2026-09-01", end: "2026-09-30", unit: "day" }, "this month");
  eq(D.periodRange("month", -1, "2026-01-10"), { start: "2025-12-01", end: "2025-12-31", unit: "day" }, "last month across a new year");
  eq(D.periodRange("month", -7, "2026-09-24"), { start: "2026-02-01", end: "2026-02-28", unit: "day" }, "February has its own length");
  eq(D.periodRange("year", 0, today), { start: "2026-01-01", end: "2026-12-31", unit: "month" }, "a year is counted in months");
  eq(D.periodRange("week", 0, "2026-09-28"), { start: "2026-09-28", end: "2026-10-04", unit: "day" }, "a Monday starts its own week");
  eq(D.periodRange("week", 0, "2026-09-27"), { start: "2026-09-21", end: "2026-09-27", unit: "day" }, "a Sunday ends its week");
  eq(D.periodLabel("week", { start: "2026-09-21", end: "2026-09-27" }), "Sep 21 – 27, 2026", "a week's label");
  eq(D.periodLabel("2weeks", { start: "2026-08-31", end: "2026-09-13" }), "Aug 31 – Sep 13, 2026", "a label across months");
  eq(D.periodLabel("week", { start: "2025-12-29", end: "2026-01-04" }), "Dec 29, 2025 – Jan 4, 2026", "a label across years");
  eq(D.periodLabel("month", { start: "2026-09-01", end: "2026-09-30" }), "Sep 2026", "a month's label");
  eq(D.periodLabel("year", { start: "2026-01-01", end: "2026-12-31" }), "2026", "a year's label");
  eq(D.monthsBetween("2026-01-01", "2026-12-31").length, 12, "a year has twelve months");
  eq(D.daysBetween("2026-02-01", "2026-02-28").length, 28, "February 2026 has 28 days");
}

// ── 2. The flat Claude plan ─────────────────────────────────────────────────
console.log("claude plan");
{
  const costs = { claudePlanCents: 20000, claudeSince: "2026-09" };
  const share = spend._claudeShareCents;
  eq(share(costs, D.daysBetween("2026-09-01", "2026-09-30"), "2026-09-24"), 20000, "a whole month is exactly the plan's price");
  const week = share(costs, D.daysBetween("2026-09-21", "2026-09-27"), "2026-09-24");
  eq(week, Math.round((20000 * 7) / 30), "a week is seven thirtieths of September's price");
  eq(share(costs, D.daysBetween("2026-08-31", "2026-09-06"), "2026-09-24"), Math.round((20000 * 6) / 30),
    "days before the plan was counted from cost nothing");
  eq(share(costs, D.daysBetween("2026-01-01", "2026-12-31"), "2026-09-24"), 20000,
    "this year so far counts only the months already billed");
  eq(share(costs, D.daysBetween("2025-01-01", "2025-12-31"), "2026-09-24"), 0, "a year before the plan counts nothing");
  eq(share({ claudePlanCents: 10000, claudeSince: "2026-01" }, D.daysBetween("2026-01-01", "2026-12-31"), "2026-09-24"), 90000,
    "January to September at $100 is $900");
}

// ── 3. The report ───────────────────────────────────────────────────────────
console.log("report");
const usage = (over) => ({ tokens: 1000, calls: 3, costMicros: 12000, ...over });
function seed(db) {
  // Two members and the owner. A day doc per day of use, a month rollup, and
  // one old doc from before cost was recorded.
  db.docs.set("users/u1", { role: "client" });
  db.docs.set("users/u2", { role: "client" });
  db.docs.set(`users/${OWNER}`, { role: "head_trainer" });
  db.docs.set("users/u1/aiUsage/2026-09-22", usage({ calls: 4, costMicros: 250000 }));   // $0.25
  db.docs.set("users/u2/aiUsage/2026-09-22", usage({ calls: 1, costMicros: 50000 }));    // $0.05
  db.docs.set("users/u1/aiUsage/2026-09-24", usage({ calls: 2, costMicros: 100000 }));   // $0.10, today
  db.docs.set("users/u2/aiUsage/2026-09-15", usage({ calls: 6, costMicros: 600000 }));   // last week
  db.docs.set("users/u1/aiUsage/2026-07-20", { tokens: 5000 });                          // before costs were recorded
  db.docs.set("users/u1/aiUsage/m-2026-09", usage({ calls: 6, costMicros: 350000 }));
  db.docs.set("users/u2/aiUsage/m-2026-09", usage({ calls: 7, costMicros: 650000 }));
  db.docs.set("users/u1/aiUsage/m-2026-08", usage({ calls: 10, costMicros: 1000000 }));
  db.docs.set("users/u1/aiUsage/m-2026-07", { tokens: 5000 });
  // Time cards: a cloud shift and a Claude shift this week, one late on a
  // Tuesday evening (after 8pm in Miami = Wednesday in UTC), one last month.
  db.docs.set("hqShifts/s1", { engine: "cloud", startedAt: Date.UTC(2026, 8, 23, 1, 30), endedAt: Date.UTC(2026, 8, 23, 1, 40), costCents: 3.5 });
  db.docs.set("hqShifts/s2", { engine: "claude", startedAt: Date.UTC(2026, 8, 21, 12, 0), endedAt: Date.UTC(2026, 8, 21, 12, 6), costCents: null });
  db.docs.set("hqShifts/s3", { engine: "cloud", startedAt: Date.UTC(2026, 7, 10, 12, 0), endedAt: Date.UTC(2026, 7, 10, 12, 5), costCents: 9 });
}
{
  const db = fakeDb();
  seed(db);
  const r = await spend.spendReport(db, { period: "week", offset: 0 }, NOW);
  eq(r.label, "Sep 21 – 27, 2026", "the week's label");
  eq(r.buckets.map((b) => b.key), D.daysBetween("2026-09-21", "2026-09-27"), "one bar per day, Monday first");
  eq(r.buckets.map((b) => b.future), [false, false, false, false, true, true, true], "days after today are marked as not yet");
  eq(r.buckets[1].glidnaMicros, 300000, "Tuesday sums both members' recorded cost");
  eq(r.buckets[1].calls, 5, "…and their requests");
  eq(r.buckets[3].glidnaMicros, 100000, "today is counted too");
  eq(r.glidna.cents, 40, "the week's Glidna AI is 40 cents");
  eq(r.crew.cloudCents, 3.5, "the cloud shift's cost is counted");
  eq(r.crew.cloudShifts, 1, "one cloud shift");
  eq(r.crew.claudeShifts, 1, "one shift ran on the Claude plan");
  eq(r.crew.claudeMinutes, 6, "…for six minutes");
  eq(r.buckets[1].crewCents, 3.5, "a shift at 9:30pm Monday in Miami lands on Monday, not UTC's Tuesday");
  ok(r.buckets[0].claudeShifts === 1, "the Claude shift lands on its own day");
  eq(r.claude.planCents, 20000, "the plan defaults to $200 a month");
  eq(r.claude.shareCents, Math.round((20000 * 7) / 30), "the week carries its share of the plan");
  eq(r.totalCents, Math.round((40 + 3.5 + r.claude.shareCents) * 100) / 100, "the total is all three lines");
  ok(r.hasNext === false, "there is no later week than this one");

  // The cache: past days are stored, today is not.
  const cachedDays = [...db.docs.keys()].filter((p) => p.startsWith("hqSpendDays/")).map((p) => p.split("/")[1]).sort();
  eq(cachedDays, ["2026-09-21", "2026-09-22", "2026-09-23"], "the finished days are cached, and today is not");
  ok(db.docs.get("hqSpendDays/2026-09-22").final === true, "a cached day says it is final");

  db.resetReads();
  db.docs.set("users/u2/aiUsage/2026-09-24", usage({ calls: 1, costMicros: 20000 }));
  const again = await spend.spendReport(db, { period: "week", offset: 0 }, NOW + 60000);
  eq(again.buckets[3].glidnaMicros, 120000, "today is summed fresh, so a new request shows up");
  eq(db.reads.aiUsage, 3, `the second look reads the members' docs for TODAY only (read ${db.reads.aiUsage})`);

  // A cache doc that doesn't say it is final (a half-written one, say) is not
  // trusted: the day is summed again from the members' records.
  const db3 = fakeDb(); seed(db3);
  db3.docs.set("hqSpendDays/2026-09-22", { costMicros: 999, calls: 1, untrackedTokens: 0 });
  const r3 = await spend.spendReport(db3, { period: "week", offset: 0 }, NOW);
  eq(r3.buckets[1].glidnaMicros, 300000, "a cache entry that isn't marked final is ignored");

  // A day that ended minutes ago might still receive a late write: not cached yet.
  const justAfter = D.zonedMidnightMs("2026-09-25") + 5 * 60000;
  const db2 = fakeDb(); seed(db2);
  await spend.spendReport(db2, { period: "week", offset: 0 }, justAfter);
  ok(!db2.docs.has("hqSpendDays/2026-09-24"), "a day that ended five minutes ago is not frozen into the cache");
  const later = D.zonedMidnightMs("2026-09-25") + 11 * 60000;
  await spend.spendReport(db2, { period: "week", offset: 0 }, later);
  ok(db2.docs.has("hqSpendDays/2026-09-24"), "…but it is once it has settled");

  // Untracked usage from before costs were recorded.
  const july = await spend.spendReport(fakeDbSeeded(), { period: "month", offset: -2 }, NOW);
  eq(july.label, "Jul 2026", "two months back is July");
  eq(july.glidna.cents, 0, "a month with no recorded cost shows no dollars");
  eq(july.glidna.untrackedTokens, 5000, "…and reports its unpriced usage instead of hiding it");

  // Years use the month rollups.
  const dbY = fakeDbSeeded();
  const year = await spend.spendReport(dbY, { period: "year", offset: 0 }, NOW);
  eq(year.unit, "month", "a year is drawn by month");
  eq(year.buckets.length, 12, "twelve bars");
  eq(year.buckets[8].glidnaMicros, 1000000, "September sums both members' month rollups");
  eq(year.buckets[7].glidnaMicros, 1000000, "August too");
  ok(year.buckets.slice(9).every((b) => b.future && b.glidnaMicros === 0), "months still to come are empty and marked");
  eq(year.glidna.untrackedTokens, 5000, "July's unpriced usage is reported");
  eq(year.crew.cloudCents, 12.5, "every cloud shift of the year is counted");
  ok(dbY.docs.has("hqSpendMonths/2026-08") && !dbY.docs.has("hqSpendMonths/2026-09"),
    "a finished month is cached, the current one is not");

  // Offsets.
  await rejects(() => spend.spendReport(fakeDb(), { period: "week", offset: 1 }, NOW), "invalid-argument", "the future can't be asked for");
  await rejects(() => spend.spendReport(fakeDb(), { period: "year", offset: -11 }, NOW), "invalid-argument", "nor ten years back");
  const unknown = await spend.spendReport(fakeDbSeeded(), { period: "decade" }, NOW);
  eq(unknown.period, "month", "an unknown period falls back to the month");
}
function fakeDbSeeded() { const db = fakeDb(); seed(db); return db; }

// ── 4. The plan's price ─────────────────────────────────────────────────────
console.log("settings");
{
  const db = fakeDbSeeded();
  await rejects(() => spend.setCosts(db, { claudePlanCents: 12.5 }, NOW), "invalid-argument", "a price must be whole cents");
  await rejects(() => spend.setCosts(db, { claudePlanCents: -1 }, NOW), "invalid-argument", "…and not negative");
  await rejects(() => spend.setCosts(db, { claudeSince: "2026-13" }, NOW), "invalid-argument", "a start month must be a real month");
  await rejects(() => spend.setCosts(db, {}, NOW), "invalid-argument", "an empty change is refused");
  const saved = await spend.setCosts(db, { claudePlanCents: 10000, claudePlanName: "Claude Max 5x\u0007" }, NOW);
  eq(saved.costs.claudePlanCents, 10000, "the new price is saved");
  eq(saved.costs.claudePlanName, "Claude Max 5x", "control characters are stripped from the name");
  const r = await spend.spendReport(db, { period: "month", offset: 0 }, NOW);
  eq(r.claude.shareCents, 10000, "the report uses the saved price");
}

// ── 5. Only the owner ───────────────────────────────────────────────────────
console.log("only the owner");
{
  const db = fakeDbSeeded();
  db.resetReads();
  await rejects(() => handle({ data: { action: "spend" } }, db, NOW), "unauthenticated", "a signed-out caller is refused");
  await rejects(() => handle({ auth: { uid: "u1" }, data: { action: "spend" } }, db, NOW), "permission-denied", "a member is refused");
  await rejects(() => handle({ auth: { uid: "u1" }, data: { action: "setCosts", claudePlanCents: 1 } }, db, NOW),
    "permission-denied", "…and can't change the price");
  ok(Object.keys(db.reads).length === 0, "a refused caller reads nothing");
  const r = await handle({ auth: { uid: OWNER }, data: { action: "spend", period: "week", offset: 0 } }, db, NOW);
  eq(r.glidna.cents, 40, "the owner gets the report through the callable");
  await rejects(() => handle({ auth: { uid: OWNER }, data: { action: "spend", period: "week", offset: 3 } }, db, NOW),
    "invalid-argument", "a bad offset comes back as a readable error, not an internal one");
  const rules = readFileSync(join(ROOT, "firestore.rules"), "utf8");
  ok(!/hqSpendDays|hqSpendMonths|hqSettings|hqPlanUsage/.test(rules), "firestore.rules has no door into the spending collections");
}

// ── 6. The screen ───────────────────────────────────────────────────────────
console.log("the screen");
{
  const hq = stripComments(readFileSync(join(ROOT, "src", "HQ.jsx"), "utf8"));
  const sheet = stripComments(readFileSync(join(ROOT, "src", "HQSpend.jsx"), "utf8"));
  ok(/callHq\(\{ action: "spend", period, offset \}\)/.test(hq), "spending comes through the owner-checked callable");
  ok(/callHq\(\{ action: "setCosts", \.\.\.patch \}\)/.test(hq), "the price is saved through the same door");
  ok(/const aiSpendCents = spend \? spend\.glidna\.cents \+ spend\.crew\.cloudCents : null;/.test(hq),
    "the station's AI spend is Glidna AI plus the cloud crew — the flat plan is not in it");
  ok(/const claudeRuns = spend \? spend\.crew\.claudeShifts : null;/.test(hq), "the Claude number is the crew's shifts on the plan");
  ok((hq.match(/onClick=\{\(e\) => openSpend\("(all|claude)", e\)\}/g) || []).length === 2, "both money numbers open the spending sheet");
  ok(/if \(spendViewRef\.current\) \{ closeSpendRef\.current\(\); return; \}/.test(hq), "Escape closes the sheet before the HQ");
  ok(/\{aiSpendCents == null \? "–" : money\(aiSpendCents\)\}/.test(hq), "an unknown spend shows a dash, never a zero that looks real");
  ok(/https:\/\/claude\.ai\/settings\/usage/.test(sheet), "the live Claude meter links to claude.ai");
  ok(!/hqSpend|functions\//.test(sheet), "the sheet only draws what the server sends");
  for (const id of ["week", "2weeks", "month", "year"]) ok(sheet.includes(`id: "${id}"`), `the sheet offers "${id}"`);
  // money(), lifted and run.
  const src = readFileSync(join(ROOT, "src", "HQSpend.jsx"), "utf8");
  const start = src.indexOf("export function money(");
  const end = src.indexOf("\n}\n", start) + 2;
  const money = new Function(`${src.slice(start, end).replace("export ", "")}; return money;`)();
  eq(money(0), "$0.00", "nothing is $0.00");
  eq(money(0.4), "<$0.01", "a fraction of a cent is shown as under a cent, not as nothing");
  eq(money(123456), "$1,234.56", "thousands get a comma");
  eq(money(40), "$0.40", "forty cents");
}

console.log(`\n${checks - fails}/${checks} HQ spending checks passed`);
if (fails) process.exit(1);
