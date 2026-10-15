# Writeup-regeneration sandbox rehearsal setup

Status: **fresh fixture created; count rollup not yet caught up**. The targeted
Sandbox verifier repair is implemented and reviewed. The fresh Request 1000366
has a durable pre-create baseline, but its active-Request census is 29 while the
rollup remains 28. The original 1000365 failure remains preserved. No dependent
fixture completion or model call has run. This is a service-integration rehearsal
for the registered Dataverse Sandbox and shared akoyaGO SharePoint site; it does
not establish hosted API authentication or production behavior.

## Execution status and retained evidence

The reviewed setup was partially applied before the Factory run: the existing
least-privilege reviewer role was assigned to the two owner-selected Sandbox
staff accounts, the missing-only Research audience and canonical notice-copy
settings were seeded, and a dedicated local Postgres 16 container/database
was created and initialized from existing schema/migration definitions. These
are retained; no cleanup is planned. No Request-specific PI, narrative,
review, Site Visit, artifact, acknowledgement, or email/notification fixture
was written, and the application provider-call budget remains **0 of 3**.

One no-bypass Factory create attempt failed with the documented GoVerify
400 error; its receipt is retained and its preallocated Request was read back
absent. A fresh manifest was then executed once with the existing guarded
Sandbox-only GoVerify bypass. It returned HTTP 201 for Request **1000365** and
created the expected unique Dynamics location and empty SharePoint folder.
The receipt records GoVerify restored and verified. It also records a failed
verification: Foundation-account `versionnumber` changed while `modifiedon`
remained `2026-05-19T18:33:57Z`; the bounded read-only Foundation audit query
returned zero rows. The create body contained only Request fields and did
not issue an account or Contact write. Current readback confirms the marked
Request, its sole expected location/folder, zero payment rows, zero regarding
emails, and no child Contact changes. Because that earlier Factory version did not persist the
runtime before-version in its receipt, the version delta cannot be attributed
conclusively to a Request-triggered rollup versus an unrelated concurrent
change. Do not weaken or edit the Factory baseline guard to continue. Retain
Request 1000365 and its empty folder as evidence; do not delete or modify them.
The fixture helper requires `receipt.verification.ok === true` and a verified
GoVerify restoration. Invoking it with the retained failed receipt using the
repository's `node --import ./scripts/lib/use-extensionless.mjs` runtime
refused at that guard before any Dataverse or Graph request.

## Foundation version-change diagnosis

**Verified:** `compareSnapshots` compares `String(versionnumber)` and the
`modifiedon` value; the observed version number is far below JavaScript's
exact-integer limit, so a type/precision artifact does not explain the
failure. The earlier Factory receipt records that the account version differed, but
it did not persist either runtime version number or the pre-create full-row
snapshot. That evidence cannot be reconstructed from the manifest.

**Verified in Sandbox:** a read-only account attribute-metadata query found
eight `SourceType=2` rollups whose `FormulaDefinition` references
`akoya_request`. On current readback, all eight `_date` companions equal
`2026-10-15T22:30:48Z` and all eight `_state` companions equal `1` (Calculated).
That timestamp falls inside Factory observation (`22:30:07.512Z` to
`22:31:08.158Z`), after its Request create response (`22:29:59.270Z`) and
meeting-date correction PATCH (`22:30:05.087Z` to `22:30:06.096Z`). The eight
rollup values currently read as request count 28, awards/grant totals 0, and
most-recent-grant date null. The Foundation applicant has 33 Request rows in
the current list, so that list count does not establish the rollup's inclusion
predicate or an expected `+1`; no count delta is assumed. The six current
Request-related asynchronous workflow jobs are all Canceled, including
`WMKF_Update CA FTB Status on Org`.

