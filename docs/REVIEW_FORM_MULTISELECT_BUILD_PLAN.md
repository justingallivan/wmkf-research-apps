---
title: "Review Form Multi-Select Questions — Build Plan"
domain: architecture
kind: plan
status: active
summary: "Add a multiselect question type and re-author the review question set from the owner's reworked form, expand-first with rehearsal before activation."
canonical: false
cataloged: 2026-07-25
owner: product-engineering
related:
  - lib/external/review-form-schema.js
  - lib/external/review-question-fetcher.js
  - lib/external/build-review-submission.js
  - shared/components/external/ReviewAuthoringForm.js
  - shared/components/workbench/ReviewsTab.js
  - shared/utils/review-matrix.js
  - lib/admin/review-question-save.js
---

# Review Form Multi-Select Questions — Build Plan

**Status:** REVISED DRAFT 2 (S375, 2026-07-25). Not started. Draft 1 was reviewed by
Codex adversarially and returned NO-SHIP; every finding is addressed below, and the
live-state probes draft 1 deferred have now been run.

**Draft-1 corrections carried into this draft:**

1. The blank-slate premise was asserted from a doc note, not probed. It is now
   replaced with measured state (§0.1) — the snapshot is **not** empty.
2. The sequencing rationale ("submits are final, so a rehearsal consumes the blank
   slate") was wrong: `scripts/reset-reviewer-for-testing.js` supports controlled
   reset. Sequencing is now expand-first with rehearsal BEFORE activation (§8).
3. The storage payload (values-only JSON + joined labels) could not preserve
   per-option value→label mapping across staff option edits. It is now a canonical
   `{value,label}` array (§3).
4. Executable type gates were missing from the fan-out (§4).
5. The seed-script authoring precedent cannot deactivate omitted rows; replaced with
   full-set reconciliation through the admin save service (§5).
6. The synthesis prompt lives in a versioned Dataverse prompt row, not in the
   service (§6).

## 0. Why this exists

The owner reworked the research reviewer form
(`WMKF_Research_Reviewer_Form_markup.docx`, shared 2026-07-25). The new form has a
**check-all-that-apply** question, which the review-question system cannot express —
it supports `picklist` (single-choice radios), `richtext`, and `string` only
[VERIFIED via `review-question-fetcher.js:29`, `review-question-save.js:69`,
`ReviewAuthoringForm.js:404-447`].

### 0.1 Measured live state (probed 2026-07-25, read-only)

Draft 1 claimed "no answer snapshots, no in-flight sessions." That was an inference
from a doc note covering only the portal. Replaced with measured counts:

| Surface | Measured | Interpretation |
|---|---|---|
| `wmkf_reviewquestion` | **12 rows, all active**, byte-identical to the seeded schema [DERIVED-FROM: `scripts/probe-live-review-questions.mjs` run 2026-07-25; a direct row count, independent of every other figure in this plan] | No divergence from the seed to reconcile. |
| `review_question_audit` | 4 rows, all dated 2026-06-29 — 2 pending, 1 failed, 1 completed [DERIVED-FROM: `scripts/probe-review-blank-slate.mjs` §4 run 2026-07-25; a direct row count, independent of every other figure in this plan] | Last question-set change was 2026-06-29. |
| `wmkf_appreviewanswer` | **3 rows** on 1 suggestion, keys `impact`/`risk`/`overallRating`, all `answerValue=99`, `answerText=""` [DERIVED-FROM: `scripts/probe-review-blank-slate.mjs` §1 run 2026-07-25; a direct row count, independent of every other figure in this plan] | NOT empty. `99` is the retired "Unable to answer" sentinel, already outside the live 1–4 domain. |
| Suggestions with `wmkf_reviewreceivedat` | **1** — `6ad328b4…`, staff upload, file `eicar-test-bytes.pdf`, no name/email, affiliation "Dr." [DERIVED-FROM: `scripts/probe-review-blank-slate.mjs` §2 run 2026-07-25; a direct row count, independent of every other figure in this plan] | A synthetic fixture from the virus-scan work, not a review. |
| `review_drafts` | **1** — suggestion `3c4bb952…`, updated 2026-07-04, every current key present [DERIVED-FROM: `scripts/probe-review-blank-slate.mjs` §3 run 2026-07-25; a direct row count, independent of every other figure in this plan] | Belongs to reviewer lastname **"Gallivan_test"**. |

**Revised premise.** No *real* reviewer data exists: the only answer rows are sentinel
values on a synthetic fixture, and the only draft belongs to an owner test record. The
freedom to redefine keys, types, and columns is therefore real — but it is a
**decision about disposing of known test artifacts**, not the absence of data.
Draft 1's wording asserted absence and was wrong.

**Explicit disposition (owner decision, §9 item 1):**
- The sentinel answer rows and their fixture suggestion: delete via
  `scripts/reset-reviewer-for-testing.js`, or leave orphaned once their keys retire.
- The `Gallivan_test` draft: it will be discarded by a key change, because
  `buildInitialValues` drops unrecognized and shape-mismatched values by design.
  Acceptable, but must be acknowledged rather than discovered.

**This window still closes at the first real submission** — after which key retirement
orphans genuine review data.

## 1. Prerequisite — live question set (DONE)

```
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-live-review-questions.mjs
```

Result (2026-07-25): `affiliation`(string, order 0), `impact`(picklist), `q2`,
`risk`(picklist), `q4`–`q9`, `overallRating`(picklist), `q11` — identical to
`lib/external/review-form-schema.js`. **No divergence; the seeded schema is a valid
baseline.**

## 2. Target question set (from the owner's document)

Checkbox glyphs appear on Q3, Q4, and Q10, but **only Q3 is multi-select** — it is the
one that says "(check all that apply)". Q4 and Q10 are single-choice scales; Word
simply has no radio glyph [owner-confirmed S375].

| # | Question | Type | Proposed key |
|---|---|---|---|
| — | Title & Organization (reviewer identity, unchanged) | `string` | `affiliation` (kept) |
| 1 | Existing publications, technologies, or prior work addressing part of the proposed work; what distinguishes this proposal | `richtext` | `priorWork` |
| 2 | Specific significant impacts foreseen; which outcomes may be useful to your work | `richtext` | `foreseenImpacts` |
| 3 | "If the proposed project is successful in its entirety, it will (check all that apply)" — enabling tools / disciplinary publications / broad publications / revise textbooks | **`multiselect`** | `impactAreas` |
| 4 | How risky is the project overall — Low / Medium / High / Impossible | `picklist` | `riskLevel` |
| 5 | What are the risks (technical / hypothesis / scope) | `richtext` | `riskDetail` |
| 6 | Are methods, data gathering, analysis appropriate | `richtext` | `methodsAppropriate` |
| 7 | Concerns about team capacity — personnel, infrastructure, **or budget** | `richtext` | `teamCapacity` |
| 8 | What questions should the Foundation raise with the PI | `richtext` | `questionsForPi` |
| 9 | Competitive in peer review at a traditional funding agency | `richtext` | `traditionalFunding` |
| 10 | Overall rating — Excellent / Very Good / Good / Fair / Poor | `picklist` | `overallAssessment` |
| 11 | Anything else (optional) | `richtext` | `additionalComments` |

Retired keys: `impact`, `risk`, `overallRating`, `q2`, `q4`, `q5`, `q6`, `q7`, `q8`,
`q9`, `q11`. `affiliation` is kept as-is — it is the identity field, is unchanged by
the new document, and is not being redefined, so keeping it is not key reuse.
`overallRating` is retired rather than kept because sentinel rows already carry that
key (§0.1) and the atlas forbids reuse.

**No "Other" free-text option exists** — verified by searching the document text for
"Other", "specify", "please list", and fill-in blanks; the only blanks are the header
identity fields. Q4's "Impossible (there is a fatal flaw; if so, please elaborate
below)" directs the reviewer to Q5, which already captures it in free text
[owner-confirmed S375]. So `multiselect` needs **no per-option text payload**.

