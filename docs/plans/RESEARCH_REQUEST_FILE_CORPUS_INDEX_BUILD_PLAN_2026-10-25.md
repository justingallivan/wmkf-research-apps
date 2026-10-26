---
title: Research request file corpus — index build (rollout step 3)
kind: plan
domain: dataverse
status: draft
summary: "Draft for owner approval: build the metadata index of SharePoint files for Research requests with a meeting year from 2018, in Postgres, from a fresh strict listing, classified by the filename rules; no text, no route, no model. Visibility decided (no per-request rule; admin exercise). Migration 090 free as of 2026-10-25. Owner decision still needed: where the first load runs."
owner: product-engineering
related:
  - docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md
  - scripts/probe-request-file-inventory.mjs
  - lib/services/request-file-corpus/filename-rules.js
  - lib/utils/sharepoint-buckets.js
  - docs/atlas/postgres-infra-tables.md
---

# Research request file corpus — index build (rollout step 3)

[DRAFT, 2026-10-25; nothing built. Parent plan:
`docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`, rollout step 3.]

## Decisions needed from the owner

1. **Visibility — DECIDED by the owner 2026-10-25: no per-request rule.** The
   app has no per-request read check (code inspected 2026-10-25: access is per
   app via `requireAppAccess`; `dynamics_restrictions` restricts tables and
   fields for Dynamics Explorer, `lib/services/dynamics/restrictions.js`; the
   app reads Dataverse as its own service principal; a search of `lib/`,
   `pages/` and `shared/` for `canViewRequest`, `canAccessRequest`,
   `assertRequestAccess`, `requestVisibility`, `isRequestVisible` and
   `scopeRequests` found only test-request visibility helpers). The owner
   ruled there are no request restrictions to honour: the corpus is an admin
   exercise, not a staff feature. Any later surface is admin-only, and test
   requests stay excluded. This supersedes the parent plan's decision 3.
2. **Where the first load runs.** Recommendation: an owner-run local script,
   the same pattern as the inventory and the pilots (Production Dataverse reads
   need `DATAVERSE_ALLOW_PROD_READS=yes`). Which database the local
   `POSTGRES_URL` points at is [ASSUMED unknown]; the owner confirms the target
   before the first load. A scheduled keep-current job is step 6.
3. **Migration number: 090 is free as of 2026-10-25** [VERIFIED via an
   owner-run read of Production `schema_migrations` (highest applied:
   `089_manual_presentation_video_pairs.sql`) and a scan of every local and
   `origin` branch (none has a migration numbered 090 or higher)]. Recheck both
   just before the branch merges: another session can claim 090 first.

## Scope

In: Research requests (`RESEARCH_PROGRAM_IDS`) with a meeting year from 2018,
plus requests created in 2026 (era 4); a fresh listing with
`requireCompleteResults` and `requireResolvedParents`; each file classified by
`filename-rules.js`; era and phase recorded.

Out: text extraction and template signatures (step 4; they need file bytes and
their own approval), any model call, any API route or UI, pre-2018 requests
(parked), and writes to SharePoint or Dataverse.

Release tier: **Tier 2** (a migration and Production Dataverse reads): a branch,
review and deliberate promotion, not a direct push to `main`.

## Tables (Postgres; names are proposals)

- **`request_corpus_requests`**: one row per request. `request_id` (key),
  `request_num`, `program`, `meeting_date`, `status`, `is_test`, `era`,
  `listing_status` (`ok` / `error`), `listing_error`, `file_count`,
  `last_listed_at`, `last_run_id`.
- **`request_corpus_files`**: one row per file, keyed by **drive id + Graph
  item id**. `request_id`, `library`, `source` (tracked folder or archive),
  `subfolder`, `name`, `extension`, `size`, `last_modified`, `doc_type`,
  `priority`, `classified_by` (`rule:<id>` or `none`), `rules_version`,
  `phase`, `first_seen_at`, `last_seen_at`, `removed_at`.
- **`request_corpus_runs`**: one row per load. Scope, rules version, start and
  finish, counts (requests, files, errors), status.

Step 4 later adds a text table (Blob pathname, method, outcome, characters,
quality, template id, source version); it is not created now.

**Sensitivity.** Filenames can name people (applicants, referees). The rows
hold what SharePoint already shows staff, and in step 3 no route reads them.
Any later surface is admin-only (decision 1).

## Load and rerun rules

- **Per request, all or nothing.** The loader lists one request's buckets, then
  in one transaction upserts its files, sets `last_seen_at` and updates the
  request row.
- **A listing error never deletes.** If a request's listing fails (truncation,
  throttling, an unresolved parent library, the depth limit), its existing file
  rows stay as they were; the request row records `listing_status = error` and
  the message.
- **Absent files are marked, not deleted.** After a successful listing, files
  previously seen for that request and not seen now get `removed_at`; a file
  that reappears has it cleared. A missing archive folder counts as an empty
  bucket, not an error (as in the inventory probe), so archive files that
  disappear are marked too.
- **A file belongs to one request.** The upsert sets `request_id` and clears
  `removed_at`, so a file moved to another request's folder follows it. A file
  listed under two requests in the same run is recorded as a run error, not
  silently reassigned [the provisional inventory had none: no Graph item id
  appears under more than one request].
- **Windowed by meeting year.** Each Dataverse request read covers one meeting
  year, well under the 5,000-row cap that stops the inventory probe
  (`queryAllRecords` reports `capped`); the inventory holds about 3,850 Research
  requests with meeting years 2018–2026 in total.
- **Idempotent.** Rerunning the same scope gives the same rows (upsert on drive
  id + item id). Each run records scope, rules version and counts. One load at a
  time, under an advisory lock.
- **Reclassify offline.** When the rules change, a reclassify pass updates
  `doc_type`, `priority`, `classified_by` and `rules_version` from the stored
  name and subfolder, without listing SharePoint again.
- **Test requests** carry `is_test` from Dataverse (request 1001931 now does)
  and are left out of counts and later consumers.

## Deliverables

1. The migration, its manifest entry, and the fresh-install shape in
   `scripts/setup-database.js`.
2. In `lib/services/request-file-corpus/`: the listing step (moved out of the
   inventory probe so both use it), the per-request upsert, and reclassify.
3. An owner-run script, `scripts/load-request-file-corpus.mjs`, with `--plan`
   (counts only), `--from`/`--to` meeting dates and resume.
4. An Atlas page, `docs/atlas/postgres-request-corpus.md`, modelled on the
   existing `postgres-*` pages, with Atlas index and catalog entries.
5. Unit tests: a listing error keeps rows; an absent file gets `removed_at`; a
   reappearing file clears it; a rerun is idempotent; reclassify changes only
   classification fields; the test flag is carried.

## Before the first Production load

- Run `--plan` and compare counts with the provisional inventory; they may
  differ, since the inventory lacked the strict parent check.
- Load era 4 (requests created in 2026) first and inspect it, then the rest
  newest first.
- Expect the two known inventory listing errors (request 1001703's document
  location and one archive folder) to reappear as recorded errors.
