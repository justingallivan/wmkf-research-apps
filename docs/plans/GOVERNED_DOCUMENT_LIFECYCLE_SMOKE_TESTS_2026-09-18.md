---
title: Governed Document Lifecycle Smoke Tests
domain: operations
kind: runbook
status: active
summary: Local, mocked, sandbox, read-only, and separately owner-authorized controlled rehearsal evidence for the governed document lifecycle. This runbook does not authorize production writes or sends.
owner: product-engineering
related:
  - docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_DECOMPOSITION_PLAN_2026-09-17.md
  - docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_EXECUTION_2026-09-18.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Governed Document Lifecycle Smoke Tests

This runbook defines the evidence required to smoke the Initial Assessment,
Pre-Site, distribution, and Final Writeup flows after the staged decomposition.
It separates repeatable local automation from sandbox integration, controlled
read-only checks, and separately approved rehearsal evidence. It does not authorize
a deployment, production write, email, SharePoint upload, Blob operation, or
Dataverse action.

The source and route pointers below are **[VERIFIED via repository source and
tests on 2026-09-18]**. Live deployment state, fixture readiness, and external
record identities require per-run evidence. The recorded local-to-live read-only
run below passed a subset of S1; unexercised live cases remain `NOT RUN — live`.

## Preconditions and release controls

Run local automation in Mode A from `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`.
Use a sandbox only after its schema, permissions, policy/configuration rows,
authentication, file behavior, background behavior, and email capture mode have
been re-probed. A preview/local process pointed at production may read only when
`DATAVERSE_ALLOW_PROD_READS=yes`; its writes remain denied by the target
interlock. Any controlled production rehearsal requires a separately approved
test request, throwaway records, allowlisted recipients, an explicit expected
write list, capture mode unless real delivery is the named objective, and
post-run reconciliation.

Before a sandbox or controlled rehearsal, the operator must record:

- deployment class and Dataverse target classification;
- the approved request/document/operation IDs and actor identity;
- schema/readiness and SharePoint folder prerequisites;
- an approved recipient address or email-capture sink;
- cleanup ownership for every row, file, activity, attachment, and ledger entry;
- the rollback/cleanup result, including any unresolved recovery work.

The read-only run below names its observed fixture; this does not authorize writes
to that fixture. A write run is blocked until the operator has named
real approved fixtures and verified their preconditions from the relevant read
routes. Do not use an ordinary staff request, real reviewer, or unapproved
recipient as a smoke fixture.

Smoke stages are separated as follows: **S1** read-only status/history/version
checks with an explicit read allowlist; **S2** approved generation/retry checks;
**S3** current-Brief prepare and any approved capture/send rehearsal; and
**S4** Final same-item/leadership checks. S2–S4 require the fixture and write
inventory below before starting. A related mocked Jest suite passing is evidence
for local behavior only; it is not evidence that the corresponding browser,
Dataverse, SharePoint, Postgres, Dynamics, or UI case ran.

## Exact local commands

These commands use existing repository paths. They are the repeatable baseline
and do not contact external services when the tests' mocks are left in place.

```sh
npx jest --runInBand --silent \
  tests/unit/initial-assessment-artifact-service.test.js \
  tests/unit/initial-assessment-artifact-versions.test.js \
  tests/unit/initial-assessment-controls-service.test.js \
  tests/unit/review-docx-governed-hash.test.js \
  tests/unit/pre-site-visit-artifact-service.test.js \
  tests/unit/pre-site-visit-reopen-service.test.js \
  tests/unit/pre-site-distribution-service.test.js \
  tests/unit/pre-site-distribution-store.test.js \
  tests/unit/deliberation-briefing-page-service.test.js \
  tests/unit/workbench-pre-site-visit-distribution-prepare-route.test.js \
  tests/unit/workbench-pre-site-visit-distribution-send-route.test.js \
  tests/unit/workbench-pre-site-visit-distribution-history-route.test.js \
  tests/unit/final-writeup-transition-service.test.js \
  tests/unit/final-writeup-leadership-transition-service.test.js \
  tests/unit/workbench-final-writeup-route.test.js \
  tests/unit/workbench-final-writeup-leadership-review-route.test.js \
  tests/unit/document-lifecycle-boundary.test.js \
  tests/unit/document-lifecycle-public-contract.test.js
```

