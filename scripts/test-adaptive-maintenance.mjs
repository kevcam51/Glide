// Maintenance calories adapt to what someone actually burns (S228).
//
// Kevin: "Can we have a users maintenance calories be automatically adjusted
// based on a clients progress? ... And of course if someone's maintenance
// calories are changed how that affects their one and a half, 1 pound and 2
// pound weight loss and weight gain numbers."
//
// Three of the five inputs already adapted: weight on every weigh-in, age
// yearly, and the training burn on every schedule edit. The fourth — the
// activity multiplier — was stated once at signup and never revisited, and one
// step on that ladder is worth 0.175 x BMR: 319 cal/day on a 200 lb man, which
// is 45 POUNDS of bodyweight. That is the gap this closes.
//
// ⚠️ THE ASYMMETRY IS THE FEATURE, AND MOST OF THIS SUITE EXISTS TO PIN IT.
// The measurement cannot tell a genuinely low burn from under-logging — they
// are arithmetically identical — so a correction may only ever raise a target.
// If it could lower one, someone logging 60% of their food would be told to eat
// less, would log 60% of that, and would be told to eat less again. Every
// downward path here must refuse.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { estimateObservedTdee, clampToFormula, TUNING } from "../src/observedTdee.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AITOOLS = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Brace-balanced lifter (S215).
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

// ── The APP's copy, lifted and run with its real dependencies ──────────────
const APP_NAMES = ["ACTIVITY_LEVELS", "MIN_DAILY_CAL", "RATE_OPTS", "MAINT_STALE_DAYS",
  "ACTIVITY_COOLDOWN_DAYS", "calcBMR", "ageFromDob", "effectiveAge", "atLeastMinCal",
  "maintBasis", "maintenanceK", "planMaintenance", "nextMaintenanceFit", "weeklyRateOf"];
const appLifted = APP_NAMES.map((n) => liftDecl(APP, n)).join("\n");
const app = new Function("TDEE_TUNING", "clampToFormula",
  appLifted + "\nreturn { " + APP_NAMES.join(", ") + " };")(TUNING, clampToFormula);

// ── The SERVER's copy, lifted from the shipping module ────────────────────
const SRV_NAMES = ["ACTIVITY_MULT", "MAINT_STALE_DAYS", "maintBasis", "maintenanceK", "planMaintenance"];
const srvLifted = SRV_NAMES.map((n) => liftDecl(AITOOLS, n)).join("\n");
const srv = new Function("TDEE_TUNING", "calcBMR", "effectiveAge",
  srvLifted + "\nreturn { " + SRV_NAMES.join(", ") + " };")(TUNING, app.calcBMR, app.effectiveAge);

const DAY = 86400000;
// ⚠️ ANCHORED TO THE REAL CLOCK, DELIBERATELY. effectiveAge rolls a stated age
// forward from ageSetAt, and maintenanceK reads Date.now() directly for the
// staleness expiry — so a frozen timestamp silently ages every fixture by a
// year and expires every fit. Relative offsets from here are what matter.
const NOW = Date.now();
const body = (over) => ({ gender: "male", weightLbs: 200, heightFt: 5, heightIn: 10,
  age: 40, ageSetAt: NOW, activityLevel: "moderate", ...over });
const fitFor = (d, k, over) => ({ k, formulaTdee: 2826, observedTdee: Math.round(2826 * k),
  clamped: false, at: NOW, loggedDays: 24, weighIns: 9, trendLbsPerWeek: -0.9,
  basis: app.maintBasis(d), source: "log", ...over });

console.log("\n  Adaptive maintenance: measured, upward only\n");

// ── 1. The formula, and what already moved without this feature ───────────
{
  const d = body();
  const m = app.planMaintenance(d);
  const REF = m.formulaTdee;
  ok("the reference body's maintenance is the Mifflin formula", REF === 2826, REF);
  ok("with no fit, the plan uses the formula", m.tdee === m.formulaTdee);
  ok("with no fit, nothing is marked fitted", m.fitted === false);
  const rungs = ["sedentary", "light", "moderate", "very", "extra"]
    .map((a) => app.planMaintenance(body({ activityLevel: a })).formulaTdee);
  ok("the activity ladder is unchanged", rungs.join() === "2188,2507,2826,3145,3465", rungs);
  const step = rungs[2] - rungs[1];
  ok("one rung is worth ~319 cal/day", step === 319, step);
  // Kevin's own question: does losing weight lower maintenance?
  const lighter = app.planMaintenance(body({ weightLbs: 180 })).formulaTdee;
  ok("20 lb lighter lowers maintenance by 140", REF - lighter === 140, REF - lighter);
  // ...and one wrong rung outweighs it by more than double.
  ok("one wrong rung outweighs a 20 lb loss", step > (REF - lighter) * 2);
}

