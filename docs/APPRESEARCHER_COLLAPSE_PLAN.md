# `wmkf_appresearcher` Collapse Plan

**Status:** Planned. Execute post-pilot. Do not execute mid-pilot.

**Goal:** Eliminate the `wmkf_appresearcher` 1:1 sidecar by folding its bibliometric fields into `wmkf_potentialreviewer` directly. Background and rationale: `.claude-memory/project-appresearcher-collapse-post-pilot.md` and `docs/REVIEWER_DATA_MODEL.md` § "Open design notes."

**Why post-pilot, not now:** Mid-pilot is exactly when correctness-over-cleanup applies. The collapse is a structural cleanup with no operational pain; it can wait. Same window as Wave 1-style cleanup work.

**Plan history:**

- S196 2026-05-28 round 1 — initial draft, Codex review folded in. Caught P0 missing caller (Review Manager), wrong logical name for publication-author, invalid `String (no cap)` decision, missing pre-drop backup gate, forward-doc reconciliation. Pre-flight expanded with 5 additional checks.
- S196 2026-05-28 round 2 — Codex re-review with live Dataverse access. **VERIFIED** items pinned below. Net-new findings folded in: Phase 5 manifest-vs-entity drop order swap (P1), Phase 2 pre-backfill orphan/dupe gate (P1), explicit elevation of `audit-dataverse-state.js` and `check-drain-table-mentions.js` as CI gates (P2), `docs/atlas/dataverse-wmkf-appresearcher.md` read-path omission fix (WRONG-NOW).

**Ground-truth checkpoints (Codex round 2 with live Dataverse, 2026-05-28):**

- `wmkf_appresearchers` $count = **334** ✓
- `wmkf_apppublications` $count = **0** ✓
- `wmkf_apppublicationauthors` $count = **0** ✓
- All 17 Phase 1 source fields exist on `wmkf_appresearcher` ✓
- None of the 17 target names exist on `wmkf_potentialreviewers` (no collision) ✓
- Field types verified: String, Integer, Memo, DateTime as planned ✓
- `wmkf_apppublicationauthor.wmkf_researcher` is a Lookup, Targets=`[wmkf_appresearcher]` — **live dependency, not schema-only** ✓

These pin the as-of-2026-05-28 state. Pre-flight check (bottom of doc) re-verifies before execution.

---

## Inventory

### Live state (verified 2026-05-28)

- `wmkf_appresearcher`: 334 rows. Custom entity, `IsCustomEntity=true, IsManaged=false, Ownership=OrganizationOwned`.
- `wmkf_potentialreviewers`: 4,267 rows. Custom entity, `UserOwned`.
- `wmkf_apppublication`: deployed (entity set `wmkf_apppublications`), 0 rows.
- `wmkf_apppublicationauthor`: deployed (entity set `wmkf_apppublicationauthors`), 0 rows. **Logical name correction from earlier draft:** the schema-as-code FILE name is `wmkf_app_z_publication_author.json` but the deployed entity logical name is `wmkf_apppublicationauthor` (no `z_`). The atlas page claim that publication-author is "not deployed" is wrong; both publication entities ARE deployed but empty.

### Live app callers to update (4 files, Codex-verified S196)

| File | Role | Touches |
|---|---|---|
| `lib/dataverse/adapters/researcher.js` | The adapter itself | DELETE after switchover |
| `pages/api/reviewer-finder/save-candidates.js` | Reviewer Finder save flow | Imports `researcherAdapter`, calls `upsertByPotentialReviewer` |
| `pages/api/reviewer-finder/my-candidates.js` | Per-PD candidate browser | Imports `researcherAdapter`, calls `updateById`; direct `queryRecords('wmkf_appresearchers', …)` at line 300 |
| `pages/api/review-manager/reviewers.js` | **(P0 — added S196 from Codex review)** Per-proposal reviewer hydration | `researcherByPerson` join (line 151, 187), `queryRecords('wmkf_appresearchers', …)` at line 350; surfaces `affiliation`, `website`, `hIndex`, `totalCitations` to the Review Manager UI |
| `lib/services/contact-enrichment-service.js` | Bibliometric enrichment pipeline | Imports adapter (line 28); explicit reference in doc comment (line 23, 494) |

