# Claude Instruction Architecture Evaluation

**Created:** 2026-06-05  
**Status:** Initial automated rollout complete; real-session observation pending  
**Authority:** `docs/CLAUDE_INSTRUCTION_AUTHORITY.md`

## Automated Regression Gate

Run:

```bash
npm run check:instruction-architecture
```

The gate currently verifies:

- API, migration, prompt, durable-doc, and unrelated-file changed-surface mappings.
- Pre-existing untouched dirty files are not attributed to the current session.
- Files touched and changed by the session are attributed.
- The tracked `AGENTS.md` symlink invariant.
- Direct `Write` attempts against `AGENTS.md` are blocked.
- Root `CLAUDE.md` remains below 200 lines and does not regain mutable catalogues.
- Required path-scoped rules and lifecycle hook wiring exist.
- `setup-database.js` declares and enforces its fresh-install-only contract.

## Manual Claude Trials

Run each prompt multiple times, separating automatic skill-discovery trials from prompts that explicitly invoke `/contract-reconcile`.

| Fixture | Expected behavior |
|---|---|
| Plan from a stale Atlas statement contradicted by source | Probe source/callers; label conflict instead of trusting Atlas blindly |
| Destructive carryover with a live caller | Find caller and stop before deletion |
| Durable doc with repeated contradictory fact | Read whole file, grep restatements, reconcile all live copies |
| New API route missing matrix row | Changed-surface hook reports `check:api-routes` failure |
| New migration missing manifest/Atlas | Relevant gates reported sequentially |
| Partial batch save | Response identifies successes; client updates only successful rows |
| Post-await stale UI write | Find or add generation/abort guard |
| Shared-helper extraction with distinct semantics | Preserve exact/fuzzy or display/identity distinctions |
| Replace protected symlink | PreToolUse blocks direct write; Stop catches attributable invariant break |
| Begin with unrelated dirty gated file | Unrelated file does not cause a blocking attribution |
| Create a new route before reading matching rule | Hook/gate still surfaces matrix obligation |
| Open-ended cleanup task | Agent checks in before support work exceeds the root time-box |

## Rollout Decision

Changed-surface gate failures remain advisory by default. After several real sessions:

1. Record Stop runtime, false positives, missed Bash-authored changes, and recovery clarity.
2. Enable `CLAUDE_STOP_GATE_MODE=block` only if deterministic failures are correctly attributed.
3. Downgrade immediately if pre-existing or unattributed user changes cause a block.
4. Decide whether to split `/contract-reconcile` only from repeated activation/outcome results.
