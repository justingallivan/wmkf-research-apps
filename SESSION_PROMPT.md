# Session 346 Prompt: Resume reviewer-invite send-side validation

## Session 345 Summary

Dynamics-decomposition session. Closed out **Checkpoints C, D, E, F** — the entire remainder of
`docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md`. The plan is now **COMPLETE**: `dynamics-service.js`
went from 1,728 L to a 479 L thin facade delegating to 11 modules under `lib/services/dynamics/`.
Every checkpoint had characterization-first coverage, mutation-proofs on the load-bearing
invariants, and either a DEDICATED Codex adversarial review (C/D/E) or an equivalent batched
verification (F, lower-risk).

### What Was Completed

1. **Checkpoint C — `write-core.js` (Stage 6)** (`c350a27f`, review `8bbead47`). DAL entity-write
   core: `_withCallerId`, `_writeFetch`, `createRecord`, `updateRecord`, `updateIfEmpty`,
   `deleteRecord`, `disassociate`. New characterization test (12 tests) pinned `updateIfEmpty`'s
   5 discriminated outcomes + plain-Error/`.status` shapes — mutation-proven, green pre/post.
   Codex adversarial review: `approve`, no material findings.
2. **Checkpoint D — `changeset.js` (Stage 7, highest-risk)** (`8d08b57f`, review `e7280940`).
   `executeChangeset` + 8 private `$batch` builders/parsers moved as one unit. The pre-existing
   17-test suite served as the C11 characterization baseline — **mutation-proven this session**
   (weakening the under-count guard, and moving the DAL assert before input validation, both
   correctly break tests). Codex: `approve`, byte-identity comparison confirmed no drift.
3. **Checkpoint E — `email.js` (Stage 8, CI-blind-spot)** (`8a97f54f`, review `90622fce`).
   `resolveSystemUser`, `createEmailActivity`, `addEmailAttachment`, `sendEmail`,
   `createAndSendEmail`. These 3 writes are `NON_ENTITY_TRANSPORT_METHODS` — exempt from the
   static access-layer gate, so the runtime assert is the *only* enforcement; a dropped assert
   would be CI-invisible. Codex independently re-verified assert-first placement, the C9
   call-time env read, the sequential attachment loop, and the frozen unescaped `resolveSystemUser`
   filter (C7 — deliberately NOT fixed) by exact line number; all disconfirming-checked before
   landing in the plan doc. Verdict: `approve`.
4. **Checkpoint F — `ai-run.js` + facade finalize (Stages 9–10)** (`7807e3ce`). Moved
   `AI_RUN_TASK_TYPES`/`AI_RUN_STATUSES`/`logAiRun`/`_truncateForMemo`. This is the C1 "known
   trap": `logAiRun` reads the picklist maps as static-property accesses (not calls), so the
   facade had to re-expose them as its own statics — dropping that would silently break every
   call. New characterization (7 tests, none existed before) pinned facade-static resolution,
   unknown-taskType/status throws, and marker math — mutation-proven (forcing the trap condition
   correctly fails the test). Facade finalize: dropped 3 dead imports, updated the plan's status
   header/frontmatter to reflect completion, regenerated `docs/DOCS_CATALOG.md`.

Verified throughout: full suite **5197/5197** (was 5178 at S344 start), build green, ALL FIVE
LAW gates + self-tests + `check:types` + the full doc/memory gate set green at every commit.

### Commits (all on main, pushed)
- `c350a27f` write-core.js · `8bbead47` C review recorded
- `8d08b57f` changeset.js · `e7280940` D review recorded
- `8a97f54f` email.js · `90622fce` E review recorded
- `7807e3ce` ai-run.js + facade finalize (Checkpoint F, plan marked complete)

## Next Items

### Verified Open

1. **Resume reviewer-invite send-side validation** (carried S341–S345 — still only the
   read-only half is done). Evidence: `git log 64ab81a5..HEAD` still has no send-path commits
   (re-verified S345 — this session's work was entirely on the Dynamics decomposition, unrelated
   surface); `reviewer-invite-capture-mode-not-full-sandbox.md`. Unexercised: capture-send +
   "possibly sent — verify" retry state, abstract-edit save + 409 compare-and-set. Requires a
   THROWAWAY reviewer suggestion + proposal (capture blocks email only — still mints Dataverse
   tokens + stamps lifecycle).

### Owner Decision Needed

