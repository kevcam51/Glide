// The savings account: what one real day put in the bank, and what a run of
// them says a pound cost THIS person (S221, Kevin).
//
// Kevin's own two examples are the spec:
//   "If a user doesn't work out and eats under 500 cal of their maintenance
//    that means that 500 cal goes into the savings account. If a user eats
//    under 500 cal and also exercises and burns 300 cal that means that they
//    have 800 cal in their savings account for that day."
// Both fall out of one subtraction — what the body spent, less what they ate —
// so the suite runs them as written.
//
// ⚠️ EVERY HELPER IS LIFTED FROM src/App.jsx AND RUN, not retyped. A suite that
// tests a transcription stays green while the shipping file drifts (S199k).
//
// Run: node scripts/test-savings.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

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


// ⚠️ planEnergy NOW RIDES ADAPTIVE MAINTENANCE (S228), so the savings burn does
// too — which is right: a maintenance fitted to what the scale actually did is a
// better basis for "what did this day cost" than the formula alone. Lifting its
// dependencies keeps this suite running the SHIPPING chain rather than a stub.
const CONSTS = ["DAYS", "REST_ST", "STRENGTH_EXERCISES", "CARDIO_GROUPS", "ALL_CARDIO",
  "ACTIVITY_LEVELS", "MIN_DAILY_CAL", "CAL_PER_LB", "PARTIAL_DAY_MIN", "HR_ZONES",
  "MAINT_STALE_DAYS", "SAVINGS_MIN_RATE_DAYS", "SAVINGS_MIN_COVERAGE"];
const FNS = ["calcBMR", "ageFromDob", "effectiveAge", "customOf", "findCardioEx", "findStrengthEx",
  "hrCaloriesPerMin", "restingKcalPerMin", "calcBurn", "cardioExFor", "exBurn", "isEatback",
  "dailyDeficitOf", "weeklyRateOf", "maintBasis", "maintenanceK", "planMaintenance", "planEnergy", "atLeastMinCal", "ymdLocal", "simDateAt",
  "dayBurnTracked", "daySavings", "savingsRun", "observedCalPerLb", "savingsPhase", "savingsLbs"];
const EXPORTS = ["dayBurnTracked", "daySavings", "savingsRun", "observedCalPerLb", "planEnergy",
  "CAL_PER_LB", "SAVINGS_MIN_RATE_DAYS", "SAVINGS_MIN_COVERAGE", "isEatback", "savingsPhase", "savingsLbs", "simDateAt"];
const source = () => [...CONSTS, ...FNS].map((n) => liftDecl(APP, n)).join("\n");
const build = (src) => new Function(`${src}; return { ${EXPORTS.join(", ")} };`)();
const M = build(source());

const P = (over = {}) => ({
  gender: "female", age: 35, heightFt: 5, heightIn: 6, weightLbs: 170,
  activityLevel: "moderate", weeklyRate: 1, cardio: {}, strength: {}, ...over,
});
const TDEE = Math.round(M.planEnergy(P()).tdee);
ok("the fixture prices a day at all", TDEE > 1200, TDEE);

// ── 1. Kevin's two examples, run as written ────────────────────────────────
{
  // "eats exactly at maintenance and does not work out — no money goes in"
  const flat = M.daySavings(P(), { calories: TDEE }, 0);
  ok("maintenance with no training banks nothing", flat.saved === 0, flat);
  // "doesn't work out, eats 500 under — 500 goes into the savings account"
  const under = M.daySavings(P(), { calories: TDEE - 500 }, 0);
  ok("500 under maintenance banks 500", under.saved === 500, under);
  // "eats 500 under AND burns 300 — 800 in savings for that day"
  const both = M.daySavings(P(), { calories: TDEE - 500 }, 300);
  ok("...and 500 under plus a 300 burn banks 800", both.saved === 800, both);
  // The other direction is the same subtraction, which is the point.
  const over = M.daySavings(P(), { calories: TDEE + 400 }, 0);
  ok("eating 400 over takes 400 out", over.saved === -400, over);
}

// ── 2. exercise reaches the balance through the BURN, not a second rule ────
{
  let bad = null;
  for (const burn of [0, 150, 300, 600, 1200]) {
    for (const eaten of [1200, 1800, TDEE, TDEE + 500]) {
      const r = M.daySavings(P(), { calories: eaten }, burn);
      if (r.saved !== (TDEE + burn) - eaten) bad = { burn, eaten, ...r };
    }
  }
  ok("a day's saving is always burn minus eaten", !bad, bad);
  // Control: training must actually move it, or the "exercise is income" half of
  // the metaphor is decoration.
  ok("(control) training moves the day's saving one-for-one",
     M.daySavings(P(), { calories: 1800 }, 300).saved - M.daySavings(P(), { calories: 1800 }, 0).saved === 300);
}

