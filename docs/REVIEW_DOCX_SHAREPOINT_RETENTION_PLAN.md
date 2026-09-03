---
title: "Review DOCX SharePoint Retention and D26 Backfill Plan"
domain: reviewer-workbench
kind: plan
status: active
summary: "Retain structured-review DOCX files in SharePoint after submission and backfill missing D26 files with a dry-run-first, conflict-safe script."
canonical: false
cataloged: 2026-09-03
last_verified: 2026-09-03
owner: product-engineering
related:
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/atlas/dataverse-wmkf-appreviewanswer.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - lib/services/external-review/submit-service.js
  - lib/services/review-manager/manual-review-entry-service.js
  - lib/services/reviewer-thankyou-sweep.js
  - lib/services/review-upload.js
  - lib/services/review-documents/docx-renderer.js
  - scripts/probe-review-blank-slate.mjs
---

# Review DOCX SharePoint Retention and D26 Backfill Plan

## Decision and status

**Status: WAVES 1–2 ARE PRODUCTION-DEPLOYED ON `main` AT `83da197f`; WAVE 3 IS
SOURCE-BUILT, ADVERSARIALLY REVIEWED, AND CLEAN READ-ONLY MANIFEST READY; WAVES 4–5 REMAIN PLANNED. Ready
deployment `dpl_F3oZ9MDbnyFox7S8Ekdos7423ece` contains the filing service and
dedicated cron, but both rollout variables are absent and the route is
Production-proved inert. A clean 24-row Production read-only manifest was
created on 2026-09-03 with 23 eligible reviews and one visible owner-confirmed
test exclusion; no SharePoint or Dataverse mutation has been authorized or
performed.**

The recommended design is to generate and retain one individual DOCX for every
structured review, using the same approved individual template as the thank-you
attachment. Dataverse answer snapshots remain the semantic source of truth. The
SharePoint DOCX is an immutable derived record and staff convenience copy.

The implementation should reuse the existing
`wmkf_appreviewersuggestion.wmkf_reviewsharepointfolder` and
`wmkf_reviewfilename` fields. That immediately activates the existing Reviews-tab
Download action and its guarded server download route. No new document table or
Postgres queue is needed. One dedicated cron route is required so automatic
filing does not extend the reviewer-submission or thank-you-email request.

The current combined **Aggregated Proposal Reviews** export remains unchanged and
on demand. This plan applies only to individual review documents.

## Verified baseline

The following facts were established from current source and read-only Production
probes on 2026-09-03:

| Claim | Producer / entry point | Persistence / source | Consumer | Evidence | Status |
|---|---|---|---|---|---|
| External structured submission atomically stores the receipt and one answer snapshot per question. | `external-review/submit-service.js` | `wmkf_appreviewersuggestion` + `wmkf_appreviewanswer` | Review Manager, report composition, thank-you sweep | Current source and answer Atlas | **VERIFIED** |
| Staff Manual Review Entry uses the same complete snapshot model; `wmkf_reviewuploadedbystaff=true` does not prove a file was uploaded. | `manual-review-entry-service.js` | Same Dataverse rows | Same consumers | Current source; two D26 structured manual entries have this flag and no file pointer | **VERIFIED** |
| The thank-you sweep already renders the approved individual DOCX and attaches it to a Dynamics email. | `reviewer-thankyou-sweep.js` | Transient DOCX bytes; email attachment | Reviewer thank-you email | Current source | **VERIFIED** |
| Structured submission and thank-you generation do not currently retain that DOCX in SharePoint. | Submission services and thank-you sweep | N/A | N/A | Source/caller search; current release docs | **VERIFIED** |
| Uploaded review files use the request library and store folder + filename on the suggestion row. | `review-upload.js` | SharePoint `akoya_request` + suggestion pointer fields | Reviews-tab Download action | Current source, Atlas, and download service | **VERIFIED** |
| Reusing both pointer fields makes the existing Download action available. | Review upload / suggestion adapter | Suggestion pointer fields | `ReviewsTab.js` → existing download route/service | Current source | **VERIFIED** |
| D26 currently has 24 received reviews and 228 answer rows. All 24 are selected, have at least one rich-text answer row, have exact receipt/answer identity parity, and have zero complete or partial SharePoint pointers. This proves current eligibility shape, not merely row-count parity. | Existing structured writers | Production Dataverse | Proposed backfill | Updated `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-review-blank-slate.mjs` | **VERIFIED AS OF 2026-09-03; RECHECK BEFORE EXECUTION** |
| Rendering identical semantic input twice does not produce byte-identical ZIP packages, while the governed Word-part hash is stable. | Current renderer | Generated DOCX package | Retry/conflict logic | Local two-render experiment: raw SHA-256 differed; governed hash matched | **VERIFIED** |
| The thank-you attachment now uses one shared individual-review builder with caller-owned generation time. | `reviewer-thankyou-sweep.js` | Existing answer snapshot + transient DOCX bytes | Thank-you attachment; filing service | Focused builder/thank-you/hash tests, rendered-page inspection, and Ready Production deployment | **PRODUCTION-LIVE AT `83da197f`; TRANSPORT BEHAVIOR UNCHANGED** |
| Automatically retaining future individual DOCX files and backfilling D26 is live. | Dedicated filing service/cron is deployed but disabled; the adversarially reviewed backfill produced a clean schema-v2 Production read-only manifest | Local redacted manifest; no SharePoint/Dataverse write | Existing pointer consumers | Ready deployment plus authenticated flag-off route and maintenance-table before/after probe; Wave 3 source/tests/review; D26 dry run | **PRODUCTION-DEPLOYED INERT; CLEAN MANIFEST 23 ELIGIBLE / 1 VISIBLE TEST EXCLUSION / 0 BLOCKERS; WRITES OPEN** |

