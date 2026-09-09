// Who may book, and who may not (S215).
//
// KEVIN: "in the coach connect we should eliminate the session booking and we
// need to remove the 'unlimited clients' phrasing... We had a client limit of 15
// and for some reason it says unlimited."
//
// Two packaging changes, both enforced rather than merely advertised:
//   • Coach Connect's roster is capped at 15, like Free. It was uncapped under
//     S176's "limit only what we pay for"; S215 reverses that on packaging
//     grounds — Connect is the entry rung and the $19.99 → $49 step has to sell
//     more than in-app AI.
//   • Session booking is Coach and above. Connect is the plugin tier.
//
// ⚠️ NEITHER MAY EVER TAKE SOMETHING AWAY. Both are dated: every account that
// existed before the ship date keeps what it had, forever. That is the rule
// teamsAllowed() already states as "never a take-away", and the reason both
// gates grandfather by ACCOUNT age rather than subscription age — over-generous
// on purpose, because the failure that matters is cutting off someone paying.
//
// ⚠️ AND THE RULES ARE NOT THE WHOLE GATE. firestore.rules mayBook() covers
// session CREATE, which is a client-side write. But respondToBookingRequest
// creates a session with the ADMIN SDK, which bypasses rules entirely — so a
// Connect trainer who could not book from the calendar could still book by
// accepting a client's request. Four doors, not one:
//   sessions create (rules) · trainerBlocks create (rules)
//   respondToBookingRequest (callable) · trainerAvailability (callable)
//   calendarFeedLink (callable)
//
// Run: node scripts/test-tier-gates.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require_ = createRequire(import.meta.url);
const RULES = readFileSync(join(ROOT, "firestore.rules"), "utf8");
const AVAIL = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");
const FEED = readFileSync(join(ROOT, "functions", "calendarFeed.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// The SHIPPING predicates, executed — not a transcription of them.
const { capApplies, bookingAllowed, CONNECT_CAP_FROM_MS, FREE_ROSTER_CAP } =
  require_(join(ROOT, "functions", "roster.js"));

const AFTER = CONNECT_CAP_FROM_MS + 86400000;    // an account created after the change
const BEFORE = CONNECT_CAP_FROM_MS - 86400000;   // one that already existed
const P = (over) => ({ uid: "u1", role: "head_trainer", createdAt: AFTER, ...over });
const sub = (tier) => ({ subscriptionStatus: "active", subscriptionTier: tier });

// ── 1. the roster cap now reaches Connect ─────────────────────────────────
ok("Free is capped", capApplies(P({})) === true);
ok("Coach Connect is capped too, which is the change", capApplies(P(sub("coach_connect"))) === true);
ok("...and so is the client-side Connect tier", capApplies(P(sub("connect"))) === true);
ok("Coach is not", capApplies(P(sub("coach"))) === false);
ok("Coach Elite is not", capApplies(P(sub("coach_max"))) === false);
ok("Coach Apex is not", capApplies(P(sub("coach_ultra"))) === false);
ok("a trial is the whole product", capApplies(P({ trialStartedAt: Date.now() })) === false);
ok("the cap is still 15", FREE_ROSTER_CAP === 15);

// ⚠️ NEVER A TAKE-AWAY — the assertion the whole dated design exists for.
ok("an EXISTING Connect subscriber keeps an unlimited roster",
   capApplies({ ...P(sub("coach_connect")), createdAt: BEFORE }) === false);
ok("...and an existing account keeps booking on Connect",
   bookingAllowed({ ...P(sub("coach_connect")), createdAt: BEFORE }) === true);

// ── 2. booking is Coach and above ─────────────────────────────────────────
ok("Coach may book", bookingAllowed(P(sub("coach"))) === true);
ok("Coach Elite may book", bookingAllowed(P(sub("coach_max"))) === true);
ok("Coach Apex may book", bookingAllowed(P(sub("coach_ultra"))) === true);
ok("a trialling trainer may book", bookingAllowed(P({ trialStartedAt: Date.now() })) === true);
ok("a NEW Coach Connect trainer may NOT", bookingAllowed(P(sub("coach_connect"))) === false);
ok("a free trainer may NOT", bookingAllowed(P({})) === false);
ok("the admin always may", bookingAllowed(P({ uid: "G7QUZ8Kat1fgyoMjdGKz4DYoVHi1" })) === true);

// ⚠️ THE SUBSTRING TRAP, ASSERTED AS ARITHMETIC. "coach_connect" contains
// "coach": a gate that tested coach first would grant booking to the one tier
// this change removes it from, and every other assertion here would still pass.
ok("NEG: the tier that must be denied literally contains the tier that is allowed",
   "coach_connect".includes("coach") && bookingAllowed(P(sub("coach"))) === true
   && bookingAllowed(P(sub("coach_connect"))) === false);
// The same hazard one rung up.
ok("NEG: coach_max contains 'max' and is still allowed", bookingAllowed(P(sub("coach_max"))) === true);

// A missing field must never lock someone out — both predicates fail OPEN.
ok("no createdAt is treated as grandfathered, not as new", bookingAllowed(P({ createdAt: undefined })) === true);
ok("...on the roster cap as well", capApplies(P({ createdAt: undefined })) === false);
ok("a comped account keeps both", bookingAllowed(P({ entitlements: { premium: true } })) === true
   && capApplies(P({ entitlements: { premium: true } })) === false);

// ── 3. all five doors are actually shut ───────────────────────────────────
// The rules cover the two client-side writes.
ok("firestore.rules gates session create", /allow create: if isSignedIn\(\)\s*\n\s*&& mayBook\(request\.resource\.data\.trainerUid\)/.test(RULES));
ok("...and blocking out time", /allow create: if isSignedIn\(\)\s*\n\s*&& mayBook\(request\.auth\.uid\)/.test(RULES));
ok("mayBook fails OPEN on a missing profile, matching roster.js",
   /return isAdmin\(\) \|\| !profileExists\(uid\) \|\| mayBookFrom\(profileData\(uid\)\);/.test(RULES));
ok("...and on a missing createdAt — the mirror's other fail-open",
   /p\.get\('createdAt', timestamp\.date\(2000, 1, 1\)\) < bookingCutoff\(\)/.test(RULES));
ok("the rules test connect BEFORE coach, or coach_connect inherits booking",
   RULES.indexOf("!p.get('subscriptionTier', '').lower().matches('.*connect.*')")
   < RULES.indexOf("&& p.get('subscriptionTier', '').lower().matches('.*coach.*')"));

// ⚠️ The Admin-SDK door the rules cannot see.
ok("respondToBookingRequest imports the one predicate", /const \{ bookingAllowed \} = require\("\.\/roster"\);/.test(AVAIL));
ok("...and refuses to accept a request off-plan", /reason: "booking-not-on-plan"/.test(AVAIL));
ok("...BEFORE the request is claimed, or a refusal destroys it",
   AVAIL.indexOf('if (accept) {') < AVAIL.indexOf("const inboxRef"));
ok("publishing free slots is gated too, so a client is never walked into a refusal",
   /if \(!bookingAllowed\(\{ \.\.\.trainer, uid: trainerUid \}\)\) return \{ visible: false, busy: \[\] \};/.test(AVAIL));
ok("the calendar feed will not mint a NEW token off-plan", /reason: "booking-not-on-plan"/.test(FEED));
ok("...but never revokes one already in someone's calendar app",
   /if \(!cur\.calendarFeedToken && !bookingAllowed/.test(FEED));

// ── 4. the app hides the door it can no longer open ───────────────────────
ok("the Sessions button tests booking, not the roster cap",
   /rosterCap && rosterCap\.booking === false\) \? setRosterPlans\(true\)/.test(APP));
ok("the server reports it", /booking: bookingAllowed\(\{ \.\.\.prof, uid \}\)/.test(readFileSync(join(ROOT, "functions", "roster.js"), "utf8")));

// ── 5. and the page no longer says the opposite ───────────────────────────
ok("Connect's roster row says 15, not Unlimited",
   /\["Clients & plan files", "15", "15", "Unlimited", "Unlimited"\]/.test(APP));
ok("simulations are stated as unlimited on every tier",
   /\["Sales simulations", "Unlimited", "Unlimited", "Unlimited", "Unlimited"\]/.test(APP));
ok("every session row moved off Connect",
   (APP.match(/\["(Session booking & cancellation policy|Roster calendar — month, week & day|Repeating sessions — weekly, fortnightly, monthly|Block out your own time|Clients see your free slots & request a time|Session reminders, at the lead times you pick|Your sessions in Google, Apple or Outlook Calendar|No-show and waive controls on delivered sessions|Earnings ledger — what was charged, and what didn't)", false, false, true, true\]/g) || []).length === 9);
ok("NEG: no session row still shows a tick under Connect",
   !/\["Session booking & cancellation policy", false, true/.test(APP)
   && !/\["Roster calendar — month, week & day", false, true/.test(APP));
ok("the blurb no longer quotes two different numbers as one",
   !/Up to 15 AI-coached clients a month, plus session booking and unlimited clients/.test(APP));
ok("card-on-file is off the grid — it is an allowlist of one, not a tier",
   !/\["Card on file & automatic session billing"/.test(APP));
ok("the 'nothing to connect' line is gone", !/Nothing to connect, nothing to switch/.test(APP));

// ── 6. Connect's AI budget is its own, and solvent (S215b) ────────────────
// ⚠️ CONNECT USED TO FALL THROUGH TO THE TIER ABOVE IT. tierFor() tested only
// /max/ and /ultra/, so coach_connect landed on `trainer` — 200k/day, identical
// to Coach at $49 — and client `connect` drew the full 45k, identical to Premium
// at $14.99. Both were reachable: isPremium() is true for any active sub, so the
// chat rendered unlocked.
//
// Kevin's call: the roster cap is the lever, not the allowance — so Connect KEEPS
// in-app AI, sized to what it charges. docs/PRICING.md has required every tier to
// be profitable at its own ceiling since S169g, and 200k costs ~$28/mo against
// Connect's ~$19.11 net.
{
  const AI = readFileSync(join(ROOT, "functions", "aichat.js"), "utf8");
  const WF = readFileSync(join(ROOT, "functions", "workflows.js"), "utf8");
  function bal(x, i) { let d = 0, st = false;
    for (let j = i; j < x.length; j++) { if (x[j] === "{") { d++; st = true; }
      else if (x[j] === "}") { d--; if (st && d === 0) return x.slice(i, j + 1); } } }
  const B = bal(AI, AI.indexOf("const BUDGETS = "));
  const S = new Function(bal(AI, AI.indexOf("function rewardTier(")) + "\n"
    + bal(AI, AI.indexOf("function rewardTierActive(")) + "\n"
    + "const BUDGETS=" + B.slice(B.indexOf("{")) + ";\n"
    + bal(AI, AI.indexOf("function tierFor(")) + "\nreturn { tierFor, BUDGETS };")();
  const T = (role, tier) => S.tierFor({ role, subscriptionStatus: "active", subscriptionTier: tier });

  ok("Coach Connect gets its OWN tier, not Coach's", T("head_trainer", "coach_connect") === "trainerConnect");
  ok("client Connect gets its own too", T("client", "connect") === "connect");
  ok("Coach is untouched", T("head_trainer", "coach") === "trainer" && S.BUDGETS.trainer === 200000);
  ok("Coach Elite is untouched", T("head_trainer", "coach_max") === "trainerMax");
  ok("Coach Apex is untouched", T("head_trainer", "coach_ultra") === "trainerUltra");
  ok("Premium is untouched", T("client", "premium") === "client" && S.BUDGETS.client === 45000);
  ok("NEG: coach_connect no longer resolves to the tier above it",
     T("head_trainer", "coach_connect") !== T("head_trainer", "coach"));
  ok("NEG: ...nor does client connect", T("client", "connect") !== T("client", "premium"));

  // Solvency, as arithmetic rather than assertion. Basis from docs/PRICING.md:
  // $0.47/day per 100k budget-tokens, 30 days.
  const monthlyCost = (tokens) => (tokens / 100000) * 0.47 * 30;
  const NET = { trainerConnect: 19.11, connect: 4.55, trainer: 47.28 };
  for (const t of ["trainerConnect", "connect"]) {
    const m = NET[t] - monthlyCost(S.BUDGETS[t]);
    ok(`${t} is profitable at its own ceiling`, m > 0, { tier: t, budget: S.BUDGETS[t], margin: +m.toFixed(2) });
  }
  ok("NEG: at the OLD budget Coach Connect was underwater — the reason for the change",
     NET.trainerConnect - monthlyCost(S.BUDGETS.trainer) < 0,
     +(NET.trainerConnect - monthlyCost(S.BUDGETS.trainer)).toFixed(2));
  ok("NEG: ...and so was client Connect at 45k",
     NET.connect - monthlyCost(45000) < 0);
  ok("Coach stays comfortably profitable", NET.trainer - monthlyCost(S.BUDGETS.trainer) > 15);

  // A boost is a fixed +15k, so it has to be checked at the boosted ceiling too.
  ok("Coach Connect may boost, and still clears at +15k",
     /trainerConnect: 2,/.test(AI) && NET.trainerConnect - monthlyCost(S.BUDGETS.trainerConnect + 15000) > 0);
  ok("client Connect may NOT boost — a +15k step puts it underwater",
     !/\bconnect: \d/.test(AI.slice(AI.indexOf("const BOOSTS_PER_DAY"), AI.indexOf("const BOOSTS_PER_DAY") + 700))
     && NET.connect - monthlyCost(S.BUDGETS.connect + 15000) < 0);
  ok("automations are stated as zero for both Connect tiers, not left to a missing key",
     /connect: 0, trainerConnect: 0,/.test(WF));

  // And the page now says what the code does.
  ok("the grid states Connect's allowance instead of a dash",
     /\["AI conversations per day", "—", "~16", "~30 \(more on request\)", "~100"\]/.test(APP)
     && /\["AI conversations per day", "—", "~66", "~133", "~200"\]/.test(APP));
  ok("...and its web searches", /\["Web searches per day", "—", "6", "12", "25"\]/.test(APP)
     && /\["Web searches per day", "—", "15", "30", "50"\]/.test(APP));
  ok("the 'No in-app AI' row is gone — it was never true",
     !/\["No in-app AI — you bring your own"/.test(APP));
  ok("...and neither blurb still claims it",
     !/blurb: "[^"]*No in-app AI/.test(APP), (APP.match(/blurb: "[^"]*No in-app AI[^"]*"/g) || [])[0]);
  ok("automations stay OFF for Connect on the grid, matching WORKFLOW_CAP",
     /\["Scheduled AI automations — wake up to today's plan", false, false, true, true\]/.test(APP));
}

console.log(`${checks - fails}/${checks} tier-gate assertions passed`);
if (fails) process.exit(1);
