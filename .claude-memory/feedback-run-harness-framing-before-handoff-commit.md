---
name: feedback-run-harness-framing-before-handoff-commit
description: "SESSION_PROMPT.md is active harness text; check:harness-framing runs in the main Tests workflow and rejects words like \"lazy\" even in technical sense, so run it before every handoff commit"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4645a5a6-2b0a-4200-94ed-4ddc0e8c0b83
  modified: 2026-09-09T13:03:20.953Z
---

`npm run check:harness-framing` scans `SESSION_PROMPT.md` (and other active harness text) and runs inside the `Tests` workflow on every push to `main`. It flagged "the lazy mount" (2026-09-09, commit `dbae65fe`) as identity-insult framing, turning the post-merge `main` run red for two production merges that had nothing wrong with them.

**Why:** the gate matches words, not intent; a technical adjective in a handoff sentence reads the same as a self-directed one. A red `main` run after a merge looks like a broken deploy until someone reads the log.

**How to apply:** before committing `SESSION_PROMPT.md`, `DEVELOPMENT_LOG.md`, or `docs/CURRENT_WORK_QUEUE.md`, run `check:harness-framing` with the other doc gates (`doc-symbol-refs`, `build-claim-freshness`, `docs-catalog`). Prefer "on-demand", "deferred", or "mounted when opened" over "lazy". Related: [[feedback-red-gates-are-p0]], [[feedback-corrections-decay-unless-mechanized]].
