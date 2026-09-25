# Smooth Training HQ — the crew's office

This private repository is where Kevin's AI crew works from. Each worker is a
Claude routine (claude.ai/code → Routines) that runs in Anthropic's cloud on a
schedule, with Kevin's Mac closed. Every routine starts here, so every worker
reads the same handbook and is stopped by the same guard.

| File | What it is |
| --- | --- |
| `CLAUDE.md` | The crew handbook: every shift's steps and the rules. Every routine reads it first. |
| `facts.md` | What the business offers, in Kevin's words. Workers quote only this. |
| `crew/<job>.md` | One job description per worker. |
| `.claude/hooks/crew-guard.sh` | The guard: refuses any tool that could send, pay, publish, delete or change something. |
| `.claude/settings.json` | Tells Claude to run the guard before every tool. |

Why a repository of its own: a routine loads its repository's `CLAUDE.md` on
every run. Glidna's is about 110,000 tokens of engineering notes, which every
worker would read (and spend Kevin's plan on) every shift. This one is a page.

## The crew today

| Worker | Department | Connectors | Shift (Miami time) |
| --- | --- | --- | --- |
| Bookkeeper | Finance | Intuit QuickBooks, Glidna | Mondays 8:00 a.m. |
| Front Desk Coordinator | Front Office | Gmail, Glidna | Weekdays 8:00 a.m. and 1:00 p.m. |
| Progress Analyst | Coaching | Glidna | Mondays 7:00 a.m. |

## Setting up a worker's routine

1. claude.ai/code → Routines → **New routine** → **Cloud**.
2. **Repository:** this one (`smooth-training-crew`).
3. **Prompt:** the one-line prompt at the top of the worker's job description.
4. **Schedule:** as in the table above.
5. **Connectors:** remove every connector except the ones in the table. A
   routine gets EVERY tool of every connector left in — the guard is the
   second lock, not the only one.

## Changing a job

Edit its file here. The next shift reads the new version; the routine itself
doesn't change.

## Adding a worker

Add `crew/<id>.md` (the id must be a seat on the HQ's org chart), list its
connectors, and if the job needs a tool the guard refuses, decide first
whether it is safe — the guard is an allow-list, so a new tool stays refused
until it is named there.