### Scripts referencing appresearcher (8 files — Phase 4.5 triage)

Lower-priority than the live app callers but need to be reconciled. Most are smoke tests, audit utilities, or schema-management scripts.

| File | Role | Likely disposition |
|---|---|---|
| `scripts/audit-dataverse-state.js` | Standalone audit (NOT a CI gate per package.json — round-3 correction) lists `wmkf_appresearchers` as a tracked entity set (line 92) | Update: remove the entry when entity is dropped |
| `scripts/backfill-postgres-to-dataverse.js` | Wave 2 backfill (Postgres → Dataverse) | Decide at execution time. Postgres reviewer tables (`researchers`, `researcher_keywords`, `proposal_searches`) are **drain-only**, not yet dropped (per `project-w6-table-drop-pending`; drop trigger ≥ 2026-07-01). If they've been dropped by the time this collapse executes, retire the script. Otherwise, leave alone — its source still exists. |
| `scripts/check-doc-currency.js` | Doc-convention check; references appresearcher naming (line 50) | Update reference |
| `scripts/check-drain-table-mentions.js` | CI gate; mentions appresearcher as a source of truth (line 11) | Update reference |
| `scripts/probe-bill-vendor-fields.js` | BILL field probe; appresearcher in its `TABLES` list (line 75) | Update list |
| `scripts/smoke-find-by-name.js` | Smoke test querying appresearcher directly (line 36) | Update or retire |
| `scripts/smoke-recent-suggestions.js` | Smoke test querying appresearcher (line 49) | Update or retire |
| `scripts/wave2-reshape-drop.js` | Wave 2 reshape utility | Retire (its purpose was creating then dropping the old shape; obsolete) |
| `lib/dataverse/schema/wave2/wmkf_app_researcher.json` | Schema-as-code for appresearcher | DELETE in Phase 5 |
| `lib/dataverse/schema/wave2/wmkf_app_z_publication_author.json` | Schema-as-code for publication-author junction | DELETE in Phase 5 |

### Docs that need updates (Phase 6)

WRONG-NOW (fix now, before this plan executes — Codex flagged):
- `docs/REVIEWER_DATA_MODEL.md` line 237: "~24 attrs" → actually 17 fields migrate per Phase 1
- `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md` lines 39-44: claim publication-author is "not deployed" → actually deployed with 0 rows
- `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` line 578: claims `contact-enrichment-service.js` writes Postgres via `DatabaseService` → actually writes via `researcherAdapter`
- `.claude-memory/project-appresearcher-collapse-post-pilot.md` "caller count is 3" → 4 (Review Manager)
- `.claude-memory/project-reviewer-postgres-to-dataverse-migration.md` lines 12-13: calls `wmkf_potentialreviewer` a "per-proposal slot" → actually global per-person per atlas
- `docs/APPRESEARCHER_COLLAPSE_PLAN.md` (this file): publication-author logical name corrected, caller count corrected

WRONG-AFTER (touched in Phase 6, after execution):
- `docs/atlas/dataverse-wmkf-appresearcher.md` → delete
- `docs/atlas/dataverse-wmkf-potentialreviewers.md` → fold appresearcher field list in (lines 42, 74)
- `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` → no change (no appresearcher claims)
- `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md` → drop publication half (lines 7-17, 39-45, 52-57)
- `docs/REVIEWER_DATA_MODEL.md` → flatten ER diagrams; update entity table; trim "Open design notes"
- `docs/REVIEWER_ARCHITECTURE.md` → rewrite "Why three tables" → "Why two" (lines 3-40, 46, 55-57, 71-73)
- `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` → multiple sections describe appresearcher as live write target (lines 27, 90, 98, 103, 118, 150, 169-178, 205, 571-578)
- `docs/SERVICE_AND_UTILITY_CATALOG.md` → no direct entry to remove (catalog only lists contact-enrichment-service.js)
- `.claude-memory/project-appresearcher-collapse-post-pilot.md` → mark SHIPPED
- `.claude-memory/project-reviewer-postgres-to-dataverse-migration.md` → drop 1:1 sidecar decision (already corrected per WRONG-NOW above; this is the post-execution mark-as-shipped pass)

---

## Phase 0 — Decisions before any schema work

These must be answered before Phase 1. Surface to Connor for the affiliation question; the rest are technical and locked here.

