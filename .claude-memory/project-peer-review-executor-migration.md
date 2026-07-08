---
name: project-peer-review-executor-migration
description: "SHIPPED S344: peer-review-summarizer wired to the Executor (admin rows drive it); route-owned A7 preamble guarded by executePrompt assertSystemIncludes. Do not revert without a decision."
metadata:
  node_type: memory
  status: active
  type: project
---

**Shipped S344 (2026-07-08).** `pages/api/process-peer-reviews.js` now runs the
`peer-review-summarizer.analyze`/`.questions` `wmkf_ai_prompt` rows via
`executePrompt()` instead of the hardcoded generators in
`shared/config/prompts/peer-reviewer.js`, so staff `/admin` prompt-edits take
effect. Owner ask; Codex-reviewed twice (design SOUND-WITH-CHANGES, shipped-diff
REWORK→fixed). Plan: `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`. Commits
`1559e8dc` (impl), `4dd5c84b` (A7 hardening).

**Do NOT reopen / revert without a new decision.** The legacy generators
(`createPeerReviewAnalysisPrompt`/`Questions`) are retained ONLY as the rollback
path (`git revert` the route diff) — they are no longer the live source. Rows are
published in Dataverse (`sonnet`, maxTokens 2500/16384, temp 0.3, `parseMode:raw`,
`kind:none`, vars `review_count`/`review_count_suffix`/`reviews_block`/`a7_preamble`).

**Durable lesson (why the A7 wiring is subtle):** wiring a prompt to the Executor
makes its A7 preamble delivery staff-mutable. Per-review nonce wrapping (owner's
choice) is route-owned, so `reviews_block` is a PLAIN override — the Executor does
NOT auto-inject a preamble. The route supplies it via `{{a7_preamble}}` in the row
system prompt, BUT a `/admin` edit dropping that placeholder would silently send
review content unprotected. Closed with `executePrompt({ assertSystemIncludes:
reviewNonces })` — the Executor throws after compose / before the Claude call if
the composed system prompt lacks the nonces (fail closed, tied to the REAL prompt,
not caller inputs). Reusable pattern + hazard live in the agent wiki:
`docs/agent-wiki/topics/prompt-executor.md`. Related: [[project-prompt-legacy-audit-followup]],
[[project-a7-prompt-injection-hardening]].
