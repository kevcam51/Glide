// Regression test for the Trainerize wearable sync (S175).
//
// The bug this pins down: tz() turns a timeout/5xx into {ok:false} rather than
// throwing, and syncClientHealth used to `continue` past it — dropping the whole
// calorieOut window. pickSource then filled `active` with 0 from the step-only
// buckets, so ONE slow call overwrote every stored burn number with zeros, and
// the next good run put them back. That flapping is what read as "the tracker
// only pulls sometimes".
//
// Run: node scripts/test-health-sync.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// firebase-functions' defineSecret/onCall only need to be constructible here.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "calorieiq-29762";

// ── fake Firestore: users/{uid}/kv/{key} docs holding { k, value } ───────────
function fakeDb() {
  const store = new Map();
  return {
    store,
    doc(path) {
      return {
        async get() {
          const v = store.get(path);
          return { exists: v !== undefined, data: () => v };
        },
        async set(obj) { store.set(path, obj); },
      };
    },
  };
}
const logKey = (uid, pid, date) =>
  `users/${uid}/kv/${encodeURIComponent(`caliq-log-${pid}-${date}`)}`;
const readWearable = (db, uid, pid, date) => {
  const d = db.store.get(logKey(uid, pid, date));
  return d ? JSON.parse(d.value).wearable : undefined;
};

// ── fake Trainerize: drive healthData/getList per metric ─────────────────────
// plan = { calorieOut: entries[] | "fail", step: entries[] | "fail" }
function stubFetch(plan) {
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const spec = plan[body.type];
    if (spec === "fail") {
      // Exactly what a 15s AbortError looks like to tz().
      const e = new Error("aborted"); e.name = "AbortError"; throw e;
    }
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ healthData: spec || [] }),
    };
  };
}
const cal = (date, source, activeEnergy, restingEnergy) =>
  ({ date, source, data: { activeEnergy, restingEnergy } });
const step = (date, source, steps) => ({ date, source, data: { steps } });

const { _syncClientHealth: sync } = require("../functions/trainerize.js");

const UID = "u1", PID = "self", TZID = 42, AUTH = "x";
const D = "2026-07-30";

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

// ── 1. happy path: both metrics arrive ──────────────────────────────────────
console.log("\n1. both metrics fetched");
{
  const db = fakeDb();
  stubFetch({ calorieOut: [cal(D, "garmin", 700, 2100)], step: [step(D, "garmin", 10010)] });
  const r = await sync(db, UID, PID, TZID, AUTH, 14);
  const w = readWearable(db, UID, PID, D);
  check("writes the day", r.days === 1, `days=${r.days}`);
  check("active 700", w.active === 700, JSON.stringify(w));
  check("resting 2100", w.resting === 2100);
  check("steps 10010", w.steps === 10010);
  check("no failed metrics", r.failed.length === 0, JSON.stringify(r.failed));
}

// ── 2. THE BUG: calorieOut fetch dies, steps succeed ────────────────────────
console.log("\n2. calorieOut times out on a later run (the regression)");
{
  const db = fakeDb();
  stubFetch({ calorieOut: [cal(D, "garmin", 700, 2100)], step: [step(D, "garmin", 10010)] });
  await sync(db, UID, PID, TZID, AUTH, 14);           // good run seeds real data
  stubFetch({ calorieOut: "fail", step: [step(D, "garmin", 10500)] });
  const r = await sync(db, UID, PID, TZID, AUTH, 14); // bad run
  const w = readWearable(db, UID, PID, D);
  check("active PRESERVED at 700", w.active === 700, `got ${w.active} (0 = the old bug)`);
  check("resting PRESERVED at 2100", w.resting === 2100, `got ${w.resting}`);
  check("steps still updated to 10500", w.steps === 10500, `got ${w.steps}`);
  check("reports the failed metric", r.failed.includes("calorieOut"), JSON.stringify(r.failed));
}

// ── 3. both metrics die: nothing is touched at all ──────────────────────────
console.log("\n3. total fetch failure");
{
  const db = fakeDb();
  stubFetch({ calorieOut: [cal(D, "garmin", 700, 2100)], step: [step(D, "garmin", 10010)] });
  await sync(db, UID, PID, TZID, AUTH, 14);
  stubFetch({ calorieOut: "fail", step: "fail" });
  const r = await sync(db, UID, PID, TZID, AUTH, 14);
  const w = readWearable(db, UID, PID, D);
  check("day untouched", w.active === 700 && w.steps === 10010, JSON.stringify(w));
  check("writes nothing", r.days === 0, `days=${r.days}`);
  check("both metrics reported failed", r.failed.length === 2, JSON.stringify(r.failed));
}

