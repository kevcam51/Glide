// The barcode scanner asks every food database we have (S228).
//
// Kevin: "I noticed that it is not searching all three food databases that we
// have on the app... I was looking up a specific protein bar with the scanner
// and it might need through all of our food databases to find specific items
// like that."
//
// TWO separate causes, and this suite guards both:
//
//   1. UPC-E WAS NEVER EXPANDED. The scanner enables UPC_E, so a small package —
//      a single-serve protein bar is the canonical case — decodes to 8 digits,
//      and nothing expanded it. Measured against the live databases: Open Food
//      Facts keeps the compressed code and the expanded one as TWO SEPARATE
//      products with different nutrition, and USDA files some records under the
//      printed 8 digits and others under the expanded 12. Asking only what was
//      scanned misses real matches in both.
//
//   2. FATSECRET WAS ABSENT FROM THE SCANNER. It is the app's PRIMARY library
//      (_foodScore gives it +55, Kevin's S94d call) and the scanner never asked
//      it, because the proxy exposed no barcode route.
//
// ⚠️ THE LADDER IS RUN, NOT MATCHED. barcodeSources takes injected sources so
// this suite can execute the real ordering and COUNT which rungs were asked —
// a source-pattern assertion cannot tell "asks FatSecret" from "would ask
// FatSecret if a branch that never runs were taken".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const PROXY = readFileSync(join(ROOT, "proxy", "server.js"), "utf8");

