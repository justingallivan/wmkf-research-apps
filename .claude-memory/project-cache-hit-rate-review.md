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

**Production telemetry (Session 525, 2026-09-20; owner-run `scripts/probe-ai-run-cache-reads.js`):**
the Executor prompts that batch are `cycle-dossier.entry` (Opus 5, measured marked prefix
610–618, several documents within seconds) and `review-synthesis.generate` (Sonnet 5,
1841–2258). Pre-fix rows show every document writing its own entry and none reading; the
post-fix cross-document read is pending the first post-fix batch (closing check:
`--since 2026-09-19T19:48:00Z`, expect later documents' `cache_read` ≈ first document's
`cache_create`). `phase-i.summary` has been idle since 2026-04-25.

**Remaining work (data-gated, not code-gated):** the review panel system blocks DO cache
on Opus 5 (seat row v2 measured 552, chair v3 801; the seat resolved to Opus 5 in the
2026-09-17 row although source defaults it to Fable 5.1 — override config not read). The
open panel question is only the unmarked user turn holding the proposal. A user-turn
breakpoint is net-negative unless the same proposal is re-sent within the TTL; check
`wmkf_ai_run` timestamps first. R5 remains conditional on repeat-within-TTL usage from
`api_usage_log`. The Executor does not write `api_usage_log`, so its hit rate is visible
only in run-row notes (`wmkf_ai_run` in Dataverse, not Postgres).

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
