# Atlas: `wmkf_appgrantcycle` (live) — `wmkf_apppublication` + `wmkf_apppublicationauthor` DROPPED S213

<!-- drain-table:file-purpose=atlas-state-page -->

> **⚠ S213 (2026-06-02): `wmkf_apppublication` and `wmkf_apppublicationauthor` were DROPPED** (deployed with 0 rows, no callers; went down with the `wmkf_appresearcher` collapse — `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md`). The publication sections below are historical. **`wmkf_appgrantcycle` is unaffected and remains live** — see its section.

**Last verified:** 2026-05-07 via `scripts/audit-dataverse-state.js` + EntityDefinitions metadata probe. **`wmkf_appgrantcycle` section re-verified 2026-05-19** post-W3 cutover (see that section); the publication entities were dropped S213 (above).

## `wmkf_apppublication` — DROPPED S213 (historical section)

**Live row count:** n/a — **entity DROPPED S213** (was 0 rows, no writers; `EntityDefinitions` now returns 404). Went down with the `wmkf_appresearcher` collapse. The details below are historical.
**Entity set (gone):** `wmkf_apppublications`
**Schema-as-code (deleted S213):** `lib/dataverse/schema/wave2/wmkf_app_publication.json`

Custom attrs (14, all confirmed deployed): `wmkf_apppublicationid` (PK), `wmkf_title` (primary name attr), `wmkf_authorsraw` (Memo), `wmkf_journal`, `wmkf_doi` (alt-key), `wmkf_pmid`, `wmkf_pmcid`, `wmkf_arxivid`, `wmkf_publicationdate`, `wmkf_year`, `wmkf_citations`, `wmkf_abstract`, `wmkf_url`, `wmkf_source`.

**No adapter exists** (no `lib/dataverse/adapters/publication.js`). No callers anywhere.

**Migration disposition (CLOSED S213):** Postgres `publications` is also empty (0 rows). Wave 2 plan was to retire the Postgres table and only start writing here when discovery is rewired. **S213 outcome:** both `wmkf_apppublication` and `wmkf_apppublicationauthor` were **DROPPED** with the appresearcher collapse (both were deployed, empty, and unused; see `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md`). The earlier "junction NOT deployed" claim was based on a probe of the wrong logical name — the junction's deployed logical name was `wmkf_apppublicationauthor` (no `_z_`; that artifact was only in the schema-as-code FILE name).

## `wmkf_appgrantcycle` — DEPLOYED, DATAVERSE-PRIMARY (W3 cutover 2026-05-12)

**Live row count:** 10 (per 2026-05-14 audit in `docs/atlas/postgres-grant-cycles.md`)
**Entity set:** `wmkf_appgrantcycles`
**Schema-as-code:** `lib/dataverse/schema/wave2/wmkf_app_grant_cycle.json` (11 attrs post-W3-preflight patch + 2 alt-keys: `wmkf_fiscalyearcode` and `wmkf_shortcode`)

Deployed custom attrs (11): `wmkf_appgrantcycleid`, `wmkf_displayname` (primary), `wmkf_fiscalyearcode`, `wmkf_shortcode`, `wmkf_programname`, `wmkf_customfields`, `wmkf_meetingdate`, `wmkf_summarypages`, `wmkf_reviewreturndeadline`, `wmkf_reviewtemplateurl`, `wmkf_reviewtemplatefilename`, `wmkf_additionalattachments`, `wmkf_isactive` (+ `wmkf_isactivename` virtual). The three middle fields (`wmkf_shortcode`, `wmkf_programname`, `wmkf_customfields`) were patched into the deployed entity 2026-05-12 (W3 preflight).

**Schema-patch SHIPPED 2026-05-12 (W3 preflight):** the three fields originally flagged as missing (`wmkf_ShortCode`, `wmkf_ProgramName`, `wmkf_CustomFields`) are now in both schema-as-code and the deployed entity. Live evidence: `lib/services/grant-cycles-dataverse.js:75-99` selects all three on every read, and `:129` addresses rows by the `wmkf_shortcode` alt-key — the prod cycle endpoint has been calling these successfully since 2026-05-12. (Re-verify via `scripts/dynamics-schema-diff.js wmkf_appgrantcycle` if you need a metadata-level confirmation before any destructive Postgres action.)

