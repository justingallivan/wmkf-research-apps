# Test Request Factory: admin form (production plan item P7)

Status: **DRAFT (2026-10-01, Session 561). Awaiting the owner decisions listed at the end, then `/contract-reconcile` and a Codex plan review before any build.** Parent plans: `TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md` (P7, P4, P2, MVP scope, Q1–Q5, *Process*), `TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` (*Operation contract and recovery*), `TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` (cast, status setter, B4), `TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md` (managed ledger, D1–D3). Where this plan and the production plan's owner decisions disagree, the production plan wins until this one is accepted.

Path convention: a bare basename with line numbers (`run-ledger.js:20-24`) is a file under `lib/services/test-requests/` unless its directory is given in brackets; the CLI is `scripts/rehearse-test-request-sandbox.mjs` ("CLI `:904`"). Every cited line was read in S561.

## The ask, and what the owner can use today

Original ask (owner, 2026-09-19): "It is very hard for me to create requests from scratch for testing. Could you design a system that could create a new request based on an existing one?" Owner decision today (2026-10-01, S561): "We need the form." P7 in the production plan: a superuser-only form in the deployed app that creates production test Requests, replacing the owner-run local CLI.

What exists today [VERIFIED S561 via the CLI source, the production plan status line, the cast plan status line]: the owner can create a production `basic` clone with the CLI (export bundle → `--reserve` → one `--advance` per step, `copy_file` once per file → optional `--run-recheck`), bound to the reused synthetic cast; set Phase I/II status with `--set-status`; bind the cast reviewer. Three production runs exist (1003301, 1003302, 1003303). Everything requires a terminal on one of the owner's two Macs, a same-day `DATAVERSE_PROD_WRITE_ACK`, `DATAVERSE_ALLOW_PROD_READS=yes`, and the ledger URL in that Mac's `.env.local`. That friction is what the form removes. Nothing else changes: the form drives the same runner, the same fence, the same ledger.

Scope rule for this plan (memory `feedback-anchor-multisession-features-to-the-original-ask`, `feedback-latency-plan-scope-accretion-postmortem`): every gate below is presented as a scope choice with its cost, not as a settled prerequisite; the recommendation is always the smallest thing that gives the owner a working button.

## Current state

### Built and reusable as-is

