// The goal DATE on the Nutrition Approach card, and the pace it is derived from
// (S216).
//
// THE BUG. `SummaryTab` dated every plan at 1 lb/week:
//
//     const wksEat = hasGoal ? weeksToGoal(toLose, 3500) : null;
//     const wksAcc = hasGoal ? weeksToGoal(toLose, 3500 + weeklyBurnAll) : null;
//
// `weeklyRateOf` has been the single source of the plan's pace since S95 — the
// daily targets, the projections, the calendar and the server all read it, and
// `SimulationSummary` multiplies by it four thousand lines earlier. This card
// never was. So a client set to 2 lb/wk was told 35 lbs would take 20 weeks when
// the plan's own arithmetic says 10, four lines under a row reading
// "Your plan's pace · 2 lbs/wk · 2,069 cal". Both directions were wrong: a
// ½ lb/wk plan was promised twice the speed it had chosen.
//
// WHAT HAS TO STAY TRUE:
//   1. BOTH TIMELINES COME OFF THE PLAN'S OWN RATE. Eat-back is that rate;
//      accelerate is that rate PLUS the whole weekly training burn (cardio and
//      strength), which is what "the burn buys the date, not the food" means.
//   2. A NON-LOSING PACE HAS NO EAT-BACK DATE. weeksToGoal refuses a
//      non-positive deficit — it must keep refusing, and the card must say why
//      rather than print a dash. The old hardcoded 3,500 manufactured a
//      confident date for a maintenance plan.
//   3. THE WORDS MATCH THE NUMBER. The chooser's own description said "steady
//      ~1 lb/wk" in prose, which is the same false claim one line above the
//      false date.
//
// The helpers are LIFTED FROM THE SHIPPING SOURCE AND RUN, and every guard is
// mutated to prove this file can see the bug it guards.
//
// Run: node scripts/test-goal-date.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const CODE = APP.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ⚠️ A BRACE-BALANCED LIFTER, NOT A LAZY REGEX (S215) — a one-line arrow const
// makes `[\s\S]*?\n\};` run on into the next declaration, and a function's
// parameter list closes its parens at depth 0.
function liftDecl(src, name) {
  const re = new RegExp("\\n([ \\t]*)(?:function " + name + "\\(|const " + name + "\\s*=)");
  const m = src.match(re);
  if (!m) throw new Error("could not lift " + name);
  const start = m.index + 1 + m[1].length;
  const isFn = src.startsWith("function", start);
  let i = start, depth = 0, opened = false;
  const skipString = () => { const qq = src[i]; for (i++; i < src.length; i++) { if (src[i] === "\\") { i++; continue; } if (src[i] === qq) return; } };
  if (isFn) {
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

const M = new Function(`
  ${liftDecl(APP, "RATE_OPTS")}
  ${liftDecl(APP, "RATE_SHORT")}
  ${liftDecl(APP, "weeklyRateOf")}
  ${liftDecl(APP, "weeksToGoal")}
  ${liftDecl(APP, "friendlyTime")}
  return { RATE_OPTS, RATE_SHORT, weeklyRateOf, weeksToGoal, friendlyTime };
`)();

// The SummaryTab body, so source assertions cannot match the rest of the file.
const SUM_A = APP.indexOf("function SummaryTab(");
const SUM_B = APP.indexOf("\nfunction ", SUM_A + 10);
ok("found the SummaryTab body", SUM_A > 0 && SUM_B > SUM_A);
const SUM = APP.slice(SUM_A, SUM_B);
const SUM_CODE = CODE.slice(CODE.indexOf("function SummaryTab("), CODE.indexOf("\nfunction ", CODE.indexOf("function SummaryTab(") + 10));

// ── 1. the card reads the plan's pace, and nothing else ────────────────────
ok("the weekly deficit is the plan's rate, not a literal",
   /const weeklyDeficitS = planRateS \* 3500;/.test(SUM_CODE));
ok("...and planRateS IS weeklyRateOf", /const planRateS = weeklyRateOf\(data\);/.test(SUM_CODE));
ok("the eat-back timeline uses it", /const wksEat = hasGoal \? weeksToGoal\(toLose, weeklyDeficitS\) : null;/.test(SUM_CODE));
// ⚠️ ACCELERATE IS THAT SAME DEFICIT PLUS THE WHOLE WEEK'S BURN — cardio AND
// strength. Dropping either half is the S215 defect in a different card.
ok("the accelerate timeline stacks the whole weekly burn on it",
   /const wksAcc = hasGoal \? weeksToGoal\(toLose, weeklyDeficitS \+ weeklyBurnAll\) : null;/.test(SUM_CODE));
ok("...and that burn really is cardio plus strength",
   /const weeklyBurnAll = \(totalBurn \|\| 0\) \+ \(totalStrBurn \|\| 0\);/.test(SUM_CODE));
// ⚠️ COUNTED, NOT FOUND. A bare 3,500 anywhere else in this component is the
// same defect wearing a different variable name.
ok("no bare 3,500 survives in the card",
   (SUM_CODE.match(/3500/g) || []).length === 1, (SUM_CODE.match(/3500/g) || []).length);

// ── 2. what the dates actually come out at ─────────────────────────────────
// 20 lbs to lose, no training, one plan per pace — the case named in the
// handoff: "20 weeks where the truth is 10".
const weeks = (rate, burn = 0) => M.weeksToGoal(20, M.weeklyRateOf({ weeklyRate: rate }) * 3500 + burn);
ok("2 lb/wk reaches the goal in 10 weeks, not 20", weeks(2) === 10, weeks(2));
ok("1 lb/wk is unchanged at 20 weeks", weeks(1) === 20, weeks(1));
ok("½ lb/wk is 40 weeks, not 20", weeks(0.5) === 40, weeks(0.5));
ok("an unset rate still defaults to 1 lb/wk", M.weeksToGoal(20, M.weeklyRateOf({}) * 3500) === 20);
ok("a junk rate falls back to 1 lb/wk too", M.weeksToGoal(20, M.weeklyRateOf({ weeklyRate: "banana" }) * 3500) === 20);
// ⚠️ THE CONTROL. The shipped bug dated all three the same.
ok("control: the hardcoded 3,500 really did date every pace identically",
   M.weeksToGoal(20, 3500) === 20 && weeks(2) !== 20 && weeks(0.5) !== 20);
ok("...and really did double the wait on a 2 lb/wk plan",
   M.weeksToGoal(20, 3500) - weeks(2) === 10);
// Accelerate adds the training burn to whatever the pace already is.
ok("training speeds a 2 lb/wk plan up further", weeks(2, 1400) < weeks(2));
ok("...and the two approaches differ by the burn, at every pace",
   [0.5, 1, 2].every((r) => weeks(r, 1400) < weeks(r)));

// ── 3. a non-losing pace has no eat-back date, and says why ────────────────
// ⚠️ weeksToGoal REFUSES a non-positive deficit. That refusal is the honest
// answer for a maintenance plan and the old literal papered over it.
ok("maintenance has no eat-back date", weeks(0) === null);
ok("a gaining pace has none either", weeks(-1) === null && weeks(-2) === null);
ok("...but training alone can still get there", weeks(0, 1400) !== null && weeks(0, 1400) > 0);
ok("friendlyTime renders a missing date as a dash rather than crashing", M.friendlyTime(null) === "—");
ok("the card explains a missing date instead of leaving the dash bare",
   /\{!wksEat && \(/.test(SUM_CODE) && /so eating alone never reaches/.test(SUM_CODE));
ok("...and names the pace that caused it", /RATE_SHORT\[planRateS\] \|\| "maintenance"/.test(SUM_CODE));
ok("...and points at the approach that still works when it does",
   /wksAcc \? " Faster Results gets there on the training burn alone\." : " Pick a losing pace to see a date\."/.test(SUM_CODE));

// ── 4. the words have to match the number ──────────────────────────────────
// The chooser's own description said "steady ~1 lb/wk" in prose — the same false
// claim as the date, one line above it, and it would have survived a fix aimed
// only at the arithmetic.
ok("the Eat More description no longer hardcodes 1 lb/wk", !/steady ~1 lb\/wk/.test(SUM_CODE));
ok("...it says the plan's own pace", /easier diet, \$\{pacePhrase\}/.test(SUM_CODE));
{
  const phrase = new Function("planRateS", `
    ${liftDecl(APP, "RATE_SHORT")}
    ${liftDecl(APP, "pacePhrase").replace(/^const pacePhrase = /, "return ")}
  `);
  // ⚠️ TWO POUNDS TAKES THE PLURAL (S220g, Kevin: "unify the spelling to lbs").
  // RATE_SHORT used to say "2 lb/wk" here while the chips on the same dashboard
  // said "2 LBS/WK". This assertion is what caught the change in a second
  // surface — which is the point of pinning the string rather than the shape.
  ok("2 lbs/wk reads as itself", phrase(2) === "a steady ~2 lbs/wk", phrase(2));
  ok("1 lb/wk is unchanged", phrase(1) === "a steady ~1 lb/wk", phrase(1));
  ok("half a pound reads properly", phrase(0.5) === "a steady ~½ lb/wk", phrase(0.5));
  // ⚠️ "steady ~Maintain" is not English — RATE_SHORT[0] is a NOUN.
  ok("maintenance gets a sentence, not a label", phrase(0) === "holding your weight steady", phrase(0));
  ok("a gaining pace keeps its plus", phrase(-1) === "a steady ~+1 lb/wk", phrase(-1));
  ok("...and a gaining two takes the plural too", phrase(-2) === "a steady ~+2 lbs/wk", phrase(-2));
  // The other half of the rule: a half and a one stay singular in both directions.
  ok("...while a half and a one stay singular",
     [0.5, 1, -0.5, -1].every((r) => !/lbs\//.test(phrase(r))), [0.5, 1, -0.5, -1].map(phrase));
  ok("every offered rate produces English", M.RATE_OPTS.every((r) => !/undefined|Maintain/.test(phrase(r))),
     M.RATE_OPTS.map(phrase));
}

// ── 5. the card that already got this right is untouched ───────────────────
// SimulationSummary has multiplied by weeklyRateOf since S95; this fix must not
// have "tidied" it in the other direction.
{
  const SIM_A = APP.indexOf("function SimulationSummary(");
  const SIM = APP.slice(SIM_A, APP.indexOf("\nfunction ", SIM_A + 10));
  ok("SimulationSummary still uses the plan's rate",
     /weeksToGoal\(diff, weeklyRateOf\(data\) \* 3500\)/.test(SIM)
     && /weeksToGoal\(diff, weeklyRateOf\(data\) \* 3500 \+ weeklyBurnAll\)/.test(SIM));
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED\n`); process.exit(1); }
console.log("  Goal date: the plan's own pace, or an honest refusal.\n");
