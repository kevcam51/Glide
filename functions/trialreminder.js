// Glidna — end-of-trial reminder emails (reverse trial, S92).
//
// Runs once a day. For users still on the free AI trial it sends:
//   • a nudge ~3 days before the trial ends, and
//   • a "trial ended" note at/after expiry
// both framed as the reverse trial: "add a card to keep your AI coach — your
// logging & data stay free either way." Each is sent at most ONCE per user
// (deduped by trialReminderSentAt / trialEndedSentAt on the profile).
//
// Reuses the Resend setup from invites.js (RESEND_API_KEY + RESEND_FROM,
// sender invites@send.smoothtraining.com, verified domain). No new setup.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const RESEND_FROM = defineSecret("RESEND_FROM");

const APP_ORIGIN = "https://glidna.com";
const DAY = 86400000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_PER_RUN = 300; // spam/cost backstop

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function startMsOf(p) {
  const t = p && p.trialStartedAt;
  return t && typeof t.toMillis === "function" ? t.toMillis() : typeof t === "number" ? t : null;
}

function emailFor(kind, first, daysLeft) {
  const hi = first ? `Hi ${esc(first)},` : "Hi,";
  const cta = `<a href="${APP_ORIGIN}" style="display:inline-block;background:#08DCE0;color:#08181a;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:10px">Keep my AI coach</a>`;
  if (kind === "pre") {
    const when = daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`;
    const subject = `Your Glidna AI trial ends ${when}`;
    const body = `${hi}<br><br>Your free Glidna <b>AI coach</b> trial ends ${when}. Add a card to keep it — chat, photo &amp; voice logging, and coaching. <b>Your logging and data stay free either way</b>, so there's no rush and nothing to lose.<br><br>${cta}<br><br>You can add a card anytime from the menu → Plans &amp; pricing.`;
    const text = `${first ? "Hi " + first + "," : "Hi,"}\n\nYour free Glidna AI coach trial ends ${when}. Add a card to keep it (chat, photo & voice logging, coaching). Your logging and data stay free either way.\n\nKeep your AI: ${APP_ORIGIN}\n`;
    return { subject, html: wrap(body), text };
  }
  const subject = "Your Glidna AI trial has ended";
  const body = `${hi}<br><br>Your free <b>AI coach</b> trial has ended. Your logging and data are still free — the AI (chat, photo &amp; voice logging, coaching) is the part that's paused. Add a card to switch it back on whenever you're ready.<br><br>${cta}`;
  const text = `${first ? "Hi " + first + "," : "Hi,"}\n\nYour free Glidna AI coach trial has ended. Your logging and data stay free; the AI is paused. Add a card to switch it back on anytime.\n\n${APP_ORIGIN}\n`;
  return { subject, html: wrap(body), text };
}
function wrap(inner) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0e1a1c;font-size:15px;line-height:1.55">
  <div style="font-weight:800;font-size:20px;letter-spacing:.5px;margin-bottom:14px"><span style="color:#08b9bd">GLI</span><span style="color:#0e1a1c">DNA</span></div>
  ${inner}
  <div style="margin-top:22px;color:#8394a0;font-size:12px">You're receiving this because you started a free trial on Glidna. It's a one-time reminder.</div>
</div>`;
}

async function sendEmail(key, from, to, msg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: msg.subject, html: msg.html, text: msg.text }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) { console.error("trialReminder resend", res.status, (await res.text().catch(() => "")).slice(0, 160)); return false; }
    return true;
  } catch (e) { console.error("trialReminder send error", e && e.message); return false; }
}

exports.trialReminders = onSchedule(
  { schedule: "every day 15:00", timeZone: "America/New_York",
    secrets: [RESEND_API_KEY, RESEND_FROM], timeoutSeconds: 300, region: "us-central1" },
  async () => {
    const key = RESEND_API_KEY.value();
    if (!key) { console.log("trialReminders: no RESEND_API_KEY — skipped"); return; }
    const from = RESEND_FROM.value() || "Glidna <onboarding@resend.dev>";
    const db = admin.firestore();
    const now = Date.now();

    // Only trial users can have a pending reminder.
    const snap = await db.collection("users").where("subscriptionStatus", "==", "trial").get();
    let sent = 0, checked = 0;
    for (const doc of snap.docs) {
      if (sent >= MAX_PER_RUN) break;
      const p = doc.data() || {};
      if (p.role === "admin") continue;
      if (!EMAIL_RE.test(p.email || "")) continue;
      const startMs = startMsOf(p);
      if (!startMs) continue;
      const endMs = startMs + (p.trialLengthDays || 30) * DAY;
      const daysLeft = Math.ceil((endMs - now) / DAY);
      const first = (p.firstName || String(p.displayName || "").split(" ")[0] || "").trim();
      checked++;

      // Pre-expiry nudge: 1–3 days left, once.
      if (daysLeft >= 1 && daysLeft <= 3 && !p.trialReminderSentAt) {
        if (await sendEmail(key, from, p.email, emailFor("pre", first, daysLeft))) {
          await doc.ref.set({ trialReminderSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
          sent++;
        }
      // Expiry note: at/after end, once.
      } else if (daysLeft <= 0 && !p.trialEndedSentAt) {
        if (await sendEmail(key, from, p.email, emailFor("post", first, 0))) {
          await doc.ref.set({ trialEndedSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
          sent++;
        }
      }
    }
    console.log("trialReminders", JSON.stringify({ trialUsers: snap.size, checked, sent }));
  }
);