The route-security negative coverage remains in the named route suites. Run the
focused auth/route contract set separately when changing route guards:

```sh
npx jest --runInBand --silent \
  tests/unit/workbench-initial-assessment-route.test.js \
  tests/unit/workbench-initial-assessment-versions-route.test.js \
  tests/unit/workbench-pre-site-visit-route.test.js \
  tests/unit/workbench-pre-site-visit-distribution-prepare-route.test.js \
  tests/unit/workbench-pre-site-visit-distribution-send-route.test.js \
  tests/unit/workbench-pre-site-visit-distribution-history-route.test.js \
  tests/unit/workbench-final-writeup-route.test.js \
  tests/unit/workbench-final-writeup-leadership-review-route.test.js \
  tests/unit/external-briefing-routes.test.js
```

## Recorded local verification — 2026-09-18

[VERIFIED via local Jest, ESLint and TypeScript command outputs] The core command
above passed **18 suites / 478 tests**; the auth/route command passed **9 suites /
64 tests**. Full Jest passed **958 suites / 14,174 tests**. Full lint passed with
0 errors and 104 existing warnings; types and strict unused-import lint passed.
The checker/public-contract subset passed 62 tests, including the new mutation
fixtures. Logs: `/tmp/wmkf-smoke-final2-core.log`,
`/tmp/wmkf-smoke-auth-final.log`, `/tmp/wmkf-smoke-final2-full.log`,
`/tmp/wmkf-smoke-full-lint.log`, and `/tmp/wmkf-smoke-full-types.log`.
These local logs are transient; this paragraph preserves their results.

The case table below combines automated coverage with the recorded manual
run; it is not a claim that every listed case ran. Automated coverage above has
run. Subsequent browser/external read coverage and the controlled rehearsal are
recorded below; the earlier read-only record did not include external writes. No
fresh canonical build was run for this follow-up; the earlier refactor build is
recorded separately in the execution receipt. The current restore-fix build is
recorded in the bounded reconciliation section.

## Recorded read-only smoke — 2026-09-18

**PARTIAL PASS — S1 read subset only.** [VERIFIED via in-app browser UI and local
Next.js HTTP logs] Candidate `bb2faa6e` ran from source at `http://localhost:3000`
against the configured production read target, signed in as the existing staff
account. Luna verified local interlock `on`, production reads enabled and no
sandbox URL configured. Sandbox schema readiness was not freshly probed; the
older absence report is not a current probe. A configured email capture flag is
not proof of distribution-send capture support.

Fixture: existing request **1003222 / ZZTEST-03**, request GUID
`e43ae6ea-698f-f111-8076-6045bd018a07`, discovered in Workbench. Only navigation,
read-only expansions and reloads were exercised. No generate, restore, Board
snapshot, reopen, prepare, send, download or lifecycle-transition action was taken.

| Observed check | Result |
|---|---|
| Existing Microsoft sign-in and Workbench request list/detail | PASS |
| Initial Assessment status | PASS: Ready/Draft, linked existing Word file, SharePoint version 2.0 |
| Initial Assessment version history | PASS: versions 2.0 (current) and 1.0; no Restore click |
| Staff Deliberations read model | PASS: existing locked Brief and existing Pre-Site Word file rendered |
| Distribution history | PASS: 13 historical attempts; latest preview not sent and prior sent receipt rendered |
| Final read model | PASS: Ready for group review; source file `1003222 Pre-Site Visit e8eb3d87-f0376846.docx`; same display after two reloads |
| Five authenticated read endpoints | PASS: initial-assessment, versions, pre-site-visit, distribution/history and final-writeup each logged HTTP 200 |
| Same five endpoints without session | PASS: each returned HTTP 307 to sign-in, without document payload |

Evidence: browser observations in this task; transient local logs
`/tmp/wmkf-document-smoke-server-polling.log` and
`/tmp/wmkf-document-smoke-unauth.json`. The first dev startup hit EMFILE watcher
errors; restarting with `WATCHPACK_POLLING=true` served the candidate successfully.

