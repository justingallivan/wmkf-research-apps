# Session 418 Prompt: reviewer activity history and pending SharePoint decisions

## Session 417 Summary

### What Was Completed

1. **Per-reviewer deadline extensions shipped and passed an owner production test.**
   Program Directors can grant or change the deadline for an accepted reviewer
   from Track Reviewers. The date must be after the request's original deadline
   and has no maximum. Saving first validates the complete notification payload,
   ETag-commits the override, and automatically sends the fixed-subject email and
   updated calendar invitation. The modal exposes retry/resend without another
   date write. Portal display, reminders, acceptance/calendar flows, and future
   token calculations use the effective reviewer deadline. Existing issued tokens
   retain the intentional original-deadline-plus-90-days lifetime through the
   Board meeting.

   Wave 18's nullable suggestion-level DateOnly field is live in Production.
   Request `1002788` exposed a legacy row with blank engagement identity
   snapshots; the writer now fills only missing snapshot identity from the linked
   reviewer record. Justin's signed-in retry saved and delivered successfully.
   The final copy correction reuses the invitation honorific helper, producing
   `Dear Dr. Homer,` instead of `Dear Test Homer,`. [VERIFIED via main
   `ed8b7a3d → d4cd8061`, production deployments recorded in the prior handoff,
   Wave 18 metadata/runtime probes, and owner smoke on 2026-08-11.]

2. **The ambiguous Last Action column was diagnosed and a replacement was scoped.**
   `ReviewerManagePanel.js` currently displays a fixed-priority fallback —
   `thankyouSentAt || reviewReceivedAt || reminderSentAt || materialsSentAt` —
   rather than the chronologically latest action, and it ignores deadline
   extensions. Justin chose an activity-history drawer to replace the column and
   confirmed Notes should remain a separate mutable memo.

3. **Claude Opus completed an adversarial review of the drawer proposal.**
   The review recommends a phased correction: first ship an accessible drawer
   derived from current reviewer fields, clearly label legacy/current-record
   evidence, and avoid a schema, route, or materialized backfill. Before any exact
   append-only ledger, run the already-required Dynamics email-activity probe and
   decide whether the feature is operational convenience or evidentiary history.
   Major findings: no email-open writer exists; engagement generations cannot be
   reconstructed; several "sent" stamps actually mean claim-before-send; email
   activity IDs are discarded by most reviewer send paths; dedup and partial
   failure semantics vary by event. [VERIFIED via the recovered Opus artifact
   committed at `outputs/reviewer-activity-history-opus-review-2026-08-11.md`.]

4. **Milestone-log governance was repaired.** The obsolete static footer was
   removed from `DEVELOPMENT_LOG.md`, and `/stop` now requires an explicit
   milestone determination. This handoff adds the missing production milestone
   entry for reviewer deadline extensions. `DEVELOPMENT_LOG.md` remains the
   milestone record, not a routine session log. [VERIFIED via `2bca2dc8` and the
   new top entry.]

5. **A colleague-facing July 29–August 11 change summary was prepared.** It
   covers Initial Assessment governance, safer reviewer finding/invitation,
   decline referrals and deadline extensions, reviewer portal/Reviews changes,
   Awardee-tab workflow changes, and performance/reliability improvements. This
   was a conversation deliverable for Justin's 2026-08-12 meeting; no repository
   artifact or runtime change was required.

### Commits

- `ed8b7a3d` — Add per-reviewer due date overrides
- `637d13b8` — Harden reviewer due date overrides
- `d6864897` — Add accepted reviewer extension workflow
- `19982cfd` — Address Opus reviewer extension findings
- `8647af33` — Record Wave 18 production schema provisioning
- `ea607fb9` — Record Wave 18 production promotion
- `ccb7e0c8` — Fix legacy reviewer extension identity fallback
- `adcc2859` — Record reviewer extension identity fallback
- `6526a934` — Use honorific greeting for extension emails
- `d4cd8061` — Record extension honorific production verification
- `2bca2dc8` — Enforce milestone log handoff decision

## Next Items

### Verified Open

1. **Design and build Phase 1 of reviewer activity history on a feature branch.**
   Evidence: `outputs/reviewer-activity-history-opus-review-2026-08-11.md` and
   `shared/components/reviewers/ReviewerManagePanel.js:1783-1836`.
   The recommended first increment replaces Last Action with an accessible drawer
   derived from the reviewer DTO, adds only the missing existing lifecycle fields
   to the projection, uses evidence-safe wording such as "recorded" where delivery
   is not proven, keeps Notes separate, performs no backfill, and closes or
   refreshes on row mutation. This is planned, not built.

2. **Board milestone snapshot producer.** Evidence:
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:791-794` says no immutable milestone
   snapshot operation exists; current source only reads the three provisioned
   `wmkf_milestone*` fields (`request-document.js:38-40`,
   `artifact-service.js:258-260`). The owner selected copy-the-bytes on 2026-08-10.

3. **Two non-destructive SharePoint checks.** Evidence:
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:691-723`. Add "Checked Out To" to the
   request-library view and read the Members permission level's Delete Items /
   Delete Versions settings. Do not test permissions by deleting governed data.

