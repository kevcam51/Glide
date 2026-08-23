#!/usr/bin/env node
// Which Cloud Functions must be redeployed when a shared file changes?
//
// Firebase deploys each function from the same source tree, but only the ones
// you NAME get the new code. So editing a file that several functions share and
// deploying a subset leaves the rest running the old copy of it — silently. It
// looks like nothing is wrong: the un-deployed function still works, it just
// works the way it did last week.
//
// That has now cost us twice. S78: aitools.js changed, only aiChat and
// aiChatStream were deployed, and setWorkoutSchedule kept dropping the custom
// exercise id on Accept while reporting success. S167: the same file changed
// and the two Accept-card writers were left behind again.
//
// Rather than remember the list, compute it:
//   npm run deploy-set aitools.js
//
// Usage: node scripts/deploy-set.mjs <file…>   (paths relative to functions/)
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const DIR = new URL("../functions/", import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => f.endsWith(".js"));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));

// Direct local requires per module: require("./x") -> x.js
const deps = {};
for (const f of files) {
  deps[f] = [...src[f].matchAll(/require\(["']\.\/([\w.-]+)["']\)/g)]
    .map((m) => (m[1].endsWith(".js") ? m[1] : `${m[1]}.js`))
    .filter((d) => files.includes(d));
}
// Transitive closure, cycle-safe.
const reaches = (from, target, seen = new Set()) => {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (deps[from] || []).some((d) => reaches(d, target, seen));
};

// Every exported function, and the module that defines it.
const index = src["index.js"] || "";
const exported = [];
for (const m of index.matchAll(/^exports\.(\w+)\s*=\s*require\(["']\.\/([\w.-]+)["']\)/gm)) {
  exported.push({ name: m[1], module: m[2].endsWith(".js") ? m[2] : `${m[2]}.js` });
}
// …plus the ones index.js defines inline (a trigger declared right there).
// ⚠️ ALL trigger forms, not just the callables: this used to match only
// onCall/onRequest/onSchedule and so never mentioned syncRoleClaims or
// fenceNewAccountTrial (onDocumentWritten / onDocumentCreated), which is a
// blind spot in the one tool that exists to stop silent staleness.
for (const m of index.matchAll(/^exports\.(\w+)\s*=\s*(onCall|onRequest|onSchedule|onDocument\w+|onObject\w+|beforeUser\w+)\b/gm)) {
  exported.push({ name: m[1], module: "index.js", inline: true });
}

const targets = process.argv.slice(2).map((a) => {
  const b = basename(a);
  return b.endsWith(".js") ? b : `${b}.js`;
});
if (!targets.length) {
  console.error("usage: node scripts/deploy-set.mjs <file…>   e.g. aitools.js");
  process.exit(1);
}
for (const t of targets) {
  if (!files.includes(t)) { console.error(`! functions/${t} not found`); process.exit(1); }
}

const hit = exported.filter((e) => targets.some((t) => reaches(e.module, t)));
// An inline index.js export only *reaches* the target through some other
// module's requires, so it is a weaker signal than a direct re-export — call it
// out rather than hiding it in the same list.
const direct = hit.filter((e) => !e.inline);
const inline = hit.filter((e) => e.inline);

console.log(`\nChanged: ${targets.join(", ")}`);
console.log(`\nMust redeploy (${direct.length}):`);
console.log(direct.map((e) => `  ${e.name.padEnd(24)} ← ${e.module}`).join("\n") || "  (none)");
if (inline.length) {
  console.log(`\nDefined in index.js and share the bundle — redeploy if they use it (${inline.length}):`);
  console.log(inline.map((e) => `  ${e.name}`).join("\n"));
}
console.log(`\n  firebase deploy --only ${direct.map((e) => `functions:${e.name}`).join(",")} --project calorieiq-29762\n`);
