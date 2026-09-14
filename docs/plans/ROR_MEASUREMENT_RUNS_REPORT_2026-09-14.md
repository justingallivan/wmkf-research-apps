---
title: ROR / Works-first Measurement Runs — Report (2026-09-14)
domain: reviewer-identity
kind: plan
status: complete
summary: "The frozen C2 incumbent and ROR arms both passed their existing gates without provider failures. The production C3 single-string replay selected no wrong ROR IDs, but one selected ID carried a location-conflict veto; the required hard stop left pair and 1002903 gates unmeasured."
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/plans/ROR_MEASUREMENT_RUNS_CODEX_BRIEF_2026-09-14.md
  - docs/plans/ROR_MEASUREMENT_RUNS_CODEX_PHASE0_REVIEW_2026-09-14.md
  - outputs/ror-reviewer-finding-strategic-assessment-2026-08-08.md
  - scripts/evaluate-reviewer-works-first.js
  - benchmarks/fuzzy-matching-falsification/adapters-ror-production.js
  - benchmarks/fuzzy-matching-falsification/baseline/ror-production-2026-09-14.results.jsonl
---

# ROR / Works-first measurement report

The required network probes returned HTTP 200 from the measurement process for both OpenAlex and ROR. The two frozen 40-case C2 arms completed. The C3 production comparator completed its 124 single-string cases; the 17 frozen pair-consistency cases were skipped because the production ROR resolver has no pair policy. **The C3 veto hard gate failed, so the five request-1002903 pairs were not replayed.** No resolver mode, production module, frozen input, or environment value changed.

## C2 — frozen Works-first cases

[VERIFIED via local `outputs/reviewer-holistic-m1/works-first-w2-rerun-2026-09-14-incumbent.json` and `outputs/reviewer-holistic-m1/works-first-w2-rerun-2026-09-14-ror.json`] Both arms evaluated all 40 SHA-pinned cases. Their Works-first and combined scored outcomes were identical case by case; both `promotion.pass` values are `true`. The following are the existing `evaluatePromotion` gates, including the evaluator's added ROR provider-health check:

| Gate | Incumbent | ROR | Verdict |
|---|---:|---:|---|
| False binds = 0 | 0 | 0 | pass / pass |
| Right-person policy binds ≤ spine | 1 ≤ 1 | 1 ≤ 1 | pass / pass |
| Correct-bind gain ≥ 3 | 9 | 9 | pass / pass |
| Misses ≤ 8 | 4 | 4 | pass / pass |
| Provider failures = 0 | 0 | 0 (0 row failures; 0 ROR resolver failures) | pass / pass |

The common spine had 12 correct binds, 3 false binds, 1 right-person policy bind, and 12 misses. Each combined arm had 21 correct binds, 0 false binds, 1 right-person policy bind, and 4 misses. These are identity outcomes, not evidence of reviewer relevance or current-affiliation accuracy. The recall thresholds are encoded gates, not a newly chosen owner policy.

A read-only cross-check found an earlier clean ROR-arm artifact at `/Users/gallivan/Code/WMKF_Apps/outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v2-ror-arm2-2026-08-09.json`: it covered 40 cases and passed its then-current gates with gain 8, 0 false binds, and 4 misses. The August assessment and September brief's premise that the network-failed v1 artifact was the only recorded C2 run was stale. The new same-day comparison is distinct, and its ROR provider-failure gate includes the later evaluator correction.

The evaluator recorded 180 OpenAlex calls for the incumbent Works-first/scoring scope and 137 for the ROR arm's same scope. The latter additionally recorded 31 ROR HTTP requests and 21 OpenAlex institution-bridge attempts, with zero ROR provider failures, zero ROR timeouts, and zero bridge failures. The evaluator explicitly excludes current-spine internal OpenAlex requests from its call metric; bridge attempts are not an exact HTTP request count because retries are not separately metered. It does not record wall time, so exact C2 durations and total provider HTTP requests are **not measurable** from the artifacts. The local row-level files remain untracked and are not quoted here.

