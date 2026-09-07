// "On my way" + ETA (S201) — the rules, executed rather than pattern-matched.
//
// WHAT THIS FEATURE PROMISES, and therefore what has to stay true:
//
//   1. THE POSITION IS NEVER STORED. One GPS fix goes up, an ETA comes back,
//      and the coordinates die in the callable. Nothing writes a lat/lng to
//      Firestore, to `drivecache`, or to a log line. This is the whole reason
//      Kevin agreed to the feature at all, so it is asserted three ways.
//   2. A GPS ORIGIN NEVER GOES THROUGH A GEOCODER. `estimateDrive` geocodes
//      BOTH ends; handing it "25.76,-80.19" would hit the S199u/v precision
//      guard, which refuses an APPROXIMATE or `partial_match` hit — so a pin we
//      already hold to the metre would come back as a neighbourhood centroid or
//      be refused outright. `estimateDriveFrom` exists for this and geocodes
//      only the destination.
//   3. THE TWO SIDES AGREE ON WHEN IT MAY BE SAID. The server refuses outside
//      its window and the client hides the button on the same bound; a drift in
//      either direction is a button that throws or a button that hides when it
//      should work.
//   4. A DENIED LOCATION PROMPT IS NOT A FAILED TAP. The other person is still
//      told; only the number is missing.
//
// Every predicate below is LIFTED FROM THE SHIPPING SOURCE and run. A regex
// against the source passes just as happily against `if (false)`, which is the
// trap S199 paid for twice.
//
// Run: node scripts/test-on-my-way.mjs
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AVAIL = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");
const DRIVE_SRC = readFileSync(join(ROOT, "functions", "driveTime.js"), "utf8");
const SESSIONS = readFileSync(join(ROOT, "src", "sessions.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
const D = require(join(ROOT, "functions", "driveTime.js"));

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

const MIN = 60000;
const NOW = Date.UTC(2026, 8, 6, 14, 0);   // a fixed clock, so nothing here is flaky

// ── lift the server's decision ──────────────────────────────────────────────
// availability.js pulls in firebase-functions at module scope, so the pure
// helpers are extracted by source rather than required — but they are extracted
// WHOLE and EXECUTED, so a mutation to the shipping body fails this file.
function lift(src, name) {
  const m = src.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
const serverPure = new Function(`
  const ON_MY_WAY_LEAD_MIN = ${(AVAIL.match(/const ON_MY_WAY_LEAD_MIN = (\d+)/) || [])[1]};
  const ON_MY_WAY_MIN_GAP_MS = ${(AVAIL.match(/const ON_MY_WAY_MIN_GAP_MS = (\d+)/) || [])[1]};
  const fmtWhen = (ms, tz, o) => new Date(ms).toLocaleString("en-US", { timeZone: "UTC", ...o });
  ${lift(AVAIL, "onMyWayDecision")}
  ${lift(AVAIL, "onMyWayThrottled")}
  ${lift(AVAIL, "onMyWayMessage")}
  return { onMyWayDecision, onMyWayThrottled, onMyWayMessage, ON_MY_WAY_LEAD_MIN, ON_MY_WAY_MIN_GAP_MS };
`)();
const { onMyWayDecision, onMyWayThrottled, onMyWayMessage } = serverPure;

const S = (over = {}) => ({
  trainerUid: "t1", clientUid: "c1", participants: ["t1", "c1"],
  startAt: NOW + 30 * MIN, durationMin: 60, status: "scheduled",
  location: "123 Main St, Miami FL", ...over,
});

// ── 1. who may say it ───────────────────────────────────────────────────────
ok("the trainer may say it", onMyWayDecision(S(), "t1", NOW).ok);
ok("and so may the client — whoever taps is the one moving",
   onMyWayDecision(S(), "c1", NOW).ok);
{
  const v = onMyWayDecision(S(), "stranger", NOW);
  ok("a non-participant is refused", !v.ok && v.code === "permission-denied", v);
}
ok("a signed-out caller is refused", !onMyWayDecision(S(), "", NOW).ok);
ok("a missing session is refused", !onMyWayDecision(null, "t1", NOW).ok);
// The other side is read from `participants`, never from a role — that is the
// only field authoritative about who the pair are, and it is what makes both
// directions work from one code path.
ok("the trainer's tap targets the client", onMyWayDecision(S(), "t1", NOW).otherUid === "c1");
ok("the client's tap targets the trainer", onMyWayDecision(S(), "c1", NOW).otherUid === "t1");
{
  // A malformed doc must not send a notification to the person who tapped it.
  const v = onMyWayDecision(S({ participants: ["t1"] }), "t1", NOW);
  ok("a session with nobody to tell is refused, not self-notified", !v.ok, v);
}

// ── 2. when it is a true statement ──────────────────────────────────────────
{
  const v = onMyWayDecision(S({ status: "cancelled" }), "t1", NOW);
  ok("a cancelled session is refused", !v.ok && v.code === "failed-precondition", v);
}
{
  // Past the END, not past the start: someone running late to a session already
  // under way still has something worth saying.
  const v = onMyWayDecision(S({ startAt: NOW - 10 * MIN }), "t1", NOW);
  ok("a session in progress still accepts it", v.ok, v);
}
{
  const v = onMyWayDecision(S({ startAt: NOW - 90 * MIN }), "t1", NOW);
  ok("a finished session is refused", !v.ok, v);
}
{
  const lead = serverPure.ON_MY_WAY_LEAD_MIN;
  ok("inside the lead window it is allowed",
     onMyWayDecision(S({ startAt: NOW + (lead - 1) * MIN }), "t1", NOW).ok);
  // Refused rather than sent: "your trainer is on the way" about a session two
  // days out is a notification about a journey nobody is on.
  ok("outside the lead window it is refused",
     !onMyWayDecision(S({ startAt: NOW + (lead + 1) * MIN }), "t1", NOW).ok);
}

// ── 3. the two sides agree on that window ───────────────────────────────────
{
  const server = Number((AVAIL.match(/const ON_MY_WAY_LEAD_MIN = (\d+)/) || [])[1]);
  const client = Number((SESSIONS.match(/export const ON_MY_WAY_LEAD_MIN = (\d+)/) || [])[1]);
  ok("both files declare the lead window", server > 0 && client > 0, [server, client]);
  ok("and the numbers are the same — a wider client bound is a button that throws",
     server === client, [server, client]);
}

// ── 4. the cooldown ─────────────────────────────────────────────────────────
// A person legitimately re-taps when traffic turns; a double-tap is one tap.
// Each tap is a Routes call AND a push, so this bounds both.
{
  const gap = serverPure.ON_MY_WAY_MIN_GAP_MS;
  const prev = { by: "t1", at: NOW, minutes: 12, etaAt: NOW + 12 * MIN };
  ok("an immediate second tap is throttled", onMyWayThrottled(prev, "t1", NOW + 1000));
  ok("a tap after the cooldown is not", !onMyWayThrottled(prev, "t1", NOW + gap + 1000));
  // The other side setting off is a different event entirely — throttling it
  // against the first person's stamp would silence a real notification.
  ok("the OTHER participant is never throttled by my stamp",
     !onMyWayThrottled(prev, "c1", NOW + 1000));
  ok("no previous tap is never throttled", !onMyWayThrottled(null, "t1", NOW));
  // A clock that jumped backwards must not lock the button out.
  ok("a stamp from the future does not throttle", !onMyWayThrottled(prev, "t1", NOW - 60 * MIN));
}

// ── 5. what the other person is told ────────────────────────────────────────
{
  const m = onMyWayMessage("Kevin", 12, NOW + 12 * MIN, "UTC");
  ok("the message names who is moving", /Kevin/.test(m.title), m);
  ok("and says how long", /12 min/.test(m.body), m);
  // The no-ETA case has to be a real sentence, not a gap where a number was.
  const none = onMyWayMessage("Kevin", null, null, "UTC");
  ok("with no ETA it still says they're on the way", /on the way/.test(none.title), none);
  ok("and does not print a blank or a null", !/null|undefined|NaN/.test(none.title + none.body), none);
  ok("a missing name still reads as a sentence",
     !/^ is|undefined/.test(onMyWayMessage("", 5, NOW, "UTC").title));
}

// ── 6. the GPS origin never reaches a geocoder ──────────────────────────────
// The trap the handoff flagged by name. Proven by counting geocoder calls: a
// fake fetch records every outbound URL, so a regression that routes the origin
// through geocode() shows up as two lookups instead of one.
{
  const mkDb = () => {
    const store = new Map();
    return { store, db: { doc: (p) => ({
      get: async () => ({ exists: store.has(p), data: () => store.get(p) }),
      set: async (v, o) => { store.set(p, o && o.merge ? { ...(store.get(p) || {}), ...v } : v); },
    }) } };
  };
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("maps.googleapis.com")) {
      return { ok: true, json: async () => ({ status: "OK", results: [{
        geometry: { location: { lat: 25.8010, lng: -80.1990 }, location_type: "ROOFTOP" },
        partial_match: false }] }) };
    }
    if (String(url).includes("routes.googleapis.com")) {
      return { ok: true, json: async () => ({ routes: [{ duration: "600s", distanceMeters: 5000 }] }) };
    }
    return { ok: true, json: async () => [] };
  };

  const { db } = mkDb();
  const est = await D.estimateDriveFrom(db, { lat: 25.7907, lng: -80.1300 },
    "123 Main St Miami FL", NOW, "AIzaTESTKEY", fakeFetch, "AIzaTESTKEY");
  ok("an estimate comes back from a live position", !!est && est.minutes > 0, est);
  const geocodes = calls.filter((u) => u.includes("maps.googleapis.com/maps/api/geocode"));
  ok("exactly ONE geocode — the destination", geocodes.length === 1, geocodes);
  ok("and the origin's coordinates are in no geocoder query",
     !geocodes.some((u) => u.includes("25.79") || u.includes("80.13")), geocodes);
  ok("the ROUTES call is the one that carries the position",
     calls.some((u) => u.includes("routes.googleapis.com")), calls);
}
{
  // ...and with no Routes key it still answers, from the straight line.
  const store = new Map();
  const db = { doc: (p) => ({
    get: async () => ({ exists: store.has(p), data: () => store.get(p) }),
    set: async (v, o) => { store.set(p, o && o.merge ? { ...(store.get(p) || {}), ...v } : v); },
  }) };
  const est = await D.estimateDriveFrom(db, { lat: 25.7907, lng: -80.1300 }, "somewhere in miami",
    NOW, null, async () => ({ ok: true, json: async () => ([{ lat: "25.8010", lon: "-80.1990", addresstype: "building" }]) }), null);
  ok("with no key it falls back to a straight line rather than nothing",
     !!est && est.source === "straight-line", est);
  ok("and the estimate is labelled so the UI can hedge it", est.source !== "routes");
}
{
  // A bad fix must produce NO estimate rather than a confident wrong one.
  //
  // ⚠️ THE DESTINATION GEOCODER HERE MUST SUCCEED. The first version of this
  // block used a fetch that threw, so every case returned null whether the
  // point guard ran or not — and a mutation test proved it: deleting the
  // null-island and off-globe checks left this file GREEN. With a WORKING
  // destination lookup, the only thing that can still produce null is the guard
  // being tested, and the call counter proves it bailed before spending one.
  let looked = 0;
  const geoOk = async (url) => {
    looked++;
    return { ok: true, json: async () => ([{ lat: "25.8010", lon: "-80.1990", addresstype: "building" }]) };
  };
  const fresh = () => {
    const store = new Map();
    return { doc: (p) => ({
      get: async () => ({ exists: store.has(p), data: () => store.get(p) }),
      set: async (v, o) => { store.set(p, o && o.merge ? { ...(store.get(p) || {}), ...v } : v); },
    }) };
  };
  // Sanity: with a GOOD fix this exact setup does return an estimate. Without
  // this line every assertion below could pass because the harness is broken.
  looked = 0;
  const control = await D.estimateDriveFrom(fresh(), { lat: 25.7907, lng: -80.1300 }, "1 Real St Miami", NOW, null, geoOk, null);
  ok("control: a good fix through this harness DOES estimate", !!control && control.minutes > 0, control);
  ok("...and it did look the destination up", looked === 1, looked);

  const refused = async (label, point, dest = "1 Real St Miami") => {
    looked = 0;
    const r = await D.estimateDriveFrom(fresh(), point, dest, NOW, null, geoOk, null);
    ok(label, r === null, r);
    ok(`${label} — and nothing was looked up`, looked === 0, looked);
  };
  await refused("null island is refused", { lat: 0, lng: 0 });
  await refused("an off-globe latitude is refused", { lat: 91, lng: 0 });
  await refused("an off-globe longitude is refused", { lat: 25, lng: 181 });
  await refused("a missing fix is refused", undefined);
  await refused("a string fix is refused", { lat: "here", lng: "there" });
  await refused("an empty destination is refused before any lookup", { lat: 25.79, lng: -80.13 }, "  ");
}
ok("validPoint accepts an ordinary fix", !!D.validPoint({ lat: 25.79, lng: -80.13 }));
ok("validPoint rejects NaN", D.validPoint({ lat: NaN, lng: 0 }) === null);

// ── 7. the position is never persisted ──────────────────────────────────────
// Three ways, because this is the promise the feature was approved on.
{
  const body = AVAIL.slice(AVAIL.indexOf("exports.sessionOnMyWay"));
  const written = body.match(/onMyWay: \{[^}]*\}/);
  ok("the callable writes an onMyWay record", !!written, written);
  ok("...and it holds no coordinates",
     !!written && !/\blat\b|\blng\b|latitude|longitude|coords/.test(written[0]), written && written[0]);
  ok("...only a duration and a clock time",
     !!written && /minutes/.test(written[0]) && /etaAt/.test(written[0]), written && written[0]);
  // ⚠️ MERGE, NEVER REPLACE. The session doc is a live billing record — status,
  // prices, completion stamps — and a bare set() here would erase it.
  ok("the write MERGES rather than replacing the session",
     /\{ merge: true \}/.test(body.slice(0, body.indexOf("sendPushTo"))), true);
  ok("nothing in the callable logs the fix",
     !/console\.(log|error|warn)\([^)]*d\.lat/.test(body));
}
{
  // estimateDriveFrom must not write a drivecache entry: the key is
  // (origin, destination, weekday, hour), so caching a live position would put
  // coordinates in a shared, uid-less document — and could never hit anyway.
  const fn = DRIVE_SRC.slice(DRIVE_SRC.indexOf("async function estimateDriveFrom"));
  const bodyOnly = fn.slice(0, fn.indexOf("\nmodule.exports"));
  ok("estimateDriveFrom touches no drive cache", !/drivecache|driveKey/.test(bodyOnly), bodyOnly.slice(0, 200));
}
{
  // And the browser must not keep it either.
  const start = APP.indexOf("function oneGpsFix()");
  const end = APP.indexOf("\nfunction calBillingState");
  const ui = APP.slice(start, end);
  ok("extracted the client-side on-my-way UI", start > 0 && end > start);
  ok("the fix is passed to the callable and never put in state or storage",
     !/setState[^\n]*lat|localStorage[^\n]*lat|storage\.set[^\n]*lat/.test(ui));
  ok("and the screen says so, at the moment of the decision",
     /never where you are/i.test(ui), true);
}

