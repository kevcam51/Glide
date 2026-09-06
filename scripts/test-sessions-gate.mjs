// The Sessions panel has three doors, and they have to agree (S200e).
//
// THE BUG. `loadTrainerInfo` can fail — that is the whole reason S200 added an
// error card with a Try again inside the panel. But the BUTTON that opens the
// panel was gated on `trainerInfo` alone, so on exactly the failure the card
// exists for, the button disappeared. The card was reachable only by three
// side doors (a declined-payment banner, an existing session, a notification);
// a client with none of those silently lost booking, their saved card and
// their cancellation terms, with no error and nothing to tap.
//
// It sat above a comment that read "Always reachable (S101 bug-check)". Reading
// the code did not find it. Forcing the profile read to fail in a real browser
// did — which is why the invariant now lives in a function this file can RUN,
// instead of in three JSX conditions that can drift apart again.
//
// THE INVARIANT, both directions:
//   • no state shows a button whose tap renders nothing (a dead control), and
//   • no state can render a body that no button can reach (a dead panel).
//
// Run: node scripts/test-sessions-gate.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Lift the shipping predicate out of App.jsx and execute it. Matching a regex
// against the source would pass against a function that is never called, which
// is the failure mode this whole file exists to prevent.
const src = APP.match(/function sessionsPanelState\([\s\S]*?\n\}/);
if (!src) { console.log("  FAIL: sessionsPanelState not found in App.jsx"); process.exit(1); }
const sessionsPanelState = new Function(`${src[0]}; return sessionsPanelState;`)();

const TRAINER = { uid: "t1", name: "Coach" };

// ---- the four states a client can actually be in -------------------------
const loaded  = sessionsPanelState(TRAINER, false);
const failed  = sessionsPanelState(null, true);
const loading = sessionsPanelState(null, false);
const both    = sessionsPanelState(TRAINER, true);   // a retry that succeeded

ok("loaded: panel opens", loaded.body === "panel", loaded);
ok("loaded: button shows", loaded.buttonVisible === true, loaded);

// The regression, stated as itself.
ok("FAILED READ: button still shows", failed.buttonVisible === true, failed);
ok("FAILED READ: shows the error card", failed.body === "error", failed);

// Still loading is not an error — nothing to open and nothing to apologise for.
ok("loading: no button", loading.buttonVisible === false, loading);
ok("loading: no body", loading.body === null, loading);

// A stale failure flag must never hide a panel that now works.
ok("recovered: real panel wins over the stale flag", both.body === "panel", both);
ok("recovered: button shows", both.buttonVisible === true, both);

// ---- the invariant, over every combination -------------------------------
for (const t of [TRAINER, null]) {
  for (const f of [true, false]) {
    const s = sessionsPanelState(t, f);
    ok(`no dead control (${!!t},${f})`, !(s.buttonVisible && s.body === null), s);
    ok(`no dead panel (${!!t},${f})`, !(s.body !== null && !s.buttonVisible), s);
    ok(`body is one of panel|error|null (${!!t},${f})`,
      s.body === "panel" || s.body === "error" || s.body === null, s);
  }
}

// ---- the gates in App.jsx actually call it -------------------------------
// The predicate is worthless if the JSX still hardcodes its own conditions.
const calls = (APP.match(/(?<!function )sessionsPanelState\(trainerInfo, profileLoadFailed\)/g) || []).length;
ok("all three JSX gates route through the predicate", calls === 3, calls);
ok("the old button gate is gone", !APP.includes("{(trainerInfo || profileLoadFailed) && ("));

// ---- negative controls: can this harness see the bug it guards? ----------
// Reintroduce the exact shipped defect and the exact inverse, and demand red.
const buggy = (ti) => ({ buttonVisible: !!ti, body: ti ? "panel" : null });
ok("NEG: the S200e bug would fail 'button still shows'", buggy(null).buttonVisible !== true);
ok("NEG: the S200e bug would fail 'shows the error card'", buggy(null).body !== "error");
const orphan = (ti, f) => ({ buttonVisible: !!ti, body: ti ? "panel" : (f ? "error" : null) });
const o = orphan(null, true);
ok("NEG: an unreachable card trips 'no dead panel'", o.body !== null || o.buttonVisible);

console.log(fails === 0
  ? `  PASS  sessions gate (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
