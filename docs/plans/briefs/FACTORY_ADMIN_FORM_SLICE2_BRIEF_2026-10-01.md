# Build brief: Test Request Factory admin form, slice 2 (routes + matrix rows)

Date: 2026-10-01 (S562). Orchestrator: Fable. Builder: Sonnet. Reviewers: Opus, then Fable, then Codex (adversarial).

Plan: `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md` (read *2c*, *Route, service and UI sketch*, the slice 2 row, *Contract-reconcile* items 3, 5, 6). Slice 1 brief (the service you are calling): `docs/plans/briefs/FACTORY_ADMIN_FORM_SLICE1_BRIEF_2026-10-01.md`. Where this brief and the plan differ, this brief governs; the differences are listed under *Plan corrections*.

## Where

Worktree `/Users/gallivan/Code/WMKF_Apps-factory-form`, branch `claude/factory-admin-form-slice2` (from `origin/main`). Stay in this directory and on this branch. Commit in small steps with descriptive messages; push the branch (`git push -u origin claude/factory-admin-form-slice2`). Never push to `main`.

**No live systems.** No Production/Preview Dataverse, Postgres, Vercel or Blob access: unit tests only, with fakes. Never read `.env*` values. **Never run `npm run check:factory-ledger`** (it connects to the live managed ledgers); it is not one of this slice's gates.

## Scope

Six thin route files under `pages/api/admin/test-requests/runs/`, their tests, a small deadline addition to the service, one `next.config.js` tracing entry, the security-matrix rows, and the canonical route count. No UI (slice 3). No status routes (`runs/[runId]/status*` are slice 2b). No `vercel.json` change.

## Facts [VERIFIED S562 on this branch; re-read before relying on them]

