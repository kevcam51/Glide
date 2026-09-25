// Smooth Training HQ — the owner's desk and the crew's time cards (S238, piece 2).
//
// The HQ (src/HQ.jsx) is Kevin's AI business crew drawn as a building. This is
// the part that holds real state:
//
//   hqDesk/{id}    — everything waiting on the owner: a report, a draft to
//                    review, a question, a heads-up. One tray, whatever
//                    department it came from. Nothing on it has been sent,
//                    paid or published — that is the owner's decision.
//   hqShifts/{id}  — one time card per worker shift: when it clocked in and
//                    out, what it looked at, what it handed over, what it cost.
//
// ⚠️ ADMIN-SDK-ONLY, SERVER-CHECKED. firestore.rules has no match for either
// collection, so every client read or write is denied by default — the owner's
// account included — the same pattern as `workflows` and `webauthnCreds`. The
// only way in is the `hqApi` callable below, which checks the caller's uid on
// the server. So "hidden from everyone but the owner" does not rest on a menu
// row the app chooses not to draw: a copied request from any other account is
// refused here.
//
// ⚠️ WORKERS WRITE THROUGH postDeskItem / logShift, NEVER RAW. Whoever hands
// work to the desk — a Glidna cloud worker, or a Claude routine arriving
// through a door built in a later piece — goes through the sanitizers, so a
// worker can never file an item as already "done", back-date it, point a link
// at a non-https URL, or bury the desk under an unbounded body. The worker is a
// model; its output is input.
//
// The crew's rules (hqOrg.js CREW_RULES) are product law: drafts never send,
// money never moves, nothing is deleted. This file only ever ADDS items and
// time cards and lets the owner change an item's status — there is no delete.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { spendReport, setCosts } = require("./hqSpend");

// Admin is a UID, never a profile role (S199g/h). Mirrors aichat.js,
// firestore.rules isAdmin() and every other copy; scripts/test-target-parity.mjs
// requires this file to declare the same one.
const ADMIN_UIDS = ["G7QUZ8Kat1fgyoMjdGKz4DYoVHi1"];
function isAdminUid(uid) { return ADMIN_UIDS.includes(uid); }

const KINDS = ["report", "draft", "question", "alert", "note"];
const STATUSES = ["open", "done", "dismissed"];
const ENGINES = ["claude", "cloud", "manual"];
const SHIFT_STATUSES = ["done", "failed", "skipped"];

// Big enough for a weekly report, small enough that one worker can't bury the
// desk or bloat the overview the phone downloads.
const CAP = {
  title: 120, summary: 600, body: 20000, headNote: 600,
  linkLabel: 60, url: 2000, action: 200, actions: 30, deskRefs: 10, shiftSummary: 600,
};
// Seat and room ids from src/hqOrg.js: "bookkeeper", "front-desk", "finance".
const SEAT_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
// Firestore auto-ids (20 chars) and anything reasonable a caller might pass.
const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
// No timestamp before the HQ existed, and none more than a day ahead.
const EARLIEST = Date.UTC(2026, 0, 1);

function bad(msg) { return new HttpsError("invalid-argument", msg); }

// Plain text only: control characters out (newlines and tabs stay), trimmed,
// capped. React escapes it on the way to the screen, so no HTML survives.
function clean(v, max) {
  if (v == null) return "";
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

function sanitizeLink(link) {
  if (link == null || link === "") return null;
  if (typeof link !== "object") throw bad("link must be { label, url }.");
  const url = clean(link.url, CAP.url);
  let parsed;
  try { parsed = new URL(url); } catch { throw bad("link.url is not a valid address."); }
  if (parsed.protocol !== "https:") throw bad("link.url must start with https://.");
  return { label: clean(link.label, CAP.linkLabel) || "Open", url: parsed.toString() };
}

// What a worker may put on the desk. Everything the desk itself owns — the
// status, when it was filed, when it was handled — is set here or by the
// owner, never taken from the worker.
function sanitizeDeskItem(input) {
  const i = input && typeof input === "object" ? input : {};
  const worker = clean(i.worker, 60);
  const dept = clean(i.dept, 60);
  if (!SEAT_ID.test(worker)) throw bad("worker must be a seat id such as \"bookkeeper\".");
  if (!SEAT_ID.test(dept)) throw bad("dept must be a room id such as \"finance\".");
  if (!KINDS.includes(i.kind)) throw bad(`kind must be one of: ${KINDS.join(", ")}.`);
  const title = clean(i.title, CAP.title);
  if (!title) throw bad("title is required.");
  return {
    worker, dept, kind: i.kind, title,
    summary: clean(i.summary, CAP.summary),
    body: clean(i.body, CAP.body),
    headNote: clean(i.headNote, CAP.headNote) || null,
    link: sanitizeLink(i.link),
    engine: ENGINES.includes(i.engine) ? i.engine : "manual",
  };
}

function sanitizeShift(input, now = Date.now()) {
  const i = input && typeof input === "object" ? input : {};
  const worker = clean(i.worker, 60);
  const dept = clean(i.dept, 60);
  if (!SEAT_ID.test(worker)) throw bad("worker must be a seat id such as \"bookkeeper\".");
  if (!SEAT_ID.test(dept)) throw bad("dept must be a room id such as \"finance\".");
  const status = SHIFT_STATUSES.includes(i.status) ? i.status : "done";
  const inRange = (t) => Number.isFinite(t) && t >= EARLIEST && t <= now + 86400000;
  const endedAt = inRange(Number(i.endedAt)) ? Number(i.endedAt) : now;
  const startedAt = inRange(Number(i.startedAt)) && Number(i.startedAt) <= endedAt ? Number(i.startedAt) : endedAt;
  const actions = (Array.isArray(i.actions) ? i.actions : [])
    .map((a) => clean(a, CAP.action)).filter(Boolean).slice(0, CAP.actions);
  const deskItems = (Array.isArray(i.deskItems) ? i.deskItems : [])
    .map((d) => clean(d, 64)).filter((d) => DOC_ID.test(d)).slice(0, CAP.deskRefs);
  const count = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);
  const usage = i.usage && typeof i.usage === "object"
    ? { inputTokens: count(i.usage.inputTokens), outputTokens: count(i.usage.outputTokens) }
    : null;
  const cost = Number(i.costCents);
  return {
    worker, dept, status, startedAt, endedAt,
    engine: ENGINES.includes(i.engine) ? i.engine : "manual",
    summary: clean(i.summary, CAP.shiftSummary),
    actions, deskItems, usage,
    costCents: Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) / 100 : null,
  };
}

