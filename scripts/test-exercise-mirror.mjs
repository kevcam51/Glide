// The exercise catalogue, its server mirror, and the burn baseline (S218).
//
// Kevin: "I answered in a simple exercise like an incline walk at a 12% incline
// ... it looked like the calories were extremely low ... I wanna make sure that
// all of our calorie calculations are close to as accurate as possible."
//
// Two independent causes, both pinned here.
//
//   1. THE BASELINE. restingKcalPerMin multiplied a MET by the person's BMR per
//      minute. Compendium METs are DEFINED as multiples of 3.5 mL O2/kg/min, so
//      that mixed two conventions and deflated every burn by 8-29% — worst for
//      the heaviest clients, and it made a burn DROP when a profile was
//      completed. Now the ACSM definition, weight-only.
//
//   2. THE TABLE. The incline-walk METs sat 6-16% under the ACSM graded-walking
//      equation. Recomputed here from the equation rather than pinned as magic
//      numbers, so lowering one means arguing with the physiology.
//
// ⚠️ AND functions/exercises.js SAID "Generated, not hand-authored" WITH NO
// GENERATOR IN THE REPO. It had already drifted (entry order no longer matched
// src/App.jsx). The generator now exists and this suite fails when the
// checked-in file is stale, so a forgotten run cannot reach a client.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSource } from "./gen-exercises.mjs";

const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; console.log(`  FAIL: ${name}`, extra === undefined ? "" : extra); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const AITOOLS = readFileSync(new URL("../functions/aitools.js", import.meta.url), "utf8");
const MIRROR_SRC = readFileSync(new URL("../functions/exercises.js", import.meta.url), "utf8");
const mirror = require("../functions/exercises.js");

// ── The mirror is not stale ──────────────────────────────────────────────────
ok("functions/exercises.js is exactly what the generator produces",
   MIRROR_SRC === buildSource().out,
   "run `npm run gen:exercises` — the checked-in mirror is stale");
ok("...and it still says it is generated", /GENERATED — DO NOT HAND-EDIT/.test(MIRROR_SRC));

// Brace/bracket-balanced lift — never slice to the next delimiter (S211/S216).
function liftFn(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let d = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  return null;
}
function liftArray(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  const open = src.indexOf("[", start);
  let depth = 0, inStr = null, prev = "";
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === inStr && prev !== "\\") inStr = null; }
    else if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "[") depth++;
    else if (c === "]") { depth--; if (!depth) return src.slice(open, i + 1); }
    prev = c;
  }
  return null;
}

const CARDIO_GROUPS = eval(liftArray(APP, "CARDIO_GROUPS"));
const STRENGTH_EXERCISES = eval(liftArray(APP, "STRENGTH_EXERCISES"));
const ALL_CARDIO = CARDIO_GROUPS.flatMap((g) => g.options);

ok("every cardio id in the app has a MET in the mirror",
   ALL_CARDIO.every((e) => mirror.MET[e.id] !== undefined),
   ALL_CARDIO.filter((e) => mirror.MET[e.id] === undefined).map((e) => e.id));
ok("every strength id in the app has a MET in the mirror",
   STRENGTH_EXERCISES.every((e) => mirror.MET[e.id] !== undefined),
   STRENGTH_EXERCISES.filter((e) => mirror.MET[e.id] === undefined).map((e) => e.id));
ok("...and every mirrored MET equals the app's",
   [...ALL_CARDIO, ...STRENGTH_EXERCISES].every((e) => mirror.MET[e.id] === e.met),
   [...ALL_CARDIO, ...STRENGTH_EXERCISES].filter((e) => mirror.MET[e.id] !== e.met).map((e) => e.id));

// ── The two burn baselines are the same code ─────────────────────────────────
// aitools.js says it "MUST match restingKcalPerMin in src/App.jsx". Make that
// claim enforceable rather than aspirational.
{
  const a = liftFn(APP, "restingKcalPerMin");
  const b = liftFn(AITOOLS, "restingKcalPerMin");
  ok("both files define restingKcalPerMin", !!a && !!b);
  // Only the parameter name differs by design (data vs d), so normalise that.
  const norm = (s) => s.replace(/\bdata\b/g, "d").replace(/\s+/g, " ").trim();
  ok("...and the two bodies are the same code", norm(a) === norm(b), { app: norm(a), server: norm(b) });
}

// ── The baseline is the ACSM definition, not a personal BMR ──────────────────
const restingKcalPerMin = eval(`(${liftFn(APP, "restingKcalPerMin")})`);
ok("1 MET is 3.5 mL O2/kg/min converted to kcal (MET x 3.5 x kg / 200)",
   near(restingKcalPerMin({}, 200), (200 * 0.453592) * 3.5 / 200, 1e-9), restingKcalPerMin({}, 200));
