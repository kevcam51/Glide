// No tier may lose money at its own ceiling (S215e).
//
// KEVIN: "make sure the prices don't make us lose money."
//
// docs/PRICING.md has required "every tier profitable at its absolute ceiling"
// since S169g — and the margin table that backs that claim counts TOKENS ONLY.
//
// ⚠️ WEB SEARCH IS BILLED SEPARATELY, at $10 per 1,000 (docs/WEB-SEARCH.md), on
// top of tokens. SEARCH_BUDGETS was sized in S184 against TYPICAL use (~15% of
// exchanges search) and never against the ceiling rule. Counted properly, four
// tiers were underwater at their ceilings and Connect lost $0.78/month at BASE,
// with no boosts at all — and S215b had just re-sized Connect using that same
// token-only basis, inheriting the blind spot.
//
// ⚠️ A BOOST IS A FIXED +15k, so it must be priced at the BOOSTED ceiling, not
// the base one. Three of the four failures only appeared once boosts were added.
//
// This file is the guard: it recomputes every tier from the SHIPPING constants
// and fails if one cannot pay for itself. It is arithmetic, not an assertion
// about text, so it cannot rot into agreeing with whatever the numbers become.
//
// Run: node scripts/test-tier-solvency.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AI = readFileSync(join(ROOT, "functions", "aichat.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

function bal(x, i) { let d = 0, st = false;
  for (let j = i; j < x.length; j++) { if (x[j] === "{") { d++; st = true; }
    else if (x[j] === "}") { d--; if (st && d === 0) return x.slice(i, j + 1); } } }
const obj = (name) => { const b = bal(AI, AI.indexOf(`const ${name} = `));
  return eval("(" + b.slice(b.indexOf("{")) + ")"); };

const BUDGETS = obj("BUDGETS"), SEARCH = obj("SEARCH_BUDGETS"), BOOSTS = obj("BOOSTS_PER_DAY");

// ── the cost basis, from the docs that measured it ────────────────────────
const RATE_AVG = 4.70;    // $/1M budget-tokens — PRICING.md measured 3.8–6.1
const RATE_WORST = 6.10;  // the top of that measured range
const SEARCH_EACH = 0.01; // $10 per 1,000 — WEB-SEARCH.md
const BOOST_STEP = 15000; // fixed step since S179i
const DAYS = 30;
const MIN_MARGIN = 1.00;  // a tier must clear its ceiling by at least this

// Net of Stripe's 2.9% + 30c — the same figures referrals.js grants against.
const NET = { connect: 4.55, premium: 14.26, max: 28.82, ultra: 48.24,
  coach_connect: 19.11, coach: 47.28, coach_max: 76.41, coach_ultra: 124.96 };

const TIERS = [
  ["Connect",       "connect",      "connect"],
  ["Premium",       "premium",      "client"],
  ["Client Elite",  "max",          "clientMax"],
  ["Client Apex",   "ultra",        "clientUltra"],
  ["Coach Connect", "coach_connect", "trainerConnect"],
  ["Coach",         "coach",        "trainer"],
  ["Coach Elite",   "coach_max",    "trainerMax"],
  ["Coach Apex",    "coach_ultra",  "trainerUltra"],
];

const cost = (tokens, searches, rate) =>
  (tokens / 1e6) * rate * DAYS + searches * SEARCH_EACH * DAYS;

// ── 1. every priced tier clears its ceiling, boosts included ──────────────
for (const [label, priceKey, budKey] of TIERS) {
  const net = NET[priceKey], base = BUDGETS[budKey];
  const searches = SEARCH[budKey] || 0, boosts = BOOSTS[budKey] || 0;
  ok(`${label}: budget is defined`, typeof base === "number" && base > 0, base);
  const ceiling = base + boosts * BOOST_STEP;
  const m = net - cost(ceiling, searches, RATE_AVG);
  ok(`${label}: clears its ceiling by >= $${MIN_MARGIN.toFixed(2)}`, m >= MIN_MARGIN,
     { net, tokens: base, boosts, searches, ceilingCost: +cost(ceiling, searches, RATE_AVG).toFixed(2), margin: +m.toFixed(2) });
}

