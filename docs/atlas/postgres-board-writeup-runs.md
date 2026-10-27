---
title: "Atlas: Research Board writeup runs"
domain: postgres
kind: state-page
status: source-built
summary: "Production Board archival schema and readiness flag verified 2026-10-27; D26 active with 23 confirmed proposals and no releases or archives. One isolated test-request archive and native Akoya document access passed; local worker resumption passed without cloud writes or email. Real D26 archival and President batch email acceptance remain unproved."
canonical: true
cataloged: 2026-10-16
owner: product-engineering
related:
  - docs/plans/RESEARCH_WRITEUP_RELEASE_AND_BOARD_ARCHIVE_PLAN_2026-10-16.md
  - docs/audits/BOARD_ARCHIVE_REHEARSAL_2026-10-27.md
  - lib/db/migrations/085_board_writeup_runs.sql
  - lib/services/board-writeups/store.js
  - pages/api/workbench/board-writeups.js
  - pages/api/admin/board-writeup-cycles.js
  - pages/api/cron/board-writeups.js
---

# Research Board writeup runs

## Current production state — verified 2026-10-27

[VERIFIED via owner-run schema preflights, Vercel deployment/configuration reads,
signed-in production setup and API readback, 2026-10-27] The `Board Writeup`
artifact option `100000014`, `wmkf_initiatedat` and both explicit-actor
relationships are exact in production. `BOARD_WRITEUP_SCHEMA_READY` is literal
`on`. Redeployment `dpl_EWuXB8WrnksMdCx8WS48vUjNYK3Z`, from existing `main`
commit `80b1cd737`, is Ready on the production aliases. This enables archival;
it does not start a batch or authorize copying unfinished documents.

[VERIFIED via signed-in production setup and API journal readback, 2026-10-27]
D26 is active with 23 selected, confirmed request identities, materials deadline
`2026-11-02` and Board end date `2026-12-10`. Shared assignments are Allison
Keller (President), Beth Pruitt (CSO), Sarah Hibler (Grants Manager) and Justin
Gallivan (cycle admin recipient). At journal revision `189`, `configPending`
was false and all 23 release receipts and archive entries were null. No real
D26 release or archive is claimed by the test evidence below.

[VERIFIED via production worker logs, 2026-10-27] Hourly Board-worker requests
at 16:00–21:00 UTC returned HTTP 200; the six-hour log scan found no warnings
or errors. This proves scheduled invocation, not successful release, archival,
or email delivery.

[VERIFIED via isolated live rehearsal receipts and native signed-in AkoyaGO
Documents readback, 2026-10-27] Marked test request `1003220`, cycle `J00`, run
`014a60d7-a0fe-4ad7-8303-db22ce7f31a1` passed the real archive services,
SharePoint readback, Dataverse registration and Board-reference reader. The
President-edit stand-in and archived file have the same governed-content hash,
`gdc1:Amn1Fmcyyp3rPGyZRrlSuQUYEOx9b9q4fqCAJscjuqQ`, distinct from the original
fixture. Native AkoyaGO Documents → Board Milestones → J00 opened the readable
archive in view-only Word with the edit marker present. A separate local
`runBoardWorkflow`/`archiveOne` resumption verified the existing copy with one
dispatch, local journal state and a locally suppressed completion notice;
cloud writes were blocked. Neither exercise proves production journal writes,
a deployed worker upload, a real D26 batch or email delivery. See the
[bounded rehearsal evidence and remaining limits](../audits/BOARD_ARCHIVE_REHEARSAL_2026-10-27.md).

## Journal contract and migration

[VERIFIED via source and isolated PostgreSQL tests] Migration 085 creates
`board_writeup_runs`, keyed by Research program GUID and meeting-date cycle
code. The row contains a monotonic revision and version-1 JSON journal.
Settings and human identities remain in Dataverse; SharePoint owns file bytes;
`wmkf_requestdocument` owns archived references.