### Deltas from the live set

- **New:** Q1 (prior work) has no counterpart.
- **Merged:** `q7` (personnel/infrastructure) + `q9` (budget) → one capacity question.
- **Retyped + rescoped:** `impact` (single-choice rating) → multi-select categories;
  loses "Little to no impact", gains "provide enabling tools to the community".
- **Reworded:** most remaining questions.
- **Reordered options:** Q10 displays Excellent-first. Keep the numeric **values**
  as-is (5 = Excellent); array order is display, the number is meaning.

## 3. Design decision — how a multi-select answer is stored

`wmkf_appreviewanswer` holds one row per question with a single `wmkf_answervalue`
integer, `wmkf_answertext`, and `wmkf_answerhtml`
[VERIFIED via `lib/dataverse/adapters/review-answer.js:44-50`].

**One row per selected option is NOT viable.** The upsert alternate key is
`(_wmkf_appreviewersuggestion_value, wmkf_questionkey)`
[VERIFIED via `review-answer.js:173-179`], so two rows for one question collide.
Changing the alternate key would additionally require aggregation across rows and
deletion of stale option rows in every consumer.

**A Dataverse multi-select choice column is also rejected**: its options are *column
metadata*, whereas this system's options are per-question runtime configuration
editable by staff in `/admin`. The two models are incompatible.

