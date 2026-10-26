---
title: "Atlas: Research request file corpus index"
domain: postgres
kind: state-page
status: source-built
summary: "Migration 090 adds request_corpus_runs, request_corpus_requests and request_corpus_files: a derived, rebuildable metadata index of SharePoint files for Research requests with meeting years from 2018, filled by an owner-run loader. Branch-built 2026-10-25; not applied or loaded. No route reads it; admin use only."
canonical: true
cataloged: 2026-10-25
owner: product-engineering
related:
  - docs/plans/RESEARCH_REQUEST_FILE_CORPUS_INDEX_BUILD_PLAN_2026-10-25.md
  - docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md
  - lib/db/migrations/090_request_corpus_index.sql
  - lib/services/request-file-corpus/index-store.js
  - lib/services/request-file-corpus/listing.js
  - scripts/load-request-file-corpus.mjs
---

# Research request file corpus index

[VERIFIED via source and recording-client unit tests, 2026-10-25; branch
`claude/request-corpus-index`. Not applied to any database; no load has run.]
Migration 090 creates three tables. They are derived state: SharePoint owns the
files, Dataverse owns the requests, and every row can be rebuilt by listing
again. No API route, page or worker reads them; the corpus is an admin
exercise (owner, 2026-10-25), and test requests are carried but excluded from
later consumers.

## Tables

- **`request_corpus_runs`**: one row per load. `run_id`, `scope` (meeting
  years, limit), `rules_version` (a hash of `filename-rules.js`), `status`
  (`running` / `completed` / `failed`), counts, and per-request `errors`.
- **`request_corpus_requests`**: one row per Research request listed.
  Request number, program label, meeting date, created on, status, `is_test`,
  `era` (1–4, recut at 2018), `listing_status` (`ok` / `error`),
  `listing_error`, `file_count`, `last_listed_at`, `last_run_id`.
- **`request_corpus_files`**: one row per SharePoint file, keyed by Graph
  `drive_id` + `item_id`. Request, library, source (tracked folder or
  archive), subfolder, name, extension, size, last modified, MIME type,
  `doc_type`, `priority`, `classified_by` (`rule:<id>` or `none`),
  `rules_version`, `phase`, `first_seen_at`, `last_seen_at`, `removed_at`,
  `last_run_id`.

## Writers and rules

Only `scripts/load-request-file-corpus.mjs` writes, through
`lib/services/request-file-corpus/index-store.js`, holding a Postgres advisory
lock so one load runs at a time.

- `saveRequestListing` writes one request per transaction: request row, file
  upsert (sets `request_id`, clears `removed_at`), then `removed_at` on that
  request's rows not seen in this run. Rows are never deleted.
- `saveRequestError` records a listing error on the request row and leaves its
  file rows and stored file count as they were.
- A file listed under two requests in one run is recorded as an error on the
  second request, not reassigned.
- `reclassify` recomputes `doc_type`, `priority`, `classified_by`, `phase` and
  `rules_version` from the stored name and subfolder.

The listing (`listing.js`) uses `getRequestSharePointBuckets` with
`requireCompleteResults` and `requireResolvedParents`; truncation, depth limits
and any bucket error fail the whole request; a missing archive folder counts as
an empty bucket.

## Readers

None in the app. Owner analysis queries only.

## Sensitivity and retention

Filenames can name applicants and referees; the rows hold what SharePoint
shows staff. No automatic deletion: absent files keep their row with
`removed_at`. The tables can be dropped and rebuilt from SharePoint. File rows
reference their request row; `last_run_id` is a plain column (no foreign key),
so old run rows can be pruned without touching files.
