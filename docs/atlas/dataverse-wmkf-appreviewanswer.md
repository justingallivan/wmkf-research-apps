# Atlas: `wmkf_appreviewanswer` (Dataverse, WMKF child entity)

**Last verified:** 2026-07-26 — the base entity remains live in **prod** from wave 8, and wave 15 is now applied. Production metadata reports `wmkf_answervalues` as nullable custom Memo `wmkf_AnswerValues` with `MaxLength=150000`; the property is selectable through `wmkf_appreviewanswers`. **[VERIFIED via `scripts/probe-review-answer-multiselect-field.mjs` production readback after `scripts/apply-dataverse-schema.js --target=prod --wave=15-review-answer-multiselect --execute`].**
**Live row count:** non-zero in prod once reviewers submit (Phase 3 write path is live S302); not independently re-counted here.
**Entity set:** `wmkf_appreviewanswers`
**Schema spec:** `lib/dataverse/schema/wave8-review-answer-snapshot/01_wmkf_appreviewanswer.json`
**Lookup `@odata.bind` key:** `wmkf_AppReviewerSuggestion@odata.bind` (→ `wmkf_appreviewersuggestion`) — PascalCase per schema-apply convention; bind/read value field is `_wmkf_appreviewersuggestion_value`.

## Source of Truth

Point-in-time **answer snapshot** for an external reviewer's submitted review. One row per submitted question, each storing the question text exactly as asked beside the answer, so a submitted review reconstructs losslessly even after the question set changes. It is the **sole system of record for the structured ratings** as well as narrative and categorical answers. Production's active question contract has two core ratings (`riskLevel`, `overallAssessment`) and one categorical multiselect (`impactAreas`) as of the audited 2026-07-26 target publication. The former parent rating columns were retired and dropped in S305. Adding questions later = more rows, never new columns.

Full design: `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` §3a.

## Fields

Identity:
- `wmkf_appreviewanswerid` (PK)
- `wmkf_name` (String 200, optional) — synthetic display name; the writer populates the question key. Not load-bearing.

Lookup:
- `wmkf_AppReviewerSuggestion` / `_wmkf_appreviewersuggestion_value` → `wmkf_appreviewersuggestion` (ApplicationRequired); relationship `wmkf_appreviewanswer_suggestion`.
- Alternate key `wmkf_appreviewanswer_suggestion_question_key` on `(wmkf_appreviewersuggestion, wmkf_questionkey)` — makes submit/retry idempotent (upsert by key, never duplicate a question row).

Data:
- `wmkf_questionkey` (String 100, ApplicationRequired) — stable question id (for the active target set: `priorWork`, `foreseenImpacts`, `impactAreas`, `riskLevel`, `riskDetail`, `methodsAppropriate`, `teamCapacity`, `questionsForPi`, `traditionalFunding`, `overallAssessment`, `additionalComments`); mirrors `field.key` in `lib/external/review-form-schema.js`. Never reused for a different question.
- `wmkf_questionorder` (Integer 0–1000) — display order at submission (`field.order`); drives read-back ordering.
- `wmkf_questiontext` (Memo 4000) — question text exactly as asked (`field.label`); denormalized per row for fidelity.
- `wmkf_questiontype` (String 50) — `picklist` | `multiselect` | `richtext` | `string` (mirrors `field.type`). Plain text, not a Choice (code-controlled values; simplest-first).
- `wmkf_answerhtml` (Memo 150000) — server-sanitized HTML for narrative answers; null for ratings.
- `wmkf_answertext` (Memo 150000) — plain-text rendition for Excel export; for ratings = the chosen label.
- `wmkf_answervalue` (Integer) — picklist numeric value for rating questions; null for narrative.
- `wmkf_answervalues` (Memo 150000, nullable; wave 15 applied in prod 2026-07-26) — compact canonical JSON array of `{value,label}` pairs for multiselect answers; `[]` represents an allowed empty selection and non-multiselect rows write null. Values are numeric client selections canonicalized against the live option set; labels and order are server-owned snapshots.

## Read Paths

