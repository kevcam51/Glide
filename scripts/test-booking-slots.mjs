// A multi-day booking ask must survive the server (S199).
//
// THE BUG THIS PINS. A client can ask across several days — "Mon, Wed or Fri,
// whichever suits" — and BOTH ends were built for it: the composer sends
// booking.slots, the trainer's inbox renders a "Book this" button per offered
// time, and respondToBookingRequest validates the trainer's chosen time against
// exactly that list so they cannot book an hour nobody offered.
//
// But sendTrainerRequest is the ONLY writer of a booking inbox item, and it
// rebuilt the object as { startAt, durationMin } — dropping slots on the floor.
// So slots was ALWAYS undefined in production: the per-slot buttons never
// rendered, the single Accept booked Monday, the request was marked done, and
// the client was pushed "it's on your calendar". Wednesday and Friday vanished
// with nobody told.
//
// ⚠️ AND THIS FILE USED TO TEST A COPY. Its first version transcribed the
// validation and asserted against the transcription, with a few substring
// regexes as the only link to the source. A mutation showed how weak that is:
// changing `slots.length > 1` to `> 99` in requests.js — which reintroduces
// exactly this bug, since askSlots never offers more than one time per weekday
// — left the suite at 23/23 green. buildBooking is now exported and driven
// directly, so the assertions below execute the shipping code.
//
// Run: node scripts/test-booking-slots.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const AVAIL = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");
const { buildBooking, MAX_ASK_SLOTS } = require(join(ROOT, "functions", "requests.js"));

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── the three ends of this feature must agree ───────────────────────────────
ok("the client SENDS slots", /booking: \{ startAt: slots\[0\], slots, durationMin/.test(APP));
ok("the trainer's inbox READS slots", /Array\.isArray\(r\.booking\.slots\)/.test(APP));
ok("the accept path VALIDATES against slots", /booking\.slots\.map\(Number\)/.test(AVAIL));
ok("a DECLINE names every offered time, not just the first",
   /None of the \$\{offered\.length\} times/.test(AVAIL));
ok("the slot cap is a named constant", MAX_ASK_SLOTS > 0, MAX_ASK_SLOTS);

const NOW = Date.parse("2026-09-10T12:00:00Z");
const day = (n) => NOW + n * 86400000;
const build = (b) => buildBooking(b, NOW);

// ── the headline case ───────────────────────────────────────────────────────
{
  const { booking: b, droppedSlots } = build({ startAt: day(1), slots: [day(1), day(3), day(5)], durationMin: 60 });
  ok("a three-day ask keeps all three", (b.slots || []).length === 3, b);
  ok("...and startAt is the earliest of them", b.startAt === day(1), b);
  ok("...so the old single-button path still books something real", (b.slots || []).includes(b.startAt), b);
  ok("...and nothing is reported dropped", droppedSlots === 0, droppedSlots);
}
{
  const { booking: b } = build({ startAt: day(2), slots: [day(2)], durationMin: 45 });
  ok("a single-slot ask carries no slots array", b.slots === undefined, b);
  ok("...and still books the right time", b.startAt === day(2) && b.durationMin === 45, b);
}
{
  const { booking: b } = build({ startAt: day(4), durationMin: 60 });
  ok("a request with no slots is unchanged", b.startAt === day(4) && b.slots === undefined, b);
}
{
  const { booking: b, droppedSlots } = build({ startAt: day(-3), slots: [day(-3), day(2), day(4)], durationMin: 60 });
  ok("a slot that has passed is dropped", (b.slots || []).length === 2, b);
  ok("...and startAt moves to the earliest SURVIVOR, never a dropped time", b.startAt === day(2), b);
  ok("...which the accept path would therefore accept", (b.slots || []).includes(b.startAt), b);
  // ⚠️ The drop must be REPORTED. Returning ok:true after discarding a time the
  // client still has on screen is the same silence this change is about: the
  // composer memoises its slot list and does not re-derive on a clock tick, so
  // a sheet open across 9:00 still reads "3 sessions".
  ok("...and the drop is counted so the client can be told", droppedSlots === 1, droppedSlots);
}
{
  // Down to one survivor: the slots array is omitted, so the count is the ONLY
  // way anyone could know two times were lost.
  const { booking: b, droppedSlots } = build({ startAt: day(-5), slots: [day(-5), day(-2), day(3)], durationMin: 60 });
  ok("two passed slots leave a single-time booking", b.slots === undefined && b.startAt === day(3), b);
  ok("...and both drops are counted", droppedSlots === 2, droppedSlots);
}
{
  let threw = null;
  try { build({ startAt: day(-5), slots: [day(-5), day(-2)], durationMin: 60 }); } catch (e) { threw = e.message; }
  ok("an ask where every time has passed is refused", /future/.test(threw || ""), threw);
}
{
  const many = Array.from({ length: 40 }, (_, i) => day(i + 1));
  const { booking: b, droppedSlots } = build({ startAt: many[0], slots: many, durationMin: 60 });
  ok("the slot list is capped", (b.slots || []).length === MAX_ASK_SLOTS, (b.slots || []).length);
  ok("...keeping the EARLIEST times, not an arbitrary window", (b.slots || [])[0] === day(1), (b.slots || [])[0]);
  ok("...and the excess is counted", droppedSlots === 40 - MAX_ASK_SLOTS, droppedSlots);
}
{
  const { booking: b } = build({ startAt: day(1), slots: [day(3), day(1), day(3), day(1)], durationMin: 60 });
  ok("duplicate times collapse", (b.slots || []).length === 2, b);
  ok("...and the list is sorted", (b.slots || [])[0] < (b.slots || [])[1], b);
}
{
  const { booking: b } = build({ startAt: day(1), slots: [day(1), "nonsense", null, NaN, day(2)], durationMin: 60 });
  ok("junk entries are skipped rather than thrown on", (b.slots || []).length === 2, b);
}
{
  const { booking: b, droppedSlots } = build({ startAt: day(1), slots: [day(1), day(400)], durationMin: 60 });
  ok("a slot beyond the horizon is dropped", b.slots === undefined && b.startAt === day(1), b);
  ok("...and counted", droppedSlots === 1, droppedSlots);
}
{
  let threw = null;
  try { build({ startAt: day(1), slots: [day(1)], durationMin: 900 }); } catch (e) { threw = e.message; }
  ok("an absurd duration is still refused", /sensible length/.test(threw || ""), threw);
}
// ⚠️ TWO BOUNDS, TWO MESSAGES. Folding them into one predicate once told a
// client that a date in 2027 was "not in the future" — wrong, and unactionable,
// because nothing on screen named the real limit.
{
  let far = null, past = null;
  try { build({ startAt: day(400), durationMin: 60 }); } catch (e) { far = e.message; }
  try { build({ startAt: day(-9), durationMin: 60 }); } catch (e) { past = e.message; }
  ok("a date over a year out says so", /year/.test(far || ""), far);
  ok("...and is NOT reported as 'not in the future'", !/future/.test(far || ""), far);
  ok("a past date still says pick a future time", /future/.test(past || ""), past);
}
{
  const { booking } = build(null);
  ok("a request with no booking half yields no booking", booking === null);
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