### D0.1 (USER/Connor) Affiliation field reconciliation + max-length

Two questions in one decision:

**(a) Which field becomes canonical?** `wmkf_potentialreviewer.wmkf_organizationname` is **String, 100-char cap.** `wmkf_appresearcher.wmkf_primaryaffiliation` is the same semantic meaning ("which institution this person is at") at a longer length. The collapse can't carry both — pick one.

**(b) What's the max length?** Codex (P1 finding) caught that the original draft said "no cap" — Dataverse string columns require an explicit max length, and the choice is between **String with explicit length** (~4000 max) and **Memo** (effectively unlimited but rendered differently in views). Recommendation: **String, max 500** — long enough for "Department of X, School of Y, University of Z, City, Country" without going Memo (Memo is heavier for views and limited in sort/filter).

Probe the actual `wmkf_primaryaffiliation` length on appresearcher before locking the value — if any current row exceeds 500, raise the cap to fit the longest + headroom.

**Recommendation: Adopt `wmkf_PrimaryAffiliation` (String, max 500) as the canonical; retire `wmkf_organizationname`.** Migration: copy non-null `wmkf_organizationname` values onto the new field where empty; then drop the old column.

Alternative: keep `wmkf_organizationname` (Reviewer Finder writes here today, fewer callers to change). Riskier: perpetuates the 100-char truncation.

### D0.2 (Locked) Publication tables — drop, not retarget

Live state (Codex-corrected S196): both publication entities ARE deployed, but with 0 rows each. The schema-as-code FILE name `wmkf_app_z_publication_author.json` corresponds to the deployed entity logical name `wmkf_apppublicationauthor` (no `z_`). They're never written to by live code. Plan: **drop both `wmkf_apppublication` and `wmkf_apppublicationauthor` in the same wave as the appresearcher drop.** Cheaper than retargeting the FK to potentialreviewer. If publication tracking is ever needed, it can be redesigned around `wmkf_potentialreviewer` directly.

Phase 5 drop order: publication-author (junction) → publication → appresearcher. Junction FKs the other two; must be removed first.

### D0.3 (Locked) Name field reconciliation

Both entities have `wmkf_name` (String, primary name attr). Potentialreviewer's wins (it's the canonical identity). Appresearcher's data is identical (the upsert writes from the same source); no risk of losing distinct info.

### D0.4 (Locked) Email field reconciliation

`wmkf_potentialreviewer.wmkf_emailaddress` (alt-key, de-dupe) vs `wmkf_appresearcher.wmkf_email`. Same value. Potentialreviewer's wins (it's the alt-key). Drop `wmkf_email` from the migration.

### D0.5 (Locked) `wmkf_normalizedname` retirement

Appresearcher's `wmkf_normalizedname` was a dedupe key for the researcher table. Potentialreviewer dedupes on email. The normalized-name field has no consumer outside the researcher adapter. **Drop, do not migrate.**

### D0.6 (Locked S196 per Codex P1) Forward-doc reconciliation

`docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` still describes `wmkf_appresearcher` as a future write target in several sections (lines 27, 90, 98, 103, 118, 150, 169-178, 205, 571-578). Before executing the collapse, those references must be updated or footnoted so future work doesn't silently re-create the sidecar pattern. Phase 6 (post-execution) handles the final pass, but pre-flight check #10 verifies that no future-work plan would undo the collapse.

---

## Phase 1 — Schema additions

Idempotent additive change. New wave directory (`lib/dataverse/schema/wave6/`).

Manifest: `lib/dataverse/schema/wave6/01_wmkf_potentialreviewer_bibliometric.json`. Adds the following attributes to `wmkf_potentialreviewers`:

