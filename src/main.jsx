import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'           // Tailwind v4 (theme + utilities; preflight intentionally excluded)
import './storage.js'          // installs window.storage (Firestore-backed) + imports firebase
import AuthGate from './AuthGate.jsx'
import App from './App.jsx'
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
        <App />
      </AuthGate>
    )}
  </StrictMode>,
)

// Register the PWA service worker (prod only, so dev/preview isn't affected by
// any caching). Enables home-screen install + a graceful offline shell.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
