// Smooth Training HQ — the owner's spending view (S238).
//
// Kevin: "I do like the addition of having how much money we've spent on
// Glidna in terms of AI usage. Can we also possibly put up the Claude usage on
// there as well? ... can we make that based on every month? And if we click on
// it, can we show weekly? Bi-weekly ... and monthly, and also possibly look at
// a year ... so we can look at all of our spending within a certain time frame."
//
// Three lines of spending, never blended into one figure without saying which
// is which:
//
//   Glidna AI     — what Glidna's own Anthropic account spends on members'
//                   chats, food estimates, photos and workflows. Every AI call
//                   already records its cost per person per day (aiusage.js,
//                   since S167), so this is a SUM of real records, not a guess.
//   Crew (cloud)  — what HQ workers running on Glidna's servers cost, from
//                   their own time cards (hqShifts.costCents).
//                   ⚠️ A cloud worker must record its cost on its time card and
//                   NOT through aiusage.recordUsage under a member's uid — that
//                   would count the same dollars twice, once in each line.
//   Claude plan   — the owner's flat monthly subscription. The dollars don't
//                   move with use, so this line shows the plan's price, the
//                   share of it a period covers, and how many crew shifts ran
//                   on it. Anthropic gives apps no way to read the plan's live
//                   usage meter, so the screen links to claude.ai for that.
//
// ⚠️ ADMIN-SDK ONLY, like the desk. Everything here is reached through the
// hqApi callable, which refuses any caller but the owner before this file runs.
// The cache collections (hqSpendDays, hqSpendMonths) and settings (hqSettings)
// have no match in firestore.rules, so the app can't read or write them either.
//
// Reads are bounded by caching: a day (or month) that has ENDED is summed once
// and stored, so reopening a year costs one read per cached day instead of one
// per member per day. The current day and month are always summed fresh.

const TZ = "America/New_York";
const PERIODS = ["week", "2weeks", "month", "year"];
const DEFAULT_COSTS = { claudePlanCents: 20000, claudePlanName: "Claude plan", claudeSince: "2026-09" };
// A day is final once it ended this long ago. aiusage.js keys a call by the
// moment it FINISHES, so a call that runs across midnight still writes to the
// new day — the margin covers a write that is slow to commit.
const SETTLE_MS = 10 * 60 * 1000;
const GET_ALL_CHUNK = 300;
const MAX_OFFSET = { week: 520, "2weeks": 260, month: 120, year: 10 };

// ── Dates, all in the app's audience timezone (aiusage.js keys days the same way)

