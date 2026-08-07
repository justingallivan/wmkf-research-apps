# Atlas: `reviewer_identity_shadow_log` (Postgres — observability only)

**Last verified:** 2026-07-19 — production migration
`026_reviewer_identity_shadow_log.sql` is tracked as applied. Live catalog
verification found the expected 12 columns and four indexes.
**Live row count:** 0 immediately after migration; the one-day canonical
report also returned zero comparisons, errors, and runs.

## Purpose

Durable copy of the shadow W2-vs-legacy comparisons that
`lib/services/reviewer-identity-runtime.js` previously emitted only to
`console.info` — Vercel runtime logs expire within minutes, which made shadow
cohort observation impossible after the fact. Rows support arm-disagreement,
authoritative combined-outcome, and error reporting, grouped by `run_id` (one
UUID per resolver batch).

The request-batch resolver's aggregate cache/provider-call metrics are separate
PII-free `console.info` telemetry. They are not stored in this table and do not
change its schema, retention, or reader contract.

## Source of truth

- Schema: `lib/db/migrations/026_reviewer_identity_shadow_log.sql` (fresh-install mirror: `scripts/setup-database.js` v36 block).
- Writer: `lib/services/reviewer-identity-shadow-log.js` — sole write path, called only from the default shadow/combined observers in `reviewer-identity-runtime.js`.
- Cleanup: `MaintenanceService.cleanupReviewerIdentityShadowLog` (daily `/api/cron/maintenance`; `retention:reviewer_identity_shadow_log_days` Dataverse setting, default 90 days, plus a 200k hard row cap).
- Readers: no application decision path. The canonical operator read path is
  `node scripts/report-reviewer-identity-shadow-log.js`; it supports
  run-, mode-, and time-scoped text/JSON reports.

## Invariants

- **Non-authoritative.** Nothing on any reviewer decision path reads this
  table; deleting every row at any time is safe.
- **Best-effort writes.** The writer always resolves and opens a circuit breaker
  (60s) after 5 consecutive insert failures. Runtime observers await each
  best-effort insert, capped at 2 seconds, so normal writes settle before
  function completion without an unbounded observability wait;
  logger/storage failure must never alter the reviewer decision (tested in
  `tests/unit/reviewer-identity-shadow-log.test.js` and
  `tests/unit/reviewer-identity-runtime.test.js`).
- **Data-minimized pseudonymous identifier.** No raw candidate names, email
  addresses, proposal content, provider
  payloads, identity anchors, or secrets. `candidate_key` is the runtime's
  16-hex-char truncated SHA-256 of normalized `name|institution` —
  recomputable and dictionary-testable by a party holding the roster. Treat it
  as pseudonymous personal data, not anonymous data. Error rows store a stable
  `error_code` only, never messages; they retain the pseudonymous candidate key
  so batch failures remain attributable.
- **Bounded.** Text values clamped to 120 chars at the writer; lifetime
  bounded by retention + row cap in the maintenance cron.

## Columns

`id`, `run_id` (batch UUID), `resolver_mode` (default `'shadow'`),
`event_type` (`comparison` | `error`), `candidate_key`, `legacy_decision`,
`works_decision`, `combined_decision`, `combined_reason`, `anchors_agree`,
`error_code`, `created_at`.
