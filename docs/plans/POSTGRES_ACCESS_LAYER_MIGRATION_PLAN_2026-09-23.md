---
title: Postgres Access Layer Migration Plan
domain: platform
kind: plan
status: active
summary: Staged introduction of one Postgres client seam and per-domain stores, a ratchet-then-law gate mirroring the Dataverse DAL campaign, closure of the route→service law's SQL blind spot, and a real-planner contract-test harness; plan only, nothing executed.
canonical: false
owner: product-engineering
related:
  - docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md
  - docs/SYSTEM_MODEL.md
  - docs/atlas/postgres-infra-tables.md
---

# Postgres Access Layer Migration Plan

> Produced 2026-09-23 on `claude/investigation` (Session 536, Claude Fable
> 5.1). Read-only scoping; **no code was changed and no stage has run.**
> Every count below was probed live against commit `1046c1033` and is
> labelled `[VERIFIED via <probe>]`. Stage 0 re-derives all of them with a
> committed script before anything else happens (Ground rule 1).
>
> Written to be executed stage by stage by a less capable model. Each stage
> states: Preconditions (what must be true of the tree), Tests before (what
> must exist and pass before the first edit), Work (ordered file list),
> Verify (how green is proven), Rollback. Do not start a stage whose
> Preconditions you cannot reproduce with the Stage 0 probe.

## 0. Target selection — why this refactor, not another

Three candidates survived a survey of every plan doc, the work queue,
`DEVELOPMENT_LOG.md`, and memory `[VERIFIED via Explore survey + grep, S536]`:

| Candidate | Size | Already planned? | Why not first |
|---|---|---|---|
| **Postgres access layer** (this plan) | 60 non-test files import a Postgres driver; 349 `` sql` `` statements in 52 files; 17 files under `pages/api/` touch Postgres directly; 53 fresh-install tables plus 5 migration-only tables | **No plan doc exists.** `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md` and `scripts/check-route-service-boundary.js` only recognise Dataverse sources, so a route can pass the "thin route" law while running SQL inline | — |
| `pages/admin.js` | 3,571 lines, 99 `useState` | Deferred by three plans (`docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md:64`) | One file, one app; UI-only; no cross-cutting law is missing |
| Flat `lib/services/` namespace | 174 root files next to 27 domain dirs (46 `reviewer-*` root files beside `reviewer-engagement/`, `reviewer-finder/`, `review-manager/`, `review-documents/`) | Explicitly out of scope in `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md:78` ("Existing flat services are NOT moved") | Mostly moves; low defect yield per commit; the Postgres stores are a large share of it and get relocated by Stage 7 of this plan anyway |

The Postgres layer wins because it is a **whole layer with a live incident
behind it**: the S504 production failure (`could not determine data type of
parameter $2`, `.claude-memory/feedback-mocked-sql-hides-parameter-typing.md`)
happened because every test mocks the driver and nothing reaches a real
planner. The Dataverse side already got exactly this treatment
(`docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`, Stages 0–9, now law); the
Postgres side got nothing.

**What this plan is NOT:** not an ORM or query builder; not a schema
redesign; not a drain of Postgres into Dataverse (`docs/SYSTEM_MODEL.md:226-233`
gives Postgres its own tier: staging bound for Dataverse, per-user custom
functions, and **permanent** app-operational data; individual artifacts may be
promoted, the tier does not go away). Statements move; they do not change.

## 1. Verified baseline (2026-09-23, commit `1046c1033`)

All `[VERIFIED via grep/awk census, S536]` unless stated; the disconfirming
query (files whose only driver mention is a comment) was run and two false
positives removed — see Appendix A note. Reproduce with Appendix B; Stage 0
replaces these with an AST probe.

- **Drivers:** `@vercel/postgres ^0.10.0` (57 importing files) and `pg ^8.22.0`
  (3 files: `lib/services/irs-bmf-service.js` `newPool()`,
  `pages/api/intake/submit.js` `newPool()`, `pages/api/cron/drain-submissions.js`
  module-scoped `getPool()`).
- **Files:** 60 non-test files under `pages/` and `lib/` import a driver —
  36 in `lib/services/`, 17 in `pages/api/`, 4 in `lib/utils/`, and one each
  in `lib/intake/`, `lib/external/`, `lib/bill/`. Every file with a `` sql` ``
  tag also imports the driver (no tag-only files). Full list: Appendix A.
- **Statements:** 349 `` sql` `` tagged statements in 52 files
  `[RECHECKED after scripts/check-postgres-access-layer.js change: node
  scripts/check-postgres-access-layer.js --report, S536 — the hand grep said
  352/53; the AST probe excludes a comment at lib/intake/rate-limit.js:197, a
  docstring at lib/services/maintenance-service.js:237, and
  lib/services/irs-bmf-service.js, which has no sql tag (pool.query only)]`.
  Idioms present, as file counts from the probe `[VERIFIED via --json kind
  totals, Stage 0 close]`: `` sql` `` 52, `sql.query(` 10, `client.query(`
  10 (8 driver importers such as `lib/services/cycle-dossier-store.js:12-23`
  plus the 2 client-passed files), `db.connect(` 6 (`alert-service.js:30`,
  `consultant-feedback-service.js`, `cycle-dossier-store.js`,
  `deliberation-briefing/briefing-link-store.js`, `review-panel-store.js`,
  `pages/api/auth/link-profile.js:57`), `pool.connect(` 3, `new Pool(` 3,
  `pool.query(` 1, explicit `BEGIN` 9 (the six `db.connect` files,
  `irs-bmf-service.js`, `pages/api/intake/submit.js`,
  `lib/services/cron/drain-submissions-service.js`). No file uses `sql.begin`.
- **Routes:** 17 `pages/api` files reach Postgres directly: 13 with `` sql` ``
  plus `auth/link-profile.js` (`db`), `intake/submit.js` and
  `cron/drain-submissions.js` (`pg` Pool), `cron/secret-check.js` (imports
  `sql`, no tag of its own). `scripts/check-route-service-boundary.js`
  reports 0 violations because its source predicates
  (`isDynamicsServiceSource`, `isDynamicsSubmoduleSource`, adapters) do not
  include a Postgres driver `[VERIFIED via scripts/check-route-service-boundary.js:65-79]`.
- **Tables:** 53 `CREATE TABLE` names in `scripts/setup-database.js` plus
  exactly 5 live tables created only by migrations and **absent from
  `setup-database.js`**: `reviewer_find_roster` (`020`, `023`, `025`, `027`,
  `029`), `review_drafts` (`021`), `review_question_audit` (`022`),
  `bill_onboarding_state` (`017`), `bill_webhook_events` (`015`)
  `[RECHECKED S536 via full pass: every migration CREATE TABLE name minus
  every migration DROP TABLE name, tested against setup-database.js —
  tests/unit/postgres-schema-parity.test.js KNOWN_GAPS; the plan's first draft
  listed four because it only probed four suspected names]`. CLAUDE.md names `setup-database.js` the
  fresh-install shape of record, so this is a parity defect this plan must
  close (Stage 0, item 5). 6 tables are drained and out of scope
  (`scripts/check-drain-table-mentions.js:65-72`); one drained table,
  `grant_cycles` (drained, historical), is still among the 53 `setup-database.js` names,
  so the live count is 52 + 5.
- **Hot tables** `[VERIFIED via probe table extraction, Stage 0 close —
  the hand grep counted comment mentions and over-stated these]`:
  `user_profiles` in 16 files; `dynamics_user_roles` 6; `expertise_roster`
  5; `api_usage_log` 5; `system_alerts` 4. `lib/services/maintenance-service.js`
  alone touches 13 tables.
- **Existing seams to codify, not invent:** `lib/services/database-service.js`
  (519 lines, 14 importing files under `pages/`+`lib/`; `search_cache` +
  `user_profiles` static class),
  and nine store modules that already isolate one domain each:
  `lib/services/review-panel-store.js`, `lib/services/cycle-dossier-store.js`,
  `lib/services/scheduled-email-store.js`, `lib/services/reviewer-roster-store.js`,
  `lib/services/deliberation-briefing/briefing-link-store.js`,
  `lib/services/pre-site-visit/distribution-store.js`,
  `lib/services/site-visit-materials/collection-store.js`,
  `lib/services/meeting-tracker/agenda-store.js`,
  `lib/services/dynamics-explorer/explorer-store.js`.
- **Tests:** 79 test files `jest.mock('@vercel/postgres')`. 6 tests mention
  `POSTGRES_URL`/`DATABASE_URL`: 4 set a **dummy** URL so a pool constructor
  does not throw (`tests/unit/intake-submit-pending-guard.test.js:86-93`),
  the other 2 only in a fixture string or comment; **zero tests reach a real
  Postgres planner.** `.github/workflows/test.yml` runs
  `npm run test:ci` (`jest --ci --coverage`) with no Postgres service
  container `[VERIFIED via .github/workflows/test.yml:40-73]`.
- **Bundle constraint that shapes Stage 6:** `lib/utils/auth-policy.js` must
  never import the driver (proxy/Edge bundle,
  `lib/utils/auth-policy.js:6-9`); `lib/utils/auth-bypass-monitor.js` reaches
  `system_alerts` only through `AlertService`. Neither is in the census.
- **Gates that already touch this surface:** `check:atlas`
  (`scripts/check-application-state-atlas.js`: every table in
  `schema.sql`/migrations/`setup-database.js` must appear in an Atlas page),
  `check:migrations-manifest`, `check:drain-table-mentions`,
  `check:route-service-boundary` (Dataverse-only), the shared AST core
  `scripts/lib/ast-scan-core.js`.

## 2. Ground rules for every stage (executor: read before each stage)

Copied from `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` with the probe swapped;
the wording is deliberately identical so executors recognise it.

1. **Assumption re-verification preamble (mandatory, fresh context).** Before
   starting a stage, run in a FRESH session/agent with no memory of prior
   stages: `node scripts/check-postgres-access-layer.js --report` (Stage 0
   builds it) and diff its counts against the stage's Preconditions. If any
   named file, symbol, or count no longer matches the tree, STOP and reconcile
   the plan first (edit this doc; note the drift in the Stage log). Never
   execute a stage against assumptions the probe cannot reproduce.
2. **Green means the FULL suite** plus the gate set for touched surfaces
   (`docs/CI_GATES_REFERENCE.md`), plus `npm run build`. Claiming green on a
   subset is a violation (memory: `feedback-green-requires-full-test-suite`).
3. **One caller file per commit** during conversion waves. Rollback is
   `git revert <commit>`; nothing requires multi-file atomic changes except
   where a stage says so explicitly.
4. **No renames or physical moves of existing modules until Stage 7.** New
   code lands in new files; existing callers change imports in place. This
   keeps greps and the Atlas stable throughout.
5. **Tests-before rule.** Each stage names the tests that must EXIST AND PASS
   before its first edit. If they don't exist, writing them IS the first task
   of the stage — characterization tests capture current behavior before any
   refactor.
6. **Behavior freeze.** Conversion changes imports and call shapes, never SQL
   text, response DTOs, filter semantics, or error contracts. Any observed
   diff in a route's output is a stage-stopping bug. (Exception: adding an
   explicit `::type` cast to a bound parameter that feeds a variadic/`any`
   function is allowed and encouraged — it is the S504 fix pattern.)
7. **Probe scripts get committed** (`docs/CLAUDE_REMEDIATION_PLAN.md`).
8. **Label live-state claims** `[VERIFIED via X]` / `[ASSUMED]` in every stage
   report.

Additional rules specific to this plan:

9. **Real planner or it doesn't count.** A store's "tests before" is not
   satisfied by a mocked `sql` alone. Each store needs at least one contract
   test that runs its statements against a real Postgres (Stage 0 decides the
   harness, Q1). Until Q1 is resolved, stages 3–6 may not start.
10. **Branch, not `main`.** This is Tier 1–3 runtime work under
    `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Every stage lands
    on a feature branch and is promoted deliberately.
