---
name: project-reviewer-self-report-orcid-sticky-confirmed
description: Reviewer self-reported ORCID capture plus C0.2 persistence containment; automated confirmed decisions are capped at probable at the adapter boundary.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-10-22 via branch-source researcher.js and three automated callers; no fresh deployment probe
---

## Recall Rule

Read this when touching reviewer self-reported ORCID capture, resolver status
semantics, or `writeIdentityDecision`/`clearIdentityFields`.

`confirmed` is the transitional persisted sentinel for reviewer self-report.
The resolver may still produce an automated decision labeled `confirmed`, so
confidence alone is not provenance. The adapter boundary enforces provenance:

- `writeIdentityDecision` requires server-only `identityOrigin`.
- Only `self_report` with incoming `confirmed` may persist `confirmed` and it
  intentionally does not pre-read; a fresh reviewer attestation wins.
- Every runtime resolver writer and identity backfill uses `automated`.
- Automated incoming `confirmed` is cloned and downgraded to `probable`; the
  caller's decision object is not mutated.
- Every automated `writeIdentityDecision` first reads current status and anchors, skips stored
  `confirmed`, and propagates read failure without writing. Stored `probable`
  cannot become `unresolved`/`ambiguous`; a probable refresh requires nonempty,
  overlapping stored/incoming anchors.
- A permitted automated `writeIdentityDecision` requires the current person ETag and passes it as
  `ifMatch`; missing versions fail before mutation and conflicts require a fresh read.
- `clearIdentityFields` accepts only `automated`, reads current status, and
  deliberately abstains for every stored state. Read failures propagate; missing
  same-binding field lineage never authorizes a blanket clear.
- Missing or unknown origins fail before any Dataverse read or write.

The marker is adapter-only and must not enter UI or resolver DTOs. It is
containment, not the durable model: legacy `confirmed` rows do not encode their
source. Conditional automated writes do not supply the missing per-field lineage;
keep that limitation distinct from ETag concurrency protection. The broader
versioned-binding work is tracked in the reviewer holistic plan.

The contracts above remain scoped to `writeIdentityDecision` and
`clearIdentityFields`. Separately, the current branch routes the three
automated enrichment callers through `upsertByPotentialReviewer`'s combined
field/decision ETag write. For stored `confirmed`/`probable` rows, it requires
valid overlapping person identifiers and a match to the initially observed
stored email before writing any enrichment field or timestamp; it recomputes
both checks after a 412 reread. Confirmed decision metadata remains unchanged
on a compatible enrichment, while compatible probable refreshes retain the
existing downgrade/cap rules. Save-candidates passes resolver identity only for
a verified, identity-bound receipt. The identity parser for this automated
guard is separate from the legacy `writeIdentityDecision` anchor semantics.
These are branch-source changes only; no deployment is asserted. The
2026-10-22 audit accurately described the earlier ordering gap and possible
contract gap at the time, not observed corruption or a proven exploit:
`docs/audits/identity-coi-referral-provenance-audit-2026-10-22.md`.

This repair does not activate the separate Wave 13 versioned lineage writer
for automated resolver enrichment. The acceptance-drain self-report binding
path remains distinct and must not be collapsed into the resolver
decision-metadata contract above.

Reviewer self-report capture in the acceptance drain also has a distinct
versioned binding path through `reviewer-identity-binding-writer.js`; do not
collapse that path into the resolver decision-metadata contract above.

## Historical containment

C0.2 was promoted July 12 at `e5ed38db`, with deployment READY and a clean
error scan recorded then. That first guard was read-then-write without an
ETag-bound update and protected confirmed rows from clears. July 29 hardening
(`676909500`) added the protections described above. These historical deployment
observations are not a fresh statement about serving state.

Ground truth: `lib/dataverse/adapters/researcher.js`,
`lib/services/capture-self-reported-orcid.js`, all direct mutation callers,
`tests/unit/researcher-identity-confirmed-sticky.test.js`, and
`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` C0.2.
