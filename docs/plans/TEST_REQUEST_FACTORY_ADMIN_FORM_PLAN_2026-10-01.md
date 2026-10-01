# Test Request Factory: admin form (production plan item P7)

Status: **DRAFT (2026-10-01, Session 561). Owner decisions 1–10 answered in S561 (decision 6 reversed from the draft: the status setter is in v1; decision 10 = option (a)). Codex round 1 (gpt-6-astra, medium): needs-attention, seven findings, all revised below (see *Codex round 1*); round 2 next, then `/contract-reconcile`, before any build. Decision 11 (kill-switch posture) is new and open.** Parent plans: `TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md` (P7, P4, P2, MVP scope, Q1–Q5, *Process*), `TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` (*Operation contract and recovery*), `TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` (cast, status setter, B4), `TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md` (managed ledger, D1–D3). Where this plan and the production plan's owner decisions disagree, the production plan wins until this one is accepted.

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

Fact [VERIFIED via `lib/dataverse/core/interlock.js:163-176,335-338`]: `resolveProdWriteAck` returns null unless `classifyDeployment() === 'local'`; `evaluatePolicy` on a production deployment allows every write to the production target. On Vercel Production the interlock contributes nothing to the Factory. On Vercel Preview it denies a production write only while `DATAVERSE_TARGET_INTERLOCK=on` **and** no `DATAVERSE_REHEARSAL_GRANT` covering the write is set there: `resolveRehearsalGrant` has no local-only check (`interlock.js:188-212` [lib/dataverse/core]) and the grant branch runs for any non-production deployment (`:365-371`); modes `off`/`warn` do not deny (`:77-85`). Both are owner-controlled Preview variables (Codex round 1, finding 6). The form's own guarantee is the one this plan relies on: `targetFromDeployment()` binds the client to the sandbox host off production (2d), so a form write never addresses the production host whatever the interlock mode. So in Production the guards are: `requireSuperuser` + the Factory fence (P2) + the always-on marker write guard + whatever this plan adds.

| Option | What it is | Cost | Weakness |
|---|---|---|---|
| A. Nothing new | Superuser + fence | 0 | Any superuser session can create a production Request with one click; the daily ack had a deliberate per-day friction. |
| B. Kill switch | `TEST_REQUEST_FACTORY_FORM=on` (literal, **fails closed when unset**, unlike `DATAVERSE_DAL_ENFORCEMENT`); checked at every route entry | one env var, one redeploy | Blanket, like the ack; no per-run intent. **Deploy-time, not instant**: a Vercel variable reaches only new deployments (production plan P4, Codex round 1 finding 3), so turning it off needs a redeploy; the instant control is promoting the last-known-good deployment (see *Release tier and rollback*). |
| C. Typed confirmation bound to the plan | At Confirm the admin re-types the source Request number; the server compares it with the bundle's source number, which the reserved plan already carries as `sourceRequestNumber` (the CLI makes the same comparison, `:904-906`), and refuses a mismatch; `computeRunPlanDigest` is not changed | small, UI + one check | Friction only, not authority; a determined superuser can still create. |
| D. Second-person approval | Another superuser confirms | large | Over-built for a tool one person uses. |

**Recommendation: B + C.** B gives the owner an off switch of the same shape as the ack (off at the next deployment; the instant stop is a deployment rollback); C replaces the ack's "I mean this one" with a per-run intent checked against the reserved plan. Both are cheap. Also: the route must refuse when `requireSuperuser` returns `{ profileId: null }` (the `AUTH_REQUIRED=false` dev path, `auth.js:448-450` [lib/utils]), since the actor is the program director; this refusal is on every route, not only Confirm. Rejected: D. A runtime-read control (a `wmkf_appsystemsettings` flag read per request) would make the switch instant, but every other switch in this repo is deploy-time and a one-person tool does not justify the machinery; the recommendation is not to build one (decision 11).

### 2b. Where the source bundle (and manifest) live server-side

