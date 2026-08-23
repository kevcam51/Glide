// Every notification the server can send must have a decided destination.
//
// The bug this pins down (S197h): NotifFeed decided whether to draw "Open →"
// and App.notifDestination decided where it went — two functions answering one
// question, so they drifted. Seven of sixteen server tags reached nothing, and
// `session-no-card-*` (the "we could not charge your card" push) landed on the
// sessions list instead of the card sheet it was asking the person to open.
//
// This reads the REAL tags out of functions/*.js and the REAL router out of
// src/App.jsx, so adding a notification type without deciding where it goes
// fails here rather than in someone's hand.
//
// Run: node scripts/test-notif-routes.mjs
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0, checks = 0;
const ok = (name, cond, extra) => {
  checks++;
  if (!cond) { failures++; console.log("  FAIL:", name, extra !== undefined ? JSON.stringify(extra) : ""); }
};

// ── 1. harvest every tag literal the server pushes ──────────────────────────
const fnDir = join(ROOT, "functions");
const tags = new Set();
for (const f of readdirSync(fnDir).filter((n) => n.endsWith(".js"))) {
  const src = readFileSync(join(fnDir, f), "utf8");
  // tag: "literal"  |  tag: `prefix-${expr}`  → keep the static prefix
  for (const m of src.matchAll(/tag:\s*"([^"]+)"/g)) tags.add(m[1]);
  for (const m of src.matchAll(/tag:\s*`([^`]*)`/g)) {
    const lit = m[1].replace(/\$\{[^}]*\}/g, "X");   // a stand-in for the id
    tags.add(lit);
  }
}
ok("found the server's notification tags", tags.size >= 12, tags.size);

// ── 2. lift the REAL notifDestination out of App.jsx ────────────────────────
const app = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const start = app.indexOf("const notifDestination = (n) => {");
const end = app.indexOf("\n  };", start) + 5;
ok("extracted notifDestination", start > 0 && end > start);
const notifDestination = new Function(`${app.slice(start, end)}; return notifDestination;`)();

// ── 3. the destinations the app can actually act on ─────────────────────────
// Kept in step with ClientHome's intent effect + App's feed handler.
const HANDLED = new Set(["messages", "sessions", "card", "todos", "referrals", "weighIn", "food"]);

// Tags that legitimately open nothing, each with the reason. Anything NOT
// listed here and NOT routed is a bug, which is the point of this file.
const NO_DESTINATION = {
  workflow: "the automation result is entirely in the notification body — no screen shows more",
};

console.log("\n  TAG                                  DESTINATION");
console.log("  " + "-".repeat(62));
const unrouted = [];
for (const tag of [...tags].sort()) {
  const dest = notifDestination({ tag, url: "/" });
  const label = dest || (NO_DESTINATION[tag] ? "(none — by decision)" : "*** NOTHING ***");
  console.log(`  ${tag.padEnd(36)} ${label}`);
  if (!dest && !NO_DESTINATION[tag]) unrouted.push(tag);
  if (dest) ok(`${tag} routes somewhere the app handles`, HANDLED.has(dest), dest);
}
console.log();
ok("every server tag is routed or explicitly declared destination-less", unrouted.length === 0, unrouted);

// ── 4. the specific regressions ─────────────────────────────────────────────
ok("session-no-card-* reaches the CARD sheet, not the sessions list",
   notifDestination({ tag: "session-no-card-abc", url: "/" }) === "card");
ok("session-nocard-* (the other spelling) also reaches the card sheet",
   notifDestination({ tag: "session-nocard-abc", url: "/" }) === "card");
ok("a booking confirmation can reach the calendar it mentions",
   notifDestination({ tag: "booking-accepted-r1", url: "/" }) === "sessions");
ok("a declined booking goes there too, so they can ask again",
   notifDestination({ tag: "booking-declined-r1", url: "/" }) === "sessions");
ok("a weigh-in nudge opens the weigh-in input",
   notifDestination({ tag: "weighin-reminder", url: "/" }) === "weighIn");
ok("a coach confirming a meal opens where food is logged",
   notifDestination({ tag: "meal-review", url: "/" }) === "food");
ok("a plain session reminder still reaches sessions",
   notifDestination({ tag: "session-reminder-abc-60", url: "/" }) === "sessions");
ok("a DM still reaches messages", notifDestination({ tag: "dm-t1_c1", url: "/" }) === "messages");
ok("a card link still wins on the url", notifDestination({ tag: "whatever", url: "/?savecard=1" }) === "card");
// ── Routed is not the same as ARRIVING (the original bug) ──────────────────
// `notifDestination` returning "todos" was never the problem — the problem was
// that ClientHome handled "todos" by doing nothing, so the button moved nobody.
// A destination nobody handles is the same dead tap with extra steps, so read
// the handled set out of the code rather than trusting the mapping alone.
const handled = new Set();
for (const m of app.matchAll(/homeIntent\.kind === "([a-zA-Z]+)"/g)) handled.add(m[1]);
for (const m of app.matchAll(/dest === "([a-zA-Z]+)"/g)) handled.add(m[1]);  // App-level, not a panel
ok("found the destinations the client actually handles", handled.size >= 5, [...handled]);
const unhandled = [];
for (const tag of tags) {
  const dest = notifDestination({ tag, url: "/" });
  if (dest && !handled.has(dest)) unhandled.push(`${tag} → ${dest}`);
}
ok("EVERY destination is actually handled, not just mapped", unhandled.length === 0, unhandled);

ok("an unknown tag routes nowhere rather than guessing",
   notifDestination({ tag: "something-new", url: "/" }) === null);

// ── 5. NotifFeed must not decide this for itself again ──────────────────────
const feedStart = app.indexOf("const actionFor = (n) => {");
const feedSrc = app.slice(feedStart, app.indexOf("\n  };", feedStart));
ok("NotifFeed asks destinationFor instead of re-deriving the route",
   feedSrc.includes("destinationFor") && !feedSrc.includes("startsWith(\"session-\")"));
ok("NotifFeed draws no button when there is no destination", /if \(!dest\) return null/.test(feedSrc));

console.log(`  ${checks - failures}/${checks} assertions passed`);
process.exit(failures ? 1 : 0);
