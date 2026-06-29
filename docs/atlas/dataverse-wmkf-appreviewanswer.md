# Atlas: `wmkf_appreviewanswer` (Dataverse, WMKF child entity)

**Last verified:** 2026-06-28 (S301) — created in **prod** via `scripts/apply-dataverse-schema.js --target=prod --wave=8-review-answer-snapshot --execute` (all 8 metadata artifacts reported `✓ created`). **[VERIFIED via `lib/dataverse/schema/wave8-review-answer-snapshot/01_wmkf_appreviewanswer.json`].**
**Live row count:** non-zero in prod once reviewers submit (Phase 3 write path is live S302); not independently re-counted here.
**Entity set:** `wmkf_appreviewanswers`
**Schema spec:** `lib/dataverse/schema/wave8-review-answer-snapshot/01_wmkf_appreviewanswer.json`
**Lookup `@odata.bind` key:** `wmkf_AppReviewerSuggestion@odata.bind` (→ `wmkf_appreviewersuggestion`) — PascalCase per schema-apply convention; bind/read value field is `_wmkf_appreviewersuggestion_value`.

## Source of Truth

Point-in-time **answer snapshot** for an external reviewer's submitted review. One row per question per submitted review (all 11 questions, ratings included), each storing the question text exactly as asked beside the answer, so a submitted review reconstructs losslessly even after the question set changes. System of record for the narrative answers; the three ratings are **also** denormalized onto the parent `wmkf_appreviewersuggestion` row (`wmkf_reviewerimpact/risk/overallrating`) for native year-over-year aggregation — a deliberate, documented duplication. Adding questions later = more rows, never new columns.

Full design: `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` §3a.

## Fields

Identity:
- `wmkf_appreviewanswerid` (PK)
- `wmkf_name` (String 200, optional) — synthetic display name; the writer populates the question key. Not load-bearing.

Lookup:
- `wmkf_AppReviewerSuggestion` / `_wmkf_appreviewersuggestion_value` → `wmkf_appreviewersuggestion` (ApplicationRequired); relationship `wmkf_appreviewanswer_suggestion`.
- Alternate key `wmkf_appreviewanswer_suggestion_question_key` on `(wmkf_appreviewersuggestion, wmkf_questionkey)` — makes submit/retry idempotent (upsert by key, never duplicate a question row).

Data:
- `wmkf_questionkey` (String 100, ApplicationRequired) — stable question id (`impact`, `risk`, `overallRating`, `q2`, `q4`..`q11`); mirrors `field.key` in `lib/external/review-form-schema.js`. Never reused for a different question.
- `wmkf_questionorder` (Integer 0–1000) — display order at submission (`field.order`); drives read-back ordering.
- `wmkf_questiontext` (Memo 4000) — question text exactly as asked (`field.label`); denormalized per row for fidelity.
- `wmkf_questiontype` (String 50) — `picklist` | `richtext` | `string` (mirrors `field.type`). Plain text, not a Choice (code-controlled values; simplest-first).
- `wmkf_answerhtml` (Memo 150000) — server-sanitized HTML for narrative answers; null for ratings.
- `wmkf_answertext` (Memo 150000) — plain-text rendition for Excel export; for ratings = the chosen label.
- `wmkf_answervalue` (Integer) — picklist numeric value for rating questions; null for narrative.

## Read Paths

**LIVE (Phase 4, S302).** `/api/review-manager/reviewers` GET reads the rows via a separate keyed child query (not `$expand`) — `queryAllRecords('wmkf_appreviewanswers', { filter: '_wmkf_appreviewersuggestion_value eq <id>', orderby: 'wmkf_questionorder' })`, chunked + paginated, attaching `answers[]` per submitted reviewer (re-sanitized on read). Rendered by `shared/components/workbench/ReviewsTab.js` (narrative rich-text answers). See plan §6.

## Write Paths

**LIVE (Phase 3, S302).** `/api/external/review/[token]/submit` upserts the N answer rows by alternate key (lookup addressed as `_wmkf_appreviewersuggestion_value=<guid>` — memory `reference-dataverse-altkey-lookup-upsert-url`) inside an all-or-nothing `DynamicsService.executeChangeset` changeset, alongside the parent rating/affiliation/`wmkf_reviewreceivedat` PATCH (If-Match-guarded).

## Open Questions / Gotchas

- **Schema lives only in prod.** The sandbox (`orgd9e66399`) could not host this table — its parent `wmkf_appreviewersuggestion` 404s there (schema-stale; memory `project-dynamics-sandbox-state`). Re-running `apply-dataverse-schema.js` is idempotent (creation-only) if a future env needs it.
- **Snapshot ↔ parent rating invariant.** Ratings live both here (`wmkf_answervalue` on the rating rows) and on the parent columns. `buildReviewSubmission()` (Phase 3) is the single producer of both and must assert equality + live-picklist validity before writing.
