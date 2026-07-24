---
title: Current Work Queue
domain: architecture
kind: source-of-truth
status: canonical
summary: Canonical priority queue separating current commitments, evidence windows, optional work, external dependencies, and parked programs.
canonical: true
cataloged: 2026-07-22
last_verified: 2026-07-24
owner: product-engineering
related:
  - docs/SYSTEM_MODEL.md
  - docs/STRATEGY.md
  - docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md
  - docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md
---

# Current Work Queue

This document owns **work priority**, not runtime truth. Source, the Application State Atlas,
live probes, and current tests own what the system does. `docs/DOCS_CATALOG.md` inventories
documents; an `active` catalog status means the document remains useful, not that every task in
it is approved backlog.

## Current sequence

Work these items in order unless an operational incident or explicit owner decision changes the
sequence.

| Order | Work | Current boundary | Completion decision |
| --- | --- | --- | --- |
| 1 | Reviewer reliability evidence design | Structured staff review entry and post-accept terminal statuses (`withdrew` vs `released`) are live in production. The next allowed step is a read-only probe of whether Dynamics email activities can serve as durable, ordered materials-dispatch evidence. Completed-review payability remains a separate feature; keep pre-accept reset separate from both terminal status and post-accept financial annotation. | Owner-reviewed evidence design before any schema or metric build. |
| 2 | Reviewer campaign evidence window | Keep the legacy resolver authoritative during the upcoming run. Record W2 shadow disagreements, wrong/missed identity outcomes, email confirmation, staff corrections, invitations, and review completion. | Post-run evidence review; no automatic cutover. |
| 3 | Optional reviewer UX triage | Select only improvements supported by observed staff friction. Current candidates: campaign-settings discoverability/defaults, review-output formatting, and global reviewer notes/flags or a Reviewer Pool. | Separate owner choice for each item; absence from this selection means no build. |

## Completed in this execution

- Documentation ground-truth reconciliation: merged to `main` on 2026-07-22; this queue is the
  priority authority and the documentation gates were green.
- Dataverse target/write interlock: positive warn-mode production observation, explicit owner
  approval, staged local/Preview/Production flip, and signed-in post-flip Workbench smoke completed
  2026-07-22. Production logged `mode=on deployment=production target=production` and no denial.
- Structured staff review-entry rescue: complete live-question/rich-text UI, dedicated authenticated
  route/service, canonical full-review producer, ETag/version guards, and atomic parent/answer writes
  shipped through PR #75 / merge `0226f7eb` to production deployment
  `dpl_BjkM3tjopMpRWPMwn3NRgtB4CHSU` on 2026-07-22. All PR checks passed; Vercel reported Ready,
  the unauthenticated route smoke redirected to sign-in, and the post-deploy error scan was clean.
- Reviewer terminal statuses: `withdrew` and `released` shipped through PR #78 plus the accepted/null
  repair in PR #79 / merge `fd610837` on 2026-07-24. Production Dataverse and Workbench readback
  verified `Withdrew`, token revoked, accepted preserved, and no review-received/completed timestamp.
  Deadline evidence and completed-review payability remain separate.

## Reviewer redesign gates

The reviewer redesign is an active **measured program**, not authorization for continuous tuning.

- W2 `combined` mode remains owner-gated. Shadow output never changes the authoritative result.
- Wave 13 action-policy reader/backfill/send enforcement remains a separate migration.
- The applicant-neighborhood finding arm remains evaluation-only under `scripts/`; production
  assignment and attribution require an explicit pilot decision.
- Do not delete legacy readers, Track B, or old heuristics until the applicable promotion decision
  and one complete campaign of observation.

## External or dependency-bound work

These are valid directions but are not current app-team delivery commitments:

- Power Automate Executor parity and status-driven backend automation — Connor-owned and dependent
  on grant-cycle sequencing.
- Group B writeup spine and related dashboard automation — blocked on the documented Dataverse and
  Power Automate inputs.
- Proposal-context extraction and staged-pipeline evolution — later-cycle work, not part of the
  current reviewer campaign.

## Parked — do not resurface without a new decision

- Applicant intake product build — parked while WMKF evaluates the GOApply re-engineering.
- Automated BILL onboarding — tabled, possibly permanently; honorarium payment remains an offline
  operations process.
- Whack-a-mole remediation workstreams — independent review returned `NEEDS REWORK`; owner
  reconciliation is required before execution.
- Reviewer institution-to-CRM linking/typeahead — parked pending Connor/Sarah account cleanup.
- Destructive reviewer cleanup — gated by promotion plus one full campaign.

## Completed implementation records — not backlog

Plans describing the Workbench build, Postgres-to-Dataverse reviewer migration, staff-editable
review questions, reviewer search timeout controls, service decompositions, route/service
consolidation, OData/chunk consolidation, prompt migrations, grantee portal construction, and
honorarium portal construction are implementation history or current operating references. They do
not become current work merely because their document status remains `active`.

## Queue maintenance rule

When priority changes, update this file, `docs/STRATEGY.md`, the strategy wiki router, and the
current `SESSION_PROMPT.md` in the same reconciliation pass. Detailed implementation plans may
remain where they are; link them from the queue instead of duplicating their contracts here.
