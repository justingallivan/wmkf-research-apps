---
name: feedback-share-codex-verbatim
description: When a Codex review/rescue returns, the next user-facing reply is the full Codex stdout verbatim in a delimited block, with no paraphrase or framing before or after it.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S221 (2026-06-04) — PostToolUse hook added
---

## Recall Rule

Read this when an `Agent(codex:codex-rescue)`, `/codex:rescue`, Codex review,
rescue, or diagnostic tool result returns — every round-trip. This explicitly
includes `/codex:review` and `/codex:adversarial-review`, which run
`codex-companion.mjs` directly via **Bash**, not through the Agent/Task tool —
`.claude/hooks/codex-verbatim-reminder.js` only matches `Agent`/`Task` calls
with `subagent_type: codex:*` and by design does NOT fire for a raw Bash
invocation. Confirmed missed live on 2026-07-05 (S333): an
`/codex:adversarial-review --wait` Bash call returned a real P1 finding, and
the next message paraphrased/summarized it instead of pasting verbatim — no
hook caught it because the tool was Bash, not Agent. Do not rely on the hook
for these two commands; apply the rule from memory alone.

## Expert Procedure

- Make the very next user-facing message the Codex stdout pasted whole in a
  clearly delimited block.
- Label the block as verbatim.
- Make that block the entire delivery message.
- Do not paraphrase, summarize, re-rank, drop footers, run verification, or add
  framing before the verbatim delivery.
- Fold catches, fixes, decisions, or follow-up questions in a later turn.

## A tool result is NOT a user-visible message (S413, 2026-08-10)

Running `codex-companion.mjs result <id>` puts the report in a **tool result**,
which the harness shows to the model but **not reliably to the user**. Writing
"that's Codex's report verbatim above" while the text exists only in that tool
result delivers nothing — the user sees commentary about a report they never
got. This happened twice in one turn before the user said "You didn't print the
report."

The failure is easy to miss precisely because the model CAN see the output, so
the turn feels complete from the inside. Reading it is not printing it.

**How to apply:** the verbatim block must appear in your own message text, typed
out, not referenced. Before writing any sentence like "above", "as returned", or
"see the output", ask: *did I paste those characters into a user-facing message
in this turn?* If the only place the text exists is a tool result, it has not
been delivered. This applies to the `result`/`status` fetch just as much as to
the launching call.

## Evidence Required

- The delivered block contains the complete Codex stdout, including line numbers,
  severity labels, footers, and usage details when present.
- Any subsequent fix work happens after the verbatim delivery turn.

## Related Rules

- Hook: `.claude/hooks/codex-verbatim-reminder.js`.
- Related memory: `feedback-surface-full-review-findings.md`.
- Maintainer rationale:
  `.claude-memory/rationale/feedback-share-codex-verbatim.md`.
