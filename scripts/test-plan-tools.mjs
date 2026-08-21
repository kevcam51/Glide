// Regression test for the eight plan-editing AI tools after the S197f
// transactional conversion.
//
// node --check cannot catch what this catches: a variable that now lives only
// inside the transaction callback is a RUNTIME ReferenceError. This drives the
// real runTool for every converted tool against a fake Firestore and checks
// both the written document and the returned shape.
//
// Run: node scripts/test-plan-tools.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const FN = join(dirname(fileURLToPath(import.meta.url)), "..", "functions") + "/";
const fs = require("fs");


const admin = require(FN + "node_modules/firebase-admin");

const store = new Map();
const mkRef = (p) => ({
  path: p,
  async get() { const d = store.get(p); return { exists: !!d, data: () => d }; },
  async set(v) { store.set(p, v); },
  async update(v) { store.set(p, { ...(store.get(p) || {}), ...v }); },
  async delete() { store.delete(p); },
});
const db = {
  doc: mkRef,
  collection: (c) => ({
    doc: (id) => mkRef(`${c}/${id}`),
    async get() { return { empty: true, docs: [], forEach() {} }; },
    where() { return this; }, orderBy() { return this; }, limit() { return this; },
  }),
  async runTransaction(fn) {
    const tx = {
      async get(r) { const d = store.get(r.path); return { exists: !!d, data: () => d }; },
      set(r, v) { store.set(r.path, v); },
    };
    return await fn(tx);
  },
};
// firebase-admin defines `firestore` with a getter, so a plain assignment is
// silently ignored — this is why the first attempt still hit the real SDK.
Object.defineProperty(admin, "firestore", { value: () => db, configurable: true, writable: true });
Object.defineProperty(admin, "initializeApp", { value: () => ({}), configurable: true, writable: true });

const { runTool } = require(FN + "aitools.js");

const K = (uid, key) => `users/${uid}/kv/${encodeURIComponent(key)}`;
const seed = (uid, key, obj) => store.set(K(uid, key), { k: key, value: JSON.stringify(obj) });
const read = (uid, key) => { const d = store.get(K(uid, key)); return d ? JSON.parse(d.value) : null; };

const ctx = { callerUid: "u1", role: "client", isTrainer: false, callerName: "Casey",
  today: "2026-08-21", db, seatAutoConfirm: 0 };

let fails = 0, checks = 0;
const ok = (name, cond, extra) => { checks++; if (!cond) { fails++; console.log("FAIL:", name, extra !== undefined ? JSON.stringify(extra) : ""); } };