// ── 3. a tracker's measured burn counts, whatever the TARGET settings say ──
// ⚠️ wearableTdee is gated on data.wearableAdjust and on eat-back because it
// decides what somebody is TOLD TO EAT. What a body spent on a day that already
// happened is a measurement, so it counts either way — the S220e distinction.
{
  const log = { calories: 2000, wearable: { resting: 1500, active: 700 } };
  for (const d of [P(), P({ wearableAdjust: true }), P({ wearableAdjust: false }),
                   P({ deficitMode: "accelerate" }), P({ wearableAdjust: true, deficitMode: "accelerate" })]) {
    const r = M.daySavings(d, log, 0);
    ok("the tracker's own burn is used regardless of the target settings",
       r.measured === true && r.burn === 2200 && r.saved === 200, { d: d.deficitMode, wa: d.wearableAdjust, ...r });
  }
  // A hand-entered whole-day total stands on its own.
  const tot = M.daySavings(P(), { calories: 2000, wearable: { total: 2400 } }, 0);
  ok("...and a hand-entered day total stands on its own", tot.burn === 2400 && tot.saved === 400, tot);
  // ⚠️ A HALF-SYNCED DAY IS NOT A DAY THAT BURNED ALMOST NOTHING. A watch reports
  // cumulatively, so a resting figure far under BMR is a day still filling in.
  const partial = M.daySavings(P(), { calories: 2000, wearable: { resting: 200, active: 50 } }, 0);
  ok("a half-synced day falls back to the estimate rather than banking a fiction",
     partial.measured === false && partial.burn === TDEE, partial);
}

// ── 4. the run: only what was tracked, and it says so ──────────────────────
{
  const days = [
    { key: "d1", log: { calories: TDEE - 500 } },
    { key: "d2", log: { calories: TDEE - 300 } },
    { key: "d3", log: null },                       // never opened
    { key: "d4", log: { calories: 0 } },            // opened, nothing logged
    { key: "d5", log: { calories: TDEE + 200 } },
    { key: "d6", log: { weight: 168 } },            // a weigh-in, no food
    { key: "d7", log: { calories: TDEE - 400 } },
  ];
  const r = M.savingsRun(P(), days, 0);
  ok("the run banks only the days with real intake", r.tracked === 4, r);
  ok("...and reports the whole span beside it", r.span === 7, r);
  ok("...and the balance is the sum of those days", r.banked === 500 + 300 - 200 + 400, r);
  // ⚠️ THE CASE THIS RULE EXISTS FOR. Three good days and four untracked ones
  // must not read as a rising balance with nothing said — that is the balance
  // contradicting the scale, invisibly.
  const sparse = M.savingsRun(P(), [
    { key: "a", log: { calories: TDEE - 600 } },
    { key: "b", log: { calories: TDEE - 600 } },
    { key: "c", log: { calories: TDEE - 600 } },
    { key: "d", log: null }, { key: "e", log: null }, { key: "f", log: null }, { key: "g", log: null },
  ], 0);
  ok("three good days out of seven bank three days, not seven",
     sparse.banked === 1800 && sparse.tracked === 3 && sparse.span === 7, sparse);
  // ⚠️ A WEIGH-IN-ONLY DAY WOULD OTHERWISE BANK A WHOLE DAY'S BURN and read as
  // the best day of the run.
  ok("(control) a weigh-in with no food banks nothing",
     r.byDay.find((x) => x.key === "d6").tracked === false);
  ok("...and the measured-day count comes back too", r.measuredDays === 0, r.measuredDays);
}

// ── 5. an unpriceable plan refuses rather than banking a zero ──────────────
{
  const blank = M.daySavings({ cardio: {}, strength: {} }, { calories: 1800 }, 0);
  ok("a plan with no body behind it refuses to price a day", blank === null, blank);
  const r = M.savingsRun({ cardio: {}, strength: {} }, [{ key: "x", log: { calories: 1800 } }], 0);
  ok("...and the run counts it as untracked rather than as a perfect day",
     r.tracked === 0 && r.banked === 0 && r.span === 1, r);
}

