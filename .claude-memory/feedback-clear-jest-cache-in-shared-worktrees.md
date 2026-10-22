---
name: feedback-clear-jest-cache-in-shared-worktrees
description: For intermittent Jest failures after concurrent edits, preserve evidence and bound any diagnostic rerun; the S438 cache-cause hypothesis remains unproven.
status: active
metadata:
  type: feedback
---

## Recall Rule

Read this when concurrent edits are followed by an intermittent Jest failure
that appears inconsistent with the exact source under test.

Do: preserve the failing output and identify the exact source/commit and run mode.
If the failure is provably impossible from that source, perform at most a
task-appropriate, bounded diagnostic rerun within the agreed verification ceiling.
Clear cache only when there is a specific reason to test that hypothesis; the S438
incident did not prove cache causation.

Do not: label an ordinary red test as cache-related or claim cache causation
without separate evidence.

Ground truth: the exact source, failing test/output, and any bounded rerun. The
cache cause in the S438 incident remains unknown; this memory does not prescribe
repeated parallel runs or guarantee that clearing cache explains a failure.

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

**How to apply:** after concurrent edits, keep the task-appropriate run mode and verification
budget explicit. Only call a red impossible when the assertion is provably unsatisfiable from
the exact source being tested. A rerun or cache-clear is a bounded diagnostic, not a required
ritual; recurrence warrants investigation but a single post-clear result does not establish
cause. The S438 cache explanation remains unconfirmed. Related:
[[feedback-scope-git-stash-in-shared-worktrees]].
