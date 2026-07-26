# Session 376 Prompt: Finish the review-form multiselect release

**Current status (2026-07-26):** the original implementation brief below is
historical. The compatible multiselect code and production schema expansion are
complete and deployed; the known-fixture cleanup is also complete. The live next
work is the remaining pre-exposure sequence in
`docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md` §9. The first controlled Request
#1002788 production smoke passed external draft/submit, canonical multiselect
storage, workbench DTO/matrix, panel DOCX/PDF, courtesy DOCX, finality, and
cleanup, but failed `review-synthesis.generate` twice with incomplete JSON.
The original request synthesis and email markers were preserved and no email was
sent. The immediate open gate is synthesis resolution (or the plan's prompt-only
rollback), followed by the remaining staff-writer success rehearsal, question/
prompt rollback proof, republish, final smoke, and exposure. The target question
publication, independently routed production HTTP writer gate, and backward-
compatible synthesis prompt v2 publication all completed 2026-07-26.

## Session 375 Summary

The owner's reworked research reviewer form introduced a **check-all-that-apply**
question. Session 375 established that the review-question system cannot express one,
produced an accepted and frozen build plan for adding it, and shipped two fixes that
were blocking or adjacent to that work. **Implementation of the multiselect feature
itself has NOT started.**

The next session is expected to be Codex implementing against the frozen plan.

### What Was Completed

1. **Verified the gap and its hazard**
   - The review-question path supports `picklist` (single-choice radios), `richtext`,
     and `string` only — enforced at `review-question-fetcher.js:29`,
     `review-question-save.js:69`, and the admin dropdown.
   - `wmkf_appreviewanswer` stores a single `wmkf_answervalue`; there is no
     multi-value column, so "check all that apply" needs a storage decision.
   - **HAZARD:** `getActiveQuestionSet()` is fail-closed. Hand-adding a `checkbox`
     row to `wmkf_reviewquestion` in Dataverse makes `context`/`draft`/`submit` all
     500 — it breaks every reviewer's portal page, not just one question.
   - Commits `a5e2a54d`, `56a16653`.

2. **Measured live state instead of inferring it**
   - `scripts/probe-live-review-questions.mjs` and
     `scripts/probe-review-blank-slate.mjs` (both read-only, committed).
   - The live question set is byte-identical to the seeded schema. The owner's
     2026-07-25 admin edits never reached Dataverse; `review_question_audit` shows
     no change after 2026-06-29.
   - The answer snapshot is **not** empty: sentinel rows (`answerValue=99`) on one
     synthetic fixture whose review file is `eicar-test-bytes.pdf`, plus one
     `Gallivan_test` Postgres draft. No real reviewer data.
   - Commits `b66366eb`, `201f11be`, `b6d71ed7`.

3. **Corrected the sandbox record — absence, not staleness**
   - `scripts/probe-sandbox-reviewer-schema.mjs` (read-only metadata probe): the
     sandbox org authenticates and `akoya_request` is present, but
     `wmkf_appreviewersuggestion`, `wmkf_appreviewanswer`, `wmkf_reviewquestion`,
     and `wmkf_potentialreviewer` all 404. The reviewer chain was never provisioned
     there. Docs previously said "schema-stale", implying drift a re-run would fix.
   - Corrected across the Atlas, campaign strategy, and sandbox-state memory.
   - Commits `4c24e85b`, `9ac640df`, `75afb1d2`.

4. **Shipped: authoritative question-set resolution at write boundaries**
   - The fetcher cache is module-local with a 5-minute TTL, and `invalidate()` clears
     only its own process. A submitting instance compared the client's `setVersion`
     against its own stale set — both agreed, the `set_changed` guard passed, and rows
     committed against a retired question set.
   - `getAuthoritativeQuestionSet()` resolves uncached; used by portal submit, staff
     manual entry, legacy upload, and mark-received-no-file. Reads stay cached by
     design (self-correcting). The admin save path was never exposed.
   - Commit `afed10ec`. 170 tests green across six suites.

