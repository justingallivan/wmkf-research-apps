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

**Status: PLANNED. No automatic SharePoint write or historical backfill described
here has been implemented or authorized for execution.**

The recommended design is to generate and retain one individual DOCX for every
structured review, using the same approved individual template as the thank-you
attachment. Dataverse answer snapshots remain the semantic source of truth. The
SharePoint DOCX is an immutable derived record and staff convenience copy.

The implementation should reuse the existing
`wmkf_appreviewersuggestion.wmkf_reviewsharepointfolder` and
`wmkf_reviewfilename` fields. That immediately activates the existing Reviews-tab
Download action and its guarded server download route; no new document table,
Postgres queue, API route, or UI feature is needed for the first release.

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
| D26 currently has 22 received reviews, 210 answer rows, exact identity parity between received suggestions and answer-bearing suggestions, and zero complete or partial SharePoint pointers. | Existing structured writers | Production Dataverse | Proposed backfill | `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-review-blank-slate.mjs` | **VERIFIED AS OF 2026-09-03; RECHECK BEFORE EXECUTION** |
| Rendering identical semantic input twice does not produce byte-identical ZIP packages, while the governed Word-part hash is stable. | Current renderer | Generated DOCX package | Retry/conflict logic | Local two-render experiment: raw SHA-256 differed; governed hash matched | **VERIFIED** |
| Automatically retaining future individual DOCX files and backfilling D26 is live. | N/A | N/A | N/A | No implementation exists yet | **PLANNED** |

### Sweep boundary

This was a Mode B domain truth audit covering the structured-review writers,
answer and reviewer-suggestion persistence, individual renderer, thank-you
consumer, SharePoint upload/download services, current plans, Atlas pages, wiki,
memory, and session handoff. Historical/current statements that say the Wave 25
release performs no SharePoint upload remain correct: they describe the shipped
baseline. This document is the single forward plan and is explicitly marked
`PLANNED`, so it does not rewrite that history as deployed behavior.

## Product contract

### Included

1. Generate an individual DOCX after a successful external structured review
   submission.
2. Generate an individual DOCX after a successful staff Manual Review Entry.
3. Store the generated file in the existing request SharePoint library hierarchy.
4. Persist the existing folder/filename pointers on the reviewer suggestion.
5. Repair missing generated files through a bounded recurring sweep.
6. Backfill eligible reviews for one explicitly named cycle through a standalone,
   dry-run-first script.
7. Preserve the existing combined export and courtesy attachment behavior.

### Excluded

- Uploaded-review ingestion, which already stores the uploaded source file.
- `mark received without file` rows that do not have a structured answer snapshot.
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
3. **Existing pointers win.** If both SharePoint pointer fields are already set,
   the service reports `already_filed` and performs no upload or replacement.
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
- the request and reviewer relationships resolve;
- a non-empty, internally coherent set of self-describing answer snapshot rows
  exists and passes the individual-report input contract;
- the suggestion is not excluded or otherwise outside the submitted-review
  lifecycle; and
- for backfill, the server-derived cycle code equals the exact requested cycle.

Completeness must not be inferred from today's editable question definitions.
The structured writers commit the receipt and the full submitted snapshot in one
Dataverse changeset; the reader validates that persisted historical set's own
question keys, order, text, type, option snapshots, and answer shapes. A received
row with no structured snapshot is `not_structured` and skipped. A malformed or
internally inconsistent snapshot is `invalid_snapshot` and fails visibly; it is
not converted into a misleading file.

## SharePoint destination

Use the existing `akoya_request` document library and the established request and
reviewer path helpers:

```text
{requestNumber}_{REQUEST_GUID_WITHOUT_HYPHENS_UPPER}/
  Reviewer_Uploads/
    {sanitizedReviewerLastName}_{shortSuggestionId}/
      Review-{requestNumber}.docx
```

This intentionally uses the canonical plural `Reviewer_Uploads` hierarchy so the
existing pointer consumer continues to work. Generated records do not use an
`attempt_{uuid}` subfolder: the suggestion-specific reviewer folder already gives
the generated artifact a unique, stable destination. Folder and filename are
derived only on the server.