### Sweep boundary

This was a Mode B domain truth audit covering the structured-review writers,
answer and reviewer-suggestion persistence, individual renderer, thank-you
consumer, SharePoint upload/download services, current plans, Atlas pages, wiki,
memory, and session handoff. Historical/current statements that say the Wave 25
release performs no SharePoint upload remain correct: they describe the shipped
baseline. This document is the single active forward plan. Its wave statuses
distinguish the Production-deployed inert runtime, source-built backfill, and
still-planned activation work, so it does not rewrite that history as deployed
behavior.

### Adversarial review reconciliation

Claude's read-only review returned **APPROVE WITH CONDITIONS**. Each condition
was then checked against source rather than accepted by assertion:

- **Accepted:** mark-received-without-file can atomically write only rating and
  multiselect rows, so receipt/answer parity alone was insufficient. Rich-text
  presence is now an explicit first-release provenance gate, and the updated
  Production probe proves all 24 current D26 rows meet it.
- **Accepted:** Graph writes are outside the Dataverse target interlock. The plan
  now requires exact SharePoint target identity plus an enforcing Dataverse
  pointer-write preflight before Graph mutation.
- **Accepted with architectural change:** no filing runs inline after submission
  or inside the thank-you cron. A dedicated bounded five-minute cron owns both
  automatic generation and repair.
- **Accepted:** generated pointer metadata must not look like a reviewer upload;
  generated paths receive a stable namespace and explicit consumer handling.
- **Accepted:** a 412 followed by still-null pointers needs one bounded
  fresh-ETag retry; selected/excluded state and cycle derivation are explicit.
- **Accepted simplification:** the governed DOCX hash and reviewer-subfolder
  helpers are already exported. This release does not extract either helper and
  the generated GUID path does not depend on reviewer name.
- **Confirmed safe:** create-only upload, semantic-hash adoption, exact-item
  cleanup, existing Download activation, and scoped remove-entirely cleanup
  remain valid. The generated non-attempt path is handled by the existing
  primary-filename-only deletion policy.

With these amendments, no adversarial condition remains open at the plan layer.
Wave 1's behavior-preserving foundation is source/test/render verified and now
Production-deployed. SharePoint mutation, backfill, and activated automatic
filing behavior remain unproved and separately gated.

Claude's subsequent read-only Wave 2 build review returned **APPROVE WITH
NON-BLOCKING SUGGESTIONS**. The accepted pre-release hardening keeps scheduled
discovery to exact cycle-stamped rows, orders newest receipts first, avoids
flag-off maintenance noise, centralizes actionable status classification, adds
the missing negative-path tests, and documents post-commit verification failure.
That review covered source and local tests only. The later release proved the
Production deployment and disabled-route boundary, but not the guarded write
path.

Claude's read-only Wave 3 build review returned **APPROVE WITH NON-BLOCKING
NOTES**. The accepted remediation keeps the CLI population explicitly limited
to received rows with a missing or partial pointer: a completed pointer pair
leaves later manifests and retries rather than being reported as
`already_filed`. It also binds the tracked Production Dataverse base URL into
the reviewed target, replaces locale-sensitive ordering, preserves every
execution report under a timestamped create-only filename, restores scheduled
classification precedence, and strengthens tests with present confidential
fixtures plus duplicate/cap/blocking/exit-path cases. The interlock's same-day
operator acknowledgement remains a process-wide Production-write exception,
not a record-scoped grant; the service separately asserts every exact suggestion
PATCH target before Graph mutation and again per row. The review and remediation
cover source and local tests only. The separately authorized first Production
dry run then created a redacted 24-row manifest: 23 eligible and one
`invalid_snapshot` on owner-confirmed test Request `1003223`. The replacement
schema-v2 manifest records that exact request as a hash-bound, non-writing
`excluded_test_request`; unmatched exclusions block rather than disappearing
silently. The clean manifest has zero blockers. Every write remains separately
owner-gated.

