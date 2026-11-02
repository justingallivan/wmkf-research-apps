# Retraction Watch refresh operating guide

**Source-built on `codex/integrity-screening-discussion`, not deployed (2026-11-02).** No production migration/import or cron activation has occurred. The data remains Postgres reference data; screening histories and staff decisions remain unchanged.

The official source is Crossref's full CSV at `https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv`; see [Crossref's documentation](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/). Do not use the obsolete Labs feed or substitute an arbitrary URL.

## Safety contract

The managed service validates complete CSV/header/IDs/dates/widths before publishing. It stages and merges under a transaction-scoped advisory lock, preserving the live table/IDs and atomically recording checksum/generation. Failed work before COMMIT leaves the corpus unchanged. Lost COMMIT acknowledgement is explicitly uncertain: inspect authoritative metadata before retrying. Audit logging failure after a confirmed commit is reported separately and does not mean the corpus stayed unchanged.

If unchanged bytes produce different derived rows, `retraction_derived_corpus_differs` reports diff counts and refuses publication; Dry-run reports `sourceUnchanged: true` and the same row differences; do not approve publication when that combination has nonzero differences. Investigate both unmanaged writers and normalization-code changes, then obtain a separately reviewed re-derivation plan. Unchanged upstream bytes only advance last_checked_at, not publication time/generation. A row-count drop beyond 10% or a removal with foreign-key references is refused. Do not work around those guards: inspect a dry-run manifest and revise the exact operation with owner approval. Old manual imports cannot run after the metadata schema exists, and all old/external writers must be quiet before initial cutover.

## Isolated rehearsal

Use `scripts/rehearse-retraction-refresh.cjs` with an explicitly configured `RETRACTION_REHEARSAL_URL` for a temporary loopback database. It does not load `.env.local` or fall back to application credentials. Apply the normal existing-DB migrations to that scratch database first. The command defaults to dry-run; `--file=/absolute/source.csv` selects a local test/downloaded CSV, and `--publish` permits publication **only in that selected loopback database**. Neither argument is accepted from HTTP callers. Temporary prepared files are cleaned up; keep the safe JSON summary/checksum for review, not a tracked copy of the large CSV.

## Production preparation — not yet authorized/executed

1. After Fable review, identify exact target/environment; read schema, corpus counts/timestamps, metadata, foreign keys, known writer/scheduler state, and recovery backup. Row last_updated values do not prove a complete import.
2. Obtain exact migration/first-refresh authorization. Apply 092 via `node scripts/apply-migrations.js`, never fresh-install setup against a populated database. Migration 092 bounds lock acquisition to five seconds; use a quiet window and retry only after inspecting contention. Keep migration output/readback and prove old importers are stopped.
3. Confirm the server-only existing `CRON_SECRET` and non-sensitive `RETRACTION_REFRESH_ENABLED` flag. The new worker refuses missing secrets, Preview/dev, and any flag value except literal `on`. The flag is not a client-supplied option. No secret value belongs in logs, commands saved to Git, or this guide.
4. After explicitly authorized enablement, invoke the production worker with its bearer secret and `dryRun=1`; review safe inserted/changed/removed counts, header/width diagnostics and checksum. Dry-run performs TEMP staging and maintenance audit writes, but rolls back corpus/metadata changes. It is not a no-database-write operation. On the first managed refresh, changed may approach the entire prior count because author normalization and date parsing differ from the legacy importer; inspect samples and treat inserted/removed as the primary first-run comparison, rather than interpreting changed alone as upstream churn.
5. With exact publication approval, invoke the same worker for the controlled first refresh. Inspect `retraction_dataset`, counts, checksum, generation and the checked maintenance receipt. If acknowledgement is uncertain, read authoritative metadata rather than blindly retry. If the worker is killed or no response arrives, a maintenance row may remain running after publication: inspect authoritative metadata and reconcile that operational receipt before retrying. Record auditRecorded=false or an alert failure for follow-up even if publication succeeded.
6. Only after successful readback add the schedule `0 6 1 * *` in a **separate** activation commit/promotion. This is the planned 1st-of-month 06:00 UTC cadence. No schedule entry is included in this implementation.

The function duration ceiling is 300 seconds, with a 240-second work budget and bounded download/database operations. Isolated full-source measurements fit comfortably; actual Vercel/production connection latency remains to be confirmed before activation. No queue/workflow or direct PubPeer endpoint is introduced.

## Screening provenance

New screens record publication generation/checksum and dates with each person's Retraction Watch source. If the corpus changes mid-run, final results are incomplete and cannot receive a new staff approval. No automatic paid retry occurs. Existing runs show that the dataset version was not recorded; their saved evidence and reviews are not rewritten. A freshness warning appears after 45 days without a successful full-source check; it does not revoke an approval or determine misconduct.
