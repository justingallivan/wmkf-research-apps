# Source-aware institution affiliation Stage 1 shadow evaluation

Generated: 2026-08-19T14:16:05.771Z

Verdict: **GO_FOR_SHADOW_CONTRACT**

Status: **shadow only; no production caller, selectability rule, or durable write consumes this result.**

## Headline

- Source-complete cases: **25/25**
- Relationship matches: **25/25**
- Consumer-action matches: **25/25**
- Sibling entity collapses: **0**
- Unsafe action clears: **0**
- Manufactured reviews: **0**
- Provider-failure copy checks: **1/1**
- Held cases with a remedy: **5/5**
- Challenged regressions nonblocking: **3/3**
- Live-capture provider failures: **0**
- Old-label revisions: **5/16**

## Slice denominators

Relationships: same=10, parent_child=3, distinct=6, related_other=2, sibling=2, unresolved=2.

Evidence contexts: compatible_with_additional=2, compatible=11, historical_difference=4, historical_related=2, current_conflict=4, unresolved=2.

## Case results

| Case | Adjudicated relationship → action | Shadow relationship → action | Result |
|---|---|---|---|
| source25-83ce8914d857 | same → allow_if_other_identity_gates_pass | same (compatible_with_additional) → allow_if_other_identity_gates_pass | match |
| source25-97d16b3bdc69 | same → allow_if_other_identity_gates_pass | same (compatible) → allow_if_other_identity_gates_pass | match |
| source25-24810991224e | parent_child → allow_if_other_identity_gates_pass | parent_child (compatible) → allow_if_other_identity_gates_pass | match |
| source25-f9b213526332 | parent_child → allow_if_other_identity_gates_pass | parent_child (compatible) → allow_if_other_identity_gates_pass | match |
| source25-a84e6c6e46e5 | same → allow_if_other_identity_gates_pass | same (compatible) → allow_if_other_identity_gates_pass | match |
| source25-d70586a585f6 | same → allow_if_other_identity_gates_pass | same (compatible) → allow_if_other_identity_gates_pass | match |
| source25-30ef5475b6e0 | parent_child → allow_if_other_identity_gates_pass | parent_child (compatible) → allow_if_other_identity_gates_pass | match |
| source25-5c277235d507 | same → allow_if_other_identity_gates_pass | same (compatible) → allow_if_other_identity_gates_pass | match |
| source25-69090881d690 | same → allow_if_other_identity_gates_pass | same (compatible) → allow_if_other_identity_gates_pass | match |
| source25-365d3af38651 | same → allow_if_other_identity_gates_pass | same (compatible) → allow_if_other_identity_gates_pass | match |
| source25-a6e6bd5c0fab | same → allow_if_other_identity_gates_pass | same (compatible) → allow_if_other_identity_gates_pass | match |
| source25-888808befc3f | distinct → allow_if_other_identity_gates_pass | distinct (historical_difference) → allow_if_other_identity_gates_pass | match |
| source25-9eb2d6bb6876 | distinct → allow_if_other_identity_gates_pass | distinct (historical_difference) → allow_if_other_identity_gates_pass | match |
| source25-2569b1946dd0 | related_other → allow_if_other_identity_gates_pass | related_other (historical_related) → allow_if_other_identity_gates_pass | match |
| source25-0e43e7bca20d | distinct → allow_if_other_identity_gates_pass | distinct (historical_difference) → allow_if_other_identity_gates_pass | match |
| source25-ucla-ucsd-current | sibling → hold_for_identity_or_institution_correction | sibling (current_conflict) → hold_for_identity_or_institution_correction | match |
| source25-ucb-ucla-current | sibling → hold_for_identity_or_institution_correction | sibling (current_conflict) → hold_for_identity_or_institution_correction | match |
| source25-columbia-nyu-current | distinct → hold_for_identity_or_institution_correction | distinct (current_conflict) → hold_for_identity_or_institution_correction | match |
| source25-vumc-vanderbilt | related_other → allow_if_other_identity_gates_pass | related_other (historical_related) → allow_if_other_identity_gates_pass | match |
| source25-baylor-cmu-current | distinct → hold_for_identity_or_institution_correction | distinct (current_conflict) → hold_for_identity_or_institution_correction | match |
| source25-genentech-mit-history | distinct → allow_if_other_identity_gates_pass | distinct (historical_difference) → allow_if_other_identity_gates_pass | match |
| source25-fred-hutch-hhmi-additional | same → allow_if_other_identity_gates_pass | same (compatible_with_additional) → allow_if_other_identity_gates_pass | match |
| source25-epfl-decoration | same → allow_if_other_identity_gates_pass | same (compatible) → allow_if_other_identity_gates_pass | match |
| source25-provider-failure-neutral | unresolved → allow_if_other_identity_gates_pass | unresolved (unresolved) → allow_if_other_identity_gates_pass | match |
| source25-ambiguous-parent-hold | unresolved → hold_for_independent_identity | unresolved (unresolved) → hold_for_independent_identity | match |

## Promotion boundary

- The benchmark independent-identity input is an explicit counterfactual policy input, not a production runtime authority receipt.
- The live roster retains a machine-verifiable non-affiliation identity breakdown for only a small subset of current mismatch rows; Stage 3 remains blocked until that execution-point contract exists.
- Publication observation dates are null where the legacy production capture did not retain an exact work reference; currentness is explicitly historical rather than inferred as current.

Passing this artifact permits continued shadow evaluation only. It does not authorize Stage 2 UI behavior or Stage 3 identity/selectability/write authority.
