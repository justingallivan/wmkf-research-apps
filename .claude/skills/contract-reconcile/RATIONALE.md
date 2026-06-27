# Contract Reconcile Rationale

This sidecar preserves the history behind `/contract-reconcile` without placing
that history in the normal skill prompt.

The skill was added after repeated verification-shape gaps: treating a
headline, grep hit, or plan claim as the whole file; fixing one flagged line
while leaving the same fact stale elsewhere; treating planned state as built
state; changing one layer without tracing caller, persistence, response, UI,
docs, and gates; treating partial success as total success; adding async work
without stale-generation guards; and extracting shared helpers that collapsed
important semantic differences.

Active instruction belongs in `SKILL.md`. Incident history belongs here.
