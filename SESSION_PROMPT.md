# Session 375 Prompt: Choose the next owner-prioritized workstream

## Session 374 Summary

The reviewer invitation, decline, withdrawal, and tracking workflow was
finished through production QA. Declined reviewers now leave the active
proposal pool automatically, retain their history/referrals, and appear in
the Invite Reviewers tab's Removed section. The associated UI corrections
were merged to `main`, deployed successfully, and verified on request
`1002788`.

### What Was Completed

1. **Reviewer invitation and acceptance-email QA**
   - The invitation includes the review due date and only one accept/decline
     action block.
   - The automatic acceptance reply mirrors the accepted portal page and
     retains a later self-service withdrawal path.
   - Reviewer self-withdrawal routes through the decline/referral form,
     notifies the Program Director, removes the linked honorarium request,
     and updates derived reviewer counts.
   - [VERIFIED via real-email browser rehearsal, Dataverse/Postgres probes,
     focused tests, and production inspection.]

2. **Staff-recorded reviewer withdrawal**
   - Track Reviewers exposes the dedicated staff withdrawal action without
     asking the Program Director for alternate-reviewer suggestions.
   - The shared withdrawal path revokes the reviewer token, deletes the exact
     linked honorarium request, records the terminal state, and updates every
     selected-row-derived dashboard/count.
   - [VERIFIED via production browser rehearsal and the shared lifecycle
     contract documented in
     `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.]

3. **Invite and Track Reviewers UI corrections**
   - Declined rows no longer count as invitable or leave the Send Invitation
     button in a contradictory state.
   - Track Reviewers no longer shows a confusing always-visible status
     dropdown beside separate action buttons; correction/withdrawal/release
     actions are consolidated under the row's Manage control.
   - [VERIFIED via focused tests, lint, build, and production browser QA.]

4. **Automatic decline archival**
   - Initial decline, reviewer self-withdrawal, staff withdrawal, and the
     honorarium race-compensation path now write `wmkf_selected=false`.
   - Declined reviewers appear under Removed with a **Reset & restore** action
     that clears prior engagement state and requires a fresh invitation/token.
   - Decline referrals remain readable after archival; accepting again before
     materials release restores `wmkf_selected=true`.
   - Released/no-longer-needed reviewers remain a distinct non-decline
     terminal path and are not auto-archived.
   - [VERIFIED via 190 focused Jest tests, targeted ESLint, production build,
     contract reconciliation, and durable-fact sweep.]

5. **Production promotion and legacy repair**
   - Merge `c9ca86b5` deployed READY to production from `main`.
   - A scoped, operator-authorized Dataverse repair changed only
     `wmkf_selected` on the two legacy `selected=true, declined=true` rows for
     request `1002788`.
   - Postconditions proved zero selected+declined rows remain and both exact
     suggestion IDs are returned by the Removed query.
   - Justin refreshed the Workbench and confirmed the result looks correct.
   - The merged feature branch was deleted locally; no remote feature branch
     existed. `main` was clean and synchronized at session close.

### Commits

- `ab2b22f4` — Fix declined reviewer invite eligibility
- `5584dc90` — Clarify reviewer tracking actions
- `b6d74d54` — Merge reviewer workflow UI fixes
- `7e84ff67` — Fix: archive declined reviewers from proposals
- `c9ca86b5` — Merge declined reviewer archival

## Next Items

### Verified Open

1. **Correct the effective saved invitation wording**
   Evidence: the real invitation rendered “Your completed reviews,” while
   `lib/seed/email-defaults/reviewer-templates.js` already says “Your completed
   review.” Source wording alone does not control saved admin/per-PD overrides.
   Read the effective organization default and Justin's per-PD override, then
   edit or reset the winning saved template.

### Owner Decision Needed

1. **Retain or permanently delete reviewer test artifacts**
   Evidence: request `1002788` still retains the controlled declined reviewer
   rows (including `ZZZ Smoke Test (DELETE)`) under Removed, plus referral and
   notification/audit evidence from the production rehearsal. Session 374
   archived them from the active proposal pool but deliberately did not
   permanently delete the suggestion/person records.
   Decide whether those artifacts should remain available for future
   rehearsals or go through the existing removal preflight and permanent-delete
   workflow.

### Parked

1. Reviewer dispatch-evidence reliability design remains parked until Justin
   reprioritizes it.
2. Applicant intake remains parked during the GOApply evaluation.
3. Automated BILL onboarding remains tabled; payment is offline/manual.

### Verify Before Acting

1. **Production/default-template state**
   Evidence currently available: tracked singular wording does not prove the
   effective saved admin/per-PD template is singular.
   Read both live layers before editing or claiming correction.

2. **Local real-email mode**
   Evidence currently available: `.env.local` normally uses capture mode and
   may not contain a usable external signing secret.
   A future real-email rehearsal must deliberately enable send mode, use an
   allowlisted inbox, and carry a dated production-write acknowledgement only
   for the exact rehearsal operation.

### Do Not Reopen Without New Decision

1. Do not make Accept, Decline, or Withdrawal mutate state on GET; email
   security scanners prefetch links.
2. Do not add a new campaign-date store; the current campaign system remains
   authoritative.
3. Do not auto-decline nonresponders.
4. Do not ask a staff-recorded withdrawal for alternate reviewer suggestions.
5. Do not restore declined reviewers implicitly. Restore is an explicit staff
   reset that clears the prior engagement and requires a fresh invitation.
6. The reviewer invitation/acceptance/decline/staff-withdrawal production QA is
   complete; do not carry it forward as untested without new regression
   evidence.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Authoritative decline, withdrawal, selection, Removed-query, and restore writes |
| `lib/services/external-review/respond-service.js` | External accept/decline state machine and legacy repeat-decline repair |
| `lib/services/workbench/decline-referrals-service.js` | Reads referrals from active and archived decline rows |
| `lib/services/reviewer-finder/my-candidates-service.js` | Projects active and Removed candidate DTOs |
| `shared/components/reviewers/ReviewerInvitePanel.js` | Invite-stage list, Removed section, and Reset & restore UI |
| `shared/components/reviewers/ReviewerManagePanel.js` | Track-stage reviewer status and Manage actions |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | Durable reviewer lifecycle contract |
| `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` | Dataverse reviewer-suggestion ownership and field semantics |

## Testing

```bash
rtk npm test -- --runInBand \
  tests/unit/reviewer-adapters-writeback.test.js \
  tests/unit/reviewer-suggestion-disposition.test.js \
  tests/unit/reviewer-suggestion-withdrawal.test.js \
  tests/unit/external-review-services.test.js \
  tests/integration/external-review-routes.test.js \
  tests/unit/decline-referrals-service.test.js \
  tests/unit/my-candidates-service.test.js \
  tests/unit/reviewer-invite-panel-invite-capture.test.js \
  tests/unit/terminal-transition-service.test.js

rtk npx eslint \
  lib/dataverse/adapters/reviewer-suggestion.js \
  lib/external/verify-suggestion-token.js \
  lib/services/external-review/respond-service.js \
  lib/services/reviewer-finder/my-candidates-service.js \
  lib/services/workbench/decline-referrals-service.js \
  shared/components/reviewers/ReviewerInvitePanel.js

rtk npm run build
```
