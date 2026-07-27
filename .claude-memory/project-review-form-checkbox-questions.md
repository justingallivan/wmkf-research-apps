---
name: project-review-form-checkbox-questions
description: Multiselect release boundary: code/config and staff entry are live; synthesis failed three current-v2 runs; exposure is held.
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

[VERIFIED] Request `1002788` passed the portal, canonical storage,
Workbench/export/courtesy consumers, finality, and cleanup without email.
Three current-v2 synthesis runs failed on incomplete JSON before writeback.
The 2026-07-27 follow-up proved Manual Review Entry and exact restoration:
memo hash/timestamp and outreach markers stayed unchanged; zero answers/draft
remained. Failed run `be61f383-f289-f111-ab0f-70a8a59cded0` is append-only.

[PLANNED / HELD] Fix synthesis, rehearse rollback, run a post-fix smoke, then
decide exposure. [OWNER-CONFIRMED 2026-07-27] Automatic readiness covers
selected, non-excluded invited/accepted rows and requires ≥1 receipt. Receipt
resolves with content; decline/no-response/withdrawn-sufficient/withdrew/
released or current revoked/expired token resolves without. Others block
fail-closed (including live-token non-acceptance, unresolved duplicates, invalid
state); re-minting reactivates only a participating nonterminal row whose token
was its sole resolution. Unbuilt: no auto trigger; service/card remain
zero-gated; staff keeps the explicit ≥1-receipt override.

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

[VERIFIED] The EICAR thank-you marker came from the April 30 synthetic
validation. Owner-approved `deleteContact:false` cleanup removed both test
suggestions, three sentinel answers, the sole draft, and `eicar-test-bytes.pdf`;
alerts `361`/`362` were clean. Contacts and the separately preserved Tim
Newhouse/St. Jude test PDF remain; no new deletion authority exists.

## Evidence index

Under `outputs/review-form-multiselect/`: `question-publication-evidence-2026-07-26.json`,
`prompt-publication-evidence-2026-07-26.json`,
`preactivation-evidence-2026-07-26.json`,
`thankyou-provenance-2026-07-26.json`, and
`fixture-cleanup-evidence-2026-07-26.json`.

Historical census, the 23-PATCH rollback contract, and sequencing rationale
remain in the frozen plan. Do not expand this routed memory into a build diary.
