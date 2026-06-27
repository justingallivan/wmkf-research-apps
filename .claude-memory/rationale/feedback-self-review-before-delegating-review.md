# feedback-self-review-before-delegating-review Rationale

This sidecar preserves the incident history behind the active memory without
placing that history in the normal recall rule.

The rule was added after multi-slice reviews repeatedly found issues that were
discoverable before delegation: sibling guards, trust-boundary gaps, lifecycle
edges, provenance gaps, and cross-layer failure-path mismatches. The effective
correction is to perform those traces before delegating and include the evidence
in the review prompt.
