# Privacy Policy — AI Connector language

> **STATUS (S130, Jul 26 2026): §3a/3b/3c/3d are PUBLISHED LIVE** in
> `public/privacy.html` (Last updated bumped to Jul 26, 2026). Kevin's decision: ship the
> accurate disclosure now, counsel reviews after. Rationale: the connector is already live and
> processing data, so having no policy describing it was the larger exposure — publishing an
> accurate description is a net risk REDUCTION, not a corner cut.
>
> **This document remains the attorney brief.** §5's open questions are NOT resolved by
> publishing — most importantly **Q3 (trainer→client)**: when a trainer reads client data through
> their OWN external AI, the clients have consented to trainer access but not to that specific
> onward flow. Publishing discloses it; it does not resolve it. Q1 (affirmative checkbox vs
> links) is a cheap code change if counsel wants it.

> **Status: DRAFT, not published.** Written Session 114 (Jul 2026) for Kevin to take to counsel
> alongside the waiver and session-billing terms already in review
> (`docs/SESSIONS-ATTORNEY-QUESTIONS.md`, `docs/LEGAL-WAIVER.md`).
>
> **I am not a lawyer.** This is engineering-accurate drafting — it describes exactly what the
> code does — but the legal sufficiency (especially for health data) needs counsel.

---

## 1. Why the current policy isn't sufficient

`public/privacy.html` §3 ("Who can see your data") already lists **Anthropic** as a service
provider "(AI responses)". That covers the **in-app** Ask Glidna feature, where *we* call
Anthropic with our own API key, as our processor, under our contract.

**The MCP connector is a materially different data flow** and is not covered:

| | In-app AI (covered today) | MCP connector (NOT covered) |
|---|---|---|
| Who calls the AI | Glidna, with Glidna's API key | The **user's own** AI account |
| Legal role of the AI vendor | Our **processor**, under our terms | An **independent controller**, under *their* terms with the user |
| Who pays | Glidna | The user's own subscription |
| Our control over retention/training | Governed by our vendor agreement | **None** — governed by the user's own agreement |
| Which AI vendor | Anthropic (chosen by us) | **Any** MCP-capable assistant the user connects |

The key disclosure gap: once data leaves via the connector, **it is governed by the user's
agreement with their AI provider, not ours.** A user should understand that before granting.

## 2. What the system actually does (facts counsel should rely on)

Verified against the shipped code (`functions/mcp.js`, `functions/mcpauth.js`):

- **User-initiated only.** Nothing flows until the user completes an OAuth authorization and
  taps **Allow** on a Glidna-hosted consent screen. There is no background/automatic export.
- **Scoped.** The current grant is **read-only** (`scope=read`). Write scopes
  (`write:logs`, `write:plan`, `trainer`) are defined but **not yet granted** — Phase 3.
- **Same access ceiling as the app.** The connector calls the identical server-side tool layer
  (`aitools.js runTool`) with the same authorization context. A client can only reach their own
  data; a trainer only clients already linked to them. **The connector cannot widen access.**
- **What can be read today:** profile (name, gender, age/DOB-derived age, height, weight),
  calorie/macro targets, food logs, weigh-ins, body measurements & body-fat estimates, workout
  plans, plan notes; and for trainers, their own clients' equivalent summaries.
- **Revocable.** The user can disconnect in their AI's settings; we can revoke server-side by
  deleting the token record. Access tokens expire after 1 hour; refresh tokens after 30 days.
- **We do not store the AI conversation.** We see only individual tool calls; the chat itself
  lives with the user's AI provider.
