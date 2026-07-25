# Glide MCP Connector — Design Doc

> **Status: DESIGN (not built).** Written Session 111 (Jul 2026) from Kevin's request: "users can use
> their Claude to manage all of their app functions just like the app Ask button does." This is
> Phase 3 — the flagship endgame — of `docs/AI-INTEROP-VISION.md` ("Glide works with your AI").
> Companion: the benefits brainstorm below is the KEEP-FOREVER section Kevin asked to save.

---

## 1. What an MCP connector is (plain language)

**MCP (Model Context Protocol)** is an open standard — a universal power outlet that lets an AI
assistant plug into an outside app. An **MCP server** is a small hosted service that publishes a
menu of "things the AI may do here" (**tools**) and "things it may read" (**resources**). Any AI
that speaks MCP — Claude.ai, Claude Desktop/mobile, increasingly ChatGPT — can connect to it *with
the user's permission* and use those tools as that user.

A **connector** = that server, hosted on the public internet, that a user authorizes from inside
their own Claude (Settings → Connectors). Once connected, **their** Claude reads and writes
**their** Glide data directly — in their Claude window, not ours.

**The key economic distinction:** the in-app Ask button burns OUR Anthropic key (we pay for the
thinking). A connector runs inside the USER'S Claude subscription — **they pay for the thinking; we
pay only pennies for the data operations.** Our heaviest AI users flip from a cost into nearly free.

## 2. Why Glide is unusually close to shipping this

