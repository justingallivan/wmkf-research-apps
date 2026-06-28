---
agent_wiki: topic
status: active
last_verified: 2026-06-15
stale_after_days: 90
owner: dev-ops
source_files:
  - package.json
  - scripts/
  - .github/workflows/
  - .claude/hooks/lib/git-commit-detect.js
  - .claude/hooks/enum-parity-commit-guard.js
  - .claude/hooks/trust-boundary-guid-commit-guard.js
canonical_docs:
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/CI_GATES_REFERENCE.md
watch_paths:
  - AGENTS.md
  - CLAUDE.md
  - .agents/skills
  - .claude/skills/**
  - .claude/hooks/**
  - .claude/rules/**
  - package.json
  - scripts/**
  - .github/workflows/**
  - docs/CREDENTIALS_RUNBOOK.md
update_triggers:
  - root instruction, hook, rule, or skill wiring changes
  - local build/test/deploy command changes
  - secrets or environment handling changes
  - Claude config sync changes
---

# Dev Environment

Use this page for local test/build quirks, Vercel CLI deploy posture, secrets,
Claude config sync, and environment-specific operating notes.

## Durable Memory

- Instruction architecture, hooks, rules: `project-claude-instruction-architecture`.
- Dev environment and Vercel deploy: `project-dev-environment`, `project-vercel-sensitive-env-pull-empty`, `project-vercel-cli-deploy-preview-auth`.
- Claude config sync: `claude-config-git-sync`.
- Local Jest/build/git operating notes: `local-jest-build-environment`, `env-broken-git-autogc`.
- Decision log: `decision-module-typeless-warning-accept`.

## Operating Notes

- **New-machine setup:** `scripts/bootstrap-machine.sh` (idempotent) recreates the
  per-machine, gitignored state after a fresh clone — the `.agents/skills` +
  auto-memory symlinks (slug computed from the repo path at runtime), `npm install`,
  and an `.env.local` presence check (secrets provisioned separately per
  `docs/CREDENTIALS_RUNBOOK.md`). `--worktree NAME` also sets up a sibling Codex
  worktree. Run the `parallel-agent-worktree` skill for the guided procedure;
  `docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md` is the full command-level detail.
- **`scripts/reset-request-reviewers.mjs` protects applicant-sourced rows by
  default.** It clears a single request's reviewer working state for testing. Rows
  the applicant proposed (`wmkf_applicantdisposition` non-null, or `applicant` in
  `wmkf_sources`) are SKIPPED unless you pass `--include-applicant` — a test reset
  must not clobber applicant input. Dry-run by default; reversible soft-delete
  unless `--hard`. To undo a soft-delete, `scripts/restore-request-reviewers-selected.mjs`
  flips `wmkf_selected` back to true.

## Commit Guards & Triggers

Three `PreToolUse(Bash)` hooks fire on `git commit` (wired in `.claude/settings.json`):

- **`enum-parity-commit-guard.js`** — BLOCKS (exit 2) on status/enum producer↔consumer
  drift (`check:status-enum-parity`).
- **`trust-boundary-guid-commit-guard.js`** — BLOCKS (exit 2) when a client-supplied id
  reaches a Dataverse selector without a GUID guard (`check:trust-boundary-guid`). See
  `security-auth.md` → "Trust-Boundary GUID Validation".
- **`pre-commit-self-review.js`** — ADVISORY (injects a staged-diff-tailored checklist,
  never blocks). It keeps the fan-out and verify-claims checklist visible during commits.

All three share ONE trigger, **`.claude/hooks/lib/git-commit-detect.js`** (`isGitCommit` /
`isAmend`) — a single source of truth so the trigger cannot drift across the siblings (the
fan-out lesson applied to the hooks themselves; see `feedback-symbol-consumer-fanout`).
Tested by `.claude/hooks/lib/git-commit-detect.test.js` (plain `node`, no jest; run it
directly).

Design rules these hooks encode (Codex S259 two-round review — important when editing them):

- **Broad commit detection for blocking guards.** Every `git commit` form should run the
  blocking guard. `isGitCommit` matches any `git` token in a segment (not anchored to segment
  start) and walks past global options (`-c key=val`, `-C dir`, `--no-pager`, ...) to the first
  subcommand; harmless false positives such as `echo git commit` on a clean tree just re-run
  the gate. It strips quoted spans by substituting a `__QUOTED__` placeholder and splits on
  `&& || ; | newline` and unescaped `( )`.
- **Fail open on helper errors.** Each hook does `require('./lib/git-commit-detect')` inside
  its `try/catch`, so a missing or broken helper exits 0 (allow). The test matrix locks this
  fail-open behavior.
- Blocking guards gate `--amend` (an amend can introduce a violation); the advisory
  self-review skips it. `isAmend` strips quotes first so `--amend` inside a commit MESSAGE
  does not falsely skip.

Adding a new blocking commit gate? Mirror `trust-boundary-guid-commit-guard.js`: import the
shared trigger, run the `check:*` script via `execFileSync`, `process.exit(2)` on failure,
fail open on any other error; then wire it into the `PreToolUse`→`Bash` block of
`.claude/settings.json` and add it to the `/start` gate list.

## Other Discipline Hooks (non-commit)

- **`pre-review-delegation-trace-guard.js`** — `PreToolUse(Task|Agent)`, ADVISORY (injects
  context, never blocks). Fires before a review/verify delegation (any Codex subagent, or any
  agent with a review-worded prompt) and adds a LIFECYCLE (trace from the landed state /
  the edge the code omits) + PROVENANCE (what produced a value; a contract's failure path,
  not just its shape) self-trace with file:line evidence before delegating. The reviewer should
  receive the trace evidence, not just the assertion. Complements the PostToolUse
  `codex-verbatim-reminder.js`. Fail-open.

## Standard Probe

```bash
rg -n "vercel|env|jest|build|autogc|CLAUDE|check:|isGitCommit|commit-guard" package.json scripts docs .github .claude/hooks
```
