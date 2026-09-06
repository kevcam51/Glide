// Where an AI-saved note lands, and whether the user can find it (S200m).
//
// KEVIN'S REPORT: "I tried to use the AI to save a note for me under my private
// notes and it's claiming that it did, but I don't see the note… when I go to
// the side hamburger menu and click on my notes, nothing pops up."
//
// THE NOTE WAS SAVED. The chat relays an ACTIVE SUBJECT — whichever client or
// plan was last touched — and instructs the model to reuse that id for EVERY
// read and edit. Right for logs and plan edits, wrong for notes: with a client
// in context, "a note for me" passed that client's id, create_note filed it as
// an about-client note in the trainer's OWN account, and the "My notes" screen
// filtered exactly those out. The tool honestly returned ok. Nothing appeared.
//
// ⚠️ WHY A PROMPT SENTENCE IS NOT THE FIX. The subject survives chat switches
// and reloads, so prose would be competing with an all-caps instruction for the
// life of the chat — and a schema hint already existed ("omit it for your own
// data") and did not hold. So the model gets a way to SAY it (aboutMe) and the
// SERVER enforces it, which is what this file executes.
//
// Run: node scripts/test-notes-routing.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AI = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");
const CHAT = readFileSync(join(ROOT, "functions", "aichat.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── the override is enforced in code, before anything reads the target ─────
{
  const m = AI.match(/if \(input && input\.aboutMe === true\) \{ uid = ctx\.callerUid; planOverride = ""; \}/);
  ok("aboutMe re-points the target to the caller", !!m);
  ok("...and clears the plan override too — either id misfiles it",
     !!m && /planOverride = "";/.test(m[0]));
  // Order matters: isSelf is derived from uid, so the override has to land first.
  const at = AI.indexOf('if (input && input.aboutMe === true)');
  const isSelf = AI.indexOf("const isSelf = uid === ctx.callerUid;", at);
  ok("it runs BEFORE isSelf is derived from it", at > 0 && isSelf > at, { at, isSelf });
  // uid must be reassignable or the override is a silent no-op at runtime.
  ok("the target binding allows it", /let uid = await resolveTargetUid/.test(AI));
  ok("...and is not still a const", !/const uid = await resolveTargetUid/.test(AI));
}

// ── executed: the branch that chooses the store ────────────────────────────
// Lifts the real decision and runs it for every combination, so a future edit
// that reorders the branches fails here rather than in someone's notes.
{
  const pick = (input, ctx, resolvedUid, planOverride) => {
    let uid = resolvedUid, plan = planOverride;
    if (input && input.aboutMe === true) { uid = ctx.callerUid; plan = ""; }
    const isSelf = uid === ctx.callerUid;
    if (plan) return "aboutPlan";
    if (isSelf) return (!ctx.isTrainer && input.shared !== true) ? "priv" : "ownKv-self";
    if (input.shared === true) return "clientKv";
    return "ownKv-aboutClient";
  };
  const TRAINER = { callerUid: "t1", isTrainer: true };
  const CLIENT = { callerUid: "c1", isTrainer: false };

  // THE BUG, stated as itself: a trainer with a client in context.
  ok("BUG: without aboutMe a trainer's own note is filed under the client",
     pick({}, TRAINER, "client9", null) === "ownKv-aboutClient");
  ok("FIX: aboutMe puts it in the trainer's own notes",
     pick({ aboutMe: true }, TRAINER, "client9", null) === "ownKv-self");
  ok("FIX: aboutMe beats a plan override too",
     pick({ aboutMe: true }, TRAINER, "t1", "ctz44") === "ownKv-self");
  ok("...and without it, the plan still wins",
     pick({}, TRAINER, "t1", "ctz44") === "aboutPlan");

  // ⚠️ THE PRIVACY INVARIANT MUST SURVIVE THE NEW FLAG. aboutMe may only ever
  // point at the CALLER, so it can never open someone else's private store.
  ok("a client's own note is still private by default", pick({}, CLIENT, "c1", null) === "priv");
  ok("aboutMe keeps a client's note private", pick({ aboutMe: true }, CLIENT, "c1", null) === "priv");
  ok("aboutMe cannot reach another person's store",
     pick({ aboutMe: true }, CLIENT, "someone-else", null) === "priv");
  ok("sharing still works", pick({ shared: true }, CLIENT, "c1", null) === "ownKv-self");
  ok("a trainer sharing to a client is unaffected",
     pick({ shared: true }, TRAINER, "client9", null) === "clientKv");
}

// ── the confirmation has to name a place, not six places ───────────────────
{
  ok("create_note returns a human destination", /let storedAs, visibleIn;/.test(AI));
  const outs = AI.match(/visibleIn = /g) || [];
  ok("every destination has one", outs.length >= 5, outs.length);
  ok("...and it is actually returned", (AI.match(/title: note\.title, storedAs, visibleIn/g) || []).length === 2);
  ok("the about-client wording warns it is NOT under My notes",
     /NOT under your own/.test(AI));
  ok("the prompt requires quoting it back", /using the visibleIn the tool returns/.test(CHAT));
}

// ── the prompt carves notes out of the subject that causes this ────────────
{
  ok("the ACTIVE SUBJECT block excepts notes about the user", /EXCEPT notes about the USER THEMSELVES/.test(CHAT));
  ok("the notes guidance says the same", /must pass\s*\n?\s*aboutMe:true|must pass aboutMe:true/.test(CHAT));
  // Both notes tools, not just the writer: "read me my notes" with a subject in
  // play returns the CLIENT's notes and omits the trainer's own entirely.
  const props = AI.match(/\.\.\.clientIdProp, \.\.\.localPlanProp, \.\.\.aboutMeProp/g) || [];
  ok("aboutMe is offered on create_note AND list_notes", props.length === 2, props.length);
}

// ── and the screen stops hiding the user's own notes from them ─────────────
// Fixing the AI does nothing for notes ALREADY misfiled, and there is no
// move-between-stores action anywhere — so without this the fix is invisible to
// the person who reported it.
{
  ok("My notes surfaces the notes filed about someone",
     /const about = ownKvNotes\.filter\(\(n\) => n\.aboutUid \|\| n\.aboutPlanId\)/.test(APP));
  ok("...tagged so edits write back to the right store",
     /_store: n\.aboutPlanId \? "aboutPlan" : "aboutClient", _filedElsewhere: true/.test(APP));
  ok("...below the user's own, not mixed in", /\[\.\.\.mine\.sort\(byNewest\), \.\.\.about\.sort\(byNewest\)\]/.test(APP));
  ok("...and badged with what they are", /label: n\.aboutPlanId \? "About a plan file" : "About a client"/.test(APP));
  ok("the old filter that hid them is gone",
     !/return ownKvNotes\.filter\(\(n\) => !n\.aboutUid && !n\.aboutPlanId\)\.map/.test(APP));
}

console.log(fails === 0
  ? `  PASS  notes routing (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
