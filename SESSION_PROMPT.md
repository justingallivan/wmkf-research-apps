# Session 304 Prompt: Staff-editable review questions — Phase A live, B1 (server) done; do B2 (client cutover) + E2E + Codex review of B

## Session 303 Summary

**Scoped + started a new epic: staff-editable reviewer review questions** (the
deferred §0 #6 from the authoring epic). Owner decisions captured, plan written +
Codex design-reviewed, **Phase A built + Codex-reviewed + deployed live to prod**,
and **Phase B1 (the entire server side) migrated** — all behavior-preserving.

Plan: `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md` (status IN PROGRESS;
Phase A ✅ live, B1 server ✅, B2/C/D/E pending). Full `npm test` green except the
documented expected-red `bill.test.js` / `discovery-verification-status.test.js`.

### Owner decisions (S303, all in plan §0)
1. Fully variable scope — staff edit **all** questions incl. ratings.
2. System of record = new Dataverse entity `wmkf_reviewquestion`, read via a
   cached fail-closed fetcher (PolicyFetcher pattern).
3. Live edit; the `wmkf_appreviewanswer` snapshot protects history (no versioning).
4. All ratings → snapshot; retire the 3 parent rating columns. **External
   (Connor/reporting) gate RESOLVED** — only internal reader migration orders it.

### What Was Completed

1. **Plan scoped + Codex design-reviewed.** Codex caught: the parent-rating-column
   readers are fewer than I first claimed — **VRP prompt + dataverse-export do NOT
   read them** (re-verified by literal grep); `ReviewerManagePanel.js:977-979` is a
   missed DTO reader. Folded into plan §6/§11.
2. **Phase A — entity + fetcher + seed, LIVE IN PROD.**
   - `lib/dataverse/schema/wave9-review-questions/01_wmkf_reviewquestion.json`
     (entity + 8 attrs + alt key on `wmkf_questionkey`) — **created in prod**.
   - `lib/external/review-question-fetcher.js` — `getActiveQuestionSet()` (cached,
     single-flight, **fail-closed**, generation-guarded invalidate, >100 cap,
     strict sanity) + `questionSetVersion()`. 18 unit tests.
   - `scripts/seed-review-questions.mjs` — idempotent alt-key upsert; self-gates on
     `EntityKeyIndexStatus === 'Active'`. **Seeded 12 rows in prod** (affiliation
     order 0 + 11 questions); `getActiveQuestionSet()` read-back verified end-to-end.
   - Codex Phase-A review (no P0) folded: invalidate race, >100 truncation, seed
     index-race, strict-boolean required, strict-int options, dup-order.
3. **Phase B1 — server fully migrated to the fetched set (behavior-identical).**
   - `build-review-submission.js` + `validateReviewForm`: take the question set as
     a param (default static); parent-column dual-write binding via the code-side
     `reviewParentColumnByKey`; snapshot rows selected by TYPE (picklist|richtext),
     NOT "has order" (seeded affiliation has order 0). Parity tests prove the
     Dataverse-shaped set yields byte-identical output.
   - `submit.js`, `draft.js`, `context.js` all read `getActiveQuestionSet()`.
     `context.js` (stage2b) returns `questions` + `questionSetVersion`; `submit.js`
     409s `set_changed` on a stale client `setVersion` (client wiring is B2).

### Commits
- `c5a4b085` — scope + Codex design review folded into the plan
- `f06316bb` `d6b4d69c` — Phase A build + Codex-review fixes
- `3701dc46` — Phase A live in prod (entity created + 12 rows seeded)
- `b13bda93` — B1 producers parameterized (parity-tested)
- `2beb247e` — B1 submit route + set_changed
- `de28dbe6` — B1 draft + context routes

## Next Items

### Verified Open

1. **Phase B2 — client cutover. ✅ DONE (S304).**
   `ReviewAuthoringForm` renders from the `context` set (`data.questions`, no static
   import), echoes `setVersion` + handles the `set_changed` 409 reload, and reconciles
   the draft type-aware on load; `ReviewFormFields` gained an optional `fields` prop
   (default static; `ReviewerManagePanel` stays static per §5). Real-build E2E green
   (7 cases incl. render-from-context, setVersion echo, set_changed reload, type-mismatch
   reconcile). **Phase B Codex-reviewed (S304):** no P0; two P1s fixed + regression-tested
   — `questionSetVersion` now hashes `label`/`hint` (audit integrity: snapshot persists
   `questionText=label`), and the `set_changed` branch flushes the draft so in-debounce
   edits survive reload (plan §11). Next: **Phase C (admin variable-length editor)**.
   Evidence: plan §5/§8/§11 (✅ DONE), `tests/e2e/reviewer-stage2b-authoring.spec.js`.

   _Superseded original task note:_
   - Make both components consume the question set from the `context` response
     (`data.questions`) as props instead of the static import.
   - Send `data.questionSetVersion` back on the `/submit` POST body as `setVersion`
     (the server-side `set_changed` 409 is already wired; client must echo + handle
     it by prompting a reload).
   - **Type-aware draft reconciliation** (Codex P1): on form load, overlay
     `draft_json` onto the current set by key, discarding a value whose stored
     shape doesn't match the current field `type` (richtext↔picklist change).
   - Then E2E parity (Playwright/Chromium, real build): authoring renders from the
     context set, autosave, submit → read-only, set_changed reload path.
   - **Ship B1+B2 together is now moot** (B1 already shipped behavior-identically
     because the seeded set == the static schema; B2 is additive on top).
2. **Phase B Codex review** once B2 lands (cadence: each phase Codex-reviewed).
3. **Phase C — admin editor. ✅ LIVE (S304).** `pages/api/admin/review-questions.js`
   + pure `lib/admin/review-question-save.js` + `ReviewQuestionsSection.js`
   (drag-reorder), atomic `executeChangeset` save, row-identity key-immutability,
   `questionSetVersion` optimistic-lock (409 set_changed), Postgres audit
   (migration 022 — **not yet applied to prod**), `invalidate()`. 25 tests green
   (17 unit save + 10 route integration + 4 RTL). **Codex-reviewed (S304): no P0;
   3 P1s fixed** — required `baseVersion` + per-row `If-Match` optimistic lock
   (412→409 reload), 100-row cap, and a guard rejecting removal of the four
   parent-bound rows (affiliation/impact/risk/overallRating) until Phase E.
   **Next: apply migration 022 to prod, then Phases D → E**
   (migrate the §6 parent-column readers + two legacy staff writers to the
   snapshot; then stop-write/drop the parent columns — external gate already clear).

### Owner Decision Needed (carried from S303, not addressed)

1. Remit-flag on review-completion — wire `wmkf_authorizationtoremitpaymentflag`
   on submit? Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.

(Ops/Steph BILL-honorarium update — DONE, sent by Justin S304.)

### Parked

1. The longer carried list (BILL API access, PNI self-report, workbench access
   boundaries, applicant-exclusion, awardee onboarding, Dataverse settings audit,
   GRANTEE_PORTAL title provenance, nomenclature/app-sunset sweep). Re-open trigger:
   owner prioritization. Evidence: S302 prompt + `.claude-memory/MEMORY.md` router.

### Do Not Reopen Without New Decision

1. **Phase A is COMPLETE + LIVE** (`wmkf_reviewquestion` created + seeded in prod,
   read-back verified). Do not re-create or re-seed (seed is idempotent if needed).
   Evidence: `docs/atlas/dataverse-wmkf-reviewquestion.md`.
2. **B1 server is done + behavior-identical.** The static `reviewFormSchema` is
   retained as the field-shape + seed + helper source + the default param — do NOT
   delete it. Evidence: plan §1, `commit de28dbe6`.
3. **VRP prompt + dataverse-export do NOT read the parent rating columns** (Codex
   re-verified S303). Don't list them as retirement blockers. Evidence: plan §6.

### Verify Before Acting

1. **Phase D/E parent-column retirement is DESTRUCTIVE.** Before stop-write/drop:
   grep the live §6 reader table + the two legacy staff writers, confirm each reads
   the snapshot. Evidence: plan §6/§7. (External gate is resolved; internal
   migration is not.)

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md` | The epic plan — Phase A ✅ live, B1 server ✅; §5 = B2 client spec; §11 = Codex logs. |
| `lib/external/review-question-fetcher.js` | `getActiveQuestionSet()` (cached, fail-closed) + `questionSetVersion()`. |
| `lib/external/build-review-submission.js` | `validateReviewSubmission`/`buildReviewSubmission(…, questionSet)`. |
| `lib/external/review-form-schema.js` | Retained: field shape, seed, helpers, `reviewParentColumnByKey` (dual-write binding), `labelForOption`. |
| `pages/api/external/review/[token]/{submit,draft,context}.js` | Reviewer routes — now read the fetched set; context emits `questions`+`questionSetVersion`; submit `set_changed`. |
| `shared/components/external/ReviewAuthoringForm.js` + `ReviewFormFields.js` | **B2 ✅ DONE** — `ReviewAuthoringForm` renders from `data.questions`; `ReviewFormFields` has an optional `fields` prop (default static, staff path unchanged). |
| `scripts/seed-review-questions.mjs` | Idempotent seed (self-gates on alt-key Active). |

## Testing

```bash
# Phase A + B1 unit/integration (all green):
npx jest tests/unit/review-question-fetcher.test.js tests/unit/build-review-submission.test.js \
  tests/integration/external-review-submit-route.test.js tests/integration/external-review-draft-route.test.js \
  tests/integration/external-review-routes.test.js
# Re-verify the live prod question set reads back (12 rows):
#   getActiveQuestionSet() via a small script with lib/dataverse/client loadEnvLocal()
# Full suite green except expected-red bill/discovery:
npm test
```

## Gotchas / Continuity

- **Current prod state is consistent + safe:** server reads the Dataverse set,
  which is seeded IDENTICAL to the static schema the client still imports — the
  live reviewer flow behaves exactly as before. `questions`/`questionSetVersion`
  in the context response are additive and currently ignored by the client.
- **Fetcher is fail-closed** — if `wmkf_reviewquestion` is empty/unreachable,
  context/submit/draft 500 (intentional; can't author against an unknown set).
- **Key format allows camelCase** (`overallRating`): `^[a-z][a-zA-Z0-9_]*$`.
- **`set_changed`**: server already 409s a stale `setVersion`; client doesn't send
  one yet (B2), so the check is skipped today — no false positives.
