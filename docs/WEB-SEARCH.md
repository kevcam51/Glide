# Web search for the Glidna AI — scoping

_Written S183u (Aug 8, 2026) as scoping; **BUILT in S184 (Aug 8, 2026)** — see
"What actually shipped" at the bottom for the numbers as implemented, which are
the ones to trust where they differ from the estimates above._

## The short answer: no, we don't need a third-party API

I said earlier that adding search meant picking a vendor (Brave / Tavily /
Serper) and wiring a key. **That was wrong.** Anthropic ships web search as a
**server-side tool** on the Claude API — the same API we already call from
`functions/aichat.js`. We declare it in the `tools` array and Anthropic runs the
searches on their infrastructure, mid-turn, before the reply comes back.

There is no vendor to sign up with, no second API key, no Cloud Function to
write, no result-parsing pipeline, and no extra round trip. It is closer to a
config change than a feature build.

| | Third-party API (what I first described) | Anthropic server tool (actual option) |
|---|---|---|
| Sticker price | ~$3–5 per 1,000 queries | **$10 per 1,000 searches** (1¢ each) |
| New vendor + key | Yes | No |
| Code to write | Search fn, result parsing, feed back through a second model turn | One tool entry + prompt guidance |
| Extra tokens | Full result text re-enters context on a second turn | Dynamic filtering trims results **before** they hit context |
| Citations | Build it | Built in — and `cited_text`/`title`/`url` are **not billed** |
| Where it runs | Our function, our latency, our failure modes | Anthropic's, inside the existing call |

Per-search sticker is higher; total cost and total effort are almost certainly
lower, because the third-party route pays for the same content twice in tokens
and costs us a build.

## What we'd actually declare

Glidna runs `claude-sonnet-4-6`, which supports the newer variants — this
matters, because dynamic filtering is Claude 4.6+ only.

```js
{ type: "web_search_20260318", name: "web_search", max_uses: 3,
  allowed_domains: [...],           // see "The liability question" below
  user_location: { type: "approximate", country: "US",
                   timezone: "America/New_York" } }
```

Three version choices, newest is best for us:
- `web_search_20250305` — basic. Every result lands in context. Avoid.
- `web_search_20260209` — adds **dynamic filtering**: Claude writes code that
  filters results before they enter context. Big token saving on search-heavy
  turns. Provisions its own code execution — we do **not** add `code_execution`
  to `tools` ourselves (a second execution environment confuses the model), and
  there's no extra charge for it.
- `web_search_20260318` — adds `response_inclusion: "excluded"`, which drops the
  raw search blocks from the response. Cuts output tokens for exactly our shape
  of workflow (we never echo raw search content to the user).

## What it would cost us

$10 per 1,000 searches, on top of normal token cost. Each search counts once
regardless of results; **errored searches aren't billed**.

Against our measured ~1¢/exchange (S67), a searching exchange roughly doubles to
quadruples in cost. The exposure is entirely a function of how often it searches
and how many searches per turn — which is why `max_uses` is not optional.

Rough model, assuming ~15% of exchanges trigger a search at ~2 searches each:

| Tier | Allowance | Searches/day | Search cost/mo | vs. plan price |
|---|---|---|---|---|
| Premium $14.99 | ~15 msg/day | ~4.5 | **~$1.35** | ~9% of revenue |
| Max $29.99 | ~100 msg/day | ~30 | **~$9.00** | ~30% of revenue — **not acceptable as-is** |
| Coach $49 | roster-driven | varies | varies | needs its own cap |

**Conclusion: Max cannot have uncapped search.** The fix is a per-user daily
*search* budget tracked exactly like the existing token budget in
`users/{uid}/aiUsage/{date}` — a second counter, same shape, same 80%-warn /
100%-block behaviour. `usage.server_tool_use.web_search_requests` on each
response is the number to accumulate.

## The liability question — the real reason to think before shipping

This is a fitness and nutrition product. Unrestricted web search means the
assistant can pull nutrition advice from anywhere on the internet and hand it to
someone with a medical condition, an eating disorder, or a coach whose plan it
just contradicted. That is a different risk class from summarising a link the
user pasted themselves (`fetch_link`, S82).

Three mitigations, all cheap:

1. **`allowed_domains` allowlist.** Restrict to sources a trainer would accept —
   PubMed, Examine.com, NIH/ODS, Mayo Clinic, USDA, ACSM/NSCA, AND. This is the
   single highest-value control and costs nothing. Do NOT ship an open search.
   (`allowed_domains` and `blocked_domains` are mutually exclusive — sending both
   is a 400.)
2. **Trainer guidance outranks the internet.** S183t already made the AI treat
   `fromTrainer` notes as the plan of record. The search prompt must say the same
   thing explicitly: a web source never overrides the client's coach; if they
   conflict, surface the conflict rather than silently siding with the web.
3. **Citations are mandatory, not optional.** Anthropic's terms require citing
   sources when API output is displayed to end users, and the citation fields are
   free tokens. Show them. It's also the honest thing — "your coach said X, and
   [source] suggests Y" is a good coaching moment; an unattributed assertion is a
   liability.