**LIVE path; target multiselect configuration active.** `/api/review-manager/reviewers` GET reads the rows via a separate keyed child query (not `$expand`) — `queryAllRecords('wmkf_appreviewanswers', { filter: '_wmkf_appreviewersuggestion_value eq <id>', orderby: 'wmkf_questionorder' })`, chunked + paginated, attaching `answers[]` per submitted reviewer (rich text re-sanitized on read). The deployed reader parses multiselect JSON defensively, exposes stored pairs plus `answerValuesUnreadable`, and lets cards, comparison tallies, reports, and synthesis isolate a corrupt row without failing the rest of the review. Parsing is type-scoped: non-multiselect rows ignore stray `wmkf_answervalues` content, so categorical corruption cannot hide a valid rating or narrative. The first controlled Request #1002788 portal submission/readback smoke passed this full path on 2026-07-26: 11 canonical snapshot rows, exact categorical value/label pairs, DTO hydration, categorical tallies, numeric projections, DOCX/PDF/courtesy consumers, finality, and atomic cleanup all verified. The broader release gate remains red because the sibling synthesis consumer failed twice on incomplete JSON; staff-writer success coverage, rollback/republish, and final smoke remain pending before reviewer exposure.

The same DTO derives ratings from these rows (`ratingsFromAnswers`, `lib/external/review-answer-snapshot.js`) instead of parent columns, and the external review-context prefill reads them per suggestion. In the active target contract the projection contains only `riskLevel` and `overallAssessment`; a rating with no snapshot row remains null (informal/unrated).

## Write Paths

**LIVE (Phase 3, S302).** `/api/external/review/[token]/submit` upserts the N answer rows by alternate key (lookup addressed as `_wmkf_appreviewersuggestion_value=<guid>` — memory `reference-dataverse-altkey-lookup-upsert-url`) inside an all-or-nothing `DynamicsService.executeChangeset` changeset, alongside the parent affiliation/`wmkf_reviewreceivedat` PATCH (If-Match-guarded). Post-E1 the parent PATCH no longer carries the rating columns — the rating rows in this snapshot are their only home.

**Structured staff rescue.** `/api/review-manager/manual-review-entry` uses the same live question fetcher, rich-text sanitizer, full validator, `buildReviewSubmission()` producer, and atomic parent/child changeset as external submission. It writes the complete answer snapshot (ratings and narratives), rejects stale question-set versions, and ETag-guards the parent PATCH. The legacy staff paths below remain intentionally partial.

The two legacy staff writers — `lib/services/review-upload.js` (file upload) and `pages/api/review-manager/mark-received-no-file.js` — upsert structured snapshot rows atomically with their parent PATCH. The active target contract uses shared rating and multiselect row builders, so both core ratings and `impactAreas` are represented; narrative answers remain in the uploaded PDF for this legacy path, and informal feedback writes no answer rows. One-time backfill `scripts/backfill-rating-snapshot-rows.mjs` filled historical parent-only rating rows (1 in prod).

## Open Questions / Gotchas

- **Schema lives only in prod.** The sandbox (`orgd9e66399`) could not host this table — its parent `wmkf_appreviewersuggestion` 404s there (schema-stale; memory `project-dynamics-sandbox-state`). Re-running `apply-dataverse-schema.js` is idempotent (creation-only) if a future env needs it.
  - **Re-measured 2026-07-26** via `scripts/probe-sandbox-reviewer-schema.mjs` (read-only metadata probe): the sandbox org is alive and authenticates, but `wmkf_appreviewersuggestion`, `wmkf_appreviewanswer`, `wmkf_reviewquestion`, and `wmkf_potentialreviewer` all return 404; only `akoya_request` is present. So this is not drift a re-run would fix — the reviewer chain has never existed in the sandbox. Treat any plan that proposes a sandbox rehearsal of the reviewer flow as depending on a full four-entity schema build-out plus the campaign gate's auth/file/job/email verification, not on a provisioning step.
- **Producer rating backstop (post-E1).** Ratings live ONLY here now (the parent/child equality invariant retired with the dual-write at E1). `buildReviewSubmission()` is still the single producer and asserts the core ratings (`CORE_RATING_KEYS`) are present + in the live picklist domain before writing — re-anchored on the explicit key list, not the parent-column map, so the backstop survived the column retirement.
- **Pre-deployment expand and activation gates — partially cleared 2026-07-26.** Wave 15 is applied, exact metadata plus entity-set select readback passed, and compatible code is live at production deployment `dpl_7sfTLrMafYPKp7mnYdrEVjs9HmW5`. The target 12-row question set is active at `347a37e820f73890`; the first controlled portal submission/readback and cleanup passed. Synthesis resolution, staff-writer success coverage, rollback rehearsal, and the final smoke remain pending.
