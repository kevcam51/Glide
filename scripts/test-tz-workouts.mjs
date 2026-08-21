// Regression test for the Trainerize workout sync after the S197f
// transactional conversion (it runs on a 30-minute schedule, so it lands while
// people are using the app). Checks the marked counts, idempotence, and that a
// hand-written note and mood on the same day survive the merge.
//
// Run: node scripts/test-tz-workouts.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const FN = join(dirname(fileURLToPath(import.meta.url)), "..", "functions") + "/";
const fs = require("fs");

const src = fs.readFileSync(FN + "trainerize.js", "utf8");
const cut = (startMarker, endMarker) => {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error("could not extract " + startMarker);
  return src.slice(a, b);
};
const helperSrc = cut("async function planTxnWrap", "\n}\n") + "\n}\n";
const fnSrc = cut("async function syncClientWorkouts", "\n// Sync one client's recent Trainerize nutrition");
const mergeSrc = cut("function mergeTzNote", "\n}\n") + "\n}\n";
const nameSrc = cut("function workoutItemName", "\n}\n") + "\n}\n";

let failures = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { failures++; console.log("FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const store = new Map();
const db = {
  doc: (p) => ({ path: p }),
  async runTransaction(fn) {
    const tx = {
      async get(r) { const d = store.get(r.path); return { exists: !!d, data: () => d }; },
      set(r, v) { store.set(r.path, v); },
    };
    return await fn(tx);
  },
};
const K = (uid, key) => `users/${uid}/kv/${encodeURIComponent(key)}`;
const read = (uid, pid) => { const d = store.get(K(uid, `caliq-${pid}`)); return d ? JSON.parse(d.value) : null; };

const today = new Date().toISOString().slice(0, 10);
let calendar = [{ date: today, items: [
  { status: "tracked", type: "workoutRegular", title: "Back & Triceps", detail: { time: 3600 } },
  { status: "tracked", type: "cardio", detail: { time: 1200 } },
  { status: "scheduled", type: "workoutRegular", title: "Never happened" },
]}];
const tz = async () => ({ ok: true, status: 200, json: { calendar } });

const scope = new Function("db_unused", "tz", "WORKOUT_DAYS_MAX", "WORKOUT_TYPES", "console", `
  ${helperSrc}
  ${mergeSrc}
  ${nameSrc}
  ${fnSrc}
  return { syncClientWorkouts, planTxnWrap };
`)(null, tz, 90, new Set(["workoutInterval", "workoutRegular", "workoutVideo", "cardio"]), console);

(async () => {
  // 1. first sync marks the day
  store.set(K("u1", "caliq-p1"), { k: "caliq-p1", value: JSON.stringify({ data: { weightLbs: 200 }, step: 5 }) });
  let n = await scope.syncClientWorkouts(db, "u1", "p1", 123, {}, 14);
  ok("first sync marked one day", n === 1, n);
  let d = read("u1", "p1").data;
  ok("check-in created + workedOut", d.checkIns.length === 1 && d.checkIns[0].workedOut === true, d.checkIns);
  ok("names in notes", /Trainerize:/.test(d.checkIns[0].notes), d.checkIns[0].notes);
  ok("minutes recorded", d.checkIns[0].tzMinutes === 80, d.checkIns[0].tzMinutes);
  ok("sessions recorded", d.checkIns[0].tzSessions === 2, d.checkIns[0].tzSessions);
  ok("untouched plan fields survive", d.weightLbs === 200 && read("u1", "p1").step === 5);

  // 2. re-sync is idempotent and writes nothing new
  const before = JSON.stringify(read("u1", "p1"));
  n = await scope.syncClientWorkouts(db, "u1", "p1", 123, {}, 14);
  ok("re-sync marks 0", n === 0, n);
  ok("re-sync wrote nothing", JSON.stringify(read("u1", "p1")) === before);

  // 3. a hand-written note on the same day must survive
  const w = read("u1", "p1");
  w.data.checkIns[0].notes = "Felt great today — " + w.data.checkIns[0].notes;
  w.data.checkIns[0].mood = 5;
  store.set(K("u1", "caliq-p1"), { k: "caliq-p1", value: JSON.stringify(w) });
  calendar = [{ date: today, items: [
    { status: "tracked", type: "workoutRegular", title: "Back & Triceps", detail: { time: 3600 } },
    { status: "tracked", type: "cardio", detail: { time: 1200 } },
    { status: "tracked", type: "workoutVideo", title: "Core", detail: { time: 600 } },
  ]}];
  n = await scope.syncClientWorkouts(db, "u1", "p1", 123, {}, 14);
  d = read("u1", "p1").data;
  ok("new session re-marks the day", n === 1, n);
  ok("hand-written note survived", /Felt great today/.test(d.checkIns[0].notes), d.checkIns[0].notes);
  ok("mood survived", d.checkIns[0].mood === 5);
  ok("session count updated", d.checkIns[0].tzSessions === 3, d.checkIns[0].tzSessions);

  // 4. no tracked items → no write at all
  calendar = [{ date: today, items: [{ status: "scheduled", type: "cardio" }] }];
  const before2 = JSON.stringify(read("u1", "p1"));
  n = await scope.syncClientWorkouts(db, "u1", "p1", 123, {}, 14);
  ok("nothing tracked → 0", n === 0, n);
  ok("nothing tracked → no write", JSON.stringify(read("u1", "p1")) === before2);

  console.log(`\n${checks - failures}/${checks} assertions passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e.message); process.exit(1); });
