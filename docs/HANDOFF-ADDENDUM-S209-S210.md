# Handoff addendum — S209 + S210

⚠️ **A SEPARATE FILE ON PURPOSE.** `Glide-Session-Handoff-NEXT.md` was being
edited in another session while this work landed, so folding these in there
directly would have collided. **Merge this into the START HERE block and delete
this file.** Everything below is already pushed, deployed and live — none of it
is work to redo.

Tip at the time of writing: `75bf883`. Clean tree, level with origin,
**1,653 unit assertions across 29 suites + 245 rules tests**, all 78 functions on
current module code, live bundle marker-diffed.

---

## S209 — "On my way" is bounded, not just rate-limited

Kevin asked whether the button should be limited to control API calls. It should
have been already: the 60-second cooldown bounds the RATE, not the TOTAL, so
tapping every 61 seconds for an hour was ~60 traffic-aware Routes calls on ONE
session. Traffic-aware is the dearer **Pro** SKU — 5,000 free events a month,
then $10/1,000, against Essentials' 10,000 then $5.

Three bounds now:

| bound | constant | behaviour |
|---|---|---|
| rate | `ON_MY_WAY_MIN_GAP_MS` (60s) | replays the stored ETA |
| total | `ON_MY_WAY_MAX_ETAS` (10/journey) | replays the stored ETA |
| eligibility | Coach tier · 240-min window · a destination | hides the button |

⚠️ **BOTH BOUNDS REPLAY, NEITHER REFUSES.** The stored ETA is still the truest
thing available, and refusing would leave someone unable to tell their client
anything at all. The point is to stop spending, not to stop the message. The UI
says WHICH bound was hit, because "give it a minute" is useless advice when
waiting will never help again.

⚠️ **The counter is PER SENDER.** Both people can travel across one session's
life — a trainer to a park, then a client to the next place — so the second
journey must not inherit a count it did not spend.

⚠️ Caught by `check:undef`, not by me: a failed edit script left a call to
`onMyWayTapCount` with the function never written. It loaded fine (the call is
runtime-only) and would have thrown on the first real tap.

---

## S210 — 14 test assertions that would have stayed green through a real regression

**`npm run check:weak` is a new standing check.** It reports any assertion of the
form `/pattern/.test(SOURCE)` where the pattern matches 2+ times — the shape that
survives one occurrence breaking. **It currently reads zero. It is a report, not
a gate**, so it never blocks a build.

⚠️ **THE RULE: a guard that exists in TWO places must be COUNTED in two, not
merely found.** This exact mistake was made FOUR times in one session, every time
in code that had just been written and was believed tested.

A 14-agent mutation audit (each in its own git worktree) broke every occurrence
individually and re-ran the suite. **All fourteen were genuinely weak — not one
false positive.** What they were letting through:

- **Start Over** reverting to a one-tap unconfirmed wipe — the exact bug
  `test-reset-confirm.mjs` exists to prevent
- `sessionTravel` losing its `trainerUid == uid` scoping — the query that
  returns other clients' **addresses**, going unscoped
- `RELEVANT_GAP_MIN` set to `1e9`, making every session pair "relevant" and
  putting a permanent unchecked-connections notice on a healthy schedule
- **`meetAt` dropped from `firestore.rules bookingFields()`**, which refuses
  every booking that sets it
- the weight chart drawing straight into a planned goal — a filter applied in
  FIVE places where any one could silently drop it
- the plural branch of the dropped-slots notice emptied, so a client who offered
  three times and lost two read a headless fragment
- the activity card drifting onto an inline copy with no cooldown, or never
  asking at all

**The two fixes, and when each is wrong:** COUNT the occurrences where every site
must carry it; ANCHOR to the block that owns the guard where the other matches
are unrelated and volatile. A count over unrelated matches breaks on any new
error message elsewhere — so the choice is justified in place, per assertion.

⚠️ **Two of my own MUTATIONS were wrong before the tests were.** A
`replace(…, 1)` hit an unrelated "Try again" instead of the one under test, and
another used real curly quotes against source storing `“` escapes. Both
looked like a surviving mutation and were no-ops. **Verify the mutation actually
applied before believing what it tells you.**

---

## Verified live on Kevin's own account

    onMyWay push         {"sessionId":"5exS4OIIAF2xO3QoKB0p","delivery":{"skipped":"no-subs"}}
    onMyWay arrival push {"sessionId":"5exS4OIIAF2xO3QoKB0p","delivery":{"skipped":"no-subs"}}

Gate → GPS fix → ETA stored → feed row → arrival → idempotent second tap.

⚠️ `skipped: "no-subs"` **is not a fault** — that client has no push
subscription, so there was no lock-screen buzz. The bell/feed row is written by
`appendFeed` BEFORE any preference or subscription check, which is why they still
saw it. **A real lock-screen push is the one thing still never observed**, and it
needs a recipient who has enabled notifications once.

⚠️ **A second "I'm here" tap produces NO log line.** Arriving twice is one
arrival — the callable returns early on `prev.arrivedAt` without writing or
notifying. Do not "fix" this.

---

## Waiting on Kevin (not blocking any work)

1. **Save his own address** (≡ → Where I train clients). The "My place" chip is
   disabled until he does — ⚠️ it keys off the TRAINER's saved address, not the
   client's, and he guessed the other way round when he hit it.
2. **A client enabling notifications once**, if a real push is wanted.

## Still queued (nothing started)

1. A client-side way to say **the trainer did not show up**. ⚠️ Touches BILLING —
   read `functions/sessionSettle.js` and the S186 invariants first.
2. A **trainer session ledger**: every session kept for life, browsable by year /
   month / week / day, typeable or scrollable, including cancelled and
   rescheduled. ⚠️ The data already exists (sessions are never deleted), so this
   is a query + UI problem. Watch the composite-index trap documented in
   `functions/availability.js` and `calendarFeed.js`.