**Chosen: a new `wmkf_answervalues` Memo column holding a canonical JSON array of
`{value,label}` objects**, one row per question.

```json
[{"value":1,"label":"Provide enabling tools to the community"},
 {"value":3,"label":"Result in publications of broad interest"}]
```

Storing the label **with** each value is the correction from draft 1. A values-only
array plus a joined `answerText` string cannot be reversed per option after staff
rename, reorder, or remove an option, which would defeat the point-in-time snapshot
invariant in `docs/atlas/dataverse-wmkf-appreviewanswer.md` and mislabel historical
per-option tallies.

**Contract:**
- **Ordering:** stored in the question's option order at submit time, not click order.
- **Deduplication:** values deduplicated before persist; duplicates are a producer error.
- **`answerText`:** *derived* from this array (labels joined with "; ") so the human
  form and machine form cannot disagree. It stays the field synthesis and exports read.
- **`answerValue`:** null for multiselect rows.
- **Parse corruption:** a row whose `wmkf_answervalues` fails to parse renders as
  "unreadable answer" in staff surfaces and is excluded from tallies. It must never
  throw in a read path — one bad row cannot break a whole request's Reviews tab.
- **Empty selection:** an optional multiselect with no selections stores `[]`, not null,
  so "asked and left blank" is distinguishable from "not asked".
- **Read projection:** `ANSWER_FIELDS` (`review-answer.js:43-52`) must select the new
  column, and the DTO mapping (`:98-105`) must expose it as `answerValues`. Draft 1
  omitted the read side entirely.
- **Tally semantics:** per-option tallies use the **stored** labels, not current
  question options, so a historical review keeps the wording its reviewer saw.

A schema wave is required, following the precedent set by the earlier review-related
schema waves (snapshot table, question table, synthesis column).

## 4. Code changes

**Type system**
- `review-question-fetcher.js:29` — add `multiselect` to `SUPPORTED_TYPES`; reuse the
  picklist options normalization at `:87-113`.
- `review-question-save.js:69` — same allowlist; options validation `:165`; the
  options/diff serialization gated on `row.type === 'picklist'` (`:222`, `:236-237`)
  must include `multiselect`.
- `ReviewQuestionsSection.js` — add "Checkboxes (check all that apply)" to the type
  dropdown (`:25-26`); the option builder gate (`:306`) and the maxLength gate
  (`:291`) both key off `picklist` and need the new type folded in.

