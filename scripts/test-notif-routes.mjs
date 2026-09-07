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
// ⚠️ THE HARVESTER MISSED TWO (S200q). `tag: booking ? "booking-request" :
// "client-request"` has no literal in the `tag:` position, so neither tag was
// ever checked here — and they are the trainer's two most common pushes.
for (const f of readdirSync(fnDir).filter((n) => n.endsWith(".js"))) {
  const src = readFileSync(join(fnDir, f), "utf8");
  for (const m of src.matchAll(/tag:\s*[^,\n]*\?[^,\n]*"([^"]+)"\s*:\s*"([^"]+)"/g)) { tags.add(m[1]); tags.add(m[2]); }
}
ok("found the server's notification tags", tags.size >= 14, tags.size);
ok("...including the ones behind a ternary", tags.has("booking-request") && tags.has("client-request"));

// ── 2. lift the REAL notifDestination out of App.jsx ────────────────────────
const app = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const start = app.indexOf("function notifDestination(n) {");
const end = app.indexOf("\n}", start) + 2;
ok("extracted notifDestination", start > 0 && end > start);
const notifDestination = new Function(`${app.slice(start, end)}; return notifDestination;`)();
// ⚠️ ONE COPY, MODULE-LEVEL (S200q). It is now called by the in-app feed AND by
// a tapped push; two copies of this decision is exactly how the feed and the
// router drifted in S197h.
ok("it is module-level so both callers share it", /^function notifDestination\(n\) \{/m.test(app));

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
ok("a client's ASK reaches the trainer's inbox, not their calendar",
   notifDestination({ tag: "booking-request", url: "/" }) === "todos",
   notifDestination({ tag: "booking-request", url: "/" }));
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


// ── 4. a tapped push must reach the same screen (S200q) ────────────────────
// Kevin: nine pushes shipped url "/". Tapping one opened the app at "/" and
// nothing happened — sw.js sees the open client's url already equals the
// target, skips navigate(), and just focuses. The in-app FEED rows worked the
// whole time, because the feed routes by TAG; this was tap-a-push-only.
//
// ⚠️ AND SETTING THE URLS ALONE WAS INERT. The app had no URL→screen router for
// four of the six destinations, so /?sessions would have been parsed by nothing.
// The url carries the TAG and goes through the one router above.
{
  const files = readdirSync(fnDir).filter((n) => n.endsWith(".js"));
  const dead = [], unrouted = [], cardish = [];
  for (const f of files) {
    const src = readFileSync(join(fnDir, f), "utf8");
    for (const m of src.matchAll(/url:\s*"(\/[^"]*)"/g)) {
      const u = m[1];
      // workflows.js emits no tag at all, so notifDestination returns null by
      // design and there is nothing to route to. referrals uses ?reward=1,
      // which App handles separately.
      if (f === "workflows.js" || u.includes("reward=")) continue;
      if (u === "/") { dead.push(`${f}: ${u}`); continue; }
      const t = /[?&]notif=([^&"]*)/.exec(u);
      if (!t) continue;
      if (!notifDestination({ tag: t[1] })) unrouted.push(`${f}: ${u}`);
      // ⚠️ notifDestination checks the URL for these BEFORE any tag branch, so a
      // url containing either silently re-routes the in-app feed row too.
      if (/cardlink|savecard/.test(u) && notifDestination({ tag: t[1] }) !== "card") cardish.push(`${f}: ${u}`);
    }
  }
  ok("no push still lands on a bare /", dead.length === 0, dead);
  ok("every push url routes to a real screen", unrouted.length === 0, unrouted);
  ok("no url accidentally hijacks the feed's card check", cardish.length === 0, cardish);

  // The app side: stash at import, take unconditionally, route both roles.
  ok("the app stashes ?notif= at import, like the todo intent",
     /^stashNotifIntent\(\);$/m.test(app) && /function stashNotifIntent\(\)/.test(app));
  // ⚠️ Each take* CLEARS its stash, so one skipped by an early return stays in
  // localStorage and fires days later, out of nowhere.
  ok("every intent is taken before any of them can win",
     /const bootCard = takeSaveCardIntent\(\);\s*\n\s*const bootTodo = takeTodoIntent\(\);\s*\n\s*const bootNotif = takeNotifIntent\(\);/.test(app));
  ok("a client's push resolves through the shared router",
     /bootNotif \? notifDestination\(\{ tag: bootNotif \}\) : null/.test(app));
  // ⚠️ THE HALF THAT WAS MISSING ENTIRELY. homeIntent only reaches ClientHome,
  // and role is null at boot, so trainers need an effect.
  ok("a trainer's push is routed once the role is known",
     /if \(!role \|\| !bootNotifRef\.current\) return;/.test(app));
  ok("...to the same screens the in-app feed uses",
     (app.match(/setHomeTab\(dest === "sessions" \|\| dest === "card" \? "calendar" : "dashboard"\);/g) || []).length === 2);
  ok("...exactly once per launch", /bootNotifRef\.current = null;/.test(app));
}

console.log(`  ${checks - failures}/${checks} assertions passed`);
process.exit(failures ? 1 : 0);
