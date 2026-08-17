---
title: Current Work Queue
domain: architecture
kind: source-of-truth
status: canonical
summary: Canonical priority queue separating current commitments, evidence windows, optional work, external dependencies, and parked programs.
canonical: true
cataloged: 2026-07-22
last_verified: 2026-08-16
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
| 1 | Close the remaining Initial Assessment pilot gates | **[VERIFIED IN SOURCE 2026-08-16]** Initial Assessment and Field Primer now require the exact active `AI Materials/ProposalNarrative_{Request#}.pdf`; a read-only live Request `1002788` extraction returned non-empty text. No governed artifact was generated from that new source in this change. Earlier Requests `1002788` and `1003109` remain production evidence for artifact mechanics, lineage, exact-input reuse, interrupted-finalization recovery, and attributed editing, but their older Phase I/Reviewer Materials inputs are superseded. Both artifact consumers still resolve the same stable item. Graph-current metadata display is live; a disposable production-library probe also proved previous-version inspection/restore and signed-in first-stage recycle recovery. Before declaring the pilot gate complete, obtain administrator evidence for version limits, second-stage recovery, Purview retention, and editor least privilege, then implement Workbench administrator restore and milestone snapshots. **Connor replied 2026-08-10 (S413) and the evidence is still not closed:** major versioning confirmed on but the configured limit unanswered; no second-stage recycle bin reported (unusual for SharePoint Online — confirm with a site-collection admin before relying on it); Purview unanswered and rerouted to an M365 compliance admin; site members' "limited control" is not a built-in permission level, so editor delete rights are unresolved. See `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` item 5. | Current metadata, native version restore, and first-stage recovery are proven; administrator policy/access evidence and product history/milestone controls are recorded or completed. |
| 2 | First deadline-bound writeup slice | **[VERIFIED LOCALLY 2026-08-17; historical single-source live evidence 2026-08-16]** The Workbench Pre Site Visit integration has an interim local-download path: it now requires the exact separate AI Materials narrative and bibliography, supplies both to Claude as bounded labeled inputs, records both identities/versions/hashes in its result, adds authoritative Dataverse metadata, renders the tracked Word template, and returns the DOCX without a SharePoint or registry write. Dataverse sole-current prompt v3 `f2c9ce97-f499-f111-b8db-7ced8d6e2f44` remains the prior single-source contract on reviewed `claude-sonnet-4-6`; publish a new immutable two-input prompt version before promoting this code. The latest audited Executor invocation against Request `1002379` remains accepted v2 run `5bd65180-ed99-f111-b8db-7ced8d6e2f44`; no live bibliography probe or two-input Claude run exists. A separate direct exact-v3 model/render QA correctly underlined the two Dataverse roster names and met the 145-word personnel target, but the 574-word Background/Methodology pair spilled its final sentence to page 4; it intentionally created no `wmkf_ai_run`. The earlier v1 run completed at the model boundary but was rejected during render QA for page overflow and remains append-only history. The integration branch is not deployed, the signed-in Workbench route has not been production-smoked, and no SharePoint artifact, registry row, request pointer, or business field was written. The durable governed-artifact reuse still waits on the remaining library/readback gate above. | Have Connor supply both exact AI Materials files; publish the reviewed two-input prompt as a new immutable version; then promote the direct-download slice deliberately and prove the signed-in Workbench download for a dedicated request. Tighten the soft one-page target only if the owner wants to eliminate the observed spill. The later durable milestone remains a searchable, editable, recoverable Word artifact with complete prompt/run/request lineage and verified human review; the full Editor Dashboard contract remains later reuse. |

## Audit follow-ups — verified open, not silently prioritized

- **Retired-table operational scripts:** 25 non-archive scripts mention the
  dropped `reviewer_suggestions` table. `scripts/README.md` now blocks the
  copy-pasteable commands, but code quarantine/removal requires an owner-approved
  scope and caller review.
- **Live-state reconciliation:** environment posture, mutable row counts, external
  automation, and genuine external-reviewer use remain probe-required. The
  repository-wide material-claim audit is partial reconciliation, not a clean
  bill of health.
