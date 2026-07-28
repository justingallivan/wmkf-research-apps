---
title: Current Work Queue
domain: architecture
kind: source-of-truth
status: canonical
summary: Canonical priority queue separating current commitments, evidence windows, optional work, external dependencies, and parked programs.
canonical: true
cataloged: 2026-07-22
last_verified: 2026-07-28
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
| 1 | Remaining lifecycle design freeze | Calendar the fixed deadlines and finish the contracts for Pre Site Visit Writeup, Site Visit, Final Writeup, J27 Initial Assessment, and the cycle-wide Editor Dashboard that preserves Allison's single-list editing workflow. SharePoint Word is the decided narrative authority; Dataverse is the typed registry/workflow authority. Exact schema, document topology, target-library protection settings, remaining stage inputs, dashboard audience/access, and Reviewed-marker granularity are still open. | Each tab has approved user, inputs, producer, persistence, consumer, search, access, version/recovery/retention, milestone, and deadline contracts; the Editor Dashboard has an approved audience, minimum list/filter/direct-edit view, progress-marker contract, and deadline. |
| 2 | First deadline-bound writeup slice | Default candidate is Pre Site Visit Writeup, but only after the calendar and input/artifact contracts are approved. | One request produces a durable, searchable, editable and recoverable Word artifact, a protected milestone snapshot, and visible Workbench state through a production smoke. |

## Audit follow-ups — verified open, not silently prioritized

- **Retired-table operational scripts:** 25 non-archive scripts mention the
  dropped `reviewer_suggestions` table. `scripts/README.md` now blocks the
  copy-pasteable commands, but code quarantine/removal requires an owner-approved
  scope and caller review.
- **Live-state reconciliation:** environment posture, mutable row counts, external
  automation, and genuine external-reviewer use remain probe-required. The
  repository-wide material-claim audit is partial reconciliation, not a clean
  bill of health.

## Completed in this execution

- Review-synthesis lifecycle rollout: signed-in read-only verification passed;
  Production automation was deliberately enabled; and the controlled Request
  `1002788` smoke completed job `2`, maintenance run `27723`, and prompt-v3 AI
  run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` in one claim. Exact cleanup
  removed 11 temporary answers, restored four parent fields, left no draft, and
  returned the census to 157 participant rows / 25 requests / zero eligible.
  PR #98 fixed the automatic run-source defect found before the first attempt's
  LLM boundary; PR #99 moved claimed-job readiness revalidation before content
  loading. Final deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready with
  automation enabled; the post-deploy zero-eligible drain was clean.
- Auth-status policy reconciliation: `/api/auth/status` remains intentionally
  public with the exact `{ enabled: boolean }` shape, but now delegates to the
  same fail-closed `isAuthRequired()` policy used by the proxy and API guards.
  Production-mode misconfiguration therefore reports enforcement enabled; the
  explicit emergency bypass must permit the base kill-switch/configuration
  predicate before the endpoint reports disabled. The endpoint policy matrix
  is covered by a focused regression suite.
- Review-synthesis reliability implementation and deployment: the Executor now parses
  complete normalized text, requires `end_turn` before persistence, preserves
  safe stop/token/hash diagnostics on failure, and capability-gates native JSON
  schema. Review synthesis retries only a confirmed `max_tokens` result once,
  at a bounded larger budget; each invocation remains separately audited.
  Focused and surrounding Executor/service suites passed 102 tests, and the
  model-registry gate plus self-test passed. The code merged through PR #92 as
  `ab1d2943` and reached a Ready production deployment on 2026-07-28.
  Governed prompt v3
  (`660d7e3f-9e8a-f111-ab0f-000d3a31c468`) was then published through the
  version-preserving seed recovery path and verified as the sole current row
  with exact tracked system/body/variables/schema/model/settings. The
  2026-07-28 controlled Request `1002788` smoke completed on the first semantic
  attempt (`end_turn`), persisted a valid synthesis, and wrote completed AI run
  `20aec518-9f8a-f111-ab0f-6045bd018deb` against prompt version 3. The 11
  synthetic answers and four staged parent fields were atomically restored;
  the new synthesis and append-only audit remain as the intended proof.
  Independent follow-up review returned READY after the requested local changes.
- Production review-synthesis smoke: the owner-authorized Request `1002788`
  smoke ran once on 2026-07-27 after a reversible staff Manual Review Entry.
  It reproduced the current-v2 incomplete-JSON failure as HTTP 500 and failed
  AI run `be61f383-f289-f111-ab0f-70a8a59cded0`. The original 1,709-character
  memo retained SHA-256 `a91f05cc0a20cad72341db9d7fc5fe808ed3b28610a35dfdaca82d69beebbcba`
  and its prior modified timestamp; no partial synthesis write occurred. The
  11 synthetic answers and four staged parent fields were atomically restored,
  with no draft and no changes to other target/sibling email, reminder,
  materials, or thank-you state. The append-only failed audit row remains.
  This bounded failure supplied the diagnosis baseline for the successful
  governed-v3 proof recorded immediately above.
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
  on grant-cycle sequencing. The 2026-07-27 production metadata probe found no
  deployed prompt-Executor flow among the 114 visible cloud-flow definitions;
  this is planned external work, not an active production pipeline.
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
