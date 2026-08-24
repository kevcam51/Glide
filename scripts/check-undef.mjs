#!/usr/bin/env node
// Fail on any UNDEFINED REFERENCE in src/ or functions/ (S197t).
//
// Two of these were live at once when this was written, and both were the same
// shape: an identifier the code reads that nothing declares. JavaScript does not
// complain until the line actually runs, and both lines ran rarely.
//
//   • src/App.jsx  — DailyDashboard read `logAdherence`, which was never one of
//     its props. Tapping "Progress Snapshot" on any plan with 2+ weigh-ins
//     WHITE-SCREENED THE APP. Shipped in July, found in August.
//   • functions/trainerize.js — applySnapshotAndSyncs returned `d` and `step`
//     from outside the callback they were declared in, so every Trainerize
//     import and every scheduled auto-sync threw. Introduced by S197f's own
//     transactional conversion, four hours before this script existed.
//
// `node --check` cannot see either: both are valid syntax. The unit tests missed
// both: neither path was covered. eslint's no-undef had them the whole time —
// nobody ran it, because a blanket lint reports ~380 pre-existing style errors
// and never goes green. So this checks ONE rule, and that one can stay green.
//
// Run: node scripts/check-undef.mjs
import { ESLint } from "eslint";

const eslint = new ESLint({ errorOnUnmatchedPattern: false });
const results = await eslint.lintFiles(["src/**/*.{js,jsx}", "functions/*.js", "scripts/*.mjs"]);

const undef = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId === "no-undef") {
      undef.push(`${r.filePath.replace(process.cwd() + "/", "")}:${m.line}  ${m.message}`);
    }
  }
}
if (undef.length) {
  console.error(`\n✗ ${undef.length} undefined reference(s) — each one throws when its line runs:\n`);
  for (const u of undef) console.error("  " + u);
  console.error("\nA bare undeclared identifier is a ReferenceError, not a warning.");
  process.exit(1);
}
console.log(`✓ no undefined references (${results.length} files)`);