Fact [VERIFIED via `source-bundle.js:889` and `run-runner.js:429-431`]: the bundle carries `exportedAt`, `bundleSha256 = sha256(bundle)`, and every advance recomputes the digest and refuses a mismatch against the reserved run. So **re-exporting per step is not possible**: a fresh export has a new digest and fails the ledger match. The manifest also contains the compiled create body (purpose text, `basic-clone-steps.js:663`). Both are private and both must survive from reserve to `verify` (minutes to hours; on the CLI path the owner has resumed a run the next day).

| Option | Cost | Judgement |
|---|---|---|
| A. Private Blob store, dedicated token (`FACTORY_BLOB_RW_TOKEN`; the read/verify pattern of `cycle-dossier-storage.js:8-30` [lib/services]), pathnames minted server-side and bound to the target and actor (`<target>/drafts/<actorId>/<draftId>/bundle.json`; `<target>/runs/<runId>/{manifest,bundle}.json`), size-capped and digest-checked on read; retention rules below | owner provisions one store **per environment** + one token each; ~1 service file; tracked-secret entry | **Recommended.** Known pattern; the ledger's no-text contract stays untouched. |
| B. New table in the **ledger** database (not the app DB) | ledger migration 059 + fingerprint/approved-ahead update + owner-run `ledger:apply` on Neon + amendment of the run-ledger no-text contract (`run-ledger.js:10-15`) that went through four Codex rounds | More moving parts; touches a reviewed fence. |
| C. Re-read per step | 0 | Not possible (above) without changing the digest contract. |
| D. Hold in the browser | 0 | Lost on close; defeats Resume. |

Blob invariants (CLAUDE.md): never `INTAKE_BLOB_RW_TOKEN` or `UPLOADS_BLOB_RW_TOKEN`; the client never chooses pathnames. The 6-hour freshness applies at reserve only (CLI `assertBundleFresh` at `:907`); a stored bundle is bound by digest after that. The owner is asked to accept that a bundle bound inside the window may finish a run after it (same as the CLI today).

**Order at Confirm (Codex round 1, finding 4).** The CLI already writes the manifest before it reserves (CLI `:999-1003`); the form keeps that order. Confirm derives `runId` from `(actorId, idempotencyKey)` (2f), copies the draft bundle to `<target>/runs/<runId>/bundle.json` and writes `manifest.json` beside it, both **create-only** (never overwrite), and only then calls `reserveRun`. A retry with the same key recomputes the same `runId`: if the manifest already exists it is loaded as-is and `buildCloneManifest` is not called again (so the bundle freshness re-check inside it, `basic-clone-steps.js:670-671`, never runs on a retry), and `reserveRun` returns the stored row. Crash points: (1) before the artifacts exist — nothing to recover, Confirm again; (2) artifacts exist, no ledger row — the retry reuses them and reserves; (3) row exists — reserve-or-return. A same-path write whose content differs is a 409 before any reserve; a `plan_digest` conflict (`run-ledger.js:834-838`) never overwrites an artifact.

**Retention (finding 5).** `claimLease` resumes `prepared`, `creating` and `needs_attention` (`run-ledger.js:890`), so run artifacts live for every run in those states and are never deleted by age. They are deleted only after a durable `ready`, by a retryable cleanup that tolerates a missing object. A resumable run whose artifacts are missing is shown as **recovery required** (an explicit state with the run ID and a pointer to the CLI), never a 500 or a re-export. Drafts have no run: they expire after the 6-hour window and are swept in bounded batches by the existing maintenance cron; Confirm copies draft → run artifacts first, so a swept draft fails Confirm cleanly ("re-export the source"). A minimal authenticated download of a run's manifest and bundle (`runs/[runId]/artifacts`, superuser, owner) ships in v1 as the CLI fallback, because rollback depends on it.

### 2c. Serverless limits

Facts [VERIFIED]: one step per `advanceRun` call; basic lease 300 s; `observe` is a 60 s in-function wait (`OBSERVATION_MS`, `basic-clone-steps.js:105`); the first production create POST hit a 30 s client timeout and the next advance recovered the preallocated GUID without a re-POST (production plan item 5); the preview's file policy is `maxFiles 7`, `maxTotalBytes 50 MB` (`admin-preview-service.js:66-68`; the runner's own policy is validated in `file-plan.js:69-94`); `vercel.json` already sets `maxDuration: 300` for several routes.

