# Session 659 Prompt: Integrity work complete; await next owner-selected task

## Session 658 Summary — Codex, 2026-11-02 Pacific

[VERIFIED via merged PRs and production receipts] Integrity screening accuracy,
managed Retraction Watch refresh, monthly activation and the manual-only PubPeer
policy are complete. Justin requested stop and disposal of this session's isolated
worktree. Documentation lands on main through a docs-only closeout branch;
no runtime promotion, provider call, database write or new backlog implementation
is part of this closeout.

### What Was Completed

1. **Screening accuracy — PR #604, merge b95a6f04c.** Conflicting given/middle
   names are excluded; retained name candidates explicitly remain identity-unverified.
   Matching, source reporting, history and exports were Fable-reviewed and tested.
2. **Managed reference data — migration 092 and first publication.** Canonical
   migration runner applied 092; scoped backup/local restore was verified before
   publication. Owner-approved first refresh produced 73,521 rows: 73,519 upstream
   plus two narrowly retained legacy records (13045/67801) with explicit notice,
   backup and payload provenance. Initial generation 1; completed audit 282049.
   Exact checksums and production readbacks are in the release receipt.
3. **Monthly refresh — PR #605, merge c7f6b4370.** Production registry was verified
   at 0 6 1 * * (the 1st at 06:00 UTC), with Production enablement on. The first
   scheduled run is December 1, 2026 at 06:00 UTC / November 30 at 10 p.m. PST;
   it has not yet been observed. No automatic applicant screening is scheduled.
4. **Manual-only PubPeer — PR #607, merge 431a71888.** Owner declines paid access.
   Automated Google PubPeer searches and Claude PubPeer analysis are removed.
   Both screens, help, app card and PDF/Markdown/JSON show the manual link and
   Not checked automatically; opening it records no check. Policy version 3
   requires successful automated Retraction Watch/news plus existing roster and
   reviewer authority checks. Old version-1/2 evidence/decisions retain their rules;
   older unapproved runs need a new screen. No schema/history rewrite.
5. **Live validation.** Owner approved Claude/SerpAPI credits to rerun request
   1002852. Saved screening 68 verifies policy 3, recorded dataset generation 1,
   successful automated sources and manual-only PubPeer. Owner subsequently
   reported recording staff approval. This session did not record an approval,
   hold or dismissal. No namesake match was converted into verified identity.
6. **Workflow boundary.** Source/caller audit confirmed Integrity approval checks
   apply to recording an Integrity disposition; no downstream progression/funding
   gate consumes them. Monthly corpus refresh alone does not revoke a saved approval.

### Commits and Evidence

- PR #604 / b95a6f04c — accuracy, controlled refresh and retained provenance.
- PR #605 / c7f6b4370; 6e00a10a7 — monthly activation and verified receipt.
- PR #607 / 431a71888; 45814e16a — manual-only policy and deployed Fable closure.
- Final Fable closure: READY TO MERGE after the P2 help/app-card correction;
  OAuth-only read-only review, no API-key agent authentication or metered review.
- Final manual-policy verification: 166 focused tests / 10 suites, 4 isolated
  real-Postgres review tests, all PR checks green, Ready production deployment
  dpl_EMb1sWckL9wCyvpL3gzw3ce571TX at the exact PR #607 merge SHA. Subsequent
  docs-only reconciliation did not change the runtime. Production readback proved
  the same 73,521-row hash/provenance and active monthly schedule.

## Next Items

### Verified Open

None required for this Integrity task. Do not start new work during closeout.
The first future monthly execution remains unobserved; inspect its maintenance
receipt if the owner asks about it, rather than claiming scheduled execution passed.

### Parked — requires a new owner request

- ORCID/publication/coauthor-grounded identity matching for common names.
- Durable different-person dismissals. Existing standalone dismissal UI remains
  a placeholder; do not claim reviewed namesakes are suppressed in future screens.
Evidence: current matching/UI source and the manual-policy review receipt.

### Do Not Reopen Without New Decision

- No paid PubPeer subscription, undocumented endpoint or extension-key reuse.
  June correspondence offered paid DOI/author APIs and limited trial access;
  the old no-sanctioned-API claim is superseded. Owner chose manual-only.
- No automatic re-screen, staff disposition, historical rewrite or new provider
  spend. The completed request-specific credit approval is not blanket authority.
- Do not add an Integrity funding/progression gate.

## Concurrent Streams — preserve ownership, verify before acting

The complete preceding Session 657/658 handoff is retrievable at
`git show 997d395a4:SESSION_PROMPT.md` (verified during closeout). It preserves
terminology acceptance limits, local-only colleague-brief artifacts, old queue
pointers and other agents' boundaries. These are dated resume evidence, not a new
worklist or transferable production-write authorization.

| Owner / stream | Current routing and preservation boundary |
| --- | --- |
| Claude / shared prompts | PR #606 is merged; 997d395a4 records the subsequent 40-row catalog backfill. Owning record: docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md. Recheck source/live state with its owner; do not revive superseded plug-in/Windows-registration directions or treat the old PR #553 branch as current authority. |
| Claude / reviewer outcomes and invitations | Existing owning plans: docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md and docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md. Current open/closed items were not re-audited here. Coordinate before edits or sends. |
| Codex / terminology | Merged slices and bounded verifier; preceding handoff and docs/audits/terminology-completion-audit-2026-11-01.md retain acceptance limits. Local colleague-brief output is not Git-backed; leave it untouched. |
| Other streams | Preserve their worktrees, owning plans and queue decisions. No reprioritization or cleanup authority for another agent's artifacts. |

## Key Files and Recovery

| Path | Purpose |
| --- | --- |
| docs/audits/integrity-production-release-2026-11-02.md | Migration, backup, dry-run and approved first publication receipts |
| docs/audits/integrity-monthly-activation-2026-11-02.md | Fable/CI/deployment/live cron verification |
| docs/audits/integrity-pubpeer-manual-2026-11-02.md | Policy contract, tests, Fable closure and deployed status |
| docs/guides/RETRACTION_WATCH_REFRESH.md | Controlled refresh/uncertain-commit/recovery operating contract |
| docs/agent-wiki/topics/integrity-screener.md | Current retrieval routing and PubPeer owner decision |

The verified scoped backup remains outside the disposable worktree at
`/Users/gallivan/Code/WMKF_Apps/.integrity-backups/2026-11-02-pre-refresh/`.
It is private, ignored and not Git-synced. Preserve it; no production restore is
authorized. Restoring must keep corpus and publication metadata coherent under
the writer lock; never replay the raw dump into a running app.

## Stop and Worktree Preservation

[VERIFIED before cleanup] Feature work is merged and pushed. The clean worktree
`/private/tmp/wmkf-integrity-screening` has no local-only commits or unexplained
untracked files. Inventoried ignored residuals are node_modules, .next, .swc,
generated app/.well-known/workflow files, .agents/skills and the .env.local symlink
back to the main checkout. These are disposable session setup/build artifacts;
removing the symlink must not remove its target. The external backup, main output
artifacts, other agents' worktrees and unrelated dirty main files remain untouched.
Cleanup completion is recorded in the final chat after Git verifies removal.

Milestone determination: required and added to DEVELOPMENT_LOG.md for managed
Retraction Watch production cutover and retirement of automated PubPeer access.
No CLAUDE.md or skill/instruction change is needed. Claim-evidence pilot report
was attempted; local observation state could not be read, so no observation row
or zero-advisory result was invented. Closeout documentation gates and push must
pass before disposal; prior runtime checks are dated receipts, not rerun by stop.
