# Session 324 Prompt: Clean main handoff; only parked/time-driven follow-ups

## Session 323 Summary

Session 323 closed the remaining S322 housekeeping work and the last reviewer-email
tail. The work stayed evidence-first: every deletion/retirement was checked against live
callers before acting, stale plan tails were explicitly deprecated instead of carried
forward, and the session ended with only time-driven or parked follow-ups.

### What Was Completed

1. **Reviewer Atlas count refresh.**
   The reviewer Atlas row-count claim was refreshed before the housekeeping work
   resumed, keeping the durable docs aligned with live state.

2. **S322 docs-drift audit applied.**
   README now points to `.env.example`; `docs/CI_GATES_REFERENCE.md` uses the live
   `:self-test` script names for the drain-table and prompt-storage gates; and
   `.env.example` no longer lists the dead `NOTIFICATION_EMAIL_TO` placeholder.

3. **Instruction-audit F1 applied; F2 rejected and deprecated.**
   The duplicate safety-invariant restatements in `.claude/rules/` now point back
   to CLAUDE.md. The proposed `pages/api/**` removal from
   `.claude/rules/llm-and-prompts.md` was reviewed, rejected as unsafe, and marked
   deprecated/do-not-apply in `docs/AGENT_INSTRUCTION_AUDIT_S322.md`.

4. **Env-var docs and project tree reconciled.**
   `docs/CREDENTIALS_RUNBOOK.md` now documents BILL runtime credentials/HMACs,
   option-set values, reviewer page-email recovery, intake drain tuning, and
   related legacy/config env knobs. `.env.example` has local placeholders for the
   toggles an operator would plausibly set, and `CLAUDE.md` lists `modules/`,
   `outputs/`, and `_archived/`.

5. **B2 enrichment-timeout partial-return shipped.**
   `ContactEnrichmentService.enrichCandidates()` now has opt-in
   `returnPartialOnAbort`; `/api/reviewer-finder/enrich-contacts` opts in and
   streams completed-prefix results as a partial `complete` SSE frame when the
   admin deadline aborts the tail. This closes the reviewer-email B2 reliability
   item.

6. **Reviewer-email stale tails deprecated.**
   `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` marks the remaining measurement /
   reconsideration tails CLOSED-DEPRECATED; do not keep carrying the no-email
   re-measure as housekeeping.

7. **SAFE dead-code bucket deleted after live caller checks.**
   Removed the two orphan files, dead exports, dead `MOCK_MODE` computation, and
   20 one-off scripts from `docs/DEAD_CODE_DELETION_MANIFEST.md`. Active docs,
   `.env.example`, the BILL option-set probe/test, and `docs/DOCS_CATALOG.md`
   were reconciled so deleted helpers and unsupported env vars no longer appear
   as live contracts.

8. **Merged remote Codex branches deleted.**
   Live `git ls-remote` confirmed `codex/referral-seeding-build` and
   `codex/program-area-normalization` existed; both tips were verified as
   ancestors of `main`, then deleted from origin. Follow-up `git ls-remote`
   returned no heads.

### Commits

- `6fd49af7` docs: refresh reviewer atlas row counts
- `e12199fe` docs: apply mechanical drift fixes
- `95c0e024` docs: consolidate duplicate rule invariants
- `9f19dabd` docs: close rejected instruction audit item
- `0b90b4b7` docs: document env triage and project tree
- `a1682b8b` fix reviewer enrichment timeout partial return
- `d4b37c51` docs: close reviewer email plan tails
- `8811051e` chore: apply housekeeping cleanup
- `18010652` docs: close remote branch cleanup item

## Next Items

### Verified Open

None at stop. There is no immediate actionable housekeeping item left in
`SESSION_PROMPT.md`.

### Measure Later

1. **Institution-COI ledger calibration.**
   Evidence: `scripts/probe-institution-coi-breakdown.mjs` exists; current prompt
   carried this as time-driven only.
   Run `scripts/probe-institution-coi-breakdown.mjs 120` once enough `coi_dropped`
   ledger rows have accumulated to validate Phase C thresholds.