**Recommendation:** `maxDuration: 300` for the advance route; exactly one step per POST; the create POST keeps its existing timeout, well under the function limit; `copy_file` already copies one file per advance. The lease is claimed after the manifest and digest checks (`run-runner.js:4196-4208`), so it expires within `leaseSeconds` of the claim, a few seconds after a killed function at most; nothing starts a second lease while the first is live. Every route computes a **deadline at entry** (function limit minus a margin), bounds its upstream waits by it, and closes its `pgLedgerDb` pool in `finally` (`run-ledger-db.js:102-104`) (Codex round 1, finding 7). The export route (`maxDuration: 300`) hashes one file at a time from a buffer under the 25 MB per-file cap (`admin-preview-service.js:67,361-386`), so peak memory is one file, not the 50 MB total. The hour-later `--run-recheck` becomes a read-only **Recheck** button (no cron, no detached promise, per the design's operation contract); the UI shows "recheck available after <capturedAt + 1 h>". Nothing is scheduled.

### 2d. Ledger reachability from Vercel

Facts: the durable record says the ledger URL is "local `.env.local` on each owner Mac only — never a Vercel variable" (`docs/CREDENTIALS_RUNBOOK.md:92,356`; portability plan D1 and Phase 2 item 2) [VERIFIED]. The form reverses that for **Production (and Preview for the sandbox ledger)** — owner decision 1. The guard already encodes the "never the app database" rule positively (registered host + expected database per target, `ledger-guard.js:43-68` [lib/db]), so it ports unchanged.

**Recommendation:** keep the variable names (`TEST_REQUEST_LEDGER_URL` → `ledger_prod`, `TEST_REQUEST_SANDBOX_LEDGER_URL` → `ledger`) so `LEDGER_VAR_TARGETS` and `expectedLedgerDatabase` apply unchanged. Production gets `TEST_REQUEST_LEDGER_URL` only; Preview gets `TEST_REQUEST_SANDBOX_LEDGER_URL` only. The route derives `target` from `classifyDeployment()` (`lib/dataverse/core/interlock.js:39-41`: production → `production`, anything else → `sandbox`) and then calls `requireLedgerUrl(target)` — the same fail-closed guard the CLI uses, now with the deployment picking the target, so a Preview deployment can never open `ledger_prod` and Production can never open `ledger`. Because the client is bound the same way, a Preview deployment can only ever address the **sandbox** host (its interlock posture is the secondary guard, 2a). Each environment gets its own Blob store and ledger credential, each limited to that environment's target (`ledger_prod` and the production store only in Production; `ledger` and a separate store in Preview); the variable names are shared, the values are environment-scoped. But the source step is not free there: `buildSourceBundle` accepts only a registered production host (`source-bundle.js:873-875`), so the form's source export reads production Dataverse even from Preview, and `evaluatePolicy` allows a production read from a non-production deployment only when `DATAVERSE_ALLOW_PROD_READS === 'yes'` (`lib/dataverse/core/interlock.js:346-351`). That is the authorization the owner grants today for the local CLI (memory `feedback-never-self-authorize-prod-dataverse-reads`); extending it to the Preview environment is owner decision 10. The `console.log` in `requireLedgerUrl` (`:52`) prints only the variable name, never the URL, so it is safe in function logs. Rotation: Neon console reset + Vercel env update + both Macs.

Pooler: the registered pooled hostname suits serverless. [ASSUMED] Neon's transaction-mode pooler tolerates a few superuser calls per hour (far below the app DB's load).

### 2e. Isolation-switch server check (replaces P4 attestation)

The route process **is** the serving deployment, so `testRequestIsolationEnabled()` (and `syntheticReviewerIsolationEnabled()`, since every production manifest binds the cast) read at reserve and again inside the advance route before the `create_request` lease is exactly P4's check with no endpoint and no deployment-ID handshake. Cost: a few lines. **Recommendation:** do this; close P4 as superseded.

Receipt: record the serving deployment's ID in the reservation plan. [ASSUMED] `VERCEL_DEPLOYMENT_ID` is present in the function environment; verify at build.

### 2f. Actor identity, program director, idempotency

