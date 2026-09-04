# Session 476 Prompt: Review DOCX Templates — Schema-First Release

## Current Outcome

The owner approved the recommended review-DOCX design. The complete implementation
is Production-live on `main` at `3101f067` in Ready deployment
`dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs`.

- [VERIFIED via source, focused tests, and signed-in Production export] The Review Manager's existing combined
  Word export now calls a guarded server route, rereads the proposal and submitted
  reviews from Dataverse, and renders the approved combined template. The browser
  supplies only a validated proposal GUID.
- [VERIFIED via deployed source, focused tests, and rendered-page inspection] The thank-you sweep renders
  the submitted review through the approved individual template and attaches it
  when generation succeeds. Per-review render failure remains nonfatal to the
  thank-you send and is reported separately.
- [VERIFIED via Production apply and independent metadata readback 2026-09-03]
  Wave 25 created `wmkf_appreviewanswer.wmkf_questionoptions` as the exact
  nullable Memo field declared by the schema, with `MaxLength=20000`.
- [VERIFIED via source] New categorical answer rows snapshot the complete ordered
  `{value,label}` option set. Legacy rows with no option snapshot regenerate with
  an explicit selected-only note; corrupt snapshots render an explicit unavailable
  state rather than silently substituting today's question definition.
- [OWNER DECISION] This phase does not upload generated review DOCX files to
  SharePoint. Dataverse remains authoritative. The existing combined export stays
  an on-demand download, and the individual document is a courtesy attachment.

## Release Boundary

The release is complete. Wave 25 is exact in Production, the six reviewed commits
were fast-forwarded to `main`, and deployment
`dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs` reached Ready at 2026-09-03 09:07 PDT.
The pre-release evidence remains: 306/306 affected-workflow tests, all relevant
structural gates and self-tests, TypeScript, lint with 0 errors/76 existing
warnings, a production build, and both template bundle traces.

[VERIFIED via signed-in Production Workbench export] Request `1002903` exposed
the Word action for its submitted review and generated a valid 60,586-byte DOCX
named `reviews-1002903-20260903.docx`. ZIP integrity passed and the package title
and header read **Aggregated Proposal Reviews**. Focused Vercel logs recorded
three export requests with successful 2xx Dataverse dependencies; the bounded
post-deploy error-level scan returned no logs. No review data was altered and no
thank-you email was sent during verification, so the courtesy-send path remains
deployed/source/test/render verified rather than transport-smoked in Production.

## Implementation Surfaces

- `lib/dataverse/schema/wave25-review-answer-question-options/`
- `scripts/preflight-review-answer-question-options-schema.mjs`
- `lib/dataverse/adapters/review-answer.js`
- `lib/external/build-review-submission.js`
- `lib/external/review-answer-snapshot.js`
- `shared/utils/review-matrix.js`
- `shared/utils/review-report.js`
- `lib/services/review-documents/docx-renderer.js`
- `shared/templates/reviews/individual-review-v1.docx`
- `shared/templates/reviews/combined-review-v1.docx`
- `shared/templates/reviews/individual-review-v2.docx`
- `shared/templates/reviews/combined-review-v2.docx`
- `shared/templates/reviews/individual-review-v3.docx`
- `shared/templates/reviews/combined-review-v3.docx`
- `shared/templates/reviews/individual-review-v4.docx`
- `shared/templates/reviews/combined-review-v4.docx`
- `lib/services/review-manager/export-reviews-service.js`
- `pages/api/review-manager/export-reviews.js`
- `lib/services/reviewer-thankyou-sweep.js`
- `shared/components/workbench/ReviewsTab.js`

## Following Priority

