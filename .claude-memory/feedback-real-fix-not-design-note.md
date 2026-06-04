---
name: feedback-real-fix-not-design-note
description: When a real correctness issue is found, do NOT default to "design-note" / "acceptable for pilot" / "last-writer-wins is fine" framing. Propose the actual fix and its cost honestly; let the user decide. The default should be "fix it" unless the fix is genuinely prohibitive.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S184 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: external review (Codex, code-reviewer, etc.) surfaces a real correctness issue and my first instinct is to document/accept it ("fine for pilot").

Do:
- Compute the actual cost of the fix and surface BOTH options (fix vs accept) for the user to decide.
- Default to "fix it" when the fix lives at the genuinely race-safe layer (e.g. SQL UPDATE WHERE), unless cost is prohibitive (>2h cross-contract).

Do not:
- Unilaterally call a fixable correctness gap "acceptable" because the fix has cost.
- Treat "we have N defensive checks already" as safety when none is race-safe at the persistence layer.
- Wave through trigger phrases: "acceptable for pilot", "last-writer-wins is fine", "the race window is narrow".

Ground truth: historical-only (lesson, not live state). Related: [[feedback-thoroughness-default]], [[feedback-surface-full-review-findings]].

When external review (Codex, code-reviewer, etc.) surfaces a real
correctness issue, my default response should be **"here's the fix
and its cost"**, NOT **"I documented the limitation"**.

**Why:** This happened in S184 chunk 5. Codex caught a TOCTOU race
in the cardinality gate (two concurrent `/attach` calls could both
pass an in-endpoint check and both `promoteToClean`, landing
`attachments[]` past cap). I framed it as: "the race is real but
acceptable for pilot, I'll document it." User pushed back with
**"Why a design-note and not a fix?"** — the fix turned out to be
60-90 min of focused work (SQL-level cardinality gate in
`promoteToClean`'s UPDATE WHERE, plus rippling the new arg through
chunk 3, chunk 5, tests, and design docs). Codex confirmed afterward
that the SQL gate was the only race-safe layer; my "two TOCTOU
checks = defense in depth" reasoning was a cop-out.

The pattern I'd been falling into: framing a fixable correctness gap
as "tolerable" because the fix has cost (touching multiple commits,
re-running tests, etc.). The honest framing is the cost + the user's
choice — not a unilateral "it's acceptable."

**How to apply:**
1. When external review surfaces a correctness issue and my first
   instinct is "this is fine for the pilot": stop. Compute the actual
   cost of the fix. Surface BOTH options to the user — fix vs accept
   — with the cost line and what makes the fix non-trivial.
2. If the fix exists at the architectural layer that's actually
   race-safe (SQL UPDATE WHERE rather than app-level read-then-check),
   default to "fix it" unless the cost is genuinely prohibitive
   (>2 hours of touching cross-chunk contract changes).
3. Treat "we have N defensive checks already" as a yellow flag.
   Defense in depth is real, but if NONE of the N checks is actually
   race-safe at the persistence layer, more app-level checks don't
   help.
4. Phrases that should trigger self-review: "acceptable for pilot",
   "last-writer-wins is fine", "the race window is narrow", "submit-
   strict catches it later". Each of these may be true, but they're
   the signals that the fix is real and I'm rationalizing skipping it.

Related: [[feedback-thoroughness-default]],
[[project-codex-design-pre-impl-iteration]],
[[feedback-surface-full-review-findings]].
