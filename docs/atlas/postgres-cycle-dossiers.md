---
title: Postgres Cycle Dossier
domain: cycle-dossier
kind: source-of-truth
status: source-built
summary: "Source-built D26 Cycle Dossier pilot state: six Postgres tables hold private workflow state, JSON checkpoints, and a durable operator stop; artifact bytes use the dedicated private Blob store."
canonical: true
cataloged: 2026-09-07
owner: product-engineering
last_verified: 2026-09-07
related:
  - docs/CYCLE_DOSSIER_PILOT_DESIGN.md
  - lib/db/migrations/045_cycle_dossiers.sql
  - lib/services/cycle-dossier-store.js
  - lib/services/cycle-dossier-storage.js
---

# Postgres Cycle Dossiers

**[VERIFIED 2026-09-07 via migration readback, fresh-install shape, source files, and branch-local service reads]** These six tables are source-built on branch `codex/cycle-dossier-pilot-build`; migration 045 is applied and verified. The private store `wmkf-cycle-dossier-private` (`store_W9WC1TLR7kpl9hty`) is connected under the custom `DOSSIER_BLOB` prefix in all environments, and both governed prompts are published at version 1 with successful readback. The feature remains disabled; no generation or SharePoint artifact publication is claimed.

| Table | Owner / scope | Stored state | Retention and write contract |
|---|---|---|---|
| `cycle_dossiers` | `owner_profile_id`, one D26 dossier per owner | Current private selection and latest edition pointer | Upserted for the owner; private app state |
| `cycle_dossier_previews` | `owner_profile_id`, linked dossier | Expiring preview JSON: selected roster, frozen input/config refs and cost estimate | 30-minute expiry; preview payload is bounded and references retained inputs |
| `cycle_dossier_entries` | Shared request entry, `created_by` attribution | Immutable revision JSON, including frozen source/config/provenance and artifact refs | Ready revisions are reusable by superusers; new generations append revisions |
| `cycle_dossier_runs` | `owner_profile_id`, linked dossier | One global run lease plus independently checkpointed item state, reservations, pauses, retries, and assembly refs | Queue/drain state; retries create a new run and preserve prior charge history |
| `cycle_dossier_control` | Singleton operator control row | Durable global stop signal, reason, operator, and update time | Created with `stop_requested=false`; the superuser operator action sets the stop and pauses queued/running runs |
| `cycle_dossier_editions` | `owner_profile_id`, linked run/dossier | Private edition cut JSON and immutable combined document refs | One row per `(run_id, cut_key)`; ready editions are owner-private |

The tables store JSONB metadata and checkpoint references. The dedicated `DOSSIER_BLOB_READ_WRITE_TOKEN` store owns the bytes; exact persisted pathnames and SHA-256/size checks are required for reads. Cleanup of expired previews and unreferenced artifacts remains a planned exact-reference operation; no prefix deletion is implied.

The run model is intentionally bounded: one global run lease claims three request jobs, and the worker advances one LLM stage per cron invocation with an absolute deadline. A pause, durable operator stop, or lease loss is a checkpoint boundary. Literature transport and document rendering may finish their current bounded stage, but a new provider call or SharePoint mutation requires a fresh control, lease, and authorization check.

## Current lifecycle truth

- **Source-built:** migration and service contracts exist on the current branch.
- **Provisioned and verified:** migration 045, the dedicated private store connection, and prompt v1 publication/readback are complete; the managed token has been authenticated in Development.
- **Not activated:** `CYCLE_DOSSIER_ENABLED` remains disabled; production/Preview token runtime, generation, SharePoint artifact publication, unattended cron, deployment, and promotion remain pending controlled preflight and smoke.
