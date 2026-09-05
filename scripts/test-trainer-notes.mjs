// Coaching notes are the coach's (S199j).
//
// THE EXPOSURE. The plan is ONE shared document that both sides edit — that has
// been the design since a client account could be linked at all — so a card
// titled "Trainer Notes", meant for "keeps skipping Thursdays, suspect the job",
// rendered inside the client's own Results page. Hiding that card alone would
// have been a false promise, because it was never the only reader:
//
//   • get_profile returned trainerNotes verbatim, so a client could simply ASK
//     the assistant — in the app or through the MCP connector — and be read
//     their coach's private observations about them.
//   • set_personal_info ACCEPTED trainerNotes and REPLACES rather than appends,
//     so a client could wipe their coach's notes in one sentence.
//
// ⚠️ THIS TEST DRIVES THE REAL runTool. The parity suite in this repo learned
// the hard way that a substring assertion on a function body passes while the
// guard it names is dead code — `if (false)` left it green. So both roles are
// run against the shipping tool over a Firestore stand-in, and the negative
// controls at the bottom prove the harness can actually see the bug.
//
// NOT pinned here, because it is not true: this is a PRODUCT boundary, not a
// storage one. The notes live in the plan document, which for a connected
// client sits in that client's own kv and which firestore.rules correctly lets
// its owner read. Every route the app offers is closed; raw Firestore is not.
//
// Run: node scripts/test-trainer-notes.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
// Resolve exactly as functions/ does, so firebase-admin is the SAME module
// instance aitools.js captured — otherwise the stub below patches a copy.
const require = createRequire(join(ROOT, "functions", "package.json"));
const admin = require("firebase-admin");
const { buildTools, runTool } = require("./aitools.js");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── a Firestore stand-in, enough for the two profile tools ──────────────────
function makeDb() {
  const store = new Map();
  const ref = (path) => ({
    path,
    async get() { const d = store.get(path); return { exists: !!d, data: () => ({ value: d.value }) }; },
    set(v) { store.set(path, { value: v.value }); },
  });
  return {
    _store: store,
    doc: (p) => ref(p),
    async runTransaction(fn) {
      const writes = [];
      const out = await fn({
        async get(r) { const d = store.get(r.path); return { exists: !!d, data: () => ({ value: d.value }) }; },
        set(r, v) { writes.push([r.path, v]); },
      });
      for (const [p, v] of writes) store.set(p, { value: v.value });
      return out;
    },
  };
}
const NOTES = "Keeps skipping Thursdays — suspect the new job. Do not raise directly.";
let db;
const seed = () => {
  db = makeDb();
  db._store.set(`users/u1/kv/${encodeURIComponent("caliq-self")}`, {
    value: JSON.stringify({ data: { weightLbs: 200, gender: "male", age: 35, heightFt: 5, heightIn: 10,
      activityLevel: "moderate", trainerNotes: NOTES }, step: 5 }),
  });
};
const ctxFor = (isTrainer) => ({
  callerUid: "u1", role: isTrainer ? "head_trainer" : "client", isTrainer,
  callerName: isTrainer ? "Coach" : "Client", today: "2026-09-05", nowTime: "12:00",
});
// runTool reaches for admin.firestore() itself rather than taking a db, so the
// stand-in is installed on the namespace. The statics (FieldValue, Timestamp)
// are carried across — aitools uses them, and a bare arrow would drop them.
const realFirestore = admin.firestore;
const stub = () => db;
for (const k of Object.getOwnPropertyNames(realFirestore)) {
  if (["length", "name", "prototype", "caller", "arguments"].includes(k)) continue;
  try { stub[k] = realFirestore[k]; } catch { /* non-configurable static */ }
}
// `firestore` is a getter on the namespace, so it is redefined, not assigned.
Object.defineProperty(admin, "firestore", { value: stub, configurable: true });
const call = (name, input, isTrainer) => runTool(name, input, ctxFor(isTrainer));