The hard part of any connector is the tool layer — and ours already exists, battle-tested. The Ask
button runs on **34 server-side tools** in `functions/aitools.js`, every one already enforcing the
access model server-side (a client can only touch their own data; a trainer only their verified
clients via `resolveTargetUid`; localPlanId only ever resolves against the caller's own index):

**Both roles (29):** `get_profile`, `set_personal_info`, `get_nutrition_log`,
`get_nutrition_targets`, `set_targets`, `propose_meal`, `log_meal`, `log_meals`, `remove_meal`,
`log_workout`, `log_weigh_in`, `log_check_in`, `log_measurements`, `get_measurements`, `log_water`,
`list_plans`, `create_plan`, `switch_plan`, `rename_plan`, `list_exercises`, `add_custom_exercise`,
`propose_workout`, `set_workout_schedule`, `search_food`, `list_notes`, `create_note`,
`update_note`, `fetch_link`, `set_notification_prefs`.

**Trainer-only (5):** `find_client`, `list_clients`, `coach_summary`, `list_local_plans`,
`send_client_request`.

An MCP connector is essentially **a new front door onto this exact same `runTool()` dispatch** —
same security, same data model, same behaviors users already trust from the Ask button. The two
genuinely new pieces: (a) an endpoint that speaks the MCP protocol, (b) an OAuth "Connect your
Glide account" flow so the user's Claude acts *as them*.

## 3. THE BENEFITS — what a connector unlocks (Kevin: keep this list)

> Saved verbatim-in-spirit from the Session-111 brainstorm. This is the "why."

### The core picture
A user opens **their own Claude** and says "log my lunch," "what did I eat this week," "set my
protein to 200," "build me a push/pull/legs split" — and it all lands in Glide. A trainer: "how's
Casey doing," "log a weigh-in for #KEM2," "nudge my stalled clients." It's the Ask button, living
inside whatever AI they already use all day.

### 1. Cross-tool workflows (the real magic)
Because Glide becomes one tool among the user's OTHER connectors, their AI can chain them:
- "Look at my **Google Calendar** and schedule my workouts around my meetings, then put them in Glide."
- "Read this **PDF meal plan** my nutritionist emailed and log the whole week into Glide."
- "Summarize my Glide progress and **draft an email** update to my coach."
- "My **Whoop** says I'm under-recovered — lighten today's Glide workout."
No fitness app can do this alone; it emerges free from being in the user's connector ecosystem.

### 2. Trainers running their coaching from their own AI
A trainer already living in Claude for email/admin manages clients in the same window — pull who's
off track, build programs, send to-dos — without switching apps. The whole roster becomes
conversational.

### 3. Automation
Paired with Claude's scheduled tasks: "every Sunday, review my Glide week and suggest adjustments."
"Every morning, tell me my calorie target and today's workout." Recurring coaching, driven by the
user's own AI, grounded in real Glide data.

### 4. Effortless onboarding
A brand-new user sets up their entire plan by talking to their own Claude (the S72 onboarding tools
already exist), then opens Glide to a finished dashboard.

### 5. Read-only resources
Expose the plan, recent logs, and progress as context Claude can reference anytime — so even
non-fitness conversations can pull in "what's my calorie target today."

### 6. The reverse direction
Glide's own AI can also CONSUME other MCP servers (Whoop, Oura, calendars) to enrich coaching.
Same protocol, opposite direction — a later phase.

### The two strategic wins
- **Cost:** power users driving Glide from their own Claude subscription offload inference cost
  from us. We pay for Firestore reads/writes (fractions of a cent); they pay for the model.
- **Differentiation:** nobody in fitness is doing this. "Glide works with your AI" is a genuine,
  defensible headline — especially for the trainer-platform story. Natural Premium/Max perk (and it
  LOWERS our cost to serve, the opposite of every other premium AI feature).

## 4. Architecture (to be finalized against verified current specs)

> Verified against Anthropic's current connector requirements + the current MCP spec — see §7
> for the primary-source findings and the concrete design consequences.

**Shape:** a hosted **remote MCP server** (Streamable HTTP transport) running on our existing
Firebase Blaze / Cloud Functions v2 (Cloud Run) infrastructure, publishing a curated subset of the
34 tools, with per-request auth that resolves to a Glide uid and then calls the SAME
`runTool(name, input, ctx)` used by the Ask button.

**Auth (the genuinely new build):** OAuth flow — user clicks "Connect" in Claude → lands on a Glide
consent page (signs in with their existing Firebase account: email/Google/passkey) → approves scopes
→ Claude receives tokens that map to that uid. Every MCP request verifies the token, builds the same
`ctx` (callerUid, role, isTrainer) the chat backend builds, and dispatches. **No new data paths — a
connector caller can do exactly what that same user can do in the app, never more.**

**Scoping model (proposed):**
- `read` — profile, targets, logs, measurements, progress (safe default; Phase 1 could ship read-only)
- `write:logs` — meals, weigh-ins, workouts, water, measurements
- `write:plan` — targets, personal info, workout schedule, plans/phases
- `trainer` — the 5 trainer tools (only offered to trainer accounts)

**Tool curation for MCP (differences from the in-app set):**
- Drop `propose_meal` / `propose_workout` (they exist to render in-app Accept cards; in Claude the
  confirmation is conversational — the *user's* AI asks before calling the write tool). Keep the
  direct write tools.
- Tool descriptions get rewritten for an EXTERNAL model that doesn't have our system prompt (each
  description must carry its own usage guidance + confirmation expectations).
- Mark read-only vs destructive tools with the spec's tool annotations so Claude's UI can show
  appropriate confirmation affordances.

**Cost/abuse controls:** the connector bypasses our Anthropic spend entirely, but Firestore ops and
function invocations are ours — add a per-uid daily MCP request budget (cheap counter, same pattern
as `aiUsage`), and gate the connector behind Premium/Max entitlement (checked at token issue AND per
request).

## 5. Phased build plan (draft)

1. **Phase 0 — design lock:** finish this doc with verified specs; pick OAuth implementation.
2. **Phase 1 — read-only connector (fast, safe, instantly useful):** OAuth + Streamable HTTP server
   + the read tools only. "Connect Glide, ask your Claude about your data." Validates the whole
   chain with zero write risk.
3. **Phase 2 — writes:** logging tools (meals/weigh-ins/workouts), then plan-editing tools behind
   the `write:plan` scope.
4. **Phase 3 — trainer tools + polish:** trainer scope, connector directory submission, docs page
   ("Connect Glide to your AI"), marketing.
5. **Phase 4 — ChatGPT** (separate integration; OpenAI's connector surface differs) and
   **reverse-direction MCP** (Glide's AI consuming Whoop/Oura/calendar servers).

## 6. Open questions (for Kevin)

- Gate behind which tier — Premium, Max, or free-with-account? (Recommend: Premium+ at launch;
  it's a retention feature and lowers our costs.)
- Read-only Phase 1 public beta, or wait for writes before announcing?
- Trainer tools in v1 or v1.5?
- Naming on the consent screen: "Glidna" (app brand) — confirm.

## 7. Verified current-spec findings (Session-111 research + adversarial verification)

> 4 researchers + 4 adversarial verifiers against primary sources (claude.com/docs/connectors,
> modelcontextprotocol.io spec, cloud.google.com, SDK repos), July 2026. Verdicts noted.

### Claude custom connectors — [CONFIRMED/CORRECTED]
- A custom connector = a **remote MCP server** added by URL (Settings → Connectors → "Add custom
  connector"). Must be reachable from the public internet — connections come from **Anthropic's
  cloud** (egress 160.79.104.0/21), not the user's device.
- **Transport: Streamable HTTP** (single endpoint, POST+GET); legacy HTTP+SSE is deprecated. Build
  Streamable HTTP only.
- **[CORRECTED] Available on ALL Claude plans, including Free** (Free = limited to ONE custom
  connector). This kills the earlier assumption that Claude's own plan gating filters who can use
  it — the user-side floor is $0. (Team/Enterprise: only org Owners add them.)
- **[CORRECTED] Auth is NOT required by Claude** — authless (`none`) servers are supported. Glide
  still needs auth (per-user data), but this confirms auth burden is ours to choose, not imposed.
- **Limits:** ~150,000-char max tool result; 300-second timeout on Claude.ai/Desktop. OAuth
  endpoints must answer in ≤10s (30s for refresh). No machine-to-machine `client_credentials` —
  every connection is user-consented.
- **Directory exists:** submission portal requires a **Team or Enterprise org** (Owner access),
  tool `title` + `readOnlyHint`/`destructiveHint` annotations on every tool, OAuth 2.0 for
  authenticated services, privacy policy URL, docs URL, support contact, icon, reviewer test
  account, 7 policy acknowledgments. Escalations: mcp-review@anthropic.com.

### MCP spec (ratified 2025-11-25; 2026-07-28 revision ships days from now) — [CONFIRMED]
- Streamable HTTP details: every client message is a new POST; server replies `application/json`
  or an SSE stream; **sessions are OPTIONAL** (server MAY issue `MCP-Session-Id`) — a stateless
  server is fully spec-legal. Server MUST validate `Origin` (403 otherwise).
- **Authorization (if implemented):** server = OAuth 2.1 resource server. MUSTs: RFC 9728
  protected-resource metadata (advertised via 401 `WWW-Authenticate resource_metadata` and/or
  `/.well-known/oauth-protected-resource`); the AS must serve RFC 8414 / OIDC discovery metadata;
  PKCE **S256 mandatory** (Claude sends it on every auth request and refuses if
  `code_challenge_methods_supported` is absent); RFC 8707 resource-indicator audience binding
  (tokens must be issued FOR this server; no token passthrough).
- **Client registration:** Dynamic Client Registration (RFC 7591) is now MAY (back-compat);
  **CIMD (Client ID Metadata Documents) is the recommended path**, or Anthropic-held client
  credentials (`oauth_anthropic_creds`, via mcp-review@) for directory/high-traffic servers —
  Anthropic explicitly recommends against DCR for directory servers (it registers a new client
  per connection).
- Claude's hosted OAuth callback: `https://claude.ai/api/mcp/auth_callback`.
- Tools should carry the annotations (`title`, `readOnlyHint`, `destructiveHint`) — required for
  directory listing anyway.

### Hosting on our existing stack — [CONFIRMED]
- **Officially supported pattern:** Google publishes "Host MCP servers on Cloud Run" docs + a
  deploy tutorial. Cloud Functions v2 run on Cloud Run — same properties. Our `aiChatStream`
  already streams SSE from a v2 onRequest function on this exact stack, so streaming is proven
  in OUR project.
- **Stateless is the right shape here:** Cloud Run session affinity is explicitly best-effort →
  don't pin in-memory MCP sessions. The official TypeScript SDK (v1.29.0) documents stateless
  Streamable HTTP (`sessionIdGenerator: undefined`) with a **new server+transport instance per
  request** as its serverless pattern (and the v2 SDK beta is stateless by default). ⚠️ Known SDK
  regression (#1994): REUSING one stateless transport across requests 500s — per-request
  instances (the documented pattern) avoid it.
- Timeouts ample: v2 HTTP functions go to 60 min; Claude's own 300s ceiling is the binding limit.
- **The real build is the OAuth AS layer:** Firebase Auth is an identity provider, NOT an OAuth
  2.1 authorization server (no PRM/AS-metadata/CIMD). So we add a small authorization + token
  endpoint pair on our Functions: user lands on a Glide consent page → signs in with their
  existing Firebase account → we issue OUR access/refresh tokens bound to their uid + scopes
  (+ PKCE, + RFC 8707 audience). The MCP endpoint verifies our token per request (the SDK ships
  `requireBearerAuth` middleware that delegates to any verifier we supply) and builds the same
  `ctx` as the chat backend.

### Design consequences (folding back into §4)
1. Stateless Streamable HTTP server on a new Cloud Functions v2 onRequest (or a thin Cloud Run
   service if bundle size demands) — per-request McpServer instances over the existing `runTool`.
2. Our own mini-AS: `/authorize` (Glide-branded consent page reusing Firebase sign-in incl.
   passkeys) + `/token` (PKCE S256, refresh, audience-bound JWTs) + RFC 9728/8414 metadata docs.
   Support CIMD; DCR optional.
3. Tool annotations from day one (needed for directory later; helps Claude's confirm UX now).
4. Directory listing requires a Team/Enterprise Claude org — factor ~$150/yr-per-seat org cost
   into the launch plan (or start unlisted: users add by URL, which works on every plan).
5. Keep every tool result well under the 150K-char cap (coach_summary is the one to watch).
