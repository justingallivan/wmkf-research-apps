# Managed Retraction Watch refresh — Fable implementation review

**Source-built, not deployed.** Ordinary read-only Fable review requested by Justin; source disclosure and potential subscription usage explicitly approved, OAuth only, no API credits. The subprocess used the host Keychain-backed first-party subscription session with only HOME/PATH/USER/LOGNAME/SHELL/TMPDIR/LANG/LC_ALL/TERM environment variables. Read/Grep/Glob only, safe mode, no MCP servers, no shell or writes, no token extraction. No alternate review product or authentication fallback was used.

Initial CLI receipt: success, model `claude-fable-5-1`, 68 turns, no permission denials.

## Initial review — verbatim

Review complete. Verdict and findings follow.

**Verdict: NEEDS FIXES** (one P1, small; otherwise the increment matches the plan and guide).

**Whole-flow trace result.** The service, route, migration, fence, and consumers hold together. Confirmed clean from source: strict bearer with no development bypass and production-only plus literal flag gate (`pages/api/cron/refresh-retractions.js:10-23`); approved-host check applied before every fetch including redirects, bounded bytes, identity encoding, content-length agreement when declared (`lib/services/retraction-refresh-service.js:43-69`); full CSV parsing with no skipped rows, required headers, unique nonempty IDs, strict dates, checksum of the staged bytes (`:71-102`); one explicit transaction with `SET LOCAL` timeouts, transaction-scoped advisory lock, TEMP stage `ON COMMIT DROP`, COPY inside the transaction, width and drop and FK guards before any merge, dry-run rollback (`:133-168`); keyed upsert preserving `retractions.id`, explicit removals, metadata upsert with unconditional generation increment so A→B→A cannot evade readers (`:176-189`); commit-uncertainty classification (`:207`); unchanged-checksum path advances only `last_checked_at` with drift detection (`:169-174`). The engine reads metadata before the first corpus query and after the last person, invalidates every person's Retraction Watch source on any change or unverifiable read, recomputes counts, then saves (`lib/services/integrity-service.js:83, 236-249`). Standalone route forwards the corrected `complete.results` untouched and the page renders only that event (`pages/api/integrity-screener/screen.js:117-123`, `pages/integrity-screener.js:406`). Workbench persists the completed array and refuses new approval on `unverified` dataset or any source error (`lib/services/workbench/integrity-service.js:249-253`). Legacy importer refuses before `--clear` (`scripts/import-retraction-watch.js:179-182`). Fresh install reaches parity because the bootstrap executes migration 092 after the base groups (`scripts/lib/fresh-database-bootstrap.js:128-148`). `vercel.json` adds only a duration override.

**P1. One shared alert key suppresses the publication-uncertain and post-commit audit-failure alerts.**
`lib/services/retraction-refresh-service.js:107` uses `autoResolveKey: 'retraction-refresh-failure'` for every alert the service raises. `lib/services/alert-service.js:37-48` returns `null` without inserting when any active or acknowledged alert with that key exists. A still-open alert from an earlier ordinary failure therefore silently drops the later "publication committed=unknown" alert (`:210`) and the "published but logging failed" alert (`:201`). Plan B2 names those two outcomes as the ones that must surface distinctly. For the manual first refresh the HTTP body still carries the code, but for the deferred monthly cron the alert is the only signal.
Fix: distinct keys per outcome class, at minimum `retraction-refresh-publication-uncertain` and `retraction-refresh-audit-failed` separate from generic failure.
Disconfirming test: pre-insert an active `system_alerts` row with the shared key, run the lost-ack facade from `tests/integration/retraction-refresh.pg.test.js:113-120`, and assert a second alert row exists.

**P2. Uncoded failures discard the root cause.**
`lib/services/retraction-refresh-service.js:204-211` rethrows `retraction_refresh_failed` for any error whose code is not a lowercase token, which covers pg, fs, stream, and abort errors, and nothing logs the original. Alert, audit row, and HTTP body carry only the code. A failed first controlled production refresh would be undiagnosable.
Fix: server-side `console.error` of the underlying error only, keeping alert and HTTP text as they are.

