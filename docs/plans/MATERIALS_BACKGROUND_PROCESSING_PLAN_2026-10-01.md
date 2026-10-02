---
title: Applicant materials background processing
kind: plan
status: active
last_verified: 2026-10-02
---

# Applicant materials background processing

[PRODUCTION BACKGROUND ADMISSION LIVE; FIRST REAL JOB COMPLETED] Applicant Site Visit / Research Presentation uploads can return after private Blob transfer and a durable Postgres admission transaction. The scheduled worker scans and saves admitted files. Production schema readiness, admission, and virus scanning are all enabled. The first real background job completed successfully on attempt 1 and its staging receipt was consumed. Production activation and a read-only operator-path check are recorded below. Consultant Feedback and other upload workflows retain synchronous processing and the shared configurable 500 MB cap.

## Evidence and review decisions

[VERIFIED via source at main `499d9e29a`] Reviewer acceptance uses a deployed job-ledger pattern (`reviewer-acceptance-job-service.js`, `reviewer-acceptance-drain.js`). Reuse its claim, fencing and retry approach; do not reuse its payload or table. The parked intake drain is not the dependency.

[VERIFIED via source] The synchronous finalize path waits for Blob read, validation, scanning, SharePoint and registry persistence. With background admission enabled, finalize returns after durable Postgres admission; the worker then scans and saves the file. Staging has actor/scope/request binding, candidate receipts and consumed replay. Earlier cleanup selected expired rows before remote deletion, leaving a race with finalize; earlier checklist replacement used the same canonical item before registry write. Both risks were addressed in the shipped background design.

[VERIFIED via owner-authorized agent Production probes, deployment readback, and first-job lifecycle, 2026-10-02] Production Postgres target is host `ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech`, database `neondb`, schema `public`; migration 060 and the physical job table/staging owner column are present. The three Production switches are `SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY=on`, `SITE_VISIT_MATERIALS_BACKGROUND_ADMISSION_ENABLED=on`, and `VIRUS_SCAN_ENABLED=true`. PR #404 (`a63747ca5dfa74954c208e23bd1f90f3b25b0eab`), #407 (`df7bb6ac3f90eba5b80d785f3119c96b8bd0f0e4`), and #410 (`8fb8a6d83684a9d49b8450b26ef5bbef382f9a32`) are merged and all CI passed. The historical activation deployment `dpl_2AacXcc5YQX9dNvJ4gMn4PpGtWWN` serves `8fb8a6d83684a9d49b8450b26ef5bbef382f9a32` at `https://wmkfresearchapps-36g8ub7g7-justin-gallivans-projects.vercel.app`, aliased to `applications.wmkeck.org`. The read-only Production CLI passed target/TLS checks and returned expected `job_not_found` for deliberately nonexistent UUID `00000000-0000-4000-8000-000000000000`; no recovery mutation was run.

The first real job, `33630e07-4311-41b3-8aef-737a2962ce03` (`presentation_source`), was created at `2026-10-02T21:36:35.918Z`, started at `21:37:05.541Z`, recorded a clean scan checkpoint at `21:38:23.439Z`, and completed at `2026-10-02T21:39:19.482Z` on attempt 1 with no error; staging was consumed. Admission-to-completion took about 2m44s. The owner closed and reopened the browser during processing, later reopened it again, and confirmed the completed Received state. Subsequent worker invocations (21:44–21:48 UTC) were healthy and found an empty queue. No automatic email is sent; operational monitoring remains required.

Claude Fable reviewed the plan twice through the Claude Code OAuth/subscription session. The second verdict permitted building after preserving synchronous scan-disabled behavior and protecting Graph items referenced by registry rows in any lifecycle state. The separate per-staging-folder design protects prior files through partial failure. The October 2 reader, guarded recovery, scan-diagnostic, and progress changes are merged in PRs #402, #404, #407, and #410 and are in the current Production deployment. PR #405 merged as `1df8a33e2` after all current-head CI checks passed; PR #413 merged as `81dad17e2`. Both are included in Ready Production deployment `dpl_7zi1no5HrxgrPbCQo18Lsi1NM5CZ` at commit `b223dad7d` (October 2 final deployment readback and Git ancestry checks).

### L1/L2/L3 fixes shipped in PR #402 — Production-deployed

