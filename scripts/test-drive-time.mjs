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
// A street name that merely BEGINS like a unit designator must survive. This
// used to swallow the following token unconditionally, so "100 Ste Catherine
// St" normalised to "100 st" — a destroyed street name, and a cache key shared
// with anything else that collapsed to the same thing.
ok("\"Ste\" in a street name is not a unit number",
   D.normalizeAddress("100 Ste Catherine St, Montreal").includes("catherine"),
   D.normalizeAddress("100 Ste Catherine St, Montreal"));
ok("a real suite number is still dropped",
   !D.normalizeAddress("100 Main St Suite 200, Miami").includes("200"),
   D.normalizeAddress("100 Main St Suite 200, Miami"));
ok("a lettered unit is still dropped",
   !D.normalizeAddress("12 King St Unit 4, Toronto").includes("4"),
   D.normalizeAddress("12 King St Unit 4, Toronto"));
ok("two Ste-streets with different names stay distinct",
   D.addressKey("100 Ste Catherine St") !== D.addressKey("100 Ste Anne St"));
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
  // Kevin's S198 decision: Coach and above, not the Connect entry rung.
  ok("Connect does NOT get traffic (it is the upgrade reason)",
     !listed.includes("coach_connect"), listed);
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

  // ⚠️ A straight-line entry must be re-done once a key exists, or the day the
  // key arrives changes nothing for any route already cached (S198w).
  {
    const store2 = new Map();
    const db2 = { doc: (p) => ({ path: p,
      async get() { const d = store2.get(p); return { exists: !!d, data: () => d }; },
      async set(v) { store2.set(p, v); } }) };
    const key = D.driveKey("100 Ocean Dr Miami", "200 NW 2nd Ave Wynwood", mon9);
    store2.set(`drivecache/${key}`, { at: Date.now(), minutes: 43, miles: 5, source: "straight-line" });
    const noKey = await D.estimateDrive(db2, "100 Ocean Dr Miami", "200 NW 2nd Ave Wynwood", mon9, null, fakeFetch);
    ok("with NO key the cached straight line is still used", noKey.cached === true && noKey.minutes === 43, noKey);
    // With a key, Routes is attempted; this fake returns non-ok so it falls back —
    // the point is that it did NOT serve the stale cached entry.
    // With a key it geocodes through GOOGLE and calls Routes, so the stub has to
    // answer both; Routes replies with a real 22-minute duration.
    const googleFetch = async (url, opts) => {
      const u = String(url);
      if (u.includes("maps.googleapis.com/maps/api/geocode")) {
        const q = decodeURIComponent(u.split("address=")[1].split("&")[0]);
        const pt = /wynwood|2nd ave/i.test(q) ? wynwood : southBeach;
        return { ok: true, json: async () => ({ results: [{ geometry: { location: { lat: pt.lat, lng: pt.lng } } }] }) };
      }
      if (u.includes("routes.googleapis.com")) {
        return { ok: true, json: async () => ({ routes: [{ duration: "1320s", distanceMeters: 9000 }] }) };
      }
      return { ok: false };
    };
    const withKey = await D.estimateDrive(db2, "100 Ocean Dr Miami", "200 NW 2nd Ave Wynwood", mon9, "AIzaTESTKEY", googleFetch);
    ok("with a key the stale straight line is NOT served from cache", withKey && withKey.cached === false, withKey);
    ok("and the answer is traffic-aware", withKey && withKey.source === "routes", withKey && withKey.source);
    ok("Routes duration is used (22 min + overhead)", withKey && withKey.minutes === 27, withKey && withKey.minutes);
  }

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

  // ── a configured key must not disable the free geocoder (S199) ────────────
  // The whole `if (apiKey)` branch used to end in `return null` on every
  // failure, which made the Nominatim block unreachable the moment a key
  // existed — so turning the key on turned the drive warning OFF, and only for
  // the paying accounts that had one. The old suite could not see it: its one
  // key-present stub always succeeded.
  {
    // ⚠️ THE DOUBLE MUST HONOUR `merge`, or it proves nothing about Firestore.
    // The soft-fail write relies on merge to preserve coordinates it cannot see
    // (the cache read may have thrown), so a double that always replaces would
    // pass a test the real database fails — and the reverse: the old
    // always-replace double is exactly why the clobber shipped.
    const mkDb = () => { const m = new Map(); return { store: m, db: { doc: (path) => ({ path,
      async get() { const d = m.get(path); return { exists: !!d, data: () => d }; },
      async set(v, opts) {
        m.set(path, (opts && opts.merge && m.get(path)) ? { ...m.get(path), ...v } : v);
      } }) } }; };

    // Google refuses (a restricted key, a lapsed bill); Nominatim answers.
    {
      const { db: d2 } = mkDb();
      let google = 0, osm = 0;
      const f = async (url) => {
        const u = String(url);
        if (u.includes("maps.googleapis.com")) { google++; return { ok: false }; }
        osm++; return { ok: true, json: async () => [{ lat: "25.79", lon: "-80.13" }] };
      };
      const hit = await D.geocode(d2, "1300 Ocean Dr Miami Beach", "AIzaTESTKEY", f);
      ok("a key that fails falls back to the free geocoder", !!hit && hit.provider === "nominatim", hit);
      ok("...and Google was genuinely tried first", google === 1 && osm === 1, { google, osm });
    }

    // Google answers: the free provider must not be called at all.
    {
      const { db: d2 } = mkDb();
      let osm = 0;
      const f = async (url) => {
        const u = String(url);
        if (u.includes("maps.googleapis.com")) {
          return { ok: true, json: async () => ({ status: "OK", results: [{ geometry: { location: { lat: 25.78, lng: -80.13 } } }] }) };
        }
        osm++; return { ok: true, json: async () => [] };
      };
      const hit = await D.geocode(d2, "1300 Ocean Dr Miami Beach", "AIzaTESTKEY", f);
      ok("a working key still short-circuits", !!hit && hit.provider === "google", hit);
      ok("...and the fallback is not called needlessly", osm === 0, { osm });
    }

    // ⚠️ A TRANSIENT FAILURE MUST NOT BE CACHED AS "no such address". The cache
    // doc has no uid in it, so one account's rate-limited second would disable
    // the drive check at that address for EVERY trainer for a day.
    {
      const { store, db: d2 } = mkDb();
      const f = async () => ({ ok: false });     // both providers down
      const hit = await D.geocode(d2, "77 Transient Way Miami", "AIzaTESTKEY", f);
      ok("both providers failing yields null", hit === null);
      // A soft marker IS written — it damps a retry storm — but it must never
      // be a verdict about the address, because the cache doc is shared by
      // every trainer and `failed` short-circuits them all for a day.
      ok("...and NO 'no such address' verdict is written",
         ![...store.values()].some((v) => v && v.failed), [...store.values()]);
      ok("...only a short-lived soft marker",
         [...store.values()].every((v) => v && v.softFail === true), [...store.values()]);
    }

    // A real miss — both providers agree it does not exist — is still cached.
    {
      const { store, db: d2 } = mkDb();
      const f = async (url) => String(url).includes("maps.googleapis.com")
        ? { ok: true, json: async () => ({ status: "ZERO_RESULTS", results: [] }) }
        : { ok: true, json: async () => [] };
      const hit = await D.geocode(d2, "zzz not a place zzz", "AIzaTESTKEY", f);
      ok("a genuine miss still yields null", hit === null);
      ok("...and IS remembered, so a typo is not looked up every open",
         [...store.values()].some((v) => v && v.failed === true), [...store.values()]);
    }

    // ⚠️ THE REALISTIC GOOGLE FAILURE IS SLOW, NOT FAST — and the first version
    // of this fix died on exactly that. One shared AbortController across both
    // providers meant a hung Google call aborted the signal, and Nominatim was
    // then invoked with an ALREADY-ABORTED signal and threw instantly. The
    // fallback ran only when Google failed fast.
    //
    // This stub REJECTS on an already-aborted signal, the way real fetch does.
    // The earlier stub ignored it and happily reported a pass, which is why the
    // bug survived its own test.
    {
      const { db: d2 } = mkDb();
      let osm = 0;
      const slowGoogle = async (url, opts) => {
        const sig = opts && opts.signal;
        if (sig && sig.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
        if (String(url).includes("maps.googleapis.com")) {
          return await new Promise((_r, rej) => sig.addEventListener("abort", () => {
            const e = new Error("aborted"); e.name = "AbortError"; rej(e);
          }));
        }
        osm++;
        return { ok: true, json: async () => [{ lat: "25.79", lon: "-80.13" }] };
      };
      const hit = await D.geocode(d2, "1300 Ocean Dr Miami Beach", "AIzaTESTKEY", slowGoogle);
      ok("a SLOW Google still reaches the free fallback", !!hit && hit.provider === "nominatim", hit);
      ok("...because each provider has its own timeout budget", osm === 1, { osm });
    }

    // Malformed coordinates are not a location.
    {
      const { store, db: d2 } = mkDb();
      const f = async (url) => String(url).includes("maps.googleapis.com")
        ? { ok: false }
        : { ok: true, json: async () => [{ lat: "not-a-number", lon: "-80.1" }] };
      const hit = await D.geocode(d2, "12 Garbled St", "AIzaTESTKEY", f);
      ok("a malformed lat/lon yields null rather than NaN coordinates", hit === null, hit);
      ok("...and is not cached as a definite miss",
         ![...store.values()].some((v) => v && v.failed), [...store.values()]);
    }

    // ⚠️ AN EXPIRED HIT BEATS NO ANSWER. Buildings do not move, so when the
    // lookup fails we serve what we already knew rather than losing the drive
    // check for ten minutes.
    {
      const { store, db: d2 } = mkDb();
      const good = await D.geocode(d2, "5 Stale Rd Miami", "AIzaTESTKEY",
        async (url) => String(url).includes("maps.googleapis.com")
          ? { ok: true, json: async () => ({ status: "OK", results: [{ geometry: { location: { lat: 25.5, lng: -80.5 } } }] }) }
          : { ok: true, json: async () => [] });
      ok("a hit is cached", !!good, good);
      const key = [...store.keys()][0];
      store.get(key).at = 0;                         // expire it
      const after = await D.geocode(d2, "5 Stale Rd Miami", "AIzaTESTKEY", async () => ({ ok: false }));
      ok("an expired hit is served when the lookup then fails",
         !!after && after.lat === 25.5, after);
      ok("...and the coordinates survive the soft-fail write",
         store.get(key).lat === 25.5 && store.get(key).softFail === true, store.get(key));
      // ⚠️ AND THE HIT IS NOT RE-DATED BY THE FAILURE. Stamping a fresh `at`
      // would make an expired pin look newly geocoded and freeze it in place
      // for the whole TTL — a stale answer made permanent by a temporary fault.
      ok("...without the failure making the stale pin look fresh",
         store.get(key).at === 0 && store.get(key).softAt > 0, store.get(key));
    }

    // ⚠️ EVEN WHEN THE CACHE READ ITSELF FAILS. `stale` is only populated from a
    // read that succeeded, so a Firestore blip — or losing a race to another
    // invocation that just wrote the hit — leaves it null while a perfectly
    // good document exists. A full replace destroyed it, for every trainer at
    // that address, with no lookup even attempted for ten minutes.
    {
      const m = new Map();
      const key = "geocache/" + D.addressKey("3000 NW 2nd Ave Miami");
      m.set(key, { at: Date.now(), lat: 25.8, lng: -80.19, provider: "google", q: "x" });
      let failNextRead = true;
      const d2 = { doc: (path) => ({ path,
        async get() { if (failNextRead) { failNextRead = false; throw new Error("deadline exceeded"); }
          const d = m.get(path); return { exists: !!d, data: () => d }; },
        async set(v, opts) { m.set(path, (opts && opts.merge && m.get(path)) ? { ...m.get(path), ...v } : v); } }) };
      await D.geocode(d2, "3000 NW 2nd Ave Miami", "AIzaTESTKEY", async () => ({ ok: false }));
      const doc = m.get(key);
      ok("a LOST cache read does not destroy the stored coordinates",
         doc && doc.lat === 25.8 && doc.lng === -80.19, doc);
      ok("...and the next call can still serve them", (await D.geocode(d2, "3000 NW 2nd Ave Miami", "AIzaTESTKEY",
         async () => ({ ok: false }))) !== null);
    }

    // ⚠️ A SOFT FAILURE MUST NOT CLEAR A VERDICT. It knows nothing — and the
    // writer often cannot even see what the document holds, because `stale` is
    // null exactly when the read threw. Clearing on an inconclusive result let
    // a key-less caller delete the verdict a PAYING caller's Google lookup
    // recorded, re-billing that address every ten minutes instead of daily.
    {
      const { store, db: d2 } = mkDb();
      const k = "geocache/" + D.addressKey("7 Contested Way");
      // Aged past the 24h miss window, so the lookup actually re-runs — a FRESH
      // miss short-circuits before any write, which is correct.
      store.set(k, { at: Date.now() - 25 * 3600000, failed: true, missBy: "both", q: "x" });
      await D.geocode(d2, "7 Contested Way", null, async () => ({ ok: false }));
      ok("a soft failure leaves an existing verdict alone",
         store.get(k).failed === true && store.get(k).missBy === "both", store.get(k));
      ok("...while still recording that a lookup was attempted",
         store.get(k).softFail === true, store.get(k));
    }
    // ...and a definite miss must not destroy coordinates we already had.
    {
      const { store, db: d2 } = mkDb();
      const k = "geocache/" + D.addressKey("11 Renamed Plaza");
      store.set(k, { at: Date.now() - 200 * 86400000, lat: 25.78, lng: -80.19, provider: "google", q: "x" });
      await D.geocode(d2, "11 Renamed Plaza", null, async () => ({ ok: true, json: async () => [] }));
      ok("a miss keeps the coordinates it had", store.get(k).lat === 25.78, store.get(k));
      const again = await D.geocode(d2, "11 Renamed Plaza", null, async () => ({ ok: false }));
      ok("...and the next call serves them rather than going dark",
         !!again && again.lat === 25.78, again);
    }

    // Symmetric to the nominatim guard: a GOOGLE-only miss must not lock out a
    // caller who only has the free provider, which knows places Google does not.
    {
      const { store, db: d2 } = mkDb();
      const k = "geocache/" + D.addressKey("Brickell Park Miami");
      store.set(k, { at: Date.now(), failed: true, missBy: "google", q: "x" });
      let osm = 0;
      const hit = await D.geocode(d2, "Brickell Park Miami", null, async () => {
        osm++; return { ok: true, json: async () => [{ lat: "25.76", lon: "-80.19" }] };
      });
      ok("a Google-only miss does not block a Nominatim-only caller", !!hit && osm === 1, { hit, osm });
    }

    // And a transient failure must not overwrite a good cached hit — `ref.set`
    // replaces, so writing on every outcome would destroy a working entry.
    {
      const { store, db: d2 } = mkDb();
      const good = await D.geocode(d2, "9 Good Address Miami", "AIzaTESTKEY",
        async (url) => String(url).includes("maps.googleapis.com")
          ? { ok: true, json: async () => ({ status: "OK", results: [{ geometry: { location: { lat: 25.7, lng: -80.2 } } }] }) }
          : { ok: true, json: async () => [] });
      ok("a good entry is cached", !!good && store.size === 1, good);
      const key = [...store.keys()][0];
      store.get(key).at = 0;                       // force it stale so the lookup re-runs
      await D.geocode(d2, "9 Good Address Miami", "AIzaTESTKEY", async () => ({ ok: false }));
      ok("a later transient failure does not clobber it",
         store.get(key) && store.get(key).failed !== true && store.get(key).lat === 25.7, store.get(key));
    }
  }

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
