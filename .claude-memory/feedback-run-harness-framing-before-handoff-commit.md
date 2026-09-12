---
name: feedback-run-harness-framing-before-handoff-commit
description: SESSION_PROMPT.md is active harness text scanned by check:harness-framing inside the main Tests workflow; run that gate with the other doc gates before every handoff commit and avoid adjectives it matches as insults
metadata: 
  node_type: memory
  status: active
  type: feedback
  originSessionId: 4645a5a6-2b0a-4200-94ed-4ddc0e8c0b83
  modified: 2026-09-09T13:03:57.052Z
---

`npm run check:harness-framing` scans `SESSION_PROMPT.md` and other active harness text, and it runs inside the `Tests` workflow on every push to `main`. It matches words, not intent: a technical adjective in a handoff sentence is rejected the same way as self-directed wording, and the whole `main` run turns red (first seen 2026-09-09 on a sentence about an on-demand mount).

**Why:** a red `main` run right after a production merge looks like a broken deploy until someone opens the log, and the fix commit then has to chase the merge.

**How to apply:** before committing `SESSION_PROMPT.md`, `DEVELOPMENT_LOG.md`, `docs/CURRENT_WORK_QUEUE.md`, or a memory file, run `check:harness-framing` together with `check:doc-symbol-refs`, `check:build-claim-freshness`, `check:docs-catalog`, and `check:memory-router`. Never chain the commit after a gate loop that printed a failure. Describe deferred rendering as "on-demand", "deferred", or "mounted when opened". Related: [[feedback-red-gates-are-p0]], [[feedback-corrections-decay-unless-mechanized]].