| Finding | Required invariant | Evidence before marking built |
|---|---|---|
| Recursive document readers | Internal recursive readers exclude files inside `portal-<UUID>` upload subfolders beneath canonical Site Visit materials folders, so uncommitted candidates and prior replacements do not enter generic document lists. | **Verified via source, four call sites, and focused regressions:** five suites, 79 tests, one snapshot passed (`785017d32`). |
| Exhausted recovery retry | An operator can explicitly retry an exhausted `needs_attention` job only when the job and staging row have no live lease, staging is unconsumed and still owned/bound to that job, and the failure is not infected content. Retry starts a fresh bounded two-hour budget and preserves the staging identity. | **Verified via source and real PostgreSQL through the actual loopback CLI:** exhausted retry and exact-owner/live-lease/consumed/infected guards passed (`2c7d1f1c9`). |
| Operator/test parity | The tested PostgreSQL transition is the implementation used by the operator command, including cancellation and retry guards. | **Verified via source and real PostgreSQL:** the CLI delegates to the tested store transition; 95 focused unit tests and 16 PG tests passed (`2c7d1f1c9`). |

PR #402's L1/L2/L3 corrections are Production-deployed. The guarded recovery CLI and reader filter from PR #404, scan diagnostics from PR #407, and upload progress/rejection copy from PR #410 are also merged, CI-passing, and included in the current Production deployment. Focused source, unit, and local PostgreSQL evidence is retained in the dated build record below. The first real Production job completed successfully; PR #405 is merged and Production-deployed.

## Production activation and first-job verification — 2026-10-02

Schema readiness, worker, scan rejection diagnostics, request-wide job projections, the guarded operator path, and the five-caller recursive-reader filter are live in Production. PR #404, #407, and #410 passed CI and merged. The owner enabled schema readiness, admissions, and scanning on October 2. Read-only operator validation and the first real job are recorded above. PR #405 merged as `1df8a33e2` after all current-head CI checks passed; PR #413 merged as `81dad17e2`. Both are included in Ready Production deployment `dpl_7zi1no5HrxgrPbCQo18Lsi1NM5CZ` at commit `b223dad7d` (October 2 final deployment readback and Git ancestry checks).

| Follow-up | Invariant | Current evidence |
|---|---|---|
| Production operator recovery | The fixed local-shell `MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL` path requires explicit `--target production`, expected host/database, verified TLS, and exact job/action confirmations for retry/cancel. Inspect is read-only; database/schema are asserted inside the transaction; errors and output are sanitized. | **PRODUCTION SOURCE AND PATH VERIFIED 2026-10-02.** PR #404 is merged. The owner-authorized agent read-only probe passed target/TLS checks and returned expected `job_not_found` for intentionally nonexistent UUID `00000000-0000-4000-8000-000000000000`. No recovery mutation was run. |
| Older root-level file listing | In schema-on mode, lazily consult the request-scoped registry only when a Graph walk contains direct files in canonical Site Visit materials folders. Suppress only exact same-request portal-produced Superseded `(drive,item)` identities, excluding current winners selected by the existing matcher. Leave unrelated inventory unchanged; on incomplete evidence, omit affected candidates and return a sanitized error. | **PRODUCTION-DEPLOYED in PR #404**, included in deployment `dpl_2AacXcc5YQX9dNvJ4gMn4PpGtWWN`. The dedicated registry-aware materials view remains the source for current published files. |

The generic walker continues to omit background subfolder artifacts. If staff overwrite a previously Superseded SharePoint item in place, its item ID remains the same and this filter will still suppress it; this is a known limitation of the exact identity rule. Use the dedicated registry-aware materials view as the authoritative current-file surface.

Production activation was authorized and completed on October 2: schema readiness, admission, and scanning are enabled. The first background job completed successfully. A real 300+ MB PPTX had also completed before background activation. The configured 500 MB limit is covered by unit tests. The exact 500 MB live transfer remains unverified and parked, not a normal-use release blocker. The owner declined another simultaneous-large background test on October 2: the expected set is one large PPTX, a usually smaller PDF, and a text document. Reopen stress testing only if usage or failures warrant it. No automatic email is sent, so operational monitoring remains necessary.

## User-visible contract

