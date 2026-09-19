#!/usr/bin/env node
// The client intake: one form, three doors, no new infrastructure (S236).
//
// Kevin: "I need to make the glide app almost like an intake for all new and
// potential clients." The person he most wants to capture has NO ACCOUNT, and
// every rule in this app assumes an authenticated user — so the intake reaches
// them through doors that already exist rather than through a public endpoint.
//
// ⚠️ EVERY HELPER IS LIFTED FROM src/App.jsx AND RUN, not retyped.
// The savings account: what one real day put in the bank, and what a run of
// them says a pound cost THIS person (S221, Kevin).
//
// Kevin's own two examples are the spec:
//   "If a user doesn't work out and eats under 500 cal of their maintenance
//    that means that 500 cal goes into the savings account. If a user eats
//    under 500 cal and also exercises and burns 300 cal that means that they
//    have 800 cal in their savings account for that day."
// Both fall out of one subtraction — what the body spent, less what they ate —
// so the suite runs them as written.
//
// ⚠️ EVERY HELPER IS LIFTED FROM src/App.jsx AND RUN, not retyped. A suite that
// tests a transcription stays green while the shipping file drifts (S199k).
//
// Run: node scripts/test-savings.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

function liftDecl(src, name) {
  // ⚠️ `async function` too — readIntake/writeIntake are async, and a lifter
  // that only knows `function` throws "could not lift" on exactly the helpers
  // this suite exists for.
  const re = new RegExp("\\n([ \\t]*)(?:async function " + name + "\\(|function " + name + "\\(|const " + name + "\\s*=)");
  const m = src.match(re);
  if (!m) throw new Error("could not lift " + name);
  const start = m.index + 1 + m[1].length;
  const isFn = src.startsWith("function", start) || src.startsWith("async function", start);
  let i = start, depth = 0, opened = false;
  const skipString = () => { const qq = src[i]; for (i++; i < src.length; i++) { if (src[i] === "\\") { i++; continue; } if (src[i] === qq) return; } };
  if (isFn) {
    while (i < src.length && src[i] !== "(") i++;
    let pd = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
      if (c === "(") pd++; else if (c === ")") { pd--; if (pd === 0) { i++; break; } }
    }
  }
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (isFn) { if (c === "{") { depth++; opened = true; } else if (c === "}") { depth--; if (opened && depth === 0) return src.slice(start, i + 1); } }
    else { if ("([{".indexOf(c) >= 0) depth++; else if (")]}".indexOf(c) >= 0) depth--; else if (c === ";" && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("unterminated " + name);
}

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const NAMES = ["INTAKE_VERSION", "INTAKE_SECTIONS", "intakeKey", "intakeProgress", "readIntake", "writeIntake"];
const M = new Function(NAMES.map((n) => liftDecl(APP, n)).join("\n") +
  `; return { ${NAMES.join(", ")} };`)();

console.log("\n  The intake: one form, three doors\n");

// ── the schema ─────────────────────────────────────────────────────────────
{
  const ids = M.INTAKE_SECTIONS.map((s) => s.id);
  ok("every section has a unique id", new Set(ids).size === ids.length, ids);
  const keys = M.INTAKE_SECTIONS.flatMap((s) => s.fields.map((f) => f.k));
  // ⚠️ A DUPLICATE KEY IS SILENT AND DESTRUCTIVE: two fields writing one slot
  // means answering the second wipes the first, and the progress count is wrong.
  ok("every field key is unique across ALL sections", new Set(keys).size === keys.length,
     keys.filter((k, i) => keys.indexOf(k) !== i));
  ok("every field has a label and a type",
     M.INTAKE_SECTIONS.every((s) => s.fields.every((f) => f.label && f.type)));
  const TYPES = new Set(["text", "long", "tel", "date", "choice"]);
  ok("every field type is one the sheet can render",
     M.INTAKE_SECTIONS.every((s) => s.fields.every((f) => TYPES.has(f.type))),
     M.INTAKE_SECTIONS.flatMap((s) => s.fields.map((f) => f.type)).filter((t) => !TYPES.has(t)));
  ok("every choice field actually offers choices",
     M.INTAKE_SECTIONS.every((s) => s.fields.every((f) => f.type !== "choice" || (f.options || []).length > 1)));
  // ⚠️ NOT A WAIVER. A liability release is a legal document needing an
  // attorney, not a form field — this fails if one creeps in.
  const prose = JSON.stringify(M.INTAKE_SECTIONS).toLowerCase();
  ok("it collects no waiver, release or signature",
     !/waiver|liabilit|indemnif|i agree|signature|hold harmless/.test(prose));
}

// ── where it lives ─────────────────────────────────────────────────────────
{
  ok("a connected client's intake is their own document", M.intakeKey(null) === "caliq-intake");
  ok("a prospect's is filed against the plan id", M.intakeKey("p17") === "caliq-intake-p17");
  // These must never collide, or a trainer's prospect would overwrite their own.
  ok("...and the two can never collide", M.intakeKey(null) !== M.intakeKey("p17"));
}

// ── progress ───────────────────────────────────────────────────────────────
{
  const total = M.INTAKE_SECTIONS.flatMap((s) => s.fields).length;
  ok("an empty intake is zero", M.intakeProgress({}).done === 0 && M.intakeProgress({}).total === total);
  ok("junk is answered, not thrown", M.intakeProgress(null).done === 0 && M.intakeProgress(undefined).pct === 0);
  // ⚠️ WHITESPACE IS NOT AN ANSWER. Counting " " would let a form look finished
  // while telling the trainer nothing.
  ok("a whitespace answer does not count", M.intakeProgress({ why: "   " }).done === 0);
  ok("a real answer does", M.intakeProgress({ why: "wedding" }).done === 1);
  const first = M.INTAKE_SECTIONS[0].fields[0].k;
  ok("...and an unknown key is ignored", M.intakeProgress({ zzz: "x", [first]: "y" }).done === 1);
}

// ── read: absence is not failure, and failure is not absence ───────────────
{
  const notFound = () => { const e = new Error("no doc"); e.code = "not-found"; throw e; };
  const run = async (get) => M.readIntake(get, null);

  const fresh = await run(notFound);
  ok("a first-time intake reads as empty and OK", fresh.ok === true && Object.keys(fresh.answers).length === 0, fresh);
  const nullish = await run(async () => null);
  ok("a null document (getForUser) is also empty and OK", nullish.ok === true, nullish);

  // ⚠️ THE ONE THAT MATTERS. window.storage.get THROWS for a missing doc while
  // getForUser returns null, so a genuine network failure lands in the same
  // catch as a first-time read. If that reported "empty and fine", the sheet
  // would open blank over answers that exist and the next save would wipe them.
  const broken = await run(async () => { throw new Error("offline"); });
  ok("an unreachable read is NOT reported as an empty intake", broken.ok === false, broken);

  const real = await run(async () => ({ value: JSON.stringify({ version: 1, answers: { why: "wedding" }, updatedAt: 7 }) }));
  ok("a real document comes back", real.answers.why === "wedding" && real.updatedAt === 7 && real.ok === true, real);
  const corrupt = await run(async () => ({ value: "{not json" }));
  ok("corrupt JSON refuses rather than pretending to be empty", corrupt.ok === false, corrupt);
}

// ── write ──────────────────────────────────────────────────────────────────
{
  const seen = [];
  const set = async (k, v) => { seen.push([k, v]); };
  const doc = await M.writeIntake(set, null, { why: "wedding" }, { uid: "u1", name: "Kev", role: "head_trainer" });
  ok("it writes to the client's own key", seen[0][0] === "caliq-intake", seen[0][0]);
  // ⚠️ A STRING, VERBATIM. window.storage.set stores `value` as given and the
  // app always passes JSON — poking an object in made the trainer home read
  // "0 plans" once (S216b/S217).
  ok("...as a JSON string, never an object", typeof seen[0][1] === "string");
  const parsed = JSON.parse(seen[0][1]);
  ok("...carrying a version, so a future shape can migrate", parsed.version === M.INTAKE_VERSION);
  ok("...and who last touched it", parsed.updatedBy.uid === "u1" && parsed.updatedBy.role === "head_trainer");
  ok("...and the answers", parsed.answers.why === "wedding");
  ok("it returns the document it wrote", doc.answers.why === "wedding");

  const seen2 = [];
  await M.writeIntake(async (k, v) => seen2.push([k, v]), "p17", {}, null);
  ok("a prospect's write is filed against the plan", seen2[0][0] === "caliq-intake-p17", seen2[0][0]);
  ok("...and an empty intake is still savable", JSON.parse(seen2[0][1]).answers && true);
}

// ── the three doors, in the shipping source ────────────────────────────────
{
  const code = APP;
  // Door 1: the trainer can send it as a to-do, riding sendTrainerRequest — so
  // it needs no new notification tag and no backend at all.
  ok("door 1: an intake template exists to send", /type: "intake",\s+iconName: "clipboard"/.test(code));
  ok("...and the modal opens the sheet rather than dead-ending at the plan editor",
     /type === "intake" && onOpenIntake/.test(code));
  // Door 2: the client reaches it unprompted.
  ok("door 2: the client's home offers it", /intakeProg && intakeProg\.done < intakeProg\.total/.test(code));
  // Door 3: a prospect with NO ACCOUNT, filled in by the trainer.
  ok("door 3: a local plan file has an intake", /openIntakeFor\(\{ localId: p\.id/.test(code));
  ok("...and a connected client does too", /openIntakeFor\(\{ uid: c\.uid/.test(code));

  // ⚠️ MOUNTED AT TOP LEVEL. Inside the collapsible Local Plans fragment it
  // would silently do nothing whenever that section was closed — which is its
  // default state, and is exactly the S183g bug that hid Message and Sessions.
  const dash = code.slice(code.indexOf("function TrainerDashboard("));
  const mount = dash.indexOf("{intakeFor && (");
  const plansEnd = dash.indexOf("</>)}");
  ok("the trainer's sheet mounts outside the collapsible section",
     mount > plansEnd && plansEnd > 0, [mount, plansEnd]);

  // The to-do is ticked on SAVE, never on open: opening a form is not doing it.
  ok("the intake to-do is completed on save, not on open",
     /r\.type === "intake" && r\.status === "open"/.test(code));
  ok("...and the modal's Start button does not mark it done",
     /onClose\(\); onOpenIntake\(\);/.test(code));
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED`); process.exit(1); }
console.log("  Intake: one form, three doors, nothing new to deploy.\n");