Before implementation, move the existing reviewer-subfolder builder into a narrow
shared helper used unchanged by both uploaded and generated review paths. Its
characterization tests must prove byte-identical paths for existing uploads.

## Generation service

Add a narrow service, for example
`lib/services/review-documents/individual-file-service.js`, with two layers:

1. `buildIndividualReviewDocx(suggestionId)` performs the authoritative reads,
   composes the current individual report, and renders the DOCX.
2. `ensureIndividualReviewFile(suggestionId)` applies eligibility, identity,
   conflict, upload, pointer-commit, and reconciliation rules.

The thank-you sweep should use the shared build function for its attachment so
there is one data-loading/composition contract. It must not require SharePoint to
be healthy before sending a thank-you: a new filing outage must not become an
email outage.

Use `wmkf_reviewreceivedat` as `generatedAtIso`. That gives regenerated documents
a stable, historically meaningful timestamp instead of retry time.

### Semantic content identity

Raw DOCX bytes cannot be used for idempotency because ZIP entry timestamps differ
between otherwise identical renders. Extract the existing proven governed Word
content-hash implementation from
`initial-assessment/artifact-service.js` into a narrowly shared document helper,
for example `lib/services/documents/governed-docx-hash.js`. Preserve its current
canonicalization and re-export/import it without behavior change for Initial
Assessment. The review service uses the same semantic hash over governed `word/*`
parts.

This helper extraction is a contract-sensitive change: characterization tests for
all existing Initial Assessment hash cases must stay green before review filing is
added.

### Create-only and recovery algorithm

For one eligible suggestion:

1. Reload the suggestion, ETag, request, reviewer, and answer rows.
2. Render with the stable receipt timestamp and calculate the semantic hash.
3. Derive the exact server-owned path and filename.
4. Read the exact target path.
5. If absent, upload with `conflictBehavior: 'fail'`; never use `replace`.
6. If the path exists, or a competing create returns a conflict, download that
   exact item and compare semantic hashes.
7. If hashes match, reuse the existing item. If they differ, return
   `content_conflict`; never overwrite or delete the existing item.
8. Patch both pointer fields using the fresh suggestion ETag.
9. On a 412/lost response, reread the suggestion. Exact pointers mean success;
   different pointers mean `pointer_conflict` and must not be overwritten.
10. If this invocation created a unique item but lost the pointer race, delete
    only that exact item by stable drive/item ID. Never delete a pre-existing
    candidate. A cleanup failure must be logged with the exact stable identity for
    operator action.
11. Reread pointer fields and Graph metadata before returning success.

Return a structured per-suggestion result containing the suggestion ID, status,
expected folder/filename, item identity and semantic hash when available, and a
bounded error code/message. Do not log review answers or document contents.

## Forward submission wiring

Add a non-sensitive literal-on rollout flag:

```text
REVIEW_DOCX_SHAREPOINT_WRITE=on
```

Unset, empty, or any value other than literal `on` skips forward filing. Add the
flag to the tracked environment contract before deployment.

After the atomic Dataverse submission is committed, both structured writers call
`ensureIndividualReviewFile(suggestionId)` inside the existing trusted DAL
context. The call is awaited; do not use fire-and-forget work. A filing failure is
recorded and returned to server telemetry but does **not** roll back or misreport
the already accepted review. Preserve the public external response contract.

The Graph upload has a current 60-second bound. Focused tests and Preview timing
must verify that post-commit filing does not exceed the submission route budget or
produce a misleading client failure. If that budget is not acceptable, stop and
move the immediate attempt to a durable job design; do not hide it in unawaited
server work.

Do not invoke generated filing from `review-upload.js` or the mark-received-no-file
path.

## Automatic repair without new durable infrastructure

Add a bounded `sweepMissingIndividualReviewFiles` pass to the beginning of the
existing daily reviewer thank-you cron, independent of thank-you marker state.
This provides automatic recovery when a post-commit attempt fails and includes
reviews that were already thanked.

The sweep should:

- discover only received, no-pointer candidates;
- apply the same eligibility and ensure service, never a second implementation;
- use a conservative per-run cap and low concurrency;
- continue after individual failures and report per-ID results;
- leave partial pointers and content conflicts untouched; and
- run only when the same literal-on flag is enabled.

Null pointers are the durable pending signal, so a new Postgres queue is not
required for this first release. If Production volume or recovery latency later
outgrows the bounded cron, reassess a durable queue explicitly rather than adding
one preemptively.

## D26 backfill script

Add `scripts/backfill-review-docx-sharepoint.mjs` as an operator-only script. It
must use the same service as forward generation and be safe by default.

### Interface

```text
node scripts/backfill-review-docx-sharepoint.mjs --cycle D26
node scripts/backfill-review-docx-sharepoint.mjs --cycle D26 --request-number 1002903
node scripts/backfill-review-docx-sharepoint.mjs --cycle D26 --execute --manifest <path>
```

- `--cycle` is required and exact; never infer "current cycle."
- Dry run is the default.
- Writes require both `--execute` and a previously generated manifest.
- `--request-number` supports a one-review controlled smoke.
- There is no `--force` or overwrite mode.
- Production reads/writes continue to require the repository's explicit target
  and interlock controls; the script must not bypass them.

### Dry-run manifest

The manifest contains no answer text or document body. For every candidate it
records:

- reviewer suggestion GUID and ETag/source fingerprint;
- request GUID and request number;
- receipt timestamp and exact cycle;
- eligibility classification;
- expected folder and filename;
- semantic document hash for eligible rows;
- whether an item already exists at the exact path and, if so, its stable metadata
  and semantic match result; and
- a digest of the ordered candidate population.

Dry run exits nonzero for partial pointers, target-content conflicts, invalid
snapshots, duplicate identities, or unresolved relationships. It can report
ineligible legacy rows without treating them as writes.

### Execute and partial-success behavior

Before the first write, execute must reread the population and source fingerprints
and compare them with the manifest. Any drift aborts the run before mutation.

Process conservatively and report each suggestion as `created`, `reconciled`,
`already_filed`, `skipped`, or `failed`. Continue after a row-specific failure,
but exit nonzero if any row failed. A retry uses a fresh manifest and targets only
still-missing suggestions; completed rows are idempotent no-ops.

After every apparent success, reread both Dataverse pointer fields, Graph stable
metadata, and the downloaded semantic hash. Count-only or upload-response-only
verification is insufficient.

The final dry run must show zero eligible missing rows, zero partial pointers,
zero divergent collisions, and no duplicate generated paths. The dated 22-review
D26 count is evidence for planning only and must never be hardcoded.

## Verification matrix

### Focused automated tests

- Stable semantic hash across two renders whose raw bytes differ.
- Existing Initial Assessment governed-hash cases remain unchanged after helper
  extraction.
- Eligibility: structured/no-pointer eligible; complete pointer skipped; partial
  pointer fails; no-answer receipt skipped; malformed snapshot fails.
- Manual structured rows are eligible even when
  `wmkf_reviewuploadedbystaff=true`.
- Deterministic path/filename and unchanged legacy upload folder derivation.
- Create-only upload; matching pre-existing content reconciles; mismatched content
  never overwrites.
- Pointer 412: exact winner succeeds, divergent winner conflicts, and cleanup can
  delete only the exact newly created item.
- External and manual post-commit filing failures do not undo or misreport the
  stored review.
- SharePoint filing failure does not prevent the existing thank-you attachment.
- Repair sweep is independent of thank-you marker state and respects its cap.
- Backfill dry-run default, required exact cycle, manifest drift abort, per-row
  partial success, nonzero failure exit, and clean rerun.
- Existing review upload, remove-entirely cleanup, Reviews-tab download, and
  combined export tests stay green.

### Document and end-to-end proof

1. Render representative external and manual individual reviews and inspect every
   page, including the approved blank line below the header.
2. In Preview/mocks, prove upload, exact retry, collision, lost response, 412, and
   cleanup behavior.
