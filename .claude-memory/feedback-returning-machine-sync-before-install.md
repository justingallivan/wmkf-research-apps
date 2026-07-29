---
name: feedback-returning-machine-sync-before-install
description: On a returning machine, sync the repo before installing deps; never npm audit fix --force here
metadata:
  node_type: memory
  type: feedback
  status: active
  scope: dev-env
  last_verified: 2026-07-29 via ~/.bash_history lines 305-352, .git birth date, and isolated lockfile audits
---

## Recall Rule

Read this when: writing multi-machine handoff instructions, or when a machine
that has been idle reports `npm audit` vulnerabilities, `npm ci`/`npm install`
trouble, or an out-of-date checkout.

Do:
- On a machine returning after time away, run `/start` (which syncs) FIRST, then
  `npm ci`. Ordering install before sync audits stale dependency versions.
- Treat a nonzero `npm audit` after an absence as a staleness symptom, not a
  work item — check `git status -sb` against `origin/main` before acting.

Do not:
- Run `npm audit fix --force` in this repo. It resolves advisories by
  DOWNGRADING to ancient majors that carry their own advisories, so each run
  appears to surface more problems.
- Write handoffs that tell a machine to `git clone` into a path that already
  holds a checkout. Git refuses a non-empty destination
  (`fatal: destination path ... already exists and is not an empty directory`),
  so the operator improvises — typically a bare clone that nests a second repo
  inside the first.

**Why:** Session 386 (2026-07-29). The Session 386 handoff assumed the office
machine needed a fresh clone; that checkout had existed since 2026-05-27 with
local commits through 2026-07-09. The clone therefore ran with no destination
from inside `~/Code/WMKF_Apps` and nested at `wmkf-research-apps/`, while
`npm install` ran in the outer STALE tree. Its Session-351-era lockfile audited
to 14 vulnerabilities (1 critical, 8 high); `npm audit fix --force` ran 11 times,
downgrading `exceljs` 4.4.0→3.4.0 and `eslint-config-next` 16.2.12→0.2.4. The
same lockfile at `origin/main` audited to **0 vulnerabilities** — 364 commits of
upstream updates had already fixed every finding. Syncing was the entire fix.

**How to apply:** For a returning machine the sequence is `/start` → `npm ci`.
No clone. If a handoff says otherwise, correct it. Verify a stale-vs-synced
audit claim by extracting both lockfiles to a scratch dir and running
`npm audit --package-lock-only` on each, rather than trusting the advisory count
in the working tree.

Prior art that already knew this but was not reachable from the startup path:
`docs/security-audit/SECURITY_AUDIT_2026-06-11.md` lines 247 and 279 warned that
`npm audit fix --force` "proposed breaking/downgrade-like changes" and named
`exceljs` as needing deliberate update review — 7 weeks before `exceljs` was in
fact force-downgraded. Guidance buried in an audit doc does not fire at the
moment of need; that is why this lives in the memory router.

Ground truth: [VERIFIED 2026-07-29 via `~/.bash_history`,
`git reflog --date=iso`, `stat -f %SB .git`, and isolated lockfile audits];
cross-refs [[project-dev-environment]], [[feedback-verify-branch-before-git-action]].
