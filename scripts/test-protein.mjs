// The protein target: one number, six screens (S224, Kevin).
//
// Kevin: "I want to keep the option to eat your body weight in g of protein as
// an option, but please still do the research on this." The research came back
// supporting the NUMBER and rejecting the DENOMINATOR: 1 g/lb is well inside
// what Helms 2014 and the 2025 Refalo update support for a lean client cutting,
// but it multiplies TOTAL bodyweight — so a 320 lb client at 42% body fat was
// told to eat 320 g, which is 71% of their calories and left four grams of carbs.
// Fat tissue does not need feeding.
//
// ⚠️ AND THE SAME NUMBER WAS COMPUTED IN SIX PLACES, GIVING FOUR ANSWERS: 0.8
// g/lb in the Muscle tab, 0.8-or-1.0 chosen by PACE in Nutrients, the plan's
// basis on the dashboard and the share card, and a bare bodyweight in the
// beginners' view. This suite exists mostly to stop a seventh appearing.
//
// ⚠️ EVERY HELPER IS LIFTED FROM THE SHIPPING FILES AND RUN, not retyped — both
// the App copy and the functions/ mirror, which are then required to agree.
//
// Run: node scripts/test-protein.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const TOOLS = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

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

// ⚠️ ASSERTIONS ABOUT WHAT A USER READS MUST NOT MATCH A COMMENT (S208, hit six
// times in S228). The word this suite is hunting for — "Morton" — survives
// deliberately in two code comments explaining WHY it was removed, so a naive
// /Morton/ over the raw file would fail against the fix itself.
const codeOnly = (src) => src
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

const APP_CODE = codeOnly(APP);

// ── the two implementations, both lifted and run ───────────────────────────
const APP_SRC = ["PROTEIN_REF_BF", "PROTEIN_MAX_PCT", "proteinBasisOf", "proteinPlan", "autoProteinG"]
  .map((n) => liftDecl(APP, n)).join("\n");
const buildApp = (src) => new Function(`${src}; return { proteinPlan, autoProteinG, PROTEIN_REF_BF, PROTEIN_MAX_PCT };`)();
const A = buildApp(APP_SRC);

const SRV_SRC = ["PROTEIN_REF_BF", "PROTEIN_MAX_PCT", "proteinPlan"].map((n) => liftDecl(TOOLS, n)).join("\n");
const S = new Function(`${SRV_SRC}; return { proteinPlan, PROTEIN_REF_BF, PROTEIN_MAX_PCT };`)();

const P = (over = {}) => ({ weightLbs: 180, ...over });

// ── 1. Kevin's option is untouched for the client it was written for ───────
{
  // 1 g/lb IS the right answer at PROTEIN_REF_BF — that is what the
  // normalisation is for, so a lean client must not move by a single gram.
  const lean = A.proteinPlan(P({ bodyFat: 15 }), 2400);
  ok("a lean client at the reference body fat is unchanged at 1 g/lb", lean.grams === 180, lean);
  ok("...and the bodyweight basis with no reading gives the same 180", A.proteinPlan(P(), 2400).grams === 180);
  // Leaner than the reference earns MORE, which is the direction that matters.
  ok("someone leaner than the reference gets more, not less",
     A.proteinPlan(P({ bodyFat: 8 }), 2400).grams > 180, A.proteinPlan(P({ bodyFat: 8 }), 2400));
  ok("the 0.7 g/lb choice is still honoured", A.proteinPlan(P({ proteinPerLb: 0.7 }), 2400).grams === 126);
  ok("...and it rides the lean denominator too",
     A.proteinPlan(P({ proteinPerLb: 0.7, bodyFat: 15 }), 2400).grams === 126);
  // An unrecognised basis falls back to 1.0 exactly as proteinBasisOf does.
  ok("an unknown basis falls back to 1 g/lb", A.proteinPlan(P({ proteinPerLb: 1.4 }), 2400).grams === 180);
}

