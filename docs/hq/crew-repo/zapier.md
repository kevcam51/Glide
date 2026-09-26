# Kevin's Zapier — inventory and recommendation (for the Automations Lead)

_Read Sep 25 2026 (S238b), read-only: every Zap opened in Zapier's editor, nothing changed. This is
the Automations Lead's starting file — add it to its Claude Project._

## The account

- **Plan: Pro, $29.99/month** (monthly billing; Zapier quotes $19.99/month billed yearly). 750 tasks
  a month; **0 used** this cycle. Usage resets **Oct 7 2026** — the natural point to change plans.
- **19 Zaps: 8 switched on, 11 off (5 of the 11 are unfinished drafts). No Zap has run in 60 days,
  and Zap history shows no runs at all in the last 30.**
- **8 app connections, all "Connected":** ABC Trainerize (16 Zaps), Google Sheets (7), ChatGPT (6),
  Acuity Scheduling (4), SignNow (3), Gmail (2), Stripe (1), Calendly (0). Nothing is broken —
  the Zaps simply haven't been triggered (no new clients, bookings or goal hits through these apps).

## Every Zap

| # | Zap | On? | Steps | What it does | Recommendation |
|---|---|---|---|---|---|
| 1 | New Client Welcome Flow | ON | 11: Trainerize New Client → Formatter date → SignNow waiver invite → SignNow PAR-Q invite → Sheets row ×2 → Trainerize message → Trainerize tag → Trainerize assign trainer → Trainerize add-on program → Gmail email | The whole onboarding in one chain | **Split.** SignNow invites stay in Zapier (two 2-step Zaps, below). Message, tag, trainer, program and email move to Glidna, which already sees new Trainerize clients on its sync. The Sheets rows retire (Glidna holds the roster). |
| 2 | Waiver Completed – Congratulations | ON | 5: SignNow Document Completed → Trainerize message → Sheets lookup → Formatter date → Sheets update | Thanks the client, marks the sheet | **Keep in Zapier as 2 steps** (SignNow completed → Trainerize message); drop the Sheets steps. |
| 3 | PAR-Q Completed – Congratulations | ON | Same shape as #2 | Same, for the PAR-Q | **Keep in Zapier as 2 steps**, as #2. |
| 4 | Workout Celebrations with AI | off | 5: Trainerize Workout Completed → Webhooks custom request → ChatGPT conversation → Formatter date → Trainerize message | AI-written congratulations | **Rebuild in Glidna** (Claude, with the client's real data). |
| 5 | Cardio Celebrations with AI | off | Same shape, Cardio Completed | | **Rebuild in Glidna.** |
| 6 | Habit Celebrations with AI | off | Same shape, Habit Completed | | **Rebuild in Glidna.** |
| 7 | Nutrition Goal Celebrations with AI | ON | Same shape, Daily Nutrition Goal Hit | | **Rebuild in Glidna.** |
| 8 | Weight Goal Celebrations AI | ON | Same shape, Weight Goal Hit | | **Rebuild in Glidna.** |
| 9 | Chat GPT Auto Message | off | 2: Trainerize Workout Completed → ChatGPT Send Prompt | An earlier version of #4 | **Retire** (superseded by #4 → Glidna). |
| 10 | Automated Workout Message | off | 3: Trainerize Workout Completed → AI by Zapier → Trainerize message | Another earlier version of #4 | **Retire.** |
| 11 | 24-Hour Schedule Reminder | ON | 3: Acuity Appointment Start → Sheets lookup → Trainerize message | Reminder the day before | **Glidna** — its session reminders (S187) already do this for sessions booked in Glidna. Only rebuild against Acuity if Acuity stays. |
| 12 | New Booking – Trainerize Confirmation (Acuity) | ON | 3: Acuity New Appointment → Sheets lookup → Trainerize message | Booking confirmation | **Glidna**, same reasoning as #11. |
| 13 | Client Connection Sheet | ON | 2: Trainerize Invitee Created → Sheets row | Roster sheet | **Retire** — Glidna holds the roster. |
| 14 | Create tasks in Google Tasks for new Trainerize clients | off (draft) | 2: Trainerize New Client → Google Tasks | To-do per new client | **Retire** — becomes an item on Kevin's HQ desk. |
| 15 | Request signatures in SignNow from new Trainerize clients | off (draft) | 2: Trainerize New Client → SignNow free-form invite | An earlier version of #1's SignNow steps | **Retire** in favour of the two 2-step SignNow Zaps below. |
| 16 | Send new Trainerize clients a text (ClickSend) | off (draft) | 2: Trainerize New Client → ClickSend SMS | Setup link by text | **Retire for now** — Trainerize's invitation email covers it; Glidna can text through ClickSend's API later. |
| 17 | Create Stripe Customer for New Clients | off (draft) | 1 of 2: Acuity New Appointment → (action never chosen) | Unfinished | **Retire** — Glidna's card-on-file link creates Stripe customers. |
| 18 | Untitled Zap | off (draft) | 4: Stripe New Charge → Filter → Delay → Gmail email | Unfinished receipt/thank-you idea | **Retire**; if wanted, Glidna already sees every session charge. |
| 19 | Untitled Zap | off (draft) | 3: Acuity Appointment Start → Filter → Sheets lookup | Unfinished | **Retire.** |

## SignNow — keep it (Kevin likes it)

The simplest way to keep SignNow is **four 2-step Zaps**, which fit Zapier's free plan (two steps per
Zap, 100 tasks a month):

1. Trainerize New Client → SignNow "Create Document From Template & Send Role Invite" (waiver)
2. Trainerize New Client → SignNow "Create Document From Template & Send Role Invite" (PAR-Q)
3. SignNow Document Completed (waiver) → Trainerize Send Message (thanks)
4. SignNow Document Completed (PAR-Q) → Trainerize Send Message (thanks)

About 4 tasks per new client, so ~25 new clients a month on the free plan.
⚠️ **Check first:** this only works if neither SignNow nor ABC Trainerize is a "Premium" app on
Zapier (premium apps need a paid plan). Neither appeared to be when checked, but confirm in the Zap
editor — a premium app shows a badge when you pick it.

The other way is Glidna calling SignNow's own API directly (send from a template, get told when it's
signed, record "waiver signed" on the client). No Zapier at all — but it needs a SignNow API app, and
it's worth checking whether Kevin's SignNow plan includes API access.

## Recommendation for the plan

1. Build the four SignNow Zaps above and switch off #1–#3.
2. Glidna takes over the welcome message / tag / trainer / program / email and the celebrations.
3. **Downgrade to the free plan before the Oct 7 renewal** (Kevin does this himself, in Zapier's
   billing page): the account stays, the SignNow Zaps keep running, and Zapier's AI connector (MCP)
   still works for the Automations Lead to try things — each call uses 2 of the 100 tasks.
4. Upgrade again only when a multi-step automation genuinely can't live in Glidna.

## A note on Trainerize webhooks

Zapier's Trainerize triggers (Workout Completed, Habit Completed, New Client, …) fire instantly —
they could relay events to Glidna while Trainerize registers webhooks for us directly. But the relay
step, **Webhooks by Zapier, is a paid-plan app**, so it only makes sense if Pro is kept anyway. On the
free plan, Glidna checks Trainerize itself every few minutes until the direct webhooks are live (the
request to api@trainerize.com was drafted in Kevin's Gmail on Sep 25, for him to send).