let fails = 0, checks = 0, return_;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Brace-balanced lifter (S215) — see scripts/test-what-if-week.mjs for why a
// lazy regex is not good enough here.
function liftDecl(src, name) {
  const re = new RegExp("\\n([ \\t]*)(?:function " + name + "\\(|const " + name + "\\s*=|async function " + name + "\\()");
  const m = src.match(re);
  if (!m) throw new Error("could not lift " + name);
  const start = m.index + 1 + m[1].length;
  const isFn = /^(async )?function/.test(src.slice(start, start + 15));
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

const NAMES = ["upcEtoA", "barcodeVariants", "offBarcodeForms", "barcodeGtins", "barcodeSources", "barcodeMiss"];
const lifted = NAMES.map((n) => liftDecl(APP, n)).join("\n");
const { upcEtoA, barcodeVariants, offBarcodeForms, barcodeGtins, barcodeSources, barcodeMiss } =
  new Function(lifted + "\nreturn { " + NAMES.join(", ") + " };")();

// functions/foodsearch.js is CommonJS and reachable directly — no lifting, and
// no transcription either: this is the shipping module.
const { _barcodeLookup } = await import(join(ROOT, "functions", "foodsearch.js"));

console.log("\n  Barcode: every database, every form of the number\n");

// ── 1. UPC-E expansion ─────────────────────────────────────────────────────
// Canonical cases. 049000 is Coca-Cola's real GS1 prefix, so the first is
// verifiable against the printed can rather than only against the algorithm.
ok("UPC-E last digit 0-2: 04963406", upcEtoA("04963406") === "049000006346", upcEtoA("04963406"));
ok("UPC-E last digit 5-9: 01234565", upcEtoA("01234565") === "012345000065", upcEtoA("01234565"));
ok("UPC-E last digit 4: 04252614", upcEtoA("04252614") === "042100005264", upcEtoA("04252614"));
ok("UPC-E last digit 3: 01234534", upcEtoA("01234534") === "012300000454", upcEtoA("01234534"));
ok("every expansion is 12 digits", ["04963406", "01234565", "04252614", "01234534", "10000001", "19999998"]
  .every((c) => (upcEtoA(c) || "").length === 12));
ok("a 12-digit UPC-A is not a UPC-E", upcEtoA("049000006346") === null);
ok("a 13-digit EAN is not a UPC-E", upcEtoA("0049000006346") === null);
ok("an 8-digit code starting 2 is not a UPC-E", upcEtoA("24963406") === null);
ok("an 8-digit code starting 9 is not a UPC-E", upcEtoA("94963406") === null);
ok("junk is not a UPC-E", upcEtoA("SHELF-TAG-7") === null);
ok("empty is not a UPC-E", upcEtoA("") === null);
ok("null is not a UPC-E", upcEtoA(null) === null);
{
  // The expansion must be a pure rearrangement: every UPC-A it produces keeps
  // the leading digit and the check digit it was given.
  let wrongEnds = 0;
  for (let i = 0; i < 4000; i++) {
    const c = "0" + String(i).padStart(6, "0") + String(i % 10);
    const a = upcEtoA(c);
    if (!a || a[0] !== c[0] || a[11] !== c[7]) wrongEnds++;
  }
  ok("expansion preserves the number system and check digit", wrongEnds === 0, wrongEnds);
}

// ── 2. What each source gets asked ─────────────────────────────────────────
{
  const v = barcodeVariants("04963406");
  ok("USDA is asked the scanned 8 digits", v.includes("04963406"));
  ok("USDA is ALSO asked the expanded UPC-A", v.includes("049000006346"), v);
  ok("USDA is asked the 13-digit form of the expansion", v.includes("0049000006346"));
  ok("USDA is asked the 14-digit form of the expansion", v.includes("00049000006346"));
  ok("no duplicates in the variant list", v.length === new Set(v).size);
}
{
  // A 12-digit scan must be byte-identical to what shipped before — the whole
  // point is that a working scan keeps working.
  const v = barcodeVariants("028400335799");
  // Byte-identical to what shipped before the UPC-E work: a 12-digit code has
  // no compressed reading, so the expansion adds nothing to it.
  ok("12-digit scan: unchanged variant set",
    v.join() === "028400335799,28400335799,0028400335799,00028400335799", v);
}
ok("OFF is asked both forms of an 8-digit scan", offBarcodeForms("04963406").join() === "04963406,049000006346");
ok("OFF is asked one form of a 12-digit scan", offBarcodeForms("028400335799").length === 1);
ok("OFF is asked nothing for junk", offBarcodeForms("").length === 0);

// ── 3. GTIN-13 candidates for FatSecret ────────────────────────────────────
ok("a 12-digit UPC-A is zero-padded to 13", barcodeGtins("028400335799")[0] === "0028400335799");
ok("a 13-digit EAN passes through", barcodeGtins("5000112637922")[0] === "5000112637922");
ok("an 8-digit scan yields BOTH readings", barcodeGtins("04963406").length === 2, barcodeGtins("04963406"));
ok("the expanded reading is a real GTIN-13", barcodeGtins("04963406")[1] === "0049000006346", barcodeGtins("04963406"));
ok("every candidate is exactly 13 digits",
  ["04963406", "028400335799", "5000112637922", "00028400335799"]
    .every((c) => barcodeGtins(c).every((g) => /^\d{13}$/.test(g))));
ok("a 14-digit GTIN with 13 significant digits is accepted", barcodeGtins("00028400335799")[0] === "0028400335799");
// CODE_128 is in the scanner format list and carries arbitrary text. A shelf
// tag must not spend a FatSecret call.
ok("a CODE_128 shelf tag asks nothing", barcodeGtins("AISLE-7-PROMO").length === 0);
ok("too few digits ask nothing", barcodeGtins("1234").length === 0);
ok("too many digits ask nothing", barcodeGtins("123456789012345").length === 0);
ok("empty asks nothing", barcodeGtins("").length === 0);
ok("no candidate is duplicated", (() => { const g = barcodeGtins("04963406"); return g.length === new Set(g).size; })());

// ── 4. The ladder — RUN, with the rungs counted ───────────────────────────
const food = (name, kcal, source) => ({ name, kcal, p: 1, c: 2, f: 3, source });
const spy = (result) => { const f = async () => { f.calls++; return typeof result === "function" ? result() : result; }; f.calls = 0; return f; };

{
  const offS = spy(food("Cola", 42, "off")), fsS = spy(null), usdaS = spy(null);
  const r = await barcodeSources("x", { offByBarcode: offS, fsByBarcode: fsS, usdaByBarcode: usdaS });
  ok("an Open Food Facts hit still wins", r.winner.source === "off");
  ok("a winning OFF hit spends no FatSecret quota", fsS.calls === 0);
  ok("a winning OFF hit spends no USDA call", usdaS.calls === 0);
}
{
  // THE REPORTED FAILURE: OFF has nothing, FatSecret has the bar.
  const offS = spy(null), fsS = spy(food("Protein Bar", 210, "fatsecret")), usdaS = spy(null);
  const r = await barcodeSources("x", { offByBarcode: offS, fsByBarcode: fsS, usdaByBarcode: usdaS });
  ok("FatSecret is asked when OFF comes up empty", fsS.calls === 1);
  ok("a FatSecret hit wins", r.winner.source === "fatsecret", r.winner);
  ok("a FatSecret hit stops before USDA", usdaS.calls === 0);
}
{
  const offS = spy(food("Named Only", 0, "off")), fsS = spy(null), usdaS = spy(food("Bar", 200, "usda"));
  const r = await barcodeSources("x", { offByBarcode: offS, fsByBarcode: fsS, usdaByBarcode: usdaS });
  ok("an OFF record with no calories is not a hit", r.winner.source === "usda", r.winner);
  ok("a nutrition-less OFF record still asks FatSecret", fsS.calls === 1);
  ok("the named OFF record is carried through for the message", r.off.name === "Named Only");
}
{
  const offS = spy(null), fsS = spy(null), usdaS = spy(null);
  const r = await barcodeSources("x", { offByBarcode: offS, fsByBarcode: fsS, usdaByBarcode: usdaS });
  ok("all three sources are asked before giving up", offS.calls === 1 && fsS.calls === 1 && usdaS.calls === 1,
    { off: offS.calls, fs: fsS.calls, usda: usdaS.calls });
  ok("nothing found means no winner", r.winner === null);
}
{
  // A throwing source must not take the ladder down with it — that would turn
  // a flaky network into "this barcode does not exist".
  const boom = () => { throw new Error("network"); };
  const offS = spy(boom), fsS = spy(boom), usdaS = spy(food("Bar", 200, "usda"));
  const r = await barcodeSources("x", { offByBarcode: offS, fsByBarcode: fsS, usdaByBarcode: usdaS });
  ok("a throwing OFF falls through to the next rung", r.winner.source === "usda");
  ok("a throwing FatSecret falls through to the next rung", usdaS.calls === 1);
}

// ── 5. The message when nothing has it ────────────────────────────────────
{
  const m = barcodeMiss(null, null, "04963406");
  ok("a total miss names the code", m.err.includes("04963406"));
  ok("a total miss offers a way forward", /Search by name|AI estimate/.test(m.err));
  ok("a total miss prefills nothing", m.name === "");
  const named = barcodeMiss(food("Choc Bar", 0, "off"), null, "04963406");
  ok("a named miss says the product WAS found", /Found the product/.test(named.err));
  ok("a named miss prefills the name", named.name === "Choc Bar");
  const fsNamed = barcodeMiss(null, { name: "FS Bar" }, "1");
  ok("a name from FatSecret counts too", fsNamed.name === "FS Bar");
  // The app white-labels and the source list changes; naming vendors in an
  // error tells the person holding a protein bar nothing they can act on.
  ok("no vendor names leak into the copy",
    !/Open Food Facts|USDA|FatSecret/.test(m.err + named.err + fsNamed.err), m.err);
}

// ── 6. The callable never turns a deployment problem into an error ────────
const res = (obj, okFlag = true, status = 200) => async () => ({ ok: okFlag, status, json: async () => obj });
{
  const r = await _barcodeLookup([], "https://p", "s", res({}));
  ok("no candidates: a clean empty answer", r.mode === "barcode" && r.food === null && !r.unavailable, r);
}
{
  // ⚠️ FILTERED, NOT MERELY SURVIVED. Asserting only that the answer is empty
  // passes whether the candidate was rejected or sent upstream and missed — so
  // this counts the outbound calls. A raw 8-digit code is not a GTIN-13 and must
  // never reach FatSecret.
  let asked = 0;
  const counting = async () => { asked++; return { ok: true, status: 200, json: async () => ({}) }; };
  const r = await _barcodeLookup(["04963406"], "https://p", "s", counting);
  ok("a non-GTIN candidate is never sent upstream", asked === 0, asked);
  ok("a non-GTIN candidate answers cleanly", r.mode === "barcode" && r.food === null && !r.unavailable);
}
{
  // An OLD proxy answers 404 for an unknown path. That must look like a miss.
  const r = await _barcodeLookup(["0049000006346"], "https://p", "s", res({ error: "not-found" }, false, 404));
  ok("an un-redeployed proxy reads as unavailable", r.unavailable === true, r);
  ok("an un-redeployed proxy still answers in barcode mode", r.mode === "barcode");
  ok("an un-redeployed proxy never throws", r.food === null);
}
{
  const r = await _barcodeLookup(["0049000006346"], "https://p", "s", res({ gated: true }));
  ok("a FatSecret scope gate reads as gated", r.gated === true && r.unavailable === true, r);
}
{
  const r = await _barcodeLookup(["0049000006346"], "https://p", "s", res({ food: null }));
  ok("a real miss is NOT unavailable", r.food === null && !r.unavailable, r);
}
{
  const fsFood = { food_name: "protein bar", brand_name: "brand", food_id: "77",
    servings: { serving: [{ metric_serving_amount: "100", metric_serving_unit: "g",
      calories: "210", protein: "20", carbohydrate: "24", fat: "7", serving_description: "1 bar" }] } };
  const r = await _barcodeLookup(["0049000006346"], "https://p", "s", res({ food: fsFood }));
  ok("a FatSecret food comes back parsed", r.food && r.food.kcal === 210, r.food);
  ok("a FatSecret food is tagged as FatSecret", r.food.source === "fatsecret");
  ok("a FatSecret food keeps its id for the detail fetch", r.food.fsId === "77");
  ok("a FatSecret food is title-cased like the rest", r.food.name === "Protein Bar", r.food.name);
  ok("a barcode hit is never flagged unavailable", !r.unavailable);
}
{
  let asked = 0;
  const f = async () => { asked++; return { ok: true, status: 200, json: async () => ({ food: null }) }; };
  await _barcodeLookup(["0049000006346", "0028400335799", "5000112637922"], "https://p", "s", f);
  ok("at most two candidates are ever sent upstream", asked === 2, asked);
}

// ── 6b. The client latch, RUN ─────────────────────────────────────────────
// ⚠️ THE LATCH USED TO FIRE ON A TIMEOUT. `unavailable` is set by the server on
// ANY non-2xx and on any fetch failure, including its own 6-second abort — so
// one slow scan disabled FatSecret for the whole browser session, which is the
// exact opposite of what the comment above it promised. Latch on facts about
// the DEPLOYMENT (an old proxy, a scope gate), never on the weather.
{
  const mk = (reply) => {
    const prelude = "let _fsBarcodeOff = false; let _fatSecretOff = false;"
      + " const _fsBarcodeCache = new Map();"
      + " const callFoodSearch = async () => ({ data: REPLY });";
    const body = [liftDecl(APP, "upcEtoA"), liftDecl(APP, "barcodeGtins"), liftDecl(APP, "fsByBarcode")].join("\n");
    const f = new Function("REPLY", prelude + "\n" + body
      + "\nreturn { fsByBarcode, off: () => _fsBarcodeOff };");
    return f(reply);
  };
  const CODE = "0049000006346";
  {
    const m = mk({ mode: "barcode", food: null, unavailable: true });
    return_ = await m.fsByBarcode(CODE);
    ok("a slow call returns no food", return_ === null);
    ok("...and does NOT retire the source", m.off() === false);
  }
  {
    const m = mk({ mode: "barcode", food: null, unavailable: true, routeMissing: true });
    await m.fsByBarcode(CODE);
    ok("an un-redeployed proxy DOES retire the source", m.off() === true);
  }
  {
    const m = mk({ mode: "barcode", food: null, unavailable: true, gated: true });
    await m.fsByBarcode(CODE);
    ok("a scope gate DOES retire the source", m.off() === true);
  }
  {
    const m = mk({ foods: [] });                       // an older deploy: no `mode`
    await m.fsByBarcode(CODE);
    ok("a reply with no barcode mode retires the source", m.off() === true);
  }
  {
    const m = mk({ mode: "barcode", food: { name: "Bar", kcal: 210, source: "fatsecret" } });
    const hit = await m.fsByBarcode(CODE);
    ok("a hit comes back", hit && hit.kcal === 210, hit);
    ok("...and leaves the source enabled", m.off() === false);
  }
}
{
  // A 404 from the proxy is a fact about the deployment and must be reported
  // as one — it is what tells the app it may stop asking.
  const res404 = async () => ({ ok: false, status: 404, json: async () => ({ error: "not-found" }) });
  const r = await _barcodeLookup(["0049000006346"], "https://p", "s", res404);
  ok("a 404 is reported as a missing route", r.routeMissing === true, r);
  const resSlow = async () => { throw new Error("aborted"); };
  const r2 = await _barcodeLookup(["0049000006346"], "https://p", "s", resSlow);
  ok("a timeout is NOT reported as a missing route", !r2.routeMissing && r2.unavailable === true, r2);
}
{
  // ⚠️ ORDER, NOT PRESENCE. A 200 carrying no token must be refused BEFORE the
  // cache line, or `undefined` is cached for 24 hours and every later call
  // sends "Bearer undefined" with no way to self-heal.
  const guard = PROXY.indexOf("fatsecret-auth-no-token");
  const cache = PROXY.indexOf("_tokens.set(scope,");
  ok("a tokenless 200 is refused", guard > 0, guard);
  ok("...before anything is cached", guard > 0 && cache > guard, { guard, cache });
}

// ── 7. Wiring only the source can answer ──────────────────────────────────
// ⚠️ THE ALLOWLIST, NOT THE HANDLER. Asserting the handler exists stays green
// when the path is removed from the 404 guard above it — the handler is then
// unreachable code and every scan gets "not-found".
ok("the barcode path survives the 404 guard",
  /u\.pathname !== "\/search" && u\.pathname !== "\/food" && u\.pathname !== "\/barcode"/.test(PROXY));
ok("the proxy has a barcode handler", /if \(u\.pathname === "\/barcode"\)/.test(PROXY));
ok("the proxy validates the GTIN before spending a call", /\\d\{13\}\$\/\.test\(code\)/.test(PROXY));
ok("the proxy still asks for the basic scope by default", /getToken\(scope = "basic"\)/.test(PROXY));
ok("the barcode path asks for the barcode scope", /const SCOPE = "basic barcode";/.test(PROXY));
ok("a refused scope is retried without one", /retrying with no scope/.test(PROXY));
{
  // ⚠️ RUN THE PREDICATE, DO NOT MATCH IT. Widening this to `!!e` is invisible to
  // a source grep and is the difference between "FatSecret does not grant us
  // barcode" and "one rate-limit blip disabled barcode for the life of a VM
  // process nobody restarts".
  const gateErr = new Function(liftDecl(PROXY, "gateErr") + "\nreturn gateErr;")();
  // ⚠️ RUN THE SCOPE-RETRY DECISION TOO. It used to retry WITHOUT the scope on
  // any failure at all — so a 429 or a 503 from FatSecret's oauth endpoint
  // produced a basic-only token, cached for 24 hours, which then answered
  // "missing scope" and latched the gate permanently. One bad minute disabled
  // barcode on an account that holds the entitlement, silently.
  const scopeRefused = new Function(liftDecl(PROXY, "scopeRefused") + "\nreturn scopeRefused;")();
  ok("a 400 is a scope refusal", scopeRefused(400) === true);
  ok("a 401 is a scope refusal", scopeRefused(401) === true);
  ok("a 403 is a scope refusal", scopeRefused(403) === true);
  ok("a RATE LIMIT is not a scope refusal", scopeRefused(429) === false);
  ok("a server error is not a scope refusal", scopeRefused(500) === false);
  ok("a gateway error is not a scope refusal", scopeRefused(502) === false);
  ok("a timeout-shaped 504 is not a scope refusal", scopeRefused(504) === false);
  // ⚠️ AND THE GATE EXPIRES, so a wrong conclusion cannot outlive the process
  // that reached it — recovery used to need an SSH session.
  const barcodeGated = new Function(liftDecl(PROXY, "GATE_TTL_MS") + "\nlet _barcodeGateAt = 0;\n"
    + liftDecl(PROXY, "barcodeGated") + "\nreturn (at, now) => { _barcodeGateAt = at; return barcodeGated(now); };")();
  const T = 1757000000000;
  ok("an ungated process is not gated", barcodeGated(0, T) === false);
  ok("a fresh gate holds", barcodeGated(T - 60000, T) === true);
  ok("an hour-old gate has expired", barcodeGated(T - 61 * 60000, T) === false);
  ok("a missing-scope code gates", gateErr({ code: 14, message: "Missing scope" }) === true);
  ok("a missing-scope message gates", gateErr({ code: 2, message: "missing scope: barcode" }) === true);
  ok("an unknown-method message gates", gateErr({ code: 3, message: "Unknown method" }) === true);
  ok("a rate limit does NOT gate", gateErr({ code: 21, message: "Too many requests" }) === false);
  ok("a generic upstream error does NOT gate", gateErr({ code: 5, message: "Internal error" }) === false);
  ok("an absent error does not gate", gateErr(null) === false);
  ok("an empty error does not gate", gateErr({}) === false);
}
ok("the scanner asks the ladder, not two inline sources", /await barcodeSources\(code\)/.test(APP));
ok("the old two-source error copy is gone", !/in Open Food Facts or USDA/.test(APP));
// Count CALL SITES: the ladder is worthless if nothing calls it.
ok("barcodeSources has exactly one caller", (APP.match(/await barcodeSources\(/g) || []).length === 1);
ok("fsByBarcode is wired into the ladder default", /offByBarcode, fsByBarcode, usdaByBarcode/.test(APP));

console.log(`\n  ${checks - fails}/${checks} checks passed`);
console.log("  Three databases, and both readings of every short code.\n");
process.exit(fails ? 1 : 0);
