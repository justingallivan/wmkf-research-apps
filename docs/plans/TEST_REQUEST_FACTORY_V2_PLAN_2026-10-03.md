---
title: Test Request Factory v2 recovery and operations plan
domain: test-request-factory
kind: plan
status: draft
summary: "Read-only diagnosis shipped in #426; status-outcome explanation shipped in #427; fresh-run file recovery is now authorized for implementation; expired runs require a new run. Retain Request 1003308."
canonical: false
cataloged: 2026-10-03
owner: product-engineering
related:
  - docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md
  - docs/atlas/postgres-test-request-runs.md
  - docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md
  - docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md
---

# Test Request Factory v2: recovery and operations

**Status: FIRST READ-ONLY DIAGNOSIS SLICE SHIPPED IN #426.** [VERIFIED via GitHub] The owner authorized merge `31a432de5`; [OWNER-REPORTED] deployment was clean. [VERIFIED via GitHub] The subsequent status-outcome explanation merged in #427 as `025749f4d`; [OWNER-REPORTED] it is in Production. The owner subsequently authorized finishing fresh-run file recovery, while retaining the six-hour cutoff. Retirement, cleanup and data deletion remain outside this work. Request 1003308 remains retained and out of bounds for mutation rehearsal.

This plan supersedes the earlier draft of the same pathname on branch `codex/open-items-followup`. If that branch or PR #423 is integrated later, resolve the same-path overlap by keeping this plan as the current v2 plan; do not retain two competing versions or undo the decision to preserve Request 1003308.

## Current Factory contract and evidence

