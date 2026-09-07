// A typed age must not go stale (S201b, Kevin).
//
// "If a user enters their age and not the birthday, let's have the app
// automatically update their age every year based on the date it was entered."
//
// ⚠️ WHY IT MATTERS BEYOND TIDINESS. A frozen age is fed to Mifflin-St Jeor
// (the calorie target), Jackson-Pollock (calipers) and Bailey's over/under-30
// branch — so it is wrong in ONE direction, forever, and nothing surfaces it.
// The same class as the missing-age bug in S200v, just slower.
//
// ⚠️ AND IT IS AN APPROXIMATION. Someone who typed "40" may have been 40 and one
// month or 40 and eleven, so a year later they are 41 or nearly 42. Rolling
// forward is closer than freezing; a dob is exact, which is why dob still wins.
//
// Run: node scripts/test-age-rollforward.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AI = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");
const TZ = readFileSync(join(ROOT, "functions", "trainerize.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

function balanced(src, i) {
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error("unbalanced");
}
const lift = (src) => new Function(
  `${balanced(src, src.indexOf("function ageFromDob("))}\n` +
  `${balanced(src, src.indexOf("const effectiveAge = "))};\nreturn effectiveAge;`)();

const YEAR = 31557600000;
const ago = (y) => Date.now() - Math.round(y * YEAR);

for (const [name, src] of [["app", APP], ["server", AI]]) {
  const effectiveAge = lift(src);

  // ── the thing Kevin asked for ───────────────────────────────────────────
  ok(`${name}: a fresh age is itself`, effectiveAge({ age: "40", ageSetAt: Date.now() }) === 40);
  ok(`${name}: one year on it is 41`, effectiveAge({ age: "40", ageSetAt: ago(1.01) }) === 41);
  ok(`${name}: three years on it is 43`, effectiveAge({ age: "40", ageSetAt: ago(3.2) }) === 43);
  ok(`${name}: it does NOT roll early`, effectiveAge({ age: "40", ageSetAt: ago(0.99) }) === 40);

  // ── a dob is exact, so it still wins ────────────────────────────────────
  const dob = `${new Date().getUTCFullYear() - 30}-01-01`;
  ok(`${name}: a dob beats a typed age`, effectiveAge({ age: "40", ageSetAt: ago(5), dob }) === 30);

  // ── nothing regresses for data that predates the stamp ──────────────────
  // ⚠️ THE IMPORTANT NEGATIVE: every existing plan has an age and NO ageSetAt.
  // Those must read exactly as before, not roll from the epoch to age 95.
  ok(`${name}: an unstamped age is unchanged`, effectiveAge({ age: "40" }) === 40);
  ok(`${name}: ...and is not rolled from zero`, effectiveAge({ age: "40", ageSetAt: 0 }) === 40);
  ok(`${name}: no age is still no age`, effectiveAge({}) === 0);

  // ── bad data must not invent a person ───────────────────────────────────
  ok(`${name}: a future stamp is ignored, not negative`, effectiveAge({ age: "40", ageSetAt: Date.now() + YEAR }) === 40);
  // ⚠️ THIS HAS TO USE A STAMP THAT IS STILL A VALID TIMESTAMP. ago(200) is
  // BEFORE 1970, so it is negative and gets caught by the `setAt > 0` guard —
  // the assertion passed while testing a different branch entirely. A stamp
  // inside the epoch is what actually exercises the ceiling.
  // A 1970 stamp would roll 56 years and land on 96 — under any ceiling on the
  // ANSWER, and completely wrong. The cap is on the ROLL for that reason.
  ok(`${name}: a corrupt stamp falls back to what they typed`,
     effectiveAge({ age: "40", ageSetAt: 100000 }) === 40,
     effectiveAge({ age: "40", ageSetAt: 100000 }));
  ok(`${name}: a plausible long gap still rolls`,
     effectiveAge({ age: "40", ageSetAt: ago(6.3) }) === 46);
  ok(`${name}: ...and a negative stamp is refused by the other guard`,
     effectiveAge({ age: "40", ageSetAt: ago(200) }) === 40);
  // S200v's guards refuse outside 15–100, so the roll must stay in a sane band
  // rather than silently disabling calipers for a long-dormant plan.
  ok(`${name}: a decade-old stamp still lands in range`,
     effectiveAge({ age: "40", ageSetAt: ago(10.5) }) === 50);
}

// ── the stamp is written wherever an age is ─────────────────────────────────
// Without it nothing rolls, and the whole change is inert.
ok("the app stamps at its one write choke point",
   /String\(raw\.age \?\? ""\) !== String\(prev\.age \?\? ""\) && Number\(raw\.age\) > 0/.test(APP)
   && /ageSetAt: Date\.now\(\)/.test(APP));
ok("...only when the age actually changed, so it is not re-stamped on every edit",
   /raw\.age \?\? ""\) !== String\(prev\.age/.test(APP));
ok("the assistant stamps it", /d\.age = a; d\.ageSetAt = Date\.now\(\);/.test(AI));
ok("the Trainerize import stamps it", /d\.age = String\(age\); d\.ageSetAt = Date\.now\(\);/.test(TZ));

// ── the two copies of effectiveAge must agree ──────────────────────────────
{
  const a = balanced(APP, APP.indexOf("const effectiveAge = ")).replace(/\s+/g, " ");
  const b = balanced(AI, AI.indexOf("const effectiveAge = ")).replace(/\s+/g, " ");
  ok("app and server compute age identically", a === b);
}

// ── negative control ───────────────────────────────────────────────────────
const frozen = (d) => Number(d.age) || 0;
ok("NEG: the old behaviour would still say 40 three years on", frozen({ age: "40", ageSetAt: ago(3) }) === 40);

console.log(fails === 0
  ? `  PASS  age roll-forward (${checks} assertions)`
  : `  ${fails}/${checks} FAILED`);
process.exit(fails === 0 ? 0 : 1);
