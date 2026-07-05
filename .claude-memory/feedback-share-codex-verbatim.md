---
name: feedback-share-codex-verbatim
description: When a Codex review/rescue returns, the next user-facing reply is the full Codex stdout verbatim in a delimited block, with no paraphrase or framing before or after it.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S221 (2026-06-04) — PostToolUse hook added
---

## Recall Trigger

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

## Evidence Required

- The delivered block contains the complete Codex stdout, including line numbers,
  severity labels, footers, and usage details when present.
- Any subsequent fix work happens after the verbatim delivery turn.

## Related Rules

- Hook: `.claude/hooks/codex-verbatim-reminder.js`.
- Related memory: `feedback-surface-full-review-findings.md`.
- Maintainer rationale:
  `.claude-memory/rationale/feedback-share-codex-verbatim.md`.
