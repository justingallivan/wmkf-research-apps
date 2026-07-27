---
agent_wiki: topic
status: active
last_verified: 2026-07-18
stale_after_days: 90
owner: dev-ops
source_files:
  - package.json
  - scripts/
  - .github/workflows/
  - .claude/hooks/lib/git-commit-detect.js
  - .claude/hooks/lib/document-guards.js
  - .claude/hooks/design-doc-assertion-guard.js
  - .claude/hooks/pre-review-delegation-trace-guard.js
  - .claude/hooks/session-lifecycle.js
  - .claude/settings.json
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

- **npm-global and Homebrew share `/opt/homebrew` — the path never identifies the
  installer (S377).** npm's global prefix on this machine is `/opt/homebrew`, so
  npm-installed CLIs land in `/opt/homebrew/bin` beside Homebrew's and `which` cannot
  tell them apart. Before telling the owner how to update a tool, resolve it:
  `readlink /opt/homebrew/bin/<tool>` → `../lib/node_modules/…` means npm
  (`npm i -g <pkg>`), `../Cellar/…` means brew (`brew upgrade <formula>`); a tool in
  `/usr/bin` is macOS-shipped and belongs to neither. Confirm with
  `npm -g ls --depth=0` / `brew list --versions <tool>`, which name the package rather
  than merely containing the binary. As of 2026-07-26: `vercel`, `codegraph`, `codex`,
  and `gemini` are npm; `rtk`, `gh`, and `node`/`npm` are brew
  [VERIFIED 2026-07-26 via `readlink` on each binary, cross-checked against
  `npm -g ls --depth=0` and `brew list --versions`; re-run those three to refresh].
  Hazard this guards:
  S377 asserted "Homebrew-installed" for `vercel` from the path prefix and recorded it
  as `[VERIFIED]`, contradicting Codex, which had been correctly saying npm. Policy
  memory: `feedback-cite-ground-truth`, `project-vercel-plugin-disabled-restore`.
- **Session automation is branch-aware (S356).** `/start` checks
  `git rev-parse --abbrev-ref HEAD` before any pull (never `git pull origin main`
  from a feature branch), and `/stop` verifies the branch at Step 1, re-verifies
  immediately before the docs commit, and pushes the current branch instead of a
  hard-coded `main`. Hazard this guards: the shared checkout's HEAD drifts when a
  concurrent Codex/subagent session does branch work (S280: commits landed on
  `codex-portal-work` and had to be untangled; S355: a docs commit landed on a
  feature branch and was recovered via cherry-pick). Policy memory: `feedback-verify-branch-before-git-action`.
- **New-machine setup:** `scripts/bootstrap-machine.sh` (idempotent) recreates the
  per-machine, gitignored state after a fresh clone — the `.agents/skills` +
  auto-memory symlinks (slug computed from the repo path at runtime), `npm install`,
  and an `.env.local` presence check (secrets provisioned separately per
  `docs/CREDENTIALS_RUNBOOK.md`). `--worktree NAME` also sets up a sibling Codex
  worktree. Run the `parallel-agent-worktree` skill for the guided procedure;
  `docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md` is the full command-level detail.
- **CodeGraph index is per-machine, auto-synced, and never committed.** `.codegraph/`
  (a ~86 MB SQLite DB + WAL, daemon pid/socket/log) is gitignored twice — root
  `.gitignore` and a self-written `.codegraph/.gitignore` (`*` + `!.gitignore`). It is a
  derived artifact rebuilt from source, like `node_modules/`/`.next/`; do NOT commit or
  try to sync it between machines. Each machine runs its own daemon (v1.3.0) whose file
  watcher auto-syncs on change — the startup log shows a full re-index (`Auto-synced N
  file(s)`) then per-edit incremental syncs, so it stays current across a `git pull`
  (verified 2026-07-08: after a 576-commit pull it auto-synced 668 files on startup and
  tracked same-session edits, including a line-number shift). If ever suspected stale,
  restart the daemon to force a re-sync. **Query hygiene:** the auto-injected
  `codegraph_context` block runs a query on the raw *prompt sentence*, so on conversational
  prompts it returns fuzzy/irrelevant symbol matches — that noise is not a broken index.
  Re-query `codegraph_explore` with the actual symbol name(s) rather than falling back to
  grep.
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

