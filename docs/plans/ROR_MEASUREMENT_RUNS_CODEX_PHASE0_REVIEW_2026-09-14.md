---
title: ROR / Works-first Measurement Runs — Codex Phase 0 Review (2026-09-14)
domain: reviewer-identity
kind: plan
status: active
summary: "Independent source review of the 2026-08-08 ROR strategic assessment. The C1/C2/C3 decomposition and no-tuning boundary stand, but the proposed C2 provider-failure gate and C3 production-pair comparison need reconciliation before either run is treated as go/no-go evidence."
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/plans/ROR_MEASUREMENT_RUNS_CODEX_BRIEF_2026-09-14.md
  - outputs/ror-reviewer-finding-strategic-assessment-2026-08-08.md
  - docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md
  - docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md
  - scripts/evaluate-reviewer-works-first.js
  - benchmarks/fuzzy-matching-falsification/README.md
  - lib/services/reviewer-works-first.js
  - lib/services/ror-institution-identity-resolver.js
---

# Phase 0 — independent review

**Verdict: NEEDS REWORK before the measurements are used as promotion gates.** This is a read-only review of the assessment's §§1–5 against the current branch. No evaluation run, provider request, resolver-mode change, code edit, or Phase 1 work was performed. The two bounded runs remain useful as *diagnostic measurements*; the disagreement is with what their current outputs can prove. Owner decisions 1, 3, and 4 remain open.

## Findings by assessment section

### §1 Capability and contract decomposition — AGREE, with two contract corrections

[VERIFIED via `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md` §The strategic problem and `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` §§Executive conclusion, Current affiliation and contact attribution] Separating reviewer relevance (C1), person identity (C2), and institution identity (C3) is necessary; current affiliation and contact ownership remain separate. The 15-row PubMed/Works-first diagnostic compares unlike contracts and cannot gate C3 or C1.

[VERIFIED via `lib/services/reviewer-works-first.js:337-363,382-449`] C2 does consume institution resolution, so changing the institution arm can change person outcomes. The assessment's “ORCID, else OpenAlex author id” description applies to the broader legacy/combined seam, not the current Works-first bind path: Works-first returns `review` when there is no ORCID cluster. [VERIFIED via `lib/services/ror-institution-decision.js:371-386` and `lib/services/ror-institution-identity-resolver.js:63-114`] The ROR *decision* layer can select more than one ROR id for a multi-organization string; the downstream identity bridge returns one hydrated identity or null. Those are distinct output contracts.

**Proposed clarification:** name the C3 decision result, its single-identity bridge, and pair consistency separately. Describe Works-first's currently enforced ORCID requirement precisely. No gate threshold change follows from these wording corrections.

### §2 Reusable benchmarks and proposed runs — DISAGREE with the claimed coverage

[VERIFIED via count of `benchmarks/fuzzy-matching-falsification/cases/*.jsonl`, `benchmarks/fuzzy-matching-falsification/run.js:42-67`, and `versions/v3/results/ror-claim-resolver-2026-08-07-v14.summary.json:1-21`] The suite has 166 cases: 141 institution cases in scope for v3 and 25 other cases skipped. The recorded v3 run reports 141 pass, zero fail/error, and zero wrong automatic resolutions. This is evidence about the benchmark v3 resolver, not a fresh result for the production modules. [VERIFIED via `benchmarks/fuzzy-matching-falsification/adapters-ror.js:89-92,174-206`] The top-level ROR adapter is the `chosen:true` comparator, not the production resolver. The September brief correctly requires a new production adapter.

[VERIFIED via `docs/audits/reviewer-holistic-identity-benchmark-v2.json` parsed case counts and SHA-256, `scripts/evaluate-reviewer-works-first.js:28,44,96-117`] The frozen C2 input has 40 cases, 25 expected binds and 15 abstains; its current hash matches the script's pinned `f815fe270ff1b36db3f76ab5f90803476fccd890e42ab7ffcd0801762cf8e375`. [VERIFIED via read-only `/Users/gallivan/Code/WMKF_Apps/outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v1.json`] The recorded artifact contains 40 `openalex_outage` spine rows and 40 `error: fetch failed` Works-first rows, so its promotion verdict has no performance meaning. The assessment's proposed *single* “current wiring” rerun is underspecified: the script defaults to the incumbent institution arm (`scripts/evaluate-reviewer-works-first.js:64-70`) and has a separate production-ROR arm (`:370-380`). The September brief's **two arm runs** correct this and are needed for a like-for-like C2 comparison.

