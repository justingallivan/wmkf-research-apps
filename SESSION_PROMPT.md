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
`origin/main` remained at `a66e09091`. Its final checks were all successful.
Do not silently merge or infer the Preview is Production. Recheck GitHub and the
serving deployment next time if this distinction still matters. The previously
released runtime/rehearsal proof is separate from this documentation closeout.

### Session branch commits

- `cc1c9c801` — Record completed Factory reviewer rehearsal and read-only probes.
- `18dc93c1d` — Close out prepared Factory MVP and document repeatable rehearsal.
- `15a427dd1` — Resolve Fable closeout guidance findings.
- This stop commit adds the handoff and Factory milestone entry.

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
