// "Start Over" is a destructive action, and it was one tap (S199l/S199m).
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
// when a coach built it; what was missing was the pause and the honesty.
//
// ⚠️ THEN THE SAME BUG IN THE MIRROR (S199m). The first fix asked "does the
// VIEWER have a coach", which is the wrong question when the viewer IS the
// coach: a trainer with a connected client's plan open was warned about "YOUR
// stats, YOUR goal" for a document that lives in the client's account and
// re-renders on the client's device. So the wording is chosen by the SUBJECT of
// the plan, not the role of the reader — and that choice is what this file
// spends most of its assertions on.
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
const warnSrc = /function resetWarning\(opts\) \{[\s\S]*?\n\}/.exec(APP);
const emptySrc = /const EMPTY_DATA = \{[\s\S]*?\n\};/.exec(APP);
const resetSrc = /function resetPlanData\(prev\) \{[\s\S]*?\n\}/.exec(APP);
ok("resetWarning is liftable", !!warnSrc);
ok("resetPlanData is liftable", !!emptySrc && !!resetSrc);
if (!warnSrc || !resetSrc) { console.log("  cannot continue"); process.exit(1); }
const resetWarning = new Function(`${warnSrc[0]}\nreturn resetWarning;`)();
// defaultCardio/defaultStrength are referenced by EMPTY_DATA and irrelevant here.
const resetPlanData = new Function("defaultCardio", "defaultStrength",
  `${emptySrc[0]}\n${resetSrc[0]}\nreturn resetPlanData;`)({}, {});

const say = (w) => `${w.title} ${w.body}`;

