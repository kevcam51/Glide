// Strip comments from JS/JSX source, for test assertions (S229b).
//
// ⚠️ WHY THIS IS NOT A PAIR OF REGEXES. Every suite that needed it wrote the
// same three-replace helper:
//
//     src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
//        .replace(/\/\/[^\n]*/g, "")
//        .replace(/\/\*[\s\S]*?\*\//g, "")
//
// and all of them were silently wrong on this file. `src/App.jsx` contains
// `accept="image/*,video/*"` in two file pickers. The `/*` inside that STRING
// looks like the start of a block comment, so the last replace matched forward
// to the next real `*/` and deleted everything in between — 35,140 characters
// in one case and 24,927 in the other. Roughly 60,000 characters of the file
// were invisible to every assertion written against the stripped source.
//
// The dangerous half is not the assertion that fails. It is the assertion that
// says "this file does NOT contain X": with the region gone, it passes over
// code that is really there. That is the exact class of green-over-a-bug this
// repo keeps paying for, so the fix is a real scanner rather than a better
// regex — strings are consumed as strings, and a `/*` inside one is just text.
//
// Template literals are consumed too, including `${...}` interpolations, so a
// quote or a slash inside one cannot desynchronise the scan.
//
// ⚠️ THE ORIGINAL HEADER SAID REGEX LITERALS WERE NOT HANDLED AND THAT THE
// FAILURE "does not occur in this codebase", pinned by a test. Both halves were
// wrong (S230). functions/aitools.js line 97 is `.replace(/\\"/g, '"')` — the
// test only looked for a regex OPENING with `//` or `/*`, and the thing that
// actually broke the scan was a regex CONTAINING A QUOTE. Regexes are consumed
// properly now, character classes and escapes included.
// ⚠️ A QUOTE IS NOT ALWAYS A STRING, AND A SLASH IS NOT ALWAYS A COMMENT (S230).
// The first version of this scanner consumed every `"` and `'` as a string
// delimiter and left `/` alone unless it was followed by `/` or `*`. Both are
// wrong in this codebase, in two different files, for two different reasons —
// and the symptom is identical: the scan desynchronises and comments downstream
// of it survive the strip.
//
//   1. JSX TEXT IS NOT CODE. "Glidna's library", "we'll build your personalized
//      plan", "what's possible" — each apostrophe opened a string that ran to
//      the next apostrophe, thousands of characters later. 90 such spans in
//      src/App.jsx, swallowing 565 comment lines.
//   2. A REGEX LITERAL CAN CONTAIN A QUOTE. functions/aitools.js has
//      `.replace(/\\"/g, '"')` — the `"` inside the pattern opened a string,
//      which then swallowed the `'` that follows and ran on from there. The old
//      header claimed regexes "do not occur in this codebase" in a form that
//      breaks the scan. They do, and this is where.
//
// Both are fixed by the same observation: JavaScript will not let a string or a
// regex literal follow a VALUE. `foo"bar"`, `x'y'`, `a()"b"` and `a[0]'c'` are
// all syntax errors, and `a / b` is division precisely because `a` is a value.
// So a quote or a slash that follows a word character, `)` or `]` is text or
// division — never the start of a literal. That single test is what tells JSX
// prose from a string, and a divisor from a pattern.
//
// ⚠️ THE KEYWORD EXCEPTION IS WHY THIS IS NOT JUST /[\w$)\]]/. `return"x"`,
// `case'a':` and `typeof'x'` are all legal with no space, and a word-character
// test alone would read them as text and desynchronise in the other direction.
// The word before the quote is looked up rather than assumed.
//
// Comment detection still runs before the regex branch: `//` can never open a
// regex, since an empty one is a syntax error.
const VALUE_ENDERS = /[\w$)\]]/;
// Keywords a literal may legally follow with no space between.
const PRE_VALUE_WORDS = new Set(["return", "typeof", "case", "in", "of", "new", "do", "else",
  "delete", "void", "instanceof", "yield", "await", "throw"]);

