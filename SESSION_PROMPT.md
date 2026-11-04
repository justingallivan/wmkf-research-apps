# Session 662 Prompt: Resume the J27 PD workflow discussion

## Session 661 Summary — Codex, 2026-11-03 Pacific

The prepared J27 Factory reviewer-test MVP completed its bounded Production
rehearsal. The owner chose to revisit the broader PD workflow next time; do not
begin that implementation before settling the workflow. This handoff lands on
`codex/factory-reviewer-rehearsal-proof`, not directly on main.

### What Was Completed

1. **Prepared fixture and guarded readiness.** PR #617 (`d3016b5da`) shipped
   prepared J27 Basic clones, separate guarded phase changes, owner-only
   journaled readiness and optional exact prior-GoVerify-PDF proof. Both managed
   ledgers have migration 094 and the 054+058+094 fingerprint. Power Automate
   continues to own readiness on real requests; apps do not directly set
   `akoya_requeststatus` for this workflow.
2. **Immutable test reviewer promotion.** PR #618 (`7054043ed`) shipped the
   explicit Add Factory reviewer to Invite action, preserving stored synthetic
   identity and ordinary guards.
3. **Materials preflight correction.** PR #623 (`a66e09091`) shipped the narrow
   expected-archive-miss correction; real/incomplete availability failures still
   block. The staff preflight indicator is advisory, not itself a hard send gate.
4. **Bounded reviewer rehearsal passed.** Request 1003456, run
   `c2da75d4-a737-4d81-8db1-96aca62e12a6` on **managed-ledger/ledger_prod**:
   readiness true, Phase I Invited, Phase II Pending Committee Review, derived
   Phase II Pending. One controlled synthetic reviewer was invited, accepted
   with separately authorized policy acknowledgments and honorarium opt-out,
   received manual materials release, and submitted a clearly labeled test
   review. The 24-page PDF hash matched the saved source package; staff showed
   Review Received and all nine answers. Final bounded census: two sent emails,
   zero request payments and no linked honorarium request. Materials inbox
   delivery was not independently verified. No synthesis or ordinary follow-up
   path was exercised. Temporary local PDF/render copies were removed.
5. **Closeout prepared in PR #626.** Runbook, finish plan and Atlas reconciled;
   historical checkpoints bounded; sanitized receipt and two GET-only probes
   published. Fable reviewed docs/probes; required and recommended documentation
   corrections resolved. All hosted checks on `15a427dd1` now passed.

### Release-status discrepancy — verify before claiming promotion

[OWNER REPORTED] Justin said the closeout was done and in Production.
[VERIFIED via GitHub at stop] PR #626 was still OPEN, with no merge commit;
`origin/main` remained at `a66e09091`. [VERIFIED via GitHub, Claude, later
2026-11-03] PR #626 has since merged (`626b1d681`, 23:05 UTC). Its final checks were all successful.
Do not silently merge or infer the Preview is Production. Recheck GitHub and the
serving deployment next time if this distinction still matters. The previously
released runtime/rehearsal proof is separate from this documentation closeout.

### Session branch commits

- `cc1c9c801` — Record completed Factory reviewer rehearsal and read-only probes.
- `18dc93c1d` — Close out prepared Factory MVP and document repeatable rehearsal.
- `15a427dd1` — Resolve Fable closeout guidance findings.
- This stop commit adds the handoff and Factory milestone entry.

## Concurrent Claude stream — same day (Claude, 2026-11-03)