1. **"Remove entirely" discoverability.** Evidence: `shared/components/reviewers/ReviewerInvitePanel.js:458-513`;
   owner raised S344 (couldn't find it). The permanent-delete is a deliberate two-step behind the
   collapsed "Removed (N)" section. If that's too hidden, options: surface it on active rows behind
   the confirm modal, or default-expand "Removed". Needs an owner call before touching a shipped flow.
   (Carried, unchanged.)
2. **Reviewer closeout-payability design.** Evidence: `project-reviewer-closeout-payability.md`
   (owner ask S343). Payable/not-payable flag + potential/invited reset button. Needs build-shape
   decision. (Carried, unchanged.)
3. **How far to push the TS `check:types` gate.** Evidence: `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`.
   Optional ratcheting beyond the closed 2-route untrusted surface — the DynamicsService facade
   is now fully `// @ts-check`'d as of this decomposition. (Carried, unchanged.)

### Parked

1. Residual prompt-legacy write-path audit ([ASSUMED]) — confirm no other LLM free-text reaches a
   length-capped `akoya_request` field. Evidence: `project-prompt-legacy-audit-followup.md`; low priority.
2. Spec-audit design-docs recovery (work computer). Evidence: `project-spec-audit-docs-recovery-parked.md`.
3. Product/UX asks: review-output formatting (`project-review-output-formatting.md`), campaign-settings
   UX revisit (`project-campaign-settings-ux-revisit.md`).
4. Project-wide prompt-cache-hit audit. Evidence: `project-cache-hit-rate-review.md` (S339 flagged).
5. Dependabot #53 merge once real tests green. Evidence: `gh pr checks 53`.

### Do Not Reopen Without New Decision

1. **DynamicsService decomposition is COMPLETE** (S345, all 6 checkpoints). Evidence:
   `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` status header + frontmatter (`status: active`,
   summary marked DONE). `dynamics-service.js` is now a 479 L thin facade over
   `lib/services/dynamics/*.js` (11 modules) — this is the intended end-state, not a
   partially-done refactor. Do not re-inline the modules "for simplicity."
2. **Peer-review Executor migration is SHIPPED** (S344, `1559e8dc`/`4dd5c84b`). Evidence:
   `project-peer-review-executor-migration.md`, `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`. The
   legacy generators are ROLLBACK-ONLY, not the live path; don't "restore" them as the source.
3. **4 PDF-upload apps are SUNSET** (S344, `f9d9a593`). Evidence: `APP_LIFECYCLE_REGISTRY`,
   `docs/PROMPT_LEGACY_AUDIT.md` disposition banner. Code retained by design for DV-native migration;
   superusers can't browser-load them (documented + accepted) — don't re-add keys to `ALL_APP_KEYS`.
4. **"Remove entirely" two-step is by design** (S343). Don't add a one-click permanent-delete on
   active reviewers without an owner decision (see Owner Decision #1).

### Verify Before Acting

1. **Prompt rows are LIVE in Dataverse** (`peer-review-summarizer.*` re-seeded S344 with `a7_preamble`).
   If re-seeding or editing these rows, keep `{{a7_preamble}}` in the system prompt — the route's
   `assertSystemIncludes: reviewNonces` fail-closes if it's dropped (that's intended). Evidence:
   `scripts/seed-peer-review-summarizer-prompts.js`, `shared/config/prompts/peer-reviewer-dynamics.js`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/dynamics-service.js` | Now a 479 L thin facade — all 33 static methods delegate to `lib/services/dynamics/*.js` |
| `lib/services/dynamics/write-core.js` | DAL entity-write core (createRecord/updateRecord/updateIfEmpty/deleteRecord/disassociate) |
| `lib/services/dynamics/changeset.js` | Atomic `$batch` changeset (executeChangeset + parser/builders) |
| `lib/services/dynamics/email.js` | CRM email pipeline (resolveSystemUser/createEmailActivity/addEmailAttachment/sendEmail/createAndSendEmail) |
| `lib/services/dynamics/ai-run.js` | AI run audit logging (logAiRun, picklist maps) |
| `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` | The full decomposition plan — now marked complete, all checkpoint evidence + review verdicts recorded |
| `tests/unit/dynamics-service-write-core.test.js` | New (S345) — write-core characterization |
| `tests/unit/dynamics-service-ai-run.test.js` | New (S345) — ai-run characterization incl. the C1 static-property trap |

## Testing

```bash
npm test                                                  # full suite (5197 green as of S345)
npm run build
npm run check:dataverse-access-layer && npm run check:route-service-boundary \
  && npm run check:dynamics-context-boundary && npm run check:odata-escape \
  && npm run check:trust-boundary-guid                    # ALL FIVE LAW gates
npm run check:types                                       # DynamicsService facade is fully @ts-check'd
# Reviewer-invite send-side (still to do; THROWAWAY record):
#   REVIEWER_EMAIL_DELIVERY_MODE=capture npm run dev   # capture blocks email, NOT Dataverse writes
```
