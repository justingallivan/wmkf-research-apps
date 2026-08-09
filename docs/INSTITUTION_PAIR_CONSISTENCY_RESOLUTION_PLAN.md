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
> opt-in `segmentComparison` default-off at :165; segment-wise comparison at
> :187 with shared-fragment self-pair exclusion, parent-fragment pool
> policy (`classifyFragment` with per-call-site `unprovenExtensionPolicy`
> and extension-cap overflow handling), and Wave 4 direct-identity-only
> crossings/fallback (associated-link evidence consulted nowhere on the
> staged path; the Wave 3c/3d crossing tags and whole-parent restrictions
> are removed as subsumed); default path in `areConsistent` (:335)
> behavior-identical when the flag is off — verified via the live
> default-path probe, the vector-4 pin, and the resolve call-count
> assertions.]
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
> **Stage 1 live gate history.** Wave 2c PASS (145/145,
> `results/stage1-wave2c-2026-08-08.json`) is HISTORICAL: it predates the
> hardened runner, so it carries no provider-failure proof or provenance
> (Codex finding 2). Wave 3 FAIL (141/145,
> `results/stage1-wave3-2026-08-08.json`) is the falsification record for
> the strict-everywhere pool rule. **Current gate: Wave 5 PASS, 2026-08-09
> — 156/156 (named-relationship family added; required-families enforcement
> active) with providerFailures 0 and clean-tree provenance (git sha
> d9c8af0, dirty false)** (`results/stage1-wave5-2026-08-09.json`). All
> three named-relationship rows surface on the staged arm as expected;
> observationally, the incumbent (main-behavior) arm auto-clears
> VUMC↔Vanderbilt AND Dana-Farber↔Harvard via associated links — live
> confirmation that main's default path violates the policy table's
> Dana-Farber surface expectation today, Stage 2 scope. Prior record:
> Wave 4 PASS, 2026-08-08 — 153/153 (uc-system-* family added), git sha
> df819f9 (`results/stage1-wave4-2026-08-08.json`). The seven new
> campus-vs-system rows demonstrate the fix in-band: the incumbent
> (main-behavior) arm auto-clears campus vs "University of California
> System" (`same-or-related`, 7/7), the staged arm surfaces it
> (`not-cleared`, 7/7); the eighth row (system self-pair) clears on both
> arms, as expected for `same`.
> Earlier PASS artifacts (wave3b/3c/3d/3e, 145-row set) record prior
> checker revisions and are retained. The original wave2c narrative below
> is retained for the family-level detail, which every subsequent passing
> run reproduced:
>
> **Wave 2c detail (historical)** — 145/145 pairs:
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
> **Wave 3 remediation (2026-08-08, after Codex adversarial re-review of the
> branch: needs-attention, 2 high + 2 medium).** An earlier revision of this
> paragraph claimed the residual exposure was campus-vs-parent only and
> Stage-1-only; offline probes falsified both halves, and Wave 3 closed the
> in-scope paths:
> 1. *Step-2 parent-fragment fail-open (was documented too narrowly).* With a
>    resolver that resolves a bare parent string, step 2 auto-cleared BOTH
>    campus-vs-parent (via the shared-fragment whole-operand exception) AND
>    sibling campuses (parent fragment × associated-link) [VERIFIED via stub
>    probes, S409]. Wave 3 fix, two revisions: the first cut excluded any
>    fragment with an unresolvable extension from step-2 pools (strict fail
>    closed everywhere) — empirically REJECTED: the live gate failed 141/145
>    with all four 1002903 clears regressed, because real decoration
>    extensions ("…, La Jolla", "…, Nashville") definitively abstain
>    (`results/stage1-wave3-2026-08-08.json`, retained as the falsification
>    record; providerFailures 0, so the misses are definitive, not outage).
>    Final rule — a principled evidence split: step 1 (which clears on string
>    match alone) and the whole-operand parent check stay strict (unproven
>    extension demotes); step-2 pools, where clearing requires resolved
>    identity evidence on BOTH sides, admit a fragment whose own identity
>    resolved when its extensions merely abstain, and demote only on an
>    extension resolving to a DIFFERENT identity. A whole operand that is
>    itself a bare parent shape of the other operand earns direct-identity
>    credit only in step-2 pairings (associated-link evidence withheld).
>    The Codex re-review then falsified the first residual enumeration: an
>    admitted-unproven bare-parent fragment could ALSO cross to a SIBLING
>    campus whole via associated-link credit (bare parent resolves + one
>    campus definitively misses) [VERIFIED via reproduced probe, S409] —
>    an invariant-1 violation, not acceptable-residual class. Wave 3c fix
>    (HISTORICAL — the tagging mechanism described here was removed by
>    Wave 4, which drops associated-link evidence from the staged path
>    entirely): pool entries admitted despite an abstaining extension were
>    TAGGED, and any crossing involving a tagged entry cleared via direct
>    identity match only. Deliberate narrowing accepted with that fix: the
>    offline Broad-Institute-vs-MIT decorated-fragment case was re-pinned
>    false. (Its "whole-operand corroboration is unaffected" carve-out was
>    itself superseded by Wave 4, which flipped Harvard↔HMS to surface per
>    the relationship-policy table.)
>    ACCEPTED RESIDUAL, now precisely IDENTITY-EQUALITY ONLY (pinned in a
>    labeled offline test): if a bare parent ever RESOLVES (it abstains
>    today, S400) AND the campus extension string definitively misses, a
>    campus-vs-parent pair auto-clears via step-2 directMatch of the same
>    identity — unfixable without breaking the row-4 VUMC clear, which has
>    the identical structural shape. Two independently unlikely live
>    conditions. Tripwire: the deterministic offline pins — the live gate's
>    campus-vs-parent rows CANNOT exercise this class (they require a
>    one-sided definitive miss, and the real campuses resolve). Total
>    provider outage still surfaces (unresolved fragments never enter
>    pools — invariant 3 holds).
>
>    **Wave 4 (owner-directed, 2026-08-08): staged path drops
>    associated-link credit entirely.** A fourth review round found prefix-
>    ordered qualifiers bypass the suffix-only extension model; session
>    probes then established the deeper fact: **"University of California
>    System" resolves live** (OpenAlex I2803209242, 15 associated
>    institutions), so system↔campus pairs auto-cleared via associated-link
>    credit as plain whole operands — on the staged path AND on `main`'s
>    default path (the checker's original one-hop corroboration design)
>    [VERIFIED via live probes, S409: staged and default both returned true
>    for "University of California System" vs "University of California San
>    Diego"]. Owner decision 2 was therefore never enforced against the
>    resolvable system name anywhere; the prior gate never caught it because
>    its campus-vs-parent rows used the bare form, which abstains live. The
>    owner overrode the stop-rule for this one fix ("fix it and let's move
>    on"); the stop-rule is back in force after Wave 4.
>    **The Wave 4 invariant (replaces the suffix-contiguous closure claim):
>    with `segmentComparison: true`, associated-link evidence is consulted
>    nowhere — step 1 clears on string match with decoration proof; step 2
>    crossings and the fallback clear on resolved-identity direct match
>    only.** This removes the subsumed Wave 3c/3d crossing machinery
>    (`admittedUnproven` tags, whole-parent direct-only restriction,
>    fallback parent-shape guard) rather than adding a fifth guard; the
>    step-1 decoration proof, parent-fragment pool exclusion, and
>    shared-fragment self-pair exclusion remain (each still blocks a named
>    probe). Consequences, per the Stage 2 relationship-policy table
>    (verified from this doc): Harvard↔HMS and Dana-Farber↔Harvard now
>    SURFACE at the alert (the table's stated policy — note Harvard↔HMS was
>    the owner's motivating example, so related-institution pairs will
>    alert until Stage 2 typed relationships enable `related-autoclear`);
>    VUMC↔Vanderbilt-class auto-clears are explicitly Stage 2 scope. The
>    default path is behavior-identical (enrichment/identity-evidence
>    corroboration unchanged, decision 3 — verified via live probe and the
>    default-path pins); the earlier "branch widens the
>    hazard" note inverts — post-Wave-4 the branch STRICTLY NARROWS alert
>    auto-clearing relative to `main`. Remaining accepted residual:
>    same-resolved-identity clears (the SYSTEM==SYSTEM class) are inherent
>    to identity-equality evidence. The gate gains a system-name family
>    ("University of California System" vs each campus → related-surface)
>    so the resolvable form is exercised live.
>
>    **Wave 3d (superseded by Wave 4 above) and the STOP-RULE.** A third re-review
>    round falsified the closure claim as then written: `fragmentExtensions`
>    capped classification at the 3 shortest extensions, so a crafted
>    byline whose contradictory extension is longest could be wrongly
>    certified proven-decoration and earn associated-link credit
>    [VERIFIED via reproduced probe, S409 — requires a bare parent that
>    resolves, so live exposure is nil today]. Wave 3d makes the claim
>    true: extension overflow forbids the 'decoration' classification
>    (demote under strict policy, `admittedUnproven` under admit policy);
>    the consumer-scope inventory widens to all runnable extensions and
>    static dynamic-import specifiers. **Stop-rule (owner-directed,
>    2026-08-08): this is the last Stage 1 checker iteration. If a
>    subsequent adversarial review finds any further step-2 path, Stage 1
>    freezes as-is — the finding is recorded, the closure claim is narrowed
>    to what is proven, and the remainder routes to Stage 2's typed
>    parent/child relationships. No fifth guard mechanism gets added to
>    the string-side checker.** Rationale: three rounds produced
>    progressively more contrived counterexamples, none live-reachable
>    today — the step-2 crossing paths (rounds 2–3) all require a bare
>    parent that resolves (live: abstains, S400), and round 1's fallback
>    path required an associated-institution NAME collision (live: OpenAlex
>    names the UC parent "University of California System", which does not
>    collide); the composition of four interacting guards is a hand-rolled
>    approximation of Stage 2's typed relationships, and further patching
>    adds complexity faster than safety.
> 2. *Unguarded fallback under `segmentComparison: true`.* When the segment
>    path abstained, the pre-existing default path could still auto-clear
>    campus-vs-parent via an associated-institution NAME collision (resolver
>    abstains on the bare parent → raw-string substitution at the fallback →
>    name match against the campus's associated institution) [VERIFIED via
>    stub probe, S409]. Wave 3 fix: with `segmentComparison: true`, when one
>    whole operand equals a proper parent fragment of the other, the fallback
>    accepts only direct identity matches — associated-link evidence is
>    rejected for that pair shape.
> 3. *Pre-existing main-branch hazard, DOCUMENTED NOT FIXED (owner risk
>    acceptance).* The same name-collision fallback path exists on `main`
>    with `segmentComparison: false` — the mode enrichment and
>    identity-evidence use. It does not fire live today only because OpenAlex
>    names the UC parent "University of California System" (string ≠
>    "University of California") [VERIFIED: live gate campus-vs-parent rows
>    surface; stub probe with colliding name auto-clears]. Per owner
>    decision 3 (enrichment copy-only in Stage 1), Wave 3 leaves default-path
>    behavior byte-identical and pins the current behavior in a labeled test;
>    the structural fix (typed parent/child relationships) is Stage 2 scope.
> 4. *Gate runner could PASS vacuously during provider failure* (default
>    error suppression turned provider exceptions into abstains, which
>    satisfy `distinct`/`related-surface` expectations). Wave 3 fix: the
>    runner propagates provider errors, records resolver metrics, and fails
>    on any recorded provider failure; artifacts now embed git HEAD, dirty
>    state, runner/fixture sha256, node version, and a key-present boolean.
>    `gate: PASS` now means "all expectations met AND zero provider
>    failures".
> 5. *Falsification-record classification.* The two failed wave-2 artifacts
>    are historical, non-revision-reproducible observations (runner, failure,
>    and fix landed in one commit); the durable falsification record is the
>    offline jest regressions that pin those fail-open scenarios with stub
>    resolvers — stronger evidence than replaying an old commit, because the
>    scenarios are deterministic.

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

**Gate-contract split (S409, closes the final Codex re-review finding):**
the named regressions above carry TWO different expectations by stage. The
**Stage 1 live gate** pins all three pairs as `related-surface` — the
expected Wave 4 staged verdict given the live resolutions verified
2026-08-09 (HMS definitively abstains; VUMC/Vanderbilt/Dana-Farber resolve
to distinct identities) and the hostile-verified no-associated-link
invariant; the expanded gate run recorded below is the end-to-end
evidence — via the tracked `named-relationship-pairs.jsonl` family, and
the runner fails fast if any required family (1002903, uc-sibling,
named-relationship) is absent. The **Stage 2 contract** is where
VUMC↔Vanderbilt's `related-autoclear` expectation lives (typed
relationships); per the owner's 2026-08-09 cost calibration (institution
errors at the alert tier are reviewer-self-corrected, so surfaced pairs —
not false clears — are the expensive direction there), the Stage 2
`related-autoclear` classification should lean broad. Byline-normalization
coverage at the Stage 1 gate is the 1002903 family; the frozen
fuzzy-matching hierarchy suites remain offline Stage 2 evidence, not Stage 1
live-gate families.

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
     **Arm 2 COMPLETED 2026-08-09** (local artifact
     `outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v2-ror-arm2-2026-08-09.json`,
     untracked per the same precedent): 40/40, zero provider failures on
     both providers (ROR adapter: 31 requests, all 2xx, 0 timeouts/
     transport failures/malformed responses). All five `evaluatePromotion`
     gates pass with the SAME numbers as arm 1 — and that is the finding:
     **every combined decision and outcome is identical to the baseline
     across all 40 cases** [VERIFIED via per-case diff of both artifacts].
     The headroom hypothesis is FALSIFIED on this benchmark: the ROR arm
     resolved more claimed institutions (`claimed_institution_unresolved`
     works-stage reasons dropped; resolver decisions: 21 resolved / 3
     review / 0 unresolved), but in the only two cases whose works-stage
     reason changed (hazard-10-a-patel, clean-01-ram-madabhushi) the newly
     resolved institution then failed byline corroboration — `review
     (claimed_institution_unresolved)` became `abstain
     (no_institution_corroborated_byline)` with unchanged combined
     outcomes. Institution resolution was not the binding constraint on
     the frozen-40; byline corroboration is. Note the benchmark's claimed
     affiliations are full institution names, so ROR's alias/short-form
     advantage ("UCLA", "UC San Diego") is untested by this suite.
     Consequence: the enrichment-injection gate's zero-false-binds
     condition is met, but there is no measured benefit to justify the
     authority change — recommendation recorded as do-not-inject on
     current evidence; revisit only with a benchmark whose failure mode
     is actually institution-resolution-bound (e.g. short-form
     affiliations).
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
