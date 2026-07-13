---
name: project-reviewer-self-report-orcid-sticky-confirmed
description: Reviewer self-reported ORCID capture plus C0.2 persistence containment; automated confirmed decisions are capped at probable at the adapter boundary.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-12 — C0.2 implemented on its Tier-2 branch; automated confirmed decisions are downgraded before persistence; promotion pending.
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
- Every automated write first reads current status, skips stored `confirmed`,
  and propagates read failure without writing.
- `clearIdentityFields` accepts only `automated`, reads current status, skips
  stored `confirmed`, and propagates read failure without clearing.
- Missing or unknown origins fail before any Dataverse read or write.

The marker is adapter-only and must not enter UI or resolver DTOs. It is
containment, not the durable model: legacy `confirmed` rows do not encode their
source, and the automated guard is read-then-write rather than an atomic
conditional update. The reviewer holistic plan's I1 phase replaces it with a
versioned binding source and coherent transition writer.

Ground truth: `lib/dataverse/adapters/researcher.js`,
`lib/services/capture-self-reported-orcid.js`, all direct mutation callers,
`tests/unit/researcher-identity-confirmed-sticky.test.js`, and
`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` C0.2.