## Product contract

### Included

1. Automatically generate an individual DOCX shortly after a successful external
   structured review submission, outside the submission request.
2. Do the same after a successful staff Manual Review Entry.
3. Store the generated file in the existing request SharePoint library hierarchy.
4. Persist the existing folder/filename pointers on the reviewer suggestion.
5. Repair missing generated files through a bounded recurring sweep.
6. Backfill eligible reviews for one explicitly named cycle through a standalone,
   dry-run-first script.
7. Preserve the existing combined export and courtesy attachment behavior.

### Excluded

- Uploaded-review ingestion, which already stores the uploaded source file.
- Every `mark received without file` row, including rows with partial rating or
  multiselect snapshots.
- Automatic replacement or reformatting of a file already retained in SharePoint.
- PDF generation, combined-report storage, in-app editing, or a new document
  registry.
- Changes to review questions or answer-snapshot schema.

## Source-of-truth and identity rules

1. **Dataverse remains authoritative.** The DOCX must always be regenerated from
   the suggestion, request, reviewer identity, and self-describing answer snapshot
   rows loaded from Dataverse. Browser-supplied report data is never accepted.
2. **The retained file is derived and immutable.** A later template change does
   not silently replace prior files. Any future explicit regeneration/versioning
   workflow is a separate owner decision.
3. **Existing pointers win.** The shared ensure service reports
   `already_filed` and performs no upload or replacement when invoked for a row
   whose exact pointer pair is already set. The backfill CLI is narrower: its
   missing-file population excludes complete pointer pairs, so completed rows
   leave fresh manifests and retries entirely.
4. **A partial pointer is an anomaly.** Folder-without-filename or
   filename-without-folder must fail for investigation; the service must not guess
   or repair it automatically.
5. **`wmkf_reviewuploadedbystaff` is not an eligibility discriminator.** Manual
   structured entry sets this flag even though no file was uploaded.
6. **One reviewer suggestion is the idempotency identity.** Counts alone never
   establish success; every result and retry is keyed by the suggestion GUID.

## Eligibility contract

A forward or backfill operation is eligible only when all of these hold after a
fresh authoritative read:

- `wmkf_reviewreceivedat` is non-null;
- both existing SharePoint pointer fields are null;
- `wmkf_selected` is exactly `true` and the applicant disposition is not
  Excluded;
- the request and reviewer relationships resolve;
- a non-empty, internally coherent set of self-describing answer snapshot rows
  exists and passes the individual-report input contract;
- for backfill, the server-derived cycle code equals the exact requested cycle.

Completeness must not be inferred from today's editable question definitions.
The structured writers commit the receipt and the full submitted snapshot in one
Dataverse changeset; the reader validates that persisted historical set's own
question keys, order, text, type, option snapshots, and answer shapes.

For the first release, **at least one persisted `richtext` answer row is the
enforced provenance discriminator** between a full external/manual structured
submission and the ratings/multiselect-only rows written by uploaded-review and
mark-received-without-file paths. A received row with no rich-text snapshot is
`not_structured` and skipped even if other answer rows exist. This rule is
version-independent for historical rows, but a future approved question set with
no rich-text questions must deliberately replace the discriminator before it is
published. A malformed or internally inconsistent snapshot is
`invalid_snapshot` and fails visibly; it is not converted into a misleading
file.

For one explicitly addressed row, prefer the suggestion's stamped
`wmkf_grantcyclecode`; when null, derive the request cycle from its meeting date
using the existing cycle helper. This fallback supports the future operator
backfill. Scheduled discovery is narrower: it admits only rows whose stamped
cycle exactly matches the configured automatic cohort. A row with neither source
is `no_cycle` and blocks the manifest for operator resolution. Backfill still
requires an exact caller-supplied cycle match.

## SharePoint destination

Use the existing `akoya_request` document library and the established request and
reviewer path helpers:

```text
{requestNumber}_{REQUEST_GUID_WITHOUT_HYPHENS_UPPER}/
  Reviewer_Uploads/
    Generated/
      {SUGGESTION_GUID_WITHOUT_HYPHENS_UPPER}/
        Review-{requestNumber}.docx
```

