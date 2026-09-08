// The trainer's session ledger (S211).
//
// Kevin: "every logged session kept for life, browsable per trainer by year /
// month / week of month / day, typeable or scrollable, including cancelled and
// rescheduled ones."
//
// WHAT HAS TO STAY TRUE:
//
//   1. NOTHING IS EVER HIDDEN. Cancelled, waived, disputed, no-show and moved
//      sessions all appear. A ledger that quietly drops the awkward ones is
//      worse than no ledger, because it looks complete.
//   2. IT ADDS NO QUERY AND NO INDEX. `participants array-contains` plus a
//      range on `startAt` needs a composite index — the trap
//      functions/availability.js and calendarFeed.js both document. Every
//      narrowing is pure JS over the array the calendar already holds.
//   3. A CHIP THAT WOULD SHOW NOTHING IS NEVER OFFERED, and a selection that a
//      new search has made impossible is dropped rather than silently
//      emptying the screen.
//   4. "DELIVERED VALUE" IS NOT MONEY COLLECTED. A no-show bills a percentage
//      the session document doesn't store, a waive bills nothing, and a
//      disputed session bills nothing yet — so none of the three may be summed
//      into a figure a trainer could read as earnings.
//   5. A RESCHEDULE IS REMEMBERED, and remembering it is idempotent — the
//      trigger that records it is delivered at least once.
//
// Run: node scripts/test-session-ledger.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSIONS = readFileSync(join(ROOT, "src", "sessions.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const RULES = readFileSync(join(ROOT, "firestore.rules"), "utf8");
const AUDIT = require(join(ROOT, "functions", "sessionAudit.js"));

