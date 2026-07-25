// Glidna MCP connector — the "Connect your account" consent screen (Phase 2).
//
// This is what a user sees after clicking "Connect" on the Glidna connector in
// their own Claude. Claude sends them to:
//   https://glidna.com/oauth/authorize?client_id=…&redirect_uri=…&state=…
//     &code_challenge=…&code_challenge_method=S256&scope=read&resource=…
//
// It renders INSIDE AuthGate, so an unauthenticated visitor signs in with their
// existing Glidna account first (email / Google / Face ID) — we never build a
// second login. Once signed in they see exactly what's being granted and tap
// Allow; we exchange their Firebase session for a one-time authorization code
// and hand control back to Claude.
//
// Security notes:
//  • We never see or store Claude's PKCE verifier — only the challenge rides
//    through us, and the server verifies it at token exchange.
//  • The code is minted server-side against the user's verified ID token, so
//    this page cannot authorize anyone but the person signed into it.
//  • redirect_uri is validated SERVER-side against the client's registration
//    before we mint anything; we only navigate to what the server echoes back.

import { useEffect, useMemo, useState } from "react";
import { auth } from "./firebase";

const FN_BASE = `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;

// Plain-English descriptions — the user should understand what they're granting
// without knowing what a "scope" is.
const SCOPE_TEXT = {
  read: {
    title: "Read your Glidna data",
    detail: "Your profile, calorie and macro targets, food logs, weigh-ins, measurements, and plans.",
  },
  "write:logs": {
    title: "Log food, workouts and weigh-ins for you",
    detail: "Add meals, workouts, water and weigh-ins to your diary.",
  },
  "write:plan": {
    title: "Update your plan",
    detail: "Change your targets, personal stats and workout schedule.",
  },
  trainer: {
    title: "Manage your clients",
    detail: "Read your clients' progress and send them to-dos.",
  },
};

export default function OAuthConsent() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const clientId = params.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const state = params.get("state") || "";
  const codeChallenge = params.get("code_challenge") || "";
  const challengeMethod = params.get("code_challenge_method") || "";
  const resource = params.get("resource") || "";
  const scope = params.get("scope") || "read";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);

  useEffect(() => {
    const u = auth.currentUser;
    if (u) setMe({ email: u.email, name: u.displayName });
  }, []);

  const scopes = scope.split(/\s+/).filter(Boolean);
  const missing = !clientId || !redirectUri || !codeChallenge || challengeMethod !== "S256";

  // Send the user back to the client with an error (the OAuth-correct way to
  // decline — never leave them on a dead end).
  const bounce = (extra) => {
    try {
      const u = new URL(redirectUri);
      Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
      if (state) u.searchParams.set("state", state);
      window.location.replace(u.toString());
    } catch {
      setError("This connection request has an invalid return address.");
    }
  };

  const allow = async () => {
    setBusy(true); setError("");
    try {
      const user = auth.currentUser;
      if (!user) { setError("Please sign in first."); setBusy(false); return; }
      const idToken = await user.getIdToken();
      const resp = await fetch(`${FN_BASE}/mcpAuthorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: challengeMethod,
          resource,
          scope,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data.error_description || "Couldn't authorize this connection.");
        setBusy(false);
        return;
      }
      bounce({ code: data.code });
    } catch (e) {
      setError("Something went wrong connecting. Please try again.");
      setBusy(false);
    }
  };

  const deny = () => bounce({ error: "access_denied", error_description: "The user declined." });

  const card = "w-full max-w-[440px] rounded-2xl border border-border bg-surface p-6 text-fg";

  if (missing) {
    return (
      <div data-theme="pro" className="min-h-screen bg-bg text-fg flex items-center justify-center px-4"
        style={{ fontFamily: "var(--font-sans)" }}>
        <div className={card}>
          <div className="font-display text-xl mb-2">Invalid connection request</div>
          <p className="text-sm text-muted leading-relaxed">
            This link is missing information we need (or is using an unsupported security method).
            Start the connection again from your AI assistant.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-theme="pro" className="min-h-screen bg-bg text-fg flex items-center justify-center px-4 py-10"
      style={{ fontFamily: "var(--font-sans)" }}>
      <div className={card}>
        <div className="mb-1 font-display text-2xl">
          <span className="text-primary">GLI</span><span className="text-fg">DNA</span>
        </div>
        <div className="font-display text-lg mb-1">Connect your account</div>
        <p className="text-sm text-muted leading-relaxed mb-4">
          An AI assistant wants to connect to your Glidna account
          {me?.email ? <> as <b className="text-fg">{me.email}</b></> : null}.
          It will be able to:
        </p>

        <div className="flex flex-col gap-2 mb-4">
          {scopes.map((s) => {
            const t = SCOPE_TEXT[s] || { title: s, detail: "" };
            return (
              <div key={s} className="rounded-lg bg-surface2 p-3">
                <div className="text-sm font-semibold">{t.title}</div>
                {t.detail ? <div className="text-xs text-muted mt-0.5 leading-relaxed">{t.detail}</div> : null}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted leading-relaxed mb-4">
          Only your own data is shared. You can disconnect at any time from your AI assistant's
          settings, and nothing is shared with anyone else.
        </p>

        {error ? <div className="mb-3 text-sm text-danger">{error}</div> : null}

        <div className="flex gap-2">
          <button onClick={allow} disabled={busy}
            className="flex-1 rounded-lg bg-primaryfill px-4 py-3 text-sm font-bold text-primaryfg cursor-pointer disabled:opacity-60">
            {busy ? "Connecting…" : "Allow"}
          </button>
          <button onClick={deny} disabled={busy}
            className="rounded-lg border border-border bg-transparent px-4 py-3 text-sm font-semibold text-fg cursor-pointer disabled:opacity-60">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