- **Phantom co-PI on seven requests — NOT REMEDIATED (S422, 2026-08-12).** One
  duplicate contact carrying the placeholder email `_@_._`
  (`2a67a272-9eb5-f011-bbd3-6045bd0510d4`) sits in a co-PI slot on requests
  `1002132`, `1002262`, `1002363`, `1002367`, `1002865`, `1002880`, `1003053`,
  and in the matching `wmkf_apprequestperson` junction rows. **Nothing has been
  executed** — `scripts/remediate-placeholder-copi.js` has only ever been run
  `--dry-run`; all 14 rows are still live in production. No application code is
  at fault. Only `1002132` reached an awardee (grantee portal, 2026-08-12); the
  owner reports the other six were not awarded, so no further abstract requests
  are expected and the exposure risk is contained but the CRM data stays wrong.
  Root cause is the akoyaGO import and is **Connor's to fix** — until then new
  requests keep acquiring the phantom. **Seven is a floor, not a ceiling**
  `[VERIFIED for email exactly `_@_._`; other placeholder shapes UNTESTED]` — the
  sweep matched that one literal, so `x@x.com`/blank/`noemail@…` variants would
  not have appeared. Widen the pattern before anyone calls this cleanup complete.
  Full record with slot/junction ids: `outputs/phantom-copi-incident-2026-08-12.md`.

## Completed in this execution

- Initial Assessment substantive human edit: Request `1003109`'s canonical
  SharePoint item advanced to version `2.0`, attributed to Justin Gallivan.
  Foundation Opportunity now contains staff-authored content and no
  `STAFF INPUT REQUIRED` marker. The per-request Workbench and D26 locator
  still open the same stable item. The edit also verified that the current
  Dataverse registry retains upload-time version `1.0` metadata. Response-only
  Graph-current refresh and consumer display are deployed and live-verified on
  Request `1003109` via deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`;
  native version inspection/restore and first-stage recycle recovery also
  passed in the production Request library. Library-limit, second-stage,
  retention, editor-permission, Workbench history/admin-restore, and milestone
  controls remain in the open library/readback gate.

- Initial Assessment interrupted-finalization recovery: Request `1003109`
  was staged as Failed after its SharePoint upload and retried through the
  signed-in Workbench. Recovery restored the same registry row and request
  pointer while preserving the single AI run and SharePoint item/version;
  attempt count advanced to `2`, with no second model call, upload, overwrite,
  duplicate, or cleanup work. Runtime logs again used the service-principal
  fallback for Dataverse registry writes. The owner accepts application
  attribution for system-generated registry changes; native SharePoint
  version attribution remains the required human-edit audit surface.

- Initial Assessment controlled-production rehearsal: Request `1002788`
  generated registry row `fb995f0f-628c-f111-ab0f-6045bd018a07`, the matching
  request pointer, completed AI run
  `b7ae9b17-628c-f111-ab0f-000d3a31c468`, and canonical SharePoint item
  `01G4GVMS77A2SBVPGA4VFINZFWAFIZGVFG`. Both Workbench consumers opened the
  same item, and a same-input retry preserved the one row/run/item with no new
  attempt. This is valid mechanics evidence only: the loaded document was an
  old Phase I proposal, so the generated content is not valid Phase II
  semantic evidence. The rehearsal also exposed the recovery hash mismatch and
  null AI-run request lookup recorded in
  [the pilot report](INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md).

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
- Excluded-reviewers structured intake (`docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md`,
  S398) — schema contract drafted; repo-side Phases A/B (Dataverse wave + backend consumption)
  are buildable on owner go, but final field names and the form work wait on the Justin×Connor
  reconciliation meeting (agenda in the plan §6).

## Parked — do not resurface without a new decision

- Applicant intake product build — parked while WMKF evaluates the GOApply
  re-engineering. The narrow request-scoped Site Visit Materials Upload planned
  as part of the Workbench lifecycle does not reopen the general intake
  product.
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
