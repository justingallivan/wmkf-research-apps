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

**Update 2026-07-08 (S348):** the *feature* these docs describe shipped independently —
the reviewer-acceptance fast-response drain is on `main` (commit `a3103b3c`, 2026-07-02:
migration `024_reviewer_acceptance_jobs.sql` + `lib/services/reviewer-acceptance-{drain,email,job-service}.js`
+ `pages/api/cron/drain-reviewer-acceptances.js`). So `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md`
is now mostly a historical design record; `REVIEWER_QUOTA_PD_EMAIL_PLAN.md` may still be an
unbuilt plan (recover for the rationale). The user re-sighted commit `370f3867` on the work
computer 2026-07-08 and confirmed it is still **unpushed** (re-verified absent here:
`git cat-file -t 370f3867` fails; not on origin, not in any dangling commit).

**Recovery — ONE command on the work computer** (the hash is known, so no branch hunt):
```bash
git push origin 370f3867:refs/heads/codex/spec-audit
```
(If that hash errors, fall back: `git branch -a | grep spec-audit` /
`git fsck --full | grep 'dangling commit'` then push the found hash.)

Once pushed, fetch here, review, and `git merge --no-ff codex/spec-audit` (docs-only,
low-risk). Do NOT reconstruct the docs from scratch and do NOT re-run the local search
before the branch is pushed. See [[feedback-dont-resurface-parked-items]] and
[[feedback-commit-before-delegating-to-worktree-agent]] (the near-miss: unpushed
worktree commits are recoverable only from the machine that made them).