// ⚠️ THE WHOLE POINT: identical for everyone at a given weight. It used to fall
// 8-29% depending on sex/age/height, so completing a profile shrank the burn.
{
  const lean = restingKcalPerMin({ gender: "female", age: 50, heightFt: 5, heightIn: 6, weightLbs: 200 }, 200);
  const bare = restingKcalPerMin({}, 200);
  ok("...and a completed profile no longer changes it", near(lean, bare, 1e-9), { lean, bare });
}
ok("no weight still means no burn", restingKcalPerMin({}, 0) === 0);
// Negative control: the old BMR-anchored baseline must be measurably different,
// or the assertion above is not testing anything.
{
  const kg = 200 * 0.453592;
  const oldBmr = (10 * kg + 6.25 * (5 * 12 + 6) * 2.54 - 5 * 50 - 161) / 1440;
  ok("(control) the old BMR baseline really was materially lower",
     oldBmr < restingKcalPerMin({}, 200) * 0.8, { oldBmr, now: restingKcalPerMin({}, 200) });
}

// ── The incline table, recomputed from ACSM ──────────────────────────────────
// VO2 (mL/kg/min) = 0.1*S + 1.8*S*G + 3.5, S in m/min, G fractional grade.
// A treadmill incline walk sits around 3.0-3.2 mph; 3.0 is the conservative end.
const acsmMet = (mph, grade) => (0.1 * (mph * 26.8224) + 1.8 * (mph * 26.8224) * grade + 3.5) / 3.5;
const metOf = (id) => ALL_CARDIO.find((e) => e.id === id).met;
for (const [id, grade] of [["incline_walk_5", 0.05], ["incline_walk_8", 0.08],
                           ["incline_walk_10", 0.10], ["incline_walk_12", 0.12], ["incline_walk_15", 0.15]]) {
  ok(`${id} matches the ACSM equation at 3.0 mph`, near(metOf(id), acsmMet(3.0, grade), 0.06),
     { table: metOf(id), acsm: +acsmMet(3.0, grade).toFixed(2) });
  // and must never sit below the equation again — the bug Kevin reported
  ok(`...and is not below it`, metOf(id) >= acsmMet(3.0, grade) - 0.06, metOf(id));
}
ok("level walking stays at the Compendium value for 2.8-3.2 mph", metOf("walk_flat") === 3.5);
// A graded walk must cost more than the same walk on the flat, monotonically.
{
  const ladder = ["walk_flat", "incline_walk_5", "incline_walk_8", "incline_walk_10", "incline_walk_12", "incline_walk_15"].map(metOf);
  ok("the incline ladder rises monotonically", ladder.every((v, i) => i === 0 || v > ladder[i - 1]), ladder);
}

// ── Running (S218b) ─────────────────────────────────────────────────────────
// ⚠️ KEVIN: "the cardio exercises out of the most important are the ones that are
// a little bit more simple, like walking and running." Walking was derived from
// the ACSM equation in the first pass; RUNNING was not looked at, and was 4-12%
// light. For LEVEL running the Compendium carries measured speed-specific values,
// which beat a prediction equation — so these are the measured numbers, not ACSM.
ok("a 5 mph jog is the Compendium measured value", metOf("treadmill_jog") === 8.3);
ok("...and the outdoor jog agrees with it", metOf("outdoor_jog") === metOf("treadmill_jog"));
ok("a ~6-7 mph run sits between the 6 and 7 mph values", metOf("treadmill_run") === 10.5);
ok("a ~7-8 mph run is the 7.5 mph value", metOf("outdoor_run") === 11.8);
// The whole running ladder has to rise, and every rung must beat the steepest walk.
{
  const run = ["treadmill_jog", "treadmill_run", "outdoor_run", "treadmill_sprint"].map(metOf);
  ok("the running ladder rises", run.every((v, i) => i === 0 || v > run[i - 1]), run);
  // ⚠️ I FIRST ASSERTED A JOG MUST BEAT THE STEEPEST WALK. IT MUST NOT, AND THE
  // SUITE CAUGHT ME. Walking a 15% grade (9.5) is harder than jogging level at
  // 5 mph (8.3) — the ACSM equations say so and anyone who has done both knows
  // it. Pinning the TRUE relation instead, so nobody "fixes" it back.
  ok("a steep incline walk legitimately outranks a level jog",
     metOf("incline_walk_15") > metOf("treadmill_jog"),
     { walk15: metOf("incline_walk_15"), jog: metOf("treadmill_jog") });
}

