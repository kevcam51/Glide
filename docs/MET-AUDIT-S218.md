# Calorie-burn audit — S218

Kevin, after testing a 12% incline walk: *"it looked like the calories were
extremely low for someone doing a 12% incline walk for 30 minutes. I wanna make
sure that all of our calorie calculations are close to as accurate as possible."*

He was right, and the incline table was the **smaller** of two causes.

## The headline number

A 12% incline walk, 30 minutes, 200 lb:

| | cal |
|---|---|
| before | **285** |
| baseline fixed only | 357 |
| MET fixed only | 315 |
| **both (shipped)** | **395** |

## Cause 1 — the baseline (the big one, affected EVERY exercise)

`restingKcalPerMin` multiplied a MET by the person's **BMR per minute**. The
intent (S183k) was to personalise: *"the textbook shortcut treats 1 MET as
1 kcal/kg/hr, which is really an average young adult male."*

The premise is true — 3.5 mL/kg/min does overstate resting VO₂ for many adults.
The conclusion does not follow. **Compendium MET values are themselves defined as
multiples of that same 3.5 standard**, so multiplying one by an individual BMR
mixes two conventions and double-counts the personalisation: `MET × kg` already
scales with body size, and scaling again by BMR/kg — which *falls* as weight
rises — bends the answer down hardest for the heaviest people.

Measured understatement vs the standard:

| profile | |
|---|---|
| 180 lb male, 30 | −10% |
| 200 lb male, 40 | −16% |
| 250 lb male, 45 | −24% |
| 200 lb female, 50 | −29% |

It also meant **completing your profile made your burn drop ~15%**, because the
incomplete-profile path used the standard rate.

Now: `MET × 3.5 × kg / 200` — the ACSM/Compendium definition, which is what the
MET numbers in the catalogue are calibrated against and what treadmills, watches
and other apps report. Same for everyone at a given weight.

**Downstream:** weekly training burn +19–41%; eat-back daily targets +71 to
+126 cal/day; accelerate goal dates slightly sooner. Kevin approved this
explicitly, knowing every existing client's numbers move.

## Cause 2 — ten MET values corrected

Incline walking is derived from the **ACSM graded-walking equation**
(`VO₂ = 0.1·S + 1.8·S·G + 3.5`) at 3.0 mph — the conservative end of a treadmill
walk — not from a recalled table, so the numbers are reproducible and the test
recomputes them.

| id | was | now | basis |
|---|---|---|---|
| incline_walk_5 | 4.5 | 5.4 | ACSM @3.0 mph (Compendium uphill 1–5% grade = 5.3) |
| incline_walk_8 | 6.0 | 6.6 | ACSM @3.0 mph |
| incline_walk_10 | 7.0 | 7.4 | ACSM @3.0 mph |
| incline_walk_12 | 7.5 | **8.3** | ACSM @3.0 mph — the one Kevin reported |
| incline_walk_15 | 8.5 | 9.5 | ACSM @3.0 mph |
| water_aerobics | 4.0 | 5.3 | Compendium water aerobics |
| kickboxing | 8.0 | 10.3 | Compendium moderate-pace striking arts — and it sat *below* `martial_arts` 10.0, the same entry |
| tennis | 7.3 | 8.0 | label says Singles; 7.3 is "tennis, general" |
| wrestling | 8.0 | **6.0** | Compendium wrestling — app was HIGH |
| trampoline | 4.5 | **3.5** | Compendium trampoline — app was HIGH |

Two came **down**. Accuracy is not "make the numbers bigger".

## The judgment calls — Kevin ruled: "set these to whatever is most accurate"

Handed back rather than left open. These have no clean lookup, so each is stated
with its anchor.

| id | was | now | basis |
|---|---|---|---|
| `boxing_bag` | 9.8 | **8.0** | see below |
| `martial_arts` | 10.0 | 10.3 | the *same* Compendium entry `kickboxing` reads (moderate-pace striking arts), so a gap between them was arbitrary |
| `swim_easy` | 5.0 | 5.8 | Compendium freestyle, slow / light-moderate |
| `jump_rope` | 11.0 | 11.8 | Compendium rope jumping, moderate |
| `dancing` | 6.5 | 7.3 | Compendium aerobic dance, general |
| `flag_football` | 7.0 | 8.0 | Compendium football, touch/flag, general |

