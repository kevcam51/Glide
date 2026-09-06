// The booking loop's privacy and money boundaries (S200).
//
// From an 11-agent audit of the whole loop. These are the four that could hurt
// somebody: a client reading another client's schedule, a client charged a rate
// they never agreed to, a client whose session controls silently did nothing,
// and a client told they had asked for times that were never sent.
//
// Run: node scripts/test-availability.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AV = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// ── a narrow probe must not undo the merge ──────────────────────────────────
// The ranges are merged so three back-to-back clients and one long block look
// identical from outside. But the TRUE endpoints were pushed and nothing bounds
// how narrow a window may be, so looping one-minute probes across a day
// recovered 09:00–10:00, 10:00–11:00, 11:00–12:00 out of a block that renders as
// a single 09:00–12:00 — every appointment's exact start and length, and
// therefore the trainer's client count.
{
  ok("session ranges are clipped to the requested window",
     /ranges\.push\(\{ start: Math\.max\(start, from\), end: Math\.min\(end, to\) \}\)/.test(AV));
  ok("...and so are blocks", (AV.match(/start: Math\.max\(start, from\), end: Math\.min\(end, to\)/g) || []).length === 2);

  // mergeRanges is what makes the clip sufficient: a clipped one-minute answer
  // merges back into the same block under a full scan, so probing gains nothing.
  const src = /function mergeRanges\(ranges\) \{[\s\S]*?\n\}/.exec(AV);
  ok("mergeRanges is liftable", !!src);
  const mergeRanges = new Function(`${src[0]}\nreturn mergeRanges;`)();
  const H = 3600000, t9 = Date.parse("2026-09-09T09:00:00Z");
  const three = [{ start: t9, end: t9 + H }, { start: t9 + H, end: t9 + 2 * H }, { start: t9 + 2 * H, end: t9 + 3 * H }];
  const merged = mergeRanges(three);
  ok("three back-to-back clients merge into ONE block", merged.length === 1, merged);
  ok("...spanning the whole morning", merged[0].start === t9 && merged[0].end === t9 + 3 * H, merged[0]);
  // The clip, applied: a one-minute window over the middle session yields a
  // one-minute range — "busy during this minute" — not 10:00-11:00.
  const from = t9 + H, to = from + 60000;
  const clipped = three.filter((r) => r.end > from && r.start < to)
    .map((r) => ({ start: Math.max(r.start, from), end: Math.min(r.end, to) }));
  ok("a one-minute probe can only learn about that minute",
     clipped.length === 1 && clipped[0].start === from && clipped[0].end === to, clipped);
  ok("...which reveals no appointment boundary", clipped[0].end - clipped[0].start === 60000);
}

// ── only the people who can actually book you ───────────────────────────────
// This walked one rung up the chain and returned true for the HEAD trainer above
// your coach, so at a gym with five sub-trainers all hundred of their clients
// could read the owner's calendar — people the owner may never have met and who
// cannot book them, since a booking only ever targets assignedTrainerId.
{
  const fn = /async function isMyTrainer\(db, clientProfile, trainerUid\) \{[\s\S]*?\n\}/.exec(AV);
  ok("isMyTrainer is liftable", !!fn);
  const isMyTrainer = new Function(`return ${fn[0].replace("async function", "async function")}`)();
  const run = async (profile, target) => isMyTrainer({ doc: () => ({ get: async () => ({ data: () => ({ headTrainerId: "HEAD" }) }) }) }, profile, target);
  ok("my own trainer: yes", await run({ assignedTrainerId: "T1" }, "T1"));
  ok("the head above my trainer: NO", !(await run({ assignedTrainerId: "T1" }, "HEAD")));
  ok("a stranger: no", !(await run({ assignedTrainerId: "T1" }, "T2")));
  ok("no trainer at all: no", !(await run({}, "T1")));
}

// ── the trainer's own training is time they are not free ────────────────────
{
  ok("free/busy no longer drops sessions the trainer RECEIVES",
     !/if \(s\.trainerUid !== trainerUid\) return;/.test(AV));
  ok("...and the accept-path overlap check sees both sides too",
     /tx\.get\(db\.collection\("sessions"\)\.where\("participants", "array-contains", uid\)\)/.test(AV));
}

// ── the rate they agreed to, not today's ────────────────────────────────────
// Both screens promise "you stay on the terms above until you agree to the new
// ones", and sessionConsentPolicy is the mirror of exactly that — but Accept
// priced from the trainer's LIVE rate, so raising it charged existing clients
// against terms they had been shown and never re-agreed.
{
  ok("accept prices from the client's CONSENTED rate",
     /const consented = Number\(\(client\.sessionConsentPolicy \|\| \{\}\)\.standardPriceCents\) \|\| 0;/.test(AV));
  ok("...falling back to the live rate only when nothing was ever promised",
     /consented > 0 \? consented : live/.test(AV));
  ok("...and a $0 booking is still refused outright", /reason: "no-standard-price"/.test(AV));
}

