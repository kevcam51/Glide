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
import { stripComments } from "./lib/strip-comments.mjs";

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
//
// ⚠️ AND THE STRIPPER IS THE SHARED SCANNER, NOT THREE REGEXES (S229b). The
// obvious version treats the `/*` inside `accept="image/*,video/*"` as the start
// of a block comment and deletes forward to the next real `*/` — ~60,000
// characters of App.jsx, invisible to every assertion written against it. The
// dangerous half is not a failing assertion; it is an absence check like the
// Morton one below passing over code that is really there.
//
// This suite carried its own belt-and-braces pass — the shared scanner used to
// leave 565 comment lines in App.jsx, because an apostrophe in JSX prose opened
// a string that ran to the next apostrophe. S230 fixed that in the scanner, and
// scripts/test-strip-comments.mjs now asserts zero survivors in this file, so
// the local workaround is gone.
const codeOnly = stripComments;

const APP_CODE = codeOnly(APP);

// ── the two implementations, both lifted and run ───────────────────────────
const APP_SRC = ["PROTEIN_REF_BF", "PROTEIN_MAX_PCT", "proteinBasisOf", "proteinPlan", "autoProteinG",
  "MACRO_SPLITS", "MACRO_KEYS_PLAN", "MACRO_KEYS_BUILD", "splitGrams", "macroSplitTiles"]
  .map((n) => liftDecl(APP, n)).join("\n");
const buildApp = (src) => new Function(`${src}; return { proteinPlan, autoProteinG, PROTEIN_REF_BF, PROTEIN_MAX_PCT,
  MACRO_SPLITS, MACRO_KEYS_PLAN, MACRO_KEYS_BUILD, splitGrams, macroSplitTiles };`)();
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
  // The anchor tile is the only caption the card writes itself, because only
  // this screen knows the protein BASIS; every comparative comes measured.
  ok("the anchor caption follows the same three cases, in the same order",
     /sub: x\.sub != null \? x\.sub\s*\n\s*: !protMoved \? `\$\{proteinPerLb\} g\/lb protein`\s*\n\s*: protPlan\.capped \? `protein held at \$\{Math\.round\(PROTEIN_MAX_PCT \* 100\)\}% of cal`\s*\n\s*: "protein from lean mass" \}\)\);/.test(APP_CODE));
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

