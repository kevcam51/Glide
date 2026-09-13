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
// quote or a slash inside one cannot desynchronise the scan. Regex literals are
// NOT specially handled: telling `/` division from a regex needs a parser, and
// the failure it would cause here (a regex containing `//` or `/*`) does not
// occur in this codebase — scripts/test-strip-comments.mjs pins that claim
// against the real sources so it cannot quietly stop being true.
export function stripComments(src) {
  const s = String(src == null ? "" : src);
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    // A string: copy it through untouched, escapes and all.
    if (c === '"' || c === "'") {
      const q = c;
      out += c; i++;
      while (i < n) {
        if (s[i] === "\\") { out += s[i] + (s[i + 1] || ""); i += 2; continue; }
        out += s[i];
        if (s[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    // A template literal, with its interpolations.
    if (c === "`") {
      out += c; i++;
      let depth = 0;
      while (i < n) {
        if (s[i] === "\\") { out += s[i] + (s[i + 1] || ""); i += 2; continue; }
        if (s[i] === "$" && s[i + 1] === "{") { depth++; out += "${"; i += 2; continue; }
        if (depth > 0 && s[i] === "}") { depth--; out += "}"; i++; continue; }
        if (depth === 0 && s[i] === "`") { out += "`"; i++; break; }
        out += s[i]; i++;
      }
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
    out += c; i++;
  }
  return out;
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