| Piece | Where | Evidence |
|---|---|---|
| Resumable step runner, basic recipe (7 steps: `fence_source`, `create_request`, `correct_meeting_date`, `provision_location`, `copy_file`, `observe`, `verify`); one `advanceRun()` call advances one step under a lease (300 s for basic) | `lib/services/test-requests/run-runner.js:173-177,4189`; `recipeLeaseSeconds` `:239` | [VERIFIED via source] |
| Production write fence (`fenceProductionClient`, `fenceProductionGraph`) imported by the runner and applied to production runs: closed POST shapes, source-ID refusal, deny-by-default | `lib/services/test-requests/production-write-fence.js:1-45`; `run-runner.js:71` | [VERIFIED via source header and import; per-step wiring per production plan MVP item 2, not re-traced this session] |
| Durable ledger with reserve-or-return on `(actor_id, idempotency_key)`, lease fencing, `markReady`, `markNeedsAttention`, `getRun`, `listRunResources`, `listRuns`; no-text invariant (identities, digests, sizes only) | `run-ledger.js:1-38,775,877,967,1002,1140,1148,1501` | [VERIFIED via source] |
| Injected-db adapters: `pgLedgerDb(url)` routes every string URL through `lib/db/ledger-registry.js` `buildLedgerClientConfig`; `pg` is a runtime dependency | `run-ledger-db.js:56-107`; `package.json:146` (inside `dependencies`, `:112`) | [VERIFIED] |
| Ledger host registry and guard: `requireLedgerUrl(target)` refuses unset, shared-app-DB, unregistered host, wrong database; `ledgerSchemaCheck` fingerprint | `lib/db/ledger-registry.js:1-60`; `ledger-guard.js:43-68,103` [lib/db] | [VERIFIED] |
| Managed ledger live: Neon `wmkf-factory-ledger`, databases `ledger_prod` and `ledger`, 054 + 058 applied, operational rows loaded | `docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md` | [VERIFIED via evidence file; not re-probed this session] |
| Source bundle export (read-only production reads, injected deps) and freshness rule (`BUNDLE_MAX_AGE_MS` = 6 h) | `source-bundle.js:630,868-896`; `lib/services/test-requests/bundle-file-copy.js:87-97` | [VERIFIED] |
| Manifest builder, program-director resolver (sign-in → exactly one enabled `systemuser`), cast readback requirement for production manifests | `basic-clone-steps.js:545-563,620-663` | [VERIFIED] |
| Foundation transition recheck (`recheckFoundationTransition`) used by `--run-recheck`: needs only the ledger run + resources and a read client, not the manifest or bundle | CLI `:1276-1292` | [VERIFIED] |
| Superuser gate `requireSuperuser` and the admin Test Requests workspace with two sections and two routes | `auth.js:447-462` [lib/utils]; `admin.js:3433-3454` [pages]; `pages/api/admin/test-requests/{preview,email-allowlist}.js`; `shared/components/admin/TestRequest*Section.js` | [VERIFIED] |
| Isolation switch readers (`testRequestIsolationEnabled`, `syntheticReviewerIsolationEnabled`: literal `on` only) | `isolation.js:27-28,75` | [VERIFIED] |
| Production environment has `TEST_REQUEST_ISOLATION`, `SYNTHETIC_REVIEWER_ISOLATION`, `DATAVERSE_TARGET_INTERLOCK`, `DATAVERSE_DAL_ENFORCEMENT` set; **no** `TEST_REQUEST_LEDGER_URL` | `vercel env ls production` (names only) | [VERIFIED S561; values not read] |

### Built but not reusable for the form

- **The existing admin preview is sandbox-only and uses the older compiler.** `assertPreviewTargets` refuses unless `target === 'sandbox'` and the deployment is not production (`admin-preview-service.js:123-130`); it composes `compileTestRequestDraft`/file-plan directly over live reads, not the bundle path the runner requires (`isBundleManifest` refuses non-v4 manifests, CLI `:925`). Its source-lookup UI (`TestRequestPreviewSection.js`, 428 lines) is the right *shape* for picking a source Request but its route cannot be pointed at production without a rewrite. Recommendation: leave it as the sandbox preview; build the form's source step on `exportTestRequestSourceBundle` instead (2b). [VERIFIED via source]
- **`vercelPostgresLedgerDb()`** (`run-ledger-db.js:22-48`) is labelled "production/preview" but binds `@vercel/postgres`, i.e. the shared app `POSTGRES_URL`. Using it from the form would make the app database the ledger, which P6, the runbook and the Atlas forbid. It has no caller outside its own file [VERIFIED by grep over `lib`, `pages`, `scripts`, `tests`, `shared`]. The form must use `pgLedgerDb(requireLedgerUrl(...))`. Build item: delete or rename that adapter so it cannot be picked by mistake.
- **The CLI's production gate is the interlock's local ack.** On Vercel it does not exist (2a).
- **Reservation identity.** The ledger header requires the caller to derive `run_id`/destination GUIDs deterministically from `(actorId, idempotencyKey)` (`run-ledger.js:20-24`); `buildCloneManifest` uses `crypto.randomUUID()` (`basic-clone-steps.js:645-647`). The CLI gets away with it because the manifest is written before the reserve and a retry re-reads the stored row. The form has no local manifest file, so it must derive them (2f). [VERIFIED via source]
- **DAL gate exemptions.** `scripts/check-dataverse-access-layer.js` walks `lib/` and `pages/` and exempts named Factory modules (`:63,81-98`). A new server-side Factory service that constructs the raw `createClient` (needed for `allowTestRequestMarkerWrites`, `client.js:255` [lib/dataverse]) will need a reviewed exemption entry. [VERIFIED via gate source]
- Whether `check:dynamics-context-boundary` also fires on that service is [ASSUMED] until the build runs it.

