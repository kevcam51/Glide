// Tests for the drive-time engine and the back-to-back feasibility check
// (S197i) — the part of "drive to you" with the real value.
//
// The rules being pinned:
//   • An unknown drive produces NO warning. A warning nobody can act on trains
//     people to ignore the ones that matter.
//   • An outright overlap is reported even with no addresses at all — it is
//     true regardless of geography.
//   • Estimates round UP and are labelled with their source, because the free
//     estimator is at its most optimistic exactly at rush hour.
//   • Cache keys survive the same address typed differently.
//
// Run: node scripts/test-drive-time.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const FN = join(dirname(fileURLToPath(import.meta.url)), "..", "functions") + "/";
const D = require(FN + "driveTime.js");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── address normalisation ───────────────────────────────────────────────────
ok("same address typed differently normalises the same",
   D.normalizeAddress("123 Main Street, Miami, FL") === D.normalizeAddress("123 main st Miami FL"),
   [D.normalizeAddress("123 Main Street, Miami, FL"), D.normalizeAddress("123 main st Miami FL")]);
ok("and therefore shares a cache key",
   D.addressKey("123 Main Street, Miami, FL") === D.addressKey("123 main st  Miami  FL"));
ok("a unit number does not move the pin",
   D.normalizeAddress("50 Ocean Dr Apt 3B, Miami") === D.normalizeAddress("50 Ocean Drive, Miami"),
   [D.normalizeAddress("50 Ocean Dr Apt 3B, Miami"), D.normalizeAddress("50 Ocean Drive, Miami")]);
ok("different addresses do not collide",
   D.addressKey("123 Main St Miami") !== D.addressKey("124 Main St Miami"));
ok("an empty address normalises to empty", D.normalizeAddress("  ") === "");

// ── distance ────────────────────────────────────────────────────────────────
// South Beach → Wynwood is about 5 miles as the crow flies.
const southBeach = { lat: 25.7907, lng: -80.1300 };
const wynwood    = { lat: 25.8010, lng: -80.1990 };
const miles = D.haversineMiles(southBeach, wynwood);
ok("haversine gives a sane Miami distance", near(miles, 4.4, 1.2), miles);
ok("haversine is symmetric", D.haversineMiles(southBeach, wynwood) === D.haversineMiles(wynwood, southBeach));
ok("missing coordinates give null, not NaN", D.haversineMiles(null, wynwood) === null);
ok("junk coordinates give null", D.haversineMiles({ lat: "x", lng: 1 }, wynwood) === null);

const mins = D.straightLineMinutes(southBeach, wynwood);
ok("a ~4.4 mile city drive lands in a believable range", mins >= 15 && mins <= 30, mins);
ok("the estimate includes the fixed overhead", mins > (miles * D.ROAD_FACTOR / D.AVG_MPH) * 60);
ok("the same place is zero minutes", D.straightLineMinutes(southBeach, { ...southBeach }) === 0);
ok("estimates round up, never down", Number.isInteger(mins));

// ── feasibility: the core ───────────────────────────────────────────────────
const H = 3600000, M = 60000;
const base = Date.UTC(2026, 7, 24, 13, 0);   // Mon 9:00 ET
const S = (id, offsetMin, dur, location, status) =>
  ({ id, startAt: base + offsetMin * M, durationMin: dur, location, status });

// 20 minutes between two sessions 30 minutes apart by car → impossible.
let w = D.feasibilityWarnings(
  [S("a", 0, 60, "A"), S("b", 80, 60, "B")],
  () => ({ minutes: 30, source: "straight-line" }));
ok("a drive longer than the gap is flagged impossible", w.length === 1 && w[0].kind === "impossible", w);
ok("it reports the shortfall", w[0].slackMin === -10, w[0]);
ok("it names both sessions", w[0].fromId === "a" && w[0].toId === "b");
ok("it says where the number came from", w[0].source === "straight-line");

// 25 minute drive, 30 minute gap → tight but possible.
w = D.feasibilityWarnings([S("a", 0, 60, "A"), S("b", 90, 60, "B")],
  () => ({ minutes: 25, source: "routes" }));
ok("a drive that barely fits is flagged tight", w.length === 1 && w[0].kind === "tight", w);
ok("tight still reports positive slack", w[0].slackMin === 5, w[0]);

// Comfortable gap → nothing at all.
w = D.feasibilityWarnings([S("a", 0, 60, "A"), S("b", 180, 60, "B")],
  () => ({ minutes: 25, source: "routes" }));
ok("a comfortable gap produces no warning", w.length === 0, w);

// ⚠️ THE RULE THAT MATTERS MOST: unknown means silent.
w = D.feasibilityWarnings([S("a", 0, 60, "A"), S("b", 61, 60, "B")], () => null);
ok("an unknown drive produces NO warning", w.length === 0, w);
w = D.feasibilityWarnings([S("a", 0, 60, ""), S("b", 61, 60, "")], () => null);
ok("missing addresses produce no warning", w.length === 0, w);

