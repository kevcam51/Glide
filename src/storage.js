// Glidna storage layer — Firestore-backed, drop-in replacement for the old
// localStorage polyfill. The rest of the app keeps calling window.storage.get/
// set/delete/list exactly as before; only the implementation underneath changed.
//
// Data model: each user's data lives under  users/{uid}/kv/{encodedKey}
//   - field "k"     : the original key (e.g. "calorieiq:clients")
//   - field "value" : the stored string (app already JSON.stringifies its data)
// This isolates every user to their own namespace. Firestore security rules
// (see firestore.rules) enforce that a user can only touch users/{their-uid}/**.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where,
} from "firebase/firestore";

// --- track the signed-in user ------------------------------------------------
let currentUid = null;
let resolveReady;
const ready = new Promise((res) => { resolveReady = res; });

onAuthStateChanged(auth, (user) => {
  currentUid = user ? user.uid : null;
  resolveReady(); // unblock any storage calls waiting on first auth resolution
});

function requireUid() {
  if (!currentUid) {
    throw new Error("storage: no authenticated user (call after login)");
  }
  return currentUid;
}

// Firestore doc IDs can't contain "/", so encode keys. Original key is also
// stored in the "k" field so list() can return the real keys.
const encodeKey = (key) => encodeURIComponent(key);
const kvCol = (uid) => collection(db, "users", uid, "kv");
const kvDoc = (uid, key) => doc(db, "users", uid, "kv", encodeKey(key));

const firestoreStorage = {
  async get(key) {
    await ready;
    const uid = requireUid();
    const snap = await getDoc(kvDoc(uid, key));
    if (!snap.exists()) throw new Error("Key not found: " + key);
    return { key, value: snap.data().value, shared: false };
  },

  async set(key, value) {
    await ready;
    const uid = requireUid();
    await setDoc(kvDoc(uid, key), { k: key, value });
    return { key, value, shared: false };
  },

  async delete(key) {
    await ready;
    const uid = requireUid();
    await deleteDoc(kvDoc(uid, key));
    return { key, deleted: true, shared: false };
  },

  async list(prefix) {
    await ready;
    const uid = requireUid();
    // With a prefix, use a range query on the stored "k" field so Firestore
    // only reads (and bills) the matching docs — a full-collection scan here
    // was the app's biggest read amplifier (every list() fetched every daily
    // log with its full value). "" is the standard high-codepoint prefix
    // upper bound. No prefix = the export path's deliberate full scan.
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
    return { keys, prefix, shared: false };
  },
};

window.storage = firestoreStorage;

// --- one-time migration: copy this device's old localStorage data into ----------
// Firestore for the signed-in user. Safe: only writes keys that don't already
// exist in the cloud, so re-running it won't clobber newer cloud data.
// Call window.migrateLocalToCloud() once from the browser console after logging
// in on the device that holds your existing client data.
window.migrateLocalToCloud = async function migrateLocalToCloud() {
  await ready;
  const uid = requireUid();
  let copied = 0, skipped = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k);
    const existing = await getDoc(kvDoc(uid, k));
    if (existing.exists()) { skipped++; continue; }
    await setDoc(kvDoc(uid, k), { k, value: v });
    copied++;
  }
  const msg = `Migration done — copied ${copied} key(s), skipped ${skipped} already in cloud.`;
  console.log(msg);
  return msg;
};

export default firestoreStorage;