**Inference, not proof of exclusive cause:** the fresh rollup timestamps are
direct evidence that the platform recalculated the Request aggregate rollups
during the verification window. That likely explains a genuine
`versionnumber` bump without a `modifiedon` change. The absent before-version,
zero Foundation audit rows, and lack of a version-bearing intermediate read
mean an unrelated concurrent update cannot be excluded. The private
read-only probe summary is retained at
`/private/tmp/writeup-factory-foundation-readonly-2026-10-15.json`; it was
collected by reading the Sandbox account, querying Account attribute metadata
for `SourceType=2` formulas containing `akoya_request`, reading the new
Request's async-operation rows with formatted status, and counting current
Foundation-applicant Request rows.

**Implemented guarded verification:** the owner approved the targeted repair.
The standalone Sandbox Factory runner now journals a versioned baseline before
its sole create POST, then rechecks source freshness and interruption state.
The baseline retains digests of every protected account field, all rollup
values/companions, the Contact census, and the exact expected active Request
set. All 15 live rollup formulas are hash-pinned. The count formula was verified
to count only active Requests: 28 active plus 5 inactive explains the earlier
33-row total. The after-set must equal the before-set plus precisely the reserved
Request, and the rollup count must equal that complete set. Other rollup values,
non-rollup account fields (including modified time), and Contacts stay protected.
Only reviewed rollup dates within the operation window may move, with healthy
Calculated states; unexplained version-only drift fails. Missing/unknown schema,
fields, unhealthy states, unexpected membership, or changed formulas fail closed.
The existing version comparison remains the default for other Factory callers.

Luna implemented, Sol reviewed, and parent checked the composition. Two focused
suites / 39 tests passed, as did scoped lint and sequential data-access/writer
gates and self-tests. The GET-only live probe captured a valid baseline and
failed only the expected reserved-Request absence check without any create.
The reproducible probe is `scripts/probe-writeup-sandbox-rollups.mjs`. A fresh
manifest/receipt is required; this does not convert the failed 1000365 receipt
into a success. No production contract or schema was changed.

## Fresh baseline-backed attempt

[VERIFIED via the private baseline manifest/receipt and read-only recheck.]
A fresh v3 manifest created Request **1000366** once; POST returned 201 and
GoVerify restoration was verified. The initial final check and later read-only
check at `2026-10-15T23:17:50.885Z` used the original baseline captured at
`23:14:55.012Z`. Both found exactly the expected active Request set (29), but the
account's count rollup was still 28, with no rollup or version movement. The sole
failure was count/census parity. Fresh Request, location/parent, empty folder,
zero payment/email, unchanged Contact, and active GoVerify checks passed.

Private evidence is retained as
`/private/tmp/writeup-regen-foundation-baseline-receipt-2026-10-15.json` and
`/private/tmp/writeup-regen-foundation-baseline-recheck-2026-10-15.json`.
The original failed receipt was not edited. A future read-only recheck may use
this same original baseline; it must not capture a new baseline after creation
or retry creation. Fixture completion remains stopped pending a fully passing
check, and provider attempts remain **0 of 3**.

## Read-only evidence

The bounded inventory in
[`probe-writeup-regeneration-sandbox-fixture.mjs`](../../scripts/probe-writeup-regeneration-sandbox-fixture.mjs)
pins `DYNAMICS_URL` and `DYNAMICS_SANDBOX_URL` to the registered Sandbox host,
sets the target interlock and DAL enforcement to `on`, removes the production
read opt-in, and issues GETs only. On 2026-10-15 it found 22 marked test
Requests, no linked Project Leader on any of them, and one current Pre-Site
artifact among them. A separate read-only Site Visit query found two visits
related to those test Requests; one matched the locally configured eligible
ended pair `0/1`, but its Request has no PI or current Pre-Site/Final pointers.
It cannot serve as this rehearsal's source.

