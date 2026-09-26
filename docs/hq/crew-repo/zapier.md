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

## The decision (Sep 26 2026 — Kevin: "I will go with whatever is best")

**Move to Zapier's free plan before the Oct 7 renewal, and keep SignNow on it.**
Facts behind it (checked Sep 26, zapier.com and help.zapier.com):

- The free plan runs **unlimited two-step Zaps** (one trigger, one action), **100 tasks a month**,
  and no premium apps, Webhooks, Filters, Paths or Formatter. Instant triggers still fire at once.
- **SignNow and ABC Trainerize are NOT premium apps**, so both work on the free plan.
- A downgrade takes effect at the end of the billing cycle, and **every Zap with more than one
  action is switched off then**, so #1–#3 must be replaced first.
- Zapier's Claude connector (MCP) works on every plan: **2 tasks per call**, about 50 calls a month
  on the free plan. Set its server to **Managed** mode at mcp.zapier.com so each agent gets only
  the actions picked for it (new servers start in Agentic mode, where the AI enables actions itself).

## The four SignNow Zaps (build these first)

Easiest: in Zapier, press **Create → Zap**, and type each sentence into the AI builder (Copilot),
then check the SignNow template it picked. Skip "test step" on the SignNow action, or it sends a real
invite — or test with your own email.

1. "When a new client is added in ABC Trainerize, create a document from my waiver template in
   SignNow and send the role invite to the client's email." (Trigger **New Client**; action
   **Create Document From Template & Send Role Invite**.)
2. The same, with the **PAR-Q** template.
3. "When a document is completed in SignNow (the waiver), send the client a thank-you message in
   ABC Trainerize." (Trigger **Document Completed**; action **Send Message in Trainerize**.)
4. The same, for the PAR-Q.

About 4 tasks per new client, so roughly 20 new clients a month fit alongside the agents' calls.
Then switch these four **on**, switch **#1, #2 and #3 off**, and downgrade in Zapier's billing
settings.

## The rest of the old welcome flow (optional)

Each of #1's other steps can be its own two-step Zap if Kevin wants to keep it, triggered by
**New Client** in ABC Trainerize: **Send Message in Trainerize** (the welcome message), **Add Tag to
Client**, **Assign To** (the trainer), the add-on program action, and a Gmail welcome email. That is
about five more tasks per new client. Otherwise Glidna takes them over later (build order in Glidna's
docs/WORKOUT-PROGRAMMER.md), and the Google Sheets rows retire either way.

## On request, not automatic

When Kevin needs a document sent outside the automatic flow ("send Jane the waiver"), the
**Client Onboarding Specialist** does it in its Claude chat through Zapier's connector, with only
SignNow's send-invite and find actions switched on for it. It reads back the name and email, and
sends only after Kevin says yes. That is 2 tasks per send.

## A note on Trainerize webhooks

Zapier's Trainerize triggers fire instantly, but relaying them to Glidna needs **Webhooks by
Zapier**, a paid-plan app. Glidna doesn't need the relay: Trainerize will send its webhooks straight
to https://glidna.com/hooks/trainerize once its API team turns them on (Kevin's short email, Sep 26),
and until then Glidna checks Trainerize itself every 30 minutes.