**Callers:** `lib/services/grant-cycles-dataverse.js` is the live read/write path. Consumed by `pages/api/reviewer-finder/grant-cycles.js`, `pages/api/review-manager/render-emails.js`, `pages/api/review-manager/send-emails.js`, and `lib/services/maintenance-service.js` (blob cleanup, via `wmkf_reviewtemplateurl`). Postgres `grant_cycles` is drain-only post-W3 cutover; see `docs/atlas/postgres-grant-cycles.md` for the cross-reference. Post-pilot drop of the Postgres table is destructive-carryover-gated (≥2026-07-01).

## `wmkf_appproposalsearch` — DEPLOYED (empty), unconventional plural

**Live row count:** 0 (re-probed 2026-05-25)
**Entity set:** `wmkf_appproposalsearchs` — **NOT** the expected `wmkf_appproposalsearches`. Dataverse's auto-pluralization for this entity used `+s` (not the English `-ch → -ches` rule); attempting `?$top=1` on `wmkf_appproposalsearches` returns 404, on `wmkf_appproposalsearchs` returns 200 empty.
**Schema-as-code:** `lib/dataverse/schema/wave2/wmkf_app_proposal_search.json`

S185 audit catch (2026-05-25-B): the prior "NOT DEPLOYED" claim (from 2026-05-07) was based on a probe of only the `-es` variant. The reconcile-memory-claims candidate generator's broader probe (commit `5d560c2`) found the actual `-s` entity set. The entity exists, has no rows, has no writer code, and no read path uses it. Postgres `proposal_searches` is also 0 rows; writer is dead. Defer indefinitely — but the deployment status row in the migration-plan table below is now ✅ deployed (empty), not ❌.

## `wmkf_apppublicationauthor` — DROPPED S213 (historical section)

**Live row count:** n/a — **entity DROPPED S213** (was 0 rows; `EntityDefinitions` now 404).
**Entity set (gone):** `wmkf_apppublicationauthors`
**Schema-as-code (deleted S213):** `lib/dataverse/schema/wave2/wmkf_app_z_publication_author.json` (file name had `_z_` artifact; deployed entity logical name was `wmkf_apppublicationauthor` without the `_z_`)

Junction for `wmkf_apppublication ↔ wmkf_appresearcher`. Originally marked NOT DEPLOYED in the 2026-05-07 probe — that was wrong (the probe used the `_z_`-named entity set, which never existed). The deployed entity used the no-`_z_` logical name. Both publication entities were dropped S213 in the appresearcher collapse (see `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md`).

## What this means for the migration plan

`docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` claims "schema-as-code already lives in `wave2/`." That's true for files-on-disk, but **deployment status differs by entity:**

| Entity | Schema-as-code? | Deployed? | Has data? |
|---|---|---|---|
| `wmkf_appresearcher` | (deleted S213) | **DROPPED S213** (404) | collapsed onto `wmkf_potentialreviewers` (was 339 rows) |
| `wmkf_appreviewersuggestion` | (extension manifest only) | ✅ | ✅ (662 rows) |
| `wmkf_apppublication` | (deleted S213) | **DROPPED S213** (404) | was empty |
| `wmkf_appgrantcycle` | ✅ (partial) | ✅ | 10 rows (Dataverse-primary post-2026-05-12) |
| `wmkf_appproposalsearch` | ✅ | ✅ (entity set is `wmkf_appproposalsearchs`, NOT `-es`) | empty |
| `wmkf_apppublicationauthor` (file: `wmkf_app_z_publication_author.json`) | (deleted S213) | **DROPPED S213** (404) | was empty |

The "as-built vs. as-designed" reconciliation Codex round-3 #5 asked for is captured here. (S213: the three sidecar/publication entities were dropped — see `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md`.)
