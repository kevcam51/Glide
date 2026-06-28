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
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, onSnapshot,
} from "firebase/firestore";

const encodeKey = (key) => encodeURIComponent(key);
const kvDoc = (uid, key) => doc(db, "users", uid, "kv", encodeKey(key));
const kvCol = (uid) => collection(db, "users", uid, "kv");

// Read one key from a specific user's namespace. Returns { key, value } or null.
export async function getForUser(uid, key) {
  if (!uid) throw new Error("getForUser: missing uid");
  const snap = await getDoc(kvDoc(uid, key));
  return snap.exists() ? { key, value: snap.data().value } : null;
}

// Write one key into a specific user's namespace.
export async function setForUser(uid, key, value) {
  if (!uid) throw new Error("setForUser: missing uid");
  await setDoc(kvDoc(uid, key), { k: key, value });
  return { key, value };
}

// Delete one key from a specific user's namespace.
export async function deleteForUser(uid, key) {
  if (!uid) throw new Error("deleteForUser: missing uid");
  await deleteDoc(kvDoc(uid, key));
  return { key, deleted: true };
}

// Subscribe to one key in a specific user's namespace for real-time updates.
// Calls cb(value | null) immediately with the current value and again on every
// server-side change. Returns an unsubscribe function. Errors (e.g. a denied
// read) are swallowed so a listener can never crash the app — it just goes
// quiet, and the manual Refresh / next open still works.
export function subscribeForUser(uid, key, cb) {
  if (!uid) return () => {};
  return onSnapshot(
    kvDoc(uid, key),
    (snap) => cb(snap.exists() ? snap.data().value : null),
    () => {},
  );
}

// List keys (optionally filtered by prefix) in a specific user's namespace.
export async function listForUser(uid, prefix) {
  if (!uid) throw new Error("listForUser: missing uid");
  const snap = await getDocs(kvCol(uid));
  const keys = [];
  snap.forEach((d) => {
    const k = d.data().k;
    if (!prefix || (k && k.startsWith(prefix))) keys.push(k);
  });
  return { keys, prefix };
}
