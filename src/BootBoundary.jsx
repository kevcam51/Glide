import { Component } from 'react'

// ── The app had no error boundary at all (S236) ────────────────────────────────
//
// Kevin, three times across two days: "it was not working" → "it loads for a
// second and the screen goes blank" → "still not working. it is just a blank
// screen." Each round cost a diagnosis from first principles, because a broken
// Glidna reported NOTHING: no message, no code, no recovery. React unmounts the
// whole tree when a render throws and there was nothing anywhere in src/ to
// catch it — so every failure, whatever its cause, arrives looking identical and
// looking like the same bug.
//
// ⚠️ THIS IS NOT A GUESS ABOUT THE CAUSE, IT IS THE INSTRUMENT. Whether the
// blank screen is a dead chunk, a render throw in 41,000 lines of App.jsx, or
// something neither of us has thought of yet, it now says which — on the device
// it happened on, which is the only place some of these are reproducible.
//
// ⚠️ AND A FAILED IMPORT IS HANDLED, NOT JUST REPORTED. A stale worker can serve
// a cached chunk that no longer resolves, in which case nothing reaches the
// network and the server-side fallback in api/entry.js never gets asked. That
// case repairs itself here instead: drop every cache, unregister the worker,
// reload. The timestamp is what stops a loop — if a heal ran moments ago and we
// are still failing, it shows the error rather than reloading forever.

const HEAL_KEY = 'glidna-boot-heal'
const HEAL_WINDOW_MS = 60000

// A module that never arrived is a different animal from a component that threw:
// the first is a delivery problem a reload can fix, the second is a bug that
// would throw again just as reliably after one. Reloading for the second would
// turn a visible error into an invisible loop.
function isChunkFailure(err) {
  const s = `${err?.name || ''} ${err?.message || ''}`
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported|Failed to fetch/i.test(s)
}

async function wipeAndReload() {
  try {
    if (self.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)))
  } catch { /* best-effort */ }
  try {
    if (navigator.serviceWorker) {
      const rs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(rs.map((r) => r.unregister()))
    }
  } catch { /* best-effort */ }
  try { window.location.reload() } catch { /* nothing left to try */ }
}

const wrap = {
  minHeight: '100vh', background: '#05080a', color: '#eafcfc', display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: '24px',
  font: "15px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif",
}
const card = {
  maxWidth: '420px', width: '100%', background: '#161f24', border: '1px solid #2e4241',
  borderRadius: '14px', padding: '22px',
}
const btn = {
  width: '100%', marginTop: '14px', padding: '13px', borderRadius: '10px', border: 0,
  background: '#08dce0', color: '#05080a', font: "700 15px/1 system-ui, sans-serif", cursor: 'pointer',
}

export default class BootBoundary extends Component {
  constructor(p) {
    super(p)
    this.state = { err: null, healing: false }
  }

  static getDerivedStateFromError(err) { return { err } }

  componentDidCatch(err) {
    // Logged as well as shown: if Kevin can reach a console, this is the line
    // that names the failure, and it survives the screen being screenshotted.
    try { console.error('[glidna] boot failure:', err) } catch { /* ignore */ }
    if (!isChunkFailure(err)) return
    let recent = false
    try {
      recent = Date.now() - Number(sessionStorage.getItem(HEAL_KEY) || 0) < HEAL_WINDOW_MS
      if (!recent) sessionStorage.setItem(HEAL_KEY, String(Date.now()))
    } catch { /* private mode — fall through and just show the error */ }
    if (recent) return
    this.setState({ healing: true })
    wipeAndReload()
  }

  render() {
    const { err, healing } = this.state
    if (!err) return this.props.children
    if (healing) {
      return (
        <div style={wrap}>
          <div style={{ ...card, textAlign: 'center' }}>Updating Glidna…</div>
        </div>
      )
    }
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ font: "800 20px/1.2 system-ui, sans-serif", marginBottom: '8px' }}>
            Glidna hit a snag
          </div>
          <div style={{ color: '#9bb8b8', fontSize: '14px' }}>
            Something went wrong loading the app. Resetting clears the stored copy
            and downloads a fresh one — your data is safe, it lives in your account.
          </div>
          <button style={btn} onClick={wipeAndReload}>Reset and reload</button>
          <div style={{
            marginTop: '14px', padding: '10px', borderRadius: '8px', background: '#05080a',
            border: '1px solid #2e4241', color: '#7e9a9a',
            font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
            wordBreak: 'break-word', maxHeight: '160px', overflow: 'auto',
          }}>
            {String(err?.message || err) || 'unknown error'}
          </div>
        </div>
      </div>
    )
  }
}
