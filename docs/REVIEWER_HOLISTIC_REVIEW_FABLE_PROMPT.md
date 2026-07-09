---
title: Reviewer Finding & Disambiguation — Holistic Review Prompt (for Fable)
domain: reviewer-identity
kind: audit
status: draft
summary: "Pointer-based prompt for a Fable session to holistically reassess reviewer finding and disambiguation — reframe-first, full latitude, curated reading map."
canonical: false
cataloged: 2026-07-08
owner: product-engineering
related:
  - lib/services/reviewer-identity-resolver.js
  - lib/dataverse/adapters/researcher.js
  - docs/audits/memory-triage-2026-07-08.md
---

# Holistic review request — reviewer finding & disambiguation (for Fable)

You are being asked, as a stronger and more holistic model, to step *all the way back*
on the two hardest, highest-stakes capabilities in this codebase and tell us whether
we are solving the right problem the right way. You are running inside the repo with
full read access, `git`, grep, and the ability to run scripts. You are a top-level
session, so you **may dispatch parallel sub-agents** to cover the reading map faster —
but the synthesis, judgment, and the final opinion must be *yours*, held in one mind.
**Read the ground truth before you conclude.** Do not take the framing below as settled — it is deliberately
thin so it does not steer you. Your value is a fresh read that we, having lived through
every incremental decision, can no longer produce.

## Mission

1. **Reframe first.** Before any recommendation: are we even solving the right problem,
   framed the right way? Where are we over-engineering, and where are we under-investing?
2. **Then give direction** for both halves — finding good reviewers, and disambiguating
   them — grounded in what you actually read here.
3. **Then say what to STOP doing.**

You have **full latitude**. You may challenge anything: the data sources
(OpenAlex / ORCID / PubMed / SerpAPI), buy-vs-build, whether a given step should be
automated at all, the data model, even our definition of success. Nothing is fixed.

## How to behave (this matters more than usual)

- **Stay at problem/architecture altitude.** We have repeatedly gotten lost in the weeds
  — line-level fixes, one-namesake-at-a-time patches — across many sessions, only to
  conclude the whole direction was wrong. Do NOT propose code diffs. Think in problems,
  approaches, and tradeoffs.
- **Read before you conclude.** Use the reading map below. Pull threads. Run the eval
  harnesses if they help. Ungrounded opinion is worse than useless here.
- **Be blunt. No sycophancy.** If we are overcomplicating this, say so. If we are
  optimizing the wrong metric, say so. If a whole subsystem should not exist, say so. We
  would rather hear "you are solving the wrong problem" than a polite endorsement.
- **Distrust our own conclusions.** Where you read a decision or a "principle" we
  adopted, ask whether it was right, not just whether it was implemented.

## Why this is the load-bearing problem

This app suite supports a private foundation's (WMKF) grant-review workflow. For each
proposal, staff must find qualified, conflict-free external reviewers and correctly
identify who those people actually *are* (the same name can be several researchers; the
right person carries the right publications, affiliation, and conflicts). This is the
heaviest, highest-consequence load the suite bears: a missed good reviewer, or a
mis-identified one, degrades the review or creates an undetected conflict of interest.
Scale is small-batch and high-stakes (order tens of proposals per cycle, not thousands),
which may itself change what the right approach is — consider that.

## What we believe "getting it right" means — CHALLENGE THIS

Our governing principle is a *frame*, not a metric ranking: **the tool surfaces and
informs; the human decides.** It has two symmetric halves:

- **Never silently filter.** Surface candidates — and their conflicts — widely and let
  staff make the call. Missing a genuinely good, conflict-free reviewer is a silent,
  unrecoverable loss (no one knows what they didn't see). This is why COI is "surface,
  don't gate" except permanent conflicts, and why we prize recall over precision.
- **Never silently assert.** When binding an identity — ORCID, publications, affiliation,
  conflicts — to a candidate, calibrate confidence honestly and defer to a human rather
  than freeze a guess. A confidently-*wrong* binding is the dangerous failure (see the
  fail-dangerous hazard and the sticky-`confirmed` question below).

Interrogate this frame directly — it is the thing we most want your judgment on:

- Is "surface and inform, human decides" the right organizing principle at this scale, or
  is it a rationalization for never committing to automated decisions we could actually
  trust? Where should the tool decide, not just inform?
- We have NOT settled the **severity ordering among the failure modes.** Is a *missed
  conflict of interest* the single worst outcome (which would argue for gating some COI
  after all)? Worse than a missed good reviewer? Worse than a confidently-wrong identity
  binding? Tell us how you would rank the failures — that ranking should drive the design.
- Are "recall of candidates" and "integrity of the identity binding" even the right two
  axes, or is there a better decomposition?

## The two problems, precisely

- **Finding (origination / discovery):** given a proposal, produce a ranked set of
  candidate reviewers from external sources, screened for conflicts.
- **Disambiguation (identity resolution):** given a candidate name (+ weak signals),
  decide which real-world researcher it is, with what confidence, and bind the right
  ORCID / publications / affiliation / conflicts to them — without freezing a wrong guess.

## How we got here — read these and form YOUR OWN view of the pattern

We have made several reversals. They are documented; do not just accept our stated
reasons — judge whether the *pattern* of how we reason is itself the problem. Start with:

- `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` (§"Increment 2a") — we designed
  automated institution→account matching that writes `contact.parentcustomerid`, then
  **reversed** it as high-harm/low-yield; shipped an alert-only design instead.
- `.claude-memory/project-reviewer-institution-match.md` (now marked **stale**) — the
  memory for the reversed plan.
- `.claude-memory/project-reviewer-coi-rely-on-self-disclosure.md` — COI moved from a
  hard gate to "surface, don't gate" (except permanent conflicts).
- `.claude-memory/project-reviewer-recall-over-precision.md` — the recall-over-precision
  principle we adopted.
- `.claude-memory/project-reviewer-verify-fail-dangerous.md` — the "fabricated
  wrong-forename lands on a same-surname namesake" hazard and our forename-gating saves.
- `.claude-memory/project-reviewer-self-report-orcid-sticky-confirmed.md` +
  `docs/audits/memory-triage-2026-07-08.md` (finding #1) — an OPEN, unresolved design
  question: the automated resolver now emits a `confirmed` status that was meant to be a
  human-attestation-only sentinel, so a fallible automated identity can become
  un-correctable. This is a live symptom of the disambiguation model straining.
- `.claude-memory/reviewer-identity-fragmentation.md` — the underlying failure mode
  (one researcher fragmented across disjoint stores with no shared key).
- `.claude-memory/project-openalex-merge-use-orcid-works.md` — OpenAlex merges
  same-name authors; a data-source-quality hazard we worked around.
- Also skim: `git log --oneline -- lib/services/discovery lib/services/reviewer-identity-resolver.js lib/dataverse/adapters/researcher.js`
  and the reviewer-heavy `DEVELOPMENT_LOG.md` entries, to see how many passes this took.

## Reading map (curated; each launch-pad routes onward — follow the threads)

**Start at the two retrieval launch-pads (they route to canonical docs, Atlas, memories, hazards):**
- `docs/agent-wiki/topics/reviewer-origination.md` — the finding half.
- `docs/agent-wiki/topics/reviewer-identity.md` — the disambiguation half.

**Finding — design + code:**
- Docs: `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`,
  `docs/REVIEWER_FINDER_ORIGINATION_PLAN.md`,
  `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md` (an actual experiment —
  empirical signal), `docs/REVIEWER_ARCHITECTURE.md`, `docs/REVIEWER_DATA_MODEL.md`.
- Code: `lib/services/discovery-service.js` (facade) and `lib/services/discovery/`
  (`match-signals.js`, `ranking.js`, `name-matching.js`, `affiliation.js`,
  `publications.js`, `literature-search.js`, `coauthor-coi.js`, `provenance.js`); <!-- drain-table:ignore reason=code-module -->
  `lib/services/reviewer-finder/save-candidates-service.js`;
  `lib/services/contact-enrichment/`, `lib/services/openalex-service.js`,
  `lib/services/serp-contact-service.js`.

**Disambiguation — design + code:**
- Docs: `docs/REVIEWER_IDENTITY_STRATEGY_EVALUATION.md` (our own strategy eval — a good
  holistic starting point), `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`,
  `docs/REVIEWER_ORCID_SPINE_SPEC.md`, `docs/REVIEWER_FIELD_AWARE_VERIFICATION_DESIGN.md`,
  `docs/REVIEWER_IDENTITY_ORCID_EMPLOYMENT_PROMOTION_DESIGN.md`,
  `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` (§14 = reviewer self-report),
  `docs/REVIEWER_FINDER_PI_IDENTITY_WIREIN_PLAN.md`.
- Code: `lib/services/reviewer-identity-resolver.js` (the classifier — see
  `classifySpineEvidence`), `lib/dataverse/adapters/researcher.js` (`writeIdentityDecision`
  / `clearIdentityFields` — the sticky-`confirmed` guards),
  `lib/services/discovery/name-matching.js`.

**Empirical harnesses (run or read their methodology — real ground truth beats our prose):**
- `scripts/eval-orcid-spine-sweep.mjs`
- `scripts/probe-source-coverage.mjs`
- Look for `docs/atlas/evidence/` artifacts and any origination-experiment outputs.

**Constraints / whole-system context:**
- `docs/STRATEGY.md`, `docs/SYSTEM_MODEL.md`, `.claude-memory/project-system-model.md`
  (WMKF direction: Dataverse/Dynamics is the source of truth; minimize AkoyaGO reliance;
  small-batch cycles).
- `shared/config/appRegistry.js` (`reviewers` is the live app; reviewer-finder +
  review-manager were consolidated into the Request Workbench).

## What we want back

Structure your answer as:

1. **Reframe** — are we solving the right problem(s)? State the problem(s) as *you* would
   frame them after reading. Where is our "surface and inform, human decides" frame — and
   our unsettled failure-severity ranking — wrong or incomplete? Where should the tool
   decide rather than defer?
2. **Where we over- and under-invest** — name the specific places we've sunk effort that
   don't earn it, and the gaps we've neglected.
3. **Recommended direction — finding.** The approach you'd take, and why, at small scale.
4. **Recommended direction — disambiguation.** Same. Address the `confirmed`-sentinel /
   sticky-identity question head-on as a symptom: is the whole confidence-status model
   right?
5. **Stop doing** — a short, concrete list of things to abandon.
6. **The pattern** — from the reversal history, what recurring mistake in *how we reason*
   about this should we watch for?

Be specific, cite what you read (`file:line` or doc section), and prefer a strong opinion
you can defend over a balanced menu. If you need to run a script or grep to ground a
claim, do it.

## Where to put your answer

Write your analysis to a new file **`outputs/reviewer-holistic-review-fable-findings.md`**
so it can be picked up in a later working session. Do **not** run the `/stop` routine and
do **not** edit `SESSION_PROMPT.md`, the memory store, or any other durable doc — your job
is the analysis artifact only; a human will decide what to act on and reconcile it from
there.
