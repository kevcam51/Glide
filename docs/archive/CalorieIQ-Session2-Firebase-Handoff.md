# CalorieIQ — Session 2: Firebase Auth + Firestore Setup (Claude Code Handoff)

You are working in the **CalorieIQ** project. This document is a complete, self-contained
spec for the task. Read it fully, then execute the checklist. The owner (Kevin) is not
comfortable with manual terminal/file work, so please do all file creation, package
installs, and verification yourself, and explain what you did in plain language.

---

## Project context

- **What it is:** CalorieIQ is a nutrition + fitness planning web app. It's the foundation
  of a SaaS platform for personal trainers and their clients.
- **Tech stack:** Vite + React (JSX). Single large component in `src/App.jsx` (~7,500 lines).
- **Repo:** github.com/kevcam51/calorieiq
- **Deployed:** Vercel (calorieiq-jet.vercel.app). Pushing to GitHub main auto-deploys.
- **Key architectural fact:** The entire app reads/writes data through a single abstraction,
  `window.storage`, defined in `src/storage.js`. Until now that was backed by `localStorage`.
  This task swaps the *implementation* of `src/storage.js` to use Firebase Firestore, so
  **`src/App.jsx` does not need to change at all.** Same interface, cloud backend.

## What's already done (in the Firebase console, by the owner)

- Firebase project created. **Project ID: `calorieiq-29762`**
- Authentication enabled with providers: **Email/Password**, **Google**, **Anonymous**.
- Firestore database created in **nam5** multi-region, **Production mode** (locked by default).
- The owner has the web app config values (included below).

## Goal of this task

Wire the app to Firebase so that:
1. Users must log in (email/password or Google) before reaching the app.
2. All `window.storage` calls read/write Firestore instead of localStorage, namespaced
   per authenticated user (`users/{uid}/kv/{key}`).
3. The project builds and runs locally.

---

## IMPORTANT cleanup first

The owner attempted to create a `.env.local` file via the terminal and it likely landed in
the **wrong directory** (their Home folder — a stray `.localized` file was visible alongside
it, which indicates a macOS system folder, not the project root).

**Before anything else:**
1. Confirm the working directory is the project root (it should contain `package.json`,
   `vite.config.js`, and `src/`).