**Limits:** complete S1 is not claimed. No second wrong-app account, authenticated
invalid-GUID probe, full raw-DTO comparison or independent database before/after
census was performed. Direct API tab navigation was blocked by the browser client;
the signed-in UI requests and server status logs supplied the positive evidence.
No Workbench/external mutation request appeared in the local HTTP log. This is not
a database-wide proof of zero incidental authentication/telemetry writes.
S2 remains incomplete because generation failed and was not retried; the restore
metadata was subsequently reconciled by the bounded service recovery recorded
below. S3–S4 remain NOT RUN. No production deployment was changed.

## Controlled rehearsal attempt — 2026-09-18

**STOPPED / INCOMPLETE — two IA write checks failed before downstream stages.** [VERIFIED via the controlled loopback rehearsal logs and Dataverse/Graph readbacks] The owner-approved rehearsal used request **1003222 / ZZTEST-03** (`e43ae6ea-698f-f111-8076-6045bd018a07`) with the sole approved recipient `justingallivan@me.com`. The backend and proxy were stopped after the two failures below. This is a separate run from the earlier S1 read-only subset; it does not turn any prior partial read result into a write or end-to-end pass. The initial restore failure is historical; the later bounded service recovery is recorded immediately after it.

| Attempt | Result | Durable readback |
|---|---|---|
| IA generation | HTTP 500; `claude_output_truncated` (`max_tokens=2200`), run `7d8b647c-abb3-f111-aaac-000d3a361c1f`; no SharePoint item/output was persisted | One new Failed IA row `ea6e4768-abb3-f111-aaac-6045bd04539e`; the request remained unchanged; the 24 pre-existing Dataverse Request Document rows were unchanged; distribution attempts remained at 13 |
| IA restore | Selected historical version 1.0 from current 2.0. Graph restore succeeded, then the API returned HTTP 500 `initial_assessment_restore_bytes_mismatch` before registry metadata persistence | Readback `/tmp/wmkf-restore-readback.json` shows current version 3.0 stable, historical 1.0/2.0 preserved, and equal governed hashes `gdc1:yGi7ISeqZspD0PwIecM9bbGPZQhn7hJpEV_k6Qgv4Yk`; raw package bytes differ only in custom XML, custom properties and trash parts, with no Word body-part changes. Registry metadata reconciliation was not confirmed and no rollback was attempted |

After stopping, the request and its 24 pre-existing Dataverse Request Document rows were unchanged apart from the single new Failed IA row (25 total); the SharePoint restore effect is recorded separately above. No PSV generation/reopen/start-site-visit, distribution prepare/send, Final transition or leadership request ran, and no email was sent. The prior signed-in read-only observations remain historical S1 evidence.

The process-only proxy used the reviewed interlock-on target and dated ACK; no environment file was changed. Evidence files: `/tmp/wmkf-document-rehearsal-before.json`, `/tmp/wmkf-document-rehearsal-after.json`, `/tmp/wmkf-restore-readback.json`, and the corresponding sanitized rehearsal/backend/proxy logs.

## Bounded restore reconciliation — 2026-09-18

**PASS — service recovery only; no new browser restore.** [VERIFIED via `/tmp/wmkf-ia-restore-reconcile-applied.json`, `/tmp/wmkf-restore-registry-before.json`, `/tmp/wmkf-restore-registry-after.json`, `/tmp/wmkf-restore-reconciled-graph.json` and process logs] Root invoked the public restore service with the original request/artifact/target payload under a five-minute PATCH-only grant. The wrapper prohibited Graph restore calls and allowed one exact update for artifact `a6876ad6-3b94-f111-8075-70a8a59cded0`.

The service returned `restored:false`, `reconciled:true`, `targetVersionId:1.0`; it made one registry update and zero Graph restore calls. The independent comparison found the request projection unchanged, 25 Request Document rows before and after, only the existing IA row’s captured version/etag/modified time changed, all other 24 captured rows unchanged, and all 13 distribution attempts unchanged. Graph readback at 22:23:44Z confirmed the same item, stable current version 3.0, preserved 3.0/2.0/1.0 history, and the same governed hash as version 1.0.

