// "Save your card" landing (S195) — the link a trainer texts a client.
//
// A trainer's share link is /card/CODE?n=FirstName (rewritten here via
// vercel.json to /api/card?c=CODE&n=FirstName). Same shape as the invite
// landing next door: OG meta so it unfurls with a personalized card, then a
// redirect into the app.
//
// ⚠️ THE LINK CARRIES THE TRAINER'S IDENTITY, NEVER THE CLIENT'S, AND NEVER A
// TOKEN. `c` is the trainer's public invite code — the same code that is
// already printed on their invite QR and pasted into signup forms. It says WHO
// to save a card for; it grants nothing. The client authenticates as
// themselves, the card page is Stripe-hosted, and the card is attached to the
// account that is signed in.
//
// That is the whole security argument, and it is why there is no "save a card
// for client X" variant: a link that identified the CLIENT would, if forwarded
// or screenshotted, let a stranger attach their card — or, worse, attach the
// wrong person's card to a real account and start charging it. A link that gets
// forwarded here just shows someone else the trainer's normal signup path.
//
// The app is told what to do next by `savecard=1` — an intent flag with no
// identity in it. Linking is handled by the EXISTING ?invite= flow, so a new
// client signs up, links to the trainer and lands on the card sheet, while an
// existing client (already linked, so the invite is a no-op) goes straight
// there.

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function cleanName(raw) {
  const n = (raw || "").toString().trim().replace(/\s+/g, " ");
  if (!n) return "";
  return n.length > 40 ? n.slice(0, 40).trim() : n;
}
function cleanCode(raw) {
  return (raw || "").toString().trim().replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
}

export default function handler(req, res) {
  const q = req.query || {};
  const code = cleanCode(q.c || q.code || "");
  const name = cleanName(q.n || "");

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "glidna.com";
  const origin = `${proto}://${host}`;

  // Where a real browser lands: the app, with the trainer to link to and the
  // "open the card sheet" intent.
  const appUrl = code
    ? `${origin}/?invite=${encodeURIComponent(code)}&savecard=1${name ? `&n=${encodeURIComponent(name)}` : ""}`
    : `${origin}/?savecard=1`;

  const who = name || "Your trainer";
  const title = `${who} — save your card for training`;
  const desc = `Add a card so ${name || "your trainer"} can charge you for sessions you've had. You'll see the cancellation terms before you agree, and you can remove the card any time.`;
  // Reuses the invite card art — same brand, and it already falls back to the
  // static /og.png on any rendering error, so the unfurl can only improve.
  const imageUrl = `${origin}/api/og${name ? `?n=${encodeURIComponent(name)}` : ""}`;
  const pageUrl = `${origin}/card/${encodeURIComponent(code)}${name ? `?n=${encodeURIComponent(name)}` : ""}`;

  const et = esc(title), ed = esc(desc), eImg = esc(imageUrl), eApp = esc(appUrl), ePage = esc(pageUrl);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${et}</title>
<meta name="description" content="${ed}" />
<meta name="robots" content="noindex" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Glidna" />
<meta property="og:title" content="${et}" />
<meta property="og:description" content="${ed}" />
<meta property="og:url" content="${ePage}" />
<meta property="og:image" content="${eImg}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${et}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${et}" />
<meta name="twitter:description" content="${ed}" />
<meta name="twitter:image" content="${eImg}" />
<meta http-equiv="refresh" content="0; url=${eApp}" />
<link rel="canonical" href="${eApp}" />
<style>
  html,body{margin:0;height:100%;background:#070f0e;color:#eafcfc;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px}
  .brand{font-size:2.6rem;font-weight:800;letter-spacing:2px}
  .brand span{color:#eafcfc}
  .brand b{color:#08dce0;font-weight:800}
  .msg{color:#9bb8b8;font-size:1.05rem;max-width:380px;line-height:1.5}
  a.cta{margin-top:8px;background:#08dce0;color:#04201f;font-weight:700;text-decoration:none;
    padding:12px 22px;border-radius:10px;font-size:1rem}
</style>
<script>window.location.replace(${JSON.stringify(appUrl)});</script>
</head>
<body>
<div class="wrap">
<div class="brand"><b>GLI</b><span>DE</span></div>
<div class="msg">Taking you to Glidna to save your card…</div>
<a class="cta" href="${eApp}">Continue →</a>
</div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Never cached by a shared cache: this page is personalized to one trainer,
  // and it is a payment-adjacent destination people forward to each other.
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.status(200).send(html);
}