2. Check the Home directory (`~`) for a stray `~/.env.local` that was created by mistake.
   If it exists and contains the `VITE_FIREBASE_*` values, delete it (`rm ~/.env.local`) —
   we'll create the correct one at the project root in the steps below. Do NOT delete
   `~/.localized` (that's a normal macOS system file).

---

## Task checklist

1. [ ] Verify you're in the project root; clean up any stray `~/.env.local` (see above).
2. [ ] Install the `firebase` package: `npm install firebase` (Firebase v12+).
3. [ ] Create `.env.local` at the **project root** with the exact contents in section A.
4. [ ] Create `src/firebase.js` with the contents in section B.
5. [ ] Replace `src/storage.js` entirely with the contents in section C.
6. [ ] Create `src/AuthGate.jsx` with the contents in section D.
7. [ ] Replace `src/main.jsx` entirely with the contents in section E.
8. [ ] Create `firestore.rules` at the project root with the contents in section F.
9. [ ] Create `.env.example` at the project root with the contents in section G.
10. [ ] Ensure `.gitignore` contains `.env.local` and `.env*.local` (add if missing).
11. [ ] Run `npm run build` to confirm it compiles with no errors.
12. [ ] Run `npm run dev` and confirm the CalorieIQ login screen appears at the local URL.
13. [ ] Report back to the owner with the local URL and the two remaining manual steps
        (section H — publishing Firestore rules + adding Vercel env vars).

---

## Section A — `.env.local` (project root)

These Firebase config values are NOT secret (the apiKey only identifies the project; real
security is enforced by Firestore rules). But keep this file gitignored anyway.

```
VITE_FIREBASE_API_KEY=AIzaSyDn6at-tFKg5qtb5kIQt37FMSA-Lh58d24
VITE_FIREBASE_AUTH_DOMAIN=calorieiq-29762.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=calorieiq-29762
VITE_FIREBASE_STORAGE_BUCKET=calorieiq-29762.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=350381584449
VITE_FIREBASE_APP_ID=1:350381584449:web:fdcff9ee484bb85bf656c0
```

## Section B — `src/firebase.js` (new file)

```javascript
// Firebase initialization for CalorieIQ
// Config values come from Vite env vars (.env.local locally, Vercel env vars in prod).
// NOTE: The Firebase "apiKey" is NOT a secret — it only identifies your project to
// Google. Real security comes from Auth + Firestore rules (firestore.rules). It is
// safe to expose in client code, but we keep it in env vars for cleanliness.

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
export default app;
```

## Section C — `src/storage.js` (REPLACE existing file entirely)

```javascript
// CalorieIQ storage layer — Firestore-backed, drop-in replacement for the old
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
  doc, getDoc, setDoc, deleteDoc, collection, getDocs,
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
    const snap = await getDocs(kvCol(uid));
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
```

## Section D — `src/AuthGate.jsx` (new file)

```jsx
// AuthGate — wraps the app. Shows a login/signup screen until the user is
// authenticated, then renders children (the real CalorieIQ app). Because the
// app only mounts when a user exists, storage.js can always assume a uid.

import { useState, useEffect } from "react";
import { auth, googleProvider } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";

export function useAuth() {
  const [user, setUser] = useState(undefined); // undefined = still loading
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);
  return user;
}

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut(auth)}
      style={{
        position: "fixed", top: 12, right: 12, zIndex: 9999,
        padding: "6px 12px", fontSize: 13, borderRadius: 8,
        border: "1px solid #d1d5db", background: "#fff", cursor: "pointer",
      }}
    >
      Sign out
    </button>
  );
}

export default function AuthGate({ children }) {
  const user = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  if (user === undefined) {
    return <div style={S.center}>Loading…</div>;
  }
  if (user) {
    return (
      <>
        <SignOutButton />
        {children}
      </>
    );
  }

  const submit = async () => {
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(""); setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) { setError("Enter your email first, then tap reset."); return; }
    setError(""); setNotice("");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("Password reset email sent.");
    } catch (e) {
      setError(prettyError(e));
    }
  };

  return (
    <div style={S.center}>
      <div style={S.card}>
        <h1 style={S.brand}>CalorieIQ</h1>
        <p style={S.sub}>{mode === "signup" ? "Create your account" : "Sign in"}</p>

        <input
          style={S.input} type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email"
        />
        <input
          style={S.input} type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />

        {error && <div style={S.error}>{error}</div>}
        {notice && <div style={S.notice}>{notice}</div>}

        <button style={S.primary} onClick={submit} disabled={busy}>
          {busy ? "…" : mode === "signup" ? "Sign up" : "Sign in"}
        </button>

        <button style={S.google} onClick={google} disabled={busy}>
          Continue with Google
        </button>

        <div style={S.row}>
          {mode === "login" ? (
            <>
              <button style={S.link} onClick={() => setMode("signup")}>
                Create account
              </button>
              <button style={S.link} onClick={reset}>Forgot password?</button>
            </>
          ) : (
            <button style={S.link} onClick={() => setMode("login")}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function prettyError(e) {
  const code = (e && e.code) || "";
  const map = {
    "auth/invalid-email": "That email doesn't look right.",
    "auth/missing-password": "Enter a password.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "No account with that email.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/popup-closed-by-user": "Google sign-in was closed.",
    "auth/too-many-requests": "Too many attempts. Try again in a bit.",
  };
  return map[code] || (e && e.message) || "Something went wrong.";
}

const S = {
  center: {
    minHeight: "100vh", display: "flex", alignItems: "center",
    justifyContent: "center", background: "#f3f4f6", padding: 16,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  card: {
    width: "100%", maxWidth: 360, background: "#fff", borderRadius: 16,
    padding: 28, boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
    display: "flex", flexDirection: "column", gap: 12,
  },
  brand: { margin: 0, fontSize: 28, fontWeight: 800, color: "#111827", textAlign: "center" },
  sub: { margin: "0 0 8px", color: "#6b7280", textAlign: "center", fontSize: 14 },
  input: {
    padding: "12px 14px", fontSize: 15, borderRadius: 10,
    border: "1px solid #d1d5db", outline: "none",
  },
  primary: {
    padding: "12px 14px", fontSize: 15, fontWeight: 600, borderRadius: 10,
    border: "none", background: "#111827", color: "#fff", cursor: "pointer",
  },
  google: {
    padding: "12px 14px", fontSize: 15, fontWeight: 500, borderRadius: 10,
    border: "1px solid #d1d5db", background: "#fff", color: "#111827", cursor: "pointer",
  },
  row: { display: "flex", justifyContent: "space-between", marginTop: 4 },
  link: { background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, padding: 0 },
  error: { color: "#b91c1c", fontSize: 13, background: "#fef2f2", padding: "8px 10px", borderRadius: 8 },
  notice: { color: "#065f46", fontSize: 13, background: "#ecfdf5", padding: "8px 10px", borderRadius: 8 },
};
```

## Section E — `src/main.jsx` (REPLACE existing file entirely)

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './storage.js'          // installs window.storage (Firestore-backed) + imports firebase
import AuthGate from './AuthGate.jsx'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
)
```

## Section F — `firestore.rules` (project root, new file)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Each user can read/write ONLY their own data namespace.
    // users/{uid}/kv/{anything}  — the key-value docs CalorieIQ stores.
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // Everything else is denied by default.
    // NOTE: trainer -> client data sharing (a trainer reading their clients'
    // docs) is intentionally NOT here yet. That needs the role model from
    // Session 3 (Admin / Trainer / Client). We'll extend these rules then.
  }
}
```

