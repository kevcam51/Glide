# Legal research — Florida fitness liability waiver, minors, assumption of risk

> **Research findings, NOT legal advice.** Prepared with AI assistance from primary sources for the owner
> and a licensed Florida attorney to review before any real client signatures. Companion to
> `docs/SMOOTH-TRAINING-WAIVER-DRAFT.md` (the revised waiver) and `docs/SESSIONS-ATTORNEY-QUESTIONS.md`
> (the separate session-billing / health-studio analysis). Multi-agent research + two adversarial
> verification passes against primary sources (Florida Statutes via flsenate.gov, Florida case law).

## Executive summary

**Adults.** A clearly-worded pre-injury release is enforceable in Florida to bar **ordinary negligence**.
Since *Sanislo v. Give Kids the World, Inc.*, **157 So. 3d 256 (Fla. 2015)**, the word "negligence" is not
strictly required — but the release must be "clear and unequivocal" and "so clear that an ordinary and
knowledgeable person will know what he or she is contracting away," and such clauses are **disfavored and
strictly construed against the drafter**. Tie the release to the Company's *own* conduct and the specific
activity (the draft does); generic "any and all claims" boilerplate not tied to the releasee's conduct has
been struck down (*University Plaza*; *Van Tuyn*).

**Three hard limits — no waiver can do these:** (1) release **gross negligence**; (2) release
**intentional/reckless** conduct; (3) waive **non-waivable statutory rights**. The draft now states this
as an affirmative carve-out rather than relying only on severability.

