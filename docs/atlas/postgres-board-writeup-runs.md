---
title: "Atlas: Research Board writeup runs"
domain: postgres
kind: state-page
status: source-built
summary: "Board workflow deployed; cycle setup remains owner-controlled. Phase II candidate filter is deployed; the production journal migration is applied."
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

[VERIFIED via source and isolated PostgreSQL tests] Migration 085 creates `board_writeup_runs`, keyed by Research program GUID and meeting-date cycle code. The row contains a monotonic revision and version-1 JSON journal. Settings and human identities remain in Dataverse; SharePoint owns file bytes; `wmkf_requestdocument` owns archived references. Runtime deployed at merge `0e39ad951`; production redeployment `dpl_3AHPWmAYw5B1aMeUzvuPS4Ce44kM` was Ready on 2026-10-18 PT. The missing journal caused the initial production cycle-save failure. [VERIFIED via production schema probe and `scripts/apply-migrations.js`, 2026-10-18 PT] Migration 085 was the only pending migration and is now applied (1 applied, 83 skipped). Tracker readback and an insert/row-lock transaction followed by rollback verified the journal. No cycle settings were changed by the repair. Historical preflight on 2026-10-16 also found Board Writeup option 100000014 absent; this Postgres repair does not establish Dataverse archival schema readiness.

The bounded journal is an implementation refinement of the plan's logical release/archive/email ledgers: one row lock serializes all those receipts with archive-start and configuration intent. Request IDs and email notice keys are unique object keys within that cycle. `mutateCycle` requires a synchronous callback, holds `SELECT FOR UPDATE`, commits before external calls, and rolls back exceptions. Limits: 100 expected requests, 2 MB journal, 5,000 audit events. There is no automatic deletion; operational capacity alerts require administrator attention and historical receipts must be retained.

## Stored state and ownership

- `releases[requestId]`: authenticated CSO approval/source version, upload intent/hash, lease, destination identity, release receipt or failure/hold. Only verified completion counts as released. Uncertain uploads never retry bytes automatically.
- `archives[requestId]`: frozen Board source/version, upload intent, destination and registry receipt, exclusions and recovery history. Archive start uses the same cycle lock and rejects unresolved releases or stale reconciliation revisions. Completion requires every frozen entry archived or explicitly excluded.
- `emails[noticeKey]`: frozen content/To/cc, activity/correlation IDs, create/send intents, lease and accepted timestamp. Activity acceptance is not proof of delivery. Daily keys use Pacific local dates; uncertain sends reconcile without blind replay.
- `configIntent`, `configHistory`, `events`: cross-store setup reconciliation and app-visible audit. Initial ambiguous creation remains held; revision-fenced updates may resume the same conditional save.
- `firstEventAt`, `archiveStartedAt`, `archiveCompletedAt`, `archiveManifest`: separate lifecycle boundaries. First event is the earlier eligible handoff or successful release; archival start stops confirmation reminders, completion drives its own notice.
- `cleanupCompletedAt`, `cleanupCompletedBy`: optional cycle-level staff-discussion cleanup acknowledgement, added on `codex/board-cleanup-reminder` (deployed 2026-10-18 via merge `0e39ad951`). Older journals omit these fields and read as incomplete. An enabled authenticated superuser records completion once, with server-derived actor and time, through `completeCleanup`; the same transaction appends `discussion_cleanup_completed`. It does not delete discussion records or files and does not change archival status. No new table or SQL migration is needed.

## Staff-discussion cleanup reminder (deployed 2026-10-18)

[VERIFIED via source and isolated tests] The configured cycle admin receives a daily email, with no cc, at 9 a.m. Pacific starting seven calendar days after `boardEnds`. The existing Board worker and active-cycle/feature gates apply; missing dates or inactive cycles do not send. `emails[cleanup:YYYY-MM-DD]` reuses the lease, correlation and accepted-send protocol; missed days do not cause catch-up bursts. Board archival does not stop these separate reminders. The Board page exposes **Mark cleanup complete** to administrators when due, preserves the original completion actor/time on repeat requests, and stops future notices. The sender checks completion again before dispatch; an email already handed to the provider may still arrive.

