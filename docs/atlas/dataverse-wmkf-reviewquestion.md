# Atlas: `wmkf_reviewquestion` (Dataverse, WMKF config entity)

**Phase status:** Original staff-editable-question epic complete through S305. The multiselect code expansion is deployed (`main` `5282cee8`; production `dpl_7sfTLrMafYPKp7mnYdrEVjs9HmW5`), and the sibling `wmkf_appreviewanswer.wmkf_answervalues` production schema expansion completed first on 2026-07-26. The backward-compatible `review-synthesis.generate` v2 and exact target question-set publications also completed 2026-07-26. The first controlled portal smoke passed question/context/draft/submit/readback and cleanup. A 2026-07-27 follow-up proved the structured staff Manual Review Entry path and exact restoration, but synthesis has now failed three controlled current-v2 executions on incomplete JSON. Synthesis resolution, the two legacy staff-writer success rehearsals, rollback/republish, final smoke, and reviewer exposure remain pending.
**Last verified:** 2026-07-26 — production has the exact frozen target set: 12 active rows at normalized version `347a37e820f73890`, plus 11 inactive legacy rows. The audited admin publication retained `affiliation`, created 11 target rows, retired 11 legacy rows, and completed request `3d0c7160-3a09-4d96-ab9f-36ebe63e0e7a` with no warnings. Three independently routed admin reads returned the target version; the compatible synthesis prompt remained unchanged. **[VERIFIED via the owner-only archived question-publication receipt, SHA-256 `9f5dead9ecc9989e2701f7ec6573c6313eb295a68a40b1ebc6992d3faade16cf`; redundant ignored source disposal is recorded in `docs/audits/local-operational-data-retention-audit-2026-07-27.md`].**
**Live row count:** 23 total — 12 active (affiliation order 0 + 11 target questions) and 11 inactive legacy rows. **[VERIFIED 2026-07-26 via `scripts/probe-live-review-questions.mjs` read-only production probe].**
**Entity set:** `wmkf_reviewquestions`
**Schema spec:** `lib/dataverse/schema/wave9-review-questions/01_wmkf_reviewquestion.json`
**Seed:** `scripts/seed-review-questions.mjs` (idempotent upsert by alt key from `lib/external/review-form-schema.js`).

## Source of Truth

Staff-editable definition of the external-reviewer review-form question set — one row per current question. System of record for **which** questions the review form asks and how each renders/validates, read at runtime through `lib/external/review-question-fetcher.js` (`ReviewQuestionFetcher`, cached), replacing the former static array in `lib/external/review-form-schema.js`.

The point-in-time `wmkf_appreviewanswer` snapshot (one answer row per question per submitted review, denormalizing the question text as asked) preserves historical fidelity, so this set can be **edited live** without disturbing past reviews. Removing a question **deactivates** its row (`statecode`), never a hard delete, so `wmkf_questionkey` stays stable as the snapshot join. Adding a question = a new row; never a new column.

Full design: `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md` (Phase A = this entity + fetcher + seed).

## Fields

Identity:
- `wmkf_reviewquestionid` (PK)
- `wmkf_name` (String 200, ApplicationRequired) — display name; seed populates with the question key. Not load-bearing.

Alternate key:
- `wmkf_reviewquestion_key` on `(wmkf_questionkey)` — single-attribute key; makes the admin save / seed an idempotent upsert (PATCH to `wmkf_reviewquestions(wmkf_questionkey='<key>')`).