Only after server authorization, private object metadata verification and committed queue ownership does finalize return HTTP 202: “Upload received. We’re checking and saving your file. You can close this page.” A failed or uncertain admission keeps the staging identity available for Retry. Session storage is a convenience, not the work owner.

Durable context distinguishes queued/processing/completed/failed/cancelled/needs-attention. Existing registry receipts remain separate from new processing uploads. Processing and attention hold the affected checklist slot and prevent Ready; reminders do not ask applicants to replace a held upload. Failure copy explains the reason in safe language and resolves the Program Coordinator name/email from the request. No new automatic emails. The cron is classified `allowed` in the Test Request Factory scheduled-job census: it continues an explicitly submitted, token-authorized upload on the chosen request, including a test request; it does not independently select requests or send mail.

One page-level poll, at least 15 seconds apart, refreshes active work; hidden-page, unmount, token-change cancellation and 429 backoff prevent stale updates and rate-limit churn. Reopening without session storage recovers durable state. Staff status includes processing/attention even after natural collection closure. Expired external links continue to deny access.

## Durable ownership and rollout

- Migration 060 adds `materials_upload_jobs` and nullable `portal_upload_staging.background_job_id`; existing staging status values remain unchanged.
- Job identity is unique per staging row. Persist request, collection, slot, actor/digest binding (never raw JWT), original filename, status, attempt/deadline, lease, clean-scan checkpoint, result and sanitized error.
- A partial unique index holds one active job per request/checklist slot across collections, including `needs_attention`. Optional Other files are not slot-serialized.
- `SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY=on` enables schema-dependent queries. Off means no new-table/column query. `SITE_VISIT_MATERIALS_BACKGROUND_ADMISSION_ENABLED=on` separately enables new admissions and requires schema readiness plus enabled scanning. Existing jobs continue draining/status/cleanup when admission is off.
- Admission locks the collection and exact claimed staging row, validates ownership/window/checklist, inserts or replays the job, extends staging retention, sets its owner, and releases the request lease atomically. It resets a Ready collection to open, clearing readiness, but never reopens a closed collection. Synchronous behavior remains unchanged when admission is off, except conflicts with active queued jobs are denied.
- Release sequence (completed in Production on 2026-10-02): deploy schema-capable code, apply migration through `scripts/apply-migrations.js`, enable schema readiness and verify the worker, then enable admission. Treat schema readiness as one-way once any job exists: do not switch it off while ownership rows remain. Disable admission and drain/resolve all jobs before any rollback to code unaware of the ownership column.

## Worker and recovery

One job per cron invocation, every minute, with an explicit 300-second route budget. Acquire process memory admission before claiming. A fixed 360-second authoritative job lease fences staging and downstream mutations; the worker does not renew it. Claim increments attempts so crashes count. The store exposes an attempt-giveback helper, but no runtime caller currently uses it, so configuration pauses or lease/contention deferrals do not return an attempt. Scanner-disabled queues pause before claiming. Synchronous scanner-disabled behavior is deliberately preserved.

Before work and publication verify durable request/digest/checklist binding. Honor a job admitted before the deadline even after natural collection expiry; a durable acknowledgement is a promise to finish. Binding drift or waived slots cancel before external work; uncertain side effects require attention. Job/staging/slot lease takeover must respect the same authoritative token and deadline; stop on loss before further writes.

Reuse the bounded staging loader and materials finalizer. A clean checkpoint binds actual loaded SHA256 and scan policy version, is persisted under the job lease before Graph, and is reused only after bytes are verified again. Infected or inconclusive results cannot become clean checkpoints. No new registry/public link is published before a clean scan.

Background uploads use a staging-ID-specific subfolder beneath the existing slot folder, retaining the canonical filename. Retries of the same staging identity use the same destination. The previous item remains intact. The staff folder reader stays nonrecursive and merges only current Ready registry links; known superseded portal root items are suppressed by exact drive/item identity, while manual root files remain visible. The five generic internal recursive document readers opt into pruning `portal-<UUID>` children of the canonical Site Visit materials folders, so unregistered candidates and prior background copies do not enter those lists. Focused source/callsite regressions passed (`785017d32`); Fable approved the L1/L2/L3 corrections on October 2.

