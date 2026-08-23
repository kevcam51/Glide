// clientData.js — cross-account data access for the trainer ↔ client connection.
//
// A trainer may read/write a *linked* client's data because firestore.rules
// already grant the client's direct trainer (and the head above them) access to
//   users/{clientUid}/kv/**
// This file is a separate, explicit accessor used ONLY for linked clients. It
// deliberately does NOT touch the `window.storage` interface (which is scoped to
// the signed-in user and which the rest of the app depends on) — it mirrors the
// same Firestore layout (users/{uid}/kv/{encodedKey} with fields k + value) but
// takes the target user's uid as an argument.
//
// Security note: these calls succeed only when the signed-in user is allowed by
// firestore.rules to touch the target uid's kv (owner, admin, the owner's direct
// trainer, or the head above that trainer). Any other caller is denied by the
// rules — this code can't widen access, it just uses the access that exists.

import { db } from "./firebase.js";
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, onSnapshot, query, where, orderBy, limit,
  runTransaction,
} from "firebase/firestore";

const encodeKey = (key) => encodeURIComponent(key);
const kvDoc = (uid, key) => doc(db, "users", uid, "kv", encodeKey(key));
const kvCol = (uid) => collection(db, "users", uid, "kv");

// Read one key from a specific user's namespace. Returns { key, value } or null.
export async function getForUser(uid, key) {
  if (!uid) throw new Error("getForUser: missing uid");
  const snap = await getDoc(kvDoc(uid, key));
  if (snap.exists()) return { key, value: snap.data().value };
  // Absence is normally a real answer and callers rely on the null. But when the
  // snapshot came from the offline cache the server was never reached, so this
  // "missing" may be a document that exists and simply was not cached — and the
  // caller would write over it. Same reasoning as window.storage.get (S197s).
  if (snap.metadata && snap.metadata.fromCache) {
    const err = new Error("Offline — can't confirm whether this exists: " + key);
    err.code = "unavailable";
    throw err;
  }
  return null;
}

// Write one key into a specific user's namespace.
export async function setForUser(uid, key, value) {
  if (!uid) throw new Error("setForUser: missing uid");
  await setDoc(kvDoc(uid, key), { k: key, value });
  return { key, value };
}

// Read-modify-write one key in a specific user's namespace, inside a
// transaction — the cross-account twin of window.storage.mergeSet (S197m).
//
// The trainer editing a linked client's plan is the case this matters most for:
// the client is on their own home screen, and the AI may be writing the same
// document, so a whole-document save from the trainer's browser lands on top of
// both. `fn(currentValueString | null)` returns the string to write and is
// RE-RUN on contention, so it must be pure. Returning null writes nothing.
export async function mergeForUser(uid, key, fn) {
  if (!uid) throw new Error("mergeForUser: missing uid");
  const ref = kvDoc(uid, key);
  let written = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data().value : null;
    const next = fn(cur);
    if (next == null) { written = null; return; }
    tx.set(ref, { k: key, value: next });
    written = next;
  });
  return { key, value: written };
}

// Delete one key from a specific user's namespace.
export async function deleteForUser(uid, key) {
  if (!uid) throw new Error("deleteForUser: missing uid");
  await deleteDoc(kvDoc(uid, key));
  return { key, deleted: true };
}

// Subscribe to one key in a specific user's namespace for real-time updates.
// Calls cb(value | null) immediately with the current value and again on every
// server-side change. Returns an unsubscribe function. A failing listener never
// crashes the app — it goes quiet, and the manual Refresh / next open still
// works.
//
// ⚠️ BUT "GOES QUIET" USED TO MEAN COMPLETELY SILENT (S197g). The error handler
// was an empty function, so a listener that died — a denied read after a rules
// change, an expired token, a dropped connection Firestore gave up on — left
// the screen showing data that had simply stopped updating, with nothing in the
// console and no way to tell from the outside. That is the failure mode behind
// "it was showing me the old number": indistinguishable from nothing having
// changed. The listener is still non-fatal; it is just no longer invisible.
export function subscribeForUser(uid, key, cb, onError) {
  if (!uid) return () => {};
  return onSnapshot(
    kvDoc(uid, key),
    (snap) => cb(snap.exists() ? snap.data().value : null),
    (err) => {
      console.warn(`live sync stopped for ${key}:`, (err && err.code) || err);
      if (onError) { try { onError(err); } catch { /* a reporter must not throw */ } }
    },
  );
}

// List keys (optionally filtered by prefix) in a specific user's namespace.
// With a prefix this uses a range query on "k" so only matching docs are read
// (and billed) — the trainer dashboards call this once PER CLIENT, so a full
// collection scan here scaled reads with every client's entire log history.
// The newest key under a prefix in another user's namespace — one document,
// not their whole history (S196o). listForUser downloads every matching doc in
// full (Firestore's web SDK has no projection), and the trainer roster used it
// per client purely to find each one's most recent log date. Ordering by the
// same field the range filters on needs no composite index.
export async function latestKeyForUser(uid, prefix) {
  if (!uid) throw new Error("latestKeyForUser: missing uid");
  const snap = await getDocs(query(
    kvCol(uid),
    where("k", ">=", prefix), where("k", "<=", prefix + "\uf8ff"),
    orderBy("k", "desc"), limit(1),
  ));
  let key = null;
  snap.forEach((d) => { if (!key) key = (d.data() || {}).k || null; });
  return key;
}

export async function listForUser(uid, prefix) {
  if (!uid) throw new Error("listForUser: missing uid");
  const snap = await getDocs(
    prefix
      ? query(kvCol(uid), where("k", ">=", prefix), where("k", "<=", prefix + "\uf8ff"))
      : kvCol(uid)
  );
  const keys = [];
  snap.forEach((d) => {
    const k = d.data().k;
    if (!prefix || (k && k.startsWith(prefix))) keys.push(k);
  });
  return { keys, prefix };
}

// listForUser + values. Same reasoning as storage.listEntries: getDocs already
// pulls the whole document, so returning `value` costs nothing extra.
export async function listEntriesForUser(uid, prefix) {
  if (!uid) throw new Error("listEntriesForUser: missing uid");
  const snap = await getDocs(
    prefix
      ? query(kvCol(uid), where("k", ">=", prefix), where("k", "<=", prefix + "\uf8ff"))
      : kvCol(uid)
  );
  const entries = [];
  snap.forEach((d) => {
    const row = d.data();
    if (!prefix || (row.k && row.k.startsWith(prefix))) entries.push({ k: row.k, value: row.value });
  });
  return { entries, prefix };
}