// ── 8. a refused location prompt is not a refused tap ───────────────────────
{
  const start = APP.indexOf("function oneGpsFix()");
  const ui = APP.slice(start, APP.indexOf("\nfunction calBillingState"));
  // oneGpsFix RESOLVES null instead of rejecting, which is what keeps the
  // notification going out when the prompt is declined.
  const gps = APP.slice(start, APP.indexOf("function OnMyWay("));
  ok("a denied prompt resolves null rather than throwing", /resolve\(null\)|finish\(null\)/.test(gps));
  ok("...and there is no reject path to swallow the tap", !/reject\(/.test(gps));
  ok("the call is still made with no fix", /\.\.\.\(fix \|\| \{\}\)/.test(ui), true);
  ok("and the person is told WHY there is no arrival time",
     /location wasn't shared/.test(ui) && /no address/.test(ui), true);
}

// ── 8b. a broken call never shows the user a status code ────────────────────
// ⚠️ FOUND IN THE BROWSER, NOT IN THE CODE. With the callable not yet deployed,
// tapping the button rendered the bare word "internal" — the exact defect S196b
// had already fixed once on the booking Accept. A Firebase callable's `message`
// IS its code when the server did not supply one, so passing it straight
// through is the trap, and it only shows up when something is actually broken.
{
  const src = APP.match(/const OMW_SERVER_SAYS = [\s\S]*?\nfunction onMyWayError\(e\) \{[\s\S]*?\n\}/)[0];
  const onMyWayError = new Function(`${src}; return onMyWayError;`)();
  // A deliberate refusal: the server knows why, and its sentence is the useful one.
  ok("a deliberate refusal shows the server's own wording",
     onMyWayError({ code: "functions/failed-precondition", message: "That session was cancelled." })
       === "That session was cancelled.");
  ok("permission-denied likewise",
     /isn't your session/.test(onMyWayError({ code: "functions/permission-denied", message: "That isn't your session." })));
  // A breakage: there is no sentence, only a code, and the code is not English.
  const internal = onMyWayError({ code: "functions/internal", message: "internal" });
  ok("a broken call never prints the word 'internal'", !/internal/i.test(internal), internal);
  ok("...it says something a person can act on", /try again/i.test(internal), internal);
  ok("a network failure says so", /connection/i.test(onMyWayError({ code: "functions/unavailable", message: "unavailable" })));
  ok("an undeployed function does not leak its code either",
     !/not-found|internal|unavailable/i.test(onMyWayError({ code: "functions/not-found", message: "not-found" })),
     onMyWayError({ code: "functions/not-found", message: "not-found" }));
  ok("a bare Error with no code still reads as a sentence",
     /try again/i.test(onMyWayError(new Error("boom"))));
  ok("and so does no error at all", /try again/i.test(onMyWayError(null)));
}

// ── 9. the notification has somewhere to land ───────────────────────────────
// The failure S200q had to fix fifteen times: a push that opens the app and
// does nothing. test-notif-routes.mjs harvests the tag automatically; this pins
// the pairing at the source.
{
  const body = AVAIL.slice(AVAIL.indexOf("exports.sessionOnMyWay"));
  ok("the push carries a tag", /tag: `session-onmyway-\$\{sessionId\}`/.test(body));
  ok("...and a url", /url: "\/\?notif=session-onmyway"/.test(body));
  const m = APP.match(/function notifDestination\(n\) \{[\s\S]*?\n\}/);
  const notifDestination = new Function(`${m[0]}; return notifDestination;`)();
  ok("and it routes to the screen that shows the ETA",
     notifDestination({ tag: "session-onmyway-abc", url: "/?notif=session-onmyway" }) === "sessions");
  // Its own preference key, so silencing the automated countdown does not also
  // silence a person telling you they have left.
  ok("it has its own notification type", /"sessionOnMyWay"\)/.test(body));
  ok("...which the Notification Center actually offers, to BOTH roles",
     (APP.match(/key: "sessionOnMyWay"/g) || []).length === 2,
     (APP.match(/key: "sessionOnMyWay"/g) || []).length);
}

// ── 9b. the session id is an id, not a path ─────────────────────────────────
{
  const body = AVAIL.slice(AVAIL.indexOf("exports.sessionOnMyWay"));
  ok("a slash or dot in the session id is refused before any read",
     /\/\[\/\.\]\/\.test\(sessionId\)/.test(body.replace(/\s+/g, "")) || /\[\/\.\]/.test(body),
     true);
  const guard = body.slice(0, body.indexOf("const db = admin.firestore()"));
  ok("...and the guard runs before the document is addressed",
     /invalid-argument/.test(guard), true);
}

// ── 10. the client's read of an ETA ─────────────────────────────────────────
// Lifted and run for the same reason as the server's: this is what decides
// whether a stale number keeps being quoted as fact.
{
  const lifted = SESSIONS.match(/export function onMyWayStatus\([\s\S]*?\n\}/)[0];
  const canSrc = SESSIONS.match(/export function canSayOnMyWay\([\s\S]*?\n\}/)[0];
  const mod = new Function(`
    const ON_MY_WAY_LEAD_MIN = ${(SESSIONS.match(/export const ON_MY_WAY_LEAD_MIN = (\d+)/) || [])[1]};
    const ON_MY_WAY_STALE_MIN = ${(SESSIONS.match(/export const ON_MY_WAY_STALE_MIN = (\d+)/) || [])[1]};
    const SESSION_DEFAULT_MIN = 60;
    const sessionEndMs = (s) => (s.startAt || 0) + (s.durationMin || SESSION_DEFAULT_MIN) * 60000;
    const isPastSession = (s, now) => sessionEndMs(s) <= now;
    ${lifted.replace("export ", "")}
    ${canSrc.replace("export ", "")}
    return { onMyWayStatus, canSayOnMyWay };
  `)();
  const { onMyWayStatus, canSayOnMyWay } = mod;

  ok("no travel note means nothing to render", onMyWayStatus(S(), "c1", NOW) === null);
  {
    const s = S({ onMyWay: { by: "t1", at: NOW, minutes: 12, etaAt: NOW + 12 * MIN, source: "routes" } });
    const mine = onMyWayStatus(s, "t1", NOW);
    const theirs = onMyWayStatus(s, "c1", NOW);
    ok("the sender sees it as theirs", mine.mine === true);
    ok("the other side does not", theirs.mine === false);
    ok("it reads 12 minutes out at the moment it was sent", theirs.minutesOut === 12, theirs);
    // ⚠️ THE COUNTDOWN IS FROM etaAt, NOT FROM THE STORED DURATION. Rendering
    // `minutes` unchanged means a row still claiming "12 min out" half an hour
    // later — the exact way an ETA becomes a lie without anyone editing it.
    const later = onMyWayStatus(s, "c1", NOW + 8 * MIN);
    ok("it counts DOWN as time passes", later.minutesOut === 4, later);
    const arrived = onMyWayStatus(s, "c1", NOW + 20 * MIN);
    ok("it never shows a negative countdown", arrived.minutesOut === null || arrived.minutesOut >= 0, arrived);
    ok("...it says they should be arriving instead", arrived.overdue === true, arrived);
  }
  {
    // An estimate nobody has refreshed stops being quoted as one.
    const stale = S({ onMyWay: { by: "t1", at: NOW - 90 * MIN, minutes: 12, etaAt: NOW - 78 * MIN } });
    const v = onMyWayStatus(stale, "c1", NOW);
    ok("a stale ETA drops the number", v.stale === true && v.minutesOut === null, v);
  }
  {
    const cancelled = S({ status: "cancelled", onMyWay: { by: "t1", at: NOW, minutes: 5, etaAt: NOW + 5 * MIN } });
    ok("a cancelled session shows no travel note", onMyWayStatus(cancelled, "c1", NOW) === null);
    const done = S({ startAt: NOW - 120 * MIN, onMyWay: { by: "t1", at: NOW - 130 * MIN, minutes: 5, etaAt: NOW - 125 * MIN } });
    ok("a finished session shows no travel note", onMyWayStatus(done, "c1", NOW) === null);
    // ⚠️ AND A RESCHEDULE MUST NOT LEAVE ONE BEHIND. Tap at 12:50 for a 1:00
    // session, then move the session to 3:00: a hand-rolled cancelled/past pair
    // still showed "12 minutes away" about a session two hours off.
    const moved = S({ startAt: NOW + 600 * MIN, onMyWay: { by: "t1", at: NOW, minutes: 12, etaAt: NOW + 12 * MIN } });
    ok("a session rescheduled out of reach drops the travel note",
       onMyWayStatus(moved, "c1", NOW) === null, onMyWayStatus(moved, "c1", NOW));
    // ...and the two halves stay in step by construction: anything that can no
    // longer be SAID can no longer be SHOWN.
    for (const off of [-200, -61, -1, 0, 30, 239, 241, 500]) {
      const st = S({ startAt: NOW + off * MIN, onMyWay: { by: "t1", at: NOW, minutes: 3, etaAt: NOW + 3 * MIN } });
      ok(`say and show agree at ${off} min`,
         (onMyWayStatus(st, "c1", NOW) !== null) === canSayOnMyWay(st, NOW), off);
    }
  }
  // The button's own visibility, on the same bound as the server's refusal.
  ok("the button shows inside the window", canSayOnMyWay(S({ startAt: NOW + 30 * MIN }), NOW));
  ok("and hides outside it", !canSayOnMyWay(S({ startAt: NOW + 600 * MIN }), NOW));
  ok("and hides on a cancelled session", !canSayOnMyWay(S({ status: "cancelled" }), NOW));
  ok("and hides once the session is over", !canSayOnMyWay(S({ startAt: NOW - 120 * MIN }), NOW));
  // Cross-check: for every offset, the client's button and the server's verdict
  // must agree. This is the drift check that a single constant comparison misses.
  for (const off of [-200, -70, -60, -1, 0, 1, 60, 239, 240, 241, 500]) {
    const s = S({ startAt: NOW + off * MIN });
    ok(`button and server agree at ${off} min`,
       canSayOnMyWay(s, NOW) === onMyWayDecision(s, "t1", NOW).ok, off);
  }
}

// ── 11. the session doc stays server-owned ──────────────────────────────────
// `onMyWay` is deliberately absent from firestore.rules bookingFields(), so
// neither side can type an arrival time from a console — and no rules publish
// is needed, because `changed()` is a diff of affected keys.
{
  const rules = readFileSync(join(ROOT, "firestore.rules"), "utf8");
  const fields = rules.slice(rules.indexOf("function bookingFields()"));
  ok("onMyWay is not a client-writable booking field",
     !/'onMyWay'/.test(fields.slice(0, fields.indexOf("}"))), true);
  ok("nothing in src/ writes onMyWay directly",
     !/updateDoc\([^)]*onMyWay|onMyWay:/.test(SESSIONS.replace(/\/\/[^\n]*/g, "")), true);
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
