# Session 227 Prompt: Web-discovery increment 2 (route + UI) — or observe the new Stop-gate harness

## Session 226 Summary

Short, focused session. The agenda was to **review the enforcement harnesses Codex authored while S225 slept** (the instruction-architecture Phase-2 work). Reviewed against the *corrected* Phase-1 review, found and fixed two real `Stop`-hook loops, then committed + pushed the whole changeset.

### What Was Completed

1. **Reviewed Codex's instruction-architecture harnesses** — verdict: faithful to the *corrected* §4 (not the withdrawn first draft). Checked each constraint in source:
   - SessionStart is advisory-only (can't block — verified); symlink guard is a PreToolUse Write/Edit **deny** (`protected-path-guard.js`).
   - Stop hook = deterministic **changed-surface** gate check, scoped to session-owned changes, advisory by default (`CLAUDE_STOP_GATE_MODE=block` opts in); symlink breakage blocks immediately.
   - `setup-database.js` self-contradiction reconciled **in source** + source-level `assertFreshDatabase` guard (refuses populated DBs; `ALLOW_POPULATED_DATABASE_SETUP=true` for recovery).
   - `CLAUDE_INSTRUCTION_AUTHORITY.md` = ownership registry (one-rule-one-home), not a runtime precedence ladder.
   - CLAUDE.md trimmed **308→82 lines**; 9 `.claude/rules/*.md` with valid `paths:` frontmatter; CI wires `check:agent-invariants:ci` (tracked-only) + `check:instruction-architecture`. All gates green.

2. **Fixed two `Stop`-hook infinite loops (found live).** `additionalContext` on `Stop` **re-opens the turn** ("conversation continues so Claude can act on the feedback"), so any advisory emitted on a normal stop loops forever:
   - **No-ledger path** → now exits silently (nothing actionable; sessions predating the hook hit this — I was in this loop during review).
   - **Advisory gate-failure path** → de-dups on (failing gates + changed-surface fingerprint): surfaces each distinct state to Claude **once**, then the next Stop proceeds. Block mode (exit 2) unchanged.

### Commits
- `605593e` — feat(claude-arch): instruction-architecture enforcement harnesses (Phase 2)
- `8786664` — fix(claude-arch): stop advisory gate-failure from looping the Stop hook
- (this doc commit) — Session 226 docs + memory

## Potential Next Steps

### 1. Web-discovery increment 2 (route + UI) — the main feature thread
Backend (`lib/services/web-discovery-service.js`) shipped S225, **inert in prod** (no caller). To wire it up:
- Route `pages/api/reviewer-finder/web-suggestions.js` — `requireAppAccess('reviewer-finder','reviewers')`, key-gated, calls `WebDiscoveryService.search`. **Add an API_ROUTE_SECURITY_MATRIX entry or `check:api-routes` goes red.** (The new Stop gate will also flag `pages/api/**` changes.)
- Read-only "Web suggestions" panel + capability-gated `searchWeb` toggle on both surfaces (`ReviewerSearchSection.js` + Workbench `ReviewerFindPanel.js`).
- ⚠ **Live Perplexity contract test before enabling** — no `PERPLEXITY_API_KEY` set yet; `search_after_date_filter` format (M/D/YYYY) is unconfirmed against the real API. Deferred-v2 (full pipeline integration) contracts live in plan §10. See [[project-reviewer-finder-next-topics]] §3.

### 2. Observe the new Stop-gate harness before enabling blocking
Per [[project-claude-instruction-architecture]] follow-up: watch a few real sessions in **advisory** mode. Record false positives, missed Bash-authored changes (only Write/Edit are attributed), and Stop runtime. Only then consider `CLAUDE_STOP_GATE_MODE=block`. **Latent**: the `main()` error-catch in `session-lifecycle.js` still emits `additionalContext` on a `stop()` exception (loops only if the hook is persistently broken) — Justin deferred fixing it.

### 3. (Deferred) "Add as candidate" manual-add path
Parked — carries real contracts (Codex v6 review). Not in read-only v1.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked.** This session's commits are agent-instruction infra + an inert service — safe in prod.
- **The `additionalContext`-on-`Stop`-loops-the-turn fact is now load-bearing** — see [[project-claude-instruction-architecture]] before touching `session-lifecycle.js`. Block (exit 2) is the only non-looping way to make Stop act every time.
- `/contract-reconcile` before declaring multi-layer work done; keep the impl→post-impl Codex loop.

## Key Files Reference

| File | Purpose |
|------|---------|
| `.claude/hooks/session-lifecycle.js` | SessionStart baseline + PostToolUse record + Stop changed-surface gate (advisory; de-duped) |
| `.claude/hooks/protected-path-guard.js` | PreToolUse deny on Write/Edit to `AGENTS.md` / `.agents/skills` |
| `scripts/check-instruction-architecture.js` | Self-testing gate for the whole harness (18 checks) |
| `docs/CLAUDE_INSTRUCTION_AUTHORITY.md` | Instruction ownership registry + hook safety contract |
| `lib/services/web-discovery-service.js` | Perplexity → A7 extraction → WebLead[] (read-only v1, inert until a route calls it) |
| `docs/REVIEWER_WEB_DISCOVERY_PLAN.md` | v7 read-only scope + deferred-v2 integration contracts |

## Testing

```bash
npm run check:instruction-architecture          # 18 harness checks
npm run check:agent-invariants                   # 3 symlinks (tracked + per-machine)
node -c .claude/hooks/session-lifecycle.js       # hook parses
npx jest web-discovery-service                   # 15 tests (increment 1)
# full startup gate set: see .claude/skills/start
```
