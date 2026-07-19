import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'           // Tailwind v4 (theme + utilities; preflight intentionally excluded)
import './storage.js'          // installs window.storage (Firestore-backed) + imports firebase
import AuthGate from './AuthGate.jsx'
import App from './App.jsx'
// Dev-only design preview — lazy so it (and its extra font CSS) stays OUT of the
// production boot bundle. Nobody loading the real app should pay for it.
const Showcase = lazy(() => import('./Showcase.jsx'))

// Dev-only design preview: /?showcase=1 renders the Tailwind theme showcase
// INSTEAD of the app (no login, fully isolated from the real app + auth flow).
const isShowcase = (() => {
  try { return new URLSearchParams(window.location.search).has('showcase') } catch { return false }
})()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isShowcase ? (
      <Suspense fallback={null}><Showcase /></Suspense>
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