This intentionally uses the canonical plural `Reviewer_Uploads` hierarchy so the
existing pointer consumer continues to work, while the explicit `Generated`
namespace cannot collide with uploaded-review `attempt_{uuid}` folders. The full
suggestion GUID makes the path stable across reviewer-name corrections and
process loss. Folder and filename are derived only on the server. Existing
`buildReviewerSubfolder` is already exported and remains unchanged for uploads;
the generated path does not need it.

## Generation service

Wave 1 adds
`lib/services/review-documents/individual-review-builder.js` as the shared
answer-read, composition, filename/content-type, and render seam. It accepts the
authoritative suggestion/request/reviewer context already loaded by its caller
and deliberately requires a caller-supplied generation timestamp.

Wave 2 adds a narrow filing service, for example
`lib/services/review-documents/individual-file-service.js`, around that builder:

1. the filing path freshly reloads the authoritative suggestion, request,
   reviewer, ETag, and answer snapshot context before calling
   `buildIndividualReviewDocx(...)`;
2. `ensureIndividualReviewFile(suggestionId)` applies eligibility, identity,
   conflict, upload, pointer-commit, and reconciliation rules.

The thank-you sweep should use the shared build function for its attachment so
there is one data-loading/composition contract. It must not require SharePoint to
be healthy before sending a thank-you: a new filing outage must not become an
email outage.

For the retained SharePoint copy, use `wmkf_reviewreceivedat` as
`generatedAtIso`. That gives retries a stable, historically meaningful timestamp.
The thank-you attachment must continue to receive its current send-time value so
sharing the builder does not change the already shipped attachment semantics.

### Semantic content identity

Raw DOCX bytes cannot be used for idempotency because ZIP entry timestamps differ
between otherwise identical renders. For the first release, import the already
exported `hashGovernedDocxContent` directly from
`initial-assessment/artifact-service.js`; do not extract or rename it. Existing
Pre-Site, Site Visit, distribution, controls, reopen, Final Writeup, and Initial
Assessment consumers make extraction a broader contract change with no benefit
required for this feature. Map an invalid/non-DOCX item at the target path to
`content_conflict` rather than leaking the helper's Initial-Assessment-branded
exception.

### Create-only and recovery algorithm

For one eligible suggestion:

1. Reload the suggestion, ETag, request, reviewer, and answer rows.
2. Render with the stable receipt timestamp and calculate the semantic hash.
3. Derive the exact server-owned path and filename.
4. Resolve and assert the exact SharePoint site/drive and the intended Dataverse
   pointer-write target **before any Graph mutation**.
5. Read the exact target path.
6. If absent, upload with `conflictBehavior: 'fail'`; never use `replace`.
7. If the path exists, or a competing create returns a conflict, download that
   exact item and compare semantic hashes.
8. If hashes match, reuse the existing item. If they differ, return
   `content_conflict`; never overwrite or delete the existing item.
9. Patch both pointer fields using the fresh suggestion ETag.
10. On a 412/lost response, reread the suggestion. Exact pointers mean success;
    different non-null pointers mean `pointer_conflict`; both pointers still null
    means retry the pointer PATCH once with the fresh ETag and the same already
    resolved item. A second conflict fails visibly without another upload.
11. If this invocation created a unique item but loses the pointer race, delete
    only that exact item by stable drive/item ID. Never delete a pre-existing
    candidate. A cleanup failure must be logged with the exact stable identity for
    operator action.
12. Reread pointer fields and Graph metadata before returning success.

If step 12 fails after the pointer commit, return `verification_failed` and
raise the deduplicated operational event. The complete durable pointer makes the
next ordinary sweep return `already_filed`, so this post-commit anomaly requires
operator verification/resolution; the automatic path must not rewrite or delete
the retained file merely to clear the event.

`GraphService.deleteFile` already treats a missing item (404) as successful
cleanup, so exact-item cleanup is safely repeatable.

Return a structured per-suggestion result containing the suggestion ID, status,
expected folder/filename, item identity and semantic hash when available, and a
bounded error code/message. Do not log review answers or document contents.

## SharePoint target/write guard

The Dataverse target interlock does not inspect Microsoft Graph calls. Therefore
the filing service needs an explicit review-document preflight before step 6:

1. `REVIEW_DOCX_SHAREPOINT_WRITE` must equal literal `on`.
2. `DATAVERSE_TARGET_INTERLOCK` must resolve to `on`; `off` or `warn` is not
   sufficient for this writer.
3. The configured SharePoint URL must exactly match the tracked canonical
   akoyaGO site URL, not merely an allowlisted tenant hostname.
4. Resolve and return the site ID and `akoya_request` drive ID; execution uses
   only those asserted identities. The backfill manifest records both plus the
   exact tracked Production Dataverse base URL.