// ── 4. a genuine zero from the tracker still counts as data (S137) ──────────
console.log("\n4. a real reported zero still overwrites");
{
  const db = fakeDb();
  stubFetch({ calorieOut: [cal(D, "garmin", 700, 2100)], step: [step(D, "garmin", 10010)] });
  await sync(db, UID, PID, TZID, AUTH, 14);
  stubFetch({ calorieOut: [cal(D, "garmin", 0, 2050)], step: [step(D, "garmin", 10010)] });
  await sync(db, UID, PID, TZID, AUTH, 14);
  const w = readWearable(db, UID, PID, D);
  check("reported 0 is written", w.active === 0, `got ${w.active}`);
  check("resting follows to 2050", w.resting === 2050, `got ${w.resting}`);
}

// ── 5. an empty second tracker must not displace the one being worn (S138/S150)
console.log("\n5. two trackers, one empty");
{
  const db = fakeDb();
  stubFetch({
    calorieOut: [cal(D, "appleHealth", 0, 0), cal(D, "garmin", 820, 2200)],
    step: [step(D, "appleHealth", 0), step(D, "garmin", 16410)],
  });
  await sync(db, UID, PID, TZID, AUTH, 14);
  const w = readWearable(db, UID, PID, D);
  check("garmin's calories win", w.active === 820, JSON.stringify(w));
  check("garmin's steps win", w.steps === 16410);
  check("day attributed to garmin", w.source === "garmin", `source=${w.source}`);
}

// ── 6. a hand-entered override owns ITS date only ───────────────────────────
console.log("\n6. manual override is per-date");
{
  const OTHER = "2026-07-31";
  const db = fakeDb();
  stubFetch({
    calorieOut: [cal(D, "garmin", 700, 2100), cal(OTHER, "garmin", 640, 2050)],
    step: [step(D, "garmin", 10010), step(OTHER, "garmin", 9000)],
  });
  await sync(db, UID, PID, TZID, AUTH, 14);
  // Kevin overrides ONLY D, exactly as the burn box writes it.
  const doc = JSON.parse(db.store.get(logKey(UID, PID, D)).value);
  doc.wearable = { ...doc.wearable, active: 950, source: "Manual", manual: true, reported: true };
  db.store.set(logKey(UID, PID, D), { k: `caliq-log-${PID}-${D}`, value: JSON.stringify(doc) });

  stubFetch({
    calorieOut: [cal(D, "garmin", 700, 2100), cal(OTHER, "garmin", 880, 2050)],
    step: [step(D, "garmin", 10010), step(OTHER, "garmin", 9500)],
  });
  await sync(db, UID, PID, TZID, AUTH, 14);
  const wD = readWearable(db, UID, PID, D), wO = readWearable(db, UID, PID, OTHER);
  check("overridden day keeps the typed 950", wD.active === 950, `got ${wD.active}`);
  check("overridden day stays flagged manual", wD.manual === true);
  check("the NEXT day still tracks the watch", wO.active === 880, `got ${wO.active}`);
  check("the next day is not flagged manual", !wO.manual);
}

// ── 7. an empty tracker record must not read as a zero-calorie day ──────────
// Kevin's real data, Aug 2026: Trainerize returns ONE calorie record per date —
// garmin's on the days Garmin reported, an empty appleHealthKit {0,0} on the
// rest — while garmin supplies steps every day. Those phantom zeros were being
// stored as real readings, which is what showed 0 burn.
console.log("\n7. empty {0,0} tracker record is not data");
{
  const GARMIN = "2026-07-30", PHANTOM = "2026-07-31";
  const db = fakeDb();
  stubFetch({
    calorieOut: [cal(GARMIN, "garmin", 607, 2337), cal(PHANTOM, "appleHealthKit", 0, 0)],
    step: [step(GARMIN, "garmin", 10201), step(PHANTOM, "garmin", 6839)],
  });
  await sync(db, UID, PID, TZID, AUTH, 14);
  const g = readWearable(db, UID, PID, GARMIN), p = readWearable(db, UID, PID, PHANTOM);
  check("garmin day keeps its calories", g.active === 607 && g.resting === 2337, JSON.stringify(g));
  check("phantom day records NO calories", p.active === undefined && p.resting === undefined, JSON.stringify(p));
  check("phantom day still keeps garmin's steps", p.steps === 6839, JSON.stringify(p));

  // And a later phantom must not erase a real reading already stored.
  stubFetch({
    calorieOut: [cal(GARMIN, "appleHealthKit", 0, 0)],
    step: [step(GARMIN, "garmin", 10201)],
  });
  await sync(db, UID, PID, TZID, AUTH, 14);
  const g2 = readWearable(db, UID, PID, GARMIN);
  check("a later phantom cannot erase garmin's number", g2.active === 607, `got ${g2.active}`);
}

// ── 8. a real 0-active day with resting still counts (S137 must survive) ────
console.log("\n8. real 0 active + real resting still writes");
{
  const db = fakeDb();
  stubFetch({ calorieOut: [cal(D, "garmin", 0, 2337)], step: [step(D, "garmin", 400)] });
  await sync(db, UID, PID, TZID, AUTH, 14);
  const w = readWearable(db, UID, PID, D);
  check("active 0 recorded", w.active === 0, JSON.stringify(w));
  check("resting 2337 recorded", w.resting === 2337);
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
