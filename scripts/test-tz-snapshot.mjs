// applySnapshotAndSyncs — the function every Trainerize import and every
// scheduled auto-sync runs (S197y).
//
// WHY THIS EXISTS: it threw a ReferenceError on EVERY call for four hours,
// because S197f's transactional conversion moved `d` and `step` inside a
// callback while the return statement still read them outside. Valid syntax,
// so `node --check` passed. No test touched it. And it is admin-UID-gated, so
// it cannot be exercised in production from anywhere except Kevin's own
// account — which is exactly why it needs covering here instead.
//
// Run: node scripts/test-tz-snapshot.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "functions/trainerize.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Pull the real function plus the helpers it needs, and inject the rest.
const cut = (start, endMarker) => {
  const a = SRC.indexOf(start);
  if (a < 0) throw new Error("could not find " + start);
  const b = SRC.indexOf(endMarker, a);
  return SRC.slice(a, b);
};
const planTxn = cut("async function planTxnWrap", "\n}\n") + "\n}\n";
const applyFn = cut("async function applySnapshotAndSyncs", "\n// Every Trainerize client we should keep in sync");

const store = new Map();
const K = (uid, key) => `users/${uid}/kv/${encodeURIComponent(key)}`;
const db = {
  doc: (p) => ({ path: p,
    async get() { const d = store.get(p); return { exists: !!d, data: () => d }; },
    async set(v) { store.set(p, v); } }),
  async runTransaction(fn) {
    const tx = {
      async get(r) { const d = store.get(r.path); return { exists: !!d, data: () => d }; },
      set(r, v) { store.set(r.path, v); },
    };
    return await fn(tx);
  },
};
const read = (uid, key) => { const d = store.get(K(uid, key)); return d ? JSON.parse(d.value) : null; };
const seed = (uid, key, obj) => store.set(K(uid, key), { k: key, value: JSON.stringify(obj) });

// The three syncs each hit the Trainerize API; stub them to no-ops so this
// isolates the snapshot/merge logic (the workout sync has its own harness).
const scope = new Function(
  "db_unused", "syncClientNutrition", "syncClientHealth", "syncClientWorkouts", "console",
  `${planTxn}\n${applyFn}\nreturn { applySnapshotAndSyncs };`
)(null,
  async () => 0,
  async () => ({ days: 0, seen: 0 }),
  async () => 0,
  console);

const CLIENT = { id: 4242 };

(async () => {
  // ── 1. THE REGRESSION ITSELF: it must not throw, and must report back. ────
  store.clear();
  seed("admin", "caliq-ctz4242", { data: { weightLbs: 200, trainerNotes: "keep this" }, step: 5 });
  let res = null, threw = null;
  try {
    res = await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT,
      { weightLbs: 191, gender: "male", age: 41, heightFt: 6, activityLevel: "moderate" },
      "2026-08-20", {}, 14);
  } catch (e) { threw = String(e && e.message); }
  ok("it does not throw (the S197f ReferenceError)", threw === null, threw);
  ok("it returns the plan data it wrote", !!(res && res.d), res && Object.keys(res || {}));
  ok("it returns the step", res && typeof res.step === "number", res && res.step);
  ok("it reports the sync counts callers print", res
    && res.mealDays === 0 && res.healthDays === 0 && res.workoutDays === 0, res);

  // ── 2. it actually wrote, and merged rather than replaced ────────────────
  const wrap = read("admin", "caliq-ctz4242");
  ok("the snapshot was persisted", wrap && wrap.data.weightLbs === 191, wrap && wrap.data.weightLbs);
  ok("Trainerize's profile fields applied", wrap.data.gender === "male" && wrap.data.age === 41, wrap.data);
  ok("a field Trainerize knows nothing about SURVIVED", wrap.data.trainerNotes === "keep this", wrap.data.trainerNotes);
  ok("trainerizeId is stamped for the auto-sync to find", wrap.data.trainerizeId === 4242, wrap.data.trainerizeId);
  ok("a complete profile reaches step 5", wrap.step === 5, wrap.step);
  ok("the returned data matches what was written", res.d.weightLbs === wrap.data.weightLbs);

  // ── 3. the weigh-in seeded a check-in on the stat's own date ─────────────
  const ci = (wrap.data.checkIns || []).find((c) => c.date === "2026-08-20");
  ok("a check-in was seeded on the stat date", !!ci && Number(ci.weight) === 191, ci);
  ok("startWeightLbs was captured", wrap.data.startWeightLbs === 191, wrap.data.startWeightLbs);

  // ── 4. a LOCAL weigh-in that is newer must not be reverted (S86d rule) ───
  store.clear();
  seed("admin", "caliq-ctz4242", { data: { weightLbs: 188,
    checkIns: [{ date: "2026-08-23", weight: 188, timestamp: 1 }] }, step: 5 });
  await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT,
    { weightLbs: 200 }, "2026-08-20", {}, 14);
  ok("a fresher Glidna weigh-in is NOT overwritten by an older stat",
     read("admin", "caliq-ctz4242").data.weightLbs === 188,
     read("admin", "caliq-ctz4242").data.weightLbs);

  // ── 5. deliberately-set macro targets are never re-stamped ───────────────
  store.clear();
  seed("admin", "caliq-ctz4242", { data: { macroTargets: { protein: 200 }, macroTargetsEditedAt: 123 }, step: 5 });
  await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT,
    { macroTargets: { protein: 111 }, weightLbs: 180 }, null, {}, 14);
  ok("an edited macro target survives the sync",
     read("admin", "caliq-ctz4242").data.macroTargets.protein === 200,
     read("admin", "caliq-ctz4242").data.macroTargets);

  // ── 6. a plan that does not exist yet is created, not crashed on ─────────
  store.clear();
  threw = null;
  try {
    await scope.applySnapshotAndSyncs(db, "admin", "ctz9999", { id: 9999 }, { weightLbs: 150 }, null, {}, 14);
  } catch (e) { threw = String(e && e.message); }
  ok("a brand-new plan document is created", threw === null && read("admin", "caliq-ctz9999") !== null, threw);

  console.log(`  ${checks - fails}/${checks} assertions passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e.message); process.exit(1); });