The marked Request with the current Pre-Site Draft is a usable Factory source,
but the Factory clone omits the fields this rehearsal needs: PI, lead Program
Director, broad Grant Program, and Request status. The default
`loadPreSiteVisitInputs` completed its read-only narrative, applicant funding
rollup/program-grant, and review-roster work, then failed closed with
`pre_site_visit_context_incomplete` because the cloned Request has no PI. The
current governed `pre-site-visit.proposal-core.generate` prompt is present.
The sandbox returned at least 100 enabled SystemUsers and nine active broad
Grant Programs; these aggregate counts do not select or authorize an actor.
The read-only Wave 21 Site Visit logistics preflight returned four exact
fields, and `SITE_VISIT_LOGISTICS_SCHEMA_READY` is literal `on` in the local
rehearsal environment. The Wave 24 explicit-actor metadata preflight returned
three exact artifacts; its local readiness flag is currently off and must be
enabled only for the reviewed rehearsal process after retaining the exact
metadata result. Neither preflight applied schema.

The initial read-only probe found no `WMKF Final Writeup Reviewer` role row, no
enabled users in that role, no `final_writeup.matrix_audiences` app-setting
row, and no handoff email copy settings. The approved, missing-only setup was
subsequently completed and read back: the existing role was assigned to both
selected accounts, the Research audience was configured, and the two canonical
email copy settings were seeded. These settings remain in Sandbox after the
Factory verification stop.
The local
`FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS` flag is unset; the rehearsal would
set it only in its isolated process after copy and audience preconditions pass.
The owner has selected two named Sandbox staff identities and authorized their
use as the rehearsal lead and reviewing colleague. A fresh exact-name probe
found one enabled Sandbox SystemUser for each; the sanctioned role command's
dry run resolved both assignments and all six role privileges. The existing
least-privilege role specification is
[`wave23-final-writeup-reviewer.json`](../../lib/dataverse/schema/roles/wave23-final-writeup-reviewer.json).
It grants acknowledgement Create/Read/Write/Append plus Request Document and
User AppendTo; it grants no Request Document write, delete, assign, or share.
The sanctioned `scripts/apply-security-role.js` path supports a Sandbox dry
run and an explicit execute step. The reviewed operation is limited to the
two owner-selected accounts. It will create the existing role if absent, add
its six specified privileges and solution membership, and assign it to those
accounts. These assignments persist as Sandbox security configuration after
the rehearsal; there is no automatic removal. The proposed version-2 matrix
setting is one-program-only for the active Sandbox Research Grant Program,
with both selected users assigned the Program Director persona so the lead is
excluded from the handoff audience and the colleague receives it. The owner
approved seeding the exact existing subject/body keys only if a fresh read
still finds them absent, using the canonical values in
[`final-writeup-handoff.js`](../../lib/seed/email-defaults/final-writeup-handoff.js).
The final write remains gated on parent review of the dry-run artifacts.

The first prepared Factory manifest at
`/private/tmp/writeup-regen-factory-manifest.json` had no bypass and failed on
GoVerify; its receipt is retained. The second manifest at
`/private/tmp/writeup-regen-factory-manifest-goverify.json` was executed once
with the reviewed Sandbox-only bypass and produced Request 1000365, but did
not pass Factory verification. Both have no bundle and no file-copy plan. The
target SharePoint site is
shared, so isolation depends on the Factory-created unique Request folder and
the exact Request-owned `akoya_request` location, never on a separate site.
The read-only preparation command was:

```sh
DYNAMICS_URL=https://<registered-sandbox-host> \
DYNAMICS_SANDBOX_URL=https://<registered-sandbox-host> \
DATAVERSE_TARGET_INTERLOCK=on DATAVERSE_DAL_ENFORCEMENT=on \
node scripts/rehearse-test-request-sandbox.mjs \
  --prepare=/private/tmp/writeup-regen-factory-manifest.json \
  --source-request-number=<marked-sandbox-source> \
  --test-label=writeup-regeneration-rehearsal
```

## Bounded operation after review

1. Re-run the exact-name enabled-SystemUser check for both owner-selected
   accounts immediately before applying the reviewed role operation. Pin both
   Dynamics URLs to the registered Sandbox host, retain the target interlock
   and DAL enforcement, and stop if either match is no longer unique/enabled.
   Do not substitute another colleague or a superuser.
