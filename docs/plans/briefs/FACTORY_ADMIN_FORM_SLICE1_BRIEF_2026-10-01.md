# Build brief: Test Request Factory admin form, slice 1 (server plumbing)

Date: 2026-10-01 (S561). Orchestrator: Fable. Builder: Sonnet. Reviewers: Opus, then Fable, then Codex (adversarial).

Plan: `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md` (read it whole: 2a–2f, the route/service sketch, slice 1, *Contract-reconcile*). Reconnaissance (S561, Sonnet, read-only) is summarized in *Facts* below; every line cited there was read on this branch.

## Where

Worktree `/Users/gallivan/Code/WMKF_Apps-factory-form`, branch `claude/factory-admin-form-slice1` (from `origin/main`). Stay in this directory and on this branch. Commit in small steps with descriptive messages; push the branch (`git push -u origin claude/factory-admin-form-slice1`). Never push to `main`. No Production/Preview Dataverse, Postgres, Vercel or Blob access: unit tests only, with fakes. Never read `.env.local` values.

## Scope

Server plumbing only. No API routes, no UI, no status setter (slice 2b), no `next.config.js` change (slice 2). The deliverable is a service a thin route can call, plus its tests.

## Facts [VERIFIED S561 recon; re-read before relying on them]

- `buildCloneManifest(preflight, { source, fiscalYear, meetingDate, testLabel, bundle, recipe, programDirector, cast })` mints `requestId`, `runId`, `locationId` with `crypto.randomUUID()` (`lib/services/test-requests/basic-clone-steps.js:645-647`). `requestId` → `akoya_requestid`, `runId` → `wmkf_testcreationrunid` in the create body (`policy.js:321,331`), so both are inside `createBodySha256`. `computeRunPlanDigest` (`:786-797`) hashes the three ids, recipe, source id/revision, `bundleSha256`, copy-policy digest, `createBodySha256`, and on production the target. Default label at `:652` embeds the date. `assertBundleFresh` is called inside the builder (`:670-676`); manifest TTL 1 h (`:103`), not enforced at advance.
- Off production, a non-null `programDirector` or `cast` throws (`:638-643`). A sandbox manifest needs a bundle or `computeRunPlanDigest` throws on `copyPolicy.digest`.
- `reserveRun({ actorId, idempotencyKey, plan })` (`run-ledger.js:775`) validates the plan first (`assertReservePlan`, `:549-570`); `ACTOR_ID` regex `:390` is version-agnostic, so a UUIDv5 passes; the raw key must be printable ASCII without spaces (`:398-401`) and only its sha256 is stored. Returns `{ run, created }`; a same-key repeat returns the first row (`created: false`); a different plan digest on the same key throws 409 `test_request_run_conflict`. `getRun(runId)` (`:1140`) does **no** actor check; `listRuns({ actorId, limit })` (`:1501`) filters by actor.
- `pgLedgerDb(urlOrConfig)` (`run-ledger-db.js:62-104`) builds a `pg` Pool with no `max`/timeouts. `vercelPostgresLedgerDb` (`:22-48`) has no callers anywhere (rg over the repo).
- `requireLedgerUrl(target, env)` (`lib/db/ledger-guard.js:43`): fail-closed, logs the variable **name** only. `selectLedgerVariable` (`lib/db/ledger-registry.js:197-201`) falls back to `TEST_REQUEST_LEDGER_URL` for a sandbox target when the sandbox variable is unset; only the database-name check then refuses it. `ledgerSchemaCheck` (`ledger-guard.js:103`) opens its own pool and reads two JSON fingerprints from `process.cwd()` (`ledger-schema.js:35-36`).
- `classifyDeployment()` (`lib/dataverse/core/interlock.js:~38-45`) returns `production` | `preview` | `test` | `local`. `TARGET_URLS`, `SANDBOX_URL`, `PRODUCTION_URL` live in `basic-clone-steps.js:49-57`.
- `lib/dataverse/client.js` is CJS: `getAccessToken(resourceUrl)` (`:93`, reads `DYNAMICS_TENANT_ID/CLIENT_ID/CLIENT_SECRET`), `createClient({ resourceUrl, token, allowTestRequestMarkerWrites })` (`:255`). ESM services import it with `createRequire` or `require` as `lib/services/dataverse-settings-service.js:24` does.
- The CLI's reserve path (`scripts/rehearse-test-request-sandbox.mjs:880-1010`) and `buildGraphContext` (`:474-509`, a 14-method Graph wrapper) are the reference implementation. The CLI does **not** check `testRequestIsolationEnabled`; the form's check is new behaviour.
- Private Blob precedent `lib/services/cycle-dossier-storage.js`: `put(..., { access: 'private', token, addRandomSuffix: false, allowOverwrite: false })`, `get(..., { access: 'private', token, useCache: false })`. Its put-error read-back-as-success catch block must **not** be copied (it contradicts "any existing unreserved artifact refused"). Delete precedent: `del(pathname, { token })` in `portal-upload-staging.js:378,783`; list/del in `MaintenanceService`.
- `lib/utils/tracked-secrets.js:34-61` entry shape: `{ key: 'factory_blob_rw_token', name: '...', tier: 'blob' }`.
- Maintenance cron (`pages/api/cron/maintenance.js`): each task in its own try/catch; a result object with `error` counts as failed (`isFailedSubtaskResult`, `:361-369`); `MaintenanceService` is CJS and loads ESM via dynamic `import()` (`:740-743`), never `require`.
- `isolation.js:27-28`: `env?.TEST_REQUEST_ISOLATION === 'on'`.
- `uuid@11.1.1` is a dependency; `import { v5 as uuidv5 } from 'uuid'`; argument order `uuidv5(name, namespace)`.
- DAL gate: `scripts/check-dataverse-access-layer.js` `EXEMPT_FILES` is a `Set` of repo-relative paths with a comment each (`:63-98`).
- Tests use a recording fake db (`tests/unit/test-request-run-ledger.test.js:24 createFakeDb`) and injected env (`tests/unit/ledger-guard.test.js`). Live-Postgres tests live under `tests/integration/*.pg.test.js` and skip without `TEST_REQUEST_LEDGER_TEST_URL`. Do not add live tests in this slice.

