// Generates the static Open Graph share card (public/og.png, 1200×630) that
// unfurls when a Glidna link is pasted into Messages / WhatsApp / Slack, etc.
// This is the generic "foundation" card (Option A) — per-invite personalized
// cards (Option B) layer on later via a Vercel image function.
//
// Run: npm run gen:og   (uses @resvg/resvg-js + the Sora font, dev-only deps).
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// TTF, not WOFF2, and from the repo rather than node_modules (S196x). resvg
// silently ignores WOFF2 — it took the buffer and rendered no text — and
// @fontsource/sora is not installed here, so this script could not run at all.
// api/_fonts/ is committed and is what the deployed function already ships.
const fontDir = join(root, "api/_fonts");
const sora700 = join(fontDir, "sora-700.ttf");
const sora400 = join(fontDir, "sora-400.ttf");

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#070f0e"/>
  <circle cx="1085" cy="120" r="240" fill="none" stroke="#08dce0" stroke-opacity="0.10" stroke-width="2"/>
  <circle cx="1085" cy="120" r="150" fill="none" stroke="#08dce0" stroke-opacity="0.15" stroke-width="2"/>
  <circle cx="120" cy="520" r="200" fill="none" stroke="#08dce0" stroke-opacity="0.08" stroke-width="2"/>
  <text x="600" y="332" text-anchor="middle" font-family="Sora" font-weight="700" font-size="172" letter-spacing="4"><tspan fill="#08dce0">GLI</tspan><tspan fill="#eafcfc">DNA</tspan></text>
  <rect x="540" y="372" width="120" height="6" rx="3" fill="#08dce0"/>
  <text x="600" y="452" text-anchor="middle" font-family="Sora" font-weight="400" font-size="44" fill="#9bb8b8">One place to stay on track.</text>
</svg>`;

const resvg = new Resvg(svg, {
  // fontFiles, not fontBuffers — see the note in api/og.js. Buffers are ignored
  // by this resvg version, so this card was rendering in a system face.
  font: { fontFiles: [sora700, sora400], loadSystemFonts: false, defaultFontFamily: "Sora" },
  fitTo: { mode: "width", value: 1200 },
});
const png = resvg.render().asPng();
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public/og.png"), png);
console.log("wrote public/og.png —", png.length, "bytes");
