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

// ── 5. A quote is not always a string (S230) ────────────────────────────
// ⚠️ THE SECOND DESYNC, AND IT LEFT 565 COMMENT LINES IN src/App.jsx. JSX text
// is not code, so an apostrophe in prose opened a string that ran to the next
// apostrophe — 90 spans, some over 5,000 characters. Everything inside one
// survived the strip. Harmless for an absence check, which then fails loudly;
// the danger is a POSITIVE assertion matching a comment that names the guard it
// was written to confirm, which is the trap this file exists to prevent.
//
// ⚠️ EVERY CASE BELOW USES A TRAILING COMMENT, AND THAT IS NOT STYLE. The final
// pass blanks lines that BEGIN with `//`, so a case built on a whole-line
// comment passes whether the scanner works or the sweep cleaned up after it —
// measured: four of five mutations stayed green until these were rewritten.
// A trailing comment is only removed if the scan itself is in sync.
{
  const eaten = (src) => stripComments(src).includes("EATEN");
  const kept = (src) => stripComments(src).includes("const A = 1");
  for (const [label, prose] of [
    ["an apostrophe in JSX prose", "<div>Glidna's library</div>"],
    ["a contraction in JSX prose", "<p>we'll build your personalized plan</p>"],
    ["a possessive in JSX prose", "<span>what's possible</span>"],
  ]) {
    const src = `${prose}\nconst A = 1; // EATEN`;
    ok(`${label} does not open a string`, !eaten(src), stripComments(src));
    ok("...and the code around it survives", kept(src));
  }
  // Real strings must still be consumed, or the fix trades one desync for another.
  ok("a string after a colon is still a string", stripComments('{ hint: "a/*b" }\nconst A = 1; // EATEN').includes("a/*b"));
  ok("...and its trailing comment still goes", !eaten('{ hint: "a/*b" }\nconst A = 1; // EATEN'));
  ok("a string after an equals is still a string", stripComments('const e = "x";\nconst A = 1; // EATEN').includes('"x"'));
  ok("a string after a comma, a bracket and a brace too",
     stripComments('f(1, "a")\n[ "b" ]\n{ "c": 1 }\nconst A = 1; // EATEN').match(/"a"[\s\S]*"b"[\s\S]*"c"/) != null);
  ok("...and none of those desynchronised", !eaten('f(1, "a")\n[ "b" ]\n{ "c": 1 }\nconst A = 1; // EATEN'));
  // ⚠️ THE KEYWORD EXCEPTION. `return"x"` and `case'a':` are legal with no space,
  // and a bare word-character test would read them as prose and desynchronise in
  // the OTHER direction — the string's contents then get scanned as code, and
  // `"/*"` opens a block comment that eats to the end of the file.
  ok("a string may follow return with no space", kept('function f(){return"/*"}\nconst A = 1; // EATEN') && !eaten('function f(){return"/*"}\nconst A = 1; // EATEN'));
  ok("...and a case label", kept("switch(x){case'/*':break}\nconst A = 1; // EATEN"));
  ok("...and typeof", kept("if(typeof'/*'){}\nconst A = 1; // EATEN"));
  // A literal ends a value, so nothing may directly follow one. Synthetic on
  // purpose — `f()'x'` is not legal JS, which is the point: the scanner must not
  // treat that quote as an opener.
  ok("a quote right after a call cannot open a string", !eaten("f()'x'\nconst A = 1; // EATEN"));
  ok("...nor right after an index", !eaten("a[0]'x'\nconst A = 1; // EATEN"));
  // ⚠️ A CLOSED LITERAL IS ITSELF A VALUE, and the scanner has to remember that
  // rather than falling back to whatever preceded the literal. Synthetic inputs,
  // because the realistic form is JSX prose right after an interpolation — but
  // the state bug they catch is the same one, and nothing else reddens it.
  // ⚠️ THE APOSTROPHE HAS TO BE UNPAIRED OR THE CASE PROVES NOTHING. A balanced
  // 'x' closes on the same line whether or not the scanner remembers the literal
  // before it, so the first version of these three stayed green under mutation.
  // One apostrophe is what runs to the end of the file.
  ok("a quote right after a string that just closed cannot open one",
     !eaten(`const s = "a"'\nconst A = 1; // EATEN`));
  ok("...nor right after a template that just closed",
     !eaten("const s = `a`'\nconst A = 1; // EATEN"));
  ok("...nor right after a regex that just closed",
     !eaten("const r = /a/'\nconst A = 1; // EATEN"));
}

