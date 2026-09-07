// A measuring day must be visible on the surfaces people browse (S199x).
//
// Kevin's own note in the handoff: "The month/week CALENDAR has no measurement
// indicator, so the body composition work is invisible from the surface people
// browse days on." The day view has shown tape/caliper/scan readings since S92;
// the month grid and the week list showed nothing, so a month of measuring
// looked identical to a month of nothing.
//
// ⚠️ THE PREDICATE IS THE WHOLE POINT, AND IT IS EXECUTED. mergeMeasurements
// creates an entry per date carrying date/timestamp/loggedBy whether or not a
// value came with it — so "an entry exists" is NOT "this person was measured",
// and a dot for an empty shell is a lie on the exact surface this exists to make
// honest. hasMeasurement is module-level so this test can run the shipping copy.
//
// Run: node scripts/test-measure-dots.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const fields = /const MEASURED_ANY_FIELD = \[[\s\S]*?\];/.exec(APP);
const fn = /function hasMeasurement\(entry\) \{[\s\S]*?\n\}/.exec(APP);
ok("hasMeasurement is liftable", !!fields && !!fn);
const hasMeasurement = new Function(`${fields[0]}\n${fn[0]}\nreturn hasMeasurement;`)();

const book = { date: "2026-09-01", timestamp: 1, loggedBy: "client" };

// ── the lie this prevents ───────────────────────────────────────────────────
ok("bookkeeping alone is NOT a measurement", !hasMeasurement(book), book);
ok("nothing at all is not a measurement", !hasMeasurement(null) && !hasMeasurement(undefined));
ok("an empty object is not a measurement", !hasMeasurement({}));

// ── every way of actually being measured ────────────────────────────────────
ok("a tape reading counts", hasMeasurement({ ...book, waist: 34 }));
ok("...any site, not just waist", hasMeasurement({ ...book, calf: 15 }));
ok("a caliper reading counts", hasMeasurement({ ...book, calAbdomen: 18 }));
ok("...the female sites too", hasMeasurement({ ...book, calSuprailiac: 12 }));
// ⚠️ bodyFatManual, NOT scanBf (S200y). This assertion was GREEN against a bug:
// MEASURED_ANY_FIELD listed "scanBf", a key no save path has ever written, so
// the test proved the list contained a field and nothing more — a day whose only
// entry was a scale reading did not count as measured anywhere. The check below
// is the one that would have caught it.
ok("a scale body-fat reading counts", hasMeasurement({ ...book, bodyFatManual: 21.4 }));
ok("...and the key nothing writes does NOT", !hasMeasurement({ ...book, scanBf: 21.4 }));
// Every name in the list must be a field some save path actually writes, or it
// is decoration that silently narrows what counts as a measurement.
{
  const list = (APP.match(/const MEASURED_ANY_FIELD = \[[\s\S]*?\];/) || [""])[0]
    .replace(/\/\/[^\n]*/g, "");
  const names = [...list.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  const written = new Set([
    ...[...(APP.match(/const MEASUREMENT_FIELDS = \[[\s\S]*?\];/) || [""])[0].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]),
    ...[...(APP.match(/const CALIPER_FIELDS_M = \[[\s\S]*?\];/) || [""])[0].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]),
    ...[...(APP.match(/const CALIPER_FIELDS_F = \[[\s\S]*?\];/) || [""])[0].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]),
    "bodyFatManual",
  ]);
  const orphans = names.filter((n2) => !written.has(n2));
  ok("no measured-field name is one nothing ever writes", orphans.length === 0, orphans);
}

// ── things that are not readings ────────────────────────────────────────────
// Zero is what an emptied field leaves behind, and a negative is nonsense.
ok("a zeroed field is not a reading", !hasMeasurement({ ...book, waist: 0 }));
ok("an empty string is not a reading", !hasMeasurement({ ...book, waist: "" }));
ok("junk is not a reading", !hasMeasurement({ ...book, waist: "abc" }));
ok("a negative is not a reading", !hasMeasurement({ ...book, waist: -3 }));
// Numbers arrive from inputs as strings; those must still count.
ok("a numeric STRING still counts — inputs give strings", hasMeasurement({ ...book, waist: "34.5" }));

