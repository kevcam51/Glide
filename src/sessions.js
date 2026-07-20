// Training sessions / appointments (S100, docs/SESSIONS-BILLING-PLAN.md).
//
// One doc per booked session at sessions/{sid}. The TRAINER books; either side
// may cancel. Access control lives entirely in firestore.rules (participants
// only; create requires a real trainer↔client link) — these helpers just
// read/write the shapes the rules expect, exactly like src/messaging.js.
//
// ⚠️ Billing fields (settled / settledAt / chargeId / completedAt) are written
// ONLY by the server (the future settle dispatcher, Admin SDK). Nothing in this
// file may write them — the rules reject it, and that's deliberate: those
// fields decide whether real money moves.
//
// Queries use where('participants','array-contains', uid) — a single-field
// index, so no composite index is needed. Ordering/filtering by time happens
// in JS on the returned set (a person's session list is small). If that ever
// grows past a few thousand, add a composite index and paginate.
import { db } from "./firebase";
import {
  doc, collection, addDoc, updateDoc, getDocs, query, where, onSnapshot,
} from "firebase/firestore";

export const SESSION_DEFAULT_MIN = 60;

// Sort helper — soonest first. Exported so the UI never re-implements it.
export const bySoonest = (a, b) => (a.startAt || 0) - (b.startAt || 0);

// A session is "past" once its END time has gone by (a session in progress is
// still upcoming — it hasn't happened yet as far as the client is concerned).
export const sessionEndMs = (s) => (s.startAt || 0) + (s.durationMin || SESSION_DEFAULT_MIN) * 60000;
export const isPastSession = (s, now = Date.now()) => sessionEndMs(s) <= now;

// Book a session. Only a trainer can call this successfully — the rules check
// that request.auth.uid === trainerUid AND that the client is really theirs.
export async function bookSession(trainerUid, clientUid, {
  startAt, durationMin = SESSION_DEFAULT_MIN, title = "", location = "", priceCents = 0,
}) {
  const now = Date.now();
  const ref = await addDoc(collection(db, "sessions"), {
    participants: [trainerUid, clientUid],
    trainerUid, clientUid,
    startAt: Number(startAt),
    durationMin: Number(durationMin) || SESSION_DEFAULT_MIN,
    status: "scheduled",
    title: String(title || "").slice(0, 80),
    location: String(location || "").slice(0, 120),
    priceCents: Math.max(0, Math.round(Number(priceCents) || 0)),
    createdBy: trainerUid, createdAt: now, updatedAt: now,
  });
  return ref.id;
}

// Reschedule / retitle / re-price — trainer only (rules enforce it).
export function updateSession(sessionId, fields) {
  const patch = { updatedAt: Date.now() };
  for (const k of ["startAt", "durationMin", "title", "location", "priceCents"]) {
    if (fields[k] !== undefined) patch[k] = fields[k];
  }
  return updateDoc(doc(db, "sessions", sessionId), patch);
}

// Cancel — either side. The rules let a client write ONLY these fields, so the
// same call works for both roles.
export function cancelSession(sessionId, byUid, reason = "") {
  return updateDoc(doc(db, "sessions", sessionId), {
    status: "cancelled",
    cancelledBy: byUid,
    cancelledAt: Date.now(),
    cancelReason: String(reason || "").slice(0, 200),
    updatedAt: Date.now(),
  });
}