The recovery process and wrapper exited 0. Limits: this was not a global database audit, and the browser restore was not rerun after the service fix. S2 therefore remains incomplete; S3–S4 remain NOT RUN.

## Controlled smoke continuation — 2026-09-18

**PARTIAL — Board snapshot action succeeded; downstream readiness blocked.** [VERIFIED via the isolated candidate build/readback files and sanitized environment classification] Candidate source `f45581ed` built successfully with 269 route rows. The Board snapshot readback `/tmp/wmkf-smoke2-board.json` returned row `dc7558c4-b2b3-f111-aaac-7ced8d3c3a59`, source IA artifact `a6876ad6-3b94-f111-8075-70a8a59cded0` at version `3.0`, governed hash `gdc1:yGi7ISeqZspD0PwIecM9bbGPZQhn7hJpEV_k6Qgv4Yk`, and distinct Board item `01G4GVMS5XTETQIS3JPNEIXAKRDZPRBY35`. The UI displayed actor `Not captured`. The Board snapshot action created the distinct Board snapshot item and did not invoke AI.

The subsequent distribution prepare returned HTTP 503 `distribution_briefing_required` for operation `061f25d7-b0c1-40d7-8c1e-18f1e098d6c6`; no send was attempted. Readback `/tmp/wmkf-smoke2-prepare-blocked.json` shows the 26-document projection and 13 distribution attempts byte-identical to the prior readback. The default dependency path requires `DELIBERATION_BRIEFING_SCHEMA_READY` to be exactly `on` and calls `ensureLiveBriefingLink`, which is write-capable; no live link was minted during the failed preparation. The sanitized environment classification found that flag unset. Source confirms migration `038_deliberation_briefing_links.sql` is present and listed in `lib/db/migrations-manifest.json`, but no live schema probe or flag change was performed. The owner remedy is to first verify whether migration 038 and the briefing-link schema are already applied in the target Postgres; apply it only if missing and separately authorized, then verify the public-link configuration and set the readiness flag through supported deployment configuration before retrying prepare. Do not bypass the gate or call the minting helper as a read-only probe.

Guarded PSV reopen separately returned HTTP 503 `Guarded reopen is unavailable until its Dataverse schema is verified`; no retry was attempted. Readback `/tmp/wmkf-smoke2-reopen-blocked.json` shows the request, document projection and distribution attempts unchanged. The sanitized environment classification found `GUARDED_REOPEN_SCHEMA_READY` unset. The owner must complete the documented Dataverse schema verification and supported deployment configuration before retrying; no flag was changed here.

The recorded blocked attempt used local `NEXTAUTH_URL=http://localhost:3000`, before the public-link override was configured. That remains suitable for local auth but is not a deliverable external email URL. The supported configuration keeps `NEXTAUTH_URL` for staff auth and sets `DELIBERATION_BRIEFING_PUBLIC_BASE_URL` to an approved HTTPS origin for briefing links; no distribution email was sent. The backend and proxy were stopped cleanly with SIGINT (exit 130); Final and leadership were intentionally deferred to preserve the reopen order.

## Smoke cases and evidence

Each row is a separate run record. The operator fills in the run timestamp,
fixture IDs, deployment/target mode, command or URL, result, and evidence links.
Unexercised portions retain `NOT RUN — live`; partial results refer to the recorded runs above.