### Owner Decision Needed

1. **Activity-history Phase 1 behavior.** Decide whether replacing Last Action
   should preserve its fixed-priority semantics or show true recency; whether the
   existing `proposalFirstAccessed` signal should be labeled "Portal first
   accessed"; and whether actor names belong in the staff-shared view. The Opus
   review recommends no materialized legacy backfill.

2. **Whether an exact ledger is necessary after Phase 1.** If the drawer is only
   for operational convenience, Phase 1 may be the complete feature. If it will
   feed reviewer reliability or payment decisions, run the read-only Dynamics
   email-activity probe first, then choose Dataverse vs Postgres vs extended email
   activity, add durable engagement generation, and reconcile
   `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md:189-216` before schema work.

3. **`merge-candidates` authorization remains org-open and destructive.**
   Evidence: `.claude-memory/project-merge-candidates-authorization-gap.md`;
   `pages/api/reviewer-finder/merge-candidates.js` takes two GUIDs without a
   `requestId`, while `reviewer-modes.js:86-96` documents the UI management gate
   as cosmetic and fail-open. Owner decision remains required on whether this
   later destructive primitive should stay app-wide.

### Parked

1. **Invite-tab surfacing of needs-merge alerts.** Re-open only if a new alert
   probes `STILL_BLOCKED`; begin with a request-scoped information-only hint.
   Direct alert-to-merge additionally depends on owner decision #3 above.

2. **Exact activity ledger and deferred-load API.** Park until Phase 1 is evaluated
   and the product/evidence decision is made. A future route must bind
   `suggestionId` to `requestId` server-side and be added to
   `docs/API_ROUTE_SECURITY_MATRIX.md`.

### Verify Before Acting

1. **SharePoint policy input.** Connor's outstanding answer was expected
   2026-08-12 (`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:783`). Check for the actual
   response before treating retention or permission conclusions as settled.

2. **Activity timestamps are not uniformly dispatch proof.** Reminder and
   thank-you timestamps can survive a failed send, extension save can succeed
   before notification fails, and invitations can be `unconfirmed`. Read the
   exact source paths cited in the Opus review before choosing labels or ledger
   outcomes.

3. **"No new BILL alerts" remains assumed until tied to a known acceptance.**
   The prior census showed zero active/new post-redeploy alerts and healthy drain
   runs, but no real reviewer acceptance was confirmed in that observation
   window. Re-run only after a known acceptance.

### Do Not Reopen Without New Decision

1. **Launching a merge from a stored alert (`initialMerge`).** The stored alert
   is not live proof and can feed a destructive merge; only the current live
   re-derivation creates a safe conflict pair.
2. **Changing the accepted-reviewer 90-day token policy for ordinary extensions.**
   Justin intentionally keeps issued links valid through the Board meeting; the
   longest normal reviewer extension is roughly two weeks.
3. **Retiring `DEVELOPMENT_LOG.md`.** Justin confirmed it is the milestone record.
   `/stop` now requires a milestone determination, not per-session logging.
4. **Materializing derived reviewer-history backfill.** Re-added rows have lost
   prior generation stamps and several lifecycle timestamps do not prove sends;
   a materialized backfill would create false-confidence history.

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/reviewer-activity-history-opus-review-2026-08-11.md` | Adversarial findings, phased recommendation, and owner decisions for activity history |
| `shared/components/reviewers/ReviewerManagePanel.js` | Track Reviewers table, current Last Action derivation, notes, and row actions |
| `shared/components/reviewers/ReviewerDueDateEditor.js` | Production extension modal and retry/resend UI |
| `lib/services/reviewer-due-extension.js` | Validated date write, notification dispatch, and partial-success contract |
| `lib/services/review-manager/reviewers-service.js` | Reviewer DTO projection that can support a derived Phase 1 drawer |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Reviewer lifecycle fields, ETag writes, and engagement reset behavior |
| `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md` | Due-date implementation record and deferred immutable dispatch-evidence gate |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Open milestone snapshot work and SharePoint policy/probe record |
| `.claude-memory/project-merge-candidates-authorization-gap.md` | Durable record of the pre-existing merge authorization decision |

## Testing and Release Evidence

```bash
# Reviewer extension release evidence recorded in Session 417:
npx jest tests/unit                         # 610 suites / 7,717 tests
npx jest <focused extension set>            # 30/30
npm run build                               # webpack production build passed

# Handoff checks:
npm run check:doc-currency
npm run test:check-doc-currency             # run sequentially after the gate
npm run check:fact-consistency
npm run test:check-fact-consistency         # run sequentially after the gate
git diff --check
```

The `/stop` claim-evidence report was attempted but returned "local state could
not be read"; no observation-table row was inferred from an unavailable report.
`CLAUDE.md` did not require a feature catalogue update: its source-of-truth
pointers and operating contract remain current.
