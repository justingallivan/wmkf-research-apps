# Session 325 Prompt: Clean main after pricing-refresh build repair

## Session 324 Summary

Session 324 started from a clean `main` handoff, ran the full `/start` gate set,
then handled a failed Vercel build from the previous push. The failure was a real
build break caused by S323 housekeeping deleting a live service dependency for
the monthly Anthropic pricing drift cron. The fix was committed, built locally
outside the sandbox, and pushed to `origin/main`.

### What Was Completed

1. **Startup gates passed cleanly.**
   - `git fetch origin` and status showed `main` aligned with `origin/main`.
   - Memory and Codex skills symlinks were valid.
   - Every `check:*` startup gate and paired self-test from `/start` passed,
     including `check:memory-drift:no-write`.

2. **Vercel build failure diagnosed.**
   - Attached Vercel log for commit `d51fc03` failed at
     `pages/api/cron/pricing-refresh.js` with
     `Module not found: Can't resolve '../../../lib/services/anthropic-admin'`.
   - Live source/doc checks showed `/api/cron/pricing-refresh` is still a live
     Vercel cron route (`vercel.json`, `docs/API_ROUTE_SECURITY_MATRIX.md`,
     `docs/CREDENTIALS_RUNBOOK.md`, `docs/atlas/postgres-infra-tables.md`).
   - Git history showed `lib/services/anthropic-admin.js` was deleted by
     `8811051e chore: apply housekeeping cleanup`.

3. **Anthropic Admin pricing client restored.**
   - Restored `lib/services/anthropic-admin.js` as the thin
     `/v1/organizations/cost_report` client expected by `pricing-refresh`.
   - Updated `docs/DEAD_CODE_DELETION_MANIFEST.md` to record the correction:
     the file was not safe dead code because the live cron imports it.
   - Pushed `5f2c6807` to `origin/main`; `git status` is clean and synced.

4. **Codex local permission posture tuned outside the repo.**
   - With owner permission, edited `/Users/gallivan/.codex/config.toml` to keep
     `workspace-write` but use `approval_policy = "on-request"`,
     `approvals_reviewer = "user"`, and `network_access = true`.
   - Removed the ineffective `.git` `writable_roots` attempt.
   - Appended user-level exec rules in
     `/Users/gallivan/.codex/rules/default.rules`: routine
     `git fetch/status/rev-parse/rev-list/log/add/commit/push origin main` and
     `npm run build` allow; `rm`, `git reset`, and `git checkout` prompt.
   - Verified rules with `codex execpolicy check`. Restart Codex / start a new
     thread for these settings to fully apply; this thread still ran under the
     old managed sandbox.

### Commits

- `5f2c6807` fix: restore Anthropic admin pricing client

## Next Items

### Verified Open

None at stop. There is no immediate actionable housekeeping item left in
`SESSION_PROMPT.md`.

### Measure Later

1. **Institution-COI ledger calibration.**
   Evidence: `scripts/probe-institution-coi-breakdown.mjs` exists and documents
   the read-only `coi_dropped` ledger measurement path.
   Run `scripts/probe-institution-coi-breakdown.mjs 120` once enough
   `coi_dropped` ledger rows have accumulated to validate Phase C thresholds.

### Owner Decision Needed

None at stop.

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
   `docs/DOCS_DRIFT_AUDIT_S322.md` all describe snapshot findings. This session
   proved the risk: `lib/services/anthropic-admin.js` had been deleted as an
   orphan but was still imported by the live `pricing-refresh` cron.
   Re-run live caller/source checks before applying any remaining suggestion
   from those docs, especially destructive/delete/retire work.

2. **Codex permission changes need a fresh Codex process/thread.**
   Evidence: `/Users/gallivan/.codex/config.toml` and
   `/Users/gallivan/.codex/rules/default.rules` were edited outside the repo and
   validated with `codex execpolicy check`.
   If a future thread still reports `approvals_reviewer = "auto_review"` or
   `.git` read-only despite the rules, inspect managed requirements; local config
   may be overridden.

### Do Not Reopen Without New Decision

1. **Do not delete `lib/services/anthropic-admin.js` as dead code.**
   Evidence: `pages/api/cron/pricing-refresh.js` imports it, the Vercel build
   failed without it, and `docs/DEAD_CODE_DELETION_MANIFEST.md` now records the
   correction.

2. **Two advisory hooks remain retired by owner approval.**
   Evidence: `docs/HARNESS_INSTRUCTION_AUDIT_S322.md` and
   `docs/agent-wiki/topics/dev-environment.md`.
   Do not resurrect `doc-edit-reconcile-reminder.js` or
   `memory-placement-reminder.js` without evidence of recurrence.

3. **`pre-commit-self-review.js` deliberately kept.**
   Evidence: `docs/HARNESS_INSTRUCTION_AUDIT_S322.md` risk note and the S323
   staging-gap fix commits.
   Do not remove it as duplicate hook hygiene without a new decision.

4. **Instruction-audit F2 remains rejected.**
   Evidence: `docs/AGENT_INSTRUCTION_AUDIT_S322.md`.
   Do not remove `pages/api/**` from `.claude/rules/llm-and-prompts.md` unless
   new evidence proves API-route LLM guidance still loads for routes calling
   `execute-prompt` or `llm-client`.

5. **Reviewer-email tails are closed/deprecated.**
   Evidence: `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` and commits
   `a1682b8b` / `d4b37c51`.
   Do not reopen the no-email re-measure or send-gate predicate work without a
   new product decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `SESSION_PROMPT.md` | Current handoff and verified carryovers. |
| `lib/services/anthropic-admin.js` | Anthropic Admin API cost-report client used by `pricing-refresh`. |
| `pages/api/cron/pricing-refresh.js` | Live monthly pricing drift cron that imports the admin client. |
| `docs/DEAD_CODE_DELETION_MANIFEST.md` | S322 cleanup manifest; now records the `anthropic-admin` restore correction. |
| `/Users/gallivan/.codex/config.toml` | Local Codex permission settings edited outside the repo. |
| `/Users/gallivan/.codex/rules/default.rules` | Local Codex exec rules edited outside the repo. |
| `.claude-memory/project-spec-audit-docs-recovery-parked.md` | Parked work-computer-only spec-audit recovery instructions. |
| `scripts/probe-institution-coi-breakdown.mjs` | Future institution-COI threshold calibration probe. |

## Testing

```bash
npm run build
npx eslint lib/services/anthropic-admin.js pages/api/cron/pricing-refresh.js
npm run check:api-routes
npm run check:api-routes:self-test
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
npm run check:docs-catalog
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:secret-scan
npm run check:secret-scan:self-test
codex execpolicy check --pretty --rules /Users/gallivan/.codex/rules/default.rules -- git push origin main
codex execpolicy check --pretty --rules /Users/gallivan/.codex/rules/default.rules -- npm run build
codex execpolicy check --pretty --rules /Users/gallivan/.codex/rules/default.rules -- rm -rf /tmp/example
codex execpolicy check --pretty --rules /Users/gallivan/.codex/rules/default.rules -- git reset --hard HEAD~1
```

Notes:
- The first two sandboxed `npm run build` attempts stalled in the current
  thread's old sandbox during Turbopack's optimized build phase; the approved
  unsandboxed `npm run build` completed successfully in 6.8s.
- `codex execpolicy check` emitted a harmless PATH warning in the old sandbox
  but returned the expected allow/prompt decisions.
