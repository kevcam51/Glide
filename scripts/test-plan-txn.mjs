// Regression test for planTxnWrap (S197f) — the transactional read-modify-write
// that replaced the plan wrapper's last-write-wins overwrite.
//
// The bug it pins down: loadPlanWrap() -> mutate -> kvSetJSON() wrote the WHOLE
// document, so a second writer landing in between was silently erased. The AI
// writes plans through these tools while a trainer edits the same plan in the
// app, so that window is real.
//
// Assertion 6 is a NEGATIVE CONTROL: it reproduces the old blind write and
// proves this test can actually detect the bug it is guarding against.
//
// Run: node scripts/test-plan-txn.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const FN = join(dirname(fileURLToPath(import.meta.url)), "..", "functions") + "/";
const fs = require("fs");

let failures = 0, checks = 0;
const ok = (name, cond) => { checks++; if (!cond) { failures++; console.log("FAIL:", name); } };

// ── A minimal Firestore stand-in with optimistic concurrency ────────────────
function makeDb() {
  const store = new Map();          // path -> { value, version }
  let txnAttempts = 0;
  const ref = (path) => ({
    path,
    async get() { const d = store.get(path); return { exists: !!d, data: () => ({ value: d.value }) }; },
    set(v) { const cur = store.get(path); store.set(path, { value: v.value, version: (cur ? cur.version : 0) + 1 }); },
  });
  return {
    _store: store,
    _attempts: () => txnAttempts,
    doc: (p) => ref(p),
    // Reads snapshot a version; the commit fails if that version moved, and the
    // whole function is re-run — exactly Firestore's behaviour.
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 6; attempt++) {
        txnAttempts++;
        const readVersions = new Map();
        const writes = [];
        const tx = {
          async get(r) {
            const d = store.get(r.path);
            readVersions.set(r.path, d ? d.version : 0);
            return { exists: !!d, data: () => ({ value: d.value }) };
          },
          set(r, v) { writes.push([r.path, v]); },
        };
        const out = await fn(tx);
        let stale = false;
        for (const [p, v] of readVersions) {
          const d = store.get(p);
          if ((d ? d.version : 0) !== v) { stale = true; break; }
        }
        if (stale) { if (db._onRetry) db._onRetry(); continue; }
        for (const [p, v] of writes) {
          const cur = store.get(p);
          store.set(p, { value: v.value, version: (cur ? cur.version : 0) + 1 });
        }
        return out;
      }
      throw new Error("too much contention");
    },
  };
}
let db = makeDb();

// The helper under test, copied verbatim from aitools.js.
const src = fs.readFileSync(FN + "aitools.js", "utf8");
const start = src.indexOf("async function planTxnWrap");
const end = src.indexOf("\n}\n", start) + 3;
const helperSrc = src.slice(start, end);
ok("extracted planTxnWrap", helperSrc.includes("runTransaction") && helperSrc.includes("__abort"));
const kvDocRef = (db, uid, key) => db.doc(`users/${uid}/kv/${encodeURIComponent(key)}`);
const planTxnWrap = new Function("kvDocRef", `${helperSrc}; return planTxnWrap;`)(kvDocRef);

const seed = (planId, wrap) => db._store.set(`users/u1/kv/${encodeURIComponent("caliq-" + planId)}`,
  { value: JSON.stringify(wrap), version: 1 });
const read = (planId) => JSON.parse(db._store.get(`users/u1/kv/${encodeURIComponent("caliq-" + planId)}`).value);

(async () => {
  // 1. basic write
  db = makeDb(); seed("self", { data: { weightLbs: 200 }, step: 5 });
  await planTxnWrap(db, "u1", "self", (w) => { w.data.weightLbs = 190; return {}; });
  ok("writes the mutation", read("self").data.weightLbs === 190);
  ok("preserves untouched fields", read("self").step === 5);

  // 2. missing document becomes a fresh wrapper rather than throwing
  db = makeDb();
  await planTxnWrap(db, "u1", "new", (w) => { w.data.goalWeight = 170; return {}; });
  ok("creates a wrapper when absent", read("new").data.goalWeight === 170 && read("new").step === 0);

  // 3. corrupt JSON is treated as absent, not fatal
  db = makeDb();
  db._store.set(`users/u1/kv/${encodeURIComponent("caliq-self")}`, { value: "{not json", version: 1 });
  await planTxnWrap(db, "u1", "self", (w) => { w.data.age = 30; return {}; });
  ok("survives corrupt JSON", read("self").data.age === 30);

  // 4. __abort writes NOTHING and returns the object
  db = makeDb(); seed("self", { data: { weightLbs: 200 }, step: 5 });
  const before = db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`).version;
  const res = await planTxnWrap(db, "u1", "self", (w) => {
    w.data.weightLbs = 1; // a mutation that must NOT be persisted
    return { __abort: true, error: "nope" };
  });
  ok("__abort returns the object", res.error === "nope");
  ok("__abort writes nothing", read("self").data.weightLbs === 200
    && db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`).version === before);

  // 5. THE POINT: a concurrent writer must not be lost.
  // Someone else writes the doc between our read and our commit.
  db = makeDb(); seed("self", { data: { weightLbs: 200, trainerNotes: "" }, step: 5 });
  let injected = false;
  db._onRetry = () => {};
  const other = () => {           // the app's autoSave, landing mid-transaction
    const cur = read("self");
    cur.data.trainerNotes = "written by the trainer in the app";
    const d = db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`);
    db._store.set(`users/u1/kv/${encodeURIComponent("caliq-self")}`,
      { value: JSON.stringify(cur), version: d.version + 1 });
  };
  await planTxnWrap(db, "u1", "self", (w) => {
    if (!injected) { injected = true; other(); }   // contention on the first attempt only
    w.data.weightLbs = 185;                        // the AI's edit
    return {};
  });
  const merged = read("self");
  ok("AI edit landed", merged.data.weightLbs === 185);
  ok("concurrent trainer edit SURVIVED", merged.data.trainerNotes === "written by the trainer in the app");
  ok("it actually retried", db._attempts() >= 2);

  // 6. the same race WITHOUT a transaction — proves the test can detect the bug
  db = makeDb(); seed("self", { data: { weightLbs: 200, trainerNotes: "" }, step: 5 });
  const stale = read("self");                       // load
  other();                                          // someone else writes
  stale.data.weightLbs = 185;                       // mutate our stale copy
  db._store.set(`users/u1/kv/${encodeURIComponent("caliq-self")}`,
    { value: JSON.stringify(stale), version: 99 }); // blind overwrite
  ok("old code WOULD have lost the trainer edit", read("self").data.trainerNotes === "");

  // 7. retries must not double-count an accumulator held INSIDE fn
  db = makeDb(); seed("self", { data: {}, step: 0 });
  let inj2 = false;
  const out = await planTxnWrap(db, "u1", "self", (w) => {
    const changes = [];                             // declared inside — correct
    if (!inj2) { inj2 = true; other(); }
    w.data.age = 30; changes.push("age");
    return { changes };
  });
  ok("inner accumulator is not doubled by a retry", out.changes.length === 1);

  console.log(`\n${checks - failures}/${checks} assertions passed`);
  process.exit(failures ? 1 : 0);
})();
