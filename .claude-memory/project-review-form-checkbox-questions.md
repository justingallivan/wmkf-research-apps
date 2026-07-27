---
name: project-review-form-checkbox-questions
description: Current release boundary for the reviewer-form multiselect change: compatible code/schema/questions are live, the primary portal smoke passed, synthesis remains red, and reviewer exposure is held.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-27 via frozen plan, production evidence artifacts, current source, and focused contract tests
---

## Recall Rule

Read this when: changing the reviewer question set, answer snapshots, staff
manual-entry form, review matrix/exports, or the multiselect release.

Do:
- Treat `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md` as the frozen release
  contract and preserve its closed owner decisions.
- Keep the producer→snapshot→consumer chain aligned: live options canonicalize
  numeric client values into `{value,label}` pairs; every reader isolates corrupt
  JSON; only explicit rating keys feed averages.
- Hold reviewer exposure until synthesis succeeds and the remaining release
  rehearsal/rollback gates are deliberately cleared.

Do not:
- Reopen question keys, option values, storage shape, or the `multiselect` type
  without a new owner decision.
- Infer operational readiness from green code/schema/question publication.
- Delete any preserved fixture/artifact without exact owner authority and a
  fresh read-only preflight.

Ground truth: frozen plan above; source in
`lib/external/review-question-fetcher.js`,
`lib/external/build-review-submission.js`,
`lib/dataverse/adapters/review-answer.js`,
`shared/utils/review-matrix.js`, and staff/external form consumers. Production
evidence lives under `outputs/review-form-multiselect/`.

## Current boundary (2026-07-27)

[VERIFIED] Compatible code was merged at `5282cee8`; Wave 15 was applied/read
back before deployment. The audited admin route published backward-compatible
`review-synthesis.generate` v2 and then the exact target question set:

- 12 target rows active at version `347a37e820f73890`;
- 11 legacy rows inactive;
- retained `affiliation` row identity preserved; and
- real rollback row IDs/ETags captured in the unexecuted rollback manifest.

[VERIFIED] Request `1002788` portal smoke passed context,
sanitized draft reload, atomic submit, canonical multiselect storage, Workbench
DTO/matrix, DOCX/PDF/courtesy consumers, finality, and atomic cleanup without
email. It remained red because two current-v2 synthesis attempts failed on
incomplete JSON before writeback; the original synthesis and all email markers
were preserved.

[PLANNED / HELD] Resolve synthesis, prove the staff-writer success path, rehearse
rollback, run the final smoke, then make a separate reviewer-exposure decision.
Automatic synthesis readiness is also unimplemented: owner intent is "all
invited reviews are in," with explicit staff override. The participation set is
`UNKNOWN`: declined, withdrew, released, and revoked invitations have not been
decided as included, excluded, or terminal for readiness. Current source rejects
only zero submitted reviews, and the UI hides the synthesis card at zero.

## Frozen owner decisions

- Only `affiliation` retains its key. The whole remaining set is re-keyed.
- `CORE_RATING_KEYS = ['riskLevel','overallAssessment']`; `impactAreas` must
  never enter a rating-key list.
- `riskLevel`/`overallAssessment` retain prior options and numeric values.
- Only Q3 is multi-select. Q4/Q10 render checkbox glyphs in Word but remain
  single-choice. No `Other` payload.
- Storage is `wmkf_answervalues`, a Memo containing `{value,label}` pairs. The
  client sends numeric values; the server resolves labels from live options.
- Production operations are separately controlled: schema, prompt publication,
  question publication, rollback, smoke, cleanup, and exposure are not implied
  by one another.
- No sandbox rehearsal; the controlled production smoke is the accepted path.

## Fixture and cleanup boundary

[VERIFIED] The EICAR thank-you marker was traced to the April 30 synthetic
validation, not genuine reviewer correspondence. Exact owner-approved cleanup
with `deleteContact:false` removed both test suggestions, three sentinel
answers, the sole draft, and `eicar-test-bytes.pdf`; alerts `361`/`362` completed
without warnings. Both contacts and the separately preserved Tim Newhouse/St.
Jude PDF remain. The owner later classified that PDF as a test artifact, but no
new deletion authority exists. Do not carry deletion forward.

## Evidence index

Under `outputs/review-form-multiselect/`: `question-publication-evidence-2026-07-26.json`,
`prompt-publication-evidence-2026-07-26.json`,
`preactivation-evidence-2026-07-26.json`,
`thankyou-provenance-2026-07-26.json`, and
`fixture-cleanup-evidence-2026-07-26.json`.

Historical pre-implementation type census, the complete 23-PATCH rollback
contract, and all release sequencing rationale remain in the frozen plan and
evidence artifacts. Do not expand this routed memory back into a build diary.
