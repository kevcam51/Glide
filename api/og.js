// Dynamic personalized Open Graph share card (Option B).
// GET /api/og?n=Kevin  ->  a 1200x630 PNG that says "Kevin invited you to Glidna".
// Rendered on the fly with resvg + the Sora font so an invite link unfurls with a
// card naming the inviter. If anything fails (font/render/import), we 302-redirect
// to the static /og.png so the link still unfurls with the branded card — this
// endpoint can only ever improve on, never break, the existing preview.
//
// Wired up by api/invite.js (og:image) and reachable directly for testing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// XML/SVG-escape user text.
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// A trimmed, length-capped display name (first name only is passed in practice).
function cleanName(raw) {
  const n = (raw || "").toString().trim().replace(/\s+/g, " ");
  if (!n) return "";
  return n.length > 22 ? n.slice(0, 22).trim() + "…" : n;
}

export default async function handler(req, res) {
  const name = cleanName((req.query && req.query.n) || "");
  try {
    const fontUrl = (f) => fileURLToPath(new URL(`./_fonts/${f}`, import.meta.url));
    // ⚠️ TTF, NOT WOFF2 (S196x). resvg's font database cannot parse WOFF2 — it
    // accepts the buffer without complaint and then contributes nothing, so
    // every card rendered here came out with NO TEXT on a host with no system
    // fonts (Vercel's Linux runtime), and in a generic system face anywhere
    // else. Nothing threw, so the catch below never fired and the fallback to
    // the static /og.png never happened either. Proven: rendering with the
    // WOFF2 buffer was BYTE-IDENTICAL to rendering with no font at all.
    const sora700 = fontUrl("sora-700.ttf");
    const sora400 = fontUrl("sora-400.ttf");

    // Headline: personalized when we have a name, generic otherwise.
    const headline = name ? `${esc(name)} invited you` : "You're invited";
    const topLabel = name ? "PERSONAL INVITE" : "AN INVITE TO";

    const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#070f0e"/>
  <circle cx="1085" cy="120" r="240" fill="none" stroke="#08dce0" stroke-opacity="0.10" stroke-width="2"/>
  <circle cx="1085" cy="120" r="150" fill="none" stroke="#08dce0" stroke-opacity="0.15" stroke-width="2"/>
  <circle cx="120" cy="520" r="200" fill="none" stroke="#08dce0" stroke-opacity="0.08" stroke-width="2"/>
  <text x="600" y="150" text-anchor="middle" font-family="Sora" font-weight="700" font-size="30" letter-spacing="8" fill="#08dce0">${topLabel}</text>
  <text x="600" y="300" text-anchor="middle" font-family="Sora" font-weight="700" font-size="140" letter-spacing="3"><tspan fill="#08dce0">GLI</tspan><tspan fill="#eafcfc">DNA</tspan></text>
  <rect x="550" y="336" width="100" height="6" rx="3" fill="#08dce0"/>
  <text x="600" y="430" text-anchor="middle" font-family="Sora" font-weight="700" font-size="56" fill="#eafcfc">${headline}</text>
  <text x="600" y="500" text-anchor="middle" font-family="Sora" font-weight="400" font-size="34" fill="#9bb8b8">Your trainer + smart AI, one place to stay on track.</text>
</svg>`;

    // Lazy-load the native renderer inside the try so an import failure also
    // falls through to the static-card redirect below.
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svg, {
      // ⚠️ fontFiles, NOT fontBuffers (S196x). Two separate traps, and the card
      // fell into both. The files were WOFF2, which resvg cannot parse at all;
      // and `fontBuffers` is IGNORED OUTRIGHT by this version — passing the real
      // Sora TTF and passing 29 bytes of garbage render byte-identical output,
      // so the buffers never mattered and `loadSystemFonts: false` was silently
      // discarded along with them. Text came from whatever the host had
      // installed. On Vercel's Linux runtime, which has no Sora and may have no
      // usable face at all, that means the personalised "{Name} invited you"
      // card could render with no headline at all — and nothing throws, so the
      // catch below never falls back to the static /og.png either.
      font: { fontFiles: [sora700, sora400], loadSystemFonts: false, defaultFontFamily: "Sora" },
      fitTo: { mode: "width", value: 1200 },
    });
    const png = resvg.render().asPng();

    res.setHeader("Content-Type", "image/png");
    // Cache aggressively at the edge — the image is a pure function of ?n=.
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    res.status(200).send(png);
  } catch (err) {
    // Any failure: fall back to the static branded card so the link still unfurls.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.redirect(302, "/og.png");
  }
}
