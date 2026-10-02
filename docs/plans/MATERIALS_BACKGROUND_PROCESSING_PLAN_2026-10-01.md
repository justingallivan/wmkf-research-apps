---
title: Applicant materials background processing
kind: plan
status: active
last_verified: 2026-10-01
---

# Applicant materials background processing

[SOURCE-BUILT; final adversarial review and full validation underway] Applicant Site Visit / Research Presentation uploads will return after the private Blob transfer and a durable Postgres admission transaction. A scheduled worker will scan and save the file. This branch does not authorize production migration, flag changes, merge, deployment, or provider rehearsal. Consultant Feedback and other upload workflows retain synchronous processing and the shared configurable 500 MB cap.

## Evidence and review decisions

[VERIFIED via source at main `499d9e29a`] Reviewer acceptance uses a deployed job-ledger pattern (`reviewer-acceptance-job-service.js`, `reviewer-acceptance-drain.js`). Reuse its claim, fencing and retry approach; do not reuse its payload or table. The parked intake drain is not the dependency.

[VERIFIED via source] Materials finalization currently waits for Blob read, validation, scanning, SharePoint and registry persistence. Staging has actor/scope/request binding, candidate receipts and consumed replay. Cleanup previously selected expired rows before remote deletion, leaving a race with finalize. Checklist SharePoint replacement used the same canonical item before the registry write, risking changes to the previously received file on partial failure.

Claude Fable reviewed the plan twice through the Claude Code OAuth/subscription session. The second verdict permits building after two corrections: preserve the existing synchronous scan-disabled contract, and protect Graph items referenced by registry rows in **any** lifecycle state. Sol additionally found the replacement-overwrite risk; the parent accepted separate per-staging folders for background uploads. No third cosmetic plan loop is required. Final implementation still requires Sol, parent and Fable adversarial review.

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
- Deploy schema-capable code first; apply migration through `scripts/apply-migrations.js`; enable schema and verify the worker; then enable admission. These are future release steps, not performed in this build. Disable admission and drain/resolve all jobs before any rollback to code unaware of the ownership column.

## Worker and recovery

One job per cron invocation, every minute, with an explicit 300-second route budget. Acquire process memory admission before claiming. A 360-second authoritative job lease fences staging and downstream mutations. Claim increments attempts so crashes count; give back an attempt only when no provider/byte work occurred (configuration pause or lease contention). Scanner-disabled queues pause before claiming. Synchronous scanner-disabled behavior is deliberately preserved.

Before work and publication verify durable request/digest/checklist binding. Honor a job admitted before the deadline even after natural collection expiry; a durable acknowledgement is a promise to finish. Binding drift or waived slots cancel before external work; uncertain side effects require attention. Job/staging/slot lease takeover must respect the same authoritative token and deadline; stop on loss before further writes.

Reuse the bounded staging loader and materials finalizer. A clean checkpoint binds actual loaded SHA256 and scan policy version, is persisted under the job lease before Graph, and is reused only after bytes are verified again. Infected or inconclusive results cannot become clean checkpoints. No new registry/public link is published before a clean scan.

Background uploads use a staging-ID-specific subfolder beneath the existing slot folder, retaining the canonical filename. Retries of the same staging identity use the same destination. The previous item remains intact. Staff folder reads stay nonrecursive and merge only current Ready registry links; known superseded portal root items are suppressed by exact drive/item identity, while manual root files remain visible. Do not recursively expose unregistered candidates.

Recover consumed staging receipts without rereading already-deleted Blob bytes. Preserve generation-key/candidate reconciliation; do not promise exactly-once SharePoint version creation across a crash before receipt persistence.

Automatic processing is bounded to two hours and eight attempts. Deadline exhaustion with no clean checkpoint/candidate can fail safely; evidence of possible external writes holds `needs_attention`. An exact-job operator command supports inspect and guarded retry/cancel only without a live worker lease. Preserve candidate/generation identity and bounded retry. No live operator command is run during development. [BUILD LIMITATION] The operator CLI currently accepts loopback databases only and refuses retry of a consumed receipt. Automatic approval review rejected expanding it to remote mutations and removing that safeguard as outside the authorized local operational scope. A production recovery path therefore requires separate authorization before release; the build does not claim that operational prerequisite is complete.

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

Run focused unit/UI tests and real local PG16 tests, required CI integration job, relevant route/Atlas/migration/fact/writer gates and sequential self-tests. Run the 499 MiB local memory harness if shared byte loading changes. No project-provider credentials or remote data are used in local tests. Real 500 MB provider/browser rehearsal remains a release task.

Parent orchestrates Luna builders, Sol review, parent final review and Fable adversarial OAuth review. After two substantive rounds, parent takes over small residual fixes to avoid review churn. Deliver a reviewed tested PR; do not merge while the owner is away.
