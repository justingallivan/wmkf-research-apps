---
title: "Review Form Multi-Select Questions — Build Plan"
domain: architecture
kind: plan
status: active
summary: "Add a multiselect question type and re-author the review question set from the owner's 2026-07-25 form markup, on a blank slate of zero submitted reviews."
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

**Status:** SCOPED (S375, 2026-07-25). Not started. Awaiting the live question-set
dump (§1) before the question-authoring step is finalized.

## 0. Why this exists

The owner reworked the research reviewer form
(`WMKF_Research_Reviewer_Form_markup.docx`, shared 2026-07-25). The new form has a
**check-all-that-apply** question, which the review-question system cannot express —
it supports `picklist` (single-choice radios), `richtext`, and `string` only
[VERIFIED via `review-question-fetcher.js:29`, `review-question-save.js:69`,
`ReviewAuthoringForm.js:404-447`].

**This is a blank slate.** No reviewer has ever submitted a review through the portal
[VERIFIED via `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` verification-boundary
note]. There are therefore no answer snapshots to migrate, no in-flight authoring
sessions to preserve, and no PD-side consumer that has ever processed real data. Every
constraint that would normally force a compatible migration is currently vacuous:
question keys can be retired, types changed, Dataverse columns added, and downstream
renderers redefined. **This window closes at the first real submission.**

## 1. Prerequisite — read the live question set

The set is staff-editable, and the owner edited it on 2026-07-25 while discovering the
checkbox gap. The seeded static schema is therefore NOT a valid baseline.

```
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-live-review-questions.mjs
```

Read-only (`scripts/probe-live-review-questions.mjs`, committed S375). Its output
determines which live rows are edited, retired, or created in §5 — nothing else in this
plan depends on it.

## 2. Target question set (from the owner's document)

Eleven questions. Checkbox glyphs appear on Q3, Q4, and Q10, but **only Q3 is
multi-select** — it is the one that says "(check all that apply)". Q4 and Q10 are
single-choice scales; Word simply has no radio glyph [owner-confirmed S375].

| # | Question | Type |
|---|---|---|
| 1 | Existing publications, technologies, or prior work addressing part of the proposed work; what distinguishes this proposal | `richtext` |
| 2 | Specific significant impacts foreseen; which outcomes may be useful to your work | `richtext` |
| 3 | "If the proposed project is successful in its entirety, it will (check all that apply)" — enabling tools / disciplinary publications / broad publications / revise textbooks | **`multiselect`** |
| 4 | How risky is the project overall — Low / Medium / High / Impossible | `picklist` |
| 5 | What are the risks (technical / hypothesis / scope) | `richtext` |
| 6 | Are methods, data gathering, analysis appropriate | `richtext` |
| 7 | Concerns about team capacity — personnel, infrastructure, **or budget** | `richtext` |
| 8 | What questions should the Foundation raise with the PI | `richtext` |
| 9 | Competitive in peer review at a traditional funding agency | `richtext` |
| 10 | Overall rating — Excellent / Very Good / Good / Fair / Poor | `picklist` |
| 11 | Anything else (optional) | `richtext` |

**No "Other" free-text option exists** — verified by searching the document text for
"Other", "specify", "please list", and fill-in blanks; the only blanks are the header
identity fields. Q4's "Impossible (there is a fatal flaw; if so, please elaborate
below)" directs the reviewer to Q5, which already captures it in free text
[owner-confirmed S375]. So `multiselect` needs **no per-option text payload**. An
inline conditional text box, if ever wanted, is a separate increment.

### Deltas from the seeded set

- **New:** Q1 (prior work) has no counterpart today.
- **Merged:** current `q7` (personnel/infrastructure) + `q9` (budget) → one capacity
  question.
- **Retyped:** `impact` was a single-choice rating; it becomes multi-select and loses
  "Little to no impact", gaining "provide enabling tools to the community". It stops
  being a scale — the options are categories, not points.
- **Reworded:** most remaining questions.
- **Reordered options:** Q10 displays Excellent-first. Keep the numeric **values**
  as-is (5 = Excellent); array order is display, the number is meaning. Renumbering
  would silently redefine what a stored score means.

