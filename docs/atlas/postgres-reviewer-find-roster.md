# Atlas: `reviewer_find_roster` (Postgres — operational, source of truth)

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** 2026-07-03 (Contract 5 institution-COI follow-up: migration 023 adds `status='coi_dropped'` as a discovery-time hard-drop ledger; read contract keeps it non-selectable and non-recoverable).
**Live row count:** 0 (new table; no rows until the Workbench Find tab records a search).

## NOT a regression of the S219/migration-018 Dataverse cutover

Migration 018 dropped the **canonical reviewer-identity** Postgres tables (`researchers`, `researcher_keywords`, `publications`, `proposal_searches`, `reviewer_suggestions`), whose source of truth is now Dataverse (`wmkf_potentialreviewer` / `wmkf_appreviewersuggestion`). `reviewer_find_roster` is a different concern: **operational, pre-save, per-request working state** for the Workbench Reviewers→Find tab — un-vetted search discoveries plus their render blobs. It is the same class of object as `search_cache`, which migration 018 deliberately KEPT in Postgres. The canonical saved reviewer pool still lives in Dataverse, untouched. This table is name-keyed because search candidates are name-based and frequently email-less at surface time, whereas the canonical pool is email-keyed.

## Source of truth

**Postgres-primary.** This table IS the source of truth for the Find-tab per-request candidate roster (which candidates a request's searches or applicant-suggested enrichment have surfaced, and their active/excluded/saved disposition for that request). It also stores the discovery-time institution-COI hard-drop ledger (`status='coi_dropped'`) for observability only. The canonical reviewer pool (saved candidates) remains Dataverse `wmkf_appreviewersuggestion`; a candidate flips to `status='saved'` here only as a dedup marker after it is saved to Dataverse via `save-candidates.js` or after an applicant-suggested row is explicitly promoted via `promote-applicant-reviewer.js`.

## Schema (10 columns)

| Column | Type | Notes |
|---|---|---|
| id | bigint (IDENTITY PK) | |
| request_id | uuid | akoya_request GUID (per-request scope) |
| normalized_name | text | `normalizeReviewerName(candidate.name)` — the dedup key |
| display_name | text | surface-time `candidate.name` for re-render |
| status | text | `active` \| `excluded` \| `saved` \| `coi_dropped` (CHECK-constrained) |
| candidate | jsonb | pruned render DTO (only `CandidateCard`-rendered fields, not raw enrichment internals). Applicant-suggested enrichment rows carry `enrichedProposalKey` (`library::folder::name`) so the UI can restore only same-proposal enrichment. Institution-COI ledger rows carry a compact blob with `hasInstitutionCOI` and `institutionCOIDetails` (`piInstitution`, reviewer affiliation, drop stage/source). |
| source_kind | text | Provenance kind: `cited_reference` \| `proposal_named` \| `applicant_suggested` \| `literature_retrieved` \| `grounded_seed` \| `barred_parametric`. Legacy rows may hold `claude_verified` or `database`; reads normalize those to a `provenance` DTO without rewriting the row. |
| first_seen_at | timestamptz | |
| updated_at | timestamptz | |

Indexes: `uq_reviewer_find_roster_req_name` UNIQUE `(request_id, normalized_name)` (the dedup key) + `idx_reviewer_find_roster_req_status (request_id, status)`.

**Status semantics:** `active` = surfaced & available (selectable list) · `excluded` = staff set-aside (collapsed recoverable section) · `saved` = graduated to the Dataverse pool (not rendered on Find, kept for dedup) · `coi_dropped` = discovery-time institution-COI hard-drop ledger (not rendered as selectable, not recoverable/promotable). The cross-run dedup union = **all roster names for the request, every status**. `recordSurfaced` never downgrades `excluded`/`saved`/`coi_dropped` → `active` (curation and hard-drop ledgers win) and enforces a per-request row cap (oldest `active`/`saved` evicted; never `excluded` or `coi_dropped`).

**Provenance semantics:** `candidate.provenance` is the durable render DTO for origin/grounding (`kind`, ordered `sources[]`, `seedRole`, `groundingWorkIds[]`). `source_kind` is a queryable copy of `provenance.kind`, not a Claude-vs-database flag. During the migration window, candidate JSON also keeps legacy `source`, `sources`, and `isClaudeSuggestion` fields for downstream compatibility.

## Read paths

- `lib/services/reviewer-roster-store.js` `listForRequest(requestId)` — the only reader. Surfaced via `pages/api/workbench/reviewer-roster.js` GET, consumed by `shared/components/reviewers/ReviewerSearchSection.js` (roster load-on-mount → active/excluded render + the dedup name union fed into `/analyze` + `/discover`; applicant-suggested active rows with a matching `enrichedProposalKey` restore the Find tab without re-running `/api/workbench/enrich-recommended`). `coi_dropped` rows are excluded from active/excluded render buckets and contribute only through `allNames`.

## Write paths

- `lib/services/reviewer-roster-store.js` only: `recordSurfaced` (bulk upsert `active`, never-downgrade guard, row cap), `recordCoiDropped` (bulk upsert `coi_dropped`, compact hard-drop ledger, never overwrites active/excluded/saved rows), `setExcluded` (upsert → `excluded`), `promote` (`excluded`→`active`), `markSaved` (active/saved → `saved`).
- `pages/api/workbench/reviewer-roster.js` (POST/PATCH), driven by `ReviewerSearchSection` actions (record-on-results, Exclude, Promote, save-graduation after `save-candidates`, applicant-promotion graduation after `promote-applicant-reviewer`).
- `pages/api/workbench/enrich-recommended.js` records applicant-suggested enrichment output directly via `recordSurfaced(requestId, prunedCandidates)` as `status='active'`, stamped with `candidate.enrichedProposalKey`.
- `pages/api/reviewer-finder/discover.js` records institution-COI candidates dropped by Track A verified discovery and referred-seed discovery as `status='coi_dropped'`. `lib/services/discovery-service.js` returns Track B institution-COI drops to the route for the same request-scoped write.

## Cross-system

No Dataverse equivalent — operational/ephemeral by design. Crossing points: a candidate saved via `save-candidates.js` lands in Dataverse `wmkf_appreviewersuggestion` (canonical) and is independently flipped to `status='saved'` here as a dedup marker; an applicant-suggested row promoted via `promote-applicant-reviewer.js` flips the existing Dataverse junction row to `wmkf_selected=true` and is also marked `status='saved'` here. The two stores are not transactionally linked; the roster never governs the Dataverse `wmkf_applicantdisposition` picklist.

## Migration disposition / gotchas

- Growth bounded by a per-request row cap (v1); a TTL cleanup cron for closed requests is a tracked follow-up (mirror `DatabaseService.cleanupExpiredCache`).
- PATCH handlers are eviction-tolerant (upsert from the submitted blob / no-op) so a row evicted by the cap while still on screen can't 404 a card action.
- Stores a pruned render DTO, never the raw `contactEnrichment` internals (no resolver anchors / tierResults).
- Applicant-suggested restore is keyed on `candidate.enrichedProposalKey`, not the proposal Blob URL. `load-proposal` uses `addRandomSuffix:true`, so `blobUrl` changes across reloads and is not a stable cache key.
- `coi_dropped` is observability-only. Do not expose it as a recover/promote UI bucket without a separate policy decision; Contract 5 still hard-drops current-institution COI and save still fail-closes.
