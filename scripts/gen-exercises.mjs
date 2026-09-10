// Regenerate functions/exercises.js from the frontend catalogue (S218).
//
// ⚠️ THIS SCRIPT DID NOT EXIST UNTIL S218, AND THE FILE IT WRITES SAID
// "Generated, not hand-authored" THE WHOLE TIME. So the only thing keeping the
// server's copy in step with src/App.jsx was somebody remembering to redo an
// ad-hoc extraction — which is precisely how a mirror drifts, and the AI then
// quotes burns the app disagrees with (the S215 add_custom_exercise bug, and the
// S86 target mismatch, were both this shape).
//
// Run it after ANY change to CARDIO_GROUPS or STRENGTH_EXERCISES:
//   npm run gen:exercises
// scripts/test-exercise-mirror.mjs fails if the checked-in file is stale, so a
// forgotten run is caught by the suite rather than by a client.
import { readFileSync, writeFileSync } from "node:fs";

// Exported so scripts/test-exercise-mirror.mjs compares against THIS derivation
// rather than a second copy of it — two extractors would drift the same way the
// mirror already did.
export function buildSource() {

  const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

  // Slice a top-level `const NAME = [ … ];` by bracket balance. Not a regex to the
  // next "];" — several entries contain "]" inside a label, and the S211/S216 trap
  // in this repo is exactly a lift that stops at the first delimiter it sees.
  function liftArray(name) {
    const start = APP.indexOf(`const ${name} = [`);
    if (start < 0) throw new Error(`${name} not found in src/App.jsx`);
    const open = APP.indexOf("[", start);
    let depth = 0, inStr = null, prev = "";
    for (let i = open; i < APP.length; i++) {
      const c = APP[i];
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
      } else if (c === '"' || c === "'" || c === "`") inStr = c;
      else if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) return APP.slice(open, i + 1); }
      prev = c;
    }
    throw new Error(`unbalanced ${name}`);
  }

  const CARDIO_GROUPS = eval(liftArray("CARDIO_GROUPS"));
  const STRENGTH_EXERCISES = eval(liftArray("STRENGTH_EXERCISES"));
  const ALL_CARDIO = CARDIO_GROUPS.flatMap((g) => g.options);

  // The mirror carries id + label (+ movement category for strength) — enough for
  // the AI to name real exercises — and a separate id → MET map for the burn maths.
  const CARDIO = ALL_CARDIO.map((e) => ({ id: e.id, label: e.label }));
  const STRENGTH = STRENGTH_EXERCISES.map((e) => ({ id: e.id, label: e.label, cat: e.cat }));

  const MET = {};
  for (const e of ALL_CARDIO) MET[e.id] = e.met;
  for (const e of STRENGTH_EXERCISES) MET[e.id] = e.met;
  // The two rest entries are real ids the schedule can hold, and both burn zero.
  MET.rest = 0;
  MET.rest_st = 0;
  if (!CARDIO.some((e) => e.id === "rest")) CARDIO.push({ id: "rest", label: "Rest Day" });

  const out = `// Glide — compact exercise library for the AI plan builder (Session 69).
//
// MIRROR of src/App.jsx CARDIO_GROUPS (ALL_CARDIO) + STRENGTH_EXERCISES — id +
// label (+ movement category for strength). Used so the AI proposes/writes
// workout programs with REAL exercise ids (so they display + compute burn
// correctly in the app).
//
// ⚠️ GENERATED — DO NOT HAND-EDIT. Run \`npm run gen:exercises\` after any change
// to the frontend catalogue; scripts/test-exercise-mirror.mjs fails if this file
// is stale.

const CARDIO = ${JSON.stringify(CARDIO)};

const STRENGTH = ${JSON.stringify(STRENGTH)};

const CARDIO_IDS = new Set(CARDIO.map((e) => e.id));
const STRENGTH_IDS = new Set(STRENGTH.map((e) => e.id));

// id → MET value (mirrors the frontend catalog exactly). Used by
// nutritionTargets to include scheduled-exercise burn in the calorie target the
// AI reports, matching App.jsx computeClientCalories. Custom exercises aren't
// here — they carry their own met/calPerMin on the plan itself.
const MET = ${JSON.stringify(MET)};

module.exports = { CARDIO, STRENGTH, CARDIO_IDS, STRENGTH_IDS, MET };
`;

  return { out, counts: { cardio: CARDIO.length, strength: STRENGTH.length, met: Object.keys(MET).length } };
}

// CLI: `npm run gen:exercises`
if (process.argv[1] && process.argv[1].endsWith("gen-exercises.mjs")) {
  const { out, counts } = buildSource();
  writeFileSync(new URL("../functions/exercises.js", import.meta.url), out);
  console.log(`functions/exercises.js regenerated — ${counts.cardio} cardio, ${counts.strength} strength, ${counts.met} MET values`);
}