- **Tokens are opaque and hashed** at rest; a database leak does not yield usable credentials.
- **Trainer note (flagged for counsel):** a trainer connecting their own Claude can read data
  about **their clients**, who are third parties that did not personally approve *that trainer's*
  connector. Arguably already covered by the existing trainer-access consent (§3 "Your trainer…
  authorizes that trainer to view and edit your fitness data"), but **counsel should confirm**
  whether client-level notice is required when a trainer routes client data through an external
  AI. See open question Q3.

## 3. PROPOSED policy text (drop-in for `public/privacy.html`)

### 3a. New subsection under §3 "Who can see your data"

> **AI assistants you connect yourself.** You can connect Glidna to an outside AI assistant
> (such as Claude) so it can work with your Glidna data on your behalf. This only happens if
> you start the connection and approve it on our permission screen, and you choose what it may
> do — reading your data, and (where offered) logging entries for you.
>
> When you connect an assistant, the information it requests is sent to **that** provider, and
> from that point it is handled under **your agreement with them and their privacy policy, not
> ours** — including how long they keep it and whether they use it to improve their services.
> We cannot control or delete data once it is in your assistant's hands. Please review your AI
> provider's privacy terms before connecting.
>
> A connected assistant can never see more than you can. It uses the same permission rules as
> the app: your own data, and — if you are a trainer — the clients already linked to your
> account. It cannot reach anyone else's information.
>
> You can disconnect at any time in your AI assistant's settings. Disconnecting stops all future
> access immediately; it does not retrieve data your assistant already received.

### 3b. Amend the existing service-provider sentence

Current text lists "Anthropic (AI responses)". Suggested clarification:

> …Anthropic (AI responses **generated inside Glidna**)…

so the in-app processor role is distinguishable from a user-connected assistant.

### 3c. Add to §5 "Your choices & rights"

> **Disconnecting an AI assistant.** Remove Glidna from your AI assistant's connector settings.
> You may also ask us to revoke a connection at [contact address]; we will invalidate the
> credentials so the assistant loses access.

### 3d. Add to §1 "What we collect" (transparency about our own logging)

> **Connector activity.** When you use a connected AI assistant, we record a per-day count of
> requests (to enforce fair-use limits) and the standard server logs described above. We do not
> store the conversations you have with your assistant.

## 4. Consent-screen wording (SHIPPED — for counsel's awareness)

The Glidna permission screen (`src/OAuthConsent.jsx`) shows the granted permissions in plain
language and now carries this line with links to both policies:

> "Connecting shares your Glidna data with the AI assistant you're linking, which processes it
> under its own terms. See our Terms of Service and Privacy Policy."

**Design decision for counsel to confirm:** we used **links, not a tick-box**. Rationale: the
person is an existing account holder who accepted the Terms at signup; the connector authorizes
a different door into their *own* data rather than forming a new agreement, and the
grant itself is recorded server-side with a timestamp, user id, client id and scope. **If counsel
prefers affirmative click-through consent** (plausible given health data), adding a required
checkbox is a small change — see Q1.

## 5. Open questions for counsel

1. **Affirmative consent?** Are links sufficient, or does health/fitness data warrant a required
   "I understand and agree" checkbox on the connector consent screen? (Cheap to add.)
2. **Sensitive-data category.** Glidna holds weight, body-fat, measurements, and optional DOB.
   Does routing this to a user-chosen third party trigger heightened consent under any applicable
   regime (state health-privacy statutes, GDPR Art. 9 if EU users, etc.)? Note Glidna is **not**
   a HIPAA covered entity, but state laws (e.g. Washington's My Health My Data) may still reach
   consumer health data.
3. **Trainer→client flow (most important).** When a trainer connects their own AI and reads
   client data through it, is the clients' existing consent to trainer access sufficient, or do
   clients need separate notice/opt-out for external-AI processing? Should we (a) notify clients
   that their trainer has connected an AI, (b) give clients an opt-out, or (c) rely on existing
   consent?
4. **Minors.** The waiver work established Kevin may serve minors with guardian consent. Should
   the connector be **blocked** for accounts flagged as minors, or is guardian consent adequate?
5. **Retention disclaimer.** Is "we cannot control or delete data once it is in your assistant's
   hands" adequately protective, or should it be stronger/more specific?
6. **Directory listing.** Anthropic's connector-directory submission requires a public privacy
   policy that reviewers assess. Anything to add specifically for that review?

## 6. Implementation checklist

- [x] **DONE (S130)** Merge §3a/3b/3c/3d into `public/privacy.html`; bump its "Last updated" date.
- [ ] Decide checkbox vs links on the consent screen (Q1) — code change if checkbox.
- [ ] Decide + implement the trainer/client notice question (Q3).
- [ ] Decide + implement minor-account gating (Q4).
- [ ] Re-check wording when **Phase 3 writes** ship: the consent screen will then also request
      permission to CREATE/EDIT data, and the scope re-consent flow will re-prompt users.