**Executable type gates missed in draft 1 — each is a hard failure, not a polish item**
[all VERIFIED by reading the cited lines]:

- `ReviewAuthoringForm.isComplete` (`:81-93`) — the trailing
  `else if (typeof v !== 'string' || v.trim().length === 0) return false` catches an
  array, so a required multiselect makes Submit **permanently disabled**.
- `submit-service.js:128-130` — `snapshotKeys` is built from
  `picklist || richtext` only, so `answerUpsertDescriptor` → `answerRowKeyPredicate`
  throws `"not a known snapshot question key"` for a multiselect row and the whole
  submit changeset fails.
- `validateReviewForm` (`review-form-schema.js:262`, `:289`) — the legacy validator
  used by the retained staff paths rejects an unrecognized type as unsupported.
- `review-answer.js:60` `REVIEW_RATING_KEYS` — an additional hardcoded rating-key list
  beyond those draft 1 named (`CORE_RATING_KEYS` `review-form-schema.js:179`,
  `REVIEW_RATING_KEYS` `review-answer-snapshot.js:26`, `RATING_KEYS`
  `ReviewsTab.js:53`).
- Both `ratingsFromAnswers` implementations (`review-answer-snapshot.js:38`,
  `review-answer.js:117`) hardcode their output keys independently.

**Snapshot writer/reader fan-out**

The column body is written by TWO deliberately mirrored helpers, kept byte-identical
so a staff-written row is indistinguishable from a reviewer-written one
[VERIFIED via `review-answer-snapshot.js:1-17`, `review-answer.js:190`]:
`review-answer.js:191-200` and `review-answer-snapshot.js:95`. A new column must reach
**both**. The write paths that flow through them:

- `pages/api/external/review/[token]/submit.js` — the reviewer portal.
- `lib/services/review-manager/manual-review-entry-service.js` — live staff rescue.
- `lib/services/review-upload.js` — retained legacy, hidden from the UI.
- `lib/services/review-manager/mark-received-no-file-service.js` — retained legacy.

The last two dual-write ratings via `buildRatingSnapshotRows`
(`review-answer-snapshot.js:125`). Readers: `ratingsFromAnswers`
(→ `reviewers-service.js:315`) and `readRatingsBySuggestion` (→ `context-service.js`).

**Guards to adjust (ours, not external)**
- `PARENT_BOUND_KEYS` (`review-question-save.js:44`) / `CORE_RATING_KEYS` — drop
  `impact` once it is no longer a rating, so the admin editor stops refusing to delete
  it [VERIFIED via `review-questions-service.js:106-115`].
- `ratingKeysFor` (`build-review-submission.js:41-43`) needs **no** change: it filters
  core ratings to keys present *as picklists*, so a retyped or retired `impact` drops
  out of `assertRatingInvariants` automatically. [Codex confirmed this reading.]

## 5. Question-set authoring

**Key reuse is removed as an option.** `docs/atlas/dataverse-wmkf-reviewquestion.md`
documents the key as immutable and never reused; reuse would also mislabel the
historical sentinel rows, because `review-matrix.js:113-116` applies the *live* type to
historical rows sharing a key. The clean keys are named in the §2 table.

**The seed script is not the mechanism.** `scripts/seed-review-questions.mjs` performs
sequential upserts only: it never deactivates omitted keys, uses no atomic changeset or
ETags, writes no `review_question_audit` row, and does not invalidate the question
cache. Using it for a full replacement would leave the old questions active and could
expose a hybrid set on partial failure.

**Use full-set reconciliation through the existing admin save path**
(`lib/admin/review-question-save.js` planner + `lib/services/admin/review-questions-service.js`),
which already provides the atomic changeset, per-row ETags, `baseVersion` optimistic
lock, soft-delete of omitted rows, Postgres audit, and `invalidate()`. A thin script
may compose the submitted set and call that service; it must not reimplement the write.
Post-state must be verified by re-running the §1 probe.

