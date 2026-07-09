// Glide — email invites (Option C).
//
// A trainer sends a client an email invitation containing their personalized
// invite link (/i/CODE?n=First — the same link that unfurls with a "{Name}
// invited you to Glide" card). Sent via Resend (OpenAI-simple HTTP API).
//
// SETUP: DONE (S84) — secrets RESEND_API_KEY + RESEND_FROM are set, domain
// send.smoothtraining.com verified (SPF/DKIM/DMARC), sender
// invites@send.smoothtraining.com. LIVE. Caps: 20 recipients/call (MAX_RECIPIENTS),
// 50 emails/day/trainer (S85, users/{uid}/inviteUsage/{day}).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const RESEND_FROM = defineSecret("RESEND_FROM");

const APP_ORIGIN = "https://glidna.com"; // custom domain (S90)
const MAX_RECIPIENTS = 20;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function emailHtml({ trainerName, link, note }) {
  const noteBlock = note
    ? `<tr><td style="padding:4px 32px 12px">
         <div style="background:#0f1a1c;border:1px solid #2e4241;border-radius:12px;padding:14px 16px;color:#c4dede;font-size:15px;line-height:1.55">
           <div style="color:#7e9a9a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">A note from ${esc(trainerName)}</div>
           ${esc(note).replace(/\n/g, "<br>")}
         </div></td></tr>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#05080a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05080a;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#0d1618;border:1px solid #23312f;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <tr><td style="padding:32px 32px 8px;text-align:center">
          <div style="font-size:30px;font-weight:800;letter-spacing:2px"><span style="color:#08dce0">GLI</span><span style="color:#eafcfc">DE</span></div>
        </td></tr>
        <tr><td style="padding:12px 32px 4px;text-align:center">
          <div style="color:#eafcfc;font-size:22px;font-weight:700;line-height:1.35">${esc(trainerName)} invited you to Glide</div>
        </td></tr>
        <tr><td style="padding:8px 32px 16px;text-align:center">
          <div style="color:#9bb8b8;font-size:15px;line-height:1.55">Your trainer + smart AI in one place — to keep you aware, accountable, and on track. Tap below to join and you'll be linked automatically.</div>
        </td></tr>
        ${noteBlock}
        <tr><td style="padding:8px 32px 28px;text-align:center">
          <a href="${esc(link)}" style="display:inline-block;background:#08dce0;color:#04201f;font-weight:700;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:10px">Join on Glide →</a>
          <div style="color:#5c7373;font-size:12px;margin-top:16px;word-break:break-all">Or paste this link: ${esc(link)}</div>
        </td></tr>
      </table>
      <div style="color:#4a5c5c;font-size:11px;margin-top:16px">Sent via Glide · If you weren't expecting this, you can ignore it.</div>
    </td></tr>
  </table>
</body></html>`;
}

// Plain-text alternative — a multipart (text + html) email scores better with
// spam filters than HTML-only.
function emailText({ trainerName, link, note }) {
  return `${trainerName} invited you to Glide.

Glide is your trainer + smart AI in one place — to keep you aware, accountable, and on track.
${note ? `\nA note from ${trainerName}:\n${note}\n` : ""}
Join here: ${link}

If you weren't expecting this, you can ignore this email.`;
}

exports.sendInvite = onCall(
  { secrets: [RESEND_API_KEY, RESEND_FROM], region: "us-central1", maxInstances: 10 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");

    const db = admin.firestore();
    const prof = (await db.doc(`users/${uid}`).get()).data() || {};
    const role = prof.role;
    const isTrainer = role === "head_trainer" || role === "sub_trainer" || role === "admin";
    if (!isTrainer) throw new HttpsError("permission-denied", "Only trainers can send invites.");

    const emails = Array.from(new Set(
      ((request.data && request.data.emails) || [])
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => EMAIL_RE.test(e))
    )).slice(0, MAX_RECIPIENTS);
    if (!emails.length) throw new HttpsError("invalid-argument", "Add at least one valid email address.");

    // Daily per-trainer send cap — anyone can self-signup as a "trainer", so an
    // uncapped loop here was a free spam relay on Glide's Resend account (and
    // the sending domain's reputation). 50/day is far above real coaching use.
    const DAILY_CAP = 50;
    const day = new Date().toISOString().slice(0, 10); // UTC day, same scheme as aiUsage
    const capRef = db.doc(`users/${uid}/inviteUsage/${day}`);
    const sentToday = ((await capRef.get()).data() || {}).sent || 0;
    if (sentToday + emails.length > DAILY_CAP) {
      throw new HttpsError("resource-exhausted",
        "You've hit today's invite-email limit. It resets tomorrow — or share your invite link directly.");
    }
    const note = String((request.data && request.data.note) || "").slice(0, 500);

    const code = prof.inviteCode;
    if (!code) throw new HttpsError("failed-precondition", "Open your invite panel once to create your code, then try again.");
    const first = (prof.firstName || String(prof.displayName || "").split(" ")[0] || "").trim();
    const trainerName = prof.displayName || [prof.firstName, prof.lastName].filter(Boolean).join(" ") || "Your trainer";
    const link = `${APP_ORIGIN}/i/${encodeURIComponent(code)}${first ? `?n=${encodeURIComponent(first)}` : ""}`;

    const key = RESEND_API_KEY.value();
    if (!key) throw new HttpsError("failed-precondition", "Email invites aren't set up yet.");
    const from = RESEND_FROM.value() || "Glide <onboarding@resend.dev>";
    const html = emailHtml({ trainerName, link, note });
    const text = emailText({ trainerName, link, note });
    const subject = `${trainerName} invited you to Glide`;
    // Replies go to the trainer, and a real reply-to improves deliverability.
    const replyTo = EMAIL_RE.test(prof.email || "") ? prof.email : undefined;

    const results = [];
    for (const to of emails) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        const ok = res.ok;
        if (!ok) { const t = await res.text().catch(() => ""); console.error("sendInvite resend", res.status, t.slice(0, 200)); }
        results.push({ email: to, ok });
      } catch (e) {
        console.error("sendInvite error", e && e.message);
        results.push({ email: to, ok: false });
      }
    }
    const sentOk = results.filter((r) => r.ok).length;
    if (sentOk > 0) {
      await capRef.set({ sent: admin.firestore.FieldValue.increment(sentOk),
        updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        .catch((e) => console.error("inviteUsage write failed", e && e.message));
    }
    return { results, link };
  }
);