// ── the client is told what was actually sent ───────────────────────────────
{
  ok("the composer binds the server's reply", /const res = await callSendTrainerRequest\(\{/.test(APP));
  ok("...reads droppedSlots off it", /setDroppedCount\(Number\(\(res && res\.data && res\.data\.droppedSlots\) \|\| 0\)\)/.test(APP));
  ok("...and says so on the confirmation", /had already passed/.test(APP));
  // The prompt froze times client-side: it named every slot the client picked
  // while the buttons render only the survivors, and it was formatted in the
  // ASKER's zone, so a London client's trainer read 9:00 above a 4:00 button.
  ok("the prompt no longer freezes formatted times",
     /prompt: note\.trim\(\) \? note\.trim\(\) : `Can we train\? \(\$\{durMin\} min\)`/.test(APP));
  // One-of-several, which is what every other part of the loop implements.
  ok("the summary says OFFERING several, not asking for several sessions",
     /You&apos;re offering <b>\{slots\.length\}<\/b> times/.test(APP));
}

// ── a tap that does nothing is a bug ────────────────────────────────────────
{
  ok("the client's profile read is retried", /return loadTrainerInfo\(attempt \+ 1\);/.test(APP));
  ok("...and a final failure is remembered", /setProfileLoadFailed\(true\)/.test(APP));
  // S200e: this was a source regex on one of three JSX gates, and the gate it
  // did NOT cover — the button — was the broken one. The reachability contract
  // now lives in an executable predicate; test-sessions-gate.mjs runs it.
  ok("...so the panel says so instead of rendering nothing",
     /showSessions && sessionsPanelState\(trainerInfo, profileLoadFailed\)\.body === "error"/.test(APP));
  ok("...with a way out", /Try again/.test(APP));
}

// ── the trainer's inbox must not lose or silently ignore anything ──────────
{
  const RQ = readFileSync(join(ROOT, "functions", "requests.js"), "utf8");
  // A blind slice dropped the OLDEST item whatever its status, so a trainer who
  // never taps "Clear completed" silently lost an unanswered ask the moment the
  // list filled — after the client had been told it was sent.
  // EXECUTED, not matched: the first version of this asserted the lines existed,
  // and a mutation that broke the logic while leaving them in place stayed green.
  const { capInbox } = require(join(ROOT, "functions", "requests.js"));
  const mk = (i, st) => ({ id: `r${i}`, status: st });
  // ⚠️ THE OLD ASK MUST BE AT THE END, or a blind slice keeps it by accident and
  // the assertion proves nothing — which is exactly what the first fixture did.
  // The array is newest-first (`[item, ...arr]`), so the item at risk is last.
  const full = [mk(1, "done"), mk(2, "done"), mk(3, "done"), mk(4, "open")];
  const capped = capInbox(full, 3);
  ok("the oldest UNANSWERED ask survives when the list fills",
     capped.some((r) => r.id === "r4"), capped);
  ok("...and an answered one is what got dropped instead",
     capped.length === 3 && capped.filter((r) => r.status === "done").length === 2, capped);
  ok("under the cap nothing is touched", capInbox(full, 10).length === full.length);
  ok("an all-open inbox still caps rather than growing forever",
     capInbox([mk(1,"open"),mk(2,"open"),mk(3,"open")], 2).length === 2);
  ok("junk entries do not throw", capInbox([null, mk(1,"open"), undefined], 5).length === 1);

  // The inbox doc is written by the SERVER too, so replacing it wholesale from
  // React state deleted every ask that arrived while the page sat open.
  ok("the inbox is read-modify-written, not replaced from state",
     /const r = await window\.storage\.get\("caliq-inbox"\);/.test(APP));
  ok("...and callers pass a mutation, not an array",
     /const inboxDone = \(id\) => writeInbox\(\(arr\) =>/.test(APP)
     && /const inboxRemove = \(id\) => writeInbox\(\(arr\) =>/.test(APP));

  // answerBooking opens with `if (bookingBusy) return`, so a tap on ANOTHER row
  // while one was in flight did nothing at all — no disable, no spinner.
  ok("every answer button disables while any row is in flight",
     /disabled=\{!!bookingBusy \|\| !live\.length\}/.test(APP) && /disabled=\{!!bookingBusy\}/.test(APP));

  // Accept and decline are both server calls that REFUSE once a client unlinks,
  // so an ask from someone who left could never be cleared — and a trainer who
  // booked the time manually had to push "couldn't make it" about a session
  // that exists.
  // BOTH kinds of item need the exit — the loose form matched the pre-existing
  // one on ordinary to-dos and would have stayed green with the booking one gone.
  ok("both ordinary to-dos AND booking asks have a truthful exit",
     (APP.match(/onClick=\{\(\) => inboxRemove\(r\.id\)\}>Dismiss<\/button>/g) || []).length === 2,
     (APP.match(/inboxRemove\(r\.id\)\}>Dismiss/g) || []).length);
}

// ── notifications name an hour the reader recognises ───────────────────────
{
  ok("no booking notification is hard-coded to Eastern any more",
     !/timeZone: "America\/New_York"/.test(AV));
  ok("the client's confirmation uses the CLIENT's zone", /fmtWhen\(chosenStart, client\.tz/.test(AV));
  ok("the overlap refusal uses the TRAINER's", /fmtWhen\(clash\.st, trainer\.tz/.test(AV));
  ok("an unknown or absent zone falls back rather than throwing",
     /catch \(e\) \{ return DEFAULT_TZ; \}/.test(AV));
  ok("the browser stores its own zone for the server to use",
     /export async function ensureTimezone/.test(readFileSync(join(ROOT, "src", "profile.js"), "utf8")));
}

// ── a one-tap Accept keeps the drive check working ─────────────────────────
{
  ok("an accepted session inherits where this pair last trained",
     /title: "", location: lastLocationForClient,/.test(AV));
  ok("...from that client's own history", /where\("participants", "array-contains", clientUid\)/.test(AV));
  ok("...and only from sessions this trainer delivered", /if \(v\.trainerUid !== uid \|\| !v\.location\) return;/.test(AV));
}

// ── the form never opens in a state it immediately complains about ─────────
{
  ok("the default horizon is derived, not assumed", /function defaultAskHorizon\(days, startDate\)/.test(APP));
  ok("...and falls to next week when this week has already gone",
     /\.length \? "this" : "next"/.test(APP));
  ok("...and is used as the initial value", /useState\(\(\) => defaultAskHorizon\(/.test(APP));
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
