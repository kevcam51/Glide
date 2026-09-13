// The two target cards fold (S237b).
//
// Kevin, right after the roster search dropdown: "can we also make the daily
// calorie targets and macro targets a drop down as well."
//
// MEASURED BEFORE TOUCHING EITHER, in a real browser at 375×812: Daily Calorie
// Targets was 512px and Macro Targets 321px. 833px of pick-list on an 812px
// screen — the two of them together were TALLER THAN THE PHONE, so the meal
// log, the week summary and the activity feed all sat behind two lists most
// people set once and then never touch.
//
// ⚠️ THEY USE S236's `FoldCard`, NOT A SECOND FOLD OF THEIR OWN. A parallel
// session folded Measured Burn and Savings account on this same screen hours
// earlier; a first version of this work shipped its own `DrawerHead` beside it,
// which would have put four foldable cards on one dashboard folding two
// different ways. FoldCard gained one additive prop instead — see below.
//
// ⚠️ AND THAT PROP, `always`, IS WHAT THIS FILE IS MOSTLY FOR. A fold that can
// hide a warning is worse than a card that is too long:
//
//   • The 1,200-calorie notice. THE FLOOR IS A STANDARD, NOT A DETAIL, and
//     CLAUDE.md is explicit that a silent clamp is its own bug — a fold that
//     could hide it would be exactly that, with extra steps.
//   • "These macros don't add up to your day" — same class, same rule (S224).
//   • An unanswered preview's Make-it-my-target / Cancel bar. Folding that away
//     strands the ring on a number with no way to keep or drop it.
//
// Every one is checked BOTH ways — present in the region that always renders,
// and ABSENT from the region behind the fold — because "it renders somewhere"
// is exactly what a card that hides it would also satisfy.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripJsxComments } from "./lib/strip-comments.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(here, "..", "src", "App.jsx"), "utf8");
const C = stripJsxComments(APP);

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

console.log("\n  Target cards fold — and the warnings do not fold with them\n");

// Slice a card into the half that always renders and the half behind the fold.
//
// ⚠️ BRACE-DEPTH, NOT indexOf(">"). The first version found the end of the
// opening tag with a plain `indexOf(">", …)`, which lands on the first `>` of
// an inline JSX prop — so the macro card's regions were nonsense and six
// assertions failed against correct code. A `>` only ends the tag at brace
// depth 0; every arrow function and nested element sits deeper than that.
function tagEnd(src, from) {
  let d = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") d++;
    else if (c === "}") d--;
    else if (c === ">" && d === 0) return i;
  }
  throw new Error("unterminated tag");
}
// The value of a JSX prop, brace-balanced. `always={name}` resolves to the
// const it names, so a card may hold its always-half inline or above the return
// and the assertions read the same either way.
function prop(src, from, name) {
  const i = src.indexOf(name + "={", from);
  if (i < 0) throw new Error("no prop " + name);
  let d = 0;
  for (let j = i + name.length + 1; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (d === 0) {
      const body = src.slice(i + name.length + 2, j);
      const m = body.trim().match(/^([A-Za-z_$][\w$]*)$/);
      if (!m) return body;
      const k = src.indexOf("const " + m[1] + " = (");
      if (k < 0) throw new Error("no const " + m[1]);
      return src.slice(k, src.indexOf("\n        );", k));
    } }
  }
  throw new Error("unterminated prop " + name);
}
function card(id) {
  const open = C.indexOf(`<FoldCard id="${id}"`);
  if (open < 0) throw new Error("no FoldCard " + id);
  const end = tagEnd(C, open);
  const close = C.indexOf("</FoldCard>", end);
  if (close < 0) throw new Error("no close for " + id);
  return { head: C.slice(open, end), inside: C.slice(end, close),
    always: prop(C, open, "always"), summary: prop(C, open, "summary") };
}

const cal = card("cal-targets");
const mac = card("macro-targets");