11. **Coordination.** Before editing any file in Appendix A, run
    `git log --all --oneline -3 -- <file>` and check active worktrees
    (`git worktree list`). On 2026-09-23 `pages/api/cron/spend-check.js` was
    being edited on `codex/test-request-preview-integration` (Test Request
    Factory Stage 1d); it stays red until that branch merges.
12. **Comment mentions are not imports.** The Stage 0 probe must classify by
    AST import/require nodes, never by text match; two files were false
    positives under a text grep (§1, bundle-constraint bullet).

## 3. Owner decisions (all seven DECIDED 2026-09-23; one Q3 sub-question open)

| # | Decision | Decision (2026-09-23, owner) | Rationale / residual risk |
|---|---|---|---|
| Q1 | **Real-Postgres contract-test harness.** Options: (a) GitHub Actions `services: postgres` container + `npm run test:pg-contract`; (b) opt-in local only via `PG_CONTRACT_URL`, skipped in CI; (c) a Neon/Vercel branch database per CI run. **Sub-decision Q1b (transport):** `@vercel/postgres` is `@neondatabase/serverless` over WebSocket (`node_modules/@vercel/postgres/package.json` deps; `dist/index-node.cjs:15-16` sets `neonConfig.webSocketConstructor`), so a plain container is reachable only via (i) Neon's `wsproxy` sidecar with `neonConfig.wsProxy` / `useSecureWebSocket=false` / `forceDisablePgSSL` set in the harness, or (ii) the Stage 2 seam selecting `pg` when `PG_CONTRACT_URL` is set — the S504 error is planner output, so `pg` surfaces it identically. No doc in `docs/` describes running Postgres locally today `[VERIFIED via grep of docs/ for local/docker postgres, S536]`. | **DECIDED: (a) + (ii)** — CI `services: postgres:16`; under the contract lane a Jest `moduleNameMapper` swaps `@vercel/postgres` for a `pg`-backed shim (Stage 0 built it that way, so no production seam change is needed for tests); the lane refuses any non-loopback host with **no override** (Codex S536 finding) | (a) is the cheapest venue that makes the tests mandatory; (b) would recreate the S504 blind spot; (c) needs credentials the runbook lacks. (ii) is one branch in one owned file versus a third-party sidecar nobody has run. Residual: `sql`-tag files are contract-tested through `pg`, not Neon's driver; typing/`jsonb`/`ON CONFLICT` semantics are server-side so the S504 class is covered. Sidecar (i) stays available as an additive upgrade. |
| Q2 | **Target directory.** `lib/postgres/` (new, mirrors `lib/dataverse/`) vs. growing `lib/db/` (currently migrations, `migrations-manifest.json`, `schema.sql` — the latter a `check:atlas` table source). | **DECIDED: `lib/postgres/`** with `client.js`, `stores/`, `core/` | Mirrors `lib/dataverse/` so executor and gates have a template; keeps runtime code out of a directory that `check:migrations-manifest` and `check:atlas` treat as schema-only |
| Q3 | **Fresh-install parity for the 5 migration-only tables** (four named at decision time; `review_question_audit` found by the Stage 0 parity test and folded in under the same decision). Add them to `scripts/setup-database.js`, or amend CLAUDE.md so migrations alone define shape. Related: `setup-database.js` never writes `schema_migrations` (`grep schema_migrations scripts/setup-database.js` → 0 hits), and the manifest starts at `002`, so neither script alone yields a stamped, complete schema; the harness (Stage 0 item 3) needs an explicit stamping step. | **DECIDED 2026-09-23 (owner):** add the five tables to `setup-database.js`; harness stamps every manifest file after setup. The omissions were in-the-moment lapses, not a policy: no doc, migration header, or log entry records a decision, and the established pairing is migration + inline `setup-database.js` block (`docs/INTAKE_PORTAL_DESIGN.md:629`, migration `009` + V30). | **Sub-question answered by the owner (2026-09-23):** there is no through-line — the migrations accreted over time against databases that already existed, so no fresh-install-plus-stamp procedure was ever needed or written. Consequence: today a fresh `setup-database.js` install has an empty `schema_migrations`, and `apply-migrations.js` would try to re-apply all 52 files (007 is not re-runnable) while `lib/utils/migration-drift.js` alarms at cold start. The contract lane stamps the manifest itself (Stage 0 item 3). Proposed follow-up, owner approval required: make `setup-database.js` stamp every manifest file after a successful fresh install, so the two scripts agree by construction. |
| Q4 | **Physical moves in Stage 7.** Relocate the nine existing store modules and `database-service.js` under `lib/postgres/stores/`, or leave them and only enforce the import law. | **DECIDED: relocate**, confirmed at Stage 7 rather than now | The law is what matters; location is legibility. Cheap once everything else is done (one commit per file, one-release re-export shim) and retires part of the flat-`lib/services/` debt. Skipping at Stage 7 loses nothing structural. |
| Q5 | **Permanent exemptions** allowed to import the driver forever: `scripts/**` (setup, apply-migrations, backfills, probes), `lib/utils/migration-drift.js`, `lib/utils/health-checker.js` (`information_schema` probe). | **DECIDED: exempt all three classes**; everything else converts; pin the set in `tests/unit/postgres-access-layer-recorded-set.test.js` (Stage 7) | They inspect the database rather than read domain tables; routing them through domain stores adds indirection with no boundary benefit. Same recorded-set mechanism as the reviewer-engagement gate so growth is a reviewed edit. |
| Q6 | **Parameter-cast lint.** Add a static check to the gate that flags bound parameters inside `jsonb_build_object|jsonb_build_array|concat|format|CASE|VALUES` without a `::cast`. | **DECIDED: ship as `--warn` in Stage 1**; decide on red at Stage 7 from its false-positive record | Contract tests (Q1) are the real defence; this is defence-in-depth for statements no test covers. A noisy red gate erodes trust in all gates, so it earns promotion. |
| Q7 | **`spend-check.js` sequencing.** Convert in Stage 4 after the Factory branch merges, or exempt until Stage 7. | **DECIDED: wait for the Factory branch to merge**, then convert in its Stage 4 slot | Stage 4 follows Stages 0–3 (harness, gate, seam, 30-file wave), so the Factory merge will precede it; exempting until Stage 7 would leave one route holding the law open for nothing. |

## 4. Target shape (codified from what already exists)

The layer is three things, each already present somewhere in the tree:

1. **One driver seam** — `lib/postgres/client.js` (Q2). The only runtime
   module allowed to `import` `@vercel/postgres` or `pg`. Exports exactly:
   - `sql` — the tagged template, re-exported unchanged so every existing
     statement compiles without edit. (`db` is NOT exported: the seam
     consumes `db.connect()` inside `withClient`, and every live `db` use is
     a `connect()` call that `withClient` replaces — Stage 2 review.)
   - `withClient(fn)` — replaces the `db.connect()` / `client.release()`
     pairs in 6 files (all six take `db` from `@vercel/postgres`); releases
     in `finally`, passing the thrown error to `release(err)` when `fn`
     threw so the connection is destroyed rather than returned (the form
     `alert-service.js` and `auth/link-profile.js` already use; destroying
     after an error is the strictly safer superset for the other four).
   - `withTransaction(fn)` — replaces the SIMPLE hand-rolled
     `BEGIN`/`COMMIT`/`ROLLBACK` sequences (model: `withDossierTransaction`
     in `lib/services/cycle-dossier-store.js:28`, byte-identical twin
     `withReviewPanelTransaction` in `review-panel-store.js:73`); `fn(client)`
     receives a client whose `.query` accepts the existing `(text, params)`
     form; `ROLLBACK` failure must not mask the original error. The live
     census has 12 `BEGIN` literals in 10 files (Stage 1 probe, not the 8
     first hand-counted); the ones with an early `ROLLBACK`-and-return or
     more than one `COMMIT` (`briefing-link-store`, `auth/link-profile`,
     `consultant-feedback`) and `drain-submissions-service` (client passed
     in by the caller) keep their own statements on a `withClient` client —
     rule 6 forbids reshaping them.
   - `getPool()` — the single lazily created `pg` Pool for the three Pool
     users, handed out as a frozen `{ query, connect }` facade (Codex Stage
     2 finding: the raw Pool exposes `end()`, and two of the three live
     users call `pool.end()` per request — a singleton must not be endable
     by an importer; a non-enumerable test-only hook closes it in Jest). Today all three build a Pool from `POSTGRES_URL || DATABASE_URL`;
     two (`irs-bmf-service`, `intake/submit`) build one per call and
     `pool.end()` it, one (`cron/drain-submissions`) caches it. `getPool()`
     keeps the same `POSTGRES_URL || DATABASE_URL` resolution (behaviour
     freeze) and its missing-variable error names both; it is the only place
     OUR code reads those variables — `@vercel/postgres` reads
     `POSTGRES_URL` internally behind the re-exported `sql` and the internal
     `db`, which the seam cannot and need not change. The per-call `pool.end()` callers are
     converted in their own stages (3 and 4) with the lifecycle change
     stated in that stage's report.
   No query helpers, no naming conventions, no result mapping. Rule 8.
2. **Per-domain stores** — one module per table cluster, the shape
   `lib/services/scheduled-email-store.js:14-49` already has: flat
   `export async function` per operation, `sql` at the top, returns
   `result.rows[0] || null` or `result.rows`, throws driver errors
   unchanged. New stores copy that file's layout. Stores are the only
   modules that import `lib/postgres/client`.
3. **The law** — `scripts/check-postgres-access-layer.js`: (a) outside
   `lib/postgres/**` and the Q5 exemptions, no file imports the driver;
   (b) no `pages/api` file imports `lib/postgres/**` directly (routes go
   through `lib/services`); (c) `scripts/check-route-service-boundary.js`
   learns the driver and `lib/postgres/client` as boundary sources.

Naming for new stores follows the table cluster, not the caller:
`user-profile-store.js`, `usage-log-store.js`, `system-alert-store.js`,
`health-history-store.js`, `expertise-store.js`, `explorer-access-store.js`
(`dynamics_restrictions` + `dynamics_user_roles`), `bill-store.js`,
`maintenance-store.js`, `rate-limit-store.js`, `search-cache-store.js`.

## 5. Stages

Every stage leaves `npm run test:ci`, every gate in `/start`, and
`npm run build` green. "Verify" lists are the minimum; Ground rule 2 always
applies.

### Stage 0 — Census probe, contract harness, parity fix (no runtime change)

**Goal:** a committed, reproducible census; a real-planner test lane; the
schema parity gap closed; owner decisions Q1–Q7 recorded.

**Preconditions:** Appendix A matches the tree (`[VERIFIED 2026-09-23]`;
re-derive with Appendix B).

**Tests before:** none (this stage creates them).

**Work (in order):**
1. `scripts/check-postgres-access-layer.js --report` on
   `scripts/lib/ast-scan-core.js` (`createSourceRecognizers` with a
   predicate matching `@vercel/postgres` and `pg`): for every `.js/.mjs`
   under `pages/`, `lib/`, `shared/`, `modules/` (excluding tests), record
   `{file, kind}` where `kind ∈ {driver-import, sql-tag, sql.query,
   client.query, pool.query, db.connect, pool.connect, new-Pool,
   begin-literal}` and the
   table names in each statement (regex over `FROM|INTO|UPDATE|JOIN|DELETE
   FROM`). Print counts by dir and the full table. Diff its output against
   Appendix A; reconcile Appendix A to the probe, never the reverse.
2. Self-test `scripts/check-postgres-access-layer.js --self-test` with a
   temp-root fixture tree covering every `kind`, an alias import, a
   re-export barrel, a `require()` form, and a **comment-only mention that
   must NOT count** (rule 12). Register `check:postgres-access-layer` /
   `:self-test` in `package.json`, `.github/workflows/test.yml`,
   `docs/CI_GATES_REFERENCE.md`, and `.claude/skills/start/SKILL.md`
   (report-only in this stage: exits 0).
