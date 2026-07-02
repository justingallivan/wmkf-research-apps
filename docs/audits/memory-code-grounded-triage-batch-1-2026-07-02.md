# Memory Code-Grounded Triage Batch 1 - 2026-07-02

Status: complete for reviewer Postgres-to-Dataverse memory cluster.

## Scope

Read and classified:

- `.claude-memory/project-reviewer-postgres-to-dataverse-migration.md`
- `.claude-memory/project-reviewer-finder-dataverse-entry-path.md`
- `.claude-memory/project-appresearcher-collapse-post-pilot.md`
- `.claude-memory/project-w6-table-drop-closed.md` as supporting closed context

## Code-Grounded Checks

- [VERIFIED] Standalone reviewer finder and retired routes are absent: `pages/reviewer-finder.js`, `pages/api/reviewer-finder/extract-summary.js`, and `pages/api/reviewer-finder/candidates.js` all returned absent via `test ! -f`.
- [VERIFIED] `save-candidates` writes through Dataverse adapters and rejects before adapter writes for unresolved/system-discovered identities: `pages/api/reviewer-finder/save-candidates.js`.
- [VERIFIED] `grant-cycles` is Dataverse-only at the route and service layers: `pages/api/reviewer-finder/grant-cycles.js` and `lib/services/grant-cycles-dataverse.js`.
- [VERIFIED] Migration 018 dropped the canonical reviewer-finder Postgres drain tables and kept `search_cache` out of scope: `lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql`.
- [VERIFIED] Migration 020's `reviewer_find_roster` is operational pre-save working state, not a regression to canonical reviewer identity in Postgres: `lib/db/migrations/020_reviewer_find_roster.sql`.
- [VERIFIED] Bibliometric writes now target `wmkf_potentialreviewerses`: `lib/dataverse/adapters/researcher.js`.
- [VERIFIED] Atlas states `wmkf_appresearcher`, `wmkf_apppublication`, and `wmkf_apppublicationauthor` were dropped S213, with bibliometrics folded onto `wmkf_potentialreviewers`: `docs/atlas/dataverse-wmkf-potentialreviewers.md` and `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md`.

## Classification

| Memory | Classification | Action |
|---|---|---|
| `project-reviewer-postgres-to-dataverse-migration.md` | `CLOSE_HISTORICAL` | Demoted from active to closed. The current live guardrails are narrower memories plus source/Atlas. |
| `project-reviewer-finder-dataverse-entry-path.md` | `KEEP_ACTIVE` | Still earns active status as the focused guardrail for Dataverse-native reviewer-finder entry paths and dropped Postgres reviewer tables. Refreshed `last_verified`. |
| `project-appresearcher-collapse-post-pilot.md` | `KEEP_ACTIVE` | Still earns active status as the focused guardrail for dropped sidecar entities and current bibliometric field placement. Refreshed `last_verified`. |
| `project-w6-table-drop-closed.md` | `KEEP_CLOSED_SUPPORTING` | Already closed; remains the W6 drop closeout pointer. |

## Reconciliation

- Removed `project-reviewer-postgres-to-dataverse-migration` from the live data-model/migration routing list in the reviewer workbench wiki and left it as an explicitly historical pointer.
- Updated the memory-control audit and pending-triage plan so the large S136 migration memory is no longer queued as an untriaged active file.
- No memory files were deleted.

## Residual Risk

This was source/Atlas verification, not a live Dataverse metadata probe. The demotion is still safe because it reduces active routing reliance on the old memory; any destructive table/entity action still requires live probing and Atlas/source verification.