| New schema name | Type | Source field on appresearcher | Notes |
|---|---|---|---|
| `wmkf_PrimaryAffiliation` | String, max 500 (or longer per D0.1 probe) | `wmkf_primaryaffiliation` | Canonical affiliation per D0.1. Probe longest-existing value before locking max. |
| `wmkf_Department` | String | `wmkf_department` | |
| `wmkf_Orcid` | String, max 50 | `wmkf_orcid` | Alt-key consideration — orcid is unique-when-present. Decision: skip alt-key (most rows null; alt-keys with null are awkward). Adapter dedup on email is sufficient. |
| `wmkf_OrcidUrl` | String (Url) | `wmkf_orcidurl` | |
| `wmkf_GoogleScholarId` | String | `wmkf_googlescholarid` | |
| `wmkf_GoogleScholarUrl` | String (Url) | `wmkf_googlescholarurl` | |
| `wmkf_HIndex` | Integer | `wmkf_hindex` | |
| `wmkf_I10Index` | Integer | `wmkf_i10index` | |
| `wmkf_TotalCitations` | Integer | `wmkf_totalcitations` | |
| `wmkf_Website` | String (Url) | `wmkf_website` | |
| `wmkf_FacultyPageUrl` | String (Url) | `wmkf_facultypageurl` | |
| `wmkf_Keywords` | Memo | `wmkf_keywords` | |
| `wmkf_EmailSource` | String | `wmkf_emailsource` | Provenance flag for the email value (orcid/scholar/manual). |
| `wmkf_LastChecked` | DateTime | `wmkf_lastchecked` | Last refresh of any bibliometric field. |
| `wmkf_MetricsUpdatedAt` | DateTime | `wmkf_metricsupdatedat` | Last refresh of metric fields specifically (h-index etc.). |
| `wmkf_ContactEnrichedAt` | DateTime | `wmkf_contactenrichedat` | Last contact-enrichment run. |
| `wmkf_ContactEnrichmentSource` | String | `wmkf_contactenrichmentsource` | Provenance. |

NOT migrated: `wmkf_name` (D0.3), `wmkf_email` (D0.4), `wmkf_normalizedname` (D0.5), `wmkf_notes` (potentialreviewer doesn't need it; appresearcher's notes are unused in code — confirm with `grep wmkf_notes`).

Deploy: `node scripts/apply-dataverse-schema.js --target=prod --wave=6 --execute`. Same pattern as the S196 `wmkf_completedat` deploy.

**Validation gate before Phase 2:** Re-probe potentialreviewer attributes; confirm all 17 new fields exist with correct types.

---

## Phase 2 — Backfill

### 2.0 Pre-backfill integrity gate (added S196 round 2 per Codex P1)

Before any backfill writes, audit `wmkf_appresearcher._wmkf_potentialreviewer_value` for shape anomalies. Backfill assumes every appresearcher row links to exactly one live potentialreviewer; the audit confirms or surfaces violations.

Script: `scripts/audit-appresearcher-links.js` (one-shot, retire after Phase 5).

Checks:
- **Null links** — appresearcher rows where `_wmkf_potentialreviewer_value` is null. Should be 0 (the lookup is required per the schema). If non-zero: report rows; decide manually whether to delete-orphan or repair before proceeding.
- **Dangling links** — `_wmkf_potentialreviewer_value` points at a potentialreviewer row that doesn't exist (deleted or invalid GUID). Should be 0. If non-zero: same triage.
- **Duplicate links** — more than one appresearcher row pointing at the same potentialreviewer. Should be 0 (1:1 enforced by alt-key). If non-zero: the alt-key is broken; surface immediately, do not proceed.

Output: report-only mode by default. Backfill (Phase 2.1) refuses to start unless the audit returns clean OR `--force` is passed AND triaged-rows are explicitly listed.

### 2.1 Backfill

Script: `scripts/backfill-appresearcher-to-potentialreviewer.js`. Reads each row in `wmkf_appresearchers`, locates the linked `wmkf_potentialreviewer` row by `_wmkf_potentialreviewer_value`, and PATCHes the new fields.

Properties:

