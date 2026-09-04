// Parity between the CLIENT's calorie target and the SERVER's (S199).
//
// The app computes "what should I eat today" in src/App.jsx and the server
// recomputes it independently in functions/aitools.js, because the AI, the
// coach dashboards and the MCP connector all have to answer the same question
// without a browser. That mirror is deliberate — and it has drifted twice, both
// times silently, both times found by reading rather than by failing:
//
//   • RATE_OPTS gained the surplus rates in S198x on the client and not on the
//     server, so a gaining plan (weeklyRate -1) failed the membership test and
//     fell back to 1 lb/week of LOSS. The AI quoted a target 1,000 calories
//     below every screen, for precisely the clients whose plan is to eat more.
//   • nutritionTargets never read data.calorieTarget at all, so a coach's own
//     typed number — which beats the calculation everywhere in the app — was
//     invisible to the AI, the connector and coach_summary.
//
// Neither had a test. This is that test. It reads the client's constants out of
// the source text (there is no way to import from a 31k-line JSX bundle) and
// drives the server's real exported function.
//
// Run: node scripts/test-target-parity.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AITOOLS = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");
const { nutritionTargets } = require(join(ROOT, "functions", "aitools.js"));

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const parseRates = (src, label) => {
  const m = /const RATE_OPTS = \[([^\]]*)\]/.exec(src);
  if (!m) { ok(`${label} declares RATE_OPTS`, false); return null; }
  return m[1].split(",").map((v) => Number(v.trim())).sort((a, b) => a - b);
};

// ── the drift that shipped ──────────────────────────────────────────────────
{
  const client = parseRates(APP, "client");
  const server = parseRates(AITOOLS, "server");
  ok("client and server offer the SAME weekly rates",
     JSON.stringify(client) === JSON.stringify(server), { client, server });
  ok("...and that includes the surplus rates", client && client.includes(-1) && client.includes(-2), client);
}

// A complete, ordinary plan. 200 lb male, 5'10", 35, moderately active.
const base = {
  weightLbs: 200, gender: "male", heightFt: 5, heightIn: 10, age: 35,
  activityLevel: "moderate", deficitMode: "accelerate",
};

// ── a surplus must ADD calories, not subtract them ──────────────────────────
{
  const maintain = nutritionTargets({ ...base, weeklyRate: 0 }).calorieTarget;
  const gain1 = nutritionTargets({ ...base, weeklyRate: -1 }).calorieTarget;
  const lose1 = nutritionTargets({ ...base, weeklyRate: 1 }).calorieTarget;
  ok("maintenance sits between gaining and losing", gain1 > maintain && maintain > lose1,
     { gain1, maintain, lose1 });
  ok("gaining 1 lb/wk is maintenance + 500", gain1 - maintain === 500, { gain1, maintain });
  ok("losing 1 lb/wk is maintenance - 500", maintain - lose1 === 500, { maintain, lose1 });
  // The exact defect: before the fix, weeklyRate -1 fell back to +1 and returned
  // the LOSING number — a 1,000-cal error in the direction that matters most.
  ok("a surplus is not silently converted into a deficit", gain1 !== lose1, { gain1, lose1 });
  const gain2 = nutritionTargets({ ...base, weeklyRate: -2 }).calorieTarget;
  ok("gaining 2 lb/wk is maintenance + 1000", gain2 - maintain === 1000, { gain2, maintain });
}

// ── the manual override wins, exactly as it does on every screen ────────────
{
  const auto = nutritionTargets({ ...base, weeklyRate: 1 }).calorieTarget;
  const manual = nutritionTargets({ ...base, weeklyRate: 1, calorieTarget: 1900 });
  ok("a typed target beats the calculation", manual.calorieTarget === 1900, manual.calorieTarget);
  ok("...and is not merely the formula", auto !== 1900, auto);
  // Macros hang off the target, so they must follow it too — otherwise the AI
  // reports a protein/fat split that adds up to a different day's calories.
  ok("fat is derived from the OVERRIDDEN target",
     manual.fatTarget === Math.round((1900 * 0.28) / 9), manual.fatTarget);
  ok("carbs fill what is left of the OVERRIDDEN target",
     manual.carbsTarget === Math.max(0, Math.round((1900 - manual.proteinTarget * 4 - manual.fatTarget * 9) / 4)),
     manual.carbsTarget);
}
{
  // A typed target stands even on a plan too incomplete to compute one — which
  // is how the dashboard behaves, so the server must agree.
  const bare = nutritionTargets({ calorieTarget: 2100 });
  ok("a typed target survives an incomplete plan", bare.calorieTarget === 2100, bare);
  const nothing = nutritionTargets({});
  ok("...and an empty plan still yields null, not a guess", nothing.calorieTarget === null, nothing);
}
{
  // Zero and junk are NOT a target — the app screens these before trusting them.
  ok("a zero target does not override", nutritionTargets({ ...base, weeklyRate: 1, calorieTarget: 0 }).calorieTarget
     === nutritionTargets({ ...base, weeklyRate: 1 }).calorieTarget);
  ok("a blank target does not override", nutritionTargets({ ...base, weeklyRate: 1, calorieTarget: "" }).calorieTarget
     === nutritionTargets({ ...base, weeklyRate: 1 }).calorieTarget);
}

// ── the 1,200 floor is a shared promise ─────────────────────────────────────
{
  const tiny = nutritionTargets({ ...base, weightLbs: 100, weeklyRate: 2 });
  ok("the server floors at 1,200 like every client screen", tiny.calorieTarget >= 1200, tiny.calorieTarget);
}

// ── a planned goal weight is not a measurement, on either side ──────────────
{
  // Both copies of weightTrend must skip isFuturePlan entries. Checked in the
  // source, because the client's copy cannot be imported.
  ok("client weightTrend filters planned entries",
     /filter\(c => c\.weight && c\.timestamp && !c\.isFuturePlan\)/.test(APP));
  ok("server weightTrend filters planned entries",
     /filter\(\(c\) => c\.weight && c\.timestamp && !c\.isFuturePlan\)/.test(AITOOLS));
  // ...and the plan's CURRENT weight must not be dragged to a future goal.
  ok("syncWeightFromCheckIns refuses a planned entry",
     /if \(checkin\.isFuturePlan\) return next;/.test(APP));
  ok("...and excludes planned entries when picking the newest",
     /\(next\.checkIns \|\| \[\]\)\.filter\(\(c\) => c && c\.weight && !c\.isFuturePlan\)/.test(APP));
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