3. In Production with the runtime flag still off, generate a fresh D26 dry-run
   manifest and reconcile it to the read-only probe.
4. After explicit owner approval, run one manifest-selected review as the write
   smoke.
5. Verify its Graph drive/item identity, downloaded semantic hash, Dataverse
   pointers, and staff Reviews-tab Download action.
6. Scan bounded Production dependency/error logs.
7. After separate approval, execute the remainder against a fresh manifest.
8. Rerun dry-run and prove zero missing/partial/divergent/duplicate results.
9. Enable forward filing deliberately, then verify the next natural structured
   submission and the repair sweep.

The repository's reviewer sandbox does not reproduce the full live review schema,
so it can prove route/auth mechanics but is not a substitute for the controlled
Production SharePoint write proof.

## Required gates

Run affected focused tests first, then the following applicable gates. Every gate
with a self-test runs sequentially with its self-test:

- `npm run check:dataverse-access-layer` then its self-test;
- `npm run check:dynamics-context-boundary` then its self-test;
- `npm run check:request-document-writers` then its self-test if the new writer is
  registered by that gate;
- `npm run check:api-routes` then its self-test after persistence/matrix updates;
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

- Land the approved individual-template header-spacing change before generating
  retained files.
- Extract and characterize the governed DOCX hash helper.
- Share the reviewer folder and individual document build helpers without changing
  upload, export, or email behavior.

**Gate:** focused regression tests and rendered-page inspection.

### Wave 2 — Filing service and automatic repair, flag off

- Implement eligibility, create-only upload, semantic reconciliation, ETag pointer
  commit, exact cleanup, telemetry, structured results, and bounded repair sweep.
- Wire external/manual post-commit calls and thank-you-cron repair behind the
  literal-on flag.
- Update Atlas, route persistence matrix if applicable, environment contract, and
  tests.

**Gate:** adversarial review, all relevant gates, Preview/mock verification, and a
Ready Production deployment with the flag off.

### Wave 3 — D26 dry run and one-file proof

- Build the dry-run-first backfill script using the same ensure service.
- Produce a fresh D26 manifest in Production.
- Stop for explicit approval of one exact write target.
- Execute and verify one review end to end.

**Gate:** Graph + Dataverse + Workbench readback and bounded logs.

### Wave 4 — D26 completion

- Produce another fresh manifest.
- Stop for explicit approval of the remaining bounded write set.
- Execute, reconcile every suggestion identity, and prove a clean rerun.

### Wave 5 — Forward activation

- Enable `REVIEW_DOCX_SHAREPOINT_WRITE=on` deliberately.
- Verify the next natural external or manual structured submission.
- Confirm the repair sweep stays quiet when nothing is missing and reports only
  actionable failures.

## Stop conditions

Stop before writes or further rollout if any of the following appears:

- a partial existing pointer;
- a file at the expected path with a different semantic hash;
- manifest population/source drift;
- missing or invalid answer snapshots;
- unresolved request/reviewer identity;
- any attempt would overwrite or broadly delete an existing SharePoint item;
- post-commit filing threatens the submission response budget; or
- the one-file smoke cannot be verified by stable identity, content, Dataverse
  pointers, and the staff download path.

## Sweep report

```text
Sweep mode: Mode B — domain truth audit
Domain: structured individual review DOCX generation and SharePoint retention
Claims: 9 -> VERIFIED 8 / PLANNED 1 / PARTIAL 0 / ASSUMED 0 / UNKNOWN 0
Durable restatements: current no-upload statements remain accurate historical/current baseline
Structural fix: added this separately labeled forward plan and catalog entry
Semantic omissions found: upload flag, eligibility distinction for manual structured rows,
  create-only conflict recovery, semantic rather than raw-byte identity, partial-success
  backfill accounting, and post-commit repair were not previously specified
Remaining live STALE: 0 within this plan's stated scope
Remaining UNKNOWN/ASSUMED: Production write behavior remains unproved until the approved smoke
Verdict: RECONCILED FOR PLANNING; IMPLEMENTATION REMAINS PLANNED
```
