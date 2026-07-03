# Session 323 Prompt: Act on S322 audit decisions (or pick up B2 / Atlas counts)

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
   D26 retire-together cluster, 4 one-way flags, 27 weaker scripts. Nothing deleted.
   Caught scan false positive: `lib/seed/email-defaults/reviewer-reminders.js` is live
   (imported at `scripts/seed-email-defaults.mjs:23`).

2. **Agent-instruction file audit** (`docs/AGENT_INSTRUCTION_AUDIT_S322.md`, `e6d109ce`).
   Architecture clean: no oversize files, no contradictions, no @-imports, no lint
   restatement. F1 (3 safety-invariant restatements in rules files) + F2 (over-broad
   `pages/api/**` glob in llm-and-prompts rule) — apply-ready diffs, owner-pending.

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

### Verified Open

1. **Atlas row-count refresh (the only red gate).**
   Evidence: `check:memory-drift:no-write` red at S322 start and unaddressed:
   `wmkf_app_reviewer_suggestion`/`wmkf_appreviewersuggestions` atlas=336 live=621;
   `wmkf_potentialreviewerses` atlas=331 live=4393. Organic growth, not breakage.
   Small doc reconcile; follow `.claude/rules/durable-docs.md`.
2. **Apply mechanical docs-drift fixes (items 1-3).**
   Evidence: apply-ready diffs in `docs/DOCS_DRIFT_AUDIT_S322.md` (README `.env.example`
   step, 4× CI_GATES_REFERENCE script names, `NOTIFICATION_EMAIL_TO` removal). Re-verify
   quoted lines live first.
3. **B2 — enrichment-timeout partial-return.**
   Evidence: `lib/services/contact-enrichment-service.js:1356` (S321 anchor; file
   untouched in S322 but re-confirm the line), `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md`
   §B2. Last open item on the reviewer-email reliability track.

### Owner Decision Needed

1. **Dead-code deletion pass** — approve the SAFE bucket and/or triage the NEEDS-OWNER
   bucket. Evidence: `docs/DEAD_CODE_DELETION_MANIFEST.md` (execution protocol inside;
   re-run caller checks live before deleting — anchors are at `7d3be6a1`).
2. **Instruction-audit F1/F2 consolidations.** Evidence: diffs in
   `docs/AGENT_INSTRUCTION_AUDIT_S322.md`; duplication may be deliberate reinforcement.
3. **Env-var doc triage + CLAUDE.md tree additions.** Evidence:
   `docs/DOCS_DRIFT_AUDIT_S322.md` items 4-5, 7 (which vars belong in `.env.example`;
   whether `modules/`/`outputs/`/`_archived/` are deliberately untreed).
4. **Whether to delete merged remote Codex branches** (carryover S320; verify merged first).
   Evidence: `git ls-remote --heads origin codex/referral-seeding-build codex/program-area-normalization`.

### Measure Later (time-driven, not work-driven)

1. **`scripts/probe-no-email-breakdown.mjs 120`** after a few weeks of enrichment cycles
   (email-gate redesign shipped S321; flag ON since 2026-07-03).
2. **`scripts/probe-institution-coi-breakdown.mjs 120`** once `coi_dropped` ledger rows
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
3. **Cause #2 RESOLVED / COI Phase C shipped / `REVIEWER_PAGE_EMAIL_TIER_ENABLED` ON in
   prod / invite send-gate predicate unchanged** — all carry forward from S321 verbatim
   (evidence in `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md`, `docs/REVIEWER_COI_PRECISION_PLAN.md`).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/DEAD_CODE_DELETION_MANIFEST.md` | Deletion candidates by confidence + execution protocol. |
| `docs/AGENT_INSTRUCTION_AUDIT_S322.md` | CLAUDE.md/rules audit; F1/F2 diffs owner-pending. |
| `docs/HARNESS_INSTRUCTION_AUDIT_S322.md` | Hook/skill classification + applied-outcome record. |
| `docs/DOCS_DRIFT_AUDIT_S322.md` | Drift table + docs patch (mechanical part apply-ready). |
| `.claude/hooks/docs-catalog-commit-guard.js` | Now parses command path tokens (staging-gap fix). |
| `.claude/hooks/pre-commit-self-review.js` | Same staging-gap fix; checklist tailoring restored for compound commits. |
| `.claude/hooks/codex-verbatim-reminder.js` | subagent_type-authoritative scoping. |
| `docs/agent-wiki/topics/dev-environment.md` | 4 commit hooks + staging-gap rule for new hooks. |

## Testing

```bash
npm test   # full suite; known-red baseline: bill, discovery-verification-status, stage2a (30 tests)
node .claude/hooks/lib/git-commit-detect.test.js   # commit-hook trigger matrix (plain node)
npm run check:memory-drift:no-write                # expect RED until Atlas row counts refreshed
# gate list: .claude/skills/start/SKILL.md (full set as of 2026-07-03, incl. check:docs-catalog)
```