## Decisions (made by the orchestrator; do not reopen)

1. **Factory namespace:** `export const FACTORY_ID_NAMESPACE = '717824eb-02d6-4f1e-8c95-891f6ffad959';` in a new `lib/services/test-requests/admin-run-identity.js`. Never change it.
2. **Names:** `actorId = 'admin:' + uuidv5('profile:' + String(profileId), NS)`. Ids: `uuidv5(`${actorId}\u001f${idempotencyKey}\u001f${label}`, NS)` with labels `run`, `request`, `location` (unit separator, which cannot appear in a key). Export `deriveActorId(profileId)` (throws on a non-positive-integer profileId) and `deriveRunIds(actorId, idempotencyKey)` → `{ runId, requestId, locationId }`. Validate the key against the ledger's grammar before deriving.
3. **`buildCloneManifest` gets an optional `ids = null`.** When supplied, each must be a GUID and the three distinct, else throw. The CLI passes nothing and is unchanged. Also: the production create body must use these ids; confirm by test that `createBody.akoya_requestid === ids.requestId` and `wmkf_testcreationrunid === ids.runId`.
4. **`targetFromDeployment(deployment = classifyDeployment())`** in `admin-run-identity.js` (or the service): `production` → `'production'`; `preview`, `test`, `local` → `'sandbox'`; anything else throws.
5. **Ledger URL selection:** the service calls `requireLedgerUrl(target, env)` but **first** refuses when `target === 'sandbox'` and `env.TEST_REQUEST_SANDBOX_LEDGER_URL` is unset (so the registry's fallback to the production variable can never be reached from the form). Do not edit `ledger-registry.js`.
6. **Pool settings:** `pgLedgerDb` accepts an optional second argument `{ pool: { max, idleTimeoutMillis, connectionTimeoutMillis } }` merged into the Pool config; the service passes `{ max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 }`. Default behaviour unchanged for the CLI. Every service entry point opens its pool, uses it, and `end()`s it in `finally`.
7. **`ledgerSchemaCheck`:** called by the service only at **reserve** (mode `'reserve'`), not on every call; the fingerprint-file tracing problem is slice 2's (`next.config.js`). Accept an injected `schemaCheck` dependency so tests can stub it.
8. **Blob store:** new `lib/services/test-requests/factory-artifact-store.js`. Token `FACTORY_BLOB_RW_TOKEN` (503-style error if unset). Pathnames minted **only** here: `${target}/drafts/${actorId}/${draftId}/bundle.json` and `${target}/runs/${runId}/{bundle,manifest}.json`; every id validated as a GUID, `target` as `sandbox|production`. `putCreateOnly(pathname, bytes)` uses `allowOverwrite: false`; any put error is a refusal (`factory_artifact_exists` when the store reports the object exists, else the raw error), never a read-back-as-success. `read(pathname, { expectedSha256? , maxBytes })` streams with a cap (bundle 60 MB, manifest 2 MB) and checks the digest when given. `del(pathname)` tolerates a missing object. `list(prefix, { limit })` bounded. Inject the `@vercel/blob` functions for tests.
9. **Manifest integrity on read:** the ledger holds `bundleSha256` and `createBodySha256`; the store need not keep a manifest digest. On advance the service reads the manifest and bundle, then calls the runner's existing `assertRunMatchesManifestAndBundle` path through `advanceRun` (do not duplicate that check). The bundle read passes `expectedSha256 = run.bundleSha256`.
10. **Graph context:** copy the CLI's `buildGraphContext` wrapper into the service module verbatim (same 14 methods), with a comment naming the CLI as the twin. Do not refactor the CLI to share it in this slice.
11. **Isolation check:** at reserve and advance, require `testRequestIsolationEnabled(env)` and `syntheticReviewerIsolationEnabled(env)` when `target === 'production'`; refuse with `factory_isolation_off` otherwise. Off production, no isolation requirement.
12. **Kill switch:** `factoryFormEnabled(env) = env?.TEST_REQUEST_FACTORY_FORM === 'on'` in `isolation.js`, beside the other readers. The service's **write** entry points (`exportSource`, `confirmRun`, `advance`) refuse with `factory_form_disabled` when off; read entry points (`listRuns`, `inspectRun`, `readArtifacts`, `recheck`) do not check it.
13. **`testLabel`:** required, 1–`MAX_LABEL_LENGTH` chars after trim; the service never relies on the builder's default.
14. **Director email:** the service takes `{ profileId, actorEmail }` from the caller (the future route reads `session.user.azureEmail`); it refuses a missing/invalid email on production and passes it to `resolveProgramDirector`. Off production, director and cast are `null`.
15. **Sweep ships in this slice** as `sweepFactoryArtifacts({ env, blob, ledgerDb, now })` in the store module, plus `MaintenanceService.sweepFactoryArtifacts()` (dynamic import) and one try/catch block in the cron handler. It returns `{ skipped: 'unconfigured', deleted: 0 }` when `TEST_REQUEST_LEDGER_URL` or `FACTORY_BLOB_RW_TOKEN` is unset. Rules: delete under `<target>/runs/<runId>/` only when (a) no ledger row and every object older than 24 h, or (b) the row's status is `ready`; never for `prepared|creating|needs_attention`; skip on ledger read error; tolerate missing objects; delete drafts older than 6 h. Bounded: at most 200 listed objects per invocation. The sweep's target is `targetFromDeployment()`.
16. **Owner-run download:** `scripts/factory-artifacts-download.mjs --run=<runId> --out=<absolute dir>`: reads `FACTORY_BLOB_RW_TOKEN` from the loaded env (`node --env-file`), validates the GUID, writes `manifest.json` and `bundle.json` create-only (`wx`, mode 0600) into `--out`, prints only pathnames, sizes and sha256 prefixes. Target from `--target=production|sandbox` (required).
17. **Delete `vercelPostgresLedgerDb`** and its header lines; grep for `@vercel/postgres` imports left in that file and remove if unused there.
18. **Ownership:** every per-run service entry point loads the run and refuses (`factory_run_not_found`, 404-style) unless `run.actorId === actorId`. CLI-made runs (`cli:` actors) are therefore invisible from the form: accepted v1 behaviour (owner, S561).

## Service surface (`lib/services/test-requests/admin-run-service.js`)

Factory function `createAdminRunService(deps)` where `deps` default to real implementations but every external is injectable: `{ env, deployment, ledgerDbFactory, schemaCheck, blob, createClient, getAccessToken, graphContext, now, exportBundle, readCast, resolveProgramDirector }`. Methods (all async; errors are `ServiceHttpError` with codes named above):

- `exportSource({ profileId, sourceRequestNumber })` → export the bundle (reuse `exportTestRequestSourceBundle`/`buildSourceBundle` from `source-bundle.js` with injected deps; production reads only), store it at the draft path under a server-minted `draftId`, return `{ draftId, summary, defaults: { fiscalYear, meetingDate } }`. Never return bundle text.
- `confirmRun({ profileId, actorEmail, draftId, idempotencyKey, confirmSourceRequestNumber, testLabel, fiscalYear?, meetingDate? })` → ledger-first: derive ids; `getRun(runId)`; if a row exists and `actorId` matches, return `{ run, created: false }` with **no** freshness check; else read the draft, `assertBundleFresh`, check the typed number against the bundle's source, preflight, production-only director + cast, build the manifest with the derived ids, compute the plan, write bundle then manifest **create-only** at the run path (an existing object → `factory_artifact_exists`, tell the caller to re-export with a new key), `ledgerSchemaCheck`, `reserveRun`, return `{ run, created }`. Never delete artifacts on any failure.
- `advance({ profileId, runId })` → load run, ownership, if `ready` return `{ outcome: 'ready' }` without touching Blob; isolation check (production); read manifest and bundle (digest-checked), one `advanceRun` with the fenced deps, return `{ step, outcome, status, destinationRequestNumber, errorMessage }`. Missing artifacts on a resumable run → `factory_recovery_required` with the run id (never re-export).
- `listRuns({ profileId })`, `inspectRun({ profileId, runId })` (redacted like `--run-inspect`: run + resources, no text), `readArtifacts({ profileId, runId })` (returns the two JSON documents; this is the owner download), `recheck({ profileId, runId })` (`recheckFoundationTransition` with a read client).

## Tests (mirror existing fakes; no live Postgres or Blob)

`tests/unit/test-request-admin-run-identity.test.js`, `tests/unit/test-request-factory-artifact-store.test.js`, `tests/unit/test-request-admin-run-service.test.js`, plus small additions to `tests/unit/test-request-basic-clone-steps.test.js` (ids), `tests/unit/maintenance-cron-handler.test.js` (sweep block, skip object), `tests/unit/notification-trust-model-pushup.test.js` or the tracked-secrets test if it enumerates entries. Cases the plan's slice-1 column requires, verbatim:

- guard picks `ledger_prod` and the production host only when the deployment is `production`; `preview`/`test`/`local` → sandbox host and `ledger`; sandbox target with no sandbox variable → refused before the registry fallback
- a manifest whose target mismatches the deployment is refused
- interlock modes `off`/`warn`/`on` and a rehearsal grant never change the host the form addresses (assert the `resourceUrl` passed to `createClient`)
- a sandbox reservation through the real `buildCloneManifest` (bundle-backed, no director, no cast) succeeds
- Blob pathnames are server-minted and actor/target-bound; a non-GUID id is refused
- an existing row is returned with no freshness check; a new reservation is refused on a stale draft (> 6 h)
- a failed or throwing `reserveRun` leaves artifacts in place (assert no `del`)
- any existing object at the run path → `factory_artifact_exists`, no overwrite
- the three derived ids differ and are stable across calls; a different key or actor changes all three
- pools are `end()`ed in `finally` on success and on error
- `create body` carries the supplied ids
- kill switch off → write methods refuse, read methods work
- isolation off on production → reserve/advance refuse; off production no check
- null/invalid profileId → refused everywhere; another actor's run → not found
- sweep: deletes a `ready` run's artifacts; keeps `prepared`/`creating`/`needs_attention`; deletes no-row objects only when all are > 24 h; tolerates missing objects; skips when unconfigured; skips on ledger read error
- `advance` on a `ready` run returns without reading Blob; missing artifacts on a `creating` run → `factory_recovery_required`
- existing CLI tests unchanged and green

**Mutation checks (do at least three and record them):** remove the ownership compare → the "another actor's run" test must fail; drop `allowOverwrite: false` → the exists test must fail; swap the sandbox-variable guard → the fallback test must fail.

## Gates (sequential; gate then its self-test)

`npx jest --testPathPatterns "test-request|ledger|maintenance"` then: `check:dataverse-access-layer` (+ self-test; add the `EXEMPT_FILES` entry with a comment), `check:dynamics-context-boundary` (+ self-test), `check:route-service-boundary` (+ self-test), `check:secret-scan` (+ self-test), `check:trust-boundary-guid` (+ self-test), `check:types`, `check:doc-currency`, `check:fact-consistency`. Report pass counts and any red output verbatim. If a gate fires on something this brief did not anticipate, stop and report rather than widening the exemption lists.

## Not in this slice

Routes, UI, `vercel.json`, `next.config.js` tracing, the status setter and `--status-abandon`, Atlas/runbook prose (slice 5), any change to the fence, the ledger schema, `ledger-registry.js`, or the runner's step bodies.

## Hand-back

Commits pushed on the branch; a report with: files changed; test counts; the three mutation checks; gate results; anything you had to decide that this brief did not cover (list it, do not bury it).