Worth a line in `docs/LEGAL-SESSIONS.md` before launch.

## Integration notes (for whoever builds it)

- **Where:** `functions/aichat.js`, in the `tools` array alongside the existing
  `buildTools(role)` output. It is a *server* tool — it never goes through
  `runTool()` in aitools.js, so the MCP connector does NOT inherit it. If the
  connector should search too, that's a separate decision (the user's own Claude
  already has its own search, so probably leave it).
- **`pause_turn`:** long search turns can stop with `stop_reason: "pause_turn"`.
  Both `aiChat` and `aiChatStream` need to send the paused assistant message back
  unchanged to continue. We don't handle this today.
- **Errors return HTTP 200**, with `content` as a single error object instead of a
  list (`too_many_requests`, `max_uses_exceeded`, `unavailable`, …). Branch on the
  shape before indexing, or a rate-limited search reads as a crash.
- **Multi-turn:** search results carry `encrypted_content` that must be passed
  back **unmodified** on later turns or the request 400s. Our chat history
  currently stores text only (`caliq-ai-chat-{id}`) — check this before enabling,
  or follow-up questions about a search will break.
- **Org switch:** web search can be disabled org-wide in the Claude Console. If
  it's off, the request fails with a 400 rather than a soft error.
- **Gating:** search should be a paid-tier capability. Free is already stopped at
  trial-expired; Premium up is where it belongs, with the tighter daily cap on
  Premium and the higher one on Max.

## Kevin's approval (Aug 8, 2026) — added requirement

Approved for build **with the allowlist**, with safety framed as the headline
requirement: _"we are pretty much selling a nutrition product and we don't wanna
give users the wrong information."_

**New requirement not in the original scoping:** users must be told that running
internet searches **draws down their AI allowance faster**. Surface it where they
can act on it — a line in the chat when a search runs, and in the Plans & pricing
feature grid alongside the published AI allowance. This depends on the daily
search counter below: we cannot honestly tell someone search costs more allowance
unless something is counting it, which is a second reason that counter ships in
the same change rather than after.

## Recommendation

Ship it, but not open. In order:

1. `web_search_20260318`, `max_uses: 3`, allowlisted domains, Premium and above.
2. A daily per-user search counter beside the token counter, with the same
   warn/block behaviour. **Do this in the same change, not after** — the Max
   maths above is the reason.
3. Prompt: search only when the answer depends on something current or
   product-specific; never override the client's trainer; always cite.
4. Watch `web_search_requests` in the logs for two weeks before loosening
   `max_uses` or widening the allowlist.

Estimated build: small — the tool declaration and prompt are an afternoon; the
budget counter and `pause_turn` handling are the real work.

---

## What actually shipped (S184, Aug 8 2026)

Built as recommended, with the allowlist, the daily search counter and the
allowance disclosure all in the same change. Where a number below differs from
the estimates above, **this section is the one to trust.**

### The tool

`functions/aichat.js` → `webSearchTool()`. `web_search_20260318`, `max_uses: 3`,
`allowed_domains` (27 domains covering ~22 vetted organisations — PubMed/PMC, Cochrane, ClinicalTrials,
Examine, JISSN, ASN, BJSM; NIH/ODS, CDC, FDA, USDA/FoodData, WHO, NHS, NICE,
EFSA; Mayo Clinic, Harvard Health + Nutrition Source, AHA, ADA, the Academy of
Nutrition and Dietetics, ACSM, NSCA; Stronger By Science), `user_location`
US/Eastern. Dynamic filtering is on by default at this version, so we do **not**
declare `code_execution` ourselves.

⚠️ **`response_inclusion: "excluded"` was tried and REMOVED — don't put it back
without re-checking citations.** It reads like free money (we never echo raw
search content, so why pay output tokens for the blocks?), but dropping the
result blocks leaves nothing to cite *from*. Two live searches came back with
good, current answers and an **empty source list both times**: citations
reference result blocks that no longer existed, and dynamic filtering consumes
results inside code execution without reliably attaching citation blocks either.
Prose attribution ("a 2024 review says…") is not a source a reader can check,
and citation was a headline requirement. `collectSources()` now reads citation
blocks when present and falls back to the `web_search_result` entries
themselves.

The prompt block sits with the other action rules and carries all three safety
requirements: search only when the answer genuinely depends on something current
(never for macros, portions, training principles, or anything in the user's own
logs), **a `fromTrainer` note outranks anything found on the web** — surface the
disagreement, never quietly switch them — and **always name the source**.

### Where the money is capped

Two independent limits, because either alone leaks:

| | Premium / trial | Elite | Ultra | Coach trial | Coach | Coach Elite | Coach Ultra |
|---|---|---|---|---|---|---|---|
| Searches/day | 12 | 25 | 40 | 15 | 30 | 50 | 70 |

