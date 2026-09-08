// Paying back an over-eating day (S200r, Kevin).
//
// "Let's say they ate 5,000 when they were supposed to eat 2,500. Show how much
// exercise they'd need and how much of a deficit — let them pick how many days
// to make it up over, and a slider for how much comes from training versus
// eating, because some people would rather train more than eat less."
//
// ⚠️ WHY THIS IS TESTED AND NOT EYEBALLED. It is arithmetic a person will act
// on, and the failure mode is not a crash — it is a plan that looks reasonable
// and does not add up. Two specific traps:
//
//   • THE 1,200 FLOOR CHANGES THE ANSWER. At 100% from eating over 3 days, a
//     2,500 overage wants 833/day off a 2,000 target — straight through the
//     floor every screen else in this app respects. Capping it silently would
//     hand back a plan that pays back less than the number printed at the top.
//     So the floor moves the remainder to training and SAYS it did.
//   • THE TWO HALVES MUST STILL SUM. Whatever the split, burn + cut over the
//     window has to equal the overage, or the tool is lying about the premise.
//
// Run: node scripts/test-makeup-plan.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Lift and RUN the shipping function — a transcription would drift.
const src = APP.match(/function makeUpPlan\(\{[\s\S]*?\n\}/);
if (!src) { console.log("  FAIL: makeUpPlan not found"); process.exit(1); }
const makeUpPlan = new Function(`const CAL_PER_LB = 3500;\n${src[0]}\nreturn makeUpPlan;`)();

// Kevin's own example, and the shape everything else is checked against.
const ATE = 5000, TARGET = 2500, OVER = ATE - TARGET;

// ── the split does what the slider says ────────────────────────────────────
{
  const all3 = makeUpPlan({ over: OVER, days: 3, share: 1, target: TARGET });
  ok("all from training: nothing comes off the plate", all3.cutPerDay === 0, all3);
  ok("...and the burn is the whole thing spread over the window",
     all3.burnPerDay === Math.round(OVER / 3), all3.burnPerDay);
  ok("...so the target is untouched", all3.newTarget === TARGET, all3.newTarget);

  const half = makeUpPlan({ over: OVER, days: 3, share: 0.5, target: TARGET });
  ok("50/50 splits it down the middle",
     half.burnPerDay === Math.round(OVER * 0.5 / 3) && half.cutPerDay === Math.round(OVER * 0.5 / 3), half);
  ok("...and the plate drops by exactly that", half.newTarget === TARGET - half.cutPerDay, half);

  const none = makeUpPlan({ over: OVER, days: 3, share: 0, target: TARGET });
  ok("all from eating: no extra training at all", none.burnPerDay === 0, none);
  ok("...and it stays above the floor at this target", none.newTarget >= 1200, none.newTarget);
}

// ── the invariant: it must actually add up ────────────────────────────────
// This is the one that catches an arithmetic slip in any future edit.
for (const days of [1, 2, 3, 5, 7, 14]) {
  for (const share of [0, 0.25, 0.5, 0.75, 1]) {
    const p = makeUpPlan({ over: OVER, days, share, target: TARGET });
    const paid = (p.burnPerDay + p.cutPerDay) * days;
    ok(`sums to the overage (${days}d, ${share * 100}% training)`,
       Math.abs(paid - OVER) <= days, { paid, OVER, days, share });
  }
}

// ── the floor, which is where a naive version quietly lies ────────────────
{
  // 2,500 over, 3 days, ALL from eating, against a 2,000 target: wants 833/day
  // off, but only 800 is available before 1,200.
  const p = makeUpPlan({ over: 2500, days: 3, share: 0, target: 2000 });
  ok("the plate never goes below 1,200", p.newTarget >= 1200, p.newTarget);
  ok("...and it says the floor bit", p.floorHit === true, p);
  ok("...moving the remainder to training rather than dropping it",
     p.burnPerDay > 0 && Math.abs((p.burnPerDay + p.cutPerDay) * 3 - 2500) <= 3, p);
  ok("...and reports how much moved", p.movedToTraining > 0, p.movedToTraining);

  // A target already at the floor can give nothing at all.
  const atFloor = makeUpPlan({ over: 2000, days: 2, share: 0, target: 1200 });
  ok("at the floor, eating contributes nothing", atFloor.cutPerDay === 0, atFloor);
  ok("...and the whole thing becomes training", atFloor.burnPerDay === 1000, atFloor.burnPerDay);
  ok("...and it does not pretend otherwise", atFloor.floorHit === true);

  // Generous window + generous target: the floor should NOT fire.
  const easy = makeUpPlan({ over: 2500, days: 14, share: 0, target: 2500 });
  ok("a longer window keeps it off the floor", easy.floorHit === false, easy);
}

// ── refusals and edges ────────────────────────────────────────────────────
ok("a day that was not over produces nothing", makeUpPlan({ over: 0, days: 3, share: 0.5, target: 2500 }) === null);
ok("...and neither does a negative", makeUpPlan({ over: -400, days: 3, share: 0.5, target: 2500 }) === null);
ok("zero days is treated as one, not a divide-by-zero",
   makeUpPlan({ over: 1000, days: 0, share: 1, target: 2500 }).burnPerDay === 1000);
ok("a share above 1 is clamped", makeUpPlan({ over: 900, days: 3, share: 5, target: 2500 }).cutPerDay === 0);
ok("...and below 0", makeUpPlan({ over: 900, days: 3, share: -5, target: 2500 }).burnPerDay === 0);
ok("the scale cost is reported honestly (3,500 cal ~ 1 lb)",
   Math.abs(makeUpPlan({ over: 3500, days: 1, share: 1, target: 2500 }).lbs - 1) < 0.001);

// ── the screen has to honour what the function returns ────────────────────
ok("only days that actually went over are offered", /\.filter\(\(x\) => x\.cals > tgt\)/.test(APP));
ok("the slider spans the whole range", /min="0" max="100" step="5" value=\{muShare\}/.test(APP));
ok("...and both ends are labelled", /<span>Eat less<\/span>/.test(APP) && /<span>Train more<\/span>/.test(APP));
ok("the floor warning is shown, not swallowed", /mu\.floorHit && \(/.test(APP));
ok("...naming what moved to training", /mu\.movedToTraining\.toLocaleString\(\)/.test(APP));
ok("the burn is translated into time on the exercise they picked", /≈ \{muMinutes\} min of \{pickedEx\.label\}/.test(APP));
ok("one big day is put in proportion rather than dramatised", /isn&rsquo;t a setback unless it becomes the pattern/.test(APP));

// ── negative controls ─────────────────────────────────────────────────────
const naive = ({ over, days, share, target }) => {  // the version without a floor
  const cut = Math.round((over * (1 - share)) / days);
  return { cutPerDay: cut, newTarget: target - cut, burnPerDay: Math.round((over * share) / days) };
};
ok("NEG: a floorless version would push the plate under 1,200",
   naive({ over: 2500, days: 3, share: 0, target: 2000 }).newTarget < 1200);
ok("NEG: ...and would pay back less than it promised once capped",
   (Math.max(1200, naive({ over: 2500, days: 3, share: 0, target: 2000 }).newTarget) !== naive({ over: 2500, days: 3, share: 0, target: 2000 }).newTarget));

console.log(fails === 0
  ? `  PASS  make-up plan (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
