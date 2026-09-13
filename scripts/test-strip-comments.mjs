// The comment stripper five other suites depend on (S229b).
//
// ⚠️ WHY THIS FILE EXISTS. Every suite that needed to assert "the source does
// NOT contain X" wrote the same three-replace helper, and all of them were
// silently wrong on src/App.jsx. That file contains `accept="image/*,video/*"`
// in two file pickers; the `/*` inside that STRING looked like the start of a
// block comment, so the last replace matched forward to the next real `*/` and
// deleted everything between — 35,140 characters in one case, 24,927 in the
// other.
//
// The failing assertion is the harmless half. The dangerous half is the
// assertion that says "this file does NOT do X": with the region gone it passes
// over code that is really there. That is green-over-a-bug, which is the thing
// this repo's whole testing discipline exists to prevent — so the stripper is
// now a real scanner, and this suite is what keeps it one.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripComments, stripJsxComments } from "./lib/strip-comments.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

console.log("\n  Stripping comments without eating the code\n");

// ── 1. It removes what it should ─────────────────────────────────────────
ok("a line comment goes", stripComments("a\n// gone\nb").includes("gone") === false);
ok("...and the code around it stays", (() => { const r = stripComments("a\n// gone\nb"); return r.includes("a") && r.includes("b"); })());
ok("a block comment goes", !stripComments("a /* gone */ b").includes("gone"));
ok("a multi-line block comment goes", !stripComments("a\n/* one\n two\n*/\nb").includes("two"));
ok("a trailing line comment goes", !stripComments("const x = 1; // gone").includes("gone"));
ok("a JSX comment's text goes", !stripJsxComments("<div>{/* gone */}</div>").includes("gone"));

// ── 2. THE BUG. A slash-star inside a string is not a comment ────────────
{
  const src = 'a\n<input accept="image/*,video/*" />\nconst KEEP_ME = 1;\n/* a real comment */\nconst ALSO = 2;';
  const out = stripComments(src);
  ok("code after image/* survives", out.includes("KEEP_ME"), out);
  ok("...and so does code after the real comment", out.includes("ALSO"));
  ok("the accept attribute is left intact", out.includes('accept="image/*,video/*"'));
  ok("the real comment is still removed", !out.includes("a real comment"));
}
ok("a lone /* in a string does not swallow the file",
  stripComments("const a = \"/*\";\nconst B = 2;").includes("B"));
ok("a // in a string is not a comment",
  stripComments('const u = "https://x.example";\nconst C = 3;').includes("https://x.example"));
ok("...and the code after it survives", stripComments('const u = "https://x";\nconst C = 3;').includes("C"));
ok("a */ in a string does not end a comment early",
  !stripComments('/* x */ const s = "*/"; const D = 4;').includes("x"));
ok("single quotes work the same", stripComments("const a = '/*';\nconst E = 5;").includes("E"));
ok("an escaped quote does not end the string",
  stripComments('const a = "he said \\" /* not a comment";\nconst F = 6;').includes("F"));

// ── 3. Template literals, including interpolation ───────────────────────
ok("a template literal survives", stripComments("const t = `a/*b`;\nconst G = 7;").includes("G"));
ok("an interpolation survives", stripComments("const t = `x ${y} z`;\nconst H = 8;").includes("H"));
ok("a quote inside an interpolation does not desynchronise",
  stripComments('const t = `${a ? "/*" : "x"}`;\nconst I = 9;').includes("I"));
ok("a nested brace inside an interpolation is tracked",
  stripComments("const t = `${ {a:1}.a }`;\nconst J = 10;").includes("J"));

// ── 4. Against the REAL sources, which is what actually matters ─────────
{
  const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  const out = stripJsxComments(APP);
  // The old helper deleted ~60,000 characters of this file. These probes sit
  // inside the regions it ate.
  ok("the file picker's own attribute survives", out.includes('accept="image/*'), out.length);
  for (const probe of ['homeIntent.kind === "food"', 'homeIntent.kind === "activity"']) {
    ok(`code after the file picker survives: ${probe}`, out.includes(probe));
  }
  // And it really is still stripping.
  ok("prose is gone from the stripped app", !out.includes("THE SEARCH OPENS THE DRAWER"));
  ok("the result is not suspiciously short", out.length > APP.length * 0.6, { out: out.length, src: APP.length });
  ok("...nor suspiciously long", out.length < APP.length, { out: out.length, src: APP.length });
}
{
  // ⚠️ THE ONE CASE THIS SCANNER DOES NOT HANDLE, PINNED SO IT CANNOT QUIETLY
  // START MATTERING. Telling a regex literal from division needs a parser. A
  // regex containing `//` or `/*` would desynchronise the scan — so assert the
  // shipping sources contain none, rather than claiming the scanner is complete.
  const files = ["src/App.jsx", "src/sessions.js", "functions/push.js",
    "functions/aitools.js", "functions/startCode.js", "functions/trainerize.js"];
  let risky = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    // A regex literal opening with a comment-looking sequence.
    for (const m of src.matchAll(/[=(,:]\s*\/(\/|\*)/g)) {
      // `= //` is a line comment after an assignment, which is fine; what would
      // break the scan is a REGEX starting with those characters, i.e. one that
      // closes on the same line.
      const rest = src.slice(m.index, src.indexOf("\n", m.index));
      if (/^[=(,:]\s*\/(\/|\*)[^\n]*\/[gimsuy]*\s*[.,);]/.test(rest)) risky++;
    }
  }
  ok("no shipping file opens a regex with // or /*", risky === 0, risky);
}

// ── 5. Every suite that strips uses the shared one ──────────────────────
{
  // ⚠️ SWEEP EVERY SUITE, NOT A LIST I HAPPEN TO REMEMBER. The broken helper was
  // in TEN files, not the five I first found — test-plan-target.mjs carried two
  // copies. A hand-maintained list would have missed the same five again.
  const files = readdirSync(join(ROOT, "scripts")).filter((f) => /^test-.*\.mjs$/.test(f));
  const offenders = [];
  for (const f of files) {
    const s = readFileSync(join(ROOT, "scripts", f), "utf8");
    // The block-comment half of the old chain, which is the half that ate code.
    if (s.includes('replace(/\\/\\*[\\s\\S]*?\\*\\//g, "")')) offenders.push(f);
  }
  ok("no suite carries the string-blind stripper any more", offenders.length === 0, offenders);
  ok("the sweep actually looked at the suites", files.length >= 40, files.length);
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  A slash-star inside a string is a string.\n");
process.exit(fails ? 1 : 0);