// ── 2. maintenanceK — every safety rule, RUN ──────────────────────────────
{
  const d = body();
  ok("no fit means no correction", app.maintenanceK(d) === 1);
  ok("a fit applies", app.maintenanceK({ ...d, maintenanceFit: fitFor(d, 1.1) }) === 1.1);
  // THE CENTRAL RULE.
  ok("a fit BELOW 1 is refused", app.maintenanceK({ ...d, maintenanceFit: fitFor(d, 0.85) }) === 1);
  ok("a fit of exactly 1 is refused", app.maintenanceK({ ...d, maintenanceFit: fitFor(d, 1) }) === 1);
  ok("a negative fit is refused", app.maintenanceK({ ...d, maintenanceFit: fitFor(d, -2) }) === 1);
  ok("a NaN fit is refused", app.maintenanceK({ ...d, maintenanceFit: fitFor(d, "abc") }) === 1);
  ok("Infinity is refused", app.maintenanceK({ ...d, maintenanceFit: fitFor(d, Infinity) }) === 1);
  // A forged value is bounded by the READ clamp — the plan owner can write
  // their own kv unvalidated, so this is the bound that actually holds.
  ok("a forged huge fit is clamped to the ceiling",
    app.maintenanceK({ ...d, maintenanceFit: fitFor(d, 99) }) === 1 + TUNING.MAX_RISE_PCT);
  ok("the ceiling is the estimator's own number", TUNING.MAX_RISE_PCT === 0.20);
  ok("switched off means no correction",
    app.maintenanceK({ ...d, maintenanceAuto: false, maintenanceFit: fitFor(d, 1.15) }) === 1);
  ok("absent maintenanceAuto means ON", app.maintenanceK({ ...d, maintenanceFit: fitFor(d, 1.15) }) === 1.15);
  ok("a junk fit object is refused", app.maintenanceK({ ...d, maintenanceFit: "yes" }) === 1);
  ok("a fit with no timestamp is refused",
    app.maintenanceK({ ...d, maintenanceFit: fitFor(d, 1.1, { at: 0 }) }) === 1);
}
{
  // BASIS INVALIDATION — the rule that covers all four writers of activityLevel,
  // including functions/trainerize.js, which re-stamps it from the Trainerize
  // snapshot on exactly the imported clients this feature serves.
  const d = body();
  const fit = fitFor(d, 1.15);
  ok("a fit survives a weigh-in", app.maintenanceK({ ...d, weightLbs: 188, maintenanceFit: fit }) === 1.15);
  ok("a fit survives getting older", app.maintenanceK({ ...d, age: 41, maintenanceFit: fit }) === 1.15);
  ok("a changed activity level retires the fit",
    app.maintenanceK({ ...d, activityLevel: "very", maintenanceFit: fit }) === 1);
  ok("a corrected height retires the fit",
    app.maintenanceK({ ...d, heightFt: 6, maintenanceFit: fit }) === 1);
  ok("a corrected inches retires the fit",
    app.maintenanceK({ ...d, heightIn: 11, maintenanceFit: fit }) === 1);
  ok("a corrected sex retires the fit",
    app.maintenanceK({ ...d, gender: "female", maintenanceFit: fit }) === 1);
  ok("a fit with no basis at all is refused",
    app.maintenanceK({ ...d, maintenanceFit: fitFor(d, 1.15, { basis: undefined }) }) === 1);
  // A number and a string that print the same must not be treated as different,
  // or a fit would retire itself the moment anything re-saved the profile.
  ok("height stored as a string still matches",
    app.maintenanceK({ ...d, heightFt: "5", heightIn: "10", maintenanceFit: fit }) === 1.15);
}
{
  // STALENESS expires on the READ side, because the only writer runs inside a
  // dashboard effect — and the people with a stale fit are by definition the
  // ones who stopped opening that screen.
  const d = body();
  const old = fitFor(d, 1.15, { at: NOW - 61 * DAY });
  const fresh = fitFor(d, 1.15, { at: NOW - 59 * DAY });
  const realNow = Date.now();
  ok("a fit from two months ago has expired",
    app.maintenanceK({ ...d, maintenanceFit: { ...old, at: realNow - 61 * DAY } }) === 1);
  ok("a fit from last month still applies",
    app.maintenanceK({ ...d, maintenanceFit: { ...fresh, at: realNow - 59 * DAY } }) === 1.15);
  ok("the expiry is 60 days", app.MAINT_STALE_DAYS === 60);
  ok("a future-dated fit is not treated as fresh forever",
    app.maintenanceK({ ...d, maintenanceFit: { ...fresh, at: realNow + 400 * DAY } }) === 1.15);
}

