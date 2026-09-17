---
name: feedback-feature-branch-handoff-lands-on-main
description: When a session ends mid-feature on a Tier 1-3 branch, push the branch AND land the SESSION_PROMPT handoff banner on main, so /start on another Mac finds the work without knowing the branch name.
metadata:
  type: feedback
  status: active
  last_verified: 2026-09-16 (S515)
---

## Recall Rule
Read at /stop whenever HEAD is not on `main`.

Owner asked (2026-09-16, S515): "Will the feature branch be available on a different
machine later after I run the start skill?" — only if pushed, and `/start` on `main`
pulls `main`, which will not show branch work. The owner chose **both**: push the
feature branch with its upstream, and put a docs-only commit on `main` carrying the
`SESSION_PROMPT.md` banner that names the branch and the resume section.

**Why:** the multi-Mac workflow relies on `/start` reading `SESSION_PROMPT.md` from
`main`; a handoff that lives only on the branch is invisible until someone remembers
the branch name. Build commits stay on the branch (Tier 1-3); the banner is Tier 0.

**How to apply:** at `/stop` off `main`: (1) push the branch (`-u`); (2) `git checkout
main`, write the banner + session docs, commit, push; (3) checkout the branch again if
work continues. Never cherry-pick build commits to `main`. See
[[feedback-verify-branch-before-git-action]].