5. **Shipped: the question editor no longer silently loses staff edits**
   - A stale-version 409 used to disable Save and offer only Reload, discarding
     everything typed. It now resyncs while KEEPING edits, re-baselines the version,
     and highlights which rows changed/were removed/were added underneath.
   - A no-op save wore success styling; it now has a neutral tone and says nothing was
     written. The post-save reload is skipped on a no-op — `load()` clears `message`
     and was wiping the notice before it could render.
   - Commit `7b22dd85`. 7 tests green.

6. **Plan authored, adversarially reviewed twice, accepted, frozen**
   - Draft 1 (Claude) → Codex NO-SHIP → draft 2 → Codex NO-SHIP → draft 3/4 (Codex
     authored) → Claude review → accepted.
   - Commits `3e94a33e`, `73fd663d`, `4ecb6f73`, `8658792e`, `80c1179b`, `e92e0f2f`.

### Commits

- `a5e2a54d` — Record verified gap: review form has no checkbox/multi-select type
- `56a16653` — Add reconcile list for the review-question type restatements
- `b66366eb` — Add read-only probe for the live review-question set
- `3e94a33e` — Scope the review-form multi-select build
- `73fd663d` — Revise multiselect build plan against Codex adversarial review
- `201f11be` — Record probed review-data state so it is not re-inferred
- `b6d71ed7` — Mark the probe result as rechecked after the script fix
- `4c24e85b` — Measure the sandbox reviewer schema instead of inferring it
- `9ac640df` — Reconcile the campaign-gate sandbox claim with the 2026-07-26 probe
- `afed10ec` — Resolve the question set authoritatively at review write boundaries
- `75afb1d2` — Correct sandbox language across durable docs: absence, not staleness
- `4ecb6f73` — Plan draft 4 (Codex-authored) — production rehearsal, semantic key rule
- `8658792e` — Reconcile the plan's cache dependency with the shipped fix
- `80c1179b` — Acknowledge same-session source changes in the two plan docs
- `e92e0f2f` — Accept the plan, re-key the question set, freeze the document
- `7b22dd85` — Stop the question editor from silently losing staff edits

## Next Items

### Verified Open

1. **Complete the remaining pre-activation release gates.**
   Evidence: `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md` records compatible code
   deployed on `main`, wave 15 read back in production, and the frozen target
   12-row set active at version `347a37e820f73890`. The compatible synthesis
   prompt is current, but its first production execution failed twice with
   `Claude output not valid JSON: Unexpected end of JSON input` under v2 with
   `wmkf_ai_maxtokens=8000`. Resolve that red gate (or execute the plan's
   prompt-only rollback), then complete the three staff-writer success paths,
   rollback/republish rehearsal, final smoke, and exposure.
   **Target go-live remains 2026-08-15.**

### Recently Closed

1. **Primary Request #1002788 portal smoke and cleanup completed, with synthesis
   red, 2026-07-26.**
   The external context exposed only `Proposal_1002788.pdf`; token regeneration
   cleared the disposable draft; autosave stripped a script tag, dropped an
   unknown key, and canonicalized `[3,1,3,999,'x']` to `[1,3]`; final submit
   atomically wrote 11 answer snapshots and the parent finality fields.
   `impactAreas` stored `answerValue=null` plus the exact two value/label pairs.
   Workbench hydration, categorical tallies, numeric ratings, panel DOCX/PDF,
   courtesy DOCX, and both finality locks passed. No email route ran and all email
   markers remained unchanged. Two current-v2 synthesis calls failed before
   writeback with incomplete JSON, producing failed append-only runs
   `f5aa3712-4789-f111-ab0f-6045bd018a07` and
   `04805a39-4789-f111-ab0f-6045bd018deb`; the pre-smoke request synthesis hash
   remained `a91f05cc0a20cad72341db9d7fc5fe808ed3b28610a35dfdaca82d69beebbcba`.
   A 12-operation atomic cleanup deleted the 11 answers and restored the test
   suggestion to `materials_sent` with no draft, received timestamp, or
   affiliation. Gitignored local evidence:
   `outputs/review-form-multiselect/primary-smoke-evidence-2026-07-26.json`,
   SHA-256 `1eb2b8b7542cdd829ed5bcc87b2a090ad4a02a14e8ebdce751001bd8eb6645da`.

