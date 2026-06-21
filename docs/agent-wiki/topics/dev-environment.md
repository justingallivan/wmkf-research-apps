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
Claude config sync, and environment-specific gotchas.

## Durable Memory

- Instruction architecture, hooks, rules: `project-claude-instruction-architecture`.
- Dev environment and Vercel deploy: `project-dev-environment`, `project-vercel-sensitive-env-pull-empty`, `project-vercel-cli-deploy-preview-auth`.
- Claude config sync: `claude-config-git-sync`.
- Local Jest/build/git gotchas: `local-jest-build-environment`, `env-broken-git-autogc`.
- Decision log: `decision-module-typeless-warning-accept`.

## Gotchas

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
  never blocks). The forcing function behind the fan-out / verify-claims rules.

All three share ONE trigger, **`.claude/hooks/lib/git-commit-detect.js`** (`isGitCommit` /
`isAmend`) — a single source of truth so the trigger cannot drift across the siblings (the
fan-out lesson applied to the hooks themselves; see `feedback-symbol-consumer-fanout`).
Tested by `.claude/hooks/lib/git-commit-detect.test.js` (plain `node`, no jest; run it
directly).

Design rules these hooks encode (Codex S259 two-round review — important when editing them):

- **Liberal match, never miss.** For a BLOCKING guard a missed `git commit` form silently
  disables it — the dangerous direction. So `isGitCommit` matches ANY `git` token in a
  segment (not anchored to segment start) and walks past global options (`-c key=val`,
  `-C dir`, `--no-pager`, …) to the first subcommand; it accepts harmless false-positives
  (e.g. `echo git commit` on a clean tree just re-runs the gate). It strips quoted spans
  (substituting a `__QUOTED__` placeholder, NOT a bare space — a bare space let a
  value-taking global eat `commit`, a real false-negative) and splits on `&& || ; | newline`
  and unescaped `( )`.
- **Fail OPEN, never wedge.** Each hook does `require('./lib/git-commit-detect')` INSIDE its
  `try/catch`, so a missing/broken helper exits 0 (allow) rather than crashing with a non-2
  code whose block/allow behavior is undefined. Locked by fail-open regression tests in the
  test matrix.
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
  agent with a review-worded prompt) and demands a LIFECYCLE (trace from the landed state /
  the edge the code omits) + PROVENANCE (what produced a value; a contract's failure path,
  not just its shape) self-trace WITH file:line evidence before delegating — so the reviewer
  confirms a trace, not a bare assertion, and so a named check isn't deflected to the reviewer
  or into a future project tool. The forcing function behind modes 5–6 of
  `feedback-self-review-before-delegating-review` (added S272 after Codex reviews repeatedly
  caught lifecycle/provenance misses — a one-way latch gone stale, a 200-on-failure DELETE).
  Complements the PostToolUse `codex-verbatim-reminder.js`. Fail-open.

## Standard Probe

```bash
rg -n "vercel|env|jest|build|autogc|CLAUDE|check:|isGitCommit|commit-guard" package.json scripts docs .github .claude/hooks
```
