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
- **`scripts/reset-reviewer-for-testing.js` resets ONE reviewer to pre-invite pristine
  for a full PD→reviewer E2E re-run** (invite → accept/decline → materials → submit
  review) without minting a new person+email. Target `--email <x> --requestNumber <n>`
  (or `--suggestionId`). It PATCHes the suggestion back to `{selected:true, invited:false}`
  with 40 lifecycle/response/token/review fields cleared, clears the honorarium lookup
  via `disassociate()` (NOT `@odata.bind:null` — Dataverse rejects that), deletes the
  `wmkf_appreviewanswer` snapshot rows + the review draft, and nulls the person's 3
  board-identity fields. Parent PATCH runs BEFORE the child deletes (crash-safe order).
  Guards: refuses applicant-disposition rows and any reviewer whose name lacks "test"
  (override `--force`). Dry-run by default; `--commit` writes. Codex-reviewed (3 rounds).
  No `akoya_request` teardown — in capture-only mode there is none; in the
  no-BILL creation posture, any minted honorarium request needs separate cleanup.

- **Never run `rtk init` in this repo.** It replaces the condensed RTK block in
  root `CLAUDE.md` (between the `<!-- rtk-instructions v2 -->` markers) with a
  ~139-line command reference, pushing the file past the 200-line
  `check:instruction-architecture` gate. [VERIFIED 2026-07-04 via scratchpad
  replay of `rtk init` against the marker block.] The rtk Bash hook in
  `.claude/settings.json` and `.rtk/filters.toml` are the tracked setup.

## Commit Guards & Triggers

Four `PreToolUse(Bash)` hooks fire on `git commit` (wired in `.claude/settings.json`):

- **`enum-parity-commit-guard.js`** — BLOCKS (exit 2) on status/enum producer↔consumer
  drift (`check:status-enum-parity`).
- **`trust-boundary-guid-commit-guard.js`** — BLOCKS (exit 2) when a client-supplied id
  reaches a Dataverse selector without a GUID guard (`check:trust-boundary-guid`). See
  `security-auth.md` → "Trust-Boundary GUID Validation".
- **`docs-catalog-commit-guard.js`** — BLOCKS (exit 2) when staged docs-catalog surface
  changes leave `docs/DOCS_CATALOG.md` stale/invalid (`check:docs-catalog`).
- **`pre-commit-self-review.js`** — ADVISORY (injects a staged-diff-tailored checklist,
  never blocks). It keeps the fan-out and verify-claims checklist visible during commits.

**Staging-gap rule (S322):** PreToolUse runs BEFORE the command, so a compound
`git add X && git commit` has an empty index when the hook fires. Any commit hook that
tailors to staged paths must also parse path-like tokens from the command string —
`docs-catalog-commit-guard.js` and `pre-commit-self-review.js` do this (fixed S322 after
two stale-catalog commits evaded the docs-catalog guard). A new path-dependent commit
hook must copy that pattern, not the bare `git diff --cached` read.

All four share ONE trigger, **`.claude/hooks/lib/git-commit-detect.js`** (`isGitCommit` /
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

S330 added a plan/review enforcement layer (Codex-built, designed from the four S330 P0
coverage-miss mechanisms; shared detectors in **`.claude/hooks/lib/document-guards.js`**,
plain-node tests beside it). All fail open on internal errors; every blocker has a VISIBLE
in-artifact escape marker — never a silent env var:

- **`pre-review-delegation-trace-guard.js`** — `PreToolUse(Task|Agent)`. The broad
  LIFECYCLE+PROVENANCE self-trace reminder stays ADVISORY, but repo-local discovery asks in a
  review delegation prompt ("check whether any routes stream") now BLOCK unless adjacent
  TRACED:/Evidence: file:line proof or a `[DELEGATED-DISCOVERY: reason]` escape is present.
  Complements the PostToolUse `codex-verbatim-reminder.js`.
- **`scope-claim-reminder.js`** — `PreToolUse(Write|Edit)`, now BLOCKS plan docs that mix an
  unresolved quantity (TBD/[ASSUMED]) with unqualified derived counts on the same subject.
  Escapes: keep the derived count visibly `[ASSUMED]`, or add `[DERIVED-FROM: <probe>]`;
  historical log lines must state their resolution inline.
- **`plan-named-source-read-guard.js`** — `PreToolUse(Write|Edit)`, BLOCKS a plan doc naming a
  live `pages/`/`lib/` source file with no read evidence in the session transcript (Read,
  shell readers, or codegraph_explore output all count). Escape: `[NOT-READ: <path> — reason]`.
- **`session-lifecycle.js`** — tracks docs touched this session; when a `scripts/`/`lib/`
  source file changes afterward, docs mentioning it get flagged and UNRESOLVED plan/design-doc
  staleness blocks at Stop. Acks: `[RECHECKED after <path> change: ...]` or
  `[STALE-ACCEPTED: ...]` on a line mentioning the changed path.

## Standard Probe

```bash
rg -n "vercel|env|jest|build|autogc|CLAUDE|check:|isGitCommit|commit-guard" package.json scripts docs .github .claude/hooks
```
