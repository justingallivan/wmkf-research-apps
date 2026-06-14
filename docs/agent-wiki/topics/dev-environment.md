---
agent_wiki: topic
status: active
last_verified: 2026-06-14
stale_after_days: 90
owner: dev-ops
source_files:
  - package.json
  - scripts/
  - .github/workflows/
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

## Standard Probe

```bash
rg -n "vercel|env|jest|build|autogc|CLAUDE|check:" package.json scripts docs .github
```
