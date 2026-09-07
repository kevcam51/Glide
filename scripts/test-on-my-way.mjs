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
  // `async ` too — trainerHasDriveFeatures is one, and a lifter that silently
  // could not see it would have quietly dropped the whole plan-gate section.
  const m = src.match(new RegExp(`\\n(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
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

// ── 8c. the sender is told the TRUTH about delivery (S206) ──────────────────
// ⚠️ FOUND BY A PRE-FLIGHT AUDIT, BEFORE THE OWNER'S FIRST LIVE TAP. sendPushTo
// reports {sent} / {skipped:"prefs"} / {skipped:"no-subs"} and every outcome was
// being collapsed into one cheerful "Sent." — so a trainer whose client has
// never enabled push was told "they can see you're 12 min away" and would
// reasonably rely on that to explain being late.
// The in-app row is ALWAYS written (appendFeed runs before any preference or
// subscription check), so the honest split is HOW they will see it, not WHETHER.
{
  const src = APP.match(/function onMyWaySentNote\(d, otherName, hadFix\) \{[\s\S]*?\n\}/)[0];
  const note = new Function(`${src}; return onMyWaySentNote;`)();
  const eta = { minutes: 12, etaAt: 1 };
  ok("a delivered ETA reads plainly", /12 min away/.test(note({ ...eta, pushed: true }, "Casey", true)));
  ok("...with no unnecessary caveat", !/open Glidna|muted/.test(note({ ...eta, pushed: true }, "Casey", true)));
  // The two outcomes that mean "no buzz".
  const noSubs = note({ ...eta, pushSkipped: "no-subs" }, "Casey", true);
  ok("no push subscription is disclosed", /open Glidna/.test(noSubs), noSubs);
  ok("...without claiming it failed — they DO see it in-app", !/fail|error|couldn/i.test(noSubs), noSubs);
  const muted = note({ ...eta, pushSkipped: "prefs" }, "Casey", true);
  ok("a muted preference is disclosed", /muted/.test(muted), muted);
  ok("...and named as their choice, not a fault", /muted push alerts/.test(muted), muted);
  // An UNKNOWN outcome must not invent a caveat.
  ok("an unknown delivery outcome says nothing extra",
     !/open Glidna|muted/.test(note({ ...eta }, "Casey", true)));
  // The no-ETA halves still say WHY.
  ok("a denied location still explains itself", /location wasn't shared/.test(note({}, "Casey", false)));
  // ⚠️ UPDATED, NOT WEAKENED (S206). This used to pass `{}` and expect "no
  // address" — which encoded the very guess that was wrong: an absent
  // `noDestination` meant "the server did not say", and printing "no address"
  // for it is what misdirected the reader. The session that really has none now
  // has to say so.
  ok("a session with no address explains itself", /no address/.test(note({ noDestination: true }, "Casey", true)));
  ok("no message ever prints a null or undefined",
     ["Casey", ""].every((n) => [true, false].every((f) =>
       [{}, eta, { ...eta, pushSkipped: "no-subs" }].every((d) =>
         !/null|undefined|NaN/.test(note(d, n, f))))));

  // ⚠️ THE "WHY" MUST COME FROM THE SERVER, NOT A GUESS (S206). Inferring it
  // from whether the browser got a fix printed "this session has no address" for
  // every server-side cause — a geocoder that cannot place the address
  // precisely, a Routes hiccup, a key problem — on a session whose address is
  // visible on the same screen. Three audit lenses flagged it independently.
  ok("a session that really has no address says so",
     /no address/.test(note({ noDestination: true }, "Casey", true)));
  ok("...but a geocode failure does NOT claim the address is missing",
     !/no address/.test(note({ noDestination: false }, "Casey", true)),
     note({ noDestination: false }, "Casey", true));
  ok("...it names the real problem instead",
     /full street address/.test(note({ noDestination: false }, "Casey", true)));
  ok("a denied fix still outranks both", /location wasn't shared/.test(note({ noDestination: false }, "Casey", false)));
  // A cooldown replay is not a send — reporting it as one is exactly wrong in
  // the natural loop: tap, no ETA, fix the address, tap again, be told it worked.
  ok("a replay is not reported as a fresh send",
     /Already sent/.test(note({ repeated: true, minutes: 12 }, "Casey", true)));
  ok("...and does not also claim delivery", !/^Sent/.test(note({ repeated: true, minutes: 12 }, "Casey", true)));
  ok("...even with no ETA to replay", /Already sent/.test(note({ repeated: true }, "Casey", true)));

  // The server must actually REPORT it, or the wording has nothing to read.
  const body = AVAIL.slice(AVAIL.indexOf("exports.sessionOnMyWay"));
  ok("the callable reports whether it buzzed", /pushed: !!\(push && push\.sent > 0\)/.test(body));
  ok("...and why it did not", /pushSkipped: \(push && push\.skipped\) \|\| null/.test(body));
  // ⚠️ AND IT MUST STILL NOT THROW. A notification that could not be delivered
  // must never fail the tap — the ETA is stored either way.
  // ⚠️ COUNT BOTH, DO NOT JUST MATCH ONE. The first version of this asserted the
  // pattern appeared "somewhere in sessionOnMyWay" — and stayed green when the
  // DEPARTURE catch was reverted to `.catch(() => {})`, because the ARRIVAL one
  // still matched. A guard that exists in two places has to be counted in two
  // places.
  ok("BOTH pushes catch to a value, so neither can fail the tap",
     (body.match(/\.catch\(\(e\) => \(\{ skipped: "error"/g) || []).length === 2,
     (body.match(/\.catch\(\(e\) => \(\{ skipped: "error"/g) || []).length);
  ok("...and no push is left swallowing its result",
     !/sendPushTo\([\s\S]{0,400}?\.catch\(\(\) => \{\}\)/.test(body), true);
  // Undebuggable was the other half of the finding: the logs could not answer
  // "did it send?" either.
  ok("the outcome is logged, so the logs can answer it", /console\.log\("onMyWay push"/.test(body));
  ok("...for the arrival too", /console\.log\("onMyWay arrival push"/.test(body));
}

// ── 8d. the open sheet is LIVE, not a snapshot (S206) ───────────────────────
// ⚠️ THE ONE REAL BUG THE PRE-FLIGHT AUDIT FOUND. `detail` was set once from the
// tapped calendar block and never re-read, so everything this feature writes
// came back nowhere: tapping "On my way" stored the ETA and notified the client,
// while the sheet went on offering "On my way" — and "I'm here", which only
// renders once a status exists, could never appear AT ALL. On the surface the
// code itself calls "the surface it matters on most".
{
  ok("the calendar sheet reads from the live session list",
     /const liveDetail = useMemo\(/.test(APP), true);
  ok("...keyed on both the tapped id and the live list",
     /\[detail, sessions\],/.test(APP), true);
  ok("...and the sheet is handed the live copy, not the frozen one",
     /<CalSessionSheet session=\{liveDetail\}/.test(APP), true);
  ok("...falling back so a vanished session closes cleanly rather than blanking",
     /\.find\(\(x\) => x\.id === detail\.id\) \|\| detail/.test(APP), true);
  // The owner must not be silently locked out of his own feature by a blip.
  // ⚠️ The server grants by UID BEFORE reading any profile, so deriving "no"
  // from a failed read disagrees with the gate this mirrors.
  ok("a failed profile read does not lock the owner out",
     /setMyDrive\(meUid === OWNER_UID\);/.test(APP), true);
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

// ── 9c. the plan gate (S202, Kevin: Option B) ───────────────────────────────
// The whole feature is Coach-and-above. Below that it does not appear — no
// panel, no button, no degraded version.
//
// ⚠️ THE REJECTED ALTERNATIVE IS THE ONE TO GUARD AGAINST. Gating the GEOCODING
// instead leaves the panel and the button rendering and silently producing
// nothing — the S199u bug — and this feature's silence reads as "your schedule
// is fine". So these assertions check that the gate is on ENTRY, not on the key.
{
  const server = (AVAIL.match(/const TRAFFIC_AWARE_TIERS = \[([^\]]*)\]/) || [])[1];
  const client = (SESSIONS.match(/export const DRIVE_FEATURE_TIERS = \[([^\]]*)\]/) || [])[1];
  ok("both sides declare the qualifying plans", !!server && !!client, [server, client]);
  const norm = (x) => (x || "").replace(/["'\s]/g, "");
  ok("...and the two lists are identical — the app must hide exactly what the server refuses",
     norm(server) === norm(client), [norm(server), norm(client)]);
  ok("Connect is deliberately NOT included", !/\bconnect\b/.test(norm(client)), norm(client));

  // The server predicate, lifted and RUN.
  const gate = new Function(`
    const TRAFFIC_AWARE_TIERS = [${server}];
    const ADMIN_UIDS = ["ADMIN"];
    function isAdminUid(uid) { return ADMIN_UIDS.includes(uid); }
    ${lift(AVAIL, "trainerHasDriveFeatures").replace("async function", "async function")}
    return trainerHasDriveFeatures;
  `)();
  const dbOf = (profile, throws) => ({ doc: () => ({ get: async () => {
    if (throws) throw new Error("firestore blip");
    return { data: () => profile };
  } }) });
  ok("a coach on an active plan is allowed",
     await gate(dbOf({ subscriptionStatus: "active", subscriptionTier: "coach" }), "t1") === true);
  ok("coach_max is allowed",
     await gate(dbOf({ subscriptionStatus: "active", subscriptionTier: "coach_max" }), "t1") === true);
  ok("a CANCELLED coach subscription is refused",
     await gate(dbOf({ subscriptionStatus: "canceled", subscriptionTier: "coach" }), "t1") === false);
  ok("a TRIALING coach subscription is refused",
     await gate(dbOf({ subscriptionStatus: "trial", subscriptionTier: "coach" }), "t1") === false);
  ok("the Connect tier is refused",
     await gate(dbOf({ subscriptionStatus: "active", subscriptionTier: "connect" }), "t1") === false);
  ok("a free trainer is refused", await gate(dbOf({}), "t1") === false);
  ok("the owner UID is allowed without a profile read", await gate(dbOf(null), "ADMIN") === true);
  ok("no trainer at all is refused", await gate(dbOf({}), "") === false);
  // ⚠️ A read blip must not hand out a paid feature. The OLD code caught the
  // same read and carried on with the free estimator, which was right when the
  // answer only chose between two qualities of one answer; it now decides
  // whether the feature exists.
  ok("a failed profile read is NO, not a free pass",
     await gate(dbOf(null, true), "t1") === false);
  // Case shouldn't matter — the stored tier is whatever billing.js wrote.
  ok("tier matching is case-insensitive",
     await gate(dbOf({ subscriptionStatus: "active", subscriptionTier: "COACH" }), "t1") === true);
}
{
  // ORDER IS THE WHOLE POINT for the action. A refusal that lands after the
  // write has stamped an ETA and buzzed the other person is not a refusal.
  const body = AVAIL.slice(AVAIL.indexOf("exports.sessionOnMyWay"));
  const gateAt = body.indexOf("trainerHasDriveFeatures");
  ok("sessionOnMyWay checks the plan", gateAt > 0);
  ok("...before it writes the ETA", gateAt < body.indexOf("ref.set("), [gateAt, body.indexOf("ref.set(")]);
  ok("...and before it notifies anyone", gateAt < body.indexOf("sendPushTo"), [gateAt, body.indexOf("sendPushTo")]);
  ok("...and before it spends a Routes call", gateAt < body.indexOf("estimateDriveFrom"));
  // sessionTravel refuses by RETURNING, not throwing: the browser's catch paints
  // "couldn't check your schedule" on any failure, and a plan boundary is not an
  // outage.
  const tBody = AVAIL.slice(AVAIL.indexOf("exports.sessionTravel"), AVAIL.indexOf("exports.sessionOnMyWay"));
  const tGate = tBody.indexOf("trainerHasDriveFeatures");
  ok("sessionTravel checks the plan", tGate > 0);
  ok("...and answers with a clean unavailable rather than throwing",
     /available: false/.test(tBody.slice(tGate, tGate + 400)), tBody.slice(tGate, tGate + 400));
  ok("...before it scans the sessions collection",
     tGate < tBody.indexOf('collection("sessions")'), [tGate, tBody.indexOf('collection("sessions")')]);
}
{
  // The app side: every OnMyWay mount passes an explicit answer, and the default
  // is OFF so a new mount site cannot ship the feature by omission.
  ok("OnMyWay defaults to disabled", /enabled = false \}/.test(APP), true);
  ok("...and renders nothing when disabled", /if \(!enabled\) return null;/.test(APP));
  const mounts = APP.match(/<OnMyWay[\s\S]{0,260}?\/>/g) || [];
  ok("found every OnMyWay mount", mounts.length === 3, mounts.length);
  for (const m of mounts) {
    ok(`a mount passes an explicit enabled: ${m.slice(0, 46).replace(/\s+/g, " ")}`, /enabled=\{/.test(m), m);
  }
  // The calendar must not CALL sessionTravel when the plan excludes it — the
  // catch there paints an error banner, so a server refusal would look like an
  // outage on a schedule that is fine.
  ok("the travel effect refuses to call when the plan excludes it",
     /if \(!myDrive \|\|[\s\S]{0,120}?\{ setTravel\(null\); return; \}/.test(APP), true);
  // ...and `myDrive` leads the guard, so a falsy plan answer short-circuits
  // before anything else is even evaluated.
  ok("...with the plan answer first in the guard", /\{\s*if \(!myDrive \|\|/.test(APP.replace(/\n\s*\/\/[^\n]*/g, "")), true);
  ok("...and re-runs when the answer arrives", /\}, \[meUid, travelSig, myDrive\]\);/.test(APP));
  // Tri-state: null means "not known yet" and must not be read as allowed.
  ok("the calendar's plan answer starts unknown, not allowed",
     /const \[myDrive, setMyDrive\] = useState\(null\);/.test(APP));
}

// ── 9d. the pricing grid is a PROMISE, so it must match the gate ────────────
// A row that says a plan includes drive time, on a plan the server refuses, is a
// bill someone paid for a feature that never appears. The grid columns are
// [Free, Connect, Coach, Coach Max].
{
  const rows = [
    "Drive time between sessions, with traffic",
    "Warns you when you can't make it across town",
  ];
  for (const label of rows) {
    const m = APP.match(new RegExp(`\\["${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}", ([^\\]]*)\\]`));
    ok(`the grid has a row for "${label.slice(0, 34)}…"`, !!m, label);
    if (!m) continue;
    const cols = m[1].split(",").map((x) => x.trim());
    ok(`…and it is NOT sold on Free: ${label.slice(0, 24)}`, cols[0] === "false", cols);
    // The one that actually changed, and the one a future edit is most likely
    // to put back: Connect must not be sold a feature the server refuses.
    ok(`…and NOT sold on Connect: ${label.slice(0, 24)}`, cols[1] === "false", cols);
    ok(`…and IS sold on Coach and above: ${label.slice(0, 24)}`,
       cols[2] === "true" && cols[3] === "true", cols);
  }
  const omw = APP.match(/\["\u201cOn my way\u201d[^"]*", ([^\]]*)\]/);
  ok("the grid sells \u201cOn my way\u201d", !!omw, omw && omw[1]);
  if (omw) {
    const cols = omw[1].split(",").map((x) => x.trim());
    ok("...on Coach and above only", cols.join() === "false,false,true,true", cols);
  }
  // A row with no tooltip renders bare; the grid explains every other line.
  ok("...and explains what it is", /one tap works out how long you\u2019ll be/i.test(APP)
     || /arriving around 9:05/.test(APP), true);
  // The upsell that is now false — everyone who reaches that panel already
  // bought the thing it offered.
  ok("the panel no longer offers traffic to people who already have it",
     !/Traffic-aware times come with any paid plan/.test(APP), true);
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
    const MEET_AT = { TRAINER: "trainer", CLIENT: "client" };
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

// ── 10b. arriving (S204) — the other end of the same journey ────────────────
{
  const lifted = SESSIONS.match(/export function onMyWayStatus\([\s\S]*?\n\}/)[0];
  const canSrc = SESSIONS.match(/export function canSayOnMyWay\([\s\S]*?\n\}/)[0];
  const mod = new Function(`
    const ON_MY_WAY_LEAD_MIN = ${(SESSIONS.match(/export const ON_MY_WAY_LEAD_MIN = (\d+)/) || [])[1]};
    const ON_MY_WAY_STALE_MIN = ${(SESSIONS.match(/export const ON_MY_WAY_STALE_MIN = (\d+)/) || [])[1]};
    const SESSION_DEFAULT_MIN = 60;
    const sessionEndMs = (s) => (s.startAt || 0) + (s.durationMin || SESSION_DEFAULT_MIN) * 60000;
    const isPastSession = (s, now) => sessionEndMs(s) <= now;
    const MEET_AT = { TRAINER: "trainer", CLIENT: "client" };
    ${lifted.replace("export ", "")}
    ${canSrc.replace("export ", "")}
    return onMyWayStatus;
  `)();
  const withW = (w) => S({ startAt: NOW + 20 * MIN, onMyWay: w });

  // ⚠️ ARRIVAL OUTRANKS THE COUNTDOWN. "Kev has arrived" and "about 4 min away"
  // on the same row is a contradiction, not extra detail.
  {
    const v = mod(withW({ by: "t1", at: NOW - 10 * MIN, minutes: 14, etaAt: NOW + 4 * MIN, arrivedAt: NOW - MIN }), "c1", NOW);
    ok("arrival is reported", v.arrived === true, v);
    ok("...and the countdown stops", v.minutesOut === null, v);
    ok("...and it is never also 'overdue'", v.overdue === false, v);
    ok("...with how long ago", v.arrivedMinAgo === 1, v);
  }
  {
    const v = mod(withW({ by: "t1", at: NOW, minutes: 9, etaAt: NOW + 9 * MIN }), "c1", NOW);
    ok("no arrival leaves the countdown alone", v.arrived === false && v.minutesOut === 9, v);
  }
  // ⚠️ `arrivedAt: null` IS THE CLEARED STATE, NOT A MISSING KEY. A fresh
  // departure writes null rather than deleting (a nested delete needs a dotted
  // path), so a truthiness test is the only correct read — `"arrivedAt" in w`
  // would report every re-departure as arrived, forever.
  {
    const v = mod(withW({ by: "t1", at: NOW, minutes: 9, etaAt: NOW + 9 * MIN, arrivedAt: null }), "c1", NOW);
    ok("a cleared arrival reads as NOT arrived", v.arrived === false, v);
    ok("...and the countdown comes back", v.minutesOut === 9, v);
  }
  ok("a zero stamp is not an arrival", mod(withW({ by: "t1", at: NOW, arrivedAt: 0 }), "c1", NOW).arrived === false);

  // The server half.
  const body = AVAIL.slice(AVAIL.indexOf("exports.sessionOnMyWay"));
  ok("the callable handles arriving", /d\.arrived === true/.test(body));
  // ⚠️ NO GPS ON THIS PATH. Arriving is a statement; asking for a fix to confirm
  // it would collect a position to learn nothing.
  const arriveBranch = body.slice(body.indexOf("d.arrived === true"), body.indexOf("A repeat inside the cooldown"));
  ok("...without reading a position", !/estimateDriveFrom|d\.lat|d\.lng/.test(arriveBranch), arriveBranch.slice(0, 200));
  ok("...idempotently — two taps are one arrival", /prev && prev\.arrivedAt/.test(arriveBranch), true);
  ok("...and it still notifies the other side", /sendPushTo/.test(arriveBranch), true);
  // ⚠️ THE BUG THIS ALMOST SHIPPED WITH: set(..., {merge:true}) merges nested
  // maps RECURSIVELY, so omitting arrivedAt on a new departure would leave the
  // previous one in place — a fresh journey stamped "arrived" forever.
  ok("a new departure explicitly CLEARS the arrival",
     /arrivedAt: null \}/.test(body), true);
  ok("the plan gate still runs before arriving can notify anyone",
     body.indexOf("trainerHasDriveFeatures") < body.indexOf("d.arrived === true"), true);

  // The app half.
  ok("the app offers 'I'm here' only once you have set off",
     /status && status\.mine && !status\.arrived && \(/.test(APP), true);
  ok("...and drops the departure control once you have arrived",
     /!\(status && status\.arrived\) && \(/.test(APP), true);
  ok("...and sends no coordinates with it",
     /callSessionOnMyWay\(\{ sessionId: s\.id, arrived: true \}\)/.test(APP), true);
}

// ── 10c. you cannot be on your way to your own place (S204) ─────────────────
{
  const lifted = SESSIONS.match(/export function onMyWayStatus\([\s\S]*?\n\}/)[0];
  const canSrc = SESSIONS.match(/export function canSayOnMyWay\([\s\S]*?\n\}/)[0];
  const canSay = new Function(`
    const ON_MY_WAY_LEAD_MIN = ${(SESSIONS.match(/export const ON_MY_WAY_LEAD_MIN = (\d+)/) || [])[1]};
    const ON_MY_WAY_STALE_MIN = ${(SESSIONS.match(/export const ON_MY_WAY_STALE_MIN = (\d+)/) || [])[1]};
    const SESSION_DEFAULT_MIN = 60;
    const MEET_AT = { TRAINER: "trainer", CLIENT: "client" };
    const sessionEndMs = (s) => (s.startAt || 0) + (s.durationMin || SESSION_DEFAULT_MIN) * 60000;
    const isPastSession = (s, now) => sessionEndMs(s) <= now;
    ${lifted.replace("export ", "")}
    ${canSrc.replace("export ", "")}
    return canSayOnMyWay;
  `)();
  const soon = (over) => S({ startAt: NOW + 30 * MIN, ...over });

  // At the CLIENT's place: the client is the host and is already there.
  ok("the client is not offered it at their own place",
     !canSay(soon({ meetAt: "client" }), NOW, "c1"));
  ok("...but the trainer, who is driving there, is",
     canSay(soon({ meetAt: "client" }), NOW, "t1"));
  // ⚠️ THE MIRROR IS DELIBERATELY NOT RESTRICTED. A trainer's saved place is
  // where they WORK and they commute to it — running late to your own studio is
  // exactly the case this exists for. Hiding it there would remove a real use.
  ok("at the TRAINER's place the trainer keeps it (they commute to their studio)",
     canSay(soon({ meetAt: "trainer" }), NOW, "t1"));
  ok("...and so does the client, who is travelling",
     canSay(soon({ meetAt: "trainer" }), NOW, "c1"));
  // Nothing chosen means nobody is designated, so neither side is restricted.
  ok("with no place chosen, both sides keep it",
     canSay(soon({}), NOW, "c1") && canSay(soon({}), NOW, "t1"));
  // The window still wins over all of it.
  ok("the lead window still applies", !canSay(S({ startAt: NOW + 600 * MIN, meetAt: "trainer" }), NOW, "c1"));

  // And the SERVER agrees — a hidden button whose callable would have accepted
  // is a rule that exists in only one place.
  {
    const v = onMyWayDecision(soon({ meetAt: "client" }), "c1", NOW);
    ok("the server refuses the client at their own place", !v.ok, v);
    ok("...with a reason a person can read", /coming to you/i.test(v.reason || ""), v);
    ok("the server still allows the trainer driving there",
       onMyWayDecision(soon({ meetAt: "client" }), "t1", NOW).ok);
    ok("...and both sides at the trainer's place",
       onMyWayDecision(soon({ meetAt: "trainer" }), "t1", NOW).ok
       && onMyWayDecision(soon({ meetAt: "trainer" }), "c1", NOW).ok);
  }
  // Cross-check across the window, for BOTH participants and all three places.
  for (const meetAt of ["", "trainer", "client"]) {
    for (const who of ["t1", "c1"]) {
      for (const off of [-200, -1, 30, 239, 241]) {
        const st = S({ startAt: NOW + off * MIN, meetAt });
        ok(`button and server agree (${meetAt || "none"}/${who}/${off}m)`,
           canSay(st, NOW, who) === onMyWayDecision(st, who, NOW).ok, [meetAt, who, off]);
      }
    }
  }
  ok("the app passes the viewer through, or the rule never fires",
     /canSayOnMyWay\(s, now, meUid\)/.test(APP), true);
}

// ── 10d. the Routes request stays on the tier we think it is (S204) ─────────
// ⚠️ Routes bills ONE SKU per request, at the highest tier ANY requested feature
// belongs to. Traffic-awareness puts us on Pro (5,000 free/month then $10/1,000
// against Essentials' 10,000 then $5) — a deliberate trade. But three OTHER
// features silently promote a request to the same tier, so a future edit could
// double the bill while adding nothing anyone asked for.
{
  const body = (DRIVE_SRC.match(/const body = \{[\s\S]*?\n    \};/) || [""])[0];
  ok("found the Routes request body", body.length > 80, body.length);
  ok("traffic-awareness is requested deliberately", /routingPreference: "TRAFFIC_AWARE"/.test(body));
  // The other three Pro triggers, none of which this feature needs.
  ok("no intermediate waypoints", !/intermediates/.test(body), body);
  ok("no waypoint-order optimisation", !/optimizeWaypointOrder/.test(body), body);
  ok("no location modifiers (side of road / heading / stopover)",
     !/sideOfRoad|heading|vehicleStopover/.test(body), body);
  ok("and the cost consequence is written down where the request is",
     /Compute Routes Pro/.test(DRIVE_SRC), true);
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
