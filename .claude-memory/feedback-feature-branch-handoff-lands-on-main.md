---
name: feedback-feature-branch-handoff-lands-on-main
description: Preserve the owner's cross-machine preference for a main handoff banner naming feature work; confirm the destination through /stop and coordinate an isolated docs landing without promoting runtime commits.
metadata:
  type: feedback
  status: active
  last_verified: 2026-10-22 via /stop and collaboration procedures; owner preference remains the dated S515 decision
---

## Recall Rule
Read at /stop whenever HEAD is not on `main`.

Historical owner decision (2026-09-16, S515): "Will the feature branch be available on a different
machine later after I run the start skill?" — only if pushed, and `/start` on `main`
pulls `main`, which will not show branch work. The owner chose **both**: push the
feature branch with its upstream, and put a docs-only commit on `main` carrying the
`SESSION_PROMPT.md` banner that names the branch and the resume section.

**Why:** the multi-Mac workflow relies on `/start` reading `SESSION_PROMPT.md` from
`main`; a handoff that lives only on the branch is invisible until someone remembers
the branch name. Build commits stay on the branch (Tier 1-3); the banner is Tier 0.

**How to apply:** follow `.claude/skills/stop/SKILL.md` to confirm where the
handoff belongs, using any destination already authorized in the session. Preserve
the feature branch on its own upstream. If a docs-only banner on `main` is chosen,
coordinate its file ownership and use an available, authorized checkout or an
isolated docs branch based on current `origin/main`; never take over another
session's worktree or switch its branch. Include only the handoff changes, not a
merge of the runtime feature branch. Recheck the destination branch before commit
and push. See [[feedback-verify-branch-before-git-action]] and
[[feedback-merge-to-main-from-temp-worktree]].
