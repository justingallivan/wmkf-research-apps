---
name: feedback-clear-jest-cache-in-shared-worktrees
description: In shared multi-agent worktrees, clear the Jest cache before citable verification runs when intermittent false reds appear; cache involvement may be suspected but is not proven by this incident.
status: active
metadata:
  type: feedback
---

## Recall Rule

Read this when multi-agent edits are followed by intermittent Jest failures
that committed source cannot produce.

Do: prove the failure is impossible from HEAD, clear Jest's cache, and require
repeated green verification. Treat any post-clear recurrence as real.

Do not: label an ordinary red test as cache-related or claim cache causation
without separate evidence.

Ground truth: committed source, the failing test, and Jest's post-clear rerun;
this memory records an incident lesson, not a guaranteed diagnosis.

During the Stage 2 read-coalescing build (S438, branch
`codex/claude-workbench-read-coalescing-stage2`), parallel cold-cache jest runs in a worktree
where multiple builder agents had iterated produced 13–16 intermittent failures concentrated in
call-count/select assertions that HEAD source provably could not produce (a single call site
cannot yield two recorded calls; `jest.clearAllMocks()` ruled out carryover). Warm or serial
(`-w 1`) runs were 100% green. The observed failures were false reds; stale Jest transform-cache
entries written during mid-build module states were a plausible but unconfirmed cause, and one
signature stayed unexplained.

**Why:** a reviewer or orchestrator seeing those reds can waste a diagnosis round or wrongly
doubt a correct diff; conversely trusting "it flaked" without proving the failure is impossible
from HEAD would hide real bugs.

**How to apply:** after multiple agents have edited services in one worktree, run
`npx jest --clearCache` before any verification run you intend to cite, then require N
consecutive green parallel runs. If a failure recurs post-clear, treat it as real. Distinguish
carefully: only call a red a false red when the assertion is provably unsatisfiable from committed
source, and do not attribute its cause to cache without separate evidence. Related:
[[feedback-scope-git-stash-in-shared-worktrees]].