### Not built

The P4 readiness endpoint (deferred in the MVP list; replaced by an owner checklist). Any `retire` ledger method (`run-ledger.js` has no retire path; one mention of the word) [VERIFIED by grep]. Any server-side storage for a manifest or bundle. Any `pages/api/admin/test-requests/runs*` route.

## Design questions

### 2a. Production write authority on the server

Fact [VERIFIED via `lib/dataverse/core/interlock.js:163-176,335-338`]: `resolveProdWriteAck` returns null unless `classifyDeployment() === 'local'`; `evaluatePolicy` on a production deployment allows every write to the production target. On Vercel Production the interlock contributes nothing to the Factory, and on Vercel Preview it **denies** every production write outright (no ack can exist there). So in Production the guards are: `requireSuperuser` + the Factory fence (P2) + the always-on marker write guard + whatever this plan adds.

| Option | What it is | Cost | Weakness |
|---|---|---|---|
| A. Nothing new | Superuser + fence | 0 | Any superuser session can create a production Request with one click; the daily ack had a deliberate per-day friction. |
| B. Kill switch | `TEST_REQUEST_FACTORY_FORM=on` (literal, **fails closed when unset**, unlike `DATAVERSE_DAL_ENFORCEMENT`); checked at every route entry | one env var, one redeploy | Blanket, like the ack; no per-run intent. |
| C. Typed confirmation bound to the plan | At Confirm the admin re-types the source Request number; the server compares it with the bundle's source number, which the reserved plan already carries as `sourceRequestNumber` (the CLI makes the same comparison, `:904-906`), and refuses a mismatch; `computeRunPlanDigest` is not changed | small, UI + one check | Friction only, not authority; a determined superuser can still create. |
| D. Second-person approval | Another superuser confirms | large | Over-built for a tool one person uses. |

**Recommendation: B + C.** B gives the owner the same off switch the ack gave (and a rollback that needs no deploy); C replaces the ack's "I mean this one" with a per-run intent checked against the reserved plan. Both are cheap. Also: the route must refuse when `requireSuperuser` returns `{ profileId: null }` (the `AUTH_REQUIRED=false` dev path, `auth.js:448-450` [lib/utils]), since the actor is the program director. Rejected: D.

### 2b. Where the source bundle (and manifest) live server-side

Fact [VERIFIED via `source-bundle.js:889` and `run-runner.js:429-431`]: the bundle carries `exportedAt`, `bundleSha256 = sha256(bundle)`, and every advance recomputes the digest and refuses a mismatch against the reserved run. So **re-exporting per step is not possible**: a fresh export has a new digest and fails the ledger match. The manifest also contains the compiled create body (purpose text, `basic-clone-steps.js:663`). Both are private and both must survive from reserve to `verify` (minutes to hours; on the CLI path the owner has resumed a run the next day).

| Option | Cost | Judgement |
|---|---|---|
| A. Private Blob store, dedicated token (`FACTORY_BLOB_RW_TOKEN`; the read/verify pattern of `cycle-dossier-storage.js:8-30` [lib/services]), pathname `test-request-runs/<runId>/{manifest,bundle}.json` minted server-side, size-capped and digest-checked on read, deleted when the run reaches `ready` or is abandoned | owner provisions one store + one token; ~1 service file; tracked-secret entry | **Recommended.** Known pattern; the ledger's no-text contract stays untouched. |
| B. New table in the **ledger** database (not the app DB) | ledger migration 059 + fingerprint/approved-ahead update + owner-run `ledger:apply` on Neon + amendment of the run-ledger no-text contract (`run-ledger.js:10-15`) that went through four Codex rounds | More moving parts; touches a reviewed fence. |
| C. Re-read per step | 0 | Not possible (above) without changing the digest contract. |
| D. Hold in the browser | 0 | Lost on close; defeats Resume. |

