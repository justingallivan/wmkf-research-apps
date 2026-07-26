---
name: project-review-form-checkbox-questions
description: Owner reworked the reviewer review form to include check-all-that-apply and checkbox-plus-Other questions; the question-type system supports no checkbox type today.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-25 via source read of the full question-type chain (fetcher, admin save/editor, ReviewAuthoringForm, build-review-submission, review-answer adapter, review-matrix)
---

## Status (S375, 2026-07-26)

**Plan ACCEPTED and FROZEN: `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md`. Implementation
NOT started. Target go-live 2026-08-15, full scope — the owner explicitly rejected
deferring any part of it.** Read the plan, not this file, for the contract; this entry
records only what a future session would otherwise re-derive or get wrong.

Closed owner decisions (do not reopen without a new one):
- The whole question set is re-keyed; only `affiliation` keeps its key.
  `CORE_RATING_KEYS = ['riskLevel','overallAssessment']`; `impactAreas` must never
  appear in any rating-key list.
- `riskLevel`/`overallAssessment` carry the prior options and numeric values —
  a re-key, not a re-scoring. Never renumber option values.
- Storage: a `wmkf_answervalues` Memo column of `{value,label}` pairs. Row-per-option
  is impossible (alternate key is suggestion + question key); a Dataverse multi-select
  Choice column is rejected (options are runtime config, not column metadata).
- The client sends numeric values only; the server builds the pairs from live options.
- Only Q3 is multi-select. Q4/Q10 show ☐ in Word but are single-choice. No "Other".
- No sandbox rehearsal — the controlled production smoke replaced it.

**Do not reconcile the frozen plan against incidental source changes.** It cites 30
source files; per-change reconciliation cost more than the drift it prevented.

## Recall Rule

Read before any work on the reviewer review form, the staff review-question editor,
the answer snapshot, or end-to-end review-entry testing. Checkbox support is a
prerequisite for the review form matching the owner's reworked question set, so it
sequences ahead of the never-yet-executed live submission rehearsal in
[[project-reviewer-reliability-data]]'s neighbor, `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.

## The ask (owner, S375, 2026-07-25)

The review form has been reworked to contain **checkbox questions**, specifically:

- **Check all that apply** — multi-select from a fixed option list, zero/one/many
  selections per question.
- **Checkbox plus free-text "Other"** — multi-select where one option opens a text
  field, so an option can carry a text payload.

The owner has the reworked form in a document and will share it; the exact question
list, option sets, and required-ness come from that document, not from this file.

## Verified state: no checkbox type exists (2026-07-25)

The review-question path supports exactly three types — `picklist` (rendered as
**single-choice radios**), `richtext`, `string`. Verified by a repo-wide
disconfirming grep for every `type === '...'` comparison in `lib`/`pages`/`shared`:
the other form types it surfaced (`table`, `file`, `longtext`, `rating`) belong to
the **separate** applicant/grantee form schema (`lib/utils/form-schema.js`,
`shared/forms/phase-ii-research-2026-06/`) and the virtual review panel, not to the
reviewer review form. Per-layer evidence:

- `lib/external/review-question-fetcher.js:29` — `SUPPORTED_TYPES` allowlist.
- `lib/admin/review-question-save.js:69` — same allowlist on the staff save path.
- `shared/components/admin/ReviewQuestionsSection.js:25-26` — editor dropdown offers
  only "Rich text (narrative)" and "Rating (single choice)".
- `shared/components/external/ReviewAuthoringForm.js:404-447` — picklist renders as
  `type="radio"`, so selections are mutually exclusive by construction.
- `lib/external/build-review-submission.js:83-124` — picklist normalizes to ONE
  integer; any unrecognized type produces an `unsupported field type` error.
- `wmkf_appreviewanswer` (`lib/dataverse/adapters/review-answer.js:44-50`) — a single
  `wmkf_answervalue` number plus one `wmkf_answertext` / `wmkf_answerhtml`. **There is
  no multi-value column**, so multi-select needs a storage decision, not just a
  renderer.
- `shared/utils/review-matrix.js:146` — average/spread is picklist-only; the Compare
  grid, DOCX/PDF export, and AI synthesis all derive from that matrix.

## Hazard: do not add a checkbox row directly in Dataverse

`getActiveQuestionSet()` is deliberately fail-closed — an unrecognized
`wmkf_questiontype` throws, and `context`/`draft`/`submit` all 500 on that throw. A
`checkbox` row hand-written into `wmkf_reviewquestion` would break **every reviewer's
portal page**, not just render one question oddly. The type must ship in code first.

## Probed live state (2026-07-25) — do NOT re-infer this

A Codex adversarial review refuted the first plan's "blank slate" claim, which had been
inferred from a doc note saying no reviewer had submitted through the *portal*. Probed
via `scripts/probe-live-review-questions.mjs` and `scripts/probe-review-blank-slate.mjs`:

- The live `wmkf_reviewquestion` set is **byte-identical to the seeded schema**. The
  owner believed they edited it on 2026-07-25; neither the set nor
  `review_question_audit` shows any change after 2026-06-29. The edits never reached
  Dataverse — most likely an admin save that hit the `missingParentBoundKeys` 400.
- `wmkf_appreviewanswer` is **NOT empty**: sentinel rows (`answerValue=99`, empty text)
  on one synthetic fixture whose review file is `eicar-test-bytes.pdf` (virus-scan test
  data, not a review).
- `review_drafts` holds a draft belonging to reviewer lastname `Gallivan_test`.

Net: no *real* reviewer data, so keys/types/columns are still freely redefinable — but
that is a decision to dispose of known test artifacts, not an absence of data. Say it
that way; the sloppy version is what the review caught.

## Reconcile list for when a checkbox type ships

The `picklist | richtext | string` list is restated in these durable surfaces — all
CORRECT as of 2026-07-25, and all needing an update in the same pass that adds a new
type (grepped S375):

- `docs/atlas/dataverse-wmkf-reviewquestion.md:31` and `:33` — live column semantics.
- `docs/atlas/dataverse-wmkf-appreviewanswer.md:29` — snapshot `wmkf_questiontype`.
- `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md:89` and
  `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md:74` — completed-epic design
  records; classify as historical rather than silently rewriting them.
- `docs/atlas/postgres-review-drafts.md:18` — `draft_json` shape per type, which a
  multi-value answer changes.

## Prior art

`shared/forms/phase-ii-research-2026-06/schema.js:24` documents a `bool` → checkbox
type in the **applicant/grantee** form system. That is prior art for a SINGLE
checkbox only; no multi-select / check-all-that-apply type exists anywhere in the
repo, so the multi-value storage and rendering decisions are genuinely new.

## Related

- [[project-staff-review-rescue-tool]] — the staff manual-entry form uses the same
  producer and question set, so it must gain checkbox support in the same pass.
- [[project-review-output-formatting]] — DOCX/PDF rendition of a multi-select answer
  is part of the read-back surface.
