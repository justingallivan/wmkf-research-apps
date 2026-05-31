# Session 205 Prompt: open board (ProfileContext closed; browser/ops-gated items remain)

## ⏰ Standing context / guardrails (carried from S197–S204)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity words into docs/memory. S204 caught itself with it: an early "5 exhaustive-deps warnings" tally was a **false alarm** — a bare `grep` counted `// eslint-disable-next-line react-hooks/exhaustive-deps` *comment text*, not real warnings. The authoritative source for lint counts is `npx eslint . -f json` keyed on `ruleId`/`severity`, NOT grep over the default formatter output (which echoes disable-comment text).
- **Codex stop-time review gate is ENABLED** and thorough on async/state code.
- **rtk grep filter STILL corrupts output.** For any "does X exist" verification use `rtk proxy git grep` or write-to-file + Read; never trust a bare `grep`/`rg`. Also: `rtk` compresses `jest` output to a useless `PASS (N) FAIL (0)` — use `rtk proxy npx jest` to see real pass/fail + test names.
- **Push deploys to prod.** `main` auto-deploys on Vercel. All S204 work is pushed (last commit `fec2e75`).
- **CI-green ≠ correct for async/effect code.** The two worst S203 bugs passed lint + tests + build. See [[feedback-profile-context-runtime-bugs]].
- **Local-dev auth:** full Azure login can't run on `localhost` (no `localhost:3000` redirect URI in the app registration). To smoke-test gated UI locally, add `AUTH_REQUIRED=false` + a throwaway `NEXTAUTH_SECRET` + `NEXTAUTH_URL=http://localhost:3000` to `.env.local`, run `npm run dev`, **and revert those 3 lines after** (the base `.env.local` is DB+API-keys only, fail-closed). Under that bypass the fire-and-forget `PATCH /api/user-profiles` (last_used ping) 401s harmlessly.

## Session 204 Summary

Open board. Started on item 1 (the mandatory ProfileContext smoke test), closed it fully, then did the safe slice of item 6.

### Item 1 — ProfileContext refactor: SMOKE TEST DONE, refactor verified three ways (CLOSED)
The S203 atomic refactor previously had **zero** tests, which is why its two bugs shipped CI-green. Now closed:
1. **5 regression tests** — `tests/unit/profile-context.test.js` (commit `62b0640`). Both CI-missed bugs pinned (init fetch-loop bounded-count assertion; failed-migration-save preserves localStorage), plus stale-flash-on-switch and out-of-order-request fencing. **Both bug reintroductions were verified to turn the suite RED**, then reverted — the tests are non-vacuous.
2. **Server-log analysis** under local `npm run dev` (auth-bypassed; env reverted after): bounded `2× user-profiles + 1× user-preferences` per load then silent; every profile switch fired a fresh `GET /api/user-preferences?profileId=<new>`. No loop, no cross-profile bleed.
3. **Justin's browser pass**: correct per-profile settings + persistence, no leak/flash.

### Item 6 — lint ratchet: safe slice done (35 → 32 warnings, 0 errors)
Resolved the **3 `import/no-anonymous-default-export`** warnings (commit `fec2e75`) by naming the default-exported object in `modelNames.js`, `email-reviewer.js`, `dynamics-identity-service.js`. Export shape unchanged → zero runtime risk; 1549 tests pass.
**Deliberately left the other 32** — all React-Compiler-eligibility noise (`set-state-in-effect` ×26, `immutability` ×5, `preserve-manual-memoization` ×1). "Fixing" them = reworking effect/state logic, several in the exact ProfileContext consumer effects S203 stabilized → the precise [[feedback-profile-context-runtime-bugs]] hazard. Not worth the risk for non-blocking lint cosmetics. **Confirmed: 0 `exhaustive-deps` warnings remain (S203's claim holds).**

### Commits
- `62b0640` — ProfileContext regression tests (the two S203 CI-missed bugs + 2 structural guards)
- `fec2e75` — Lint ratchet: 3 `import/no-anonymous-default-export` resolved

## Potential Next Steps

The solo-drivable, low-risk work is exhausted. Remaining items are gated on the user (browser/ops) or are deliberately-deferred-risky.

### 1. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do (browser-gated)
Run the live EICAR upload through `/apply` before the next cycle's Phase I intake goes live. Fixture builder exists (`scripts/build-intake-eicar-fixture.py`). Needs a browser-through-Entra session. See [[project-intake-portal-virus-scan-e2e-deferred]].

### 2. BILL chunk-5 tail (ops / non-coding)
Office question (BILL self-registration address capture); ops before `BILL_ENABLED=true`: `HONORARIUM_*`/`BILLCOM_ACCOUNT_*` probe+set, `honorarium.default_amount` via /admin, Steph's sandbox. (Migration 017 applied S203 ✓.)

### 3. Explorer soak — still traffic-blocked
Error-rate measurement after A3/A4/A5 + the S200 validator needs accrued traffic. Don't re-measure on thin data. `scripts/analyze-dynamics-explorer-failures.js` doesn't split pre/post-deploy.

### 4. Lint ratchet remainder (optional, risky — default: leave)
32 warnings, all React-Compiler-eligibility noise; CI won't block. If touched, treat each `immutability`/`set-state-in-effect` as a *real* change (read the effect, reason, test) — not a silencing pass. Lowest priority.

## Key Files Reference
| File | Purpose |
|------|---------|
| `tests/unit/profile-context.test.js` | S204 regression tests for the two S203 CI-missed bugs + state-machine guards |
| `shared/context/ProfileContext.js` | Atomic `useReducer` state machine (the S203 refactor target; now test-backed) |
| `scripts/build-intake-eicar-fixture.py` | Builds `/tmp/eicar-test-exe.docx` for the manual intake virus-scan e2e |
| `.claude-memory/feedback-profile-context-runtime-bugs.md` | The two runtime-bug root causes + the now-CLOSED smoke-test rule |

## Testing
```bash
rtk proxy npx jest                       # 1549 tests (use `rtk proxy` — bare rtk compresses jest output)
npm run lint                             # 0 errors / 32 warnings (CI blocks on errors only)
npx eslint . -f json                     # authoritative warning tally (keyed on ruleId/severity, NOT grep)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:fact-consistency
```
