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

<!-- [RECHECKED after lib/services/workbench/enrich-recommended-service.js change: Wave 2 branch diff is one display string in institutionVerdictReason (+1/−1); identity gate, checker construction, and write branches untouched; consumer set machine-enforced by tests/unit/institution-checker-consumer-scope.test.js] -->

## Status

**APPROVED WITH SCOPE, 2026-08-08 — Stage 1 is authorized.** The four owner
decisions below were resolved in Session 409; see "Owner decisions —
resolved." Stages proceed in order on a branch per the rollout section; every
stage gate must be runnable headlessly by an agent (see "Agent-runnable
evaluation harness") — no production UI searches are part of any gate.

**Amended 2026-08-08 after Codex adversarial review (GPT-5; verdict
needs-attention).** All four findings were verified against source and
accepted: (1) the enrichment consumer's checker verdict feeds
`identityNeedsReview`, which gates durable researcher writes, ORCID
back-propagation, and COI writes — not only display [VERIFIED via
`lib/services/workbench/enrich-recommended-service.js` identity gate and
`upsertByPotentialReviewer` branch]; (2) the production ROR resolver returns
only the hydrated canonical identity, so successor canonicalization is
invisible to a same-ID pair verdict; (3) ROR's `related` type does not
distinguish constituent links from cross-system links; (4) the originally
named gate evidence was partly untracked or mismatched. The decision-3
rescope, Stage 2 operand contract, relationship-policy table, and fixture
requirements below are the accepted remediations. [RECHECKED after
lib/services/workbench/enrich-recommended-service.js change: finding 1's
identity-gate/write-branch claims are unaffected by the Wave 2 branch diff,
which is a single display string in `institutionVerdictReason` (+1/−1);
see the decision-3 recheck marker for detail.]

Drafted 2026-08-08 (Session 409) from the owner's problem statement: staff spend
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
> (with `related` policy-split into `related-autoclear` / `related-surface`
> per the Stage 2 relationship-policy table)

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
`alert-reviewer-affiliation-mismatch.js`]. [RECHECKED after
lib/services/workbench/enrich-recommended-service.js change: the consumer set
is unchanged on the Stage 1 branch and is now machine-enforced by
`tests/unit/institution-checker-consumer-scope.test.js`.] It fails on the
owner's two example classes for mechanical reasons proven live in
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