5. Before Graph upload, call the existing Dataverse interlock for the exact
   intended suggestion-pointer PATCH URL and method, once for the reviewed write
   set and again immediately before each row's mutation sequence. This proves a
   local Production backfill has a valid same-day
   `DATAVERSE_PROD_WRITE_ACK` before the file can be created. The acknowledgement
   is a blanket local-process exception for Production Dataverse writes, not a
   record-scoped authorization; exact row scope comes from these asserted URLs
   and the hash-bound manifest.
6. Scheduled automatic filing is allowed only from a Production deployment.
   Preview, test, and ordinary local runtime calls fail closed even if the feature
   flag is accidentally enabled. The operator backfill is the sole local
   exception and must satisfy its manifest and acknowledgement contract.

A noncanonical site, a backfill site/drive/Dataverse mismatch against its
manifest, a non-Production Dataverse target, non-enforcing Dataverse interlock,
non-Production scheduled deployment, or missing local Production
acknowledgement is a pre-mutation hard failure. Tests must prove
`GraphService.uploadFile` is not reached.

## Automatic filing route

Add a non-sensitive literal-on rollout flag:

```text
REVIEW_DOCX_SHAREPOINT_WRITE=on
REVIEW_DOCX_SHAREPOINT_CYCLE=D26
```

Unset, empty, or any value other than literal `on` skips forward filing before a
maintenance run or any candidate/Graph read. Add the flag to the tracked
environment contract before deployment. The automatic cron also requires one
exact valid cycle code and discovers only suggestions carrying that exact cycle
stamp. This prevents activation from unexpectedly filing older historical
cohorts; advancing the automatic cycle is a deliberate configuration change.
The operator backfill continues to use its explicit `--cycle` manifest and may
apply the request-meeting-date fallback during per-row validation.

Add a dedicated CRON-secret-guarded route, for example
`pages/api/cron/file-review-docx.js`, scheduled every five minutes. It calls
`sweepMissingIndividualReviewFiles` inside its own trusted DAL context. This is
both the normal automatic producer and the repair path: successful submissions
become eligible through their atomic Dataverse receipt, and the next sweep files
them without extending or changing either submission response.

Do **not** call filing from the external submit service, Manual Review Entry,
`review-upload.js`, mark-received-without-file, or the thank-you cron. This avoids
unawaited work, misleading post-commit submission failures, external-path DAL
context ambiguity, and competition with the thank-you claim/send time budget.

The dedicated route should have an explicit 300-second function duration, a
conservative attempt cap, sequential or very low concurrency, and an overall
deadline that refuses to begin another item without enough remaining Graph
budget. Its sweep should:

- discover rich-text-bearing, received, selected, non-excluded, no-pointer
  candidates rather than every received row;
- apply the same eligibility and ensure service, never a second implementation;
- order exact cycle-stamped candidates newest-first, use separate scan/attempt
  caps, and continue past ineligible rows so historical anomalies cannot starve
  later submissions;
- continue after individual failures and report per-ID results;
- leave partial pointers and content conflicts untouched; and
- run only when the same literal-on flag is enabled.

Null pointers are the durable pending signal only after the eligibility filter is
applied. The result must retain stable per-ID classifications such as
`not_structured`, `not_selected`, `excluded`, `no_cycle`, `invalid_snapshot`,
`content_conflict`, and `partial_pointer`. Expected skips are summarized
compactly; actionable repeated failures use the existing deduplicated operational
event mechanism rather than noisy full-content logs. Do not promise that every
healthy run is silent while unresolved anomalies remain.

A new Postgres queue is not required for this first release. If Production volume
or recovery latency later outgrows the bounded cron, reassess a durable queue
explicitly rather than adding one preemptively.

## Pointer consumer semantics

Both pointer fields remain the storage contract, but generated metadata must not
be presented as if the reviewer uploaded a file:

- external context suppresses `submission.filename` only for the server-recognized
  generated namespace; every existing non-generated/legacy pointer retains its
  current display behavior, while a generated path remains hidden in the
  reviewer's received notice;
- the Reviews tab labels an `attempt_{uuid}` path with
  `wmkf_reviewuploadedbystaff=true` as **staff upload** and a generated path with
  that flag as **staff entry**, rather than treating every staff-entered review as
  an upload; and
- the existing staff download service continues to require and use both exact
  pointer fields.

Use one tested server/shared path classifier for these consumer distinctions; do
not let the browser infer provenance from an arbitrary filename.

## D26 backfill script

The source-built operator entry point is
`scripts/backfill-review-docx-sharepoint.mjs`. It uses the same ensure service
as forward generation and is safe by default.

### Interface

