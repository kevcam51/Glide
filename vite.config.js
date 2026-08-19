import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // ── Why chunk at all (S196g) ──────────────────────────────────────
        // Everything used to land in ONE ~1.7MB file, which meant every deploy
        // — including a one-line copy change — invalidated the whole thing for
        // every user, on every device, including the installed PWA. Glidna
        // ships several times a day, so people were re-downloading React and
        // the entire Firebase SDK to get a fixed sentence.
        //
        // Vendor code changes only when a dependency is upgraded, so splitting
        // it out means a normal deploy re-downloads app code alone and the
        // vendor chunks come straight from cache. It does NOT shrink a
        // first-ever visit — for that, src/App.jsx has to stop being one
        // 1.86MB module, which is a real refactor and a separate job.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Firestore is the biggest single piece of Firebase and is needed on
          // every screen; auth/functions are comparatively small. Keeping them
          // together keeps the request count down while still isolating them
          // from app code.
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react';
          // ⚠️ EVERYTHING ELSE IS LEFT ALONE, DELIBERATELY. The remaining
          // dependencies — the barcode scanner, the QR encoder, confetti, the
          // passkey helper — are already behind dynamic import() and Rollup
          // gives each its own chunk. Naming a catch-all 'vendor' here merged
          // all four into one 511kB download, so opening the barcode scanner
          // would also have fetched the QR encoder and the confetti library.
          // A manual chunk is only ever an improvement for code that is
          // ALWAYS loaded; for lazy code it destroys the split.
          return undefined;
        },
      },
    },
  },
})