// ── 6. A slash is not always a comment (S230) ───────────────────────────
// ⚠️ THE FIRST HEADER CLAIMED THIS COULD NOT HAPPEN HERE AND POINTED AT A TEST.
// The test looked for a regex OPENING with `//` or `/*`; what actually broke the
// scan was a regex CONTAINING A QUOTE — functions/aitools.js line 97.
{
  const eaten = (src) => stripComments(src).includes("EATEN");
  const real = `const s = t.replace(/\\\\"/g, '"').replace(/\\\\\\//g, "/");\nconst A = 1; // EATEN`;
  ok("a regex containing a quote does not open a string", !eaten(real), stripComments(real).slice(0, 200));
  ok("...and the code after it survives", stripComments(real).includes("const A = 1"));
  ok("a regex containing a slash-slash is pattern text", !eaten('const r = /https:\\/\\//;\nconst A = 1; // EATEN'));
  ok("a character class holding a slash does not close the regex", !eaten('const r = /[/*]x/;\nconst A = 1; // EATEN'));
  ok("...and the pattern itself is kept", stripComments('const r = /[/*]x/;\nconst A = 1;').includes("/[/*]x/"));
  // Division must stay division, or every arithmetic expression becomes a regex.
  ok("a slash after an identifier is division", stripComments("const q = a / b;\nconst A = 1;").includes("a / b"));
  ok("...and after a closing paren", stripComments("const q = f(x) / 2;\nconst A = 1;").includes("/ 2"));
  ok("...and after a closing bracket", stripComments("const q = a[0] / 2;\nconst A = 1;").includes("/ 2"));
  ok("a real comment after division still goes", !eaten("const q = a / b; // EATEN"));
  ok("regex flags are consumed, so what follows is not scanned as pattern",
     !eaten(`const r = /x/gi; const s = "a";\nconst A = 1; // EATEN`));
}

// ── 7. The real sources, stripped clean ─────────────────────────────────
{
  // ⚠️ THE MEASUREMENT THAT MADE THIS WORTH DOING, KEPT AS A GATE. Before S230:
  // src/App.jsx 569 surviving comment lines, functions/aitools.js 15,
  // src/AuthGate.jsx 6.
  for (const f of ["src/App.jsx", "functions/aitools.js", "src/AuthGate.jsx",
                   "functions/push.js", "functions/trainerize.js", "src/storage.js"]) {
    const out = stripComments(readFileSync(join(ROOT, f), "utf8"));
    const left = out.split("\n").filter((l) => /^\s*\/\//.test(l)).length;
    ok(`no comment line survives ${f}`, left === 0, left);
  }
  // ⚠️ AND IT MUST STAY LINEAR. The first version answered the position question
  // by scanning backwards through the output it had built so far, which took
  // SEVEN SECONDS on src/App.jsx — sixteen suites use this helper.
  const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  const t0 = Date.now(); stripComments(APP); const ms = Date.now() - t0;
  ok("stripping the largest file stays well under a second", ms < 800, ms);
}
{
  // ⚠️ THE LINE SWEEP'S ONE ASSUMPTION, PINNED. `}` and `>` cannot join the
  // value-enders (measured: adding `}` took src/App.jsx from 254 leaked lines to
  // 1,783, and `>` would break every `() => "x"`), so JSX text like
  // `{heightFt}'{heightIn}"` still opens a string. Those leftovers are swept by
  // blanking lines that BEGIN with `//`. The only thing that could damage is a
  // template literal with a line starting that way — a bare URL at the head of a
  // line. Assert the shipping sources have none.
  const files = ["src/App.jsx", "src/AuthGate.jsx", "src/storage.js", "src/clientData.js",
    "functions/aitools.js", "functions/push.js", "functions/trainerize.js"];
  let risky = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    // Lines beginning with `//` that are NOT comments: i.e. a protocol-relative
    // URL or similar inside a template. A real comment has a space or a word
    // after the slashes; `//host/path` does not.
    for (const line of src.split("\n")) {
      if (/^\s*\/\/[A-Za-z0-9._-]+\//.test(line)) risky.push([f, line.trim().slice(0, 60)]);
    }
  }
  ok("no line in a shipping source begins with a URL-shaped slash-slash", risky.length === 0, risky.slice(0, 3));
}

// ── 8. Every suite that strips uses the shared one ──────────────────────
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
console.log("  A slash-star inside a string is a string; an apostrophe in prose is prose.\n");
process.exit(fails ? 1 : 0);
