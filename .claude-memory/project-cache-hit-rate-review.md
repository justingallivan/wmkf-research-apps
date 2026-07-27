---
name: project-cache-hit-rate-review
description: "Active remaining-work pointer for prompt caching after the July 2026 project-wide audit and root remediation."
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

**Remaining work:** R4 is the optional cross-document Executor composition change: today
`composeMessages` interpolates variables into the system text before its cache marker, so
the shipped mitigation only makes an identical rerun cache-eligible. R5 remains conditional:
measure prefix size and repeat-within-TTL use before changing `composeScorePrompt` or
`process-phase-i-writeup`.

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
`lib/services/execute-prompt.js`; R4/R5 remain conditional work, not shipped
behavior.
