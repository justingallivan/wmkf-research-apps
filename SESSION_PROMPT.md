# Session 323 Prompt: Act on remaining S322 audit decisions

## Session 322 Summary

An audit-heavy session: four evidence-anchored audit reports landed in docs/, and
the harness-audit recommendations were owner-approved and applied same-session.
Every audit claim was grounded in a session tool result; several scan-agent claims
were caught wrong during main-session re-verification and corrected in place
(seed-file false positive, codex-hook cause, worktree-skill trim).

### What Was Completed

1. **Dead-code deletion manifest** (`docs/DEAD_CODE_DELETION_MANIFEST.md`, `16185334`).
   Four parallel scans + hand re-verification. SAFE bucket: 2 orphan files, ~20 dead
   exports, `MOCK_MODE` config, 20 one-off scripts. NEEDS-OWNER: 3 unwired API routes,
   D26 retire-together cluster, 4 one-way flags, 27 weaker scripts. SAFE bucket deleted
   on 2026-07-03 after live caller checks.
   Caught scan false positive: `lib/seed/email-defaults/reviewer-reminders.js` is live
   (imported at `scripts/seed-email-defaults.mjs:23`).

2. **Agent-instruction file audit** (`docs/AGENT_INSTRUCTION_AUDIT_S322.md`, `e6d109ce`).
   Architecture clean: no oversize files, no contradictions, no @-imports, no lint
   restatement. F1 (3 safety-invariant restatements in rules files) + F2 (over-broad
   `pages/api/**` glob in llm-and-prompts rule) — F1 applied this session; F2 reviewed,
   rejected as unsafe to remove, and deprecated in the audit doc.