**Minors — the material difference.** A parent's pre-injury release does **NOT** let a commercial fitness
business escape liability for its **own negligence** toward a child: *Kirton v. Fields*, **997 So. 2d 349
(Fla. 2008)** ("a pre-injury release executed by a parent on behalf of a minor child is unenforceable
against the minor or the minor's estate in a tort action arising from injuries resulting from participation
in a commercial activity"). The only protection is the narrow **Fla. Stat. § 744.301(3)** (2010): a
guardian may waive the activity's **inherent risks** (dangers that persist even with due care) **only if**
the waiver reproduces a specific warning **verbatim**, in **uppercase type at least 5 points larger than
and clearly distinguishable from** the rest of the text, with the released party named in each of three
blanks. Even a perfectly compliant § 744.301(3) waiver only creates **rebuttable presumptions** — a
plaintiff can still recover by proving by clear and convincing evidence that the harm was **not** an
inherent risk (i.e., the trainer's negligence). **Minors are a residual-exposure decision, not a paperwork
problem.**

## Verified holdings (confirmed against primary sources)

| Item | Cite | Status |
|---|---|---|
| Adult release need not say "negligence"; must be clear & unequivocal | *Sanislo v. Give Kids the World, Inc.*, 157 So. 3d 256 (Fla. 2015) | CONFIRMED (note: the "189 So.3d 145" cite in older notes is **wrong**) |
| Enforceability test ("ordinary and knowledgeable person will know what he is contracting away") | *Fuentes v. Owen*, 310 So. 2d 458 (Fla. 3d DCA 1975); *University Plaza v. Stewart* (Fla. 1973) | CONFIRMED |
| Parent cannot pre-release a minor's claim for a commercial activity | *Kirton v. Fields*, 997 So. 2d 349 (Fla. 2008) | CONFIRMED, correctly scoped |
| Guardian inherent-risk waiver + mandatory verbatim uppercase notice (≥5pt larger) | Fla. Stat. § 744.301(3) | CONFIRMED verbatim vs. official statute |
| Gross negligence cannot be pre-released | (universally stated; public-policy line + § 725.06 analogy) | **Not locked to a single controlling FL Supreme Court verbatim holding — attorney must pin. Do NOT cite *Theis v. J&J Racing*, 571 So.2d 92 — reversed at 581 So.2d 168.** |

## PAR-Q / health screening
No Florida law requires a personal trainer to use a PAR-Q (personal trainers are carved out of the Health
Studio Act and, since July 1 2016, need no FDACS registration). But it is the **industry standard of care**
(ACSM/NSCA), and a completed, signed PAR-Q **strengthens** a defense two ways: it shows responsible
screening, and if the client hid/misrepresented a condition it feeds the comparative-negligence/causation
defense (Florida is modified comparative fault since March 2023 — a client >50% at fault recovers nothing).
It is corroborating evidence, **not a shield** like a release. Recommend including it in the program-request
intake.

## Age misrepresentation (the "what if a minor lies about their DOB" question)
You can't perfectly prevent it online. The defensible posture: (1) collect a real **date of birth** (not a
self-checked "18+" box) and compute age server-side; (2) make age a **representation** in the waiver so a
minor who lies has made their own misrepresentation you relied on in good faith; (3) **store the record**
(DOB, attestation, timestamp, IP, waiver version); (4) use the **human checkpoint** — program requests are
reviewed by the trainer before any program is built, so age/guardian status can be confirmed there or the
client declined. Hard ID verification (e.g., Stripe Identity) exists but is overkill given the manual
review step. (Attorney should confirm how far good-faith reliance goes and how to verify guardian identity.)

## E-signature / no witness
A liability release does **not** require a witness or notary in Florida (confirm). For the app, the
**e-signature audit trail** (identity, timestamp, IP, exact document version) is the modern, stronger
equivalent — so the signature block is participant-only (+ guardian if under 18). Open: whether a clickwrap
checkbox suffices for a personal-injury release under Florida's UETA (§ 668.50) or whether a typed/drawn
e-signature is preferable. _(The dedicated e-signature research agent dropped on a transient error twice;
this rests on general UETA/E-SIGN principles — attorney to confirm.)_

## Minors playbook (recommended app flow)
1. **DOB at intake** (real field, compute age server-side).
2. **≥18:** adult signs the release → "request a training program" unlocks.
3. **<18:** the program-request step is **blocked**; the minor cannot unlock it. Route to a guardian flow —
   guardian attests parent/legal-guardian status, reads & signs the § 744.301(3) minor section (rendered
   uppercase, ≥5pt larger, boxed, "SMOOTH TRAINING, LLC" in all blanks), gives name + relationship +
   signature.
4. **Versioned consent record** per participant (waiver version + rendered notice, when, which guardian,
   IP/UA) — mirror the S106 session-consent wiring.
5. Only after a valid guardian record does program delivery unlock.
6. **Framing:** never tell guardians the form removes liability — under *Kirton* it doesn't cover the
   Company's own negligence. Consider declining minor clients at launch until guardian-verification +
   insurance posture is set.

## Questions for the attorney (waiver-specific)
1. Confirm the § 744.301(3) verbatim text, the uppercase/≥5pt-larger/distinguishable formatting, and that
   our rendered app version complies; confirm "SMOOTH TRAINING, LLC" in all three blanks (and whether
   trainers/sub-trainers/the platform should also be named).
2. Confirm the *Sanislo* cite (157 So. 3d 256 (Fla. 2015)) and pin controlling authority (with verbatim
   language) that **gross negligence cannot be pre-released** for an adult fitness activity.
3. Does session-billing / any prepaid model make Smooth Training a "health studio" (Ch. 501, Part XI)? If
   so, the non-waivable **3-day cancellation/refund** (§ 501.017) interacts with waiver §6 (cap) and §7
   (no-refund). (Cross-ref `docs/SESSIONS-ATTORNEY-QUESTIONS.md`.)
4. Is a clickwrap checkbox enough for a personal-injury release under Florida's UETA, or is a typed/drawn
   e-signature needed? What record retention proves a knowing waiver? Is a witness/notary needed (we
   believe not)?
5. For minors: given *Kirton*, does a § 744.301(3)-compliant guardian waiver give meaningful protection for
   commercial personal training, or advise declining minor clients / requiring insurance + guardian ID
   verification at launch? How should guardian identity/authority be verified in an app flow?
6. Should the media/likeness release be a separate opt-in (we separated it), and does bundling weaken the
   knowing, separate assent to the safety release?
7. Scope of released parties: should the release name the software platform (Glide/Glidna) and AI-generated
   program guidance, and how does the head-/sub-trainer independent-contractor chain affect who is named /
   who bears liability?
8. Should the waiver be a standalone executed, per-participant document (per-section initials) rather than a
   clause in the ToS? (Florida practitioners treat a distinct signed release as materially stronger.)

## Caveats
- One genuine open gap: no single controlling **Florida Supreme Court verbatim** holding that gross
  negligence cannot be pre-released was locked — universally stated in secondary sources + follows from the
  public-policy cases; drafted as if true (the carve-out only helps), but counsel must pin it.
- The **§ 744.301(3) "≥5pt larger + distinguishable"** requirement is load-bearing: if the rendered notice
  isn't visibly larger/distinct, the minor waiver can fail even with perfect wording. Render via a
  dedicated, version-locked component and re-test after any styling change.
- Scope: this covers the injury/liability **waiver** only. Session-billing / health-studio / auto-charge /
  late-fee and multi-state (whose law governs a remote client) questions are separate — see
  `docs/SESSIONS-ATTORNEY-QUESTIONS.md`.
