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

The Wave 25 schema-first gate is cleared in Production. The source branch is
still not merged or deployed.

Remaining release sequence:

1. Rebase the branch on current `main` and rerun focused/full gates and build.
2. Review the final diff and obtain explicit owner approval before merging or
   pushing to `main`, which auto-deploys Production.
3. After deployment, run signed-in read/export verification. Do not manufacture
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
