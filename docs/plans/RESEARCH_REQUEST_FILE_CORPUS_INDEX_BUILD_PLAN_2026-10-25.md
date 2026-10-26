---
title: Research request file corpus — index build (rollout step 3)
kind: plan
domain: dataverse
status: active
summary: "Approved: build the metadata index of SharePoint files for Research requests with a meeting year from 2018, in Postgres, from a fresh strict listing, classified by the filename rules; no text, no route, no model. Visibility decided (no per-request rule; admin exercise). Migration 090 free as of 2026-10-25. Owner-run local loader decided. Built on a branch; migration 090 applied from the branch; first full load run 2026-10-26 (3,853 requests, 38,399 files, 1 known error); merged to main 2026-10-26 (460e4476a)."
owner: product-engineering
related:
  - docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md
  - scripts/probe-request-file-inventory.mjs
  - lib/services/request-file-corpus/filename-rules.js
  - lib/utils/sharepoint-buckets.js
  - docs/atlas/postgres-infra-tables.md
---

# Research request file corpus — index build (rollout step 3)

[APPROVED by the owner 2026-10-25; built on branch `claude/request-corpus-index`, merged to `main` 2026-10-26 (`460e4476a`) after a final review; migration 090 applied from the branch; first full load completed 2026-10-26 (see "First Production load"). Parent plan:
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
2. **Where the first load runs — DECIDED by the owner 2026-10-25: an owner-run
   local script**, the same pattern as the inventory and the pilots (Production
   Dataverse reads need `DATAVERSE_ALLOW_PROD_READS=yes`). The local
   `POSTGRES_URL` points at the shared app database [VERIFIED 2026-10-25 by
   hostname only: a `us-west-2.aws.neon.tech` host, database `neondb`; the
   runbook describes one app database shared by Production and Preview,
   `docs/CREDENTIALS_RUNBOOK.md` "Rotating the app Postgres password"], so a
   local load writes the live database's new tables. The loader prints the
   target hostname first. A scheduled keep-current job is step 6.
3. **Migration number: 090 is free as of 2026-10-25** [VERIFIED via an
   owner-run read of Production `schema_migrations` (highest applied:
   `089_manual_presentation_video_pairs.sql`) and a scan of every local and
   `origin` branch (none has a migration numbered 090 or higher)]. Rechecked
   2026-10-26 before the merge: no other local or `origin` branch had a
   migration numbered 090 or higher.
   **Applied 2026-10-25 before merge**, by the owner running
   `scripts/apply-migrations.js` from branch `claude/request-corpus-index` at
   `4ab2124d2` against the shared app database (1 applied, 88 skipped). A
   tracker row for 090 before this branch merges is this application, not a
   stray.

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
  time, under a session advisory lock on a direct (non-pooled) connection,
  `POSTGRES_URL_NON_POOLING` (final review, 2026-10-26).
- **Reclassify offline.** When the rules change, a reclassify pass updates
  `doc_type`, `priority`, `classified_by` and `rules_version` from the stored
  name and subfolder, without listing SharePoint again.
- **Test requests** carry `is_test` from Dataverse (request 1001931 now does)
  and are left out of counts and later consumers.

## Deliverables

1. The migration, its manifest entry, and the fresh-install shape in
   `scripts/setup-database.js`.
2. In `lib/services/request-file-corpus/`: the strict listing step
   (`listing.js`; the inventory probe keeps its own per-bucket copy), the
   per-request upsert, and reclassify (`index-store.js`).
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

## First Production load (2026-10-26)

Owner-run from branch `claude/request-corpus-index` against the shared app
database; output pasted into the session [VERIFIED via the loader's printed
whole-run summary, which `finishRun` recomputes from stored rows].

- `--plan`: 3,854 Research requests with meeting years 2018–2026 (2026: 447,
  6 test; 2025: 296, 1 test; 2024: 400; 2023: 406; 2022: 430; 2021: 494;
  2020: 483; 2019: 491; 2018: 407).
- Trial `--limit=25` (newest cycle): run `3f23ff55-6664-476d-a330-426603d526bf`,
  25 requests, 326 files, 0 errors; label counts inspected and judged sane.
- Full load: run `5631c55d-1b92-498f-9e93-e625dd1bfd16`
  (`filename-rules:bf050083cdd6`), about 85 minutes: 3,841 listed, 38,315
  files, 13 errors. Eleven were transient Dataverse timeouts among 2018–2019
  requests; one `--resume` of the same run retried them.
- Whole run after the first resume: **3,852 requests listed, 38,340 files, 2
  errors** — the two expected inventory errors: request 992853 (its
  `RequestArchive3` folder returns 404) and request 994366 (its document
  location points at request 1001703's library, which the Graph allowlist
  refuses). Both are Dynamics/SharePoint data problems, not loader faults.
- 2026-10-26, after the owner's colleague removed request 994366's stray third
  document location (a pointer into another request's folder) in Dynamics and
  SharePoint, a second `--resume` listed it: whole run **3,853 requests, 38,399
  files, 1 error** (request 992853 only). The colleague confirmed that request
  documents live in four libraries (`Request`, shown in Graph as
  `akoya_request`, and `RequestArchive1`–`3`), and that some requests active
  at the GMS migration still have two pointers, one to `Request` and one to an
  archive; the loader already lists every Dynamics pointer plus each archive's
  standard folder, so both locations are covered. Request 992853's error is a
  Dynamics pointer to a `RequestArchive3` folder that does not exist
  [ASSUMED to be one of those leftover pointers].
- The full load connected through the pooled `POSTGRES_URL`; only one loader
  ran at a time, so the lock weakness the final review found did not bite.
  The loader now requires the direct connection.
- The provisional inventory counted 38,316 files for the same years; the load
  is within normal snapshot drift of it.
