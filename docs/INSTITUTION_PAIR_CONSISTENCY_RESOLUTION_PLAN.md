---
title: Institution Pair Consistency Resolution Plan
domain: reviewer-identity
kind: plan
status: active
summary: "Staged plan to auto-resolve manufactured institution conflicts so staff adjudicate only genuine mismatches. Proposed; awaiting owner approval."
canonical: false
cataloged: 2026-08-08
owner: product-engineering
related:
  - docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md
  - docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md
  - docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md
  - outputs/ror-reviewer-finding-strategic-assessment-2026-08-08.md
  - outputs/s400-institution-checker-probe-findings.md
  - lib/services/institution-affiliation-consistency.js
  - lib/services/ror-institution-identity-resolver.js
---

# Institution Pair Consistency Resolution Plan

## Status

**PROPOSED — no stage is authorized until the owner approves.** Drafted
2026-08-08 (Session 409) from the owner's problem statement: staff spend
substantial effort resolving conflicts that should be automatic — "Harvard
University" vs "Harvard Medical School," "University of Illinois" vs
"University of Illinois Department of Chemistry" — including clicking
verification confirmations against websites they then have to cite.

This plan resolves the strategic-reset question in
`docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md` differently than a
resolver promotion: the product goal is **pair consistency** (are these two
institution strings the same organization, related organizations, or genuinely
different?), not resolve-one-string-to-one-id, and not identity-arm
authority. The dormant production ROR stack is reused here as a substrate, at
lower risk than the identity-promotion path it was originally built toward.

## Problem

### The contract nobody named

The strategic reset separated reviewer relevance, person identity, and
institution normalization. The staff pain sits in a fourth contract:

> `pairConsistency(left, right) → same | related | distinct | insufficient`

- **Input:** two institution strings from different evidence sources (listed
  institution, publication byline, enrichment result, prior record).
- **Output:** a typed verdict with a machine-readable reason, so consumers can
  auto-clear `same`/`related`, surface `distinct` as a real conflict, and
  present `insufficient` honestly instead of calling it a mismatch.
- **Not this contract:** COI adjacency (hard firewall, see invariants),
  canonical-id resolution (C3), person identity (C2), address/person
  attestation (its verification flow exists for contact safety and stays).

### Where the manufactured conflicts come from

`createInstitutionConsistencyChecker.areConsistent()` accepts direct identity
and one-hop OpenAlex associated-institution links — Vanderbilt↔VUMC and
Columbia↔Irving pass today [VERIFIED via
`lib/services/institution-affiliation-consistency.js:13-51` and the S400 probe
table]. Its consumers are the identity-evidence path, enrichment, and the
affiliation-mismatch alert [VERIFIED via CodeGraph callers of
`createInstitutionConsistencyChecker`: `reviewer-identity-evidence.js`,
`workbench/enrich-recommended-service.js`,
`alert-reviewer-affiliation-mismatch.js`]. It fails on the owner's two example
classes for mechanical reasons proven live in
`outputs/s400-institution-checker-probe-findings.md`:

1. **Subset/decorated strings never resolve.** "Department of X,
   <Institution>, City, ST, USA" returns zero OpenAlex search results; the
   checker falls back to raw-string comparison → `false` → staff see
   "institution mismatch." Four of the five real request-1002903 conflicts
   were this class [VERIFIED via the S400 production capture section]. A core
   extractor exists but is a crude first-match regex and is not applied in
   the checker [VERIFIED via `lib/services/discovery/affiliation.js:117-136`
   and the checker source, which calls only
   `DeduplicationService.institutionDisplayName`].
2. **Short forms tie ambiguously.** "Texas A&M," "NC State University" → tie
   or zero results → null → `false` [VERIFIED via S400 probe 2].

So most human adjudication clicks resolve conflicts the system manufactured
out of string decoration, not genuine disagreements.

### Why the dormant ROR stack fits this consumer

- ROR's affiliation endpoint is built for messy decorated text — the input
  class the incumbent resolver scores near zero on. Candidate benchmark:
  ROR 128/141 vs incumbent 84/141 [VERIFIED via
  `outputs/institution-resolution-handoff-to-codex-2026-08-07.md` evidence
  trail].
- ROR records carry typed relationships (parent/child/related/successor) —
  the adjudication data for "Harvard Medical School relates to Harvard
  University." The v2 benchmark already built relationship-aware pair
  evaluation, and the frozen suite has hierarchy and byline-normalization
  case families [VERIFIED via the handoff and
  `benchmarks/fuzzy-matching-falsification/cases/` listing].