| Case | Source entry point and consumer | Required proof | Local status | Live status |
|---|---|---|---|---|
| IA-1 generation | `pages/api/workbench/initial-assessment.js` POST; `shared/components/workbench/InitialAssessmentTab.js` | Valid request returns Ready artifact, stable SharePoint identity, registry lineage, and UI Word/SharePoint action. | `MOCKED SUITES PASS` | `FAILED — controlled rehearsal HTTP 500; no SharePoint item; no retry` |
| IA-2 exact retry | Same POST and `lib/services/initial-assessment/artifact-service.js` retry path | Repeating the same request reuses the generation/registry identity and does not call AI, upload, or create a second row. Capture row identity, generation key, call counts, and response. | `MOCKED SUITES PASS` | `NOT RUN — stopped after IA-1 failure` |
| IA-3 read/status | `pages/api/workbench/initial-assessment.js` GET with `requestId` or `cycleCode`; Initial Assessment tab | Current Ready/Board Ready projections are returned with response-only metadata refresh; malformed/unknown rows fail closed and no write spy fires. | `MOCKED SUITES PASS; operator case NOT RUN` | `PARTIAL — read subset above; remaining checks NOT RUN` |
| IA-4 versions/restore | `pages/api/workbench/initial-assessment/versions.js`, `restore-version.js`, `board-snapshot.js`; `tests/unit/initial-assessment-artifact-versions.test.js` | Version list, selected-version restore, and Board snapshot preserve stable identity, conditional writes, actor policy, and cleanup ownership. | `MOCKED SUITES PASS` | `PARTIAL — initial browser restore failed historically; bounded service recovery reconciled metadata; Board snapshot succeeded; browser restore was not rerun` |
| PSV-1 generation/status | `pages/api/workbench/pre-site-visit.js`; Staff Deliberations tab | POST generates/reuses the governed Pre-Site row; GET returns current and newer pending status; UI exposes the correct Word action. | `MOCKED SUITES PASS` | `PARTIAL — prior S1 read only; write case NOT RUN after IA stop` |
| PSV-2 stale correction | `pages/api/workbench/pre-site-visit/reopen.js`; reopen service and route suite | Stale/current pointer or correction-cycle input is rejected or creates the approved successor; old row remains evidence and a retry does not create a duplicate. | `MOCKED SUITES PASS; operator case NOT RUN` | `BLOCKED — HTTP 503 schema readiness; no retry` |
| DIST-1 current brief prepare | `pages/api/workbench/pre-site-visit/distribution/prepare.js`; `PreSiteDistributionPanel.js` | Current **`attachmentMode: none`** prepare is the supported happy path: server-owned retained snapshot/review-bundle identities, received-review requirement, input fingerprint, and preview hash are returned. Assert no writes on failed read/drift gates and exact DTOs on success. | `MOCKED SUITES PASS; operator case NOT RUN` | `BLOCKED — HTTP 503 distribution_briefing_required; no send` |
| DIST-2 review-bundle rebuild | `lib/services/deliberation-briefing/briefing-page-service.js` `resolveBriefingMember`; external briefing document route | A changed live review set rebuilds through real retention with mocked external I/O, preserves actor/ledger/hash/size, and an unchanged set reuses the retained identity. | `MOCKED SUITES PASS; operator case NOT RUN` | `NOT RUN — live` |
| DIST-3 legacy modes | `distribution/prepare.js` and `distribution/send.js` | `docx`, `pdf`, and `both` remain readable/retryable for existing ledger rows. **MOCK-ONLY; no live status is applicable.** Current prepare does not accept these modes for new attempts. | `MOCKED SUITES PASS` | `NOT APPLICABLE — live send prohibited` |
| DIST-4 send retry/uncertain transport | `pages/api/workbench/pre-site-visit/distribution/send.js`; `send.js` and email-recovery tests | Activity identity is persisted/recovered before exact assertions; uncertain response, lease loss, stale source, duplicate attachment, and sent retry do not create a second activity or send. **MOCK-ONLY; no live status is applicable.** | `MOCKED SUITES PASS` | `NOT APPLICABLE — live send prohibited` |
| DIST-5 history | `pages/api/workbench/pre-site-visit/distribution/history.js`; distribution history panel | History returns ordered attempts, source drift, actor names when available, and strict-read defaults without changing ledger state. Invalid request and denied access return the route contract. | `MOCKED SUITES PASS` | `PARTIAL — prior S1 read only; no write-stage history action` |
| FINAL-1 same-item transition | `pages/api/workbench/final-writeup.js`; `shared/components/workbench/FinalWriteupTab.js` | Start requires session actor and lead-PD/superuser authorization, verifies the current stable document, creates/reuses one Final row, and changes no SharePoint item. | `MOCKED SUITES PASS` | `PARTIAL — prior S1 read only; transition NOT RUN after IA stop` |
| FINAL-2 leadership transition | `pages/api/workbench/final-writeup/leadership-review.js`; Final Writeup tab | Leadership transition verifies current pointer/version, applies the ordered ETag changeset, records actor/time, and replays a landed response without a second write. | `MOCKED SUITES PASS; operator case NOT RUN` | `NOT RUN — live` |
| AUTH-1 negative access | Every named Workbench route plus external briefing routes | Unauthenticated, wrong-app, non-reviewer, missing actor, invalid GUID/body, stale expected identity, and unauthorized leadership requests fail before service writes. | `MOCKED SUITES PASS; operator case NOT RUN` | `PARTIAL — read subset above; remaining checks NOT RUN` |