// ── 3. The ladder moves WITH maintenance — Kevin's last question ──────────
{
  // planIntakeForRate is not lifted (it needs the whole exercise catalogue), so
  // the ladder is reconstructed from its ONE documented rule and checked against
  // planMaintenance. What matters here is that every pace shifts by the SAME
  // amount when maintenance moves, which is the property Kevin asked about.
  const d = body();
  const fitted = { ...d, maintenanceFit: fitFor(d, 1.1) };
  const base = app.planMaintenance(d).tdee;
  const after = app.planMaintenance(fitted).tdee;
  ok("a 10% fit raises maintenance", after - base === 283, after - base);
  const ladder = (t) => app.RATE_OPTS.map((r) => app.atLeastMinCal(t - Math.round((r * 3500) / 7)));
  const a = ladder(base), b = ladder(after);
  const shifts = a.map((v, i) => b[i] - v);
  ok("every pace moves by exactly the same amount", new Set(shifts).size === 1, shifts);
  ok("the shift is the maintenance change", shifts[0] === after - base, shifts[0]);
  ok("gaining paces move too, not just losing ones",
    app.RATE_OPTS.filter((r) => r < 0).every((r) => b[app.RATE_OPTS.indexOf(r)] > a[app.RATE_OPTS.indexOf(r)]));
  // ⚠️ THE 1,200 FLOOR IS NOT BYPASSED BY ANY OF THIS.
  const tiny = app.planMaintenance(body({ weightLbs: 95, gender: "female", heightFt: 4, heightIn: 10 }));
  ok("the floor still holds under a fitted ladder",
    ladder(tiny.tdee).every((v) => v >= app.MIN_DAILY_CAL));
}

// ── 4. nextMaintenanceFit — the write rule, RUN ───────────────────────────
const high = (over) => ({ confidence: "high", tdee: 3200, loggedDays: 24, weighIns: 9,
  trendLbsPerWeek: -0.9, ...over });
const call = (over) => app.nextMaintenanceFit({
  observed: high(), formulaTdee: 2826, basis: app.maintBasis(body()),
  current: undefined, auto: undefined, now: NOW, ...over });

{
  const r = call();
  ok("a high-confidence measurement above the formula writes a fit", !!r && r.k > 1, r);
  ok("the ratio is measured over FORMULA", r && Math.abs(r.k - 3200 / 2826) < 1e-9, r && r.k);
  ok("the UNCLAMPED measurement is stored", r.observedTdee === 3200);
  ok("the formula it was measured against is stored", r.formulaTdee === 2826);
  ok("the basis is stored so it can be invalidated", r.basis.activityLevel === "moderate");
  ok("the source is recorded", r.source === "log");
}
// THE SPIRAL GUARD, from every direction.
ok("a measurement BELOW the formula never writes a fit",
  call({ observed: high({ tdee: 2400 }) }) === undefined);
ok("a measurement far below clears an existing fit",
  call({ observed: high({ tdee: 2000 }), current: fitFor(body(), 1.1) }) === null);
ok("a measurement AT the formula clears an existing fit",
  call({ observed: high({ tdee: 2826 }), current: fitFor(body(), 1.1) }) === null);
ok("retraction stops at the formula, it never goes under",
  call({ observed: high({ tdee: 2400 }), current: fitFor(body(), 1.1) }) === null);
ok("low confidence writes nothing", call({ observed: high({ confidence: "low" }) }) === undefined);
ok("medium confidence writes nothing", call({ observed: high({ confidence: "medium" }) }) === undefined);
ok("no measurement writes nothing", call({ observed: null }) === undefined);
ok("a refusing estimator writes nothing", call({ observed: { confidence: "high", tdee: null } }) === undefined);
ok("no formula writes nothing", call({ formulaTdee: 0 }) === undefined);
ok("switched off writes nothing when there is nothing to clear",
  call({ auto: false }) === undefined);
