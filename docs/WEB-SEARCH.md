# Web search for the Glidna AI — scoping

_Written S183u (Aug 8, 2026). Nothing built yet. Kevin deferred the decision; this
is the paperwork so it can be made deliberately._

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