## 6. PD-side read-back

- `review-matrix.js` — `multiselect` must not enter the ratings grid (the grid selects
  `type === 'picklist'` at `:146`; average/spread over categories is meaningless). Give
  it its own section: per reviewer the selected labels, plus a **per-option tally**
  across reviewers, computed from stored labels [owner-chosen S375].
- `ReviewsTab.js:53-58` — `RATING_KEYS`/`PROJECTION_FIELD` hardcode the ratings;
  update to those that remain numeric, and render multiselect answers in card view.
- `review-report.js` / `-docx.js` / `-pdf.js` — render selected labels; exclude
  multiselect from any averaged column.
- **Synthesis prompt** — `synthesize-reviews-service.js` only composes the
  `reviews_digest` input. The prompt text lives in
  `shared/config/prompts/review-synthesis.js` and production resolves a **versioned
  Dataverse prompt row**; the current prompt uses `impact` as its rating example and
  describes picklists as scores. Editing the service alone leaves production behavior
  unchanged. Required: author a new prompt version, seed/publish it, verify the live
  current version, and add a synthesis regression test asserting multiselect answers
  become categorical evidence and never `ratingSummaries`.

## 7. Verification

- Unit: fetcher normalization, save validation, producer validation/emission,
  `answerValues` round-trip (including a corrupt-JSON row), matrix derivation, report
  composition.
- Integration, with a live multiselect question present, across every write path
  listed in §4: portal submit, manual entry, legacy upload, mark-received-no-file.
- E2E (`tests/e2e/reviewer-stage2b-authoring.spec.js`): renders, multi-selects,
  autosaves an array, rehydrates, required-ness gates on at least one selection, Submit
  enables (the `isComplete` regression), locks read-only after submit.
- RTL (`tests/unit/reviews-tab.test.js`): the multiselect section and per-option tally.

## 8. Sequencing — expand-first, rehearse before activation

Draft 1 deferred the integrated rehearsal until after shipping. That was wrong on two
counts: this is a Tier-2 external-user + Dataverse-write change, and
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` requires integrated rehearsal
before deliberate production promotion. "Submits are final" is the *reviewer-facing*
contract only — `scripts/reset-reviewer-for-testing.js` already deletes answer rows,
drafts, and the synthesis memo for a test reviewer.

1. Provision the nullable `wmkf_answervalues` column; verify it is selectable.
2. Deploy backward-compatible code against the **existing** question set — the new type
   is supported but unused, so behavior is unchanged.
3. Rehearse the full round trip on a controlled test reviewer: author → submit →
   Reviews tab → Compare → DOCX/PDF → synthesis. **This is the end-to-end test the
   session originally set out to run**, and it now happens before activation rather
   than after.
4. Reset test state via `reset-reviewer-for-testing.js`, then re-run the §0.1 probes to
   confirm the post-reset state.
5. Atomically activate the new question set (§5) with a recorded rollback path (the
   prior set is recoverable from `review_question_audit.before_json`).
6. Re-rehearse against the new set, then reset.

## 9. Open items

1. **Owner decision — test-artifact disposition (§0.1):** delete the sentinel fixture
   and the `Gallivan_test` draft, or accept them being orphaned/discarded.
2. **Owner approval of the §2 key names** before authoring.
3. `/contract-reconcile` after this draft is accepted, before implementation.
4. **Owner recollection vs. measured state.** The owner recalled editing the question
   set on 2026-07-25. Both the live set (§1) and the audit table (§0.1) show no change
   on either surface after 2026-06-29, so the edits did not reach Dataverse. Ask the
   owner where they were made — the likeliest explanation is an admin-panel save that
   hit the `missingParentBoundKeys` 400 guard
   (`review-questions-service.js:106-115`) and surfaced as "Fix the highlighted
   problems and try again."
