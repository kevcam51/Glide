// Smooth Training HQ — piece 1: the building and the org chart (S238, Kevin).
//
// Kevin: "Should we add it in the Glide app and make sure it's hidden so only
// me the admin can look at it?" So the promise this suite keeps is ONLY HIM:
//
//   • The ≡ menu row that opens the HQ renders only under `isAdminUid`, and the
//     screen itself only mounts under the same guard — a guard on the button
//     alone would leave `showHQ` able to mount it for anyone.
//   • App.jsx reaches HQ.jsx through lazy() and NEVER a static import, so no
//     other account downloads the file.
//   • The no-login preview route exists only in development.
//
// And the org chart it draws has to stay coherent as seats get filled: one
// head per department, every seat in a real room, and the two first hires
// named with what they're waiting on. The pixel art is run, not read — every
// rectangle of every room must land inside its canvas with a real number,
// because an SVG draws NaN as nothing and a missing desk is silent.
//
// Run: node scripts/test-hq.mjs
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { stripComments } from "./lib/strip-comments.mjs";
import {
  ROOMS, SEATS, FLOORS, CREW_RULES, BLUEPRINT,
  seatsIn, headOf, orgCounts, roomSummary, roomsOnFloor, liveSeats,
} from "../src/hqOrg.js";
import { W, H, roomScene, seatCenters, palmTree, van, PALM_W, PALM_H, VAN_W, VAN_H } from "../src/hqPixels.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = stripComments(readFileSync(join(ROOT, "src", "App.jsx"), "utf8"));
const MAIN = stripComments(readFileSync(join(ROOT, "src", "main.jsx"), "utf8"));
const HQ = readFileSync(join(ROOT, "src", "HQ.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };

// ── 1. Only the owner can open it ───────────────────────────────────────────
console.log("owner only");
{
  // The row: the ONE place setShowHQ(true) is called must sit inside an
  // `{isAdminUid && (` block that has not closed yet.
  const opens = [...APP.matchAll(/setShowHQ\(true\)/g)];
  ok(opens.length === 1, `exactly one control opens the HQ (found ${opens.length})`);
  if (opens.length === 1) {
    const before = APP.slice(0, opens[0].index);
    const guard = before.lastIndexOf("{isAdminUid && (");
    ok(guard !== -1 && opens[0].index - guard < 200, "the HQ menu row sits directly inside an {isAdminUid && ( guard");
    ok(guard !== -1 && !before.slice(guard).includes(")}"), "…and that guard is still open at the row (nothing closed it)");
  }

  // The mount: <HQScreen must render under isAdminUid too, not just showHQ.
  const mounts = [...APP.matchAll(/<HQScreen\b/g)];
  ok(mounts.length === 1, `HQScreen is mounted in exactly one place (found ${mounts.length})`);
  if (mounts.length === 1) {
    const before = APP.slice(0, mounts[0].index);
    const guard = before.lastIndexOf("{isAdminUid && showHQ && (");
    ok(guard !== -1 && mounts[0].index - guard < 160, "the HQ screen mounts only under {isAdminUid && showHQ && (");
  }

  // isAdminUid means the owner's uid and nothing else.
  ok(/isAdminUid=\{meUid === OWNER_UID\}/.test(APP), "SideMenu's isAdminUid is meUid === OWNER_UID");

  // Lazy, never static: a static import would put the HQ in every account's download.
  ok(/const HQScreen = lazy\(\(\) => import\("\.\/HQ\.jsx"\)\)/.test(APP), "App.jsx loads HQ.jsx with lazy(import())");
  ok(!/import\s+[^;]*from\s+["']\.\/HQ\.jsx["']/.test(APP), "App.jsx never imports HQ.jsx statically");
  ok(!/from\s+["']\.\/hqOrg\.js["']|from\s+["']\.\/hqPixels\.js["']/.test(APP), "App.jsx doesn't pull the HQ's data or art into the main bundle");

  // The no-login preview is development-only.
  ok(/const isHQPreview = import\.meta\.env\.DEV &&/.test(MAIN), "the /?hq-preview route is gated on import.meta.env.DEV");
  ok(/const HQPreview = import\.meta\.env\.DEV \? lazy\(/.test(MAIN), "the preview's import only exists in development builds");
}

// ── 2. No business data ships in the HQ bundle ──────────────────────────────
console.log("structure only");
{
  const code = stripComments(HQ) + JSON.stringify({ ROOMS, SEATS, CREW_RULES, BLUEPRINT });
  ok(!/\$\s?\d[\d,]*\.\d\d/.test(code), "no dollar figures anywhere in the HQ's code or org data");
  ok(!/@[a-z0-9-]+\.(com|net|org)/i.test(code), "no email addresses in the HQ's code or org data");
  // Piece 2: the desk is live, and it reads through ONE door — the hqApi
  // callable, which checks the owner's uid on the server. No direct Firestore,
  // no kv reads, no second callable that might forget the check.
  const hqCode = stripComments(HQ);
  ok(/const callHq = httpsCallable\(functions, "hqApi"\)/.test(hqCode), "the HQ reads its desk through the hqApi callable");
  ok((hqCode.match(/httpsCallable\(/g) || []).length === 1, "…and through no other callable");
  ok(!/from "firebase\/firestore"|getForUser|window\.storage|onSnapshot/.test(hqCode), "the HQ never reads Firestore or kv directly");
}

// ── 2b. The desk's controls do what they say ────────────────────────────────
console.log("desk controls");
{
  const hqCode = stripComments(HQ);
  ok(/onClick=\{\(\) => onStatus\(item, "done"\)\}>Mark done</.test(hqCode), "Mark done files the item as done");
  ok(/onClick=\{\(\) => onStatus\(item, "dismissed"\)\}>Dismiss</.test(hqCode), "Dismiss files the item as dismissed");
  ok(/onClick=\{\(\) => setStatus\(item, "open"\)\}[\s\S]{0,120}>Undo</.test(hqCode), "Undo puts a handled item back on the desk");
  ok(/await callHq\(\{ action: "resolve", id: item\.id, status \}\)/.test(hqCode), "a status change is saved through the resolve action");
  ok(/setDesk\(before\)/.test(hqCode), "a refused save puts the item back where it was");
  // The station's "Your desk" number and the side panel's big number both
  // count the open items — two places, so both are counted (check:weak's rule).
  const flat = hqCode.replace(/\s+/g, " ");
  ok(/<span>Your desk<\/span><b>\{deskKnown \? desk\.open\.length : "–"\}<\/b>/.test(flat),
    "the station's \"Your desk\" number is the real count of open items");
  ok(/<b>\{deskKnown \? desk\.open\.length : "–"\}<\/b><span>waiting on you<\/span>/.test(flat),
    "…and so is the side panel's");
  ok(!/<b>0<\/b>/.test(flat), "…neither is a hardcoded zero");
  // The station is part of the HQ's lazy chunk too, never the main bundle.
  ok(/import HQStation from "\.\/HQStation\.jsx";/.test(hqCode), "the station map is loaded by the HQ screen");
  ok(!/HQStation|hqStation/.test(APP), "App.jsx never pulls the station map into the main bundle");
  // The painted art (S238) rides the same lazy chunk: only the station map
  // imports it, so no other account ever downloads a pixel of it.
  const srcFiles = readdirSync(join(ROOT, "src")).filter((f) => /\.(jsx?|mjs)$/.test(f));
  const artUsers = srcFiles.filter((f) => /hq-art\//.test(stripComments(readFileSync(join(ROOT, "src", f), "utf8"))));
  ok(artUsers.length === 1 && artUsers[0] === "HQStation.jsx", `only the station map loads the HQ's art (found in: ${artUsers.join(", ")})`);
  ok(/import HQSpend, \{ SPEND_CSS, money \} from "\.\/HQSpend\.jsx";/.test(hqCode), "the spending sheet is part of the HQ screen");
  ok(!/HQSpend/.test(APP), "App.jsx never pulls the spending sheet into the main bundle");
  // A callable's error message IS its code ("internal", "not-found"), so it is
  // never shown raw (S202's lesson).
  ok(/setDeskErr\(deskError\(e\)\)/.test(hqCode) && !/setDeskErr\(e\.message\)|setDeskErr\(String\(e/.test(hqCode),
    "desk errors are translated into plain words, never the raw error");
  // Example items live in a dev-only file that the shipped app never imports.
  // Comment-stripped: HQ.jsx's own comment NAMES the file while explaining it,
  // and an assertion that fails on its own documentation gets deleted, not fixed.
  ok(!/hqSamples/.test(stripComments(HQ)) && !/hqSamples/.test(APP), "HQ.jsx and App.jsx never import the example items");
  const devBlock = MAIN.slice(MAIN.indexOf("const HQPreview"), MAIN.indexOf("const HQPreview") + 400);
  ok(/import\.meta\.env\.DEV \? lazy\(/.test(devBlock) && /import\('\.\/hqSamples\.js'\)/.test(devBlock),
    "main.jsx loads the example items only inside the dev-only preview");
  ok((MAIN.match(/hqSamples/g) || []).length === 1, "…and nowhere else");
}

// ── 3. The org chart holds together ─────────────────────────────────────────
console.log("org chart");
{
  const ids = SEATS.map((s) => s.id);
  ok(new Set(ids).size === ids.length, "every seat id is unique");
  const roomIds = new Set(ROOMS.map((r) => r.id));
  ok(SEATS.every((s) => roomIds.has(s.room)), "every seat sits in a room that exists");
  ok(ROOMS.every((r) => seatsIn(r.id).length > 0), "every room has at least one seat");
  ok(SEATS.every((s) => ["owner", "head", "worker"].includes(s.role)), "roles are owner, head or worker");
  ok(SEATS.every((s) => ["you", "training", "open"].includes(s.status)), "statuses are you, training or open");
  ok(SEATS.every((s) => s.title && s.short && s.job), "every seat has a title, a name tag and a job description");
  ok(SEATS.every((s) => s.short.length <= 10), "every name tag fits a quarter of a phone-width room (≤ 10 characters)");

  const owners = SEATS.filter((s) => s.role === "owner");
  ok(owners.length === 1 && owners[0].status === "you" && owners[0].room === "owner", "one owner seat, Kevin's, in Your Office");
  for (const r of ROOMS.filter((r) => r.id !== "owner")) {
    const heads = seatsIn(r.id).filter((s) => s.role === "head");
    ok(heads.length === 1, `${r.name} has exactly one department head (found ${heads.length})`);
    ok(headOf(r.id) === heads[0], `headOf(${r.id}) returns that head`);
  }

  const training = SEATS.filter((s) => s.status === "training");
  ok(training.map((s) => s.id).sort().join() === "bookkeeper,front-desk", "the two first hires are the Bookkeeper and the Front Desk Coordinator");
  ok(training.every((s) => s.firstHire && s.waitingOn), "each first hire says what it's waiting on");
  ok(training.every((s) => s.role === "worker"), "first hires are workers, not heads");

  const c = orgCounts();
  ok(c.total === SEATS.length && c.you + c.training + c.open === c.total, "orgCounts adds up to every seat");
  ok(roomSummary("finance") === "1 in training · 2 open", `Finance reads "1 in training · 2 open" (got "${roomSummary("finance")}")`);
  ok(roomSummary("owner") === "You", `Your Office reads "You" (got "${roomSummary("owner")}")`);

  ok(FLOORS.every((f) => roomsOnFloor(f).length === 2), "every floor holds two rooms");
  ok(ROOMS.every((r) => FLOORS.includes(r.floor)), "every room is on a real floor");
  ok(ROOMS.every((r) => r.uses && r.tagline), "every room says how Kevin will use it");

  const statuses = BLUEPRINT.map((b) => b.status);
  ok(statuses[0] === "built" && statuses.filter((s) => s === "next").length === 1, "the plan has piece 1 built and exactly one piece next");
  ok(CREW_RULES.some((r) => /never sends/i.test(r.title)) && CREW_RULES.some((r) => /money/i.test(r.title)),
    "the crew rules include drafts-only and never-moves-money");
}

// ── 4. The pixel art lands inside its canvas ────────────────────────────────
// ── The crew as it really is ─────────────────────────────────────────────────
// The chart says where each seat STARTS; real events move it. Run, not read.
console.log("live seats");
{
  const same = liveSeats(SEATS, {});
  ok(same.every((s, i) => s.status === SEATS[i].status), "with nothing happening, every seat keeps its chart status");
  const moved = liveSeats(SEATS, {
    shifts: [{ worker: "bookkeeper" }], active: [{ worker: "front-desk" }], open: [{ worker: "progress-analyst" }],
    recent: [{ worker: "content-creator" }],
  });
  const st = (id) => moved.find((s) => s.id === id).status;
  ok(st("front-desk") === "on-shift", "a worker clocked in right now is on shift");
  ok(st("bookkeeper") === "working", "a worker that has logged a shift is working");
  ok(st("progress-analyst") === "working", "…so is one whose work is waiting on the desk");
  ok(st("content-creator") === "working", "…or whose work the owner has already handled");
  ok(st("owner") === "you", "the owner's seat never changes");
  ok(st("scheduling") === "open", "a seat nobody has touched stays open");
  const both = liveSeats(SEATS, { shifts: [{ worker: "bookkeeper" }], active: [{ worker: "bookkeeper" }] });
  ok(both.find((s) => s.id === "bookkeeper").status === "on-shift", "on shift wins over working");
  ok(liveSeats(SEATS, { active: [{ worker: "owner" }] }).find((s) => s.id === "owner").status === "you",
    "…and not even a clock-in can move the owner");
  const counts = orgCounts(moved);
  ok(counts.onShift === 1 && counts.working === 3 && counts.training === 0, `the counts follow (${JSON.stringify(counts)})`);
  ok(roomSummary("front", moved) === "1 on shift · 3 open", `a room's line says who is on shift (${roomSummary("front", moved)})`);
  ok(roomSummary("finance", moved) === "1 working · 2 open", `…and who is working (${roomSummary("finance", moved)})`);
  ok(roomSummary("finance") === "1 in training · 2 open", "the chart's own line is unchanged without live data");

  const hqCode = stripComments(HQ);
  // The screen wires it: live seats feed every count and the map, a poll
  // looks again every minute while the page is visible, and deliveries go to
  // the map and come back marked.
  ok(/const live = liveSeats\(SEATS, desk\);/.test(hqCode), "the HQ screen works from live seats");
  ok(/<HQStation seats=\{seats\}/.test(hqCode), "…and hands them to the map");
  ok(/deliveries=\{toDeliver\} onDelivered=\{markDelivered\} deskCount=\{desk\.open\.length\}/.test(hqCode),
    "the map gets what to deliver, tells the screen when it's delivered, and knows how full the desk is");
  ok(/document\.visibilityState === "visible"\) load\(\{ quiet: true \}\)/.test(hqCode), "the minute poll runs only while the HQ is on screen, and quietly");
  ok(/const POLL_MS = 60000;/.test(hqCode), "…once a minute");
  ok(/\.slice\(-DELIVERED_CAP\)/.test(hqCode) && /const DELIVERED_CAP = 300;/.test(hqCode), "the delivered list on this device is capped");
}

console.log("pixel art");
{
  const inBounds = (rects, w, h) => rects.every(([x, y, rw, rh, fill]) =>
    [x, y, rw, rh].every(Number.isFinite) && rw > 0 && rh > 0
    && x >= 0 && y >= 0 && x + rw <= w && y + rh <= h && typeof fill === "string" && fill.length > 0);
  for (const r of ROOMS) {
    const seats = seatsIn(r.id);
    const lit = seats.some((s) => s.status !== "open");
    const rects = roomScene(r.id, seats, { lit, boardLights: ["training", "open", "open", "open", "training", "open"] });
    ok(rects.length > 20, `${r.id}: the room draws something (${rects.length} rectangles)`);
    ok(inBounds(rects, W, H), `${r.id}: every rectangle is a real number inside the ${W}×${H} canvas`);
    const xs = seatCenters(r.id, seats.length);
    ok(xs.length === seats.length, `${r.id}: every seat has a position (${xs.length} of ${seats.length})`);
    // Half a desk: the owner's is 26 wide, a head's 20, a worker's 18.
    const half = (s) => (s.role === "owner" ? 13 : s.role === "head" ? 10 : 9);
    ok(xs.every((x, i) => x - half(seats[i]) >= 0 && x + half(seats[i]) <= W), `${r.id}: every desk fits inside the room`);
    ok(xs.every((x, i) => i === 0 || x - xs[i - 1] >= 18), `${r.id}: desks don't overlap each other`);
  }
  // A worker in training draws a person; an open seat draws only furniture.
  const withBookkeeper = roomScene("finance", seatsIn("finance"));
  const emptyFinance = roomScene("finance", seatsIn("finance").map((s) => ({ ...s, status: "open" })));
  ok(withBookkeeper.length > emptyFinance.length, "a worker in training adds a person to the room");
  ok(roomScene("ops", seatsIn("ops"), { lit: false }).some(([, , w, h, fill]) => w === W && h === H && /rgba/.test(fill)),
    "a room with nobody hired draws with the lights off");
  ok(inBounds(palmTree(), PALM_W, PALM_H), "the palm tree stays inside its canvas");
  ok(inBounds(van(), VAN_W, VAN_H), "the van stays inside its canvas");
}

console.log(`\n${checks - fails}/${checks} HQ checks passed`);
if (fails) process.exit(1);