- **[VERIFIED via read-only Production `--run-inspect`, 2026-10-03]** Run `20407283-c279-5e0c-b396-210ad6842482` remains `needs_attention` at `copy_file`, recipe `basic`, step index 4, reason `file_journal_unverified`. It targets test Request 1003308, cloned from source 1002860. The ledger last changed at `2026-10-02T18:28:33.383Z`; no lease is held. Two file resources are `verified`; the third, an XLSX, is `failed`. Its receipt includes a destination item identity and upload-attempt timestamp but no verified readback receipt. This was a ledger-only read. No Dataverse or SharePoint read/write was made for this plan, and unnecessary resource identifiers are omitted.
- **[VERIFIED via source]** Admin API routes require a superuser and pass the authenticated profile to `admin-run-service.js`; the run service limits inspection/actions to the actor who reserved the run. The form currently creates `basic` runs. Confirm reserves only; each Advance calls the shared runner for one bounded step. List and inspect are read-only. `TEST_REQUEST_FACTORY_FORM` gates writable form actions.
- **[VERIFIED via `run-ledger.js`]** `claimLease` compares the expected run version, admits only `prepared`, `creating`, and `needs_attention`, and requires a clear/expired lease. It increments the generation. Subsequent run/resource writes are fenced by lease token, generation, version and database-clock expiry. `markNeedsAttention` stores the reason code and releases the lease in one fenced update; `needs_attention` can be claimed again. A lease expiry does not prove a prior remote operation ended or failed.
- **[VERIFIED via `run-runner.js:927-965`]** When the next file journal row has an item ID without a verified receipt, the Basic runner refuses with `file_journal_unverified`. If upload was attempted without a journaled item ID, it refuses with `file_ambiguous_unrecovered`. Neither path sends a second PUT. So another ordinary Advance cannot repair the failed 1003308 XLSX.
- **[VERIFIED via `bundle-file-copy.js`]** File upload is create-only and journaled before dispatch. Ambiguous upload results are checked by exact destination path; successful copy readback uses exact hash for supported MIME types or package attestation for DOCX/XLSX. A journaled item ID proves only which item to inspect, not that its content is correct. Source metadata and bytes are rechecked before a normal copy.
- **[VERIFIED via source and CLI dispatch]** The form exposes status options, one journaled conditional PATCH per change, and status recheck. The owner-run CLI also has status recheck/`--status-abandon`, status `--rerun`, cast creation, reviewer binding, and reviewer-slot binding. Status abandon only closes a dispatched status-change journal; it neither abandons a Factory run nor proves no sender is still running. Reviewer-slot binding has a separate exact-Request confirmation. No general run abandon/reset or retirement command exists in the CLI dispatch.
- **[VERIFIED via Atlas/source]** Managed Postgres owns run/resource/status receipts; private Factory Blob holds the saved bundle/manifest; Dataverse owns Request records; SharePoint owns document bytes. Maintenance keeps artifacts for `needs_attention` runs and deletes completed-run artifacts only for `ready`. It does not turn an ambiguous resource into a safe retry.
- **[VERIFIED via PR #425 and owner-provided receipt, 2026-10-03]** Applicant abstract bundle v5 is deployed to Ready Production deployment `dpl_Ac2a21TX57PXgTcMJ57FSCrTJpKF`; the new-clone live path has not been smoked. Separately, an owner-authorized one-field repair of Request 1003303 returned HTTP 204 and exact readback matched the pinned 2,476-character source (`docs/plans/evidence/FACTORY_AND_EMAIL_REPAIR_CHECKPOINT_2026-10-03.json`). This does not authorize or imply a repair to Request 1003308.

## Recovery policy

The shipped first slice adds a **read-only, server-derived diagnosis** using the owned run row and recorded resource receipts only. It does not read private artifacts or live external systems. The newly authorized local recovery extension reads the authoritative run row, typed resource journal, saved artifacts and their digest/freshness, lease state and exact live file evidence. Its implementation and release evidence are tracked below; the shipped web diagnosis remains ledger-only. It must not call the current status-recheck operation: that operation may write late-effect ledger data for already complete or needs_attention changes, so it is not read-only; it does not change dispatched status. The client cannot choose a run status, destination, item ID, write-attempt flag, or recovery decision. The response should state the stopped step, evidence present/missing and one disposition: **retry under existing runner**, **wait/re-inspect**, **readback verification may be evaluated**, **start a new run**, or **blocked for operator investigation**. Unknown state stays blocked. Return finite safe reason copy and identifiers already needed by the owner; never return bundle contents, purpose/abstract text, bearer links, recipient addresses or raw upstream error text.

| State evidence | Existing behavior | V2 disposition |
|---|---|---|
| No dispatch marker | Existing retry can re-run after preconditions are checked. | Preserve existing retry path and explain why it is allowed. |
| Dispatch marker but no recoverable exact identity | Existing create/location/upload paths refuse a blind second POST/PUT. | Show ambiguous outcome; inspect exact reserved identity/path; no retry button. |
| Item identity journaled but no verified receipt | `file_journal_unverified` prevents re-upload. | At most offer read-only exact-item verification eligibility; existence, filename or size alone never proves success. |
| Status change remains `dispatched` | The existing recheck leaves `dispatched` status unchanged. It writes late-effect ledger data only for changes already `complete` or `needs_attention`. | Diagnosis only reports the stored state. Keep the existing effectful recheck separate; do not close while a sender may still run. |
| Lease remains live | A worker may still own the run. | Wait/re-inspect. Expiry alone is not proof a remote request stopped. |
| Missing/stale/digest-mismatched artifacts or unknown receipt | Existing checks refuse the step. | Block continuation; require a fresh lookup/new run when original pinned evidence is unavailable. |

### Readback-only file recovery candidate

**[AUTHORIZED BUILD; live proof unperformed.]** The earlier offline experiment established content-integrity feasibility only. The current implementation uses real Graph response shapes and retains the original six-hour source-bundle limit. It diagnoses expired evidence and requires a new run; there is no stale-tolerant continuation or freshness renewal. Request 1003308 remains retained and excluded from mutation rehearsal.

A fresh candidate must pass exact Request ownership, saved manifest/bundle/policy pins, source metadata/hash, destination stable-ID/path metadata, complete bounded inventory, and exact-hash or package attestation. Recovery must repeat these reads under the current run lease, retain the full private operator receipt, and atomically compare the original run/resource snapshots before changing one receipt. It returns to the same copy step, preserves dispatch history, and leaves later files and terminal verification to the ordinary runner. The implementation contract below governs this work; offline or prior inspection results do not authorize a receipt write.

## Additional operations and recommended order

1. **Read-only stopped-run explanation — shipped in #426.** The existing inspect response derives Basic-run guidance from ledger state, using the existing bundle freshness helper. It preserves superuser authentication and actor ownership, makes no write or remote read, and requires no migration. Unknown or unresolved dispatch evidence blocks Basic continuation; supported transient/no-dispatch cases retain retry. Other known recipes are not assessed and retain their existing controls after successful inspection; missing or failed inspection disables Advance until refreshed.
2. **Clear status-change outcomes — shipped in #427.** The form improves explanation of the form's existing status recheck: it reports the current outcome and leaves dispatched changes dispatched; for already complete or needs_attention changes it can write newly observed late-effect ledger data. Keep this operation separate from read-only stopped-run diagnosis. Keep `--status-abandon` CLI-only while no web-safe proof establishes every sender has stopped, including suspended invocations. Recheck journals late payment/tracking/email effects only for changes already complete or `needs_attention`; keep duplicate-producing transitions blocked.
3. **Fresh-run readback recovery — implementation authorized; live portion unperformed.** The full candidate scope must cover exact-hash and package paths, exact-ID lookup, source/item missing, duplicates, metadata/version/policy drift, incomplete receipts, ambiguous responses, concurrent claims, lease expiry and stale-worker fencing. This proof performs no write to a retained Production run. The accepted fresh-run contract below permits a typed receipt transition; release and live operational evidence remain separate.
4. **Separate higher-effect actions.** Keep status `--rerun`, cast creation/reviewer binding, and reviewer-slot PATCH as one operation per separately reviewed release. Each needs a target/effect preview, current actor/target/marker check, explicit confirmation, journal-before-dispatch, exact-ID ambiguity recovery and readback. Existing CLI support does not by itself authorize exposing the action through the form.
5. **Retirement as a separate plan.** Decide first whether operators need a display disposition, a terminal run state, or actual resource retirement. Inventory all status readers, constraints, CLI, artifacts/sweeps, privacy and references before changing schema. Retain tombstones and evidence; touch only individually proven run-owned resources and report residue. Age alone must never trigger cascade deletion. No retention change belongs to this plan.

Keep v2 actor-scoped initially. A cross-actor support console is a separate authority/privacy decision and is not a prerequisite to explain an actor's own stopped run. Do not add a generic force/reset/abandon action or a new `abandoned` state in the first slice.

## Implementation contract and gates

| Invariant | Likely owners | Required evidence |
|---|---|---|
| Only authenticated owner can inspect/operate a run | API routes, `admin-run-service.js`, page selection state | Superuser/forged-profile/other-actor denial and stale-selection tests |
| One call does one bounded step or one named operation | Form route and shared runner | Concurrent calls, deadlines, response loss, lease expiry and stale-worker tests |
| A dispatched remote write is never repeated because its response was lost | Runner, status runner, ledger, Dataverse/Graph clients | One-write assertion plus exact-ID readback at each ambiguous dispatch boundary |
| Resource provenance stays typed and unknown values fail closed | JS receipt validator, SQL CHECKs, migrations/fingerprint | Bad receipt/enum/index tests, direct SQL rejection and fence-loss tests |
| Readback proves ownership, content and target, not existence alone | `bundle-file-copy.js`, attestor, Dataverse/Graph fences | Source/destination drift, duplicate/late item, wrong path/site/drive and content mismatch |
| `ready` follows ordinary terminal verification only | runner, `markReady`, status readers | Mutations that bypass `verify`; partial/failed/unknown resources |
| Retained runs/artifacts remain visible and protected | list/detail/artifacts, CLI inspect, maintenance sweep | All states in every reader; unknown/partial state never cleaned up |

The owner accepted the first actor-scoped, read-only diagnosis slice and preservation of 1003308. The owner subsequently authorized the offline verifier feasibility experiment. The owner subsequently authorized a read-only verifier and fresh-run file receipt recovery. Live sandbox fixture creation, production operations, status rerun/closure, cast operations, slot binding and retirement remain separate decisions. A new run is the fallback for expired evidence; it does not reconcile or remove a partial destination from the old run.

## Scope and evidence limits

This plan covers shipped stopped-run diagnosis and the authorized fresh-run recovery implementation. The recovery build adds a separate owner CLI transition; it does not change ordinary runner freshness checks, clone fields or bundle versions. Implementation work does not execute Advance or a live CLI mutation mode; repair, retire, clean up or delete Request 1003308; modify retention; or change another capability's status. The Basic form is more conservative than the backend for unclassified failures: a disabled form retry calls for owner investigation, not a claim that the existing CLI runner cannot recover. Root owns the open-items follow-up report and broader status records.

**Historical planning checkpoint — contract-reconcile surface:** Admin run inspect/advance/status routes and CLI dispatch; managed Postgres run/resource/status journals; private Blob bundle/manifest; Dataverse Requests; SharePoint files; consumers are the Admin form, run-inspect, retry runner, maintenance sweep and status runner. Evidence read: remediation plan, Application State Atlas, Factory ledger Atlas, current Factory v1 design/production/admin plans and runbook, and the cited implementation modules/routes. CodeGraph is unavailable because this checkout has no `.codegraph/`; direct source inspection was used. A fresh read-only Production `--run-inspect` was run on 2026-10-03. No Dataverse/SharePoint probe, write, deployment, migration or code test was run for this plan. Broader Factory Atlas contradictions are out of scope here and remain for root's open-items work.

Independent plan review: Sol reviewed and marked READY; Root and Fable approved after the freshness, typed-receipt and effectful-recheck clarifications above. Fable used subscription OAuth; its final follow-up reviewed the plan text, with source verification performed by Sol/root. The first diagnosis slice subsequently shipped in #426. The owner subsequently authorized status-outcome release #427 and reported it in Production.

## First-slice implementation evidence

[VERIFIED via source and focused tests] `admin-run-service.js::inspectRun` checks ownership before reading resources, then calls the pure `diagnoseFactoryRun` helper. The DTO exposes fixed guidance and summary evidence only; it does not invoke status recheck, an artifact read, a lease claim or a remote client. The UI consumes it through the existing selection scope, clears it on selection/advance/error, and links a blocked Basic Advance button to the explanatory text. Existing backend Advance semantics remain unchanged.

Luna built the slice; Sol and root approved the source. The initial three focused service, route and UI suites passed 368 tests. After the bounded adversarial correction, the affected service and UI suites passed 182 tests; the unchanged route suite remains covered by the earlier run. Type checking passed; touched-file lint had zero errors and one preexisting unused-disable warning. No live run, new clone, email, database write or browser rehearsal was performed during implementation. The owner subsequently authorized #426 merge and reported deployment clean. Fable identified overly restrictive existing readback retries and stale earlier-step receipts. Luna corrected those cases, Sol and root approved them, and Fable approved the corrected source with no remaining material findings. The [review receipt](evidence/FACTORY_DIAGNOSIS_REVIEW_2026-10-03.json) records the verdict, validation and limits. Named existing create/location readback and verification retries remain available; unknown Basic failures still require investigation. No new recovery operation was added.

## Status-outcome explanation evidence

[VERIFIED via source and focused tests] The form shows the rechecked change number, its recorded status, and counts of records absent from saved history at the time of that check. It distinguishes those counts from delivery or lifetime effects, and does not show a dispatched result as settled. Results are displayed only after the latest dispatched change in a fresh journal read matches the response sequence/status; subsequent status actions or mismatched/failed reads clear stale results. The route, service, runner and conditional ledger write behavior are unchanged; the runner comment now accurately describes its existing effectful recheck.

Luna built this slice; Sol and root approved it. The focused status-control and status-runner suites passed 95 tests, type checking passed, and lint reported zero errors with two existing hook warnings. Fifteen scoped gates/self-tests passed. Fable approved after one bounded copy/evidence clarification; the final status-control rerun passed 47 tests. The [review receipt](evidence/FACTORY_STATUS_OUTCOMES_REVIEW_2026-10-03.json) records the source fingerprints and verdict. No live status change, recheck, email, repair or deletion was performed during implementation. [VERIFIED via GitHub] The owner-authorized #427 merge is `025749f4d`; [OWNER-REPORTED] Production deployment is complete.

## Offline verifier experiment — evidence boundary

Change surface: a test-only composition in `tests/unit/test-request-readback-recovery-proof.test.js`. Entry point: focused Jest execution. Persistence: none; fixtures and proof results stay in memory. Consumers: this feasibility report and later design review. No runtime route, runner, ledger writer, or UI is added.

| Invariant | Evidence mechanism | Limit |
|---|---|---|
| Source and destination contents agree under the correct integrity mode | Existing bundle/manifest validators, exact SHA-256, real XLSX package attestor | Synthetic bytes and mocked reads only |
| Selected candidate provenance checks reject synthetic mismatches | Run-plan digest, bundle/policy/revision, pending-index and destination-ID/path negative fixtures | Not an exhaustive guard audit; normalized site/drive/parent fixture fields are hypothetical and do not validate the live Graph adapter |
| Integrity-only results carry no continuation authority | Ordinary freshness refusal is exercised; the test-only result returns fixed denial flags | Denial flags describe experiment scope, not a tested runtime enforcement mechanism |
| Retained records stay untouched | No live verifier or remote writer in this experiment | No live recovery success claimed |

[VERIFIED via read-only platform census and sandbox ledger schema check, 2026-10-03] The registered Sandbox metadata endpoints responded successfully and its separate ledger matches the tracked schema. GoVerify remains active on Request creation; other create workflows/plugins are also active. These are metadata observations, not a current clone rehearsal or proof of all automation effects. No business records or files were read by this recon pass, and no disposable source/destination was verified. The local Factory CLI lacks its explicit registered Sandbox URL setting. Its optional GoVerify bypass temporarily changes an organization-wide workflow; neither that bypass nor any clone/create/upload was executed. Historical create/bypass failures are supporting context only, not freshly reproduced failures.

A live proof therefore remains unperformed. It needs a reviewed read-only execution path and a verified disposable fixture or a separately scoped setup that accounts for the marked Request, ledger/artifact retention, SharePoint files and create-automation effects. Do not change shared workflow state merely to unblock this experiment. Database receipt fencing, concurrent workers and late remote writes remain outside the offline proof.

[VERIFIED via focused Jest execution] The 13 offline experiment cases pass. The three-suite run with the existing copy and package-attestation tests passes 216 tests. Targeted lint and whitespace checks pass. The experiment uses the real integrity helpers but test-only orchestration and mocked remote reads. It also demonstrates why the existing diagnostic reconciliation helper alone is insufficient: it can attest a changed source/destination package pair without checking the pinned source hash. This result is not a runtime regression fix or permission to treat a diagnostic receipt as authoritative.

Luna built the experiment; Sol independently ran its 13 tests and approved the bounded source; root reviewed and ran the 216-test set. Fable approved through subscription OAuth after one bounded correction pass; its source review did not run tests. Untested boundaries include a real Graph adapter, complete live inventory/late arrivals, durable receipt compare-and-set and worker fencing. The candidate has no persisted receipt and cannot resume a run.

[VERIFIED via source review] Live `getFileMetadataById` exposes raw `parentReference`; its `siteId`/`driveId` echo call arguments. Live folder listing does not include the fixture's normalized site/drive/parent fields. Therefore this experiment establishes no live target/parent authority or complete inventory binding. A real adapter must validate those identities from authoritative Graph responses and the registered/pinned site contract before a live verifier is built. The fixture's failed XLSX row intentionally lacks a prior `attestedDigest`: the fresh comparison returns a new digest and normalized-parts evidence in memory. This does not prove the complete persisted receipt invariant, and it does not relax the existing final verifier's required digest.

The [experiment receipt](evidence/FACTORY_READBACK_PROOF_REVIEW_2026-10-03.json) records final fingerprints, review verdicts, tests and probe limits. No runtime implementation or deployment is included.

## Fresh-run recovery implementation contract — Sandbox source built and reviewed

Owner decision: recover only while the original source bundle is within six hours; expired runs are diagnosed and require a new run. There is no source rebase, timestamp refresh, stale-bundle continuation, or change to retained Request 1003308.

Entry point: a privileged local owner CLI, initially Sandbox-only, with explicit target and run, read-only inspection by default, and a separate recovery action confirming the exact destination Request. Local operator credentials are the authority; a supplied actor string is not web authentication. Stored run ownership remains a pinned compare-and-set input. No public API or cross-actor web console is introduced.

The real verifier must bind the saved manifest/bundle/policy and run, reread the exact marked destination Request and its run correlation, resolve registered SharePoint site/drives, compare path-addressed and stable-ID metadata, and inspect a complete bounded destination inventory. Source bytes and metadata must match their pinned bundle. PDF requires exact hash; XLSX requires the existing package attestor. Both require stable readback metadata. Missing, ambiguous, malformed, unknown, drifted or expired evidence blocks.

| Invariant | Planned implementation | Required verification |
|---|---|---|
| A prior report cannot authorize a write | Recovery claims the current lease and reruns the verifier | Changed evidence, expired bundle and lease-loss tests |
| One exact receipt changes atomically with run state | Run token/generation/version/DB expiry fence plus resource old-outcome/readback/planned-identity/provenance CAS | Real disposable Postgres conflict, rollback and concurrency tests |
| Recovery preserves dispatch history and remaining work | Same copy step; mark only the verified file; clear stop reason and release lease atomically | No upload, no step skip, no ready transition; normal runner remains required |
| Package evidence survives the operation | Private create-only operator receipt before CAS retains digest and attestation details as evidence/intent, not proof of commit; ledger stores existing typed digest/metadata | Receipt failure blocks mutation; final runner still requires digest and reruns attestation |
| Read-only mode performs no remote mutation | Read-only dependencies and no ledger writer invoked | Side-effect assertions and exact live read-only rehearsal |

Persistence uses existing ledger columns/constraints; no new schema is planned. The recovery writer must not reuse the generic unconditional resource-readback update. It must return a conflict without a partial verified receipt if any original resource or run condition has changed. A run becomes `creating` at the same `copy_file` step, never `ready`; the next ordinary Advance remains subject to freshness and terminal verification.

[VERIFIED via read-only owner-scoped Sandbox ledger census and exact Request/file metadata reads] A retained, approximately six-day-old sandbox Pre-Site run still has a marked Request with matching run correlation and two accessible journaled file identities. This is a real-reader candidate, not a fresh Basic recovery fixture; no bytes were downloaded or remote data changed during that census. A separate disposable local PostgreSQL instance was used for the transactional tests below. Neither observation proves live end-to-end recovery.

[VERIFIED via source] The private receipt is written before the transaction and deliberately records CAS intent. A lost or ambiguous response requires a fresh ledger inspection; the file alone never proves a completed transition. Production recovery remains refused in this initial Sandbox entry point.

## Runtime build verification and remaining live rehearsal

[VERIFIED via focused tests and source review] Luna built the verifier and recovery command; Sol and root approved after bounded corrections. The final eight-suite run passed **280 tests**, including **six real disposable PostgreSQL tests** with `TEST_REQUEST_LEDGER_REQUIRE=1`: exact receipt transition, source expiry, snapshot conflicts, concurrent claim winner, stale-generation rejection, concurrent recovery winner, and rollback after the resource update. Package attestation, normal final-verifier receipt compatibility, strict Graph listing and failure-path lease release are included. Type checking, touched-file lint, syntax/whitespace checks and 15 scoped gates/self-tests passed. No migration was introduced.

Fable approved the bounded Sandbox source through OAuth with no blocking findings and no tool permission denials. Fable performed source review only; its packet predated the final test result, so its note that two failure tests had not yet run is superseded by the 280-test execution. Its live source-path/inventory adapter cautions remain part of the rehearsal checklist. The [runtime review receipt](evidence/FACTORY_FILE_RECOVERY_REVIEW_2026-10-03.json) records evidence and limits.

[PLANNED, not executed] The smallest full rehearsal needs a fresh marked Sandbox Basic Request, its ordinary document location and copied files, retained as test evidence. The existing ready sandbox candidate is expired and uses a different recipe. A deterministic recovery demonstration also needs an explicitly labeled pending-file interruption fixture; the current CLI has no safe switch that deliberately stops between upload and verification. A ledger-only fault fixture must preserve actual Request/file provenance, and must not be described as a naturally occurring failure.

The GoVerify toggle is optional in source, which does **not** establish that an ordinary create succeeds with active automation. Historical sandbox creates were refused without the bypass. Current active create-workflow/plugin side effects have not been proved safe for a new fixture. Do not disable shared workflows or execute creation merely to bypass this evidence gap. The remaining operational prerequisite is a reviewed disposable fixture whose creation respects the no-email constraint; its exact create/location/file/ledger effects must be known before execution. No live fixture creation, recovery, Production enablement, email or deletion occurred in this build. Request 1003308 remains retained.
