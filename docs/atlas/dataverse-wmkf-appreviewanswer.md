# Atlas: `wmkf_appreviewanswer` (Dataverse, WMKF child entity)

**Last verified:** 2026-06-28 (S301) — created in **prod** via `scripts/apply-dataverse-schema.js --target=prod --wave=8-review-answer-snapshot --execute` (all 8 metadata artifacts reported `✓ created`). **[VERIFIED via `lib/dataverse/schema/wave8-review-answer-snapshot/01_wmkf_appreviewanswer.json`].**
**Live row count:** non-zero in prod once reviewers submit (Phase 3 write path is live S302); not independently re-counted here.
**Entity set:** `wmkf_appreviewanswers`
**Schema spec:** `lib/dataverse/schema/wave8-review-answer-snapshot/01_wmkf_appreviewanswer.json`
**Lookup `@odata.bind` key:** `wmkf_AppReviewerSuggestion@odata.bind` (→ `wmkf_appreviewersuggestion`) — PascalCase per schema-apply convention; bind/read value field is `_wmkf_appreviewersuggestion_value`.

## Source of Truth

Point-in-time **answer snapshot** for an external reviewer's submitted review. One row per question per submitted review (all 11 questions, ratings included), each storing the question text exactly as asked beside the answer, so a submitted review reconstructs losslessly even after the question set changes. **Sole system of record for the three ratings** (post-Phase-E1, S305) as well as the narrative answers — the DTO, the review-context prefill, and the merge engagement signal all read ratings from here. The former parent columns (`wmkf_reviewerimpact/risk/overallrating`) were retired entirely — no reader (Phase D), no writer (E1), and the columns themselves **dropped from Dataverse (E2, S305)**. Adding questions later = more rows, never new columns.

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

**LIVE (Phase D, S305).** The same DTO now also **derives the three ratings** from these rows (`ratingsFromAnswers`, `lib/external/review-answer-snapshot.js`) instead of the parent columns, and the external review-context prefill reads them per-suggestion (`readRatingsBySuggestion` → `context.js`). A rating with no snapshot row → null (informal/unrated), identical to the old parent read.

## Write Paths

**LIVE (Phase 3, S302).** `/api/external/review/[token]/submit` upserts the N answer rows by alternate key (lookup addressed as `_wmkf_appreviewersuggestion_value=<guid>` — memory `reference-dataverse-altkey-lookup-upsert-url`) inside an all-or-nothing `DynamicsService.executeChangeset` changeset, alongside the parent affiliation/`wmkf_reviewreceivedat` PATCH (If-Match-guarded). Post-E1 the parent PATCH no longer carries the rating columns — the rating rows in this snapshot are their only home.

**Structured staff rescue.** `/api/review-manager/manual-review-entry` uses the same live question fetcher, rich-text sanitizer, full validator, `buildReviewSubmission()` producer, and atomic parent/child changeset as external submission. It writes the complete answer snapshot (ratings and narratives), rejects stale question-set versions, and ETag-guards the parent PATCH. The legacy staff paths below remain intentionally partial.

**LIVE (Phase D, S305).** The two legacy staff writers — `lib/services/review-upload.js` (file upload) and `pages/api/review-manager/mark-received-no-file.js` — now also upsert the **rating** snapshot rows atomically with their parent PATCH (shared `buildRatingSnapshotRows` + `answerRowUrl`/`answerRowBody`), so staff-entered ratings are in the snapshot too. They write only the rating rows (narrative answers live in the uploaded PDF); the informal-feedback no-file path writes none. One-time backfill `scripts/backfill-rating-snapshot-rows.mjs` filled historical parent-only rows (1 in prod).

## Open Questions / Gotchas

- **Schema lives only in prod.** The sandbox (`orgd9e66399`) could not host this table — its parent `wmkf_appreviewersuggestion` 404s there (schema-stale; memory `project-dynamics-sandbox-state`). Re-running `apply-dataverse-schema.js` is idempotent (creation-only) if a future env needs it.
  - **Re-measured 2026-07-26** via `scripts/probe-sandbox-reviewer-schema.mjs` (read-only metadata probe): the sandbox org is alive and authenticates, but `wmkf_appreviewersuggestion`, `wmkf_appreviewanswer`, `wmkf_reviewquestion`, and `wmkf_potentialreviewer` all return 404; only `akoya_request` is present. So this is not drift a re-run would fix — the reviewer chain has never existed in the sandbox. Treat any plan that proposes a sandbox rehearsal of the reviewer flow as depending on a full four-entity schema build-out plus the campaign gate's auth/file/job/email verification, not on a provisioning step.
- **Producer rating backstop (post-E1).** Ratings live ONLY here now (the parent/child equality invariant retired with the dual-write at E1). `buildReviewSubmission()` is still the single producer and asserts the core ratings (`CORE_RATING_KEYS`) are present + in the live picklist domain before writing — re-anchored on the explicit key list, not the parent-column map, so the backstop survived the column retirement.
