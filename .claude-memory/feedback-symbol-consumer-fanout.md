---
name: feedback-symbol-consumer-fanout
description: "When a plan/change adds or modifies a persisted enum value, column, or status, verify every READ surface by grepping the SYMBOL — not just the write path. A verified write is half a proof; defects hide on the read side (reverse map, 2nd select list, default-open denylist, filter buckets, sibling terminal states)."
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: c178a6d6-706e-47bb-9580-d248197210b1
---

Twice (S257, reviewer "hold step" plan) I verified the WRITE path of a new Dataverse
picklist value (`held=100000004`) + column (`wmkf_heldat`) and called the surface covered —
and an adversarial Codex pass found the read-side gaps both times: a second select list
(`SUGGESTION_SELECT` vs the adapter `FIELD_SELECT`), the reverse read-map
(`RESPONSE_TYPE_BY_VALUE` vs the write map `RESPONSE_TYPE_MAP`), a default-open denylist
(`sendAllowsAttachments` returning true for any unlisted type), and a staff filter bucket that
miscounted the new status (`pending = !responseType`).

**Why:** my failure mode is trusting my own write-path reasoning. An enum value / column / status
is a CONTRACT read in many places. The reflex (from Codex): treat every changed symbol as a thing
that is *read* somewhere I haven't looked yet, and grep the SYMBOL is the proof — not reasoning
about the flow.

**Grep the FIELD, not just the mapping helper (S257 refinement).** When I first ran this audit for
`held` I grepped the map variables (`RESPONSE_TYPE_MAP`/`RESPONSE_TYPE_BY_VALUE`) and found 3
consumers — but a Codex code review then caught a 4th (`my-candidates.js`) that reads the **raw field
`wmkf_responsetype`** without importing either map, so the map-symbol grep missed it. Always grep the
lowest-level persisted identifier (the Dataverse/Postgres column name), which is a superset of the
helper-variable hits.

**How to apply:** before declaring a symbol's surface covered, grep the symbol repo-wide (the raw
field name first, then the mapping helpers) and prove:
- **Maps are symmetric** — a write-map almost always has a reverse read-map; find both (one without
  the value returns `undefined` to consumers).
- **Select/projection lists come in ≥2** — add the field to each, not the first found.
- **Boolean guards fail open** — a `return v !== 'x'` denylist is wrong-by-default for a new value;
  read the default branch, prefer an allowlist.
- **Filter/count buckets must be total** — the new value lands in exactly ONE bucket, not zero
  (vanishes) or the wrong one (miscount).
- **State machines span all terminals** — a sibling column or side-channel writer (cron/webhook/
  bulk) can set "done" bypassing the main guard; check every terminal-signalling column.

This is now audit #7 ("Symbol-consumer fan-out") in [[contract-reconcile]] — the blocking check.
Related: [[feedback-idempotency-name-the-mechanism]], [[feedback-falsify-not-confirm]],
[[feedback-cite-ground-truth]].
