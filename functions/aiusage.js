// AI usage accounting (S167).
//
// Two things were wrong with what the admin dashboard could show.
//
// 1. The day was a UTC day. Glidna's audience is Eastern, where a UTC day ends
//    at 8pm local — so "AI today" dropped everything logged that evening and
//    silently carried in usage from the night before. Every date key in the app
//    has been local since S45; this brings the server side in line.
// 2. Only one number was stored: `tokens` = input + output + cacheWrite, the
//    BUDGET basis (cache reads are excluded because they bill at ~10%). That
//    number can't be turned into money — the four kinds of token cost four
//    different amounts — and cache reads, which are usually the largest count,
//    weren't recorded at all.
//
// So each call now records the full breakdown and its cost, into four rollups:
// the day (which is still the budget doc), the month, the year, and lifetime.
// Rollups are incremented at write time rather than summed at read time, so a
// year of spend is one document read instead of 365.
const admin = require("firebase-admin");

// USD per 1,000,000 tokens. Cache reads bill at ~10% of input; cache writes at
// 1.25x input for the 5-minute TTL this app uses (aichat.js marks its system
// prompt `ephemeral` with no explicit ttl). Verified against Anthropic's
// published pricing 2026-07-31.
const PRICING = {
  "claude-sonnet-4-6": { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-opus-4-8":   { input: 5.00, output: 25.00, cacheWrite: 6.25, cacheRead: 0.50 },
  "claude-haiku-4-5":  { input: 1.00, output: 5.00,  cacheWrite: 1.25, cacheRead: 0.10 },
};
const DEFAULT_MODEL = "claude-sonnet-4-6";

// Cost in MICRO-dollars (1e-6 USD), as an integer. Firestore increments are
// floats; accumulating dollars across thousands of calls would drift in the
// cents. Integers don't.
function costMicros(agg, model) {
  const p = PRICING[model] || PRICING[DEFAULT_MODEL];
  const usd = ((agg.input || 0) * p.input
    + (agg.output || 0) * p.output
    + (agg.cacheWrite || 0) * p.cacheWrite
    + (agg.cacheRead || 0) * p.cacheRead) / 1e6;
  return Math.round(usd * 1e6);
}

// Local date keys, in the app's audience timezone. en-CA renders ISO-style
// (YYYY-MM-DD), which is what the rest of the app keys on.
const TZ = "America/New_York";
function localYMD(d) {
  try { return (d || new Date()).toLocaleDateString("en-CA", { timeZone: TZ }); }
  catch { return (d || new Date()).toISOString().slice(0, 10); } // tz database missing
}
const dayKey = (d) => localYMD(d);                       // 2026-07-31  (also the budget doc)
const monthKey = (d) => `m-${localYMD(d).slice(0, 7)}`;  // m-2026-07
const yearKey = (d) => `y-${localYMD(d).slice(0, 4)}`;   // y-2026

// Record one call against every rollup. `agg` is the accumulated Anthropic
// usage for the turn: {input, output, cacheWrite, cacheRead}.
//
// `tokens` keeps its existing meaning — input + output + cacheWrite — because
// the daily budget check reads it. Everything else is additive, so old day docs
// (which only have `tokens`) still work; they just report no cost.
async function recordUsage(db, uid, agg, source) {
  // This runs inside a `finally` on every AI path, so it must never throw: an
  // exception here would REPLACE the reply the user is waiting on with an
  // error. Accounting failing is bad; failing a good answer in order to report
  // it is worse. (S167 shipped without this guard and a scope bug did exactly
  // that — every chat turn errored after the reply had already been produced.)
  try {
    return await writeUsage(db, uid, agg, source);
  } catch (e) {
    console.error("recordUsage failed:", (e && e.stack) || e);
    return null;
  }
}

async function writeUsage(db, uid, agg, source) {
  const model = (agg && agg.model) || DEFAULT_MODEL;
  const budgetTokens = (agg.input || 0) + (agg.output || 0) + (agg.cacheWrite || 0);
  if (budgetTokens <= 0 && !(agg.cacheRead > 0)) return null;
  const inc = admin.firestore.FieldValue.increment;
  const patch = {
    tokens: inc(budgetTokens),
    input: inc(agg.input || 0),
    output: inc(agg.output || 0),
    cacheWrite: inc(agg.cacheWrite || 0),
    cacheRead: inc(agg.cacheRead || 0),
    calls: inc(1),
    costMicros: inc(costMicros(agg, model)),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const now = new Date();
  const col = db.collection(`users/${uid}/aiUsage`);
  // Best-effort and independent: a rollup that fails must never fail the reply
  // the user is waiting on, and must not take the other rollups down with it.
  const writes = [
    col.doc(dayKey(now)).set(patch, { merge: true }),
    col.doc(monthKey(now)).set(patch, { merge: true }),
    col.doc(yearKey(now)).set(patch, { merge: true }),
    col.doc("meta").set(patch, { merge: true }),
  ];
  const results = await Promise.allSettled(writes);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("aiUsage write failed:", (r.reason && r.reason.message) || r.reason);
    }
  }
  console.log("aiUsage", JSON.stringify({
    fn: source || "ai", model, ...agg, budgetTokens, costMicros: costMicros(agg, model),
  }));
  return budgetTokens;
}

// Shape a usage doc for the client. Old docs carry only `tokens`, so cost and
// the breakdown come back null rather than a misleading zero.
function readUsage(snap) {
  const d = (snap && snap.data && snap.data()) || {};
  const hasBreakdown = d.costMicros != null;
  return {
    tokens: d.tokens || 0,
    input: d.input || 0,
    output: d.output || 0,
    cacheWrite: d.cacheWrite || 0,
    cacheRead: d.cacheRead || 0,
    calls: d.calls || 0,
    costMicros: hasBreakdown ? (d.costMicros || 0) : null,
    boost: d.boost || 0,
  };
}

module.exports = { PRICING, DEFAULT_MODEL, costMicros, dayKey, monthKey, yearKey, localYMD, recordUsage, readUsage };