Blob invariants (CLAUDE.md): never `INTAKE_BLOB_RW_TOKEN` or `UPLOADS_BLOB_RW_TOKEN`; the client never chooses pathnames. The 6-hour freshness applies at reserve only (CLI `assertBundleFresh` at `:907`); a stored bundle is bound by digest after that. The owner is asked to accept that a bundle bound inside the window may finish a run after it (same as the CLI today). A draft that is never confirmed has no run to delete it: drafts are keyed by `draftId`, treated as expired after the same 6 hours, and swept by the existing maintenance cron (a build detail, not a new scheduler).

### 2c. Serverless limits

Facts [VERIFIED]: one step per `advanceRun` call; basic lease 300 s; `observe` is a 60 s in-function wait (`OBSERVATION_MS`, `basic-clone-steps.js:105`); the first production create POST hit a 30 s client timeout and the next advance recovered the preallocated GUID without a re-POST (production plan item 5); the preview's file policy is `maxFiles 7`, `maxTotalBytes 50 MB` (`admin-preview-service.js:66-68`; the runner's own policy is validated in `file-plan.js:69-94`); `vercel.json` already sets `maxDuration: 300` for several routes.

**Recommendation:** `maxDuration: 300` for the advance route (equal to the lease, so a lost lease and a killed function coincide); exactly one step per POST; the create POST keeps its existing timeout, well under the function limit; `copy_file` already copies one file per advance. The export step (download + hash of up to 50 MB) gets its own route with `maxDuration: 300`; whether that fits a default function memory allocation is in *Facts not verified* below. The hour-later `--run-recheck` becomes a read-only **Recheck** button (no cron, no detached promise, per the design's operation contract); the UI shows "recheck available after <capturedAt + 1 h>". Nothing is scheduled.

### 2d. Ledger reachability from Vercel

Facts: the durable record says the ledger URL is "local `.env.local` on each owner Mac only — never a Vercel variable" (`docs/CREDENTIALS_RUNBOOK.md:92,356`; portability plan D1 and Phase 2 item 2) [VERIFIED]. The form reverses that for **Production (and Preview for the sandbox ledger)** — owner decision 1. The guard already encodes the "never the app database" rule positively (registered host + expected database per target, `ledger-guard.js:43-68` [lib/db]), so it ports unchanged.

**Recommendation:** keep the variable names (`TEST_REQUEST_LEDGER_URL` → `ledger_prod`, `TEST_REQUEST_SANDBOX_LEDGER_URL` → `ledger`) so `LEDGER_VAR_TARGETS` and `expectedLedgerDatabase` apply unchanged. Production gets `TEST_REQUEST_LEDGER_URL` only; Preview gets `TEST_REQUEST_SANDBOX_LEDGER_URL` only. The route derives `target` from `classifyDeployment()` (`lib/dataverse/core/interlock.js:39-41`: production → `production`, anything else → `sandbox`) and then calls `requireLedgerUrl(target)` — the same fail-closed guard the CLI uses, now with the deployment picking the target, so a Preview deployment can never open `ledger_prod` and Production can never open `ledger`. Preview is also structurally unable to write production Dataverse (2a), so a Preview deployment can only ever create **sandbox** clones. But the source step is not free there: `buildSourceBundle` accepts only a registered production host (`source-bundle.js:873-875`), so the form's source export reads production Dataverse even from Preview, and `evaluatePolicy` allows a production read from a non-production deployment only when `DATAVERSE_ALLOW_PROD_READS === 'yes'` (`lib/dataverse/core/interlock.js:346-351`). That is the authorization the owner grants today for the local CLI (memory `feedback-never-self-authorize-prod-dataverse-reads`); extending it to the Preview environment is owner decision 10. The `console.log` in `requireLedgerUrl` (`:52`) prints only the variable name, never the URL, so it is safe in function logs. Rotation: Neon console reset + Vercel env update + both Macs.

Pooler: the registered pooled hostname suits serverless. [ASSUMED] Neon's transaction-mode pooler tolerates a few superuser calls per hour (far below the app DB's load).

