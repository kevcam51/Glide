// Does a booking land on something already there? (S199d)
//
// Nothing on ANY booking path checked this. A trainer could put two billable
// sessions on the same hour and find out from a client — and it got worse when
// multi-day asks started working, because the composer only fetches free/busy
// for the FIRST offered day, so "Book this" on Wednesday books an hour nothing
// on either side ever looked at.
//
// The helpers are pure, so the arithmetic is tested away from Firestore and
// React. They MOVED in S199q: App.jsx used to carry its own copies, and its
// seriesStarts was a hand-written MIRROR of bookSeries's occurrence maths — by
// its own admission — so a warning could describe dates the booking would not
// create. There is now one implementation, in src/sessions.js, and it is the
// one that does the booking. Lifted rather than imported because that module
// pulls in Firebase.
//
// Run: node scripts/test-overlap.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "src", "sessions.js"), "utf8");
const APP = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

let fails = 0, checks = 0;
const ok = (n, c, x) => { checks++; if (!c) { fails++; console.log("  FAIL:", n, x !== undefined ? JSON.stringify(x) : ""); } };

// Brace-match a declaration out of the module text.
const grab = (name, kind = "function") => {
  const i = SRC.indexOf(`${kind} ${name}`);
  if (i < 0) throw new Error(`${name} not found in src/sessions.js`);
  let d = 0;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") d++;
    else if (SRC[k] === "}") { d--; if (d === 0) return SRC.slice(i, k + 1); }
  }
  throw new Error(`${name} unterminated`);
};
const line = (re) => { const m = re.exec(SRC); if (!m) throw new Error(`${re} not found`); return m[0]; };

// Everything the two helpers stand on, lifted from the same file so the
// occurrence maths under test IS the shipping one.
const scope = [
  "const SESSION_DEFAULT_MIN = 60;",
  line(/export const REPEAT_OPTIONS = \{[\s\S]*?\n\};/).replace("export ", ""),
  line(/export const REPEAT_MAX = \d+;/).replace("export ", ""),
  line(/export const repeatsOf = [^\n]*/).replace("export ", ""),
  grab("addDaysKeepingLocalTime"),
  grab("addMonthsKeepingLocalTime"),
  grab("occurrenceStart"),
  grab("seriesStarts", "export function"),
  grab("overlappingSessions", "export function"),
].join("\n").replace(/export function /g, "function ");
const [seriesStarts, overlappingSessions] =
  new Function(`${scope}\nreturn [seriesStarts, overlappingSessions];`)();
const SESSION_DEFAULT_MIN = 60, REPEAT_MAX = 52;

