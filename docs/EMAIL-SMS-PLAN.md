# Automated email (per trainer) + SMS — plan

_Kevin's direction: **email first** (priority), start with the shared-domain approach, add per-trainer
own-domain later; **SMS much later** (nice to have). Logged for when we build it._

## Where we are today (built, live)
- Resend + a Cloud Function (`sendInvite`) send email from our **verified domain**
  `invites@send.smoothtraining.com` (SPF + DKIM set in Squarespace DNS; DMARC optional/pending).
- Currently used for **client invites**. Confirmed delivering (first sends may land in spam until the
  domain warms up — marking "Not spam" trains filters; DMARC helps).

## Phase 1 — Automated email, shared domain, personalized (DO FIRST)
Every trainer can have automated emails sent to **their** clients on **their behalf**, with **no
per-trainer setup**:
- **Sender:** our one verified domain, but **From name = the trainer/business** (e.g.
  `"Kevin — Smooth Training" <invites@send.smoothtraining.com>`), with **Reply-To = the trainer's own
  email**, so replies go to them. (This is how Calendly/Mailchimp send "on behalf of.")
- **Automated triggers** (opt-in, wired into the existing Notification Center):
  - Welcome email when a client joins
  - Weigh-in / food-logging reminders
  - Weekly progress report
  - Inactivity nudge ("haven't logged in N days")
- **Build pieces:** email templates (branded), scheduled/triggered Cloud Functions (cron on Blaze),
  per-user on/off preferences, and a required **unsubscribe link** (CAN-SPAM) + suppression list.
- **Deliverability care as volume grows:** finish DMARC, warm up sending, throttle, protect domain
  reputation, honor unsubscribes.

## Phase 2 — Per-trainer OWN domain (LATER, optional/pro)
A trainer verifies **their own** domain in Resend (the same SPF/DKIM/DMARC DNS steps we did once, but per
trainer) so mail truly comes from their address. More setup per trainer → offer as a **pro option** for
those who want full branding. Resend supports many domains; each needs its own verification.

## Phase 3 — SMS (MUCH LATER, opt-in/premium)
Great for reminders (texts get read), but has real costs/rules email doesn't:
- **Provider:** Twilio (or similar). **Cost:** ~1¢/SMS + ~$1–2/mo per number (not free like email).
- **US carrier registration ("A2P 10DLC"):** a one-time business verification, takes a few days before
  app texts can send.
- **Consent (TCPA):** explicit opt-in required; "reply STOP" must unsubscribe (handle the webhook).
- → Ship as an **opt-in / premium** reminder add-on once there's demand. Same trigger framework as email.

## Priority order (Kevin, confirmed)
1. Email — shared domain, personalized (Phase 1). **Priority.**
2. Per-trainer own domain (Phase 2) — later.
3. SMS (Phase 3) — much later; liked the option, not urgent.
