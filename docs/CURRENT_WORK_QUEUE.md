---
title: Current Work Queue
domain: architecture
kind: source-of-truth
status: canonical
summary: Canonical priority queue separating current commitments, evidence windows, optional work, external dependencies, and parked programs.
canonical: true
cataloged: 2026-07-22
last_verified: 2026-07-26
owner: product-engineering
related:
  - docs/SYSTEM_MODEL.md
  - docs/STRATEGY.md
  - docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md
  - docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
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
| 1 | Production review-synthesis smoke | Use Request `1002788` and a deliberate staff-triggered Generate/Regenerate action. Verify valid structured output, Dataverse persistence, reload visibility, overwrite behavior, and clean logs. Do not add automatic triggering during the smoke. | All smoke criteria in `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` pass, or a bounded diagnosis is recorded with no partial write. |
| 2 | Reviews/synthesis contract closure | Fix the incomplete-JSON reliability gate; define the participating-invitation set; implement automatic all-in readiness, explicit manual early-run, stored-output visibility, and observable regeneration. | Owner-approved state machine plus tested producer → persistence → consumer contract. |
| 3 | Remaining lifecycle design freeze | Calendar the fixed deadlines and define the full contract for Pre Site Visit Writeup, Site Visit, Final Writeup, and Initial Writeup. Existing June assumptions are inputs, not decisions. | Each tab has approved user, inputs, producer, persistence, consumer, access, recovery, and deadline. |
| 4 | First deadline-bound writeup slice | Default candidate is Pre Site Visit Writeup, but only after the calendar and input/artifact contracts are approved. | One request produces a durable, editable Word artifact and visible Workbench state through a production smoke. |

## Completed in this execution

- Evidence-first sweep correction and bounded Workbench truth pass: the sweep now derives truth before
  searching prose, supports domain audits, requires producer→persistence→consumer evidence, and
  records supported/falsified claims. The scalar fact gate now derives Workbench tab counts and
  cannot be bypassed with Markdown-bold/code-wrapped numbers. That pass retired the stale forward
  roadmap and established the six-live/four-placeholder state, but it did not fully reconcile the
  Reviewer/Reviews corpus; the 2026-07-26 [repository-wide material-claim
  audit](audits/AUDIT_FULL_DOCUMENTATION_TRUTH_2026-07-26.md) records the
  remaining contradictions and probe requirements.
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
  That is the historical production baseline. Merge `70f51f45`, production-live in deployment
  `dpl_9r2FYkAXhRqSXiJVCwevrXFZ5SzH` on 2026-07-24, changes PD-recorded `Withdrew`
  to the full withdrawal contract: accepted false, declined true, token revoked, exact linked
  honorarium deleted, and acceptance follow-up cancelled. Deadline evidence and completed-review
  payability remain separate.

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
- Power Automate-backed writeup automation remains dependency-bound. The former Group B document
  is historical; the app-side writeup contract must be redesigned from current fields, prompts,
  inputs, and deadlines before any build.
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
