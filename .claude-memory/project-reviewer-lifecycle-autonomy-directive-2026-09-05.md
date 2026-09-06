---
name: project-reviewer-lifecycle-autonomy-directive-2026-09-05
description: Owner directive (2026-09-05 evening): after the follow-up fix, 6C and 6D land, keep building lifecycle Stages 2, 3, 5, then 7 (skip 4) autonomously with the plan→Sonnet build→Opus review→Codex (≤2 rounds) cycle; grace period is now, not next cycle; stop only when stuck.
metadata:
  type: project
  status: active
---

On 2026-09-05 (Session 489, evening) Justin granted autonomy for the remaining reviewer
lifecycle work: "Once the current tasks land, keep working on the next items in the queue
(2-5, then 7)." Rationale in his words: two cycles a year, so anything not surfaced now
"will come back to bite us when we've forgotten about it"; the team will be "given more
grace now while we're starting out" than in a few months when colleagues expect a better
experience. "If you are stuck, feel free to stop. Otherwise, I'll check on your progress
in the morning."

**Why:** The architect had pushed back that Stages 2/3/5/7 are internal writer-boundary
moves with no observed defect and that promotion during the D26 review window was risky.
The owner weighed that and chose to build now. Stage 4 remains skipped (audit: benefit not
established).

**How to apply:** Operating cycle per stage: architect plan (with contract-reconcile for
anything touching routes/services/persistence) → Sonnet builds on a fresh branch from main
→ Opus independent review → Codex adversarial, at most two rounds as a stopping rule →
PR. Try `gh pr merge`; if the permission classifier blocks it, leave the PR green for the
owner and cut the next stage so it stacks. Record each stage in its receipt and the
readiness audit. Stop and report if a stage hits the Codex cap without converging or a
decision is genuinely the owner's. Architect took the 6D uniform-enforcement decision
under this grant (both reviewers recommended it); flagged for morning review. See
[[project-accepted-awaiting-materials-is-transient]] and the readiness audit
`docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md`.