### 2e. Isolation-switch server check (replaces P4 attestation)

The route process **is** the serving deployment, so `testRequestIsolationEnabled()` (and `syntheticReviewerIsolationEnabled()`, since every production manifest binds the cast) read at reserve and again inside the advance route before the `create_request` lease is exactly P4's check with no endpoint and no deployment-ID handshake. Cost: a few lines. **Recommendation:** do this; close P4 as superseded.

Receipt: record the serving deployment's ID in the reservation plan. [ASSUMED] `VERCEL_DEPLOYMENT_ID` is present in the function environment; verify at build.

### 2f. Actor identity, program director, idempotency

- **Actor**: `actorId` = the authenticated `profileId` from `requireSuperuser` (never request input). Program director = the session user's email resolved to exactly one enabled `systemuser` via `resolveProgramDirector(client, email)` (`basic-clone-steps.js:545-555`) or the app's `program-director-resolver.js` `resolveByEmail` [lib/services]; a missing or ambiguous match refuses the reservation. The email comes from the server session, not the body.
- **Idempotency**: the browser mints a UUID when the form opens and sends it with Confirm and every retry of Confirm; "Create another" mints a new one. The ledger's reserve-or-return makes a retry return the first run.
- **Deterministic identities**: derive `runId`, `destinationRequestId`, `destinationLocationId` as UUIDv5 over `(actorId, idempotencyKey)` as the ledger header requires, so a lost first response and its retry compute identical GUIDs and `reserveRun` finds the stored row. This is a small change to `buildCloneManifest` (accept supplied ids) that the CLI can keep ignoring.
- **Cast**: reused as the CLI does (`readCast` from the production ledger before manifest build, CLI `:916-926`).

### 2g. Scope of v1

Production manifests already require the cast and set status `Phase II Pending` in the body (`basic-clone-steps.js:60,627-638`), so a v1 clone is the same clone the CLI makes today. Costs are rough session counts.

| Capability | In v1? | Why |
|---|---|---|
| Source lookup by Request number (server-side bundle export) | yes | the ask |
| Confirm → reserve | yes | the ask |
| Advance / Resume (one step per click, auto-continue while `advanced`) | yes | the ask; design says Resume, not "try again" |
| Inspect (run list for this actor, current step, resources, errors) | yes | needed to understand a stop |
| Recheck (read-only Foundation recheck) | yes, small | replaces the owner's hour-later CLI command; ~0.25 |
| Status setter (Phase I/II) in the form | **recommended defer, owner choice** | ~1 session; without it a `Pending` clone opens only by direct link (Workbench/My Proposals filter on `Phase II Pending`, production plan item 5), and the CLI `--set-status` still works |
| Bind reviewer / slot PATCH | defer | B4 operational checks are still incomplete (cast plan status line) |
| Retire | defer | no ledger method, residue semantics open (production plan open question 3) |
| Editable reviewer addresses in the form (P7 bullet) | defer | the cast replaced per-run addresses (owner, S548) |
| Editable program director (P7 bullet) | **drop** | owner decision S546: director = the cloning admin |

**Recommendation:** v1 = lookup + confirm + advance/resume + inspect + recheck, basic recipe only. Estimated 3–4 sessions including review. The status setter is the one deferral with a visible cost; the owner decides (decision 6).

## Route, service and UI sketch

Routes under `pages/api/admin/test-requests/` (all `requireSuperuser`, `withDalContext`, `config.api.bodyParser.sizeLimit: '32kb'`, kill switch checked first):