The external briefing `GET /api/external/briefing/[token]/document?member=review-bundle`
is **not** a read-only production smoke. `resolveBriefingMember` may rebuild and
write a retained review bundle when the live review fingerprint differs. A read-only
briefing check may use only `context` and non-rebuilding document members with
rebuild dependencies disabled; the review-bundle member belongs in DIST-2's mocked
case or an explicitly approved sandbox write rehearsal.

## Concrete fixture and observation steps

These steps make each local case executable without inventing external IDs. The
fixture builders must use the existing test factories/rows in the named suites;
an operator supplies disposable sandbox values only after the release-policy
preconditions pass.

1. **Initial Assessment.** Start from a request fixture with one active proposal
   narrative and a resolved request library. POST the exact `{ requestId }`,
   capture the response artifact id, generation key, SharePoint drive/item,
   version/eTag, content hash, and registry row. Repeat the same POST and assert
   the same identity plus zero additional AI/create/upload calls. GET by
   `requestId`, list `versions`, then exercise restore and Board snapshot with
   an approved version; record ETag-conditional updates and final rows. The
   expected UI evidence is a Ready/Board Ready card with the Word/SharePoint
   action and a separate version/snapshot result.
2. **Pre-Site and correction.** Start with a current Draft/Ready Pre-Site row
   and stable source metadata. POST `/api/workbench/pre-site-visit`, repeat it,
   then mutate the fixture's expected current pointer/version in a mock or
   disposable sandbox row. The expected result is a stale/correction response,
   no supersession of a newer pointer, and at most one approved successor from
   `reopen`; record row ids, source/target identity, cycle code, and cleanup
   work. GET status must show current and newer pending rows without a write.
3. **Current Brief prepare.** Use a stored Brief snapshot with at least one
   received review, a current brief pointer, stable source metadata, session
   snapshot, and valid actor. POST prepare with the exact request/artifact/
   operation ids and compose inputs from the panel. Record `previewHash`, input
   fingerprints/delta, retained DOCX/PDF rows, review-bundle identity, and the
   prepared ledger row. Repeat the same payload and assert exact preview/ledger
   reuse. For stale input, change one real snapshot field and assert the named
   drift error before any write.
4. **Review-bundle rebuild.** Invoke the real `resolveBriefingMember` with a
   fixture whose live received-review set differs from the pinned fingerprint,
   but inject mocked Graph/PDF/Dataverse persistence. Capture the actor passed
   to retention, uploaded bytes, SHA-256/size, Request Document create, and
   ledger update. Repeat with the same set and assert no second create/upload;
   then use the external route only as a mocked route-shape test, never as a
   read-only live claim.
5. **Final same-item and leadership.** Start from a current Ready/Review
   Pre-Site row and stable SharePoint identity. Call the real local service or
   route with a session-derived authorized actor; assert one Final row and one
   ordered ETag changeset with no upload/copy. Repeat after a simulated lost
   response and assert reconciliation, not a second row/write. For leadership,
   assert the ordered final-row PATCH then request-pointer PATCH, actor/time,
   version/eTag/hash persistence, and landed-response replay. The UI evidence
   is the Final Writeup state changing from ready/group review to leadership.
6. **Auth negatives.** For each route in the command above, run unauthenticated,
   wrong-app/non-reviewer, invalid method/body/GUID, missing actor, stale expected
   identity, and unauthorized leadership fixtures. Record status/code/body and
   verify no create/update/delete/upload/send spy fired.

## Mock-only cases

