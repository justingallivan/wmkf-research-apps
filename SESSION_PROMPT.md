# Session 420 Prompt: run the SharePoint permission audit with Connor

## Session 419 Summary

### What Was Completed

1. **Reviewer activity history Phase 1 shipped.** Track Reviewers now shows the
   chronologically newest derived event and opens an accessible History drawer. Five
   review rounds corrected lifecycle-stamp overclaims before release. PR #120 merged,
   all eight required checks passed, the Production deployment completed, and an
   authenticated smoke on Request `1002959` verified the drawer, evidence caveat, and
   neutral invitation wording. No completed-receipt row was available in that request;
   focused tests cover its wording.

2. **Inherited CI failures were repaired.** PR #121 restored the documentation-catalog
   path invariant and removed a harness-framing false positive without weakening either
   gate. Local `main` was reconciled with `origin/main` in `a81289d0` so both Claude's
   Session 419 work and the merged gate repairs are present.

3. **Claude's newer SharePoint policy work was recovered.** The decision-ready brief is
   on `origin/codex/sharepoint-storage-policy-questions` at commit `f04d76a7`.
   It records the 2026-08-11 Connor session, the modern Site Permissions screenshot,
   the `Everyone except external users` membership signal, and the supported read-only
   PnP.PowerShell route. This supersedes the shorter Connor question list in the older
   handoff.

### Commits

