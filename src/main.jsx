import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'           // Tailwind v4 (theme + utilities; preflight intentionally excluded)
import './storage.js'          // installs window.storage (Firestore-backed) + imports firebase
import AuthGate from './AuthGate.jsx'
// ── The app itself is lazy, and warmed immediately (S196g) ──────────────────
// App.jsx is ~1.2MB of the bundle on its own. Loading it eagerly meant a
// SIGNED-OUT visitor downloaded and parsed the entire application before a
// login box could paint — a first impression paid for entirely in code they
// cannot use yet.
//
// Lazy alone would be a bad trade for the signed-IN case (most visits), because
// the chunk would only start downloading after Firebase resolved the session,
// making a round trip serial that used to be parallel. So it is warmed on the
// line below: the request goes out at module evaluation, in parallel with auth,
// and by the time AuthGate has a user the chunk is normally already there.
// Fast for the first-time visitor, no slower for everyone else.
const App = lazy(() => import('./App.jsx'))
import('./App.jsx')
// Dev-only design preview — lazy so it (and its extra font CSS) stays OUT of the
// production boot bundle. Nobody loading the real app should pay for it.
const Showcase = lazy(() => import('./Showcase.jsx'))
// MCP connector consent screen (S113). Lazy so the OAuth flow's code stays out
// of the normal boot bundle — almost nobody hits this path.
const OAuthConsent = lazy(() => import('./OAuthConsent.jsx'))

// Dev-only design preview: /?showcase=1 renders the Tailwind theme showcase
// INSTEAD of the app (no login, fully isolated from the real app + auth flow).
const isShowcase = (() => {
  try { return new URLSearchParams(window.location.search).has('showcase') } catch { return false }
})()

// /oauth/authorize — a user's own Claude (or any MCP client) sent them here to
// connect their Glidna account. Rendered INSIDE AuthGate so signing in reuses
// the existing email / Google / Face ID flow instead of a second login.
const isOAuthConsent = (() => {
  try { return window.location.pathname.replace(/\/+$/, '') === '/oauth/authorize' } catch { return false }
})()

// Reuse the root across hot reloads. Vite re-evaluates this module on HMR, and
// calling createRoot() again on the same container makes React warn ("already
// been passed to createRoot") and throw away the mounted tree. Dev-only noise —
// production evaluates this once — but it clutters the console during exactly
// the work where you're reading it.
const container = document.getElementById('root')
const root = (globalThis.__glidnaRoot ||= createRoot(container))
root.render(
  <StrictMode>
    {isShowcase ? (
      <Suspense fallback={null}><Showcase /></Suspense>
    ) : isOAuthConsent ? (
      <AuthGate>
        <Suspense fallback={null}><OAuthConsent /></Suspense>
      </AuthGate>
    ) : (
      <AuthGate>
        {/* No fallback markup: AuthGate has already painted its own frame, and
            a second spinner underneath it reads as a stutter. In practice the
            warm import means this rarely renders at all. */}
        <Suspense fallback={null}><App /></Suspense>
      </AuthGate>
    )}
  </StrictMode>,
)

// ── Publish the on-screen keyboard's height (S196q) ─────────────────────────
// iOS does not resize the layout viewport when the keyboard opens — it draws it
// over the page — so a position:fixed panel has no idea anything happened and
// its composer ends up underneath the keys. visualViewport DOES know: the gap
// between it and the layout viewport IS the keyboard. Published as --kb so the
// .kb-safe class can lift affected panels clear.
//
// Chrome already resizes (see interactive-widget in index.html), where this
// measures ~0 and the class is a no-op. Nothing to feature-detect.
if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport
  // Written synchronously. An earlier draft batched this into a
  // requestAnimationFrame, which is dead weight here — the event fires a handful
  // of times per keyboard transition, not per frame — and rAF is PAUSED while
  // the tab is hidden, so the value could sit stale exactly when a backgrounded
  // PWA came back with the keyboard already up.
  const sync = () => {
    // offsetTop matters when the page is scrolled under the keyboard; without
    // it a mid-page focus over-reports the gap and pushes the panel too far.
    const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    document.documentElement.style.setProperty('--kb', `${Math.round(gap)}px`)
  }
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  sync()
}

// Register the PWA service worker (prod only, so dev/preview isn't affected by
// any caching). Enables home-screen install + a graceful offline shell.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
