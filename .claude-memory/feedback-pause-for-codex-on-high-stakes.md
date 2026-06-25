---
name: feedback-pause-for-codex-on-high-stakes
description: On high-stakes / colleague-facing / prod-deploying work, offer to consult Codex (plan AND/OR review) BEFORE solo-implementing — don't rush ahead and only review at the very end.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-06-24 (S286) — owner corrected me mid-task
---

The owner (S286) corrected me for rushing into a large solo implementation —
switching the reviewer-finder origination model to Opus 4.8 plus guardrails across
~9 files — without first asking whether we should consult Codex for planning or
review. I only reached for Codex review at the tail end, after the code was written.

**Why:** the reviewer/Workbench apps were in front of the owner's non-technical
colleagues for the FIRST time, and `main` auto-deploys to prod (local dev hits PROD
Dataverse). A visible failure could make colleagues lose confidence and push back on
the tools, potentially negating ~9 months of development. Against that downside, the
cost of a pre-implementation plan or an adversarial review is trivial — the review
should GATE the work, not trail it.

**How to apply:** when a task is colleague-facing, prod-deploying, or otherwise
high-stakes, PAUSE before writing code and explicitly offer to get Codex on the plan
and/or an adversarial review first. Default to ask-before-build, not
build-then-review-at-the-end, and scale the review intensity to the blast radius.
Related: [[project-codex-design-pre-impl-iteration]],
[[feedback-self-review-before-delegating-review]],
[[feedback-first-time-correctness-over-rework]], [[feedback-drive-to-completion]].
