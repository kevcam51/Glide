#!/usr/bin/env node
// Find test assertions that would stay GREEN if a regression broke ONE of
// several identical occurrences of the thing they check.
//
// ⚠️ THIS EXISTS BECAUSE THE SAME MISTAKE WAS MADE FOUR TIMES IN ONE SESSION
// (S206–S209), by me, in code I had just written and believed I was testing:
//
//   ok("a push failure cannot fail the tap", /\.catch\(\(e\) =>/.test(body));
//
// The guard existed on BOTH the departure and the arrival push. Reverting the
// departure one left the suite green, because the arrival one still matched. The
// same shape recurred on the stale-response guard, the owner-lockout fix, and
// the ETA ceiling — where `capped: onMyWayAtCap(...)` inside a RETURN kept the
// assertion green while the ceiling was removed from the `if`.
//
// THE RULE: a guard that exists in TWO places must be COUNTED in two, not merely
// found. Either
//     (src.match(/guard/g) || []).length === 2
// or anchor the search to the ONE block that owns it:
//     const block = src.slice(src.indexOf("start"), src.indexOf("end"));
//
// This is a REPORT, not a gate: plenty of flagged lines are legitimate (a
// user-facing phrase that happens to appear twice is not a guard). It runs
// separately from test:units so it never blocks a build — its job is to make the
// class visible, and to make a NEW instance obvious in review.
//
// Run: node scripts/check-weak-assertions.mjs [--strict]
//   --strict exits non-zero if any line is flagged that is not in ALLOW below.
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };

// The variable names test files conventionally bind their target source to.
const SRC = {
  APP: read("src/App.jsx"),
  AVAIL: read("functions/availability.js"),
  SESSIONS: read("src/sessions.js"),
  PLACES: read("functions/places.js"),
  DRIVE_SRC: read("functions/driveTime.js"),
  RULES: read("firestore.rules"),
  INDEX: read("functions/index.js"),
  AI: read("functions/aitools.js"),
  FIELDS: read("src/App.jsx"),
};

// Lines confirmed by mutation testing to be sound or not-a-guard. Each needs a
// REASON — an allowlist without reasons becomes a place to hide regressions.
const ALLOW = {
  // "file.mjs:LINE": "why this one is fine",
};

const files = readdirSync(join(ROOT, "scripts")).filter((f) => f.startsWith("test-") && f.endsWith(".mjs"));
let flagged = 0, allowed = 0;
for (const f of files) {
  const lines = read(`scripts/${f}`).split("\n");
  const hits = [];
  lines.forEach((ln, i) => {
    const m = ln.match(/\/((?:\\.|[^/\\])+)\/[gimsuy]*\.test\(([A-Z_]+[A-Za-z_]*)\)/);
    if (!m) return;
    // Already counting occurrences, or slicing to a block — the two correct fixes.
    if (/\.length/.test(ln) || /\.match\(/.test(ln) || /\.slice\(/.test(ln)) return;
    const target = SRC[m[2]];
    if (!target) return;
    let re; try { re = new RegExp(m[1], "g"); } catch { return; }
    const n = (target.match(re) || []).length;
    if (n < 2) return;
    const key = `${f}:${i + 1}`;
    if (ALLOW[key]) { allowed++; return; }
    hits.push({ line: i + 1, n, snippet: ln.trim().slice(0, 108) });
  });
  if (hits.length) {
    flagged += hits.length;
    console.log(`\n${f}`);
    for (const h of hits) console.log(`  L${h.line}  matches ${h.n}x  ${h.snippet}`);
  }
}
console.log(`\n${flagged} assertion(s) match a pattern that occurs 2+ times`
  + (allowed ? `, ${allowed} allowlisted` : "")
  + `.\nCount the occurrences, or anchor to the block that owns the guard — see the header of this file.`);
if (process.argv.includes("--strict") && flagged > 0) process.exit(1);
