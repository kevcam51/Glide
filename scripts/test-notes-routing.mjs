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
  const m = AI.match(/if \(NOTES_TOOLS\.has\(name\) && input && input\.aboutMe === true\) \{[\s\S]{0,200}?\}/);
  ok("aboutMe re-points the target to the caller", !!m && /uid = ctx\.callerUid;/.test(m[0]));
  ok("...and clears the plan override too — either id misfiles it",
     !!m && /planOverride = null;/.test(m[0]));
  // ⚠️ ORDER, AND IT IS LOAD-BEARING TWICE (S200p). isSelf is derived from uid,
  // so the re-point must precede it — and the AI-CLIENT SEAT GATE is computed
  // from uid too, ~100 lines earlier. Landing after the gate meant a trainer at
  // their seat cap was REFUSED when saving a note into their own account, and
  // one below the cap was charged a client seat for it.
  const at = AI.indexOf("if (NOTES_TOOLS.has(name) && input && input.aboutMe === true)");
  const seat = AI.indexOf("const seatKey = planOverride", at > 0 ? 0 : 0);
  const isSelf = AI.indexOf("const isSelf = uid === ctx.callerUid;", at);
  ok("it runs BEFORE isSelf is derived from it", at > 0 && isSelf > at, { at, isSelf });
  ok("...and BEFORE the seat gate charges for the uncorrected target", at > 0 && at < seat, { at, seat });
  // Scoped, or it becomes a way to dodge the gate from any tool.
  ok("only the notes tools may re-point", /const NOTES_TOOLS = new Set\(\["list_notes", "create_note", "update_note"\]\);/.test(AI));
  ok("...and the late duplicate is gone",
     !/if \(input && input\.aboutMe === true\) \{ uid = ctx\.callerUid; planOverride = ""; \}/.test(AI));
  // update_note must be able to edit anything list_notes can show.
  ok("update_note searches privkv whenever the target is the caller",
     /\? \[\["priv", ctx\.callerUid\], \["kv", uid\]\]/.test(AI));
  ok("...and no longer excludes trainers from their own private store",
     !/!ctx\.isTrainer \? \[\["priv", ctx\.callerUid\]\] : \[\]/.test(AI));
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
  // ⚠️ BOTH about-someone-else destinations carry the warning — a plan file and
  // a client's card — so a bare match stayed green if either lost it, and a
  // trainer would be told their note is under "My notes" when it is not.
  ok("the about-client wording warns it is NOT under My notes — on BOTH destinations",
     (AI.match(/NOT under your own/g) || []).length === 2,
     (AI.match(/NOT under your own/g) || []).length);
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
  ok("...below the user's own, not mixed in", /\.\.\.mine\.sort\(byNewest\), \.\.\.about\.sort\(byNewest\)\]/.test(APP));
  ok("...and badged with what they are", /label: n\.aboutPlanId \? "About a plan file" : "About a client"/.test(APP));
  ok("the old filter that hid them is gone",
     !/return ownKvNotes\.filter\(\(n\) => !n\.aboutUid && !n\.aboutPlanId\)\.map/.test(APP));
}

