---
title: Shared Executor synthetic job ledger
status: branch-built
last_verified: 2026-11-11
---

# Shared Executor synthetic job ledger

**[VERIFIED 2026-11-10 via migration 097 in isolated PostgreSQL 16 and the real SQL integration suite]** The branch implements the ledger for the synthetic trial. Migration 097 is in the manifest that both the existing-database migration runner and fresh bootstrap consume. No live schema or enabled caller is asserted.

| Table | Persisted contract |
| --- | --- |
| `prompt_jobs` | Environment, authenticated principal key, separate authorization scope, Request ID, caller-command hash, source-event ID, retention, snapshot hash/reference, original Request ETag, and monotonic version. Unique environment/principal/idempotency key. |
| `prompt_job_tasks` | Frozen prompt/profile/configuration hashes, reviewed model, task key, generation and writeback states, and validated-result reference. One row per task key in a job. |
| `prompt_job_attempts` | Durable dispatch intent, attempt number, stable audit-run ID, response and audit references, numeric usage and completeness, and safe error code. Uncertain attempts remain fenced. |
| `prompt_job_initializations` | One active slot per environment/Request/fixture field. Captures blankness and content hash under the job's original ETag. A known terminal pre-publication failure can release a slot while preserving history. |
| `prompt_job_publications` | One physical operation per initialization job, with original ETag, immutable payload hash/reference, contributing task and reservation IDs, and dispatch outcome. |
| `prompt_job_content` | Bounded temporary JSON payloads for configuration, source, normalized response, validated result, audit and exact publication. Stores the SHA-256, byte count and expiry for each immutable row. |

## Ownership and transitions

The server-only `createPromptJobStore(pool)` requires an injected PostgreSQL pool. The caller owns principal, Request, source and destination authorization, including replay. Admission accepts only the synthetic `test` environment and the two fixture tasks. The Executive Summary and Methodology task keys bind to the synthetic fields `fixture_summary` and `fixture_methodology`; these are fixture labels. The store computes canonical prompt and profile hashes, checks the pinned profile identity, and binds the same authorization scope and Request ID into all configurations and the snapshot. The job, task configurations and initialization reservations commit together.

Claim uses a transaction advisory lock plus a partial unique per-Request lease index. An expired provider, audit or publication dispatch becomes unknown before the next claim proceeds. The old lease cannot checkpoint or complete it. A saved response is attached in the same transaction as the response state, and validation and its audit payload have a separate atomic checkpoint. An unresolved provider or publication blocks a competing job on that Request. An unknown provider also blocks a new sibling dispatch within the job. A conflict or unknown publication retains the original ETag and slots and cannot dispatch again. A change in source event, prompt revision or staff-cleared field does not reopen a retained slot.

A second initialization job cannot capture its Request ETag while an earlier initialized job has pending writeback, including a different field or a slot released by a failed sibling. It waits across worker ticks and captures the new ETag after the earlier publication settles.

Audit exceptions are unknown unless the adapter explicitly proves a definitive rejection. Neither unknown nor failed delivery is automatically resent, and both block publication. A publication waits for all tasks to reach a known terminal generation state and cannot proceed while a contributing audit dispatch is in flight or uncertain. It coalesces eligible validated outputs into one immutable command and records the contributing IDs. Confirmed outcomes update all contributing task receipts together. Draft-only work has no Request writeback. Known pre-dispatch or validation failures release only their eligible slots before a physical publication exists. A field already holding staff content stays protected.

## Retention and verification

The synthetic store caps source/response retention at seven days and configuration/result/audit/publication retention at thirty days. It rejects expired content reads, verifies hashes and byte size, and exposes bounded `expireContent` for exact row deletion. No cleanup schedule or receipt purge is wired in this branch increment. Receipt references survive content deletion. Content bytes do not appear in the ledger status read. Temporary text is bounded per row and may need earlier expiry or different storage before real requests are enabled.

The PostgreSQL suite applies the exact migration to a randomized loopback schema. It covers racing admission/claims and initialization slots, immutable configuration and snapshot, protected staff content, response recovery, audit and writeback uncertainty, stale completion, original-ETag conflicts, and replay tombstones after content expires. Real provider, audit transport, Dataverse, PA authorization, operational recovery and production worker scheduling are outside this ledger proof.