Recover consumed staging receipts without rereading already-deleted Blob bytes. Preserve generation-key/candidate reconciliation; do not promise exactly-once SharePoint version creation across a crash before receipt persistence.

Automatic processing is bounded to two hours and eight attempts. Deadline exhaustion with no clean checkpoint/candidate can fail safely; evidence of possible external writes holds `needs_attention`. The exact-job operator command supports inspect and guarded retry/cancel. Production mode uses the fixed local-shell `MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL`, explicit host/database confirmations, verified TLS, and in-transaction database/schema assertions. An explicit retry of an exhausted job starts a fresh two-hour/eight-attempt cycle while preserving staging and candidate identity; it requires an unleased `needs_attention` job, a matching unleased, unconsumed staging owner, and a non-infected failure. **[VERIFIED via local tests and owner-authorized agent Production read-only probe, 2026-10-02.]** The Production probe returned expected `job_not_found` for a deliberately nonexistent UUID after target/TLS checks. No Production recovery mutation was run. Consumed, infected, owner-mismatched, or live-leased jobs remain refused for manual escalation. Admission is live. A paused queue can exceed its two-hour deadline; no new notification email is sent, so operational monitoring remains necessary.

## Cleanup safeguards

Claim expired unowned staging atomically before remote deletion. Preserve consumed status, consumed time and replay receipt. Every selection/claim/candidate-clear/final-update/prune respects the background owner with schema-off-compatible SQL. Keep ownership throughout active/attention and terminal retention; release only with a checked terminal state.

Record Graph ETag in candidates. Never delete an item with a predecessor, its own generation row, or **any** request registry reference matching drive/item, including superseded rows. Lookup outage preserves the receipt. Delete only an unreferenced, predecessor-free candidate with an exact saved ETag. A missing ETag or 412 retains the item and clears the reconciled receipt so it cannot starve cleanup.

Infected Blob bytes are rejected/deleted immediately. Failed clean bytes are retained seven days; terminal job metadata 30 days. Ambiguous attention evidence stays until explicit resolution.

## Invariants and verification

| Invariant | Surfaces | Required evidence |
|---|---|---|
| No false 202 | finalize, job store, staging | failed commit/duplicate enqueue tests |
| One owner and safe cleanup | job store, staging SQL | real local PostgreSQL two-connection races |
| One active checklist replacement | job unique index, Ready | same-slot cross-collection and Ready/admit races |
| Crash recovery is bounded | worker, job store | lease takeover, attempts/deadline, consumed replay |
| Previous file survives partial save | finalizer, cleanup, staff reader | distinct destination, reference/ETag guards, uncommitted candidate hidden |
| Scan precedes publication | finalizer, checkpoint | infected/error/off and hash/policy mismatch tests |
| Every reader tells the truth | context, batch summary, cards, reminder, Ready | all statuses, unavailable reads, closed collection |
| Rollout is additive | gates, SQL | schema-off no new queries; admission-off drain continues |
| UI has no stale updates | page and cards | refresh, lost202, hidden/unmount/tokenchange,429 |

Run focused unit/UI tests and real local PG16 tests, required CI integration job, relevant route/Atlas/migration/fact/writer gates and sequential self-tests. Run the 499 MiB local memory harness if shared byte loading changes. No project-provider credentials or remote data are used in local tests. Real 500 MB provider/browser rehearsal is parked; it is not a normal-use release blocker.

Parent orchestrates Luna builders, Sol review, parent final review and Fable adversarial OAuth review. After two substantive rounds, parent takes over small residual fixes to avoid review churn. Deliver a reviewed tested PR; do not merge while the owner is away.

## Historical local and base-release validation — 2026-10-01/02

[VERIFIED via local command results] Full Jest coverage run: 1,198 suites, 19,095 tests and five snapshots passed; seven suites / 112 tests skipped. The seven required PostgreSQL suites were run separately against a disposable loopback PostgreSQL 16 database and passed all 112 tests, including 14 materials queue ownership/race tests. An additional admission-route suite added afterward passed all 13 cases. No provider credentials were used by these tests.

All 42 CI gate commands passed locally, with gate/self-test pairs run sequentially. Whole-repository lint passed with zero errors and 134 warnings. The production webpack build passed. The default local Turbopack build could not traverse this worktree's external node_modules symlink; CI with a normal dependency installation must verify the default build.