## 3. Design decision — how a multi-select answer is stored

`wmkf_appreviewanswer` holds one row per question with a single `wmkf_answervalue`
integer, `wmkf_answertext`, and `wmkf_answerhtml`
[VERIFIED via `lib/dataverse/adapters/review-answer.js:44-50`].

**One row per selected option is NOT viable.** The upsert alternate key is
`(_wmkf_appreviewersuggestion_value, wmkf_questionkey)`
[VERIFIED via `review-answer.js:171-178`], so two rows for one question collide.

**Chosen: add a `wmkf_answervalues` Memo column holding a JSON array of the selected
option values**, keeping one row per question. `wmkf_answertext` continues to hold the
human-readable form — the selected option labels joined — which is what the AI
synthesis and the DOCX/PDF exports already read.

Rationale: preserves the alternate key and the one-row-per-question shape every
consumer assumes; keeps a machine-readable form for tallies and a human form for
rendering, matching the existing intent that `answerText` is the option label at submit
time [VERIFIED via `build-review-submission.js:205-214`]. Rejected alternative: packing
JSON into `wmkf_answertext` — it would overload a field consumers treat as display text
and break the per-option tally in §6.

Schema wave required (new column on an existing entity), following the wave8/wave9/
wave11 precedent in this feature.

## 4. Code changes

**Type system**
- `review-question-fetcher.js` — add `multiselect` to `SUPPORTED_TYPES`; parse and
  validate its `options` exactly as `picklist` does (the same strict-integer,
  non-empty-label normalization at `:87-113`).
- `review-question-save.js` — same allowlist addition (`:69`); options validation reuse
  (`:165`), and the options/diff serialization currently gated on
  `row.type === 'picklist'` (`:222`, `:236-237`) must include `multiselect`.
- `ReviewQuestionsSection.js` — add "Checkboxes (check all that apply)" to the type
  dropdown (`:25-26`); the option builder is gated on `row.type === 'picklist'`
  (`:306`) and the maxLength control on `row.type !== 'picklist'` (`:291`) — both need
  the new type folded in.

**Reviewer form**
- `ReviewAuthoringForm.js` — render `multiselect` as a checkbox group (`type="checkbox"`,
  value = array of selected ints), alongside the existing string/picklist/richtext
  branches (`:404-447`). Draft value shape is an array; the type-aware
  `buildInitialValues` reconciliation must discard a non-array draft value for a
  multiselect field, matching the existing shape-mismatch rule.

**Submit producer**
- `build-review-submission.js` — validate `multiselect` as a deduplicated array of
  in-domain integers; `required` means at least one selection. Emit `answerValues`
  (array) + `answerText` (joined labels) on the snapshot row; `answerValue` stays null.
- `ratingKeysFor` needs no change: it already filters core ratings to those present
  **as picklists**, so a retyped or retired `impact` drops out of
  `assertRatingInvariants` automatically [VERIFIED via `build-review-submission.js:41-43`].

**Snapshot writer/reader fan-out — the easiest thing to miss**

The `wmkf_appreviewanswer` column body is written by TWO deliberately mirrored
helpers, kept byte-identical so a staff-written row is indistinguishable from a
reviewer-written one [VERIFIED via `review-answer-snapshot.js:1-17` header and
`review-answer.js:190` "Mirrors review-answer-snapshot.js#answerRowBody"]:

- `lib/dataverse/adapters/review-answer.js:191-200` — `answerRowBody`
- `lib/external/review-answer-snapshot.js:95` — `answerRowBody`

A new `wmkf_answervalues` column must be added to **both**, or the mirror invariant
silently breaks. Four write paths flow through them [VERIFIED via import grep]:

1. `pages/api/external/review/[token]/submit.js` — the reviewer portal.
2. `lib/services/review-manager/manual-review-entry-service.js` — the live staff rescue.
3. `lib/services/review-upload.js` — retained legacy, hidden from the UI.
4. `lib/services/review-manager/mark-received-no-file-service.js` — retained legacy.