The owner-approved D26 retention backfill is complete. Waves 1–4 are
Production-live on `main` at `3ba2a6ad` in Ready deployment
`dpl_22wUzC1cCi4nhKTSFQftfaycucSh`. The exact v4 manifest executed 22 files
with zero failures, and a fresh post-write Production dry run found zero
eligible missing files, zero reconcile candidates, zero blockers, and only the
explicit Request `1003223` test exclusion. Wave 5 is now activated with exact
Production `REVIEW_DOCX_SHAREPOINT_WRITE=on` and
`REVIEW_DOCX_SHAREPOINT_CYCLE=D26` in Ready activation-proof deployment
`dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM`. The first authenticated enabled run returned
HTTP 200, attempted no filing, and found only test Request `1003223` as
`invalid_snapshot`; bounded logs showed no Graph mutation, Dataverse PATCH, or
runtime error. The next natural automatic filing remains unproved. Test-row
disposition is now resolved: on 2026-09-04 UTC the sole suggestion for test
Request `1003223` was ETag-conditionally changed only from
`wmkf_selected=true` to `false`, preserving its received-review history and
empty SharePoint pointers. A follow-up authenticated enabled sweep returned
HTTP 200 with zero candidates and zero attempts. The later owner cleanup of
Request `1002874` is independently verified complete; the work queue otherwise
returns to Final Writeup persona rollout. That rollout is now Production-live
on `main` at `213f6c34` in Ready deployment
`dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`. A read-only production-data smoke using
the deployed source verified Program Director, Program Coordinator,
Leadership, PD + Leadership overlap, ineligible/unassigned, and superuser
projections; no data was written. The isolated browser reached the expected
sign-in boundary, so a signed-in non-superuser dashboard observation remains
useful on the next natural staff visit rather than a release blocker.
The active plan is `docs/REVIEW_DOCX_SHAREPOINT_RETENTION_PLAN.md`. Claude's
read-only adversarial review of the plan returned
APPROVE WITH CONDITIONS; the plan now incorporates the verified eligibility,
SharePoint target, dedicated-cron, pointer-consumer, 412, cycle, and helper-scope
corrections. Claude's reviewer thank-you honorarium-copy change is Production-live
on `main` at `41326cf5`, and this branch is rebased onto that baseline.

[VERIFIED via source, focused tests, governed-hash characterization, rendered
page inspection, and the Ready Production deployment] Wave 1 is complete on
`main` and included in current runtime `3ba2a6ad`: the shared
`review-documents/individual-review-builder.js` now owns answer loading,
composition, filename/content type, and template rendering. The thank-you sweep
still supplies send time, builds before its If-Match claim, and preserves the
honorarium projection/pass-through. No SharePoint call, pointer write, route,
cron, or rollout flag was added by Wave 1.