- **A "wrong user logged in, no sign-out button" symptom on `localhost:3000` is
  usually `AUTH_REQUIRED` missing/not `'true'` in `.env.local`, not a browser or
  Microsoft-SSO problem (S346).** `AUTH_REQUIRED` fails OPEN — unless it is the
  literal string `'true'`, Azure AD is skipped entirely and the dev-only
  `ProfileSelector` lets you silently pick any existing Postgres `user_profiles`
  row. Full local-auth checklist (Azure AD vars, `AUTH_REQUIRED=true`,
  `EXTERNAL_LINK_SECRET`): `project-local-dev-auth-setup`. Editing `.env.local`
  does not reach an already-running `next dev` process — restart it after any
  change.
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
plain-node tests beside it). All fail open on internal errors. Policy exceptions are
visible in the artifact or delegation prompt — never a silent env var:

- **`pre-review-delegation-trace-guard.js`** — `PreToolUse(Task|Agent)`. The broad
  LIFECYCLE+PROVENANCE self-trace reminder stays ADVISORY, but repo-local discovery asks in a
  review delegation prompt ("check whether any routes stream") now BLOCK unless adjacent
  TRACED:/Evidence: file:line proof or a `[DELEGATED-DISCOVERY: reason]` escape is present.
  A fingerprinted adversarial-review receipt marker also BLOCKS unless the same prompt asks
  for adversarial/refuting review, `file:line` evidence, and a disconfirming check for each
  recommendation.
  Complements the PostToolUse `codex-verbatim-reminder.js`.
- **`design-doc-assertion-guard.js`** — `PreToolUse(Write|Edit)`, BLOCKS the narrow
  detectable pattern of a newly introduced reviewer email plus a strong ownership/identity
  assertion marker (for example, "almost certainly", "belongs to", or "role mailbox"). Same-sentence
  source evidence or an explicit hedge passes; broad design/storage claims remain ADVISORY.
  The settings integration test proves the configured command preserves exit code 2.
- **`scope-claim-reminder.js`** — `PreToolUse(Write|Edit)`, now BLOCKS plan docs that mix an
  unresolved quantity (TBD/[ASSUMED]) with unqualified derived counts on the same subject.
  Escapes: keep the derived count visibly `[ASSUMED]`, or add `[DERIVED-FROM: <probe>]`;
  historical log lines must state their resolution inline.
- **`plan-named-source-read-guard.js`** — `PreToolUse(Write|Edit)`, BLOCKS when the text a
  plan-doc edit INTRODUCES (delta-scoped — an unrelated paragraph edit does not re-litigate
  every path a long historical plan already names) names a live `pages/`/`lib/` source file
  with no read evidence in the session transcript (Read, shell readers, or codegraph_explore
  output all count). Escape: `[NOT-READ: <path> — reason]` anywhere in the doc.
- **`session-lifecycle.js`** — tracks docs touched this session; when a `scripts/`/`lib/`
  source file changes afterward, docs mentioning it get flagged and UNRESOLVED plan/design-doc
  staleness blocks at Stop. Acks: `[RECHECKED after <path> change: ...]` or
  `[STALE-ACCEPTED: ...]` on a line mentioning the changed path. It also fingerprints
  consequential review artifacts and blocks Stop until a qualified fresh-agent receipt
  matches the current file, or the artifact contains
  `<!-- adversarial-review:waived reason=specific reason -->`.

## Standard Probe

```bash
rg -n "vercel|env|jest|build|autogc|CLAUDE|check:|isGitCommit|commit-guard" package.json scripts docs .github .claude/hooks
```
