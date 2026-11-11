---
title: Shared Executor job ledger
status: branch-built
last_verified: 2026-11-11
---

# Shared Executor job ledger

**[VERIFIED 2026-11-10 via migration 097 in isolated PostgreSQL 16 and the real SQL integration suite]** The branch implements the ledger for the synthetic trial. Migration 097 is in the manifest that both the existing-database migration runner and fresh bootstrap consume. [VERIFIED via staff service and store branch source] The staff proposal draft path reuses migration 097 and its six tables. Local staff-trial verification passed. **[VERIFIED 2026-11-11 via canonical migration and live service admission]**
The configured application Postgres database applied exactly 097. The
owner-approved, process-scoped `local-production` trial admitted one
Request 1003384 draft job using these tables. It retained one format-validated
summary, rejected the truncated Methodology, delivered both audits, and
settled at `needs_attention`. A separately approved second cohort used both v2 tasks, retained the validated summary, rejected the over-limit Methodology and also settled at `needs_attention` with both audits delivered. The HTTP routes remain undeployed. [Trial receipt](../plans/SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md#authorized-live-trial).

| Table | Persisted contract |
| --- | --- |
| `prompt_jobs` | Environment, authenticated principal key, separate authorization scope, Request ID, caller-command hash, source-event ID, retention, snapshot hash/reference, original Request ETag, and monotonic version. Unique environment/principal/idempotency key. |
| `prompt_job_tasks` | Frozen prompt/profile/configuration hashes, reviewed model, task key, generation and writeback states, and validated-result reference. One row per task key in a job. |
| `prompt_job_attempts` | Durable dispatch intent, attempt number, stable audit-run ID, response and audit references, numeric usage and completeness, and safe error code. Uncertain attempts remain fenced. |
| `prompt_job_initializations` | One active slot per environment/Request/fixture field. Captures blankness and content hash under the job's original ETag. A known terminal pre-publication failure can release a slot while preserving history. |
| `prompt_job_publications` | One physical operation per initialization job, with original ETag, immutable payload hash/reference, contributing task and reservation IDs, and dispatch outcome. |
| `prompt_job_content` | Bounded temporary JSON payloads for configuration, source, normalized response, validated result, audit and exact publication. Stores the SHA-256, byte count and expiry for each immutable row. |

## Ownership and transitions

The server-only `createPromptJobStore(pool)` requires an injected PostgreSQL pool. The caller owns principal, Request, source and destination authorization, including replay. Synthetic admission accepts the two fixture tasks in the `test` environment. The Executive Summary and Methodology task keys bind to the synthetic fields `fixture_summary` and `fixture_methodology`; these are fixture labels. The store computes canonical prompt and profile hashes, checks the pinned profile identity, and binds the same authorization scope and Request ID into all configurations and the snapshot. The job, task configurations and any initialization reservations commit together.

The staff proposal trial admits both proposal task keys together in `generate-draft` only. It binds a trial UUID, one current Superuser, one Request and an allowed target/deployment class. Within the shared database an advisory lock serializes the cohort across environments and principals. The transaction checks exact idempotency replay before rejecting a second job in that cohort. Proposal jobs carry no destination field, initialization reservation, or publication command. Task configurations retain the exact profile/prompt pins, actor, and a source manifest of IDs and hashes. The source snapshot contains the bounded extracted proposal and PI name.

Staff status and result reads require environment, principal, authorization scope and Request, plus the job ID for individual reads. The status projection exposes safe states, error codes and availability. The separate result projection checks integrity and expiry and returns only available validated draft text. Reads leave leases and job versions unchanged. The server-selected worker rechecks policy and actor and uses the same provider, response and audit fences. It can write a content-free Dataverse AI-run via required actor impersonation. It does not write Request fields.

Claim uses a transaction advisory lock plus a partial unique per-Request lease index. An expired provider, audit or publication dispatch becomes unknown before the next claim proceeds. The old lease cannot checkpoint or complete it. A saved response is attached in the same transaction as the response state, and validation and its audit payload have a separate atomic checkpoint. An unresolved provider or publication blocks a competing job on that Request. An unknown provider also blocks a new sibling dispatch within the job. A conflict or unknown publication retains the original ETag and slots and cannot dispatch again. A change in source event, prompt revision or staff-cleared field does not reopen a retained slot.

A second initialization job cannot capture its Request ETag while an earlier initialized job has pending writeback, including a different field or a slot released by a failed sibling. It waits across worker ticks and captures the new ETag after the earlier publication settles.

Audit exceptions are unknown unless the adapter explicitly proves a definitive rejection. Neither unknown nor failed delivery is automatically resent, and both block publication. A publication waits for all tasks to reach a known terminal generation state and cannot proceed while a contributing audit dispatch is in flight or uncertain. It coalesces eligible validated outputs into one immutable command and records the contributing IDs. Confirmed outcomes update all contributing task receipts together. Draft-only work has no Request writeback. Known pre-dispatch or validation failures release only their eligible slots before a physical publication exists. A field already holding staff content stays protected.

## Typed recommendations fixture

[VERIFIED via branch source and loopback PostgreSQL] The fixture adds no
tables or persisted states. A `test` job under `expertise-fixture:<lowercase GUID>`
admits exactly one `expertise.recommendations` draft task and has no
destination or publication reservation. Configuration freezes the roster
fingerprint and may pin a versioned source identity proof. Admission
validates the proof shape. Snapshot persistence checks it against the
sealed snapshot's ordered document metadata. The private roster is part of the v2 sealed snapshot and
expires with source content. The v2 response checkpoint remains private.
The worker atomically attaches the `{contractVersion,result}` envelope
and the deferred audit through the existing attempt fence.

`readValidatedRecommendations` requires environment, principal, authorization
scope, Request and job identity. It checks result kind, retained expiry,
hash, byte size and envelope. The Executor already ran domain validation
against the frozen roster before persistence. The internal reader can
return an unexpired validated result after source cleanup. It does not
assert current source or roster freshness. The offline facade uses
`readRecommendationState` under the same owner predicates plus the fixture
app owner, sole task, draft operation and no-writeback guards. Status reads
only receipt and TTL metadata. For a retained result, the facade can read
the hash-checked proof from configuration after source cleanup. It compares
current fabricated observations before reading and projecting the result.
A database clock sample plus monotonic elapsed time fences expiry across
the final authorization check. The text reader and fixture publication
consume text only. Production staff delivery remains planned. Separate Sandbox read-only
accessors use the existing ledger rows with exact environment, app
principal, authorization scope, Request and job predicates. The read facade
checks the fixed draft-only task, retained compatible configuration and
target-bound `ai-materials-combined-pdf-v1` proof before observing source
or roster. Fixture proof cannot support a Sandbox payload. This read
path adds no tables, admission or dispatch. [Shared task interfaces](../plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md).

## Local Sandbox recommendations trial

[VERIFIED via branch source at `2a0f4d6bd` and loopback PostgreSQL]
The local, default-off operator trial reuses the six migration 097 tables.
Admission pins the configured PostgreSQL cluster and database. The same
transaction takes a Sandbox singleton advisory lock, checks exact replay,
and counts every `expertise.recommendations` job across `local-sandbox`
and `preview-sandbox` regardless of state, cohort or app. Fixture jobs
are outside the predicate. The sole draft task carries a typed v2 seal
and checkpoint, one fenced dispatch attempt and no field reservation.
A response saved before an unavailable currentness or access check can
recover only through explicit zero-call validation.

Configuration, results and audit outbox content expire after seven days.
Source and response content expire after 24 hours. The bounded cleanup
checks the pinned database, exact job, owner tuple and task before
deleting expired content. Receipts remain and continue to count against
the singleton. Operator cleanup and live admission evidence are pending.
[Local trial contract](../plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md#local-sandbox-recommendations-trial).

## Synthetic safeguard follow-up (2026-11-11)

[VERIFIED via branch store, Executor, and worker source] The follow-up
uses existing state values and migration 097. Explicit dispatch
authorization/freshness denial ends a queued task with
`failed_pre_dispatch` / `dispatch_denied`. A confirmed provider rejection
after dispatch intent revokes the attempt as `failed_pre_dispatch` /
`provider_rejected`. Eligible initialization slots release in the same
fenced mutation. The attempt keeps audit state `none`, so this outcome
creates no Dataverse AI-run row. The Executor's `paidCall:true` indicates
a response or confirmed rejection. Billing is a separate provider fact.
Ambiguous outcomes enter `unknown` and preserve the reservation. If the
deadline expires during the final pre-provider authorization/freshness
check, the worker returns `waiting` without creating an attempt.

An oversized canonical snapshot records `snapshot_too_large` on queued
tasks and releases eligible slots. A subsequent tick returns
`needs_attention` without rerunning preparation or dispatching. The Executor saves a bounded marker
with available usage when a response exceeds its canonical checkpoint
limit. Its parser and checkpoint recovery classify the marker as
`failed_validation` / `profile_response_too_large`. Both cases are terminal
for the affected task; the worker never regenerates from that marker.

## Retention and verification

The store caps source/response retention at seven days and configuration/result/audit/publication retention at thirty days. The staff trial freezes stricter deadlines at admission: 24 hours for source/response content and seven days for configuration/results. Polling does not extend these deadlines. Shared validators cap raw extracted document text at 256 KiB per document and in aggregate. The store caps canonical snapshots at 4 MiB, response checkpoints at 256 KiB, and validated results at 128 KiB. It rejects expired content reads, verifies hashes and byte size, and exposes bounded `expireContent` for exact row deletion. The unscheduled staff drain invokes bounded expiry for the exact configured scope before checking current actor access. Disabled or malformed policy cannot run cleanup. The two Request 1003384 cohorts each have scoped source/response and configuration/result cleanup deadlines. Physical deletion has not yet been verified. See the [retention receipt](../plans/SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md#scoped-retention-follow-up). Content expiry leaves job, attempt, audit and idempotency receipts intact. Receipt references survive content deletion. Content bytes do not appear in the ledger status read. The owner-uploaded narrative passed read-only preparation, then the approved live trial persisted the hash-matched snapshot for the scoped job.

The PostgreSQL suite applies the exact migration to a randomized loopback schema. It covers racing admission/claims and initialization slots, immutable configuration and snapshot, protected staff content, response recovery, audit and writeback uncertainty, stale completion, original-ETag conflicts, and replay tombstones after content expires. The staff trial also passed the integrated local PostgreSQL suite. See the [staff workflow receipt](../audits/SHARED_EXECUTOR_STAFF_OPUS55_REVIEW_2026-11-11.md#integrated-verification). Real provider, live audit transport, Dataverse, PA authorization, operational recovery, and production worker scheduling are outside this ledger proof.
