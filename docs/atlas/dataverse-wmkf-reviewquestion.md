# Atlas: `wmkf_reviewquestion` (Dataverse, WMKF config entity)

**Last verified:** 2026-06-29 (S303) — **CREATED in prod** via `scripts/apply-dataverse-schema.js --target=prod --wave=9-review-questions --execute` (entity + 8 attributes + alt key all `✓ created`), then **seeded** with the current 12 fields via `scripts/seed-review-questions.mjs --execute` (the alt-key index gate held at `Pending`, then ran once `Active`). **Read-back verified end-to-end:** `getActiveQuestionSet()` returns all 12 questions from live prod, ordered, with types/required/option-counts matching the static schema. **[VERIFIED via live fetch S303 + `lib/dataverse/schema/wave9-review-questions/01_wmkf_reviewquestion.json`].**
**Live row count:** 12 (affiliation order 0 + 11 questions), as of 2026-06-29.
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
- `wmkf_questionkey` (String 100, ApplicationRequired) — stable, **immutable** question id (`affiliation`, `impact`, `risk`, `overallRating`, `q2`, `q4`..`q11`); the join to `wmkf_appreviewanswer.wmkf_questionkey` (also String 100). Never reused for a different question.
- `wmkf_questionorder` (Integer 0–1000) — display/snapshot position (`field.order`); affiliation = 0, questions 1–11.
- `wmkf_questiontext` (Memo 4000) — question label/text shown to the reviewer (`field.label`); copied verbatim into each answer row at submission.
- `wmkf_questiontype` (String 50) — `picklist` | `richtext` | `string` (mirrors `field.type`). Plain text, not a Choice (code-controlled values; simplest-first, same as the snapshot's type column).
- `wmkf_required` (Boolean, default true; labels Required/Optional) — whether an answer is required to submit.
- `wmkf_maxlength` (Integer 0–1000000) — char cap for richtext/string (`field.maxLength`); null → code default. Unused for picklists.
- `wmkf_hint` (String 500) — optional helper text (`field.hint`); null when none.
- `wmkf_options` (Memo 20000) — for picklists, a JSON array of `{ value, label }` (`field.options`); null otherwise. Options are never queried natively (only answers are, in the snapshot), so JSON is sufficient.

## Read Paths

`lib/external/review-question-fetcher.js::getActiveQuestionSet()` — keyed query `wmkf_reviewquestions` filtered `statecode eq 0`, ordered by `wmkf_questionorder`, normalized to the `{ key, order, label, type, required, maxLength?, hint?, options? }` field shape and **fail-closed** on unreachable/empty/invalid sets (process-local 5-min cache + single-flight, mirrors `PolicyFetcher`). **Phase A: the fetcher exists and is unit-tested; no production consumer reads it yet** — the static `reviewFormSchema.fields` is still the live source until Phase B swaps consumers onto the fetcher.

## Write Paths

- **Seed (Phase A):** `scripts/seed-review-questions.mjs` upserts the current schema's fields by alt key.
- **Admin editor (Phase C, not built):** `pages/api/admin/review-questions.js` will add/edit/soft-delete/reorder as one atomic `executeChangeset`, enforcing key-immutability by row identity, then call `ReviewQuestionFetcher.invalidate()`.

## Open Questions / Gotchas

- **Created + seeded in prod S303.** `schema-apply` is creation-only/idempotent, so re-running is safe; the seed upserts by alt key (idempotent) and self-gates on `EntityKeyIndexStatus === 'Active'`.
- **Schema will live only in prod.** The sandbox is schema-stale (sibling reviewer entities 404 there; memory `project-dynamics-sandbox-state`), same as `wmkf_appreviewanswer`.
- **`affiliation` is seeded as a question row (order 0, type `string`)** so the fetched set equals today's static set 1:1 (behavior-preserving for Phase B). Its mapping to the parent `wmkf_revieweraffiliation` column stays in code, not in this entity. Whether staff may *remove* affiliation is a Phase-C editor policy, not a data constraint here.
- **Key format** allows camelCase (`overallRating`) — `^[a-z][a-zA-Z0-9_]*$`, not the lowercase-only form first drafted in the plan.
