// Does a booking land on something already there? (S199d)
//
// Nothing on ANY booking path checked this. A trainer could put two billable
// sessions on the same hour and find out from a client — and it got worse when
// multi-day asks started working, because the composer only fetches free/busy
// for the FIRST offered day, so "Book this" on Wednesday books an hour nothing
// on either side ever looked at.
//
// The two helpers are pure, so the arithmetic is tested here away from
// Firestore and React. They are read out of src/App.jsx and evaluated, because
// a 32k-line JSX bundle cannot be imported.
//
// Run: node scripts/test-overlap.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const grab = (name) => {
  const i = APP.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found in src/App.jsx`);
  // brace-match to the end of the declaration
  let d = 0, j = APP.indexOf("{", i);
  for (let k = j; k < APP.length; k++) {
    if (APP[k] === "{") d++;
    else if (APP[k] === "}") { d--; if (d === 0) return APP.slice(i, k + 1); }
  }
  throw new Error(`${name} unterminated`);
};
const SESSION_DEFAULT_MIN = 60, REPEAT_MAX = 52;
const seriesStarts = eval(`(${grab("seriesStarts").replace(/^function /, "function ")})`);
const overlappingSessions = eval(`(${grab("overlappingSessions").replace(/^function /, "function ")})`);

const H = 3600000;
const at = (iso) => Date.parse(iso);

// ── the series expansion ────────────────────────────────────────────────────
{
  const one = seriesStarts(at("2026-09-07T09:00:00Z"), "none", 8);
  ok("no repeat is a single date", one.length === 1, one.length);
  const wk = seriesStarts(at("2026-09-07T09:00:00Z"), "weekly", 4);
  ok("weekly gives four dates", wk.length === 4, wk.length);
  ok("...seven days apart", wk[1] - wk[0] === 7 * 24 * H, (wk[1] - wk[0]) / (24 * H));
  const bw = seriesStarts(at("2026-09-07T09:00:00Z"), "biweekly", 3);
  ok("biweekly is fourteen days apart", bw[1] - bw[0] === 14 * 24 * H, (bw[1] - bw[0]) / (24 * H));
}
{
  // ⚠️ Month stepping must CLAMP, not roll over: Jan 31 -> Feb 28 -> Mar 31,
  // never Mar 3. Mirrors bookSeries, which S196 got right and this must match.
  const m = seriesStarts(at("2026-01-31T09:00:00Z"), "monthly", 3).map((t) => new Date(t).getDate());
  ok("monthly clamps the short month rather than rolling over",
     m[0] === 31 && m[1] <= 29 && m[2] === 31, m);
}
{
  const capped = seriesStarts(at("2026-09-07T09:00:00Z"), "weekly", 999);
  ok("the occurrence count is bounded", capped.length <= REPEAT_MAX, capped.length);
}

// ── the overlap itself ──────────────────────────────────────────────────────
const existing = [
  { id: "a", startAt: at("2026-09-07T09:00:00Z"), durationMin: 60, status: "scheduled" },
  { id: "b", startAt: at("2026-09-09T14:00:00Z"), durationMin: 30, status: "scheduled" },
  { id: "gone", startAt: at("2026-09-07T09:00:00Z"), durationMin: 60, status: "cancelled" },
];
{
  const hit = overlappingSessions(existing, [at("2026-09-07T09:30:00Z")], 60);
  ok("a partial overlap is found", hit.length === 1, hit);
  ok("...and names the session it collides with", /Sep/.test(((hit[0] || {}).label) || ""), hit[0]);
}
{
  ok("touching end-to-start is NOT an overlap",
     overlappingSessions(existing, [at("2026-09-07T10:00:00Z")], 60).length === 0);
  ok("...and neither is ending exactly when one starts",
     overlappingSessions(existing, [at("2026-09-07T08:00:00Z")], 60).length === 0);
}
{
  ok("a cancelled session does not collide",
     overlappingSessions(existing.filter((s) => s.status === "cancelled"), [at("2026-09-07T09:00:00Z")], 60).length === 0);
}
{
  // Rescheduling a session must not find itself.
  ok("the session being moved does not overlap itself",
     overlappingSessions(existing, [at("2026-09-07T09:00:00Z")], 60, "a").length === 0);
}
{
  // ⚠️ THE POINT OF EXPANDING THE SERIES. The calendar's own warning panel only
  // looks 21 days ahead, so occurrences beyond that were examined by nothing.
  // Aug 12 + 4 weeks = Sep 9, i.e. the FIFTH occurrence and 28 days out —
  // beyond the 21-day window the calendar's own warning panel ever looks at.
  const starts = seriesStarts(at("2026-08-12T14:00:00Z"), "weekly", 8);
  const hits = overlappingSessions(existing, starts, 30);
  ok("a clash in a LATER occurrence is caught", hits.length === 1, { starts: starts.map((t) => new Date(t).toISOString()), hits });
  ok("...and it is the one on Sep 9", new Date((hits[0] || {}).startAt || 0).getUTCDate() === 9, hits[0]);
  ok("...which is past the 21-day window the panel looks at",
     ((hits[0] || {}).startAt || 0) - starts[0] > 21 * 24 * H, hits[0]);
}
{
  ok("one clash is reported per requested date, not per pair",
     overlappingSessions([...existing, { id: "c", startAt: at("2026-09-07T09:15:00Z"), durationMin: 60, status: "scheduled" }],
       [at("2026-09-07T09:30:00Z")], 60).length === 1);
}
{
  ok("no sessions means no clash", overlappingSessions([], [at("2026-09-07T09:00:00Z")], 60).length === 0);
  ok("junk rows are skipped", overlappingSessions([null, {}, { startAt: 0 }], [at("2026-09-07T09:00:00Z")], 60).length === 0);
}

// ── the server refuses the one-tap path ─────────────────────────────────────
const AVAIL = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");
ok("the accept path checks for an overlap before claiming", /reason: "overlap"/.test(AVAIL));
ok("...and refuses rather than booking on top", /That overlaps a session you already have/.test(AVAIL));
ok("...using one equality, with the window filtered in code",
   /where\("trainerUid", "==", uid\)/.test(AVAIL));

// ── the panel can say "couldn't check" ──────────────────────────────────────
ok("sessionTravel reports what it could not estimate", /unknownPairs: unknown/.test(AVAIL));
ok("...and pairs with no address separately", /pairsWithoutAddress: noAddress/.test(AVAIL));
ok("a failed travel call is no longer rendered as an all-clear",
   /setTravel\(\{ warnings: \[\], failed: true \}\)/.test(APP));
ok("...and the panel says so", /this isn&rsquo;t an all-clear/.test(APP));

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