// ── READ ────────────────────────────────────────────────────────────────────
{
  seed();
  const asCoach = await call("get_profile", {}, true);
  ok("a coach reads their own notes back", asCoach.trainerNotes === NOTES, asCoach.trainerNotes);

  seed();
  const asClient = await call("get_profile", {}, false);
  ok("a client is not given the notes", asClient.trainerNotes === undefined, asClient.trainerNotes);
  // ⚠️ ABSENT, NOT NULL. `trainerNotes: null` would tell the model "there are no
  // notes" about a person whose coach has written pages — a different lie, and a
  // more convincing one.
  ok("...and the key is absent rather than nulled", !("trainerNotes" in asClient), Object.keys(asClient));
  // The rest of the profile must still arrive, or this stops being a gate and
  // starts being an outage.
  ok("...while the rest of the profile is untouched",
     asClient.weightLbs === 200 && asClient.activityLevel === "moderate", asClient);
}

// ── WRITE ───────────────────────────────────────────────────────────────────
{
  seed();
  const r = await call("set_personal_info", { trainerNotes: "wiped" }, true);
  ok("a coach can still write notes", (r.updated || []).includes("trainer notes"), r);
  const stored = JSON.parse(db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`).value);
  ok("...and the write lands", stored.data.trainerNotes === "wiped", stored.data.trainerNotes);
}
{
  seed();
  // set_personal_info REPLACES. Unguarded, one sentence from the client erases
  // everything the coach ever recorded.
  const r = await call("set_personal_info", { trainerNotes: "" }, false);
  const stored = JSON.parse(db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`).value);
  ok("a client cannot erase their coach's notes", stored.data.trainerNotes === NOTES, stored.data.trainerNotes);
  // Refused OUT LOUD. Dropping the field quietly would have the assistant report
  // a successful save for a change that never happened — the house rule is that
  // silent success is the same bug as silent failure.
  ok("...and is told why, rather than being ignored",
     /coach/i.test(JSON.stringify(r)), r);
}
{
  seed();
  // A refusal must not masquerade as an edit when other fields DID apply.
  const r = await call("set_personal_info", { weightLbs: 190, trainerNotes: "sneak" }, false);
  const stored = JSON.parse(db._store.get(`users/u1/kv/${encodeURIComponent("caliq-self")}`).value);
  ok("a legitimate field beside a refused one still saves", stored.data.weightLbs === 190, stored.data.weightLbs);
  ok("...the notes still do not", stored.data.trainerNotes === NOTES, stored.data.trainerNotes);
  ok("...and 'trainer notes' is NOT listed as a change", !(r.updated || []).join(",").includes("trainer notes"), r.updated);
  ok("...while the refusal rides along", Array.isArray(r.refused) && r.refused.length === 1, r.refused);
}

// ── the schema the model is shown ───────────────────────────────────────────
{
  const field = (role) => {
    const t = buildTools(role).find((x) => x.name === "set_personal_info");
    return t.input_schema.properties.trainerNotes;
  };
  ok("a coach's schema offers the notes field", !!field("head_trainer"));
  ok("a sub-trainer's does too", !!field("sub_trainer"));
  ok("a client's schema does not", !field("client"));
  // The schema is what the model is TOLD; the handler above is what it can be
  // talked into. Both, or neither counts.
}

