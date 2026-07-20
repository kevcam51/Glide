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