// ── The other corrected entries ──────────────────────────────────────────────
ok("water aerobics is the Compendium value", metOf("water_aerobics") === 5.3);
ok("cycling moderate is the 150W value", metOf("cycling_mod") === 7.0);
ok("cycling vigorous is the 200W value", metOf("cycling_vig") === 10.5);
ok("in-line skating is the Compendium leisurely value", metOf("rollerblading") === 7.5);
// ⚠️ kickboxing AND martial_arts READ THE SAME COMPENDIUM ENTRY (moderate-pace striking arts), so any gap between them is arbitrary. They were
// 8.0 and 10.0; both are now the published 10.3.
ok("kickboxing is the Compendium value", metOf("kickboxing") === 10.3);
ok("...and general martial arts, its own source entry, matches it", metOf("martial_arts") === 10.3);
// The striking family has to make sense as a ladder: shadow boxing is genuinely
// lighter than bag work, and neither approaches competitive ring work.
{
  const ladder = ["shadow_boxing", "boxing_bag", "kickboxing"].map(metOf);
  ok("the striking ladder is non-decreasing", ladder.every((v, i) => i === 0 || v >= ladder[i - 1]), ladder);
}
// ⚠️ HEAVY BAG IS A JUDGEMENT, ANCHORED — NOT A LOOKUP. The Compendium's
// "punching bag" 5.5 is casual intermittent work, not a coached round; "sparring"
// is 7.8 and "in ring" 12.8. A SCHEDULED 30-minute bag session is rounds with
// rest, so it sits just above sparring and nowhere near ring work. It was 9.8,
// which is continuous hard effort for the whole duration.
ok("heavy bag sits between sparring and ring work", metOf("boxing_bag") === 8.0);
ok("...and above shadow boxing, which is genuinely lighter", metOf("boxing_bag") > metOf("shadow_boxing"));
ok("swimming easy is the Compendium freestyle light/moderate value", metOf("swim_easy") === 5.8);
ok("jump rope moderate is the Compendium value", metOf("jump_rope") === 11.8);
ok("dance cardio is the Compendium aerobic-dance value", metOf("dancing") === 7.3);
ok("flag football is the Compendium touch/flag value", metOf("flag_football") === 8.0);
ok("tennis singles is the singles value, not 'tennis, general'", metOf("tennis") === 8.0);
// Both directions: accuracy is not "make the numbers bigger".
ok("wrestling came DOWN to the Compendium value", metOf("wrestling") === 6.0);
ok("trampoline came DOWN to the Compendium value", metOf("trampoline") === 3.5);

// ── Sanity bounds on the whole catalogue ─────────────────────────────────────
// The Compendium tops out around 23 (competitive running); nothing in a gym
// catalogue should approach that, and nothing active should be under 2.
{
  const all = [...ALL_CARDIO, ...STRENGTH_EXERCISES].filter((e) => e.met > 0);
  ok("no MET is implausibly high", all.every((e) => e.met <= 14), all.filter((e) => e.met > 14).map((e) => `${e.id}=${e.met}`));
  ok("no active MET is implausibly low", all.every((e) => e.met >= 2), all.filter((e) => e.met < 2).map((e) => `${e.id}=${e.met}`));
  // Resistance work: the Compendium only has coarse bands (light/moderate 3.5,
  // vigorous 6.0, circuit 8.0). The app's finer per-exercise gradations are a
  // house model, not a published table — so this checks the BAND, not each value.
  const st = STRENGTH_EXERCISES.filter((e) => e.met > 0);
  ok("strength values stay inside the Compendium's resistance-training band",
     st.every((e) => e.met >= 2.5 && e.met <= 9), st.filter((e) => e.met < 2.5 || e.met > 9).map((e) => `${e.id}=${e.met}`));
}

// ── Cross-file burn parity ───────────────────────────────────────────────────
// The number the AI quotes and the number every screen shows must be the same.
{
  const exBurn = eval(`(${liftFn(APP, "exBurn")})`);
  globalThis.restingKcalPerMin = restingKcalPerMin;
  const cases = [["bb_bench", 220, 45], ["incline_walk_12", 200, 30], ["bb_squat", 186, 60]];
  for (const [id, lbs, mins] of cases) {
    const ex = [...ALL_CARDIO, ...STRENGTH_EXERCISES].find((e) => e.id === id);
    const app = exBurn(ex, lbs, mins, {});
    const server = Math.round(mirror.MET[id] * ((lbs * 0.453592) * 3.5 / 200) * mins);
    ok(`${id} burns the same on both sides (${app} cal)`, app === server, { app, server });
  }
  // The entry Kevin measured, stated outright so a regression is unmissable.
  const iw = ALL_CARDIO.find((e) => e.id === "incline_walk_12");
  ok("a 12% incline walk, 30 min, 200 lb is ~395 cal (was 285)",
     near(exBurn(iw, 200, 30, {}), 395, 3), exBurn(iw, 200, 30, {}));
}

console.log(`\n  ${pass}/${pass + fail} checks passed`);
console.log("  Exercise catalogue: one source, one mirror, ACSM numbers.\n");
if (fail) process.exit(1);
