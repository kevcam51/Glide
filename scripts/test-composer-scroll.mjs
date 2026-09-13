// Composer textareas: grow, then SCROLL — never clip (S228).
//
// Kevin: "In the text box when I'm typing or reading a transcribed message
// before I sent it I wanted to scroll up and down to read it, but I'm unable to
// scroll within the text box. The only thing I was able to do was scroll the
// background which is not what I want."
//
// Two independent mechanisms produced that one sentence, and this suite guards
// both:
//
//   1. THE CAP WAS DECLARED TWICE WITH TWO DIFFERENT NUMBERS. The JS clamped the
//      height at 200 while a Tailwind `max-h-[140px]` on the same element
//      clamped the ELEMENT at 140 — and CSS max-height beats an inline height.
//      Between those numbers the box was cut off while overflowY was explicitly
//      "hidden", on a `resize-none` box: invisible AND unreachable.
//
//   2. PULL-TO-REFRESH ARMED INSIDE THE BOX. usePullToRefresh listens on
//      `document` and never looked at the event target, so a drag inside the
//      composer pulled the PAGE. overscroll-behavior cannot cover that — the
//      touchmove reaches document whether or not an inner scroll chained.
//
// ⚠️ EVERY FUNCTION HERE IS LIFTED OUT OF src/App.jsx AND RUN. Nothing is
// transcribed and nothing is pattern-matched where it could be executed
// instead: a suite that greps for a guard stays green when the guard is
// replaced with `if (false)`, which this repo has paid for more than once.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(here, "..", "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ⚠️ A BRACE-BALANCED LIFTER, NOT A LAZY REGEX (S215) — same helper the other
// suites use. Note its one sharp edge: it tests for a quote character BEFORE it
// tests for `//`, so a single apostrophe inside a `//` comment within a lifted
// body sends it past the end of the file. The helpers it lifts are written
// apostrophe-free inside their bodies for exactly that reason; keep them so.
function liftDecl(src, name) {
  const re = new RegExp("\\n([ \\t]*)(?:function " + name + "\\(|const " + name + "\\s*=)");
  const m = src.match(re);
  if (!m) throw new Error("could not lift " + name);
  const start = m.index + 1 + m[1].length;
  const isFn = src.startsWith("function", start);
  let i = start, depth = 0, opened = false;
  const skipString = () => { const qq = src[i]; for (i++; i < src.length; i++) { if (src[i] === "\\") { i++; continue; } if (src[i] === qq) return; } };
  if (isFn) {
    while (i < src.length && src[i] !== "(") i++;
    let pd = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
      if (c === "(") pd++;
      else if (c === ")") { pd--; if (pd === 0) { i++; break; } }
    }
  }
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { skipString(); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (isFn) {
      if (c === "{") { depth++; opened = true; }
      else if (c === "}") { depth--; if (opened && depth === 0) return src.slice(start, i + 1); }
    } else {
      if ("([{".indexOf(c) >= 0) depth++;
      else if (")]}".indexOf(c) >= 0) depth--;
      else if (c === ";" && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unterminated " + name);
}

const CONSTS = ["COMPOSER_MAX_H", "COMPOSER_MIN_H", "COMPOSER_SHARE", "PTR_IGNORE"];
const FNS = ["composerMaxH", "autoGrowTextarea", "ptrIgnored", "ptrShouldArm"];
const lifted = [...CONSTS, ...FNS].map((n) => liftDecl(APP, n)).join("\n");
const { COMPOSER_MAX_H, COMPOSER_MIN_H, COMPOSER_SHARE, PTR_IGNORE,
        composerMaxH, autoGrowTextarea, ptrIgnored, ptrShouldArm } =
  new Function(lifted + "\nreturn { COMPOSER_MAX_H, COMPOSER_MIN_H, COMPOSER_SHARE, PTR_IGNORE, composerMaxH, autoGrowTextarea, ptrIgnored, ptrShouldArm };")();

console.log("\n  Composer textareas: grow, then scroll\n");

// ── 1. composerMaxH — the ceiling follows the room there is ─────────────────
ok("full screen gets the flat ceiling", composerMaxH(0) === COMPOSER_MAX_H, composerMaxH(0));
ok("absent panel height gets the flat ceiling", composerMaxH(undefined) === COMPOSER_MAX_H);
ok("a nonsense panel height gets the flat ceiling", composerMaxH(-5) === COMPOSER_MAX_H);
ok("a NaN panel height gets the flat ceiling", composerMaxH("x") === COMPOSER_MAX_H);
// A 720px phone docks the bar at round(720*0.33)=238 -> 119. An 1180px iPad
// docks at 389 -> 195. Both leave the transcript at least half the panel.
ok("phone dock: half the panel", composerMaxH(238) === 119, composerMaxH(238));
ok("iPad dock: half the panel", composerMaxH(389) === 195, composerMaxH(389));
ok("a tall panel is still capped", composerMaxH(4000) === COMPOSER_MAX_H, composerMaxH(4000));
ok("a tiny panel keeps one usable row", composerMaxH(40) === COMPOSER_MIN_H, composerMaxH(40));
{
  let capViolation = 0, floorViolation = 0, nonMonotonic = 0, prev = -1;
  for (let p = 1; p <= 2000; p++) {
    const v = composerMaxH(p);
    if (v > COMPOSER_MAX_H) capViolation++;
    if (v < COMPOSER_MIN_H) floorViolation++;
    if (v < prev) nonMonotonic++;
    prev = v;
  }
  ok("no panel size exceeds the ceiling", capViolation === 0, capViolation);
  ok("no panel size falls under the floor", floorViolation === 0, floorViolation);
  ok("a bigger panel never yields a smaller composer", nonMonotonic === 0, nonMonotonic);
}
ok("the share is a real fraction", COMPOSER_SHARE > 0 && COMPOSER_SHARE <= 1, COMPOSER_SHARE);

// ── 2. autoGrowTextarea — run it against a fake element ────────────────────
// contentPx is what the browser would report as scrollHeight once the box has
// been collapsed to height:auto. borderPx models the 1px top + 1px bottom
// border that scrollHeight excludes but a border-box height must include.
const fakeEl = (contentPx, value = "x", borderPx = 2) => ({
  value,
  style: {},
  get scrollHeight() { return contentPx; },
  get offsetHeight() { return contentPx + borderPx; },
  get clientHeight() { return contentPx; },
});

ok("a null element is a no-op, not a throw", (() => { try { autoGrowTextarea(null, 200); return true; } catch { return false; } })());
{
  const el = fakeEl(120, "");
  autoGrowTextarea(el, 200);
  ok("empty: stays at the rows=1 height", el.style.height === "auto", el.style.height);
  ok("empty: overflow hidden so it cannot show two blank rows", el.style.overflowY === "hidden");
  ok("empty: the ceiling is still published to max-height", el.style.maxHeight === "200px", el.style.maxHeight);
}
{
  const el = fakeEl(90);
  autoGrowTextarea(el, 200);
  ok("short text: height follows the content", el.style.height === "92px", el.style.height);
  ok("short text: the border is added back", el.style.height === (90 + 2) + "px");
  ok("short text: no scrollbar needed", el.style.overflowY === "hidden");
}
{
  // THE BUG. 150px of content against a 140px ceiling: this is the band that
  // used to be clipped with overflowY hidden and no way to reach the rest.
  const el = fakeEl(150);
  autoGrowTextarea(el, 140);
  ok("overflowing text: height stops at the ceiling", el.style.height === "140px", el.style.height);
  ok("overflowing text: IT SCROLLS", el.style.overflowY === "auto", el.style.overflowY);
  ok("overflowing text: max-height agrees with the clamp", el.style.maxHeight === "140px", el.style.maxHeight);
}
{
  // >= not >. At exactly the ceiling the content already fills the box, so
  // "hidden" there would clip the last line with no way to see it.
  const el = fakeEl(198);
  autoGrowTextarea(el, 200);
  ok("exactly at the ceiling: it scrolls", el.style.overflowY === "auto", el.style.overflowY);
}
{
  const el = fakeEl(300);
  autoGrowTextarea(el, 0);
  ok("a missing cap falls back to the house ceiling", el.style.height === COMPOSER_MAX_H + "px", el.style.height);
  ok("a missing cap still publishes max-height", el.style.maxHeight === COMPOSER_MAX_H + "px");
}
{
  const el = fakeEl(300, "x", 0);
  autoGrowTextarea(el, 200);
  ok("a borderless box needs no compensation", el.style.height === "200px", el.style.height);
}
{
  // ⚠️ THE INVARIANT THIS SUITE EXISTS FOR, swept rather than spot-checked:
  // content is NEVER unreachable. Either the box is tall enough to show all of
  // it, or the box scrolls. "Clipped and hidden" must not occur at any size.
  let trapped = 0, capExceeded = 0, capDisagreed = 0;
  for (const cap of [46, 96, 120, 140, 175, 200]) {
    for (let content = 10; content <= 600; content += 1) {
      const el = fakeEl(content);
      autoGrowTextarea(el, cap);
      const h = parseInt(el.style.height, 10);
      const shown = h >= content + 2;
      if (!shown && el.style.overflowY !== "auto") trapped++;
      if (h > cap) capExceeded++;
      if (el.style.maxHeight !== cap + "px") capDisagreed++;
    }
  }
  ok("no size traps text behind overflow hidden", trapped === 0, trapped);
  ok("no size grows past its ceiling", capExceeded === 0, capExceeded);
  ok("the published max-height always equals the clamp", capDisagreed === 0, capDisagreed);
}

// ── 3. ptrShouldArm — the page must not pull when the box should scroll ────
const el = (tag, parent = null) => ({
  tagName: tag.toUpperCase(),
  closest(sel) {
    const wants = sel.split(",").map((s) => s.trim());
    for (let n = this; n; n = n._parent) {
      for (const w of wants) {
        if (w === "textarea" && n.tagName === "TEXTAREA") return n;
        if (w === "[data-ptr-ignore]" && n._ptr) return n;
      }
    }
    return null;
  },
  _parent: parent,
});
const div = () => el("div");
const textarea = () => el("textarea");
const insideIgnored = () => { const root = div(); root._ptr = true; const child = el("span", root); child._parent = root; return child; };

ok("a plain drag at the top of the page still arms", ptrShouldArm(div(), false, true, 1) === true);
ok("a drag inside a textarea does NOT arm", ptrShouldArm(textarea(), false, true, 1) === false);
ok("a drag inside a data-ptr-ignore panel does NOT arm", ptrShouldArm(insideIgnored(), false, true, 1) === false);
ok("a locked body does not arm", ptrShouldArm(div(), true, true, 1) === false);
ok("mid-page does not arm", ptrShouldArm(div(), false, false, 1) === false);
ok("two fingers do not arm", ptrShouldArm(div(), false, true, 2) === false);
ok("zero fingers do not arm", ptrShouldArm(div(), false, true, 0) === false);
ok("a missing target still lets the page pull", ptrShouldArm(null, false, true, 1) === true);
ok("a target with no closest() is not treated as ignored", ptrShouldArm({}, false, true, 1) === true);
ok("ptrIgnored is true for a textarea", ptrIgnored(textarea()) === true);
ok("ptrIgnored is false for a div", ptrIgnored(div()) === false);
ok("ptrIgnored tolerates null", ptrIgnored(null) === false);
ok("the ignore selector covers both cases", /textarea/.test(PTR_IGNORE) && /data-ptr-ignore/.test(PTR_IGNORE), PTR_IGNORE);

// ── 4. The shipping wiring — things only the source can answer ─────────────
// These are deliberately the MINORITY of this suite: everything executable was
// executed above. Each one below still fails if the wiring regresses.

// Count CALL SITES, not mentions — a mention in a comment is not a caller.
const callSites = [...APP.matchAll(/autoGrowTextarea\(\s*([A-Za-z_$][\w$]*)\.current\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)];
ok("autoGrowTextarea has at least two callers", callSites.length >= 2, callSites.length);

// Every ref handed to autoGrowTextarea must belong to a <textarea>, and that
// textarea must carry NO competing CSS cap — the whole cause of the bug.
{
  let notATextarea = 0, cssCapped = 0, inlineCapped = 0;
  for (const m of callSites) {
    const ref = m[1];
    const tag = APP.match(new RegExp("<textarea[^>]*ref=\\{" + ref + "\\}[\\s\\S]{0,900}?/>"));
    if (!tag) { notATextarea++; continue; }
    if (/max-h-\[/.test(tag[0])) cssCapped++;
    if (/maxHeight/.test(tag[0])) inlineCapped++;
  }
  ok("every auto-grown ref is on a textarea", notATextarea === 0, notATextarea);
  ok("NO auto-grown textarea carries a max-h-* class", cssCapped === 0, cssCapped);
  ok("NO auto-grown textarea carries an inline maxHeight", inlineCapped === 0, inlineCapped);
}
ok("the old duplicate ceiling is gone", !/\bMAX_TA\b/.test(APP));
ok("the composer contains its own overscroll", /order-first basis-full[^"]*overscroll-contain/.test(APP));
ok("the chat panel is not a pull-to-refresh surface", /data-ptr-ignore className=\{`fixed kb-safe/.test(APP));
ok("the voice bar is not a pull-to-refresh surface", /data-ptr-ignore className=\{`fixed \$\{sheetUp/.test(APP));
ok("the voice transcript contains its own overscroll", /max-h-\[26vh\] overflow-y-auto overscroll-contain/.test(APP));
// The arming DECISION lives in the lifted function, not inline in the listener —
// otherwise the assertions above test something the app does not run.
ok("pull-to-refresh arms through the tested function", /startY\.current = ptrShouldArm\(/.test(APP));
ok("the old inline arming condition is gone", !/startY\.current = \(!isBodyLocked\(\)/.test(APP));

// ⚠️ TDZ GUARD (the S213 white screen). `maxTa` is read by a dependency array,
// which is evaluated during render — so declaring it below that effect is a
// ReferenceError on every render, and `npm run check:undef` cannot see it
// because the binding does exist, just later.
{
  const decl = APP.indexOf("const maxTa = composerMaxH(panelPx)");
  const use = APP.indexOf("autoGrowTextarea(taRef.current, maxTa)");
  ok("maxTa is declared", decl > 0, decl);
  ok("maxTa is declared ABOVE the effect that reads it", decl > 0 && use > decl, { decl, use });
}
// One resolved height, quoted by the panel style AND the dock variable — they
// used to call safeH separately, which is how two numbers drift apart.
{
  // "Resolved once" means exactly one call site each — the panel style, the dock
  // variable and the resize drag all read barPx/cardPx. A second safeH call is
  // how two numbers for one panel drift apart.
  const bar = (APP.match(/safeH\(barH, 0\.33\)/g) || []).length;
  const card = (APP.match(/safeH\(cardH, 0\.68\)/g) || []).length;
  ok("the docked height is resolved exactly once", bar === 1, bar);
  ok("the card height is resolved exactly once", card === 1, card);
}
ok("the panel style quotes the resolved height", /height: barPx,/.test(APP) && /height: cardPx,/.test(APP));
ok("the dock variable quotes the resolved height", /\$\{barPx \+ 12\}px/.test(APP));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  Composers grow, then scroll — and the page stays put.\n");
process.exit(fails ? 1 : 0);