(async () => {
  const reset = () => { store.clear(); seed("u1", "caliq-plans", { active: "self", plans: [{ id: "self", name: "Main" }] });
    seed("u1", "caliq-self", { data: { gender: "female", age: 30, heightFt: 5, heightIn: 6, weightLbs: 186, goalWeight: 172, activityLevel: "moderate" }, step: 5 }); };

  // ── set_personal_info ────────────────────────────────────────────────────
  reset();
  let r = await runTool("set_personal_info", { weightLbs: 180, goalWeightLbs: 165 }, ctx);
  ok("set_personal_info ok", r.ok === true, r);
  ok("set_personal_info persisted weight", read("u1", "caliq-self").data.weightLbs === 180);
  ok("set_personal_info persisted goal", read("u1", "caliq-self").data.goalWeight === 165);
  ok("set_personal_info returns changes", Array.isArray(r.updated) && r.updated.length === 2, r.updated);
  ok("set_personal_info returns a profile", !!r.profile && r.profile.weightLbs === 180, r.profile);
  ok("set_personal_info kept other fields", read("u1", "caliq-self").data.gender === "female");
  ok("set_personal_info kept step", read("u1", "caliq-self").step === 5);

  // refusal path must NOT write
  reset();
  const beforeRefuse = JSON.stringify(read("u1", "caliq-self"));
  r = await runTool("set_personal_info", {}, ctx);
  ok("set_personal_info refuses empty input", !!r.error, r);
  ok("refusal wrote nothing", JSON.stringify(read("u1", "caliq-self")) === beforeRefuse);

  // ── set_targets ──────────────────────────────────────────────────────────
  reset();
  r = await runTool("set_targets", { proteinTarget: 200 }, ctx);
  ok("set_targets ok", r.ok === true, r);
  ok("set_targets pinned ONLY protein", JSON.stringify(read("u1", "caliq-self").data.macroTargets) === '{"protein":200}',
     read("u1", "caliq-self").data.macroTargets);
  ok("set_targets returns updated", r.updated && r.updated.macroTargets.protein === 200, r.updated);
  r = await runTool("set_targets", {}, ctx);
  ok("set_targets refuses empty", !!r.error);

  // ── log_weigh_in ─────────────────────────────────────────────────────────
  reset();
  r = await runTool("log_weigh_in", { weightLbs: 184.2 }, ctx);
  ok("log_weigh_in ok", r.ok === true, r);
  let d = read("u1", "caliq-self").data;
  ok("weigh-in set current weight", d.weightLbs === 184.2);
  ok("weigh-in created a check-in", d.checkIns.length === 1 && d.checkIns[0].weight === 184.2);
  ok("weigh-in seeded startWeight", d.startWeightLbs === 186);
  // back-dated weigh-in must NOT move current weight (the S196p rule)
  r = await runTool("log_weigh_in", { weightLbs: 190, date: "2026-08-01" }, ctx);
  d = read("u1", "caliq-self").data;
  ok("back-dated weigh-in kept current weight", d.weightLbs === 184.2, d.weightLbs);
  ok("back-dated weigh-in still recorded", d.checkIns.some((c) => c.date === "2026-08-01" && c.weight === 190));

  // ── log_workout merges into the same day's check-in ──────────────────────
  r = await runTool("log_workout", { note: "Push day", date: "2026-08-01" }, ctx);
  d = read("u1", "caliq-self").data;
  const aug1 = d.checkIns.find((c) => c.date === "2026-08-01");
  ok("log_workout ok", r.ok === true, r);
  ok("workout merged, weight survived", aug1.workedOut === true && aug1.weight === 190, aug1);

  // ── log_check_in ─────────────────────────────────────────────────────────
  r = await runTool("log_check_in", { mood: 4, notes: "felt strong" }, ctx);
  ok("log_check_in ok", r.ok === true, r);
  d = read("u1", "caliq-self").data;
  const today = d.checkIns.find((c) => c.date === "2026-08-21");
  ok("check-in merged with the weigh-in", today.mood === 4 && today.weight === 184.2, today);

  // ── log_measurements (returns computed metrics from inside the txn) ──────
  reset();
  r = await runTool("log_measurements", { waist: 32, hips: 40, thigh: 22, calf: 14, wrist: 6 }, ctx);
  ok("log_measurements ok", r.ok === true, r);
  ok("log_measurements persisted", (read("u1", "caliq-self").data.measurements || []).length === 1);
  ok("log_measurements returned metrics", r.bodyFatPct !== undefined || r.note !== undefined, r);

  // ── add_custom_exercise, incl. the dedupe no-write path ─────────────────
  reset();
  r = await runTool("add_custom_exercise", { name: "Sled Push", type: "strength", met: 9 }, ctx);
  ok("add_custom_exercise ok", r.ok === true && !!r.exercise.id, r);
  const firstId = r.exercise.id;
  ok("custom exercise persisted", read("u1", "caliq-self").data.customExercises.length === 1);
  ok("burnPer30min reported", typeof r.burnPer30min === "number", r.burnPer30min);
  const beforeDupe = JSON.stringify(read("u1", "caliq-self"));
  r = await runTool("add_custom_exercise", { name: "sled push", type: "strength", met: 9 }, ctx);
  ok("dedupe reuses the id", r.ok === true && r.exercise.id === firstId, r);
  ok("dedupe wrote nothing", JSON.stringify(read("u1", "caliq-self")) === beforeDupe);
  ok("dedupe says so", /Already exists/.test(r.note || ""), r.note);

  // ── set_workout_schedule ────────────────────────────────────────────────
  reset();
  r = await runTool("set_workout_schedule", { strength: { Monday: [{ type: "bb_bench", duration: 45 }] } }, ctx);
  ok("set_workout_schedule ok", r.ok === true, r);
  ok("schedule persisted", (read("u1", "caliq-self").data.strength.Monday || []).length === 1,
     read("u1", "caliq-self").data.strength);
  ok("returns strengthDays", Array.isArray(r.strengthDays) && r.strengthDays[0].startsWith("Monday"), r.strengthDays);
  ok("returns droppedInvalidIds", Array.isArray(r.droppedInvalidIds), r.droppedInvalidIds);
  r = await runTool("set_workout_schedule", {}, ctx);
  ok("set_workout_schedule refuses empty", !!r.error, r);
  // an unknown id is dropped and reported
  r = await runTool("set_workout_schedule", { cardio: { Tuesday: [{ type: "not_a_real_exercise" }] } }, ctx);
  ok("unknown ids reported", (r.droppedInvalidIds || []).includes("not_a_real_exercise"), r.droppedInvalidIds);

  // ── a MISSING plan document must not throw ──────────────────────────────
  store.clear(); seed("u1", "caliq-plans", { active: "brand-new", plans: [{ id: "brand-new", name: "New" }] });
  r = await runTool("set_personal_info", { weightLbs: 200 }, ctx);
  ok("missing plan doc creates one", r.ok === true && read("u1", "caliq-brand-new").data.weightLbs === 200, r);

  console.log(`\n${checks - fails}/${checks} assertions passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
