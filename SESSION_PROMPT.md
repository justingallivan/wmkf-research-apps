# Session 426 Prompt: Add an Editable Respond-Nudge Email Preview

## Session 425 Summary

The manual respond-by nudge was completed, reviewed, promoted to `main`, and
deployed to Production. Program Directors can now nudge an active invited
reviewer who has not answered; the send uses a fresh secure response link and
records when the reviewer was last nudged. The current UI still uses a browser
confirmation and sends the configured template without showing its contents.

### What Was Completed

1. **Shipped the manual respond-by nudge (PRODUCTION).** The Invite Reviewers
   row exposes `Send reminder` only for active unanswered invitations. The route
   distinguishes `kind: 'respond'` from the existing review-due reminder while
   preserving the omitted-kind behavior used by the Reviews tab.

2. **Made manual reminder authorization and persistence atomic.** Both manual
   reminder paths freshly authorize the reviewer lifecycle and persist the
   marker plus fresh token in one ETag-bound PATCH. Removed/revoked reviewers
   fail closed, and a concurrent lifecycle change prevents the email send.

3. **Closed the adversarial review findings.** Claude Opus found no remaining
   P0/P1/P2 issue after the atomic-claim and UI/error-state corrections. Local
   verification passed 617 suites / 7,902 tests, type checking, the production
   build, and the relevant contract/documentation gates.

4. **Promoted and verified Production.** `main` advanced to `8529d4a5`; the
   Vercel deployment completed, all five GitHub workflows passed (Tests,
   Playwright, Security Scan, Dependency Scan, Secret Scanning), and the public
   application and external-review endpoint returned HTTP 200. No real nudge
   email was sent during the deployment verification.

### Commits

- `5891c65e` - feat(reviewers): add manual respond-by nudges
- `8529d4a5` - fix(reviewers): make manual reminder claim atomic
- Promotion also included the ten prerequisite investigation, probe, plan, and
  handoff commits from `48aea0d5..2d169c77`.

## Next Items

### Verified Open

1. **[OWNER-REQUESTED, VERIFIED OPEN] Replace the respond-nudge confirmation
   with an editable email preview modal.** Clicking `Send reminder` in Invite
   Reviewers should launch a modal that shows the nudge email contents and lets
   the PD edit them before an explicit send. Cancel must perform no marker,
   token, or email mutation. Evidence: owner direction, 2026-08-13; the current
   `sendRespondReminder` in `shared/components/reviewers/ReviewerInvitePanel.js`
   uses `confirm(...)` and immediately POSTs only `requestId`, `suggestionId`,
   and `kind: 'respond'`.

2. **[VERIFIED OPEN] Phase B - mint-surface hardening.** Separate change, own
   review. `ensureToken`, `send-emails-service`, and `regenerate-token-service`
   still mint without a selected/revoked check. This is pre-existing exposure;
   the resurrection invariant is not closed until Phase B lands. Evidence:
   `docs/REVIEWER_MANUAL_RESPOND_NUDGE_BUILD_PLAN.md` mint-surface audit.

3. **[VERIFIED OPEN] The automatic respond-by cron remains unsafe and must not
   be armed.** It still needs selected/revoked selection and authorization guards
   before `respondReminderEnabled` is exposed or set. Evidence:
   `lib/services/reviewer-reminder-sweep.js:99-168`.

4. **[VERIFIED OPEN, carried from S423] The merge cascade is still
   non-transactional.** `hardDeleteById` in `reviewer-merge.js` permanently
   deletes colliding loser rows with no compensation.

5. **[VERIFIED OPEN, carried from S423] The slot-binding half of the ETag
   question is unverified.** Needs a controlled sandbox write.

6. **[VERIFIED OPEN, re-checked 2026-08-13 in S423] Repair `computeCanManage`
   rather than delete it.** See `shared/components/reviewers/reviewer-modes.js`.

7. **[VERIFIED OPEN, carried] SharePoint:** PnP.PowerShell audit with Connor;
   Purview/holds evidence with the M365 compliance admin; board milestone
   snapshot producer. The separate Claude handoff is
   `outputs/sharepoint-retention-handoff-to-codex-2026-08-13.md`.

### Owner Decision Needed

1. **Preview scope.** The owner request was made in the context of the new
   respond-by nudge in Invite Reviewers. Confirm before expanding the same modal
   to the existing review-due reminder in Track Reviewers.

2. **Expose the campaign-settings reminder toggles at all?** Arming them is
   unsafe until Phase B and the cron guards land.

3. **Execute the phantom co-PI remediation?** Unchanged from S423/S424.

4. **Should `merge-candidates` remain organization-open?** Unchanged.

### Verify Before Acting

1. **Trace the preview contract end to end before implementation.** The server
   currently reads the configured subject/body, mints the fresh token, renders,
   and sends in one command path. Decide how preview obtains rendered content
   without minting a live token or claiming the marker, and how edited content
   reaches the send path without weakening server-side lifecycle authorization,
   HTML safety, signature/link handling, or the at-most-once contract. Invoke
   `/contract-reconcile` for this cross-layer change.

2. **The production scale figures in the nudge plan remain `[ASSUMED]`.** The
   original probe artifact was never written because of the now-fixed output
   flag parser. Re-run the read-only probe to re-measure before relying on them.

3. **Requests 1002146 / 1002379 are last cycle and must never be nudged.** They
   remain incidentally blocked by null offsets; do not use them for a live smoke.

### Parked

1. Per-reason `skipped` counters in the cron sweep.
2. Sticky per-user reminder defaults (`INVITE_TIMING` extension).
3. Excel export still carries the full match-reason blob including the referral
   clause. No data is lost; it differs from the candidate card display.
4. Invite-tab needs-merge alerts; exact activity ledger; staff review before
   grantee co-PI display; bespoke per-invitation due date.

### Do Not Reopen Without New Decision

1. **Arming `respondReminderEnabled` before Phase B and cron hardening.**
2. **Deleting `computeCanManage`.** Repair the fail-open branch instead.
3. **Removing the Step 7 pre-deactivate re-check in the merge.**
4. **Changing application code for the phantom co-PI.**
5. **Reinstating a block on any `respondBy` condition in the invitation timeline.**
6. **Re-encoding the referrer as a space-joined match-reason prefix.**

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/ReviewerInvitePanel.js` | Current browser-confirm flow and respond-nudge trigger |
| `pages/api/review-manager/send-review-reminder.js` | Manual reminder route and `kind` discriminator |
| `lib/services/reviewer-manual-reminder.js` | Manual preflight and fresh lifecycle authorization |
| `lib/services/reviewer-reminder-sweep.js` | Template rendering, atomic marker/token persistence, and send |
| `docs/REVIEWER_MANUAL_RESPOND_NUDGE_BUILD_PLAN.md` | Phase A production record and Phase B boundaries |

## Testing

```bash
npm test -- --runInBand
npm run check:types
npm run build
```
