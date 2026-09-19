---
name: project-cache-hit-rate-review
description: "Prompt-caching remaining-work pointer: R4 closed 2026-09-19 (nonce-free Executor preamble); panel user-turn marker and R5 are data-gated."
metadata: 
  node_type: memory
  type: project
  status: active
  originSessionId: 0a631ca0-29ca-4f6c-913a-f551fb1ced7d
---

The project-wide prompt-caching audit is complete. Its root remediation merged as `4fa53c7e`
(S341): R1 added keyed stable nonces for opt-in untrusted-content wrappers, R3 applied them
to Q&A, and the Executor now uses the same approach for identical reruns. See
`docs/PROMPT_CACHING_AUDIT.md` for the July 2026 census and implementation record.

**R4 closed 2026-09-19 (Session 524):** the July belief that the Executor needed a
template/variable schema split was overstated. No prompt definition places an untrusted
variable in the system template; the only per-document bytes ahead of the marker were the
preamble's nonce list. `composeMessages` now calls `buildUntrustedContentPreamble()` without
nonces (helper documents the line as optional; sentinels still carry the nonce), pinned by
the "two different documents share a byte-identical marked system block" unit test.

**Remaining work (data-gated, not code-gated):** the review panel (Fable 5.1 seat, Opus 5
chair, via the Executor) caches nothing today — its system block is below the 512 floor and
the proposal sits in an unmarked user turn. A user-turn breakpoint is net-negative unless the
same proposal is re-sent within the TTL; check `wmkf_ai_run` timestamps first. R5 remains
conditional on repeat-within-TTL usage from `api_usage_log`. The Executor does not write
`api_usage_log`, so its hit rate is visible only in run-row notes.

## Recall Rule

Read this when: changing prompt-cache boundaries or proposing cache work after a
repeated LLM call.

Do:
- Prove a byte-identical prefix at the real execution point, the active model's
  applicable cache floor, and repeat-within-TTL use.
- Verify realized cache reads through usage telemetry.

Do not:
- Add a one-off cache marker merely because a call repeats.

Ground truth: `docs/PROMPT_CACHING_AUDIT.md` and
`lib/services/execute-prompt.js`; R4 shipped 2026-09-19; R5 and the panel
user-turn marker remain conditional work, not shipped behavior.