| Route | Method | Does | Function limit |
|---|---|---|---|
| `runs/source` | POST `{ sourceRequestNumber }` | exports the bundle server-side (read-only production reads), stores it in Blob under a server-minted `draftId`, returns the printable summary (`summarizeSourceBundle`) plus editable cycle defaults | 300 s |
| `runs` | GET | `listRuns({ actorId })` for the signed-in admin | default |
| `runs` | POST `{ draftId, idempotencyKey, confirmSourceRequestNumber, testLabel, fiscalYear?, meetingDate? }` | isolation + cast + director checks, manifest build with UUIDv5 ids, `reserveRun`, manifest stored in Blob | default |
| `runs/[runId]` | GET | `getRun` + `listRunResources` (inspect), redacted exactly as `--run-inspect` | default |
| `runs/[runId]/advance` | POST | loads manifest + bundle from Blob, isolation re-check, one `advanceRun`, returns `{ step, outcome, status }`; error text returned to the caller, never to the ledger | 300 s |
| `runs/[runId]/recheck` | POST | read-only `recheckFoundationTransition` | default |

Service: one new module `lib/services/test-requests/admin-run-service.js` that owns the Dataverse client bound to the deployment's target (`createClient({ resourceUrl: TARGET_URLS[targetFromDeployment()], token, allowTestRequestMarkerWrites: true })`, needs a DAL-gate exemption entry; on a sandbox target the service skips `readCast`, because `buildCloneManifest` refuses a cast off production, `basic-clone-steps.js:642-643`), the Graph object (the same wrapper shape as the CLI's `buildGraphContext`, `:474-500`), the ledger (`pgLedgerDb(requireLedgerUrl(targetFromDeployment()))` + `ledgerSchemaCheck`), and the Blob store. Routes stay thin. `advanceRun`, `reserveRun`, the fence and the steps are called unchanged.

DAL context: no basic-step module asserts a trusted DAL context [VERIFIED by grep over the five basic-step and runner modules]; the IA deps do, and v1 does not reach them.

That the basic steps therefore need no `enterDynamicsBypassForScript` under `withDalContext` is [ASSUMED] until slice 1 exercises it.

UI: a third section in `TestRequestsWorkspace` (`admin.js:3433` [pages]): source number → summary → Confirm (typed re-entry) → progress list of the seven steps with Resume, a run list with Inspect and Recheck. No status, bind or retire controls in v1. Error copy in the owner's voice (memory `feedback-user-facing-error-copy-voice`).

### Route security matrix rows (format of `docs/API_ROUTE_SECURITY_MATRIX.md:120`)

| Route | Methods | Intended Class | Current Guard | Data Scope | Persistence | Risk | Notes |
|---|---|---|---|---|---|---|---|
| `/api/admin/test-requests/runs/source` | POST | Superuser | `requireSuperuser`; `withDalContext`; `TEST_REQUEST_FACTORY_FORM=on` | One bounded Request number; server-derived everything else | Private Blob (dedicated Factory store) write of the bundle; read-only Dataverse/Graph | Medium | Bundle carries source text; Blob path server-minted; 6 h freshness enforced at reserve |
| `/api/admin/test-requests/runs` | GET, POST | Superuser | same + isolation switches `on` + typed source confirmation | Actor = session profile; director = session email → systemuser | Ledger `test_request_runs` row (managed Neon ledger, never the app DB); manifest to Blob | High | Reserve-or-return on `(actorId, idempotencyKey)`; UUIDv5 identities |
| `/api/admin/test-requests/runs/[runId]` | GET | Superuser | same | Run owned by actor | none | Low | Redacted as `--run-inspect` |
| `/api/admin/test-requests/runs/[runId]/advance` | POST | Superuser | same + isolation re-check before `create_request` + production write fence | Run owned by actor | One production Dataverse/Graph write step per call; ledger journal | High | `maxDuration 300` = lease; ambiguous outcomes recovered by exact GUID, never re-POSTed |
| `/api/admin/test-requests/runs/[runId]/recheck` | POST | Superuser | same | Run owned by actor | ledger read; Dataverse read | Low | Read-only Foundation transition recheck |

### Atlas impact