// ── the UI half ─────────────────────────────────────────────────────────────
{
  // ⚠️ THE GATE MOVED, IT DID NOT GO (S199p). The card became an entry point to
  // a panel clients already have on their Home, so gating the DOORWAY was
  // arbitrary under Kevin's "same control" rule. What is still the coach's is
  // the legacy blob, and that is what the gate now wraps.
  // ⚠️ ANCHORED TO THE CARD, NOT THE BUTTON. `{onOpenNotes && (` appears twice —
  // the card wrapper and the "Open notes" button inside it — so the loose form
  // stayed green with the card re-gated, because it was matching the button.
  ok("the card itself is open to whoever owns the plan",
     /\{onOpenNotes && \(\n\s*<div className="card"/.test(APP));
  ok("...while the coach's older note stays gated",
     /\{canSeeNotes && data\.trainerNotes && onMoveLegacyNote && \(/.test(APP));
  ok("...and a client is routed to their OWN notes context, by a POSITIVE role test",
     /\{planNotesOpen && \(!isTrainerHome\s*\n\s*\? <NotesPanel mode="client"/.test(APP));
  // Matches the DEFAULT, not the prop's position in the list: this used to
  // require `canSeeNotes = false }) {`, so adding any prop after it failed a
  // test about privacy for a reason that had nothing to do with privacy (S199l).
  ok("...on a prop that defaults CLOSED", /canSeeNotes = false\s*[,}]/.test(APP));
  // ⚠️ `role` is null until the profile loads, so a NEGATIVE test would show the
  // notes on every cold start until the read returned. isTrainerHome is the
  // app's existing positive predicate (head_trainer || sub_trainer).
  ok("...fed by the positive trainer predicate", /canSeeNotes=\{isTrainerHome\}/.test(APP));
  ok("...which is itself positive, not a not-a-client test",
     /const isTrainerHome = role === ROLES\.HEAD_TRAINER \|\| role === ROLES\.SUB_TRAINER;/.test(APP));
}

// ── EVERY READER, ENUMERATED ────────────────────────────────────────────────
// ⚠️ THE ASSERTIONS ABOVE ARE PATTERN MATCHES AND CANNOT SEE A NEW READER. The
// review that followed this change made the point concrete: four lenses found
// the data-export button handing the notes over, and a fifth found Start Over
// erasing them — neither touched the card, so nothing above would have moved.
// A gate on ONE render site is not a boundary; the boundary is the set of
// places the field is read at all.
//
// So the set is pinned. Adding a `trainerNotes` reference to src/App.jsx fails
// this test with the offending line, and the author has to say which bucket it
// belongs in. It is deliberately annoying — that is the whole mechanism.
{
  const lines = APP.split("\n");
  const ALLOWED = [
    // The gated card, inside {canSeeNotes && (...)}. The textarea is GONE: the
    // field is no longer editable anywhere (S199n). It is displayed read-only
    // until a coach files it into the real notes system, and then deleted.
    /\{canSeeNotes && data\.trainerNotes$/,
    /\{canSeeNotes && data\.trainerNotes && onMoveLegacyNote && \(/,
    /marginBottom:"9px"\}\}>\{data\.trainerNotes\}<\/div>/,
    // moveLegacyNote — reachable only from that card
    /const text = String\(\(data && data\.trainerNotes\) \|\| ""\)\.trim\(\);/,
    /setDataAndSave\(\(p\) => \{ const n = \{ \.\.\.p \}; delete n\.trainerNotes; return n; \}\);/,
    // the shape declaration
    /checkIns:\[\], trainerNotes:"", bodyFat:"", goalBodyFat:"",/,
    // The coach's audit row — records THAT it changed, never the content. Two
    // lines since S199o, because clearing the field is FILING the note, not
    // writing one, and the client reads this feed.
    /if \(\(p\.trainerNotes \|\| ""\) !== \(n\.trainerNotes \|\| ""\)\) \{/,
    /out\.push\(n\.trainerNotes \? "updated trainer notes" : "filed an older note away"\);/,
    // the export stripper
    /if \(d && typeof d === "object" && typeof d\.trainerNotes === "string" && d\.trainerNotes\) \{/,
    /delete d\.trainerNotes; n\+\+;/,
    // Start Over carrying them across
    /const keep = prev && prev\.trainerNotes;/,
    /return \{ \.\.\.EMPTY_DATA, \.\.\.\(keep \? \{ trainerNotes: keep \} : \{\}\) \};/,
  ];
  // Comments discuss this field at length — including JSX {/* ... */} blocks,
  // whose continuation lines start with neither // nor *. Tracked properly, so
  // the guard reacts to CODE and prose stays free.
  const unknown = [];
  let inBlock = false;
  lines.forEach((ln, i) => {
    const wasInBlock = inBlock;
    const opens = ln.lastIndexOf("/*"), closes = ln.lastIndexOf("*/");
    if (opens > closes) inBlock = true;
    else if (closes > opens) inBlock = false;
    if (!ln.includes("trainerNotes")) return;
    if (wasInBlock || /^\s*(\/\/|\*|\/\*)/.test(ln)) return;   // prose about the field
    if (ALLOWED.some((re) => re.test(ln))) return;
    unknown.push(`${i + 1}: ${ln.trim().slice(0, 90)}`);
  });
  ok("no reader of trainerNotes outside the known set — if this fails, the new "
     + "line must be gated on the viewer being a coach, then added to ALLOWED",
     unknown.length === 0, unknown);
}

// ── the export (S199k) ──────────────────────────────────────────────────────
// EXECUTED. stripCoachNotes is pure with no free variables, so the shipping
// source is lifted and run — the four lenses that found this hole found it by
// reading, and a pattern match would not have caught it either.
{
  const src = /function stripCoachNotes\(data, hide\) \{[\s\S]*?\n\}/.exec(APP);
  ok("stripCoachNotes is liftable", !!src);
  const strip = new Function(`${src[0]}\nreturn stripCoachNotes;`)();

  const bundle = () => ({
    "caliq-self": { data: { weightLbs: 200, trainerNotes: NOTES }, step: 5 },
    "caliq-p_2": { data: { weightLbs: 200, trainerNotes: "second plan" }, step: 5 },
    "caliq-log-self-2026-09-01": { calories: 1800 },
    "caliq-plans": { active: "self", plans: [{ id: "self" }] },
    "caliq-notes": [{ text: "the client's OWN notes — never touch these" }],
  });

  const coached = bundle();
  const n = strip(coached, true);
  ok("a coached client's export loses the notes", coached["caliq-self"].data.trainerNotes === undefined);
  ok("...from EVERY plan, not just the active one", coached["caliq-p_2"].data.trainerNotes === undefined);
  ok("...and reports how many, so the omission can be declared", n === 2, n);
  ok("...while the rest of the plan survives", coached["caliq-self"].data.weightLbs === 200);
  ok("...and the client's own notes are untouched",
     coached["caliq-notes"][0].text === "the client's OWN notes — never touch these");

  // A person with no coach can only have written that text themselves. Removing
  // it would be deleting their own words to protect nobody.
  const solo = bundle();
  ok("a client with no coach keeps their own text", strip(solo, false) === 0
     && solo["caliq-self"].data.trainerNotes === NOTES);

  ok("junk in the bundle does not throw",
     strip({ a: null, b: "a string", c: 7, d: { data: null }, e: { data: { trainerNotes: 5 } } }, true) === 0);
  ok("an empty note is not counted as a strip", strip({ x: { data: { trainerNotes: "" } } }, true) === 0);

  // The bundle must SAY something was left out. Silence implying completeness is
  // the failure this file's own export comment warns about.
  ok("the omission is declared in the bundle",
     /strippedNotes \? \["Your coach's private coaching notes/.test(APP));
  ok("...and the strip runs for coached clients only",
     /stripCoachNotes\(data, role === ROLES\.CLIENT && !!hasCoach\)/.test(APP));
  ok("...with hasCoach actually threaded from App state",
     /hasCoach=\{meHasCoach\}/.test(APP) && /exportMyData\(\{ meName, meEmail, role, hasCoach \}\)/.test(APP));
}

// ── Start Over (S199k) ──────────────────────────────────────────────────────
// EXECUTED, for the reason the header gives. EMPTY_DATA declares
// trainerNotes:"", and planMerge counts a key whose value differs from the
// baseline as a deliberate edit — so the blank was written straight OVER the
// coach's text. The button has no confirm and no role gate, and it sits outside
// the Simple/Detailed switch, one tap from a client's default view.
{
  const empty = /const EMPTY_DATA = \{[\s\S]*?\n\};/.exec(APP);
  const fn = /function resetPlanData\(prev\) \{[\s\S]*?\n\}/.exec(APP);
  ok("resetPlanData is liftable", !!empty && !!fn);
  // defaultCardio/defaultStrength are referenced by EMPTY_DATA and irrelevant here.
  const reset = new Function("defaultCardio", "defaultStrength",
    `${empty[0]}\n${fn[0]}\nreturn resetPlanData;`)({}, {});

  const after = reset({ weightLbs: 200, goalWeight: 180, trainerNotes: NOTES });
  ok("Start Over keeps the coach's notes", after.trainerNotes === NOTES, after.trainerNotes);
  ok("...and still clears the plan", !after.weightLbs && !after.goalWeight, after);
  ok("...on a plan with no notes, nothing is invented",
     reset({ weightLbs: 200 }).trainerNotes === "", reset({ weightLbs: 200 }).trainerNotes);
  ok("...and an empty note does not become undefined", reset({ trainerNotes: "" }).trainerNotes === "");
  ok("...nor does a missing plan throw", reset(null).trainerNotes === "" && reset(undefined).trainerNotes === "");
  ok("the App uses it rather than a private copy", /const fresh = resetPlanData\(data\);/.test(APP));
}

// ── one notes system, not two (S199n, Kevin) ────────────────────────────────
// "Trainers can have their own private notes for clients and notes that are
// open for clients to see — the trainer decides when the note is created."
//
// That already existed (S91): NotesPanel writes each note to a store chosen by
// its visibility, and privacy is STRUCTURAL — a private about-client note lives
// in the TRAINER's own kv, which a client cannot read, and a client's own
// private note lives in privkv, which the rules make owner-only. A flag alone
// would be decoration; the S91 plan says exactly that and the emulator suite
// has nine attack cases behind it.
//
// The one surface that lacked the choice was the plan editor's `trainerNotes`
// blob. It now points at the same panel — so these two functions are the seam
// where a second implementation could drift back in, and they are EXECUTED.
{
  const storeSrc = /function noteStoreFor\(mode, shared\) \{[\s\S]*?\n\}/.exec(APP);
  const buildSrc = /function buildNote\(\{[\s\S]*?\n\}/.exec(APP);
  const titleSrc = /const noteAutoTitle = [^\n]*\n/.exec(APP);
  ok("the note helpers are liftable", !!storeSrc && !!buildSrc && !!titleSrc);
  const [noteStoreFor, buildNote] = new Function(
    `${titleSrc[0]}\n${storeSrc[0]}\n${buildSrc[0]}\nreturn [noteStoreFor, buildNote];`)();

  // ⚠️ THE ROUTING IS THE PRIVACY. A private note filed to the client's own kv
  // is not private, however it is labelled.
  ok("a coach's private note about a client goes to the COACH's own kv",
     noteStoreFor("trainer-client", false) === "aboutClient");
  ok("...and a shared one goes to the CLIENT's kv, where they can read it",
     noteStoreFor("trainer-client", true) === "clientShared");
  ok("a client's own private note goes to privkv, not their kv",
     noteStoreFor("client", false) === "priv");
  ok("...and their shared one to their kv, where the coach can read it",
     noteStoreFor("client", true) === "sharedOwn");
  // A local plan file is a person with no account. There is nobody to share
  // WITH, so the shared flag must not silently route somewhere readable.
  ok("a local plan file has no shared store", noteStoreFor("trainer-plan", true) === "aboutPlan"
     && noteStoreFor("trainer-plan", false) === "aboutPlan");

  const n = (store, extra) => buildNote({ body: "keeps skipping Thursdays", store,
    authorUid: "u1", authorName: "Coach", clientUid: "c1", planId: "p1", now: 1000, ...extra });
  ok("an aboutClient note is marked private and tagged with the client",
     n("aboutClient").visibility === "private" && n("aboutClient").aboutUid === "c1", n("aboutClient"));
  ok("a clientShared note is marked shared and carries NO aboutUid",
     n("clientShared").visibility === "shared" && n("clientShared").aboutUid === undefined, n("clientShared"));
  ok("a plan-file note is private and tagged with the plan",
     n("aboutPlan").visibility === "private" && n("aboutPlan").aboutPlanId === "p1", n("aboutPlan"));
  ok("the title is auto-derived when none is given", n("aboutClient").title === "keeps skipping Thursdays");
  ok("...and a given title wins", n("aboutClient", { title: "Thursdays" }).title === "Thursdays");
  ok("aiHidden is absent unless asked for",
     n("aboutClient").aiHidden === undefined && n("aboutClient", { aiHidden: true }).aiHidden === true);

  // NotesPanel must use the SAME two functions, or the drift is back.
  ok("NotesPanel routes through noteStoreFor",
     /const storeForNew = \(\) => noteStoreFor\(mode, dShared\);/.test(APP));
  ok("...and builds through buildNote", /const note = buildNote\(\{ title, body, store, authorUid: uid/.test(APP));
  ok("the plan editor opens the same panel rather than a second one",
     /<NotesPanel mode="trainer-client" meUid=\{meUid\} meName=\{meName\}\s+clientUid=\{activeRemoteUid\}/.test(APP));

  // ⚠️ THE WRITE LANDS BEFORE THE SOURCE IS CLEARED. Deleting the only copy on
  // the strength of an unconfirmed write is how this repo has lost data before.
  const mv = /const moveLegacyNote = async \(shared\) => \{[\s\S]*?\n  \};/.exec(APP);
  ok("moveLegacyNote is findable", !!mv);
  const body = mv ? mv[0] : "";
  // ⚠️ indexOf RETURNS -1 WHEN ABSENT, and -1 is less than everything. The first
  // version of this assertion was an ordering check alone, so deleting the
  // `return false` entirely — which makes a failed write fall through and clear
  // the note anyway, the exact bug — left it green. Existence first, then order.
  const failExit = body.indexOf("return null;");
  const clears = body.indexOf("delete n.trainerNotes");
  ok("the catch returns a failure value", failExit >= 0, failExit);
  ok("...before anything is cleared", failExit >= 0 && clears >= 0 && failExit < clears, { failExit, clears });
  ok("...and the card says so rather than looking like it worked",
     /Couldn&rsquo;t file it — nothing moved/.test(APP));
  ok("the legacy note is never auto-filed — a person picks",
     /onMoveLegacyNote\(false\)/.test(APP) && /onMoveLegacyNote\(true\)/.test(APP));
}

// ── scrubbing the note out of past AI replies (S199p) ───────────────────────
// Before the gate, get_profile handed a client's assistant the note verbatim,
// and the REPLY was saved into that client's own chat thread — where reopening
// the panel restores it and feeds it back to the model. No gate reaches data
// already written, so filing a note PRIVATELY now also redacts it from those
// threads. EXECUTED, because a matcher that is too eager destroys a person's
// conversation and one that is too shy does nothing, and both look identical
// from a source regex.
{
  const q = /const quotesNote = |function quotesNote\(text, note\) \{[\s\S]*?\n\}/.exec(APP);
  const r = /function redactThread\(thread, note\) \{[\s\S]*?\n\}/.exec(APP);
  const norm = /const normalizeForMatch = [^\n]*\n/.exec(APP);
  const run = /const NOTE_MIN_RUN = [^\n]*\n/.exec(APP);
  const marker = /const NOTE_REDACTED = [^\n]*\n/.exec(APP);
  ok("the scrub helpers are liftable", !!q && !!r && !!norm && !!run && !!marker);
  const [quotesNote, redactThread, NOTE_REDACTED] = new Function(
    `${run[0]}${norm[0]}${marker[0]}${q[0]}\n${r[0]}\nreturn [quotesNote, redactThread, NOTE_REDACTED];`)();

  const NOTE = "Keeps skipping Thursdays — suspect the new job. Do not raise directly.";

  ok("a verbatim quote is found", quotesNote(`Kevin noted: "${NOTE}"`, NOTE));
  ok("...through different whitespace and case",
     quotesNote("KEEPS   SKIPPING\nTHURSDAYS — SUSPECT THE NEW JOB.", NOTE));
  ok("...and when only part of the note was quoted",
     quotesNote("he wrote that you keep skipping thursdays — suspect the new job", NOTE));

  // ⚠️ FALSE POSITIVES DESTROY A TRANSCRIPT. An ordinary coaching reply that
  // happens to share a few words must survive.
  ok("an unrelated reply is left alone",
     !quotesNote("You skipped Thursday this week — want to move it to Friday?", NOTE));
  ok("...and so is an empty one", !quotesNote("", NOTE));
  // The honest limit, pinned so nobody later claims more than it does.
  ok("a PARAPHRASE is not found — this is a verbatim scrub",
     !quotesNote("He thinks your new job is why Thursdays keep slipping.", NOTE));
  // ⚠️ THE SHORT-NOTE FLOOR, EXERCISED. The first version of this assertion used
  // a haystack that did not contain the short note at all, so it passed with the
  // floor deleted — a mutation proved it. The phrase must actually BE there.
  ok("a note too short to be distinctive is not matched even when present",
     !quotesNote("we talked about his back tight after squats", "back tight"));
  ok("...while a note just over the floor still matches",
     quotesNote("she said left knee clicks on squats today", "left knee clicks on squats"));

  // ⚠️ The user turn QUOTES THE NOTE TOO. It has to, or dropping the role check
  // changes nothing and the assertion below is decorative — which is exactly
  // what a mutation caught the first time.
  const thread = [
    { role: "user", content: `did you say "${NOTE}"? that's harsh` },
    { role: "assistant", content: `Your coach wrote: "${NOTE}"` },
    { role: "user", content: "ok" },
    { role: "assistant", content: "Want to look at this week's protein?" },
  ];
  const out = redactThread(thread, NOTE);
  ok("the quoting reply is redacted", out.redacted === 1, out.redacted);
  ok("...and replaced with a marker, not deleted", out.thread[1].content === NOTE_REDACTED);
  ok("...while the innocent reply is untouched", out.thread[3].content === "Want to look at this week's protein?");
  // A client who typed it already knows it, and rewriting someone's own words
  // in their own transcript is not ours to do.
  ok("the client's own messages are never rewritten, even quoting it verbatim",
     out.thread[0].content.includes(NOTE) && out.thread[0].content !== NOTE_REDACTED, out.thread[0].content);
  ok("re-running it redacts nothing further", redactThread(out.thread, NOTE).redacted === 0);
  ok("junk input does not throw", redactThread(null, NOTE).redacted === 0
     && redactThread([null, 7, {}], NOTE).redacted === 0);

  // Wiring: private only, and the outcome is reported without overclaiming.
  ok("the scrub runs on the PRIVATE path only", /if \(!shared && activeRemoteUid\) \{/.test(APP));
  ok("...covering the pre-S90 single thread as well as the indexed ones",
     /const keys = \["caliq-ai-chat"\]/.test(APP) && /caliq-ai-chat-\$\{c\.id\}/.test(APP));
  ok("...and the card admits what a paraphrase would defeat",
     /paraphrased it rather than quoting it/.test(APP));
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
