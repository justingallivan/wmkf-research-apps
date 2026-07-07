---
name: project-cache-hit-rate-review
description: "Deferred — project-wide prompt-caching audit after Anthropic flagged a low cache-hit rate (raised S339, 2026-07-06)"
metadata: 
  node_type: memory
  type: project
  status: active
  originSessionId: 0a631ca0-29ca-4f6c-913a-f551fb1ced7d
---

Anthropic emailed the owner (around 2026-07-06) that this project's prompt **cache-hit rate is low**. The owner wants a **project-wide** review of prompt caching in a later session — not a piecemeal per-path fix.

**Why:** Caching is currently applied unevenly. Confirmed `cache_control: { type: 'ephemeral' }` markers exist only in `lib/services/execute-prompt.js` (system/user boundary) and `lib/services/expertise-finder/batch-match-service.js`. The reviewer-finder analyze path (`lib/services/claude-reviewer-service.js` `_callLLM`) does **not** set `cache_control`, so its repair-loop retries re-send the full bounded proposal at full input price. Other LLM callers are unaudited. A low aggregate hit rate suggests either missing markers, cache-busting prompt ordering (dynamic content ahead of stable prefix), or sub-5-min-TTL gaps.

**How to apply:** When this is picked up, audit every LLM call site (start from `lib/services/llm-client.js` consumers), check marker placement (stable prefix first, `cache_control` at the largest stable boundary), and standardize rather than adding one-off markers. Explicitly deferred out of the S339 reviewer-finder PI/institution-exclusion work — that plan does the backfill via the existing repair loop WITHOUT adding a one-off cache marker, precisely so caching stays a holistic decision here. See [[project-reviewer-verify-fail-dangerous]] neighborhood for the reviewer-finder analyze path.