- **Idempotent.** Re-runnable safely. Uses fill-if-empty for non-metric fields (preserves any manual edits made between runs); metric fields always overwrite (they're snapshots).
- **Affiliation reconciliation per D0.1.** If `wmkf_organizationname` is set and `wmkf_primaryaffiliation` is empty in the source, copy `wmkf_organizationname` to `wmkf_PrimaryAffiliation` on the target. Otherwise prefer `wmkf_primaryaffiliation`.
- **Dry-run mode.** Default `--dry-run`; requires explicit `--execute` to write. Reports per-row decisions: which fields would be written, which skipped, which conflicts detected.
- **Conflict report.** Surfaces any row where both source values are non-null and disagree (shouldn't happen but the report is the verification). Fail-loud, not silent overwrite.
- **Throttle.** 30s backoff on 429 per project memory; bounded concurrency (e.g., 4 in-flight).
- **Pre-flight check.** Reads the audit report from 2.0; refuses to start if any anomalies remain.

Validation gate before Phase 3: spot-check ~10 rows across data-completeness deciles (fully-populated, partially-populated, sparse applicant-source). Confirm all expected fields landed; no data loss vs the source.

---

## Phase 3 — Adapter consolidation

Fold `researcher.js` API surface into `potential-reviewer.js`. Single adapter, single set of fields.

New methods on `potential-reviewer.js` (in addition to existing `getByEmail` / `getById` / `upsertByEmail` / `update` / `setContactLink`):

- `upsertBibliometricsByEmail({ email, hIndex, totalCitations, … }, opts)` — counterpart to the old `upsertByPotentialReviewer`. Same metric-overwrite + fill-if-empty semantics. Resolves the row by email (already the de-dupe key), so it doesn't need a separate potentialReviewerId parameter.
- `updateBibliometrics(id, updates, opts)` — counterpart to the old `updateById`. Same no-op guard pattern as existing `update`.

The two existing methods stay as-is; the new methods add the bibliometric writeback paths. No interface break for existing callers.

Append the new fields to `FIELD_SELECT` so single-query reads return identity + bibliometrics together (saves the join hop that motivated the collapse).

Tests: extend the existing `potential-reviewer.test.js` (if present) or create one with the same patterns as `tests/unit/*` for the adapter. Cover: upsert-fresh, upsert-existing-with-metrics (overwrite), upsert-existing-with-non-metrics (fill-if-empty), no-op update guard.

---

## Phase 4 — Caller switchover

Switch each caller in order:

### 4.1 `pages/api/reviewer-finder/save-candidates.js`

- Remove `import * as researcherAdapter`.
- Replace `researcherAdapter.upsertByPotentialReviewer(prId, payload)` with `potentialReviewerAdapter.upsertBibliometricsByEmail({ email, …payload })` (or equivalent ID-based form if email is awkward at this call site).
- Verify the payload shape matches; the field names get renamed (`affiliation` → `affiliation` is unchanged, etc.; check each).

### 4.2 `pages/api/reviewer-finder/my-candidates.js`

- Replace direct `queryRecords('wmkf_appresearchers', …)` at line 300 with a single query against `wmkf_potentialreviewerses` selecting both identity and bibliometric fields.
- Replace `researcherAdapter.updateById(researcher.wmkf_appresearcherid, …)` at line 434 with `potentialReviewerAdapter.updateBibliometrics(person.wmkf_potentialreviewersid, …)`.
- The `researcherId: researcher?.wmkf_appresearcherid` field at line 173 in the response payload: drop it. Any frontend consumer using `researcherId` switches to `personId` (or whatever the existing identity id is named in this response).

### 4.3 `lib/services/contact-enrichment-service.js`

- Replace `require('../dataverse/adapters/researcher')` with `require('../dataverse/adapters/potential-reviewer')`.
- Replace call-sites with the new `upsertBibliometricsByEmail` / `updateBibliometrics` methods.
- Update doc comment at lines 23 + 494 — drop the "1:1 sidecar with bibliometric data" framing; replace with single-table description.

### 4.4 `pages/api/review-manager/reviewers.js` (added S196 per Codex P0)

- Replace the parallel `researcherByPerson` fetch (lines 151, 187) — bibliometric fields now come from the same person record, so the join becomes a single-query field selection on `wmkf_potentialreviewerses`.
- Replace direct `queryRecords('wmkf_appresearchers', …)` at line 350 — return the bibliometric fields directly from the person query already happening in the request handler.
- Update the response payload (lines 191-198): drop `researcherId`; keep `affiliation`, `website`, `hIndex`, `totalCitations` (resolved from the person record). Verify the frontend doesn't depend on `researcherId` — if it does, drop it from frontend reads too.
- Note: the response previously fell through to `person.wmkf_organizationname` when `researcher?.wmkf_primaryaffiliation` was null (line 194). Post-collapse this is just `person.wmkf_PrimaryAffiliation` — no fallback needed (the field is on the same row).

### 4.5 Script audit + update (CI-gate framing corrected S196 round 3)

Two scripts in this set ARE CI gates with `npm run` targets that block PRs (verified against `package.json`). If they encode `wmkf_appresearcher` as live truth, the CI signal goes stale post-drop. **Treat their updates as blocking for Phase 5.**

**CI gates (npm targets verified — must update before Phase 5 entity drop):**
- `scripts/check-drain-table-mentions.js` (gate: `npm run check:drain-table-mentions`) — drop appresearcher from the "source of truth" enumeration (line 11 + 305). Self-test target also exists.
- `scripts/check-doc-currency.js` (gate: `npm run check:doc-currency`) — remove the appresearcher naming convention check (line 50). Self-test target also exists.

**Standalone audit utility (NOT a CI gate, but referenced by atlas pages):**
- `scripts/audit-dataverse-state.js` — listed in atlas pages as the source for "Last verified" probe dates (line 92 has `wmkf_appresearchers` in tracked entity-set list). Update to remove the entry. Round-2 framing of this as a "CI gate" was wrong — Codex round 3 caught the `package.json` check; no `npm run` target wires it into CI.

**Other scripts (update in-place, not gate-critical):**
- `scripts/probe-bill-vendor-fields.js` — drop `wmkf_appresearcher` from the `TABLES` list (line 75)

**Retire (purpose obsolete):**
- `scripts/backfill-postgres-to-dataverse.js` — Postgres reviewer tables are drain-only (not yet dropped — drop is post-pilot per `project-w6-table-drop-pending` and `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`). This collapse may or may not coincide with the W6 table drop. If W6 drops have happened by then, retire this script; if not, leave alone (its Postgres source still exists). **Decision deferred to execution time.** Round-2 framing that the source was "already dropped" was wrong.
- `scripts/wave2-reshape-drop.js` — Wave 2 reshape utility, purpose served. Delete file.
- `scripts/smoke-find-by-name.js`, `scripts/smoke-recent-suggestions.js` — Re-evaluate: if still actively used, update to query the new combined entity; if abandoned, delete.

**Validation:** Re-run `grep -rln "appresearcher\|adapters/researcher" pages/ lib/ scripts/` after the audit. Should return zero matches in `pages/` and `lib/`; scripts may have transitional notes but no live references. Run `npm run check:drain-table-mentions` and `npm run check:doc-currency` — both must pass green BEFORE Phase 5 begins.

After each switchover: smoke-test the affected app. Phase 4 is not done until **all four live callers** (Reviewer Finder save-candidates + my-candidates, Review Manager reviewers, Contact Enrichment) are switched AND smoke-tested.

---

## Phase 5 — Drop `wmkf_appresearcher` + publication tables

Prerequisite: Phase 4 complete and verified. **No live code references appresearcher.** Confirm with `grep -r 'appresearcher\|adapters/researcher' pages/ lib/ scripts/ --include='*.js'` → expect zero hits in `pages/` and `lib/`.

### 5.0 Pre-drop data export (point-of-no-return gate, added S196 per Codex P1)

Before any DROP, export full row contents of the three entities being dropped to a recoverable artifact. This is the rollback insurance for "we discovered something the plan missed; need the old data back."

Export script: `scripts/export-appresearcher-snapshot.js` (one-shot, retire after Phase 5).
- Query all rows from `wmkf_appresearchers`, `wmkf_apppublications`, `wmkf_apppublicationauthors` (full field set, no $select pruning).
- Write to Vercel Blob (private) as JSON-lines: `appresearcher-snapshot-{ISO-date}.jsonl`, `apppublication-snapshot-{ISO-date}.jsonl`, etc.
- Verify upload succeeded; record blob URLs in a manifest file committed to `docs/atlas/snapshots/`.
- Retain for 90 days minimum after drop. Then retire.

### 5.1 Verify entity existence before drop (added S196 per Codex P1)

The drop script must not assume entities exist with specific logical names — the publication-author logical-name confusion (file says `wmkf_app_z_publication_author`, deployed entity is `wmkf_apppublicationauthor`) is exactly the failure mode this guards against. Before each drop:

```
GET EntityDefinitions(LogicalName='<name>')
```

Branch on 200 vs 404. Only DELETE-then-DROP if 200. Log skip-with-reason if 404.

### 5.2 Drop sequence

**Recovery-reference principle:** Local schema manifests are the rollback reference if a Dataverse drop fails mid-flight (they document what to recreate). They MUST survive until the Dataverse drops succeed. The adapter file (`lib/dataverse/adapters/researcher.js`) is NOT part of the recovery surface — it's just code that calls the entity; deleting it cannot orphan the recovery path. Both files get deleted, but manifests come last.

**Within Dataverse:** junction before referenced entity (FK constraints). The `wmkf_apppublicationauthor.wmkf_researcher` lookup → `wmkf_appresearcher` is live, not just schema-file (Codex round 2 verified `Targets=[wmkf_appresearcher]`).

1. Delete `lib/dataverse/adapters/researcher.js` (no live callers post-Phase-4; deleting this first surfaces any missed caller as an immediate import error rather than at runtime — recovery-safe because the adapter is not a recovery reference).
2. Drop Dataverse entities in this order:
   - DELETE all rows from `wmkf_apppublicationauthors` then DROP the entity
   - DELETE all rows from `wmkf_apppublications` then DROP the entity
   - DELETE all rows from `wmkf_appresearchers` then DROP the entity
3. Re-probe Dataverse: all three entity logical names should return 404 from EntityDefinitions.
4. **Only after Dataverse drops succeed:** delete the wave2 manifest files for dropped entities (these were the recovery references):
   - `lib/dataverse/schema/wave2/wmkf_app_z_publication_author.json` (file name; deployed as `wmkf_apppublicationauthor`)
   - `lib/dataverse/schema/wave2/wmkf_app_publication.json` (verify exact file name at execution time)
   - `lib/dataverse/schema/wave2/wmkf_app_researcher.json` (file name; deployed as `wmkf_appresearcher`)

### 5.3 Validation after drop

- `wmkf_appresearchers`, `wmkf_apppublicationauthors`, `wmkf_apppublications` all return 404 from EntityDefinitions
- `wmkf_potentialreviewers` still has the 17 new attrs (probe metadata)
- Smoke-test the 4 callers once more — confirm they still work with the entity gone (any miss in Phase 4 surfaces here)
- Snapshot blob URLs in `docs/atlas/snapshots/` are still accessible

---

## Phase 6 — Doc cleanup

In one commit:

- `docs/atlas/dataverse-wmkf-appresearcher.md` → delete file. Update `docs/APPLICATION_STATE_ATLAS.md` if it links to it.
- `docs/atlas/dataverse-wmkf-potentialreviewers.md` → fold appresearcher field list into the Key fields section (lines 42 + 74 reference appresearcher). Update "Schema (live, X custom attrs)" count.
- `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md` → drop the publication half (lines 7-17, 39-45, 52-57); trim to grant-cycle only or split.
- `docs/REVIEWER_DATA_MODEL.md` → re-render the two ER diagrams without appresearcher; trim the "Entities at a glance" table; remove the "Open design notes" section about the planned collapse (replace with a SHIPPED note in a "What changed" section if useful). Lines 13-14, 30, 45-52, 97, 116-121, 174, 213, 255 reference appresearcher.
- `docs/REVIEWER_ARCHITECTURE.md` → rewrite "Why three tables, not one" → "Why two" (lines 3-40, 46, 55-57, 71-73). Acknowledge the historical 3-table design without restating it.
- `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` → reconcile every appresearcher write-target reference (lines 27, 90, 98, 103, 118, 150, 169-178, 205, 571-578) per D0.6.
- `docs/SERVICE_AND_UTILITY_CATALOG.md` → confirm no `researcher.js` entry to remove (catalog only lists `contact-enrichment-service.js`); update that entry's description to drop "1:1 sidecar" framing.
- `.claude-memory/project-appresearcher-collapse-post-pilot.md` → update description + body to "SHIPPED [date]"; keep file for historical context.
- `.claude-memory/project-reviewer-postgres-to-dataverse-migration.md` → drop the 1:1 sidecar "locked decision" (lines 12-13, 20-23).
- `docs/APPRESEARCHER_COLLAPSE_PLAN.md` (this file) → add "EXECUTED [date]" status header; retain for historical record.

Run `npm run check:fact-consistency` and `npm run check:atlas` afterward to verify nothing broke.

---

## Risks + rollback

### Risk: data loss in backfill

Mitigation: dry-run + conflict report (Phase 2). Backfill is idempotent; if a field gets written wrong, re-run after fixing the script.

### Risk: caller misses a field name change

Mitigation: smoke-test each caller after switching (Phase 4). Type checking (if TS) would catch this — since we're JS, the smoke tests + the Phase 5 grep are the safety net.

### Risk: drop fails because something still references appresearcher

Mitigation: Phase 5's grep + the EntityDefinitions check pre-drop. If a reference is found late, abort the drop (entity still has rows; safe to keep around indefinitely while the reference gets cleaned up).

### Rollback if backfill goes wrong

The new fields on `wmkf_potentialreviewer` are additive. If backfill produces bad data, null them out and re-run with corrected logic — no rows deleted, no state lost. The original `wmkf_appresearcher` rows remain authoritative until Phase 5.

### Point-of-no-return

Phase 5 (entity drop). Everything before that is reversible (re-run backfill, revert caller switches, etc.). After Phase 5, recovering the appresearcher entity requires re-creating it from scratch — but the data lives on potentialreviewer now, so the worst case is "we have to repoint adapters back at a re-created table," not "we lose data."

---

## Effort estimate (revised S196 with Codex findings)

| Phase | Effort |
|---|---|
| 0. Decisions | ~45 min (Connor's affiliation/max-length call + D0.6 forward-doc review) |
| 1. Schema add | ~30 min (manifest + dry-run + execute) |
| 2. Backfill | ~90 min (script + dry-run + execute + spot-check) |
| 3. Adapter consolidation | ~60 min (new methods + tests) |
| 4. Caller switchover | ~150 min (4 callers × ~30 min + smoke tests + script triage) |
| 5. Drop | ~60 min (snapshot export + entity-existence checks + ordered drop) |
| 6. Doc cleanup | ~45 min (more docs to touch than original estimate) |

**Total: ~8 hours of focused work.** Splittable across two sessions at the Phase 2/3 boundary; Phase 0–2 is harmless if paused there.

---

## Pre-flight check before executing

Before kicking off Phase 1 post-pilot, re-verify (Codex-expanded S196):

1. Pilot is closed and the post-pilot cleanup window is open (no active reviewer-domain feature work).
2. Live state still matches the inventory above:
   - `wmkf_appresearchers` row count (claimed 334)
   - `wmkf_apppublications` row count (claimed 0; changes the publication-drop decision if non-zero)
   - `wmkf_apppublicationauthors` row count (claimed 0; same)
   - **Four caller files** (not three) still match the call-site enumeration: save-candidates, my-candidates, **review-manager/reviewers**, contact-enrichment-service
3. Connor has answered D0.1 (affiliation field reconciliation + max-length).
4. Probe the longest existing `wmkf_primaryaffiliation` value on appresearcher; confirm the planned String max is sufficient (or raise it).
5. No new callers have appeared: `grep -rln 'appresearcher\|adapters/researcher' pages/ lib/ scripts/`. Compare to the 4-app-caller + 8-script enumeration; anything else is new and needs analysis before proceeding.
6. **Live EntityDefinitions existence check** for both publication-entity logical names (`wmkf_apppublication` and `wmkf_apppublicationauthor` — not the `_z_` form). Both should return 200. If either has been dropped or renamed since plan was written, update Phase 5.
7. **Per-field metadata probe** on all 17 source fields on `wmkf_appresearcher`: confirm `AttributeType` matches the plan's claims (Integer, String, Memo, DateTime, etc.) and capture each field's `MaxLength` for String/Memo. Surfaces type drift before schema apply.
8. **Per-field collision check** on `wmkf_potentialreviewers`: confirm none of the 17 new `wmkf_*` attribute names already exist (e.g., from a forgotten partial deploy or a different code path that quietly added one).
9. **Review Manager smoke-test capability**: confirm there's a way to exercise `pages/api/review-manager/reviewers.js` against sandbox (test fixtures, staging data, or a known-good production query). Phase 4.4 smoke-test gate depends on this.
10. **Forward-doc residual check**: grep `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` and any other "future-work" plans for remaining `wmkf_appresearcher` write references. If any future work would re-create the appresearcher pattern, reconcile it BEFORE executing this collapse — otherwise the future work will undo the collapse silently.