- `ae337125` - feat(workbench): reviewer activity history Phase 1 (derived drawer)
- `bd8d9279` - test(workbench): pin activity-drawer focus, Escape, and evidence copy
- `9eb11496` - fix(workbench): stop asserting close-out-fabricated review receipts
- `7ebadbfe` - fix(workbench): classify response and receipt events by write path
- `058e45f2` - fix(workbench): keep the withdrawal date in Last Action
- `2e7af630` - docs: status brief for reviewer activity history Phase 1
- `c08936ff` - fix(gates): restore inherited documentation checks (#121)
- `96eba33a` - test(workbench): update reviewer envelope contract
- `a81289d0` - Merge origin/main into main

## Next Items

### First Agenda Item

1. **[VERIFIED OPEN] Run the read-only PnP.PowerShell audit with Connor.**
   Evidence: `f04d76a7:outputs/sharepoint-storage-policy-question-brief.md`, especially
   sections 1a, 6, 9, and 10; official PnP cmdlets cited there. First establish whether
   Connor has a tenant-consented Entra app client ID and the needed operator rights.
   Interactive PnP login requires that client ID; do not use an app secret.

   ```powershell
   $siteUrl = "https://appriver3651007194.sharepoint.com/sites/akoyaGO"
   $library = "akoya_request"
   $clientId = "<TENANT-CONSENTED-ENTRA-APP-CLIENT-ID>"

   Connect-PnPOnline -Url $siteUrl -Interactive -ClientId $clientId

   $members = Get-PnPGroup -AssociatedMemberGroup
   $members | Format-List Id, Title, LoginName
   Get-PnPGroupPermissions -Identity $members
   Get-PnPGroupMember -Group $members | Select-Object Title, Email, LoginName

   $list = Get-PnPList -Identity $library -Includes HasUniqueRoleAssignments
   $list | Select-Object Title, Id, HasUniqueRoleAssignments
   Get-PnPListPermissions -Identity $library -PrincipalId $members.Id
   Get-PnPRoleDefinition | Select-Object Name, BasePermissions
   ```

   Record: the actual Members role, whether Justin is an ordinary Member or has a
   direct/elevated grant, whether `akoya_request` inherits site permissions, and the
   effective `Delete Items`, `Delete Versions`, and `Manage Permissions` rights. If the
   library has unique permissions, identify its ordinary-editor principal and role.

   If Connor is a Site Collection Administrator, also run this read-only check:

   ```powershell
   Get-PnPRecycleBinItem -SecondStage |
     Select-Object Title, DirName, DeletedByName, DeletedDate
   ```

   That command requires Site Collection Administrator rights; a tenant SharePoint
   Administrator role alone is insufficient. Never use `Set-PnP*`, `Remove-PnP*`, or
   `Restore-PnP*`, and do not test by deleting a governed artifact.

   Interpret `HasUniqueRoleAssignments`: `False` means the library inherits site
   permissions; `True` means its permissions are unique. A current blank `Checked Out
   To` value cannot reconstruct the historical 2026-08-10 lock and does not close the
   delete-rights question.

### Owner Decision Needed

1. **Is reviewer activity history operational convenience or evidence?** If it may feed
   reviewer-reliability or payment decisions, the remaining derived-field ambiguities
   require stronger persistence. Evidence:
   `outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md` and
   `outputs/reviewer-activity-history-opus-review-2026-08-11.md`.

2. **Should Phase 1's disputed receipt evidence be reduced?** Three non-reset fields can
   carry prior-engagement state, but removing them leaves no engagement-scoped evidence
   distinguishing a real submission from staff close-out. Decide only after answering
   item 1.

3. **Should `merge-candidates` remain organization-open?** The destructive route takes
   two GUIDs without a request binding; the UI management gate is cosmetic and
   fail-open. Evidence: `.claude-memory/project-merge-candidates-authorization-gap.md`.

### Verified Open

1. **SharePoint durability evidence after the Connor audit.** The library is already
   verified as 500 major versions, no age limit, and checkout not required. "Limited
   control" is modern-pane wording, not the actual role definition. Purview policy and
   hold questions belong with the M365 compliance administrator, not Connor.

2. **Board milestone snapshot producer.** No immutable snapshot operation exists; the
   owner selected copy-the-bytes on 2026-08-10. Evidence:
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` and the `wmkf_milestone*` source fields.

3. **Reviewer drawer visual coverage.** The production smoke covered the drawer on one
   request, but no visible completed-receipt row was available for direct inspection.
   Focused tests cover it; a future natural example can close the visual gap.

4. **Reviewer history persistence limits.** Non-reset receipt inputs can survive a
   restored engagement, and accepted-then-withdrew overwrites the acceptance timestamp.
   Both are gated on the evidence-versus-convenience decision above.

### Parked

1. **Invite-tab surfacing of needs-merge alerts.** Re-open only if a new alert probes
   `STILL_BLOCKED`.
2. **Exact activity ledger and deferred-load API.** Re-open only after the activity
   history evidence decision.

### Verify Before Acting

1. **SharePoint policy branch disposition.** The full brief and corrected durable docs
   remain on `origin/codex/sharepoint-storage-policy-questions`. Review its diff against
   current `main` before deciding whether to merge; do not assume the whole branch is
   stale or merge-ready.
2. **`codex/initial-assessment-pilot` disposition.** It remains old and unmerged. Verify
   its current commits and callers before retaining, rebasing, or retiring it.

### Do Not Reopen Without New Decision

1. Launching a merge from a stored alert (`initialMerge`); stored alerts are not live
   proof.
2. Changing the accepted-reviewer 90-day token policy for ordinary extensions.
3. Materializing a derived reviewer-history backfill.
4. Modifying load-bearing reviewer write paths merely to improve drawer labels.

## Key Files Reference

| File | Purpose |
|------|---------|
| `f04d76a7:outputs/sharepoint-storage-policy-question-brief.md` | Claude's decision-ready SharePoint brief and PnP route |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Current governed-file evidence and durability model |
| `outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md` | Activity-history review record and open findings |
| `shared/components/reviewers/reviewer-activity-history.js` | Derived event classification |
| `shared/components/reviewers/ReviewerActivityDrawer.js` | History drawer UI |
| `.claude-memory/project-merge-candidates-authorization-gap.md` | Destructive merge-route authorization gap |

## Testing

```bash
npm run check:docs-catalog
npm run check:harness-framing
```