// ── 6. the personal exchange rate ─────────────────────────────────────────
// Kevin: "someone's 10K might be different than the next person's 10k … the
// formula that we use for each person is specific for each person's results."
{
  ok("a real run gives a real rate", M.observedCalPerLb(21000, 6, 30) === 3500);
  ok("...and it is genuinely personal", M.observedCalPerLb(18000, 6, 30) === 3000
     && M.observedCalPerLb(25200, 6, 30) === 4200);
  // ⚠️ THE GUARD THAT MATTERS. A first week reads near 1,000 cal per pound
  // because the weight leaving is water, not fat. Right for "what will this
  // weekend cost me"; a promise nobody can keep if a year is projected on it.
  // ⚠️ THE RATE HERE IS 2,000 — COMFORTABLY INSIDE THE PLAUSIBLE BAND. An earlier
  // version of this check used 1,000 cal/lb, which the band guard below rejects
  // on its own, so it proved nothing about the DAYS guard it names. Caught by
  // deleting the days guard and watching this stay green.
  ok("a single week is refused even when its rate looks perfectly sane",
     M.observedCalPerLb(7000, 3.5, 7) === null, M.observedCalPerLb(7000, 3.5, 7));
  ok("...and the same numbers over a long enough run are accepted",
     M.observedCalPerLb(7000 * 4, 3.5 * 4, 28) === 2000);
  ok("...and the threshold is named, not buried", M.SAVINGS_MIN_RATE_DAYS === 14);
  ok("under a pound of movement is refused", M.observedCalPerLb(21000, 0.6, 30) === null);
  ok("a rate that is water, not metabolism, is refused", M.observedCalPerLb(3000, 3, 30) === null);
  // The band is tied to the physical anchor, not to two magic numbers — and the
  // lower bound is explicitly NOT the 1,200 daily calorie floor, which is a
  // different quantity that happens to be a similar number.
  ok("...and the band is expressed against CAL_PER_LB",
     /rate < CAL_PER_LB \/ 3 \|\| rate > CAL_PER_LB \* 2/.test(APP));
  ok("...so just inside the band is accepted and just outside is not",
     M.observedCalPerLb(Math.round(M.CAL_PER_LB / 3 + 50) * 5, 5, 30) !== null
     && M.observedCalPerLb(Math.round(M.CAL_PER_LB / 3 - 50) * 5, 5, 30) === null);
  ok("...and so is one the log and the scale disagree about",
     M.observedCalPerLb(80000, 5, 60) === null, M.observedCalPerLb(80000, 5, 60));
  ok("gaining, or no movement, gives no rate",
     M.observedCalPerLb(21000, 0, 30) === null && M.observedCalPerLb(21000, -2, 30) === null);
  ok("(control) and CAL_PER_LB is still the fallback anchor", M.CAL_PER_LB === 3500);
  // ⚠️ COVERAGE, NOT JUST COUNT. 18 tracked days against a 30-day span quoted
  // 6,104 cal per pound on screen — the banked total is short by twelve days, so
  // every pound looks dearer than it was, and an inflated rate prices a fun meal
  // as almost free. Found by reading the sparse fixture, not by a test.
  ok("a well-covered run gives a rate", M.observedCalPerLb(21000, 6, 27, 30) === 3500);
  ok("...and a sparsely-covered one of the same length does not",
     M.observedCalPerLb(21000, 6, 18, 30) === null, M.observedCalPerLb(21000, 6, 18, 30));
  ok("...with the bar set where observedTdee sets it", M.SAVINGS_MIN_COVERAGE === 0.8);
  ok("(control) exactly at the bar is accepted", M.observedCalPerLb(21000, 6, 24, 30) !== null);
  ok("...and one day under it is not", M.observedCalPerLb(21000, 6, 23, 30) === null);
  // A span of zero or absent must not divide by it.
  ok("no span given falls back to the day count alone", M.observedCalPerLb(21000, 6, 30) === 3500);
}

// ── 7. the exchange rate answers Kevin's spend-it question ────────────────
{
  // "their meal might cost them $1,000 against their balance … we can tell them
  // they might gain .8lbs from this $1,000 meal."
  const rate = M.observedCalPerLb(21000, 6, 30);           // 3,500 for this person
  ok("a 1,000 cal overspend prices in pounds at THEIR rate",
     Math.round((1000 / rate) * 100) / 100 === 0.29, 1000 / rate);
  const fast = M.observedCalPerLb(12000, 6, 30);           // 2,000 for this one
  ok("...and a different person gets a different answer",
     Math.round((1000 / fast) * 100) / 100 === 0.5, 1000 / fast);
}

