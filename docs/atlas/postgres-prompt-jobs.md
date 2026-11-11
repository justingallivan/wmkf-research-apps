---
title: Shared Executor job ledger
status: branch-built
last_verified: 2026-11-11
---

# Shared Executor job ledger

**[VERIFIED 2026-11-10 via migration 097 in isolated PostgreSQL 16 and the real SQL integration suite]** The branch implements the ledger for the synthetic trial. Migration 097 is in the manifest that both the existing-database migration runner and fresh bootstrap consume. [VERIFIED via staff service and store branch source] The staff proposal draft path reuses migration 097 and its six tables. Live schema, activation, and integrated staff-trial verification are pending.

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

The store caps source/response retention at seven days and configuration/result/audit/publication retention at thirty days. The staff trial freezes stricter deadlines at admission: 24 hours for source/response content and seven days for configuration/results. Polling does not extend these deadlines. Shared validators cap raw extracted document text at 256 KiB per document and in aggregate. The store caps canonical snapshots at 4 MiB, response checkpoints at 256 KiB, and validated results at 128 KiB. It rejects expired content reads, verifies hashes and byte size, and exposes bounded `expireContent` for exact row deletion. The unscheduled staff drain invokes bounded expiry for the exact configured scope before checking current actor access. Disabled or malformed policy cannot run cleanup. An operational cleanup run remains pending. Content expiry leaves job, attempt, audit and idempotency receipts intact. Receipt references survive content deletion. Content bytes do not appear in the ledger status read. The read-only candidate inspection did not exercise the ledger. The staff trial awaits suitable source confirmation, live execution, and model-cost approval.

The PostgreSQL suite applies the exact migration to a randomized loopback schema. It covers racing admission/claims and initialization slots, immutable configuration and snapshot, protected staff content, response recovery, audit and writeback uncertainty, stale completion, original-ETag conflicts, and replay tombstones after content expires. This is the synthetic baseline. Integrated verification of the staff additions is pending. Real provider, live audit transport, Dataverse, PA authorization, operational recovery, and production worker scheduling are outside this ledger proof.
