// Parity between the CLIENT's calorie target and the SERVER's (S199).
//
// The app computes "what should I eat today" in src/App.jsx and the server
// recomputes it independently in functions/aitools.js, because the AI, the
// coach dashboards and the MCP connector all have to answer the same question
// without a browser. That mirror is deliberate — and it has drifted twice, both
// times silently, both times found by reading rather than by failing:
//
//   • RATE_OPTS gained the surplus rates in S198x on the client and not on the
//     server, so a gaining plan (weeklyRate -1) failed the membership test and
//     fell back to 1 lb/week of LOSS. The AI quoted a target 1,000 calories
//     below every screen, for precisely the clients whose plan is to eat more.
//   • nutritionTargets never read data.calorieTarget at all, so a coach's own
//     typed number — which beats the calculation everywhere in the app — was
//     invisible to the AI, the connector and coach_summary.
//
// Neither had a test. This is that test. It reads the client's constants out of
// the source text (there is no way to import from a 31k-line JSX bundle) and
// drives the server's real exported function.
//
// Run: node scripts/test-target-parity.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AITOOLS = readFileSync(join(ROOT, "functions", "aitools.js"), "utf8");
const { nutritionTargets } = require(join(ROOT, "functions", "aitools.js"));

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const parseRates = (src, label) => {
  const m = /const RATE_OPTS = \[([^\]]*)\]/.exec(src);
  if (!m) { ok(`${label} declares RATE_OPTS`, false); return null; }
  return m[1].split(",").map((v) => Number(v.trim())).sort((a, b) => a - b);
};

// ── the drift that shipped ──────────────────────────────────────────────────
{
  const client = parseRates(APP, "client");
  const server = parseRates(AITOOLS, "server");
  ok("client and server offer the SAME weekly rates",
     JSON.stringify(client) === JSON.stringify(server), { client, server });
  ok("...and that includes the surplus rates", client && client.includes(-1) && client.includes(-2), client);
}

// A complete, ordinary plan. 200 lb male, 5'10", 35, moderately active.
const base = {
  weightLbs: 200, gender: "male", heightFt: 5, heightIn: 10, age: 35,
  activityLevel: "moderate", deficitMode: "accelerate",
};

// ── a surplus must ADD calories, not subtract them ──────────────────────────
{
  const maintain = nutritionTargets({ ...base, weeklyRate: 0 }).calorieTarget;
  const gain1 = nutritionTargets({ ...base, weeklyRate: -1 }).calorieTarget;
  const lose1 = nutritionTargets({ ...base, weeklyRate: 1 }).calorieTarget;
  ok("maintenance sits between gaining and losing", gain1 > maintain && maintain > lose1,
     { gain1, maintain, lose1 });
  ok("gaining 1 lb/wk is maintenance + 500", gain1 - maintain === 500, { gain1, maintain });
  ok("losing 1 lb/wk is maintenance - 500", maintain - lose1 === 500, { maintain, lose1 });
  // The exact defect: before the fix, weeklyRate -1 fell back to +1 and returned
  // the LOSING number — a 1,000-cal error in the direction that matters most.
  ok("a surplus is not silently converted into a deficit", gain1 !== lose1, { gain1, lose1 });
  const gain2 = nutritionTargets({ ...base, weeklyRate: -2 }).calorieTarget;
  ok("gaining 2 lb/wk is maintenance + 1000", gain2 - maintain === 1000, { gain2, maintain });
}

