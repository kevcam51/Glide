// In-app messaging (S90, docs/MESSAGING-PLAN.md): trainer ↔ client DMs.
// One thread per linked pair at threads/{trainerUid}_{clientUid} plus an
// append-only msgs subcollection. Access control lives entirely in
// firestore.rules (participants-only; create requires a real link) — these
// helpers just read/write the shapes the rules expect.
import { db } from "./firebase";
import {
  doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs,
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
// `todoId` (optional, trainers only) turns this into a TO-DO message: the chat
// bubble becomes a tappable task card. The message stores only the POINTER —
// status lives in the client's caliq-requests item, so chat and the client's
// home can never disagree about whether a to-do is done (S124).
// `reviewId` (optional, clients only) is the mirror: a MEAL the client tagged
// and sent for their trainer to check (S183g). Same discipline — the message
// holds only the pointer; the meal itself is already in the client's day log
// and the review row carries its status, so chat can never disagree with the
// food log. The two pointers are mutually exclusive; the rules enforce both
// directions (a trainer can't tag a meal, a client can't assign a to-do).
export async function sendMessage(tid, fromUid, toUid, text, todoId = null, reviewId = null) {
  const body = String(text || "").trim().slice(0, 2000);
  if (!body) return false;
  const msg = { from: fromUid, text: body, ts: Date.now() };
  if (todoId) { msg.kind = "todo"; msg.todoId = String(todoId).slice(0, 64); }
  else if (reviewId) { msg.kind = "meal"; msg.reviewId = String(reviewId).slice(0, 64); }
  await addDoc(collection(db, "threads", tid, "msgs"), msg);
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

// Every message this user can see, flattened for "Download my data" (S178f).
// Conversations are half the record of a coaching relationship, so an export
// that skipped them would not be the "every bit of your data" the pricing page
// promises. Reads only threads the rules already let this user read.
export async function exportMyThreads(uid) {
  if (!uid) return [];
  const tq = await getDocs(query(collection(db, "threads"), where("participants", "array-contains", uid)));
  const out = [];
  for (const t of tq.docs) {
    const msgs = await getDocs(query(collection(db, "threads", t.id, "msgs"), orderBy("ts", "asc")));
    out.push({
      threadId: t.id,
      with: ((t.data() || {}).participants || []).filter((u) => u !== uid),
      messages: msgs.docs.map((m) => {
        const d = m.data() || {};
        return { from: d.from === uid ? "me" : "them", text: d.text || "", at: d.ts || null };
      }),
    });
  }
  return out;
}
