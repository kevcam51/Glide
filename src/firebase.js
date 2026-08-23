// Firebase initialization for Glide
// Config values come from Vite env vars (.env.local locally, Vercel env vars in prod).
// NOTE: The Firebase "apiKey" is NOT a secret — it only identifies your project to
// Google. Real security comes from Auth + Firestore rules (firestore.rules). It is
// safe to expose in client code, but we keep it in env vars for cleanliness.

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  terminate, clearIndexedDbPersistence } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// ── Offline cache (S196p) ───────────────────────────────────────────────────
// Firestore ships with local persistence available and Glidna had it switched
// off, so every relaunch of the installed app re-fetched everything over the
// network — a blank screen on a slow radio for data the phone had already read
// minutes earlier. With the cache on, a relaunch paints from disk immediately
// and the listeners reconcile in the background.
//
// multipleTabManager rather than the single-tab default: the same account is
// routinely open in a phone PWA and a desktop tab, and the single-tab manager
// simply refuses persistence to whichever opened second.
//
// ⚠️ It changes one behaviour worth knowing. A read can now be served from disk
// BEFORE the server answers, so a document changed elsewhere may appear stale
// for a moment. Everything that matters here is either behind an onSnapshot
// listener (which fires again with the server's copy) or re-read on open, and
// the writes are the authority either way. It is not enabled for correctness —
// it is enabled because a cold start should not be blank.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const googleProvider = new GoogleAuthProvider();
// Cloud Functions are deployed in us-central1 (see functions/). The AI chat
// callable (aiChat) and future server-side features are invoked through this.
export const functions = getFunctions(app, "us-central1");
export default app;

// ── Signing out has to clear the cache too (S197r) ──────────────────────────
// Two problems, one cause. The persistent cache above is keyed by PROJECT, not
// by user, and nothing was clearing it:
//
// 1. THE LOCK-OUT. Sign out, sign in as someone else on the same device, and
//    the app got stuck on "Couldn't load your account — check your connection"
//    and stayed stuck across full reloads. Reproduced in production, and the
//    connection was never the problem: a REST read of the very same profile,
//    with the very same token the SDK was holding, returned 200. Deleting only
//    the Firestore IndexedDB fixed it instantly.
//
// 2. THE PRIVACY HALF, which is arguably worse. Whatever the previous account
//    had read — their plans, their clients, their health data — stayed on the
//    device after they signed out, readable by whoever signed in next. Firebase
//    recommends clearing persistence on sign-out for exactly this reason.
//
// clearIndexedDbPersistence() may only run while the instance is stopped, so
// the order is fixed: sign out, terminate, clear, and then RELOAD, because `db`
// is unusable once terminated. Each step is best-effort — a failure here must
// still end with the person signed out.
export async function signOutAndClearCache() {
  try { await signOut(auth); } catch (e) { console.warn("sign-out failed", e); }
  try { await terminate(db); } catch { /* already stopped */ }
  try {
    await clearIndexedDbPersistence(db);
  } catch (e) {
    // failed-precondition means another tab still holds the cache. Nothing else
    // to do from here, and the reload below still gets this tab to a clean app.
    console.warn("could not clear the local cache:", (e && e.code) || e);
  }
  window.location.replace("/");
}