// ── a trainer erasing a CONNECTED client's plan ─────────────────────────────
// The one branch where confirming reaches into another account.
{
  const w = resetWarning({ subjectName: "Casey Client", isRemoteClient: true });
  ok("the client is named in the title", w.title.includes("Casey Client"), w.title);
  ok("...and it is framed as THEIR plan", /Casey Client's plan/.test(w.title), w.title);
  ok("...the variant is the remote one", w.variant === "remote", w.variant);
  // The whole point of the S199m fix: never "your stats" to the person who is
  // not the subject.
  ok("...it never says the trainer's own data is at risk",
     !/\byour stats\b|\byour goal\b/i.test(say(w)), say(w));
  ok("...it says the data is in the client's own account", /their own account/i.test(w.body), w.body);
  // A trainer cannot un-ring this: the client's device updates live (S70) and
  // the edit lands in the activity feed (recordPlanEdits). Both are promises the
  // app actually keeps, so both are stated.
  ok("...that the client's device updates too", /their device/i.test(w.body), w.body);
  ok("...and that it lands in their activity feed", /activity feed/i.test(w.body), w.body);
  ok("...the coaching notes are promised to survive", /coaching notes stay/i.test(w.body), w.body);
  ok("...and the button says whose plan is going", /their plan/i.test(w.confirmLabel), w.confirmLabel);
}

// ⚠️ THE NAME CAN BE ABSENT. A plan whose personal step was never filled in has
// no first/last name at all — and "Erase 's plan?" is not a warning, it is a
// bug report shown at the worst possible moment.
for (const [label, value] of [["missing", undefined], ["empty", ""], ["whitespace", "   "], ["null", null]]) {
  const w = resetWarning({ subjectName: value, isRemoteClient: true });
  ok(`a ${label} client name still reads as a sentence`, /Erase this client's plan\?/.test(w.title), w.title);
  ok(`...with no stray punctuation or undefined (${label})`, !/undefined|null|\s's|Erase\s+'/.test(w.title), w.title);
}

// Priority: the subject wins over the reader. A trainer who is themselves
// somebody's client must still be warned about the CLIENT's plan they have open.
{
  const w = resetWarning({ hasCoach: true, coachName: "Their Own Coach",
    subjectName: "Casey Client", isRemoteClient: true });
  ok("a coached trainer still gets the client's warning", w.variant === "remote", w.variant);
  ok("...and their own coach is not dragged in", !/Their Own Coach/.test(say(w)), say(w));
}

// ── a trainer erasing a LOCAL plan they keep for a real person ──────────────
// An unconnected plan is still somebody's programme.
{
  const w = resetWarning({ subjectName: "Prospect Pat" });
  ok("a local plan names its person", /Prospect Pat's plan/.test(w.title), w.title);
  ok("...as the local variant", w.variant === "local", w.variant);
  ok("...without claiming it is in their account",
     !/their own account|their device/i.test(w.body), w.body);
  ok("...and without saying it is the trainer's own data",
     !/\byour stats\b|\byour goal\b/i.test(say(w)), say(w));
}

// ── a simulation is a sandbox, and must not be sold as a person's plan ──────
// ⚠️ A SIM CARRIES A NAME TOO. Checked BEFORE the named-plan branch, or erasing
// a what-if file would announce that a real client is about to lose something.
{
  const w = resetWarning({ subjectName: "Prospect Pat", isSimulation: true });
  ok("a simulation is called a simulation", /simulation/i.test(w.title), w.title);
  ok("...as the simulation variant", w.variant === "simulation", w.variant);
  ok("...and does NOT claim a person's plan is going", !/Prospect Pat/.test(say(w)), say(w));
  ok("...it says plainly that no client data is touched", /no client's own data/i.test(w.body), w.body);
}

// ── a coached client erasing their own plan ─────────────────────────────────
{
  const w = resetWarning({ hasCoach: true, coachName: "Kevin Cameron" });
  ok("the coach is named", w.title.includes("Kevin Cameron"), w.title);
  ok("...and told it was built FOR them", /built this plan for you/.test(w.title), w.title);
  ok("...as the coached variant", w.variant === "coached", w.variant);
  ok("...the body says the coach will see it", /activity feed/.test(w.body), w.body);
  ok("...and that the coaching notes survive", /notes stay/i.test(w.body), w.body);
  // Kevin's call: persuasion, not permission. A confirm label that reads like a
  // dead end would be a block wearing a button's clothes.
  ok("...and the action is still offered", typeof w.confirmLabel === "string" && w.confirmLabel.length > 0, w.confirmLabel);
}

// ⚠️ THE COACH NAME ARRIVES LATE OR NOT AT ALL. It is fetched lazily when the
// confirm opens and the read can be denied or simply slower than the tap. A
// blank there is not cosmetic: "  built this plan for you." reads as a broken
// app at the one moment the sentence has to be believed.
for (const [label, value] of [["missing", undefined], ["null", null], ["empty", ""], ["whitespace", "   "]]) {
  const w = resetWarning({ hasCoach: true, coachName: value });
  ok(`a ${label} coach name falls back to a role`, w.title.startsWith("Your coach built"), w.title);
  ok(`...and never renders undefined/blank (${label})`, !/undefined|null|^\s|  /.test(w.title), w.title);
}

// ── someone with no coach, on their own plan ────────────────────────────────
{
  const w = resetWarning({});
  ok("a solo plan still gets a confirm", /start over\?/i.test(w.title), w.title);
  ok("...as the plain variant", w.variant === "plain", w.variant);
  ok("...that does not invent a coach", !/coach/i.test(say(w)), w);
  ok("...or a client", !/client/i.test(say(w)), w);
  ok("...but still says there's no undo", /no undo/i.test(w.body), w.body);
  // A stale coachName must not resurrect the coached wording — hasCoach is the
  // decision, the name is only how it is phrased.
  const stale = resetWarning({ coachName: "Kevin Cameron" });
  ok("...even when a name is left over in state", !/Kevin/.test(say(stale)), stale);
  ok("a bare call does not throw", resetWarning().variant === "plain");
}

// ── every variant tells the truth about what is destroyed ───────────────────
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
  // The one thing EVERY variant promises SURVIVES (S199k).
  ok("and the coaching notes survive, as the copy says",
     after.trainerNotes === "keeps skipping Thursdays", after.trainerNotes);
}

// Said in each variant, not just the one that happened to be read.
{
  const all = [
    ["remote", resetWarning({ subjectName: "Casey", isRemoteClient: true })],
    ["local", resetWarning({ subjectName: "Pat" })],
    ["simulation", resetWarning({ isSimulation: true })],
    ["coached", resetWarning({ hasCoach: true, coachName: "Kev" })],
    ["plain", resetWarning({})],
  ];
  ok("every branch is reachable and distinct",
     new Set(all.map(([, w]) => w.variant)).size === 5, all.map(([, w]) => w.variant));
  for (const [name, w] of all) {
    ok(`${name}: names the four things that go`,
       /stats/.test(w.body) && /goal/.test(w.body) && /workout schedule/.test(w.body) && /macro targets/.test(w.body), w.body);
    ok(`${name}: says there is no undo`, /no undo/i.test(w.body), w.body);
    ok(`${name}: offers a confirm label`, !!w.confirmLabel && !/undefined/.test(w.confirmLabel), w.confirmLabel);
    ok(`${name}: title is a finished sentence`, /[.?]$/.test(w.title.trim()), w.title);
  }
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
     /const w = resetWarning\(\{ hasCoach, coachName, subjectName, isRemoteClient, isSimulation \}\);/.test(APP));
  // hasCoach must be the CLIENT-with-a-trainer predicate: a trainer opening a
  // client's plan has no coach of their own and must not be told they do.
  ok("...fed by the client-with-a-coach predicate",
     /hasCoach=\{role === ROLES\.CLIENT && meHasCoach\}/.test(APP));
  ok("...and the coach name is fetched lazily when the confirm opens",
     /if \(hasCoach && !coachName && onNeedCoachName\) onNeedCoachName\(\);/.test(APP));
  // ⚠️ THE SUBJECT MUST BE BLANK FOR A CLIENT. fullName(data) on a client's own
  // plan is the CLIENT'S name — passed unguarded, Casey would be asked to
  // confirm erasing "Casey Client's plan", as though it belonged to someone else.
  ok("...the subject is named only when a trainer is reading",
     /const resetSubjectName = isTrainerHome\n\s*\? \(fullName\(data\) \|\|/.test(APP));
  ok("...and passed through, not recomputed at the call site",
     /subjectName=\{resetSubjectName\}/.test(APP));
  // ⚠️ AND IT FALLS BACK TO THE ROSTER. A connected client's plan usually has no
  // name on it at all — they were linked, nobody ran the wizard for them — so
  // without this the ONE warning that reaches into another account says "this
  // client" for almost every real client.
  ok("...falling back to the connected-clients roster when the plan is unnamed",
     /connectedClients\.find\(\(c\) => c\.uid === activeRemoteUid\)/.test(APP));
  ok("...and the cross-account case is the real remote flag",
     /isRemoteClient=\{!!activeRemoteUid\}/.test(APP));
}

// ── negative controls ───────────────────────────────────────────────────────
// If these pass, the assertions above are theatre.
{
  const broken = (o) => ({ variant: "remote", title: `Erase ${o.subjectName}'s plan?`,
    body: "This clears your stats, goal, workout schedule and macro targets.", confirmLabel: "Yes" });
  const b = broken({ subjectName: undefined });
  ok("control: the harness sees a blank/undefined subject name",
     /undefined/.test(b.title) && !/Erase this client's plan\?/.test(b.title), b.title);
  ok("control: the harness sees 'your stats' aimed at the wrong person",
     /\byour stats\b/i.test(b.title + " " + b.body));

  const noNotes = (prev) => ({ ...prev, trainerNotes: "" });
  ok("control: the harness sees notes being erased",
     noNotes({ trainerNotes: "x" }).trainerNotes !== "x");
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