- **Actor (Codex round 1, finding 1)**: `profileId` is a number (`auth.js:206-216` [lib/utils]) and the ledger accepts only `admin:<uuid>`, `user:<uuid>` or `cli:<16 hex>` (`run-ledger.js:390`; migration `054_test_request_runs.sql:151-153`), so the form derives one server-side actor, `admin:<UUIDv5(FACTORY_NAMESPACE, 'profile:' + profileId)>`, and uses it everywhere: `reserveRun`, `listRuns`, ownership on every `[runId]` route, the draft Blob path, and the deterministic ids. Never from request input; a null profile is refused on every route. Program director = the session user's email resolved to exactly one enabled `systemuser` via `resolveProgramDirector(client, email)` (`basic-clone-steps.js:545-555`) or the app's `program-director-resolver.js` `resolveByEmail` [lib/services]; a missing or ambiguous match refuses the reservation. The email comes from the server session, not the body.
- **Idempotency**: the browser mints a UUID when the form opens and sends it with Confirm and every retry of Confirm; "Create another" mints a new one. The ledger's reserve-or-return makes a retry return the first run.
- **Deterministic identities**: derive `runId`, `destinationRequestId`, `destinationLocationId` as UUIDv5 over `(actorId, idempotencyKey, label)` with the distinct labels `run`, `request`, `location`, as the ledger header requires, so a lost first response and its retry compute identical GUIDs and `reserveRun` finds the stored row. This is a small change to `buildCloneManifest` (accept supplied ids) that the CLI can keep ignoring.
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
| Status setter (Phase I/II) in the form | **yes (owner, S561, decision 6)** | ~1 session; without it a `Pending` clone opens only by direct link (Workbench/My Proposals filter on `Phase II Pending`, production plan item 5), so the form would not replace the CLI. Reuses `runStatusChange` / `recheckStatusChange` (`status-change-runner.js:200,243`) unchanged; see *Status setter in the form* below |
| Bind reviewer / slot PATCH | defer | B4 operational checks are still incomplete (cast plan status line) |
| Retire | defer | no ledger method, residue semantics open (production plan open question 3) |
| Editable reviewer addresses in the form (P7 bullet) | defer | the cast replaced per-run addresses (owner, S548) |
| Editable program director (P7 bullet) | **drop** | owner decision S546: director = the cloning admin |

**Decided (owner, S561):** v1 = lookup + confirm + advance/resume + inspect + recheck + artifacts download + Phase I/II status setter (with its recheck), basic recipe only. Estimated 5–6 sessions including review (Codex round 1 added the actor encoding, artifact ordering/retention, the status compare-and-set and the budget tests).

### Status setter in the form

Facts [VERIFIED via `status-change-runner.js:20,29,167-174,200-241,243-275`]:
- `runStatusChange` plans one change in the ledger (`planStatusChange`), dispatches one `If-Match` PATCH, then waits for the Request's background jobs. `COMPLETION_DEFAULTS` = poll 20 s, `maxWaitMs` 10 min, `minQuietMs` 90 s.
- The 10-minute wait exceeds a 300 s function. A wait that times out leaves the change `applied` (an open state). It throws `status_change_jobs_open`, and a repeat call with the same field and option resumes at completion without re-sending (`:170-173`, `:208-229`).
- `recheckStatusChange` is **not purely read-only**: when it finds late effects it writes them to the ledger journal (`recordLateStatusChangeEffects`, `:258-266`). The ledger is the only thing it writes; Dataverse is read only.
- Replay guard `assertNotDuplicateProducing` (`status-transitions.js:113`) and the live option list (`readLiveOptions`, `status-change-runner.js:59`) apply as on the CLI.

Concurrency fact [VERIFIED via `run-ledger.js:1230-1232,1252-1258`; `status-change-runner.js:86-92,200-233`]: the status journal has no lease ("the CLI is owner-run"); the one-open-change index (`054_test_request_runs.sql:400`) stops a second *different* change but not a second caller of the *same* open change. `markStatusChangeDispatched` accepts a change that is already `dispatched`, `dispatch()` ignores its return, and the resume path re-dispatches a `dispatched` change whose PATCH did not land. Two tabs, or the form plus the CLI, can therefore both PATCH with the same ETag; the loser's 412 marks the shared change `needs_attention` although the winner's write landed (Codex round 1, finding 2).

