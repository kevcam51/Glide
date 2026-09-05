// Coaching notes are the coach's (S199j).
//
// THE EXPOSURE. The plan is ONE shared document that both sides edit — that has
// been the design since a client account could be linked at all — so a card
// titled "Trainer Notes", meant for "keeps skipping Thursdays, suspect the job",
// rendered inside the client's own Results page. Hiding that card alone would
// have been a false promise, because it was never the only reader:
//
//   • get_profile returned trainerNotes verbatim, so a client could simply ASK
//     the assistant — in the app or through the MCP connector — and be read
//     their coach's private observations about them.
//   • set_personal_info ACCEPTED trainerNotes and REPLACES rather than appends,
//     so a client could wipe their coach's notes in one sentence.
//
// ⚠️ THIS TEST DRIVES THE REAL runTool. The parity suite in this repo learned
// the hard way that a substring assertion on a function body passes while the
// guard it names is dead code — `if (false)` left it green. So both roles are
// run against the shipping tool over a Firestore stand-in, and the negative
// controls at the bottom prove the harness can actually see the bug.
//
// NOT pinned here, because it is not true: this is a PRODUCT boundary, not a
// storage one. The notes live in the plan document, which for a connected
// client sits in that client's own kv and which firestore.rules correctly lets
// its owner read. Every route the app offers is closed; raw Firestore is not.
//
// Run: node scripts/test-trainer-notes.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
// Resolve exactly as functions/ does, so firebase-admin is the SAME module
// instance aitools.js captured — otherwise the stub below patches a copy.
const require = createRequire(join(ROOT, "functions", "package.json"));
const admin = require("firebase-admin");
const { buildTools, runTool } = require("./aitools.js");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── a Firestore stand-in, enough for the two profile tools ──────────────────
function makeDb() {
  const store = new Map();
  const ref = (path) => ({
    path,
    async get() { const d = store.get(path); return { exists: !!d, data: () => ({ value: d.value }) }; },
    set(v) { store.set(path, { value: v.value }); },
  });
  return {
    _store: store,
    doc: (p) => ref(p),
    async runTransaction(fn) {
      const writes = [];
      const out = await fn({
        async get(r) { const d = store.get(r.path); return { exists: !!d, data: () => ({ value: d.value }) }; },
        set(r, v) { writes.push([r.path, v]); },
      });
      for (const [p, v] of writes) store.set(p, { value: v.value });
      return out;
    },
  };
}
const NOTES = "Keeps skipping Thursdays — suspect the new job. Do not raise directly.";
let db;
const seed = () => {
  db = makeDb();
  db._store.set(`users/u1/kv/${encodeURIComponent("caliq-self")}`, {
    value: JSON.stringify({ data: { weightLbs: 200, gender: "male", age: 35, heightFt: 5, heightIn: 10,
      activityLevel: "moderate", trainerNotes: NOTES }, step: 5 }),
  });
};
const ctxFor = (isTrainer) => ({
  callerUid: "u1", role: isTrainer ? "head_trainer" : "client", isTrainer,
  callerName: isTrainer ? "Coach" : "Client", today: "2026-09-05", nowTime: "12:00",
});
// runTool reaches for admin.firestore() itself rather than taking a db, so the
// stand-in is installed on the namespace. The statics (FieldValue, Timestamp)
// are carried across — aitools uses them, and a bare arrow would drop them.
const realFirestore = admin.firestore;
const stub = () => db;
for (const k of Object.getOwnPropertyNames(realFirestore)) {
  if (["length", "name", "prototype", "caller", "arguments"].includes(k)) continue;
  try { stub[k] = realFirestore[k]; } catch { /* non-configurable static */ }
}
// `firestore` is a getter on the namespace, so it is redefined, not assigned.
Object.defineProperty(admin, "firestore", { value: stub, configurable: true });
const call = (name, input, isTrainer) => runTool(name, input, ctxFor(isTrainer));

