// Generates the PWA / home-screen app icons (public/icon-*.png, apple-touch-icon.png)
// from the Glide brand — a cyan "G" mark on near-black, with the brand underline.
// Run: npm run gen:icons   (uses @resvg/resvg-js + the Sora font, dev-only deps).
// Re-run whenever the brand/name changes (swap the glyph below).
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sora700 = readFileSync(join(root, "node_modules/@fontsource/sora/files/sora-latin-700-normal.woff2"));

// 512-canvas design (OS rounds the corners; content sits in the maskable safe
// zone). width/height are set per target size; the viewBox scales the content.
const svgFor = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#0a1517"/>
  <circle cx="256" cy="256" r="250" fill="none" stroke="#08dce0" stroke-opacity="0.12" stroke-width="4"/>
  <text x="256" y="352" text-anchor="middle" font-family="Sora" font-weight="700" font-size="300" fill="#08dce0">G</text>
  <rect x="196" y="386" width="120" height="14" rx="7" fill="#08dce0"/>
</svg>`;

// MASKABLE variant (Android home screen): Android crops maskable icons into a
// circle/squircle, so all content must sit inside the central ~80% safe zone
// with a full-bleed background — the decorative edge ring is dropped and the
// G + underline are scaled toward center. Without this, Android's mask clips
// the design and the installed tile doesn't match iOS (S86 deferred, fixed S90).
const svgMaskable = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#0a1517"/>
  <g transform="translate(256 256) scale(0.74) translate(-256 -256)">
    <circle cx="256" cy="256" r="250" fill="none" stroke="#08dce0" stroke-opacity="0.12" stroke-width="5"/>
    <text x="256" y="352" text-anchor="middle" font-family="Sora" font-weight="700" font-size="300" fill="#08dce0">G</text>
    <rect x="196" y="386" width="120" height="14" rx="7" fill="#08dce0"/>
  </g>
</svg>`;

function render(size, svg = svgFor) {
  const r = new Resvg(svg(size), {
    font: { fontBuffers: [sora700], loadSystemFonts: false, defaultFontFamily: "Sora" },
  });
  return r.render().asPng();
}

mkdirSync(join(root, "public"), { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(root, `public/icon-${size}.png`), render(size));
  writeFileSync(join(root, `public/icon-maskable-${size}.png`), render(size, svgMaskable));
}
// Apple touch icon (iOS home screen) — 180×180, no transparency (bg is opaque).
writeFileSync(join(root, "public/apple-touch-icon.png"), render(180));
console.log("wrote public/icon-{192,512}.png, icon-maskable-{192,512}.png, apple-touch-icon.png");