Historical deployment receipt: runtime merged as `0e39ad951`; production
redeployment `dpl_3AHPWmAYw5B1aMeUzvuPS4Ce44kM` was Ready on 2026-10-18 PT.
The initial cycle-save failure was caused by the missing journal. The owner-run
migration applied migration 085 (1 applied, 83 skipped); tracker readback and an
insert/row-lock transaction followed by rollback verified it. That repair did
not change cycle settings. The October 16 metadata preflight found the Board
artifact option absent; the October 27 schema evidence above supersedes that
historical absence.
The bounded journal is an implementation refinement of the plan's logical release/archive/email ledgers: one row lock serializes all those receipts with archive-start and configuration intent. Request IDs and email notice keys are unique object keys within that cycle. `mutateCycle` requires a synchronous callback, holds `SELECT FOR UPDATE`, commits before external calls, and rolls back exceptions. Limits: 100 expected requests, 2 MB journal, 5,000 audit events. There is no automatic deletion; operational capacity alerts require administrator attention and historical receipts must be retained.

## Stored state and ownership

- `releases[requestId]`: authenticated CSO approval/source version, upload intent/hash, lease, destination identity, release receipt or failure/hold. Only verified completion counts as released. Uncertain uploads never retry bytes automatically.
- `releaseBatches[batchId]`: optional additive map of newly queued request IDs, authenticated approving CSO and creation time. The same transaction commits every accepted approval with its `releases[requestId].batchId`. Existing journals without this map never backfill President emails. Maximum 1,000 batches per cycle, within existing journal byte/event caps. No SQL migration.
- `archives[requestId]`: frozen Board source/version, upload intent, destination and registry receipt, exclusions and recovery history. Archive start uses the same cycle lock and rejects unresolved releases or stale reconciliation revisions. Completion requires every frozen entry archived or explicitly excluded.
- `emails[noticeKey]`: frozen content/To/cc, activity/correlation IDs, create/send intents, lease and accepted timestamp. Activity acceptance is not proof of delivery. Daily keys use Pacific local dates; uncertain sends reconcile without blind replay.
- `configIntent`, `configHistory`, `events`: cross-store setup reconciliation and app-visible audit. Initial ambiguous creation remains held; revision-fenced updates may resume the same conditional save.
- `firstEventAt`, `archiveStartedAt`, `archiveCompletedAt`, `archiveManifest`: separate lifecycle boundaries. First event is the earlier eligible handoff or successful release; archival start stops confirmation reminders, completion drives its own notice.
- `cleanupCompletedAt`, `cleanupCompletedBy`: optional cycle-level staff-discussion cleanup acknowledgement, added on `codex/board-cleanup-reminder` (deployed 2026-10-18 via merge `0e39ad951`). Older journals omit these fields and read as incomplete. An enabled authenticated superuser records completion once, with server-derived actor and time, through `completeCleanup`; the same transaction appends `discussion_cleanup_completed`. It does not delete discussion records or files and does not change archival status. No new table or SQL migration is needed.

## Staff-discussion cleanup reminder (deployed 2026-10-18)

[VERIFIED via source and isolated tests] The configured cycle admin receives a daily email, with no cc, at 9 a.m. Pacific starting seven calendar days after `boardEnds`. The existing Board worker and active-cycle/feature gates apply; missing dates or inactive cycles do not send. `emails[cleanup:YYYY-MM-DD]` reuses the lease, correlation and accepted-send protocol; missed days do not cause catch-up bursts. Board archival does not stop these separate reminders. The deployed `/board-cycle-setup` page exposes **Mark cleanup complete** to administrators when due, preserves the original completion actor/time on repeat requests, and stops future notices. The sender checks completion again before dispatch; an email already handed to the provider may still arrive.

No discussion content or proposal details are read for the cleanup email. Recipient eligibility is checked at dispatch. Completion is a staff attestation, not verification of deletion or a cleanup engine. Tests cover scheduling across DST, duplicate invocations, stale dates, recipient/configuration changes, completion during preparation, uncertain sends, authorization, worker dispatch, and UI cycle switching. Live cleanup-email delivery remains unproved. The current D26 dates, recipient and activation are verified in the production-state section above; with the saved December 10 Board end date, cleanup reminders become due December 17, 2026.

Historical cleanup-build verification: [VERIFIED via local checks, 2026-10-18] 63 tests passed across `board-cleanup-reminder`, `board-writeup-workflow`, `board-writeup-ui` and `board-writeup-routes-disabled`. Types, scoped ESLint, production Turbopack build and relevant route/Atlas/security/document gates passed (gate/self-test pairs sequential). Claude Opus 5.5 approved commit `82a53fb2f` with no High/Medium findings and two Low findings, now addressed; see the [review record and dispositions](../audits/board-cleanup-opus-review-2026-10-18.md). The build emitted four dynamic-filesystem tracing warnings outside the changed files. No live email or production data mutation was performed.

