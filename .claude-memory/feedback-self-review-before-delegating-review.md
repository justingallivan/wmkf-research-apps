---
name: Self-review (verify + fan-out) before delegating a code review
description: The failure modes Codex review kept catching across the S258 build were self-catchable — run the verify/fan-out/boundary/concurrency self-pass BEFORE delegating review so the review confirms rather than discovers.
type: feedback
status: active
scope: workflow
last_verified: S258 (2026-06-14)
---

## Recall Rule
Read before: declaring a slice done, committing code, or delegating a review (Codex `/code-review`, contract-reconcile, etc.). The commit-time hook `.claude/hooks/pre-commit-self-review.js` injects this checklist on `git commit`; this memory is the why.

**Why:** Across a long multi-slice build (S258 Workbench Proposal tab + Field Primer), Codex review caught the SAME self-catchable failure modes round after round, forcing multiple revise→re-review cycles. The user named it directly ("lazy and forgetful") and asked for hook-enforced prevention. Scattered per-edit advisory hooks did NOT prevent it — the checks have to happen at the done/commit decision point.

**The four modes (in observed frequency):**
1. **Verify-don't-assert.** Every plan/code claim about how an EXISTING field/helper/return-shape/enum behaves must be confirmed by reading or grepping the source — not plausibly inferred. (Misfires this build: co-PIs are junction-only not UNION-read; the Executor DOES expose `meta.promptVersion`; two similar pickers had divergent `.docx`/`.pdf` preference.) Label material claims `[VERIFIED via X]`.
2. **Fan-out the guard (the #1 repeat).** When you add a validation / null-check / scope-check / coercion, immediately grep for its STRUCTURAL SIBLINGS and apply it to ALL of them in the same pass. (Misfires: GUID-validated one endpoint not its sibling; stale-fetch guard on one effect not the other; ETag fail-closed at the claim not the persist; coerced every field but missed one badge.) This generalizes [[feedback-symbol-consumer-fanout]] from enum/status consumers to guards/validations.
3. **Harden trust boundaries.** Wherever untrusted data crosses a boundary (client→DB selector, SharePoint→stream, LLM→render): validate format, scope to the AUTHORIZED set (not just "belongs to the request"), sanitize outputs, type-guard before render.
4. **Concurrency on durable writes.** For any claim/persist on shared durable state, reason explicitly about interleavings (two writers, expiry mid-op, lost update); name the idempotency/locking mechanism ([[feedback-idempotency-name-the-mechanism]]) — don't assume it.

**How to apply:** Before delegating a review, self-run the contract-reconcile + fan-out pass (`/contract-reconcile` targets modes 3–4; a sibling grep targets mode 2). The point is SHIFT-LEFT: the review should confirm a clean slice, not be the primary bug-finder. Blocking gates are reserved for precise checks (e.g. enum-parity) — these modes are judgment-shaped, so the hook injects the checklist rather than blocking. See [[feedback-timebox-metawork]] (this self-pass IS the work, not metawork).
