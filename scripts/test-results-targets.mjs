// One ladder for every "cal/day" the app prints, and a ladder that adds up (S215).
//
// TWO DEFECT FAMILIES, both found while fixing the viewed-day target bug.
//
// 1. RESULTS PRINTED A TARGET NOBODY WAS ON. Three places rendered
//    `floor(tdee − cut + avgBurnPerDay)`: cardio-only, and blind to
//    `deficitMode`. So on an accelerate plan the rows were HIGH by the cardio
//    average (the burn buys the goal date, not food) and on any lifting plan
//    they were LOW by the strength average. The Summary card printed
//    "1 lb/week 2,082" and, forty lines below itself, "Target calories 1,806".
//    ⚠️ THE "+ CARDIO" TAB WAS NOT AN EXCEPTION, though its label reads like
//    one: on a STRENGTH-ONLY eat-back plan `avgBurnPerDay` is 0, so that grid
//    was byte-identical to the "No Cardio" grid and both understated the real
//    target. A tab whose scope variable is zero cannot claim scope as a defence.
//
// 2. THE DASHBOARD LADDER STOPPED ADDING UP WHEN THE FLOOR BOUND.
//    `targetNoBurn` was pre-floored while `target` was floored once at the end,
//    so a small-frame plan read "1,524 / −1,000 / = 1,200 / +238 / 1,200" —
//    two visible breaks in five rows, for exactly the person the floor protects.
//
// WHAT HAS TO STAY TRUE:
//   • every per-rate number in Results is `planIntakeForRate(data, rate)`;
//   • the DAY-BY-DAY cells deliberately are NOT — they are per-day, and routing
//     them through the flat helper would be the S214 bug pointing the other way;
//   • the "No Cardio" tab keeps its diet-only arithmetic, because that
//     counterfactual is the tab's whole subject;
//   • the ladder's visible rows sum to the number at the bottom, in every
//     combination, and the floor is a ROW rather than a silent clamp.
//
// Everything is LIFTED FROM THE SHIPPING SOURCE AND RUN, then mutated.
//
// Run: node scripts/test-results-targets.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const CODE = APP.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ⚠️ A BRACE-BALANCED LIFTER, NOT A LAZY REGEX. `const isEatback = (d) => …;` is
// a one-liner, so a `[\s\S]*?\n\};` pattern ran on to the NEXT function's
// closing brace — 3,600 characters, including a whole other declaration, which
// is a SyntaxError the moment both are lifted.
// ⚠️ AND A FUNCTION'S PARAMETER LIST MUST BE SKIPPED FIRST. Its parens close at
// depth 0, and `function makeUpPlan({ over, days, … })` even closes a BRACE
// there — counting body braces from the declaration returned the signature and
// nothing else.
function liftDecl(src, name) {
  // Indentation-tolerant: these are sometimes module-level and sometimes
  // declared inside a component body.
  const re = new RegExp("\\n([ \\t]*)(?:function " + name + "\\(|const " + name + "\\s*=)");
  const m = src.match(re);
  if (!m) throw new Error("could not lift " + name);
  const start = m.index + 1 + m[1].length;
  const isFn = src.startsWith("function", start);
  let i = start, depth = 0, opened = false, q = null;
  const skipString = () => { const qq = src[i]; for (i++; i < src.length; i++) { if (src[i] === "\\") { i++; continue; } if (src[i] === qq) return; } };
  if (isFn) {                          // step over the parameter list
    while (i < src.length && src[i] !== "(") i++;
    let pd = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
      if (c === "(") pd++;
      else if (c === ")") { pd--; if (pd === 0) { i++; break; } }
    }
  }
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (isFn) {
      if (c === "{") { depth++; opened = true; }
      else if (c === "}") { depth--; if (opened && depth === 0) return src.slice(start, i + 1); }
    } else {
      if ("([{".indexOf(c) >= 0) depth++;
      else if (")]}".indexOf(c) >= 0) depth--;
      else if (c === ";" && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unterminated " + name);
}

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const CONSTS = ["DAYS", "REST_ST", "STRENGTH_EXERCISES", "CARDIO_GROUPS", "ALL_CARDIO",
  "ACTIVITY_LEVELS", "MIN_DAILY_CAL", "HR_ZONES", "RATE_OPTS", "OVER_TOLERANCE", "PARTIAL_DAY_MIN"];
const FNS = ["calcBMR", "ageFromDob", "effectiveAge", "customOf", "findCardioEx", "hrCaloriesPerMin",
  "restingKcalPerMin", "calcBurn", "cardioExFor", "exBurn", "isEatback", "dailyDeficitOf", "weeklyRateOf",
  "planEnergy", "planIntakeForRate", "computeClientCalories", "wearableTdee"];
const src = [...CONSTS, "atLeastMinCal", ...FNS].map((n) => liftDecl(APP, n)).join("\n");
const M = new Function(`${src}; return { planEnergy, planIntakeForRate, computeClientCalories, isEatback, weeklyRateOf, dailyDeficitOf, exBurn, atLeastMinCal, MIN_DAILY_CAL, wearableTdee, ACTIVITY_LEVELS, calcBMR, effectiveAge, DAYS };`)();

const STRENGTH_ID = [...APP.matchAll(/id:"([a-z_0-9]+)"[^}]*cat:"/g)].map((m) => m[1])[0];
const CARDIO_ID = [...APP.matchAll(/\{ id:"([a-z_0-9]+)",\s+label:"[^"]*",\s+icon:"[^"]*",\s+met:/g)].map((m) => m[1])[0];

const base = (over = {}) => ({ gender: "female", age: 34, heightFt: 5, heightIn: 6, weightLbs: 170,
  activityLevel: "moderate", weeklyRate: 1, ...over });
const withCardio = (days, min = 45) => ({ cardio: Object.fromEntries(days.map((d) => [d, [{ type: CARDIO_ID, duration: min }]])) });
const withStrength = (days, min = 60) => ({ strength: Object.fromEntries(days.map((d) => [d, [{ type: STRENGTH_ID, duration: min }]])) });
const D = M.DAYS;

// ── 1. every per-rate row is the plan's own ladder ──────────────────────────
// The OLD expression, rebuilt, so the suite can show it differing.
const oldRow = (d, cut) => {
  const e = M.planEnergy(d);
  let cardio = 0;
  D.forEach((day) => (((d.cardio || {})[day]) || []).forEach((s) => { cardio += M.exBurn({ met: 0 }, 0, 0, d) || 0; }));
  return Math.max(1200, Math.round(e.tdee - cut));   // burn added separately below
};
{
  const RATES = [[0, 0], [0.5, 250], [1, 500], [2, 1000]];
  const plans = [
    ["no training", base()],
    ["cardio only, eat-back", base(withCardio([D[0], D[2], D[4]]))],
    ["cardio only, accelerate", base({ ...withCardio([D[0], D[2], D[4]]), deficitMode: "accelerate" })],
    ["strength only, eat-back", base(withStrength([D[0], D[2], D[4]]))],
    ["strength only, accelerate", base({ ...withStrength([D[0], D[2], D[4]]), deficitMode: "accelerate" })],
    ["cardio + strength, eat-back", base({ ...withCardio([D[1], D[3]]), ...withStrength([D[0], D[2], D[4]]) })],
    ["cardio + strength, accelerate", base({ ...withCardio([D[1], D[3]]), ...withStrength([D[0], D[2], D[4]]), deficitMode: "accelerate" })],
  ];
  for (const [name, d] of plans) {
    for (const [rate, cut] of RATES) {
      ok(`${name} @${rate}: rate and cut agree`, Math.round((rate * 3500) / 7) === cut);
    }
    // the row for the plan's OWN pace must be the number six surfaces quote
    ok(`${name}: the plan's own row IS computeClientCalories`,
       M.planIntakeForRate(d, M.weeklyRateOf(d)) === M.computeClientCalories(d).target);
  }
  // ⚠️ THE CASE THAT KILLS THE "SCOPE" DEFENCE. On a strength-only eat-back
  // plan the cardio average is zero, so the old "+ Cardio" grid was identical
  // to the "No Cardio" grid — and both understated the real target.
  {
    const d = base(withStrength([D[0], D[2], D[4]]));
    const e = M.planEnergy(d);
    const oldVal = Math.max(1200, Math.round(e.tdee - 500 + 0));   // avgBurnPerDay === 0
    const now = M.planIntakeForRate(d, 1);
    ok("strength-only eat-back: the old cardio-scoped row understated the target", now > oldVal, { oldVal, now });
    ok("...by exactly the strength share", Math.abs((now - oldVal) - Math.round(e.weeklyBurn / 7)) <= 1, { now, oldVal });
  }
  // ⚠️ AND ON ACCELERATE THE OLD ROW OVERSTATED IT — it added a burn the plan
  // explicitly refuses to add back.
  {
    const d = base({ ...withCardio([D[0], D[2], D[4]]), deficitMode: "accelerate" });
    const e = M.planEnergy(d);
    const oldVal = Math.max(1200, Math.round(e.tdee - 500 + Math.round(e.weeklyBurn / 7)));
    ok("accelerate: the old row overstated the target", M.planIntakeForRate(d, 1) < oldVal);
    ok("...and accelerate adds nothing back", M.planEnergy(d).eatbackPerDay === 0);
  }
}

// ── 2. the ladder must sum, in every combination ────────────────────────────
// Rebuild the shipped row builder's arithmetic and assert the visible rows add
// up to the bottom line. Never string-match rows.
{
  // ⚠️ THE SHIPPING BUILDER, LIFTED AND RUN — not a transcription of it. It
  // closes over the component's scope, so the scope is injected as parameters.
  // A rebuilt copy would keep passing while the real one broke, which is the
  // trap this repo has paid for repeatedly.
  const builderSrc = liftDecl(APP, "targetLadderRows");
  const makeRows = new Function(
    "data", "trackerTdee", "tdee", "planRate", "burnShown", "eatbackOn",
    "rawNoBurn", "floorLift", "computedTargetForNote", "scheduledBurn",
    "canChooseBurnMode", "dailyDeficitOf", "RATE_SENTENCE", "MIN_DAILY_CAL",
    `${builderSrc}\nreturn targetLadderRows();`);
  // Parse a rendered row back into the signed number a reader would add.
  const numOf = (v) => {
    const neg = /−/.test(v);
    const n = Number(String(v).replace(/[^0-9]/g, "")) || 0;
    return neg ? -n : n;
  };
  const ladder = (d, burnShown, trackerLog) => {
    const e = M.planEnergy(d);
    const tdee = e.tdee;
    const trackerTdee = trackerLog ? M.wearableTdee(d, trackerLog) : null;
    const eatbackOn = M.isEatback(d);
    const def = M.dailyDeficitOf(d);
    const rawNoBurn = tdee - def;
    const rawTarget = trackerTdee ? trackerTdee - def : rawNoBurn + (eatbackOn ? burnShown : 0);
    const floorLift = Math.max(0, M.MIN_DAILY_CAL - rawTarget);
    const target = M.atLeastMinCal(rawTarget);
    const raw = makeRows(d, trackerTdee, tdee, M.weeklyRateOf(d), burnShown, eatbackOn,
      rawNoBurn, floorLift, target, burnShown, true, M.dailyDeficitOf,
      (r) => `rate ${r}`, M.MIN_DAILY_CAL);
    const rows = raw.map((r) => ({ k: r.k, v: numOf(r.v), subtotal: r.k === "sub", label: r.l }));
    return { rows: rows.filter((r) => r.k !== "total"), target, floorLift, rawTarget, rendered: raw };
  };
  const sums = (L) => {
    // walk the rows the way a reader does: basis, then every delta, ignoring
    // the subtotal (which restates the running total rather than adding to it)
    let run = 0;
    for (const r of L.rows) { if (r.subtotal) { if (run !== r.v) return false; continue; } run += r.v; }
    return run === L.target;
  };
  const cases = [
    ["no floor, eat-back, burn", base(withStrength([D[0]])), 300, null],
    ["no floor, accelerate, burn", base({ ...withStrength([D[0]]), deficitMode: "accelerate" }), 300, null],
    ["no floor, rest day", base(withStrength([D[0]])), 0, null],
    ["floor binds on the final target", base({ weightLbs: 130, heightFt: 5, heightIn: 4, age: 35, activityLevel: "sedentary", weeklyRate: 2, ...withStrength([D[0]]) }), 238, null],
    ["floor binds on the SUBTOTAL only", base({ weightLbs: 160, heightFt: 5, heightIn: 7, age: 40, activityLevel: "light", weeklyRate: 2, ...withStrength([D[0]]) }), 300, null],
    ["tracker day", base(Object.assign({ wearableAdjust: true }, withStrength([D[0]]))), 238, { wearable: { resting: 1295, active: 238 } }],
  ];
  for (const [name, d, burn, log] of cases) {
    const L = ladder(d, burn, log);
    ok(`ladder sums: ${name}`, sums(L), { rows: L.rendered.map((r) => `${r.l} ${r.v}`), target: L.target });
    ok(`ladder's last row IS today's target: ${name}`,
       numOf(L.rendered[L.rendered.length - 1].v) === L.target, L.rendered[L.rendered.length - 1]);
    ok(`ladder never states a target below the floor: ${name}`, L.target >= M.MIN_DAILY_CAL);
  }
  // The two named cases, by value.
  {
    const d = base({ weightLbs: 130, heightFt: 5, heightIn: 4, age: 35, activityLevel: "sedentary", weeklyRate: 2, ...withStrength([D[0]]) });
    const L = ladder(d, 238, null);
    ok("floored plan shows a floor row", L.rows.some((r) => r.k === "floor"));
    ok("...and the subtotal is the RAW number, not 1,200", L.rows.find((r) => r.k === "sub").v < M.MIN_DAILY_CAL, L.rows);
    ok("...while the target itself is still 1,200", L.target === 1200);
  }
  {
    // The case NO disclosure fired on before: the floor binds on the subtotal
    // but not on the answer, so the old ladder invented a clamp.
    const d = base({ weightLbs: 160, heightFt: 5, heightIn: 7, age: 40, activityLevel: "light", weeklyRate: 2, ...withStrength([D[0]]) });
    const L = ladder(d, 300, null);
    ok("subtotal-only case shows NO floor row", !L.rows.some((r) => r.k === "floor"), L.rows);
    ok("...because the floor genuinely does not bind", L.target > 1200);
  }
}

// ── 3. the source, anchored and COUNTED ─────────────────────────────────────
// ⚠️ COUNTED, NOT FOUND. The old expression occurred THREE times; an assertion
// that merely finds one stays green with two broken — the exact check:weak
// failure this repo has paid for four times.
ok("no per-rate row still adds a cardio-only average",
   (CODE.match(/floor\(tdee\s*-\s*t\.cut\s*\+\s*avgBurnPerDay\)/g) || []).length === 0,
   (CODE.match(/floor\(tdee\s*-\s*t\.cut\s*\+\s*avgBurnPerDay\)/g) || []).length);
// ⚠️ S216: the local `floor` helper (an unrounded second copy of the shared one)
// is gone, so these two read atLeastMinCal. What is asserted is unchanged — the
// tab still subtracts the cut from tdee and adds NO burn, because that
// counterfactual is its whole subject.
ok("the No Cardio tab KEEPS its diet-only arithmetic (the counterfactual is its subject)",
   (CODE.match(/atLeastMinCal\(tdee\s*-\s*t\.cut\)/g) || []).length === 2,
   (CODE.match(/atLeastMinCal\(tdee\s*-\s*t\.cut\)/g) || []).length);
ok("the shared ladder is used for the per-rate rows", /const intakeAt = \(r\) => planIntakeForRate\(data, r\);/.test(CODE));
ok("...and rendered through a guard that never prints 0", /const intakeTxt = \(r\)/.test(CODE) && /intakeTxt\(t\.rate\)/.test(CODE));
ok("the Summary rows call it too", /planIntakeForRate\(data, t\.rate\)/.test(CODE));
ok("SummaryTab's two approach targets come off the same helper",
   /planIntakeForRate\(\{ \.\.\.data, deficitMode: "eatback" \}, planRateS\)/.test(CODE)
   && /planIntakeForRate\(\{ \.\.\.data, deficitMode: "accelerate" \}, planRateS\)/.test(CODE));
// ⚠️ THE STRUCTURAL PIN, worth more than any single value: isEatback had ZERO
// readers inside the Results body, and that one fact is the whole defect class.
{
  const a = CODE.indexOf("function Results(");
  const b = CODE.indexOf("\nfunction SummaryTab(", a);
  ok("found the Results body", a > 0 && b > a);
  ok("Results now reads the plan's nutrition approach", /planEatback/.test(CODE.slice(a, b)));
}
// The per-day carve-out must stay per-day.
ok("the day-by-day cells are per-day, mode-gated, and include strength",
   /atLeastMinCal\(tdee - t\.cut \+ \(planEatback \? burned \+ \(\(strengthDayData\[di\] \|\| \{\}\)\.burned \|\| 0\) : 0\)\)/.test(CODE));
ok("...and do NOT route through the flat helper", !/drc-cell-val[\s\S]{0,120}planIntakeForRate/.test(CODE));
// The ladder.
ok("one ladder builder, used by the card", /const targetLadderRows = \(\) =>/.test(CODE) && /<TargetLadder \/>/.test(CODE));
ok("the ladder's subtotal is raw", /l: "= After the deficit", v: `\$\{rawNoBurn\.toLocaleString\(\)\} cal`/.test(CODE));
ok("...and is never labelled a target", !/= Target before exercise/.test(CODE));
// ⚠️ ASSERT THE GATE DRIVES THE PUSH, not that the words exist. Replacing the
// condition with `if (false)` left "minimum applied" in the source and the
// first version of this check stayed green — the floor would simply have
// stopped being disclosed.
ok("the floor row is pushed when, and only when, the floor binds",
   /if \(floorLift > 0\)\s*\n\s*rows\.push\(\{ k: "floor"/.test(CODE));
ok("...and it names how much it lifted", /v: `\+\$\{floorLift\.toLocaleString\(\)\} cal`/.test(CODE));
ok("...with the explanation beside it", /floorLift > 0 && \(/.test(CODE) && /too low to be\s+healthy or sustainable/.test(CODE));
ok("the burn-mode sheet's walkthrough is gated on the chooser it explains",
   /\{canChooseBurnMode && \(\(\) => \{/.test(CODE));
ok("the footnote names the tracker basis when there is one", /Based on your tracker/.test(APP));
ok("...and the training burn when that is what moved it", /you burned training on this day/.test(APP));
ok("prescriptions still floor through atLeastMinCal",
   /const targetNoBurn   = atLeastMinCal\(rawNoBurn\);/.test(CODE)
   && /const targetWithBurn = atLeastMinCal\(rawNoBurn \+ scheduledBurn\);/.test(CODE));
// ⚠️ SCOPED TO WHAT THIS CHANGE ADDED. The rule is that NEW UI uses house
// icons, not that every pre-existing glyph is a defect — the Results body has
// carried a wizard step emoji since long before this, and asserting over the
// whole component just fails on somebody else's code.
{
  // ⚠️ EXTRACTED, NOT SLICED BETWEEN TWO MARKERS. A "const setClientColor" end
  // marker sat 442,000 characters away and swallowed the share-card text, whose
  // emoji predate this change by a year.
  const block = (from, to) => { const i = CODE.indexOf(from); const j = CODE.indexOf(to, i); return i < 0 || j < 0 || j - i > 4000 ? "" : CODE.slice(i, j); };
  const added = [
    block("const planEatback = isEatback(data);", "const TABS ="),
    liftDecl(CODE, "targetLadderRows"),
    liftDecl(CODE, "TargetLadder"),
  ].join("");
  ok("found the blocks this change added", added.length > 400, added.length);
  ok("no emoji in them", !/\p{Extended_Pictographic}/u.test(added),
     (added.match(/\p{Extended_Pictographic}/gu) || []).join(""));
}

// ── 3b. the Nutrients tab is on the same ladder (S216) ─────────────────────
// It was the last per-rate number in Results still assembling the ladder by
// hand: `floor(tdee − cut + Math.round(cardio/7) + Math.round(strength/7))`.
// Already mode-gated and already counting strength — correct on the axes S215
// was about — but rounding each half of the week SEPARATELY put it up to a
// calorie away from computeClientCalories, on the tab whose whole job is to
// divide that number into grams.
{
  const a = CODE.indexOf("function NutrientsTab(");
  const b = CODE.indexOf("\nfunction ", a + 10);
  ok("found the NutrientsTab body", a > 0 && b > a);
  const NUT = CODE.slice(a, b);
  ok("its target is the shared ladder", /const targetCals = planIntakeForRate\(data, rateChoice\);/.test(NUT));
  // ⚠️ COUNTED. Every one of the five props it used to rebuild that ladder from
  // has to be gone, or the next edit reassembles it.
  ok("...and nothing is left to rebuild it from",
     ["tdee", "floor", "avgBurnPerDay", "avgStrPerDay", "deficitMode"]
       .every((v) => !new RegExp("\\b" + v + "\\b").test(NUT)),
     ["tdee", "floor", "avgBurnPerDay", "avgStrPerDay", "deficitMode"].filter((v) => new RegExp("\\b" + v + "\\b").test(NUT)));
  // ⚠️ SCOPED TO THE ELEMENT, NOT TO 600 CHARACTERS AFTER IT. SurplusTab is the
  // next sibling and still takes avgBurnPerDay legitimately.
  {
    const i = CODE.indexOf("<NutrientsTab");
    const el = CODE.slice(i, CODE.indexOf("/>", i));
    ok("...nor at the call site", i > 0 && !/avgBurnPerDay=|avgStrPerDay=|\bfloor=|\btdee=|deficitMode=/.test(el), el.slice(0, 400));
    ok("...which now hands over the whole plan instead", /\bdata=\{data\}/.test(el));
  }
  ok("the chooser keeps a RATE now, not a daily cut", /const \[rateChoice, setRateChoice\] = useState\(1\);/.test(NUT));
  ok("...and the buttons set and compare it", /rateChoice===t\.rate/.test(NUT) && /setRateChoice\(t\.rate\)/.test(NUT));
  ok("...so the protein basis follows the rate", /rateChoice > 0 \? 1\.0 : 0\.8/.test(NUT));
  ok("...and so does the micronutrient relevance", /const isCutting = rateChoice > 0;/.test(NUT));
  // ⚠️ THE CHOICES DID NOT CHANGE — the table has carried both columns since
  // S95 and 0/250/500/1000 IS 0/½/1/2 lb a week. If they ever stop matching,
  // this tab silently starts answering a different question from its own label.
  const tbl = CODE.match(/const targets = \[[\s\S]*?\n  \];/)[0];
  const pairs = [...tbl.matchAll(/cut:(\d+),\s*rate:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  ok("the chooser offers four paces", pairs.length === 4, pairs);
  ok("...and every cut IS its rate's daily deficit",
     pairs.every(([cut, rate]) => cut === Math.round((rate * 3500) / 7)), pairs);
  // And the number it lands on is the plan's own, run rather than asserted.
  {
    const d = base({ ...withCardio([D[1], D[3]]), ...withStrength([D[0], D[2]]) });
    for (const [, rate] of pairs) {
      ok(`Nutrients at ${rate} lb/wk IS the ladder`,
         M.planIntakeForRate(d, rate) === M.atLeastMinCal(M.planEnergy(d).tdee - Math.round((rate * 3500) / 7) + M.planEnergy(d).eatbackPerDay));
    }
    // ⚠️ NEGATIVE CONTROL, ON THE SHIPPED ROUNDER. Dividing each half of the
    // week separately drifts by a whole calorie whenever the two remainders add
    // past a half — small enough to survive a reading, big enough to make this
    // tab and the dashboard quote different targets.
    const once   = (tdee, cut, c, s) => M.atLeastMinCal(tdee - cut + (c + s) / 7);
    const twice  = (tdee, cut, c, s) => M.atLeastMinCal(tdee - cut + Math.round(c / 7) + Math.round(s / 7));
    ok("control: 100 cardio + 100 strength really is a calorie apart",
       twice(2500, 500, 100, 100) !== once(2500, 500, 100, 100),
       { twice: twice(2500, 500, 100, 100), once: once(2500, 500, 100, 100) });
    // How often, across burns a real plan actually produces.
    let drifted = 0, total = 0;
    for (let c = 0; c <= 3000; c += 37) {
      for (let sB = 0; sB <= 3000; sB += 41) {
        total++;
        if (twice(2500, 500, c, sB) !== once(2500, 500, c, sB)) drifted++;
      }
    }
    ok(`control: it drifts on a real share of plans (${Math.round((drifted / total) * 100)}% of ${total})`,
       drifted / total > 0.05, { drifted, total });
  }
}

// ── 4. negative controls ────────────────────────────────────────────────────
{
  const d = base({ ...withCardio([D[1], D[3]]), ...withStrength([D[0], D[2], D[4]]) });
  const e = M.planEnergy(d);
  const cardioOnly = Math.max(1200, Math.round(e.tdee - 500 + 0));
  ok("control: a cardio-only row really does differ from the plan ladder",
     cardioOnly !== M.planIntakeForRate(d, 1));
  const ungated = (dd) => Math.max(1200, Math.round(M.planEnergy(dd).tdee - 500 + Math.round(M.planEnergy(dd).weeklyBurn / 7)));
  const acc = base({ ...withCardio([D[1], D[3]]), deficitMode: "accelerate" });
  ok("control: an ungated row really does overstate an accelerate plan",
     ungated(acc) !== M.planIntakeForRate(acc, 1));
  // a pre-floored subtotal really does break the visible sum
  const small = base({ weightLbs: 130, heightFt: 5, heightIn: 4, age: 35, activityLevel: "sedentary", weeklyRate: 2 });
  const es = M.planEnergy(small);
  const preFloored = Math.max(1200, es.tdee - M.dailyDeficitOf(small));
  ok("control: the pre-floored subtotal really did break the arithmetic",
     preFloored + 238 !== M.atLeastMinCal(es.tdee - M.dailyDeficitOf(small) + 238), { preFloored });
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  Results quotes the plan's ladder; the dashboard ladder adds up.\n");
