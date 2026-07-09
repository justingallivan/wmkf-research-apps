---
name: project-spec-audit-docs-recovery-parked
description: RESOLVED 2026-07-09 (S350) — the two codex/spec-audit design docs were cherry-picked to main (1420d79c); recovery is done, do not re-search work computer
metadata:
  type: project
status: closed
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

**RESOLVED 2026-07-09 (S350).** The user cherry-picked both docs to `main` from the
work computer — commit `1420d79c` "Add reviewer accept-fast-response + quota PD-email
design docs". `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md` and `REVIEWER_QUOTA_PD_EMAIL_PLAN.md`
are now present in `docs/`. Recovery is done; do NOT re-search the work computer or push
`370f3867`.

Post-recovery reconcile (S350): `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md` was verified
against live source and confirmed **shipped** (reviewer_acceptance_jobs queue + drain;
built with the stricter insert-before-PATCH variant; optional client-only transition NOT
adopted). Its frontmatter stays `status: active` with a "Status: Shipped" reconciliation
block recording the deltas. `REVIEWER_QUOTA_PD_EMAIL_PLAN.md` was recovered but NOT yet
verified built-vs-plan — treat its build status as unconfirmed until checked.

Lesson retained: unpushed worktree commits are recoverable only from the machine that made
them. See [[feedback-dont-resurface-parked-items]] and
[[feedback-commit-before-delegating-to-worktree-agent]].
