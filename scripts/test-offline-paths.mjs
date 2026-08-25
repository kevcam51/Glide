// The branches that only run when the network is gone (S197x).
//
// These exist to PREVENT DATA LOSS, and until now nothing exercised them —
// they were verified by reading, which is how the bugs they fix got written in
// the first place. Both are extracted from their real source files and driven
// with injected dependencies, so this tests the shipped code rather than a copy.
//
// Run: node scripts/test-offline-paths.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };
const err = (code) => Object.assign(new Error(code), { code });

// ── 1. storage.mergeSet's offline fallback ─────────────────────────────────
{
  const src = readFileSync(join(ROOT, "src/storage.js"), "utf8");
  const start = src.indexOf("  async mergeSet(key, fn) {");
  const end = src.indexOf("\n  },", start);
  const body = src.slice(start, end + 4).replace(/^\s*async mergeSet/, "async function mergeSet");

  const make = ({ txnError, existing }) => {
    const state = { doc: existing === undefined ? null : existing, setCalls: 0, txnCalls: 0 };
    const deps = {
      ready: Promise.resolve(),
      requireUid: () => "u1",
      kvDoc: () => ({ path: "users/u1/kv/k" }),
      db: {},
      runTransaction: async (_db, fn) => {
        state.txnCalls++;
        if (txnError) throw txnError;
        const tx = {
          get: async () => ({ exists: () => state.doc !== null, data: () => ({ value: state.doc }) }),
          set: (_r, v) => { state.doc = v.value; },
        };
        return fn(tx);
      },
      getDoc: async () => ({ exists: () => state.doc !== null, data: () => ({ value: state.doc }) }),
      setDoc: async (_r, v) => { state.setCalls++; state.doc = v.value; },
    };
    const fnBody = new Function(...Object.keys(deps), `${body}; return mergeSet;`)(...Object.values(deps));
    return { mergeSet: fnBody, state };
  };

  // online: the transaction commits and no setDoc fallback happens
  let { mergeSet, state } = make({ existing: '{"a":1}' });
  let res = await mergeSet("k", (cur) => JSON.stringify({ ...JSON.parse(cur || "{}"), b: 2 }));
  ok("online: writes through the transaction", state.doc === '{"a":1,"b":2}', state.doc);
  ok("online: no setDoc fallback", state.setCalls === 0, state.setCalls);
  ok("online: not flagged as queued", !res.offlineQueued);

  // ⚠️ THE POINT: offline must still save, not vanish.
  // A THROW HERE IS THE BUG ITSELF (the fallback missing), so catch it and name
  // it rather than letting the harness die on a stack trace.
  ({ mergeSet, state } = make({ existing: '{"a":1}', txnError: err("unavailable") }));
  res = null;
  try {
    res = await mergeSet("k", (cur) => JSON.stringify({ ...JSON.parse(cur || "{}"), b: 2 }));
  } catch (e) {
    ok(`offline: mergeSet must not throw — the edit would be lost (${e.code})`, false, e.code);
    res = {};
  }
  ok("offline: the edit is still written", state.doc === '{"a":1,"b":2}', state.doc);
  ok("offline: it used the queuing setDoc", state.setCalls === 1, state.setCalls);
  ok("offline: it says so, rather than pretending", res.offlineQueued === true, res);
  ok("offline: the merge still saw the cached value", /"a":1/.test(state.doc));

  // the other offline-shaped codes
  for (const code of ["failed-precondition", "deadline-exceeded"]) {
    ({ mergeSet, state } = make({ existing: null, txnError: err(code) }));
    try { await mergeSet("k", () => '{"x":1}'); } catch { /* reported by the assertion below */ }
    ok(`offline: "${code}" also falls back`, state.doc === '{"x":1}', { code, doc: state.doc });
  }

  // A REAL error must NOT be silently downgraded to a blind overwrite.
  ({ mergeSet, state } = make({ existing: '{"a":1}', txnError: err("permission-denied") }));
  let threw = null;
  try { await mergeSet("k", () => '{"evil":1}'); } catch (e) { threw = e.code; }
  ok("permission-denied is rethrown, not written around", threw === "permission-denied", threw);
  ok("and nothing was written", state.doc === '{"a":1}', state.doc);

  // returning null writes nothing, offline or on
  ({ mergeSet, state } = make({ existing: '{"a":1}', txnError: err("unavailable") }));
  try { res = await mergeSet("k", () => null); } catch { res = {}; }
  ok("offline: a null mutation writes nothing", state.setCalls === 0 && state.doc === '{"a":1}', state);
}

// ── 2. signOutAndClearCache: flush before clearing ─────────────────────────
{
  const src = readFileSync(join(ROOT, "src/firebase.js"), "utf8");
  const start = src.indexOf("export async function signOutAndClearCache()");
  const body = src.slice(start, src.indexOf("\n}\n", start) + 3).replace("export async function", "async function");

  const make = ({ pendingForever }) => {
    const state = { signedOut: false, terminated: false, cleared: false, replaced: null, warned: [] };
    const deps = {
      signOut: async () => { state.signedOut = true; },
      auth: {},
      db: {},
      terminate: async () => { state.terminated = true; },
      clearIndexedDbPersistence: async () => { state.cleared = true; },
      waitForPendingWrites: () => pendingForever ? new Promise(() => {}) : Promise.resolve(),
      window: { location: { replace: (u) => { state.replaced = u; } } },
      console: { warn: (...a) => state.warned.push(a.join(" ")) },
    };
    const fn = new Function(...Object.keys(deps), `${body}; return signOutAndClearCache;`)(...Object.values(deps));
    return { fn, state };
  };

  let { fn, state } = make({ pendingForever: false });
  await fn();
  ok("flushed: signs out", state.signedOut);
  ok("flushed: clears the cache", state.cleared);
  ok("flushed: terminates first", state.terminated);
  ok("flushed: reloads", state.replaced === "/");

  // ⚠️ THE POINT: unsynced work must survive signing out — including the
  // 30-minute idle timeout, which nobody is present for.
  ({ fn, state } = make({ pendingForever: true }));
  const t0 = Date.now();
  await fn();
  ok("unflushed: still signs the person out", state.signedOut);
  ok("unflushed: does NOT clear the cache", state.cleared === false, state);
  ok("unflushed: does not terminate either", state.terminated === false);
  ok("unflushed: still lands them somewhere usable", state.replaced === "/");
  ok("unflushed: says why", state.warned.some((w) => /unsynced/i.test(w)), state.warned);
  ok("unflushed: waits, but not forever", Date.now() - t0 < 8000, Date.now() - t0);
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
