---
name: project-review-form-checkbox-questions
description: Owner reworked the reviewer review form; fixed-option multiselect support, production schema expansion, compatible code deployment, and known-fixture cleanup are complete, while publication, rehearsal, and exposure remain pending.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-26 via production pre-activation and cleanup evidence bundles plus implementation source and focused contract tests
---

## Status (2026-07-26 implementation pass)

**Plan ACCEPTED and FROZEN: `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md`. The
row-backward-compatible code was promoted to `main` at `5282cee8` and deployed to
production as `dpl_7sfTLrMafYPKp7mnYdrEVjs9HmW5`; wave 15 was applied to
production and read back first on 2026-07-26. Prompt/question publication,
controlled rehearsal/rollback and reviewer exposure are deliberately still
pending. Fixture disposition completed 2026-07-26. The read-only pre-activation
probe found a sent thank-you marker on the EICAR fixture, so the frozen cleanup
contract stopped before the later deletion authority and cleanup. A follow-up
read-only investigation traced
the marker to the April 30 production validation thank-you sent to the fixture
address; it was not genuine reviewer correspondence, but the stop still required
an explicit owner cleanup decision. The owner supplied that authority with
`deleteContact:false`; alerts `361`/`362` completed with no warnings. Both test
suggestions, the three sentinel answers, sole draft, and `eicar-test-bytes.pdf`
are gone, while both CRM contacts and the separately preserved Tim Newhouse/St.
Jude PDF remain. The owner later identified that PDF as another test artifact from
the retired reviewer-PDF experiment, not a genuine review; it has not received a
new deletion authorization. Target go-live remains 2026-08-15.**
Read the plan for the release contract; this entry records the current boundary.

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
- Production operations are not implied by a green code build. Applying wave 15,
  publishing the prompt or question set, exercising rollback, and opening
  reviewer exposure remain separately controlled steps. Fixture deletion was a
  separately controlled step and cleared 2026-07-26.
- Wave 15 is a **pre-deployment** gate, not only a pre-activation gate: readers
  always select `wmkf_answervalues` and writers always emit it, so production
  metadata readback must precede merging/promoting this branch to auto-deploying
  `main`. **Cleared 2026-07-26** via
  `scripts/probe-review-answer-multiselect-field.mjs`: prod reports the nullable
  custom Memo `wmkf_answervalues`, max length 150000, and the property is selectable
  through `wmkf_appreviewanswers`.

**Do not reconcile the frozen plan against incidental source changes.** It cites 30
source files; per-change reconciliation cost more than the drift it prevented.

## Recall Rule

Read before any work on the reviewer review form, the staff review-question editor,
the answer snapshot, or end-to-end review-entry testing. Checkbox support is a
prerequisite for the review form matching the owner's reworked question set, so it
sequences ahead of the never-yet-executed live submission rehearsal in
[[project-reviewer-reliability-data]]'s neighbor, `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.

## Historical intake (owner, S375, 2026-07-25)

The initial review-form document described **checkbox questions**, specifically:

- **Check all that apply** — multi-select from a fixed option list, zero/one/many
  selections per question.
- **Checkbox plus free-text "Other"** — multi-select where one option opens a text
  field, so an option can carry a text payload.

The later frozen plan resolved that broader intake: only the fixed-option
`impactAreas` multiselect is in scope, and no option carries an `Other` payload.

## Historical pre-implementation state (verified 2026-07-25)

Before this implementation, the review-question path supported exactly three types — `picklist` (rendered as
**single-choice radios**), `richtext`, `string`. Verified by a repo-wide
disconfirming grep for every `type === '...'` comparison in `lib`/`pages`/`shared`:
the other form types it surfaced (`table`, `file`, `longtext`, `rating`) belong to
the **separate** applicant/grantee form schema (`lib/utils/form-schema.js`,
`shared/forms/phase-ii-research-2026-06/`) and the virtual review panel, not to the
reviewer review form. Per-layer evidence:

- `lib/external/review-question-fetcher.js` — `SUPPORTED_TYPES` allowlist.
- `lib/admin/review-question-save.js` — same allowlist on the staff save path.
- `shared/components/admin/ReviewQuestionsSection.js` — editor dropdown offered
  only "Rich text (narrative)" and "Rating (single choice)".
- `shared/components/external/ReviewAuthoringForm.js` — picklist renders as
  `type="radio"`, so selections are mutually exclusive by construction.
- `lib/external/build-review-submission.js` — picklist normalized to ONE
  integer; any unrecognized type produces an `unsupported field type` error.
- `wmkf_appreviewanswer` (`lib/dataverse/adapters/review-answer.js`) — a single
  `wmkf_answervalue` number plus one `wmkf_answertext` / `wmkf_answerhtml`. **There is
  no multi-value column**, so multi-select needs a storage decision, not just a
  renderer.
- `shared/utils/review-matrix.js` — average/spread is picklist-only; the Compare
  grid, DOCX/PDF export, and AI synthesis all derive from that matrix.