function ymdInTz(ms) {
  try { return new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ }); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
}
function parseYmd(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return { y, m, d: d || 1 };
}
function addDays(ymd, n) {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysInMonth(ymd) {
  const { y, m } = parseYmd(ymd);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function lastDayOfMonth(ymd) {
  const { y, m } = parseYmd(ymd);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
// Monday = 0 … Sunday = 6. The app's own week views run Monday to Sunday.
function mondayIndex(ymd) {
  const { y, m, d } = parseYmd(ymd);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// The instant a local date begins in TZ, daylight saving included. Starts from
// the standard offset and corrects by however far the local reading is off.
function zonedMidnightMs(ymd) {
  const { y, m, d } = parseYmd(ymd);
  const target = Date.UTC(y, m - 1, d, 0, 0);
  let guess = target + 5 * 3600000;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const seen = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute));
    if (seen === target) break;
    guess -= seen - target;
  }
  return guess;
}

function daysBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
function monthsBetween(start, end) {
  const out = [];
  let { y, m } = parseYmd(start);
  const last = end.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// The calendar window a period and an offset (0 = the current one, -1 = the one
// before, …) cover. "2weeks" is last week plus this week, stepping by fourteen.
function periodRange(period, offset, todayYmd) {
  if (period === "week" || period === "2weeks") {
    const monday = addDays(todayYmd, -mondayIndex(todayYmd));
    const len = period === "week" ? 7 : 14;
    const lastMonday = addDays(monday, offset * len);
    const start = period === "week" ? lastMonday : addDays(lastMonday, -7);
    return { start, end: addDays(start, len - 1), unit: "day" };
  }
  if (period === "month") {
    const { y, m } = parseYmd(todayYmd);
    const first = new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
    return { start: first, end: lastDayOfMonth(first), unit: "day" };
  }
  const y = parseYmd(todayYmd).y + offset;
  return { start: `${y}-01-01`, end: `${y}-12-31`, unit: "month" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function periodLabel(period, { start, end }) {
  const a = parseYmd(start), b = parseYmd(end);
  if (period === "year") return String(a.y);
  if (period === "month") return `${MONTHS[a.m - 1]} ${a.y}`;
  const left = `${MONTHS[a.m - 1]} ${a.d}`;
  const right = a.m === b.m ? String(b.d) : `${MONTHS[b.m - 1]} ${b.d}`;
  return a.y === b.y ? `${left} – ${right}, ${b.y}` : `${left}, ${a.y} – ${right}, ${b.y}`;
}

// ── Glidna AI: sum every member's recorded cost ─────────────────────────────

async function getAllChunked(db, refs) {
  const out = [];
  for (let i = 0; i < refs.length; i += GET_ALL_CHUNK) {
    const chunk = refs.slice(i, i + GET_ALL_CHUNK);
    if (chunk.length) out.push(...(await db.getAll(...chunk)));
  }
  return out;
}

// One usage doc's contribution. Docs written before S167 carry only `tokens`
// (the budget count) and no cost; those are reported as untracked rather than
// silently priced at zero.
function addUsage(acc, d) {
  if (!d) return acc;
  const calls = Number(d.calls) || 0;
  if (d.costMicros != null) {
    acc.costMicros += Number(d.costMicros) || 0;
    acc.calls += calls;
  } else if (Number(d.tokens) > 0) {
    acc.untrackedTokens += Number(d.tokens) || 0;
  }
  return acc;
}
const emptyTotal = () => ({ costMicros: 0, calls: 0, untrackedTokens: 0 });

// keys: day keys ("2026-09-24") or month keys ("2026-09"); docId maps a key to
// the member's rollup doc id; finalAt says when a key stops changing.
async function glidnaTotals(db, keys, { cache, docId, finalAt }, now) {
  const out = Object.fromEntries(keys.map((k) => [k, emptyTotal()]));
  if (!keys.length) return out;
  const cached = await getAllChunked(db, keys.map((k) => db.collection(cache).doc(k)));
  const missing = [];
  cached.forEach((snap, i) => {
    const k = keys[i];
    const d = snap && snap.exists ? snap.data() : null;
    if (d && d.final === true) {
      out[k] = { costMicros: d.costMicros || 0, calls: d.calls || 0, untrackedTokens: d.untrackedTokens || 0 };
    } else {
      missing.push(k);
    }
  });
  if (!missing.length) return out;
  const users = await db.collection("users").listDocuments();
  const refs = [];
  const owners = [];
  for (const k of missing) {
    for (const u of users) {
      refs.push(db.doc(`users/${u.id}/aiUsage/${docId(k)}`));
      owners.push(k);
    }
  }
  const snaps = await getAllChunked(db, refs);
  snaps.forEach((snap, i) => {
    if (snap && snap.exists) addUsage(out[owners[i]], snap.data());
  });
  // Store what can no longer change. Best-effort: a failed cache write only
  // means the next view sums that key again.
  await Promise.allSettled(missing
    .filter((k) => now >= finalAt(k))
    .map((k) => db.collection(cache).doc(k).set({ ...out[k], final: true, computedAt: now })));
  return out;
}

const dayFinalAt = (day) => zonedMidnightMs(addDays(day, 1)) + SETTLE_MS;
const monthFinalAt = (month) => zonedMidnightMs(addDays(lastDayOfMonth(`${month}-01`), 1)) + SETTLE_MS;

// ── The crew's own time cards ───────────────────────────────────────────────

async function crewTotals(db, startMs, endMs, bucketOf) {
  const snap = await db.collection("hqShifts")
    .where("startedAt", ">=", startMs).where("startedAt", "<", endMs).get();
  const t = { cloudCents: 0, cloudShifts: 0, claudeShifts: 0, claudeMinutes: 0, byBucket: {} };
  for (const doc of snap.docs) {
    const s = doc.data() || {};
    const key = bucketOf(Number(s.startedAt));
    const b = t.byBucket[key] || (t.byBucket[key] = { cloudCents: 0, claudeShifts: 0 });
    const minutes = Math.max(0, (Number(s.endedAt) - Number(s.startedAt)) / 60000) || 0;
    if (s.engine === "cloud") {
      const c = Number(s.costCents) > 0 ? Number(s.costCents) : 0;
      t.cloudCents += c; t.cloudShifts += 1; b.cloudCents += c;
    } else if (s.engine === "claude") {
      t.claudeShifts += 1; t.claudeMinutes += minutes; b.claudeShifts += 1;
    }
  }
  t.cloudCents = Math.round(t.cloudCents * 100) / 100;
  t.claudeMinutes = Math.round(t.claudeMinutes);
  return t;
}

// ── The flat Claude plan ────────────────────────────────────────────────────

async function readCosts(db) {
  const snap = await db.collection("hqSettings").doc("costs").get();
  const d = (snap && snap.exists && snap.data()) || {};
  return {
    claudePlanCents: Number.isFinite(d.claudePlanCents) ? d.claudePlanCents : DEFAULT_COSTS.claudePlanCents,
    claudePlanName: d.claudePlanName || DEFAULT_COSTS.claudePlanName,
    claudeSince: /^\d{4}-\d{2}$/.test(d.claudeSince || "") ? d.claudeSince : DEFAULT_COSTS.claudeSince,
    edited: snap && snap.exists === true,
  };
}

// The plan is billed monthly, so a period's share is each covered day's slice
// of its own month's price: a whole month is exactly the price, a week about a
// quarter of it. Days before the plan was counted from, and days in months not
// billed yet, count nothing.
function claudeShareCents(costs, days, todayYmd) {
  const since = `${costs.claudeSince}-01`;
  const billedThrough = lastDayOfMonth(todayYmd);
  let share = 0;
  for (const d of days) {
    if (d < since || d > billedThrough) continue;
    share += costs.claudePlanCents / daysInMonth(d);
  }
  return Math.round(share);
}

async function readMeter(db) {
  const snap = await db.collection("hqPlanUsage").doc("latest").get();
  return snap && snap.exists ? snap.data() : null;
}

// ── The report ──────────────────────────────────────────────────────────────

function bad(msg) {
  const e = new Error(msg);
  e.code = "invalid-argument";
  return e;
}

async function spendReport(db, data, now = Date.now()) {
  const period = PERIODS.includes(data && data.period) ? data.period : "month";
  const offset = Math.trunc(Number((data && data.offset) || 0));
  if (!Number.isFinite(offset) || offset > 0 || offset < -MAX_OFFSET[period]) {
    throw bad("offset must be 0 (this period) or a negative number of periods back.");
  }
  const today = ymdInTz(now);
  const range = periodRange(period, offset, today);
  const days = daysBetween(range.start, range.end);
  const pastDays = days.filter((d) => d <= today);
  const startMs = zonedMidnightMs(range.start);
  const endMs = zonedMidnightMs(addDays(range.end, 1));

  let glidna, bucketKeys, bucketOf;
  if (range.unit === "day") {
    bucketKeys = days;
    bucketOf = (ms) => ymdInTz(ms);
    glidna = await glidnaTotals(db, pastDays, { cache: "hqSpendDays", docId: (k) => k, finalAt: dayFinalAt }, now);
  } else {
    bucketKeys = monthsBetween(range.start, range.end);
    bucketOf = (ms) => ymdInTz(ms).slice(0, 7);
    const pastMonths = bucketKeys.filter((m) => m <= today.slice(0, 7));
    glidna = await glidnaTotals(db, pastMonths, { cache: "hqSpendMonths", docId: (k) => `m-${k}`, finalAt: monthFinalAt }, now);
  }
  const [crew, costs, meter] = await Promise.all([
    crewTotals(db, startMs, endMs, bucketOf), readCosts(db), readMeter(db),
  ]);

  const buckets = bucketKeys.map((key) => {
    const g = glidna[key] || emptyTotal();
    const c = crew.byBucket[key] || { cloudCents: 0, claudeShifts: 0 };
    return {
      key,
      future: range.unit === "day" ? key > today : key > today.slice(0, 7),
      glidnaMicros: g.costMicros,
      calls: g.calls,
      crewCents: Math.round(c.cloudCents * 100) / 100,
      claudeShifts: c.claudeShifts,
    };
  });
  const total = Object.values(glidna).reduce((acc, g) => {
    acc.costMicros += g.costMicros; acc.calls += g.calls; acc.untrackedTokens += g.untrackedTokens; return acc;
  }, emptyTotal());
  const claudeCents = claudeShareCents(costs, days, today);
  const glidnaCents = total.costMicros / 10000;

  return {
    period, offset, label: periodLabel(period, range),
    start: range.start, end: range.end, unit: range.unit, today,
    hasNext: offset < 0,
    buckets,
    glidna: { cents: Math.round(glidnaCents * 100) / 100, costMicros: total.costMicros, calls: total.calls,
      untrackedTokens: total.untrackedTokens },
    crew: { cloudCents: crew.cloudCents, cloudShifts: crew.cloudShifts,
      claudeShifts: crew.claudeShifts, claudeMinutes: crew.claudeMinutes },
    claude: { planCents: costs.claudePlanCents, planName: costs.claudePlanName, since: costs.claudeSince,
      edited: costs.edited, shareCents: claudeCents, meter },
    totalCents: Math.round((glidnaCents + crew.cloudCents + claudeCents) * 100) / 100,
  };
}

// The owner can correct the plan's price and name. Nothing else about spending
// is editable: the other lines are records, not settings.
async function setCosts(db, data, now = Date.now()) {
  const i = data && typeof data === "object" ? data : {};
  const patch = { updatedAt: now };
  if (i.claudePlanCents !== undefined) {
    const c = Number(i.claudePlanCents);
    if (!Number.isInteger(c) || c < 0 || c > 1000000) throw bad("claudePlanCents must be a whole number of cents up to $10,000.");
    patch.claudePlanCents = c;
  }
  if (i.claudePlanName !== undefined) {
    // eslint-disable-next-line no-control-regex
    const name = String(i.claudePlanName || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 40);
    if (!name) throw bad("claudePlanName can't be empty.");
    patch.claudePlanName = name;
  }
  if (i.claudeSince !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(i.claudeSince))) throw bad("claudeSince must look like 2026-09.");
    patch.claudeSince = String(i.claudeSince);
  }
  if (Object.keys(patch).length === 1) throw bad("Nothing to change.");
  await db.collection("hqSettings").doc("costs").set(patch, { merge: true });
  return { ok: true, costs: await readCosts(db) };
}

module.exports = {
  spendReport, setCosts,
  // for the suite
  _dates: { ymdInTz, addDays, zonedMidnightMs, periodRange, periodLabel, daysBetween, monthsBetween,
    mondayIndex, daysInMonth, lastDayOfMonth },
  _claudeShareCents: claudeShareCents,
  SPEND_PERIODS: PERIODS, DEFAULT_COSTS, SETTLE_MS,
};