// ── the manual override wins, exactly as it does on every screen ────────────
{
  const auto = nutritionTargets({ ...base, weeklyRate: 1 }).calorieTarget;
  const manual = nutritionTargets({ ...base, weeklyRate: 1, calorieTarget: 1900 });
  ok("a typed target beats the calculation", manual.calorieTarget === 1900, manual.calorieTarget);
  ok("...and is not merely the formula", auto !== 1900, auto);
  // Macros hang off the target, so they must follow it too — otherwise the AI
  // reports a protein/fat split that adds up to a different day's calories.
  ok("fat is derived from the OVERRIDDEN target",
     manual.fatTarget === Math.round((1900 * 0.28) / 9), manual.fatTarget);
  ok("carbs fill what is left of the OVERRIDDEN target",
     manual.carbsTarget === Math.max(0, Math.round((1900 - manual.proteinTarget * 4 - manual.fatTarget * 9) / 4)),
     manual.carbsTarget);
}
{
  // A typed target stands even on a plan too incomplete to compute one — which
  // is how the dashboard behaves, so the server must agree.
  const bare = nutritionTargets({ calorieTarget: 2100 });
  ok("a typed target survives an incomplete plan", bare.calorieTarget === 2100, bare);
  const nothing = nutritionTargets({});
  ok("...and an empty plan still yields null, not a guess", nothing.calorieTarget === null, nothing);
}
{
  // Zero and junk are NOT a target — the app screens these before trusting them.
  ok("a zero target does not override", nutritionTargets({ ...base, weeklyRate: 1, calorieTarget: 0 }).calorieTarget
     === nutritionTargets({ ...base, weeklyRate: 1 }).calorieTarget);
  ok("a blank target does not override", nutritionTargets({ ...base, weeklyRate: 1, calorieTarget: "" }).calorieTarget
     === nutritionTargets({ ...base, weeklyRate: 1 }).calorieTarget);
}

// ── the 1,200 floor is a shared promise ─────────────────────────────────────
{
  const tiny = nutritionTargets({ ...base, weightLbs: 100, weeklyRate: 2 });
  ok("the server floors at 1,200 like every client screen", tiny.calorieTarget >= 1200, tiny.calorieTarget);
}

// ── a planned goal weight is not a measurement, on either side ──────────────
{
  // Both copies of weightTrend must skip isFuturePlan entries. Checked in the
  // source, because the client's copy cannot be imported.
  ok("client weightTrend filters planned entries",
     /filter\(c => c\.weight && c\.timestamp && !c\.isFuturePlan\)/.test(APP));
  ok("server weightTrend filters planned entries",
     /filter\(\(c\) => c\.weight && c\.timestamp && !c\.isFuturePlan\)/.test(AITOOLS));
  // ...and the plan's CURRENT weight must not be dragged to a future goal.
  ok("syncWeightFromCheckIns refuses a planned entry",
     /if \(checkin\.isFuturePlan\) return next;/.test(APP));
  ok("...and excludes planned entries when picking the newest",
     /\(next\.checkIns \|\| \[\]\)\.filter\(\(c\) => c && c\.weight && !c\.isFuturePlan\)/.test(APP));
}