`docs/atlas/postgres-test-request-runs.md`: a second writer (the deployed form) beside the CLI; the header's "shared Production app DB has 054 + 058 tables (empty; never the ledger)" rule stays and gains the Vercel-variable fact. New ownership line for the private Factory Blob store (bundle/manifest lifetime). `docs/CREDENTIALS_RUNBOOK.md:92,356` and the portability plan's Phase 2 item 2 must be amended (the "never a Vercel variable" sentence becomes "Vercel Production/Preview only for the admin form; never a Vercel variable for the CLI"). `lib/utils/tracked-secrets.js` gains the Blob token. The production plan's P4 and P7 entries get a pointer here.

### Gates that will apply

`check:api-routes` (new matrix rows), `check:route-service-boundary`, `check:route-lifecycle-auth`, `check:dataverse-access-layer` (exemption entry), `check:dynamics-context-boundary`, `check:trust-boundary-guid`, `check:request-document-writers` (only if an actor-policy registration changes; not expected for basic), `check:atlas`, `check:doc-currency`, `check:fact-consistency`, `check:docs-catalog`, `check:secret-scan`, `check:factory-ledger`, `check:types`, plus the unit suites under `tests/unit/test-request-*`. Each gate and its self-test run sequentially.

## Slices, build order, verification

| # | Slice | Verification | Est. |
|---|---|---|---|
| 1 | **Server plumbing**: `admin-run-service.js` (target-bound client, graph, ledger via guard, Blob, cast skipped off production), `targetFromDeployment`, kill switch, UUIDv5 ids in `buildCloneManifest`, remove/rename `vercelPostgresLedgerDb` | unit: guard picks `ledger_prod` and the production host only when the deployment is production; Blob pathnames server-minted; manifest ids deterministic; existing CLI tests unchanged | 1 |
| 2 | **Routes + matrix rows**: the six routes above, `vercel.json` entries | route tests (auth, body shape, kill switch off → 503, isolation off → 503, null profile → 403); `check:api-routes` | 1 |
| 3 | **UI** section | component tests; Preview deployment smoke per decision 10: either the full path against the **sandbox** target + `ledger` database (Preview cannot write production: interlock), or, without production reads in Preview, only sign-in, kill switch, ledger guard, list and inspect | 0.5–1 |
| 4 | **Production first run** (owner-run, in the browser): one basic clone from the current seed; Recheck after an hour; owner Audit History read | same P5 contract as the CLI runs; `--run-inspect` from a Mac must show the same row | 0.25 + owner |
| 5 | Durable facts: runbook, Atlas, portability plan, production plan P4/P7, tracked secrets | doc gates | 0.25 |

Codex adversarial review once per slice (production plan *Process*); findings weighed safety vs fidelity (memory `feedback-factory-safe-not-full-fidelity`).

## Release tier and rollback

**Tier 2** (`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:119-131`: Dataverse writes, a new secret, Blob): branch, Preview rehearsal (sandbox target), recorded last-known-good deployment, explicit owner merge. Prerequisites the owner performs. Before slice 3 (Preview): `TEST_REQUEST_FACTORY_FORM=on`, `TEST_REQUEST_SANDBOX_LEDGER_URL`, `FACTORY_BLOB_RW_TOKEN`, and, if decision 10 is yes, `DATAVERSE_ALLOW_PROD_READS=yes`; redeploy the branch. Before slice 4 (Production): `TEST_REQUEST_FACTORY_FORM=on`, `TEST_REQUEST_LEDGER_URL`, `FACTORY_BLOB_RW_TOKEN`; redeploy.

Rollback: set `TEST_REQUEST_FACTORY_FORM` to anything but `on` (every route returns 503, no deploy needed); then revert the merge if required. A run stopped mid-way stays `creating`/`needs_attention` in the ledger; it is resumable from the form after re-enabling, or from the CLI if the owner downloads its manifest and bundle from Blob (a small owner-run helper, deferred unless needed). No schema step: 054 + 058 are already applied to the ledger.