// ── wiring: the two surfaces that were blind ────────────────────────────────
ok("the month grid computes it", /measured: measuredDates\.has\(k\)/.test(APP));
ok("...and draws a dot for it", /\{d\.measured && <span style=\{\{ width: 5, height: 5/.test(APP));
ok("...which the legend explains", /> measured<\/span>/.test(APP));
ok("the week list shows it too", /measuredDates\.has\(k\) && \(\(\) => \{/.test(APP));
// ⚠️ A day with ONLY a measurement used to render as "—", i.e. "nothing here",
// which is worse than no indicator: it is a positive claim that the day is empty.
ok("a day with ONLY a measurement no longer renders as an empty dash",
   /scheduledFor\(k\) === 0 && !measuredDates\.has\(k\) && <span>—<\/span>/.test(APP));
// The set is derived through the predicate, not from "an entry exists".
ok("the set is built through hasMeasurement, not from entry existence",
   /if \(e && e\.date && hasMeasurement\(e\)\) set\.add\(e\.date\)/.test(APP));

// ── the plan is drawn, and never counted (S199z) ────────────────────────────
// S199y made planned targets invisible on the chart, which was the safe fix and
// the wrong end state: Plan Ahead exists so you can plot where you intend to be.
// They are now a DASHED tail off the last real reading — visible as a plan,
// excluded from every number. splitWeighIns is module-level because S199y found
// this same rule applied in four places and forgotten in fourteen; one function
// is what stops the fifteenth.
{
  const fn = /function splitWeighIns\(checkIns\) \{[\s\S]*?\n\}/.exec(APP);
  ok("splitWeighIns is liftable", !!fn);
  const split = new Function(`${fn[0]}\nreturn splitWeighIns;`)();
  const t = (d) => new Date(`2026-0${d}-01T12:00:00Z`).getTime();
  const real = (d, w) => ({ date: `d${d}`, timestamp: t(d), weight: w });
  const plan = (d, w) => ({ ...real(d, w), isFuturePlan: true });

  const r = split([real(1, 200), plan(4, 180), real(2, 195), plan(3, 190)]);
  ok("real readings come back in time order", r.real.map((c) => c.weight).join() === "200,195", r.real);
  ok("...with no target among them", r.real.every((c) => !c.isFuturePlan));
  ok("the plan comes back in time order", r.planned.map((c) => c.weight).join() === "190,180", r.planned);

  // ⚠️ ONLY WHAT COMES AFTER THE LAST READING. A future-flagged entry dated in
  // the PAST is not a continuation of the line — threading it through the middle
  // would draw a weight nobody ever stood on.
  const back = split([plan(1, 210), real(3, 195)]);
  ok("a target dated before the last reading is not drawn", back.planned.length === 0, back.planned);
  ok("...and never sneaks into the real series", back.real.length === 1);

  ok("weightless check-ins are ignored on both sides",
     split([{ date: "x", timestamp: t(1), workedOut: true }]).real.length === 0);
  ok("entries with no timestamp are ignored", split([{ weight: 200, isFuturePlan: true }]).planned.length === 0);
  ok("junk does not throw", split(null).real.length === 0 && split([null, 7]).planned.length === 0);

  // The chart must USE it, draw the plan dashed, and count none of it.
  ok("the chart splits through the shared function",
     /const \{ real: sorted, planned \} = splitWeighIns\(checkIns\);/.test(APP));
  ok("the plan is dashed, not solid", /strokeDasharray="5 4"/.test(APP));
  ok("...anchored to the last real reading so it reads as a continuation",
     /\[sorted\[sorted\.length - 1\], \.\.\.planned\]/.test(APP));
  ok("...and the x-axis makes room for it", /const slots = sorted\.length \+ planned\.length;/.test(APP));
  ok("...and the y-axis fits it", /\.\.\.planned\.map\(c => c\.weight\)/.test(APP));
  // The numbers are all derived from `sorted`, which excludes the plan — and the
  // tap-to-edit hit targets are too, so a target cannot be edited as a weigh-in.
  ok("only real readings are tappable", /\{onEditPoint && sorted\.map\(/.test(APP));
  ok("the dashed line says what it is", /— not measured/.test(APP));
}

// ── do the macros add up to the day? (S200c) ───────────────────────────────
// The macro half of the calorie card's 1,200-cal honesty check. A COMPUTED split
// always reconciles — carbs are derived as whatever is left of the target — but
// a hand-typed one is three independent numbers and nothing compared their sum
// to the goal. Both numbers then sit on the same screen calling themselves the
// plan, and whoever eats to the macros is not eating to the target.
{
  const fn = /function macroCalorieGap\(protein, carbs, fat, target\) \{[\s\S]*?\n\}/.exec(APP);
  const per = /const CAL_PER_G = [^\n]*\n/.exec(APP);
  ok("macroCalorieGap is liftable", !!fn && !!per);
  const gap = new Function(`${per[0]}${fn[0]}\nreturn macroCalorieGap;`)();

  // The headline case: 200/200/100 is 2,500 against a 1,900 target.
  const bad = gap(200, 200, 100, 1900);
  ok("a split that overshoots is flagged", bad.off === true, bad);
  ok("...with the real total", bad.cals === 2500, bad.cals);
  ok("...and the real gap", bad.gap === 600, bad.gap);

  const under = gap(100, 100, 40, 1900);
  ok("a split that undershoots is flagged too", under.off === true && under.gap < 0, under);

  // A computed split reconciles by construction: protein and fat chosen, carbs
  // taking the remainder. It must never be nagged.
  const t = 2000, prot = 180, fat = Math.round((t * 0.28) / 9);
  const carbs = Math.max(0, Math.round((t - prot * 4 - fat * 9) / 4));
  ok("the app's own computed split is never flagged", gap(prot, carbs, fat, t).off === false,
     gap(prot, carbs, fat, t));

  // ⚠️ ROUNDING IS NOT DISAGREEMENT. Grams are whole numbers, so a few calories
  // of drift is arithmetic — nagging about it would train people to ignore the
  // warning that matters.
  // 150p/200c/66f = 1,994 against 2,000 — six calories, which is what rounding
  // whole grams costs and is not a disagreement about anything.
  ok("a few calories of rounding drift is tolerated", gap(150, 200, 66, 2000).off === false,
     gap(150, 200, 66, 2000));
  ok("the tolerance scales with the target, with a floor",
     gap(0, 0, 0, 1000).tolerance === 40 && gap(0, 0, 0, 4000).tolerance === 80,
     [gap(0, 0, 0, 1000).tolerance, gap(0, 0, 0, 4000).tolerance]);
  // ⚠️ THE BOUNDARY, BOTH SIDES. Without the second of these the band is
  // decorative: a check that never fires and a check that always fires look the
  // same from a test that only asserts one side.
  ok("an exact match is silent", gap(250, 0, 0, 1000).off === false, gap(250, 0, 0, 1000));
  ok("...and so is a gap exactly AT the tolerance", gap(260, 0, 0, 1000).off === false,
     gap(260, 0, 0, 1000));
  ok("but one calorie past it fires", gap(261, 0, 0, 1000).off === true, gap(261, 0, 0, 1000));

  // No target means no claim to make — an incomplete plan must not be scolded.
  ok("with no calorie target it says nothing", gap(200, 200, 100, 0).off === false);
  ok("junk does not throw", gap(null, undefined, "x", 2000).cals === 0);

  // Wiring: shown for the PREVIEW too, so it warns before adoption, not after.
  ok("the card checks the split currently on screen",
     /const shown = previewMacros \? previewMacros\.t : \{ protein: proteinTarget/.test(APP));
  ok("...and says what it comes to versus the target",
     /These macros don&rsquo;t add up to your day/.test(APP));
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
