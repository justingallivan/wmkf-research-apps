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
- `lib/services/review-manager/export-reviews-service.js`
- `pages/api/review-manager/export-reviews.js`
- `lib/services/reviewer-thankyou-sweep.js`
- `shared/components/workbench/ReviewsTab.js`

## Following Priority

The owner approved automatic retention for individual structured review DOCX
files in SharePoint; the dry-run-first D26 backfill is Wave 3.
The active plan is `docs/REVIEW_DOCX_SHAREPOINT_RETENTION_PLAN.md`. Claude's
read-only adversarial review of the plan returned
APPROVE WITH CONDITIONS; the plan now incorporates the verified eligibility,
SharePoint target, dedicated-cron, pointer-consumer, 412, cycle, and helper-scope
corrections. Claude's reviewer thank-you honorarium-copy change is Production-live
on `main` at `41326cf5`, and this branch is rebased onto that baseline.

[VERIFIED via source, focused tests, governed-hash characterization, rendered
page inspection, and the Ready Production deployment] Wave 1 is complete on
`main` at `83da197f`: the shared
`review-documents/individual-review-builder.js` now owns answer loading,
composition, filename/content type, and template rendering. The thank-you sweep
still supplies send time, builds before its If-Match claim, and preserves the
honorarium projection/pass-through. No SharePoint call, pointer write, route,
cron, or rollout flag was added by Wave 1.

[VERIFIED via source/tests and flag-off Production route proof; ACTIVATED WRITES
NOT PRODUCTION-PROVED] Wave 2 is Production-deployed on `main` at `83da197f` in
Ready deployment `dpl_F3oZ9MDbnyFox7S8Ekdos7423ece`: a dedicated CRON-secret
route and filing
service enforce exact-stamped-cycle/fresh-snapshot eligibility, newest-first
scheduled discovery, create-only canonical
SharePoint writes, governed semantic reconciliation, ETag pointer commit with one
bounded retry, exact safe cleanup, structured per-row results, and deduplicated
operational events. External reviewer context hides only generated filenames;
the Workbench distinguishes generated staff entry from uploaded staff files via
one shared server classifier. `vercel.json` schedules the route every five
minutes with a 300-second function duration; flag-off requests return before a
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
next gate is review of that manifest and separate explicit approval for one
exact write target.

## Parked

- One-click PDF remains a possible future conversion of the canonical DOCX.
- Automatic review-due reminder scheduling remains held.