## Section G — `.env.example` (project root, new file)

```
# Firebase web app config. Copy this file to ".env.local" and fill in the values
# from Firebase console > Project settings > Your apps > SDK setup and config.
# These are NOT secrets (the apiKey just identifies your project) but env vars
# keep them out of the committed source and let Vercel manage them per-env.
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

## Section H — Two manual steps for the owner (cannot be automated here)

After the build runs locally, tell Kevin these two things still need doing by hand:

1. **Publish the Firestore security rules.** Firebase console → Firestore Database → Rules
   tab → paste the contents of `firestore.rules` → Publish. Until this is done, the database
   is locked (Production mode default), so logging in will work but saving data will fail
   with a permissions error. (Optional alternative: the Firebase CLI can deploy rules with
   `firebase deploy --only firestore:rules`, but that requires `firebase login` and
   `firebase init` first — the console paste is simpler for a one-off.)

2. **Add the env vars to Vercel.** Vercel → the CalorieIQ project → Settings → Environment
   Variables → add the same six `VITE_FIREBASE_*` values from `.env.local`. Without these,
   the production deploy on Vercel won't be able to connect to Firebase. `.env.local` is
   gitignored and never leaves the local machine, so Vercel needs its own copy.

---

## Verification expectations

- `npm run build` completes without errors. (Firebase adds bundle weight; a chunk-size
  warning over 500 kB is expected and harmless.)
- `npm run dev` serves the app and shows the CalorieIQ login screen (not the app directly).
- After signing up / logging in (email or Google), the real CalorieIQ app renders, with a
  small "Sign out" button fixed at the top-right.
- Saving data will only persist once the Firestore rules from section F are published
  (manual step H1).

## Out of scope (future sessions — do NOT build now)

- Role system (Admin / Head Trainer / Sub-Trainer / Client) — Session 3.
- Trainer → client data sharing in the security rules — depends on roles.
- Trial periods (self-serve client trial ~7-14 days; trainer migration trial ~30 days).
- Anonymous "Try it free" entry button and account-linking — pairs with trials/roles.
- Apple sign-in (owner has an Apple Developer account; needs Services ID + key setup).