- This consumer is lower risk than identity promotion: the checker's output
  is a review flag, never an identity bind, contact promotion, invitation, or
  COI decision [VERIFIED via the checker's header contract].

## Design — three stages, smallest first

### Stage 1 — institution-core extraction before comparison (no ROR)

Normalize both sides of `areConsistent` by extracting the institution core
from decorated bylines before resolution and comparison. Strengthen the
existing extractor (or adopt the parsing built for the ROR candidate
contract) rather than adding a new normalizer; consolidate, do not fork.

- Expected effect: flips the four documented 1002903 byline-class false
  mismatches; leaves the possibly-substantive fifth flagged — the correct
  target behavior per S400.
- Failure posture unchanged: extraction failure degrades to today's behavior,
  never to a broader match.

### Stage 2 — ROR-backed pair adjudication

Swap the checker's internal resolver from the incumbent
`createInstitutionIdentityResolver` to the production
`createRorInstitutionIdentityResolver` (dormant, veto-first, request-scoped),
and adjudicate resolved pairs with typed evidence:

- same ROR id → `same`;
- ROR parent/child or related link, or existing one-hop OpenAlex
  associated-institution link → `related` (policy decides which relationship
  kinds auto-clear; see owner decisions);
- both resolve, no link → `distinct`;
- either side unresolved/vetoed/provider-failed → `insufficient`.

ROR rank/`chosen:true` remains retrieval evidence only; vetoes still run
before any pair verdict. Callers of the incumbent resolver outside the
checker (e.g. save-candidates, evaluation harness) are untouched.

### Stage 3 — consumer policy and copy

- `same`/`related` auto-clear with a stated reason ("Harvard Medical School
  is a constituent of Harvard University — registry relationship"), removing
  the manual verify-and-cite step for those classes.
- `distinct` surfaces as a genuine conflict and keeps the existing human
  adjudication/attestation flow.
- `insufficient` surfaces as "could not compare," never as "mismatch"
  (S399/S400 lesson).
- The banner names the institutions it compared (closes the withheld-fields
  half of S399 finding 1).

## Safety invariants (all stages)

1. **Sibling campuses never auto-clear.** UCSD vs UCLA remains `distinct`
   regardless of shared parents. The 120-case UC matrix is the regression
   gate; zero auto-cleared sibling pairs is a hard gate.
2. **COI firewall unchanged.** Relationship/associated links must not feed the
   COI hard-drop matcher (existing invariant in the checker header).
   `related` is appointment-compatibility evidence only.
3. **Fail closed on ambiguity.** `insufficient` never auto-clears and never
   blocks; it routes to the existing human flow with honest copy.
4. **Address/person attestation is out of scope.** The exact-address
   verification flow
   (`docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md`) exists for
   contact safety and is not weakened or bypassed by any pair verdict.
5. **No schema, telemetry, or authority changes** beyond what a stage
   explicitly lists; `REVIEWER_IDENTITY_RESOLVER_MODE` and production
   resolver authority are untouched by this plan.

## Benchmark and gates — existing evidence only

No new labeling effort and no Claude search. Score every stage on:

- `benchmarks/fuzzy-matching-falsification/cases/institution-byline-normalization.jsonl`
  (14 cases) and `institution-hierarchy.jsonl` (7 cases) [case counts
  VERIFIED via line counts this session] — the two families directly on
  point;
- the five real request-1002903 captures
  (`outputs/s400-verdict-trace-capture-2026-08-04.log`) — expected: rows 1–4
  become `same`, row 5 stays flagged;
- sibling/parent adversarial pairs derived from
  `institution-uc-matrix.jsonl` (120 cases) — expected: zero
  `same`/`related` verdicts across sibling campuses;
- the v2 relationship-aware pair-evaluation harness for typed-relationship
  scoring (new result slugs; frozen artifacts untouched).

**Go gates per stage:** zero sibling auto-clears; zero new wrong `same`
verdicts on the frozen families; 1002903 rows 1–4 flip and row 5 holds;
no COI behavior change (existing COI tests stay green). **No-go:** any gate
failure stops the stage; no threshold tuning against the gate set without a
new owner decision (the S395 scope-accretion postmortem applies).

## Rollout

- Tier classification per
  `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`: Stages 1–2 change
  runtime reviewer-facing behavior → **Tier 1–2, branch + deliberate
  promotion**, not direct-to-main.
- Sequence: Stage 1 alone first (smallest reversible increment, measurable on
  the gates); Stage 2 only after Stage 1 ships and its effect is observed on
  a real request batch; Stage 3 copy/policy rides with whichever stage its
  pieces depend on.
- Verification per stage: focused unit tests for the checker and normalizer,
  the benchmark gate runs above, relevant red gates for touched surfaces, and
  a signed-in production smoke on a real request after promotion.

## Owner decisions required before Stage 1 starts

1. **Approve the pair-consistency contract as the product goal** for this
   workstream (supersedes the resolver-promotion framing in the strategic
   reset; the identity-arm promotion question is separately parked).
2. **Relationship auto-clear policy:** which typed relationships count as
   `related`-and-auto-clear — recommendation: parent/child (med school,
   department, constituent college) and one-hop associated institutions yes;
   sibling never; `successor` and cross-system links surfaced, not
   auto-cleared, until observed.
3. **Consumer scope:** apply verdicts to the mismatch alert and enrichment
   review flags first (recommendation), or also to identity-evidence
   corroboration in the same stage.
4. **Whether the two parked measurement runs from
   `outputs/ror-reviewer-finding-strategic-assessment-2026-08-08.md` still
   run.** They price identity-arm promotion, which this plan does not need;
   recommendation: drop unless identity promotion returns to the table.

## Relationship to the strategic reset

The reset brief asked which capability should be the promotion target. This
plan's answer: none of the three as originally framed. The ROR investment is
retained and put to work where the demonstrated staff pain is — pair
consistency — while production identity authority remains `legacy-default`
and all identity-promotion work stays parked. The frozen benchmarks remain
the falsification record; this plan adds only new result runs under new
slugs.