// An overlap is true with no addresses and no estimator at all.
w = D.feasibilityWarnings([S("a", 0, 60, ""), S("b", 30, 60, "")], () => null);
ok("an outright overlap is flagged with no addresses", w.length === 1 && w[0].kind === "overlap", w);
ok("the overlap reports how far they collide", w[0].gapMin === -30, w[0]);
ok("an overlap needs no drive estimate", w[0].driveMin === null);

// Cancelled sessions are not obstacles.
w = D.feasibilityWarnings(
  [S("a", 0, 60, "A"), S("x", 30, 60, "X", "cancelled"), S("b", 240, 60, "B")],
  () => ({ minutes: 20, source: "routes" }));
ok("a cancelled session is ignored entirely", w.length === 0, w);

// Order must not depend on the caller.
w = D.feasibilityWarnings([S("b", 80, 60, "B"), S("a", 0, 60, "A")],
  () => ({ minutes: 30, source: "routes" }));
ok("out-of-order input is sorted first", w.length === 1 && w[0].fromId === "a" && w[0].toId === "b", w);

// Same place, back to back → fine, and it must not warn.
w = D.feasibilityWarnings([S("a", 0, 60, "Same Gym"), S("b", 60, 60, "Same Gym")],
  (a, b) => (a.location === b.location ? { minutes: 0, source: "same-place" } : { minutes: 40, source: "routes" }));
ok("back-to-back at the SAME place is fine", w.length === 0, w);

// Three in a row: only the bad pair is reported.
w = D.feasibilityWarnings([S("a", 0, 60, "A"), S("b", 240, 60, "B"), S("c", 305, 60, "C")],
  () => ({ minutes: 20, source: "routes" }));
ok("only the offending pair is reported", w.length === 1 && w[0].fromId === "b", w);

// A bare number from the estimator is accepted too.
w = D.feasibilityWarnings([S("a", 0, 60, "A"), S("b", 80, 60, "B")], () => 30);
ok("a plain number estimate works", w.length === 1 && w[0].driveMin === 30, w);

// One session, or none, can never conflict.
ok("a single session yields nothing", D.feasibilityWarnings([S("a", 0, 60, "A")], () => 30).length === 0);
ok("no sessions yields nothing", D.feasibilityWarnings([], () => 30).length === 0);
ok("undefined input does not throw", D.feasibilityWarnings(undefined, () => 30).length === 0);

// The tight buffer is tunable.
w = D.feasibilityWarnings([S("a", 0, 60, "A"), S("b", 90, 60, "B")],
  () => ({ minutes: 25, source: "routes" }), { tightBufferMin: 2 });
ok("a smaller buffer stops calling it tight", w.length === 0, w);

// The estimator receives the SESSIONS, so two pairs sharing an address stay
// distinct — the ambiguity that an address-keyed lookup could not resolve.
{
  const seen = [];
  const sess = [S("a", 0, 60, "Gym"), S("b", 240, 60, "Home"), S("c", 480, 60, "Gym")];
  D.feasibilityWarnings(sess, (a, b) => { seen.push(`${a.id}>${b.id}`); return { minutes: 5, source: "routes" }; });
  ok("the estimator is asked about pairs, not addresses",
     seen.join(",") === "a>b,b>c", seen);
}

// ── drive cache key ─────────────────────────────────────────────────────────
const mon9 = Date.UTC(2026, 7, 24, 13, 0), mon9b = Date.UTC(2026, 7, 24, 13, 45);
ok("the same hour shares a cache entry",
   D.driveKey("A st", "B st", mon9) === D.driveKey("A st", "B st", mon9b));
ok("a different hour does not",
   D.driveKey("A st", "B st", mon9) !== D.driveKey("A st", "B st", mon9 + 2 * H));
ok("a different weekday does not",
   D.driveKey("A st", "B st", mon9) !== D.driveKey("A st", "B st", mon9 + 86400000));
ok("direction matters (one-ways, tolls)",
   D.driveKey("A st", "B st", mon9) !== D.driveKey("B st", "A st", mon9));