// ── 10. the splits, the contradiction they used to carry, and the surfaces ─
{
  // ⚠️ THE PRESETS USED TO SET PROTEIN AS A PERCENTAGE, WHICH FOUGHT THE
  // DEFAULT AND RAN BACKWARDS. A 180 lb client on 2,200 cal was offered 33%
  // protein by their plan and 40% by the Cutting tile beside it; and a
  // percentage falls with the calories, so the deeper the deficit the LESS
  // protein it asked for — the opposite of every deficit-specific source.
  ok("no split sets protein as a percentage any more",
     !/protein: 40, carbs: 35, fat: 25/.test(APP_CODE) && !/protein: 30, carbs: 45, fat: 25/.test(APP_CODE));
  ok("...and the goal-derived tile is gone with it",
     !/goalLbl/.test(APP_CODE) && !/sub: "from your goal"/.test(APP_CODE));
  // ⚠️ COUNT, DON'T FIND. A second copy of the table inside MuscleTab would be
  // lifted by nothing here (liftDecl takes the FIRST match) and would drift in
  // silence — the exact shape of the six-readers-four-answers bug above.
  ok("there is exactly one split table", (APP_CODE.match(/const MACRO_SPLITS = \[/g) || []).length === 1);
  ok("...and exactly one builder", (APP_CODE.match(/function splitGrams\(/g) || []).length === 1);

  const P0 = (over = {}) => ({ weightLbs: 180, ...over });

  // ── the plan surface ────────────────────────────────────────────────────
  {
    const tiles = A.macroSplitTiles(P0(), 1876, A.MACRO_KEYS_PLAN);
    ok("the dashboard shows four", tiles.length === 4, tiles.map((x) => x.key));
    ok("...anchored on the bodyweight tile", tiles[0].key === "bodyweight");
    ok("...which carries no comparative caption, because it is the thing compared to",
       tiles[0].sub === null);
    // "the protein can be different for some of the other ones that are not
    // high protein based" — two of the four sit below the basis.
    ok("...and two of the four carry less protein than the anchor",
       tiles.filter((x) => x.t.protein < tiles[0].t.protein).length === 2, tiles.map((x) => x.t.protein));
    ok("...the anchor IS the plan's own target", tiles[0].t.protein === A.proteinPlan(P0(), 1876).grams);
  }

  // ── the build surface ───────────────────────────────────────────────────
  {
    const tiles = A.macroSplitTiles(P0(), 2900, A.MACRO_KEYS_BUILD);
    ok("the Muscle tab shows three", tiles.length === 3, tiles.map((x) => x.key));
    // ⚠️ THE BULKING TILE IS EXCLUDED ON PURPOSE. pMul 0.80 against a 1 g/lb
    // basis IS 0.8 g/lb — verbatim the figure S224 deleted from this tab as a
    // defect — and it would be the one-tap obvious choice on the screen whose
    // own copy calls protein "your most important macro".
    ok("...and never the bulking one", !tiles.some((x) => x.key === "bulking"));
    ok("(control) bulking really does prescribe 0.8 g/lb",
       A.splitGrams(A.MACRO_SPLITS.find((o) => o.key === "bulking"), P0(), 4000).protein === 144);
    ok("...anchored on the tab's own lean-bulk split", tiles[0].key === "leanbulk");
    ok("...which is unchanged from what the tab prescribed before the chooser existed",
       tiles[0].t.protein === A.proteinPlan(P0(), 2900).grams
       && tiles[0].t.fat === Math.round((2900 * 0.25) / 9), tiles[0].t);
    // ⚠️ AND THE NAMES CHANGE WITH THE SURFACE. "Cutting" on a lean-bulk screen
    // is the only tile that RAISES protein, so the arithmetically right choice
    // would carry the word telling you not to take it.
    ok("...and the labels are the build ones", tiles[1].label === "High protein" && tiles[2].label === "Higher fat",
       tiles.map((x) => x.label));
    ok("(control) the same keys read differently on the plan surface",
       A.macroSplitTiles(P0(), 1876, ["bodyweight", "cutting", "balanced"])[1].label === "Cutting");
  }

  // ⚠️ THE CAPTION BUG THIS SURFACE WOULD HAVE SHIPPED. The build anchor prices
  // fat at 25%, which is the high-protein split's OWN share — so a hardcoded
  // "less fat" tail would have sat beside a fat number identical to the
  // reader's. Measured, it says "same fat".
  {
    const tiles = A.macroSplitTiles(P0(), 2900, A.MACRO_KEYS_BUILD);
    ok("the fat word is measured, so it says same fat when the fat is the same",
       tiles[1].t.fat === tiles[0].t.fat && /same fat/.test(tiles[1].sub), tiles[1]);
    ok("(control) the same tile says less fat on the plan surface, where it is",
       /less fat/.test(A.macroSplitTiles(P0(), 1876, A.MACRO_KEYS_PLAN)[1].sub));
    // ⚠️ \b MATTERS: a bare /tail: "/ also matches `detail: "`, which appears
    // twice in an unrelated connector-status helper. My own false positive.
    ok("...and no tail is asserted in the table any more", !/\btail: "/.test(APP_CODE));
  }

  // ── structural claims, swept over real plans, on BOTH surfaces ──────────
  let badSum = null, badCarbs = null, badCeil = null, badWord = null, swept = 0;
  for (const cal of [1200, 1500, 1876, 2102, 2439, 2900, 3200, 3600]) {
    for (const over of [{}, { weightLbs: 120 }, { weightLbs: 260, bodyFat: 35 }, { weightLbs: 320 }, { weightLbs: 320, bodyFat: 42 }]) {
      for (const keys of [A.MACRO_KEYS_PLAN, A.MACRO_KEYS_BUILD]) {
        const tiles = A.macroSplitTiles(P0(over), cal, keys);
        const ceilG = Math.floor((cal * A.PROTEIN_MAX_PCT) / 4);
        const base = tiles[0].t;
        const maxCarbs = Math.max(...tiles.map((x) => x.t.carbs));
        for (const x of tiles) {
          swept++;
          // The three must still add up to the day — macroCalorieGap warns about
          // a split that doesn't, and a preset should never trip its own check.
          const sum = x.t.protein * 4 + x.t.carbs * 4 + x.t.fat * 9;
          if (Math.abs(sum - cal) > 6) badSum = { cal, over, k: x.key, t: x.t, sum };
          if (x.t.protein > ceilG) badCeil = { cal, over, k: x.key, t: x.t, ceilG };
          if (x.t.carbs < 0) badCarbs = { cal, over, k: x.key, t: x.t };
          if (x.sub == null) continue;
          // EVERY word in a caption must match the numbers beside it.
          const pOk = /more protein/.test(x.sub) ? x.t.protein > base.protein
                    : /less protein/.test(x.sub) ? x.t.protein < base.protein
                    : x.t.protein === base.protein;
          const fOk = /more fat/.test(x.sub) ? x.t.fat > base.fat
                    : /less fat/.test(x.sub) ? x.t.fat < base.fat
                    : /same fat/.test(x.sub) ? x.t.fat === base.fat : true;
          const cOk = /most carbs/.test(x.sub) ? (x.t.carbs === maxCarbs && maxCarbs > base.carbs)
                    : /more carbs/.test(x.sub) ? x.t.carbs > base.carbs
                    : /fewer carbs/.test(x.sub) ? x.t.carbs < base.carbs
                    : /same carbs/.test(x.sub) ? x.t.carbs === base.carbs : true;
          if (!(pOk && fOk && cOk)) badWord = { cal, over, k: x.key, sub: x.sub, t: x.t, base };
        }
      }
    }
  }
  ok("every split still adds up to the day", !badSum, badSum);
  ok("...and none of them steps over the ceiling", !badCeil, badCeil);
  ok("...nor leaves the carb budget negative", !badCarbs, badCarbs);
  ok("...and EVERY caption word matches the numbers beside it, on both surfaces", !badWord, badWord);
  ok("(control) the sweep ran", swept === 8 * 5 * (4 + 3), swept);

  // ⚠️ THE CALORIES AND THE BASIS ARE NOT INDEPENDENT, which is why splitGrams
  // takes the plan rather than a precomputed protein figure: a mismatched pair
  // returns protein and carbs that disagree while macroCalorieGap still reports
  // off:false, because the three do add up.
  ok("the builder derives the basis from the same calories it splits",
     /function splitGrams\(o, d, cal\) \{[\s\S]{0,220}const base = proteinPlan\(d, c\)\.grams \|\| 0;/.test(APP_CODE));

  // ⚠️ ONE TABLE, TWO SURFACES, AND THE EDITOR MAKES THREE. The hand-entry
  // editor types PERCENTAGES; its shortcut chips used to carry their own list of
  // kinds, which is how "Goal-based" outlived the preset it named.
  ok("the editor chips iterate the shared table", /\{MACRO_SPLITS\.map\(\(\{key:kind,label:lbl\}\)=>\(/.test(APP_CODE));
  ok("...and no longer carry their own list",
     !/\[\["bodyweight","Bodyweight"\],\["balanced","Balanced"\],\["goal","Goal-based"\]\]/.test(APP_CODE));
  {
    // recPct is still component-local: only the dashboard converts to percent.
    const recSrc = liftDecl(APP, "recPct");
    const mk = new Function("splitTiles", "gToPct", `${recSrc}; return recPct;`);
    const cal = 2000;
    const tiles = A.macroSplitTiles(P0(), cal, A.MACRO_KEYS_PLAN);
    const recPct = mk(tiles, (g, per) => Math.round((Number(g) * per / cal) * 100));
    let drift = null;
    for (const x of tiles) {
      const r = recPct(x.key);
      if (Math.abs(Math.round((r.protein / 100) * cal / 4) - x.t.protein) > 6) drift = { k: x.key, t: x.t, r };
      if (Math.abs(Math.round((r.fat / 100) * cal / 9) - x.t.fat) > 3) drift = { k: x.key, t: x.t, r };
    }
    ok("the editor's percentages are the card's grams", !drift, drift);
    ok("(control) an unknown kind falls back rather than throwing",
       recPct("nope").protein === recPct("bodyweight").protein);
  }

  // ⚠️ THE CEILING CAN LEVEL A TILE WITH ITS ANCHOR, and the caption has to
  // notice — it read "more protein" on exactly that plan. Rendered at 320 lb.
  {
    const tiles = A.macroSplitTiles(P0({ weightLbs: 320 }), 2102, A.MACRO_KEYS_PLAN);
    ok("the ceiling levels Cutting with Bodyweight on a heavy plan", tiles[1].t.protein === tiles[0].t.protein, tiles.map((x) => x.t));
    ok("...and the caption says so rather than claiming more", /same protein/.test(tiles[1].sub), tiles[1].sub);
  }

  // Four across is ~80px a tile on a phone; rendered at 375px to check.
  ok("four tiles wrap to two rows rather than four columns",
     /macroPresets\.length >= 4 \? "repeat\(2,1fr\)"/.test(APP_CODE));

  // ── the Muscle tab writes nothing ───────────────────────────────────────
  // ⚠️ THE SINGLE MOST IMPORTANT PROPERTY HERE. data.macroTargets is one gram
  // triple with no record of the calories it came from; a bulk-derived triple
  // read against the plan target is ~750 cal adrift on five screens plus the
  // server, and this tab never reads that field back, so the screen that wrote
  // it is the one screen that could not show the result.
  {
    const a = APP_CODE.indexOf("function MuscleTab(");
    const b = APP_CODE.indexOf("\nfunction ", a + 10);
    ok("found the MuscleTab body", a > 0 && b > a);
    // ⚠️ THIS SLICE USED TO NEED ITS OWN JSX-COMMENT PASS. The comment
    // explaining WHY this tab writes nothing names `data.macroTargets`, and the
    // desynchronised scanner left it there to be matched by the very assertion
    // below — the S208 trap, in code written the same afternoon. The scanner
    // strips it now, so the slice is used as it comes.
    const MT = APP_CODE.slice(a, b);
    ok("it never writes macro targets", !/onSetMacroTargets|macroTargets/.test(MT));
    ok("...and takes no setter that could", !/onSet[A-Z]/.test(MT), (MT.match(/onSet[A-Z]\w+/) || [])[0]);
    ok("...it stores the KEY, not the numbers, so the live basis wins",
       /const \[splitKey, setSplitKey\] = useState\(MACRO_KEYS_BUILD\[0\]\);/.test(MT));
    ok("...and says so on screen", /Nothing here changes your plan/.test(MT));
    ok("...naming the calories it is built from", /lean-bulk[\s\S]{0,40}number above, not your daily goal/.test(MT));
    ok("the fat card no longer hardcodes its share",
       !/note:`25% of total calories/.test(MT) && /note:`\$\{pctF\}% of total calories/.test(MT));
    ok("...and the flatten-out sentence is gated off the ceiling and off a moved split",
       /splitKey === MACRO_KEYS_BUILD\[0\]\s*\n?\s*\? `\$\{basis\} In training studies gains flatten out/.test(MT));
    // ⚠️ IT WAS PRINTED TWICE, AND ONLY A RENDER SHOWED IT. The card template
    // appended the same sentence the note had just been given, so the protein
    // card read it through twice in a row. Counted, not found.
    ok("...and appears exactly once in the tab",
       (MT.match(/gains flatten out/g) || []).length === 1, (MT.match(/gains flatten out/g) || []).length);
  }
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED`); process.exit(1); }
console.log("  Protein: one target, six screens, four splits built from it.\n");