2. **§9.2(2) exact target question publication completed 2026-07-26.**
   The audited production admin full-set route retained `affiliation`, created
   the eleven frozen target rows, and retired the eleven legacy rows atomically.
   Production now has exactly 12 active target rows at normalized version
   `347a37e820f73890` and 11 inactive legacy rows. Audit request
   `3d0c7160-3a09-4d96-ab9f-36ebe63e0e7a` has the required pending/completed
   pair, summary `{created:11, updated:0, deleted:11, reordered:0}`, and no
   warnings. Three independently routed admin reads returned the target version.
   The synthesis prompt remained current v2 and matched its tracked source. A
   reviewed 23-PATCH rollback manifest is preserved but has not been executed.
   Evidence:
   `outputs/review-form-multiselect/question-publication-evidence-2026-07-26.json`,
   SHA-256 `9f5dead9ecc9989e2701f7ec6573c6313eb295a68a40b1ebc6992d3faade16cf`.

3. **§9.2(1) backward-compatible synthesis prompt publication completed
   2026-07-26.**
   Production prompt `review-synthesis.generate` advanced monotonically from
   v1 `d97a4a17-6977-f111-ab0f-000d3a306da2` to current v2
   `7423049a-3f89-f111-ab0f-7ced8d3d15a6` through the superuser admin route.
   Request `codex-review-synthesis-multiselect-2026-07-26` completed with no
   warnings. Only the system prompt changed; body, variables, and output schema
   hashes are unchanged. The legacy question-set version
   `119da525418d1d43`, raw-row digest, row count, keys, and types were identical
   before/after. The complete v1 rollback payload is preserved in
   `outputs/review-form-multiselect/prompt-publication-evidence-2026-07-26.json`,
   SHA-256 `50b7a4974e6bcd5e7dd1135bf1edd228f300fe42de406d5951c3ca10dbdbe428`.

4. **§9.1(3) independently routed production HTTP writer evidence completed
   2026-07-26.**
   The external context and all four writer routes resolved the live legacy
   question-set version `119da525418d1d43` through separate production HTTP
   requests. External submit and manual entry stopped at `409 set_changed`;
   legacy upload and mark-received stopped at `400` form validation. The
   approved Request #1002788 test suggestion retained the same ETag and state
   digest before/after, with zero answers, no received timestamp or review file,
   and its one pre-existing draft unchanged. Evidence:
   `outputs/review-form-multiselect/production-http-writer-evidence-2026-07-26.json`,
   SHA-256 `b6885185ab7281c53ac658c62803f831941732f69f75cbb3ee4784960a2c1b62`.

5. **§8 fixture cleanup completed 2026-07-26.**
   The owner confirmed both exact records were disposable tests and authorized
   their children/linked test artifacts with `deleteContact:false`. The first
   preflight stopped on a then-unclassified Tim Newhouse/St. Jude PDF in the EICAR
   folder; exact-item deletion preserved it. The owner later identified that PDF
   as another test artifact from the retired reviewer-PDF experiment. It remains
   preserved and has not received separate deletion authorization. Alerts
   `361`/`362` completed with no
   warnings. Both test suggestions, three sentinel answers, sole draft, and
   `eicar-test-bytes.pdf` are gone; both CRM contacts, the unrelated PDF, parent
   requests, and synthesis hashes remain. Evidence:
   `outputs/review-form-multiselect/fixture-cleanup-evidence-2026-07-26.json`,
   SHA-256 `021c21fc8b2f90aee2651aab3df19f04df3d79d76d36c8385f86a999f5d6666e`.

### Parked

1. Full read-path cache coherence.
   Evidence: plan §0.2 — "not a prerequisite for this plan"; the accepted residual is
   a ≤5-minute stale render that self-corrects at the write boundary.
   Re-open trigger: evidence of reviewers actually losing form-fills to it.

2. Provisioning the reviewer schema in the Dataverse sandbox.
   Evidence: `scripts/probe-sandbox-reviewer-schema.mjs` (4 of 5 entities 404);
   `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` Mode C campaign gate.
   Re-open trigger: an owner decision to fund it as its own project. It is NOT on the
   multiselect critical path — the controlled production smoke replaced it.

