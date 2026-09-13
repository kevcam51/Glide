// The activity-rung suggestion, and the cooldown that stops it nagging (S200f).
//
// WHAT THIS GUARDS. The measured-burn card can propose a different activity
// rung when the observed TDEE fits one better than the profile's. Kevin's
// report was that accepting it did not stick — two separate causes, one of
// which lives here:
//
//   • the card had NO memory. Nothing recorded that a suggestion had been
//     offered, accepted or dismissed, so "not now" did not exist as an answer
//     and the only way to make it stop was to say yes. Worse, when the
//     measurement lands BETWEEN two rungs a day of new data can nudge `implied`
//     back across the midpoint, so it could ask, be answered, and ask the
//     opposite next week — forever.
//   • (the other cause was the Trainerize sync re-stamping activityLevel every
//     30 minutes — see scripts/test-tz-snapshot.mjs.)
//
// WHY FOURTEEN DAYS. Against the estimator's own 28-day window: at 14 days half
// the evidence is new. At 7 it would re-ask on data that is 75% the same, which
// is asking the same question again rather than a better one.
//
// EXECUTED, NOT MATCHED. activityRungSuggestion is module-level in App.jsx
// precisely so this file can lift and RUN it — a regex over a guard stays green
// when the guard is `if (false)`, which this repo has paid for twice. The
// negative controls at the bottom prove the harness can see the bugs it guards.
//
// Run: node scripts/test-activity-suggestion.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Lift the shipping source: the ladder, the cooldown constant and the function.
const cut = (re, what) => { const m = APP.match(re); if (!m) throw new Error("could not find " + what); return m[0]; };
const LEVELS = cut(/const ACTIVITY_LEVELS = \[[\s\S]*?\n\];/, "ACTIVITY_LEVELS");
const COOL   = cut(/const ACTIVITY_COOLDOWN_DAYS = \d+;/, "ACTIVITY_COOLDOWN_DAYS");
const FN     = cut(/function activityRungSuggestion\([\s\S]*?\n\}/, "activityRungSuggestion");
const { suggest, COOLDOWN_DAYS, LADDER } = new Function(
  `${LEVELS}\n${COOL}\n${FN}\nreturn { suggest: activityRungSuggestion, COOLDOWN_DAYS: ACTIVITY_COOLDOWN_DAYS, LADDER: ACTIVITY_LEVELS };`
)();

const DAY = 86400000;
const NOW = 1757030400000;                 // fixed clock: no Date.now() in assertions
const obs = (tdee, confidence = "high") => ({ tdee, confidence });
// A "moderate" (1.55) person whose BMR is 1600 → formula TDEE 2480.
const BMR = 1600, MODERATE = 2480;
const call = (o) => suggest({ observed: obs(o.tdee, o.conf), tdee: o.tdee2 ?? MODERATE,
  activityLevel: o.level ?? "moderate", activityCheck: o.check, now: o.now ?? NOW });

// ── the constant is the one the card honours ──────────────────────────────
ok("cooldown is in the 7-14 day range Kevin asked for", COOLDOWN_DAYS >= 7 && COOLDOWN_DAYS <= 14, COOLDOWN_DAYS);
ok("the ladder has the five known rungs", LADDER.length === 5 && LADDER[0].id === "sedentary" && LADDER[4].id === "extra");