## Owner decisions needed

1. **Put `TEST_REQUEST_LEDGER_URL` into Vercel Production (and `TEST_REQUEST_SANDBOX_LEDGER_URL` into Preview), reversing D1's "never a Vercel variable"?** Recommended: **yes**, those two environments only, same variable names, guard unchanged. Without it there is no form.
2. **Write authority on the server: kill switch `TEST_REQUEST_FACTORY_FORM=on` (fails closed when unset) plus typed re-entry of the source Request number at Confirm, checked against the reserved plan?** Recommended: **yes, both**; no second-person approval.
3. **Bundle and manifest storage: a new dedicated private Blob store with its own token (`FACTORY_BLOB_RW_TOKEN`), files deleted when the run finishes?** Recommended: **yes**. Alternative is a new table in the Neon ledger (more review surface). Also accept that a bundle bound at reserve may finish a run after the 6-hour window, as the CLI does today.
4. **Replace P4's readiness endpoint with the in-process isolation-switch check at reserve and before `create_request`?** Recommended: **yes**; close P4.
5. **v1 scope = source lookup, confirm, advance/resume, inspect, recheck; basic recipe only; program director = the signed-in admin, not editable?** Recommended: **yes**.
6. **Include the Phase I/II status setter in v1 (about one more session), or keep using the CLI `--set-status` until v2?** Recommended: **defer**, accepting that a fresh clone opens only by direct link until its status is moved.
7. **Defer bind-reviewer, slot PATCH and retire to later slices?** Recommended: **yes** (B4 checks incomplete; no ledger retire method).
8. **Release as Tier 2, with the first production run owner-driven from the browser with the P5 recheck?** Recommended: **yes**.
9. **Delete `vercelPostgresLedgerDb` (no callers) so the app database can never be chosen as the ledger by a future caller?** Recommended: **delete**.
10. **Rehearsal venue: set `DATAVERSE_ALLOW_PROD_READS=yes` in the Preview environment so the whole form path (production source read → sandbox clone) rehearses on a Preview deployment before the first production run; or keep Preview without production reads and smoke only sign-in, kill switch, ledger guard, list and inspect, making slice 4 the first create through the form?** Recommended: **set it in Preview for the duration of slice 3 and remove it afterwards**: it reads what the owner already authorizes the local CLI to read, Preview cannot write production, and it is the only way to exercise `create_request` through the form before Production. Caveat: every recorded sandbox clone was created with the GoVerify bypass, which the form never offers, so the Preview rehearsal may stop at `create_request` (see *Facts not verified*); that would still rehearse reserve, fence and resume.

## Facts not verified this session

- Preview deployment's `DYNAMICS_URL` target (assumed sandbox, as the sandbox preview route requires).
- Vercel plan ceiling for `maxDuration` (300 s is already used by several routes, so it is within plan).
- Neon pooler behaviour under serverless connections for the ledger (low volume assumed).
- `VERCEL_DEPLOYMENT_ID` availability in functions.
- Whether `check:dynamics-context-boundary` flags a service that calls the raw client from a route context.
- 50 MB bundle export within default function memory (streaming hashes assumed).
- The per-step wiring of `fenceProductionClient`/`fenceProductionGraph` inside `advanceRun` (import verified; wiring taken from the production plan).
- Whether a sandbox create succeeds without the GoVerify bypass: the design records the bypass on every proven sandbox create (1000338, 1000339 and the bundle rehearsal, `TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md:69`), and no sandbox create without it is recorded. If it fails, the Preview rehearsal stops at `create_request`.
- Whether the Preview environment's Dynamics credentials are valid for a production read (the local CLI reads production with the owner Mac's credentials; Preview's are not inspected here).

## Not in scope

Deeper recipes (IA, reviews, Pre-Site) in the form; email address editing; a scheduler of any kind; changes to the fence, the ledger schema, the cast, or the status-setter contracts.
