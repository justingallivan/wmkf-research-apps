---
title: Scheduled grantee reminder defaults and recovery — release verification
domain: workbench
kind: audit
status: active
summary: "PR #531 released as 6a37ea105 after full CI and independent Claude review. Production READY, authenticated defaults load and discard warning verified; no live preference writes, sends or database work."
owner: product-engineering
related:
  - docs/audits/SCHEDULED_GRANTEE_RECOVERY_GAP_FIX_2026-10-25.md
  - docs/audits/SCHEDULED_GRANTEE_RECOVERY_GAP_CLAUDE_REVIEW_2026-10-25.md
  - docs/plans/PERSONAL_EMAIL_SCHEDULED_GRANTEE_DEFAULTS_PLAN_2026-10-25.md
---

# Release verification — October 25 Pacific; closeout October 26

[VERIFIED via GitHub checks/merge, Vercel deployment API and signed-in Chrome UI.]
Justin explicitly authorized release once CI passed. All checks on exact head
`1ddba376864959bc6a8ec0553baafd013a156ee5` passed before merge.
[PR #531](https://github.com/justingallivan/wmkf-research-apps/pull/531) merged at
2026-10-26T04:27:51Z (October 25 Pacific), commit
`6a37ea105e638702e025beccfd203fcb9d42c4bb`.

## Reviewed source and integration

Independent ordinary subscription-OAuth Claude reviews passed with nonblocking
notes. Initial implementation findings 1–7 were closed at `7a84a274a`; recovery
finding N1 was reproduced/fixed and independently closed at `17f1969d2`. Subsequent
changes were tests/documentation only. The released feature runtime paths compare
identically to `17f1969d2` using git diff. The source trace, intentional interrupted-
recovery availability tradeoff and nonblocking notes remain in the linked fix audit.

The tested PR merge included main `ae25d67dc8ae0f1b7a3ecad879cba193f85062e5`.
Git ancestry verifies that all preceding corpus/database-work commits are retained.
Only this isolated worktree was operated; Claude's checkout, migrations, database
state and environment were untouched.

## CI and local evidence

GitHub Tests run 40268300377 passed **1476 suites / 25585 tests**, with 22 suites /
295 tests skipped. Isolated PostgreSQL 16 job passed **10 suites / 149 tests**.
Playwright run 40268300367, security scans, CodeQL, ordinary automated Claude check
and Vercel preview all passed on the exact final feature head. Types, build and
repository gates are part of the passing run. Local recovery proof separately
passed 47 SQL engine tests and 125 focused unit tests; initial defaults proof passed
383 tests, 33 SQL cases and six fixture Chromium navigation cases. Local SQL was
only a task-owned disposable instance, now stopped; no shared database was queried.

## Production verification

| Claim | Evidence | Status |
| --- | --- | --- |
| Exact production source | Deployment API metadata githubCommitSha 6a37ea105 | VERIFIED |
| Release deployment | dpl_F6JoDbXQc5UsEmj3WzFHgC6LLcxt, target production, READY | VERIFIED |
| Canonical serving alias | applications.wmkeck.org assigned to released deployment | VERIFIED |
| Authenticated consumer | Reloaded scheduled-emails after READY; new Your default wording disclosure present; exact-owner GET loaded shared raw wording and required placeholders | VERIFIED |
| Editor state | Subject/body editable, Save enabled, Clear disabled for absent own preference; current stopped message retained version 2 and its content | VERIFIED |
| Discard warning | Local-only default-subject edit followed by Home navigation opened Discard your unsaved default wording? | VERIFIED |
| Navigation cancellation / fresh reload after warning | Browser connection stalled during dialog follow-up; no successful cancellation/reopen assertion made | UNKNOWN in live smoke; fixture browser tests cover this |
| Unauthenticated guard | GET preference endpoint redirected 307 to sign-in with no-store, max-age=0 | VERIFIED proxy guard; not a route 401 claim |
| Runtime errors | Exact-deployment level:error scan 04:27:51Z–04:30:22.507Z returned 0 records, no excluded intervals or more pages | VERIFIED for bounded window |

Immutable release URL:
`https://wmkfresearchapps-lslrc6lid-justin-gallivans-projects.vercel.app`.
A later read of the canonical deployment still returned this exact READY deployment.
The verification browser connection stalled after the warning appeared; this did
not interrupt the release or its deployment. No Save/Clear, review toggle, row
mutation, real send, cron invocation, token mint, migration, seed or environment
edit was performed. No live mutation acceptance, reassignment or inbox delivery
is claimed; those paths have fixture/local-SQL evidence above.

## Rollback

Last known good before merge: main `ae25d67dc8ae0f1b7a3ecad879cba193f85062e5`,
READY production deployment `dpl_3ZnwPpXEsF4zvkm6NVunq9bc4tK6`, URL
`https://wmkfresearchapps-k7jyafpwp-justin-gallivans-projects.vercel.app`.
If needed, promote that existing deployment in project wmkf_research_apps, scope
justin-gallivans-projects. No schema change requires reversal; code rollback does
not undo any mail or preferences created by normal production use. Rollback was
not executed. The release receipt is documentation only and does not alter runtime.

## Bounded sweep / coordination handoff

Mode A: scheduled reminder slice 5 is released, replacing its branch-only status.
Current plan, TODO/inventory, route matrix, ledger Atlas, service catalog and
VIP/digest plan are updated; current recovery audit and historical build receipt
link here. Plan/implementation review reports remain verbatim historical receipts.
Source→existing preferences→creation/handoff→existing ledger→guarded delivery /
read-only recovery→UI/digest is covered by the build/fix audits; this receipt adds
exact-head CI, deployment and authenticated read-only consumer evidence. The
falsification checks were exact runtime diff, deployment commit/alias and live
GET/UI load; none contradicted release status. Relevant doc gates/self-tests and
secret scan are run before the documentation-only closeout commit.

Owner: Codex. Runtime release commit 6a37ea105. Next action: ordinary staff use;
Duncan/Connor decisions and Claude's database/corpus work remain separate. Live
write/inbox behavior remains UNKNOWN, intentionally outside this verification.
