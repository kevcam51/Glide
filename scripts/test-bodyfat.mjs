// Why three body-fat methods disagreed by nine points (S200v).
//
// KEVIN, about one real client: "On the weight scanner his body fat is 20, on
// the caliper about 15%, and on the tape measure about 11%. All these numbers
// are so far off from each other. It's making me wonder if our app is pulling
// from the right formula and the correct stats."
//
// ⚠️ THE FORMULAS WERE RIGHT. Every coefficient checks out against the published
// sources — Jackson & Pollock 1978 (male chest/abdomen/thigh), Jackson, Pollock
// & Ward 1980 (female triceps/suprailiac/thigh), Siri 495/D−450, and the
// IMPERIAL Hodgdon-Beckett Navy equation with log10, fed genuinely imperial
// inputs. No unit mixing, no swapped site sets. So this file does NOT test the
// coefficients; changing them would be the regression.
//
// What was actually wrong, and both fabricate exactly the reported shape:
//
//   1. NO AGE GUARD. effectiveAge falls back to 0, and the two age-bearing
//      formulas consumed it. A plan with no age computed at age ZERO and read
//      4.4 points too lean at 40, 5.6 at 50 — silently. Navy has no age term,
//      so it did not move the three together: it drove the CALIPER and TAPE
//      numbers down while the scale reading stayed put.
//   2. BAILEY AVERAGED INTO THE TAPE NUMBER. Bailey adds and subtracts INCHES
//      and calls the result a percent — no height, no weight in it — so it
//      measures frame and muscularity as much as fat, and reads low for
//      muscular people. Exactly who a training business coaches.
//
// Run: node scripts/test-bodyfat.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AI = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Brace-balanced lift so the SHIPPING functions run here — a lazy regex
// truncates any of these that contains a nested block.
function balanced(src, startIdx) {
  let d = 0, started = false;
  for (let j = startIdx; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error("unbalanced at " + startIdx);
}
const fnOf = (src, name) => balanced(src, src.indexOf(`function ${name}(`));
const ea = balanced(APP, APP.indexOf("const effectiveAge = ")) + ";";
const S = new Function(`${fnOf(APP, "ageFromDob")}\n${ea}\n${fnOf(APP, "caliperBF")}\n${fnOf(APP, "baileyBF")}\n${fnOf(APP, "navyBF")}\nreturn { caliperBF, baileyBF, navyBF };`)();

const M = { calChest: 12, calAbdomen: 22, calThigh: 12, waist: 36, neck: 15.5, hips: 39, forearm: 11, wrist: 7 };
const MAN = { gender: "male", age: "40", weightLbs: 200, heightFt: 5, heightIn: 10 };
const NO_AGE = { gender: "male", weightLbs: 200, heightFt: 5, heightIn: 10 };

// ── 1. the age guard ──────────────────────────────────────────────────────
ok("calipers answer when age is known", S.caliperBF(MAN, M) === 15);
ok("...and REFUSE when it is not, rather than computing at age 0",
   S.caliperBF(NO_AGE, M) === null, S.caliperBF(NO_AGE, M));
ok("Bailey refuses too", S.baileyBF(NO_AGE, M) === null, S.baileyBF(NO_AGE, M));
// ⚠️ Navy has no age term, which is precisely why a missing age did not shift
// the three together — it opened a gap between them.
ok("Navy is unaffected and still answers", S.navyBF(NO_AGE, M) === 20.4, S.navyBF(NO_AGE, M));
ok("a dob works as well as a typed age",
   S.caliperBF({ ...NO_AGE, dob: `${new Date().getUTCFullYear() - 40}-01-01` }, M) != null);
ok("an absurd age is refused, not computed", S.caliperBF({ ...MAN, age: "3" }, M) === null);
ok("...at both ends", S.caliperBF({ ...MAN, age: "140" }, M) === null);

// The size of the error the guard prevents, stated so nobody "simplifies" it away.
{
  const unguarded = (age) => {
    const sum = M.calChest + M.calAbdomen + M.calThigh;
    const bd = 1.10938 - 0.0008267 * sum + 0.0000016 * sum * sum - 0.0002574 * age;
    return Math.round((495 / bd - 450) * 10) / 10;
  };
  ok("NEG: computing at age 0 reads ~4.4 points too lean for a 40-year-old",
     Math.abs(unguarded(40) - unguarded(0) - 4.4) < 0.3, { at40: unguarded(40), at0: unguarded(0) });
  ok("NEG: ...and ~5.6 for a 50-year-old",
     Math.abs(unguarded(50) - unguarded(0) - 5.6) < 0.3, { at50: unguarded(50), at0: unguarded(0) });
}

// ── 2. Bailey is a frame index, so it no longer dilutes the tape number ───
// Hold waist, neck and every skinfold FIXED — the man's fatness cannot change —
// and vary only frame. Navy and calipers must not move; Bailey does, a lot.
{
  const slight = { ...M, hips: 39, forearm: 10.5, wrist: 6.5 };
  const built  = { ...M, hips: 42, forearm: 13.5, wrist: 7.5 };
  ok("Navy ignores frame", S.navyBF(MAN, slight) === S.navyBF(MAN, built));
  ok("calipers ignore frame", S.caliperBF(MAN, slight) === S.caliperBF(MAN, built));
  const spread = Math.abs(S.baileyBF(MAN, slight) - S.baileyBF(MAN, built));
  ok("Bailey swings several points on identical fatness", spread > 5, spread);
  ok("...and reads LOWER for the more muscular build — the bias that matters here",
     S.baileyBF(MAN, built) < S.baileyBF(MAN, slight),
     { slight: S.baileyBF(MAN, slight), built: S.baileyBF(MAN, built) });
}
ok("the tape estimate is Navy, with Bailey only as a fallback",
   /const tapeAvg = navy != null \? navy : bailey;/.test(APP));
ok("...and the old 50/50 average is gone",
   !/const both = \[bailey, navy\]\.filter/.test(APP));
ok("...and the method travels with the number", /tapeSource = navy != null \? "navy"/.test(APP));

// ── 3. the server said something different for the same client ────────────
// It had no caliper maths at all and did not know the scale reading existed, so
// the AI quoted a tape-only number while the app showed the caliper or scale one.
ok("the server now has the caliper maths", /function caliperBF\(d, m\)/.test(AI));
ok("...and knows about the scale reading", /Number\(m\.bodyFatManual\) > 0/.test(AI));
ok("...and uses the app's precedence", /manual != null \? manual : caliper != null \? caliper : tapeAvg/.test(AI));
ok("...and Navy over Bailey, like the app", /const tapeAvg = navy != null \? navy : bailey;/.test(AI));
ok("...and reports which method it used", /bodyFatSource, tapeSource,/.test(AI));
// The app's caliper function is lifted verbatim, so the two cannot drift.
{
  const appFn = fnOf(APP, "caliperBF").replace(/\s+/g, " ");
  const srvFn = fnOf(AI, "caliperBF").replace(/\s+/g, " ");
  ok("the two copies of caliperBF are identical", appFn === srvFn);
}

// ── 4. already-stored numbers (S200v) ─────────────────────────────────────
// Kevin: "will these changes be able to make changes to already inputed
// information? I want to make sure the information that is already in is
// correct." The raw measurements self-correct — every screen recomputes from
// them. The SNAPSHOT in d.bodyFat does not: it was written at save time with
// whatever maths was current, and it feeds lean mass, the derived goal weight,
// the trainer dashboards and the AI.
{
  const rb = new Function(`${fnOf(APP, "repairedBodyFat")}\nreturn repairedBodyFat;`);
  ok("the repair exists and is pure", typeof rb === "function");
  ok("it runs when a plan is opened", /const fixed = repairedBodyFat\(merged\);/.test(APP));
  // ⚠️ THE ONE RULE THAT MATTERS: correct, never erase. With the new age guard a
  // plan without an age returns null for calipers, and writing that null would
  // delete a reading the person can still see.
  ok("a null recompute never overwrites a stored number", /if \(fresh == null\) return null;\s*\/\/ never erase/.test(APP));
  ok("...and the caller only writes when it returns something", /if \(fixed != null\)/.test(APP));
  ok("an unchanged value is not rewritten", /Math\.abs\(stored - fresh\) >= 0\.1 \? fresh : null/.test(APP));
  ok("an empty slot is filled rather than skipped", /if \(!\(stored > 0\)\) return fresh;/.test(APP));
  ok("it respects the hide-body-fat opt-out", /if \(!list\.length \|\| d\.hideBodyFat\) return null;/.test(APP));
  ok("it repairs from the NEWEST measurement, not an arbitrary one",
     /sort\(\(a, b\) => \(b\.timestamp \|\| 0\) - \(a\.timestamp \|\| 0\)\)\[0\]/.test(APP));
}

// ── 5. Bailey, kept and completed (S200w, Kevin's own source) ─────────────
// Kevin supplied the four tape equations and Bailey's derived numbers. The
// equations in the code already matched his source exactly; this pins them so a
// future "correction" cannot drift them, and checks the parts that were missing.
{
  const S2 = new Function(`${fnOf(APP, "baileyCorrectWeight")}\n${fnOf(APP, "baileyLeanRange")}\n${balanced(APP, APP.indexOf("const BAILEY_TARGET_BF ="))};\n${balanced(APP, APP.indexOf("const BAILEY_LBM_BY_HEIGHT ="))};\nreturn { baileyCorrectWeight, baileyLeanRange };`)();

  // ⚠️ KEVIN'S OWN WORKED EXAMPLES. If a future edit "fixes" a coefficient,
  // these fail with his numbers rather than with an abstraction.
  const ex = (d, m) => S.baileyBF(d, m);
  ok("men ≤30: 34 + ½·36 − 3·11 − 7 = 12",
     ex({ gender:"male", age:"25" }, { waist:34, hips:36, forearm:11, wrist:7 }) === 12);
  ok("men >30: 40 + ½·40 − 2.7·10.75 − 7 ≈ 24",
     Math.abs(ex({ gender:"male", age:"40" }, { waist:40, hips:40, forearm:10.75, wrist:7 }) - 24) < 0.1);
  // 23.05 exactly; IEEE gives 23.0499… so it rounds to 23 — which is the answer
  // Kevin's own worked example states, so the code and the source agree.
  ok("women ≤30: 36 + 0.8·21 − 2·12 − 5.75 = 23",
     ex({ gender:"female", age:"25" }, { hips:36, thigh:21, calf:12, wrist:5.75 }) === 23);
  ok("women >30: 39 + 23 − 2·13.5 − 6 = 29",
     ex({ gender:"female", age:"40" }, { hips:39, thigh:23, calf:13.5, wrist:6 }) === 29);

  // Bailey's correct weight: men lean/.85, women lean/.78 — his Ann/Jack table.
  ok("Jack: 131 lbs lean → 154 lbs at 15%", S2.baileyCorrectWeight("male", 131) === 154);
  ok("Ann: 98 lbs lean → 126 lbs at 22%", Math.abs(S2.baileyCorrectWeight("female", 98) - 126) <= 1);
  ok("...and it refuses without a lean mass", S2.baileyCorrectWeight("male", 0) === null);
  ok("...or an unknown gender", S2.baileyCorrectWeight("other", 131) === null);

  // The lean-mass reference table, spot-checked against the published rows.
  ok("5'10\" man reads 139–157", String(S2.baileyLeanRange({ gender:"male", heightFt:5, heightIn:10 })) === "139,157");
  ok("5'4\" woman reads 83–100", String(S2.baileyLeanRange({ gender:"female", heightFt:5, heightIn:4 })) === "83,100");
  // The table genuinely has no men under 5'3" or women over 6'0" — absent, not zero.
  ok("a height the table does not cover returns nothing",
     S2.baileyLeanRange({ gender:"male", heightFt:5, heightIn:0 }) === null);

  ok("both are shown, and named as Bailey's", /Bailey&rsquo;s correct weight/.test(APP)
     && /Bailey&rsquo;s range for your height/.test(APP));
  // Kevin asked to KEEP Bailey — S200v only stopped it diluting the tape number.
  ok("the Bailey row is still displayed on its own", /label: "Tape · Bailey"/.test(APP));
}

console.log(fails === 0
  ? `  PASS  body fat (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
