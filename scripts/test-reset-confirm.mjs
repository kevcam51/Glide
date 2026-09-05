// "Start Over" is a destructive action, and it was one tap (S199l).
//
// THE EXPOSURE. The edit bar's `↺ Start Over` called onReset directly — no
// confirm, no undo, no role check — and reset() clears stats, goal, workout
// schedule, macro targets and every check-in-derived field, then commits on the
// normal ~600ms debounce. Two things made that sharper than it looks:
//
//   • The edit bar renders OUTSIDE the Simple/Detailed ternary, and clients
//     default to Simple — so the button sat one tap from a client's normal
//     landing screen, below a plan they had no other way to damage.
//   • No role gate: a connected client could wipe a plan their coach built.
//
// Kevin's call was NOT to block it. A person may start their own plan over even
// when a coach built it; what was missing was the pause and the honesty. So the
// fix is a confirm for everyone, and a coached client's confirm names the coach
// and says the change is visible to them.
//
// ⚠️ EXECUTED, NOT MATCHED. The house rule, paid for twice in this repo: a
// source regex on a guard passes while the guard is dead — `if (false)` stayed
// green. resetWarning is module-level and pure precisely so the shipping copy
// can be RUN here. The negative controls at the bottom prove this harness can
// actually see the bug it is guarding against.
//
// Run: node scripts/test-reset-confirm.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── lift the shipping source ────────────────────────────────────────────────
const warnSrc = /function resetWarning\(hasCoach, coachName\) \{[\s\S]*?\n\}/.exec(APP);
const emptySrc = /const EMPTY_DATA = \{[\s\S]*?\n\};/.exec(APP);
const resetSrc = /function resetPlanData\(prev\) \{[\s\S]*?\n\}/.exec(APP);
ok("resetWarning is liftable", !!warnSrc);
ok("resetPlanData is liftable", !!emptySrc && !!resetSrc);
if (!warnSrc || !resetSrc) { console.log("  cannot continue"); process.exit(1); }
const resetWarning = new Function(`${warnSrc[0]}\nreturn resetWarning;`)();
// defaultCardio/defaultStrength are referenced by EMPTY_DATA and irrelevant here.
const resetPlanData = new Function("defaultCardio", "defaultStrength",
  `${emptySrc[0]}\n${resetSrc[0]}\nreturn resetPlanData;`)({}, {});

// ── a coached client is warned in their coach's name ────────────────────────
{
  const w = resetWarning(true, "Kevin Cameron");
  ok("the coach is named", w.title.includes("Kevin Cameron"), w.title);
  ok("...and told it was built FOR them", /built this plan for you/.test(w.title), w.title);
  ok("...the body says the coach will see it", /activity feed/.test(w.body), w.body);
  ok("...and that the coaching notes survive", /notes stay/i.test(w.body), w.body);
  ok("...it is marked as the coached variant", w.coached === true);
  // Kevin's call: persuasion, not permission. A confirm label that reads like a
  // dead end would be a block wearing a button's clothes.
  ok("...and the action is still offered", typeof w.confirmLabel === "string" && w.confirmLabel.length > 0, w.confirmLabel);
}

// ⚠️ THE NAME ARRIVES LATE OR NOT AT ALL. It is fetched lazily when the confirm
// opens and the read can be denied or simply slower than the tap. A blank there
// is not cosmetic: "  built this plan for you." reads as a broken app at the one
// moment the sentence has to be believed.
for (const [label, value] of [["missing", undefined], ["null", null], ["empty", ""], ["whitespace", "   "]]) {
  const w = resetWarning(true, value);
  ok(`a ${label} coach name falls back to a role`, w.title.startsWith("Your coach built"), w.title);
  ok(`...and never renders undefined/blank (${label})`, !/undefined|null|^\s|  /.test(w.title), w.title);
}

