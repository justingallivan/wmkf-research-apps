---
title: Test Request Factory Run Ledger
domain: test-request-factory
kind: atlas
status: active
summary: "Durable operation ledger for admin-driven test request clone runs; unapplied to any live database."
canonical: false
cataloged: 2026-09-23
last_verified: 2026-09-23
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md
  - lib/db/migrations/054_test_request_runs.sql
---

# Atlas: `test_request_runs` / `test_request_run_resources` (Postgres)

**[VERIFIED via source, 2026-09-23]** Migration 054 and its fresh-install
mirror (scripts/setup-database.js, V55) define the durable run ledger for
the Test Request Factory's "basic clone" stage
(docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md, "Operation contract
and recovery" and the "3. Basic clone" build-stage row). **Neither table
exists in any live database yet.** Migration 054 is listed in
`lib/db/migrations-manifest.json` but has not been run against the shared
Production/Preview Postgres database; applying it requires explicit owner
authorization and `node scripts/apply-migrations.js`, which this slice does
not perform.

## Contract

- **Writer:** `lib/services/test-requests/run-ledger.js` (`createRunLedger`),
  called by the bounded resumable runner
  `lib/services/test-requests/run-runner.js` (`advanceRun`, one step per
  call) through the CLI modes `--reserve` / `--advance` / `--run-inspect`
  of `scripts/rehearse-test-request-sandbox.mjs`, which connect only to
  the operator-supplied `TEST_REQUEST_LEDGER_URL` (refused when unset, when
  it names a neon.tech host, or when it equals any shared `POSTGRES_URL*` /
  `DATABASE_URL` value). No API route or worker calls the ledger yet.
- **Reader:** the same run-ledger store (`getRun`, `listRunResources`,
  `listRuns`) and, eventually, the admin Test Requests operations panel
  (list/status/resume/retire, design-doc stage 5, not yet built).
- **Cleanup:** none yet. Retirement (`status = 'retiring' → 'retired'`) is a
  planned admin action (design-doc stage 5); no automatic row deletion
  exists or is planned — the ledger is a durable audit trail of clone runs,
  not a transient queue.
- **Privacy:** the schema and the store enforce the design doc's rule that
  the ledger never carries credentials, bearer links, document bodies,
  purpose text, create request bodies, or bundle contents. Only identities
  (source/destination request, location, app-user, organization, Graph
  site/drive GUIDs; the run's own `run_id`), hashes/digests (`bundle_sha256`,
  `copy_policy_digest`, `plan_digest`, `create_body_sha256`, and per-resource
  provenance hashes inside `source_provenance`/`readback` JSONB), sizes,
  timestamps, and structured error codes are stored. `last_error`,
  `needs_attention_reason` and resource `error` never hold upstream message
  text: `ledgerReasonOrThrow` accepts only a member of the finite exported `LEDGER_REASON_CODES` set (or an
  Error, which `describeLedgerError` reduces to an internal code or a
  classification such as `upstream_http (http 401)`, `timeout`, `network`,
  `unknown_error`) and rejects prose. Full messages belong in the operator's
  private receipt or log, never in Postgres. Every JSONB write
  (`planned_identity`, `source_provenance`, `readback`) is validated by
  `assertLedgerReceipt` BEFORE any SQL: an allowlist of receipt keys
  (`LEDGER_RECEIPT_KEYS`: identities, hashes, sizes, statuses, timestamps),
  flat objects only, bounded string lengths, no URLs, line breaks or
  credential-shaped values (recognized token prefixes are rejected
  outright), SHA-256 shape for `*Hash`, digits for `requestNumber`, and
  exact Microsoft Graph shapes for site, drive and item identifiers. Unknown keys and unsafe values are rejected with
  `400 test_request_ledger_unsafe_value`, never redacted, so a Dataverse
  response body, purpose text or Graph download URL cannot land in the
  ledger. `ready` additionally requires `destination_request_number`
  (validator in `markReady` plus the `test_request_runs_ready_request_number`
  CHECK). The live PostgreSQL suite is a required CI job
  (`.github/workflows/test.yml` `ledger-postgres`, fails rather than skips).
- **Text columns:** `current_step` and resource `step` accept only members
  of `LEDGER_STEPS`; resource kind/system/outcome are checked against their
  enums before SQL; every text column written by `reserveRun` is validated
  by `assertReservePlan` (bounded identifiers, hostnames, digests, dates and
  `test_label` derived server-side from validated fields, `idempotency_key` stored as the SHA-256 of the caller's key, and `actor_id` an authenticated principal GUID or a `cli:` digest of the OS username). No column stores caller-typed text.
- **Trust:** `test_request_runs` is keyed by a caller-supplied
  `(actor_id, idempotency_key)` unique pair so a retried confirm cannot
  create a second run or a second destination GUID (see
  `reserveRun` in run-ledger.js: `INSERT ... ON CONFLICT DO NOTHING` followed
  by a `SELECT` inside the same transaction, so the first-reserved row's
  `destination_request_id`/`destination_location_id` always wins on retry).
  Every subsequent mutation is fenced by `lease_token` + `lease_generation`
  (+ `version` + `locked_until` on step/status writes), matching the
  convention in `lib/services/scheduled-email-store.js`. A run-row fence
  miss returns `null`; a resource-journal write whose run-row fence fails
  throws `409 test_request_run_fenced` (lease expiry judged by the database
  clock). `needs_attention` runs are re-claimable: `advanceStep` (which may
  only set `creating`) and `markReady` clear `needs_attention_reason`, and
  `markReady` and `markNeedsAttention` both clear `lease_token`/`locked_until`
  so Resume is never held to lease expiry (a worker's stale token is then a
  fence miss and it must re-claim). `advanceStep` may record the
  server-assigned `destination_request_number` as soon as it is read back,
  so a run that stalls after Create keeps the number on the run row. The `completed_at`
  CHECK requires it for `ready`, forbids it before `ready`, and admits
  either for `retiring`/`retired` (reachable from `ready` or
  `needs_attention`).
- **Authority:** Dataverse remains the request and document-registry
  authority; SharePoint remains file authority. This ledger never becomes a
  second source of truth for either — `destination_request_number` is a
  server-assigned readback recorded for display/lookup convenience, not a
  value the ledger originates.

## Limits

- Migration 054 is unapplied; nothing in this repository writes to these
  tables yet outside tests.
- `test_request_run_resources.readback`/`source_provenance` are JSONB and
  the schema cannot itself forbid a caller from stuffing prohibited content
  (document bodies, tokens) into them — that discipline lives in the
  run-ledger.js call sites once the execution service (design-doc stage 3+)
  is built, and is not enforced by a database constraint.
- No cleanup/retention policy exists yet; row growth is unbounded until the
  design doc's stage 5 retirement/retention work lands.