Claude worked in worktree `/Users/gallivan/Code/WMKF_Apps-claude-2026-11-03`
alongside Codex. Its earlier standalone handoff (PR #622) is folded in here.

1. **Preview alias CSRF fix — PRODUCTION-MERGED, PREVIEW-PROVED.** PR #620
   (`1f854345e`): on Preview only, `lib/utils/auth.js` `validateOrigin` also
   accepts the registered stable alias (tracked constant
   `PREVIEW_STABLE_ALIAS_ORIGIN`). Signed-in alias POST proved not-403; alias
   restored. Test-clock fix PR #619 (`1b499663e`); closeout PR #621
   (`e18496cbd`). Plan: `docs/plans/PREVIEW_ALIAS_CSRF_ORIGIN_PLAN_2026-11-03.md`.
2. **Per-reminder history (queue item 7) — PRODUCTION-LIVE.** PR #625, merge
   `f75465281`, deployment `dpl_HuW1y9yaeuDLQTiRTEqsAHhiS5i9` (rollback
   `dpl_6pBBZctFHNgpQMpWA6EiSCgTDfVU`). New Postgres table
   `reviewer_reminder_events` (migration 095); each reminder gets its own dated
   Activity history entry. Owner decisions D1–D3; three Codex plan reviews and
   one implementation review. Plan:
   `docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md` (§ Build, § Production
   release); Atlas `docs/atlas/postgres-reviewer-reminder-events.md`.
   - Migrations: the owner ran `node scripts/apply-migrations.js` from the
     Claude worktree, applying **094 and 095 to the Production app database**
     (094 on Codex's recommendation, keeping the shared-schema convention;
     `docs/atlas/postgres-test-request-runs.md` now says so). Readback exact.
   - Staged proof **deferred by the owner**: 1003456 preserved at Codex's
     request; on 1003430 the Factory reviewer had declined, and the test-request
     email guard refused a hand-added reviewer (no email sent; candidate
     removed). Its non-synthetic person record
     `84793be7-e1d7-f111-a05b-000d3a379333` (owner's iCloud address) remains in
     Dynamics.
   - Closeout docs: PR #628 merged (`3629a33af`); this handoff section via PR #622
     (`abd5a4a2b`). DEVELOPMENT_LOG entry added at stop.

### Claude stream — next items (verify before acting)

- **Observe the first real review-due reminder in Production**: one
  `reviewer_reminder_events` row and one dated Activity history entry.
- `scripts/reset-reviewer-for-testing.js` now requires the
  `reviewer_reminder_events` table in the database it runs against.
- The main checkout is behind `origin/main`; pulling it is the owner's call
  (other-owner WIP there).
- Note for Codex/runbook: `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` says future
  ledger migrations use `ledger:apply`, "never the app database runner"; the app
  runner nonetheless applies every numbered migration to the app database.

## Next Items

### Owner Decision Needed — next session

1. **Broader J27 PD workflow.** [OWNER DECISION 2026-11-03] Discuss next time.
   Start with `docs/plans/J27_STAFF_AND_REVIEWER_ELIGIBILITY_PLAN_2026-11-02.md`.
   Its Phase I Staff review label / Proposal destination / hidden old triage cues
   were a draft, not an approved design. Review the actual staff process and
   source before proposing implementation. Keep earlier-cycle behavior intact.

### Verify Before Acting

- Resolve PR #626's GitHub/owner-reported release discrepancy above; no new
  merge authorization is supplied by this handoff.
- The older J27 eligibility/readiness plans still contain branch-era status
  labels. Verify the already-merged readiness/actionable changes against source
  and history before treating any plan item as an open task.
- Concurrent-stream carryovers below are routing pointers, not verified todos.

### Parked

- Earlier intake-stage Factory fixtures and real Power Automate assembly/AI
  testing: revisit only if prepared reviewer fixtures no longer suffice.
- Synthesis, ordinary Contact/honorarium/BILL follow-up and live-record cleanup:
  outside the completed no-payment rehearsal; no further actions authorized.

### Do Not Reopen Without New Decision

- Owner CLI phase/readiness finalization and optional private prior-PDF evidence
  are accepted MVP operating requirements; no web finalizer is needed now.
- No new invitations, materials sends, AI runs, fixture writes or cleanup based
  solely on the prior bounded authorization. Never commit bearer links, email
  bodies, proposal contents or screenshots.

## Concurrent Streams and Preservation

The prior complete Claude Session 660 handoff is retrievable with
`git show a66e09091:SESSION_PROMPT.md`; preserve its owner decisions. It covers
shared-prompt work and compact concurrent routing. No other checkout was edited.

| Owner / stream | Resume boundary |
|---|---|
| Claude / Preview CSRF + per-reminder history | See the concurrent Claude section above; worktree `/Users/gallivan/Code/WMKF_Apps-claude-2026-11-03` (branches merged; no WIP). |
| Claude / shared prompts | `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md`; prior handoff records waiting for Connor on phase-i.checkin, skipped Production smokes, unread name-column length and parked group/catalog work. Verify before carrying these forward. |
| Codex / Integrity | Session 658 handoff at `git show 9db614417:SESSION_PROMPT.md`; Dec 1 refresh remains future at this stop. Preserve `.integrity-backups/2026-11-02-pre-refresh/`; no restore authorized. |
| Claude / reviewer outcomes / invitations | Owning plans `INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md` and `REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`; not re-audited here. |
| Codex / terminology | `docs/audits/terminology-completion-audit-2026-11-01.md`; preserve its acceptance limits and local colleague brief. |
| Other worktrees | Preserve their branches, local artifacts and unknown WIP; no disposal authorized. |

The main checkout remains behind origin with other-owner changes in
`.codex/hooks.json`, `.github/hooks/impeccable.json`, `.impeccable/critique/…`
and `output/`. Do not stage, stash, reset or remove them. Our isolated worktree
`/private/tmp/wmkf-session-660-codex` and its ignored operational state remain in
place. Private rehearsal receipts/artifacts are under
`/private/tmp/wmkf-j27-live-2026-11-03`; bearer-link and prior-PDF files are secret
local evidence, not a new session's permission to act or disposable residue.

## Key Files and Validation

- `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md`: repeatable prepared rehearsal.
- `docs/plans/J27_TEST_REQUEST_FACTORY_FINISH_PLAN_2026-11-02.md`: completed scope.
- `docs/plans/evidence/test-request-factory/j27-reviewer-rehearsal-proof-2026-11-03.md`:
  bounded browser/PDF/Dataverse proof and limitations.
- `docs/plans/evidence/test-request-factory/j27-factory-closeout-2026-11-03.md`:
  changed-fact sweep, contract audit and Fable finding closures.

Scoped documentation/Atlas/security checks and sequential self-tests passed;
probe ESLint and syntax checks passed. No instruction/convention changes were
needed in CLAUDE.md. Claim-evidence pilot report was unavailable because local
state could not be read; no observation row was fabricated. No router growth
advisory was received in this stop.

Milestone determination: **entry added** to DEVELOPMENT_LOG.md for the shipped
prepared J27 Factory and completed bounded reviewer rehearsal. PR #626's
closeout promotion is explicitly not independently verified.