// ── the mirror is gone, and must stay gone ──────────────────────────────────
ok("App.jsx no longer carries its own copy of the occurrence maths",
   !/^function seriesStarts\(/m.test(APP) && !/^function overlappingSessions\(/m.test(APP));
ok("...it imports them from the module that books", /seriesStarts, overlappingSessions/.test(APP));

const H = 3600000;
const at = (iso) => Date.parse(iso);

// ── the series expansion ────────────────────────────────────────────────────
{
  const one = seriesStarts(at("2026-09-07T09:00:00Z"), "none", 8);
  ok("no repeat is a single date", one.length === 1, one.length);
  const wk = seriesStarts(at("2026-09-07T09:00:00Z"), "weekly", 4);
  ok("weekly gives four dates", wk.length === 4, wk.length);
  ok("...seven days apart", wk[1] - wk[0] === 7 * 24 * H, (wk[1] - wk[0]) / (24 * H));
  const bw = seriesStarts(at("2026-09-07T09:00:00Z"), "biweekly", 3);
  ok("biweekly is fourteen days apart", bw[1] - bw[0] === 14 * 24 * H, (bw[1] - bw[0]) / (24 * H));
}
{
  // ⚠️ Month stepping must CLAMP, not roll over: Jan 31 -> Feb 28 -> Mar 31,
  // never Mar 3. Mirrors bookSeries, which S196 got right and this must match.
  const m = seriesStarts(at("2026-01-31T09:00:00Z"), "monthly", 3).map((t) => new Date(t).getDate());
  ok("monthly clamps the short month rather than rolling over",
     m[0] === 31 && m[1] <= 29 && m[2] === 31, m);
}
{
  const capped = seriesStarts(at("2026-09-07T09:00:00Z"), "weekly", 999);
  ok("the occurrence count is bounded", capped.length <= REPEAT_MAX, capped.length);
}

// ── the overlap itself ──────────────────────────────────────────────────────
const existing = [
  { id: "a", startAt: at("2026-09-07T09:00:00Z"), durationMin: 60, status: "scheduled" },
  { id: "b", startAt: at("2026-09-09T14:00:00Z"), durationMin: 30, status: "scheduled" },
  { id: "gone", startAt: at("2026-09-07T09:00:00Z"), durationMin: 60, status: "cancelled" },
];
{
  const hit = overlappingSessions(existing, [at("2026-09-07T09:30:00Z")], 60);
  ok("a partial overlap is found", hit.length === 1, hit);
  ok("...and names the session it collides with", /Sep/.test(((hit[0] || {}).label) || ""), hit[0]);
}
{
  ok("touching end-to-start is NOT an overlap",
     overlappingSessions(existing, [at("2026-09-07T10:00:00Z")], 60).length === 0);
  ok("...and neither is ending exactly when one starts",
     overlappingSessions(existing, [at("2026-09-07T08:00:00Z")], 60).length === 0);
}
{
  ok("a cancelled session does not collide",
     overlappingSessions(existing.filter((s) => s.status === "cancelled"), [at("2026-09-07T09:00:00Z")], 60).length === 0);
}
{
  // Rescheduling a session must not find itself.
  ok("the session being moved does not overlap itself",
     overlappingSessions(existing, [at("2026-09-07T09:00:00Z")], 60, "a").length === 0);
}
{
  // ⚠️ THE POINT OF EXPANDING THE SERIES. The calendar's own warning panel only
  // looks 21 days ahead, so occurrences beyond that were examined by nothing.
  // Aug 12 + 4 weeks = Sep 9, i.e. the FIFTH occurrence and 28 days out —
  // beyond the 21-day window the calendar's own warning panel ever looks at.
  const starts = seriesStarts(at("2026-08-12T14:00:00Z"), "weekly", 8);
  const hits = overlappingSessions(existing, starts, 30);
  ok("a clash in a LATER occurrence is caught", hits.length === 1, { starts: starts.map((t) => new Date(t).toISOString()), hits });
  ok("...and it is the one on Sep 9", new Date((hits[0] || {}).startAt || 0).getUTCDate() === 9, hits[0]);
  ok("...which is past the 21-day window the panel looks at",
     ((hits[0] || {}).startAt || 0) - starts[0] > 21 * 24 * H, hits[0]);
}
{
  ok("one clash is reported per requested date, not per pair",
     overlappingSessions([...existing, { id: "c", startAt: at("2026-09-07T09:15:00Z"), durationMin: 60, status: "scheduled" }],
       [at("2026-09-07T09:30:00Z")], 60).length === 1);
}
{
  ok("no sessions means no clash", overlappingSessions([], [at("2026-09-07T09:00:00Z")], 60).length === 0);
  ok("junk rows are skipped", overlappingSessions([null, {}, { startAt: 0 }], [at("2026-09-07T09:00:00Z")], 60).length === 0);
}

// ── blocks are busy too ─────────────────────────────────────────────────────
// trainerAvailability already publishes trainerBlocks to clients as busy, so
// booking straight over one is the app contradicting itself.
{
  const withBlock = [{ id: "blk:1", startAt: at("2026-09-10T12:00:00Z"), durationMin: 30 }];
  ok("a block is treated as busy by the overlap helper",
     overlappingSessions(withBlock, [at("2026-09-10T12:00:00Z")], 60).length === 1);
  ok("...and a block with no status field is not skipped as cancelled",
     overlappingSessions(withBlock, [at("2026-09-10T12:15:00Z")], 60).length === 1);
}

// ── the server refuses the one-tap path ─────────────────────────────────────
const AVAIL = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");
ok("the accept path checks for an overlap before claiming", /reason: "overlap"/.test(AVAIL));
ok("...and refuses rather than booking on top", /That overlaps a session you already have/.test(AVAIL));
ok("...using one equality, with the window filtered in code",
   /where\("trainerUid", "==", uid\)/.test(AVAIL));
ok("...and it considers the trainer's own blocked time",
   /collection\("trainerBlocks"\)\.where\("trainerUid", "==", uid\)/.test(AVAIL));
ok("...naming a block as a block when it refuses",
   /time you&#39;ve blocked out|time you've blocked out/.test(AVAIL));
ok("accepting one slot says the other offered times are released",
   /free again/.test(AVAIL));
ok("only pairs where a drive could matter are COUNTED", /RELEVANT_GAP_MIN/.test(AVAIL));
// ⚠️ ...but the ESTIMATE still runs for every pair. Bounding the estimate meant
// a >4h-apart impossible drive produced no warning AND no coverage note — a
// blank calendar on a schedule the same code would otherwise call infeasible.
ok("...while the estimate is NOT skipped by the ceiling",
   /const counts = gapMin < RELEVANT_GAP_MIN;/.test(AVAIL)
   && !/if \(!\(gapMin < RELEVANT_GAP_MIN\)\) continue;/.test(AVAIL));
ok("a trainer who uses no locations at all is not nagged",
   /if \(!sessions\.some\(\(s\) => s\.location\)\) noAddress = 0;/.test(AVAIL));
ok("the booking sheet names blocked time as blocked time",
   /time you've blocked out/.test(APP) && /allBlocks/.test(APP));
// ⚠️ ADMIN IS A UID, NEVER A PROFILE ROLE. createProfile only ever writes
// "client" or "head_trainer" and index.js mirrors admin into the custom CLAIM
// alone, so `profile.role === "admin"` is false for every real document — the
// owner's included. The traffic-aware gate read exactly that and so the one
// account meant to bypass the tier check never did.
ok("the traffic-aware gate identifies admin by UID",
   /let paid = isAdminUid\(uid\);/.test(AVAIL));
ok("...and no longer by a profile-doc role",
   !/paid = me\.role === "admin"/.test(AVAIL));
ok("...with the UID list matching the one every other function uses",
   /const ADMIN_UIDS = \["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"\];/.test(AVAIL));

ok("a soft geocode failure does not clear a cached verdict",
   !/softFail: true, softAt: Date\.now\(\), failed: false/.test(readFileSync(join(ROOT, "functions", "driveTime.js"), "utf8")));

// ── the panel can say "couldn't check" ──────────────────────────────────────
ok("sessionTravel reports what it could not estimate", /unknownPairs: unknown/.test(AVAIL));
ok("...and pairs with no address separately", /pairsWithoutAddress: noAddress/.test(AVAIL));
ok("a failed travel call is no longer rendered as an all-clear",
   /setTravel\(\{ warnings: \[\], failed: true \}\)/.test(APP));
ok("...and the panel says so", /isn&rsquo;t an all-clear/.test(APP));
ok("coverage is reported even when there ARE warnings",
   !/travel\.pairsWithoutAddress > 0\)\s*\n\s*&& !\(travel\.warnings/.test(APP));
ok("the overlap consent covers duration and repeat, not just the start",
   /const overlapKey = \[startAt, durationMin, form\.repeat, form\.count/.test(APP));
ok("...and is cleared when the form opens or closes",
   (APP.match(/setConfirmOverlap\(null\)/g) || []).length >= 5);
ok("the client check includes the trainer's blocks",
   /\.\.\.\(blocks \|\| \[\]\)\.map/.test(APP));

// ── every write path asks the question (S199q) ──────────────────────────────
// S199d guarded the trainer calendar and the one-tap Accept, and left the other
// three alone: the in-plan calendar's booking sheet, the Sessions panel, and
// RESCHEDULING, which moves a session onto an hour exactly as easily as booking
// one does. Neither screen can answer it themselves — both hold only the
// sessions between the trainer and the ONE client in front of them, so a clash
// with a different client is invisible there. The question is asked in
// sessions.js, against the trainer's whole book.
{
  const guarded = (fn) => {
    const i = SRC.indexOf(fn);
    if (i < 0) return false;
    return SRC.slice(i, i + 1400).includes("guardOverlap(");
  };
  ok("booking one session asks", guarded("export async function bookSession("));
  ok("booking a series asks", guarded("export async function bookSeries("));
  ok("...for EVERY occurrence, not just the first",
     /guardOverlap\(trainerUid, seriesStarts\(base\.startAt, repeat, n\)/.test(SRC));
  ok("rescheduling asks", guarded("export async function updateSession("));
  ok("...but only when the TIME moves — renaming should not need permission",
     /fields\.startAt !== undefined \|\| fields\.durationMin !== undefined/.test(SRC));
  ok("...and skips the session being moved, which always overlaps itself",
     /skipId: sessionId/.test(SRC));
  ok("the sessions query is constrained by participants, as the rules require",
     /where\("participants", "array-contains", trainerUid\)/.test(SRC));
  ok("the trainer's own blocks count as busy too",
     /collection\(db, "trainerBlocks"\), where\("trainerUid", "==", trainerUid\)/.test(SRC));

  // A refusal must be answerable — a trainer may genuinely want the overlap.
  const cls = /export class SessionOverlapError extends Error \{[\s\S]*?\n\}/.exec(SRC);
  ok("the refusal is a typed error a caller can offer to override", !!cls);
  const SessionOverlapError = new Function(
    `${cls[0].replace("export ", "")}\nreturn SessionOverlapError;`)();
  const hit = (id) => ({ startAt: 0, other: { id }, label: "Tue, Sep 8, 9:00 AM" });
  ok("one clash reads as one", /overlaps a session you already have at Tue, Sep 8/.test(new SessionOverlapError([hit("s1")]).message));
  ok("a clash with the trainer's own block says so, not 'a session'",
     /time you've blocked out/.test(new SessionOverlapError([hit("blk:b1")]).message));
  ok("several clashes are counted and the first named",
     /^3 of those dates overlap sessions you already have \(first: Tue, Sep 8/.test(
       new SessionOverlapError([hit("s1"), hit("s2"), hit("s3")]).message));
  ok("...and a mixed set does not call blocks sessions or vice versa",
     /sessions you already have/.test(new SessionOverlapError([hit("blk:b1"), hit("s2")]).message));
  ok("the code is machine-readable so a UI can branch on it",
     new SessionOverlapError([hit("s1")]).code === "overlap");

  // ⚠️ CONSENT COVERS THE WHOLE BOOKING AND DIES WITH ITS FORM. Keyed on the
  // start alone, a trainer warned about Tuesday 9:00 could change the duration
  // and the second tap booked a span nothing had checked; never cleared, a later
  // booking on the same instant went through with no check and no message.
  ok("the in-plan calendar keys consent on the whole booking",
     /const key = \[startAt, durationMin, bookForm\.repeat \|\| "none", bookForm\.count \|\| 1\]\.join\("\|"\)/.test(APP));
  ok("...and drops it when the sheet closes", /setBookForm\(null\); setBookErr\(""\); setBookConfirm\(null\);/.test(APP));
  ok("...and when a new one opens", /setBookConfirm\(null\);\n\s*setBookForm\(\{ id: null/.test(APP));
  ok("the sessions panel keys consent on the booking too, edit included",
     /const key = \[editingId \|\| "new", startAt, durationMin\]\.join\("\|"\)/.test(APP));
  ok("...and clears it on open and on edit",
     /const openNew = \(\) => \{ setEditingId\(null\); setErr\(""\); setOverlapOk\(null\);/.test(APP)
     && /const openEdit = \(s\) => \{ setEditingId\(s\.id\); setErr\(""\); setOverlapOk\(null\);/.test(APP));
  // The trainer calendar asked first, so it passes its own consent through
  // rather than being asked the identical question twice.
  ok("the trainer calendar threads its consent through", /allowOverlap: true, skipId: form\.id \|\| ""/.test(APP));
}

// ── the accept path is ONE transaction (S199q) ──────────────────────────────
// It used to be three steps — read the day, claim the inbox item, add() the
// session — each correct alone, with the bug living in the gaps. Two different
// requests for overlapping hours, accepted in the same second, both read a
// clear calendar and both booked: two billable sessions, nobody told.
{
  const AV = readFileSync(join(ROOT, "functions", "availability.js"), "utf8");
  const i = AV.indexOf("const sessionRef = db.collection(\"sessions\").doc();");
  ok("the session id is minted before the transaction", i > 0);
  const txStart = AV.indexOf("await db.runTransaction", i);
  const txEnd = AV.indexOf("\n    });", txStart);
  ok("the transaction is findable", txStart > 0 && txEnd > txStart);
  const tx = AV.slice(txStart, txEnd);

  ok("the overlap is read INSIDE the transaction", /tx\.get\(db\.collection\("sessions"\)/.test(tx));
  ok("...blocks too", /tx\.get\(db\.collection\("trainerBlocks"\)/.test(tx));
  ok("the session is CREATED inside the same transaction", /tx\.set\(sessionRef, \{/.test(tx));
  ok("...so the old separate add() is gone", !/collection\("sessions"\)\.add\(/.test(AV));

  // ⚠️ FIRESTORE REQUIRES ALL READS BEFORE ANY WRITE. Getting this wrong throws
  // at runtime, not at build, and only on the accept path.
  const lastGet = tx.lastIndexOf("tx.get(");
  const firstSet = tx.indexOf("tx.set(");
  ok("every read precedes every write", lastGet >= 0 && firstSet > lastGet, { lastGet, firstSet });

  // The refusal must abort before anything is claimed, or a refused request is
  // marked answered with no session against it.
  const throwAt = tx.indexOf('reason: "overlap"');
  ok("the overlap refusal fires before the claim is written", throwAt > 0 && throwAt < firstSet,
     { throwAt, firstSet });

  // releaseClaim existed to reopen a request when the create failed after the
  // claim. One commit means that window cannot open — and the reopen ran on a
  // connection that had just failed, so it was never reliable anyway.
  ok("the reopen-after-failure path is gone with the window it guarded",
     !/const releaseClaim = async/.test(AV));
}

console.log(`  ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
