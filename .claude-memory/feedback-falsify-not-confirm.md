---
name: feedback-falsify-not-confirm
description: "For any scope/quantity claim, run the disconfirming query: search the complement set, derive denominators independently, never let a tool's default scan window stand as a claim about reality, and label unverifiable claims instead of over-stating them."
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: global
  last_verified: S377 via /doctor self-audit 2026-07-26 (two live failures reproduced and corrected)
  originSessionId: 216e10b9-b505-4e68-a4eb-1559a471bea5
  modified: 2026-07-27T01:03:36.342Z
---

## Recall Trigger

Read this when preparing to assert a scope or quantity claim: only, all, none,
every, never, always, "the rest", "N of M", or "source of truth" — especially
in docs, memory, CLAUDE.md, SESSION_PROMPT.md, or user-facing summaries.

Also read it before any **usage, telemetry, or "unused / never used / X per Y"
verdict**, and before repeating any figure a tool handed back as a readout.
The S377 failures both came from *not* recognising a readout as a claim — the
numbers felt like observations, so no falsifier was run. Treat every verdict in
a report as load-bearing, not just the ones that sound like assertions.

## Expert Procedure

- Verify by searching for counterexamples.
- For "X only in Y" / all / none / the rest, search the complement set.
- For "N of M", derive M independently from N.
- For "X is the source of truth" / "X does Y", search for another source that
  does Y.
- **A scan window is never a claim about reality.** A default window (a skill's
  "last 50 transcripts", a 14-day slice, `head -n`) bounds the *search*, not the
  world. "Unused" requires searching full history; if full history is not
  searched, the claim is "no use within <stated window>", never "unused".
- **Check the denominator, and ask what the logging drops.** Before averaging a
  logged sample, find the population it came from and why the unlogged entries
  were excluded — selective persistence makes the survivors unrepresentative.
- **Measure rather than eyeball any number that drives a decision.** If a cost,
  size, or count is the basis for a recommendation, compute it from disk or
  command output.
- If no falsifying query is constructible, narrow the claim or label it
  `[ASSUMED]`.

## Evidence Required

- Cite the disconfirming query or command output.
- Name how any denominator was derived independently.
- State the scope alongside every usage claim (what was searched, over what
  range) so a window-bounded finding cannot be read as universal.
- Label unverifiable scope claims before they become durable text.

## Worked Failures (S377 `/doctor`, 2026-07-26)

Both were one cheap command from correct, and both were caught only because the
owner pushed back — the recurring complaint being hasty claims walked back under
questioning.

1. **Window mistaken for reality.** `claude-in-chrome` and the Vercel plugin were
   each called "unused" from a 14-day transcript window whose boundary fell just
   after real usage stopped. Full-history scans of all 506 transcripts found 202
   and 37 calls respectively. The same error was then repeated on Vercel *one
   message after* being corrected on chrome — proof that a one-off correction
   does not generalise without an explicit rule.
2. **Denominator never checked.** A UserPromptSubmit hook was reported as
   "1.4s on every prompt" from 40 logged runs. The window held ~229 prompts;
   Claude Code only persists hook runs that produce output, so the 40 were
   biased toward the slow working runs. Correct claim: ~1.4s on the ~17% of
   prompts the hook acts on.

## Related Rules

- Hook: `.claude/hooks/scope-claim-reminder.js`.
- Related memories: `feedback-apply-reconcile-to-fix-work.md`,
  `feedback-behavior-claims-cite-the-producer.md`.
- Maintainer rationale: `.claude-memory/rationale/feedback-falsify-not-confirm.md`.
