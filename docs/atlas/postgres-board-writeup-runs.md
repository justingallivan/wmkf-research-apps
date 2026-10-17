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

The current implementation rejects all nonproduction file writes; an explicitly registered synthetic test destination remains a rollout prerequisite. The approved root resolves, but D26 child folder does not yet exist. No real files or emails were created during implementation. Real DOCX round-trip, deployed credentials, clock-triggered mail and staff rehearsal are not yet proved. Existing PD group-review mail is unchanged. Read-only recipient preflight on 2026-10-16 returned only Allison Keller and Beth Pruitt. Recheck and drain old leadership digests before cutover; never clear their shared PD-mail allowlist.

Tests: `tests/unit/board-writeup-workflow.test.js`, CSO cases in `tests/unit/pre-site-writeup-visibility.test.js`, and opt-in localhost-only `tests/integration/board-writeup-postgres.test.js`. Production build passed using webpack; Turbopack rejects the worktree's external dependency symlink.

**OPEN owner setup:** Justin must enter D26 Allison materials deadline and Board meeting end date, and staff must confirm all 23 request identities. Keep the date reminder in handoffs until Justin explicitly reports completion. Future single-phase selection rules remain undecided.

Read-only source preflight: request 1002988 resolved its current group-review source, a present Graph version, a 961,267-byte valid DOCX semantic hash, and exactly one resolved Dynamics request-document bucket. This proves reads and source selection, not upload round-trip or archival writes. Candidate discovery returned 369 ordinary D26 Research records; the 23 expected proposal identities remain staff-confirmed, never inferred from that count.
