// Two things Kevin hit on a phone while logging a meal (S200k).
//
// 1. "Whenever I'm logging a meal and I click on the meal type, it always zooms
//    in a little bit too close."
//    THE CAUSE IS NOT THE MEAL TYPE. Tapping it calls openForm(), which opens
//    the add form with the food-search box ALREADY FOCUSED — and Mobile Safari
//    zooms the viewport whenever a focused control computes under 16px. The
//    meal type is where it is noticed; the box that takes focus behind it is
//    what does it. So the guard here is on every focusable control in that path,
//    not on the one he named.
//
//    ⚠️ AND NOT VIA THE VIEWPORT. maximum-scale=1 / user-scalable=no would also
//    stop the zoom, and would silently undo c1cd28b (S196p), which deliberately
//    gave pinch-zoom back after S90 took it away. That trade is not ours to
//    reverse quietly, so index.html is asserted UNCHANGED here.
//
// 2. "Whenever I go into my logged food database, it always starts with the
//    saved meals first. I wanted to start off with the previously logged."
//    The `useState("recent")` already said recent and was dead code — the open
//    effect overwrote it on every mount, because the panel only ever mounts
//    open. Patching the useState alone changes nothing, which is exactly the
//    kind of fix that gets shipped and reported as not working.
//
// Run: node scripts/test-meal-ux.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── 1. nothing focusable in the meal-logging path may compute under 16px ────
// The window covers FoodServingModal, FoodLibrary and MealLog.
const lines = APP.split("\n");
const from = lines.findIndex((l) => l.includes("function FoodServingModal"));
const to = lines.findIndex((l, i) => i > from && l.startsWith("function DailyDashboard"));
ok("found the meal-logging region", from > 0 && to > from, { from, to });

const REM = 16;
const px = (v) => (v.endsWith("rem") ? parseFloat(v) * REM : parseFloat(v));
// ⚠️ ATTRIBUTE THE SIZE TO THE CONTROL, NOT TO ITS NEIGHBOURS. A fixed line
// window reads the caption <div> underneath an input and reports it as an
// offender — which is how a guard like this ends up permanently red and then
// ignored. Accumulate from the opening tag only until that tag closes.
const offenders = [];
for (let i = from; i < to; i++) {
  if (!/<input|<select|<textarea/.test(lines[i])) continue;
  let block = "";
  for (let j = i; j < Math.min(i + 12, to); j++) {
    block += " " + lines[j];
    if (/\/>|>\s*$/.test(lines[j].trim()) && j > i) break;
    if (/\/>/.test(lines[j])) break;
  }
  for (const hit of block.matchAll(/fontSize:\s*"([\d.]+rem|[\d.]+px)"/g)) {
    if (px(hit[1]) < 16) offenders.push(`${i + 1}: ${hit[1]}`);
  }
}
ok("no focusable control in the meal path is under 16px", offenders.length === 0, offenders);

