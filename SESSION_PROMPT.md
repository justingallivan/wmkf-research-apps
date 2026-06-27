# Session 296 Prompt: Wiki positive-framing pass

## Top-of-session must-knows

1. **Session 295 shipped the active harness positive-framing refactor.** The implementation commit is `e7ef62bd` (`Refactor agent harness framing`). The stop-session doc commit follows it.
2. **Rollback protection exists.** The pre-refactor commit is tagged `harness-pre-positive-framing-2026-06-27` (`42e1f9b3`). Preserved originals are in `.harness-backups/2026-06-27-positive-framing/MANIFEST.json`.
3. **Use the new sidecar pattern for instruction rationale.** Active instructions should state the desired operating pattern; historical failure/rationale belongs in sidecars such as skill `RATIONALE.md`, `.claude-memory/rationale/*.md`, or a comparable rationale document.
4. **Read `docs/AGENT_HARNESS_STYLE_GUIDE.md` before more harness edits.** The gate is `npm run check:harness-framing`; its self-test is `npm run check:harness-framing:self-test`.
5. **Wiki topics were audited but not refactored in S295.** The next likely thread is a positive-framing pass over `docs/agent-wiki/topics/*.md`, using the same backup, sidecar rationale, and checker principles.
6. **Known-red suites carried from S294:** `tests/unit/bill.test.js` and `tests/unit/discovery-verification-status.test.js` only. Confirm any full-suite red is only those two.

## Session 295 Summary

Session 295 investigated why the agent instruction harness might be degrading Claude behavior despite intending to add safety. The working hypothesis was that repeatedly phrasing rules as "what the model does wrong" can make failure patterns more salient in the active prompt. The session audited root instructions, `SESSION_PROMPT.md` language, durable memories, hooks, skills, and the agent wiki, then refactored the active harness surfaces to prefer capability/desired-pattern framing while preserving rationale in sidecars.

### What Was Completed

1. **Positive-framing harness style guide**
   - Added `docs/AGENT_HARNESS_STYLE_GUIDE.md`.
   - Documented the active-instruction vs rationale-sidecar split.
   - Added safe examples for rules, hook output, skills, memories, and backups.

2. **Harness framing gate**
   - Added `scripts/check-harness-framing.js`.
   - Added `scripts/check-harness-framing-self-test.js`.
   - Added `npm run check:harness-framing` and `npm run check:harness-framing:self-test`.
   - Wired the gate into `.github/workflows/test.yml`, `docs/CI_GATES_REFERENCE.md`, and `.claude/skills/start/SKILL.md`.

3. **Live hook and skill cleanup**
   - Rephrased active hook output in `.claude/hooks/` toward explicit desired behavior.
   - Refactored `contract-reconcile`, `sweep`, `start`, and `stop` skill bodies.
   - Added skill `RATIONALE.md` sidecars for why the rules exist.

4. **Durable memory cleanup**
   - Refactored active feedback memories into trigger/procedure/evidence style.
   - Added `.claude-memory/rationale/*.md` sidecars for historical failure context.

5. **Backup and rollback**
   - Created `.harness-backups/2026-06-27-positive-framing/MANIFEST.json` with original copies of touched files.
   - Created rollback tag `harness-pre-positive-framing-2026-06-27`.

### Commits

- `e7ef62bd` - Refactor agent harness framing
- Stop-session commit - Documents Session 295 and creates this Session 296 prompt

## Next Items

### Verified Open

1. **Wiki positive-framing pass**
   Evidence: S295 audited `docs/agent-wiki/topics/*.md` but did not patch those topic pages; `scripts/check-harness-framing.js` currently scopes only `docs/agent-wiki/index.md` under the wiki.
   Start with a backup/tag such as `wiki-pre-positive-framing-2026-06-27`, then classify topic language as active guidance, historical rationale, or source-cited fact. Likely first files: `reviewer-origination`, `reviewer-identity`, `dev-environment`, and `integrity-screener`.

### Owner Decision Needed

None currently for the wiki pass. If a wiki entry contains a hard behavioral claim that conflicts with source/Atlas/probes, stop and ask whether to correct the wiki fact or preserve it as historical rationale.

### Parked

1. **PD-override-correction sync**
   Evidence currently available: S295 did not re-verify this S294 carryover. Previous prompt said PD identity-override corrections land through `save-candidates`, not the reviewer accept path.
   Re-open trigger: user chooses to continue the reviewer-contact boundary tail after verifying current source paths.

### Verify Before Acting

1. **Long-stale pre-S294 carryovers**
   Evidence currently available: prior `SESSION_PROMPT.md` listed model real-replay signoff/Admin Models smoke, request `1002788` triage, Restore Removed Candidates + PD identity override E2E, and reviewer-portal upload design decision.
   Required preflight: verify each against source/docs/probes before carrying it into an actionable worklist.

2. **Any destructive wiki cleanup**
   Evidence currently available: the wiki is a subordinate routing aid, not authority.
   Required preflight: before removing or retiring a wiki claim, check the authoritative source named by the entry, then preserve rationale in a sidecar when useful.

### Do Not Reopen Without New Decision

1. **Reviewer to CRM-contact boundary epic**
   Evidence: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` and S294 commits record the completed policy: name/title/nickname sync; email and affiliation alert-only.

2. **Email and affiliation contact writes**
   Evidence: S294 owner decision kept email and affiliation alert-only. Do not convert them to contact writes without a new owner decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/AGENT_HARNESS_STYLE_GUIDE.md` | Style guide for active instructions, rationale sidecars, examples, and backups. |
| `scripts/check-harness-framing.js` | Gate for negative self-framing and rationale leakage in active harness surfaces. |
| `scripts/check-harness-framing-self-test.js` | Self-test fixture runner for the harness framing gate. |
| `.github/workflows/test.yml` | CI wiring for the new harness framing gate. |
| `docs/CI_GATES_REFERENCE.md` | Gate catalog entry for harness framing. |
| `.claude/hooks/` | Live hook output that was rephrased toward desired behavior. |
| `.claude/skills/*/RATIONALE.md` | Skill rationale sidecars created in S295. |
| `.claude-memory/rationale/*.md` | Durable memory rationale sidecars created in S295. |
| `.harness-backups/2026-06-27-positive-framing/MANIFEST.json` | Backup manifest for original files touched by S295. |
| `docs/agent-wiki/topics/*.md` | Next-pass target for wiki positive-framing work. |

## Testing

```bash
npm run check:harness-framing
npm run check:harness-framing:self-test
npm run check:scaffolding-tokens
npm run check:memory-router
npm run check:agent-wiki
npm run check:instruction-architecture
npm run check:doc-symbol-refs
npm run check:fact-consistency
npm run check:agent-invariants:ci
npm run check:memory-router:self-test
npm run check:agent-wiki:self-test
npm run check:doc-symbol-refs:self-test
npm run check:scaffolding-tokens:self-test
```

Full `npm test` was not run in S295.

## Gotchas / Continuity

- The backup archive intentionally preserves original wording. Do not run broad style rewrites inside `.harness-backups/`.
- `check:harness-framing` intentionally excludes backup and rationale paths; active guidance must stay clean, but rationale sidecars may name the historical anti-patterns they explain.
- For wiki work, keep source/Atlas/probes authoritative. The wiki is a routing aid and retrieval surface, not the final source of truth.
- Preserve exact source-grounded facts while changing the behavioral wrapper around them.