**P2. First production publication will report near-total `changed`, and the guide does not say so.**
New rows normalize authors via `IntegrityMatchingService.normalizeName` (`:92`), which reorders "Last, First" and strips honorifics, while the legacy importer produced "last first" (`scripts/import-retraction-watch.js:56-78`) and parsed dates in local time (`:94-105`). The keyed merge's `IS DISTINCT FROM` will mark essentially every legacy row changed. Plan B2 makes inserted/changed/removed the approval signal, so an operator will read the number as corruption. IDs remain stable.
Fix: state in `docs/guides/RETRACTION_WATCH_REFRESH.md` step 4 that the first dry-run is expected to show changed ≈ previous_count and that inserted/removed are the meaningful first-run numbers.

**P2. Unchanged-bytes path refuses legitimate code-driven re-normalization.**
When upstream bytes are unchanged but the stage differs because `normalizeName` changed, `:171` throws `retraction_corpus_drift`, the alert blames unmanaged writers, and the corpus cannot be re-derived until upstream bytes change. Fail-closed, but misdiagnosed and with no exit.
Fix: report a distinct code with the diff counts, or allow publication as a new generation when checksum is unchanged but derived columns differ.

**P2. Migration 092 takes ACCESS EXCLUSIVE on `retractions` with no lock timeout.**
`lib/db/migrations/092_retraction_dataset.sql:5-6` are catalog-only once the lock is held, but `scripts/apply-migrations.js` sets no `lock_timeout`, so the ALTER queues behind any in-flight screening query and blocks new readers meanwhile.
Fix: add `SET LOCAL lock_timeout` at the top of 092 (it survives the migration runner's line-anchored BEGIN/COMMIT stripping) or an explicit quiet-window step in the guide.

**P2. Busy outcome is recorded as `completed` in `maintenance_runs`.**
`:195` writes `status='completed'` for the busy outcome while the route returns `success:false`. If anything reads maintenance status as success, contention looks like a run.

**P2. A version-2 result with no `dataset` object at all remains approvable.**
`shared/utils/integrity-evidence.js:18` treats `undefined` as legacy. The engine always attaches the object for non-empty rosters, so no current writer produces that shape, but the new-approval predicate should require the object when `sourceCoverageVersion === 2`.

**Residual unknowns**
- Production `POSTGRES_URL` pooling mode. Everything is transaction-scoped so transaction-mode pooling should be safe, and the IRS BMF service already runs COPY through the same connection primitive, but plan B2 requires verification, not inference.
- A hard 300-second function kill between COMMIT (`:189`) and the audit update (`:195`) leaves `maintenance_runs` as `running` with no alert and no response. Metadata remains authoritative; the runbook's "record auditRecorded=false" step assumes a response arrives.
- Silent download truncation at a record boundary when no content-length is declared would pass the 90 percent guard. Whether GitLab raw responses declare content-length was not captured.
- Abort or client read-timeout mid-COPY cleanup is untested. `pg-copy-streams` sends CopyFail on destroy and nothing can commit, but the ROLLBACK and release path after it is not exercised.
- One malformed upstream row (empty Title or Author, bad date) fails the whole monthly refresh by design.
- GitLab ignoring `accept-encoding: identity` yields a safe refusal, untested against future server behavior.

Tool access worked throughout. No files were written.

## Controller disposition

- Shared-key P1: corrected with distinct ordinary failure, uncertain-publication and post-commit audit keys. Real isolated Postgres regression pre-inserts an active ordinary alert and uses the actual AlertService to prove both critical alerts survive deduplication.
- Diagnostics: preserve private/row data by logging only error name/code/syscall server-side; HTTP/alert text remains fixed and safe.
- Initial changed counts: operating guide explicitly explains legacy normalization/date differences and requires sample inspection.
- Same-byte derivation differences: fail closed with distinct `retraction_derived_corpus_differs`, safe counts and a reviewed operator reconciliation path; do not silently overwrite drift.
- Migration: five-second transaction-local lock acquisition bound plus quiet-window guidance.
- Busy attempt: maintenance status failed with explicit busy details, never a completed success.
- Missing provenance: new approvals require an explicit dataset object. Historical pre-refresh v2 approvals remain compatible; no historical rows rewritten.
- Hard process kill: guide names possibly running receipts and authoritative metadata reconciliation without requiring a response.

## Controller verification

[VERIFIED via isolated execution] 251 tests across 14 focused suites and 12 real-database tests passed after corrections. The indexed full-source Postgres rehearsal published 73,519 records / 67,793,090 bytes in 11.9 seconds; publication plus unchanged-file verification took 23.1 seconds, RSS about 325 MB. SHA-256 `7a729a87837985954a34326202cb98c4bff4b2b142fda8695febb613cf45a7f4`. Temporary loopback Postgres only, no application DB connection. Production pooling, target/schema, backups, existing writers, hosted performance and actual provider-backed screening remain unverified. These execution claims are controller evidence, not Fable executions.

Canonical Next build, isolated mocked Chromium flow, lint (zero errors, 190 existing warnings), type check and relevant staged-source gates/self-tests passed. The bounded OAuth-only closure review returned READY FOR OWNER REVIEW, with no P0/P1 findings. No production migration/import, enabled flag, registered schedule, merge or deployment occurred. Activation requires the separately approved procedure in the operating guide.

## Browser startup isolation correction

[VERIFIED via local startup log and source trace] The first Increment B browser run passed but inherited the app database configuration. Existing `instrumentation.js` calls `detectMigrationDrift`, which reads `schema_migrations`, may auto-resolve existing alerts, and calls NotificationService. The log reached `NotificationService email failed (alert still stored)`, which follows successful alert creation; email was blocked by the Dataverse target interlock. An operational-event mirror may also have been written. This was an unintended operational database side effect, not a managed refresh/migration. Exact target/rows have not been probed or altered for cleanup. No claim that this first browser run avoided all database access is retained.

The server stopped. The repeat browser run overrides POSTGRES_URL, POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL and DATABASE_URL to a closed loopback fixture port, so the startup monitor cannot reach the inherited database. The repeat passed one mocked Chromium flow including Dataset 7 rendering, with the startup tracker query refusing the fixture connection. No changes were made to the existing production monitor. No refresh, migration or schedule was activated.

## Contract-reconcile disposition

| Audit | Evidence and boundary |
|---|---|
| Whole flow | [VERIFIED via source/tests] strict disabled worker → fixed source → validated CSV → transaction-local TEMP COPY → keyed corpus/metadata publication → generation-fenced saved results → approval/UI/exports |
| Partial success | [VERIFIED via real PG] rollback, commit-ack uncertainty, independently keyed alert outcomes, checked post-commit audit and busy failure; no corpus truncation |
| Async/stale state | [VERIFIED via real PG] actual A→B→A invalidates all people’s corpus source; final stream event is authoritative; no paid retry or transaction across model calls |
| Helper semantics | [VERIFIED via unit/source] explicit unmanaged/unpublished/unverified/recorded states, generation and checksum comparison, freshness uses last check; names remain unverified identity |
| Durable state | [VERIFIED via migration/rehearsal] 092 plus manifest, fresh-bootstrap migration path, stable row IDs and FK-removal guard; [PLANNED] exact live target/schema/pooling/backup checks |
| Documentation | [VERIFIED via source/staged gates] Atlas, route matrix, service catalog, guide, wiki and plan describe source-built disabled worker and deferred activation; startup-test side effect documented above |
| Consumer fan-out | [VERIFIED via tests/browser/source] standalone final results/PDF/Markdown/JSON, Workbench saved final array/history/new approval and dataset label; no saved histories rewritten |

[PLANNED] Production connection/pooler verification, recovery backup, external-writer quiet window, authorized migration, controlled first dry-run/publication/readback and later monthly schedule promotion remain release prerequisites. Failures of upstream availability or future schema/encoding changes remain safe refusals requiring operator action. No hosted performance or real provider response claim follows from local tests.

## Fable closure review — verbatim

CLI receipt: success, `claude-fable-5-1`, 59 turns, no permission denials; same OAuth-only read-only mechanism.

Gap closed: the streaming route sends `result` (singular) on per-person events and `results` only on the fenced `complete` event, and the standalone page sets state only when `data.results` is present. The standalone UI and all exports therefore render post-fence results, matching the Atlas claim.

## Verdict: READY FOR OWNER REVIEW

All seven correction items are confirmed closed in current source and tests. Two P2 items remain, neither blocking the owner gates. No P0 or P1.

**Closure confirmation**

- **Outcome-specific alert keys.** Keys are `retraction-refresh-failure`, `-publication-uncertain`, `-audit-failed` at `lib/services/retraction-refresh-service.js:104-108`, chosen at lines 201 and 211. The integration test at `tests/integration/retraction-refresh.pg.test.js:120-127` seeds an active ordinary alert, passes `alert: undefined` so the real AlertService runs through the mocked `@vercel/postgres` pool, and asserts all three keys exist afterward. Closed.
- **Safe failure logging.** Line 207 logs only name, code, syscall. Returned codes are filtered to lowercase snake case at lines 208-209, so SQLSTATE and Node error codes collapse to a generic code. Alert messages at 201 and 211 carry no error text. Details propagate only for the width and derived-corpus codes at line 212, which contain counts and CSV headers only. Closed.
- **First-run changed count.** Explained at `docs/guides/RETRACTION_WATCH_REFRESH.md:22`. Closed.
- **Derived corpus mismatch.** Distinct code with counts at service lines 169-171, documented at guide line 11, tested at integration lines 65-68 including generation remaining at 1. Closed.
- **Migration lock timeout.** `SET LOCAL lock_timeout = '5s'` at `lib/db/migrations/092_retraction_dataset.sql:5`. Both appliers wrap the body in a transaction, so SET LOCAL is effective: `scripts/apply-migrations.js:87-94` and the fresh-install bootstrap at `scripts/lib/fresh-database-bootstrap.js:105-154`. The fresh install therefore also creates the new table through the manifest. Closed.
- **Busy audit status.** Line 195 writes `failed` for busy, asserted at integration line 87. Closed.
- **New approval requires dataset, history stays compatible.** `lib/services/workbench/integrity-service.js:253` requires the dataset object only under `forNewApproval`; `shared/utils/integrity-evidence.js:18` treats a missing dataset as legacy; `deriveReviewState` at lines 373-401 keeps an approved run approved with an "earlier rules" reason. Rejection tested at `tests/unit/workbench-integrity-review-service.test.js:368`. Closed by inspection, test gap noted below.
- **NODE_ENV and VERCEL_ENV.** `pages/api/cron/refresh-retractions.js:21` requires both plus literal `on`. Tested at `tests/unit/retraction-refresh-route.test.js:10-16`. Closed.
- **Killed-worker receipt reconciliation.** Guide line 23. Closed.

**P2 findings**

1. **Compatibility claim lacks a disconfirming test.** No test exercises a pre-Increment-B v2 run (coverage version 2, no dataset object) with an existing approval. Logic is correct by inspection, but the claim is untested. Required test: clone the v1 test at `tests/unit/workbench-integrity-review-service.test.js:340-353` with `sourceCoverageVersion: 2, matchingVersion: 2` and `dataset: undefined`, asserting `status: 'approved', canApprove: false` and the "earlier rules" reason, plus `needs_review` and rejection when unapproved.

2. **Dry-run cannot predict the derived-corpus refusal.** The check at service line 171 is reachable only when status is `unchanged`, but dry-run forces `dry_run` at line 166 and rolls back at 168. The row-drop guard at 161 and the foreign-key guard at 164 do fire in dry-run, so the guide's "inspect a dry-run manifest" preflight is inconsistent: a clean dry-run can be followed by a refused real run. Required fix: apply the same inserted/changed/removed check whenever the previous checksum equals the prepared checksum regardless of dry-run, or add a `sourceUnchanged` boolean to the dry-run outcome. Disconfirming test: a dry-run after the drift update at integration line 66 should reject with the same code or report `sourceUnchanged: true` with nonzero changed.

**Residual unknowns, preflight scope**

- Production legacy corpus row count versus the 10% drop guard, and whether any legacy rows carry a NULL `record_id`. Such rows are counted as removed and deleted on the first managed refresh. Dry-run surfaces both.
- Rehearsal ran against direct Postgres. On Vercel the connection string is typically the pooled endpoint. TEMP table, COPY, SET LOCAL, and the transaction advisory lock all live inside one transaction and should survive transaction pooling, but this is unverified until the first controlled production dry-run.
- The duration override relies on the specific-file entry in `vercel.json` winning over the cron glob at 120 seconds. This matches the existing `refresh-irs-bmf.js` precedent, so it is not new risk.
- Production connection latency against the 120-second statement timeout and 240-second budget remains unmeasured, as the guide already states.

Controller execution evidence was taken as reported. I ran no tests, probes, or shell commands.

### Final controller disposition of nonblocking P2 items

The historical-approval test is now parameterized for both v1 and pre-refresh v2 without dataset metadata, covering saved approval, unapproved status and new-approval rejection. The dry-run outcome now includes the reviewer-proposed `sourceUnchanged` boolean; the real Postgres derivation-difference regression asserts true plus changed/inserted/removed counts. The guide explains that unchanged-source/nonzero-difference combination requires reconciliation before publication. These prescribed final corrections are controller-verified after the independent READY verdict; no third Fable review is claimed.
