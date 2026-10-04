---
title: Test Request Factory Run Ledger
domain: test-request-factory
kind: atlas
status: active
summary: "Durable test Request ledger, written by the owner-run CLI and, since 2026-10-02, by the deployed admin form in Production. Current copy: managed Neon ledger (054 + 058, operational data loaded 2026-09-30) behind a tracked host registry and schema fingerprint check. Shared Production app DB has 054 + 058 tables (empty; never the ledger); Preview unverified."
canonical: false
cataloged: 2026-09-23
last_verified: 2026-10-02
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md
  - lib/db/migrations/054_test_request_runs.sql
  - lib/db/migrations/058_test_request_cast_slot_bindings.sql
---

# Atlas: Test Request Factory Postgres ledger

Tables: `test_request_runs`, `test_request_run_resources`,
`test_request_run_reviewer_assignments`, `test_request_status_changes`,
`test_request_cast_members`, `test_request_cast_bindings`, and
`test_request_cast_slot_bindings`.

**Where the ledger lives (2026-09-30, S553; `docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md`).** The operational ledger for production test Requests has lived only in `ledger_prod` inside the `wmkf-ledger-pg` Docker container on the owner's home Mac (sandbox counterpart `ledger`), hand-built and never dumped [VERIFIED S553: the office Mac holds no `ledger_prod`]. Owner decision D1 moved it to Neon project `wmkf-factory-ledger` (Vercel Marketplace, connected to no Vercel project, us-east-1), databases `ledger_prod` and `ledger`, with 054 + 058 applied and the local tracker `ledger_schema_migrations` recording 054; the home-Mac operational data was loaded into both on 2026-09-30 and the managed ledger is now the current copy [VERIFIED via `docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md`]. Merged in PR #374: `lib/db/ledger-registry.js` is the tracked host allowlist the CLI's `requireLedgerUrl(target)` enforces (managed host requires `ledger_prod` for `--target=production`, `ledger` otherwise; the app's `POSTGRES_URL` is always refused), `lib/db/ledger-schema.js` + `lib/db/ledger-schema-fingerprint.json` are the structural schema check every ledger-driven CLI mode runs first (`check:factory-ledger` gate, `--ledger-check`), and `scripts/apply-ledger-migrations.js` is the ledger's own migration runner. Connection strings are `.env.local` variables for the CLI; since 2026-10-02 the production URL is also a hand-set Vercel Production variable for the admin form (`docs/CREDENTIALS_RUNBOOK.md`; see *Second writer: the deployed admin form*).

**[VERIFIED via source, 2026-09-29]** Migration 054 and its fresh-install
mirror (scripts/setup-database.js, V55) define the durable run ledger for
the Test Request Factory's "basic clone" stage
(docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md, "Operation contract
and recovery" and the "3. Basic clone" build-stage row). The owner-run record
names the local `ledger_prod` as the ledger for the production cast creation
[VERIFIED via `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md`,
*Order* 4]. For the first cast-bound clone (run `e33fa857`, Request 1003303)
and its `--bind-reviewer`, *Order* 5 does not name the ledger. At that historical checkpoint, the CLI
structurally required an operator-supplied `TEST_REQUEST_LEDGER_URL` for those
modes and refuses one that is unset, equals a shared `POSTGRES_URL*` /
`DATABASE_URL` value, or names a neon.tech host [VERIFIED via
`scripts/rehearse-test-request-sandbox.mjs:750-760,1283-1341`]. That historical guard ruled out
the configured shared URLs and neon.tech hosts, but does not independently
prove the supplied URL is local or which database was used; the
exact owner-run target for that clone and binding is unverified (no direct
record) [ASSUMED unknown].
Migration 054 is applied to the shared Production Postgres (2026-09-26 06:54Z,
`applied_by` `codex-feature-request-2026-09-26`) [VERIFIED via an owner-run
read-only `schema_migrations` query, S552], but from `codex/feature-request`, whose
last committed 054 at that time was `af65a24bd` (2026-09-24), before the cast tables; the
installed shape was not read. Preview's database is unverified. Existing
shared databases use `node scripts/apply-migrations.js`; the owner retains
control of any shared-database application. The local ledgers took 054 and
its in-place amendments by owner-run `psql` (cast plan, *Order* 1 and 4), and
the B4 plan forbids pointing that runner at them (cast plan, *Order* 6, §6).

## Contract

- **Writer:** `lib/services/test-requests/run-ledger.js` (`createRunLedger`), called by the bounded resumable runner and status/cast CLI operations through `scripts/rehearse-test-request-sandbox.mjs`, and by the deployed admin form described below. Target-bound `requireLedgerUrl` uses the tracked registry and refuses shared app databases; the managed ledger is allowed only with its matching target database. The new local `file-recovery-runner.js` uses a separate narrow `recoverFileReadback` transaction; its initial entry point is Sandbox-only and has not been exercised against a live stopped run.
- **Reader:** the same ledger store (`getRun`, `listRunResources`, `listRuns`), owner CLI inspection, and the deployed actor-scoped admin list/detail/diagnosis. The new file verifier adds exact live file evidence without changing the web diagnosis.
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
  exact Microsoft Graph shapes for site, drive and item identifiers. The
  same grammars are CHECK constraints in migration 054 for every text
  column, and the SQL function `test_request_receipt_ok(jsonb)` applies
  the receipt allowlist and per-key grammars to `planned_identity`,
  `source_provenance` and `readback`, so a writer that bypasses the JS
  validators cannot store a URL, token, body or prose in any column. Unknown keys and unsafe values are rejected with
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
- **Production Foundation baseline (MVP item 5, 2026-09-28):** a production
  `basic` run journals one `foundation_transition` resource at
  `fence_source`, before the create: digests of the Foundation account's
  protected projection, its Tax Status/BMF 509 pair, its four non-audited
  GuideStar columns and its Contacts' versions (`foundationProjectionSha256`,
  `foundationGoverifyResultSha256`, `foundationGuidestarSha256`,
  `foundationContactsSha256`), the pre-run `akoya_countofrequests` (`count`),
  the two GoVerify timestamps and `capturedAt`. No other account value is
  stored. `verify` evaluates the account against it
  (`lib/services/test-requests/foundation-transition.js`) and, on a pass,
  journals a second `foundation_transition` row at `verify` whose `outcome`
  is `refreshed` or `not_refreshed`. Sandbox runs write neither row. The
  read-only CLI mode `--target=production --run-recheck=<runId>` re-reads the
  account and evaluates it against the same baseline (no ledger write).

## Fresh Basic file receipt recovery — source build, live rehearsal pending

[VERIFIED via source, 2026-10-03] The local `file-recovery-runner.js` claims the run lease and repeats read-only verification before `recoverFileReadback`. The transaction locks/fences the run by token, generation, version, stored actor, target, exact Request, step and pinned digests; compares the exact old resource outcome, sequence, planned identity, provenance and readback; and checks the original six-hour source freshness using the database clock. A mismatch leaves the file receipt unchanged. A failure after the resource update rolls the whole transaction back.

Success marks exactly one file `verified`, merges only typed readback metadata/digests, preserves dispatch history, clears the run's stop reason, increments its version and releases the lease at the same `copy_file` step. It neither skips remaining files nor marks `ready`. The ordinary runner still performs final verification. Complete package-attestation details live in a private create-only local receipt written before the transaction; the ledger retains the existing attested digest. There is no schema migration, source-time renewal, remote file write or cleanup. Initial recovery is Sandbox-only; Production recovery promotion and a live disposable rehearsal remain outstanding. Request 1003308 is excluded.

## Second writer: the deployed admin form (2026-10-02)

**[VERIFIED via `lib/services/test-requests/admin-run-service.js`, `lib/services/test-requests/factory-artifact-store.js`, `pages/api/cron/maintenance.js`, `vercel env ls production` (names only) and owner-run `--run-inspect`, 2026-10-02]**

- **Writer:** `createAdminRunService` (`lib/services/test-requests/admin-run-service.js`), behind the eight superuser routes under `pages/api/admin/test-requests/runs/`. It calls the same `createRunLedger`, `advanceRun` and status runner as the CLI: `confirmRun` reserves a run, `advance` advances one step per request, `changeStatus` / `statusRecheck` journal status changes. Recipe: `basic` only.
- **Which ledger:** the deployment picks the target (`targetFromDeployment`): Vercel Production opens `ledger_prod` through `TEST_REQUEST_LEDGER_URL`; any other deployment opens `ledger` through `TEST_REQUEST_SANDBOX_LEDGER_URL` and never falls back to the production variable (`ledgerUrlFor`). Both go through `requireLedgerUrl`, so the registry and the "never the app database" rule apply unchanged. Production holds only the production URL. Preview holds neither as a standing variable; the 2026-10-02 rehearsal set the sandbox URL branch-scoped and removed it.
- **Actor:** `admin:<UUIDv5 of the staff profile>`; a run is visible only to the actor that reserved it. A CLI run reserved under a different actor (`cli:<digest>` by default, or `user:<guid>`) is not listed by the form. The CLI's `--advance` takes the manifest and bundle as local files (`--manifest`, `--bundle`), so advancing a form run from the CLI needs them downloaded first (below).
- **Switch:** `TEST_REQUEST_FACTORY_FORM=on` gates source lookup, Confirm, advance, status change and status recheck (`requireWritable`); list, detail, artifacts, Foundation recheck and status options are not gated. On in Production since 2026-10-02.
- **Production runs through the form so far:** `20407283-c279-5e0c-b396-210ad6842482` (Request 1003308, `needs_attention`, `file_journal_unverified`, not resumable) and `a5161f47-7b02-5ad3-8f20-3f645ec3c254` (Request 1003310, `ready`, one status change).

### Factory artifact Blob store

- **Store:** private Vercel Blob store `wmkf-factory-private` (`store_I7EbkXANJL0zeaby`), token `FACTORY_BLOB_RW_TOKEN` (Production only). The ledger holds no source text; the form keeps the source bundle and the run manifest here.
- **Factory source bundle v5 (2026-10-03):** [DEPLOYED via PR #425 (`14e90a4`) to Ready Production deployment `dpl_Ac2a21TX57PXgTcMJ57FSCrTJpKF`; the new-clone live path has not yet been smoked.] The private bundle includes the source Request's applicant `wmkf_abstract` for ordinary basic clones. The compiler copies it to the new Request and source fencing/readback verify it; only bundle/body digests enter the ledger. This does not include `wmkf_abstractformatted` or `wmkf_abstractapproved`. Separately, the owner-authorized abstract-only repair of Request 1003303 returned HTTP 204 and its exact 2,476-character readback matched the pinned source; receipt: `/tmp/factory-abstract-repair-receipt.json`.
- **Pathnames** (minted only by `factory-artifact-store.js`): `<target>/drafts/<actorId>/<draftId>/bundle.json` at source lookup; `<target>/runs/<runId>/{bundle,manifest}.json` at Confirm, written create-only before the ledger row is reserved.
- **Reader:** `advance` (manifest, and the bundle checked against the run's `bundleSha256`), the artifacts route, and the owner-run `scripts/factory-artifacts-download.mjs`.
- **Deletion:** only `sweepFactoryArtifacts`, run by the daily maintenance cron (`pages/api/cron/maintenance.js`), and only when both `TEST_REQUEST_LEDGER_URL` and `FACTORY_BLOB_RW_TOKEN` are set, which is now true in Production. It deletes drafts older than 6 hours; a run's two objects when its ledger row is `ready`; and objects with no ledger row once all are older than 24 hours. It never deletes for a `prepared`, `creating` or `needs_attention` run, so the artifacts of a parked run (today: `20407283`) stay until someone removes them by hand. Caps: 1,000 objects scanned per prefix and 200 deletions per sweep. Aggregate execution observed in the 2026-10-03 03:00 UTC daily maintenance record: 4 deleted, 2 kept, no errors or truncation. Exact object identities were not independently verified; see `docs/audits/OPEN_ITEMS_FOLLOWUP_2026-10-03.md`.
- **Consequence:** once a `ready` run's artifacts are swept, its manifest and bundle exist nowhere unless the owner downloaded them first.

## `test_request_run_reviewer_assignments` (slice 6c-i, D-R2 owner decision, 2026-09-25)

**[VERIFIED via lib/db/migrations/054_test_request_runs.sql and lib/services/test-requests/run-ledger.js, 2026-09-25]**
A third table, added in place to migration 054 (and its
`scripts/setup-database.js` V55 mirror): one row per reviewer assignment
reserved for a `reviews` recipe run (`run_id`, `sequence`,
`source_person_id`, `destination_person_id`, `reused`, `address`,
`address_sha256`, `created_at`). `sequence` is unique per run;
`source_person_id` and `address` are each unique per run.

- **The one sanctioned exception:** `address` is plain text — the ONE
  column in this ledger that is not a finite grammar or a digest. Decision 4
  makes the per-run address assignment the recipient-confinement authority,
  and D-R2 accepted this exception rather than dropping the address
  entirely; every other surface (JSONB receipts, `needs_attention_reason`,
  `--run-inspect` output) carries only `address_sha256`.
- **Writer:** `createRunLedger(db).reserveRun` writes every assignment row
  in the same transaction as the run reservation, only on the very first
  reservation of a given `(actor_id, idempotency_key)` (`created === true`);
  there is no UPDATE path anywhere in run-ledger.js, so a row is immutable
  once written. `assertReviewerAssignments` (private to run-ledger.js)
  validates before any SQL: non-empty when `recipeSeedsReviewers(recipe)` is
  true (`reviews` and every later cumulative recipe — slice 4a,
  `lib/services/test-requests/recipe-capabilities.js`), none otherwise, no
  two assignments sharing a source reviewer or a normalized
  (trim+lowercase) address. The CLI's `--reserve --recipe=reviews` is the only
  caller today; each bundle reviewer's address comes from its
  `--reviewer-address=<sourcePersonGuid>=<address>` flag, else its synthetic
  bundle address, else the local `TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS` base
  plus-tagged per source reviewer. An address already naming an owned
  synthetic person bound to the same source reuses it (`reused: true`);
  otherwise a fresh destination GUID is preallocated. It binds the sorted address digests plus the assignment
  count into the reservation's `plan_digest`, so a same-key retry naming
  different addresses conflicts (`409 test_request_run_conflict`) instead of
  silently reusing the first reservation's assignments.
- **Reader:** `listRunReviewerAssignments(runId)`, used by
  `--run-inspect`. Its SELECT list never names the `address` column, only
  `address_sha256` — the redaction contract is structural (nothing to scrub)
  rather than a post-hoc scrub of a fetched value.
- **Resolving an address to an existing synthetic person** (the `reused:
  true` reuse path, provenance checks, and the seeder that actually creates
  the Dataverse rows) is 6c-ii, not built yet; this slice is the
  ledger/runner/CLI/migration dimension only. The four Reviews-only ledger
  steps (`seed_reviewers`, `copy_review_file`, `seed_review_answers`,
  `verify_reviews`) stop cleanly with `needs_attention` /
  `recipe_step_not_built` until then.

## Recipe tokens (slice 4a, 2026-09-26)

**[VERIFIED via source, 2026-09-26]** `test_request_runs.recipe`'s CHECK
(migration 054 and its `scripts/setup-database.js` mirror) and
`LEDGER_RECIPES` (now defined in
`lib/services/test-requests/recipe-capabilities.js`, re-exported unchanged
from `run-ledger.js`) both accept three additional cumulative tokens:
`pre_site_visit`, `final_writeup`, `site_visit_materials` (recipes 4, 5 and 3
of the Recipes 3-5 plan, in that build order). `LEDGER_RECIPES` is ordered
(`basic`, `initial_assessment`, `reviews`, `pre_site_visit`,
`final_writeup`, `site_visit_materials`); `recipeSeedsReviewers(recipe)` and
`recipeSeedsPreSite(recipe)` (same module) are rank-based capability
predicates over that order, replacing every `recipe === 'reviews'` /
`!== 'reviews'` comparison across the Factory. Both throw on an
unrecognized recipe.

**The ledger's own enum accepts these three tokens; `RECIPE_STEP_ORDER`
(`lib/services/test-requests/run-runner.js`) does NOT yet have an entry for
`final_writeup`/`site_visit_materials`** (built in 5/3). `pre_site_visit`
gained its step order in slice 4b (below). `stepOrderForRecipe`/`nextStepFor`
fail closed (throw) on a recipe with no step order, so the CLI's `--recipe`
validation (`scripts/rehearse-test-request-sandbox.mjs`) accepts only a
recipe that BOTH is in `LEDGER_RECIPES` AND has a `RECIPE_STEP_ORDER` entry,
refusing `final_writeup`/`site_visit_materials` before any Dataverse read or
ledger write, not merely before their (not-yet-built) steps run.

## Recipe 4 — `pre_site_visit` (slice 4b, 2026-09-26)

**[VERIFIED via source]** `RECIPE_STEP_ORDER.pre_site_visit` is the `reviews`
order plus four new steps: `seed_presite_ai_run`, `seed_presite_draft`,
`render_presite`, `verify_presite` (`run-runner.js`). `verify_reviews`
advances rather than marks ready for this recipe (its own
`nextStepFor(...) === null ? markReady : advance` branch, built in 4a);
`verify_presite` is the recipe's only `markReady`.

New ledger dimension additions (migration 054, edited in place, and its
`scripts/setup-database.js` mirror stay byte-parallel):
- `LEDGER_STEPS`: the four steps above.
- `LEDGER_RESOURCE_KINDS`: `dataverse_ai_run` (the stub `wmkf_ai_run` bound at
  `seed_presite_ai_run`; `seed_presite_draft`'s registry row reuses the
  existing `dataverse_request_document` kind). `render_presite` (Opus round
  1 P2a fix) also journals its own `dataverse_request_document`-kind
  resource marking the step's own start (journal-before-write), keyed by
  `step: 'render_presite'` so it never collides with `seed_presite_draft`'s
  same-kind resource in `summarizePresiteResources` (CLI), which filters by
  `step` in addition to `resourceKind`.
- `LEDGER_REASON_CODES`: `presite_claim_lost`, `presite_pointer_mismatch`,
  `presite_upload_ambiguous`, `presite_snapshot_stale`,
  `presite_verification_failed`, `presite_promotion_uncharacterized`,
  `presite_ai_run_ambiguous`.
- `LEDGER_RECEIPT_KEYS` (`KEY_RULES`/`NUMERIC_KEYS`): `promptId`,
  `confirmedRunId` (GUID — the stub AI-run id re-asserted by
  `stepSeedPresiteAiRun`'s I3 exact-id recovery; a distinct key from `runId`
  because a resource can carry both, planned vs. confirmed),
  `inputFingerprint`/`renderInputFingerprint` (HEX64), `promptVersion`
  (numeric) — the `test_request_receipt_ok` SQL function's own enumerated
  grammar carries the same additions. [VERIFIED via
  lib/services/test-requests/run-ledger.js KEY_RULES and
  lib/db/migrations/054_test_request_runs.sql:53 / scripts/setup-database.js:1248,
  slice 4b follow-up 2026-09-26 — `confirmedRunId` was missing from all three
  before this pass, which would have rejected every real recovery/confirm
  write as an unsafe ledger value.]

`lib/services/test-requests/presite-sandbox-deps.js` is the sandbox-bound
dependency seam (mirrors `ia-sandbox-deps.js`/`reviews-sandbox-deps.js`;
exempt from `check:dataverse-access-layer` by name): `createPresiteSandboxDeps`
builds the COMPLETE, sandbox-bound dependency object for
`generatePreSiteVisitArtifact` (`lib/services/pre-site-visit/artifact-
service.js`) and `createPresiteInputDeps` the matching object for
`loadPreSiteVisitInputs` (`proposal-core-service.js`) — every key either
sandbox-bound or a throwing sentinel (`runProposalCore`, `getBuckets`,
`getExecutorBudget`, `runPrompt`), never a production `DEFAULT_DEPENDENCIES`
fallback. Owner decision P2 (design doc): the draft is copied from the
source bundle's `preSiteVisit` section, never regenerated, so a correctly
seeded row (FAILED, a factory-owned `wmkf_lasterrorcode` outside
`UNCHANGED_RETRY_BLOCKED_CODES`, the stub run bound) never reaches
`runProposalCore`. `--reserve --recipe=pre_site_visit` requires a bundle v5
`preSiteVisit` section (`assertBundleHasPreSiteSectionForRecipe`,
`source-bundle.js`), refused before any Dataverse read; reviewer-address
requirements are unchanged (`recipeSeedsReviewers(pre_site_visit)` is already
true by rank). `getCoPIs`/roster `blockers` are simplified to an empty,
deterministic result for the sandbox clone (documented in
`presite-sandbox-deps.js`) — this narrows the rendered Personnel roster and
referee diagnostics relative to a real staff generation, `[ASSUMED]`
acceptable for the sandbox rehearsal phase; revisit before any live-proof
claim about rendered content fidelity.

## `test_request_status_changes` (status setter, 2026-09-28)

**[VERIFIED via lib/db/migrations/054_test_request_runs.sql and lib/services/test-requests/run-ledger.js, 2026-09-28]**
A fourth table, added in place to migration 054 (and its `scripts/setup-database.js` V55 mirror): one row per Phase I or Phase II Status change the Factory makes on a ready production test Request (`docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md`, slice C).

- **Columns:** `change_id` (a GUID minted by the runner), `run_id`, per-run `sequence`, `field` (`wmkf_phaseistatus` or `wmkf_phaseiistatus`), `option_before`, `option_after`, `etag_before` (the row version the PATCH's `If-Match` carried), `status` (`planned` → `dispatched` → `applied` → `complete`, or `needs_attention`), `rerun`, `dispatched_at`, `effects` (a receipt under `test_request_receipt_ok`: effect IDs, a digest of the Request Status readback, counts), `error` (sanitized), timestamps.
- **Writer:** `createRunLedger(db)` `planStatusChange`, `markStatusChangeDispatched`, `markStatusChangeApplied`, `completeStatusChange`, `markStatusChangeNeedsAttention`, `recordLateStatusChangeEffects`. Callers: the status runner (`lib/services/test-requests/status-change-runner.js`), reached from the CLI `--set-status` / `--status-recheck` and, since the admin form's slice 2b (2026-10-01; enabled in Production 2026-10-02, first change that day on Request 1003310), from `admin-run-service.js` `changeStatus` / `statusRecheck`; and the CLI `--status-abandon`, which only closes a `dispatched` change. No lease: a partial unique index (`status IN ('planned','dispatched','applied')`) admits one open change per run, and exactly one PATCH per change is enforced by `markStatusChangeDispatched` being a `planned` → `dispatched` compare-and-set (only the caller that gets the row back sends). A `dispatched` change is never re-sent; `markStatusChangeNeedsAttention` takes an `onlyIf` status so no caller closes a change another caller has moved on. **[VERIFIED via lib/services/test-requests/run-ledger.js and status-change-runner.js, 2026-10-01, S562]**
- **Reader:** `listStatusChanges(runId)` (the runner's replay and resume checks; `--run-inspect`).
- **Dataverse reads by the runner** (`lib/services/test-requests/status-change-runner.js`, read-only): `asyncoperations` regarding the Request (completion waits until every job since the write is terminal), `akoya_goapplystatustrackings` by `_akoya_request_value`, regarding `emails`, `akoya_requestpayments`, and the Request's own status fields. Its one write is the fenced `akoya_requests` status PATCH.

## `test_request_cast_members` / `test_request_cast_bindings` (synthetic cast, 2026-09-28)

**[VERIFIED via lib/db/migrations/054_test_request_runs.sql, lib/services/test-requests/run-ledger.js, and merge commit `75d58e331`, 2026-09-29]**
Two tables added in place to migration 054 (and the V55 mirror) for the cast plan's slices A + B (`docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md`).

- **`test_request_cast_members`:** the reused synthetic PI and Liaison contacts and suggested-reviewer person, one per `(environment, role)`. `member_id` is the preallocated Dataverse GUID (`contactid` or `wmkf_potentialreviewersid`), journaled before the create POST names it; `role` (`pi`, `liaison`, `suggested_reviewer`, `org_leader`, `research_leader`) fixes `entity` (`wmkf_potentialreviewers` for the suggested reviewer, `contact` otherwise, a CHECK); `first_name`/`last_name` (the Factory's synthetic defaults), `address_sha256` (digest only, never the address), `status` (`planned` → `dispatched` → `verified`, or `needs_attention`), `readback` (receipt), `error` (sanitized), timestamps.
- **`test_request_cast_bindings`:** one suggested-reviewer suggestion per `(run_id, member_id)`; `binding_id` is the preallocated `wmkf_appreviewersuggestionid`; same status set, readback and error.
- **Writer:** `createRunLedger(db)` `planCastMember`, `markCastMemberDispatched`, `markCastMemberVerified`, `markCastMemberNeedsAttention`, `planCastBinding`, `markCastBindingDispatched`, `markCastBindingVerified`, `markCastBindingNeedsAttention`. Owner-run CLI, no lease; the unique constraints refuse a second plan.
- **Reader:** `listCastMembers({ environment })`, `getCastBinding({ runId, memberId })`.

## `test_request_cast_slot_bindings` (B4 branch build, 2026-09-29)

**[VERIFIED via branch source and disposable PostgreSQL test]** Migration 058 adds a separate typed journal for Potential Reviewer 1, one row per `(run_id, member_id)` with a composite foreign key to the verified suggestion's binding row. The row stores the expected Request/person GUIDs, a five-slot occupancy snapshot and concrete pre-PATCH ETag, dispatch and verification timestamps, constrained provenance and failure codes, and typed readback fields. A planned row can stop with `needs_attention` before a snapshot if the Request marker drifts; this is a journaled refusal, with no PATCH. Migration 058 restores the current cast tables and `test_request_receipt_ok` function when an earlier applied 054 lacks them; it repairs the earlier three-role cast-member CHECK and, on explicit replay, the stricter snapshot CHECK from the first B4 draft. It refuses conflicting table columns and required constraints. `scripts/setup-database.js` V57 mirrors the new table for fresh installs, after V56's post-presentation materials. The disposable PostgreSQL test applies current, earlier, and three-role 054→058, reruns 058 after recreating the old snapshot CHECK, verifies the pre-snapshot refusal and compares the installed receipt function with 054. Ledger state for 058: the managed Neon ledgers `ledger_prod` and `ledger` had 054 + 058 applied by hand on 2026-09-30 [VERIFIED S553, `check:factory-ledger` matches the 054 + 058 fingerprint]; the home Mac's local `ledger_prod`/`ledger` have not (`docs/plans/briefs/FACTORY_LEDGER_SNAPSHOT_BRIEF_2026-09-30.md`); the shared Production/Preview database has 054 only.

**[VERIFIED via branch source and disposable PostgreSQL test]** `createRunLedger` exposes `planCastSlotBinding`, snapshot, dispatch, verification, attention and read methods. `runCastSlotBinding` reads the ready run, verified suggestion and exact marked person; observes an already matching slot without a PATCH; otherwise records occupancy and ETag before one fenced PATCH, then reads back all five slots and the marker/run ID. A metadata read failure leaves the planned row retriable; no PATCH was dispatched. A dispatched row resumes by readback without resending. Unit and PostgreSQL tests cover the journal transitions, hand-set slot, occupancy, concrete ETag, response loss and 412 outcomes. Automatic approval review rejected silently extending the production-capable `--bind-reviewer` command with the live slot write. That command remains suggestion-only. A separate `--bind-reviewer-slot=<runId>` command previews the target and occupants read-only; only `--confirm-slot-request=<the previewed Request GUID>` calls the slot runner. This branch has not run a production slot PATCH.

## Limits

- The owner-run CLI refuses a ledger URL matching the configured shared
  Production/Preview URLs or any host outside `lib/db/ledger-registry.js` for every
  ledger-driven mode (the blanket neon.tech refusal was replaced by the registry in PR #374); the local
  `ledger_prod` is recorded for the production cast creation (cast plan,
  *Order* 4). Which local ledger the 1003303 clone and binding used is not
  recorded (see the header). Shared Production has 054 applied (2026-09-26
  06:54Z, `codex-feature-request-2026-09-26`, early shape: `test_request_runs`
  and `test_request_run_resources` only) and 058 applied 2026-10-01 01:56Z by
  the owner's `npm run apply:migrations`, which added the three cast tables to
  clear the `migration_drift` alert. `test_request_run_reviewer_assignments` and
  `test_request_status_changes` remain absent there; all tables are empty and
  the CLI never uses that database [VERIFIED via owner-authorized read-only
  queries, 2026-09-30/10-01]. Preview's database is unverified.
- The owner-run `ledger_prod` and `ledger` need read-only schema preflight,
  explicit 058 application by the owner, and a recorded receipt before the
  slot operation can use them. `apply-migrations.js` must not target these
  local ledgers. Shared Production/Preview Postgres migration consistency is
  not a prerequisite for the owner-run local slot journal.
- The JSONB resource receipts are checked by `test_request_receipt_ok` in
  PostgreSQL and by `assertLedgerReceipt` in JavaScript. They accept only
  bounded allowlisted keys and values; a writer bypassing JavaScript still
  cannot store arbitrary bodies or tokens in those columns.
- No cleanup/retention policy exists yet; row growth is unbounded until the
  design doc's stage 5 retirement/retention work lands.
