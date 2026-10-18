---
title: "Atlas: Research Board writeup runs"
domain: postgres
kind: state-page
status: source-built
summary: "Branch implementation of CSO release, Board archival and email receipts. Not deployed or activated."
canonical: true
cataloged: 2026-10-16
owner: product-engineering
related:
  - docs/plans/RESEARCH_WRITEUP_RELEASE_AND_BOARD_ARCHIVE_PLAN_2026-10-16.md
  - lib/db/migrations/085_board_writeup_runs.sql
  - lib/services/board-writeups/store.js
  - pages/api/workbench/board-writeups.js
  - pages/api/admin/board-writeup-cycles.js
  - pages/api/cron/board-writeups.js
---

# Research Board writeup runs

[VERIFIED via source and isolated PostgreSQL tests] Migration 085 creates `board_writeup_runs`, keyed by Research program GUID and meeting-date cycle code. The row contains a monotonic revision and version-1 JSON journal. Settings and human identities remain in Dataverse; SharePoint owns file bytes; `wmkf_requestdocument` owns archived references. This is branch source, not deployed behavior. Read-only production preflight on 2026-10-16 found neither migration 084 nor 085 in the configured database and Board Writeup option 100000014 absent.

The bounded journal is an implementation refinement of the plan's logical release/archive/email ledgers: one row lock serializes all those receipts with archive-start and configuration intent. Request IDs and email notice keys are unique object keys within that cycle. `mutateCycle` requires a synchronous callback, holds `SELECT FOR UPDATE`, commits before external calls, and rolls back exceptions. Limits: 100 expected requests, 2 MB journal, 5,000 audit events. There is no automatic deletion; operational capacity alerts require administrator attention and historical receipts must be retained.

## Stored state and ownership

- `releases[requestId]`: authenticated CSO approval/source version, upload intent/hash, lease, destination identity, release receipt or failure/hold. Only verified completion counts as released. Uncertain uploads never retry bytes automatically.
- `archives[requestId]`: frozen Board source/version, upload intent, destination and registry receipt, exclusions and recovery history. Archive start uses the same cycle lock and rejects unresolved releases or stale reconciliation revisions. Completion requires every frozen entry archived or explicitly excluded.
- `emails[noticeKey]`: frozen content/To/cc, activity/correlation IDs, create/send intents, lease and accepted timestamp. Activity acceptance is not proof of delivery. Daily keys use Pacific local dates; uncertain sends reconcile without blind replay.
- `configIntent`, `configHistory`, `events`: cross-store setup reconciliation and app-visible audit. Initial ambiguous creation remains held; revision-fenced updates may resume the same conditional save.
- `firstEventAt`, `archiveStartedAt`, `archiveCompletedAt`, `archiveManifest`: separate lifecycle boundaries. First event is the earlier eligible handoff or successful release; archival start stops confirmation reminders, completion drives its own notice.

## Services and consumers

`lib/services/board-writeups/model.js` validates closed input contracts; `config.js` owns exact settings and staff roles; `source.js` resolves ordinary Research sources and fences bytes by version/ETag; `service.js` approves/delivers; `archive.js` reconciles/freezes/archives; `recovery.js` requires explicit evidence for held copies; `notifications.js` owns durable mail; `worker.js` drains bounded work; `reader.js` projects Ready Board references to the Proposal tab. The `/board-writeups` page provides CSO controls and scoped admin/Grants Manager operations.

Dataverse settings keys: `board_writeups.cso`, `board_writeups.grants_manager`, `board_writeups.cycle.<cycle>`. Admin recipient is independent of authorization. Enabled superusers administer settings; enabled configured CSO releases; enabled configured Grants Manager with reviewers app access can reconcile/archive but cannot assign roles or release.

## Rollout and verification limits

`BOARD_WRITEUPS_ENABLED=on` and a production deployment targeting registered production Dataverse are required for Graph writes. The worker additionally requires `RESEARCH_LEADERSHIP_DIGEST_MODE=board-release`; the old leadership digest only runs in `legacy` (the unset default). `paused` and unknown modes stop both. Turning off the Board flag while retaining `board-release` never restarts old Allison mail. `BOARD_WRITEUP_SCHEMA_READY=on` is a separate archival prerequisite after exact metadata readback using `scripts/extend-requestdocument-artifacttype-board-writeup.mjs` (dry-run default). No flags or schemas have been changed externally.

