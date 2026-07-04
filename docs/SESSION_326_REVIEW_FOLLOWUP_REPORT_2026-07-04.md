---
title: Session 326 Review Follow-up Report
kind: audit
domain: review-manager
status: active
owner: codex
created: 2026-07-04
summary: Follow-up remediation report for Session 326 Reviews tab synthesis findings, verification, and remaining next steps.
---

# Session 326 Review Follow-up Report

## Scope

This follow-up addresses the adversarial review of `outputs/SESSION_326_REVIEW_HANDOFF.md`, focused on the Phase 4 Reviews tab synthesis route.

## Remediated Findings

1. [VERIFIED] `pages/api/review-manager/synthesize-reviews.js` now carries review-answer question metadata into the synthesis digest.
   - The answer snapshot query selects `wmkf_questionkey`, `wmkf_questiontype`, and `wmkf_answervalue`.
   - The digest sent to `review-synthesis.generate` includes question key, question type, question text, answer value when present, and answer text.
   - `wmkf_answerhtml` remains outside the digest payload.

2. [VERIFIED] `pages/api/review-manager/synthesize-reviews.js` no longer reports synthesis success when the Executor failed to persist the `synthesis` output.
   - `writeResults.results[].output === "synthesis"` must be `ok: true` before the route returns HTTP 200 `{ ok: true }`.
   - `concurrent_edit` is returned as HTTP 409.
   - Other synthesis writeback failures are returned as HTTP 502.

## Regression Coverage

1. [VERIFIED] `tests/unit/synthesize-reviews.test.js` asserts that the synthesis digest includes:
   - reviewer name and affiliation;
   - question key;
   - question type;
   - question text;
   - answer value;
   - answer text.

2. [VERIFIED] `tests/unit/synthesize-reviews.test.js` asserts that answer HTML is not included in the LLM payload.

3. [VERIFIED] `tests/unit/synthesize-reviews.test.js` asserts failed Executor persistence returns failure to the client instead of HTTP 200 success:
   - `writeback_failed` -> 502;
   - `concurrent_edit` -> 409.

## Verification Run

[VERIFIED] The focused tests and gates passed on 2026-07-04:

```bash
npm test -- tests/unit/synthesize-reviews.test.js tests/unit/review-synthesis-prompt-config.test.js
npm run check:api-routes
npm run check:api-routes:self-test
npm run check:prompt-injection-tagging
npm run check:prompt-injection-tagging:self-test
npm run check:trust-boundary-guid
npm run check:trust-boundary-guid:self-test
npm run generate:docs-catalog
npm run check:docs-catalog
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
```

[VERIFIED] `npm run check:docs-catalog:self-test` is not a package script in this repository, so there was no catalog self-test to run.

## Remaining Next Steps

1. [PLANNED] Run a staged/manual review-submission rehearsal against an owner-approved test request and reviewer identity to confirm the full browser -> API -> Dataverse -> Reviews tab path with real Dataverse rows. This was not run in this code-only follow-up because it requires a safe test record and may create live run/writeback state.

2. [PLANNED] Decide whether to harden the manual reminder route findings from the adversarial review:
   - avoid echoing low-level send error details to the client;
   - distinguish failed claim updates from real reminder conflicts.

3. [PLANNED] If the synthesis prompt output quality still underuses ratings after this payload fix, add a replay fixture that feeds representative picklist and prose answers through `review-synthesis.generate` and validates the shape of `ratingSummaries`.