```text
node scripts/backfill-review-docx-sharepoint.mjs --cycle D26
node scripts/backfill-review-docx-sharepoint.mjs --cycle D26 --request-number 1002903
node scripts/backfill-review-docx-sharepoint.mjs --cycle D26 --exclude-test-request 1003223
node scripts/backfill-review-docx-sharepoint.mjs --cycle D26 --execute --manifest <path>
```

- `--cycle` is required and exact; never infer "current cycle."
- Dry run is the default.
- Writes require both `--execute` and a previously generated manifest.
- `--request-number` supports a one-review controlled smoke.
- Repeatable dry-run-only `--exclude-test-request` requires an exact numeric
  request number confirmed by the owner as test data. The row remains visible
  with its original classification inside the hash-bound manifest; an unmatched,
  duplicate, malformed, or request-scope-conflicting exclusion fails closed.
- There is no `--force` or overwrite mode.
- Manifest and timestamped execution-result files are created with exclusive
  filesystem semantics; an existing artifact is never overwritten.
- Execution requires `DATAVERSE_TARGET_INTERLOCK=on`, the repository's same-day
  `DATAVERSE_PROD_WRITE_ACK`, the literal-on review-DOCX flag, and the exact
  Production Dataverse plus SharePoint target check. These are asserted before
  any Graph write.

### Dry-run manifest

The manifest contains no answer text or document body. For every candidate it
records:

- reviewer suggestion GUID and ETag/source fingerprint;
- request GUID and request number;
- receipt timestamp and exact cycle;
- selected/disposition state and rich-text presence;
- eligibility classification;
- expected folder and filename;
- semantic document hash for eligible rows;
- the exact canonical SharePoint URL, resolved site and drive IDs, and tracked
  Production Dataverse base URL;
- whether an item already exists at the exact path and, if so, its stable metadata
  and semantic match result; and
- a digest of the ordered candidate population.

The source fingerprint includes every field that changes rendered content or
identity, including reviewer display name/title/affiliation, request metadata,
receipt time, and the ordered answer snapshots. A corrected reviewer identity or
proposal label therefore invalidates a stale manifest before execution.

Dry run exits nonzero for partial pointers, target-content conflicts, invalid
snapshots, duplicate identities, missing cycles, missing rows, or unresolved
relationships. It can report reviewed nonblocking ineligible legacy rows without
treating them as writes.

### Execute and partial-success behavior

Before the first write, execute must reread the population and source fingerprints
and compare them with the manifest. Any drift aborts the run before mutation.

Process conservatively and report each manifest suggestion as `created`,
`reconciled`, `skipped`, or `failed`. Continue after a row-specific failure, but
exit nonzero if any row failed. A retry uses a fresh manifest and targets only
still-missing suggestions; completed rows have left the population and are not
re-audited by this missing-file command.

The same-day acknowledgement is reasserted before each pointer target. If UTC
midnight falls between a successful Graph upload and pointer PATCH, the
interlock can deny the PATCH and leave a create-only orphan for the next fresh
manifest to reconcile. If exact-item cleanup itself fails, the shared service
records a bounded Postgres operational event; that telemetry write is outside
the Dataverse interlock and contains identifiers/error codes, not review
content.

After every apparent success, reread both Dataverse pointer fields, Graph stable
metadata, and the downloaded semantic hash. Count-only or upload-response-only
verification is insufficient.

The final dry run must show zero eligible missing rows, zero partial pointers,
zero divergent collisions, and no duplicate generated paths. The dated 24-review
D26 count is evidence for planning only and must never be hardcoded.

## Verification matrix

### Focused automated tests

- Stable semantic hash across two renders whose raw bytes differ.
- Existing Initial Assessment and all current governed-hash consumer suites
  remain unchanged; no helper extraction occurs in this release.
- Eligibility: rich-text-bearing structured/no-pointer eligible; the shared
  ensure service skips a complete pointer while the backfill manifest omits it;
  partial pointer fails; ratings/multiselect-only mark-received fixture skipped;
  no-answer receipt skipped; malformed snapshot fails.
- Manual structured rows are eligible even when
  `wmkf_reviewuploadedbystaff=true`.
- `wmkf_selected=false`, excluded-disposition, and null-cycle fixtures follow the
  explicit skip policy; suggestion-cycle and request-cycle fallback are tested.
- Deterministic GUID-only generated path/filename remains stable across reviewer
  name corrections; legacy upload folder derivation is unchanged.
- The SharePoint target guard denies Preview/local scheduled writes, a
  noncanonical site, backfill site/drive drift, interlock `off`/`warn`, and a
  missing local Production acknowledgement before Graph upload.
- The automatic sweep fails closed when its exact cycle setting is absent,
  malformed, or does not match a candidate; an explicit backfill cycle does not
  broaden automatic eligibility.
