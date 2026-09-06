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
   /activityRungSuggestion\(\{/.test(APP) && !/const cur = ACTIVITY_LEVELS\.find\(\(a\) => a\.id === data\.activityLevel\)/.test(APP));
ok("the memo re-runs when the decision is recorded", /\}\), \[observed, data\.activityLevel, data\.activityCheck, tdee\]\);/.test(APP));
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
