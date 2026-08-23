#!/usr/bin/env node
// Is anything in production running OLD code? (S197q)
//
// Firebase deploys every function from the same source tree, but only the ones
// you NAME get the new code. Deploy a subset after changing a shared file and
// the rest keep running last week's copy — silently. Nothing errors. The
// function still works; it just works the way it used to.
//
// That has cost this project three times now (S78, S167, S168b), which is why
// `npm run deploy-set` exists. But deploy-set only helps if you remember to run
// it. This answers the question after the fact, against production:
//
//   for each deployed function, is its deploy time NEWER than the last commit
//   that touched any file it depends on?
//
// Usage: node scripts/check-stale-functions.mjs
// Needs the Firebase CLI to be logged in (it borrows its refresh token).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "functions");
const files = readdirSync(DIR).filter((f) => f.endsWith(".js"));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));

// ── the same dependency graph deploy-set.mjs computes ──────────────────────
const deps = {};
for (const f of files) {
  deps[f] = [...src[f].matchAll(/require\(["']\.\/([\w.-]+)["']\)/g)]
    .map((m) => (m[1].endsWith(".js") ? m[1] : `${m[1]}.js`))
    .filter((d) => files.includes(d));
}
const closure = (f, seen = new Set()) => {
  if (seen.has(f)) return seen;
  seen.add(f);
  for (const d of deps[f] || []) closure(d, seen);
  return seen;
};
const index = src["index.js"] || "";
const exported = [];
for (const m of index.matchAll(/^exports\.(\w+)\s*=\s*require\(["']\.\/([\w.-]+)["']\)/gm)) {
  exported.push({ name: m[1], module: m[2].endsWith(".js") ? m[2] : `${m[2]}.js` });
}
// ⚠️ MATCH EVERY TRIGGER FORM, NOT JUST THE CALLABLES. onCall/onRequest/
// onSchedule missed the two Firestore triggers defined inline
// (onDocumentWritten, onDocumentCreated), so syncRoleClaims and
// fenceNewAccountTrial were silently skipped — a checker with a blind spot in
// the exact place it is meant to look. deploy-set.mjs had the same gap.
for (const m of index.matchAll(/^exports\.(\w+)\s*=\s*(onCall|onRequest|onSchedule|onDocument\w+|onObject\w+|beforeUser\w+)\b/gm)) {
  // ⚠️ INLINE EXPORTS NEED A NARROWER RULE, or this cries wolf. A function
  // DEFINED in index.js is bundled with the whole source tree, so a naive
  // closure says every one of them is stale whenever any module changes — and
  // that is usually false: an older copy of a file the function never executes
  // changes nothing. Its real dependency is index.js itself. Anything beyond
  // that is the same weaker "shares the bundle" signal deploy-set.mjs already
  // reports separately, and a checker nobody trusts is a checker nobody runs.
  exported.push({ name: m[1], module: "index.js", inline: true });
}

// ── last commit time per file ───────────────────────────────────────────────
const lastCommit = {};
for (const f of files) {
  const out = execSync(`git log -1 --format=%ct -- functions/${f}`, { cwd: ROOT }).toString().trim();
  lastCommit[f] = out ? Number(out) * 1000 : 0;
}

// ⚠️ FOR AN INLINE EXPORT, "index.js CHANGED" IS NOT "THIS FUNCTION CHANGED".
// Nearly every commit to index.js just adds one more `exports.x = require(...)`
// line for a new function, which cannot affect the body of an old one. Using
// the file's timestamp reported five admin callables as running old code when
// none of them had been touched in months — a false alarm that would have sent
// someone redeploying, and taught them to distrust this script.
//
// git log -L follows a LINE RANGE through history, so ask when this function's
// own lines last changed.
const lastCommitForLines = (file, from, to) => {
  try {
    const out = execSync(
      `git log -1 --format=%ct -L ${from},${to}:functions/${file} 2>/dev/null`,
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString();
    const first = out.split("\n").find((l) => /^\d+$/.test(l.trim()));
    return first ? Number(first.trim()) * 1000 : 0;
  } catch { return lastCommit[file]; }   // unknown → fall back to the whole file
};
// Line span of each inline export: from its `exports.NAME =` to the line before
// the next top-level `exports.`.
const idxLines = index.split("\n");
const exportLineNos = [];
idxLines.forEach((l, i) => { if (/^exports\.\w+\s*=/.test(l)) exportLineNos.push(i + 1); });
const spanFor = (name) => {
  const i = idxLines.findIndex((l) => new RegExp(`^exports\\.${name}\\s*=`).test(l));
  if (i < 0) return null;
  const start = i + 1;
  const next = exportLineNos.find((n) => n > start);
  let end = next ? next - 1 : idxLines.length;
  // ⚠️ TRIM THE NEXT FUNCTION'S COMMENT HEADER. The gap before the following
  // `exports.` is usually a long block comment that belongs to THAT function,
  // and counting it made syncRoleClaims look 42 days stale when its nine lines
  // of code had never changed — the comment above its neighbour had. Walk back
  // over trailing blanks and comments so the span is this function's own code.
  while (end > start && /^\s*(\/\/|\/\*|\*|$)/.test(idxLines[end - 1] || "")) end--;
  return [start, end];
};

// ── production deploy times ─────────────────────────────────────────────────
const cfgPath = join(homedir(), ".config/configstore/firebase-tools.json");
if (!existsSync(cfgPath)) { console.error("No Firebase CLI credentials — run `firebase login`."); process.exit(2); }
const rt = JSON.parse(readFileSync(cfgPath, "utf8")).tokens?.refresh_token;
if (!rt) { console.error("No refresh token — run `firebase login --reauth --no-localhost`."); process.exit(2); }
const tokRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: rt, grant_type: "refresh_token",
  }),
});
if (!tokRes.ok) { console.error("Could not refresh the Google token — `firebase login --reauth --no-localhost`."); process.exit(2); }
const at = (await tokRes.json()).access_token;
const fnRes = await fetch(
  "https://cloudfunctions.googleapis.com/v2/projects/calorieiq-29762/locations/us-central1/functions?pageSize=200",
  { headers: { Authorization: `Bearer ${at}` } });
if (!fnRes.ok) { console.error("Cloud Functions API said", fnRes.status); process.exit(2); }
const live = Object.fromEntries(((await fnRes.json()).functions || [])
  .map((f) => [f.name.split("/").pop(), Date.parse(f.updateTime)]));

// ── the comparison ──────────────────────────────────────────────────────────
// A deploy takes a while, so a function deployed in the same minute as a commit
// is fine. Only a clear gap counts.
const GRACE_MS = 10 * 60 * 1000;
const stale = [], inlineSuspects = [];
for (const e of exported) {
  const deployedAt = live[e.name];
  if (!deployedAt) continue;                       // not deployed: a different problem
  let newest = 0, culprit = null;
  if (e.inline) {
    // ⚠️ INLINE EXPORTS GET A SOFTER ANSWER, ON PURPOSE.
    //
    // A function DEFINED in index.js has no module of its own, so there is no
    // exact "when did this function's code change". Two approximations were
    // tried and both cried wolf: the file's timestamp said five admin callables
    // were stale when nothing had touched them in months (index.js changes are
    // nearly always one added `exports.x = require(...)` line), and `git log -L`
    // on the function's own line span re-anchors imperfectly when a neighbour is
    // inserted above — it reported syncRoleClaims as 42 days behind, then 16
    // hours behind, when its nine lines have never changed at all.
    //
    // A checker that is wrong is worse than no checker, because people stop
    // reading it. So these are REPORTED, not FAILED — the same two-tier
    // language deploy-set.mjs already uses for them.
    const span = spanFor(e.name);
    const t = span ? lastCommitForLines("index.js", span[0], span[1]) : lastCommit["index.js"];
    if (t > deployedAt + GRACE_MS) {
      inlineSuspects.push({ name: e.name, behindMin: Math.round((t - deployedAt) / 60000) });
    }
    continue;
  }
  for (const s of [...closure(e.module)]) if (lastCommit[s] > newest) { newest = lastCommit[s]; culprit = s; }
  if (newest > deployedAt + GRACE_MS) {
    stale.push({ name: e.name, culprit, behindMin: Math.round((newest - deployedAt) / 60000) });
  }
}

const undeployed = exported.filter((e) => !live[e.name]).map((e) => e.name);
if (undeployed.length) {
  console.log(`\n⚠️  In code but NOT deployed (${undeployed.length}): ${undeployed.join(", ")}`);
}
const reportInline = () => {
  if (!inlineSuspects.length) return;
  console.log(`\nℹ  Defined inline in index.js and possibly behind (${inlineSuspects.length}) —`);
  console.log(`   index.js changed after these were deployed, but that is USUALLY just a new`);
  console.log(`   export line, which cannot affect them. Check the diff before redeploying:`);
  for (const i of inlineSuspects) console.log(`     ${i.name}`);
};
if (!stale.length) {
  console.log(`\n✓ All ${exported.length} functions are running current module code.`);
  reportInline();
  process.exit(undeployed.length ? 1 : 0);
}
console.log(`\n✗ ${stale.length} function(s) are running OLD code:\n`);
for (const s of stale.sort((a, b) => b.behindMin - a.behindMin)) {
  const d = s.behindMin >= 1440 ? `${(s.behindMin / 1440).toFixed(1)} days`
    : s.behindMin >= 60 ? `${(s.behindMin / 60).toFixed(1)} hours` : `${s.behindMin} min`;
  console.log(`  ${s.name.padEnd(26)} ${d} behind  (newest change: ${s.culprit})`);
}
reportInline();
console.log(`\nRedeploy them — and use \`npm run deploy-set <file>\` to get the full set,`);
console.log(`because a subset leaves the rest on the old copy, silently.`);
process.exit(1);
