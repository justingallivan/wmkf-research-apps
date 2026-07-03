---
name: project-spec-audit-docs-recovery-parked
description: Codex codex/spec-audit design docs exist ONLY on the work computer (unpushed); recover after ~2026-07-08, do not re-search local/origin
metadata:
  type: project
status: active
---

The `codex/spec-audit` branch (commit was cited as `370f3867` in the S318 handoff)
holds two design docs plus a catalog entry — filenames `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md`
and `REVIEWER_QUOTA_PD_EMAIL_PLAN.md`, both absent/unbuilt in this checkout (they live
only on the work computer). SESSION_PROMPT #3 described the branch as ready-to-merge in
`../WMKF_Apps-codex`. **That is false on this machine.**

**Verified 2026-07-02 (S318):** the branch, the commit object, and both docs are
absent everywhere reachable from this checkout — `git branch -a`, `git reflog --all`,
`git ls-remote origin`, and all 12 `git fsck` dangling commits (all old WIP stashes).
The decisive tell: this machine's Codex worktree reflog
(`.git/worktrees/WMKF_Apps-codex/logs/HEAD`) ends at S313 (memory-hygiene) and never
shows `spec-audit`. The spec-audit work was committed on the user's **work computer**
and never pushed, so it is unreachable from here.

**Recovery (must run ON the work computer; user gated until ~2026-07-08):**
1. `git branch -a | grep spec-audit` → if present, `git push origin codex/spec-audit`.
2. If the ref is gone, the commit is likely dangling:
   `git reflog --all | grep -iE 'spec-audit|370f3867'` /
   `git fsck --full | grep 'dangling commit'`, then
   `git show --stat <c> | grep -i 'REVIEWER_ACCEPT_FAST\|REVIEWER_QUOTA_PD'`.
3. `git branch codex/spec-audit <hash> && git push origin codex/spec-audit`.

Once pushed, fetch here, review, and `git merge --no-ff codex/spec-audit` (docs-only,
low-risk). Do NOT reconstruct the docs from scratch and do NOT re-run the local search
before the branch is pushed. See [[feedback-dont-resurface-parked-items]] and
[[feedback-commit-before-delegating-to-worktree-agent]] (the near-miss: unpushed
worktree commits are recoverable only from the machine that made them).
