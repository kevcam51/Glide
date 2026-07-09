// AuthGate — wraps the app. Shows a login/signup screen until the user is
// authenticated, then renders children (the real Glidna app). Because the
// app only mounts when a user exists, storage.js can always assume a uid.

import { useState, useEffect, useRef } from "react";
import { auth, googleProvider, functions } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { startAuthentication } from "@simplewebauthn/browser";
import { createProfile, hasProfile, ROLES } from "./profile.js";
import { Icon } from "./icons.jsx";

// Biometric sign-in (Face ID / Touch ID passkeys — S87). The server verifies
// the passkey assertion and mints a Firebase custom token.
const callPasskeyLoginOptions = httpsCallable(functions, "passkeyLoginOptions");
const callPasskeyLoginVerify = httpsCallable(functions, "passkeyLoginVerify");
// Local hint set after a passkey is registered/used on this device — leads the
// login screen with the Face ID button (the button works without it too).
const PASSKEY_HINT = "glide-passkey";

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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // role chosen on the signup form ("client" maps to client, "trainer" -> head_trainer)
  const [signupRole, setSignupRole] = useState(ROLES.CLIENT);
  // If the page was opened from a trainer's invite link (?invite=CODE), we show a
  // hint on signup. The actual linking happens inside the app once the client has
  // a profile (see RolePanel auto-link).
  const inviteParam = (() => {
    try { return (new URLSearchParams(window.location.search).get("invite") || "").trim(); }
    catch { return ""; }
  })();
  // The inviter's first name, carried through the personalized invite link
  // (/i/CODE?n=Kevin), so we can greet the new client by who invited them.
  const inviterName = (() => {
    try { return (new URLSearchParams(window.location.search).get("n") || "").trim().slice(0, 40); }
    catch { return ""; }
  })();
  // profile-completion gate: every signed-in user must have a users/{uid} profile
  const [profileChecked, setProfileChecked] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  // a FAILED profile read (offline/flaky network) is NOT "has no profile" —
  // routing an existing user into the role chooser could overwrite their
  // profile (unlink trainer, restart trial). Show a retry screen instead.
  const [checkFailed, setCheckFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
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
    setCheckFailed(false);
    hasProfile(user.uid)
      .then((has) => {
        if (cancelled) return;
        setNeedsProfile(!has);
        setProfileChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCheckFailed(true);
        setProfileChecked(true);
      });
    return () => { cancelled = true; };
  }, [user, retryTick]);

  // Force a one-time ID-token refresh on sign-in so any custom claims set
  // server-side (role + linkage — see functions/syncRoleClaims) are present in
  // this session's token without requiring a re-login. Cheap; runs once per load.
  useEffect(() => {
    if (user) user.getIdToken(true).catch(() => {});
  }, [user]);

  if (user === undefined) {
    return <div style={S.center}>Loading…</div>;
  }
  if (user) {
    if (!profileChecked) {
      return <div style={S.center}>Loading…</div>;
    }
    if (checkFailed) {
      return (
        <div style={S.center}>
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 12 }}>Couldn't load your account — check your connection.</div>
            <button style={S.primary} onClick={() => setRetryTick((t) => t + 1)}>Retry</button>
          </div>
        </div>
      );
    }
    if (needsProfile) {
      return <RoleChooser user={user} onDone={() => setNeedsProfile(false)} />;
    }
    // Sign-out now lives in the app's side menu (the hamburger ≡), so no
    // floating button here once the user is in.
    return <>{children}</>;
  }

  const submit = async () => {
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signup") {
        // Trainers run a business on the platform, so a name is required for them.
        // Clients may add one later.
        if (signupRole === ROLES.HEAD_TRAINER && (!firstName.trim() || !lastName.trim())) {
          setError("Please enter your first and last name — trainers need both.");
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        createdRef.current = true; // skip the gate's re-check for this fresh account
        await createProfile({
          uid: cred.user.uid,
          email: cred.user.email,
          role: signupRole,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
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

  // Face ID / Touch ID sign-in: passkey assertion → server verify → custom token.
  const passkeySupported = typeof window !== "undefined" && !!window.PublicKeyCredential;
  const passkeyHinted = (() => { try { return localStorage.getItem(PASSKEY_HINT) === "1"; } catch { return false; } })();
  const passkey = async () => {
    setError(""); setNotice(""); setBusy(true);
    try {
      const { data } = await callPasskeyLoginOptions({ origin: window.location.origin });
      const asseResp = await startAuthentication({ optionsJSON: data.options });
      const res = await callPasskeyLoginVerify({ origin: window.location.origin, challengeId: data.challengeId, asseResp });
      await signInWithCustomToken(auth, res.data.token);
      try { localStorage.setItem(PASSKEY_HINT, "1"); } catch { /* private mode */ }
    } catch (e) {
      const m = String((e && (e.message || e.code)) || "");
      if (/NotAllowed|cancel|abort/i.test(m)) { /* user dismissed the prompt — no error */ }
      else if (m.includes("not-found")) setError("No Face ID set up on this account yet — sign in with your password, then enable it in the menu (≡).");
      else setError("Face ID sign-in didn't work — use your password instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.center}>
      <div style={S.card}>
        <h1 style={S.brand}>Glidna</h1>
        <p style={S.sub}>{mode === "signup" ? "Create your account" : "Sign in"}</p>

        {inviteParam && (
          <div style={S.notice}>
            {inviterName
              ? `${inviterName} invited you to Glidna. `
              : "You've been invited by a trainer. "}
            Sign up (or sign in) as a client and you'll be linked automatically.
          </div>
        )}

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
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={S.input} type="text" autoComplete="given-name"
                placeholder={signupRole === ROLES.HEAD_TRAINER ? "First name (required)" : "First name (optional)"}
                value={firstName} onChange={(e) => setFirstName(e.target.value)}
              />
              <input
                style={S.input} type="text" autoComplete="family-name"
                placeholder={signupRole === ROLES.HEAD_TRAINER ? "Last name (required)" : "Last name (optional)"}
                value={lastName} onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <RoleToggle value={signupRole} onChange={setSignupRole} />
          </>
        )}

        {error && <div style={S.error}>{error}</div>}
        {notice && <div style={S.notice}>{notice}</div>}

        <button style={S.primary} onClick={submit} disabled={busy}>
          {busy ? "…" : mode === "signup" ? "Sign up" : "Sign in"}
        </button>

        <button style={S.google} onClick={google} disabled={busy}>
          Continue with Google
        </button>

        {mode === "login" && passkeySupported && (
          <>
            <button onClick={passkey} disabled={busy}
              style={{
                ...(passkeyHinted ? { ...S.primary, background: "#0e7490" } : S.google),
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              <Icon name="fingerprint" size={17} /> Sign in with Face ID / Touch ID
            </button>
            {!passkeyHinted && (
              <div style={{ fontSize: 12, color: "#6b7280", textAlign: "center", marginTop: -4 }}>
                First time on this device? Sign in with your password, then enable
                Face ID from the menu (≡) — after that this button is all you need.
              </div>
            )}
          </>
        )}

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
  // Prefill from the Google display name when available.
  const googleName = (user.displayName || "").trim();
  const sp = googleName.indexOf(" ");
  const [firstName, setFirstName] = useState(sp === -1 ? googleName : googleName.slice(0, sp));
  const [lastName, setLastName] = useState(sp === -1 ? "" : googleName.slice(sp + 1));

  const choose = async (role) => {
    setError("");
    // Trainers must provide a name (they run a business on the platform).
    if (role === ROLES.HEAD_TRAINER && (!firstName.trim() || !lastName.trim())) {
      setError("Please enter your first and last name — trainers need both.");
      return;
    }
    setBusy(true);
    try {
      await createProfile({
        uid: user.uid, email: user.email, role,
        firstName: firstName.trim(), lastName: lastName.trim(),
      });
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
        <h1 style={S.brand}>Glidna</h1>
        <p style={S.sub}>One quick thing — what's your name, and are you a trainer or a client?</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={S.input} type="text" autoComplete="given-name" placeholder="First name"
            value={firstName} onChange={(e) => setFirstName(e.target.value)}
          />
          <input
            style={S.input} type="text" autoComplete="family-name" placeholder="Last name"
            value={lastName} onChange={(e) => setLastName(e.target.value)}
          />
        </div>
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