[VERIFIED via read-only `/Users/gallivan/Code/WMKF_Apps/outputs/s400-institution-checker-probe-findings.md` §S400 production capture and the six-line verdict trace] The five production operands are real, but their labels are four observed false mismatch *pairs* plus one case whose substantive correctness is explicitly uncertain. Calling all five “adjudicated outcomes” overstates the evidence. They are also not just independent affiliation strings: each incident compared a byline with a listed institution. The 14 frozen byline cases are pair-consistency cases (`benchmarks/fuzzy-matching-falsification/cases/institution-byline-normalization.jsonl`; `run.js:42-50`).

**Proposed changes to the measurement plan:** retain the two C2 arm runs; call their outputs diagnostic until the provider-failure check below is reconciled. Separate C3 single-string resolution from pair-consistency evidence. Treat the fifth production pair as unlabeled for correctness rather than scoring it as a proven positive or negative.

### §3 Go/no-go criteria — DISAGREE materially with operationalization

**C2 safety/recall thresholds:** [VERIFIED via `lib/services/reviewer-works-first.js:572-621`] `evaluatePromotion` encodes `falseBinds = 0`, `rightPersonPolicyBinds ≤ spine`, `correctBindGain ≥ 3`, `misses ≤ 8`, and `providerFailures = 0`. I agree that any false bind or provider failure disqualifies a promotion run, and I agree that the two recall thresholds are owner policy rather than newly ratified constants. **But the implementation's `providerFailures` count only inspects `spine` and `works` row reasons** (`:580-588`). The production ROR decision layer converts provider errors to `review` with reason `provider_failure` (`lib/services/ror-institution-decision.js:359-368`); the identity bridge converts that to null (`lib/services/ror-institution-identity-resolver.js:63-75`), and Works-first then reports `claimed_institution_unresolved` (`lib/services/reviewer-works-first.js:337-352`). ROR failure metrics are stored separately in the evaluation artifact (`scripts/evaluate-reviewer-works-first.js:463-466`; resolver metrics at `lib/services/ror-institution-identity-resolver.js:177-189`). Thus **`promotion.gates.providerFailures.pass` can be true even when the ROR arm had provider failures**. A C2 run must be marked void when either row-level failures or `institutionResolverMetrics.providerFailures` is nonzero; the embedded verdict alone cannot establish the stated gate. The evaluation's OpenAlex request metric also explicitly excludes current-spine internal requests (`scripts/evaluate-reviewer-works-first.js:468-472`), so it is not a total-provider-request count.

**C3 safety gates:** I agree with zero wrong automatic resolutions, zero sibling-campus errors, and no veto override as safety requirements. [VERIFIED via `lib/services/ror-institution-decision.js:281-328,330-390`] The production decision layer applies vetoes before score/margin choice. [VERIFIED via `lib/services/ror-institution-identity-resolver.js:63-114`] Its public identity output is a hydrated identity or null, without the decision's outcome, reasons, or candidate evaluations. A comparator using only that output cannot directly establish “zero veto overridden” or distinguish safe review from provider failure. It must observe the production decision contract and its metrics as well as the bridge, without importing the v3 benchmark implementation.

**C3 pair and comparative gates:** [VERIFIED via `benchmarks/fuzzy-matching-falsification/run.js:42-50,70-106`, `benchmarks/fuzzy-matching-falsification/versions/v3/resolver.js:337-375`, and `lib/services/ror-institution-decision.js:390-404`] The frozen suite asks an adapter for `institutionPairConsistent`, while v3 has a relationship-aware `compare` method and the production ROR decision module exports only `resolve`. A wrapper that invents same-id or related-entity pair policy would measure that wrapper, not production ROR pair behavior. [VERIFIED via `lib/services/workbench/enrich-recommended-service.js:217-276,720-731,807-819`] The actual enrichment consumer now composes a legacy and staged **OpenAlex** pair checker; it does not use the ROR identity bridge. The assessment's historical “incumbent resolves ~0” premise and its proposed 1002903 fix are stale for that current consumer. The current staged path is also exercised by request-1002903 fixtures (`tests/unit/institution-pair-segment-comparison.test.js:33-118`). Comparing five raw ROR strings with the historical checker therefore cannot establish “≥ incumbent correct behavior” for today's enrichment flow. A resolution-rate gate needs an explicit denominator and a separately defined single-string oracle; the fifth pair remains unadjudicated.

**Proposed gate change:** keep the C2 numerical thresholds visible but make *all* provider failures a void-run precondition, checked from the relevant artifact metrics. Keep C3 zero-wrong/veto gates; distinguish which can be measured from decision outputs, bridge outputs, and current pair-consumer outputs. Do not call the C3 comparative and five-pair gates pass/fail until the owner defines the target pair policy and labels. This is a measurement-contract correction, not a request to tune code.

