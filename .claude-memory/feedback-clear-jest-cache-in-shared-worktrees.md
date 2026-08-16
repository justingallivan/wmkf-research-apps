---
name: feedback-clear-jest-cache-in-shared-worktrees
description: In shared multi-agent worktrees, clear the jest cache before trusting verification runs — stale transform-cache entries from mid-build states produce intermittent false reds.
status: active
metadata:
  type: feedback
---

During the Stage 2 read-coalescing build (S438, branch
`codex/claude-workbench-read-coalescing-stage2`), parallel cold-cache jest runs in a worktree
where multiple builder agents had iterated produced 13–16 intermittent failures concentrated in
call-count/select assertions that HEAD source provably could not produce (a single call site
cannot yield two recorded calls; `jest.clearAllMocks()` ruled out carryover). Warm or serial
(`-w 1`) runs were 100% green. Cause consistent with stale jest transform-cache entries written
during mid-build module states, though one signature stayed unexplained; the hazard produced
false REDS only, never false greens.

**Why:** a reviewer or orchestrator seeing those reds can waste a diagnosis round or wrongly
doubt a correct diff; conversely trusting "it flaked" without proving the failure is impossible
from HEAD would hide real bugs.

**How to apply:** after multiple agents have edited services in one worktree, run
`npx jest --clearCache` before any verification run you intend to cite, then require N
consecutive green parallel runs. If a failure recurs post-clear, treat it as real. Distinguish
carefully: only call a red a cache artifact when the assertion is provably unsatisfiable from
committed source. Related: [[feedback-scope-git-stash-in-shared-worktrees]].
