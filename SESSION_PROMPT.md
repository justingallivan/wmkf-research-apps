# Session 476 Prompt: Review DOCX Templates — Schema-First Release

## Current Outcome

The owner approved the recommended review-DOCX design. A complete implementation
is source-built on branch `codex/review-docx-templates`; it is not merged,
deployed, or production-enabled.

- [VERIFIED via source and focused tests] The Review Manager's existing combined
  Word export now calls a guarded server route, rereads the proposal and submitted
  reviews from Dataverse, and renders the approved combined template. The browser
  supplies only a validated proposal GUID.
- [VERIFIED via source and rendered-page inspection] The thank-you sweep renders
  the submitted review through the approved individual template and attaches it
  when generation succeeds. Per-review render failure remains nonfatal to the
  thank-you send and is reported separately.
- [VERIFIED via production metadata preflight 2026-09-02] The planned
  `wmkf_appreviewanswer.wmkf_questionoptions` Memo field is absent in Production.
  No schema write was performed.
- [VERIFIED via source] New categorical answer rows snapshot the complete ordered
  `{value,label}` option set. Legacy rows with no option snapshot regenerate with
  an explicit selected-only note; corrupt snapshots render an explicit unavailable
  state rather than silently substituting today's question definition.
- [OWNER DECISION] This phase does not upload generated review DOCX files to
  SharePoint. Dataverse remains authoritative. The existing combined export stays
  an on-demand download, and the individual document is a courtesy attachment.

## Release Boundary

Do not merge or deploy the branch before the Wave 25 field is applied and read
back exact in Production. The reader and every active answer writer select/write
the new field, so a code-first deployment would fail at runtime.

The next authorized action requires explicit owner approval:

1. Run the dry-run Production preflight again.
2. Apply only `wave25-review-answer-question-options` to Production.
3. Read back exact Memo metadata and a selectable entity-set projection.
4. Rebase the branch on current `main`, rerun focused/full gates and build, then
   open/merge the normal reviewed release.
5. After deployment, run signed-in read/export verification. Do not manufacture
   or alter a submitted review merely to prove the new snapshot writer.

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

After this schema-first release is verified, return to Final Writeup persona
access proof and deliberate rollout in `docs/CURRENT_WORK_QUEUE.md`.

## Parked

- Review-DOCX storage/link replacement in SharePoint is not part of this release.
- One-click PDF remains a possible future conversion of the canonical DOCX.
- Automatic review-due reminder scheduling remains held.
