---
name: feedback-scrutinize-exemptions-and-fallthrough
description: "My shipped defects live in the NEGATIVE space — the inputs my new branch doesn't match, the path I exempt from a gate, the if/else-if with no final else. I scrutinize what I ADD; I under-scrutinize what I EXEMPT and what FALLS THROUGH. Force the complement check on my own new code, and enforce (don't assume) every exemption's precondition."
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: c178a6d6-706e-47bb-9580-d248197210b1
---

S257 (reviewer hold step, chunk 6): Codex caught two fail-open HIGHs I'd shipped and
self-reviewed past:
1. `finalize` was EXEMPTED from the first-contact confidence gate on the assumption "it
   only goes to held reviewers, whose address is proven" — but nothing enforced held-ness
   server-side, so a misdirected finalize bypassed the wrong-address protection and could
   clobber `emailSentAt`. Fix: `mayReceiveFinalize` (responsetype=held), skip otherwise.
2. An unknown `templateType` still sent a real email — the lifecycle `if/else-if` had no
   final `else`, and I'd added my branches without auditing the fall-through. Fix:
   `isKnownTemplateType`, reject before send (fail-closed).

**Why:** my self-review checks "does the branch I added do the right thing for its intended
input?" Both bugs were in the COMPLEMENT — the path NOT taken (unknown type → no branch)
and the gate NOT applied (finalize exempted). Two compounding habits:
- I justify an exemption with an ASSUMED property instead of an ENFORCED one (this is
  [[feedback-idempotency-name-the-mechanism]] — "mechanism not assertion" — but applied to
  eligibility/preconditions, not just idempotency). Carving an exception out of a gate is
  the dangerous direction; adding a gate is the safe one.
- I apply a correct principle to the ONE spot in front of me and don't sweep siblings
  (chunk 5 I flipped one attachment gate to allowlist but didn't ask "is the rest of the
  handler fail-open on unknown types?"; same shape as the audit-#7 grep-scope miss in
  [[feedback-symbol-consumer-fanout]]).

**Same trap in TESTS — "passes for the wrong reason" (S257 chunk 7).** I wrote a route test
asserting "hold attaches no proposal materials" in a setup where **no materials existed to begin
with** — it proved *absence*, not *exclusion*, and would stay green even if the strip gate were
deleted. Codex caught it. A negative assertion is only meaningful when the thing-being-excluded is
actually PRESENT in the setup: to prove a strip/skip/guard, construct the input that WOULD trip it
(materials that exist, an already-invited row, a low-confidence address) and prove the guard removes
it. Before trusting a passing test, ask: "would this still pass if the feature were broken?" If yes,
the test is decorative.

**How to apply (on my OWN new code, build-side):**
- For every new branch / type / gate, enumerate the COMPLEMENT and state what the system
  does for it. An `if/else-if` with no final `else` is fail-OPEN until proven fail-closed.
  A new enum/templateType/status defaults to whatever the unhandled path does — verify
  that's safe (reject/skip), not just "my value is handled."
- Every EXEMPTION ("this path skips the gate because X") must cite the ENFORCED precondition
  at `file:line` — never trust the caller or the intended use.
- When a fix applies a principle to one spot, immediately ask "which sibling surfaces have
  the same shape?" and sweep them in the same pass.

Baked into [[contract-reconcile]] (Step 2 exemptions clause + Mode-B complement/fall-through
self-review + anti-patterns).

**Deterministic control (S257) — because a written rule can't fire itself.** The misses kept
recurring even after writing the rule down, since I never *ran* the checklist at build time.
`scripts/check-status-enum-parity.js` (npm `check:status-enum-parity`, in the `/start` gate list)
enforces a registry of producer↔consumer key-parity invariants, and a PreToolUse(Bash) hook
`.claude/hooks/enum-parity-commit-guard.js` BLOCKS a `git commit` (exit 2) when they drift —
verified end-to-end against the exact `held`-missing-from-`STAGE_META` regression. **When you add a
producer set whose values must be mirrored by a consumer (label map / filter bucket / count rollup),
add a REGISTRY entry** so the new pair is enforced too. The hook is the control; the prose above is
why it exists.
