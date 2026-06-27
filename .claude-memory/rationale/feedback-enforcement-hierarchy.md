# feedback-enforcement-hierarchy Rationale

This sidecar preserves the incident history behind the active memory without
placing that history in the normal recall rule.

The rule was added after an inferred stored claim passed green gates because no
gate compared it to source. Advisory hooks had already supplied useful friction,
but friction depended on the same judgment path it was meant to constrain. The
durable correction is to derive claims from source where possible, or gate them
against source in CI when they must be stored.