> [RECHECKED after lib/services/discovery/affiliation.js change:
> `normalizeAffiliationForComparison` untouched at :117; additive
> `institutionSegments` at :152.]
> [RECHECKED after lib/services/institution-affiliation-consistency.js change:
> opt-in `segmentComparison` default-off at :45; segment-wise comparison at
> :67 with shared-fragment self-pair exclusion; default path in
> `areConsistent` (:173 after the fail-closed guard edits) unchanged.]
> [RECHECKED after lib/services/alert-reviewer-affiliation-mismatch.js change:
> sole opt-in call site, `segmentComparison: true` at :66.]
> [RECHECKED after scripts/evaluate-reviewer-works-first.js change:
> `--institution-resolver` opt-in at :79; incumbent default construction at
> :18,294; decision 4(a)'s earlier `:281-284` citation shifted to `:294`.]
> [RECHECKED after lib/services/workbench/enrich-recommended-service.js Wave 2
> change: copy-only edit to the `prior_flag` branch of `institutionVerdictReason`
> (display text now says the institution "could not be compared this run"
> instead of asserting a mismatch was flagged). `identityNeedsReview`, the
> checker construction (bare `createInstitutionConsistencyChecker()`), and
> every write-path condition described in owner decision 3 are byte-identical;
> this file's verdict-bearing role in that decision is unchanged.]
>
> Wave 1 built 2026-08-08 (fixtures + generator, segment-comparison opt-in,
> arm-2 evaluator flag); 55 focused tests green including a falsification
> test for the shared-parent-fragment sibling hazard flagged during build.
>
> **Stage 1 live gate: PASS, 2026-08-08** — 145/145 pairs
> (`benchmarks/institution-pair-consistency/results/stage1-wave2c-2026-08-08.json`):
> all five 1002903 pairs behave to spec (four clear, the genuine mismatch
> stays flagged), zero sibling auto-clears across 126 cross-campus pairs,
> and all seven campus-vs-parent pairs surface. Two prior failed runs are
> retained as the falsification record (`stage1-wave2-…`: campus-vs-parent
> auto-cleared via a fail-open fragment guard, since made fail-closed;
> `stage1-wave2b-…`: keyless-pool rate-limit mass timeouts, since fixed by
> loading `.env.local` in the CLI). A direct segment match now requires its
> contiguous extensions to be PROVEN decoration; unproven extensions demote
> to step 2's positive-evidence path, so total provider failure surfaces
> instead of auto-clearing.
>
> Wave 2 built 2026-08-08 (live replay CLI + offline tests, consumer-scope
> assertion test, enrichment copy/provenance fix for the `prior_flag` verdict
> reason).
>
> **Known Stage 1 limitation — bare-parent step-2 dependency on live resolver
> behavior.** If a bare system/parent string (e.g. "University of California")
> ever *resolved* to an identity instead of abstaining, step 2 could pair a
> campus operand's parent-fragment segment against the OTHER operand being
> exactly that parent string (the shared-fragment exclusion deliberately
> allows a fragment that equals a whole operand), and a campus-vs-parent pair
> could auto-clear. Today the incumbent resolver abstains on bare "University
> of California" (S400 ambiguity-tie behavior), so the seven campus-vs-parent
> gate rows surface — but that part of safety invariant 2 rests on live
> resolver behavior, not code structure. Regression net: the fixed
> `uc-sibling-pairs.jsonl` suite replayed via `run-pair-gates.js` fails
> non-zero the moment resolver behavior shifts. Structural fix is Stage 2's
> typed parent/child relationships, not more string guards here.

Normalize both sides of `areConsistent` by comparing institution segments of
decorated bylines before resolution and comparison. Implementation note
(Stage 1 build, 2026-08-08): this ships as a new function in
`lib/services/discovery/affiliation.js` rather than a change to
`normalizeAffiliationForComparison` — that function keys
`_affiliationWeightsMap` grouping, so "strengthening" it would silently
change discovery affiliation-history behavior; the new function lives in the
same module to keep one home for affiliation parsing. The comparison is
segment-wise (split on comma/semicolon boundaries, test each segment and
progressive joins against the other operand) so a verdict of `same` can only
arise from matching the other operand, never from free extraction. The
behavior is opt-in at the checker factory and enabled only at the
mismatch-alert call site per decision 3.

- Expected effect: flips the four documented 1002903 byline-class false
  mismatches; leaves the possibly-substantive fifth flagged — the correct
  target behavior per S400.
- Failure posture unchanged: extraction failure degrades to today's behavior,
  never to a broader match.

### Stage 2 — ROR-backed pair adjudication

Swap the checker's internal resolver from the incumbent
`createInstitutionIdentityResolver` to the production
`createRorInstitutionIdentityResolver` (dormant, veto-first, request-scoped),
with a **provenance-preserving operand contract** (Codex finding 2): the
pair-adjudication layer must receive, for each side, the source-matched ROR
id, the canonical/hydrated ROR id, and any canonicalization relationship the
decision layer applied — the current resolver returns only the hydrated
canonical identity, and its decision layer can select an active successor for
a predecessor input via `successor_from_predecessor` [VERIFIED via
`lib/services/ror-institution-decision.js:181,200` and
`ror-institution-identity-resolver.js:63-114`], which would otherwise make a
forbidden successor pair look same-ID.

Pair adjudication order:

1. predecessor/successor and any other canonicalization relationship is
   adjudicated **before** same-ID equality; per decision 2, successor pairs
   surface, never auto-clear;
2. same source ROR id (no canonicalization) → `same`;
3. relationship-policy table (below) maps typed links to
   `related-autoclear` vs `related-surface`;
4. both resolve, no link → `distinct`;
5. either side unresolved/vetoed/provider-failed → `insufficient`.

**Relationship-policy table (Codex finding 3):** ROR's `related` type does
not distinguish a constituent hospital from a merely affiliated independent
organization, so registry relation ≠ auto-clear eligibility. The table is a
tracked artifact with a falsifiable classifier (e.g. parent/child → eligible;
`related` eligible only with corroborating evidence such as shared domain or
name-containment per the v3 name-compatibility policy; cross-system `related`
without corroboration → surface). Required named regressions: Harvard↔HMS
(successor/canonicalization: surface), VUMC↔Vanderbilt (`related` constituent:
auto-clear), Dana-Farber↔Harvard (`related` cross-organization: surface).

ROR rank/`chosen:true` remains retrieval evidence only; vetoes still run
before any pair verdict. Callers of the incumbent resolver outside the
checker (e.g. save-candidates, evaluation harness) are untouched.

### Stage 3 — consumer policy and copy

- `same` and `related-autoclear` verdicts clear with a stated reason (e.g.
  "constituent organization — registry relationship"), removing the manual
  verify-and-cite step for those classes; `related-surface` verdicts stay in
  the human queue with the relationship shown.
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
- a **tracked, sanitized fixture of the five request-1002903 pairs**
  (institution strings only, no reviewer names), created in Stage 1 — the
  source capture log is untracked local state under gitignored `outputs/`
  and cannot gate a clean checkout (Codex finding 4). Expected: rows 1–4
  become `same`, row 5 stays flagged;
- sibling/parent adversarial **pairs produced by a frozen, tracked pair
  generator with explicit expected verdicts** — the 120
  `institution-uc-matrix.jsonl` rows are single-operand resolve cases, so
  the pair set and its oracle must be derived deterministically and frozen
  as their own case file, not implied. Expected: zero `same` or
  `related-autoclear` verdicts across sibling campuses;
- the **v3** relationship/product-policy comparator harness (not v2 — v3
  carries the name-compatibility pair policy) under new result slugs;
  frozen artifacts untouched;
- the three named relationship regressions from Stage 2 (Harvard↔HMS
  surface, VUMC↔Vanderbilt auto-clear, Dana-Farber↔Harvard surface).

**Go gates per stage:** zero sibling auto-clears; zero new wrong `same`
verdicts on the frozen families; 1002903 rows 1–4 flip and row 5 holds;
no COI behavior change (existing COI tests stay green). **No-go:** any gate
failure stops the stage; no threshold tuning against the gate set without a
new owner decision (the S395 scope-accretion postmortem applies).

## Agent-runnable evaluation harness (owner requirement, 2026-08-08)

Every stage gate must be executable from a local agent session (Claude/Codex
CLI) with no production UI interaction and no paid Claude search. Precedents
already in the repo: the S400 probes ran the real production modules against
live keyless OpenAlex from a local Node process, and the falsification
comparator harness (`benchmarks/fuzzy-matching-falsification/run-comparator.js`)
replays frozen cases against adapters with new result slugs.

Deliverables (Stage 1 builds the harness alongside the fix):

1. **Offline jest suite** — deterministic fixture-based unit tests for the
   normalizer and the pair-verdict logic (recorded provider responses for the
   1002903-class strings, hierarchy pairs, and sibling pairs). Runs in the
   ordinary test suite with no network; this is the red gate for regressions.
2. **Live replay CLI** — a `benchmarks/`-style runner (jest-invisible, new
   result slugs, refuses to overwrite existing results) that replays the gate
   set — byline-normalization and hierarchy families, the frozen sibling
   pair set, the tracked 1002903 pair fixture, and the named relationship
   regressions — through the real checker in both incumbent and staged
   configurations, and prints a per-family verdict table plus the go/no-go
   gate results. Read-only provider calls (OpenAlex, and ROR from Stage 2);
   no schema, no writes, no production deployment involved. **The CLI must
   exit nonzero on any missing case, skipped case, provider failure, or
   forbidden verdict** — a partially executed run is a failed run, never a
   green one (Codex finding 4).
3. **Consumer-scope assertion** — a focused test that the factory default is
   unchanged and only the two in-scope call sites receive the new behavior,
   so decision 3's boundary is machine-enforced rather than convention.

The live replay CLI replaces production-UI observation as the per-stage
acceptance evidence; the post-promotion signed-in smoke remains a one-time
deployment sanity check, not a measurement instrument.

## Rollout

- Tier classification per
  `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`: Stages 1–2 change
  runtime reviewer-facing behavior → **Tier 1–2, branch + deliberate
  promotion**, not direct-to-main.
- Sequence: Stage 1 alone first (smallest reversible increment, measurable on
  the gates); Stage 2 only after Stage 1 ships and its effect is observed on
  a real request batch; Stage 3 copy/policy rides with whichever stage its
  pieces depend on.
- Verification per stage: the offline jest suite, the live replay CLI gate
  run (agent-runnable, see harness section), relevant red gates for touched
  surfaces, and a one-time signed-in production smoke after promotion.

## Owner decisions — resolved 2026-08-08 (Session 409)

1. **Contract approved.** Pair consistency is the product goal for this
   workstream, superseding the resolver-promotion framing in the strategic
   reset; the identity-arm promotion question remains separately parked.
2. **Relationship auto-clear policy approved as recommended.** Parent/child
   (med school, department, constituent college) and one-hop associated
   institutions auto-clear as `related`; sibling campuses never;
   `successor` and cross-system links are surfaced, not auto-cleared, until
   observed.
3. **Consumer scope — RESCOPED 2026-08-08 after Codex finding 1.** The
   enrichment checker verdict is not display-only: `institutionContradicted`
   feeds `identityNeedsReview`, whose false branch permits
   `upsertByPotentialReviewer` (durable researcher write of email, ORCID,
   metrics, affiliation), `writeIdentityDecision`, ORCID back-propagation to
   the linked contact, and COI reason writes [VERIFIED via
   `lib/services/workbench/enrich-recommended-service.js` identity-gate and
   write branches, read S409]. [RECHECKED after
   lib/services/workbench/enrich-recommended-service.js change: the Wave 2
   branch diff is one display string in `institutionVerdictReason` (+1/−1);
   the identity gate, checker construction, and every write branch cited
   above are untouched, and
   `tests/unit/institution-checker-consumer-scope.test.js` machine-enforces
   the bare checker construction.] Therefore:
   - **Full pair-verdict injection now: the affiliation-mismatch alert
     only** (`alert-reviewer-affiliation-mismatch.js`).
   - **Enrichment now: copy and provenance only** — the banner names the
     compared institutions and `insufficient` reads "could not compare";
     the verdict-bearing checker in the `identityNeedsReview` computation
     stays legacy, bit-for-bit.
   - **Enrichment verdict injection is identity-authority work**: it is
     unlocked only by the frozen-40 person-identity benchmark run with the
     new checker wired in, gated on zero false binds, plus an owner sign-off
     on that result. Identity-evidence corroboration
     (`reviewer-identity-evidence.js`) remains deferred behind the same gate
     and a further owner decision.
   - The checker factory default stays unchanged; scope boundaries are
     machine-enforced by the harness's consumer-scope assertion.
   Note: the identity gate also requires the resolver to independently reach
   ≥probable, so a pair verdict can only ever clear the second of two
   vetoes; the rescope treats that as defense-in-depth to preserve, not as
   license.
4. **Measurement runs — run (a) UNPARKED 2026-08-08; run (b) still
   parked** (`outputs/ror-reviewer-finding-strategic-assessment-2026-08-08.md`).
   - **(a) Frozen-40 W2 rerun: authorized, two arms.** Arm 1 (baseline,
     runnable immediately): the existing evaluator as-is — it wires the
     incumbent institution resolver [VERIFIED via
     `scripts/evaluate-reviewer-works-first.js:18,281-284`], and the
     benchmark had never had a clean run. Arm 2 (the actual
     enrichment-injection gate): the evaluator extended to wire the
     ROR-backed checker path — built with the Stage 1 harness. New output
     slugs; the failed 2026-08-08 network-outage artifact is preserved,
     not overwritten.
     **Arm 1 COMPLETED 2026-08-08** (local artifact
     `outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v2-baseline-2026-08-08.json`,
     untracked per run-artifact precedent): 40/40 cases, zero provider
     failures — the first clean run of this benchmark. All five
     `evaluatePromotion` gates pass for the combined arm: correct-bind gain
     +8 (spine 13 → combined 21, required ≥3), false binds 3 → 0 (all three
     spine false binds were demoted to review by the combine policy — two
     via `initial_only_not_works_corroborated`, one via
     `resolver_anchor_disagreement`, the latter becoming a miss [VERIFIED
     via the run artifact's rows]),
     right-person-policy binds 1 (≤ spine's 1), misses 11 → 4 (≤8). Works
     arm detail: 7 of 40 cases returned `claimed_institution_unresolved`
     under the incumbent institution resolver — the headroom arm 2's
     ROR-backed stage targets. This result is measurement evidence only; it
     does not authorize combined-mode promotion or enrichment injection,
     which still require arm 2 plus owner sign-off.
   - **(b) C3 replay: parked** — trigger unchanged (institution-resolver
     promotion returning to the table).

## Relationship to the strategic reset

The reset brief asked which capability should be the promotion target. This
plan's answer: none of the three as originally framed. The ROR investment is
retained and put to work where the demonstrated staff pain is — pair
consistency — while production identity authority remains `legacy-default`
and all identity-promotion work stays parked. The frozen benchmarks remain
the falsification record; this plan adds only new result runs under new
slugs.