[VERIFIED via source/tests and flag-off Production route proof; SCHEDULED WRITES
NOT PRODUCTION-PROVED] Wave 2 is included in current `main` commit `3ba2a6ad` and
Ready deployment `dpl_22wUzC1cCi4nhKTSFQftfaycucSh`: a dedicated CRON-secret
route and filing
service enforce exact-stamped-cycle/fresh-snapshot eligibility, newest-first
scheduled discovery, create-only canonical
SharePoint writes, governed semantic reconciliation, ETag pointer commit with one
bounded retry, exact safe cleanup, structured per-row results, and deduplicated
operational events. External reviewer context hides only generated filenames;
the Workbench distinguishes generated staff entry from uploaded staff files via
one shared server classifier. `vercel.json` schedules the route hourly
with a 300-second function duration; flag-off requests return before a
maintenance row or data read. Claude's Wave 2 build review returned APPROVE WITH
NON-BLOCKING SUGGESTIONS, and the accepted hardening is incorporated. The
non-sensitive write/cycle flags are absent from the Production environment. An
authenticated Production GET returned
`{ok:true,enabled:false,status:"disabled",scanCap:7,attemptCap:2}`; the
`file-review-docx` maintenance-run count was zero immediately before and after.
No Graph mutation, Dataverse pointer write, or candidate read was authorized or
performed by the Wave 2 release. Wave 3 is now source-built on
`codex/review-docx-wave3-backfill`: the operator CLI defaults to a read-only
Production dry run, records no answer/document content, binds its ordered
unfinished population and exact Production Dataverse plus SharePoint target into
a hashed manifest, rechecks all source/ETag/semantic hashes before writes, and
uses the existing create-only ensure service under the local same-day Production
acknowledgement. Focused tests and Dataverse/context/type gates pass. Claude's
Wave 3 adversarial review returned APPROVE WITH NON-BLOCKING NOTES; the accepted
contract, target-binding, deterministic-ordering, create-only result-artifact,
and discriminating-test hardening is incorporated. The first read-only
Production dry run completed on 2026-09-03 and created the redacted manifest
`outputs/review-docx-backfill/review-docx-D26-2026-09-03T21-26-05-683Z.json`.
It found 24 unfinished reviews: 23 eligible and one `invalid_snapshot` on owner-
confirmed test Request `1003223`. A second read-only run used the new explicit,
hash-bound `--exclude-test-request 1003223` contract and created clean schema-v2
manifest `outputs/review-docx-backfill/review-docx-D26-2026-09-03T21-35-11-024Z.json`:
23 eligible, one visible `excluded_test_request`, zero blockers, and zero
existing generated items. No SharePoint or Dataverse mutation occurred. The
owner then selected Request `1002874` for the one-file proof. A fresh scoped
read-only run created validated schema-v2 manifest
`outputs/review-docx-backfill/review-docx-D26-2026-09-03T21-53-38-014Z.json`
with hash `8cc5c7821fa515828a2426cde6e800de131a4ab826c240881a97001899e41711`:
one eligible missing file, zero blockers, zero existing item, and exact request
GUID `e2639251-9644-f111-88b4-000d3a306d0c`. A separate metadata-only
Production read confirmed suggestion `1a0fb28f-0f9b-f111-b8db-6045bd008868`
belongs to Agnes Karasik. No write flag, acknowledgement, `--execute`,
SharePoint mutation, or Dataverse pointer write was used at dry-run time. The
owner then explicitly approved that exact manifest. Execution result
`outputs/review-docx-backfill/review-docx-D26-2026-09-03T21-53-38-014Z.execute-result-2026-09-03T22-03-52-432Z.json`
reports one created, zero failed: SharePoint item
`01G4GVMSZ3RAXEKILFYRCISR6CGKHFVCQI`, `Review-1002874.docx`, 69,761 bytes,
version `1.0`, with the exact generated folder committed to both Dataverse
pointer fields. Independent readback classified the row `already_filed` and
proved downloaded semantic hash
`gdc1:O7QmzK_dojK9xwRvpFNXObuKCbKddrRpSc25P3gj5-A` equals the reviewed hash.
The signed-in Production Workbench exposes the exact Agnes Karasik download
link, and the owner confirmed the browser download succeeds and the downloaded
document looks correct. Opening the retained item through akoyaGO/Word for the
web exposed a first-page compatibility defect: the tab-positioned `Proposal
Review` title split after its first character. The branch now preserves the
Production-used v1 templates and selects new v2 templates that remove the two
out-of-bounds positioning tabs and directly right-aligns both individual and
combined first-page titles. Focused tests, structural package checks, and
one-page renders for both templates passed; at that stage the fix had not yet
been deployed and the existing SharePoint item was unchanged. The owner then simplified the retained
file contract: generated documents now target the request-level `Reviews/`
folder with filename `Review-<request>-<reviewer name>.docx`; no
`Reviewer_Uploads/Generated` or suggestion-GUID layer remains in the current
target. The old Request `1002874` item was initially retained for compatibility
and was owner-deleted after the repair was verified. Because the governed hash
and target identity changed, the prior
22-row manifest is superseded. Fresh v4 read-only manifest
`outputs/review-docx-backfill/review-docx-D26-2026-09-04T01-18-31-489Z.json`
has hash `9254df9e5e504c79007391efc85d189e89e8b8b2ff80b8e4f11990baca08f4f8`,
22 eligible missing files, one visible Request `1003223` test exclusion, zero
blockers, 22 unique destinations, and no Request `1002874` candidate. No
suggestion IDs were added or removed versus the prior survey; the apparent new
reviews were already included. At that stage no additional population write had
been approved. The owner then authorized an exact
Request `1002874` repair that initially retained the old file; its separately
approved cleanup is now complete. Hash-bound
manifest
`outputs/review-docx-repair/review-docx-repair-1002874-2026-09-03T23-21-31-299Z.json`
(`c30c76e47281208b8b4cc25976360453eebbdc65ba3d4b203c19a6e0f1a5692d`)
had zero blockers and proved the new target absent. Execution created
SharePoint item `01G4GVMSZZ25YPTP3RGFEK6LCT64W3JPX2`,
`Reviews/Review-1002874-Agnes Karasik.docx`, 69,733 bytes, version `1.0`, then
ETag-conditionally repointed Dataverse. Independent readback matched semantic
hash `gdc1:IjQ_lTPljr-Hz3msRORXRuMNm2SwZfPffHjlE3fO52o` and confirmed the old
item still exists. The owner then confirmed that v2 kept the title on one line
but Word Online still pushed it below the logo. OOXML inspection identified the
remaining cross-renderer ambiguity: the behind-text floating logo still declared
`wrapTight`, allowing Word Online to wrap the title around its shape. New v3
individual and combined templates change only that first-page header geometry
to explicit `wrapNone`; both render as clean one-page fixtures locally and the
focused repair suite passes. The owner approved replacing the exact current
Agnes file while initially retaining the separate legacy item; that item was
later owner-deleted and its absence independently verified. Repair manifest
`outputs/review-docx-repair/review-docx-repair-1002874-2026-09-03T23-45-44-078Z.json`
(`ab98b779b660c77719c317f73b8f1004b08a898f7159971d6f5c97f9bfb2295d`)
bound the current item ID, ETag, version `1.0`, prior semantic hash, new v3
semantic hash, Dataverse ETag/source fingerprint, and exact target. The first
write attempt failed safely with HTTP 423 while Word Online held the item lock;
no bytes or pointers changed. The retry replaced the same stable SharePoint item
`01G4GVMSZZ25YPTP3RGFEK6LCT64W3JPX2` and filename in place as version `2.0`,
retaining and verifying version `1.0`. Independent read-only regeneration and
download now classify the row `already_filed` and match v3 semantic hash
`gdc1:E3KvF7rvlOaGoxps6DHihILCQlyDlSheguneB0F0ojw`; Dataverse pointers did not
change. Owner inspection showed that the v3 floating-logo header was still not
the desired alignment. The owner then edited and returned a header-only Word
file; new v4 individual and combined templates preserve that exact fixed
9360-DXA two-column Times New Roman text header, with no image, drawing, anchor,
tab, or first-page header relationship. Both full generated fixtures render
cleanly and the focused 92-test suite passes. Exact content-repair manifest
`outputs/review-docx-repair/review-docx-repair-1002874-2026-09-04T00-37-00-977Z.json`
(`18007d495f52ab7abb88c03e6d3099eadb953157e69051b0c4c96898881ef09e`)
versioned the same stable SharePoint item/name from `2.0` to `3.0`, retaining its
prior versions. At the owner's explicit request, a second guarded generation
and in-place upload wrote the same real v4 output as version `4.0` at
`2026-09-04T00:59:51Z`, retaining versions `1.0`–`3.0`. Independent read-only
regeneration/download now returns
`already_filed`, matches v4 governed hash
`gdc1:fbIC8o5aWoe_rOjXNK6mAKR6kbNRQ_I6MU60R28Chi4`, and confirms unchanged
Dataverse pointers. The owner visually confirmed version `4.0` in Word Online
and approved the v4 header on 2026-09-03. The reviewed runtime was subsequently
promoted at `3ba2a6ad` / `dpl_22wUzC1cCi4nhKTSFQftfaycucSh`. Exact execution
artifact
`outputs/review-docx-backfill/review-docx-D26-2026-09-04T01-18-31-489Z.execute-result-2026-09-04T01-32-42-926Z.json`
reports 22 created and zero failed; row-by-row reconciliation matched every
reviewed identity, destination, semantic hash, and unique SharePoint item.
Fresh post-write manifest
`outputs/review-docx-backfill/review-docx-D26-2026-09-04T01-33-20-264Z.json`
has no eligible or reconcile rows and no blockers. Wave 5 activation is complete
at `dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM`; an authenticated enabled run resolved
`D26`, attempted zero filings, and made no SharePoint document or Dataverse
pointer mutation. It surfaced only known test Request `1003223` as
`invalid_snapshot`. The row was subsequently removed from the filing population
by changing only its suggestion's `wmkf_selected` value to `false`; the exact
follow-up enabled sweep returned zero candidates and zero attempts. The owner
then deleted Request `1002874`'s obsolete `Reviewer_Uploads/Generated` tree;
read-only Graph verification returned `404 itemNotFound` for that path and 200
for the current Agnes file, while Dataverse still pointed to the `Reviews`
folder and reviewer-named file. Only the next natural automatic filing remains
open for this workstream.

## Parked

- One-click PDF remains a possible future conversion of the canonical DOCX.
- Automatic review-due reminder scheduling remains held.
