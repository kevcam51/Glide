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
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit,
  runTransaction,
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
    if (!snap.exists()) {
      // ⚠️ ABSENCE IS NOT FAILURE, AND CALLERS NEED TO TELL THEM APART (S196L).
      // This throws for a missing key — which is the documented behaviour and
      // stays that way, because callers rely on it. But an unreachable database
      // throws too, and the two are opposite answers: "nothing logged that day"
      // is the normal case the calendar is built on, while "could not read" must
      // stop a write that would overwrite real data. A caller cannot distinguish
      // them from the message alone without matching on English.
      //
      // So the absence case carries a marker. Purely additive — the throw, its
      // type and its text are unchanged, so nothing that catches it today
      // behaves differently. `getForUser` (clientData.js) answers the same
      // question by returning null; that asymmetry between the two accessors is
      // exactly what made this worth naming rather than papering over.
      // ⚠️ AND THE OFFLINE CACHE CAN FAKE AN ABSENCE (S197s). getDoc() waits for
      // the server when it can, but when it CANNOT it falls back to the local
      // cache — and a document that exists on the server but was never cached
      // comes back exists() === false. Callers read that as "nothing logged
      // that day", write a fresh object over the top, and the real day is gone
      // as soon as the connection returns. That is precisely the data-loss
      // shape S196L/S197 fixed three times; the persistent cache (S196p)
      // quietly reopened it.
      //
      // snap.metadata.fromCache is the discriminator: an online getDoc round-
      // trips, so fromCache means the server was never heard from and this
      // absence is UNKNOWN rather than confirmed. It gets a different code, so
      // the `not-found` handlers — which correctly mean "empty day" — do not
      // swallow it and overwrite real data.
      if (snap.metadata && snap.metadata.fromCache) {
        const err = new Error("Offline — can't confirm whether this exists: " + key);
        err.code = "unavailable";
        throw err;
      }
      const err = new Error("Key not found: " + key);
      err.code = "not-found";
      throw err;
    }
    return { key, value: snap.data().value, shared: false };
  },

  async set(key, value) {
    await ready;
    const uid = requireUid();
    await setDoc(kvDoc(uid, key), { k: key, value });
    return { key, value, shared: false };
  },

  // Read-modify-write ONE key inside a transaction (S197m).
  //
  // ⚠️ ADDITIVE. get/set/delete/list are untouched — App.jsx depends on their
  // exact behaviour and this adds a fifth door rather than changing any of them.
  //
  // `fn(currentValueString | null)` returns the string to write, and is RE-RUN
  // if the document changed under us, so it must be a pure function of its
  // argument. Returning null/undefined writes nothing.
  //
  // This exists because the app saves whole documents from React state: without
  // it, a save lands on top of anything the AI or the Trainerize sync wrote
  // while someone was typing. See src/planMerge.js for the argument.
  async mergeSet(key, fn) {
    await ready;
    const uid = requireUid();
    const ref = kvDoc(uid, key);
    let written = null;
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists() ? snap.data().value : null;
        const next = fn(cur);
        if (next == null) { written = null; return; }
        tx.set(ref, { k: key, value: next });
        written = next;
      });
      return { key, value: written, shared: false };
    } catch (e) {
      // ⚠️ A TRANSACTION CANNOT COMMIT OFFLINE, AND setDoc CAN (S197u).
      // This is the cost of merging: runTransaction needs a server round trip,
      // so on a dead radio it rejects — where the plain write it replaced would
      // have queued in the local cache and synced later. autoSave swallows save
      // errors, so the edit would simply vanish. That is a worse bug than the
      // one merging fixes.
      //
      // Offline there is no server copy to merge against anyway, so falling
      // back to the whole-document write is not a compromise — it is the only
      // meaningful answer, and it is exactly what this did before.
      const offline = e && (e.code === "unavailable" || e.code === "failed-precondition"
        || e.code === "deadline-exceeded");
      if (!offline) throw e;
      let cur = null;
      try { const s = await getDoc(ref); cur = s.exists() ? s.data().value : null; } catch { /* cache miss → treat as new */ }
      const next = fn(cur);
      if (next == null) return { key, value: null, shared: false };
      await setDoc(ref, { k: key, value: next });   // queues in the offline cache
      return { key, value: next, shared: false, offlineQueued: true };
    }
  },

  async delete(key) {
    await ready;
    const uid = requireUid();
    await deleteDoc(kvDoc(uid, key));
    return { key, deleted: true, shared: false };
  },

  // The NEWEST key under a prefix, and nothing else (S196o).
  //
  // ⚠️ list() DOWNLOADS EVERY MATCHING DOCUMENT — Firestore's web SDK has no
  // projection, so asking for keys still pulls each doc's full `value`, i.e.
  // every meal, macro and micronutrient of every logged day. The trainer home
  // used list("caliq-log-") purely to find each plan's most recent date, which
  // for an imported roster meant several megabytes and thousands of billed
  // reads to compute one string per plan.
  //
  // Ordering by the same field the range filters on needs no composite index,
  // so this is one document per call. Same shape the server-side roster query
  // has used since S85.
  async latestKey(prefix) {
    await ready;
    const uid = requireUid();
    const snap = await getDocs(query(
      kvCol(uid),
      where("k", ">=", prefix), where("k", "<=", prefix + "\uf8ff"),
      orderBy("k", "desc"), limit(1),
    ));
    let key = null;
    snap.forEach((d) => { if (!key) key = (d.data() || {}).k || null; });
    return key;
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

  // Same range query as list(), but returns each doc's VALUE too. getDocs()
  // already transfers (and bills for) the full documents — list() just discards
  // the values — so reading them here is free, and it turns "one range query per
  // prefix" into enough data to compute lifetime stats without a get() per day.
  async listEntries(prefix) {
    await ready;
    const uid = requireUid();
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
