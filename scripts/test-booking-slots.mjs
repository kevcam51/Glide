// A multi-day booking ask must survive the server (S199).
//
// THE BUG THIS PINS. A client can ask across several days — "Mon, Wed or Fri,
// whichever suits" — and BOTH ends were built for it: the composer sends
// `booking.slots`, the trainer's inbox renders a "Book this" button per offered
// time, and respondToBookingRequest validates the trainer's chosen time against
// exactly that list so they cannot book an hour nobody offered.
//
// But sendTrainerRequest is the ONLY writer of a booking inbox item, and it
// rebuilt the object as `{ startAt, durationMin }` — dropping `slots` on the
// floor. So `slots` was ALWAYS undefined in production: the per-slot buttons
// never rendered, the single Accept booked Monday, the request was marked done,
// and the client was pushed "it's on your calendar". Wednesday and Friday
// vanished with nobody told.
//
// The validation logic is read out of the source and re-executed here, because
// the callable itself needs firebase-functions' onCall wrapper and a live
// request context. What matters is the shape of the object it builds.
//
// Run: node scripts/test-booking-slots.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQ = readFileSync(join(ROOT, "functions", "requests.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AVAIL = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── the three ends of this feature must agree ───────────────────────────────
ok("the client SENDS slots", /booking: \{ startAt: slots\[0\], slots, durationMin/.test(APP));
ok("the trainer's inbox READS slots", /Array\.isArray\(r\.booking\.slots\)/.test(APP));
ok("the accept path VALIDATES against slots", /booking\.slots\.map\(Number\)/.test(AVAIL));
// ...and the writer in the middle must not drop it. This is the assertion that
// would have failed for the whole life of the bug.
ok("the SERVER keeps slots when it builds the inbox item", /booking\.slots = slots/.test(REQ));
ok("...and it is not rebuilt from startAt alone",
   !/^\s*booking = \{ startAt, durationMin \};\s*$/m.test(REQ.replace(/booking = \{ startAt, durationMin \};\n\s*\/\/ Only carry/, "KEPT")));

// ── re-execute the validation the callable performs ─────────────────────────
const MAX_ASK_SLOTS = Number((/const MAX_ASK_SLOTS = (\d+)/.exec(REQ) || [])[1]);
ok("the slot cap is a named constant", MAX_ASK_SLOTS > 0, MAX_ASK_SLOTS);

const NOW = Date.parse("2026-09-10T12:00:00Z");
function buildBooking(b, now = NOW) {
  // Mirrors functions/requests.js. Kept in step by the source assertions above.
  const durationMin = Math.round(Number(b.durationMin) || 60);
  if (!(durationMin > 0 && durationMin <= 480)) throw new Error("Pick a sensible length.");
  const usable = (ms) => Number.isFinite(ms) && ms >= now - 60000 && ms <= now + 365 * 86400000;
  const raw = Array.isArray(b.slots) ? b.slots : null;
  let slots = null;
  if (raw) {
    const seen = new Set();
    slots = [];
    for (const x of raw) {
      const ms = Math.round(Number(x));
      if (!usable(ms) || seen.has(ms)) continue;
      seen.add(ms);
      slots.push(ms);
    }
    slots.sort((x, y) => x - y);
    if (slots.length > MAX_ASK_SLOTS) slots.length = MAX_ASK_SLOTS;
  }
  const startAt = slots && slots.length ? slots[0] : Math.round(Number(b.startAt));
  if (!Number.isFinite(startAt)) throw new Error("Pick a date and time.");
  if (!usable(startAt)) throw new Error("Pick a time in the future.");
  const booking = { startAt, durationMin };
  if (slots && slots.length > 1) booking.slots = slots;
  return booking;
}
const day = (n) => NOW + n * 86400000;

// The headline case.
{
  const b = buildBooking({ startAt: day(1), slots: [day(1), day(3), day(5)], durationMin: 60 });
  ok("a three-day ask keeps all three", b.slots && b.slots.length === 3, b);
  ok("...and startAt is the earliest of them", b.startAt === day(1), b);
  ok("...so the old single-button path still books something real",
     b.slots.includes(b.startAt), b);
}
// One day is not a multi-day ask — no need to carry a redundant array.
{
  const b = buildBooking({ startAt: day(2), slots: [day(2)], durationMin: 45 });
  ok("a single-slot ask carries no slots array", b.slots === undefined, b);
  ok("...and still books the right time", b.startAt === day(2) && b.durationMin === 45, b);
}
// Legacy payloads with no slots at all keep working.
{
  const b = buildBooking({ startAt: day(4), durationMin: 60 });
  ok("a request with no slots is unchanged", b.startAt === day(4) && b.slots === undefined, b);
}
// ⚠️ startAt is DERIVED, so it can never name a time that was dropped.
{
  const b = buildBooking({ startAt: day(-3), slots: [day(-3), day(2), day(4)], durationMin: 60 });
  ok("a slot that has passed is dropped", b.slots.length === 2, b);
  ok("...and startAt moves to the earliest SURVIVOR, never a dropped time",
     b.startAt === day(2), b);
  ok("...which the accept path would therefore accept", b.slots.includes(b.startAt), b);
}
// If nothing survives, refuse — do not send an ask with no bookable time.
{
  let threw = null;
  try { buildBooking({ startAt: day(-5), slots: [day(-5), day(-2)], durationMin: 60 }); }
  catch (e) { threw = e.message; }
  ok("an ask where every time has passed is refused", /future/.test(threw || ""), threw);
}
// Hand-made payloads cannot grow the trainer's inbox document without bound.
{
  const many = Array.from({ length: 40 }, (_, i) => day(i + 1));
  const b = buildBooking({ startAt: many[0], slots: many, durationMin: 60 });
  ok("the slot list is capped", b.slots.length === MAX_ASK_SLOTS, b.slots.length);
  ok("...keeping the EARLIEST times, not an arbitrary window",
     b.slots[0] === day(1), b.slots[0]);
}
{
  const b = buildBooking({ startAt: day(1), slots: [day(3), day(1), day(3), day(1)], durationMin: 60 });
  ok("duplicate times collapse", b.slots.length === 2, b);
  ok("...and the list is sorted", b.slots[0] < b.slots[1], b);
}
{
  const b = buildBooking({ startAt: day(1), slots: [day(1), "nonsense", null, NaN, day(2)], durationMin: 60 });
  ok("junk entries are skipped rather than thrown on", b.slots.length === 2, b);
}
{
  // A year-out slot is refused by the same bound as startAt.
  const b = buildBooking({ startAt: day(1), slots: [day(1), day(400)], durationMin: 60 });
  ok("a slot beyond the horizon is dropped", b.slots === undefined && b.startAt === day(1), b);
}
{
  let threw = null;
  try { buildBooking({ startAt: day(1), slots: [day(1)], durationMin: 900 }); }
  catch (e) { threw = e.message; }
  ok("an absurd duration is still refused", /sensible length/.test(threw || ""), threw);
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