**`max_uses: 3` alone does NOT give you a per-message ceiling**, and assuming it
did was the one real bug the pre-deploy review caught. `max_uses` is scoped to a
single API *request*, and one user message drives up to `MAX_TOOL_ROUNDS + 1`
= 11 requests (the model calls our tools, we answer, it goes again) — each with a
fresh budget of 3. Unchecked that is 33 searches (33¢) for one message, and the
daily allowance couldn't stop it either, because it is read once before the turn
starts. Premium's worst case was ~$10/mo of search, not $3.60 — negative margin.

`capTurnSearches()` closes it: after every round it withdraws the tool once the
turn has used its 3, or once the daily allowance is spent. Two rules make that
safe, and both matter:

- **Never withdraw while a server tool is waiting.** A `server_tool_use` block
  with no matching result block in the same response means Anthropic runs it at
  the start of the *next* request, and a request that no longer declares that
  tool fails with a 400. `hasPendingServerTool()` is that check.
- **If withdrawing is rejected anyway, put it back.** `retrySearchFix()` recovers
  in either direction, once per request. So the cap can tighten spend but can
  never break a turn — which is the whole reason it was safe to add to a path
  that couldn't be tested against the live API first.

Admin (Kevin) is effectively uncapped, matching the token budget.

With the per-message cap in place, Premium's worst case is back to ~$3.60/mo of
search on top of the ~$7.13/mo token ceiling, against $14.26 kept — positive even
if someone maxes both every day of a month, which nobody does (measured behaviour
is ~15% of exchanges searching).

The counter lives beside the token counter: `searches` on
`users/{uid}/aiUsage/{date}`, incremented from
`usage.server_tool_use.web_search_requests` by `aiusage.recordUsage`, which also
adds $0.01/search to `costMicros` so the admin dashboard's spend stays true.
Running out is a **soft** limit — the tool simply isn't declared for the rest of
the day and the assistant answers from its own knowledge, with an uncached
system block telling it to say so rather than pretend it searched.

### Telling the user (Kevin's added requirement)

- **In chat, every time:** a footer under any reply that searched — "Searched the
  web N times · uses more of your daily AI allowance than a normal reply" — with
  the actual sources beneath it as links. Citations are collected from the
  `web_search_result_location` blocks on the reply, deduped, capped at 6, and
  persisted with the thread so a revisited chat still shows them.
- **Before they buy:** a "Web search — answers backed by vetted health sources"
  row and a "Web searches per day" row in `PLAN_FEATURES`, both grids, each with
  a `PLAN_TIPS` explainer that states the allowance cost in plain English.

### Three things worth knowing before touching this again

- **A rejected search tool must never break chat.** Web search can be switched
  off for the whole organization in the Claude Console, and a request that
  declares it then fails with a **400** — not a soft in-result error. Same for an
  unusable tool version or a malformed domain. That would take the assistant down
  for every user on every message, so `callModel`/`streamModel` drop the tool and
  retry once on a 400 that mentions it. Keep that guard.
- **`pause_turn` is handled** in `aiChat`, `aiChatStream` and `runAssistantTurn`:
  push the paused assistant message back unchanged, with **no** user turn after
  it, and continue. It shares the `MAX_TOOL_ROUNDS` budget.
- **`encrypted_content` was a non-issue.** Within a turn we already push
  `resp.content` back verbatim, and across turns `capHistory` keeps only text and
  image blocks — so a search result is never sent back in a modified form. Don't
  "helpfully" start persisting raw search blocks in `caliq-ai-chat-{id}`; that is
  precisely what would start 400ing.

### Two callers deliberately opt out

`setupChat(uid, target, noSearch)` withholds the tool *and* tells the model it
is withheld, so it can't claim a search it never ran:

- **AI Coaching Insights** renders `reply` and nothing else — no place to put the
  disclosure or the citations — so a search there would spend the allowance
  invisibly. It analyses the person's own logged data anyway.
- **Scheduled automations**, for the reason below.

### Deliberately not done

- **Scheduled automations don't search.** Nobody is watching a headless run, so
  the disclosure has nowhere to appear — an allowance quietly drained every
  morning by a summary the user never asked to be researched is the exact
  dishonesty the disclosure exists to prevent.
- **The MCP connector doesn't inherit it.** A server tool never passes through
  `runTool()`, so this one genuinely cannot be mirrored — and someone running
  Glidna from their own Claude already has that Claude's search. This is the one
  place the [[ai-connector-parity]] rule doesn't hold, by nature rather than
  neglect.
- **No `blocked_domains` fallback** — it is mutually exclusive with
  `allowed_domains` and sending both is a 400.

### Next
Watch `searches` in the usage rollups for two weeks before loosening `max_uses`
or widening the allowlist, exactly as recommended above.

The scoping section above says a line about this is owed in
`docs/LEGAL-SESSIONS.md` — **that is the wrong file.** LEGAL-SESSIONS.md is about
session packages, prepaid packs and the Florida Health Studio Act; it has nothing
to do with AI-generated content. What is actually owed is a clause in the Terms
of Service (`/terms.html`) covering third-party health information surfaced with
citation: that Glidna quotes vetted sources but does not endorse or verify them,
that nothing it surfaces is medical advice, and that a user's own coach and
clinician outrank it.