- Create-only upload; matching pre-existing content reconciles; mismatched content
  or non-DOCX content never overwrites and maps to `content_conflict`.
- Pointer 412: exact winner succeeds, null-pointer reread retries once, divergent
  winner conflicts, and cleanup can delete only the exact newly created item;
  repeated cleanup accepts a 404.
- External and manual submission services are byte-behavior unchanged and make
  no filing call.
- Dedicated filing cron is independent of thank-you marker state, cannot invoke
  the thank-you sweep, respects scan/attempt/time caps, and cannot let a failing
  first row starve all later candidates.
- Generated filenames stay hidden in the external received notice; staff-upload
  versus staff-entry labels use the trusted path classifier.
- Backfill dry-run default, required exact cycle, manifest drift abort, per-row
  partial success, nonzero failure exit, create-only timestamped result artifact,
  host-independent ordering, duplicate-union/capped-batch handling, and clean
  rerun. Redaction fixtures must contain answer text and DOCX bytes that would
  leak if the allowlist projection were removed.
- Existing review upload, remove-entirely cleanup, Reviews-tab download, and
  combined export tests stay green.

### Document and end-to-end proof

1. Render representative external and manual individual reviews and inspect every
   page, including the approved blank line below the header.
2. In tests/mocks, prove upload, exact retry, collision, lost response, 412,
   cleanup, and target-denial behavior. Preview must prove fail-closed and perform
   no SharePoint write.
3. In Production with the runtime flag still off, generate a fresh D26 dry-run
   manifest and reconcile it to the read-only probe.
4. After explicit owner approval, run one manifest-selected review as the write
   smoke.
5. Verify its Graph drive/item identity, downloaded semantic hash, Dataverse
   pointers, and staff Reviews-tab Download action.
6. Scan bounded Production dependency/error logs.
7. After separate approval, execute the remainder against a fresh manifest.
8. Rerun dry-run and prove zero missing/partial/divergent/duplicate results.
9. Enable the dedicated Production filing cron deliberately, then verify the next
   natural structured submission is retained within the scheduled interval
   without changing its submission response or thank-you state.

The repository's reviewer sandbox does not reproduce the full live review schema,
so it can prove route/auth mechanics but is not a substitute for the controlled
Production SharePoint write proof.

## Required gates

Run affected focused tests first, then the following applicable gates. Every gate
with a self-test runs sequentially with its self-test:

- `npm run check:dataverse-access-layer` then its self-test;
- `npm run check:dynamics-context-boundary` then its self-test;
- `npm run check:api-routes` then its self-test after adding the cron route and
  its persistence-matrix entry;
- `npm run check:atlas` then its self-test after Atlas updates;
- `npm run check:fact-consistency` then its self-test for retained live-count or
  rollout facts;
- `npm run check:docs-catalog`;
- `npm run check:agent-invariants`;
- `npm run check:types`;
- `npm run build`; and
- `git diff --check`.

## Delivery waves and approval boundaries

### Wave 1 — Shared, behavior-preserving foundations

**Status: COMPLETE AND PRODUCTION-LIVE ON `main` AT `83da197f` (2026-09-03).**

- Claude's reviewer thank-you honorarium-copy feature landed on `main` at
  `41326cf5`; this branch was rebased onto it before the shared service changed.
- The approved individual-template header-spacing change is present.
- The existing governed DOCX hash is characterized through its current export
  without extraction; raw-distinct individual renders produce the same governed
  hash.
- `individual-review-builder.js` now owns the shared answer-read → compose →
  render contract. The thank-you sweep passes its existing send-time `nowIso`,
  preserves attachment-before-claim ordering, and retains Claude's
  `wmkf_honorariumoptout` projection and `honorariumOptOut` email pass-through.

**Gate: PASSED** — focused regression tests and one-page rendered inspection are
clean. No SharePoint call, pointer write, route, cron, or rollout flag was added.

### Wave 2 — Filing service and dedicated cron, flag off

- Implement eligibility, create-only upload, semantic reconciliation, ETag pointer
  commit, exact cleanup, target guards, telemetry, structured results, and the
  bounded dedicated filing/repair sweep.
- Add the dedicated five-minute cron behind the literal-on flag; do not modify the
  submission or thank-you execution paths to perform filing.
- Correct the external filename and staff upload/entry consumer semantics.
- Update Atlas, route persistence matrix if applicable, environment contract, and
  tests.

**Gate: PASSED.** Adversarial review and all relevant source/test/build gates
passed. Ready Production deployment `dpl_F3oZ9MDbnyFox7S8Ekdos7423ece` contains
the route with both rollout variables absent. An authenticated GET returned the
exact disabled response before persistence, and the `file-review-docx`
maintenance-run population remained zero before and after.

