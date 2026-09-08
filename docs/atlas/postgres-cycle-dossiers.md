---
title: Postgres Cycle Dossier
domain: cycle-dossier
kind: source-of-truth
status: source-built
summary: "Source-built D26 Cycle Dossier pilot state: five Postgres tables hold private workflow state and JSON checkpoints; artifact bytes use the dedicated private Blob store."
canonical: true
cataloged: 2026-09-07
owner: product-engineering
last_verified: 2026-09-07
related:
  - docs/CYCLE_DOSSIER_PILOT_DESIGN.md
  - lib/db/migrations/038_cycle_dossiers.sql
  - lib/services/cycle-dossier-store.js
  - lib/services/cycle-dossier-storage.js
---

# Postgres Cycle Dossiers

**[VERIFIED 2026-09-07 via migration 038, source files, and branch-local service reads]** These five tables are source-built on branch `codex/cycle-dossier-pilot-build`. No live migration, Blob provisioning, prompt seeding, generation, or unattended cron activation is claimed here.

| Table | Owner / scope | Stored state | Retention and write contract |
|---|---|---|---|
| `cycle_dossiers` | `owner_profile_id`, one D26 dossier per owner | Current private selection and latest edition pointer | Upserted for the owner; private app state |
| `cycle_dossier_previews` | `owner_profile_id`, linked dossier | Expiring preview JSON: selected roster, frozen input/config refs and cost estimate | 30-minute expiry; preview payload is bounded and references retained inputs |
| `cycle_dossier_entries` | Shared request entry, `created_by` attribution | Immutable revision JSON, including frozen source/config/provenance and artifact refs | Ready revisions are reusable by superusers; new generations append revisions |
| `cycle_dossier_runs` | `owner_profile_id`, linked dossier | One global run lease plus independently checkpointed item state, reservations, pauses, retries, and assembly refs | Queue/drain state; retries create a new run and preserve prior charge history |
| `cycle_dossier_editions` | `owner_profile_id`, linked run/dossier | Private edition cut JSON and immutable combined document refs | One row per `(run_id, cut_key)`; ready editions are owner-private |

The tables store JSONB metadata and checkpoint references. The dedicated `DOSSIER_BLOB_RW_TOKEN` store owns the bytes; exact persisted pathnames and SHA-256/size checks are required for reads. Cleanup of expired previews and unreferenced artifacts remains a planned exact-reference operation; no prefix deletion is implied.

The run model is intentionally bounded: one global run lease claims three request jobs, and the worker advances one LLM stage per cron invocation with an absolute deadline. A pause or lease loss is a checkpoint boundary. Literature transport and document rendering may finish their current bounded stage, but a new provider call requires a fresh lease/authorization check.

## Current lifecycle truth

- **Source-built:** migration and service contracts exist on the current branch.
- **Not live-provisioned:** no existing populated database migration has been run from this branch.
- **Not activated:** private Blob token, feature flag, prompt publication, generation, and unattended cron are separate rollout steps.
