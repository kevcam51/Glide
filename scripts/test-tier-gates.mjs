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
// ⚠️ EIGHT, NOT NINE — the ledger row was REMOVED entirely in S215d, not moved.
// This assertion caught that change itself, which is the point of counting
// rather than merely finding.
ok("every remaining session row moved off Connect",
   (APP.match(/\["(Session booking & cancellation policy|Roster calendar — month, week & day|Repeating sessions — weekly, fortnightly, monthly|Block out your own time|Clients see your free slots & request a time|Session reminders, at the lead times you pick|Your sessions in Google, Apple or Outlook Calendar|No-show and waive controls on delivered sessions)", false, false, true, true\]/g) || []).length === 8);
ok("NEG: no session row still shows a tick under Connect",
   !/\["Session booking & cancellation policy", false, true/.test(APP)
   && !/\["Roster calendar — month, week & day", false, true/.test(APP));
ok("the blurb no longer quotes two different numbers as one",
   !/Up to 15 AI-coached clients a month, plus session booking and unlimited clients/.test(APP));
// ⚠️ TWO ROWS, ONE FEATURE. Session payments are built and working, allowlisted
// to a single uid until Stripe Connect lands. Card-on-file was false in every
// column; the ledger is worse — it reads sessionCharges, which the settle
// dispatcher only writes for allowlisted uids, so for anyone else the screen
// renders EMPTY permanently. Neither belongs on a grid that says what you get.
ok("card-on-file is off the grid — it is an allowlist of one, not a tier",
   !/\["Card on file & automatic session billing"/.test(APP));
ok("...and so is the earnings ledger, which would render empty forever",
   !/\["Earnings ledger/.test(APP));
ok("NEG: both tooltips are KEPT, so the wording is ready when billing opens",
   /"Card on file & automatic session billing":/.test(APP)
   && /"Earnings ledger — what was charged, and what didn't":/.test(APP));
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

  const boostBlock = AI.slice(AI.indexOf("const BOOSTS_PER_DAY"), AI.indexOf("const BOOSTS_PER_DAY") + 900);
  ok("Coach Connect may boost", /trainerConnect: \d/.test(boostBlock));
  ok("client Connect may NOT boost — a +15k step costs more than the tier earns",
     !/\bconnect: \d/.test(boostBlock));
  ok("automations are stated as zero for both Connect tiers, not left to a missing key",
     /connect: 0, trainerConnect: 0,/.test(WF));

  // And the page now says what the code does. The exact figures are checked
  // against BUDGETS/SEARCH_BUDGETS in test-tier-solvency.mjs; what matters HERE
  // is that Connect is no longer a dash — a dash was the original lie.
  ok("BOTH grids state Connect's conversation allowance, not a dash",
     (APP.match(/\["AI conversations per day", "—", "~\d+",/g) || []).length === 2
     && !/\["AI conversations per day", "—", "—",/.test(APP));
  ok("...and both state its web searches",
     (APP.match(/\["Web searches per day", "—", "\d+", "\d+", "\d+"\]/g) || []).length === 2
     && !/\["Web searches per day", "—", "—",/.test(APP));
  ok("the 'No in-app AI' row is gone — it was never true",
     !/\["No in-app AI — you bring your own"/.test(APP));
  ok("...and neither blurb still claims it",
     !/blurb: "[^"]*No in-app AI/.test(APP), (APP.match(/blurb: "[^"]*No in-app AI[^"]*"/g) || [])[0]);
  ok("automations stay OFF for Connect on the grid, matching WORKFLOW_CAP",
     /\["Scheduled AI automations — wake up to today's plan", false, false, true, true\]/.test(APP));
}

// ── 7. Trainerize is per-trainer now, and gated (S215c) ───────────────────
// ⚠️ IT WAS NEVER A TIER FEATURE. There was ONE credential — the owner's group
// token in Secret Manager — which is why every entry point was locked to his
// UID. Opening the gate on tiers alone would not have given trainers their own
// rosters; it would have handed every Coach subscriber the owner's client list.
{
  const TZ = readFileSync(join(ROOT, "functions", "trainerize.js"), "utf8");
  const IDX = readFileSync(join(ROOT, "functions", "index.js"), "utf8");
  const RUL = RULES;

  ok("a per-trainer credential store exists", /const TZ_CREDS = "trainerizeCreds";/.test(TZ));
  // ⚠️ THE STORE'S SECURITY IS THE ABSENCE OF A RULE. firestore.rules denies by
  // default, so a collection with no match block is Admin-SDK only — the shape
  // webauthnCreds already uses. A match block appearing here would open it.
  ok("...with NO firestore.rules block, so it is Admin-SDK only",
     !/trainerizeCreds/.test(RUL));
  ok("...and NOT in kv, which the trainer chain can read",
     !/kv[^\n]*trainerizeCreds|trainerizeCreds[^\n]*kv/.test(TZ));

  ok("connect validates against Trainerize before storing", /roster = await fetchRoster\(auth\);/.test(TZ));
  ok("...and never echoes the credential or the upstream body on failure",
     /Trainerize refused those details/.test(TZ) && !/e\.message\s*\}\)\s*;?\s*\/\/ echo/.test(TZ));
  ok("status returns a MASKED group id, never the token",
     /groupIdMasked: own \? String\(own\.groupId\)\.slice\(-4\)/.test(TZ)
     && !/token: own\.token/.test(TZ));
  ok("disconnect has NO plan check — never trap a stored credential",
     /disconnectTrainerize[\s\S]{0,700}?TZ_CREDS[^\n]*delete\(\)/.test(TZ));

  ok("the import is gated to Coach and above", /reason: "trainerize-not-on-plan"/.test(TZ));
  ok("...and refuses when no account is connected", /reason: "trainerize-not-connected"/.test(TZ));
  ok("the owner still runs on the shared secret, so his roster is not migrated",
     /if \(ADMIN_UIDS\.includes\(uid\) && sharedGroupId && sharedToken\)/.test(TZ));
  ok("...and every other trainer fails CLOSED without their own", /return null;\n\}/.test(TZ));

  // The scheduled sweep was single-tenant by construction.
  ok("autoSync no longer hardcodes the owner", !/const uid = ADMIN_UIDS\[0\]; \/\/ single-tenant/.test(TZ));
  ok("...it iterates every connected trainer", /const owners = new Set\(ADMIN_UIDS\);/.test(TZ));
  ok("...re-checks the plan every run, so a lapsed sub stops syncing",
     /!ADMIN_UIDS\.includes\(uid\) && !bookingAllowed\(\{ \.\.\.prof, uid \}\)\) \{ skipped\+\+; continue; \}/.test(TZ));
  ok("...and one trainer's failure does not end the sweep",
     /failed\+\+;/.test(TZ) && /trainers: owners\.size, ran, skipped, failed/.test(TZ));
  ok("...without putting a uid in Cloud Logging",
     !/console\.error\("trainerizeAutoSync[^"]*", *uid/.test(TZ));

  ok("the three callables are exported", /exports\.connectTrainerize/.test(IDX)
     && /exports\.disconnectTrainerize/.test(IDX) && /exports\.trainerizeStatus/.test(IDX));

  // And the page stops selling it to people who cannot have it.
  ok("the grid row is Coach+ and no longer 'free forever'",
     /\["Sync your clients from Trainerize\*", false, false, true, true\]/.test(APP));
  ok("...and names the Trainerize-plan caveat we do not control",
     /Studio or higher\) \\u2014 that is Trainerize's requirement, not ours/.test(APP));
  ok("NEG: the old unlimited row is gone",
     !/\["Connect clients from Trainerize", "15", "Unlimited"/.test(APP));

  // Two claims S215 made false elsewhere on the page.
  ok("the booking tip no longer says 'every paid plan'",
     !/cancellation policy they see up front\. Included on every paid plan/.test(APP));
  ok("the seats tip no longer calls the roster unlimited on every paid plan",
     /which is 15 on Connect and unlimited from Coach up/.test(APP));
  ok("the roster banner names the plan instead of assuming free",
     /used on \{rosterCap\.cappedPlan \|\| "the free plan"\}/.test(APP));
}

// ── 8. the app can actually reach it (S215c) ──────────────────────────────
{
  ok("the three callables are wired in the app",
     /callTrainerizeStatus = httpsCallable\(functions, "trainerizeStatus"\)/.test(APP)
     && /callConnectTrainerize = httpsCallable\(functions, "connectTrainerize"/.test(APP)
     && /callDisconnectTrainerize = httpsCallable\(functions, "disconnectTrainerize"\)/.test(APP));
  // ⚠️ THE UID TEST USED TO BE THE WHOLE GATE. If it still is, the feature is
  // built and unreachable — which is exactly the state the audit found it in.
  ok("the Trainerize UI is no longer owner-only",
     /tzIsOwner = meUid === OWNER_UID \|\| meUid === TZ_TEST_UID\s*\n\s*\|\| !!\(tzStatus && tzStatus\.connected\);/.test(APP));
  ok("...and the owner keeps his UID path, so his roster is not migrated",
     /tzIsOwner = meUid === OWNER_UID \|\| meUid === TZ_TEST_UID/.test(APP));
  ok("the connect panel is shown on plan, and only before connecting",
     /tzStatus && tzStatus\.allowed && !tzStatus\.connected && !tzIsOwner &&/.test(APP));
  ok("the token field is a password input — it is a bearer credential",
     /placeholder="API token" type="password" autoComplete="off"/.test(APP));
  ok("the Trainerize-plan caveat is stated before they type anything",
     /API access on your Trainerize plan<\/b> \(Studio or higher\)/.test(APP));
  ok("a status read never blocks the page", /\.catch\(\(\) => \{ if \(alive\) setTzStatus\(null\); \}\);/.test(APP));
  ok("disconnect is offered where the connection is shown", /Disconnect<\/button>/.test(APP));
}

console.log(`${checks - fails}/${checks} tier-gate assertions passed`);
if (fails) process.exit(1);