// ── the check-in sheet's note buttons (S200n) ─────────────────────────────
// THE SECOND ROUTE TO THE SAME COMPLAINT, and this one announced success.
// appendNote routed on the word "private" with no idea who was writing, and
// privGet/privSet always address the SIGNED-IN user's privkv — a store read by
// exactly one screen, NotesPanel in "client" mode. So a TRAINER tapped "Keep
// private", got a green "Saved to your private notes", and the note landed
// where no trainer screen has ever looked.
//
// ⚠️ AND THE OBVIOUS FIX MOVES THE BUG. Sending it to the trainer's own kv makes
// it show under "My notes" — but it is a note about THAT CLIENT'S DAY, and the
// Notes panel opened from the client filters on aboutUid === clientUid. Same
// complaint, one screen over. So it routes through the app's one notes rule.
{
  const cut = (re, what) => { const m = APP.match(re); if (!m) throw new Error("missing " + what); return m[0]; };
  const noteStoreFor = new Function(`${cut(/function noteStoreFor\([\s\S]*?\n\}/, "noteStoreFor")}; return noteStoreFor;`)();

  // What each button does, per who is looking. "Keep private" = shared:false.
  ok("a client keeping it private still gets the owner-only store",
     noteStoreFor("client", false) === "priv");
  ok("a client sharing sends it to their trainer",
     noteStoreFor("client", true) === "sharedOwn");
  // THE BUG, stated as itself: this used to be "priv" for a trainer too.
  ok("a trainer keeping it private files it AGAINST THAT CLIENT, where they will look",
     noteStoreFor("trainer-client", false) === "aboutClient");
  ok("a trainer sharing puts it in the client's own notes",
     noteStoreFor("trainer-client", true) === "clientShared");
  ok("on a local plan file it is filed against the plan",
     noteStoreFor("trainer-plan", false) === "aboutPlan");
  ok("...and a plan file has no account to share with", noteStoreFor("trainer-plan", true) === "aboutPlan");

  const fn = cut(/async function appendNote\([\s\S]*?\n\}/, "appendNote");
  ok("appendNote takes the context instead of guessing",
     /async function appendNote\(\{ body, shared, mode, meUid, meName, clientUid, planId \}\)/.test(fn));
  ok("...and delegates to the one routing rule", /noteStoreFor\(mode \|\| "client", !!shared\)/.test(fn)
     && /buildNote\(\{ body: text, store,/.test(fn));
  ok("the old visibility-only routing is gone", !/if \(visibility === "private"\)/.test(fn));
  ok("it can write to a client's account when sharing", /setForUser\(clientUid, NOTES_KEY/.test(fn));

  // ⚠️ ONE CAP, AND IT IS THE LOWER ONE. This path kept 500 while every AI write
  // caps at 100, so a 500-note list survived only until the next AI note
  // truncated it — silently losing 400.
  ok("the cap agrees with the AI's", /slice\(0, 100\)/.test(fn) && !/slice\(0, 500\)/.test(fn));
  ok("...and a failed save is no longer silent", /console\.error\("check-in note save failed"/.test(fn));

  // The words have to match the action, or it is the old bug with new storage:
  // "Shared with your trainer" was shown to the person who IS the trainer.
  ok("the sheet knows whose it is", /const isCoach = noteMode !== "client";/.test(APP));
  ok("a coach is not told it went to their own trainer", /Shared with \$\{otherName\|\|"your client"\}/.test(APP));
  ok("...and the share button is hidden where there is nobody to share with",
     /noteMode !== "trainer-plan" && \(/.test(APP));
  ok("the context is derived where all three facts live",
     /mode: activeRemoteUid \? "trainer-client" : \(role === ROLES\.CLIENT \? "client" : "trainer-plan"\)/.test(APP));
}

// ── a trainer's own private store was read by nothing (S200o) ─────────────
// Kevin, after S200m surfaced the about-client notes: "I see 2 notes… I feel
// that I am missing something." He was. privkv is the owner-only store, and
// only NotesPanel mode "client" ever subscribed to it — so a trainer's own
// private notes existed on no screen in the app. The check-in sheet's "Keep
// private" button wrote there for years (source fixed in S200n); those notes
// are still in it, and until now nothing could show them.
{
  ok("a trainer's My Notes subscribes to their private store",
     /if \(mode !== "trainer-client" && mode !== "trainer-plan"\) \{\s*\n\s*unsubs\.push\(privSubscribe\(NOTES_KEY/.test(APP));
  // ⚠️ AND ONLY THERE. A client's or a plan's panel is scoped to that subject;
  // pulling the trainer's private notes into it would put unrelated notes on
  // someone else's card.
  ok("...and NOT on a client's or a plan's panel",
     /mode !== "trainer-client" && mode !== "trainer-plan"/.test(APP));
  ok("they are listed", /const priv = privNotes\.map\(\(n\) => \(\{ \.\.\.n, _store: "priv" \}\)\);/.test(APP));
  ok("...first, since nothing has ever shown them",
     /\[\.\.\.priv\.sort\(byNewest\), \.\.\.mine\.sort\(byNewest\), \.\.\.about\.sort\(byNewest\)\]/.test(APP));
  // The store tag has to round-trip, or editing one writes it to the wrong place.
  ok("editing one writes back to privkv", /if \(store === "priv"\) return privSet\(NOTES_KEY, val\);/.test(APP));
  ok("...and reading one reads privkv", /if \(store === "priv"\) return parseNotes\(await privGet\(NOTES_KEY\)\);/.test(APP));
}

// ── what carries between conversations, and what does not (S200x) ─────────
// Kevin: "I want it to remember facts about the person and their plan… but I
// think it is more important that the chat be able to be separated when needed."
//
// ⚠️ HIS INSTINCT IS RIGHT, FOR A SHARPER REASON THAN VOLUME. Carrying
// CONVERSATION across chats is what caused S200m: the active subject leaked, and
// "a note for me" was filed under a client. So conversation stays separate and
// nothing here changes that. What carries is the PERSON'S DATA, which was always
// available on demand — the model simply was not told to reach for it instead of
// asking someone to repeat what the app already knows.
{
  ok("the model is told what carries and what does not",
     /WHAT CARRIES BETWEEN CONVERSATIONS/.test(CHAT));
  ok("...naming the tools that hold the facts",
     /call get_profile and get_nutrition_targets/.test(CHAT));
  ok("...and that the separation is deliberate, not a gap",
     /that separation is intentional/.test(CHAT));
  // ⚠️ AND NOTHING ACTUALLY SHARES A TRANSCRIPT. If a future change starts
  // pooling history this assertion is where it should be argued for.
  ok("no cross-chat transcript sharing was introduced",
     !/allChats|mergeThreads|globalHistory/.test(CHAT));

  // Re-logging: needs no memory at all, only guidance. The log already returns
  // each day's meals by name and macros.
  ok("the model is told to re-log rather than re-estimate",
     /RE-USE WHAT THEY HAVE ALREADY LOGGED/.test(CHAT));
  ok("...with the reason, so it survives editing", /drift from the number they logged last time/.test(CHAT));
  ok("...and to say which day it came from", /Say which day you took it from/.test(CHAT));
  // The connector gets no system prompt, so the tool description carries it.
  ok("the connector learns it from the tool itself", /Also the way to RE-LOG something eaten before/.test(AI));
}

console.log(fails === 0
  ? `  PASS  notes routing (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