That gap is now closed in source: `multiselect` is an explicit fourth type, the
admin and reviewer UIs support it, every writer uses one server canonicalizer,
wave 15 defines `wmkf_answervalues`, and readers isolate corrupt JSON. The old
paragraph remains historical evidence for why the full-chain change was required.

## Release sequence: expand complete; deploy before activation

`getActiveQuestionSet()` is deliberately fail-closed — an unrecognized
`wmkf_questiontype` throws, and `context`/`draft`/`submit` all 500 on that throw. A
production release had to apply/read back wave 15 before deploying the compatible
code, because its readers and writers reference `wmkf_answervalues` even while the
old question set remains active. That gate cleared on 2026-07-26, and the compatible
code is now deployed. The prior 12-row question set remains active; a `multiselect`
row may be activated only through the later controlled publication/rehearsal steps.
Hand-writing a `checkbox` type remains invalid; the supported type name is exactly
`multiselect`.

## Pre-activation evidence (2026-07-26) — historical cleanup STOP

Committed probe `scripts/probe-review-multiselect-preactivation.mjs` produced
`outputs/review-form-multiselect/preactivation-evidence-2026-07-26.json`
(integrity digest
`a22c5029bdd7341fe81f74d53d4668b37f6f77699fea7370135cba5bd9155e30`).
It made no production writes.

- The legacy 12-row set remains active at version `119da525418d1d43`; there are
  no inactive question rows. The encoded target validates at version
  `347a37e820f73890` and would create 11 rows, retain `affiliation`, and
  deactivate 11 legacy rows.
- Four isolated production-target service processes resolved the same active
  version and stopped before their first write (`set_changed` for portal/manual;
  validation for legacy upload/mark-received). This is not independently routed
  production HTTP evidence, so that §9.1(3) gate remains open.
- The current `review-synthesis.generate` row is version 1,
  `d97a4a17-6977-f111-ab0f-000d3a306da2`; no prompt publication audit exists for
  that name. Prompt publication remains pending.
- The rollback artifact is intentionally a non-executable template. It proves
  the legacy `impact` row can be reactivated by its existing immutable ID, but
  cannot supply the future `impactAreas` row ID/ETag or cutover audit until after
  publication.
- EICAR fixture `6ad328b4-f044-f111-88b5-000d3a306d45` is selected, accepted,
  received, report/synthesis-included, owns the three sentinel answers and test
  file, and has `wmkf_thankyousentat=2026-05-01T01:11:26Z`. The frozen §8
  contract says a sent thank-you is a stop condition. No deletion approval had
  been requested at the time of this probe and nothing was removed by it.
  Follow-up provenance:
  `outputs/review-form-multiselect/thankyou-provenance-2026-07-26.json` records a
  Dynamics thank-you activity created at `01:11:24Z` and sent at `01:11:33Z`
  from `jgallivan@wmkeck.org` to the fixture address, bracketing the marker.
  Commit `ada645de`, authored two minutes later in Pacific time, records the
  exact five-phase validation run and its thank-you send. The marker is therefore
  a synthetic validation side effect. The owner later supplied explicit cleanup
  approval. Evidence digest:
  `b5e3fcbde1d0e30275d310f246b38e3e05b67bae1d6d016385eeb60727d4d2d9`.
- `Gallivan_test` fixture `3c4bb952-e061-f111-a826-000d3a306da2` has no answer,
  report, synthesis, honorarium, or sent thank-you, but owns the sole Postgres
  draft. This describes the pre-cleanup snapshot.

## Fixture cleanup completed (2026-07-26)

The owner authorized both exact fixture removals and linked test artifacts with
`deleteContact:false`. The first exact preflight stopped on an unexpected
Tim Newhouse/St. Jude PDF in the EICAR folder; the service/operator was narrowed
to delete only the exact EICAR Graph item. The owner later classified the
preserved PDF as a second legacy test artifact from the retired PDF-upload design.
Audited cleanup removed the two
suggestions, three answer rows, sole draft, and `eicar-test-bytes.pdf`. Alerts
`361`/`362` finalized successfully with no warnings. Both potential-reviewer rows
and CRM contact links remain, the Tim Newhouse/St. Jude PDF remains, no honorarium
was deleted, and the affected request synthesis hashes/timestamps are unchanged.
Evidence:
`outputs/review-form-multiselect/fixture-cleanup-evidence-2026-07-26.json`,
SHA-256 `021c21fc8b2f90aee2651aab3df19f04df3d79d76d36c8385f86a999f5d6666e`.

## Probed live state (2026-07-25) — historical baseline

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

## Reconciliation completed with the code implementation

The live durable surfaces that restated the old type list were updated with the
implementation:

- `docs/atlas/dataverse-wmkf-reviewquestion.md` — option-bearing multiselect type.
- `docs/atlas/dataverse-wmkf-appreviewanswer.md` — multiselect snapshot column,
  canonical JSON, and corrupt-row behavior.
- `docs/atlas/postgres-review-drafts.md` — numeric-array draft values.
- `docs/SERVICE_AND_UTILITY_CATALOG.md` — canonicalizer and multipart helper.
- The completed-epic authoring plans remain historical design records and were not
  rewritten as current contracts.

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