**Status: PRODUCTION-DEPLOYED INERT ON `main` AT `83da197f` (2026-09-03).** The dedicated guarded
service/cron, create-only Graph path, semantic hash reconciliation, bounded ETag
pointer recovery, safe exact-item cleanup, per-row telemetry/results, and shared
pointer-provenance consumer semantics are implemented with focused tests. The
scheduled scan is exact-stamp-only and newest-first; a disabled route creates no
maintenance row. Claude returned APPROVE WITH NON-BLOCKING SUGGESTIONS, and the
accepted pre-release hardening is incorporated. The rollout/cycle flags remain
absent in Production; no Graph or Dataverse pointer write occurred. The guarded
mutation path is therefore not Production-proved. Wave 3 backfill code is built
on `codex/review-docx-wave3-backfill` with focused tests. Claude's Wave 3
adversarial review returned APPROVE WITH NON-BLOCKING NOTES; the accepted
remediation is incorporated on the feature branch. The first Production
read-only run found one owner-confirmed test request; the replacement schema-v2
manifest records its explicit exclusion, has zero blockers, and performed no
mutation.

### Wave 3 — D26 dry run and one-file proof

**Status: CLEAN PRODUCTION READ-ONLY MANIFEST CREATED; AWAITING MANIFEST REVIEW
AND SEPARATE ONE-WRITE APPROVAL.**

- [x] Build the dry-run-first backfill script using the same ensure service.
- [x] Complete the read-only adversarial review and incorporate its accepted
  contract, target-binding, determinism, artifact-preservation, and test
  hardening.
- [x] Produce the first D26 manifest and identify owner-confirmed test Request
  `1003223` as the sole blocker.
- [x] Record that exact test request as an explicit hash-bound exclusion and
  produce a clean schema-v2 manifest: 23 eligible, one test exclusion, zero
  blockers, and zero existing generated items.
- Review the clean manifest and select one exact eligible smoke target.
- Stop for explicit approval of one exact write target.
- Execute and verify one review end to end.

**Gate:** Graph + Dataverse + Workbench readback and bounded logs.

### Wave 4 — D26 completion

- Produce another fresh manifest.
- Stop for explicit approval of the remaining bounded write set.
- Execute, reconcile every suggestion identity, and prove a clean rerun.

### Wave 5 — Forward activation

- Enable `REVIEW_DOCX_SHAREPOINT_WRITE=on` deliberately.
- Verify the dedicated cron files the next natural external or manual structured
  submission within the scheduled interval.
- Confirm a no-work run performs no writes; unresolved anomalies remain compactly
  classified and deduplicated rather than falsely described as silent.

## Stop conditions

Stop before writes or further rollout if any of the following appears:

- a partial existing pointer;
- a file at the expected path with a different semantic hash;
- manifest population/source drift;
- missing or invalid answer snapshots;
- a ratings/multiselect-only snapshot, unselected/excluded row, or unresolved
  cycle;
- unresolved request/reviewer identity;
- `DATAVERSE_TARGET_INTERLOCK` is not enforcing, the scheduled caller is not a
  Production deployment, the configured SharePoint site is not the canonical
  site, the backfill Dataverse target is not the tracked Production instance,
  or a backfill's resolved site/drive/Dataverse base differs from its manifest;
- any attempt would overwrite or broadly delete an existing SharePoint item;
- the one-file smoke cannot be verified by stable identity, content, Dataverse
  pointers, and the staff download path.

## Sweep report

```text
Sweep mode: Mode B domain truth audit plus Mode A Wave 3 dry-run reconciliation
Domain: structured individual review DOCX generation and SharePoint retention
Claims: Waves 1–2 implementation and flag-off Production deployment VERIFIED;
  Wave 3 backfill SOURCE/FOCUSED-TEST/ADVERSARIAL-REVIEW VERIFIED and clean
  Production read-only schema-v2 manifest VERIFIED; execution, activation, and
  Production write behavior UNPROVED
Durable restatements: current no-upload statements remain accurate historical/current baseline
Structural fix: reconciled plan/catalog/Atlas/runbook/handoff to the Ready inert
  release while preserving the separate activation and write-proof gates
Semantic omissions found: operator-confirmed test data needed an explicit,
  reviewable, hash-bound exclusion contract rather than relaxed validation or a
  silent population filter
Remaining live STALE: 0 within this plan's stated scope
Remaining UNKNOWN/ASSUMED: all Production write behavior remains unproved
Verdict: WAVES 1–2 PRODUCTION-DEPLOYED INERT; WAVE 3 CLEAN MANIFEST READY;
  ALL WRITES REMAIN GATED
```