// ── the step bands (S200l, Kevin) ─────────────────────────────────────────
// ⚠️ A CORRELATE, NOT A DEFINITION. The bands are published population figures;
// they are NOT derivable from the multiplier, and the arithmetic proves it — at
// 1.55 a 200 lb man's ladder adds ~1,000 cal/day over resting, while 1,000 cal
// of flat walking is roughly 30,000 steps. So this file checks the bands are
// present, contiguous and worded as a hint, and never that they reconcile with
// the multipliers.
{
  const FIELDS = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  ok("every rung publishes a step band", LADDER.every((a) => typeof a.steps === "string" && a.steps.length > 3),
     LADDER.map((a) => a.steps));
  // The old ⓘ prose ran 4,000 / 4,000–7,000 / 7,000–10,000+ / 12,000+, so
  // 10–12k belonged to nobody. Bands must tile.
  const nums = LADDER.map((a) => (a.steps.match(/[\d,]{3,}/g) || []).map((x) => Number(x.replace(/,/g, ""))));
  ok("the bands are contiguous — no step count belongs to nobody",
     nums[0][0] === nums[1][0] && nums[1][1] === nums[2][0] && nums[2][1] === nums[3][0] && nums[3][1] === nums[4][0],
     nums);
  ok("...and strictly increasing", nums[0][0] < nums[1][1] && nums[1][1] < nums[2][1] && nums[2][1] < nums[3][1], nums);
  // ⚠️ label is rendered by five other screens in single-line rows with no wrap
  // guard; a step range there pushes the value off the row.
  ok("no step figure leaked into label", LADDER.every((a) => !/\d{3}/.test(a.label)), LADDER.map((a) => a.label));
  // ── how the band is PRESENTED (S202, Kevin: "make it very visible") ──────
  // ⚠️ THIS USED TO ASSERT `Most people here: {a.steps}` ON ONE LINE, and that
  // exact shape was the defect. The line was real and needed no tap — but it was
  // the smallest text in the row, last in reading order, in `text-primary/80`,
  // which computes to 3.40:1 on surface2 in the LIGHT theme: a WCAG AA fail, and
  // lower contrast than the muted description directly above it. So the assertion
  // is rewritten around the INTENT it was protecting (a hedge, never a rule) plus
  // the presentation facts that made it unreadable, rather than the literal
  // markup — which is what would otherwise force the next person to delete it.
  const BAND = (FIELDS.match(/\{\/\* \u2500\u2500 The step band[\s\S]*?\n {16}<\/div>/) || [""])[0];
  ok("the step band exists as its own block", BAND.length > 200, BAND.length);
  // ⚠️ ASSERT ON THE MARKUP, NOT THE PROSE. The comment above this band NAMES the
  // class that caused the bug (`text-primary/80`) so the next reader knows what
  // not to do — and the first version of the check below matched that sentence
  // and failed on a correct file. A rule about rendered output must be tested
  // against rendered output.
  const MARKUP = BAND.slice(BAND.indexOf("*/}") + 3).replace(/\n\s*/g, " ");
  ok("stripped the explanatory comment", MARKUP.length > 150 && !/WCAG/.test(MARKUP), MARKUP.slice(0, 120));
  ok("the wizard still words it as a hint, not a rule", /Most people here/.test(MARKUP));
  ok("...in the same block as the figure it hedges", /\{a\.steps\}/.test(MARKUP));
  // The figure must be high-contrast in BOTH themes. A fractional-opacity accent
  // on a tinted surface is exactly what failed in light mode.
  ok("the step figure is rendered in the full-contrast foreground colour",
     /text-fg[^"]*"[^>]*>\s*\{a\.steps\}/.test(MARKUP), MARKUP.slice(0, 400));
  ok("no faded-accent text anywhere in the band", !/text-primary\/\d/.test(MARKUP), MARKUP);
  // It must not be the smallest thing in the row again. The description is
  // .76rem; the figure has to beat it.
  const figSize = Number((BAND.replace(/\n\s*/g, " ").match(/text-\[([\d.]+)rem\][^>]*>\s*\{a\.steps\}/) || [])[1]);
  ok("the step figure is larger than the description line above it", figSize >= 0.9, figSize);
  // Two claims on one 11px line, wrapping to three on a phone, was the other half
  // of why it did not read.
  // ⚠️ THE FIRST VERSION OF THIS CHECK SURVIVED ITS OWN MUTATION. It asked only
  // whether `addOn` appeared somewhere after `{a.steps}` — which stays true when
  // the cal/day figure is crammed BACK onto the steps line, because the separate
  // block below still matches. The rule is about ONE element, so it must be
  // asserted against that element: slice from the figure to the `</div>` closing it.
  const FIG = (MARKUP.match(/\{a\.steps\}[\s\S]*?<\/div>/) || [""])[0];
  ok("isolated the element holding the step figure", FIG.length > 20 && FIG.length < 300, FIG);
  ok("the cal/day figure has its own line, not shared with the steps", !/addOn/.test(FIG), FIG);
  ok("...and it is still shown", /addOn\(a\.multiplier\)/.test(MARKUP));
  // Splitting the band from its qualifier is only safe if the qualifier is still
  // shown — otherwise "or heavy lifting" and "or all-day heavy labour" vanish.
  ok("the qualifier is rendered, not dropped by the split", /\{a\.stepsNote\}/.test(BAND));
  ok("...and every rung that needs one has one",
     LADDER.filter((a) => /lifting|labour/.test(a.desc + (a.stepsNote || ""))).length >= 2,
     LADDER.map((a) => a.stepsNote || null));
  // A step figure in `label` still breaks five other single-line screens, and the
  // split moved text around — so re-check it did not land there.
  ok("the split did not leak a figure into label", LADDER.every((a) => !/\d{3}/.test(a.label)));
  ok("the everyday-steps exclusion is carried once, above the list",
     /Everyday steps only/.test(FIELDS) && (FIELDS.match(/Everyday steps only/g) || []).length === 1);
  ok("the tracker is used when we have it", /trackerSteps && trackerSteps\.avg > 0/.test(FIELDS));
  ok("...and never auto-selects a rung", !/trackerSteps[\s\S]{0,200}onChange\("activityLevel"/.test(FIELDS));
  ok("...averaged over the days that reported, not over 7",
     /stepDays\.reduce\(\(a, b\) => a \+ b, 0\) \/ stepDays\.length/.test(FIELDS));
  // AI/MCP parity: the connector has no system prompt, so the schema string is
  // its only guidance, and a different anchor rungs the same answer differently.
  const AI = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");
  for (const band of ["under 5k", "5–7.5k", "7.5–11k", "11–15k", "15k+"]) {
    ok(`the assistant knows the ${band} band`, AI.includes(band));
  }
  ok("...and the same exclusion", /a planned walk or run is logged separately/.test(AI));
}

// ── it proposes a better rung when one genuinely fits ─────────────────────
// implied ≈ 2200/1600 = 1.375 → "light", one rung down from moderate.
const down = call({ tdee: 2200 });
ok("proposes the rung the measurement fits", down && down.to && down.to.id === "light", down);
ok("...names the rung it is moving FROM", down && down.from && down.from.id === "moderate", down && down.from);
ok("...quotes an ordinary formula TDEE, not the observed number",
   down && down.newTdee === Math.round(BMR * 1.375), down && down.newTdee);
// implied ≈ 2760/1600 = 1.725 → "very", one rung up.
const up = call({ tdee: 2760 });
ok("proposes upward too", up && up.to.id === "very", up);

// ── and stays quiet when it should ────────────────────────────────────────
ok("silent when the nearest rung is the one already set", call({ tdee: 2500 }) === null, call({ tdee: 2500 }));
ok("silent below the noise margin", call({ tdee: MODERATE + 140 }) === null);
ok("speaks just above it", call({ tdee: 2200 }) !== null);
ok("silent on a medium-confidence read", call({ tdee: 2200, conf: "medium" }) === null);
ok("silent on a low-confidence read", call({ tdee: 2200, conf: "low" }) === null);
ok("silent with no measurement at all", suggest({ observed: null, tdee: MODERATE, activityLevel: "moderate", now: NOW }) === null);
ok("silent when the formula TDEE is unusable",
   suggest({ observed: obs(2200), tdee: 0, activityLevel: "moderate", now: NOW }) === null);

// ── off the ladder is a different message, and must NOT be silenced ───────
const off = call({ tdee: 1400 });   // implied 0.875, below sedentary
ok("a gap no rung explains reports outOfLadder", off && off.outOfLadder === true, off);
ok("...and never pins the person to an end rung", off && !off.to, off);
// ⚠️ THE ONE THING THE COOLDOWN MUST NOT HIDE. This branch asks for nothing —
// it says the food log needs attention — so silencing it for a fortnight would
// mute the only message that matters when the measurement is impossible.
const offCooled = call({ tdee: 1400, check: { at: NOW - 1 * DAY, decision: "dismissed" } });
ok("outOfLadder still reported during a cooldown", offCooled && offCooled.outOfLadder === true, offCooled);

// ── the cooldown ──────────────────────────────────────────────────────────
const justAccepted = { at: NOW - 1 * DAY, to: "light", decision: "accepted" };
const justDismissed = { at: NOW - 1 * DAY, to: "light", decision: "dismissed" };
ok("quiet the day after ACCEPTING", call({ tdee: 2200, check: justAccepted }) === null);
ok("quiet the day after DISMISSING", call({ tdee: 2200, check: justDismissed }) === null);
ok("still quiet the day before the cooldown expires",
   call({ tdee: 2200, check: { at: NOW - (COOLDOWN_DAYS - 1) * DAY } }) === null);
ok("asks again once the cooldown has passed",
   call({ tdee: 2200, check: { at: NOW - (COOLDOWN_DAYS + 1) * DAY } }) !== null);
ok("a malformed stamp does not silence it forever", call({ tdee: 2200, check: { at: "nope" } }) !== null);
ok("a missing stamp does not silence it", call({ tdee: 2200, check: {} }) !== null);
// A clock that moved backwards must not become a permanent mute.
ok("a future-dated stamp does not mute it indefinitely",
   call({ tdee: 2200, check: { at: NOW + 400 * DAY }, now: NOW + 500 * DAY }) !== null);

// ── the app wires it the way this file assumes ────────────────────────────
ok("the card calls the module-level rule, not an inline copy",
   // ⚠️ COUNT, DO NOT MATCH. The name appears in the DEFINITION and at the CALL
   // site, so a bare match stayed green when the call was replaced by an inline
   // copy with no cooldown — the exact regression this assertion exists to stop.
   (APP.match(/activityRungSuggestion\(/g) || []).length === 2
   && !/const cur = ACTIVITY_LEVELS\.find\(\(a\) => a\.id === data\.activityLevel\)/.test(APP),
   (APP.match(/activityRungSuggestion\(/g) || []).length);
// ⚠️ AND THE COUNT ALONE IS NOT ENOUGH: neutering the call in place
// (`useMemo(() => (null && { … }))`) keeps both occurrences and stops the card
// ever asking, so the suggestion silently never appears. Pin the memo itself.
ok("...and that call IS the memo the card reads",
   /const activitySuggestion = useMemo\(\(\) => activityRungSuggestion\(\{/.test(APP), true);
// A copy hiding behind a different name still has to redo the nearest-rung
// search, which is the part it cannot avoid writing.
ok("...with no second rung search anywhere in the file",
   (APP.match(/let best = ACTIVITY_LEVELS\[0\], bestErr = Infinity;/g) || []).length === 1,
   (APP.match(/let best = ACTIVITY_LEVELS\[0\], bestErr = Infinity;/g) || []).length);
// The memo must re-run when the decision is recorded, and it now also depends on
// whether a measured correction is in force (S228) — the dep list grew, so this
// names the members rather than the exact string it used to match.
ok("the memo re-runs when the decision is recorded",
   /\}\), \[observed, data\.activityLevel, data\.activityCheck, [^\]]*\]\);/.test(APP));
// ⚠️ AND IT COMPARES AGAINST THE FORMULA, NOT THE FITTED NUMBER. Handing it the
// fitted maintenance would hide the rung suggestion the moment a correction
// landed, including at the ceiling where the rung is still the right fix.
ok("the rung question is asked of the formula", /tdee: formulaTdee, activityLevel/.test(APP));
ok("accepting records the cooldown", /activityCheck: \{ at: Date\.now\(\), to: id, decision: "accepted" \}/.test(APP));
ok("dismissing records the cooldown", /activityCheck: \{ at: Date\.now\(\), to: id, decision: "dismissed" \}/.test(APP));
ok("there is a Not now to dismiss with", /onDismissActivitySuggestion\(activitySuggestion\.to\.id\)/.test(APP));
// ── the anti-clobber stamper (S200g) ──────────────────────────────────────
// Trainerize re-stamps its snapshot fields every 30 minutes unless a deliberate
// local edit is on record. Marking those at each of the ~40 handlers that could
// set one is how the guard got forgotten three times; it is marked once, in
// setDataAndSave, and executed here.
{
  const src = APP.match(/function stampLocalEdits\([\s\S]*?\n\}/);
  const lst = APP.match(/const TZ_SNAPSHOT_FIELDS = \[[\s\S]*?\];/);
  if (!src || !lst) { console.log("  FAIL: stampLocalEdits/TZ_SNAPSHOT_FIELDS not found"); process.exit(1); }
  const { stamp, FIELDS } = new Function(`${lst[0]}\n${src[0]}\nreturn { stamp: stampLocalEdits, FIELDS: TZ_SNAPSHOT_FIELDS };`)();

  const base = { gender: "female", age: "30", heightFt: "5", heightIn: "6", goalWeight: "172",
    bodyFat: "22", activityLevel: "moderate", macroTargets: { protein: 180 },
    firstName: "Casey", lastName: "Client", weightLbs: "186", checkIns: [] };

  ok("stamper: an untouched edit marks nothing",
     Object.keys(stamp(base, { ...base, water: 8 })).filter((k) => k.endsWith("EditedAt")).length === 0);

  for (const f of FIELDS) {
    const changed = { ...base, [f]: f === "macroTargets" ? { protein: 999 } : "CHANGED" };
    const out = stamp(base, changed);
    ok(`stamper: marks ${f} when it changes`, out[`${f}EditedAt`] > 0, out[`${f}EditedAt`]);
    ok(`stamper: does not mark the others for ${f}`,
       Object.keys(out).filter((k) => k.endsWith("EditedAt")).length <= (f.startsWith("height") ? 2 : 1),
       Object.keys(out).filter((k) => k.endsWith("EditedAt")));
  }

  // Height is written and re-stamped as a pair; half a guard invents a height.
  ok("stamper: height marks both halves",
     !!stamp(base, { ...base, heightFt: "6" }).heightInEditedAt
     && !!stamp(base, { ...base, heightIn: "9" }).heightFtEditedAt);

  // ⚠️ VALUE, NOT REFERENCE. React rebuilds the data object on every edit, so a
  // reference compare would mark all ten fields on the first keystroke and hand
  // Trainerize's whole snapshot to whoever typed a letter.
  ok("stamper: an identical value is not an edit",
     Object.keys(stamp(base, { ...base, macroTargets: { protein: 180 } })).filter((k) => k.endsWith("EditedAt")).length === 0);
  ok("stamper: a number and its string are not an edit",
     Object.keys(stamp({ ...base, age: 30 }, { ...base, age: "30" })).filter((k) => k.endsWith("EditedAt")).length === 0);

  // weightLbs keeps its newest-reading-wins rule; a marker would freeze the scale.
  ok("stamper: weightLbs is deliberately NOT marked", !FIELDS.includes("weightLbs"));
  ok("stamper: ...and a weigh-in marks nothing",
     Object.keys(stamp(base, { ...base, weightLbs: "180" })).filter((k) => k.endsWith("EditedAt")).length === 0);

  ok("the app marks from one place, not per handler",
     /const next = stampLocalEdits\(prev, raw\);/.test(APP));

  // NEG: the reference-compare version this deliberately avoids.
  const byRef = (prev, next) => { const o = { ...next }; for (const f of FIELDS) if (prev[f] !== next[f]) o[`${f}EditedAt`] = 1; return o; };
  ok("NEG: a reference compare would mark macroTargets on an identical value",
     !!byRef(base, { ...base, macroTargets: { protein: 180 } }).macroTargetsEditedAt);
}
// Dismissing must not touch the plan — it is an answer, not an edit.
{
  const seg = APP.slice(APP.indexOf("onDismissActivitySuggestion={"), APP.indexOf("onDismissActivitySuggestion={") + 420);
  ok("dismissing does not change activityLevel", !/activityLevel:/.test(seg), seg.slice(0, 120));
}

// ── negative controls: can this harness see the bugs? ─────────────────────
const noCooldown = ({ observed, tdee, activityLevel }) => {          // the shipped-before behaviour
  const cur = LADDER.find((a) => a.id === activityLevel) || LADDER[0];
  const bmr = tdee / cur.multiplier;
  let best = LADDER[0], e = Infinity;
  for (const a of LADDER) { const d = Math.abs(a.multiplier - observed.tdee / bmr); if (d < e) { e = d; best = a; } }
  return best.id === cur.id ? null : { to: best };
};
ok("NEG: the no-memory version would fail the day-after-dismissing check",
   noCooldown({ observed: obs(2200), tdee: MODERATE, activityLevel: "moderate" }) !== null);
const cooldownBeforeLadderCheck = (o) => (o.check ? null : call(o));   // the tempting wrong order
ok("NEG: cooling down BEFORE the ladder check would mute outOfLadder",
   cooldownBeforeLadderCheck({ tdee: 1400, check: justDismissed }) === null);

console.log(fails === 0
  ? `  PASS  activity suggestion + ${COOLDOWN_DAYS}-day cooldown (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
