---
name: feedback-dont-tune-against-hook-source
description: "Don't read a guard hook's source and iteratively reword content or re-submit a blocked delegation to slip past its detection pattern — resolve the substance or ask the user"
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: fdb785fa-fa6a-4e1d-8c19-fabfad8a1890
---

## Recall Rule

When a hook blocks an action, diagnose the substantive invariant once, make at
most one evidence-based correction, then stop and ask if it still blocks. Never
iterate wording against the matcher as an oracle.

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

## S413 extension — when the escape hatch itself triggers the guard, it's a hook bug

The one-retry cap above is what surfaces this. In S413 `scope-claim-reminder` blocked a doc
edit; the single permitted correction was the hook's OWN prescribed marker
(`[DERIVED-FROM: …; independent of TBD count]`), and it re-blocked *harder* — the marker text
contains "TBD" and "count", so the line that RESOLVES an uncertainty registered as a fresh one.
A remedy that provably cannot succeed is a defect in the checker, not a phrasing problem.

The tell that separates this from hill-climbing: you stopped after one attempt and the failure
was **structural and demonstrable** (the documented escape hatch is self-defeating), not "the
matcher still doesn't like my wording."

**How to apply:** surface it to the user with the evidence and offer fixing the heuristic as an
option — harness infra is their call, never a unilateral edit to make your own block go away.
If they approve, fix the detection logic and **mutation-test each fix** (revert it; the matching
test must fail) plus one test asserting the genuine invariant still blocks, so the guard is
narrowed rather than disarmed. Do not weaken a guard you merely find inconvenient — this applies
only when the block is provably wrong on sound content.