// ── 1. Both cards fold, through the shared component ──────────────────────
ok("the calorie card is a FoldCard", /<FoldCard id="cal-targets" title="Daily Calorie Targets"/.test(C));
ok("the macro card is a FoldCard", /<FoldCard id="macro-targets" title="Macro Targets"/.test(C));
// ⚠️ ONE FOLD ON THIS SCREEN, NOT TWO. Four foldable cards behaving two
// different ways is the "two spellings of one list" this repo keeps paying for.
ok("there is exactly one fold component", (C.match(/function FoldCard\(/g) || []).length === 1);
ok("...and nothing else declares one", !/function DrawerHead\(/.test(C) && !/function FoldableCard\(/.test(C));
ok("all four foldable cards use it", (C.match(/<FoldCard id="/g) || []).length === 4);
ok("the fold starts shut", /defaultOpen = false/.test(C));
ok("the header is the disclosure control", /aria-expanded=\{open\}/.test(C));

// ── 2. Folded, the header answers the card's own question ─────────────────
// ⚠️ A HEADER READING ONLY "Daily Calorie Targets" COSTS A TAP TO ANSWER THE
// ONE QUESTION THE CARD EXISTS FOR. FoldCard's own two cards already keep their
// figure in the header; these keep theirs the same way.
ok("the calorie header carries a number", /summary=\{calSummary\}/.test(cal.head));
ok("...and it is the RING's, not the saved one", /\{ringTarget\.toLocaleString\(\)\}<\/span>/.test(C));
ok("...which is defined as the preview when previewing", /const ringTarget = previewing \? targetForRate\(previewRate\) : target;/.test(C));
ok("the macro header carries the split", /\{shownP\}\/\{shownC\}\/\{shownF\}<\/span>/.test(mac.summary));
ok("the calorie header names the pace", /rateName\(SIM_RATES\.find\(\(r\) => Math\.abs\(r\.rate - shownRate\) < 0\.01\)\)/.test(C));
ok("...or says the number was typed", /manualTarget != null \? "Set by hand"/.test(C));
ok("the macro header says the same of a typed split", /: "Set by hand"/.test(mac.summary));
// A preview is not the plan, and the header must not imply it is.
ok("a calorie preview is badged unsaved, not YOURS", /\{previewing \? "NOT SAVED YET" : "YOURS"\}/.test(cal.summary));
ok("a macro preview is badged unsaved, not YOURS", /\{previewMacros \? "NOT SAVED YET" : "YOURS"\}/.test(mac.summary));
ok("...and both are coloured as a warning",
  /const calTone = \(previewing \|\| shownFloored\) \? "var\(--yellow\)" : "var\(--accent\)";/.test(C)
  && /color: previewMacros \? "var\(--yellow\)" : "var\(--accent\)"/.test(mac.summary));

// ── 3. THE DISCLOSURES DO NOT FOLD ────────────────────────────────────────
ok("the 1,200 notice is in the always half", /That rate would put you under 1,200 calories/.test(cal.always));
ok("...and is NOT behind the fold", !/That rate would put you under 1,200 calories/.test(cal.inside));
ok("...gated on the rate on screen, not the saved one", /\{shownFloored && \(/.test(cal.always));
ok("the macros-don't-add-up notice is in the always half", /add up to your day/.test(mac.always));
ok("...and is NOT behind the fold", !/add up to your day/.test(mac.inside));
// ⚠️ AND THE GATE, NOT ONLY THE WORDS. The calorie notice is pinned by its
// `{shownFloored && (` condition, so replacing it with `{false && (` goes red.
// The macro notice is an IIFE, and its text stayed present — and this assertion
// stayed GREEN — when the body was mutated to return null every time. Pinning
// the early-return is what makes the runtime kill visible to a source test.
ok("...and it fires on the real check, not never",
  /const chk = macroCalorieGap\(shown\.protein, shown\.carbs, shown\.fat, planDayCal\);/.test(mac.always)
  && /if \(!chk\.off\) return null;/.test(mac.always));
ok("the calorie confirm bar is in the always half", /Make \{rateName\(SIM_RATES\.find/.test(cal.always));
ok("...and is NOT behind the fold", !/Make \{rateName\(SIM_RATES\.find/.test(cal.inside));
ok("the macro confirm bar is in the always half", /my macro targets/.test(mac.always));
ok("...and is NOT behind the fold", !/my macro targets/.test(mac.inside));
ok("both cancels ride with their confirms", /Cancel/.test(cal.always) && /Cancel/.test(mac.always));
// ⚠️ THE GAP A MUTATION FOUND IN THE FIRST VERSION OF THIS FILE. Checking that
// a bar sits outside the fold says NOTHING about its own condition: gating it
// on the open flag leaves it exactly where it is and hides it anyway, and both
// bars stayed GREEN through that mutation. The invariant is that nothing in the
// always half consults the fold at all.
ok("nothing in the calorie always-half consults the fold", !/\bopen\b\s*&&/.test(cal.always));
ok("nothing in the macro always-half consults the fold", !/\bopen\b\s*&&/.test(mac.always));
// FoldCard must actually render it outside the fold, not merely accept it.
ok("FoldCard renders always outside the fold",
  /\{always\}\s*\n\s*\{open && <div style=\{\{marginTop:"10px"\}\}>\{children\}<\/div>\}/.test(C));
ok("...and it is additive — the other two cards pass none",
  (C.match(/always=\{/g) || []).length === 2);

// ── 4. What DOES fold is the choosing ─────────────────────────────────────
ok("the calorie options are behind the fold", /SIM_RATES\.filter\(\(t\)=>t\.group===g\)/.test(cal.inside));
ok("the macro presets are behind the fold", /macroPresets\.map\(\(o\) => \{/.test(mac.inside));
ok("the hint line is behind the fold", /Tap one to see it in the ring above/.test(cal.inside));
ok("the typed-target field is behind the fold", /Or set your own:/.test(cal.inside));
ok("the basis footnote is behind the fold", /Targets are floored at \{MIN_DAILY_CAL/.test(cal.inside));
// ⚠️ THE FOOTNOTE AND THE WARNING USED TO SHARE ONE TERNARY SLOT. Moving the
// warning out had to split them, or on a floored plan the footnote would render
// under the warning and say the opposite of it.
ok("...and only when the warning is not showing", /\{!shownFloored && \(/.test(cal.inside));
ok("the What if… entry is behind the fold", /What if… try a number or add training/.test(cal.inside));

// ── 5. The options are rows, and they are toggles ─────────────────────────
// ⚠️ ONE PER ROW. Three across was ~80px a tile, which wrapped "2,819" away
// from the pace it belonged to; four across wrapped "180/159/58" mid-number.
ok("the calorie options stack", /const row = \(g\) => \(\s*<div style=\{\{display:"flex",flexDirection:"column"/.test(cal.inside));
// ⚠️ SCOPED TO THIS CARD. Testing the whole file for `rateBtn(t, true)` goes
// red on CalorieSimulator, which has its own rateBtn and its own full-width
// Maintain tile — the repeat-occurrence trap pointing the other way.
ok("...including Maintain",
  /SIM_RATES\.filter\(\(t\)=>t\.group==="maintain"\)\.map\(\(t\)=>rateBtn\(t\)\)/.test(cal.inside)
  && !/rateBtn\(t, true\)/.test(cal.inside));
ok("the macro presets stack", /flexDirection:"column",gap:"6px"\}\}>\s*\{macroPresets\.map/.test(mac.inside));
ok("no grid puts the macro presets side by side", !/gridTemplateColumns[^\n]*macroPresets/.test(C));
// ⚠️ aria-pressed, NOT role="option". These toggle a preview on and off; they
// are not a listbox, and a role that lies is worse than none.
ok("the options are toggles to a screen reader", /aria-pressed=\{isShown\}/.test(cal.inside) && /aria-pressed=\{isShown\}/.test(mac.inside));
ok("...and nothing here claims to be a listbox", !/role="listbox"/.test(cal.inside) && !/role="listbox"/.test(mac.inside));
ok("the plan's own option is still marked YOURS", /isPlan && <span[^>]*>YOURS/.test(cal.inside) && /isPlan && <span[^>]*>YOURS/.test(mac.inside));
ok("a floored option still says so in the list", /\{low \? "floored" : "cal\/day"\}/.test(cal.inside));

// ── 6. Nothing about the arithmetic moved ─────────────────────────────────
// ⚠️ THIS IS A PRESENTATION CHANGE, and the assertions that matter most are the
// ones saying so. Every number still comes from the function it came from, and
// committing a rate still does the three things it always did.
ok("targets still come from targetForRate", /const val = targetForRate\(t\.rate\);/.test(cal.inside));
ok("floored still means the raw maths, not the shown number", /const flooredAt = \(r\) => rawTargetForRate\(r\) < MIN_DAILY_CAL;/.test(C));
ok("committing still clears a manual target", /if \(manualTarget != null && onSetCalorieTarget\) onSetCalorieTarget\(0\);/.test(C));
ok("...and still keeps the daily goal honest", /onSetCalorieGoal\(previewRate === 0 \? "maintain"/.test(C));
ok("the macro presets still come from the shared builder", /macroSplitTiles/.test(C));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  Folded they cost a fraction of the screen; the warnings cost nothing to keep.\n");
process.exit(fails ? 1 : 0);