Fix (both callers inherit it; no schema change): `markStatusChangeDispatched` becomes a compare-and-set on the state the caller read (`planned` → `dispatched`; or `dispatched` with the `dispatched_at` the caller read → a new `dispatched_at`), and `dispatch()` checks its return: `null` means another caller holds the change, so it re-reads the Request and resumes without a PATCH. `markStatusChangeApplied` / `markStatusChangeNeedsAttention` results are checked the same way. An overlap test asserts one PATCH across two concurrent callers of the same change. This changes `status-change-runner.js` and one ledger method, which *Not in scope* now says.

Plan:
- The form calls `runStatusChange` with `completion.maxWaitMs` derived from the route-entry deadline (function limit minus the time already spent and a margin), not a fixed 240 s: `awaitJobs` sets its own deadline only after the PATCH and the first jobs read (`status-change-runner.js:131-134`), and the census after the wait is outside it too.
- `status_change_jobs_open` is shown as "Still finishing — Check again". Check again repeats the same call, which resumes and never re-sends.
- The field and option come from a server-read live option list. The browser sends only `field` (`phase1|phase2`) and the option label, which is validated against that list server-side. `rerun` is not offered in v1.
- The kill switch, the superuser gate and run ownership apply. A status change is a production write, so it runs under the same switch as create.
- It cannot be rehearsed end to end on Preview: `assertChangeable` refuses any run that is not a production run (`status-change-runner.js:76`), and so does `verify`. Preview exercises only its refusals; slice 4 is its first run through the form.

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
| `runs/[runId]/artifacts` | GET | the run's stored manifest and bundle for the owner (CLI fallback); refused unless the run belongs to the actor | default |
| `runs/[runId]/status` | GET | live Phase I/II option lists (`readLiveOptions`) + the run's status-change journal (`listStatusChanges`) | default |
| `runs/[runId]/status` | POST `{ field: 'phase1'\|'phase2', optionLabel }` | one `runStatusChange` with `maxWaitMs` from the route-entry deadline; `status_change_jobs_open` returned as a resumable state | 300 s |
| `runs/[runId]/status/recheck` | POST | `recheckStatusChange` (Dataverse read; may append late effects to the ledger journal) | default |

Service: one new module `lib/services/test-requests/admin-run-service.js` that owns the Dataverse client bound to the deployment's target (`createClient({ resourceUrl: TARGET_URLS[targetFromDeployment()], token, allowTestRequestMarkerWrites: true })`, needs a DAL-gate exemption entry; on a sandbox target the service skips `readCast`, because `buildCloneManifest` refuses a cast off production, `basic-clone-steps.js:642-643`), the Graph object (the same wrapper shape as the CLI's `buildGraphContext`, `:474-500`), the ledger (`pgLedgerDb(requireLedgerUrl(targetFromDeployment()))` + `ledgerSchemaCheck`), and the Blob store. Routes stay thin. `advanceRun`, `reserveRun`, the fence and the steps are called unchanged.

DAL context: no basic-step module asserts a trusted DAL context [VERIFIED by grep over the five basic-step and runner modules]; the IA deps do, and v1 does not reach them.

That the basic steps therefore need no `enterDynamicsBypassForScript` under `withDalContext` is [ASSUMED] until slice 1 exercises it.

UI: a third section in `TestRequestsWorkspace` (`admin.js:3433` [pages]): source number → summary → Confirm (typed re-entry) → progress list of the seven steps with Resume, a run list with Inspect and Recheck, and on a `ready` run a Phase I/II status control with Check again and its recheck. No bind or retire controls in v1. Error copy in the owner's voice (memory `feedback-user-facing-error-copy-voice`).

### Route security matrix rows (format of `docs/API_ROUTE_SECURITY_MATRIX.md:120`)