// ── the tier constant must name REAL subscription tiers ────────────────────
// It once said ["connect", "base", "max"], read off the PLAN_FEATURES grid
// labels rather than the billing catalog. Those match no trainer subscription,
// so every paying coach silently got the free estimator while the UI told them
// their plan included traffic. Pin it to the catalog it has to agree with.
{
  const avail = readFileSync(FN + "availability.js", "utf8");
  const billing = readFileSync(FN + "billing.js", "utf8");
  const tiers = (avail.match(/const TRAFFIC_AWARE_TIERS = \[([^\]]*)\]/) || [])[1] || "";
  const listed = [...tiers.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const catalog = [...billing.matchAll(/^\s{2}(\w+):\s*\{\s*key:/gm)].map((m) => m[1]);
  ok("the tier constant is not empty", listed.length > 0, listed);
  const bogus = listed.filter((t) => !catalog.includes(t));
  ok("every tier it names exists in the billing catalog", bogus.length === 0, { bogus, catalog });
  ok("it names the $49 coach plan Kevin called out", listed.includes("coach"), listed);
  ok("and the higher coach plans, which cannot get less", 
     listed.includes("coach_max") && listed.includes("coach_ultra"), listed);
  ok("it does not name a client-only tier", !listed.includes("premium"), listed);
}

// ── estimateDrive against a fake Firestore + fake network ───────────────────
const store = new Map();
const db = { doc: (p) => ({ path: p,
  async get() { const d = store.get(p); return { exists: !!d, data: () => d }; },
  async set(v) { store.set(p, v); } }) };
let calls = 0;
const fakeFetch = async (url) => {
  calls++;
  if (String(url).includes("nominatim")) {
    const q = decodeURIComponent(String(url).split("q=")[1] || "");
    const pt = q.includes("wynwood") ? wynwood : southBeach;
    return { ok: true, json: async () => [{ lat: String(pt.lat), lon: String(pt.lng) }] };
  }
  return { ok: false };
};

(async () => {
  const e1 = await D.estimateDrive(db, "100 Ocean Dr Miami", "200 NW 2nd Ave Wynwood", mon9, null, fakeFetch);
  ok("estimateDrive works with NO api key", e1 && e1.minutes > 0, e1);
  ok("and says it used the free estimator", e1.source === "straight-line", e1.source);
  ok("it was not served from cache the first time", e1.cached === false);
  const afterFirst = calls;

  const e2 = await D.estimateDrive(db, "100 Ocean Dr Miami", "200 NW 2nd Ave Wynwood", mon9b, null, fakeFetch);
  ok("the same hour is served from cache", e2.cached === true, e2);
  ok("the cached call touched the network zero times", calls === afterFirst, calls - afterFirst);
  ok("the cached estimate matches", e2.minutes === e1.minutes);

  const same = await D.estimateDrive(db, "50 Main St", "50 main street", mon9, null, fakeFetch);
  ok("the same address twice is zero minutes and never geocoded",
     same && same.minutes === 0 && same.source === "same-place", same);

  const none = await D.estimateDrive(db, "", "somewhere", mon9, null, fakeFetch);
  ok("a missing address returns null rather than guessing", none === null);

  // A geocode failure must be cached, or a typo is looked up on every open.
  const failFetch = async () => ({ ok: true, json: async () => [] });
  const before = calls;
  const g1 = await D.geocode(db, "definitely not a real place zzz", null, failFetch);
  const g2 = await D.geocode(db, "definitely not a real place zzz", null, failFetch);
  ok("a failed geocode returns null", g1 === null && g2 === null);
  ok("and is not retried immediately", calls === before, { extra: calls - before });

  // A network that throws must not take the caller down.
  const throwFetch = async () => { throw new Error("network down"); };
  const g3 = await D.geocode(db, "17 Somewhere Ave Miami", null, throwFetch);
  ok("a thrown network error yields null, not an exception", g3 === null);

  // ── the sessionTravel callable's own wiring ───────────────────────────────
  // Extracted and run against a fake Firestore, because it cannot be deployed
  // yet (CLI token) and the leg-lookup is the part most likely to be wrong.
  const { readFileSync } = require("fs");
  const avail = readFileSync(FN + "availability.js", "utf8");
  const bodyStart = avail.indexOf("exports.sessionTravel");
  ok("sessionTravel exists", bodyStart > 0);
  ok("it is scoped to the caller as TRAINER, not merely a participant",
     /\.where\("trainerUid", "==", uid\)/.test(avail.slice(bodyStart)));
  // ⚠️ Pinned because it already went wrong once: equality + a range on a
  // different field needs a composite index, and this feature fails SILENTLY,
  // which reads as "your schedule is fine".
  ok("the query needs no composite index (one equality, window filtered in code)",
     !/\.where\("startAt"/.test(avail.slice(bodyStart)));
  ok("and the window is still applied", /st < from \|\| st > to/.test(avail.slice(bodyStart)));
  ok("it bounds the window it will read",
     /range is too wide/.test(avail.slice(bodyStart)));
  ok("it looks legs up by session pair, never by address",
     /legs\[`\$\{a\.id\}>\$\{b\.id\}`\]/.test(avail.slice(bodyStart)));
  ok("a placeholder key is treated as NO key, not a broken one",
     /startsWith\("AIza"\)/.test(avail.slice(bodyStart)));
  ok("it reports whether the numbers are traffic-aware",
     /trafficAware/.test(avail.slice(bodyStart)));
  ok("an estimate failure degrades to silence rather than throwing",
     /legs\[legKey\] = null/.test(avail.slice(bodyStart)));

  console.log(`  ${checks - fails}/${checks} assertions passed`);
  process.exit(fails ? 1 : 0);
})();