3. **Contract harness (Q1).** `tests/pg-contract/` with its own Jest project
   (`jest.pg-contract.config.js`, `testEnvironment: node`) and `npm run
   test:pg-contract`. Global setup against the empty database named by
   `PG_CONTRACT_URL`: (i) run `scripts/setup-database.js` (it mirrors every
   migration's end state); (ii) **do NOT then run `apply-migrations.js`** —
   `setup-database.js` writes no `schema_migrations` rows, so
   `apply-migrations.js` would re-apply `002`+ and `007` is documented as
   not re-runnable (`scripts/apply-migrations.js:18-20`); instead insert one
   `schema_migrations` row per file in `lib/db/migrations-manifest.json`
   (harness-local helper); (iii) assert `apply-migrations.js` then reports 0
   pending. Transport per Q1b. When `PG_CONTRACT_URL` is unset the project
   prints `pg-contract: skipped (no PG_CONTRACT_URL)` and exits 0. If
   Q1=(a), add the `services: postgres:16` block to `test.yml` and the env
   var. First contract test: `tests/pg-contract/schema-applies.test.js` —
   steps (i)–(iii) succeed (proves the lane works).
   **Local lane (owner's machine, verified 2026-09-23):** Colima 0.10.3
   provides the Docker engine (`colima start`); a disposable server is
   `docker run -d --name wmkf-pg-contract -e POSTGRES_PASSWORD=contract
   -e POSTGRES_DB=wmkf_contract -p 55432:5432 postgres:16` and
   `PG_CONTRACT_URL=postgresql://postgres:contract@127.0.0.1:55432/wmkf_contract`.
   A plain `pg` client connected and the S504 statement
   (`jsonb_build_object('k', $1)` with an untyped parameter) failed with
   `could not determine data type of parameter $1` — the real planner
   catches the class the mocked tests miss. `docker rm -f wmkf-pg-contract`
   discards it.
4. **Regression test for S504 as a contract test:**
   `tests/pg-contract/site-visit-collection-store.test.js` calling
   `acquireSlotLease` in
   `lib/services/site-visit-materials/collection-store.js` against the real
   database. This is the template every later store test copies.
5. **Parity (Q3).** `tests/unit/postgres-schema-parity.test.js`: the set of
   `CREATE TABLE` names across `lib/db/migrations/*.sql` minus tables dropped
   by later migrations must be a subset of `scripts/setup-database.js`
   names. Seed it with the 5 known gaps as an explicit `KNOWN_GAPS` list
   (exact-set assertion, so it must shrink as blocks land); then add the 5
   tables to `setup-database.js` and shrink `KNOWN_GAPS` to empty. Landing
   note (S536): the five blocks (V55–V59) and the `KNOWN_GAPS = []` change
   land as ONE commit, not one per table — the exact-set assertion means any
   split leaves the test red between commits, and the blocks are
   independent additions to a single file (ground rule 3 is about caller
   files, not about splitting one file's additive blocks). Second assertion in the same test: no
   `setup-database.js` table is the target of a `DROP TABLE` in any
   migration (today none is — `grep -l "DROP TABLE.*grant_cycles"
   lib/db/migrations/*.sql` is empty, so the drained `grant_cycles` table
   still exists in every environment and is not a parity problem). Parser
   note for the executor: both `setup-database.js` (JS comments near `:429`
   and `:433`) and `lib/db/migrations/034_pre_site_distribution_attempts.sql:131`
   (a SQL comment) contain the literal words `CREATE TABLE IF NOT EXISTS`;
   parse only template-literal contents / comment-stripped SQL. `check:atlas` must stay green — all five
   tables already have Atlas coverage (`docs/atlas/postgres-reviewer-find-roster.md`,
   `docs/atlas/postgres-review-drafts.md`, `review_question_audit` in
   `docs/atlas/dataverse-wmkf-reviewquestion.md`, and the two BILL tables in
   `docs/atlas/postgres-infra-tables.md`).
6. Record Q1–Q7 answers in §3 and the Stage log.

**Verify:** `--report` reproduces Appendix A ±0 after reconciliation; `npm run
check:postgres-access-layer && npm run check:postgres-access-layer:self-test`
green; `test:pg-contract` green locally with a database and prints the skip
line without; full suite + build green; `check:migrations-manifest`,
`check:atlas` (+ self-tests) green.

**Rollback:** revert the stage's commits; nothing at runtime changed.

### Stage 1 — Ratchet gate (freeze new raw usage) + route-law extension

**Goal:** no NEW file may import a Postgres driver or run raw SQL outside the
census; no route may add Postgres access; effective immediately.

**Preconditions:** Stage 0 complete: `scripts/check-postgres-access-layer.js
--report` is committed and a fresh run reproduces the Stage 0 census
exactly (this stage turns that census into the allowlist).

**Tests before:** Stage 0 self-test green; `npm run
check:route-service-boundary:self-test` green.

**Work:**
0. **Close the probe's recorded recognition gaps BEFORE freezing the
   baseline** (the Stage 0 docblock of `scripts/check-postgres-access-layer.js`
   lists them): (a) resolve tag bindings to their import source so a renamed
   or destructured tag (`import { sql as q }`, `const { sql: q } = require(…)`,
   `vp.sql\`…\`` after a namespace import) counts as `sql-tag`; (b) recognise
   `new pg.Pool()` (member callee) as `new-Pool`; (c) recognise `.query()` /
   `.connect()` reached through a nested member path (`this.pool.query`,
   `p.connect()` on any binding that resolves to a Pool/db) as their kinds.
   Add a red self-test fixture for each. Re-run `--report`; the live counts
   must not change (no live instance exists today), which is the proof the
   gaps were latent, not the baseline shifting.
1. `scripts/postgres-access-allowlist.json` = Stage 0 census collapsed into
   line-tolerant count keys `{file, kind, count}` (the probe's `--json`
   already exposes `files[].kinds` as a kind→count map; `pool.connect` is one
   of the nine kinds). This is the design the
   Dataverse DAL used in its Stage 1 (`docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`
   "Stage 1 — Ratchet gate"): no line numbers, so unrelated edits in legacy
   files do not break the ratchet; the Dataverse allowlist file itself was
   deleted when that gate became law, so copy the design, not a file. Gate
   fails on (a) any key not in the allowlist or count above allowed, (b)
   any allowlist count above the current census or a vanished key (forces
   shrink), (c) any `pages/api` file importing `lib/postgres/**` once that
   dir exists.
2. Extend `scripts/check-route-service-boundary.js` source recognition to
   `@vercel/postgres`, `pg`, and `lib/postgres/*`: the hook is
   `isBoundarySource` at `:81-83` (the Dataverse predicates it composes sit
   at `:65-79`). **That gate is LAW MODE with no baseline and no ratchet**
   (`scripts/check-route-service-boundary.js:3-12`; its self-test asserts
   "zero boundary routes is the only passing state" at
   `scripts/check-route-service-boundary-self-test.js:60-62` and `:379-380`),
   so there is nothing to copy — this item DEFINES a new, narrowly scoped
   carry-over: a `POSTGRES_CARRYOVER` array of the 17 route paths, red under
   the widened definition today. Semantics: (a) a listed route that no longer
   reaches Postgres FAILS the gate ("stale carry-over entry — remove it"), so
   the list can only shrink; (b) an unlisted route reaching Postgres fails as
   law; (c) Dataverse detection stays law with no list. Update the self-test:
   keep the existing zero-baseline assertions for Dataverse, add fixtures for
   (a) and (b), and change the "no baseline file exists" assertion to "no
   Dataverse baseline exists; the Postgres carry-over is an in-script array
   pinned by `tests/unit/route-service-boundary-postgres-carryover.test.js`"
   (exact-set, same pattern as the reviewer-engagement recorded-set test).
   The list must reach zero by the end of Stage 6, at which point the array
   and its test are deleted and the gate is pure law again.
3. Q6 cast-lint as `--warn` output in the report (no exit-code effect).
4. Update `docs/CI_GATES_REFERENCE.md` rows and the `/start` skill list.

**Verify:** gate green at baseline; add `import { sql } from
'@vercel/postgres'` to a scratch file under `lib/services/` → red; add
`` sql` `` to an existing route → red; remove both → green; both self-tests
green; full suite + build green.

**Rollback:** revert; the allowlist is data.

### Stage 2 — Client seam (foundation, zero callers moved)

**Goal:** `lib/postgres/client.js` exists, is contract-tested, and is
imported by nothing yet.

**Preconditions:** Stage 1 gate green; `lib/postgres/` does not exist;
the Stage 1 gate already treats `lib/postgres/**` as an allowed importer
and the route law already forbids routes importing it (fresh-context
review, 2026-09-23).

**Tests before:**
- `tests/unit/postgres-client.test.js` — `withClient` releases on throw;
  `withTransaction` issues `ROLLBACK` on throw and `COMMIT` on return;
  `getPool` is a singleton; `POSTGRES_URL` absent → clear error naming the
  variable (unit, mocked driver — allowed here because it tests control
  flow, not SQL).
- `tests/pg-contract/postgres-client.test.js` — the same three helpers
  against the real database, including a nested-throw rollback that leaves
  a probe table unchanged. Lane fact (fresh-context review): the lane's
  `moduleNameMapper` swaps only `^@vercel/postgres$` for the `pg` shim, so
  `withClient`/`withTransaction` (built on the re-exported `db`) are shimmed
  automatically, but a `pg`-backed `getPool()` reads `POSTGRES_URL`, which
  the lane deliberately never sets. The `getPool` contract test therefore
  sets `process.env.POSTGRES_URL = process.env.PG_CONTRACT_URL` inside the
  test file (the preload has already enforced loopback on that value) and
  loads the seam under `jest.isolateModules`; it must also assert the
  singleton and that `end()` is not part of the seam's public surface.

**Work:**
1. `lib/postgres/client.js` per §4 item 1. Header docblock states the law
   and points at this plan.
2. ~~Add `lib/postgres/**` to the gate's allowed-importer set~~ — done in
   Stage 1 (`isExemptFile` in the probe; check (c) in the ratchet; route
   law family `postgres`). Remaining: delete the two "(does not exist yet)"
   notes in the probe's docblock (the route law's driver predicate already
   names `@neondatabase/serverless` since `1cd79e7ce`, Stage 1 follow-up).
3. `docs/SERVICE_AND_UTILITY_CATALOG.md` entry; Atlas page
   `docs/atlas/postgres-infra-tables.md` gets an "Access layer" section
   describing the seam (no table ownership changes yet).

**Verify:** both test files green; ratchet green with the allowlist
byte-identical (the new file is in the allowed-importer set, so the
`--report` driver-file total rises 60 → 61 and the kind totals rise by the
seam's own records — that is expected, and nothing pins the 60); full suite
+ build; `check:atlas`, `check:doc-currency` (+ self-tests).

**Rollback:** delete the directory; nothing imports it.

### Stage 3 — Wave A: existing single-domain stores and services (import swap)

**Goal:** every `lib/services/**` file in Appendix A marked Stage 3 imports
`lib/postgres/client` instead of the driver; hand-rolled connect/transaction
code moves onto `withClient`/`withTransaction`. SQL text unchanged (rule 6).

**Preconditions:** Stage 2 green; the Stage 3 file list in Appendix A
matches `--report` (30 files on 2026-09-23; re-verified 2026-09-24 by the
fresh-context review — exactly the 30, all still `driver-import`, no
unassigned `lib/services` importer). Module format: 12 of the 30 are
CommonJS (`require('@vercel/postgres'|'pg')`) — alert-service,
dynamics-explorer-request-telemetry, feedback-service, intake-audit-service,
intake-draft-service, integrity-service, irs-bmf-service,
operational-event-service, review-draft-service,
reviewer-identity-shadow-log, reviewer-institution-measurement,
reviewer-roster-store — and two plain-node scripts `require` three of them
(`scripts/smoke-intake-draft.js`, `scripts/test-retractions.js`). The seam
is therefore CommonJS (Stage 2 decision, 2026-09-24): CJS files
`require('../postgres/client')` and ESM files `import { sql } from
'../postgres/client'`; no file changes module format in this stage (rule 6).

**Tests before (per file, before its commit):**
- The file's existing unit tests green. Fresh-context review 2026-09-24:
  four files have NO test of the module at all (`irs-bmf-service`,
  `panel-review-service`, `integrity-service`, `intake-audit-service` — the
  last two exist only as `jest.mock` targets); four more have only
  source-text or indirect coverage (`explorer-store`, `agenda-store`,
  `scheduled-email-store`, `briefing-link-store`). For those eight the
  contract test IS the tests-before; no characterization unit test is
  required in addition (rule 9 — a real planner counts, a mock does not).
- One contract test in `tests/pg-contract/<store>.test.js` exercising each
  exported function once against the real database (the existing
  `site-visit-collection-store.test.js` covers only the two lease functions
  of `collection-store.js`'s 16 exports — it is extended, not counted as
  done) with the discriminating
  fixture (memory: `feedback-mutation-test-with-the-discriminating-fixture`).
  For files with >10 statements (`scheduled-email-store` 32,
  `reviewer-roster-store` 24, `intake-draft-service` 20,
  `distribution-store` 19, `alert-service` 16, `collection-store` 16,
  `portal-upload-staging` 15, `agenda-store` 12, `integrity-service` 11)
  the contract test must cover every statement that binds a parameter into
  a function call, `CASE`, or `VALUES`.

**Order (lowest statement count and fan-in first; one file per commit):**
1. `lib/services/dynamics-explorer/explorer-store.js` (4 stmts, 40 lines) —
   also the template commit others copy.
2. Plain `` sql` `` import swaps, small: `lib/services/reviewer-identity-shadow-log.js`,
   `lib/services/reviewer-institution-measurement.js`,
   `lib/services/intake-audit-service.js`,
   `lib/services/dynamics-explorer-request-telemetry.js`,
   `lib/services/expertise-finder/batch-match-service.js`,
   `lib/services/site-visit/recipient-directory-service.js`,
   `lib/services/admin/policies-service.js`,
   `lib/services/admin/review-questions-service.js`,
   `lib/services/admin/prompts-publish-service.js`,
   `lib/services/review-draft-service.js`.
3. Plain `` sql` `` import swaps, larger: `lib/services/panel-review-service.js`,
   `lib/services/operational-event-service.js`,
   `lib/services/review-synthesis-job-service.js`,
   `lib/services/reviewer-acceptance-job-service.js`,
   `lib/services/feedback-service.js`, `lib/services/integrity-service.js`,
   `lib/services/meeting-tracker/agenda-store.js`,
   `lib/services/portal-upload-staging.js`,
   `lib/services/site-visit-materials/collection-store.js`,
   `lib/services/pre-site-visit/distribution-store.js`,
   `lib/services/intake-draft-service.js`.
4. Connect/transaction users (these are the files with `db.connect()` /
   `BEGIN` / `client.query`), per-file shape from the 2026-09-24 review:
   - `lib/services/cycle-dossier-store.js` and
     `lib/services/review-panel-store.js`: the exact model shape; their
     exported wrappers (`withDossierTransaction`, called from
     `cycle-dossier-service.js:153,177` and mocked in its unit test;
     `withReviewPanelTransaction`) MUST keep their names and become
     `return withTransaction(fn)`. Two recorded behaviour differences:
     ROLLBACK failure no longer masks the original error; the client is
     destroyed on error.
   - `lib/services/alert-service.js`: two `COMMIT`s but both on success
     return paths (dedup → null, insert → row), so it fits `withTransaction`
     with `fn` returning either; the transaction covers only the
     `autoResolveKey` branch. Same two recorded differences.
   - `lib/services/deliberation-briefing/briefing-link-store.js` and
     `lib/services/consultant-feedback-service.js`: excluded shapes (early
     ROLLBACK-then-throw; two COMMITs on one path and query-after-ROLLBACK)
     — keep their statements verbatim on a `withClient` client (replacing
     only `db.connect()`/`release`).
   - `lib/services/irs-bmf-service.js`: pool path only (`newPool()` at
     `:148`, per-call pools in `verifyEin` and `refresh`, `pg-copy-streams`
     COPY on one held client, BEGIN mid-session). `withClient` does NOT fit
     (it hands out the Neon client, not a raw `pg` client for COPY): use
     `getPool().connect()` / `getPool().query()` directly, delete BOTH
     `pool.end()` calls (the singleton lives for the warm instance — the
     recorded lifecycle change), keep the statements verbatim. Its
     `'POSTGRES_URL (or DATABASE_URL) is not configured'` message becomes
     `getPool()`'s (no test asserts it).
5. Largest last: `lib/services/scheduled-email-store.js`,
   `lib/services/reviewer-roster-store.js`.

**Verify (per commit):** the file's tests + its contract test green; the
file's `driver-import` key (and its `db.connect` / `pool.connect` /
`new-Pool` / `begin-literal` / `client.query` keys where the conversion
moved that code onto `withClient`/`withTransaction`) vanishes from the
census, and the matching allowlist entries are deleted in the same commit
(the gate's stale-entry check forces this); the file's `sql-tag` and any
remaining `sql.query` keys stay frozen at their counts because tags count
wherever they appear (Stage 1 decision) — a conversion never changes them;
full suite + build green at each wave boundary (after items 1, 2, 3, 4, 5).

**Rollback:** `git revert` the single commit.

### Stage 4 — Wave B: routes with inline Postgres (closes the law blind spot)

**Goal:** no `pages/api` file outside Stage 6's auth set imports a driver or
`lib/postgres`; each route's SQL lives in a store called via a service.

**Preconditions:** Stage 3 complete; `POSTGRES_CARRYOVER` in the route-law
script lists exactly the 17 routes; `spend-check.js` conflict (Q7) resolved.

**Tests before (per route):**
- Route characterization test asserting the current response shape for the
  happy path and one error path with the store mocked at the **service**
  boundary, not the driver.
- Contract test for the new store functions.

**Order (one route per commit; new store first if needed):**
1. `pages/api/admin/health-history.js` + `pages/api/cron/health-check.js` →
   `health-history-store.js` (1 + 3 stmts).
2. `pages/api/expertise-finder/history.js`, `pages/api/expertise-finder/match.js`,
   `pages/api/expertise-finder/roster.js` → `expertise-store.js` (fold
   `batch-match-service.js`'s reads if identical).
3. `pages/api/cron/pricing-canary.js`, `pages/api/cron/pricing-refresh.js`,
   `pages/api/cron/spend-check.js` (after Q7), `pages/api/admin/stats.js` →
   `usage-log-store.js` + `maintenance-store.js` reads. **`spend-check.js`
   must keep counting all spend including test requests** (Session 535
   owner decision) — the characterization test pins that. Both
   `spend-check.js:22` and `stats.js:13` import `ATTEMPT_COST_UNKNOWN_SQL`
   from `review-panel-store`; because rule (b) forbids routes importing
   `lib/postgres/**`, expose that constant through a `lib/services` module
   (the usage/stats service these routes will call) and point both routes
   at it in the same commit.
4. `pages/api/cron/drain-submissions.js` and `pages/api/intake/submit.js` →
   retire the module-scoped `getPool()` (`drain-submissions.js:47`) and
   `newPool()` (`submit.js:84`) onto the seam's `getPool()` /
   `withTransaction`. `drain-submissions.js` itself touches only
   `maintenance_runs` telemetry — the drain engine already lives in
   `lib/services/cron/drain-submissions-service.js` and takes a `pg` client
   as an argument (`:16`) — so its statements go to `maintenance-store.js`
   and the engine keeps receiving the client from the seam. `submit.js`
   statements (`intake_drafts`, `submission_jobs`) → `intake-draft-service.js`
   (already Stage 3-converted). The intake path is guarded by
   `INTAKE_BLOB_RW_TOKEN` semantics — do not touch Blob code.
5. `pages/api/webhooks/bill.js` + `lib/bill/onboarding-state.js` →
   `bill-store.js` (`bill_webhook_events`, `bill_onboarding_state`).
   Webhook signature verification stays in the route.
6. `pages/api/cron/secret-check.js` — imports `sql` (`:18`) without a tag
   of its own; determine where it flows (likely `MaintenanceService`), drop
   the import once the callee reads the seam.

**Verify:** after each commit the route disappears from `POSTGRES_CARRYOVER`
in the same commit; `check:route-service-boundary` + self-test green;
`check:route-lifecycle-auth`, `check:api-routes` (+ self-tests) green; full
suite + build. At stage end `POSTGRES_CARRYOVER` contains only the 4 Stage 6
routes.

**Rollback:** revert the single commit.

### Stage 5 — Wave C: cross-cutting utilities and the maintenance service

**Goal:** `lib/utils`, `lib/intake`, `lib/external`, `lib/bill`,
`database-service.js`, and `maintenance-service.js` are on the seam;
`database-service.js` is split by table cluster.

**Preconditions:** Stage 4 complete; Q5 exemptions recorded.

**Tests before:**
- The existing `maintenance-service` unit tests green plus a contract test
  that runs each retention statement against seeded rows and asserts the
  exact survivors (the service deletes; the discriminating fixture is
  mandatory).
- Characterization tests for `lib/utils/usage-logger.js`,
  `lib/intake/rate-limit.js`, `lib/external/rate-limit.js` (both rate
  limiters are **fail-open by design** — `lib/external/rate-limit.js:14-17`
  — and write `system_alerts` on sustained failure; the tests must pin
  fail-open).
- `database-service.js`: contract tests for `search_cache` and
  `user_profiles` operations before the split.

**Order:**
1. `lib/utils/usage-logger.js` → `usage-log-store.js`.
2. `lib/utils/migration-drift.js` (if not exempt per Q5) →
   `system-alert-store.js`; `alert-service.js` (Stage 3) adopts the same
   store for its `system_alerts` writes.
3. `lib/intake/rate-limit.js`, `lib/external/rate-limit.js` →
   `rate-limit-store.js` (`external_rate_limit`).
4. `lib/services/database-service.js` → `search-cache-store.js` +
   `user-profile-store.js`; keep `DatabaseService` as a thin re-export facade
   for its 14 importers (rule 4: no importer edits until Stage 7).
5. `lib/services/maintenance-service.js` → `maintenance-store.js` holding
   the 21 statements; the service keeps orchestration, Blob cleanup, and
   settings reads. One statement group per commit (14 tables ⇒ expect ~8
   commits).
6. `lib/utils/health-checker.js` — exempt (Q5) or convert its
   `information_schema` probe onto `withClient`.

**Verify:** ratchet reaches zero outside Stage 6 files and Q5 exemptions;
full suite + build; `check:atlas` green after Atlas ownership rows move to
the new stores.

**Rollback:** per commit.

### Stage 6 — Auth and access surface (own stage; fail-closed proof first)

**Goal:** `user_profiles`, `dynamics_user_roles`, `dynamics_restrictions`
reads/writes go through `user-profile-store.js` and
`explorer-access-store.js`; no auth route imports a driver.

**Preconditions:** Stages 3–5 complete; ratchet lists only these 9 files:
`lib/utils/auth.js`, `pages/api/auth/[...nextauth].js`,
`pages/api/auth/link-profile.js`, `pages/api/dynamics-explorer/restrictions.js`,
`pages/api/dynamics-explorer/roles.js`, `lib/services/dataverse-identity-map.js`,
`lib/services/dynamics-identity-service.js`,
`lib/services/dataverse-app-access-service.js`, `lib/services/alert-recipients.js`.
Q9 plan status checked: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md` only
*reads* `user_profiles` from the Dataverse side (`:96`, `:486`); confirm it
has not since moved that table. `lib/utils/auth-policy.js` stays out: it is
Edge-bundle constrained and must never import the seam.

**Tests before (all must exist and pass before the first edit):**
- Fail-closed / fail-soft tests, pinning each surface's CURRENT direction:
  inactive profile → 403; profile lookup error → 503 never 200
  (`lib/utils/auth.js:189-199`); role lookup error → `read_only`, i.e.
  fail-soft (`lib/utils/auth.js:420-426`,
  `lib/services/dynamics-explorer/explorer-store.js:15-21`); restriction
  read has no catch of its own (`explorer-store.js:23-26`) — the Explorer
  chat route fails closed because the `Promise.all` at
  `pages/api/dynamics-explorer/chat.js:145-148` rejects before
  `withDynamicsContext` runs. The test must assert a rejected
  `getActiveRestrictions` never yields an empty restriction set.
- Contract tests for every statement in the 9 files.
- `check:dynamics-context-boundary`, `check:route-lifecycle-auth`,
  `check:trust-boundary-guid` (+ self-tests) green as a baseline.

**Order (one file per commit):** `lib/services/alert-recipients.js` →
`lib/services/dataverse-identity-map.js` →
`lib/services/dynamics-identity-service.js` →
`lib/services/dataverse-app-access-service.js` → `lib/utils/auth.js` →
`pages/api/dynamics-explorer/roles.js` →
`pages/api/dynamics-explorer/restrictions.js` →
`pages/api/auth/link-profile.js` (its row-lock transfer transaction,
`:57-203` — `BEGIN` at `:58`, `COMMIT` at `:117`/`:192`, `ROLLBACK` at
`:63`/`:203` — moves onto `withTransaction` verbatim) →
`pages/api/auth/[...nextauth].js`.

**Verify:** all Stage 6 tests green after every commit;
`docs/API_ROUTE_SECURITY_MATRIX.md` rows for the 4 routes updated in the
same commit as the route; `docs/AUTHENTICATION_SETUP.md` gains one paragraph
naming the stores; full suite + build; a signed-in Preview smoke of login,
Explorer role check, and a restriction denial (owner runs or authorises).

**Rollback:** per commit; the auth surface must never be left half-converted
across a deploy — promote this stage as one release.

### Stage 7 — Ratchet becomes law; moves; close-out

**Goal:** `check:postgres-access-layer` has no allowlist (law mode);
`POSTGRES_CARRYOVER` is deleted; optional relocation (Q4); docs reconciled.

**Preconditions:** `--report` shows 0 raw sites outside `lib/postgres/**` and
Q5 exemptions.

**Tests before:** everything above green;
`tests/unit/postgres-access-layer-recorded-set.test.js` pins the exempt set
so growth needs a deliberate edit (same pattern as
`tests/unit/reviewer-engagement-boundary-recorded-set.test.js`).

**Work:**
1. Delete the allowlist; gate exits non-zero on any raw site; promote Q6
   cast-lint to red if the owner agreed.
2. Delete `POSTGRES_CARRYOVER` from the route-law script.
3. (Q4) `git mv` the nine store modules and the split `database-service`
   stores into `lib/postgres/stores/`; update importers; leave a one-line
   re-export at each old path for one release, then delete.
4. Docs, in one commit each: `docs/SYSTEM_MODEL.md` storage-tier paragraph
   names the seam; `docs/APPLICATION_STATE_ATLAS.md` and the affected
   Postgres pages under `docs/atlas/` get write-path rows;
   `docs/SERVICE_AND_UTILITY_CATALOG.md`; `docs/CI_GATES_REFERENCE.md`; this
   plan's status → `complete`; a `DEVELOPMENT_LOG.md` milestone;
   `.claude-memory` pointer via `/sweep`.

**Verify:** every gate in `/start` + self-tests, full suite, build; a
deliberate raw import in a scratch file turns the gate red.

## 6. Self-check protocol (method for checking the plan and the work)

Two layers, both mandatory.

**Planning time (before this plan is trusted):** a fresh-context agent with
no memory of this session reads §1 and Appendix A only, probes the tree with
Appendix B, and reports every count, path, or symbol that does not hold.
Drift is fixed in this doc and logged below before the plan is committed.
The result of that review is recorded in the Stage log entry "Planning-time
review".

**Execution time (every stage):**
1. Ground rule 1 preamble — fresh context runs `--report`, diffs against the
   stage's Preconditions, stops on drift.
2. After the stage's last commit, spawn one fresh-context reviewer whose only
   brief is: *"Read Stage N+1's Preconditions and Tests-before in
   `docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md`. Probe the
   tree. Report every assumption that no longer holds and every named test
   that does not exist."* Its findings are written into the Stage log; this
   doc is edited **before** Stage N+1 starts.
3. Every stage report uses this template:

```markdown
### Stage N report — <date> — <branch@sha>
Preconditions: [VERIFIED via --report | drift: …]
Tests before: <list> [existed | written this stage]
Commits: <sha> <file> …
Ratchet: <before> → <after>
Verify: test:ci <pass/fail>, build <pass/fail>, gates <list> <pass/fail>
Fresh-context review of Stage N+1: <findings or "none">
Open: …
```

## 7. Risks the executor must weigh (not a checklist)

- **Mocked tests will stay green while a store is broken.** The whole point
  of Q1. If Q1 is answered (b), state in every stage report that CI did not
  exercise the planner.
- **`user_profiles` is the identity anchor** for NextAuth and for the
  Dataverse identity map. Stage 6 is last for that reason; do not pull it
  forward because it is "only a read".
- **`maintenance-service` deletes rows.** A wrong table in a moved statement
  is data loss, not a test failure. The contract test's survivor assertion
  is the guard.
- **Fresh-install vs migrations parity** (Q3) is a pre-existing defect this
  plan surfaces; fixing it changes `setup-database.js`, which refuses
  populated databases by design (`scripts/setup-database.js:12-17`) — never
  run it against a live database to "test".
- **Cross-branch edits** (rule 11). The Factory branch is 18+ commits behind
  `main` and touching `spend-check.js`; the Q9 plan touches identity code.
- **`@vercel/postgres` vs `pg` semantics differ** (pooling, `sql.query`
  parameter form). The seam must not silently swap one for the other in a
  caller; `getPool()` exists so the three `pg` users keep `pg`.
- **Fail-open surfaces must stay fail-open.** The two rate limiters and the
  best-effort telemetry writers (`operational-event-service`,
  `reviewer-identity-shadow-log`, `intake-audit-service`) swallow Postgres
  errors on purpose. A seam that adds a throw changes production behaviour.

## Stage log

- **2026-09-23 — Plan drafted** (S536, `claude/investigation`). Baseline
  probed live; census in Appendix A; no code changed. Text-grep census
  initially listed 62 files; reading every file removed 2 comment-only
  mentions (`lib/utils/auth-policy.js`, `lib/utils/auth-bypass-monitor.js`)
  → 60.
- **2026-09-23 — Planning-time review (§6) run.** A fresh-context agent
  checked 95 claims and found 16 discrepancies; all 16 were re-verified
  against the tree and fixed in this doc before commit. Material ones: the
  Stage 3 transaction-user list had 4 plain-`sql` files in it and omitted
  `briefing-link-store.js` and `irs-bmf-service.js`; `database-service.js`
  importer count was a text grep (19) not an import count (14) — the same
  rule 12 error; `user_profiles` 14→17 and `dynamics_user_roles` 5→7 files;
  `@vercel/postgres` 39→57 importing files; drained tables 7→6 with the
  drained `grant_cycles` still in `setup-database.js`; the Stage 6 fail-closed
  citation pointed at `auth.js` lines that are fail-soft, and the real
  fail-closed point is `chat.js:145-148`; `link-profile.js` transaction is
  `:57-203` not the docblock; `scripts/**` importers 42→49. Appendix A's 60
  rows (lines, statement counts, tables) and the stage totals were confirmed
  exact. Findings that were answers, not drift: BILL tables are covered by
  `docs/atlas/postgres-infra-tables.md`; `docs/plans/` is outside
  `check:docs-catalog` scope (`scripts/lib/docs-catalog.js:108-109`).
- **2026-09-23 — Executability pass on Stage 0.** Three harness assumptions
  did not hold and were rewritten: `@vercel/postgres` needs Neon's
  WebSocket transport (Q1b added); `setup-database.js` does not stamp
  `schema_migrations`, so "setup then apply-migrations" would re-run `007`
  (Stage 0 item 3 now stamps from the manifest); `grant_cycles` is drained
  but never dropped by a migration, so it is not a parity problem (item 5
  gained a DROP-scan assertion). Also fixed: Stage 1 Preconditions no longer
  cite a file Stage 1 creates; `drain-submissions.js` routes to
  `maintenance-store.js` not `intake-draft-service.js`;
  `ATTEMPT_COST_UNKNOWN_SQL` needs a service-level export before rule (b)
  can bind.
- **2026-09-23 — Owner decisions Q1–Q7 recorded** (§3). Reference pace for
  scope estimates: the Dataverse DAL plan was authored 2026-07-04 (S328) and
  all nine stages executed the same day in S329 with parallel Codex/Opus/
  Sonnet worktrees, security-complete S330
  (`docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` Stage log) — not a multi-month
  effort.
- **2026-09-23 — Local real-Postgres lane proven.** No Postgres or Docker
  existed on the owner's machine; the owner installed Colima. A `postgres:16`
  container accepted a `pg` connection from Node and reproduced the S504
  planner error on an untyped `jsonb_build_object` parameter (Stage 0 item 3
  records the commands). Q1(ii) transport is therefore confirmed workable
  locally; CI proof still pending.
- **2026-09-23 — Stage 0 in progress** (branch `claude/postgres-access-layer`,
  Sonnet builders / Opus reviewers / Fable orchestrating). The AST census
  probe reconciled Appendix A: 349 `sql` tags in 52 files (three text-grep
  artefacts removed, `irs-bmf-service.js` re-labelled pool-only); the 60-file
  driver split matched exactly. The parity test found a fifth migration-only
  table, `review_question_audit` (`022`), folded into Q3. Owner-directed
  change to the working model: the `setup-database.js` parity diff gets a
  Codex adversarial review before it lands; Stage 0 ends with a regroup, not
  an automatic Stage 1.

### Stage 0 report — 2026-09-23 — `claude/postgres-access-layer`
Preconditions: `[VERIFIED via Appendix B commands + AST probe]`; drift found
and reconciled: 352/53 → 349/52 statements, four → five migration-only
tables, `irs-bmf-service.js` pool-only, `review-questions-service.js` table
list corrected.
Tests before: none required (Stage 0 creates them) — created:
`tests/unit/postgres-schema-parity.test.js`, `tests/pg-contract/schema-applies.test.js`,
`tests/pg-contract/site-visit-collection-store.test.js`,
`tests/pg-contract/setup-database-parity.test.js`; gate self-test
`check:postgres-access-layer:self-test`.
Commits (one per Stage 0 item, in order): census probe; parity fix +
unit test (`setup-database.js` V55–V59); pg-contract lane; registrations
(`package.json`, `jest.config.js`, `test.yml`, `CI_GATES_REFERENCE.md`,
`/start`); this plan update.
Ratchet: n/a (report-only). Baseline: 60 driver-import files, 349 `sql` tags
in 52 files, 62 files with any record.
Verify: `test:ci` 1057 suites / 15,645 tests pass; `test:pg-contract` 3
suites / 8 tests pass locally (Colima `postgres:16`) and prints the skip
line without a URL; every gate in `/start` that guards a touched surface
green with its self-test (atlas 58 Postgres tables, migrations-manifest,
route-service-boundary, secret-scan, scaffolding, harness-framing,
instruction-architecture, agent-invariants, doc gates); canonical
`npm run build` **passes** (`✓ Compiled successfully`, 32 static pages,
manifest unchanged) after the worktree's symlinked `node_modules` — which
Turbopack rejects ("points out of the filesystem root") — was replaced by a
real `npm ci`; a webpack build had compiled clean beforehand as a fallback
signal. Worktree note for future sessions: a `node_modules` symlink into a
sibling checkout breaks the canonical build here.
Reviews: Sonnet built, Opus reviewed each stream (census 2 rounds, harness
3 rounds, parity 1 round); Codex adversarial review 3 rounds on the parity
work. Material findings fixed: shim preferred `POSTGRES_URL` (P1, decoy DB
proof); remote-host override removed; catalog projection widened to
relation kind/persistence, collation, identity/generated, owned sequences;
base-table-only runtime check; bogus table names from `ON CONFLICT … SET`.
Owner decisions: Q1–Q7 recorded; Q3 widened to five tables.
Fresh-context review of Stage 1: run (next log entry); 6 discrepancies,
all fixed in this doc before Stage 1 may start.
CI proof: draft PR #328 (`Tests` run 35955014525) green; the
`test:pg-contract` step connected to the `postgres:16` service container
and reported 3 suites / 8 tests passed with the 43-table runtime check, not
the skip line. (The workflow triggers on `pull_request` and `push` to
`main` only, so a branch push alone never runs it.)
Open: the
Q3 sub-question (how a fresh Vercel install is stamped) remains
undocumented; renamed/member `sql` tags and `new pg.Pool()` shapes are
recorded Stage 1 obligations in the probe's docblock.

- **2026-09-23 — Fresh-context review of Stage 1 preconditions (§6).** A
  fresh agent checked 38 claims and found 6 discrepancies, all fixed above:
  (1) Stage 1 item 2 assumed the route-law gate had ratchet semantics to
  copy — it is pure law with no baseline; the item now defines the Postgres
  carry-over explicitly, names the real hook (`isBoundarySource`), and says
  how the self-test's zero-baseline assertions change. (2) The probe's
  recorded recognition gaps (renamed/member `sql` tags, `new pg.Pool()`,
  nested member `.query`/`.connect`) were not in Stage 1's work — added as
  item 0, to close before the baseline freezes. (3) `pool.connect` is a
  ninth kind the plan never named — added. (4) Appendix A's Tables column
  still carried hand-grep names that exist only in comments
  (`system_alerts` in both rate limiters, `submission_jobs` in
  `intake-draft-service.js`, `maintenance_runs` in two cron routes,
  `portal_upload_staging` in `maintenance-service.js`, …) — the whole table
  is now generated from `--json`. (5) §1 idiom and hot-table counts were
  hand-grep numbers (`client.query` 8→10 files, `BEGIN` 8→9,
  `system_alerts` 8→4 files, `maintenance-service` 14→13 tables) —
  replaced with probe counts. (6) The Stage 0 report pointed at a log entry
  that did not exist — this is it. Stage 1 may start once the owner has
  regrouped (owner decision: stop after Stage 0).
- **2026-09-23 — Stage 0 regroup.** Owner decisions: draft PR #328 opened for
  CI proof (do not merge); the local `wmkf-pg-contract` container and Colima
  stay running for Stage 1; `claude/investigation` deleted (fully contained in
  `claude/postgres-access-layer`); Q3 sub-question resolved as "no
  through-line — migrations accreted" with a proposed follow-up (see Q3 row);
  Stage 1 timing to be discussed.

### Stage 1 report — 2026-09-23 — `claude/postgres-access-layer@633104aad`
Preconditions: `[VERIFIED via --report in a fresh Haiku agent before any
edit]` 60 driver-import files (lib/services 36, pages/api 17, lib/utils 4,
lib/bill 1, lib/external 1, lib/intake 1), 349 `sql` tags in 52 files, 62
files with any record; kind totals driver-import 60, sql-tag 349,
client.query 169, sql.query 40, begin-literal 12, db.connect 8, new-Pool 3,
pool.connect 3, pool.query 1. Drift: none.
Tests before: Stage 0 self-test and `check:route-service-boundary:self-test`
[existed, green]. Written this stage:
`tests/unit/route-service-boundary-postgres-carryover.test.js` (exact-set
pin of `POSTGRES_CARRYOVER`), plus self-test fixtures for every new
recognition form, every ratchet outcome, the Postgres route family, stale
carry-over entries, the mixed-family wrapper, the override root guard, and
a >64 KiB `--json` pipe.
Commits: `72466b933` item 2 (`scripts/check-route-service-boundary.js`,
its self-test, the pin test) · `99d0f3653` items 0, 1, 3
(`scripts/check-postgres-access-layer.js`, new
`scripts/postgres-access-allowlist.json`) — items 0 and 1 share one file
and one commit because item 0's binding map is what item 1 freezes ·
`6b21da269` item 4 (`docs/CI_GATES_REFERENCE.md`, `/start`) · `1cd79e7ce`
route law names `@neondatabase/serverless` (fresh-context finding) ·
`49e068dd7` Codex round 1: two new ratcheted kinds and the self-test
unpinned · `633104aad` Codex round 2: CommonJS accessor exports and aliased
`require` recognised (below).
Ratchet: report-only → 156 `{file, kind, count}` keys (62 files × their
kinds plus the 9 baselined `unresolved-import` sites in 6 files, Q5 files
excluded; the probe now has 11 kinds — the plan's "nine" gained
`unresolved-import` and `driver-export` in the Codex round). **Census line
for the next preamble:** `--report` now prints 60 driver-import files, 349
`sql` tags in 52 files, and **67** files with any record (the 62 with
Postgres kinds plus 5 that carry only `unresolved-import`); kind totals
unresolved-import 9, driver-export 0, the other nine unchanged. Stage 2's
Verify already expects the driver total to move to 61; live census identical before and after item 0,
which is the plan's proof that the recognition gaps were latent.
`POSTGRES_CARRYOVER`: 17 routes, exactly the census's `pages/api`
driver-import set, zero extras under propagation.
Decisions taken in-stage (orchestrator, within the plan's ground rules):
- A `sql` tag counts wherever it appears, with or without a driver import
  in the same file (Opus P1: otherwise `export { sql }` from any
  allowlisted file gave every new file — routes included — an uncounted
  tag, and the plan's own Verify mutation on a driver-free route stayed
  green). Over-recognition is the safe direction; no live false positive
  (the only extra grep hit, `irs-bmf-service.js:379`, is a comment).
- `--report` and `--json` apply the ratchet exit code, so `package.json`
  and the CI workflow were not touched (shared-file fence).
- Non-literal `require()`/`import()` sources resolve one hop through a
  same-file string const; the remaining nine live sites (all deliberate
  bundler bypasses in `lib/dataverse/client.js`, `request-correlation.js`,
  `settings-service.js`, `app-access-service.js`, `database-service.js`,
  `prompt-resolver.js`) are listed in `--report` for audit and neither
  counted nor failed — failing them closed would have been a false red on
  code this plan does not own.
- `--postgres-carryover` exits 2 unless `--root` is non-default, so the
  pinned list cannot be swapped by a `package.json`/workflow edit.
- Q6 cast-lint: 465 live warnings, 448 of them `VALUES (${…})` where the
  target column types the parameter; `--report` prints per-kind and
  per-file×kind totals only, rows behind `--cast-lint-detail`/`--json`.
  The Stage 7 false-positive record should treat `VALUES` separately.
Reviews: Sonnet built two disjoint streams (never ran git); Opus reviewed
each read-only with fixture and mutation harnesses — route stream: P1
(mixed-family wrapper tracked as one family, so a carried-over route could
reach Dataverse unflagged; fixed with family sets in the fixpoint), two P2
(`pg-copy-streams` unguarded; override flag usable on the real root) —
round 2 APPROVE; ratchet stream: P1 (bare `sql` tag uncounted without a
driver import), six P2 (driver source set, const alias fail-open,
`lib/postgres` index regex, two surviving mutants, cast-lint volume, item 4
missing), round 2 conditional APPROVE on two P2 (64 KiB pipe truncation
from `process.exit`, unpinned bare-tag case) — closed and re-verified by
the orchestrator (mutant now killed; `--json | wc -c` 70122 and parses).
Orchestrator's own checks: independent gap fixture against HEAD (0 for
every gap kind) and the new script (all counted); allowlist == census
recomputed from `--json`; the plan's three Verify mutations (driver import
in a scratch `lib/services` file → red; `sql` tag in a driver-free route →
red on the ratchet; driver import in the same route → red on the route law;
removed → both green).
Verify: `test:ci` 1058 suites / 15,646 tests pass (before the docs commit;
no runtime code changed after); canonical `npm run build` passes
(`✓ Compiled successfully`, 32 static pages); every `check:*` gate in
`/start` with its self-test, run sequentially after the three commits: 69/69
green (re-run after `49e068dd7`: 69/69; after `633104aad`: 69/69);
`test:ci` re-run after `49e068dd7` and again after `633104aad`: 1058 suites
/ 15,646 tests pass both times.
Codex adversarial review (round 1, `--scope branch --base c56a005b4`):
**needs-attention** — it executed two bypasses that left both gates green:
(1) a new service loading the driver through a computed specifier
(`['@vercel','postgres'].join('/')`), (2) an allowlisted service exporting
`getRawSql() { return sql }` for a new route to call under another name;
and (3) the JSON-pipe self-test pinned the live totals 60/349/62, which
would have failed on Stage 2's exempt seam file or any legitimate shrink.
Orchestrator decision: close (1) and (2) with LOCAL per-file kinds rather
than the inter-procedural provenance Codex suggested — `unresolved-import`
(computed sources ratcheted, the nine live deliberate bundler bypasses
baselined so a new one is red at the file that loads it, which is why
route propagation is unnecessary) and `driver-export` (identity export or
exported function returning a driver-bound binding; live count 0). Full
taint through function returns stays out of scope: the gate is a ratchet
against accidental raw usage plus the cheap laundering shapes, and both
DAL precedents drew the same line. (3) fixed: deep-equality against an
in-process payload plus structural invariants, and a shrink fixture.
Codex round 2 (`--scope branch --base c56a005b4`): confirmed all three
round-1 cases fixed (computed load red, ESM raw getter red, shrink green,
pipe deep-equality), then **needs-attention** on two more same-file shapes:
a CommonJS accessor export (`module.exports.getRawSql = () => sql`) and an
aliased `require` (`const load = require; load('pg')`), both of which
produced no record. Both fixed in `633104aad` with red fixtures for every
form and a CommonJS internal-use green control; the orchestrator re-ran its
own seven-file fixture (three CJS accessors, aliased literal load, aliased
computed load, `module.require`, CJS green control) against the committed
gate before (all green — the evasion) and after (all red except the
control). Codex round 3 (narrow, on `633104aad`): both round-2 fixtures
confirmed red; one more same-file shape — a two-hop alias (`const load =
require; const load2 = load; load2('pg')`) — still produced no record.
Fixed as a Stage 1 follow-up commit (alias resolution to a same-file
fixpoint; see the commit after Stage 2's first commits, sequenced behind
the Stage 2 builder's docblock edit to the same file). The orchestrator's
own review (fixtures above, the plan's Verify mutations, allowlist ==
census, mutant kill) is the last review; further alias depth is covered
by the fixpoint, and cross-file provenance stays out of scope. Route-gate side of both rounds:
no change needed — a new file or route using either shape is red at the
ratchet, and the 17 carry-over routes cannot add one without their counts
rising.
CI proof for the push (`d1800bedc`, PR #328 still draft): E2E green;
**Tests FAILED at `check:doc-symbol-refs`** on the pull_request MERGE
commit, not on branch content — `main` gained
`.claude-memory/project-sandbox-rehearsal-bypass-allow-rule.md`
(`85f51a17b`, the root session, after this branch last merged `main`) and
it cites two Factory-branch paths that do not exist on `main`. Locally the
gate is green here (297 files / 1,783 refs) because the file is not on
this branch. Every later CI step was skipped, so **CI has not yet proved
the two Stage 1 gates, `test:ci`, or the pg-contract lane for this push**;
local runs did. The fix belongs on `main` (shared-file fence; the other
session's surface) — flagged to the owner in the handoff. Re-push or
re-run after `main` is green to get the CI proof.
Fresh-context review of Stage 2: run (next log entry); 6 discrepancies,
all fixed in §4 and Stage 2 before Stage 2 starts.
Open:
- **Stage 7 wording needs an owner decision, raised now so it is not a
  surprise later.** Because `sql` tags count everywhere, the allowlist's
  tag/query keys for the nine existing store modules and `database-service`
  can only reach zero if Q4's relocation into `lib/postgres/stores/`
  happens (the allowed-importer set) — otherwise Stage 7's precondition "0
  raw sites outside `lib/postgres/**`" is unreachable and the law must be
  defined as driver-import + route-import only, with tag counts left to the
  route law and the store boundary. Either reading is coherent; Q4's
  "confirm at Stage 7" is now load-bearing rather than cosmetic.
- `pages/api/dataverse-export/` is exempt from both families (pre-existing
  short-circuit); no carry-over route lives there.

- **2026-09-23 — Fresh-context review of Stage 2 preconditions (§6).** A
  fresh Opus agent probed the tree at `6b21da269` and found six assumptions
  that did not hold, all fixed in §4 and Stage 2 above before Stage 2 may
  start: (1) the contract lane's `moduleNameMapper` swaps only
  `^@vercel/postgres$`, so a `pg`-backed `getPool()` would read a
  `POSTGRES_URL` the lane never sets — the `getPool` contract test now sets
  it from `PG_CONTRACT_URL` under `jest.isolateModules`; (2) Stage 2 work
  item 2 (allowed-importer set) was already done by Stage 1, proven with
  `--root` fixtures — item rewritten to the two docblock notes; the route
  law's missing `@neondatabase/serverless` was fixed in Stage 1 (`1cd79e7ce`); (3) Stage 2's Verify
  "census count identical" was false — the seam file is counted (60 → 61),
  only the ratchet stays green, and nothing pins the 60; (4) §4 said 8
  hand-rolled `BEGIN` sequences; the probe counts 12 in 10 files, and four
  files cannot take a commit-on-return `withTransaction` unchanged (early
  `ROLLBACK`-and-return, multiple `COMMIT`s, caller-supplied client) — §4
  now scopes `withTransaction` to the simple sequences; (5) two of the three
  `pg` Pool users build a Pool per call and `pool.end()` it, and two
  `db.connect` sites use the destroy-on-error `release(err)` form — §4 now
  specifies `withClient` destroys on error and defers the `pool.end()`
  lifecycle change to the converting stages; (6) "`POSTGRES_URL` read in
  `getPool()` and nowhere else" is unachievable while `sql`/`db` are
  re-exported (`@vercel/postgres` reads it internally) and all three live
  Pool users fall back to `DATABASE_URL` — §4 now says `getPool()` is the
  only place OUR code reads `POSTGRES_URL || DATABASE_URL`. Named tests that
  do not exist (expected — Stage 2 writes them): `tests/unit/postgres-client.test.js`,
  `tests/pg-contract/postgres-client.test.js`. Facts recorded for the
  builder: `withDossierTransaction` (`cycle-dossier-store.js:28`) and
  `withReviewPanelTransaction` (`review-panel-store.js:73`) are
  byte-identical models whose unguarded `ROLLBACK` can mask the original
  error; `@vercel/postgres` 0.10.0 exports `sql`, `db`, `createPool`,
  `createClient`, `VercelPool`, `VercelClient`, `postgresConnectionString`,
  `types`; `pg` 8.22.0 is a direct dependency; live `POSTGRES_URL` readers
  outside the seam: `irs-bmf-service.js:149`, `intake/submit.js:85`,
  `cron/drain-submissions.js:49`, `scripts/apply-migrations.js:105`, plus
  every `sql`/`db` importer implicitly; the `wmkf-pg-contract` container was
  up. No drift: `lib/postgres/` absent; both Stage 1 gates green; the Atlas
  page `docs/atlas/postgres-infra-tables.md` has no "Access layer" section
  yet and `check:atlas` adds no requirement for one without new table names.

### Stage 2 report — 2026-09-24 — `claude/postgres-access-layer@89ad9d446`
Preconditions: `[VERIFIED via --report in a fresh Haiku agent]` 60
driver-import files, 349 `sql` tags in 52 files, 67 files with any record,
unresolved-import 9, driver-export 0, both gates exit 0, carry-over 17/0,
`lib/postgres/` absent, both named tests absent, container up. Drift: none.
Tests before: written this stage first, failed for want of the module,
then green — `tests/unit/postgres-client.test.js` (20 tests after the
Codex round: release on
success/throw/falsy throw, ROLLBACK on throw with ROLLBACK-failure not
masking, COMMIT failure path, singleton + laziness, `POSTGRES_URL ||
DATABASE_URL` and the both-absent error naming both, exact export set via
both `require` and ESM interop, frozen facade without `end`, release
throwing on either path for both helpers) and
`tests/pg-contract/postgres-client.test.js` (5 tests against the real
container: commit, rollback, nested-throw leaves the probe table unchanged,
`withClient` releases, `getPool` singleton runs `SELECT 1`; after every
transaction test it asserts `pg_current_xact_id_if_assigned()` is null on a
fresh pooled connection and no session is `idle in transaction`).
Commits: `90b5768bc` probe docblock notes · `edb69241c` Stage 1 follow-up
(alias fixpoint, Codex round 3) · `7fa6ff430` `lib/postgres/client.js` +
both tests · `71e51c6d9` catalog + Atlas entries · `bf63c1213` kind-specific
`lib/postgres/**` exemption (Codex) · `89ad9d446` CommonJS seam, frozen
pool facade, release guard (Codex + Stage 3 fresh-context review).
Ratchet: allowlist byte-identical (156 keys); `--report` driver-import
files 60 → 61 (the seam, in the allowed-importer set); the seam's own
records (driver-import 2, driver-export 2, db.connect 1, client.query 3,
begin-literal 1, new-Pool 1) are reported, never ratcheted.
Decisions taken in-stage:
- `db` is NOT exported (plan §4 "exports exactly"; every live `db` use is
  `db.connect()`, which `withClient` replaces). §4 reconciled.
- `withClient` destroys the connection on error (`release(err ?? true)`),
  the strictly safer superset of the two live forms — a behaviour change
  for the four callers that release plainly on error today; recorded here
  and in §4 for the owner.
- `COMMIT` sits outside `withTransaction`'s try: a COMMIT failure surfaces
  the COMMIT error and destroys the connection; Postgres has already
  rolled back, so the DB end-state equals the model's (Opus verified with
  a deferred-unique probe). The model helpers' unguarded `ROLLBACK` can
  mask the original error; the seam swallows ROLLBACK failure.
- `getPool()` keeps `POSTGRES_URL || DATABASE_URL` (behaviour freeze for
  the three live Pool users) and is a singleton without `end()` on the
  public surface; `drain-submissions`' `max: 5` and the two per-call
  `pool.end()` lifecycles are recorded for Stages 3/4 to state when they
  convert. Nested `withTransaction` takes a second connection, never a
  second `BEGIN` on one client — noted for converters.
Reviews: Sonnet built (tests first); Opus reviewed read-only with scratch
mutants — no P1; four P2 closed (contract test now discriminates a
poisoned-client mutant by the open-transaction assertion rather than a
hook timeout; COMMIT-failure unit case; `db` export removed; docs state
built state, not planned). Orchestrator re-ran the poisoned-client mutant
(2 failures on the xact assertion in 0.1 s) and the export list.
Verify (at `71e51c6d9`): every `check:*` gate in `/start` with its
self-test, sequential: 69/69 green; `test:ci` 1059 suites / 15,659 tests
pass; canonical `npm run build` passes. Re-run at `89ad9d446`: gates
69/69 green; `test:ci` 1059 suites / 15666 tests pass; build passes. Contract lane 4
suites / 13 tests locally, `--detectOpenHandles` clean, skip line without
a URL; `check:atlas` 58 tables / `check:doc-currency` / `check:docs-catalog`
green with self-tests. Codex adversarial review: PENDING.
Codex adversarial review (`--scope branch --base d1800bedc`):
**needs-attention**, three findings, all accepted and fixed before the
stage closed: (P1) `getPool()` returned the raw Pool, so any importer could
`end()` the process-wide singleton — now a frozen `{ query, connect }`
facade with a non-enumerable test-only hook to close the handle; (P2) an
unguarded `release()` on the failure path could replace the original
error — release failure is swallowed there; (P2) the ratchet exempted all
of `lib/postgres/**` from the driver-import law — now only `client.js` is
fully exempt and other `lib/postgres/**` files are exempt for statement
kinds only. Module format: the seam became CommonJS after the Stage 3
fresh-context review (below) found 12 CJS consumers and two plain-node
scripts. Codex round 2 (narrow, on `89ad9d446`): **approve** — all three
fixtures closed, CJS and native-ESM probes pass, no new P1/P2 (its sandbox
could not run Jest or reach loopback; the orchestrator ran both).
Fresh-context review of Stage 3: run (next log entry); 6 items, all
reconciled in §4/Stage 3/Appendix note before Stage 3 starts.
Open: none new; Stage 1's Stage 7 wording question stands.

- **2026-09-24 — Fresh-context review of Stage 3 preconditions (§6).** A
  fresh Opus agent at `71e51c6d9` reconciled the 30-file list (exact match,
  every Tests-before statement count exact) and found six items, all fixed
  above: (1) 12 of 30 files are CommonJS and two plain-node scripts require
  three of them — the seam is now CommonJS rather than converting any
  consumer's module format; (2) `irs-bmf-service` cannot use `withClient`
  (COPY on a held raw `pg` client; BEGIN mid-session; two per-call pools
  with `pool.end()`) — Stage 3 item 4 now says `getPool().connect()`
  directly and deletes both `end()` calls; (3) `alert-service`'s two
  COMMITs are both success paths, so it fits `withTransaction` after all;
  (4) `cycle-dossier-store`/`review-panel-store`'s exported wrapper names
  must survive as `return withTransaction(fn)`; (5) the existing
  `site-visit-collection-store.test.js` covers 2 of 16 exports — extended,
  not counted as done; (6) §4's "12 BEGIN in 10 files" is now 13 in 10
  with the seam (12 in 9 without), Appendix A's 60 driver files are 61 and
  its 62 census rows are 68 — expected Stage 2 drift; Appendix A stays the
  frozen 2026-09-23 snapshot and `--report` is the live source. Named tests
  that do not exist: all 30 `tests/pg-contract/<store>.test.js` (expected;
  each is written before its file's commit); eight files lack any direct
  unit test (listed in Tests-before). Template facts recorded for item 1:
  `explorer-store.js` (40 lines, 4 tags; `getUserRole`,
  `getActiveRestrictions`, fire-and-forget `logQuery` with a 42703 fallback
  unreachable on the fresh schema; importers `chat-session.js:30`,
  `pages/api/dynamics-explorer/chat.js:33`; all three tables present in the
  contract DB; discriminating fixture: a non-integer `requestRound` stored
  as NULL). Every Stage 3 table exists in the contract DB except
  `irs_exempt_orgs_new`, which `irs-bmf-service` creates at runtime.

## Appendix A — Census (2026-09-23, commit `1046c1033`)

`[VERIFIED via node scripts/check-postgres-access-layer.js --json at Stage 0
close, S536]` — every row below is generated from the probe's output (the
first draft was a hand grep and carried comment-only table names; the
fresh-context review after Stage 0 caught that). "Kinds" are the probe's
per-file occurrence counts; "Tables" is the probe's best-effort extraction
(CTE aliases such as `inserted`/`claimable` can appear and are tolerated).
Regenerate with the probe, never edit rows by hand.

| File | Lines | sql tags | Kinds (probe) | Tables (probe, best-effort; CTE aliases may appear) | Stage |
|---|---:|---:|---|---|---:|
| `lib/bill/onboarding-state.js` | 159 | 10 | sql-tag:10 | bill_onboarding_state | 5 |
| `lib/external/rate-limit.js` | 242 | 3 | sql-tag:3 | external_rate_limit | 5 |
| `lib/intake/rate-limit.js` | 255 | 3 | sql-tag:3 | external_rate_limit | 5 |
| `lib/services/admin/policies-service.js` | 530 | 3 | sql-tag:3 | policy_publish_audit, system_alerts | 3 |
| `lib/services/admin/prompts-publish-service.js` | 587 | 5 | sql-tag:5 | prompt_publish_audit, system_alerts | 3 |
| `lib/services/admin/review-questions-service.js` | 275 | 3 | sql-tag:3 | review_question_audit, system_alerts | 3 |
| `lib/services/alert-recipients.js` | 192 | 1 | sql-tag:1 | dynamics_user_roles, user_profiles | 6 |
| `lib/services/alert-service.js` | 388 | 16 | db.connect:1, client.query:7, begin-literal:1, sql-tag:16 | system_alerts, user_profiles | 3 |
| `lib/services/consultant-feedback-service.js` | 800 | 0 | sql.query:10, client.query:18, db.connect:3, begin-literal:3 | consultant_feedback, expertise_roster | 3 |
| `lib/services/cron/drain-submissions-service.js` | 898 | 0 | client.query:17, begin-literal:2 | claimable, intake_audit, submission_jobs | n/a (client passed in) |
| `lib/services/cycle-dossier-service.js` | 269 | 0 | client.query:5 | cycle_dossier_runs | n/a (client passed in) |
| `lib/services/cycle-dossier-store.js` | 186 | 0 | client.query:22, db.connect:1, begin-literal:1, sql.query:12 | cycle_dossier_control, cycle_dossier_editions, cycle_dossier_entries, cycle_dossier_previews, cycle_dossier_runs, cycle_dossiers, dynamics_user_roles, user_profiles | 3 |
| `lib/services/database-service.js` | 519 | 16 | sql-tag:16 | search_cache, user_profiles | 5 |
| `lib/services/dataverse-app-access-service.js` | 168 | 1 | sql-tag:1 | user_profiles | 6 |
| `lib/services/dataverse-identity-map.js` | 101 | 1 | sql-tag:1 | user_profiles | 6 |
| `lib/services/deliberation-briefing/briefing-link-store.js` | 153 | 4 | sql-tag:4, db.connect:1, client.query:9, begin-literal:1 | deliberation_briefing_links, pre_site_distribution_attempts | 3 |
| `lib/services/dynamics-explorer-request-telemetry.js` | 130 | 3 | sql-tag:3 | dynamics_explorer_requests | 3 |
| `lib/services/dynamics-explorer/explorer-store.js` | 40 | 4 | sql-tag:4 | dynamics_query_log, dynamics_restrictions, dynamics_user_roles | 3 |
| `lib/services/dynamics-identity-service.js` | 158 | 5 | sql-tag:5, sql.query:1 | user_profiles | 6 |
| `lib/services/expertise-finder/batch-match-service.js` | 298 | 2 | sql-tag:2 | expertise_matches, expertise_roster | 3 |
| `lib/services/feedback-service.js` | 217 | 10 | sql-tag:10 | dynamics_explorer_requests, dynamics_feedback, user_profiles | 3 |
| `lib/services/intake-audit-service.js` | 109 | 3 | sql-tag:3 | intake_audit | 3 |
| `lib/services/intake-draft-service.js` | 595 | 20 | sql-tag:20 | intake_drafts | 3 |
| `lib/services/integrity-service.js` | 709 | 11 | sql-tag:11 | integrity_screenings, retractions, screening_dismissals | 3 |
| `lib/services/irs-bmf-service.js` | 570 | 0 | new-Pool:1, pool.query:1, client.query:22, pool.connect:1, begin-literal:1 | irs_exempt_orgs, irs_exempt_orgs_new | 3 |
| `lib/services/maintenance-service.js` | 998 | 20 | sql-tag:20 | api_usage_log, bill_webhook_events, dynamics_explorer_requests, dynamics_query_log, health_check_history, intake_audit, intake_drafts, maintenance_runs, operational_events, reviewer_identity_shadow_log, reviewer_institution_measurement_events, scheduled_email_messages, submission_jobs | 5 |
| `lib/services/meeting-tracker/agenda-store.js` | 201 | 12 | sql-tag:12 | deliberation_agenda_sends, inserted | 3 |
| `lib/services/operational-event-service.js` | 594 | 7 | sql-tag:7, sql.query:1 | operational_events | 3 |
| `lib/services/panel-review-service.js` | 801 | 6 | sql-tag:6, sql.query:2 | panel_review_items, panel_reviews | 3 |
| `lib/services/portal-upload-staging.js` | 639 | 15 | sql-tag:15 | consultant_feedback, portal_upload_staging | 3 |
| `lib/services/pre-site-visit/distribution-store.js` | 436 | 19 | sql-tag:19 | inserted, pre_site_distribution_attempts | 3 |
| `lib/services/review-draft-service.js` | 116 | 4 | sql-tag:4 | review_drafts | 3 |
| `lib/services/review-panel-store.js` | 686 | 0 | db.connect:1, client.query:51, begin-literal:1, sql.query:7 | dynamics_user_roles, review_panel_control, review_panel_entries, review_panel_runs, review_panel_seat_attempts, review_panels, user_profiles | 3 |
| `lib/services/review-synthesis-job-service.js` | 210 | 8 | sql-tag:8 | claimable, inserted, review_synthesis_jobs | 3 |
| `lib/services/reviewer-acceptance-job-service.js` | 295 | 10 | sql-tag:10 | claimable, reviewer_acceptance_jobs | 3 |
| `lib/services/reviewer-identity-shadow-log.js` | 157 | 1 | sql-tag:1 | reviewer_identity_shadow_log | 3 |
| `lib/services/reviewer-institution-measurement.js` | 161 | 1 | sql-tag:1 | reviewer_institution_measurement_events | 3 |
| `lib/services/reviewer-roster-store.js` | 1149 | 24 | sql-tag:24 | deleted, reviewer_find_roster | 3 |
| `lib/services/scheduled-email-store.js` | 535 | 32 | sql-tag:32 | inserted, scheduled_email_digest_runs, scheduled_email_messages, scheduled_email_reviewer_vip_flags, scheduled_email_vip_flags | 3 |
| `lib/services/site-visit-materials/collection-store.js` | 242 | 16 | sql-tag:16 | site_visit_material_collections | 3 |
| `lib/services/site-visit/recipient-directory-service.js` | 189 | 2 | sql-tag:2 | expertise_roster, user_profiles | 3 |
| `lib/utils/auth.js` | 462 | 6 | sql-tag:6 | dynamics_user_roles, user_profiles | 6 |
| `lib/utils/health-checker.js` | 182 | 1 | sql-tag:1 | (none) | 5 |
| `lib/utils/migration-drift.js` | 138 | 1 | sql-tag:1 | schema_migrations | 5 |
| `lib/utils/usage-logger.js` | 90 | 2 | sql-tag:2 | api_usage_log | 5 |
| `pages/api/admin/health-history.js` | 53 | 1 | sql-tag:1 | health_check_history | 4 |
| `pages/api/admin/stats.js` | 213 | 7 | sql-tag:7, sql.query:1 | api_usage_log, user_profiles | 4 |
| `pages/api/auth/[...nextauth].js` | 367 | 6 | sql-tag:6 | user_profiles | 6 |
| `pages/api/auth/link-profile.js` | 219 | 0 | db.connect:1, client.query:10, begin-literal:1 | user_profiles | 6 |
| `pages/api/cron/drain-submissions.js` | 152 | 0 | new-Pool:1, pool.connect:1 | (none) | 4 |
| `pages/api/cron/health-check.js` | 131 | 3 | sql-tag:3 | health_check_history | 4 |
| `pages/api/cron/pricing-canary.js` | 265 | 1 | sql-tag:1 | api_usage_log | 4 |
| `pages/api/cron/pricing-refresh.js` | 286 | 1 | sql-tag:1, sql.query:1 | model_pricing_audit | 4 |
| `pages/api/cron/secret-check.js` | 130 | 0 | (driver import only) | (none) | 4 |
| `pages/api/cron/spend-check.js` | 173 | 1 | sql-tag:1, sql.query:1 | api_usage_log | 4 |
| `pages/api/dynamics-explorer/restrictions.js` | 106 | 6 | sql-tag:6 | dynamics_restrictions, user_profiles | 6 |
| `pages/api/dynamics-explorer/roles.js` | 99 | 3 | sql-tag:3 | dynamics_user_roles, user_profiles | 6 |
| `pages/api/expertise-finder/history.js` | 50 | 2 | sql-tag:2 | expertise_matches | 4 |
| `pages/api/expertise-finder/match.js` | 235 | 2 | sql-tag:2 | expertise_matches, expertise_roster | 4 |
| `pages/api/expertise-finder/roster.js` | 403 | 4 | sql.query:4, sql-tag:4 | expertise_roster | 4 |
| `pages/api/intake/submit.js` | 451 | 0 | new-Pool:1, pool.connect:1, client.query:8, begin-literal:1 | intake_drafts, submission_jobs | 4 |
| `pages/api/webhooks/bill.js` | 202 | 1 | sql-tag:1 | bill_webhook_events | 4 |

Totals: 62 census rows — 60 driver-import files (Stage 3: 30, Stage 4: 13, Stage 5: 8, Stage 6: 9) plus 2 files that receive a `pg` client as an argument (`lib/services/cron/drain-submissions-service.js`, `lib/services/cycle-dossier-service.js`; they follow their callers).
Excluded after reading (comment-only mentions): `lib/utils/auth-policy.js`,
`lib/utils/auth-bypass-monitor.js`. Out of scope (Q5 exemption candidates,
not counted above): 49 `scripts/**/*.js` files import a driver (72 counting
`.mjs`/`.cjs`), including
`scripts/setup-database.js`, `scripts/apply-migrations.js`, and
`scripts/archive/**`.

## Appendix B — Probe commands (reproduce §1 and Appendix A by hand)

Run from the repo root. Stage 0 replaces these with the AST probe; until
then they are the plan's evidence. The first command is the disconfirming
form (anchored to import/require lines, so comments do not count).

```bash
# Files whose import/require line names a driver (non-test), by dir → 60
grep -rlE "^\s*(import|const|let|var|\}).*(@vercel/postgres|from 'pg'|require\('pg'\))" pages lib --include='*.js' \
  | grep -vE "__tests__|\.test\." | awk -F/ '{print $1"/"$2}' | sort | uniq -c

# Statement count → text grep says 352 in 53 files; the AST probe (authoritative) says 349 in 52
grep -rE "\bsql\`" pages lib --include='*.js' | grep -vE "__tests__|\.test\." | wc -l
node scripts/check-postgres-access-layer.js --report

# Routes reaching Postgres → 17
grep -rlE "^\s*(import|const|let|var|\}).*(@vercel/postgres|from 'pg')" pages/api --include='*.js'

# Table inventory (fresh-install script) → 53 names, and migration-only tables
# (the filter drops two comment artefacts, "IF" and "is", at setup-database.js:429/:433)
grep -oiE "CREATE TABLE (IF NOT EXISTS )?[a-z_]+" scripts/setup-database.js | awk '{print $NF}' | sort -u | grep -vE '^(IF|is)$'
for t in reviewer_find_roster review_drafts review_question_audit bill_onboarding_state bill_webhook_events; do
  echo "$t setup:$(grep -cw $t scripts/setup-database.js) migs:$(grep -lw $t lib/db/migrations/*.sql | wc -l)"; done

# Tests that mock the driver (79) vs tests naming a URL (6, all dummy)
grep -rlE "jest\.mock\(['\"]@vercel/postgres" tests | wc -l
grep -rlE "POSTGRES_URL|DATABASE_URL" tests --include='*.js'

# Route law is Dataverse-only today → 0 violations
node scripts/check-route-service-boundary.js --report
```
