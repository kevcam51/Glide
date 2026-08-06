// Owner-only private storage (S91, notes): users/{me}/privkv/{key}.
// The rules make this readable by NOBODY but the signed-in owner — not the
// trainer chain that can read kv, not the admin via the client SDK. Used for
// the client's private notes. Deliberately separate from window.storage
// (whose interface is frozen) and from clientData.js (which is about reading
// OTHER users — privkv has no cross-user access by design).
import { auth, db } from "./firebase";
import { doc, collection, getDoc, getDocs, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";

function ref(key) {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) throw new Error("Not signed in");
  return doc(db, "users", uid, "privkv", encodeURIComponent(key));
}

export async function privGet(key) {
  const snap = await getDoc(ref(key));
  return snap.exists() ? snap.data().value : null;
}

export async function privSet(key, value) {
  await setDoc(ref(key), { k: key, value: String(value) });
}

export async function privDelete(key) {
  await deleteDoc(ref(key)).catch(() => {});
}

// Live subscription to one of MY private docs; cb receives the value string
// (or null). Returns unsubscribe.
export function privSubscribe(key, cb) {
  try {
    return onSnapshot(ref(key), (s) => cb(s.exists() ? s.data().value : null), () => {});
  } catch { return () => {}; }
}

// Every private doc this account owns, for "Download my data" (S178f). Private
// notes are the one store a kv-only export would silently miss — and missing
// them would make the promise on the pricing page false in exactly the place
// people care most about.
export async function privListEntries() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return [];
  const snap = await getDocs(collection(db, "users", uid, "privkv"));
  const out = [];
  snap.forEach((d) => { const r = d.data() || {}; out.push({ k: r.k || d.id, value: r.value }); });
  return out;
}