### Parked

1. **Spec-audit docs recovery on the work computer.**
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.
   Re-open around 2026-07-08 on the work computer. Do not re-search local/origin
   first, and do not reconstruct the docs from scratch here. The recovery target
   is the unpushed `codex/spec-audit` work containing
   `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md` and
   `REVIEWER_QUOTA_PD_EMAIL_PLAN.md`.

### Verify Before Acting

1. **S322 audit docs are snapshots, not fresh truth.**
   Evidence: `docs/DEAD_CODE_DELETION_MANIFEST.md`,
   `docs/AGENT_INSTRUCTION_AUDIT_S322.md`,
   `docs/HARNESS_INSTRUCTION_AUDIT_S322.md`, and
   `docs/DOCS_DRIFT_AUDIT_S322.md` all describe snapshot findings.
   Re-run live caller/source checks before applying any remaining suggestion from
   those docs, especially destructive/delete/retire work.

### Do Not Reopen Without New Decision

1. **Two advisory hooks remain retired by owner approval.**
   Evidence: `docs/HARNESS_INSTRUCTION_AUDIT_S322.md` and
   `docs/agent-wiki/topics/dev-environment.md`.
   Do not resurrect `doc-edit-reconcile-reminder.js` or
   `memory-placement-reminder.js` without evidence of recurrence.

2. **`pre-commit-self-review.js` deliberately kept.**
   Evidence: `docs/HARNESS_INSTRUCTION_AUDIT_S322.md` risk note and the S323
   staging-gap fix commits.
   Do not remove it as duplicate hook hygiene without a new decision.

3. **Instruction-audit F2 remains rejected.**
   Evidence: `docs/AGENT_INSTRUCTION_AUDIT_S322.md`.
   Do not remove `pages/api/**` from `.claude/rules/llm-and-prompts.md` unless
   new evidence proves API-route LLM guidance still loads for routes calling
   `execute-prompt` or `llm-client`.

4. **Reviewer-email tails are closed/deprecated.**
   Evidence: `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` and commits
   `a1682b8b` / `d4b37c51`.
   Do not reopen the no-email re-measure or send-gate predicate work without a
   new product decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `SESSION_PROMPT.md` | Current handoff and verified carryovers. |
| `docs/DEAD_CODE_DELETION_MANIFEST.md` | SAFE bucket applied; owner-confirmation deletion candidates remain parked. |
| `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` | Reviewer-email reliability plan; B2 shipped and leftover tails deprecated. |
| `lib/services/contact-enrichment-service.js` | `returnPartialOnAbort` implementation for enrichment timeout partial return. |
| `pages/api/reviewer-finder/enrich-contacts.js` | SSE route that opts into partial-return behavior. |
| `.claude-memory/project-spec-audit-docs-recovery-parked.md` | Parked work-computer-only spec-audit recovery instructions. |
| `scripts/probe-institution-coi-breakdown.mjs` | Future institution-COI threshold calibration probe. |

## Testing

```bash
npm run check:docs-catalog
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:agent-invariants
npx jest tests/unit/bill-onboard-reviewer.test.js --runInBand
npx eslint lib/bill/option-set-values.js lib/services/email-signature.js lib/utils/auth.js lib/utils/pdf-page-splitter.js scripts/probe-bill-option-set-values.js shared/api/middleware/rateLimiter.js shared/components/RequireAuth.js shared/components/reviewers/ReviewerManagePanel.js shared/config/appRegistry.js shared/config/baseConfig.js shared/config/prompts/peer-reviewer.js shared/config/prompts/reviewer-finder.js shared/config/prompts/virtual-review-panel.js shared/config/reviewerFinderPreferences.js shared/context/ProfileContext.js tests/unit/bill-onboard-reviewer.test.js
git ls-remote --heads origin codex/referral-seeding-build codex/program-area-normalization
```

Notes:
- Focused ESLint over touched live JS exited 0 with existing React Compiler
  warnings only.
- Full `npm run lint` remains red on the existing broad React Compiler baseline,
  including `.claude/worktrees`; this was not introduced by S323 cleanup.