Paths 3–4 dual-write ratings via `buildRatingSnapshotRows`
(`review-answer-snapshot.js:125`), driven by
`REVIEW_RATING_KEYS = ['impact','risk','overallRating']` (`:26`) — a **third**
hardcoded copy of the rating-key list alongside `CORE_RATING_KEYS`
(`review-form-schema.js:179`) and `RATING_KEYS` (`ReviewsTab.js:53`). All three must
agree after `impact` stops being a rating. Readers to check in the same pass:
`ratingsFromAnswers` (`:38`, used by `reviewers-service.js:315`) and
`readRatingsBySuggestion` (used by `context-service.js`).

**Guards to adjust (ours, not external)**
- `PARENT_BOUND_KEYS` / `CORE_RATING_KEYS` — remove `impact` once it is no longer a
  rating, so the admin editor stops refusing to delete it
  [VERIFIED via `review-questions-service.js:106-115`,
  `review-question-save.js:44`]. Whether `impact` is retired as a key or reused for Q3
  is settled in §5.

## 5. Question-set authoring

Decide after §1. Two options, both cheap on a blank slate:

- **(a) Clean keys** — retire `impact`/`q2`/`q4`…, author keys that match the new
  document (`priorWork`, `impactAreas`, `riskLevel`, `capacity`, …). Clearest long-term;
  the old keys never appear in any stored answer, so nothing is orphaned.
- **(b) Reuse keys** — repurpose existing rows in place. Less churn, but leaves key
  names that no longer describe their questions (`impact` holding a multi-select, `q4`
  holding question 5).

**Recommended: (a).** The only argument for (b) is answer-snapshot continuity, which
does not exist yet. Author via a seed script (the `scripts/seed-review-questions.mjs`
precedent), not by hand in the admin panel, so the set is reproducible and reviewable.

## 6. PD-side read-back

- `review-matrix.js` — `multiselect` questions must not enter the ratings grid
  (average/spread over categories is meaningless; the grid selects `type === 'picklist'`
  at `:146`). Give them their own section: per reviewer, the selected labels; plus a
  **per-option tally** across reviewers ("3 of 4 reviewers selected 'publications of
  broad interest'") [owner-chosen S375].
- `ReviewsTab.js` — `RATING_KEYS`/`PROJECTION_FIELD` hardcode `impact`/`risk`/
  `overallRating` (`:53-58`); update to the set that remains numeric, and render the
  multi-select answer in the card view.
- `review-report.js` / `review-report-docx.js` / `review-report-pdf.js` — render the
  selected labels; exclude multiselect from any averaged column.
- `synthesize-reviews-service.js` — the prompt must describe a set, not a score. It
  reads `answerText` (`:46`, `:92`), which carries the joined labels, so the change is
  prompt-level plus a check that `ratingSummaries` no longer claims a numeric summary
  for Q3.

## 7. Verification

- Unit: fetcher normalization, save validation, producer validation/emission, matrix
  derivation, report composition.
- E2E (`tests/e2e/reviewer-stage2b-authoring.spec.js`): a multi-select question
  renders, multi-selects, autosaves an array, rehydrates, gates required-ness on at
  least one selection, and locks read-only after submit.
- RTL (`tests/unit/reviews-tab.test.js`): the multiselect section and per-option tally.
- Then the end-to-end rehearsal this work displaced — see §8.

## 8. Sequencing note

This plan exists because the S375 session set out to test reviewer review-entry and PD
viewing end-to-end and found the form itself was wrong. Do that rehearsal **after**
this ships: a staged submission bakes in whatever question set is live at the time, and
submits are final. Running it against the old set would consume the blank slate for
nothing.

## 9. Open items

1. Live question-set dump (§1) — determines the §5 edit/retire/create list.
2. Confirm §5 option (a) vs (b) with the owner.
3. `/contract-reconcile` before implementation: new Dataverse column, cross-layer
   producer→persistence→consumer change, and a shared-helper (`review-matrix`) semantic
   change all fall inside its trigger set.