// ── someone with no coach is warned, but not lectured ───────────────────────
{
  const w = resetWarning(false, "");
  ok("a solo plan still gets a confirm", /start over\?/i.test(w.title), w.title);
  ok("...that does not invent a coach", !/coach/i.test(w.title + w.body), w);
  ok("...but still says there's no undo", /no undo/i.test(w.body), w.body);
  ok("...and is marked as the plain variant", w.coached === false);
  // A stale coachName must not resurrect the coached wording — hasCoach is the
  // decision, the name is only how it is phrased.
  const stale = resetWarning(false, "Kevin Cameron");
  ok("...even when a name is left over in state", !/Kevin/.test(stale.title + stale.body), stale);
}

// ── both variants tell the truth about what is destroyed ────────────────────
// The copy claims stats, goal, workout schedule and macro targets go. If
// resetPlanData ever stopped clearing one of them the promise would invert into
// a lie, so the claim is checked against the function that does the clearing.
{
  const before = { weightLbs: 200, age: 35, gender: "male", goalWeight: 180,
    activityLevel: "moderate", macroTargets: { protein: 200, carbs: 225, fat: 74 },
    strength: { Monday: [{ type: "bench" }] }, checkIns: [{ date: "2026-09-01", weight: 200 }],
    trainerNotes: "keeps skipping Thursdays" };
  const after = resetPlanData(before);
  ok("stats really are cleared", !after.weightLbs && !after.age && !after.gender, after);
  ok("the goal really is cleared", !after.goalWeight, after.goalWeight);
  ok("the workout schedule really is cleared",
     !(after.strength && after.strength.Monday && after.strength.Monday.length), after.strength);
  ok("the macro targets really are cleared", after.macroTargets === undefined, after.macroTargets);
  ok("the check-ins really are cleared", Array.isArray(after.checkIns) && after.checkIns.length === 0, after.checkIns);
  // The one thing both variants promise SURVIVES (S199k).
  ok("and the coaching notes survive, as the copy says",
     after.trainerNotes === "keeps skipping Thursdays", after.trainerNotes);
}

// ── the UI half ─────────────────────────────────────────────────────────────
// ⚠️ PATTERN MATCHES, AND THEY KNOW IT. React state cannot be executed here, so
// these assert only that the wiring exists — they cannot prove the confirm
// renders. They are the weakest checks in this file; the executed ones above
// are the ones that carry it.
{
  ok("the reset button no longer calls onReset directly",
     !/className="edit-bar-reset" onClick=\{onReset\}/.test(APP));
  ok("...it opens a confirm instead", /setConfirmReset\(true\)/.test(APP));
  ok("...and only the confirm's own button resets",
     /onClick=\{\(\)=>\{ setConfirmReset\(false\); onReset\(\); \}\}/.test(APP));
  ok("...with a Cancel that resets nothing",
     /onClick=\{\(\)=>setConfirmReset\(false\)\}/.test(APP));
  ok("...rendering the shipping copy rather than its own",
     /const w = resetWarning\(hasCoach, coachName\);/.test(APP));
  // hasCoach must be the CLIENT-with-a-trainer predicate: a trainer opening a
  // client's plan has no coach of their own and must not be told they do.
  ok("...fed by the client-with-a-coach predicate",
     /hasCoach=\{role === ROLES\.CLIENT && meHasCoach\}/.test(APP));
  ok("...and the name is fetched lazily when the confirm opens",
     /if \(hasCoach && !coachName && onNeedCoachName\) onNeedCoachName\(\);/.test(APP));
}

// ── negative controls ───────────────────────────────────────────────────────
// If these pass, the assertions above are theatre.
{
  const broken = (hasCoach, coachName) => ({
    coached: !!hasCoach, title: `${coachName} built this plan for you.`,
    body: "This clears everything.", confirmLabel: "Yes",
  });
  const b = broken(true, undefined);
  ok("control: the harness sees a blank/undefined coach name",
     b.title.startsWith("Your coach built") === false && /undefined/.test(b.title), b.title);

  const noNotes = (prev) => ({ ...prev, trainerNotes: "" });
  ok("control: the harness sees notes being erased",
     noNotes({ trainerNotes: "x" }).trainerNotes !== "x");
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
