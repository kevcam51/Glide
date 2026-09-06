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

// ── 4. the plan write-ahead journal (S200f) ────────────────────────────────
// WHY IT EXISTS, and why nothing cheaper works — all three measured in a real
// browser against a reload 30ms later:
//   • the plan write is debounced 600ms, so closing the app on top of an edit
//     simply loses it (tap an activity level, reload immediately: nothing
//     stored; the same tap plus 2.5s: stored);
//   • runTransaction commits only against the backend, so an in-flight merge
//     dies with the process — the offline queue cannot hold it;
//   • a plain setDoc IS queued in IndexedDB and survives a kill, but only if
//     the SDK gets to write it: issued 30ms early it survived, issued from the
//     pagehide handler it did not, and issued behind one awaited IndexedDB read
//     it did not.
// localStorage is synchronous, which is the whole reason it is the fallback.
{
  const src = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const grab = (re, what) => { const m = src.match(re); if (!m) throw new Error("missing " + what); return m[0]; };
  const body = [
    grab(/const PLAN_JOURNAL = "[^"]+";/, "PLAN_JOURNAL"),
    grab(/const PLAN_JOURNAL_MAX_AGE_MS = [^;]+;/, "max age"),
    grab(/function stashPendingPlan\([\s\S]*?\n\}/, "stashPendingPlan"),
    grab(/function clearPendingPlan\([\s\S]*?\n\}/, "clearPendingPlan"),
    grab(/function takePendingPlan\([\s\S]*?\n\}/, "takePendingPlan"),
  ].join("\n");

  const mkStore = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k), _size: () => m.size };
  };
  const load = (localStorage) => new Function("localStorage",
    `${body}; return { stashPendingPlan, clearPendingPlan, takePendingPlan, KEY: PLAN_JOURNAL, MAX: PLAN_JOURNAL_MAX_AGE_MS };`)(localStorage);

  let ls = mkStore();
  let J = load(ls);
  ok("journal: nothing parked → nothing to replay", J.takePendingPlan("u1", "caliq-self") === null);

  J.stashPendingPlan({ uid: "u1", key: "caliq-self", remote: false, wrap: '{"data":{"activityLevel":"moderate"},"step":5}' });
  ok("journal: the parked bytes come back", J.takePendingPlan("u1", "caliq-self") === '{"data":{"activityLevel":"moderate"},"step":5}');
  ok("journal: and are consumed, not replayed twice", J.takePendingPlan("u1", "caliq-self") === null);

  // ⚠️ THE TWO CHECKS THAT KEEP THIS FROM BEING A DATA-LEAK. A journal written
  // by one account, or for one plan, must never be replayed into another.
  ls = mkStore(); J = load(ls);
  J.stashPendingPlan({ uid: "u1", key: "caliq-self", wrap: "{}" });
  ok("journal: never replays into another account", J.takePendingPlan("u2", "caliq-self") === null);
  ok("journal: never replays onto another plan", J.takePendingPlan("u1", "caliq-c123") === null);
  ok("journal: a refused read leaves it parked for its rightful owner",
     J.takePendingPlan("u1", "caliq-self") === "{}");

  // Stale entries are dropped rather than guessed at: replaying a week-old edit
  // over a plan somebody has since changed is a worse bug than the one this fixes.
  ls = mkStore(); J = load(ls);
  ls.setItem(J.KEY, JSON.stringify({ uid: "u1", key: "caliq-self", wrap: "{}", at: Date.now() - (J.MAX + 60000) }));
  ok("journal: a stale entry is refused", J.takePendingPlan("u1", "caliq-self") === null);
  ok("journal: ...and cleared, not left to rot", ls.getItem(J.KEY) === null);

  ls = mkStore(); J = load(ls);
  ls.setItem(J.KEY, "not json at all");
  ok("journal: garbage is refused", J.takePendingPlan("u1", "caliq-self") === null);
  ok("journal: ...and cleared", ls.getItem(J.KEY) === null);

  ls = mkStore(); J = load(ls);
  ls.setItem(J.KEY, JSON.stringify({ uid: "u1", key: "caliq-self", wrap: { not: "a string" }, at: Date.now() }));
  ok("journal: a non-string payload is refused", J.takePendingPlan("u1", "caliq-self") === null);

  // A confirmed save must be able to retire it, or a journal written during a
  // background could later overwrite newer work.
  ls = mkStore(); J = load(ls);
  J.stashPendingPlan({ uid: "u1", key: "caliq-self", wrap: "{}" });
  J.clearPendingPlan();
  ok("journal: a confirmed save can retire it", J.takePendingPlan("u1", "caliq-self") === null);

  // Private mode / quota: parking must never throw into the pagehide handler.
  const hostile = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("denied"); } };
  const H = load(hostile);
  let threw = null;
  try { H.stashPendingPlan({ uid: "u1", key: "k", wrap: "{}" }); H.takePendingPlan("u1", "k"); H.clearPendingPlan(); }
  catch (e) { threw = String(e && e.message); }
  ok("journal: a storage-denied browser degrades quietly", threw === null, threw);

  // The app must actually park before it tries the network write, and must
  // consume the journal at the read rather than in a background effect.
  ok("app: the flush parks BEFORE attempting the write",
     src.indexOf("stashPendingPlan({ uid: job.remote || meUid") < src.indexOf("if (job.remote) setForUser(job.remote, key, out)"));
  ok("app: both load paths replay it",
     (src.match(/takePendingPlan\(/g) || []).length >= 3);
  ok("app: a confirmed save clears it",
     (src.match(/pendingSave\.current = null; clearPendingPlan\(\);/g) || []).length === 2);
  // ⚠️ THE BUG THE FIRST VERSION OF THIS FIX SHIPPED WITH. Clearing the pending
  // job when the DEBOUNCE fires looks equivalent to clearing it when the write
  // lands, and is not: the transaction needs a round trip, so an app closed
  // while it was in flight left the flush with nothing to rescue. Measured
  // failing before this line existed. So the only bare clear allowed is the
  // flush's own; every other one must be paired with retiring the journal.
  {
    const clears = src.match(/pendingSave\.current = null;?/g) || [];
    const paired = src.match(/pendingSave\.current = null; clearPendingPlan\(\);/g) || [];
    ok("app: the pending job survives the debounce firing, so a flush can still rescue it",
       clears.length - paired.length === 1, { clears: clears.length, paired: paired.length });
  }
  ok("app: the flush is wired to both lifecycle events",
     /window\.addEventListener\("pagehide", flushPlanSave\)/.test(src)
     && /document\.addEventListener\("visibilitychange", onHide\)/.test(src));
  // ⚠️ "NO SERVER COPY" HAS TWO MEANINGS AND THE FLUSH MUST NOT CONFLATE THEM
  // (S200i — a regression introduced by S200f, caught before it shipped far).
  // A brand-new plan has nothing on the server, so writing the whole in-memory
  // document is right. A plan whose READ FAILED also has nothing in
  // serverWrapRef — but its document is on the server, intact, and the screen is
  // showing EMPTY_DATA because selectProfile falls back to a blank on any error.
  // Flushing that blank whole would replace a real plan with an empty one.
  ok("app: a failed plan read is recorded",
     /catch\(e\) \{ merged = \{\.\.\.EMPTY_DATA\}; stp = 0; planLoadFailedRef\.current = true; \}/.test(src)
     && /lastSnapshotRef\.current = \{\.\.\.EMPTY_DATA\}; planLoadFailedRef\.current = true; \}/.test(src));
  ok("app: a SUCCESSFUL read clears it, or one failure mutes saving forever",
     (src.match(/planLoadFailedRef\.current = false;/g) || []).length === 3);
  ok("app: the flush refuses on a plan that never loaded",
     /if \(planLoadFailedRef\.current\) \{ console\.warn[\s\S]{0,80}return; \}/.test(src));
  ok("app: ...and refuses BEFORE it builds a document to write",
     src.indexOf("if (planLoadFailedRef.current) { console.warn") < src.indexOf("const out = JSON.stringify(server"));
  ok("app: a brand-new plan is still allowed the whole-document write",
     /serverWrapRef\.current = null;   \/\/ nothing written yet[\s\S]{0,120}planLoadFailedRef\.current = false;/.test(src));

  ok("app: a failed plan save is no longer swallowed",
     /console\.error\("plan autoSave failed"/.test(src) && !/\} catch\(e\) \{\}\s*\n\s*finally \{ if \(saveTimer/.test(src));
}

// ── 5. ClientHome must MERGE, not replace (S200j) ──────────────────────────
// The client's home-screen weigh-in, mark-workout and delete-weigh-in each
// deep-copied an in-memory wrapper and wrote the WHOLE plan document back — so
// anything written since that screen loaded (an AI edit, the coach's change,
// the Trainerize burn sync's check-in) was erased by a tap on the home screen.
// The in-memory copy was for CONSISTENCY between rapid logs, not authority over
// the server. savePlanDataMutation already existed twenty lines below them.
{
  const src = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const home = src.slice(src.indexOf("function ClientHome({ onOpenPlan,"),
                         src.indexOf("\nfunction ", src.indexOf("function ClientHome({ onOpenPlan,") + 10));

  ok("no whole-plan-document write survives in ClientHome",
     !/window\.storage\.set\(planDataKey\(activePlanId\)/.test(home),
     (home.match(/window\.storage\.set\(planDataKey\(activePlanId\)/g) || []).length);
  ok("the three handlers go through the merging helper",
     (home.match(/await savePlanDataMutation\(\(d\) => \{/g) || []).length >= 3,
     (home.match(/await savePlanDataMutation\(\(d\) => \{/g) || []).length);

  // ⚠️ AND THE HELPER HAS TO REPORT. logWeight shows SAVE_FAILED_MSG on a
  // failure, and that exists because the app used to say "Logged" for a save
  // that never happened (S197). A helper that swallows and returns undefined
  // would make every weigh-in look successful again.
  ok("savePlanDataMutation reports success", /return true;\s*\n\s*\} catch \(e\) \{ console\.error\("plan mutation failed"[\s\S]{0,80}return false; \}/.test(home));
  ok("...and the weigh-in still refuses to claim success on a failed write",
     /const planSaved = await savePlanDataMutation\(/.test(home)
     && /if \(!planSaved\) \{ setWtMsg\(SAVE_FAILED_MSG\); return false; \}/.test(home));
  ok("...and marking a workout does too", /if \(!ok\) return false;/.test(home));
  ok("...and deleting a weigh-in does not log history for a write that failed",
     /if \(!ok\) return;\s*\n\s*await appendHistory\(`deleted a weigh-in/.test(home));

// ── 6. the client's "open my plan" must open THEIR plan (S200j) ────────────
// ClientHome resolves the active plan from the caliq-plans manifest and every
// one of its own screens honours it — but App handed it `() => selectProfile("self")`,
// so a client on a cut phase tapped "Open my full plan" and landed on their old
// Main plan. profileKey and planDataKey are the same `caliq-{id}` shape, so the
// id ClientHome already holds is exactly what selectProfile wants.
  ok("App opens the plan it is handed, not a hardcoded default",
     /<ClientHome onOpenPlan=\{\(pid\) => selectProfile\(pid \|\| "self"\)\}/.test(src));
  ok("...and the old hardcode is gone", !/onOpenPlan=\{\(\) => selectProfile\("self"\)\}/.test(src));
  ok("ClientHome routes every open through one place that knows the plan",
     /const openActivePlan = \(\) => onOpenPlan\(activePlanId\);/.test(home));
  // A new button wired to the raw prop would silently reintroduce the bug. A
  // bare occurrence count would break on a comment edit, so this checks for the
  // things that actually carry the defect: a call, or a handler binding, that
  // is not the wrapper itself.
  {
    const code = home.split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))                    // drop comments
      .filter((l) => !/const openActivePlan = \(\) => onOpenPlan\(activePlanId\);/.test(l))
      .join("\n");
    const calls = code.match(/onOpenPlan\(/g) || [];
    ok("no ClientHome path calls the raw prop", calls.length === 0, calls.length);
    ok("no ClientHome control is bound straight to it",
       !/onClick=\{onOpenPlan\}/.test(code) && !/onClick: onOpenPlan\b/.test(code));
  }
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