## President release-batch email (deployed; live acceptance unproved)

[VERIFIED via Git ancestry and Ready production deployment, 2026-10-27] PR #503 commit `ae4c980b1` is an ancestor of deployed `main` commit `80b1cd737`. The batch-email code is therefore deployed. No completed real release batch or President-email acceptance has been demonstrated; deployment is not mailbox-permission or delivery evidence.

[VERIFIED via source and focused tests] Owner requested one email per completed release batch, from the CSO, on 2026-10-18. `release-batches.js` resolves batch completion from persisted release receipts. `notifications.js` emits `president:<batchId>` through the existing activity correlation, lease and create/send-intent protocol. The normal worker dispatches it after delivery, independently of the 9 a.m. reminder hour. A batch contains only newly queued approvals; duplicate clicks or already-released selections create no additional batch. Preflight-rejected rows do not join the batch. Failed, held or unknown copy states delay its email until recovered, explicitly cancelled, or superseded by a fresh CSO approval. Cancelled/superseded entries are omitted; a later fresh approval belongs to its own batch. Empty-success batches never email.

The email lists request numbers and institutions for successfully released ordinary requests and links the live registered cycle folder. The sender is the approving CSO, who must still hold the configured CSO role and remain eligible; the recipient is the current eligible President, with no cc. Before activity creation and again before dispatch, recheck request eligibility, file presence in the verified cycle folder, staff identities and exact content/parties. The provider activity freezes sender, recipient and content. Changed parties/content after creation hold the notification for investigation. Creation and send use CSO impersonation with `noFallback`; `DYNAMICS_IMPERSONATION_ENABLED=true` is required. Other reminder sender/recipient rules are unchanged. No live email has been sent to validate mailbox permissions or inbox delivery.

An uncertain create/send retains its receipt and never blindly creates or sends again. An accepted provider outcome can reconcile later. Role changes or moved/deleted files require operator investigation under the email exception below, not silent substitution, recreation or resend. Source: `tests/unit/board-president-batch-email.test.js`.

## Services and consumers

`lib/services/board-writeups/model.js` validates closed input contracts; `config.js` owns exact settings and staff roles; `source.js` resolves ordinary Research sources and fences bytes by version/ETag; `service.js` approves/delivers; `archive.js` reconciles/freezes/archives; `recovery.js` requires explicit evidence for held copies; `release-batches.js` validates batch completion and cycle-folder links; `notifications.js` owns durable mail; `worker.js` drains bounded work; `reader.js` projects Ready Board references to the Proposal tab. [VERIFIED via main source and signed-in production setup, 2026-10-27] `/board-writeups` is the CSO dashboard, viewable by the configured CSO, enabled superusers and the assigned Grants Manager. Only the CSO can release; non-CSO payloads continue to omit draft links. `/board-cycle-setup` owns dates, the cycle admin recipient, proposal roster, activation, interrupted-save reconciliation, recovery, archival and the superuser-only cleanup acknowledgement. Navigation links the two pages; cleanup reminders target setup. Both pages retain reviewers app access and server-derived Board capability checks.

