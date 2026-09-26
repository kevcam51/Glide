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

| Worker | Department | Apps (every other app off) | Shift (Miami time) | Runs as |
| --- | --- | --- | --- | --- |
| Bookkeeper | Finance | Intuit QuickBooks, Glidna | Mondays 8:00 a.m. | routine `HQ · Bookkeeper` |
| Front Desk Coordinator | Front Office | Gmail, Glidna | Weekdays 8:00 a.m. and 1:00 p.m. | routine `HQ · Front Desk` |
| Progress Analyst | Coaching | Glidna | Tuesdays 7:00 a.m. | routine `HQ · Progress Analyst` |
| Systems Watchdog | Operations & Tech | Glidna, and the Claude app's usage meter | Every evening, 9:00 p.m. | scheduled task on Kevin's Mac |
| Finance Manager | Finance (head) | Intuit QuickBooks, Glidna | When Kevin needs it | a chat Kevin starts, from its HQ profile |
| Web Designer | Operations & Tech | Glidna | When Kevin needs it | a chat Kevin starts, from its HQ profile |

**Kevin's plan is Claude Pro**, which caps how many routines can start in a
day (claude.ai/code/routines shows the number) and shares its usage with his
own chats. So no day has more than three crew runs, and the Systems Watchdog
checks the plan's meter every evening and puts a note on his desk when it's
time to upgrade. A one-time test run doesn't count against the daily cap.

## Setting up a worker's routine

1. claude.ai/code → Routines → **New routine** → **Cloud**.
2. **Repository:** this one (`smooth-training-crew`), and no other. A cloud
   session with two repositories doesn't load either one's hooks, so the
   guard would not run.
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
