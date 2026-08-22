# Handoff: merge `codex/fable-memory-hygiene-runbook` and run the first router diet

Date: 2026-08-21. Author: Claude Fable 5 (worktree
`.claude/worktrees/fable-memory-hygiene`). Audience: the Codex session active
on `main`. The authoring session is ending; this branch is complete and will
receive no further commits.

## What the branch is

`codex/fable-memory-hygiene-runbook`, 12 commits on base `053bd9f9`, head
`bac288da`, pushed to origin. Worktree clean. `main` was never touched. It
contains, in order:

1. **Deliverables** — `docs/audits/memory-hygiene-best-practices-review-2026-08-21.md`
   (evidence review) and `docs/MEMORY_HYGIENE_RUNBOOK.md` (canonical memory
   runbook: routine audit §6, router diet §10).
2. **Early-warning build** (owner-approved plan
   `docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md`, status BUILT with per-phase
   receipts): `scripts/lib/memory-router-thresholds.js` single-sources all
   router thresholds; `check:memory-router` and the SessionStart hook emit a
   routine-audit notice at ≥8,192 B; the Stop hook emits a
   crossing/growth advisory when the session's own edits are implicated;
   `/start` and `/stop` skill text updated; tests T1–T8 in
   `.claude/hooks/hook-enforcement.test.js`.
3. **Post-build review fixes** (`f9dd4b6b`, `b8f785c3`, `bac288da`): removed
   an uncaught pre-block `saveState` in `stop()` that let a state-I/O failure
   cancel deliberate blocking exits (T8 save-failure injection tests added,
   verified red against the pre-fix hook), and hardened the T1 mutation check
   to single-execution form where the suite's own pure assertion helper must
   reject each mutant result. Final Codex adversarial review of the diff:
   **approve, no material findings**.

Review provenance: six Codex adversarial review rounds plus one Codex rescue
across documents, plan, and build; every finding fixed and recorded in the
plan's changelog.

## Task 1 — merge (recommended first)

The changes are hooks, gates, tests, skills, docs, and one memory leaf — no
runtime application code, so Tier 0 under
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` (may land on `main`
directly).

1. From the `main` checkout: verify branch (`git rev-parse --abbrev-ref
   HEAD`), pull, then `git merge --no-ff origin/codex/fable-memory-hygiene-runbook`.
2. Conflict watch: `SESSION_PROMPT.md` was NOT touched on the branch, but
   `.claude-memory/MEMORY.md` (one router line added) and
   `.claude-memory/project-memory-router-trap-prevention.md` were — if memory
   moved on `main` since 2026-08-21, reconcile keeping both sides' facts.
3. Post-merge verification (sequential, never parallel; gate then its
   self-test): `npm run check:memory-router` + `:self-test`,
   `node .claude/hooks/hook-enforcement.test.js` (standalone node script —
   NOT jest), `npm run check:instruction-architecture`,
   `npm run check:docs-catalog`, `npm run check:fact-consistency` +
   `:self-test`, `npm run check:doc-symbol-refs` + `:self-test`,
   `npm run check:types`. All were green at `bac288da`.
4. Expected post-merge behavior: `check:memory-router` prints a WARNING-level
   routine-audit notice (router 9,040 B ≥ 8,192 B trigger) every run until
   Task 2 is done. That is the new system working, not a regression.

## Task 2 — first routine audit + router diet (after merge, on `main`)

`.claude-memory/MEMORY.md` is 9,040 B, over the 8,192 B trigger (warn band
11,264 B). Run the routine audit per `docs/MEMORY_HYGIENE_RUNBOOK.md` §6 and
the router diet per §10 — the runbook is canonical for procedure, diet
target, and classification rules; do not improvise a target from this
handoff.

Queued into the same diet (deliberately deferred by the author to this
audit):

- Add a `MEMORY.md` router line for `docs/MEMORY_HYGIENE_RUNBOOK.md` (it is
  currently reachable only via docs).
- The three `check:memory-health` advisory findings that predate this branch
  remain open (review doc R6) — address only if the runbook procedure calls
  for it.

After the diet: `npm run check:memory-router` + `:self-test` must be green
with no notice; the SessionStart notice disappears below 8,192 B. Shrinking
the router emits no Stop advisory (by design).

## Constraints (from CLAUDE.md and standing feedback)

- Never run mutating `check:memory-drift` during diagnosis; use
  `check:memory-drift:no-write`.
- The hook test is a standalone node script outside jest's testMatch.
- Gates and self-tests strictly sequential.
- Diet deletions are destructive carryover: list candidates and verify
  before removing (`feedback-list-and-confirm-before-bulk-deletes`,
  runbook classification rules).
- Never set `DATAVERSE_ALLOW_PROD_READS`; no production probes are needed
  for any of this.

## Explicitly out of scope

- R4/R5 in the best-practices review (advisory unique-leaf-ref count in gate
  output; weak-basis refinement) — owner decisions, still pending.
- Registering the hook test as a package `check:*` script — owner declined
  for now.
- Any expansion of the early-warning mechanism — the plan's §5 out-of-scope
  list stands.
- This file may be deleted after both tasks complete.