| Route | Methods | Intended Class | Current Guard | Data Scope | Persistence | Risk | Notes |
|---|---|---|---|---|---|---|---|
| `/api/admin/test-requests/runs/source` | POST | Superuser | `requireSuperuser`; `withDalContext`; `TEST_REQUEST_FACTORY_FORM=on` | One bounded Request number; server-derived everything else | Private Blob (dedicated Factory store) write of the bundle; read-only Dataverse/Graph | Medium | Bundle carries source text; Blob path server-minted; 6 h freshness enforced at reserve |
| `/api/admin/test-requests/runs` | GET, POST | Superuser | same + isolation switches `on` + typed source confirmation | Actor = `admin:<UUIDv5 of the session profile>`; director = session email → systemuser | Manifest and bundle to Blob (create-only) **before** the ledger `test_request_runs` row (managed Neon ledger, never the app DB) | High | Reserve-or-return on `(actorId, idempotencyKey)`; labelled UUIDv5 identities; same-key retry reuses stored artifacts |
| `/api/admin/test-requests/runs/[runId]` | GET | Superuser | same | Run owned by actor | none | Low | Redacted as `--run-inspect` |
| `/api/admin/test-requests/runs/[runId]/advance` | POST | Superuser | same + isolation re-check before `create_request` + production write fence | Run owned by actor | One production Dataverse/Graph write step per call; ledger journal | High | `maxDuration 300`, lease 300 s claimed after the manifest checks; route-entry deadline; ambiguous outcomes recovered by exact GUID, never re-POSTed; missing artifacts → recovery required, not a retry |
| `/api/admin/test-requests/runs/[runId]/recheck` | POST | Superuser | same | Run owned by actor | ledger read; Dataverse read | Low | Read-only Foundation transition recheck |
| `/api/admin/test-requests/runs/[runId]/artifacts` | GET | Superuser | same | Run owned by actor | Blob read (private Factory store) | Medium | Returns source text (manifest create body, bundle); CLI fallback for rollback; no write |
| `/api/admin/test-requests/runs/[runId]/status` | GET, POST | Superuser | same; option label validated against the server-read live list | Run owned by actor; `ready` production run only (`assertChangeable`) | POST: one `If-Match` PATCH of `wmkf_phaseistatus`/`wmkf_phaseiistatus` on the test Request; ledger status-change journal | High | Resume, not re-send, on `status_change_jobs_open`; replay guard unchanged; no `rerun` in v1 |
| `/api/admin/test-requests/runs/[runId]/status/recheck` | POST | Superuser | same | Run owned by actor | Dataverse read; ledger journal append of late effects only | Low | Not purely read-only (ledger) |

### Atlas impact

`docs/atlas/postgres-test-request-runs.md`: a second writer (the deployed form) beside the CLI; the header's "shared Production app DB has 054 + 058 tables (empty; never the ledger)" rule stays and gains the Vercel-variable fact. New ownership line for the private Factory Blob store (bundle/manifest lifetime). `docs/CREDENTIALS_RUNBOOK.md:92,356` and the portability plan's Phase 2 item 2 must be amended (the "never a Vercel variable" sentence becomes "Vercel Production/Preview only for the admin form; never a Vercel variable for the CLI"). `lib/utils/tracked-secrets.js` gains the Blob token. The production plan's P4 and P7 entries get a pointer here.

### Gates that will apply

`check:api-routes` (new matrix rows), `check:route-service-boundary`, `check:route-lifecycle-auth`, `check:dataverse-access-layer` (exemption entry), `check:dynamics-context-boundary`, `check:trust-boundary-guid`, `check:request-document-writers` (only if an actor-policy registration changes; not expected for basic), `check:atlas`, `check:doc-currency`, `check:fact-consistency`, `check:docs-catalog`, `check:secret-scan`, `check:factory-ledger`, `check:types`, plus the unit suites under `tests/unit/test-request-*`. Each gate and its self-test run sequentially.

## Slices, build order, verification