// ── 8. a phase, walked from the map the dashboard already holds ───────────
{
  const start = "2026-03-01";
  const keys = Array.from({ length: 30 }, (_, i) => M.simDateAt(start, i));
  const end = keys[28];                       // yesterday; the 30th day is "today"
  const byDate = {};
  keys.slice(0, 29).forEach((k, i) => { byDate[k] = { calories: TDEE - 500 }; });
  byDate[keys[29]] = { calories: 300 };       // today, barely started
  const d = P({ checkIns: [
    { date: keys[0], weight: 170 },
    { date: end, weight: 166 },
  ] });
  const ph = M.savingsPhase(d, byDate, start, end, 0);
  ok("a phase banks every tracked day in its window", ph.tracked === 29 && ph.span === 29, ph);
  ok("...at 500 a day", ph.banked === 29 * 500, ph.banked);
  // ⚠️ TODAY IS NOT BANKED. A day still in progress has eaten only part of what
  // it will eat; counting it drags the balance down every morning.
  ok("...and today is left out of it", !ph.byDay.some((x) => x.key === keys[29]));
  ok("the scale's own movement comes back beside it", ph.scaleLbs === 4, ph.scaleLbs);
  // 14,500 banked against 4 lbs = 3,625 — inside the band, over the day floor.
  ok("...and the personal rate is measured from the pair", ph.rate === 3625, ph.rate);
  // ⚠️ A WEIGH-IN FROM BEFORE THE PHASE MAY NOT BE CREDITED TO IT.
  const older = M.savingsPhase(P({ checkIns: [
    { date: "2026-01-01", weight: 190 }, { date: end, weight: 166 },
  ] }), byDate, start, end, 0);
  ok("a weigh-in from before the phase is not counted as its progress",
     older.scaleLbs === null && older.rate === null, older.scaleLbs);
  // An empty or inverted window is answered, not thrown.
  ok("an inverted window returns an empty phase", M.savingsPhase(d, byDate, end, start, 0).span === 0);
}

// ── 9. what the balance is worth, and in whose currency ───────────────────
{
  const measured = M.savingsLbs(14500, 3625);
  ok("a measured rate is used when there is one", measured.measured === true && measured.per === 3625);
  ok("...and prices the balance with it", measured.lbs === 4, measured.lbs);
  const fallback = M.savingsLbs(14500, null);
  ok("the physical anchor is the fallback", fallback.measured === false && fallback.per === M.CAL_PER_LB);
  ok("...and it says so rather than passing itself off as measured", fallback.lbs !== measured.lbs);
}

// ── 10. the account's intent (S222, Kevin: "those buttons do seem a little
// useless … can we find another way to use the logic?") ───────────────────
{
  // ⚠️ THE STORED VALUES ARE UNCHANGED. Every existing plan carries one of these
  // three strings, and committing a pace writes one; renaming the DATA to match
  // the new labels would silently reset every plan in the field to the default.
  ok("the three states are still stored as they always were",
     /\[\["deficit","Saving"\],\["maintain","Holding"\],\["surplus","Spending"\]\]/.test(APP));
  ok("...and nothing writes the label as the value",
     !/onSetCalorieGoal\("(Saving|Holding|Spending)"\)/.test(APP)
     && /onSetCalorieGoal\(previewRate === 0 \? "maintain" : previewRate < 0 \? "surplus" : "deficit"\)/.test(APP));
  // ⚠️ THE RING WORD IS MEASURED AGAINST THE TARGET AND NOW SAYS SO. It sits
  // under "CAL REMAINING", also against the target, but used to read
  // "Deficit"/"Surplus" — words that mean "against MAINTENANCE" everywhere else,
  // including in this very file.
  // ⚠️ COUNTED, NOT MERELY FOUND. Both branches of goalState produce this pair —
  // the maintain arm and the deficit/surplus arm — and a negative like
  // !/word: "Surplus"/ does not match `word: todaySurplus > 0 ? "Surplus"`, so
  // reverting ONE arm stayed green. Caught by mutating exactly that arm.
  ok("the ring word names what it is measured against, in both arms",
     (APP.match(/"Over target"/g) || []).length === 2
     && (APP.match(/"Under target"/g) || []).length === 2,
     { over: (APP.match(/"Over target"/g) || []).length, under: (APP.match(/"Under target"/g) || []).length });
  ok("...and the old maintenance-relative words are gone from it",
     !/\? "Surplus" : "Deficit"/.test(APP) && !/word: "Surplus"/.test(APP) && !/word: "Deficit"/.test(APP));
  // ⚠️ AND THE SAVINGS WORDS STAY OFF IT, so one component cannot quote two bases.
  ok("...and the savings vocabulary is not put on a target-based number",
     !/word: "(Saving|Holding|Spending)"/.test(APP));
  // The intent has to reach the card, or the buttons are decoration again.
  ok("the savings card is framed by the intent",
     /\{goalDir === "surplus"/.test(APP)
     && /is left to enjoy before the weight starts coming back on/.test(APP)
     && /every day you\s*\n?\s*finish under what your body burned adds to this/.test(APP));
}

console.log(`\n  ${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`  ${fails} FAILED`); process.exit(1); }
console.log("  Savings: what the day banked, and what a pound costs this person.\n");
