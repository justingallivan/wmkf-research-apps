---
title: Test Request Factory Run Ledger
domain: test-request-factory
kind: atlas
status: active
summary: "Durable owner-run test Request ledger; B4 typed slot migration is built on a branch and unapplied."
canonical: false
cataloged: 2026-09-23
last_verified: 2026-09-29
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md
  - lib/db/migrations/054_test_request_runs.sql
  - lib/db/migrations/055_test_request_cast_slot_bindings.sql
---

# Atlas: Test Request Factory Postgres ledger

Tables: `test_request_runs`, `test_request_run_resources`,
`test_request_run_reviewer_assignments`, `test_request_status_changes`,
`test_request_cast_members`, `test_request_cast_bindings`, and
`test_request_cast_slot_bindings`.

**[VERIFIED via source, 2026-09-29]** Migration 054 and its fresh-install
mirror (scripts/setup-database.js, V55) define the durable run ledger for
the Test Request Factory's "basic clone" stage
(docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md, "Operation contract
and recovery" and the "3. Basic clone" build-stage row). The owner-run record
names the local `ledger_prod` as the ledger for the production cast creation
[VERIFIED via `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md`,
*Order* 4]. For the first cast-bound clone (run `e33fa857`, Request 1003303)
and its `--bind-reviewer`, *Order* 5 does not name the ledger. The CLI
structurally requires an operator-supplied `TEST_REQUEST_LEDGER_URL` for those
modes and refuses one that is unset, equals a shared `POSTGRES_URL*` /
`DATABASE_URL` value, or names a neon.tech host [VERIFIED via
`scripts/rehearse-test-request-sandbox.mjs:750-760,1283-1341`]. That rules out
the configured shared URLs and neon.tech hosts, but does not independently
prove the supplied URL is local or which database was used; the
exact owner-run target for that clone and binding is unverified (no direct
record) [ASSUMED unknown].
Whether migration 054 is applied to the shared Production/Preview Postgres
database was not re-probed for the B4 plan revision [ASSUMED unknown]. Existing
shared databases use `node scripts/apply-migrations.js`; the owner retains
control of any shared-database application. The local ledgers took 054 and
its in-place amendments by owner-run `psql` (cast plan, *Order* 1 and 4), and
the B4 plan forbids pointing that runner at them (cast plan, *Order* 6, §6).

## Contract

- **Writer:** `lib/services/test-requests/run-ledger.js` (`createRunLedger`),
  called by the bounded resumable runner
  `lib/services/test-requests/run-runner.js` (`advanceRun`, one step per
  call) through the CLI modes `--reserve` / `--advance` / `--run-inspect`
  (and the production `--set-status` / `--status-recheck`, `--create-cast` /
  `--bind-reviewer` and `--run-recheck` modes, which use the same ledger URL
  check [VERIFIED via `scripts/rehearse-test-request-sandbox.mjs:1283-1341`])
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
`runProposalCore`. `--reserve --recipe=pre_site_visit` requires a bundle v4
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

- **Columns:** `change_id` (the CLI's own GUID), `run_id`, per-run `sequence`, `field` (`wmkf_phaseistatus` or `wmkf_phaseiistatus`), `option_before`, `option_after`, `etag_before` (the row version the PATCH's `If-Match` carried), `status` (`planned` → `dispatched` → `applied` → `complete`, or `needs_attention`), `rerun`, `dispatched_at`, `effects` (a receipt under `test_request_receipt_ok`: effect IDs, a digest of the Request Status readback, counts), `error` (sanitized), timestamps.
- **Writer:** `createRunLedger(db)` `planStatusChange`, `markStatusChangeDispatched`, `markStatusChangeApplied`, `completeStatusChange`, `markStatusChangeNeedsAttention`. No lease: the CLI is owner-run, and a partial unique index (`status IN ('planned','dispatched','applied')`) admits one open change per run.
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

**[VERIFIED via branch source and disposable PostgreSQL test]** Migration 055 adds a separate typed journal for Potential Reviewer 1, one row per `(run_id, member_id)` with a composite foreign key to the verified suggestion's binding row. The row stores the expected Request/person GUIDs, a five-slot occupancy snapshot and concrete pre-PATCH ETag, dispatch and verification timestamps, constrained provenance and failure codes, and typed readback fields. Migration 055 restores the current cast tables and `test_request_receipt_ok` function when an earlier applied 054 lacks them; it refuses conflicting table columns and required constraints. `scripts/setup-database.js` V56 mirrors the new table for fresh installs. The disposable PostgreSQL test applies current 054→055 and earlier 054→055, reruns 055, and compares the installed receipt function with 054. No operational ledger has been migrated for this branch [UNKNOWN pending owner preflight/application].

**[VERIFIED via branch source and disposable PostgreSQL test]** `createRunLedger` exposes `planCastSlotBinding`, snapshot, dispatch, verification, attention and read methods. `runCastSlotBinding` reads the ready run, verified suggestion and exact marked person; observes an already matching slot without a PATCH; otherwise records occupancy and ETag before one fenced PATCH, then reads back all five slots and the marker/run ID. A dispatched row resumes by readback without resending. Unit and PostgreSQL tests cover the journal transitions, hand-set slot, occupancy, concrete ETag, response loss and 412 outcomes. Automatic approval review rejected silently extending the production-capable `--bind-reviewer` command with the live slot write. That command remains suggestion-only. A separate `--bind-reviewer-slot=<runId>` command previews the target and occupants read-only; only `--confirm-slot-request=<the previewed Request GUID>` calls the slot runner. This branch has not run a production slot PATCH.

## Limits

- The owner-run CLI refuses a ledger URL matching the configured shared
  Production/Preview URLs or a neon.tech host for every ledger-driven mode [VERIFIED via
  `scripts/rehearse-test-request-sandbox.mjs:750-760,1283-1341`]; the local
  `ledger_prod` is recorded for the production cast creation (cast plan,
  *Order* 4). Which local ledger the 1003303 clone and binding used is not
  recorded (see the header). Shared Production/Preview database migration
  status remains unverified; this B4 revision performs no live read.
- The owner-run `ledger_prod` and `ledger` need read-only schema preflight,
  explicit 055 application by the owner, and a recorded receipt before the
  slot operation can use them. `apply-migrations.js` must not target these
  local ledgers. Shared Production/Preview Postgres migration status remains
  unverified and is not a prerequisite for the owner-run local slot journal.
- The JSONB resource receipts are checked by `test_request_receipt_ok` in
  PostgreSQL and by `assertLedgerReceipt` in JavaScript. They accept only
  bounded allowlisted keys and values; a writer bypassing JavaScript still
  cannot store arbitrary bodies or tokens in those columns.
- No cleanup/retention policy exists yet; row growth is unbounded until the
  design doc's stage 5 retirement/retention work lands.