ok("switched off CLEARS an existing fit", call({ auto: false, current: fitFor(body(), 1.1) }) === null);
{
  // The ceiling, at the write as well as the read.
  const r = call({ observed: high({ tdee: 9000 }) });
  // clampToFormula rounds the capped value to a whole calorie, so the ratio
  // lands a hair under the ceiling rather than exactly on it.
  ok("an implausible measurement is capped at the ceiling",
    Math.abs(r.k - (1 + TUNING.MAX_RISE_PCT)) < 1e-3, r.k);
  ok("and never above it", r.k <= 1 + TUNING.MAX_RISE_PCT);
  ok("the cap is recorded so the card can say so", r.clamped === true);
}
{
  // HYSTERESIS — a prescription that shuffles every time someone opens the
  // dashboard reads as instability, not precision.
  const cur = fitFor(body(), 3200 / 2826, { at: NOW - 30 * DAY });
  ok("an unchanged measurement writes nothing", call({ current: cur }) === undefined);
  ok("a 30-cal drift writes nothing", call({ observed: high({ tdee: 3230 }), current: cur }) === undefined);
  const moved = call({ observed: high({ tdee: 3400 }), current: cur });
  ok("a 200-cal move does write", !!moved && moved.k > cur.k, moved && moved.k);
}
{
  // COOLDOWN — the same 14 days the rung proposal uses, and for a stronger
  // reason: for four weeks after a fit lands the window mixes pre- and post-fit
  // intake.
  const recent = fitFor(body(), 1.05, { at: NOW - 3 * DAY });
  ok("a fit three days old is not replaced", call({ observed: high({ tdee: 3400 }), current: recent }) === undefined);
  const older = fitFor(body(), 1.05, { at: NOW - 20 * DAY });
  ok("a fit twenty days old may be replaced", !!call({ observed: high({ tdee: 3400 }), current: older }));
  ok("the cooldown is the shared constant", app.ACTIVITY_COOLDOWN_DAYS === 14);
  // ⚠️ RETRACTION IS EXEMPT. Making someone wait a fortnight to stop being
  // over-fed is the wrong side of the asymmetry.
  ok("retraction ignores the cooldown",
    call({ observed: high({ tdee: 2400 }), current: recent }) === null);
}
{
  // THE FIXED POINT. Dividing by the number in force instead of the formula
  // oscillates forever; this proves it settles.
  let d = body(), fit;
  for (let i = 0; i < 6; i++) {
    const f = app.planMaintenance({ ...d, maintenanceFit: fit }).formulaTdee;
    const r = app.nextMaintenanceFit({ observed: high({ tdee: 3200 }), formulaTdee: f,
      basis: app.maintBasis(d), current: fit, auto: undefined, now: NOW + i * 40 * DAY });
    if (r !== undefined) fit = r;
  }
  const F = app.planMaintenance(body()).formulaTdee;
  ok("repeated measurement settles rather than oscillating",
    Math.abs(fit.k - 3200 / F) < 1e-9, fit && fit.k);
  ok("the settled maintenance equals the measurement",
    app.planMaintenance({ ...body(), maintenanceFit: fit }).tdee === 3200,
    app.planMaintenance({ ...body(), maintenanceFit: fit }).tdee);
}

// ── 5. The app and the server must never disagree ─────────────────────────
{
  let diffs = 0, fittedCases = 0;
  const now = Date.now();
  for (const activityLevel of ["sedentary", "light", "moderate", "very", "extra"]) {
    for (const gender of ["male", "female"]) {
      for (const weightLbs of [110, 155, 200, 260, 320]) {
        for (const k of [null, 1.05, 1.1999, 1.2, 5, 0.9]) {
          for (const auto of [undefined, false]) {
            const d = { gender, weightLbs, heightFt: 5, heightIn: 9, age: 35, ageSetAt: now,
              activityLevel, maintenanceAuto: auto };
            if (k != null) d.maintenanceFit = { k, at: now - 5 * DAY, basis: app.maintBasis(d) };
            const a = app.planMaintenance(d), b = srv.planMaintenance(d);
            if (a.tdee !== b.tdee || a.formulaTdee !== b.formulaTdee || a.k !== b.k) diffs++;
            if (a.fitted) fittedCases++;
          }
        }
      }
    }
  }
  ok("the app and the server agree on every maintenance case", diffs === 0, diffs);
  ok("the sweep actually exercised fitted cases", fittedCases > 50, fittedCases);
  ok("the server expiry matches the app", srv.MAINT_STALE_DAYS === app.MAINT_STALE_DAYS);
  ok("the server refuses a downward fit too", (() => {
    const d = { gender: "male", weightLbs: 200, heightFt: 5, heightIn: 10, age: 40, ageSetAt: Date.now(), activityLevel: "moderate" };
    return srv.maintenanceK({ ...d, maintenanceFit: { k: 0.8, at: Date.now(), basis: srv.maintBasis(d) } }) === 1;
  })());
  ok("the server clamps a forged fit too", (() => {
    const d = { gender: "male", weightLbs: 200, heightFt: 5, heightIn: 10, age: 40, ageSetAt: Date.now(), activityLevel: "moderate" };
    return srv.maintenanceK({ ...d, maintenanceFit: { k: 40, at: Date.now(), basis: srv.maintBasis(d) } }) === 1.2;
  })());
}