### Verify Before Acting

1. **Do NOT reconcile the frozen plan against incidental source changes.**
   Evidence: plan header — "FROZEN … Reconcile it once, in full, when implementation
   lands." It cites 30 source files; per-change reconciliation cost more than the drift
   it prevented. The §0.2 recheck markers were the last such pass.

2. **The multiselect writer allowlists are complete; do not re-infer the historical
   `picklist || richtext` gap.**
   Portal submit, manual entry, legacy upload, and mark-received now admit
   `multiselect` snapshot keys and use the shared canonical producer. Verify
   source/tests before changing this contract.

### Do Not Reopen Without New Decision

1. **The whole question set is re-keyed; only `affiliation` keeps its key.**
   Evidence: plan §1.1. Draft 4's semantic-retention rule left `q4` holding Q5, `q5`
   holding Q6, `q6` holding Q8, `q8` holding Q9. With no stored answers, legibility
   won. `CORE_RATING_KEYS = ['riskLevel','overallAssessment']`. `impactAreas` must
   NEVER appear in a rating-key list.
2. **`riskLevel` and `overallAssessment` carry the prior options and numeric values
   unchanged.** A re-key, not a re-scoring. Never renumber option values — Q10 displays
   Excellent-first by reordering the options ARRAY only.
3. **Storage is a `wmkf_answervalues` Memo column holding `{value,label}` pairs.**
   Row-per-option is impossible (the alternate key is suggestion + question key);
   a Dataverse multi-select Choice column is rejected (options are runtime config).
4. **The client sends numeric values only.** The server builds `{value,label}` pairs
   from live options and derives `answerText` from them. Never trust a client label.
5. **Only Q3 is multi-select.** Q4 and Q10 render with ☐ glyphs in the Word document
   but are single-choice; Word has no radio glyph. There is no "Other" free-text option.
6. **No sandbox rehearsal.** The controlled production smoke is the primary
   pre-exposure rehearsal.
7. **Manual rollback procedure, not a built restore service** (plan §4).

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md` | **The frozen executable contract.** Read §1.1, §2, §3 fully before writing code |
| `lib/external/review-question-fetcher.js` | Question-set resolver; cached + `getAuthoritativeQuestionSet()` for writes |
| `lib/external/build-review-submission.js` | Validator + the single row-emission producer |
| `lib/external/review-answer-snapshot.js` | Mirrored answer-row body; must stay byte-identical to the adapter |
| `lib/dataverse/adapters/review-answer.js` | Answer field list, alt-key upsert, DTO mapping |
| `shared/components/external/ReviewAuthoringForm.js` | Reviewer form: `buildInitialValues`, `isComplete`, `FieldRow` |
| `shared/components/admin/ReviewQuestionsSection.js` | Staff question editor (conflict-preserving as of S375) |
| `shared/utils/review-matrix.js` | Compare-grid derivation; numeric aggregation is picklist-only |
| `scripts/probe-live-review-questions.mjs` | Read-only dump of the live question set |
| `scripts/probe-review-blank-slate.mjs` | Read-only answer/draft/audit census |
| `scripts/probe-sandbox-reviewer-schema.mjs` | Read-only sandbox entity-presence probe |

## Testing

```bash
rtk npm test -- --runInBand \
  tests/unit/review-question-fetcher.test.js \
  tests/unit/review-questions-section.test.js \
  tests/unit/manual-review-entry-service.test.js \
  tests/unit/mark-received-no-file-service.test.js \
  tests/unit/review-upload.test.js \
  tests/unit/external-review-services.test.js \
  tests/unit/review-matrix.test.js \
  tests/unit/reviews-tab.test.js \
  tests/integration/external-review-routes.test.js

rtk npx eslint \
  lib/external/review-question-fetcher.js \
  lib/external/build-review-submission.js \
  shared/components/external/ReviewAuthoringForm.js \
  shared/components/admin/ReviewQuestionsSection.js

npm run check:types
npm run build

# Read-only live-state probes (require the sanctioned prod-read flag)
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-live-review-questions.mjs
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-review-blank-slate.mjs
node scripts/probe-sandbox-reviewer-schema.mjs
```
