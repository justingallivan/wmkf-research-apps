---
name: feedback-merge-to-main-from-temp-worktree
description: When main is checked out in another session's worktree, merge an owner-approved branch in a temporary detached worktree of origin/main, test the merge, then push; `git push origin HEAD:main` may be blocked by the auto-mode classifier, so hand the owner the exact push command (S597, 2026-10-12).
metadata:
  type: feedback
status: active
---

## Recall Rule
Read before merging a branch into `main` or landing session docs on `main`.

Do: run merge steps as separate plain commands (a chained `cd … && … | …` command missed the
`Bash(git merge *)`/`Bash(git push:*)` allow rules and went to the classifier). If `git checkout main`
fails because `main` is checked out in another worktree (another session's), do not use that worktree:
`git worktree add --detach <tmp> origin/main`, `git -C <tmp> merge --no-ff <branch>`, run the tests there
(symlink `node_modules` for jest), push, then apply the Preservation preflight in
`docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md` before removing the temporary worktree.
These merge steps apply to an owner-approved runtime release. For a docs-only
handoff, follow `.claude/skills/stop/SKILL.md`: prepare only the handoff changes on
an isolated docs branch or authorized checkout; do not merge the runtime branch.

Do not: retry a push the classifier blocked, or work around it. Give the owner
`! git -C <repo> push origin <merge-sha>:main`; the merge commit survives worktree removal.

**Why:** S597. The owner's `autoMode.allow` rule (in `~/.claude/settings.json`) describes "running
`git push origin main`" after an owner says to merge. From a temporary worktree, `git push origin HEAD:main`
went through once and was blocked as "[Production Deploy]" the second time, so the rule does not reliably
cover that form. A failed `git checkout main` also left later commands running on the feature branch
(harmless that time); check the branch after every checkout.

**How to apply:** after `git fetch`, check whether `main` moved (`git rev-list --count <branch>..origin/main`);
if it did, test the merged tree before pushing. Then confirm the deploy per
[[feedback-verify-deploy-is-the-merge-build]] and [[feedback-deployment-monitoring-use-inspect]].