Data:
- `wmkf_questionkey` (String 100, ApplicationRequired) — stable, **immutable** question id; the join to `wmkf_appreviewanswer.wmkf_questionkey` (also String 100). Production's active target keeps `affiliation` and uses the eleven numbered keys listed in `review-form-schema.js`; the prior-only keys remain inactive for rollback/history. Never reuse a key for a different question.
- `wmkf_questionorder` (Integer 0–1000) — display/snapshot position (`field.order`); affiliation = 0, questions 1–11.
- `wmkf_questiontext` (Memo 4000) — question label/text shown to the reviewer (`field.label`); copied verbatim into each answer row at submission.
- `wmkf_questiontype` (String 50) — `picklist` | `multiselect` | `richtext` | `string` (mirrors `field.type`). Plain text, not a Choice (code-controlled values; simplest-first, same as the snapshot's type column).
- `wmkf_required` (Boolean, default true; labels Required/Optional) — whether an answer is required to submit.
- `wmkf_maxlength` (Integer 0–1000000) — char cap for richtext/string (`field.maxLength`); null → code default. Unused for picklists.
- `wmkf_hint` (String 500) — optional helper text (`field.hint`); null when none.
- `wmkf_options` (Memo 20000) — for picklists and multiselects, a JSON array of `{ value, label }` (`field.options`); null otherwise. Options are never queried natively (only answers are, in the snapshot), so JSON is sufficient.

## Read Paths

`lib/external/review-question-fetcher.js::getActiveQuestionSet()` — keyed query `wmkf_reviewquestions` filtered `statecode eq 0`, ordered by `wmkf_questionorder`, normalized to the `{ key, order, label, type, required, maxLength?, hint?, options? }` field shape and **fail-closed** on unreachable/empty/invalid sets (process-local 5-min cache + single-flight, mirrors `PolicyFetcher`). **Phase B LIVE (S303 server + S304 client):** the reviewer routes (`context`/`submit`/`draft`) and `build-review-submission` read this fetched set, and `ReviewAuthoringForm` renders from it — the static `reviewFormSchema.fields` is now only the field-shape/seed/helper source + dormant default. `normalizeRow` is exported for the admin route to normalize the current set identically before hashing it with `questionSetVersion`.

## Write Paths

- **Seed (Phase A):** `scripts/seed-review-questions.mjs` upserts `review-form-schema.js` fields by alt key. Because that static schema now holds the active target set, do not run the seed as an incidental verification command; operational changes follow the controlled full-set publication plan.
- **Admin editor (Phase C, LIVE S304):** `pages/api/admin/review-questions.js` (superuser, `/admin` → `ReviewQuestionsSection`). POST diffs the submitted full set vs the live set **by row id** (`lib/admin/review-question-save.js`, pure + unit-tested) and applies create (POST) / update (PATCH by id) / soft-delete (PATCH `statecode:1,statuscode:2`) / reorder (order PATCH) as **one atomic `executeChangeset`** (so a partial save can't leave the set inconsistent). Enforces key-immutability by row identity, validates against the column caps + the fetcher's normalization rules, and gates on optimistic concurrency via `questionSetVersion` (409 `set_changed`). On success calls `ReviewQuestionFetcher.invalidate()`. Updates/deletes use the **row-id URL** (`wmkf_reviewquestions(<id>)`), not the alt-key form — the editor round-trips ids. **state values [VERIFIED via metadata probe S304]:** `statecode` 0=Active (defaultStatus 1) / 1=Inactive (defaultStatus 2); `statuscode` 1→Active / 2→Inactive. So the soft-delete pair `{statecode:1,statuscode:2}` is exact, and a bare POST create lands Active (statecode 0) → visible to the fetcher's `statecode eq 0` filter. UPDATE was production-proven in S304; the 2026-07-26 target publication production-proved CREATE plus soft-delete in one atomic 22-operation changeset.
  - **Audit:** every save writes to Postgres **`review_question_audit`** (`lib/db/migrations/022_review_question_audit.sql`) — a 'pending' row before the changeset (HARD-ABORT if the audit is unavailable) then a 'final' row with the before/after set + op summary + status; `system_alerts` on audit-write failure. Mirrors `policy_publish_audit`. Append-only; indexed on `request_id` + `created_at`. The first target CREATE/DELETE publication is production-proven by completed request `3d0c7160-3a09-4d96-ab9f-36ebe63e0e7a`.

## Open Questions / Gotchas

- **Created + seeded in prod S303.** `schema-apply` is creation-only/idempotent, so re-running is safe; the seed upserts by alt key (idempotent) and self-gates on `EntityKeyIndexStatus === 'Active'`.
- **Schema will live only in prod.** The sandbox never had the reviewer schema provisioned (sibling reviewer entities 404 there; memory `project-dynamics-sandbox-state`), same as `wmkf_appreviewanswer`.
  - **Re-measured 2026-07-26** via `scripts/probe-sandbox-reviewer-schema.mjs` (read-only metadata probe): the sandbox org is alive and authenticates, but `wmkf_appreviewersuggestion`, `wmkf_appreviewanswer`, `wmkf_reviewquestion`, and `wmkf_potentialreviewer` all return 404; only `akoya_request` is present. This is absence, not drift a re-run would fix — the reviewer chain has never existed in the sandbox.
- **`affiliation` remains a question row (order 0, type `string`)** and stays mapped to parent `wmkf_revieweraffiliation` in code (`reviewParentColumnByKey`), not in this entity.
- **The staged core rows (`affiliation`/`riskLevel`/`overallAssessment`) cannot be removed via the editor.** `PARENT_BOUND_KEYS = ['affiliation', ...CORE_RATING_KEYS]`, while `reviewParentColumnByKey` remains affiliation-only. `impactAreas` is categorical and deliberately absent from both rating-key lists.
- **Key format** allows camelCase (`riskLevel`, `impactAreas`, `overallAssessment`) — `^[a-z][a-zA-Z0-9_]*$`.
- **Out-of-band writes serve stale to reviewers for ≤5 min.** `ReviewQuestionFetcher.invalidate()` is **process-local** and fires only on the admin save success path. A direct Dataverse write outside the editor (the seed, a manual fix/revert, a Power Platform edit) does NOT invalidate any serverless instance's cache (`CACHE_TTL_MS` = 5 min), so reviewers may see the pre-edit set for up to that long. Operational caveat after any manual production intervention; not a code bug.