The following remain local/mock-only even when a deployment smoke is approved:

- legacy attachment modes and all send-retry/uncertain-transport faults;
- duplicate activity/attachment responses and lost-response recovery;
- malformed registry rows, unknown producer/lifecycle values, and metadata drift;
- all AI calls, PDF/DOCX assembly inputs, Graph upload/copy/delete, and Dynamics
  email transport unless a separate sandbox approval names them.

These cases must assert ordered calls and final durable-row projections in their
fixtures. A negative “no write” assertion is valid only when the fixture contains
the row/input that would otherwise cause the write.

## Sandbox and controlled rehearsal

Sandbox writes may be proposed only after the release-policy preconditions above
are satisfied. The smallest approved write rehearsal is one disposable request:
generate, exact retry, read/version check, prepare, and cleanup. Inventory every
Request Document row, SharePoint file, Postgres attempt, Dynamics
activity/attachment, and review-bundle path; there is no single disposable
artifact path. A send rehearsal uses capture mode and an approved test
recipient unless the owner explicitly authorizes real delivery. The operator
must record every expected Dataverse/SharePoint/Postgres/Dynamics write before
starting and reconcile every resulting identity afterward.

Production-read shadow checks are read-only and must prove the request/document
read model, current pointer, version metadata, and distribution history;
they must not call prepare, send, restore, reopen, create, update, delete, or
email paths. Controlled production rehearsal is a separate owner approval and
is not implied by this document.

The external `GET /api/external/briefing/[token]/document?member=review-bundle`
route is excluded from this read-only allowlist: `resolveBriefingMember` may
rebuild and persist a retained review bundle when the live review fingerprint
differs. Exercise that member only in the mocked DIST-2 case or an explicitly
approved sandbox write rehearsal.

## Operator checklist (S1 partial; S2 incomplete; S3 blocked at prepare/send not run; S4 deferred/unrun)

Use separate disposable fixtures when restore, reopen or a lifecycle transition
would invalidate another case's preconditions. For each case record the exact
candidate commit/deployment URL, signed-in role, before/after identities and
network responses. A local mocked pass does not complete this checklist.

### S1 — signed-in read-only checks

Prerequisites: an authorized deployment/target, a staff account with `reviewers`
access, a second account without that access, and known existing IA, Pre-Site,
Final and distribution-history fixtures. Use the signed-in browser's normal
session; do not export tokens/cookies. The explicit document-flow read allowlist is:

- `GET /api/workbench/initial-assessment?requestId=<approved-request-guid>`
- `GET /api/workbench/initial-assessment/versions?requestId=<approved-request-guid>&expectedArtifactId=<displayed-IA-guid>`
- `GET /api/workbench/pre-site-visit?requestId=<approved-request-guid>`
- `GET /api/workbench/final-writeup?requestId=<approved-request-guid>`
- `GET /api/workbench/pre-site-visit/distribution/history?requestId=<approved-request-guid>`

1. Open the matching Workbench panels and capture these requests/responses.
   Confirm the displayed current document, file link, version list, Final phase
   and distribution receipt match the corresponding DTO and recorded fixture.
2. Reload twice. Confirm stable row/item/pointer identities and no new document,
   snapshot, distribution attempt or email activity. Volatile metadata-read
   timestamps need not be identical. Do not click generate, restore, snapshot,
   reopen, prepare, send or transition actions in this stage.
3. Try an allowed GET while signed out, and with the account lacking app access.
   Expect the existing authentication/authorization rejection and no document
   payload. With the authorized account, an invalid GUID must return 400.
4. Save sanitized network evidence and before/after document-domain readbacks.
   Mark PASS only after those checks; otherwise record the exact mismatch.

Do not open external briefing document/download routes in S1. The review-bundle
GET can write, and opening a complete page may initiate additional requests.

### S2 — approved generation and retry

Prerequisites: approved disposable request library, prompts/readiness and input
fixtures; explicitly authorized application AI/file/registry writes. Select a
fixture with the required active narrative and no competing active claim.

1. In IA, generate once; if the response is in progress, use status reads until
   completion or the operator's recorded timeout. Record row, generation key,
   request pointer, drive/item, version and governed hash.