2. Apply the reviewed role through `scripts/apply-security-role.js` with the
   exact Sandbox target, role stem, and the two verified SystemUser IDs. The
   command's dry-run is already recorded; execute only after parent review.
   Read back role membership and the six effective privileges before
   publishing the one-program matrix setting with
   `writeFinalWriteupMatrixAudienceConfig(config, null, null)`.
   Re-read the setting and both email-copy keys first; write the matrix only
   while the setting is still absent, and seed each email key only while that
   exact key remains absent. Verify each stored value against the canonical
   seed source. Never overwrite an existing row.
3. Review and execute the prepared v3 Factory manifest through
   `scripts/rehearse-test-request-sandbox.mjs`. The Factory creates the marked
   Request and its unique folder, without copying a document bundle. Record
   before/after evidence in a journal outside source control, including the
   manifest digest, target classification, new Request and location readback,
   and the create receipt. Do not rerun an ambiguous create.
4. Complete only this new Request with the existing guarded Sandbox writer
   seams: create or verify one synthetic PI Contact, ETag-bind it and the
   owner-selected lead Program Director and active broad Grant Program, set
   `akoya_requeststatus='Phase II Pending'` with `grantRequestAdapter.updateById`
   and the freshly read ETag, and read back each exact value. Use a unique
   synthetic Contact email
   under a non-deliverable domain. Do not alter the source Request or an
   existing Request's folder.
5. Put a synthetic, clearly labelled narrative PDF at the exact
   `AI Materials/ProposalNarrative_<request number>.pdf` path in the new
   Request folder. Verify extraction yields at least 60 characters and that
   the Request has exactly one active `akoya_request` location pointing to
   this new folder. Read the account's live program-grant rows and rollups
   again immediately before model execution; any mismatch aborts the run.
6. Use `loadPreSiteVisitInputs`, the governed prompt reader, the standard
   proposal-core producer, renderer, SharePoint upload, and atomic artifact
   writer under `withDalContext`. Never substitute a fixture prompt or model
   result. The bounded scenario is: generate an initial Draft with no reviews;
   promote it through `startSiteVisitStage`; submit one synthetic review using
   the existing supported review path; then regenerate the REVIEW artifact.
   Inject at most one upload failure before the Graph request and retry the
   same frozen operation; the retry must not call the model again. The old
   SharePoint item and current pointer remain until atomic successor
   activation. Verify source hash, successor link, fresh signoffs where
   applicable, and preserved history after readback.
7. For the group leg, create a clearly marked historical Site Visit through
   `saveSiteVisitLogistics` first, using the configured eligible `0/1` state/status
   pair, an explicit synthetic subject/description, an owner-selected actor
   and staff organizer, a fixed past time range, and exact readback of its
   ETag and Request binding. This represents a synthetic rehearsal fixture,
   not a real visit. Then stage the handoff through `stageGroupReviewHandoff`
   with the isolated Postgres ledger and local
   `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS` scoped to the test program. Start
   group review through the existing
   `startFinalWriteup` transition; deliver the staged notice only after
   readback confirms the transition committed. Use the real
   `markFinalWriteupReviewed` service as the selected reviewing colleague on
   the old current Final before regeneration, with process-scoped
   `DYNAMICS_IMPERSONATION_ENABLED=true`, the selected colleague as the actor,
   and the standard `noFallback` path. Verify the Sandbox app privilege
   preflight and actual actor identity; stop if Dataverse denies impersonation.
   Do not persist the flag to shared environment configuration or inject an
   acknowledgement row directly. Then regenerate the paired Pre-Site FINAL
   and Final REVIEW successors; delivery of that replacement notice follows
   activation. Verify both pointers activate atomically, the old acknowledgement
   remains attached to the old Final, and the successor has no acknowledgement
   and still requires fresh signoffs. If the existing impersonation contract
   is denied, report that exact signoff continuity case as unproven and do not
   fabricate it. Do not use the legacy no-schedule compatibility path.