### Heavy bag — a judgment, anchored, not a lookup

The Compendium carries three boxing entries: **punching bag 5.5**, **sparring
7.8**, **in ring 12.8**.

Neither end is right for what this catalogue means by "Heavy Bag Boxing":

- **5.5 is too low.** It describes casual, intermittent bag work, not a coached
  round. Taking it literally would have cut the burn nearly in half.
- **9.8 was too high.** That is essentially *continuous hard effort for the whole
  scheduled duration*. A 30-minute bag session is rounds with rest.

**8.0** sits just above sparring (7.8) and well below ring work (12.8), and it
has to clear `shadow_boxing` (7.5), which is genuinely lighter — you are not
absorbing impact. The suite pins both the value and that ordering.

This is the one number in the catalogue that is reasoned rather than cited. If a
coached bag session in practice runs closer to continuous work, 9–10 is
defensible and the assertion is one line to change.

## The systematic pass — all 53 cardio entries

Kevin: *"the cardio exercises out of the most important are the ones that are a
little bit more simple, like walking and running. Have you gone through all of the
exercises and looked at all the METs?"*

**Honest answer at the time: no.** Walking was derived properly from the ACSM
equation; everything else was spot-checked, and **running was never looked at** —
the direct counterpart to the walking work. It was 4–12% light.

Every cardio entry has now been checked against a reference. Corrected:

| id | was | now | basis |
|---|---|---|---|
| `treadmill_run` | 10.0 | 10.5 | Compendium 6 mph 9.8 / 7 mph 11.0 — the label spans both |
| `outdoor_run` | 11.0 | 11.8 | Compendium running 7.5 mph |
| `cycling_mod` | 6.8 | 7.0 | Compendium stationary 150W moderate |
| `cycling_vig` | 10.0 | 10.5 | Compendium stationary 200W vigorous |
| `rollerblading` | 7.0 | 7.5 | Compendium in-line skating, leisurely |

**Running uses the Compendium's measured speed values, not the ACSM equation.**
For *graded walking* the equation is strictly better, because the Compendium
lumps all of 6–15% grade into one number. For *level running* the Compendium has
speed-specific measured values, which beat a prediction. That is why a 5 mph jog
stays at **8.3** where the equation would have said 8.7.

Checked and deliberately left:

- `rowing_hard` 10.0 — the app's easy/moderate/hard ladder maps three tiers onto
  the Compendium's four (light 3.5, moderate 7.0, vigorous 8.5, very vigorous
  12.0). 10.0 sitting between the top two is right. *My own first reference table
  called this "+18% off" by comparing it to the wrong tier.*
- `jump_rope_fast` 13.0 — Compendium fast pace is 12.3, but the label says
  "Fast/Double" and double-unders are harder.
- Seven entries with **no published equivalent at all** — `hiit`, `assault_bike`,
  `versa_climber`, `jacob_ladder`, `ski_erg`, `shadow_boxing`, `elliptical_vig`.
  These are house values. They are labelled as such rather than dressed up.

### A false assumption the suite caught

I added an assertion that a jog must outrank the steepest incline walk. **It must
not.** Walking a 15% grade (9.5) is harder than jogging level at 5 mph (8.3) —
both equations say so. The true relation is pinned instead.

## The mirror had already drifted

`functions/exercises.js` said *"Generated, not hand-authored"* — with **no
generator in the repo**. Its entry order no longer matched `src/App.jsx`, so it
had silently drifted. There is now `scripts/gen-exercises.mjs`
(`npm run gen:exercises`) and `scripts/test-exercise-mirror.mjs`, which fails
when the checked-in file is stale. The two `restingKcalPerMin` copies are
compared **character for character**, making the "MUST match" comment enforceable
rather than aspirational.

## Known side effect

Custom exercises created **before** this change stored a MET derived from the old
baseline (`typed cal/min ÷ old rate`). Under the new baseline that MET yields
roughly 15–20% more than the cal/min originally typed. A correct migration is
impossible — the stored record has no memory of whose BMR framed it — so this is
accepted and recorded rather than silently patched. New ones are self-consistent.