export function stripComments(src) {
  const s = String(src == null ? "" : src);
  const out = [];
  let i = 0;
  const n = s.length;
  // ⚠️ THE POSITION TEST CARRIES STATE; IT DOES NOT RE-READ THE OUTPUT. The
  // first version asked the same question by scanning backwards through the
  // string built so far, which turned a linear pass into 7 SECONDS on
  // src/App.jsx — 16 suites use this helper, so that is two minutes of test
  // time bought for nothing. `prevSig` is the last non-whitespace character
  // emitted and `word` the identifier ending at it; both update in O(1).
  let prevSig = "";   // "" = start of file, so a literal may begin
  let word = "";
  const canStart = () => {
    if (!prevSig) return true;
    if (!VALUE_ENDERS.test(prevSig)) return true;   // an operator, comma, brace…
    // ⚠️ NO SEPARATE ARM FOR `)` AND `]`. An earlier draft had one, and no
    // mutation could make it fail: after a non-word character `word` is already
    // "", so the lookup below answers false for exactly those cases. A branch
    // that cannot go red proves nothing and reads as though it did.
    return PRE_VALUE_WORDS.has(word);
  };
  // A literal ENDS a value, so nothing may directly follow it. Recording the
  // token as a word character with no word behind it says exactly that.
  const closedLiteral = () => { prevSig = "x"; word = ""; };
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    // A string: copy it through untouched, escapes and all — but only where one
    // could legally begin. Otherwise it is an apostrophe in JSX prose.
    if ((c === '"' || c === "'") && canStart()) {
      const q = c;
      out.push(c); i++;
      while (i < n) {
        if (s[i] === "\\") { out.push(s[i] + (s[i + 1] || "")); i += 2; continue; }
        out.push(s[i]);
        if (s[i] === q) { i++; break; }
        i++;
      }
      closedLiteral();
      continue;
    }
    // A template literal, with its interpolations.
    if (c === "`") {
      out.push(c); i++;
      let depth = 0;
      while (i < n) {
        if (s[i] === "\\") { out.push(s[i] + (s[i + 1] || "")); i += 2; continue; }
        if (s[i] === "$" && s[i + 1] === "{") { depth++; out.push("${"); i += 2; continue; }
        if (depth > 0 && s[i] === "}") { depth--; out.push("}"); i++; continue; }
        if (depth === 0 && s[i] === "`") { out.push("`"); i++; break; }
        out.push(s[i]); i++;
      }
      closedLiteral();
      continue;
    }
    if (c === "/" && d === "/") {
      while (i < n && s[i] !== "\n") i++;
      continue;                       // the newline itself is kept below
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // A regex literal, copied through so a slash-slash or slash-star inside the
    // pattern is pattern text rather than the start of a comment.
    if (c === "/" && canStart()) {
      out.push(c); i++;
      let inClass = false;
      while (i < n) {
        const r = s[i];
        if (r === "\\") { out.push(r + (s[i + 1] || "")); i += 2; continue; }
        if (r === "\n") break;                  // unterminated — it was division
        out.push(r); i++;
        // ⚠️ THE CHARACTER-CLASS TRACKING IS CORRECT BUT NOT LOAD-BEARING, AND
        // THAT IS RECORDED RATHER THAN DRESSED UP. Deleting it reddens no
        // assertion: mis-closing a regex early leaves the scanner on a literal
        // boundary, where `closedLiteral()` has already made the next quote or
        // slash inert, so no comment is ever misread. It stays because a regex
        // span should be the regex; it is not claimed as a guard.
        if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
      }
      // ⚠️ NO FLAG-CONSUMING LOOP. An earlier draft had one and no mutation
      // could redden it: the main loop emits `g`/`i`/`u` as ordinary word
      // characters, which leaves the position test with exactly the answer
      // consuming them here would have given. Dead code that reads as a guard.
      closedLiteral();
      continue;
    }
    out.push(c); i++;
    if (!/\s/.test(c)) {
      prevSig = c;
      word = /[\w$]/.test(c) ? word + c : "";
    }
  }
  // ⚠️ ONE CLASS OF DESYNC SURVIVES THE POSITION TEST, AND IT CANNOT BE FIXED BY
  // A BETTER RULE. `{heightFt}'{heightIn}"` is JSX text: a foot mark straight
  // after a closing brace. `}` cannot join VALUE_ENDERS to catch it — a block's
  // closing brace is followed by a new statement, which may legitimately begin
  // with a string or a regex, and adding it MEASURED WORSE: 254 leaked lines
  // became 1,783. Same for `>`, which would break every `() => "x"`.
  //
  // So the remaining cases are swept up by the one rule that cannot mis-fire on
  // code: a line whose first non-space characters are `//` is a comment. The
  // only thing this could damage is a template literal with a line starting that
  // way — a bare URL at the head of a line — and test-strip-comments.mjs pins
  // that against the real sources so the claim cannot quietly stop being true.
  // Blanked rather than deleted, so line numbers still line up.
  return out.join("").split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
}

// JSX comments are `{/* … */}`, and stripComments already removes the comment
// inside them, leaving `{}`.
//
// ⚠️ THE BRACES ARE DELIBERATELY LEFT. An earlier version removed the whole
// `{ /* … */ }` as a unit, which also ate the body of every `catch (e) { /* …
// */ }` in functions/ — turning `catch (e) { }` into `catch (e) ` and breaking
// any assertion that slices a function body. A JS block that happens to contain
// only a comment is indistinguishable from a JSX comment without a parser, so
// the safe rule is to strip the comment and leave the braces alone.
export function stripJsxComments(src) {
  return stripComments(src);
}
