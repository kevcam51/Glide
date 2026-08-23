// Three-way merge for plan writes (S197m).
//
// THE PROBLEM. The app holds a plan in React state and saves the WHOLE document
// from it. The server writes the same document — the AI tools do, and the
// 30-minute Trainerize sync does. So:
//
//   1. the app has the plan in state
//   2. someone types → a 600ms debounce starts
//   3. the AI logs a weigh-in; the live-sync listener SKIPS applying it,
//      because applying a remote change mid-edit would yank the form
//   4. the debounce fires and writes the whole in-memory copy,
//      which never saw the weigh-in — and it is gone
//
// Step 3 is not a bug: dropping the user's half-typed edit would be worse. The
// bug is step 4 writing keys nobody touched. S197f made the SERVER side
// transactional, which stops two server writers losing each other, but a
// browser writing the whole document still lands on top of everything.
//
// THE FIX. Write only what the user actually changed, onto whatever the server
// currently holds. The baseline for "actually changed" already exists — the app
// keeps the last-saved snapshot to diff plan edits for the activity feed.
//
// GRANULARITY IS TOP-LEVEL KEYS, deliberately. If the user edited `goalWeight`
// and the AI appended to `checkIns`, both survive. If both edited `checkIns`,
// the user's version wins that key. Merging INSIDE an array would need element
// identity and would produce results neither side wrote — worse than a rule you
// can state in one sentence.

// Compare by value, not reference: React state updates rebuild objects, so
// reference equality reports changes that never happened.
//
// ⚠️ THE ASYMMETRY HERE IS THE WHOLE SAFETY ARGUMENT. JSON.stringify depends on
// key insertion order, so two equal objects built differently can compare as
// DIFFERENT. That direction is harmless — the key is written, and the user's
// own value wins. The opposite error, reporting a real edit as unchanged, would
// silently DROP what someone typed. A stable stringify would only trade a safe
// failure for a slower one.
function sameValue(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// Top-level keys that differ between the last-saved baseline and what the user
// now has. Includes keys the user DELETED — a removed date of birth is an edit
// like any other, and omitting it would silently resurrect the old value.
export function changedKeys(baseline, next) {
  const base = baseline || {};
  const cur = next || {};
  const keys = new Set([...Object.keys(base), ...Object.keys(cur)]);
  const out = [];
  for (const k of keys) {
    const inBase = Object.prototype.hasOwnProperty.call(base, k);
    const inCur = Object.prototype.hasOwnProperty.call(cur, k);
    if (inBase !== inCur || !sameValue(base[k], cur[k])) out.push(k);
  }
  return out;
}

// Start from what the SERVER holds, apply only the user's changes on top.
//
// With no baseline there is nothing to diff — a brand-new plan, or a first save
// after a load that never completed. Writing the user's whole document is then
// the only honest answer, and it is exactly the old behaviour.
export function mergePlanData(serverData, baseline, nextData) {
  if (!baseline) return { ...(nextData || {}) };
  const merged = { ...(serverData || {}) };
  for (const k of changedKeys(baseline, nextData)) {
    if (Object.prototype.hasOwnProperty.call(nextData || {}, k)) merged[k] = nextData[k];
    else delete merged[k];
  }
  return merged;
}

// The full wrapper to write. `step` is the user's, not merged: it is where this
// person is standing in the wizard right now, and the server has no better
// opinion about that than the browser in front of them.
export function mergePlanWrap(serverWrap, baseline, nextData, nextStep) {
  const server = serverWrap && typeof serverWrap === "object" ? serverWrap : null;
  return {
    ...(server || {}),
    data: mergePlanData(server ? server.data : null, baseline, nextData),
    step: nextStep,
  };
}
