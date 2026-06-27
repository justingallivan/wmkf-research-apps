---
name: feedback-apply-reconcile-to-fix-work
description: Reconcile and cite-ground-truth rules apply to fix work as much as first drafts. Each folded review finding creates new claims that need source checks, contradiction checks, and restatement greps.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S196 via memory-content (not re-probed 2026-06-04)
---

## Recall Trigger

Read this when folding code-review, Codex, or audit findings into a plan, doc,
memory, or partly-correct artifact.

## Expert Procedure

- Treat each fix as original work that can introduce new unverified claims.
- Probe or grep every claim about external state before writing it.
- Re-read any step list under a newly introduced principle and confirm the steps
  follow the principle.
- Grep touched files and related docs for restatements of each fact changed.
- Prefer plain language over tables when a claim is not verified; structure
  should reflect evidence, not substitute for it.

## Evidence Required

- Cite source/probe evidence for each new state claim.
- List grep terms used to find restatements.
- Before declaring fold-in complete, confirm no touched restatement contradicts
  the new version.

## Related Rules

- Related memories: `feedback-reconcile-dont-append-docs.md`,
  `feedback-cite-ground-truth.md`,
  `feedback-verify-external-platform-claims.md`,
  `feedback-thoroughness-default.md`.
- Maintainer rationale:
  `.claude-memory/rationale/feedback-apply-reconcile-to-fix-work.md`.
