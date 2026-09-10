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
    // ⚠️ AN INSTALLED PWA HAS NO ADDRESS BAR, SO THERE WAS NO WAY TO GET A NEW
    // VERSION (S198m, Kevin: "I wanted to refresh the page so I can see if the
    // button popped up"). sw.js calls skipWaiting() + clients.claim(), so a new
    // worker takes over as soon as it is fetched — but the page already open
    // keeps running the JavaScript it loaded with, and nothing said so.
    //
    // ⚠️ THE TRIGGER USED TO BE `controllerchange`, AND THAT WAS WRONG IN BOTH
    // DIRECTIONS (S218, Kevin on his iPad: "it constantly says that an update is
    // available, and when i select update the message for an update being
    // available still pops up").
    //
    //   FALSE POSITIVE: a controller change is not a new version. iOS/iPadOS
    //   evicts and restarts service workers aggressively, and each re-claim
    //   fired the banner. Tapping Update reloaded, the same thing happened
    //   again, and nothing the user could do would ever clear it — because the
    //   thing being announced had not happened in the first place.
    //
    //   FALSE NEGATIVE, AND THE MORE EMBARRASSING HALF: public/sw.js is a static
    //   file that Vite copies verbatim, so a NORMAL DEPLOY LEAVES IT
    //   BYTE-IDENTICAL — verified against the live site, unchanged since August.
    //   No new worker means no controllerchange, which means this banner could
    //   never once have announced a real release.
    //
    // So ask the question the banner claims to be answering: is the deployed
    // entry chunk the one this page is running? Vite content-hashes it, so the
    // filename IS the build identity. Cheap (a few KB of HTML), decisive, and
    // it cannot be fooled by the worker restarting.
    const runningEntry = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src') || null

    let lastCheck = 0
    const announce = () => {
      if (window.__glidnaUpdateReady) return
      window.__glidnaUpdateReady = true
      window.dispatchEvent(new CustomEvent('glidna:update-ready'))
    }
    const check = async () => {
      const now = Date.now()
      if (now - lastCheck < 30000) return   // app-switching shouldn't hammer it
      lastCheck = now
      try { const reg = await navigator.serviceWorker.getRegistration(); reg?.update() } catch { /* offline */ }
      if (!runningEntry) return             // can't compare, so never cry wolf
      try {
        // Not mode:'navigate' and not /assets/, so sw.js passes this straight to
        // the network (see its fetch handler) — no cached shell can answer it.
        const res = await fetch('/', { cache: 'no-store' })
        if (!res.ok) return
        const html = await res.text()
        // ⚠️ `[^"]*` BEFORE /assets/, NOT `[^"]+`. The src IS "/assets/index-….js" with
        // nothing in front of it, so a `+` here matches nothing Vite emits — the probe
        // would have been silently dead, which is the same shape of mistake as the
        // bare-1,200 scan that could not see Math.max(1200, …). Caught by running it
        // against the real built HTML and the live site rather than by reading it.
        const m = html.match(/<script[^>]*\stype="module"[^>]*\ssrc="([^"]*\/assets\/[^"]+)"/)
        if (m && m[1] !== runningEntry) announce()
      } catch { /* offline, or the probe failed — say nothing */ }
    }

    // updateViaCache:'none' stops the browser serving sw.js itself from cache.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {})

    check()
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
    // A controller change is no longer the signal, but it IS a reasonable moment
    // to go and ask — cost is one conditional HTML fetch.
    navigator.serviceWorker.addEventListener('controllerchange', () => { lastCheck = 0; check() })
    window.__glidnaCheckUpdate = () => { lastCheck = 0; return check() }

    // ⚠️ RELOADING IS NOT ENOUGH ON ITS OWN. sw.js serves navigations
    // network-first but RACED against a 1.2s timeout, so on a slow radio the
    // reload can be answered by the cached shell — the very HTML we just
    // established is out of date. Drop the shell first so the reload has to go
    // to the network. Hashed assets are immutable and are deliberately kept.
    window.__glidnaApplyUpdate = async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.filter((k) => k.startsWith('glidna-shell')).map((k) => caches.delete(k)))
      } catch { /* best-effort — reload anyway */ }
      window.location.reload()
    }
  })
}
