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
// The real list, lifted rather than retyped: a local copy would keep passing
// while the shipping one lost a field (S200g).
const localWins = cut("const LOCAL_EDIT_WINS = [", "];") + "];";
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
  `${localWins}\n${planTxn}\n${applyFn}\nreturn { applySnapshotAndSyncs, LOCAL_EDIT_WINS };`
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

  // ── 5b. EVERY snapshot field yields to a deliberate local edit (S200f/g) ──
  // ⚠️ THE SAME BUG WAS FIXED THREE TIMES, ONE FIELD AT A TIME. macroTargets in
  // S86 ("an edit silently reverted within the half hour"), weightLbs in S198
  // ("logged 200, still saw 202"), activityLevel in S200f — each guard added for
  // the field that had just been reported, while everything beside it stayed
  // exposed. Kevin: "protect the other fields too." So the rule is now a list,
  // and this loop walks the SHIPPING list rather than a copy of it: a field that
  // drops out of LOCAL_EDIT_WINS fails here instead of silently losing its guard.
  const SNAP = { firstName: "Tz", lastName: "Remote", gender: "male", age: 41,
    heightFt: 6, heightIn: 2, goalWeight: 175, bodyFat: 22,
    activityLevel: "moderate", macroTargets: { protein: 111 } };
  const LOCAL = { firstName: "Kev", lastName: "Local", gender: "female", age: 30,
    heightFt: 5, heightIn: 9, goalWeight: 160, bodyFat: 14,
    activityLevel: "very", macroTargets: { protein: 200 } };
  const sameVal = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  for (const f of scope.LOCAL_EDIT_WINS) {
    // marked → the local value is untouchable
    store.clear();
    seed("admin", "caliq-ctz4242", { data: { [f]: LOCAL[f], [`${f}EditedAt`]: 123 }, step: 5 });
    await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT, { ...SNAP }, null, {}, 14);
    ok(`a chosen ${f} survives the sync`,
       sameVal(read("admin", "caliq-ctz4242").data[f], LOCAL[f]),
       read("admin", "caliq-ctz4242").data[f]);

    // unmarked → Trainerize is still source of truth, exactly as before. A guard
    // that also broke the first import would be a different bug, not a fix.
    store.clear();
    seed("admin", "caliq-ctz4242", { data: { [f]: LOCAL[f] }, step: 5 });
    await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT, { ...SNAP }, null, {}, 14);
    ok(`an UNedited ${f} still follows Trainerize`,
       sameVal(read("admin", "caliq-ctz4242").data[f], SNAP[f]),
       read("admin", "caliq-ctz4242").data[f]);
  }

  // The list itself, because its CONTENTS are the guarantee.
  ok("the guard covers every field mapSnapshot can write, minus the measurement", (() => {
    const fn = SRC.slice(SRC.indexOf("function mapSnapshot"), SRC.indexOf("\n}", SRC.indexOf("function mapSnapshot")));
    const written = [...fn.matchAll(/\bd\.([a-zA-Z]+) =/g)].map((m) => m[1])
      .filter((k) => !k.startsWith("_"));
    // weightLbs is deliberately excluded — it is a measurement and keeps syncing
    // under the newest-reading-wins rule; a marker there would freeze the scale.
    const missing = [...new Set(written)].filter((k) => k !== "weightLbs" && !scope.LOCAL_EDIT_WINS.includes(k));
    if (missing.length) console.log("      unguarded snapshot fields:", missing.join(", "));
    return missing.length === 0;
  })());
  ok("weightLbs is NOT marker-guarded — it keeps its newest-reading-wins rule",
     !scope.LOCAL_EDIT_WINS.includes("weightLbs"));

  // The three lists that have to agree, because the app stamps what this drops.
  {
    const list = (src, name) => {
      const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
      return m ? [...m[1].matchAll(/"([a-zA-Z]+)"/g)].map((x) => x[1]).sort() : null;
    };
    const app = list(readFileSync(join(ROOT, "src/App.jsx"), "utf8"), "TZ_SNAPSHOT_FIELDS");
    const ai = list(readFileSync(join(ROOT, "functions/aitools.js"), "utf8"), "TZ_OWNED_FIELDS");
    const tz = [...scope.LOCAL_EDIT_WINS].sort();
    ok("the app stamps exactly what the sync yields on", JSON.stringify(app) === JSON.stringify(tz), { app, tz });
    ok("and so does the assistant", JSON.stringify(ai) === JSON.stringify(tz), { ai, tz });
  }

  // Height is written as a pair, so half a guard would invent a height nobody has.
  store.clear();
  seed("admin", "caliq-ctz4242", { data: { heightFt: 5, heightIn: 9, heightFtEditedAt: 1, heightInEditedAt: 1 }, step: 5 });
  await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT, { heightFt: 6, heightIn: 2 }, null, {}, 14);
  ok("a marked height survives as a PAIR",
     read("admin", "caliq-ctz4242").data.heightFt === 5 && read("admin", "caliq-ctz4242").data.heightIn === 9,
     read("admin", "caliq-ctz4242").data);

  // And a marker on one field must not freeze the others.
  store.clear();
  seed("admin", "caliq-ctz4242", { data: { activityLevel: "very", activityLevelEditedAt: 123, goalWeight: 300 }, step: 5 });
  await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT,
    { activityLevel: "moderate", goalWeight: 175, gender: "male" }, null, {}, 14);
  ok("the guard is field-scoped, not a whole-snapshot veto",
     read("admin", "caliq-ctz4242").data.activityLevel === "very"
     && read("admin", "caliq-ctz4242").data.goalWeight === 175
     && read("admin", "caliq-ctz4242").data.gender === "male",
     read("admin", "caliq-ctz4242").data);

  // ── 5c. writeSnapshot:false — WATCH DATA ONLY (S200h) ────────────────────
  // Kevin: "I do not want anything input in trainerize, other than the calorie
  // burn, to affect glide and change glide."
  //
  // The per-field guards above only protect what someone has ALREADY edited
  // here; a field nobody has touched stayed Trainerize's forever, re-asserted
  // every thirty minutes. So the background paths — the 30-minute schedule and
  // the "sync tracker now" button — now carry only what the watch measured.
  // Seeding on a deliberate import is unchanged: that is Kevin choosing.
  store.clear();
  seed("admin", "caliq-ctz4242", { data: { gender: "female", age: 30, goalWeight: 160,
    activityLevel: "very", weightLbs: 150, trainerNotes: "keep this" }, step: 5 });
  const before = JSON.stringify(read("admin", "caliq-ctz4242"));
  const rSkip = await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT,
    { gender: "male", age: 41, goalWeight: 999, activityLevel: "sedentary", weightLbs: 999 },
    "2026-09-01", {}, 14, false);
  ok("watch-only: the plan document is byte-identical afterwards",
     JSON.stringify(read("admin", "caliq-ctz4242")) === before,
     read("admin", "caliq-ctz4242").data);
  ok("watch-only: it says so to the caller", rSkip.snapshotSkipped === true, rSkip);
  ok("watch-only: the watch syncs still ran", "healthDays" in rSkip && "workoutDays" in rSkip, rSkip);

  // ⚠️ AND THE DEFAULT MUST STAY THE OLD BEHAVIOUR, or a deliberate import
  // silently stops importing. Same call, flag omitted.
  store.clear();
  seed("admin", "caliq-ctz4242", { data: { gender: "female" }, step: 5 });
  await scope.applySnapshotAndSyncs(db, "admin", "ctz4242", CLIENT, { gender: "male", age: 41 }, null, {}, 14);
  ok("a deliberate import still seeds the profile",
     read("admin", "caliq-ctz4242").data.gender === "male" && read("admin", "caliq-ctz4242").data.age === 41,
     read("admin", "caliq-ctz4242").data);

  // The two background callers must pass the flag; the picker must not. This is
  // a source check because the callers are Cloud Function bodies, but it is the
  // half that decides whether any of the above ever runs in production.
  {
    const bg = (SRC.match(/runImport\(db, uid, auth, \{ clientIds: ids, nutritionDays: 14, writeSnapshot: false \}\)/g) || []).length;
    ok("both background paths ask for watch data only", bg === 2, bg);
    ok("the 30-minute schedule is one of them",
       /trainerizeAutoSync[\s\S]*?writeSnapshot: false/.test(SRC));
    ok("the import picker still seeds",
       /return await runImport\(db, uid, auth, \{ clientIds, nutritionDays: NUTRITION_DAYS \}\);/.test(SRC));
    ok("no background caller was left on the old signature",
       !/runImport\(db, uid, auth, \{ clientIds: ids, nutritionDays: 14 \}\)/.test(SRC));
    // ⚠️ THE LOCAL INDEX CARD IS PART OF THE SAME PROMISE, and it lives in
    // runImport, which this harness cannot drive (it would call Trainerize). So
    // this is a source check — but a real one: with the snapshot skipped, `r.d`
    // is empty, so rebuilding the card from it would blank its weight and goal
    // and reset the step label. The guard must bail BEFORE the rebuild.
    const local = SRC.slice(SRC.indexOf("// LOCAL profile (default)"), SRC.indexOf("await kvSetJSON(db, uid, \"caliq-index\""));
    ok("watch-only bails before rebuilding the local index card",
       /if \(!writeSnapshot\) \{[\s\S]*?continue;[\s\S]*?\}\s*const entry = \{/.test(local),
       local.slice(local.indexOf("const r = await applySnapshot"), local.indexOf("const r = await applySnapshot") + 200));
    ok("...and the rebuild it guards is still there for a real import",
       /const entry = \{[\s\S]*?weight: r\.d\.weightLbs/.test(local));
  }

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