No discussion content or proposal details are read for the cleanup email. Recipient eligibility is checked at dispatch. Completion is a staff attestation, not verification of deletion or a cleanup engine. Tests cover scheduling across DST, duplicate invocations, stale dates, recipient/configuration changes, completion during preparation, uncertain sends, authorization, worker dispatch, and UI cycle switching. Live email delivery and configured Board dates/recipient have not been verified by this build; Board activation remains separate.

[VERIFIED via local checks, 2026-10-18] 63 tests passed across `board-cleanup-reminder`, `board-writeup-workflow`, `board-writeup-ui` and `board-writeup-routes-disabled`. Types, scoped ESLint, production Turbopack build and relevant route/Atlas/security/document gates passed (gate/self-test pairs sequential). Claude Opus 5.5 approved commit `82a53fb2f` with no High/Medium findings and two Low findings, now addressed; see the [review record and dispositions](../audits/board-cleanup-opus-review-2026-10-18.md). The build emitted four dynamic-filesystem tracing warnings outside the changed files. No live email or production data mutation was performed.

## Services and consumers

`lib/services/board-writeups/model.js` validates closed input contracts; `config.js` owns exact settings and staff roles; `source.js` resolves ordinary Research sources and fences bytes by version/ETag; `service.js` approves/delivers; `archive.js` reconciles/freezes/archives; `recovery.js` requires explicit evidence for held copies; `notifications.js` owns durable mail; `worker.js` drains bounded work; `reader.js` projects Ready Board references to the Proposal tab. The `/board-writeups` page provides CSO controls and scoped admin/Grants Manager operations.

Dataverse settings keys: `board_writeups.cso`, `board_writeups.grants_manager`, `board_writeups.cycle.<cycle>`. Admin recipient is independent of authorization. Enabled superusers administer settings; enabled configured CSO releases; enabled configured Grants Manager with reviewers app access can reconcile/archive but cannot assign roles or release.

## Rollout and verification limits

`BOARD_WRITEUPS_ENABLED=on` and a production deployment targeting registered production Dataverse are required for Graph writes. The worker additionally requires `RESEARCH_LEADERSHIP_DIGEST_MODE=board-release`; the old leadership digest only runs in `legacy` (the unset default). `paused` and unknown modes stop both. Turning off the Board flag while retaining `board-release` never restarts old Allison mail. `BOARD_WRITEUP_SCHEMA_READY=on` is a separate archival prerequisite after exact metadata readback using `scripts/extend-requestdocument-artifacttype-board-writeup.mjs` (dry-run default). [VERIFIED via Vercel CLI readback and Ready redeployment, 2026-10-18 PT] Production now has `BOARD_WRITEUPS_ENABLED=on`, `RESEARCH_LEADERSHIP_DIGEST_MODE=board-release`, and `NOTIFICATION_EMAIL_FROM=alerts@wmkeck.org` as readable Config variables. This activation did not alter schema; schema readiness is not claimed by the deployment check.

The current implementation rejects all nonproduction file writes; an explicitly registered synthetic test destination remains a rollout prerequisite. The approved root resolves, but D26 child folder does not yet exist. No real files or emails were created during implementation. A bounded fictional DOCX transport rehearsal passed on 2026-10-17 using two isolated live SharePoint folders (see `docs/audits/research-board-docx-rehearsal-2026-10-17.md`): outgoing readback, Word-for-web edit, archive readback and duplicate-name refusal. This did not exercise the workflow services or Dataverse registry. Deployed credentials, clock-triggered mail and staff rehearsal remain unproved. Existing PD group-review mail is unchanged. Read-only recipient preflight on 2026-10-16 returned only Allison Keller and Beth Pruitt. Recheck and drain old leadership digests before cutover; never clear their shared PD-mail allowlist.

