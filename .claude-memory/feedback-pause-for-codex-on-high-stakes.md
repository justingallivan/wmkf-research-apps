---
name: feedback-pause-for-codex-on-high-stakes
description: On high-stakes / colleague-facing / prod-deploying work, offer to consult Codex (plan AND/OR review) BEFORE solo-implementing — don't rush ahead and only review at the very end.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-06-24 (S286) — owner corrected me mid-task
---

## Recall Rule

Before high-blast-radius, colleague-facing, or production-deploying work, offer an
independent planning/review pass and scale it to the risk before implementation.

[VERIFIED historically via S286 owner feedback.] The named application and file
count below are incident context, not a current deployment-state claim.

The owner (S286) corrected me for rushing into a large solo implementation —
switching the reviewer-finder origination model to Opus 4.8 plus guardrails across
~9 files — without first asking whether we should consult Codex for planning or
review. I only reached for Codex review at the tail end, after the code was written.

**Historical context:** in S286 the reviewer/Workbench apps were being shown to
non-technical colleagues for the first time. At that time, `main` auto-deployed
to production and local development targeted production Dataverse, so the owner
judged a pre-implementation plan/review worth the cost. Re-check the current
release and data-target strategy before repeating those environment claims.

**How to apply:** when a task is colleague-facing, prod-deploying, or otherwise
high-stakes, PAUSE before writing code and explicitly offer to get Codex on the plan
and/or an adversarial review first. Default to ask-before-build, not
build-then-review-at-the-end, and scale the review intensity to the blast radius.
Related: [[project-codex-design-pre-impl-iteration]],
[[feedback-self-review-before-delegating-review]],
[[feedback-first-time-correctness-over-rework]], [[feedback-drive-to-completion]].