// One-shot read of every session I'm part of (trainer or client), soonest first.
export async function listMySessions(uid) {
  const snap = await getDocs(query(collection(db, "sessions"), where("participants", "array-contains", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(bySoonest);
}

// Live version — the calendar and the client's home both stay current when the
// other side books or cancels (same onSnapshot approach as the plan/log sync).
export function subscribeMySessions(uid, cb) {
  return onSnapshot(
    query(collection(db, "sessions"), where("participants", "array-contains", uid)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(bySoonest)),
    () => cb([]), // denied/offline → empty rather than throwing into the UI
  );
}

// Group sessions by local YYYY-MM-DD so the calendar can look up a day in O(1).
// Key must be LOCAL (ymdLocal semantics) — never UTC (S45).
export function sessionsByDay(sessions) {
  const out = {};
  for (const s of sessions || []) {
    if (!s.startAt) continue;
    const d = new Date(s.startAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    (out[k] = out[k] || []).push(s);
  }
  Object.values(out).forEach((arr) => arr.sort(bySoonest));
  return out;
}

// ─── Cancellation policy + prepaid packs (S100b, Kevin's rules) ─────────────
// The trainer sets their OWN cancellation window and pack prices — Glide never
// presets them (the trainer-set-pricing principle from the plan doc). Both live
// on the TRAINER's profile doc, which every signed-in user can already read via
// the trainer-directory rule, so a client can always see the policy they're
// agreeing to BEFORE they buy. Credits themselves are server-only.

// Offered as starting points in the UI; a trainer can pick one or write their own.
export const CANCEL_WINDOW_PRESETS = [6, 12, 24, 48, 72];

export const DEFAULT_SESSION_POLICY = {
  cancelWindowHours: 24,     // cancel earlier than this = free
  lateCancelChargePct: 100,  // % of the session price charged for a late CLIENT cancel
  noShowChargePct: 100,      // % charged when the client simply doesn't show
  policyNote: "",            // trainer's own wording, shown to clients verbatim
};

// General packs offered to every trainer as a starting point. A trainer can use
// these, edit them, or build their own — Kevin: "general pack options ... but
// also allow them to create their own."
export const STARTER_PACKS = [
  { id: "pack5",  name: "5 sessions",  sessions: 5,  priceCents: 0, active: false },
  { id: "pack10", name: "10 sessions", sessions: 10, priceCents: 0, active: false },
  { id: "pack20", name: "20 sessions", sessions: 20, priceCents: 0, active: false },
];

// Read a trainer's policy with defaults filled in. Never throws — a missing or
// partial policy falls back to the defaults rather than leaving the UI blank.
export function policyOf(trainerProfile) {
  const p = (trainerProfile && trainerProfile.sessionPolicy) || {};
  const hrs = Number(p.cancelWindowHours);
  return {
    cancelWindowHours: Number.isFinite(hrs) && hrs >= 0 && hrs <= 336 ? hrs : DEFAULT_SESSION_POLICY.cancelWindowHours,
    lateCancelChargePct: clampPct(p.lateCancelChargePct, DEFAULT_SESSION_POLICY.lateCancelChargePct),
    noShowChargePct: clampPct(p.noShowChargePct, DEFAULT_SESSION_POLICY.noShowChargePct),
    policyNote: String(p.policyNote || "").slice(0, 400),
  };
}
const clampPct = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : dflt;
};

export function packsOf(trainerProfile) {
  const list = (trainerProfile && trainerProfile.sessionPacks) || [];
  return (Array.isArray(list) ? list : []).filter((p) => p && p.active && Number(p.sessions) > 0);
}

// Is cancelling THIS session right now inside the late window?
// Deliberately pure + shared: the UI warns with it before you confirm, and the
// billing sweep will judge with the identical function, so what the client was
// warned about and what they're charged for can never drift apart.
export function isLateCancel(session, policy, atMs = Date.now()) {
  if (!session || !session.startAt) return false;
  const windowMs = (policy ? policy.cancelWindowHours : DEFAULT_SESSION_POLICY.cancelWindowHours) * 3600000;
  return session.startAt - atMs < windowMs;
}

// What a late cancel would actually COST — the number the client must see
// before they confirm. A trainer-initiated cancel is ALWAYS free (Kevin's
// rule: "the trainer has the option to cancel or reschedule ... and if they do
// so then they will not be charged"), so this only ever applies to the client.
export function lateCancelFeeCents(session, policy, byUid, atMs = Date.now()) {
  if (!session || byUid !== session.clientUid) return 0;      // trainer cancel → free
  if (!isLateCancel(session, policy, atMs)) return 0;          // in time → free
  const pct = policy ? policy.lateCancelChargePct : DEFAULT_SESSION_POLICY.lateCancelChargePct;
  return Math.round((Number(session.priceCents) || 0) * pct / 100);
}

// One-line human policy, e.g. "Free cancellation up to 24 hours before.
// Cancelling later is charged 100% of the session."
export function describePolicy(policy) {
  const p = policy || DEFAULT_SESSION_POLICY;
  const hrs = p.cancelWindowHours;
  const when = hrs === 0 ? "any time" : hrs % 24 === 0 && hrs >= 24
    ? `${hrs / 24} ${hrs === 24 ? "day" : "days"} before`
    : `${hrs} ${hrs === 1 ? "hour" : "hours"} before`;
  if (hrs === 0) return "Cancel any time at no charge.";
  return p.lateCancelChargePct > 0
    ? `Free cancellation up to ${when}. Cancelling later is charged ${p.lateCancelChargePct}% of the session.`
    : `Free cancellation up to ${when}.`;
}

// Save a trainer's policy / packs onto their own profile doc.
export function saveSessionPolicy(trainerUid, policy) {
  return updateDoc(doc(db, "users", trainerUid), { sessionPolicy: policy });
}
export function saveSessionPacks(trainerUid, packs) {
  return updateDoc(doc(db, "users", trainerUid), { sessionPacks: packs });
}
