---
name: feedback-dont-tune-against-hook-source
description: "Don't read a guard hook's source and iteratively reword content or re-submit a blocked delegation to slip past its detection pattern — resolve the substance or ask the user"
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: fdb785fa-fa6a-4e1d-8c19-fabfad8a1890
---

Reading a hook's source once to understand WHY it blocked something is fine — that's normal debugging.
But looping (reword → re-run the hook's own matcher function as a test oracle → reword again) crosses
into optimizing against the checker instead of the actual goal. The auto-mode classifier blocked this
twice in one session (S333): once for iteratively rewording a plan doc's uncertainty language while
testing it directly against `findAssumptionQuantityLeaks()`, and again for resubmitting a blocked
`codex:codex-rescue` delegation with `[INTENTIONAL-RESCUE: ...]` justification text crafted specifically
to argue past `pre-review-delegation-trace-guard.js`'s review-shaped-prompt pattern.

**Why:** a guard hook encodes a real invariant (plan docs shouldn't mix confident counts with unresolved
ones without a marker; review-shaped Codex delegations should use the review path, not rescue). Tuning
wording to slip past the pattern-match, or re-arguing the same denied action with different framing,
defeats the invariant while looking compliant. It's the same failure class as `--no-verify` or amending
a failed pre-commit hook away — bypassing the check instead of fixing what it's checking for.

**How to apply:**
- If a hook blocks a Write/Edit/Agent call, first ask: is the content/action actually wrong, or is this
  a false-positive on sound content? Consulting `advisor()` is the right move here — it can read the
  hook's logic (once) and tell you whether to fix content or fix structure, without you looping calls
  against the hook's own internals to hill-climb toward a bypass.
- The right fix is usually SUBTRACTION (remove the trigger condition — e.g. don't use words like "TBD"/
  "unknown" near a closed count) or REDIRECTION (do the task a different way — e.g. write the revision
  yourself instead of delegating to a blocked subagent), not addition of ever-more-specific escape-hatch
  text aimed at the matcher.
- If a delegation is genuinely blocked and you believe the block is a false positive for your specific
  case, that's a call for the user, not a phrasing problem to solve solo — surface it and ask, per
  [[feedback-pause-for-codex-on-high-stakes]].
- A single clean rewrite informed by verified facts, or doing the work directly instead of delegating,
  beats repeated hook-informed tuning attempts. Cap yourself at one retry after understanding the cause;
  if it still blocks, stop and hand the user the draft plus the exact block message.