8. Use a newly created local Postgres container/database isolated from the
   existing Factory ledger container on port 5433. Apply the existing migration
   072 only to that new local
   rehearsal database. Bind the existing handoff store SQL to the `pg` client
   using the transparent transport pattern in
   [`final-writeup-handoff-email.pg.test.js`](../../tests/integration/final-writeup-handoff-email.pg.test.js);
   do not point `@vercel/postgres` at a shared environment. Capture every
   email dependency (`createEmailActivity`, `getEmailActivity`,
   `findEmailByCorrelation`, and `sendEmail`) and `NotificationService.notify`.
   Stage and deliver through the real service logic while these dependencies
   record the replacement/fresh-signoff notice locally and perform no real
   email or notification delivery. This is service integration, not a hosted
   route/authentication rehearsal.
9. Persist a provider-request budget outside the process and fence the
   application's actual provider HTTP boundary. Count every request,
   including SDK retries and redirects, accept only the configured application
   provider host, and refuse request four. The intended sequence uses at most
   three application model requests: initial Draft, review-aware regeneration,
   and group-review regeneration. A frozen-output upload retry consumes no
   additional model request. Do not authenticate an agent CLI with provider
   keys or use agent-session credits.

## Evidence, retention, and stop conditions

Keep the Factory manifest, per-write before/after journal, provider budget,
captured notification/email tuples, and readback summary outside source
control. Preserve the original document, its link, snapshots, signoffs, and
distribution history. Leave the marked Sandbox Request, unique folder,
synthetic Contact, narrative, and generated successor artifacts in place as
rehearsal evidence. No automatic cleanup or deletion is part of this run. If a
later rollback is requested, it must use a fresh exact-ID readback and may
remove only this run's journaled test artifacts; never remove or overwrite an
old file, pointer, or history row.

Stop before a write if either selected identity is no longer uniquely enabled;
the role/audience remains unconfigured; the prepared manifest no longer matches
the Sandbox target; the account rollups disagree; the prompt is not uniquely
current; the unique folder/path or file extraction check fails; the selected
Site Visit pair is no longer configured and eligible; an ETag changes; an
email/notification capture seam is absent; or the provider budget cannot be
enforced at the actual outbound boundary. Do not add a route, schema
migration, or production fallback to work around a failed precondition.

## Source contracts

- [`basic-clone-steps.js`](../../lib/services/test-requests/basic-clone-steps.js)
  and [`rehearse-test-request-sandbox.mjs`](../../scripts/rehearse-test-request-sandbox.mjs)
  define the read-only prepare and journaled Sandbox Factory paths.
- [`proposal-core-service.js`](../../lib/services/pre-site-visit/proposal-core-service.js)
  loads the canonical narrative, validates account rollups against live grants,
  and assembles the review roster before the governed prompt call.
- [`artifact-service.js`](../../lib/services/pre-site-visit/artifact-service.js)
  and [`artifact-dependencies.js`](../../lib/services/pre-site-visit/artifact-dependencies.js)
  own the regeneration claim, frozen operation, SharePoint upload, and atomic
  activation seams.
- [`logistics-service.js`](../../lib/services/site-visit/logistics-service.js)
  is the guarded Site Visit writer;
  [`transition-schedule.js`](../../lib/services/final-writeup/transition-schedule.js)
  independently verifies the eligible ended event and ETag before group
  review.
- [`matrix-audience-service.js`](../../lib/services/final-writeup/matrix-audience-service.js)
  fails closed when the Sandbox reviewer role or staffing is missing;
  [`handoff-email-service.js`](../../lib/services/final-writeup/handoff-email-service.js)
  stages and delivers the durable handoff notice through injectable email and
  notification dependencies.
- [`final-writeup-handoff-email.pg.test.js`](../../tests/integration/final-writeup-handoff-email.pg.test.js)
  demonstrates the isolated local SQL transport binding and migration-072
  proof without changing production storage code.