**C1:** AGREE with no resolver go/no-go gate. The cited sources do not supply proposal-to-reviewer suitability labels. [ASSUMED] A universal claim that no such labels exist anywhere outside the reviewed sources has not been established; do not infer relevance improvement from C2/C3 results.

### §4 Keep / reshape / stop — DISAGREE with one now-stale work order; AGREE with no tuning

[VERIFIED via `lib/services/reviewer-identity-runtime.js:50-67,110-133` and `lib/services/ror-institution-identity-resolver.js:41-45`] Keeping the request-scoped ROR resolver behind the fail-closed mode seam and retaining frozen artifacts is consistent with source. Source verifies a **legacy default**, not the hidden live Production environment value; this Phase 0 review did not read or change that value. The old PubMed/Works-first panel remains a diagnostic rather than a promotion gate.

[STALE/CONFLICT via `lib/services/workbench/enrich-recommended-service.js:230-276,720-731,807-819` and `lib/services/institution-affiliation-consistency.js:335-369`] The assessment's suggestion to make a small work order for `normalizeAffiliationForComparison`-style core extraction has since been superseded. That approach was attempted and reverted after sibling-institution false clears; the enrichment path now composes legacy with a staged segment checker. Do not revive the old extraction direction based on the August incident alone. I agree with the assessment's **no per-name heuristics, query-cap tuning, provider fallback, combined-score patch, or new search** rule until a frozen gate identifies a mechanism and the owner authorizes work.

### §5 Minimum owner decisions — DISAGREE with the unconditional C3-first recommendation; AGREE that decisions remain with the owner

The owner authorized the two bounded measurements in the September brief, but has not chosen production authority, a C2 recall budget, or a shadow window. C3's v3 falsification result is real; [VERIFIED via `versions/v3/results/ror-claim-resolver-2026-08-07-v14.summary.json` and `lib/services/workbench/enrich-recommended-service.js:273-276`] it does not establish a production ROR pair policy or representative benefit to the current pair consumer. Therefore “C3 first” remains a hypothesis, not a source-backed promotion recommendation. No alternative promotion target or recall/shadow policy is recommended here. The two measurements may inform those owner decisions once the gate-contract issues above are reconciled.

## Contract reconciliation and stop boundary

**Surface:** read-only review of the proposed C2 script run and C3 comparator/replay. **Entry points:** `scripts/evaluate-reviewer-works-first.js` and `benchmarks/fuzzy-matching-falsification/run-comparator.js`. **Persistence:** only planned local JSON/JSONL measurement artifacts; no database or application write. **Consumers:** `evaluatePromotion`, comparator `judge`, the tracked aggregate report, and eventual owner decisions. **Prior finding:** the August assessment's §§1–5. [VERIFIED via `scripts/evaluate-reviewer-works-first.js:494-504` and `benchmarks/fuzzy-matching-falsification/run-comparator.js:34-77`] Both drivers write local artifacts, but neither was run in Phase 0.

The whole-flow audit found the C2 ROR-error-to-null-to-review path and the C3 decision-to-identity-to-pair-policy gap described above. Partial-success audit: an ROR failure can look like an ordinary review row, so the ROR metric must void the C2 run; a C3 comparator error must not be counted as safe abstention (`run.js:150-171`). Async and stale-state audit: no UI state or background task changed in this review. Helper-extraction audit: no shared helper was extracted; pair policy must not be silently supplied by a comparator. Durable-surface and symbol-fan-out audits: no schema, route, enum, or runtime symbol changed. Doc reconciliation is limited to this new review file; historical August documents are left as historical evidence.

**Recommendation evidence:** the requested change is to the *interpretation and preconditions* of the proposed runs, not to runtime code. The prerequisite for a C2 validity claim is an observed zero across row-level and ROR resolver provider-failure metrics; the current `evaluatePromotion` signature cannot see the latter. The prerequisite for a C3 pair gate is a specified, production-equivalent pair policy and settled labels; neither is available from the single-identity bridge. A disconfirming check would show a production ROR pair consumer with an enforceable policy, or an evaluator path that already folds ROR metrics into `providerFailures`; the cited export and call paths did not show either.

**Hard stop after Phase 0.** The gate and run-coverage disagreements are material under the September brief. Reconcile them with the owner before Phase 1; do not treat this review as authorization to edit frozen cases, tune resolvers, or change production authority.