// The two shared style objects those controls spread from.
ok("MealLog's shared input style is 16px", /const inp = \{ padding:"9px 11px", fontSize:"1rem"/.test(APP));
ok("the serving sheet's shared input style is 16px", /const inp = \{ padding: "9px 11px", fontSize: "1rem"/.test(APP));
// ...and the three that override the spread, which a fix to `inp` alone misses.
ok("the serving-weight box overrides upward, not down", /\.\.\.inp, width: "96px", padding: "7px 9px", fontSize: "1rem"/.test(APP));
ok("the photo-notes textarea is 16px", /fontSize:"1rem", fontFamily:"inherit", resize:"vertical"/.test(APP));

// ⚠️ THE FIX WE MUST NOT MAKE. Checked against the META TAG, not the file:
// index.html carries comments explaining why maximum-scale was removed, and a
// whole-file match would fail on the explanation of the very decision it guards.
const viewport = (HTML.match(/<meta name="viewport"[^>]*>/) || [""])[0];
ok("there is a viewport meta to check", viewport.length > 0);
ok("pinch-zoom is still allowed — no maximum-scale", !/maximum-scale/.test(viewport), viewport);
ok("...and no user-scalable=no", !/user-scalable\s*=\s*no/.test(viewport), viewport);

// ── 2. the food library opens on Previously logged ─────────────────────────
ok("the open effect prefers recents", /setTab\(\(recentFoods \|\| \[\]\)\.some\(inFilter\) \? "recent"/.test(APP));
ok("...scoped to the filter it is about to apply, not the whole list",
   /const inFilter = \(f\) => f && f\.name[\s\S]{0,140}recentMealKey\(f\.type\) === filter/.test(APP));
ok("...and falls through to Saved when there are no recents to show",
   /\? "recent" : \(\(savedFoods \|\| \[\]\)\.length \? "saved" : "recent"\)\);/.test(APP));
ok("the old saved-first default is gone", !/setTab\(\(savedFoods \|\| \[\]\)\.length \? "saved" : "recent"\);/.test(APP));
ok("the Foods/Meals toggle no longer discards the choice",
   /onClick=\{\(\) => \{ setMode\(k\); setConfirmDel\(""\); \}\}/.test(APP)
   && !/setMode\(k\); setConfirmDel\(""\); setTab\("saved"\);/.test(APP));

// ── negative controls: can this file see the bugs it guards? ───────────────
ok("NEG: a 0.85rem control would be caught", px("0.85rem") < 16);
ok("NEG: 1rem would not", px("1rem") >= 16);

// ── the app-wide floor (S200p) ─────────────────────────────────────────────
// S200k raised every control in the logging flows by hand. Measuring the rest
// of the app found 98 of 152 focusable controls still under 16px — including
// all six login and role-chooser inputs at 15px — because the S196p rule is a
// bare element selector (0,0,1) and loses to every Tailwind class (0,1,0) and
// to every React inline style, which is how this app styles nearly everything.
{
  const CSS = readFileSync(join(ROOT, "src", "index.css"), "utf8");
  const rule = (CSS.match(/@media \(max-width: 767px\)[^{]*\{[\s\S]*?\n\}/) || [""])[0];
  ok("the phone floor exists", /font-size: max\(16px, 1em\)/.test(rule), rule.slice(0, 120));
  // ⚠️ TOUCH, NOT WIDTH (S200t). iOS zooms on any touch device with a focused
  // sub-16px field — an iPad, or a phone turned landscape, both exceed 767px.
  // 19 popups in this app autofocus an input, which is when it fires.
  ok("...on every touch device, not just narrow ones", /\(pointer: coarse\)/.test(CSS));
  ok("...and can beat an inline style", /max\(16px, 1em\) !important/.test(rule));
  ok("...and still covers textarea and select", /textarea,/.test(rule) && /select \{/.test(rule));

  // ⚠️ max(16px, 1em) SHRINKS as well as raises — 1em resolves against the
  // PARENT — so anything deliberately larger is clamped DOWN to 16px unless
  // excluded. Neither exclusion is a zoom risk; both are deliberately large.
  ok("the deliberately-large controls are excluded",
     /input:not\(\.dash-log-input\):not\(\.keep-size\)/.test(rule));
  ok("...and the marker is actually on them",
     (APP.match(/keep-size/g) || []).length >= 2, (APP.match(/keep-size/g) || []).length);
  ok("...on both 1.1rem controls",
     /\$\{WZ\.input\} keep-size text-center font-semibold text-\[1\.1rem\]/.test(APP)
     && /text-\[1\.1rem\] keep-size text-fg/.test(APP));

  // The escape-hatch bug this nearly shipped with: a double-backslashed Tailwind
  // escape drops the whole media block, and iOS zoom returns everywhere at once.
  ok("no double-escaped selector silently voids the block", !/\\\\\[1\\\\\.1rem\\\\\]/.test(CSS));

  // And the login screen, which is styled by an inline object in another file.
  const AUTH = readFileSync(join(ROOT, "src", "AuthGate.jsx"), "utf8");
  ok("the login inputs are covered by the rule rather than left at 15px",
     /fontSize: 1[56]/.test(AUTH) && /!important/.test(rule));
}

console.log(fails === 0
  ? `  PASS  meal-logging UX (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
