# Atlas: `wmkf_appresearcher` (Dataverse)

**Last verified:** 2026-05-07 via `scripts/audit-dataverse-state.js` + EntityDefinitions metadata probe
**Live row count:** 334
**Entity set:** `wmkf_appresearchers`
**Adapter:** `lib/dataverse/adapters/researcher.js`

## Source of truth

Bibliometric sidecar (h-index, citations, scholar/ORCID metadata) for an external researcher. **1:1 with `wmkf_potentialreviewers`** — that table holds canonical person identity; this one holds metrics that change over time and need refresh.

## Schema (live, 24 custom attrs)

| Logical name | Type | Notes |
|---|---|---|
| `wmkf_appresearcherid` | Uniqueidentifier | PK |
| `wmkf_potentialreviewer` | Lookup | → `wmkf_potentialreviewers` (1:1, alt-key) |
| `wmkf_potentialreviewername` | String (virtual) | denorm display |
| `wmkf_name` | String | primary name attr |
| `wmkf_normalizedname` | String | dedupe key |
| `wmkf_email` | String | |
| `wmkf_emailsource` | String | provenance: `orcid \| scholar \| manual` |
| `wmkf_orcid`, `wmkf_orcidurl` | String | alt-key on `wmkf_orcid` |
| `wmkf_googlescholarid`, `wmkf_googlescholarurl` | String | |
| `wmkf_hindex`, `wmkf_i10index`, `wmkf_totalcitations` | Integer | snapshot — overwritten on each refresh |
| `wmkf_primaryaffiliation`, `wmkf_department` | String | |
| `wmkf_website`, `wmkf_facultypageurl` | String (Url) | |
| `wmkf_keywords` | Memo | comma-joined (collapsed from Postgres `researcher_keywords`) |
| `wmkf_notes` | Memo | conflicts/preferences/free-form |
| `wmkf_lastchecked` | DateTime | last refresh of any field |
| `wmkf_metricsupdatedat` | DateTime | last refresh of metric fields specifically |
| `wmkf_contactenrichedat` | DateTime | last contact-enrichment run |
| `wmkf_contactenrichmentsource` | String | provenance |

Alternate keys: `wmkf_orcid`, `wmkf_potentialreviewer` (1:1 enforcement).

## Adapter contract (`lib/dataverse/adapters/researcher.js`)

`FIELD_SELECT` matches the live schema (verified 2026-05-07). Methods:

- `getByPotentialReviewer(potentialReviewerId)` — find the 1:1 row
- `upsertByPotentialReviewer(potentialReviewerId, payload, { actingUserSystemId })` — fill-if-empty for identity fields, **always overwrite** for metric snapshots; touches `wmkf_lastchecked`; touches `wmkf_metricsupdatedat` only when a metric field is supplied
- `updateById(id, updates, { actingUserSystemId })` — partial update with metrics-touch detection

## Read paths

- `pages/api/reviewer-finder/save-candidates.js` — per-proposal save
- `pages/api/reviewer-finder/my-candidates.js` — per-PD picker
- `pages/api/review-manager/reviewers.js` `fetchResearchersByPerson` — joins researcher snapshots onto Review Manager's reviewer list (filter `_wmkf_potentialreviewer_value` OR-chain)
- `lib/services/contact-enrichment-service.js` — bibliometric enrichment pipeline reads the sidecar before writing back
- (No standalone browse/list endpoint. The Postgres-backed `pages/api/reviewer-finder/researchers.js` admin tab was retired 2026-05-12 in W6 step 1; the 1:1 contact model has no shared researcher pool to browse. A post-pilot "Add candidate by hand" feature is planned as the replacement entry point.)

## Write paths

- `pages/api/reviewer-finder/save-candidates.js` — `upsertByPotentialReviewer` (fill-if-empty for identity, overwrite for metrics)
- `pages/api/reviewer-finder/my-candidates.js` — **two paths:** `upsertByPotentialReviewer` for the per-proposal save, and `updateById` for staff edits to the bibliometric sidecar (affiliation/website/h-index corrections)
- `pages/api/review-manager/reviewers.js` — read-only (no writes)
- `lib/services/contact-enrichment-service.js` — `upsertByPotentialReviewer` writeback after bibliometric enrichment runs (W5 migration target)
- `scripts/backfill-postgres-to-dataverse.js` — `upsertByPotentialReviewer` for Wave 2 bibliometric backfill (script slated for retirement; Postgres source dropped 2026-05-12)

> **Note (S196):** This entity is slated for collapse into `wmkf_potentialreviewer` post-pilot. See `docs/APPRESEARCHER_COLLAPSE_PLAN.md`. Once collapsed, the bibliometric fields move to the person record and the read/write paths above all switch to `lib/dataverse/adapters/potential-reviewer.js`.

## Cross-system

Postgres `researchers` (331 rows) is the historical pool; this entity (334 rows) is slightly larger because per-proposal promotion can create rows for reviewers not in the Postgres pool. Bibliometric fields in Postgres are 0% populated, so the migration carries no metric values — fresh scrapes will fill `wmkf_hindex` etc.

## Migration disposition

Per `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`: this is the Wave 2 destination for the Postgres `researchers` bibliometric columns. **Cutover status (W3-W6, 2026-05-12)**: adapter shipped; My Candidates edit/write paths use this entity; browse/list endpoint retired (Database tab removed — see "No standalone browse/list endpoint" note above). A post-pilot `add-candidate-manual` endpoint is the remaining future-work entry point for manual additions.
