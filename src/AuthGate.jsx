// AuthGate — wraps the app. Shows a login/signup screen until the user is
// authenticated, then renders children (the real CalorieIQ app). Because the
// app only mounts when a user exists, storage.js can always assume a uid.

import { useState, useEffect, useRef } from "react";
import { auth, googleProvider } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { createProfile, hasProfile, ROLES } from "./profile.js";

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
  // role chosen on the signup form ("client" maps to client, "trainer" -> head_trainer)
  const [signupRole, setSignupRole] = useState(ROLES.CLIENT);
  // profile-completion gate: every signed-in user must have a users/{uid} profile
  const [profileChecked, setProfileChecked] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  // set true the moment we create a profile this session, so the gate effect
  // doesn't race the write and re-prompt for a role we just chose
  const createdRef = useRef(false);

  // When a user signs in, ensure they have a profile doc. If not (first Google
  // sign-in, or a pre-Session-3 account), show the one-time role chooser.
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setProfileChecked(false);
      setNeedsProfile(false);
      createdRef.current = false;
      return;
    }
    if (createdRef.current) {
      setNeedsProfile(false);
      setProfileChecked(true);
      return;
    }
    setProfileChecked(false);
    hasProfile(user.uid)
      .then((has) => {
        if (cancelled) return;
        setNeedsProfile(!has);
        setProfileChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        setNeedsProfile(true);
        setProfileChecked(true);
      });
    return () => { cancelled = true; };
  }, [user]);

  if (user === undefined) {
    return <div style={S.center}>Loading…</div>;
  }
  if (user) {
    if (!profileChecked) {
      return <div style={S.center}>Loading…</div>;
    }
    if (needsProfile) {
      return <RoleChooser user={user} onDone={() => setNeedsProfile(false)} />;
    }
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
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        createdRef.current = true; // skip the gate's re-check for this fresh account
        await createProfile({
          uid: cred.user.uid,
          email: cred.user.email,
          role: signupRole,
        });
        setNeedsProfile(false);
        setProfileChecked(true);
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

        {mode === "signup" && (
          <RoleToggle value={signupRole} onChange={setSignupRole} />
        )}

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

// Two-option role picker shown on the signup form. "trainer" maps to head_trainer
// (a self-signup trainer is the head of their own tree).
function RoleToggle({ value, onChange }) {
  const opt = (role, label) => (
    <button
      type="button"
      onClick={() => onChange(role)}
      style={{ ...S.toggleBtn, ...(value === role ? S.toggleBtnActive : {}) }}
    >
      {label}
    </button>
  );
  return (
    <div>
      <div style={S.toggleLabel}>I'm a…</div>
      <div style={S.toggleRow}>
        {opt(ROLES.CLIENT, "Client")}
        {opt(ROLES.HEAD_TRAINER, "Trainer")}
      </div>
    </div>
  );
}

// One-time "trainer or client?" screen for signed-in users who don't yet have a
// profile (first Google sign-in, or accounts created before Session 3 existed).
function RoleChooser({ user, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choose = async (role) => {
    setError(""); setBusy(true);
    try {
      await createProfile({ uid: user.uid, email: user.email, role });
      onDone();
    } catch (e) {
      setError(prettyError(e));
      setBusy(false);
    }
  };

  return (
    <div style={S.center}>
      <SignOutButton />
      <div style={S.card}>
        <h1 style={S.brand}>CalorieIQ</h1>
        <p style={S.sub}>One quick thing — are you a trainer or a client?</p>
        {error && <div style={S.error}>{error}</div>}
        <button style={S.primary} disabled={busy} onClick={() => choose(ROLES.CLIENT)}>
          I'm a client
        </button>
        <button style={S.google} disabled={busy} onClick={() => choose(ROLES.HEAD_TRAINER)}>
          I'm a trainer
        </button>
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
  toggleLabel: { fontSize: 13, color: "#6b7280", marginBottom: 6 },
  toggleRow: { display: "flex", gap: 8 },
  toggleBtn: {
    flex: 1, padding: "10px 12px", fontSize: 14, fontWeight: 600, borderRadius: 10,
    border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer",
  },
  toggleBtnActive: { background: "#111827", color: "#fff", borderColor: "#111827" },
  error: { color: "#b91c1c", fontSize: 13, background: "#fef2f2", padding: "8px 10px", borderRadius: 8 },
  notice: { color: "#065f46", fontSize: 13, background: "#ecfdf5", padding: "8px 10px", borderRadius: 8 },
};
