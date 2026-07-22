---
name: project-commit-directly-to-main
description: "Historical direct-main convention superseded by a campaign-aware risk tier: low-risk work may land on main, while production-sensitive changes use a branch and deliberate promotion"
type: project
status: active
scope: git-workflow
last_verified: 2026-07-09
metadata: 
  node_type: memory
  type: project
  originSessionId: 6abd9b3c-dcfa-4228-b8f3-e277128aaeae
---

## Recall Rule

Read before choosing a branch or pushing `main`. Apply the risk tier in
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`; a `main` push is a
production release, not a preservation step. `[VERIFIED via current repo release contract]`

The old convention was to **commit directly to `main` and push**. That is now
superseded by the risk-tiered workflow in
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` because `main` auto-deploys
to production and campaign-critical changes need rehearsal and rollback evidence.

**Why the old memory existed:** The harness has a generic built-in instruction —
"Commit or push only when the user asks. If on the default branch, branch first."
That did not match the project's former direct-main convention. It still is not the
literal rule: the project now chooses the workflow from production risk, rather
than branching every change or committing every change directly to `main`.

**How to apply:**

- Tier 0 documentation/tests/isolated maintenance may still commit directly to
  `main` when the user asks, subject to campaign freeze posture.
- Tier 1 contained runtime work uses a short-lived branch by default.
- Tier 2/3 auth, Dataverse, email, external-user, migration, background, or broad
  refactor work uses a branch/worktree, rehearsal, rollback record, and deliberate
  promotion to `main`.
- A push to `main` is a production release action. Do not push it merely to preserve
  work; push the feature branch instead.

The historical lesson remains valid: do not recite a generic branch rule as though
it were project policy. Apply the project-specific risk tier and state why.