| # | Slice | Verification | Est. |
|---|---|---|---|
| 1 | **Server plumbing**: `admin-run-service.js` (target-bound client, graph, ledger via guard, Blob, cast skipped off production), `targetFromDeployment`, actor derivation, kill switch, labelled UUIDv5 ids in `buildCloneManifest`, artifacts-before-reserve, retention rules, remove/rename `vercelPostgresLedgerDb` | unit: guard picks `ledger_prod` and the production host only when the deployment is production; a manifest whose target mismatches the deployment is refused; interlock modes `off`/`warn`/`on` and a rehearsal grant never change the host the form addresses; Blob pathnames server-minted and actor/target-bound; create-only artifact writes, same-key retry reuses them; three ids differ; pools closed in `finally`; existing CLI tests unchanged | 1.5 |
| 2 | **Routes + matrix rows**: the seven create/inspect routes above, `vercel.json` entries | route tests (auth, body shape, kill switch off → 503, isolation off → 503, null profile → 403 on every route, other actor's run → 404); worst-case export (7 files, 25 MB each) within the deadline; killed-call recovery (artifacts present, no row → retry reserves); `check:api-routes` | 1 |
| 2b | **Status setter**: compare-and-set dispatch in `status-change-runner.js` + one ledger method, then `runs/[runId]/status` GET/POST and `status/recheck` | overlap test: two concurrent callers of the same open change → one PATCH; CLI status tests unchanged; route tests: option label outside the live list refused; non-`ready` or non-owned run refused; `status_change_jobs_open` → resumable response, second call does not re-PATCH; deadline-derived `maxWaitMs`; `vercel.json` 300 s entry | 1.5 |
| 3 | **UI** section (includes the status control and Check again) | component tests; Preview rehearsal per decision 10(a): the full create path against the **sandbox** target + `ledger` database on this branch's Preview deployments, plus the status setter's refusal; the branch-scoped `DATAVERSE_ALLOW_PROD_READS` is removed when the slice closes | 0.5–1 |
| 4 | **Production first run** (owner-run, in the browser): one basic clone from the current seed; one Phase II status change through the form (as S547's first CLI change) and its recheck; Foundation Recheck after an hour; owner Audit History read | same P5 contract as the CLI runs; `--run-inspect` from a Mac must show the same row | 0.25 + owner |
| 5 | Durable facts: runbook, Atlas, portability plan, production plan P4/P7, tracked secrets | doc gates | 0.25 |

Codex adversarial review once per slice (production plan *Process*); findings weighed safety vs fidelity (memory `feedback-factory-safe-not-full-fidelity`).

## Release tier and rollback

**Tier 2** (`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:119-131`: Dataverse writes, a new secret, Blob): branch, Preview rehearsal (sandbox target), recorded last-known-good deployment, explicit owner merge. Prerequisites the owner performs. Before slice 3 (Preview, this branch only): `TEST_REQUEST_FACTORY_FORM=on`, `TEST_REQUEST_SANDBOX_LEDGER_URL`, `FACTORY_BLOB_RW_TOKEN` (the Preview store), and `DATAVERSE_ALLOW_PROD_READS=yes` scoped to this branch's Preview deployments (decision 10); redeploy the branch; remove the read variable when slice 3 closes. Before slice 4 (Production): `TEST_REQUEST_FACTORY_FORM=on`, `TEST_REQUEST_LEDGER_URL`, `FACTORY_BLOB_RW_TOKEN` (the Production store); redeploy.

Rollback (Codex round 1, finding 3): the **instant** stop is promoting the recorded last-known-good deployment in Vercel (no build; a Tier 2 requirement already). Setting `TEST_REQUEST_FACTORY_FORM` off is the durable stop and takes effect at the next deployment, so it is paired with a redeploy or with that promotion. Deployment-URL aliases of the old build keep its baked-in `on` but still require a superuser session, and are retired with the deployment. An in-flight step finishes under its lease and fence; nothing new starts. A run stopped mid-way stays `creating`/`needs_attention` in the ledger; it is resumable from the form after re-enabling, or from the CLI after `runs/[runId]/artifacts` hands the owner its manifest and bundle. No schema step: 054 + 058 are already applied to the ledger.

## Owner decisions

Answered by the owner in S561 (2026-10-01):

1. **Ledger URL in Vercel**: yes. `TEST_REQUEST_LEDGER_URL` in Production and `TEST_REQUEST_SANDBOX_LEDGER_URL` in Preview only, same names, guard unchanged. This reverses D1's "never a Vercel variable" for the form only.
2. **Write authority on the server**: yes, both. Kill switch `TEST_REQUEST_FACTORY_FORM=on` (fails closed when unset) plus typed re-entry of the source Request number at Confirm. No second-person approval.
3. **Bundle and manifest storage**: yes. A dedicated private Blob store with its own token (`FACTORY_BLOB_RW_TOKEN`), files deleted when the run finishes. Accepted: a bundle bound at reserve may finish a run after the 6-hour window, as the CLI does today.
4. **P4**: replaced by the in-process isolation-switch check at reserve and before `create_request`; P4 closed.
5. **v1 scope**: source lookup, confirm, advance/resume, inspect, recheck; basic recipe only; program director = the signed-in admin, not editable.
6. **Status setter**: **in v1** (reversing the draft's recommendation). See *Status setter in the form*.
7. **Deferred**: bind-reviewer, slot PATCH and retire.
8. **Release**: Tier 2; the first production run is owner-driven from the browser, with the P5 recheck.
9. **`vercelPostgresLedgerDb`**: delete.
10. **Rehearsal venue: option (a)** (owner, S561). A full Preview rehearsal with `DATAVERSE_ALLOW_PROD_READS=yes` scoped to **this branch's** Preview deployments only, as a Vercel branch-specific Preview variable, removed after slice 3. The whole create path (production source read → sandbox clone) rehearses on Preview; the status setter cannot (it refuses non-production runs, `status-change-runner.js:76`) and is first run through the form in slice 4. Caveat kept: every recorded sandbox create used the GoVerify bypass, which the form never offers, so the rehearsal may stop at `create_request` and would still rehearse reserve, fence and resume.
    - The branch-scoping of a Vercel Preview variable is the owner's statement of the platform mechanism; it was not checked here (UNVERIFIED by the author; memory `feedback-verify-external-platform-claims`).

Still open:

11. **Kill-switch posture (new, from Codex round 1 finding 3).** `TEST_REQUEST_FACTORY_FORM` is a deploy-time gate; the instant stop is a Vercel deployment rollback. Options: accept that posture (recommended: every other switch in this repo is deploy-time, and the tool has one user), or add a runtime-read control (an app-system-settings flag read on every Factory route; about half a session, one more setting to keep right). Recommended: **accept the deploy-time posture**.

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
- Whether a Vercel Preview variable can be scoped to one branch's deployments (owner-stated; decision 10).
- How far a killed function's lease outlives it: the lease is claimed after the manifest checks and lasts `leaseSeconds`; the overlap with the next call is bounded, not measured.
- The Preview environment's current `DATAVERSE_TARGET_INTERLOCK` mode and whether a `DATAVERSE_REHEARSAL_GRANT` is set there (names were listed for Production only).

## Codex round 1 (2026-10-01, S561; gpt-6-astra, medium; needs-attention)

Seven findings; Claude verified 1, 2 and 6 against source, the author re-verified every cited line. Each is answered by the smallest change: (1) actor encoding → 2f; (2) status concurrency → *Status setter in the form*, compare-and-set dispatch, overlap test; (3) kill switch not instant → 2a, *Release tier and rollback*, decision 11; (4) reserve/Blob not atomic → 2b *Order at Confirm*; (5) cleanup and fallback → 2b *Retention*, `runs/[runId]/artifacts`; (6) Preview isolation overstated → 2a, 2d, slice 1 tests; (7) time budgets and connections → 2c, status `maxWaitMs`, slice 2/2b tests. Confirmed and kept: every production basic step is fenced (`run-runner.js:4211-4234`), basic advance concurrency is lease-safe, a status PATCH→ledger crash does not resend, `withDalContext` fits. Memory `feedback-reviewer-differs-from-author` rule 3: the fixes narrow claims or make one existing update a compare-and-set; no new table, scheduler or lease mechanism was added.

## Not in scope

Deeper recipes (IA, reviews, Pre-Site) in the form; email address editing; a scheduler of any kind; changes to the fence, the ledger schema, or the cast. The status-setter contract is **not** unchanged: `status-change-runner.js` `dispatch()` and the ledger's `markStatusChangeDispatched` become compare-and-set (Codex round 1, finding 2); everything else in the status setter stays as the CLI uses it.