## C3 — production ROR single-string replay

[VERIFIED via `benchmarks/fuzzy-matching-falsification/baseline/ror-production-2026-09-14.results.jsonl`, the frozen v3 result's `expected_v2` ROR-ID oracle, and `lib/services/ror-institution-decision.js`] The new adapter calls the production candidate-union, veto-first decision, and identity-bridge modules. The frozen comparator judged 115/124 single-string cases pass and 9 fail, with 0 errors; 17 institution pair cases and 25 other-capability cases were skipped. All nine failures are exact `target.name` differences from the OpenAlex-hydrated display name. All 58 automatic decisions selected their frozen expected ROR IDs; 66 decisions requested review. The bridge hydrated 57 identities; the remaining resolved decision selected multiple ROR IDs and has no single-identity bridge output. The comparator's 9 name failures therefore do not establish 9 wrong automatic resolutions.

| Assessment §3 gate | Observed | Verdict |
|---|---|---|
| Wrong automatic resolutions on frozen suite = 0 | 0/58 resolved single-string decisions selected a wrong or forbidden ROR ID | pass for the 124 measured single-string cases; 17 pair cases not measurable |
| Sibling-campus errors = 0 | 0/60 sibling challenge cases failed; all 60 requested review | pass for measured single-string cases |
| No veto override (assessment cites score/rank) | 1 selected ID carried a `location_conflict` veto after parent canonicalization: `inst-uc-109-system-uop` | **fail** |
| Five 1002903 pairs ≥ incumbent correct behavior, no new wrong resolution | 0/5 replayed after the veto hard-gate failure; the fifth pair's substantive label is unsettled | not measurable |
| Decorated/real-shaped resolution rate ≥ incumbent | Production resolved 58/124 frozen single strings versus 18/124 for the historical incumbent, but the frozen pair cases and real bylines were not scored against a production pair policy | not measurable for the stated input class |
| Provider error/timeout profile within ROR burst bound | 119 ROR HTTP requests in 55 seconds, 0 errors and 0 timeouts; 57 OpenAlex bridge attempts, 0 bridge failures | pass for the measured replay |

The nine exact-name comparator failures are `inst-hier-005`, `inst-uc-010-ucsd-official`, `inst-uc-011-ucsd-short`, `inst-uc-012-ucsd-acronym`, `inst-uc-013-ucsd-punct`, `inst-uc-014-ucsd-byline`, `inst-uc-109-system-uop`, `inst-uc-110-system-word`, and `inst-uc-118-distractor-california-state-univers`. Each selected the frozen expected ROR ID. The one hard-gate failure is `inst-uc-109-system-uop`: a direct production decision recheck returned `parent_scope_canonicalized` and a selected evaluation with `location_conflict`. This is a veto-policy failure even though the selected ID matches the frozen oracle. No tuning or patch is included in this measurement branch.

For context, the frozen benchmark v3 result recorded 141/141 institution cases passing, and the historical incumbent baseline resolved 18/124 single-string cases. This production replay does not establish pair behavior or a resolution-rate advantage on the five real pairs. C1 has no resolver go/no-go gate or relevance labels in these measurements. Owner decisions about promotion target, recall budget, and shadow window remain open.

## Changed-fact document check

The authoritative measurement sources are the two local C2 artifacts, the tracked C3 result, the frozen v3 oracle, and the production decision source. The C2 evaluator and C3 comparator produced read-only artifacts; the report is their aggregate consumer. A focused `/sweep` search across live docs, wiki, memory, and session guidance corrected the Phase 0 review's missed August C2 run. The dated assessment and execution brief retain their historical claims under their original dates. Current `docs/SERVICE_AND_UTILITY_CATALOG.md` and `docs/agent-wiki/topics/reviewer-identity.md` still describe hard vetoes as non-overridable or always preceding selection; the measured parent-canonicalization case disproves that blanket assurance. Those files are outside this brief's allowed edit surfaces. **Document reconciliation is incomplete for those two current restatements.** No production-authority claim was tested here.
