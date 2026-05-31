# Session 204 Prompt: open board (ProfileContext refactor needs a manual smoke test)

## ⏰ Standing context / guardrails (carried from S197–S203)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity words into docs/memory. S203 earned its keep: it forced hedging the "two runtime bugs" count to "caught-by-review, not proven-exhaustive."
- **Codex stop-time review gate is ENABLED** and it is *thorough* on async/state code. In S203 it found 8 successive edges in the ProfileContext work (async-load → resurrection → migration writeback → ref lifetime → stale window → failed-load attribution → out-of-order race → stale optimistic write). Treat its findings as real; don't end the session red.
- **rtk grep filter STILL corrupts output** (it was "disabled at end of S201" but S203 saw `grep`/`rg` silently drop hits again — `rtk proxy rg` returned empty for a term that existed). For any verification grep, use `rtk proxy git grep` (reliable in S203) or write to a file and Read it. Never trust a bare `grep`/`rg` for a "does X exist" check. See `.claude-memory/project-rtk-grep-output-corruption.md`.
- **Push deploys to prod.** `main` auto-deploys on Vercel; all of S203's work is pushed (last code commit `306f77a`; docs `9e92df4` + the session-doc commit follow it).
- **CI-green ≠ correct for async/effect code.** S203's two worst bugs (infinite fetch loop, destructive-migration data loss) BOTH passed lint + 1544 tests + build. See [[feedback-profile-context-runtime-bugs]].

## Session 203 Summary

Open board. Three threads: a migration-drift alert, the parked virus-scan e2e (item 4), and the lint ratchet (item 5) — the last of which cascaded into a full ProfileContext refactor.

### Migration drift (resolved, no commit)
Admin-panel alert "migration_drift: missing 017_bill_onboarding_state.sql". Diagnosed as accurate (017 committed in `7cb8bc4` but never applied to the env). Maintenance cron's BILL steps are per-step try/caught so it degraded, not crashed. **User applied migration 017** via `scripts/apply-migrations.js`; the alert auto-resolves on next cold start.

### Item 4 — intake virus-scan EICAR e2e (verified what's verifiable; live gate still manual)
Confirmed the intake infected-branch is intact (`attach.js:430/486/526`: 422 + blob delete + `virus_detection_intake` alert), unit-tested (`intake-attach-endpoint.test.js:523/565`), and the scanner-half was already proven S193 (shared scanner). Added `scripts/build-intake-eicar-fixture.py` so the manual run is turnkey. **Residual = the live deployed-env browser e2e through Entra**, which I can't drive. See [[project-intake-portal-virus-scan-e2e-deferred]].

### Item 5 — lint ratchet → ProfileContext atomic refactor
Resolved all **14 `react-hooks/exhaustive-deps`** warnings (4 real `useCallback` fixes + reasoned `eslint-disable`s; exhaustive-deps 14→0, total 50→35, 0 errors). The three profile-preference consumers' fixes exposed a real async bug (effect keyed on `currentProfile?.id` but reading async-loaded `preferences`), which spiraled through 8 Codex rounds. Rather than keep guarding, **ProfileContext was refactored to an atomic `useReducer` state machine** (a fresh LLM did the structural pass; see `docs/PROFILE_CONTEXT_REFACTOR_SUMMARY.md`): atomic profile+prefs transitions, `activeRequestId` fencing, profileId-guarded reducer writes, destructive localStorage migration purge. **I caught + fixed two runtime bugs the refactor shipped that CI passed clean**: an init infinite fetch loop (`loadSession` depended on `state.profiles` it mutates → `0876dd0`) and a destructive migration deleting data on a failed save (unchecked `response.ok` before purge → `306f77a`). Then corrected the docs/memory records + ran a `/sweep` (0 stale remaining).

### Commits
- `0876dd0` — Lint ratchet (exhaustive-deps 14→0) + atomic ProfileContext refactor + EICAR fixture (incl. init-loop fix)
- `306f77a` — ProfileContext: don't purge localStorage when migration save fails
- `9e92df4` — docs: correct ProfileContext refactor records (memory file + S203 tag + reconcile summary doc)

## Potential Next Steps

### 1. ⚠️ MANUAL SMOKE TEST the ProfileContext refactor (do this before trusting it)
Both S203 runtime bugs were CI-invisible. Before relying on the refactor in prod, manually: load the app (confirm no fetch loop in the Network tab), switch a profile (confirm no data leak/flash + settings load), and ideally simulate a failing preferences save (confirm localStorage is preserved, not purged). The destructive migration purge is irreversible — verify it only fires on a confirmed-successful save.

### 2. Stop-gate may surface more ProfileContext edges
S203 ended via `/stop`, not a clean stop-gate ALLOW. The reducer's `profileId`-guard structurally covers the round-8 "stale optimistic write" finding, but a fresh review of the refactored file could still flag something. If it does, the file is `shared/context/ProfileContext.js`.

### 3. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do (unchanged)
Run the live EICAR upload through `/apply` before the next cycle's Phase I intake goes live. Fixture builder now exists (`scripts/build-intake-eicar-fixture.py`). See [[project-intake-portal-virus-scan-e2e-deferred]].

### 4. Explorer soak — still traffic-blocked (carried from S203, untouched)
Error-rate measurement after A3/A4/A5 + the S200 validator needs accrued traffic. Don't re-measure on thin data. `scripts/analyze-dynamics-explorer-failures.js` doesn't split pre/post-deploy; a clean soak needs a date-split or Vercel-log analysis.

### 5. BILL chunk-5 tail (non-coding / ops) — unchanged
Office question (BILL self-registration address capture); ops before `BILL_ENABLED=true` (017 now applied ✓; still need `HONORARIUM_*`/`BILLCOM_ACCOUNT_*` probe+set, `honorarium.default_amount` via /admin, Steph's sandbox).

### 6. Lint ratchet remainder (optional, low-stakes)
35 warnings left: `react-hooks/set-state-in-effect` (26, React-Compiler-eligibility noise), `immutability` (5), `import/no-anonymous-default-export` (3), `preserve-manual-memoization`. Lower-signal than exhaustive-deps was; CI won't block.

## Key Files Reference
| File | Purpose |
|------|---------|
| `shared/context/ProfileContext.js` | Atomic `useReducer` state machine (status/activeRequestId/profileId-guarded writes/destructive migration); the S203 refactor target |
| `docs/PROFILE_CONTEXT_REFACTOR_SUMMARY.md` | Refactor design + "Post-Refactor Fixes" section (the two CI-missed runtime bugs) |
| `shared/components/{EmailSettingsPanel,EmailTemplateEditor,SettingsModal,EmailGeneratorModal}.js` | Consumers simplified to gate on `status === 'ready'` |
| `scripts/build-intake-eicar-fixture.py` | Builds `/tmp/eicar-test-exe.docx` for the manual intake virus-scan e2e |
| `.claude-memory/feedback-profile-context-runtime-bugs.md` | The two runtime-bug root causes + the smoke-test rule |

## Testing
```bash
npx jest                       # 1544 tests
npm run lint                   # 0 errors / 35 warnings (CI blocks on errors only)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:fact-consistency
# rtk caveat: for verification greps use `rtk proxy git grep`, NOT bare grep/rg (filter drops hits)
```