// ── admin is a UID, never a profile role (S199g/h) ──────────────────────────
// createProfile only ever writes "client" or "head_trainer", and index.js
// mirrors the admin role into the custom CLAIM alone — so `profile.role ===
// "admin"` is false for EVERY real document, the owner's included. Six gates
// were written against it and every one was dead code. The rule was already
// documented in aichat.js; a comment did not stop the next five, so it is
// pinned here instead.
{
  const files = ["functions/availability.js", "functions/aitools.js", "functions/mcp.js",
    "functions/aichat.js", "functions/transcribe.js", "functions/index.js", "functions/billing.js"];
  // Comments QUOTE the banned pattern while explaining it, so strip them first —
  // otherwise the assertion fails on its own documentation, which is the kind of
  // test that gets deleted rather than fixed.
  const stripComments = (t) => t.replace(/^\s*\/\/.*$/gm, "");
  const src = Object.fromEntries(files.map((f) => [f, stripComments(readFileSync(join(ROOT, f), "utf8"))]));
  // A dead admin GATE looks like `role === "admin"` used as the whole test.
  // `role === "head_trainer" || ... || role === "admin"` is a different thing —
  // an is-this-a-trainer check where the extra term is harmless — so it is
  // allowed, and only the standalone forms are banned.
  const deadGate = /(?:^|[^|&\s])\s*(?:if \(\s*)?(?:profile|me|ctx|d)\.role === "admin"/;
  for (const f of files) {
    ok(`${f} has no admin gate on a profile role`, !deadGate.test(src[f]),
       (src[f].match(deadGate) || [])[0]);
  }
  // ...and every file that gates on admin declares the same UID.
  for (const f of ["functions/availability.js", "functions/aitools.js", "functions/mcp.js",
                   "functions/aichat.js", "functions/transcribe.js", "functions/index.js"]) {
    ok(`${f} identifies admin by the shared UID`,
       /ADMIN_UIDS = \["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"\]/.test(src[f]));
  }
  // The four converted this round now take a uid and use it.
  ok("resolveTargetUid checks the caller's UID", /isAdminUid\(ctx\.callerUid\)/.test(src["functions/aitools.js"]));
  ok("seatCapFor takes a uid and the ctx path passes it",
     /function seatCapFor\(profile, uid\)/.test(src["functions/aitools.js"])
     && /seatCapFor\(prof, ctx\.callerUid\)/.test(src["functions/aitools.js"]));
  ok("planFor takes a uid and its caller passes it",
     /function planFor\(profile, uid\)/.test(src["functions/mcp.js"])
     && /planFor\(profile, ctx\.callerUid\)/.test(src["functions/mcp.js"]));
  ok("both trialExpiredFor copies take a uid",
     /function trialExpiredFor\(profile, uid\)/.test(src["functions/aichat.js"])
     && /function trialExpiredFor\(profile, uid\)/.test(src["functions/transcribe.js"]));
}

// ── the coach can see what the client changed (S199i) ───────────────────────
// describePlanChanges is the ONLY writer of the activity feed a coach reads, and
// it listed who the person IS while listing nothing about what they were told to
// EAT. A coached client retyping their daily target produced an empty feed and a
// dashboard quoting the new number as though the coach had set it.
//
// ⚠️ THIS IS EXECUTED, NOT PATTERN-MATCHED. The first version of this block
// asserted that the string "weeklyRate" appeared in the function body — and a
// mutation replacing the whole guard with `if (false)` left it green, because
// the field name still appeared inside the dead branch. That is precisely the
// mistake test-booking-slots.mjs was rewritten to stop making. So the real
// source text is lifted out of App.jsx and RUN. It is a pure function over two
// plain objects; its only free variable is RATE_LABEL, lifted with it.
{
  const rateSrc = /const RATE_LABEL = \{[\s\S]*?\};/.exec(APP);
  const fnSrc = /function describePlanChanges\(prev, next\) \{[\s\S]*?\n\}/.exec(APP);
  ok("describePlanChanges is liftable from App.jsx", !!rateSrc && !!fnSrc);
  const describe = new Function(`${rateSrc[0]}\n${fnSrc[0]}\nreturn describePlanChanges;`)();

  const plan = { weightLbs: 200, activityLevel: "moderate", weeklyRate: 1 };
  const one = (patch) => describe(plan, { ...plan, ...patch });

  ok("an unchanged plan writes nothing", describe(plan, { ...plan }).length === 0);
  // The six controls that set what the person eats. Each must produce a row.
  ok("changing the weekly pace is recorded", /pace/.test(one({ weeklyRate: 0.5 }).join(" ")), one({ weeklyRate: 0.5 }));
  ok("...naming the new pace in words, not a signed number",
     /Lose ½ lb\/week/.test(one({ weeklyRate: 0.5 }).join(" ")), one({ weeklyRate: 0.5 }));
  ok("...and a switch to gaining reads as gaining",
     /Gain 1 lb\/week/.test(one({ weeklyRate: -1 }).join(" ")), one({ weeklyRate: -1 }));
  ok("typing a daily calorie target is recorded",
     /1,900/.test(one({ calorieTarget: 1900 }).join(" ")), one({ calorieTarget: 1900 }));
  ok("...and dropping back to the calculated one is too",
     /calculated/.test(describe({ ...plan, calorieTarget: 1900 }, plan).join(" ")));
  ok("overwriting the macro split is recorded",
     /180p/.test(one({ macroTargets: { protein: 180, carbs: 200, fat: 70 } }).join(" ")));
  ok("changing the protein basis is recorded", one({ proteinPerLb: 1.2 }).length === 1, one({ proteinPerLb: 1.2 }));
  ok("switching the nutrition approach is recorded",
     /nutrition approach/.test(one({ deficitMode: "eatback" }).join(" ")), one({ deficitMode: "eatback" }));
  ok("toggling tracker-adjusted targets is recorded",
     /tracker/.test(one({ wearableAdjust: true }).join(" ")), one({ wearableAdjust: true }));

  // ⚠️ NO SPURIOUS ROWS. None of these six live in EMPTY_DATA, so they are
  // absent by default — and a diff that fired on absent-vs-absent would put a
  // fake edit in every coach's feed on every save.
  ok("absent fields do not fire against each other", describe({}, {}).length === 0, describe({}, {}));
  ok("...nor does an unrelated edit drag them in",
     describe(plan, { ...plan, goalWeight: 180 }).length === 1, describe(plan, { ...plan, goalWeight: 180 }));

  // The activity level was already recorded and must stay: it is the one input
  // S199 made coach-owned, so its edits matter most.
  // Clearing it is FILING it, not writing it — the client reads this feed.
  ok("filing the older note is not reported as writing one",
     /filed an older note away/.test(describe({ ...plan, trainerNotes: "x" }, plan).join(" ")),
     describe({ ...plan, trainerNotes: "x" }, plan));
  ok("...while an actual edit still says so",
     /updated trainer notes/.test(one({ trainerNotes: "new text" }).join(" ")), one({ trainerNotes: "new text" }));

  ok("the activity level is still recorded",
     /activity level/.test(one({ activityLevel: "light" }).join(" ")), one({ activityLevel: "light" }));
}

// ── a client manages their own account, same as a trainer (S199m, Kevin) ────
// The rule: "clients that want to should be able to manage themselves just like
// a trainer can." S199 had briefly gone the other way — the measured-burn card's
// Apply button was replaced by "Your coach can update this from your plan" for
// any client with a linked trainer, and the persisted Simple/Detailed default
// was settable ONLY by a trainer viewing the client, so the person whose plan it
// was could flip the view for a session and never make it stick.
//
// What makes the freedom safe is S199i, not a lock: every prescription change
// lands in the activity feed the coach reads. Accountability, not permission.
//
// ⚠️ ENUMERATED, for the reason the trainer-notes guard was: a gate on one
// control is not a policy. A NEW `role === ROLES.CLIENT` branch in App.jsx fails
// this and has to justify itself — because a restriction added anywhere else
// would be just as invisible as the two above were.
{
  ok("the activity-level lock is gone, not merely defaulted open",
     !/canEditActivity/.test(APP));
  ok("...and the plan owner can set their own default view",
     /onSetPlanViewDefault=\{\(v\)=>setDataAndSave/.test(APP));

  const ALLOWED = [
    // cosmetic: who wrote a feed entry
    /const histNameColor = \(role\) =>/,
    /\{ev\.role === ROLES\.CLIENT \? "client" : "trainer"\}/,
    /loggedBy: role === ROLES\.CLIENT \? "client" : "trainer"/,
    // the invite auto-link only applies to an unlinked client
    /if \(p && p\.role === ROLES\.CLIENT && !p\.assignedTrainerId && invite\)/,
    // the coach's own notes are not the client's to read (S199j/k) — the one
    // deliberate asymmetry, and it is about the COACH's content, not control
    /stripCoachNotes\(data, role === ROLES\.CLIENT && !!hasCoach\)/,
    // routing and copy, not capability
    /isTrainer=\{role !== ROLES\.CLIENT\}/,
    /if \(role === ROLES\.CLIENT\) \{/,
    /\(role === ROLES\.CLIENT \? "Home" : "Clients"\)/,
    // a DEFAULT, not a lock — the client can change it and now it sticks
    /defaultView=\{role === ROLES\.CLIENT \? \(data\.planViewDefault \|\| "simple"\) : "detailed"\}/,
    // COPY, not capability (S199l): picks the wording of the Start Over confirm
    // so a coached client's dialog can name their coach. resetWarning returns
    // only { title, body, confirmLabel } — BOTH branches proceed with the reset,
    // which is the whole point of that change ("persuasion, not permission").
    // Checked by reading the function, not by trusting the prop name.
    /hasCoach=\{role === ROLES\.CLIENT && meHasCoach\}/,
  ];
  const lines = APP.split("\n");
  const unknown = [];
  let inBlock = false;
  lines.forEach((ln, i) => {
    const wasInBlock = inBlock;
    const o = ln.lastIndexOf("/*"), c = ln.lastIndexOf("*/");
    if (o > c) inBlock = true; else if (c > o) inBlock = false;
    if (!ln.includes("ROLES.CLIENT")) return;
    if (wasInBlock || /^\s*(\/\/|\*|\/\*)/.test(ln)) return;
    if (ALLOWED.some((re) => re.test(ln))) return;
    unknown.push(`${i + 1}: ${ln.trim().slice(0, 90)}`);
  });
  ok("no client-only branch outside the known set — a new one must be justified "
     + "as cosmetic/routing, not as a restriction on managing their own account",
     unknown.length === 0, unknown);
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