- Pattern route: `pages/api/admin/test-requests/preview.js`. Order: `export const config = { api: { bodyParser: { sizeLimit: '32kb' } } }` (:25); method check with `Allow` header and 405 (:42-45); `const gate = await requireSuperuser(req, res); if (!gate) return;` (:47-48); strict body-shape and `isGuid` validation answering 400 (:83-91); service call inside `withDalContext('<label>', async () => { try {…} catch (error) { return sendError(res, error); } })`; local `sendError` (:27-33) maps `ServiceHttpError` to `res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code })`, anything else to `console.error` + generic 500 JSON.
- `requireSuperuser` returns **only** `{ profileId }` (`lib/utils/auth.js:447-462`), and `{ profileId: null }` when auth is not required. The session email is read with `getSession(req, res)` (`lib/utils/auth.js:129`), as `pages/api/test-email.js:38,47` does: `session?.user?.azureEmail`.
- `createAdminRunService()` with no arguments builds every real dependency (`lib/services/test-requests/admin-run-service.js:177-200`). Methods and returns: `exportSource({ profileId, sourceRequestNumber })` → `{ draftId, summary, defaults }`; `confirmRun({ profileId, actorEmail, draftId, idempotencyKey, confirmSourceRequestNumber, testLabel, fiscalYear, meetingDate })` → `{ run, created }`; `advance({ profileId, runId })` → `{ step, outcome, status, destinationRequestNumber, errorMessage }` (also `outcome: 'ready' | 'not_advanced'`); `listRuns({ profileId })`; `inspectRun({ profileId, runId })` → `{ run, resources }`; `readArtifacts({ profileId, runId })` → `{ runId, cleanedUp, manifest, bundle }`; `recheck({ profileId, runId })`.
- Every service refusal is a `ServiceHttpError` with `httpStatus` and `code`: 403 `factory_profile_required` (null/invalid profile), 503 `factory_form_disabled` (write methods only: `exportSource`, `confirmRun`, `advance`), 503 `factory_isolation_off`, 503 `factory_ledger_unconfigured`, 404 `factory_run_not_found` (bad GUID, missing, or another actor's run), 400 `factory_invalid_input`, 403 `factory_actor_email_required`, 400 `factory_source_mismatch`, 410 `factory_draft_missing`, 409 `factory_draft_stale`, 409 `factory_recovery_required`, 404 `factory_artifacts_missing`, 409 `factory_run_not_production`, and others. The read methods never check the kill switch.
- `schemaCheck` (`ledgerSchemaCheck`) is called only in `confirmRun`. It reads `lib/db/ledger-schema-fingerprint.json` via `readExpectedFingerprint` from `process.cwd()` (`lib/db/ledger-schema.js:35,467`; `lib/db/ledger-guard.js:103-125`). `readApprovedAhead` reads `lib/db/ledger-schema-ahead.json` and returns `[]` when the file is missing (`ledger-schema.js:481-488`), so an untraced "ahead" file fails silently, not loudly.
- `next.config.js:86-89` `outputFileTracingIncludes` keys are route paths (`'/api/review-manager/export-reviews': ['./shared/templates/reviews/*.docx']`).
- `vercel.json` `functions` has no key with a dynamic segment. Dynamic-segment routes set the limit in the file: `export const config = { api: {…}, maxDuration: 300 }` (`maxDuration` is a sibling of `api`; `pages/api/dynamics-explorer/chat.js:37-41`).
- The service accepts no deadline today (no `deadline` anywhere in it). The Dataverse client supports opt-in `timeoutMs`/`signal` per request (`lib/dataverse/client.js:319-329`).
- Export read limits: 7 files, 25 MB per file, **50 MB total** (`TEST_REQUEST_PREVIEW_READ_LIMITS`, `lib/services/test-requests/admin-preview-service.js:65-73`). The bundle holds document metadata and a content hash, never file bytes; the store's 60 MB cap is a JSON size cap.
- Route count: `docs/CANONICAL_COUNTS.md:39-43` `api-route-file-count` live value 241; derived by a recursive walk of `pages/api` counting every `.js` file (`scripts/lib/canonical-facts.js:157-170`). Six new files → **247**.
- `check:api-routes` requires the literal `` `/api/admin/test-requests/runs/[runId]/advance` ``-style route string in `docs/API_ROUTE_SECURITY_MATRIX.md`; `index.js` is stripped (`runs/index.js` → `/api/admin/test-requests/runs`, `runs/[runId]/index.js` → `/api/admin/test-requests/runs/[runId]`). The two existing Factory rows are at matrix lines 144-145.
- `/api/admin` is not in `ROUTE_NAMESPACE_LIFECYCLE`; `check:route-lifecycle-auth` asks nothing of these routes. `check:route-service-boundary` forbids route imports of `lib/dataverse/adapters/*` and `lib/services/dynamics-service`.
- Route test precedent: `tests/unit/test-request-admin-preview-route.test.js` (`jest.mock('../../lib/utils/auth', …)`, `withDalContext: jest.fn((_label, fn) => fn())`, mocked service module, `mockRes()`).

## Plan corrections (orchestrator, S562)

1. **No `vercel.json` entries.** The two 300 s routes set `maxDuration: 300` in their own `config` (established practice for dynamic-segment routes).
2. **Session email** comes from `getSession(req, res)`, not from the gate result (the plan's `send-invite.js:57` citation is a `requireAppAccess` route).
3. **"7 files, 25 MB each"** is not reachable: the total cap is 50 MB. The deadline test below uses 7 documents and a fake clock; real timing is measured at the slice 3 Preview rehearsal, not here.
4. **Deadline** is cooperative checkpoints (decision 5), not cancellation.

## Decisions (made by the orchestrator; do not reopen)

1. **Files** (six): `runs/source.js` (POST), `runs/index.js` (GET, POST), `runs/[runId]/index.js` (GET), `runs/[runId]/advance.js` (POST), `runs/[runId]/recheck.js` (POST), `runs/[runId]/artifacts.js` (GET).
2. **Every route, in this order:** `config` with `bodyParser.sizeLimit: '32kb'`; method check (405 + `Allow`); `requireSuperuser` (return if falsy); input validation (400, code `factory_invalid_input`); then the service call inside `withDalContext('admin-test-request-runs-<op>', …)` with the `sendError` mapping. Never pass `req.body` or `req.query` objects to the service: pick named fields. `profileId` always comes from `gate.profileId`, never from input. The service already refuses a null profile with 403; do not duplicate that check in the route.
3. **Shared route helper:** put `sendError`, the deadline helper and the small validators in one module, `lib/services/test-requests/admin-run-route-helpers.js` (not under `pages/api`, where it would count as a route file). Do not refactor `preview.js` to use it.
4. **Input validation at the route** (before any service call):
   - `runId` (from `req.query.runId`): must be a string and `isGuid` (`lib/utils/guid.js`), else 400.
   - Bodies are plain objects with **only** the allowed keys; an unknown key is 400. POST routes with no body fields (`advance`, `recheck`) accept an absent or empty body only.
   - `sourceRequestNumber`, `confirmSourceRequestNumber`: strings matching `/^\d{1,10}$/`.
   - `draftId`: string, `isGuid`.
   - `idempotencyKey`: string matching `/^[\x21-\x7e]{1,200}$/` (the ledger's grammar, `run-ledger.js:391`).
   - `testLabel`: string, 1–120 characters after trim.
   - `fiscalYear`, `meetingDate`: optional; when present, strings of at most 32 characters (the service validates their meaning).
5. **Deadline.** The helper `routeDeadline(maxSeconds)` returns `Date.now() + maxSeconds * 1000 - 20_000`. The two 300 s routes pass `deadlineAt` to the service. Add an optional `deadlineAt` to `exportSource`, `confirmRun` and `advance`; when absent, behaviour is unchanged (slice 1 tests stay green untouched). Refusal: `ServiceHttpError` 504, code `factory_deadline_exceeded`, with a message saying nothing was started and the admin can retry. Checkpoints, using the service's injected `now()`:
   - `exportSource`: before the export starts, before each document hydrate (wrap `hydrateDocument` in `defaultExportBundle`; thread the deadline through its arguments), and before the draft `putCreateOnly`. A refusal stores no draft.
   - `confirmRun`: once, immediately before the first run-path `putCreateOnly`. Never between the bundle write, the manifest write and `reserveRun`.
   - `advance`: once, immediately before `advanceOne`, requiring at least `MIN_STEP_BUDGET_MS = 150_000` remaining (a named constant with a comment: one step includes the 60 s observe wait). Never inside a step.
   - `runs` POST (Confirm) runs at the default function limit and passes no deadline.
   Do not add `timeoutMs` to individual Dataverse or Graph calls in this slice, and do not use `Promise.race` to abandon in-flight work.
6. **Limits:** `runs/source.js` and `runs/[runId]/advance.js` set `maxDuration: 300`. The other four set none.
7. **Confirm email:** `runs` POST calls `getSession(req, res)` after the gate and passes `actorEmail: session?.user?.azureEmail ?? null`. The body has no email field, and a body that carries one is refused by the unknown-key rule. The service decides whether a missing email is fatal (production only).
8. **Responses:** 200 with the service's return value as JSON (`runs` GET returns `{ runs: [...] }`); `runs` POST returns 201 when `created` is true, 200 otherwise. `artifacts` adds `Cache-Control: no-store`. No route returns raw error text from a non-`ServiceHttpError`.
9. **One service instance per request** (`createAdminRunService()` inside the handler, or a module-level factory the tests can mock). Tests mock the service module, as the preview route test does.
10. **Tracing:** add to `next.config.js` `outputFileTracingIncludes`: `'/api/admin/test-requests/runs': ['./lib/db/ledger-schema-fingerprint.json', './lib/db/ledger-schema-ahead.json']`. Only that key (only Confirm reaches the schema check).
11. **Matrix rows:** add the six create/inspect rows from the plan's *Route security matrix rows* table (not the two `status` rows) after matrix line 145, corrected to what is built: guard cell `requireSuperuser`; `withDalContext`; the write switch named only on the three write routes; `maxDuration 300` in-file; the deadline described as "refuses to start a step with under 150 s left". Mark each row **[BUILT, NOT ENABLED: `TEST_REQUEST_FACTORY_FORM` unset]**; do not claim any live verification.
12. **Route count:** update `api-route-file-count` 241 → 247 the way the repo regenerates `docs/CANONICAL_COUNTS.md` (find the render/write command in `package.json`/`scripts/lib/canonical-counts-render.js`; do not hand-edit a generated block if a generator exists).

## Tests

New: `tests/unit/test-request-admin-runs-routes.test.js` (one file, or one per route if clearer). For **each** of the six routes and each method:

- wrong method → 405 with the right `Allow`
- `requireSuperuser` returns null → the service is not called
- a `ServiceHttpError` from the service is passed through with its status and code: 403 `factory_profile_required` (null profile), 503 `factory_form_disabled`, 503 `factory_isolation_off`, 404 `factory_run_not_found` (another actor's run)
- a non-`ServiceHttpError` → 500 with the generic body and no error text leaked
- `profileId` passed to the service equals the gate's, even when the body or query carries a `profileId` (which must be a 400 unknown key on body routes)
- malformed `runId` → 400, service not called
- body-shape cases per decision 4: unknown key, wrong type, over-length, missing required field → 400, service not called
- `config.api.bodyParser.sizeLimit === '32kb'`; `config.maxDuration === 300` on `source` and `advance` only
- `runs` POST: `actorEmail` comes from the mocked `getSession`, an `actorEmail`/`email` body key is refused, 201 vs 200 on `created`
- `source` and `advance` pass a numeric `deadlineAt` roughly `now + 280 s`; `runs` POST passes none
- `artifacts` sets `Cache-Control: no-store`

Service additions in `tests/unit/test-request-admin-run-service.test.js` (existing fakes):

- write switch off → `exportSource`/`confirmRun`/`advance` 503; `listRuns`/`inspectRun`/`readArtifacts`/`recheck` still answer
- export with 7 documents and a fake clock that passes the deadline during the fourth hydrate → 504 `factory_deadline_exceeded`, no draft stored, remaining documents not hydrated; the same export within the deadline stores one draft
- `advance` with under 150 s left → 504, `advanceRun` not called, no lease claimed; with enough time → advances
- `confirmRun` past the deadline → 504 before any run-path write (assert zero puts at the run path)
- no `deadlineAt` → unchanged behaviour

**Plan's slice 2 recovery cases.** For each case below, either cite the existing slice 1 test that already proves it (test name and file, in your report) or add the test: bundle-only leftovers at the run path → refused, nothing overwritten; complete artifacts with no ledger row → refused, re-export required; two overlapping Confirms with the same key → exactly one reservation, the loser is refused or returned the winner's row, no artifact overwritten; lost COMMIT response with the row present → the retry returns the row and artifacts are untouched; sweep against a fresh path → retained; overlapping sweeps tolerate missing objects; sweep deletes a `ready` run's artifacts and keeps `needs_attention`/`prepared`/`creating`; advance on a cleaned `ready` run returns without loading artifacts; a second lookup mints a new `draftId` and path.

**Mutation checks (do at least three, record them):** remove the `isGuid` check on `runId` → the malformed-`runId` test fails; take `actorEmail` from the body → the email test fails; remove the pre-`advanceOne` deadline check → the under-150 s test fails.

## Gates (sequential; a gate, then its self-test)

`npx jest --testPathPatterns "test-request|ledger|maintenance"`, then: `check:api-routes`, `check:route-service-boundary`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:dataverse-access-layer`, `check:dynamics-context-boundary`, `check:fact-consistency`, `check:canonical-pointers`, `check:doc-currency`, `check:secret-scan` (each followed by its `:self-test`), then `check:docs-catalog` and `check:types`. Report pass counts and any red output verbatim. If a gate fires on something this brief did not anticipate, stop and report; do not widen exemption or allow lists.

## Not in this slice

UI; `runs/[runId]/status` and `status/recheck` and the one-PATCH rule (slice 2b); `vercel.json`; Atlas, runbook and plan prose (the orchestrator writes those); any change to the fence, the ledger, the runner's step bodies, `preview.js`, or the artifact store beyond what decision 5 needs.

## Hand-back

Commits pushed on the branch; a report with: files changed; test counts; the mutation checks; the recovery-case table (case → test name and file, existing or new); gate results; anything you had to decide that this brief did not cover (list it, do not bury it).