// ── What workers call ───────────────────────────────────────────────────────

async function postDeskItem(db, input, now = Date.now()) {
  const item = sanitizeDeskItem(input);
  const ref = db.collection("hqDesk").doc();
  await ref.set({ ...item, status: "open", createdAt: now, updatedAt: now, resolvedAt: null });
  return ref.id;
}

async function logShift(db, input, now = Date.now()) {
  const shift = sanitizeShift(input, now);
  const ref = db.collection("hqShifts").doc();
  await ref.set({ ...shift, loggedAt: now });
  return ref.id;
}

// ── What the owner's HQ screen calls ────────────────────────────────────────

const withId = (d) => ({ id: d.id, ...d.data() });

async function overview(db) {
  // Each query is single-field, so Firestore's automatic indexes serve it and
  // no composite index has to exist first. Open items are fetched by status
  // alone and sorted here: an ordered, limited query would silently drop an
  // old item still waiting on the owner once newer ones pushed it past the
  // limit, and an unanswered item vanishing is the one failure a desk cannot
  // have.
  const [openSnap, recentSnap, shiftSnap] = await Promise.all([
    db.collection("hqDesk").where("status", "==", "open").limit(300).get(),
    db.collection("hqDesk").orderBy("resolvedAt", "desc").limit(25).get(),
    db.collection("hqShifts").orderBy("startedAt", "desc").limit(40).get(),
  ]);
  const open = openSnap.docs.map(withId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const recent = recentSnap.docs.map(withId).filter((d) => d.status !== "open" && d.resolvedAt);
  const shifts = shiftSnap.docs.map(withId);
  return { open, recent, shifts, openMore: openSnap.docs.length >= 300 };
}

async function resolve(db, data, now) {
  const id = String((data && data.id) || "");
  const status = data && data.status;
  if (!DOC_ID.test(id)) throw bad("id is missing or malformed.");
  if (!STATUSES.includes(status)) throw bad(`status must be one of: ${STATUSES.join(", ")}.`);
  const ref = db.collection("hqDesk").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That item is no longer on the desk.");
  await ref.update({ status, updatedAt: now, resolvedAt: status === "open" ? null : now });
  return { ok: true, id, status };
}

async function handleHq(request, db, now = Date.now()) {
  const uid = request && request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!isAdminUid(uid)) throw new HttpsError("permission-denied", "The HQ is only open to the owner.");
  const data = (request && request.data) || {};
  const action = String(data.action || "overview");
  if (action === "overview") return overview(db);
  if (action === "resolve") return resolve(db, data, now);
  // The spending view (hqSpend.js) throws plain errors carrying a code; the
  // callable turns only HttpsErrors into a readable message, so translate.
  if (action === "spend" || action === "setCosts") {
    try {
      return action === "spend" ? await spendReport(db, data, now) : await setCosts(db, data, now);
    } catch (e) {
      if (e && e.code === "invalid-argument") throw bad(e.message);
      throw e;
    }
  }
  throw bad(`Unknown action "${action}".`);
}

exports.hqApi = onCall(
  { region: "us-central1", maxInstances: 5, timeoutSeconds: 30 },
  (request) => handleHq(request, admin.firestore()),
);

// For workers (later pieces) and the suite.
exports.postDeskItem = postDeskItem;
exports.logShift = logShift;
exports._handleHq = handleHq;
exports._sanitizeDeskItem = sanitizeDeskItem;
exports._sanitizeShift = sanitizeShift;
exports.HQ_LIMITS = { KINDS, STATUSES, ENGINES, SHIFT_STATUSES, CAP };