// ── 2. the case the whole change exists for ────────────────────────────────
{
  // The research table, run against the shipping helper.
  const CAL_320 = 1800;   // that client's own target: sedentary 320 lb, 1 lb/wk
  const big = A.proteinPlan(P({ weightLbs: 320, bodyFat: 42 }), CAL_320);
  ok("the 320 lb client is no longer told to eat 320 g", big.grams < 320 && big.grams > 150, big);
  ok("...and the screen is told WHY", big.basis === "lean" && big.leanLbs === 186, big);
  // ⚠️ THE FAILURE THIS FIXES IS THE CARB BUDGET, not the protein figure itself:
  // protein 320 g plus fat at 28% left FOUR grams of carbs, and no screen said so.
  const carbsAfter = (cal, p) => Math.round((cal - p * 4 - Math.round(cal * 0.28 / 9) * 9) / 4);
  ok("(control) the old number really did leave four grams of carbs",
     carbsAfter(CAL_320, 320) <= 5, carbsAfter(CAL_320, 320));
  ok("...and the new one leaves a real carb budget",
     carbsAfter(CAL_320, big.grams) > 100, carbsAfter(CAL_320, big.grams));

  // The middle row of the same table.
  const mid = A.proteinPlan(P({ weightLbs: 260, bodyFat: 35 }), 2200);
  ok("the 260 lb client comes down too", mid.grams > 180 && mid.grams < 260, mid);

  // ⚠️ THE BAND IS WHAT MAKES A READING USABLE, NOT TRUTHINESS. A stored 0 (or a
  // blank that parsed to one) would claim 100% lean mass and hand out a target
  // 18% high — wrong in the flattering direction, which is the dangerous one.
  for (const bf of [0, 2, 71, 90, -5, NaN, null, undefined, ""]) {
    const r = A.proteinPlan(P({ bodyFat: bf }), 2400);
    ok("an implausible body fat falls back to bodyweight", r.basis === "weight" && r.grams === 180, { bf, ...r });
  }
}

// ── 3. the ceiling: high on purpose, and never silent ──────────────────────
{
  // ⚠️ IT MUST NOT FIGHT A LEGITIMATE HIGH-PROTEIN CUT. Lowering protein as
  // calories fall is exactly backwards — it is the reason the IOM's 35% AMDR was
  // rejected as the bound. A lean 180 lb client on an aggressive 1,500 is the
  // case that would have been clipped by it.
  ok("a lean client on a deep cut keeps their protein", A.proteinPlan(P(), 1500).grams === 180, A.proteinPlan(P(), 1500));
  ok("(control) a 35% ceiling WOULD have clipped that client", Math.floor(1500 * 0.35 / 4) < 180);

  // It binds where the number is absurd.
  const absurd = A.proteinPlan(P({ weightLbs: 320 }), 1960);   // no body-fat reading
  ok("with no reading the ceiling catches the absurd case", absurd.capped === true && absurd.grams === 245, absurd);
  ok("...and the raw figure comes back so the note can quote it", absurd.raw === 320, absurd);
  ok("...and it is never more than half the calorie target", absurd.grams * 4 <= 1960 * A.PROTEIN_MAX_PCT);

  // With no calorie target there is nothing to take a share of.
  const noCal = A.proteinPlan(P({ weightLbs: 320 }), null);
  ok("no calorie target means no ceiling rather than a guess", noCal.capped === false && noCal.grams === 320, noCal);

  // A plan with no weight answers null rather than 0 — 0 g is a prescription.
  for (const w of [0, null, undefined, "", -5]) {
    const r = A.proteinPlan(P({ weightLbs: w }), 2400);
    ok("no weight returns nothing rather than zero grams", r.grams === null && r.basis === null, { w, ...r });
  }
}

// ── 4. the body-fat preference is honoured ─────────────────────────────────
{
  // hideBodyFat is someone saying "don't show me that number". Using it to
  // silently move their protein and then explaining the move would quote it
  // straight back at them.
  const hidden = A.proteinPlan(P({ weightLbs: 260, bodyFat: 35, hideBodyFat: true }), 2200);
  ok("a hidden body fat stays off the lean basis", hidden.basis === "weight", hidden);
  ok("...and the ceiling is what protects them instead",
     hidden.grams * 4 <= 2200 * A.PROTEIN_MAX_PCT + 4, hidden);
}