Tests: `tests/unit/board-writeup-workflow.test.js`, CSO cases in `tests/unit/pre-site-writeup-visibility.test.js`, and opt-in localhost-only `tests/integration/board-writeup-postgres.test.js`. Production build passed using webpack; Turbopack rejects the worktree's external dependency symlink.

**OPEN owner setup:** Justin must enter D26 Allison materials deadline and Board meeting end date, and staff must confirm all 23 request identities. Keep the date reminder in handoffs until Justin explicitly reports completion. Future single-phase selection rules remain undecided.

Read-only source preflight: request 1002988 resolved its current group-review source, a present Graph version, a 961,267-byte valid DOCX semantic hash, and exactly one resolved Dynamics request-document bucket. This proves reads and source selection, not upload round-trip or archival writes. The original candidate query lacked a pipeline-status filter. PR #499 (merge `a4cf97239`) restricts new candidates to ordinary Research requests in the selected cycle with `akoya_requeststatus=Phase II Pending`, at both query and row-filter boundaries; production deployment `dpl_ADXz1nWhMaH2gHnMhcqVAbCNr2kp` is Ready and signed-in UI verification showed exactly 23 candidates. Existing saved selections remain visible for explicit owner review/removal. [VERIFIED via `scripts/probe-board-cycle-candidates.js`, 2026-10-18 PT] Owner-approved, ETag-fenced corrections marked legacy test requests 1003223 and 1003224 as tests, preserving their null run IDs. Readback found exactly 23 ordinary Phase II Pending D26 candidates. The roster still requires staff confirmation; no cycle selection or activation was changed.

## Operator exceptions (required before activation)

Do not delete receipts or clear intent merely because a file/setting/activity is absent in one read. First pause Research mode, let active workers finish or their leases expire, preserve the relevant journal revision and provider evidence, and investigate the exact operation. Resume only after its outcome is established.

- **Ambiguous initial setting creation or out-of-band configuration conflict (Opus N3):** inspect the exact Dataverse setting key, duplicate-key/index state and request/audit outcome. If its value matches the intended save, use Reconcile interrupted setup save. A conditional update can resume its original ETag. If a different value is authoritative, an administrator must resolve that business conflict and record the decision before any targeted journal repair. Do not abandon an unresolved initial POST or infer failure from a temporary missing row. Escalate unresolved provider outcomes; no automatic replay is supported.
- **Request changes cycle/program/test classification after archive start (N4):** preserve the frozen manifest and copied files. If the business edit was erroneous, an authorized administrator corrects it in Dataverse and then resumes the held archive. If intentional and no archive copy was committed, an authorized admin/Grants Manager can record an explicit archive exclusion with a reason through recovery. Unknown uploads or existing copies must be investigated, never excluded as a shortcut. Do not force the request back to the old cycle or mark an unverified copy archived. Admin control notices continue; request labels are omitted when ordinary-record eligibility cannot be proved. Beth release reminders still hold for an ineligible roster until an audited roster correction.
- **Uncertain email creation or send (N5):** inspect the exact correlation/activity and recipients in Dataverse. Accepted status is reconciled without another send. A definite refusal can be repaired only with provider evidence of no activity/send and an audited, revision-fenced receipt correction; no name/subject-based guess, automatic duplicate activity, or blind resend. One-time completion/failure notices can require this intervention. This limitation must be covered in staff handoff.
- **Upload refusal vs unknown outcome (N2):** only a persisted definite response from the single PUT authorizes cancel/retry with no committed copy. A timeout, 404/410, 5xx, expired lease or missing response remains held. Use the in-app candidate inspection and content proof to bind a real copy. Never infer a safe retry from an empty folder; do not upload a replacement over staff edits.

The original mode remains `legacy` by default. New `board-release` or `paused` modes suppress only Research in the old digest; other programs retain their existing behavior. The shared mode also gates the CSO early-draft exception. Keep Board schema readiness on for historical reads after stopping new work.
