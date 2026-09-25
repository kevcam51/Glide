# The Workout Programmer — AI programming for clients, delivered inside Trainerize

_Planned S238b (Sep 25). Nothing is built yet. API facts it rests on: `docs/TRAINERIZE-API.md`
§S238 and §S238b (all verified live against Kevin's account, read-only)._

## Kevin's decisions (Sep 24–25) — the spec

- **A client messages in Trainerize and addresses the Programmer; the AI answers and builds their
  program.** The client is responsible for sharing their situation: photos of a home gym, which gym
  they go to, what time, how busy it is. Clients can ask for improvements, removals and progressions.
- **The AI must genuinely adapt** — equipment, space, time available, preferred style, and WHEN they
  train: at prime time in a commercial gym there is less free equipment and a need to stay in one
  place.
- **Approval split:** automatic for questions, gathering details and small swaps; **Kevin approves
  new programs and big changes**; **pain, injury and medical always go to Kevin, as urgent.**
- **Complement Trainerize, never compete with it.** No workout-video library in Glidna — clients
  watch demos in Trainerize's own app. (This is also what makes the licensing problem go away.)
- **An add-on, for clients AND trainers.**
- **Users can talk to it through the Glidna connector too.**
- **HQ gets a Head of Programs**, Kevin's brainstorming partner for the program piece.
- **Zapier:** move what's worth keeping into Glidna (see the last section).

## What exists and what's new

| Exists today | New for the Programmer |
|---|---|
| AI chat with tools; reads photos | A **coaching program model**: sets, reps/time, rest, supersets, progression, a swap for every exercise |
| `propose_workout` / `set_workout_schedule` — a weekly **calorie-burn** schedule (exercise + minutes per day, Glidna's 185-exercise MET list) | The **Trainerize exercise catalog** (3,174 exercises with muscle/equipment/movement tags) — the server half of the parked Workout Builder, media-free |
| Trainerize API connection + per-trainer credentials (S215c) | The **write path** into a client's Trainerize program |
| HQ desk, door and time cards | A **client training profile**, the **message loop** and the **urgent lane** |
| Push notifications to Kevin | Approval levels **enforced in code** |

## The client training profile — what the AI plans around

Stored per client, server-side (never in a public bundle), readable by the client and their trainer:

- **Where they train:** each location (home, a named gym, hotel, outdoors) with its equipment list —
  read from photos, then confirmed by the client ("I see adjustable dumbbells to 50 and a flat
  bench — anything else?"). Space limits (apartment, noise, ceiling height, no jumping).
- **When:** days, session length, time of day, and how crowded that gym is then.
- **Style:** strength, muscle, circuits, HIIT, classes; favourite and hated exercises; must-avoids.
- **Ability:** experience, current numbers and personal bests (Trainerize tracks PBs), how hard
  recent workouts felt (the RPE clients already log in Trainerize).
- **Health:** PAR-Q answers and known injuries — used only to AVOID things and to escalate, never to
  diagnose or treat.
- **Goals:** from the Glidna plan (fat loss, muscle, performance), with the calorie target beside it.

## Adaptation rules — the starting set (for Kevin and the Head of Programs to refine)

- **Prime time → a one-station plan.** Pick one spot and one or two pieces of kit (a pair of
  dumbbells and a bench), build supersets around them, no hopping between machines. Off-peak gets the
  full plan.
- **Every exercise carries a swap** with the same movement pattern and muscle ("if the cable is
  taken, do this") — the catalog's tags make this mechanical, not guesswork.
- **Equipment-true:** only exercises whose equipment the client has at that location.
- **Time-boxed:** the session fits the minutes available, warm-up included; short on time →
  supersets or a circuit rather than cutting exercises silently.
- **Progression:** double progression by default; the RPE clients log drives it (felt easy twice →
  progress; near-max → hold or back off). A lighter week every 4–6 weeks.
- **Requests:** a swap or removal is a small edit; restructuring the week is a big one (approval).

## The conversation loop

1. A client messages in Trainerize and addresses the Programmer (a tag such as "@Programmer", or a
   thread with a "Workout Programmer" team member — see open questions).
2. Glidna hears about it — from the `msg.received` webhook once Trainerize registers it, and until
   then by checking threads every few minutes (the webhook's 500 ms timeout means the receiver only
   queues; the work happens after).
3. Glidna reads the conversation (`message/getMessages`) and any photos (`file/getFile`, GET).
4. The Programmer (Claude Sonnet, on Glidna's key) decides which of the approval levels below the
   request falls into, and acts accordingly.
5. Approved programs are written into the client's Trainerize program as a new phase, and the client
   is told it's in their app.
6. Every exchange is logged on the Programmer's time card in HQ.

It always says it's an AI. Replies can come from a team member named "Workout Programmer" (with
group-level auth the API can send as another user in the group), or from Kevin's account signed
"— Workout Programmer (AI)".

## Approval levels — enforced in the tools, not trusted to a prompt

| Level | Examples | What happens |
|---|---|---|
| **Automatic** | Answering a question; asking for photos, times, preferences; swapping one exercise for its listed alternative; removing one exercise | Done and replied to at once; logged |
| **Kevin approves** | A new program or phase; restructuring the week; changing training days; a new progression block | Drafted to Kevin's HQ desk; client told "Kevin's reviewing it"; written to Trainerize only after his tap |
| **Urgent** | Pain, injury, dizziness, chest pain, pregnancy, surgery, medication, anything medical | See the urgent lane |

The level is decided by what the tool DOES (a phase write is always "approve"), so the connector and
the chat get the same gate.

## The urgent lane (pain, injury, medical)

- **Detection:** the AI's own reading plus a keyword backstop (pain, hurt, injured, dizzy, chest,
  pregnant, surgery, medication…) — a false alarm costs Kevin a glance; a miss costs far more.
- **Kevin:** an immediate push to his phone, and an urgent item pinned to the top of his HQ desk.
- **The client:** a safe holding reply at once — stop that exercise, Kevin will reach out, and if it's
  an emergency, call 911. No advice, no diagnosis.
- **The program:** frozen for that client until Kevin clears it.
- Later, if push isn't loud enough: a text message to Kevin (Twilio or ClickSend, pennies each).

## Through the connector

New tools go into `buildTools()` in `functions/aitools.js`, so they reach the Glidna connector
automatically — the in-app AI and the connector must always have the same abilities, and the
connector's tool list is generated from that one function. There, the user's own Claude does the
thinking and Glidna supplies the data and the tools — with the same approval gates, because they live
in the tools.

## The add-on

- An entitlement (e.g. `entitlements.programmer`), for **clients** (their own programs) and
  **trainers** (for their clients, through their own Trainerize connection — S215c already stores
  per-trainer credentials). Pricing to decide.
- Cost to run, on Glidna's key: ~1–5¢ per message, ~10–20¢ per full program — for Smooth Training's
  13 active clients, likely under $10 a month.

## Open questions — one email to help@trainerize.com covers all of them

1. Register a webhook URL for our Studio account (and send the `TR-SecretKey`).
2. Written permission to show the exercise thumbnails and demo videos the API returns, inside a tool
   for our own trainers (unblocks the parked Workout Builder, `docs/WORKOUT-BUILDER.md` on its branch).
3. Does a non-human team member ("Workout Programmer") need a paid trainer seat?
4. Is "new client added" available as a webhook? (Their help article lists it; the reference doesn't.)

## Build order

0. Kevin sends the email above.
1. Kevin makes a **test client** in Trainerize; prove `trainingPlan/add` and `dailyWorkout/set` on it.
2. The exercise catalog: bring the server half of the parked library sync to main, media-free.
3. The program model and tools: build / revise / swap / progress, plus get/set the training profile.
4. The message loop (polling first, webhook later), the urgent lane and HQ desk approvals.
5. Tune the rules with Kevin and the Head of Programs, on real requests.
6. The add-on gate and pricing.
7. Retire the Zapier "Celebrations": workout / cardio / goal events → celebration drafts in Glidna.

## Zapier → Glidna

Kevin's Zapier (checked Sep 25, read-only): **Pro, $29.99/month, 0 of 750 tasks used this cycle;
19 Zaps, 8 switched on, none run in the last 60 days** — so today it costs about $360 a year and
does nothing. Every Zap maps onto something Glidna does or can do:

| Zap(s) | Apps | In Glidna |
|---|---|---|
| Workout / Cardio / Habit / Nutrition Goal / Weight Goal Celebrations with AI (5) | Trainerize + AI | Trainerize events → a celebration drafted by Glidna's AI (build order step 7) |
| Chat GPT Auto Message; Automated Workout Message | Trainerize + ChatGPT/AI | Glidna's AI (Claude) — part of the Programmer and the Check-In Coordinator |
| New Client Welcome Flow | Trainerize, Gmail + 3 | Glidna notices new Trainerize clients on its sync; welcome email through Glidna's mail (Resend) or a Front Office draft |
| Create tasks in Google Tasks for new Trainerize clients | Trainerize → Google Tasks | An item on Kevin's HQ desk |
| Client Connection Sheet | Trainerize → Sheets | Unneeded — Glidna already holds the roster |
| New Booking → Trainerize Confirmation; 24-Hour Schedule Reminder | Acuity, Sheets, Trainerize | Glidna's own booking + session reminders (S187); or read Acuity's API if Acuity stays |
| Create Stripe Customer for New Clients | Acuity → Stripe | Glidna's card-on-file flow (the /card/ link) already creates Stripe customers |
| Request signatures in SignNow; Waiver Completed; PAR-Q Completed | Trainerize, SignNow | Trainerize's own welcome email already attaches the PAR-Q and waiver; SignNow only if Kevin wants e-signatures kept |
| Send new clients a text (ClickSend) | Trainerize → ClickSend | Trainerize's invitation email covers it; a text via ClickSend's API later if wanted |
| Untitled Zap ×2 | Stripe/Gmail; Acuity/Sheets | Drafts, off — nothing to move |

Recommendation: rebuild the celebrations and the welcome flow in Glidna, then cancel or downgrade
Zapier (Kevin's call, in his Zapier billing page). Nothing depends on the Zaps today — none has run
in 60 days.