Dataverse settings keys: `board_writeups.president` (deployed via PR #501, merge `0b0b4e94c`; Allison Keller confirmed in production setup on 2026-10-27), `board_writeups.cso`, `board_writeups.grants_manager`, `board_writeups.program_coordinator`, `board_writeups.systems_specialist`, `board_writeups.cycle.<cycle>`. Program Coordinator and Systems Specialist (added 2026-10-21) are the central record of who holds those roles for other app surfaces to read via `getRole('programCoordinator')` / `getRole('systemsSpecialist')`; any active staff member may hold them, they grant no permission, and Board cycle activation does not require them (`BOARD_ACTIVATION_ROLES`). President is an explicit staff assignment required when saving an active cycle; it grants no release/archive permission. The merged batch notification uses this assignment as its recipient. The Board UI and release reminders use “the President.” Admin recipient is independent of authorization. [VERIFIED via main source and signed-in production setup, 2026-10-27] `saveRole`, `saveCycle` and `resumeConfig` require an enabled, identity-bound superuser or the existing configured Grants Manager with reviewers app access. The setup GET permits the same scoped manager access. These scoped permissions include assigning shared roles and changing cycle settings; they confer no general Admin access. The CSO alone releases. Staff-discussion cleanup completion remains superuser-only. An unassigned caller cannot bootstrap authority by assigning itself Grants Manager.

### Central staffing first release (deployed PR #507)

[VERIFIED via parent session production deployment and signed-in Admin readback, 2026-10-19] PR #507 (`e4cb89ada`) deployed the central panel. Admin → People & Access → Staffing renders `StaffingPanel` with the President, CSO and Grants Manager selectors and the existing superuser-only Final Writeup staffing editor. `/staffing` gives enabled identity-bound superusers and the existing assigned Grants Manager the shared-role editor without general Admin access. Board setup displays a role summary and links to Staffing; cycle dates, admin recipient, roster and activation remain in Board setup. Related assignment links retain their existing owning editors.

`/api/workbench/staffing` requires reviewers app access and rechecks `requireSetupManager` through `staffingCapabilities`, `loadStaffing` or `saveRole`. GET returns eligible staff plus the three independently versioned assignments; `?capabilities=true` returns only management capabilities. POST accepts only role, value and expectedRevision. It reuses the same `board_writeups.*` setting keys and optimistic writes; no data migration or new role store. A caller cannot bootstrap manager authority from request input. Removing or replacing the current Grants Manager removes that caller's shared-role authority at the next server check.

[VERIFIED via PR #508 source, Ready production deployment `dpl_4bF6rurMekk5gnF26jNdXWiQJNMQ` at `fbfb7e83b`, and signed-in dropdown readback, 2026-10-19] President eligibility requires an enabled Dataverse user, active linked profile and `@wmkeck.org` email, but no Workbench app grant. `saveRole`, active-cycle validation and President batch-email preparation/revalidation all use this same recipient-only exception. CSO and Grants Manager eligibility continues to require Workbench (`reviewers`) access or superuser status. The directory returns eligible linked staff with a server-derived `canUseWorkbench` boolean; the President picker shows that wider directory and CSO/Grants Manager pickers filter on the boolean. This grants the President no app access, release or administration authority. No migration, new environment setting, live assignment write or email-send test accompanies this change.

Staffing configuration is intentionally independent of `BOARD_WRITEUPS_ENABLED`; Board release, draft visibility, worker dispatch and archive gates remain unchanged. Final Writeup personas/program audiences retain their separate `final_writeup.matrix_audiences` v2 contract, exact reviewer eligibility, superuser API and atomic Publish. Shared roles do not grant Final Writeup personas or general Admin privileges. Existing release actors and accepted mail receipts remain historical; role changes still revalidate pending work and hold frozen email parties/content conflicts rather than silently resend. Signed-in production readback on 2026-10-19 confirmed Anneli Stone and Saskia Pallais are offered for President and absent from CSO/Grants Manager choices. Existing President, CSO and Grants Manager selections remained unchanged. No live assignment write or email-send test was performed.

## Rollout and verification limits

`BOARD_WRITEUPS_ENABLED=on` and a production deployment targeting registered
production Dataverse are required for normal runtime Graph writes. The worker
additionally requires `RESEARCH_LEADERSHIP_DIGEST_MODE=board-release`; the old
leadership digest only runs in `legacy` (the unset default). `paused` and unknown
modes stop both. Turning off the Board flag while retaining `board-release`
never restarts old Allison mail. `BOARD_WRITEUP_SCHEMA_READY=on` is the separate
archive and historical-reference readiness prerequisite, now verified in
production after exact metadata readback. The Board-work switches and
`NOTIFICATION_EMAIL_FROM=alerts@wmkeck.org` were activated on 2026-10-18; the
schema flag was enabled and redeployed on 2026-10-27.

Normal runtime still rejects test requests and nonproduction file writes.
The bounded operator rehearsal admits only its explicitly marked test request
through trusted dependency overrides, fixed approved targets, a local receipt
and a deny-by-default network fence. It does not create a production cycle
setting or journal, change normal test exclusions, run the deployed worker or
send emails. All fictional files and registry receipts are retained. The older
October 17 transport-only rehearsal remains historical evidence of outgoing
copy, Word editing, archive readback and duplicate-name refusal; the October 27
service/registration/native-reader proof supersedes its former limitation to
transport alone.

Remaining acceptance limits: no real D26 CSO release, President batch-email
acceptance or real D26 post-Board archival has been exercised. The deployed
hourly worker is observed running, but its actual upload/archive behavior is
not proved by HTTP 200 logs or the isolated local existing-copy resumption.
Post-Board confirmation, completion and cleanup email delivery remain
unproved. Existing PD group-review mail is unchanged. Production archival must
still follow release completion, discrepancy review and explicit administrator
or Grants Manager confirmation that editing is finished. Future single-phase
proposal-selection rules remain undecided.

Tests: `tests/unit/board-writeup-workflow.test.js`, CSO cases in
`tests/unit/pre-site-writeup-visibility.test.js`, opt-in localhost-only
`tests/integration/board-writeup-postgres.test.js`, and branch-only offline operator tests
in `tests/operator/board-archive-rehearsal.test.mjs` on
`codex/board-archive-rehearsal` (not merged into main). The operator suite covers
its exact-target and email/network fences, real adapter planning and local
worker dispatch; it does not substitute for live D26 acceptance.

Historical candidate/source evidence (2026-10-18): request `1002988` resolved
its current group-review source, a present Graph version, a 961,267-byte valid
DOCX semantic hash and one Dynamics request-document bucket. PR #499 (merge
`a4cf97239`) restricted new candidates to ordinary Research requests in the
selected cycle with `akoya_requeststatus=Phase II Pending`, at query and row
boundaries; signed-in production verification showed 23 candidates. Existing
saved selections remain visible for explicit owner review/removal. The
owner-approved ETag-fenced corrections marked legacy test requests `1003223`
and `1003224` as tests, preserving null run IDs. Those probes did not save a
cycle roster or activate it; the current 23-confirmed active D26 configuration
is established separately by the October 27 production readback above.

## Operator exceptions

Do not delete receipts or clear intent merely because a file/setting/activity is absent in one read. First pause Research mode, let active workers finish or their leases expire, preserve the relevant journal revision and provider evidence, and investigate the exact operation. Resume only after its outcome is established.

- **Ambiguous initial setting creation or out-of-band configuration conflict (Opus N3):** inspect the exact Dataverse setting key, duplicate-key/index state and request/audit outcome. If its value matches the intended save, use Reconcile interrupted setup save. A conditional update can resume its original ETag. If a different value is authoritative, an administrator must resolve that business conflict and record the decision before any targeted journal repair. Do not abandon an unresolved initial POST or infer failure from a temporary missing row. Escalate unresolved provider outcomes; no automatic replay is supported.
- **Request changes cycle/program/test classification after archive start (N4):** preserve the frozen manifest and copied files. If the business edit was erroneous, an authorized administrator corrects it in Dataverse and then resumes the held archive. If intentional and no archive copy was committed, an authorized admin/Grants Manager can record an explicit archive exclusion with a reason through recovery. Unknown uploads or existing copies must be investigated, never excluded as a shortcut. Do not force the request back to the old cycle or mark an unverified copy archived. Admin control notices continue; request labels are omitted when ordinary-record eligibility cannot be proved. CSO release reminders still hold for an ineligible roster until an audited roster correction.
- **Uncertain email creation or send (N5):** inspect the exact correlation/activity and recipients in Dataverse. Accepted status is reconciled without another send. A definite refusal can be repaired only with provider evidence of no activity/send and an audited, revision-fenced receipt correction; no name/subject-based guess, automatic duplicate activity, or blind resend. One-time completion/failure notices can require this intervention. This limitation must be covered in staff handoff.
- **Upload refusal vs unknown outcome (N2):** only a persisted definite response from the single PUT authorizes cancel/retry with no committed copy. A timeout, 404/410, 5xx, expired lease or missing response remains held. Use the in-app candidate inspection and content proof to bind a real copy. Never infer a safe retry from an empty folder; do not upload a replacement over staff edits.

The original mode remains `legacy` by default. New `board-release` or `paused` modes suppress only Research in the old digest; other programs retain their existing behavior. The shared mode also gates the CSO early-draft exception. Keep Board schema readiness on for historical reads after stopping new work.