3. **Harness instruction audit + APPLIED** (`docs/HARNESS_INSTRUCTION_AUDIT_S322.md`,
   `84207bcb`; applied in `b7b77836` + `a5213b1e`):
   - **Commit-guard staging gap fixed**: `docs-catalog-commit-guard.js` and
     `pre-commit-self-review.js` read `git diff --cached` at PreToolUse time, so a
     compound `git add X && git commit` evaded them (two stale-catalog commits proved
     it live). Both now also parse path tokens from the command; fix functionally
     tested (guard blocks, exit 2) and observed working on this session's own commits.
   - **Retired 2 duplicate advisory hooks**: `doc-edit-reconcile-reminder.js` (durable-docs
     path rule delivers the same guidance) and `memory-placement-reminder.js` (shadow of
     blocking router guard). Settings entries removed; memory
     `feedback-reconcile-dont-append-docs` records the delivery handover + reinstatement lever.
   - **codex-verbatim-reminder re-scoped**: `subagent_type` authoritative when present;
     substring fallback only for missing-field case. Tested in 3 directions.
   - Skills: `/start` gained missing `check:docs-catalog` gate (list re-dated 2026-07-03),
     generic git blocks condensed in start/stop; freshness caveat in contract-reconcile;
     parallel-agent-worktree kept intact (its command blocks are repo-specific — corrected
     the scan's trim suggestion). Wiki dev-environment topic now documents 4 commit hooks
     (was 3) + the staging-gap rule.

4. **Docs-vs-code drift audit** (`docs/DOCS_DRIFT_AUDIT_S322.md`, `4b2d42a9`). 7 drift
   items, none architectural: README's broken `.env.local.example` setup step; 4 wrong
   self-test script names in CI_GATES_REFERENCE (`-self-test` vs `:self-test`); dead
   `NOTIFICATION_EMAIL_TO`; BILL runtime creds undocumented; 22 undocumented code-read
   env vars (88 read / 66 documented / 61 overlap) incl. `REVIEWER_PAGE_EMAIL_TIER_ENABLED`;
   3 dirs missing from CLAUDE.md tree. Apply-ready diffs for the mechanical fixes.

### Commits

- `16185334` docs: dead-code deletion manifest
- `e6d109ce` docs: agent-instruction file audit
- `92c9111b` docs: regenerate docs catalog
- `84207bcb` docs: harness instruction audit
- `b7b77836` fix(hooks): commit-guard staging gap + codex scoping; retire two hooks
- `a5213b1e` docs+skills: apply harness audit
- `1ccb837a` chore: refresh memory-drift report
- `4b2d42a9` docs: docs-vs-code drift audit

## Next Items

### Completed This Session

1. **Mechanical docs-drift fixes (S322 audit items 1-3).**
   README now points to `.env.example`; `docs/CI_GATES_REFERENCE.md` uses the live
   `:self-test` script names for drain-table and prompt-storage gates; `.env.example`
   no longer lists dead `NOTIFICATION_EMAIL_TO` and points recipients to `/admin` →
   Alert Recipients.
2. **Instruction-audit F1 applied; F2 closed rejected.**
   The three duplicate safety-invariant restatements in `.claude/rules/` now point back
   to CLAUDE.md's Universal Safety Invariants. The `llm-and-prompts.md` `pages/api/**`
   glob was reviewed and intentionally left in place so LLM/prompt guidance still loads
   on API route call sites; `docs/AGENT_INSTRUCTION_AUDIT_S322.md` now marks the removal
   option deprecated / do not apply.
3. **Env-var doc triage + CLAUDE.md tree additions.**
   `docs/CREDENTIALS_RUNBOOK.md` now documents BILL runtime credentials/HMACs,
   option-set values, reviewer page-email recovery, intake drain tuning, and related
   legacy/config env knobs; `.env.example` has local placeholders for the toggles an
   operator would plausibly set; `CLAUDE.md` now lists `modules/`, `outputs/`, and
   `_archived/`.
4. **B2 enrichment-timeout partial-return shipped and plan tails deprecated.**
   `ContactEnrichmentService.enrichCandidates()` now has opt-in
   `returnPartialOnAbort`; `/api/reviewer-finder/enrich-contacts` opts in and streams
   completed-prefix results as a partial `complete` SSE frame. The reviewer email
   persist plan now marks remaining measurement/reconsideration tails
   CLOSED-DEPRECATED; do not keep carrying the no-email re-measure as housekeeping.
5. **SAFE dead-code bucket deleted after live caller checks.**
   Removed the two orphan files, dead exports, dead `MOCK_MODE` computation, and 20
   one-off scripts from `docs/DEAD_CODE_DELETION_MANIFEST.md`; reconciled active docs
   and env/test/probe references so deleted helpers and unsupported env vars no
   longer appear as live contracts.

### Owner Decision Needed

1. **Whether to delete merged remote Codex branches** (carryover S320; verify merged first).
   Evidence: `git ls-remote --heads origin codex/referral-seeding-build codex/program-area-normalization`.

### Measure Later (time-driven, not work-driven)

1. **`scripts/probe-institution-coi-breakdown.mjs 120`** once `coi_dropped` ledger rows
   accumulate (validates Phase C thresholds).

### Parked

1. **Spec-audit docs recovery.** Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.
   Re-open ~2026-07-08 on the work computer; do not re-search local/origin first.

### Verify Before Acting

1. **All four S322 audit docs are snapshots** (anchors at `7d3be6a1`–`1ccb837a`). Their
   file:line quotes and grep results must be re-verified live before applying any diff
   or deletion — each doc carries its own application protocol.

### Do Not Reopen Without New Decision

1. **Two advisory hooks retired S322 by owner approval** (`doc-edit-reconcile-reminder.js`,
   `memory-placement-reminder.js`). Do not resurrect without evidence of recurrence;
   the reinstatement lever is recorded in `feedback-reconcile-dont-append-docs.md`.
2. **`pre-commit-self-review.js` deliberately KEPT** (risk note 3 of the harness audit);
   its staging gap was fixed instead.
3. **Instruction-audit F2 rejected** — do not remove `pages/api/**` from
   `.claude/rules/llm-and-prompts.md` without new evidence that route-local LLM guidance
   still loads for API routes calling `execute-prompt` or `llm-client`.
4. **Cause #2 RESOLVED / COI Phase C shipped / `REVIEWER_PAGE_EMAIL_TIER_ENABLED` ON in
   prod / invite send-gate predicate unchanged** — all carry forward from S321 verbatim
   (evidence in `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md`, `docs/REVIEWER_COI_PRECISION_PLAN.md`).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/DEAD_CODE_DELETION_MANIFEST.md` | Deletion candidates by confidence + execution protocol. |
| `docs/AGENT_INSTRUCTION_AUDIT_S322.md` | CLAUDE.md/rules audit; F1 applied, F2 closed rejected/deprecated. |
| `docs/HARNESS_INSTRUCTION_AUDIT_S322.md` | Hook/skill classification + applied-outcome record. |
| `docs/DOCS_DRIFT_AUDIT_S322.md` | Drift table + applied outcome notes for docs/env/tree cleanup. |
| `.claude/hooks/docs-catalog-commit-guard.js` | Now parses command path tokens (staging-gap fix). |
| `.claude/hooks/pre-commit-self-review.js` | Same staging-gap fix; checklist tailoring restored for compound commits. |
| `.claude/hooks/codex-verbatim-reminder.js` | subagent_type-authoritative scoping. |
| `docs/agent-wiki/topics/dev-environment.md` | 4 commit hooks + staging-gap rule for new hooks. |

## Testing

```bash
npm test   # full suite; known-red baseline: bill, discovery-verification-status, stage2a (30 tests)
node .claude/hooks/lib/git-commit-detect.test.js   # commit-hook trigger matrix (plain node)
npm run check:memory-drift:no-write                # clean after Atlas row-count refresh
# gate list: .claude/skills/start/SKILL.md (full set as of 2026-07-03, incl. check:docs-catalog)
```