// ── 5. the app and the server must not drift ───────────────────────────────
{
  // functions/ cannot import from src/, so this is a hand-kept mirror. The
  // observedTdee precedent asserts byte-identity; this one runs both, which also
  // catches a divergence introduced by an "equivalent" rewrite.
  ok("the mirrored constants match", S.PROTEIN_REF_BF === A.PROTEIN_REF_BF && S.PROTEIN_MAX_PCT === A.PROTEIN_MAX_PCT);
  let bad = null, swept = 0;
  for (const w of [0, 110, 150, 180, 220, 260, 320, 400]) {
    for (const bf of [null, 8, 15, 22, 30, 42, 55]) {
      for (const perLb of [undefined, 0.7, 1.0]) {
        for (const cal of [null, 1200, 1500, 1960, 2400, 3200]) {
          const d = { weightLbs: w, bodyFat: bf, proteinPerLb: perLb };
          const a = A.proteinPlan(d, cal), s = S.proteinPlan(d, cal);
          swept++;
          if (a.grams !== s.grams || a.basis !== s.basis || a.capped !== s.capped || a.raw !== s.raw) bad = { d, cal, a, s };
        }
      }
    }
  }
  ok("the app and the AI agree on every plan in the sweep", !bad, bad);
  ok("(control) the sweep is not empty", swept === 8 * 7 * 3 * 6, swept);
  // A control that cannot go red proves nothing (S214) — break the mirror and
  // require the comparison above to notice.
  const brokenSrv = new Function(`${SRV_SRC.replace("const PROTEIN_REF_BF = 15;", "const PROTEIN_REF_BF = 20;")}; return { proteinPlan };`)();
  ok("(mutation) a drifted mirror is caught",
     brokenSrv.proteinPlan({ weightLbs: 260, bodyFat: 35 }, 2200).grams !== A.proteinPlan({ weightLbs: 260, bodyFat: 35 }, 2200).grams);
}