// ── 6. End to end: a real measurement through the real estimator ──────────
{
  // 28 days eating 3,200 while holding weight measures ~3,200 — a person whose
  // stated "moderately active" is a rung too low.
  const days = [], weighIns = [];
  for (let i = 27; i >= 0; i--) {
    const dt = new Date(Date.UTC(2026, 0, 31 - i, 12));
    const date = dt.toISOString().slice(0, 10);
    days.push({ date, calories: 3200 });
    if (i % 3 === 0) weighIns.push({ date, weight: 200 });
  }
  const o = estimateObservedTdee({ days, weighIns, asOf: "2026-01-31", formulaTdee: 2826 });
  ok("the estimator reads a held weight as its intake", o.tdee != null && Math.abs(o.tdee - 3200) <= 30, o.tdee);
  ok("a full month of logging is high confidence", o.confidence === "high", o.confidence);
  const fit = app.nextMaintenanceFit({ observed: o, formulaTdee: 2826,
    basis: app.maintBasis(body()), current: undefined, auto: undefined, now: Date.now() });
  ok("that measurement produces a fit", !!fit, fit);
  const d = { ...body(), maintenanceFit: fit };
  const m = app.planMaintenance(d);
  ok("maintenance rises toward the measurement", m.tdee > 2826 && m.tdee <= 3200 * 1.01, m.tdee);
  ok("and it is marked as fitted so the card can explain it", m.fitted === true);
  ok("the server sees the same number", srv.planMaintenance(d).tdee === m.tdee);
}

// ── 7. Wiring only the source can answer ──────────────────────────────────
// Count CALL SITES: a helper nothing calls is not a feature.
// ⚠️ EXACTLY ONE, NOT ZERO. The formula has to exist somewhere — the point is
// that it exists in planMaintenance and NOWHERE ELSE, so a second copy (which
// is what Results, the dashboard and the server each used to have) fails here.
ok("the app computes maintenance in exactly one place",
  (APP.match(/Math\.round\(bmr \* actObj\.multiplier\)/g) || []).length === 1,
  (APP.match(/Math\.round\(bmr \* actObj\.multiplier\)/g) || []).length);
ok("the server computes maintenance in exactly one place",
  (AITOOLS.match(/Math\.round\(bmr \* \(ACTIVITY_MULT/g) || []).length === 1,
  (AITOOLS.match(/Math\.round\(bmr \* \(ACTIVITY_MULT/g) || []).length);
ok("planMaintenance has at least three callers in the app",
  (APP.match(/planMaintenance\(/g) || []).length >= 4, (APP.match(/planMaintenance\(/g) || []).length);
ok("the server prices nutrition through it", /const \{ bmr, tdee \} = planMaintenance\(d\)/.test(AITOOLS));
ok("the write rule is called from the dashboard", /nextMaintenanceFit\(\{/.test(APP));
ok("the fit is persisted", /onSetMaintenanceFit=\{/.test(APP));
ok("it can be switched off", /onSetMaintenanceAuto=\{/.test(APP));
ok("the measurement is compared against the formula, not the fitted number",
  /asOf, formulaTdee,/.test(APP) && !/asOf, formulaTdee: tdee,/.test(APP));
ok("the rung proposal is suppressed when a fit already absorbed the gap",
  /suppress: maint\.fitted/.test(APP));
ok("the ceiling is imported, never re-declared in the app", !/MAX_RISE_PCT: /.test(APP));
ok("the ceiling is imported, never re-declared on the server", !/MAX_RISE_PCT: /.test(AITOOLS));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  Maintenance follows the body, and only ever upward on its own.\n");
process.exit(fails ? 1 : 0);
