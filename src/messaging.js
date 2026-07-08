// In-app messaging (S90, docs/MESSAGING-PLAN.md): trainer ↔ client DMs.
// One thread per linked pair at threads/{trainerUid}_{clientUid} plus an
// append-only msgs subcollection. Access control lives entirely in
// firestore.rules (participants-only; create requires a real link) — these
// helpers just read/write the shapes the rules expect.
import { db } from "./firebase";
import {
  doc, getDoc, setDoc, updateDoc, collection, addDoc,
  query, where, orderBy, limitToLast, onSnapshot, increment,
} from "firebase/firestore";

export const threadIdFor = (trainerUid, clientUid) => `${trainerUid}_${clientUid}`;

// Create the thread if it doesn't exist yet. Field set must match the rules'
// hasOnly allowlist exactly; lastFrom must be a participant (the creator).
export async function ensureThread(trainerUid, clientUid, creatorUid) {
  const tid = threadIdFor(trainerUid, clientUid);
  const ref = doc(db, "threads", tid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return tid;
  } catch {
    // Rules DENY reading a nonexistent thread (no participants to check), so a
    // denied get means "doesn't exist yet" — fall through to create. If the doc
    // actually exists and we're not a participant, the create below is denied
    // too (update path, participants immutable), so nothing leaks or clobbers.
  }
  await setDoc(ref, {
    participants: [trainerUid, clientUid],
    trainerUid, clientUid,
    lastMsg: "", lastFrom: creatorUid, updatedAt: Date.now(),
    unread: { [trainerUid]: 0, [clientUid]: 0 },
  });
  return tid;
}

// Append a message + bump the thread metadata (lastMsg preview, the other
// side's unread count). Two writes; the msg lands first so a metadata failure
// never loses the message itself.
export async function sendMessage(tid, fromUid, toUid, text) {
  const body = String(text || "").trim().slice(0, 2000);
  if (!body) return false;
  await addDoc(collection(db, "threads", tid, "msgs"), { from: fromUid, text: body, ts: Date.now() });
  await updateDoc(doc(db, "threads", tid), {
    lastMsg: body.slice(0, 80), lastFrom: fromUid, updatedAt: Date.now(),
    [`unread.${toUid}`]: increment(1),
  }).catch(() => { /* metadata is best-effort; the message is already saved */ });
  return true;
}

// Zero my unread counter (called when the thread view is open/receives).
export function markThreadRead(tid, myUid) {
  return updateDoc(doc(db, "threads", tid), { [`unread.${myUid}`]: 0 }).catch(() => {});
}

// Live last-50 messages, oldest → newest.
export function subscribeThread(tid, cb) {
  const q = query(collection(db, "threads", tid, "msgs"), orderBy("ts"), limitToLast(50));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
}

// Live list of all my threads (client has 1; a trainer has one per client).
// Deliberately NO orderBy — array-contains alone needs no composite index;
// callers sort by updatedAt client-side.
export function subscribeMyThreads(uid, cb) {
  const q = query(collection(db, "threads"), where("participants", "array-contains", uid));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
}
