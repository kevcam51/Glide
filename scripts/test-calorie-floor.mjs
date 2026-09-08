// The 1,200 floor, as a standard rather than a habit (S200u).
//
// KEVIN: "These formulas and responses do not go below the 1200 mark and we
// should make that a standard. Users should come up with their own creative
// ways to work around the 1200 limit."
//
// ⚠️ WHY THIS FILE EXISTS AND THE OLD ONE DID NOT CATCH IT. The floor was
// applied in a dozen places and looked well covered — but the MANUAL target
// override (data.calorieTarget) was applied OUTSIDE it at every single read.
// scripts/test-target-parity.mjs tested the floor (on the computed path, no
// override) and tested the override (with above-floor values), and never
// crossed the two. So a number typed into the dashboard prescribed itself
// unclamped to the ring, the macro split, the calendar, the trainer roster, the
// AI, coach_summary and the MCP connector. Executed against the shipping server
// function, a typed 1 came back as a 1 cal/day prescription.
//
// The rule this file enforces: no path may PRESCRIBE below the floor.
// Displaying what somebody actually ate is a different thing and is fine.
//
// Run: node scripts/test-calorie-floor.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AI = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");
const CHAT = readFileSync(join(ROOT, "functions", "aichat.js"), "utf8");
const MCP = readFileSync(join(ROOT, "functions", "mcp.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const FLOOR = 1200;

// ── the two copies must agree; functions/ cannot import from src/ ──────────
const appConst = (APP.match(/const MIN_DAILY_CAL = (\d+);/) || [])[1];
const aiConst = (AI.match(/const MIN_DAILY_CAL = (\d+);/) || [])[1];
ok("the app names the floor", Number(appConst) === FLOOR, appConst);
ok("the server names it too", Number(aiConst) === FLOOR, aiConst);
ok("...and they are the same number", appConst === aiConst, { appConst, aiConst });

// ── EXECUTED: the server's real nutritionTargets ──────────────────────────
// This is the one every AI surface and the MCP connector read.
const { nutritionTargets } = require(join(ROOT, "functions", "aitools.js"));
const base = { weightLbs: 170, gender: "female", heightFt: 5, heightIn: 5, age: 35, activityLevel: "sedentary" };

// ⚠️ THE CROSS THE OLD SUITE NEVER MADE: an override BELOW the floor.
for (const typed of [1, 100, 300, 900, 1199]) {
  const r = nutritionTargets({ ...base, weeklyRate: 1, calorieTarget: typed });
  ok(`a typed ${typed} is raised to the floor`, r.calorieTarget === FLOOR, r.calorieTarget);
}
ok("a typed target ABOVE the floor is still honoured exactly",
   nutritionTargets({ ...base, weeklyRate: 1, calorieTarget: 2400 }).calorieTarget === 2400);
// The override is deliberately applied even when the plan is too incomplete to
// compute anything — so the floor has to hold there too.
ok("...and an incomplete plan cannot smuggle one past",
   nutritionTargets({ calorieTarget: 500 }).calorieTarget === FLOOR,
   nutritionTargets({ calorieTarget: 500 }).calorieTarget);

// The computed path, at the most aggressive settings a small person can pick.
for (const rate of [0.5, 1, 2]) {
  const r = nutritionTargets({ weightLbs: 95, gender: "female", heightFt: 4, heightIn: 10,
    age: 62, activityLevel: "sedentary", weeklyRate: rate });
  ok(`the computed target holds at ${rate} lb/wk for a very small person`,
     r.calorieTarget >= FLOOR, r.calorieTarget);
}
// Accelerate mode keeps the deficit instead of eating the burn back — the
// combination most likely to drive a small person under.
ok("...and in accelerate mode with a big scheduled burn",
   nutritionTargets({ weightLbs: 95, gender: "female", heightFt: 4, heightIn: 10, age: 62,
     activityLevel: "sedentary", weeklyRate: 2, deficitMode: "accelerate" }).calorieTarget >= FLOOR);

// ── the app's own reads ───────────────────────────────────────────────────
// Every one of these let the override past the floor before S200u.
ok("the app floors through one named helper",
   /const atLeastMinCal = \(n\) => Math\.max\(MIN_DAILY_CAL, Math\.round\(Number\(n\) \|\| 0\)\);/.test(APP));
ok("the only writer of the override floors it",
   /x\.calorieTarget=atLeastMinCal\(n\)/.test(APP));
ok("the dashboard ring reads it floored", /atLeastMinCal\(data\.calorieTarget\)/.test(APP));
ok("computeClientCalories reads it floored", /atLeastMinCal\(d\.calorieTarget\)/.test(APP));
ok("no read takes the override raw any more",
   !/Number\(d\.calorieTarget\) > 0 \? Math\.round\(Number\(d\.calorieTarget\)\)/.test(APP)
   && !/Number\(data\.calorieTarget\) > 0 \? Math\.round\(Number\(data\.calorieTarget\)\)/.test(APP));
// ⚠️ The beginner screen had two branches that skipped the floor helper defined
// for them — maintenance for a very small person can itself land under 1,200.
ok("SimplePlanView floors all three goal modes",
   /goalMode === "build" \? floor\(/.test(APP) && /goalMode === "health" \? floor\(/.test(APP));

// ── a clamp that does not speak is its own bug ────────────────────────────
ok("the second typed-target field warns before you type", /Minimum \{MIN_DAILY_CAL\.toLocaleString\(\)\}/.test(APP));
ok("...and says so after, if it moved your number", /is below \$\{MIN_DAILY_CAL\.toLocaleString\(\)\}/.test(APP));
// ⚠️ TWO SURFACES CARRY THIS, and a bare match let either lose it silently: the
// sheet's own explanation and the clamp toast that fires when a typed number is
// raised to the floor. A person who only ever sees one of them still needs the
// lever named.
ok("...and points at the lever that does work, on BOTH surfaces",
   (APP.match(/take it from movement rather than food/g) || []).length === 2,
   (APP.match(/take it from movement rather than food/g) || []).length);

// ── the model is told, because prose is a prescription too ────────────────
ok("both system prompts state the floor",
   (CHAT.match(/Recommend eating below 1,200 calories a day/g) || []).length === 2);
ok("the MCP connector states it as well — it gets no system prompt",
   /NEVER recommend eating below 1,200 calories a day/.test(MCP));

// ── negative controls: can this file see the bug it guards? ───────────────
const unfloored = (d) => (Number(d.calorieTarget) > 0 ? Math.round(Number(d.calorieTarget)) : 2000);
ok("NEG: the pre-S200u read would have prescribed 900", unfloored({ calorieTarget: 900 }) === 900);
ok("NEG: ...and 1", unfloored({ calorieTarget: 1 }) === 1);

console.log(fails === 0
  ? `  PASS  1,200 calorie floor (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