const codeOnly = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const APP_CODE = codeOnly(APP);

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── lift the WHOLE builder and run it ───────────────────────────────────────
// Not a transcription: the shipping bodies, executed, so a mutation to
// src/sessions.js fails this file (the S199 lesson, paid for twice).
const liftFn = (name) => {
  const m = SESSIONS.match(new RegExp(`\\n(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0].replace(/\nexport /, "\n");
};
const liftConst = (name) => {
  const m = SESSIONS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0].replace(/^export /, "");
};
const L = new Function(`
  ${liftConst("SESSION_DEFAULT_MIN")}
  ${liftConst("sessionEndMs")}
  ${liftConst("LEDGER_MONTHS")}
  ${liftConst("LEDGER_PAGE")}
  ${liftConst("weekOfMonth")}
  ${liftConst("weekOfMonthLabel")}
  ${liftConst("rescheduleHistory")}
  ${liftFn("trainerNoShowState")}
  ${liftFn("ledgerOutcome")}
  ${SESSIONS.match(/const ymdKey = \([\s\S]*?\n\};/)[0]}
  ${SESSIONS.match(/function ledgerHaystack\([\s\S]*?\n\}/)[0]}
  ${liftFn("sessionLedger")}
  return { sessionLedger, ledgerOutcome, weekOfMonth, weekOfMonthLabel, rescheduleHistory };
`)();
const { sessionLedger, ledgerOutcome, weekOfMonth, rescheduleHistory } = L;

const NAMES = { c1: "Casey Client", c2: "Pat Prospect" };
const nameOf = (uid) => NAMES[uid] || "Client";
const at = (y, m, d, h = 9) => new Date(y, m, d, h, 0, 0, 0).getTime();
const NOW = at(2026, 8, 7, 15);      // 7 Sep 2026, local
const S = (over = {}) => ({
  id: `s${Math.random().toString(36).slice(2, 8)}`,
  trainerUid: "t1", clientUid: "c1", participants: ["t1", "c1"],
  startAt: at(2026, 8, 3), durationMin: 60, status: "scheduled",
  priceCents: 8500, ...over,
});
const build = (list, opts = {}) => sessionLedger(list, { nameOf, now: NOW, ...opts });

// ── 1. nothing is hidden ────────────────────────────────────────────────────
{
  const list = [
    S({ id: "a", startAt: at(2026, 8, 3), completedAt: at(2026, 8, 3, 10), settled: "charged" }),
    S({ id: "b", startAt: at(2026, 8, 4), status: "cancelled", cancelledBy: "c1", cancelledAt: at(2026, 8, 3) }),
    S({ id: "c", startAt: at(2026, 8, 5), status: "cancelled", cancelledBy: "t1", cancelledAt: at(2026, 8, 4) }),
    S({ id: "d", startAt: at(2026, 8, 1), completedAt: at(2026, 8, 1, 10), noShow: true }),
    S({ id: "e", startAt: at(2026, 8, 2), completedAt: at(2026, 8, 2, 10), waived: true }),
    S({ id: "f", startAt: at(2026, 8, 6), completedAt: at(2026, 8, 6, 10), trainerNoShow: true }),
    S({ id: "g", startAt: at(2026, 8, 20) }),   // still upcoming
  ];
  const l = build(list);
  ok("every session is in the ledger, whatever happened to it", l.rows.length === 7, l.rows.length);
  ok("a cancelled session is there", l.rows.some((r) => r.id === "b"));
  ok("...and says who cancelled it", l.rows.find((r) => r.id === "b").outcome.label === "Cancelled by client");
  ok("...both ways", l.rows.find((r) => r.id === "c").outcome.label === "Cancelled by you");
  ok("a waive is labelled as one", l.rows.find((r) => r.id === "e").outcome.key === "waived");
  ok("a client no-show is labelled as one", l.rows.find((r) => r.id === "d").outcome.key === "no_show");
  ok("an open dispute is labelled as one", l.rows.find((r) => r.id === "f").outcome.key === "disputed");
  ok("a future session reads as scheduled", l.rows.find((r) => r.id === "g").outcome.key === "scheduled");
  // A ledger is read backwards.
  ok("newest first", l.rows.map((r) => r.id).join("") === "gfcbaed", l.rows.map((r) => r.id));
  // Grouping is by local day, and a day header appears once per day.
  ok("one group per day", l.groups.length === 7);
  ok("the month divider is drawn once", l.groups.filter((g) => g.newMonth).length === 1);
}
// A session with no start time is not a session; it must not become a group of
// "Invalid Date" at the top of the list.
ok("a startAt-less document is skipped", build([S({ startAt: 0 }), S({ startAt: undefined })]).rows.length === 0);

// ── 2. week OF THE MONTH, as asked ──────────────────────────────────────────
ok("the 1st is week 1", weekOfMonth(at(2026, 8, 1)) === 1);
ok("the 7th is week 1", weekOfMonth(at(2026, 8, 7)) === 1);
ok("the 8th is week 2", weekOfMonth(at(2026, 8, 8)) === 2);
ok("the 29th is week 5", weekOfMonth(at(2026, 8, 29)) === 5);

// ── 3. year → month → week, and the chips that are offered ──────────────────
{
  const list = [
    S({ id: "y24", startAt: at(2024, 1, 14) }),
    S({ id: "y25", startAt: at(2025, 5, 2) }),
    S({ id: "sep3", startAt: at(2026, 8, 3) }),
    S({ id: "sep9", startAt: at(2026, 8, 9) }),
    S({ id: "aug", startAt: at(2026, 7, 20) }),
  ];
  const all = build(list);
  ok("years are offered newest first", all.years.join(",") === "2026,2025,2024", all.years);
  ok("no month chips until a year is picked", all.months.length === 0);
  const y26 = build(list, { year: 2026 });
  ok("picking a year narrows the rows", y26.rows.length === 3);
  ok("...and offers only that year's months", y26.months.map((m) => m.m).join(",") === "8,7", y26.months);
  ok("...with counts", y26.months.find((m) => m.m === 8).count === 2);
  const sep = build(list, { year: 2026, month: 8 });
  ok("picking a month narrows again", sep.rows.length === 2);
  ok("...and offers its weeks", sep.weeks.map((w) => w.w).join(",") === "1,2", sep.weeks);
  const w2 = build(list, { year: 2026, month: 8, week: 2 });
  ok("picking a week gets one day", w2.rows.map((r) => r.id).join("") === "sep9");
  // A month can't be selected without a year, or the chips and the rows drift.
  ok("a month with no year is ignored", build(list, { month: 8 }).month === null);
  ok("a week with no month is ignored", build(list, { year: 2026, week: 1 }).week === null);
  // ⚠️ THE ONE THAT BITES: a search that excludes the selected year must not
  // leave an empty screen with a chip still lit.
  const stale = build(list, { year: 2026, q: "2024" });
  ok("a selection the search killed is dropped, not silently applied", stale.year === null, stale.year);
  ok("...and the rows are the search's, not nothing", stale.rows.length === 1, stale.rows.length);
}

// ── 4. typing ───────────────────────────────────────────────────────────────
{
  const list = [
    S({ id: "casey", clientUid: "c1", startAt: at(2026, 8, 3), title: "Upper body" }),
    S({ id: "pat", clientUid: "c2", startAt: at(2026, 2, 11), location: "Flamingo Park" }),
    S({ id: "canc", clientUid: "c2", startAt: at(2025, 11, 24), status: "cancelled", cancelledBy: "c2", cancelledAt: at(2025, 11, 20) }),
  ];
  const q = (t) => build(list, { q: t }).rows.map((r) => r.id).sort().join(",");
  ok("by client name", q("casey") === "casey");
  ok("by name, case-insensitively — both of Pat's", q("PAT") === "canc,pat");
  ok("by session title", q("upper") === "casey");
  ok("by location", q("flamingo") === "pat");
  ok("by month name", q("march") === "pat");
  ok("by short month", q("dec") === "canc");
  ok("by year", q("2025") === "canc");
  ok("by what happened to it", q("cancelled") === "canc");
  ok("by price", q("$85") === "canc,casey,pat");
  ok("by weekday", build(list, { q: new Date(at(2026, 8, 3)).toLocaleDateString("en-US", { weekday: "long" }) }).rows.length >= 1);
  ok("a search that matches nothing returns nothing, not everything", q("zzzz") === "");
  ok("whitespace alone is not a search", build(list, { q: "   " }).rows.length === 3);
}

// ── 5. the totals, and the one that must not overstate ──────────────────────
{
  const list = [
    S({ id: "1", startAt: at(2026, 8, 1), completedAt: at(2026, 8, 1, 10), settled: "charged", priceCents: 8500, billableCents: 8500 }),
    S({ id: "2", startAt: at(2026, 8, 2), completedAt: at(2026, 8, 2, 10), priceCents: 8500, billableCents: 8500 }),
    S({ id: "3", startAt: at(2026, 8, 3), completedAt: at(2026, 8, 3, 10), waived: true, priceCents: 8500, billableCents: 8500 }),
    S({ id: "4", startAt: at(2026, 8, 4), completedAt: at(2026, 8, 4, 10), noShow: true, priceCents: 8500, billableCents: 8500 }),
    S({ id: "5", startAt: at(2026, 8, 5), completedAt: at(2026, 8, 5, 10), trainerNoShow: true, priceCents: 8500, billableCents: 8500 }),
    S({ id: "6", startAt: at(2026, 8, 6), status: "cancelled", cancelledBy: "c1", cancelledAt: at(2026, 8, 5), priceCents: 8500 }),
  ];
  const t = build(list).totals;
  ok("counts everything", t.all === 6);
  ok("counts the cancellation", t.cancelled === 1);
  ok("counts the client no-show", t.noShow === 1);
  ok("counts the open dispute", t.disputed === 1);
  // ⚠️ THE HEADLINE NUMBER. A waived session earns nothing, a no-show earns a
  // PERCENTAGE this document doesn't store, and a disputed one earns nothing
  // yet — so summing any of them into "delivered value" would show a trainer
  // money that isn't coming.
  ok("delivered value is only the sessions that bill in full", t.deliveredCents === 17000, t.deliveredCents);
  ok("...so a waive is excluded", t.deliveredCents !== 25500);
  ok("...and a no-show is not counted at full price", t.deliveredCents < 34000);
  // A frozen billableCents beats a later edit to priceCents — the same rule the
  // settle engine bills by.
  const frozen = build([S({ startAt: at(2026, 8, 1), completedAt: at(2026, 8, 1, 10), priceCents: 99900, billableCents: 8500 })]).totals;
  ok("the frozen price wins over a re-typed one", frozen.deliveredCents === 8500, frozen.deliveredCents);
}

// ── 6. rescheduled sessions ─────────────────────────────────────────────────
{
  const moved = S({ id: "m", startAt: at(2026, 8, 9), startAtHistory: [{ from: at(2026, 8, 3), at: 1, eid: "e1" }, { from: at(2026, 8, 6), at: 2, eid: "e2" }] });
  const l = build([moved]);
  ok("a moved session says it moved", l.rows[0].movedFrom.length === 2);
  ok("...and the first entry is where it was originally booked", l.rows[0].movedFrom[0] === at(2026, 8, 3));
  ok("the totals count it", l.totals.rescheduled === 1);
  ok("a search finds it by the word", build([moved], { q: "rescheduled" }).rows.length === 1);
  ok("an unmoved session has no trail", build([S()]).rows[0].movedFrom.length === 0);
  ok("a junk trail is ignored rather than rendered", rescheduleHistory({ startAtHistory: ["x", null, { from: "nope" }, 5] }).length === 0);
}

// ── 7. the trail is written by the server, correctly, once ──────────────────
const { rescheduleTrail, appendTrail, MAX_TRAIL } = AUDIT;
ok("a create records nothing — there is no previous time", rescheduleTrail(null, { startAt: 1 }) === null);
ok("a delete records nothing", rescheduleTrail({ startAt: 1 }, null) === null);
ok("a move records the time it moved AWAY from", rescheduleTrail({ startAt: 111 }, { startAt: 222 }) === 111);
ok("moving earlier counts too", rescheduleTrail({ startAt: 222 }, { startAt: 111 }) === 222);
// This trigger sees every write to every session; the quiet path is the common
// one, and a chatty one would rewrite the document on each billing stamp.
ok("the completion stamp records nothing", rescheduleTrail({ startAt: 111 }, { startAt: 111, completedAt: 9 }) === null);
ok("a no-show flag records nothing", rescheduleTrail({ startAt: 111, noShow: false }, { startAt: 111, noShow: true }) === null);
ok("our own write-back records nothing (no infinite loop)",
   rescheduleTrail({ startAt: 111 }, { startAt: 111, startAtHistory: [{ from: 1 }] }) === null);
ok("a junk start time records nothing", rescheduleTrail({ startAt: "soon" }, { startAt: 222 }) === null);
ok("a zeroed start time records nothing", rescheduleTrail({ startAt: 111 }, { startAt: 0 }) === null);
{
  const e = (n) => ({ from: n, at: n, eid: `e${n}` });
  ok("the first move starts the trail", appendTrail(undefined, e(1)).length === 1);
  ok("the second appends", appendTrail([e(1)], e(2)).map((x) => x.from).join(",") === "1,2");
  // AT LEAST ONCE delivery: the same event arriving twice must not double up.
  ok("a redelivered event is ignored", appendTrail([e(1)], e(1)) === null);
  // ...but a genuine move BACK to an old slot is a different event and is kept.
  ok("moving back to an old slot is still recorded",
     appendTrail([e(1), e(2)], { from: 1, at: 3, eid: "e3" }).length === 3);
  ok("junk already in the array doesn't crash the append", appendTrail([null, "x", e(1)], e(2)).length === 2);
  // Bounded, and bounded from the MIDDLE: the original booking is the entry
  // anyone asking about a moved session actually wants.
  const many = Array.from({ length: MAX_TRAIL + 5 }, (_, i) => e(i + 1));
  const capped = appendTrail(many, e(999));
  ok("the trail is capped", capped.length === MAX_TRAIL, capped.length);
  ok("...keeping the ORIGINAL booking", capped[0].from === 1);
  ok("...and the newest move", capped[capped.length - 1].from === 999);
}
// Neither participant may write the trail, or it is not evidence.
ok("startAtHistory is absent from the client-writable field list",
   !(RULES.match(/function bookingFields\(\)[\s\S]*?\n      \}/) || [""])[0].includes("startAtHistory"));

// ── 7b. bounded rendering, honest totals ────────────────────────────────────
// A trainer with years behind them would otherwise render thousands of buttons
// on one screen. The list is capped; the COUNTS are not, or the summary would
// quietly become a summary of the first page.
{
  const many = Array.from({ length: 40 }, (_, i) =>
    S({ id: `x${i}`, startAt: at(2026, 8, 1) + i * 86400000, completedAt: at(2026, 8, 1) + i * 86400000 }));
  const l = build(many, { limit: 10 });
  ok("the rendered list is capped", l.groups.reduce((a, g) => a + g.rows.length, 0) === 10);
  ok("...and says so", l.truncated === true && l.shown === 10);
  ok("the totals still count everything that matched", l.totals.all === 40);
  ok("the money total is over everything too", l.totals.deliveredCents === 40 * 8500);
  ok("...and the cap only applies when it bites", build(many, { limit: 500 }).truncated === false);
  ok("the newest are the ones kept", l.groups[0].rows[0].id === "x39");
}

// ── 8. the screen ───────────────────────────────────────────────────────────
ok("the calendar offers a Ledger view", /\["month", "week", "day", "ledger"\]/.test(APP_CODE));
ok("it is built by the shared function, not a second copy of the filtering",
   /sessionLedger\(mine, \{ \.\.\.ledgerFilter, nameOf, now \}\)/.test(APP_CODE));
// ⚠️ NO NEW QUERY. The whole point is that the calendar's existing subscription
// already holds every session; adding a range filter to it would demand a
// composite index.
ok("no startAt range crept into the session query", !/where\("startAt"/.test(codeOnly(SESSIONS)));
// ⚠️ COUNTED, NOT FOUND (the S210 rule, and `npm run check:weak` flagged this
// very line). BOTH readers must stay on the single-field query — listMySessions
// and subscribeMySessions — because a range added to either is a composite
// index nobody has deployed. `.test()` alone would have stayed green with one
// of them broken.
ok("both session readers are still the single-field array-contains",
   (SESSIONS.match(/where\("participants", "array-contains", uid\)/g) || []).length === 2,
   (SESSIONS.match(/where\("participants", "array-contains", uid\)/g) || []).length);
ok("the ledger is only computed while it is open", /view === "ledger" \? sessionLedger/.test(APP_CODE));
ok("delivered value is captioned as booked prices, not as earnings",
   APP.includes("What was actually collected is in Earnings"));
ok("a truncated list says it is truncated", APP_CODE.includes("ledger.truncated"));

// ── 9. negative controls ────────────────────────────────────────────────────
{
  // A totals function that summed everything delivered would overstate a
  // trainer's earnings by every waive and every no-show.
  const naive = (list) => list.reduce((a, s) => a + (s.billableCents || s.priceCents || 0), 0);
  const list = [S({ completedAt: 1, priceCents: 8500 }), S({ completedAt: 1, priceCents: 8500, waived: true })];
  ok("control: summing every delivered session is caught",
     naive(list) !== build(list).totals.deliveredCents);
}
{
  // A builder that ignored the search when computing the year chips would offer
  // a year with nothing in it.
  const list = [S({ startAt: at(2024, 1, 1), clientUid: "c2" }), S({ startAt: at(2026, 8, 1), clientUid: "c1" })];
  const l = build(list, { q: "casey" });
  ok("control: chips come from the searched set, not the whole book",
     l.years.join(",") === "2026", l.years);
}
{
  // A ledger that filtered cancelled sessions out — the single likeliest way
  // this feature gets quietly broken later.
  const list = [S({ status: "cancelled", cancelledBy: "c1", cancelledAt: 1 })];
  ok("control: a ledger that hides cancellations is caught", build(list).rows.length === 1);
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  Session ledger: complete, browsable, and honest about money.\n");
