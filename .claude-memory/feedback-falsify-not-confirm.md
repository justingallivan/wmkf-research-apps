---
name: feedback-falsify-not-confirm
description: For any scope/quantity claim, run the disconfirming query: search the complement set, derive denominators independently, and label unverifiable claims instead of over-stating them.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S197 via memory-content (not re-probed 2026-06-04)
---

## Recall Trigger

Read this when preparing to assert a scope or quantity claim: only, all, none,
every, never, always, "the rest", "N of M", or "source of truth" — especially
in docs, memory, CLAUDE.md, SESSION_PROMPT.md, or user-facing summaries.

## Expert Procedure

- Verify by searching for counterexamples.
- For "X only in Y" / all / none / the rest, search the complement set.
- For "N of M", derive M independently from N.
- For "X is the source of truth" / "X does Y", search for another source that
  does Y.
- If no falsifying query is constructible, narrow the claim or label it
  `[ASSUMED]`.

## Evidence Required

- Cite the disconfirming query or command output.
- Name how any denominator was derived independently.
- Label unverifiable scope claims before they become durable text.

## Related Rules

- Hook: `.claude/hooks/scope-claim-reminder.js`.
- Related memories: `feedback-apply-reconcile-to-fix-work.md`,
  `feedback-behavior-claims-cite-the-producer.md`.
- Maintainer rationale: `.claude-memory/rationale/feedback-falsify-not-confirm.md`.