2. Replay the same generate request with unchanged inputs. Require the same
   artifact/item, with no additional AI run or upload. Reload the panel and
   confirm the same file action. Repeat the corresponding Pre-Site happy path
   with its own eligible fixture.
3. Restore/Board-snapshot and guarded-reopen checks are separate approved write
   cases with their own preconditions, not automatic cleanup. Exercise them only
   with a preselected version or eligible Review source and the required role.
   Record the intended distinct snapshot/successor and its pointer relationship.
   Keep stale-pointer and crash injection in the mocked suites.

### S3 — approved current-Brief preparation and send

Prerequisites: current Brief with at least one received review, fresh input
fingerprint (or an explicitly reviewed exact-fingerprint acknowledgement),
valid staff sender, approved recipients, required session/readiness and a verified
mail capture configuration. Capture support must be proved before relying on it;
if unavailable, omit send unless real delivery is separately authorized.

1. Open the Share composer and prepare without sending. The UI omits
   `attachmentMode`; the server defaults it to current mode `none`. Record the panel's exact request/expected-artifact/operation IDs and returned
   preview hash. Check retained document/bundle rows, files and ledger identities.
   Confirm that preparation alone did not send an email.
2. Replay the captured preparation request in the authorized browser session,
   preserving the identical payload and operation ID. Do not click Prepare again:
   that action generates a new operation ID. Require reuse of the attempt and
   retained identities. Do not manufacture a second ID to disguise a failed retry.
3. If send is approved, confirm the preview once. Capture the send payload
   (`requestId`, `operationId`, `previewHash`) and the resulting Dynamics activity
   and ledger status. A confirmed success displays **Sent for delivery.** This
   proves transport acceptance only, not inbox delivery.
4. Replay the same send payload after confirmed success. Require the same
   activity and sent attempt, with no additional transport/attachment work.
   If the outcome is uncertain, stop and reconcile; do not induce or retry that
   fault live. The mocked suites cover uncertain/lost-response paths.
5. Optional, separately approved bundle-write smoke: on a sent fixture, add one
   approved test review through its normal flow, then download the review bundle.
   Verify one changed fingerprint/new retained bundle and the original sharing
   actor attribution; a second download must reuse it. This GET is a write case.

### S4 — approved Final and leadership transitions

Prerequisites: current Ready/Review Pre-Site fixture, authorized lead PD or
superuser with resolved actor identity, stable SharePoint item and readiness.

1. Record the source row/item/version/hash and request's current pointers. Start
   Final via the panel (`POST /api/workbench/final-writeup` with `requestId` and
   `expectedArtifactId`). After completion, verify source lifecycle Final,
   Final row Ready/Review, current-Final pointer, and identical drive/item IDs.
   There must be no new SharePoint file or upload/copy.
2. Replay the identical start payload. Require the same Final row/item and
   preserved milestone fields. Observe the group-review UI after reload.
3. Advance via `POST /api/workbench/final-writeup/leadership-review` with
   `requestId` and `expectedFinalArtifactId`. Verify leadership actor/time and
   current version/hash, unchanged milestone version/hash/time, the same item,
   and the leadership UI state. Replay the same payload; require reuse without
   restamping the transition. Use mocked tests for ambiguous commits and races.
4. Reconcile every approved write against the fixture inventory. Record cleanup
   or retained test evidence under the release policy; never delete unowned data
   or attempt to reverse a business transition by hand as generic cleanup.

## Stop criteria and evidence record

Stop immediately on an unexpected write, a second activity/attachment, a changed
SharePoint item when same-item behavior is required, an actor/pointer mismatch,
an unapproved recipient, a missing lease/ETag conflict, a fixture that is not
disposable, or any response that claims success without durable readback. Mark
the case `BLOCKED` with the error, request/operation IDs, and cleanup owner;
do not retry against the same external fixture until the state is reconciled.

For every completed case, retain the exact command or route, fixture
preconditions, sanitized request/response, ordered external-call trace, durable
row/file/activity identities, cleanup result, and final status. This runbook
must never be changed to turn an unrun live case into a pass without that
evidence.