The 499 MiB synthetic upload harness passed all seven byte/hash/range/scanner-framing scenarios. Optimized peak RSS was approximately 699 MiB for one upload, 704 MiB for a timeout/retry, and 1,209 MiB for two admitted uploads processed serially. This is local memory evidence, not a live transfer at the exact 500 MB cap.

Sol's final review found no remaining material code blocker; parent final review corrected optional-Other queue contention, safe error projection and staff status classification. Fable's first adversarial pass required a safe unavailable-status projection and matching held-slot reminder previews. Both were fixed in `e50da1c3c` and approved in the bounded second pass; Fable reran the two suites / 40 tests successfully. The base feature and activation follow-ups are deployed; background admission is enabled.

**Historical CI receipt (PR #402):** GitHub Actions run 36961661350 passed on prior head `837729b4e280317a3e20f93a377bf2947bd358a9`: 1,199 suites, 19,110 tests, five snapshots, and seven PostgreSQL suites with 114 tests. The current deployment and subsequent merged follow-ups are recorded in “Production activation and first-job verification” above.

## Final review disposition

[VERIFIED via OAuth Fable review, Sol review and parent source inspection at prior head `837729b4e`] Fable's verdict on that implementation is **APPROVE FOR PR**, explicitly not production activation approval. That review approved the staff status helper suppressing unavailable summaries instead of falsely claiming an invitation was not sent, and reminder preview/send excluding the same active-job slots. The L1/L2/L3 fixes recorded above passed source/unit/PG checks and Sol/parent review, and Fable approved them. PR #402 final CI passed 1,204 suites, 19,529 tests, five snapshots, and seven PostgreSQL suites with 114 tests. This approval and CI evidence applies to the merged base, not the new activation follow-ups below.

[VERIFIED via local PostgreSQL 16] Commit `16f17e5ab` adds real-helper proofs that cleanup preserves an expired attention-owned staging row without calling Blob deletion, and schema-off claim/candidate/release/complete/reject/cleanup works against migrations 031–044 without migration 060. Commit `2c7d1f1c9` adds actual-CLI exhausted-retry and guarded-recovery cases plus real cleanup/prune assertions; the focused PG suite passes 16 tests. The prior concurrency case is explicitly a cleanup-lock-wins interleaving, not a bidirectional race proof. Parent reviewed the tests; Fable approved the L1/L2/L3 corrections on October 2.

The base background-processing code and the guarded recovery/reader follow-ups are Production-deployed in merge `8fb8a6d83`. Admission is enabled. The first real job completed on attempt 1 with its staging receipt consumed; no recovery mutation was needed. The exact 500 MB live transfer remains unverified and parked, not a normal-use release blocker. The owner declined another simultaneous-large background test on October 2: the expected set is one large PPTX, a usually smaller PDF, and a text document. Reopen stress testing only if usage or failures warrant it.

## October 2 follow-up disposition

[VERIFIED via Fable OAuth report] Fable approved all three corrections through `2c7d1f1c9`, with no material defect. Parent also applied Fable's same-option recommendation to Grant Reporting's recursive picker, the fifth reader, with a caller regression. Shared walker tests prove the excluded folders are present and unrelated folders remain. Factory source/census walks intentionally retain complete inventories and are outside these generic application readers.

PR #404, #407, and #410 are merged; the operator recovery path, exact-root reader filter, scan-rejection diagnostics, and upload progress copy are deployed in `dpl_2AacXcc5YQX9dNvJ4gMn4PpGtWWN`. Schema readiness, admission, and scanning are enabled. The first real background upload completed successfully. PR #405 merged as `1df8a33e2` after all current-head CI checks passed; PR #413 merged as `81dad17e2`. Both are included in Ready Production deployment `dpl_7zi1no5HrxgrPbCQo18Lsi1NM5CZ` at commit `b223dad7d` (October 2 final deployment readback and Git ancestry checks). Monitoring remains a release operation because the worker sends no automatic email. The exact 500 MB live transfer remains unverified and parked, not a normal-use release blocker. The owner declined another simultaneous-large background test on October 2: the expected set is one large PPTX, a usually smaller PDF, and a text document. Reopen stress testing only if usage or failures warrant it.