The current implementation rejects all nonproduction file writes; an explicitly registered synthetic test destination remains a rollout prerequisite. The approved root resolves, but D26 child folder does not yet exist. No real files or emails were created during implementation. A bounded fictional DOCX transport rehearsal passed on 2026-10-17 using two isolated live SharePoint folders (see `docs/audits/research-board-docx-rehearsal-2026-10-17.md`): outgoing readback, Word-for-web edit, archive readback and duplicate-name refusal. This did not exercise the workflow services or Dataverse registry. Deployed credentials, clock-triggered mail and staff rehearsal remain unproved. Existing PD group-review mail is unchanged. Read-only recipient preflight on 2026-10-16 returned only Allison Keller and Beth Pruitt. Recheck and drain old leadership digests before cutover; never clear their shared PD-mail allowlist.

Tests: `tests/unit/board-writeup-workflow.test.js`, CSO cases in `tests/unit/pre-site-writeup-visibility.test.js`, and opt-in localhost-only `tests/integration/board-writeup-postgres.test.js`. Production build passed using webpack; Turbopack rejects the worktree's external dependency symlink.

**OPEN owner setup:** Justin must enter D26 Allison materials deadline and Board meeting end date, and staff must confirm all 23 request identities. Keep the date reminder in handoffs until Justin explicitly reports completion. Future single-phase selection rules remain undecided.

Read-only source preflight: request 1002988 resolved its current group-review source, a present Graph version, a 961,267-byte valid DOCX semantic hash, and exactly one resolved Dynamics request-document bucket. This proves reads and source selection, not upload round-trip or archival writes. Candidate discovery returned 369 ordinary D26 Research records; the 23 expected proposal identities remain staff-confirmed, never inferred from that count.

## Operator exceptions (required before activation)

Do not delete receipts or clear intent merely because a file/setting/activity is absent in one read. First pause Research mode, let active workers finish or their leases expire, preserve the relevant journal revision and provider evidence, and investigate the exact operation. Resume only after its outcome is established.

- **Ambiguous initial setting creation or out-of-band configuration conflict (Opus N3):** inspect the exact Dataverse setting key, duplicate-key/index state and request/audit outcome. If its value matches the intended save, use Reconcile interrupted setup save. A conditional update can resume its original ETag. If a different value is authoritative, an administrator must resolve that business conflict and record the decision before any targeted journal repair. Do not abandon an unresolved initial POST or infer failure from a temporary missing row. Escalate unresolved provider outcomes; no automatic replay is supported.
- **Request changes cycle/program/test classification after archive start (N4):** preserve the frozen manifest and copied files. If the business edit was erroneous, an authorized administrator corrects it in Dataverse and then resumes the held archive. If intentional and no archive copy was committed, an authorized admin/Grants Manager can record an explicit archive exclusion with a reason through recovery. Unknown uploads or existing copies must be investigated, never excluded as a shortcut. Do not force the request back to the old cycle or mark an unverified copy archived. Admin control notices continue; request labels are omitted when ordinary-record eligibility cannot be proved. Beth release reminders still hold for an ineligible roster until an audited roster correction.
- **Uncertain email creation or send (N5):** inspect the exact correlation/activity and recipients in Dataverse. Accepted status is reconciled without another send. A definite refusal can be repaired only with provider evidence of no activity/send and an audited, revision-fenced receipt correction; no name/subject-based guess, automatic duplicate activity, or blind resend. One-time completion/failure notices can require this intervention. This limitation must be covered in staff handoff.
- **Upload refusal vs unknown outcome (N2):** only a persisted definite response from the single PUT authorizes cancel/retry with no committed copy. A timeout, 404/410, 5xx, expired lease or missing response remains held. Use the in-app candidate inspection and content proof to bind a real copy. Never infer a safe retry from an empty folder; do not upload a replacement over staff edits.

The original mode remains `legacy` by default. New `board-release` or `paused` modes suppress only Research in the old digest; other programs retain their existing behavior. The shared mode also gates the CSO early-draft exception. Keep Board schema readiness on for historical reads after stopping new work.
