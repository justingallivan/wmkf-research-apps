---
name: project-peer-review-executor-migration
description: Historical peer-review upload Executor migration; standalone entry point retired, prompt rows and A7 contract preserved for reuse.
metadata:
  node_type: memory
  status: active
  type: project
  last_verified: 2026-11-19 via retirement decision and caller inventory
---

## Recall Rule

Read before reusing peer-review upload prompts or changing Executor A7 assertions.
The standalone Summarize Peer Reviews page/API is retired by the November 19
source change; see `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md` for the source
and deployment boundary. Its stored prompt rows, history, and original route
implementation are preserved. Workbench review synthesis uses the separate
`review-synthesis.generate` prompt and remains live.

## Historical implementation — S344, 2026-07-08

The original `/api/process-peer-reviews` implementation used
`peer-review-summarizer.analyze`/`.questions` through `executePrompt()` rather than
the legacy code generators. Its archived implementation preserves that behavior
as reference. Commits `1559e8dc` and `4dd5c84b` implemented and hardened it; the
historical migration plan is `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`.

The durable A7 lesson still applies to future reuse: per-review nonce wrapping
was route-owned, and `reviews_block` was a plain override. The route supplied
`{{a7_preamble}}` and `assertSystemIncludes: reviewNonces`; the Executor refused
to call the model when the composed system prompt omitted a required nonce.
Removing the placeholder from a staff-editable prompt must never silently strip
that protection. Preserve this contract when adapting the archived route.

Published prompt status is separate from app lifecycle. Retirement does not
unpublish/delete rows or claim that an external caller cannot use them.