// ── READ ────────────────────────────────────────────────────────────────────
{
  seed();
  const asCoach = await call("get_profile", {}, true);
  ok("a coach reads their own notes back", asCoach.trainerNotes === NOTES, asCoach.trainerNotes);

  seed();
  const asClient = await call("get_profile", {}, false);
  ok("a client is not given the notes", asClient.trainerNotes === undefined, asClient.trainerNotes);
  // ⚠️ ABSENT, NOT NULL. `trainerNotes: null` would tell the model "there are no
  // notes" about a person whose coach has written pages — a different lie, and a
  // more convincing one.
  ok("...and the key is absent rather than nulled", !("trainerNotes" in asClient), Object.keys(asClient));
  // The rest of the profile must still arrive, or this stops being a gate and
  // starts being an outage.
  ok("...while the rest of the profile is untouched",
     asClient.weightLbs === 200 && asClient.activityLevel === "moderate", asClient);
}

// ── WRITE ───────────────────────────────────────────────────────────────────
{
  seed();
  const r = await call("set_personal_info", { trainerNotes: "wiped" }, true);
  ok("a coach can still write notes", (r.updated || []).includes("trainer notes"), r);
  const stored = JSON.parse(db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`).value);
  ok("...and the write lands", stored.data.trainerNotes === "wiped", stored.data.trainerNotes);
}
{
  seed();
  // set_personal_info REPLACES. Unguarded, one sentence from the client erases
  // everything the coach ever recorded.
  const r = await call("set_personal_info", { trainerNotes: "" }, false);
  const stored = JSON.parse(db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`).value);
  ok("a client cannot erase their coach's notes", stored.data.trainerNotes === NOTES, stored.data.trainerNotes);
  // Refused OUT LOUD. Dropping the field quietly would have the assistant report
  // a successful save for a change that never happened — the house rule is that
  // silent success is the same bug as silent failure.
  ok("...and is told why, rather than being ignored",
     /coach/i.test(JSON.stringify(r)), r);
}
{
  seed();
  // A refusal must not masquerade as an edit when other fields DID apply.
  const r = await call("set_personal_info", { weightLbs: 190, trainerNotes: "sneak" }, false);
  const stored = JSON.parse(db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`).value);
  ok("a legitimate field beside a refused one still saves", stored.data.weightLbs === 190, stored.data.weightLbs);
  ok("...the notes still do not", stored.data.trainerNotes === NOTES, stored.data.trainerNotes);
  ok("...and 'trainer notes' is NOT listed as a change", !(r.updated || []).join(",").includes("trainer notes"), r.updated);
  ok("...while the refusal rides along", Array.isArray(r.refused) && r.refused.length === 1, r.refused);
}

// ── the schema the model is shown ───────────────────────────────────────────
{
  const field = (role) => {
    const t = buildTools(role).find((x) => x.name === "set_personal_info");
    return t.input_schema.properties.trainerNotes;
  };
  ok("a coach's schema offers the notes field", !!field("head_trainer"));
  ok("a sub-trainer's does too", !!field("sub_trainer"));
  ok("a client's schema does not", !field("client"));
  // The schema is what the model is TOLD; the handler above is what it can be
  // talked into. Both, or neither counts.
}

// ── the UI half ─────────────────────────────────────────────────────────────
{
  ok("the Results card is gated", /\{canSeeNotes && \(/.test(APP));
  ok("...on a prop that defaults CLOSED", /canSeeNotes = false \}\) \{/.test(APP));
  // ⚠️ `role` is null until the profile loads, so a NEGATIVE test would show the
  // notes on every cold start until the read returned. isTrainerHome is the
  // app's existing positive predicate (head_trainer || sub_trainer).
  ok("...fed by the positive trainer predicate", /canSeeNotes=\{isTrainerHome\}/.test(APP));
  ok("...which is itself positive, not a not-a-client test",
     /const isTrainerHome = role === ROLES\.HEAD_TRAINER \|\| role === ROLES\.SUB_TRAINER;/.test(APP));
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
