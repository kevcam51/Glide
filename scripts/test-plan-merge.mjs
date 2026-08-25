// Tests for the client-side three-way plan merge (S197m).
//
// The scenario, which is the whole reason this exists:
//   1. the app holds a plan in React state
//   2. someone types → a 600ms debounce starts
//   3. the AI logs a weigh-in; the live-sync listener SKIPS it, because
//      applying a remote change mid-edit would yank the form
//   4. the debounce fires and writes the whole in-memory copy — and the
//      weigh-in is gone
//
// Assertion group 1 proves the merge keeps both. The NEGATIVE CONTROL proves
// the old whole-document write lost one, so these tests can detect the bug.
//
// Run: node scripts/test-plan-merge.mjs
import { changedKeys, mergePlanData, mergePlanWrap } from "../src/planMerge.js";

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── changedKeys ─────────────────────────────────────────────────────────────
ok("no changes → nothing", changedKeys({ a: 1, b: 2 }, { a: 1, b: 2 }).length === 0);
ok("a scalar edit is caught", changedKeys({ a: 1 }, { a: 2 }).join() === "a");
ok("an added key is caught", changedKeys({ a: 1 }, { a: 1, b: 2 }).join() === "b");
ok("a DELETED key is caught", changedKeys({ a: 1, b: 2 }, { a: 1 }).join() === "b",
   changedKeys({ a: 1, b: 2 }, { a: 1 }));
ok("nested objects compare by value, not reference",
   changedKeys({ m: { p: 1 } }, { m: { p: 1 } }).length === 0);
ok("a nested edit is caught", changedKeys({ m: { p: 1 } }, { m: { p: 2 } }).join() === "m");
ok("array order matters", changedKeys({ a: [1, 2] }, { a: [2, 1] }).join() === "a");
ok("null vs missing are different", changedKeys({ a: null }, {}).join() === "a");
ok("empty baseline reports every key", changedKeys({}, { a: 1, b: 2 }).sort().join() === "a,b");
ok("undefined inputs do not throw", changedKeys(undefined, undefined).length === 0);

// ── THE CORE SCENARIO ───────────────────────────────────────────────────────
// Baseline: what the app last saved. The user then edits goalWeight; meanwhile
// the AI appends a weigh-in to checkIns on the server.
const baseline = { goalWeight: 180, weightLbs: 200, checkIns: [{ date: "2026-08-01", weight: 200 }] };
const userHas  = { goalWeight: 165, weightLbs: 200, checkIns: [{ date: "2026-08-01", weight: 200 }] };
const serverHas = { goalWeight: 180, weightLbs: 194, checkIns: [
  { date: "2026-08-01", weight: 200 }, { date: "2026-08-20", weight: 194 }] };

const merged = mergePlanData(serverHas, baseline, userHas);
ok("the user's edit lands", merged.goalWeight === 165, merged.goalWeight);
ok("the AI's weigh-in SURVIVES", merged.checkIns.length === 2, merged.checkIns);
ok("and the weight the AI set survives too", merged.weightLbs === 194, merged.weightLbs);

// NEGATIVE CONTROL — the old behaviour, so we know this test can fail.
const oldBehaviour = { ...userHas };
ok("the OLD whole-document write would have lost the weigh-in",
   oldBehaviour.checkIns.length === 1 && oldBehaviour.weightLbs === 200);

// ── conflicts on the same key ───────────────────────────────────────────────
const bothEdited = mergePlanData(
  { goalWeight: 170 }, { goalWeight: 180 }, { goalWeight: 165 });
ok("when both edited one key, the user wins it", bothEdited.goalWeight === 165, bothEdited);

// A key the user never touched is taken from the server even when it is new.
const serverAdded = mergePlanData(
  { goalWeight: 180, trainerNotes: "added by the coach" }, { goalWeight: 180 }, { goalWeight: 165 });
ok("a key only the server added is kept", serverAdded.trainerNotes === "added by the coach", serverAdded);

// A key the user DELETED must stay deleted, not be resurrected by the server.
const userDeleted = mergePlanData(
  { goalWeight: 180, dob: "1990-01-01" }, { goalWeight: 180, dob: "1990-01-01" }, { goalWeight: 180 });
ok("a key the user deleted stays deleted", !("dob" in userDeleted), userDeleted);

// ── no baseline → write everything (a brand-new plan) ───────────────────────
const noBase = mergePlanData({ goalWeight: 999, junk: 1 }, null, { goalWeight: 165 });
ok("with no baseline the user's document wins whole", noBase.goalWeight === 165 && !("junk" in noBase), noBase);

// ── the wrapper ─────────────────────────────────────────────────────────────
let w = mergePlanWrap({ data: serverHas, step: 5 }, baseline, userHas, 3);
ok("step is the user's, not the server's", w.step === 3, w.step);
ok("the wrapper still merges its data", w.data.checkIns.length === 2 && w.data.goalWeight === 165);

w = mergePlanWrap(null, baseline, userHas, 5);
ok("a missing server document is fine", w.data.goalWeight === 165 && w.step === 5, w);

w = mergePlanWrap({ data: serverHas, step: 2, someOtherField: "keep me" }, baseline, userHas, 4);
ok("unknown wrapper fields survive", w.someOtherField === "keep me", w);

// ── the merge must not mutate its inputs ────────────────────────────────────
const srvBefore = JSON.stringify(serverHas), userBefore = JSON.stringify(userHas);
mergePlanData(serverHas, baseline, userHas);
ok("the server object is not mutated", JSON.stringify(serverHas) === srvBefore);
ok("the user object is not mutated", JSON.stringify(userHas) === userBefore);

// ── re-running the merge is stable (transactions retry) ─────────────────────
const once = mergePlanData(serverHas, baseline, userHas);
const twice = mergePlanData(serverHas, baseline, userHas);
ok("the merge is deterministic on retry", JSON.stringify(once) === JSON.stringify(twice));
// And applied to its own output, it changes nothing more.
const applied = mergePlanData(once, baseline, userHas);
ok("merging onto the result is idempotent", JSON.stringify(applied) === JSON.stringify(once));

// ── a realistic three-way: trainer edits the program, AI logs a workout ─────
const base2 = { strength: { Monday: ["a"] }, checkIns: [], macroTargets: { protein: 180 } };
const trainerHas = { strength: { Monday: ["a", "b"] }, checkIns: [], macroTargets: { protein: 180 } };
const serverNow = { strength: { Monday: ["a"] },
  checkIns: [{ date: "2026-08-21", workedOut: true }], macroTargets: { protein: 200 } };
const m2 = mergePlanData(serverNow, base2, trainerHas);
ok("the trainer's program edit lands", m2.strength.Monday.length === 2, m2.strength);
ok("the AI's workout survives", m2.checkIns.length === 1, m2.checkIns);
ok("the AI's macro change survives", m2.macroTargets.protein === 200, m2.macroTargets);

// ── a BRAND-NEW plan must save every field it starts with ──────────────────
// createProfile seeds data the server has never seen. If the baseline is that
// same object, the first save diffs it against itself and writes nothing —
// which silently dropped deficitMode from every plan created in-app.
{
  const fresh = { deficitMode: "accelerate", gender: "female" };
  const written = mergePlanData(null, null, fresh);
  ok("a null baseline writes the whole document", written.deficitMode === "accelerate", written);
  ok("and keeps its other seeded fields", written.gender === "female", written);
  // The failure mode it replaced, pinned so it cannot come back:
  const wrong = mergePlanData(null, fresh, fresh);
  ok("baseline === next would have written NOTHING (the bug)",
     Object.keys(wrong).length === 0, wrong);
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