// ── 6. every reader goes through the helper ────────────────────────────────
{
  // ⚠️ COUNT, DON'T FIND (S210). Each of these shapes existed exactly once and
  // each was a different answer to the same question.
  ok("the muscle tab no longer hardcodes 0.8 g/lb", !/Math\.round\(weightLbs \* 0\.8\)/.test(APP_CODE));
  ok("the pace no longer picks the protein multiplier", !/proteinMultiplier/.test(APP_CODE));
  ok("the beginners' view no longer reads a bare bodyweight",
     !/const protein = Math\.round\(Number\(data\.macroTargets\?\.protein\) \|\| w\)/.test(APP_CODE));
  ok("the share card routes through the helper", /const proteinG = mtS\.protein != null \? Number\(mtS\.protein\) : autoProteinG\(data, targetCals\);/.test(APP_CODE));
  // Five call sites in App (dashboard, share card, muscle, nutrients, simple view
  // via autoProteinG) and one in the server.
  const appCalls = (APP_CODE.match(/proteinPlan\(/g) || []).length;
  ok("every App reader calls the helper", appCalls >= 6, appCalls);   // 1 declaration + ≥5 uses
  ok("...and so does the server", /proteinPlan\(d, cal\)\.grams/.test(codeOnly(TOOLS)));
  // The basis chips must advertise what the plan will actually show.
  ok("the basis chip prices itself through the helper",
     /proteinPlan\(\{ \.\.\.data, weightLbs, proteinPerLb: v \}, target\)\.grams/.test(APP_CODE));
  ok("...and no longer multiplies the weight itself", !/\{Math\.round\(Number\(weightLbs\)\*v\)\}g/.test(APP_CODE));
}

// ── 7. a bound that changes the answer says so ─────────────────────────────
{
  // The 1,200-floor rule, applied here: a silent clamp is its own bug.
  ok("the card discloses the move", /\{!macrosCustom && protMoved && \(/.test(APP_CODE));
  ok("...naming the raw figure it replaced", /protPlan\.raw/.test(APP_CODE));
  ok("...and the lean mass it used", /protPlan\.leanLbs/.test(APP_CODE));
  // ⚠️ AND IT SPEAKS ONLY WHEN THE ANSWER MOVED. A lean client's lean-mass
  // target IS the number 1 g/lb already gave them; a permanent paragraph
  // explaining a change that did not happen is noise, not disclosure.
  ok("...only when the number actually moved",
     /const protMoved = protPlan\.grams != null\s*\n\s*&& Math\.abs\(protPlan\.grams - Math\.round\(Number\(weightLbs\) \* protPlan\.perLb\)\) > 2;/.test(APP_CODE));
  // ⚠️ THE PRESET CAPTION MUST DESCRIBE THE NUMBER BESIDE IT. It read "1 g/lb
  // protein" over a tile showing 199 g for a 260 lb client — the denominator had
  // moved and the caption went on quoting the old rule. Found by rendering it.
  ok("the preset caption follows the same three cases, in the same order",
     /sub: !protMoved \? `\$\{proteinPerLb\} g\/lb protein`\s*\n\s*: protPlan\.capped \? `protein held at \$\{Math\.round\(PROTEIN_MAX_PCT \* 100\)\}% of cal`\s*\n\s*: "protein from lean mass",/.test(APP_CODE));
  ok("...and no longer hardcodes the g\/lb caption", !/sub: `\$\{proteinPerLb\} g\/lb protein`,/.test(APP_CODE));
  // The three cases the render check walked, as arithmetic: unchanged, moved by
  // the denominator, moved by the ceiling.
  ok("(render parity) a lean client is inside the quiet band",
     Math.abs(A.proteinPlan(P({ bodyFat: 15 }), 1876).grams - 180) <= 2);
  ok("(render parity) a 260 lb client at 35% is outside it",
     Math.abs(A.proteinPlan(P({ weightLbs: 260, bodyFat: 35 }), 2439).grams - 260) > 2);
  ok("(render parity) ...and lands on the 199 g the card showed",
     A.proteinPlan(P({ weightLbs: 260, bodyFat: 35 }), 2439).grams === 199);
  ok("(render parity) the 320 lb ceiling case lands on the 262 g the card showed",
     A.proteinPlan(P({ weightLbs: 320 }), 2102).grams === 262);
}

// ── 8. no research citation is quoted at a user ────────────────────────────
{
  // ⚠️ THE ONE PLACE THE APP PUT A CITATION IN FRONT OF A CLIENT, AND IT WAS A
  // MISUSE: "the proven ceiling for maximizing muscle protein synthesis (Morton
  // et al. 2018)". Morton studied people in energy BALANCE, its 1.62 g/kg
  // breakpoint was not statistically significant (p=0.079), the outcome was lean
  // mass rather than MPS, and the app quoted 0.8 g/lb while the dashboard used
  // 1.0. Comments explaining that are fine; user-facing copy is not.
  ok("Morton is no longer quoted to users", !/Morton/.test(APP_CODE), (APP_CODE.match(/.{0,60}Morton.{0,60}/) || [])[0]);
  ok("nor is the 'proven ceiling' claim", !/proven ceiling/i.test(APP_CODE));
  // ⚠️ COUNTED, NOT FOUND. This is the positive control for codeOnly above —
  // if the stripper ever stopped stripping, the absence check would pass for
  // the wrong reason. An exact count also means a NEW mention has to be
  // looked at rather than absorbed: the two that stand are both comments
  // explaining why the citation left.
  const mortonMentions = (APP.match(/Morton/g) || []).length;
  ok("(control) the reasoning survives in the comments, which is the point",
     mortonMentions === 2, mortonMentions);
  ok("the surplus paragraph no longer attributes itself to a protein paper",
     !/Morton et al\. \(2018\)<\/strong>\. A lean bulk surplus/.test(APP));
  // The stale parentheticals that quoted a figure no screen computed.
  ok("no prose hardcodes 0.8 g/lb any more", !/protein \(0\.8g\/lb\)/.test(APP_CODE));
}

// ── 9. mutation: each guard must be load-bearing ───────────────────────────
{
  const mutate = (from, to) => {
    const c = APP_SRC.split(from).length - 1;
    if (c !== 1) throw new Error(`mutation anchor appears ${c}× : ${from}`);
    return buildApp(APP_SRC.replace(from, to));
  };
  // Drop the lean-mass branch → the 320 lb client is back to a bodyweight target.
  const noLean = mutate("const useLean = !d.hideBodyFat &&", "const useLean = false &&");
  ok("(mutation) removing the lean denominator is caught",
     noLean.proteinPlan({ weightLbs: 320, bodyFat: 42 }, 4000).grams === 320);
  // Drop the ceiling → the absurd case returns.
  const noCap = mutate("const capped = maxG != null && raw > maxG;", "const capped = false;");
  ok("(mutation) removing the ceiling is caught",
     noCap.proteinPlan({ weightLbs: 320 }, 1960).grams === 320);
  // Drop the normalisation → a lean client's number moves, which is the promise
  // that licenses the change shipping to everyone at once.
  const noNorm = mutate("(leanLbs * perLb) / (1 - PROTEIN_REF_BF / 100)", "(leanLbs * perLb)");
  ok("(mutation) losing the normalisation moves the lean client",
     noNorm.proteinPlan({ weightLbs: 180, bodyFat: 15 }, 2400).grams !== 180);
  // Drop the weight guard → 0 g becomes a prescription.
  const noWeight = mutate("if (!(w > 0)) return empty;", "");
  ok("(mutation) losing the weight guard prescribes zero grams",
     noWeight.proteinPlan({ weightLbs: 0 }, 2400).grams === 0);
  // Drop the band → a stored 0 claims 100% lean mass.
  const noBand = mutate("isFinite(bf) && bf >= 3 && bf <= 70", "isFinite(bf)");
  ok("(mutation) losing the plausible band trusts a zero reading",
     noBand.proteinPlan({ weightLbs: 180, bodyFat: 0 }, 4000).grams > 200);
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED`); process.exit(1); }
console.log("  Protein: one target, six screens, and a denominator that tracks muscle.\n");
