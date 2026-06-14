---
name: feedback-idempotency-name-the-mechanism
description: "\"idempotent\" / \"no-op on repeat\" / \"only-once\" / \"no re-stamp\" / \"dedup\" is a behavior CLAIM, not a verified property. Treat it as [ASSUMED] until you cite the enforcing guard at file:line; an unconditional write under an idempotency claim is a defect."
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: c178a6d6-706e-47bb-9580-d248197210b1
---

In the S257 reviewer "hold step" plan I wrote "idempotent repeat hold = no re-stamp" as an
assertion. Codex traced it: `applyStage2aResponse` writes `now = new Date().toISOString()`
unconditionally, so a second POST would overwrite `wmkf_heldat` — the claim was false. The fix
was a mechanical short-circuit (early-return when already held, mirroring the existing
decline-idempotency branch in `respond.js`).

**Why:** prose never substitutes for a guard. I state the property I *want* without tracing whether
the code path delivers it. "Idempotent" is the single most common false-safety claim in a plan.

**How to apply:** for every "idempotent / no-op on repeat / only-once / no re-stamp / dedup"
claim, find the write site in source and name the enforcing mechanism at `file:line` — an
early-return before the write, a conditional `WHERE … IS NULL` / `ON CONFLICT DO NOTHING`, a unique
constraint, or a generation guard. No named mechanism ⇒ label it `[ASSUMED]` and either add the
guard or retract the claim. Same discipline for "reuse existing guards" (read the default branch for
the NEW value) and "backward compatible" (trace the read path).

Baked into [[contract-reconcile]] (Step 2 "Mechanism, not assertion" + anti-patterns list).
Related: [[feedback-symbol-consumer-fanout]], [[feedback-real-fix-not-design-note]].