// ⚠️ THE SEARCH HALF, ASSERTED SEPARATELY. Without this a future edit could
// zero the token budgets, pass every check above, and still bleed on search.
for (const [label, priceKey, budKey] of TIERS) {
  const share = (SEARCH[budKey] || 0) * SEARCH_EACH * DAYS / NET[priceKey];
  ok(`${label}: search is a sane share of revenue (<40%)`, share < 0.40, +(share * 100).toFixed(1) + "%");
}

// ── 2. the failures this file was written for ─────────────────────────────
// Negative controls: the OLD numbers must still compute as losses, or the model
// has drifted into agreeing with whatever is in the file today.
ok("NEG: the old Connect (25k + 6 searches) really did lose money",
   NET.connect - cost(25000, 6, RATE_AVG) < 0,
   +(NET.connect - cost(25000, 6, RATE_AVG)).toFixed(2));
ok("NEG: the old Coach Connect (100k + 15 searches + 2 boosts) lost money",
   NET.coach_connect - cost(100000 + 2 * BOOST_STEP, 15, RATE_AVG) < 0);
ok("NEG: the old Client Elite (150k + 25 searches + 1 boost) lost money",
   NET.max - cost(150000 + BOOST_STEP, 25, RATE_AVG) < 0);
ok("NEG: token-only maths HIDES all three — which is why the table missed them",
   NET.connect - cost(25000, 0, RATE_AVG) > 0
   && NET.coach_connect - cost(100000 + 2 * BOOST_STEP, 0, RATE_AVG) > 0);

// ── 3. the coach ladder still has real headroom ───────────────────────────
for (const [label, priceKey, budKey] of TIERS.filter((t) => ["Coach", "Coach Elite", "Coach Apex"].includes(t[0]))) {
  const m = NET[priceKey] - cost(BUDGETS[budKey] + (BOOSTS[budKey] || 0) * BOOST_STEP, SEARCH[budKey] || 0, RATE_AVG);
  ok(`${label}: comfortable, not merely solvent (>= $5)`, m >= 5, +m.toFixed(2));
}

// ── 4. paying must never shrink the product (S169g) ───────────────────────
ok("Premium is not beaten by the trial it follows", BUDGETS.client >= BUDGETS.trial);
ok("Coach is not beaten by the trainer trial", BUDGETS.trainer >= BUDGETS.trainerTrial);
ok("each rung buys more than the one below it",
   BUDGETS.connect < BUDGETS.client && BUDGETS.client < BUDGETS.clientMax
   && BUDGETS.clientMax < BUDGETS.clientUltra
   && BUDGETS.trainerConnect < BUDGETS.trainer && BUDGETS.trainer < BUDGETS.trainerMax
   && BUDGETS.trainerMax < BUDGETS.trainerUltra);
ok("...and so does each search allowance",
   SEARCH.connect < SEARCH.client && SEARCH.client < SEARCH.clientMax
   && SEARCH.trainerConnect < SEARCH.trainer && SEARCH.trainer < SEARCH.trainerMax);

// ── 5. what the page tells a buyer matches what they get ──────────────────
// ⚠️ THE WHOLE POINT OF CHANGING A PRICE IS THAT SOMEBODY IS DECIDING ON IT.
// An allowance edit that does not reach the grid turns a real number into a
// false promise, which is the class of defect the S215 audit existed to clear.
const conv = (t) => Math.floor(t / 1500);   // ~1,500 budget-tokens per conversation
ok("client grid states Connect's conversations",
   new RegExp(`\\["AI conversations per day", "—", "~${conv(BUDGETS.connect)}",`).test(APP),
   conv(BUDGETS.connect));
ok("trainer grid states Coach Connect's conversations",
   new RegExp(`\\["AI conversations per day", "—", "~${conv(BUDGETS.trainerConnect)}",`).test(APP),
   conv(BUDGETS.trainerConnect));
ok("client grid states the search allowances",
   new RegExp(`\\["Web searches per day", "—", "${SEARCH.connect}", "${SEARCH.client}", "${SEARCH.clientMax}"\\]`).test(APP),
   [SEARCH.connect, SEARCH.client, SEARCH.clientMax]);
ok("trainer grid states the search allowances",
   new RegExp(`\\["Web searches per day", "—", "${SEARCH.trainerConnect}", "${SEARCH.trainer}", "${SEARCH.trainerMax}"\\]`).test(APP),
   [SEARCH.trainerConnect, SEARCH.trainer, SEARCH.trainerMax]);

console.log(`${checks - fails}/${checks} tier-solvency assertions passed`);
if (fails) process.exit(1);
