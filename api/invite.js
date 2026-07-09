// Personalized invite landing (Option B).
// A trainer's share link is /i/CODE?n=FirstName  (rewritten here via vercel.json
// to /api/invite?c=CODE&n=FirstName). This function returns a tiny HTML page whose
// Open Graph / Twitter meta name the inviter ("Kevin invited you to Glidna") so the
// link unfurls with a personalized card in Messages / WhatsApp / Slack, etc.
//
// Link-preview crawlers don't run JS, so they read the meta below. Real browsers
// run the redirect and land in the app at /?invite=CODE&n=Name, where the existing
// auto-link flow (App.jsx) links the new client to the trainer.

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
// Only keep plausible invite-code characters (our codes are short + alphanumeric
// with dashes). Prevents anything odd from riding through into the redirect URL.
function cleanCode(raw) {
  return (raw || "").toString().trim().replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
}

export default function handler(req, res) {
  const q = req.query || {};
  const code = cleanCode(q.c || q.code || "");
  const name = cleanName(q.n || "");

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "calorieiq-jet.vercel.app";
  const origin = `${proto}://${host}`;

  // Where a real browser should end up: the app, with the invite (+ name) params.
  const appUrl = code
    ? `${origin}/?invite=${encodeURIComponent(code)}${name ? `&n=${encodeURIComponent(name)}` : ""}`
    : `${origin}/`;

  const title = name ? `${name} invited you to Glidna` : "You're invited to Glidna";
  const desc = name
    ? `${name} wants you on Glidna — where your trainer and smart AI keep you aware, accountable, and on track. Tap to join.`
    : "Join on Glidna — where your trainer and smart AI keep you aware, accountable, and on track.";
  const imageUrl = `${origin}/api/og${name ? `?n=${encodeURIComponent(name)}` : ""}`;
  const pageUrl = `${origin}/i/${encodeURIComponent(code)}${name ? `?n=${encodeURIComponent(name)}` : ""}`;

  const et = esc(title), ed = esc(desc), eImg = esc(imageUrl), eApp = esc(appUrl), ePage = esc(pageUrl);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${et}</title>
<meta name="description" content="${ed}" />
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
<div class="msg">${et}. Taking you there…</div>
<a class="cta" href="${eApp}">Continue to Glidna →</a>
</div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Short cache: crawlers can cache the card briefly; the page is cheap to rebuild.
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.status(200).send(html);
}
