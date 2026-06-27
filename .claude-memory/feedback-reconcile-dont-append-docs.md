---
name: feedback_reconcile_dont_append_docs
description: When updating a long-lived design/state doc, reconcile the whole doc to one consistent state. Registered code-derived scalars are gated by `check:fact-consistency`.
metadata:
  type: feedback
  status: active
  scope: docs
  last_verified: 2026-06-04 (S219) — reinforced with the read-WHOLE-file lesson + PreToolUse hook
---

## Recall Trigger

Read this when updating a long-lived design/state doc, Atlas page,
SESSION_PROMPT, or memory entry with a new decision, finding, status, or
current-state claim.

## Expert Procedure

- Read the entire target file before editing a fact, status, or claim.
- Reconcile frontmatter, summaries, body text, lead-ins, tails, linked docs, and
  recall rules in the same pass.
- Grep the repo for every restatement of the changed fact.
- Prefer rewriting a stale block over appending a new correction beside old text.
- For registered code-derived scalars, run `npm run check:fact-consistency`.
- For broader fact-level reconciliation, use `/sweep`.

## Evidence Required

- Cite the whole-file read target and the grep terms used.
- Report the relevant gate output before declaring a fact-level edit complete.
- Add a `CANONICAL_FACTS` entry and self-test fixture when a new drift-prone
  code-derived scalar becomes operationally important.

## Related Rules

- Hook: `.claude/hooks/doc-edit-reconcile-reminder.js`.
- Skill: `.claude/skills/sweep/SKILL.md`.
- Related memories: `feedback-apply-reconcile-to-fix-work.md`,
  `feedback-red-gates-are-p0.md`, `feedback-surface-full-review-findings.md`.
- Maintainer rationale:
  `.claude-memory/rationale/feedback-reconcile-dont-append-docs.md`.
