# Session 462 Prompt: Review and Decide Promotion of Personalized Scheduled Email P0

## Session 461 Summary

Session 461 mapped the user and super-user email-template/signature touchpoints,
resolved the P0 product flow with the owner, and implemented the first
personalized scheduled-email review workflow on feature branch
`codex/scheduled-email-review-p0`. The implementation is committed but is not
merged, deployed, migrated, or live-probed.

### What Was Completed

1. **The P0 owner flow was resolved.**
   - Email remains personalized and sends from the assigned Program Director.
   - Automated recipient mail identifies that it was sent automatically on
     behalf of the PD and states that replies go to the PD.
   - Each PD can explicitly choose automatic sending or an advance review
     period of 1–14 days; the UI suggests 3 days.
   - The review lead moves the intervention notification earlier without moving
     the established recipient send date.
   - Review-mode actions are edit subject/body, approve, stop, and send now.
     Silence sends the frozen draft at the scheduled time.

2. **The first cross-layer workflow was implemented.**
   - The first bounded workflow is the grantee abstract reminder.
   - Profile Settings owns the PD preference; `/scheduled-emails` provides the
     review inbox.
   - Migration 036 adds `scheduled_email_messages`, a durable Postgres ledger
     for the exact draft, review actions, leases, Dynamics activity receipts,
     retry reconciliation, and Dataverse finalization repair.
   - A live grantee token is minted only at the actual send. Browser preview
     uses a non-live placeholder, and sender/recipients/signature/source/schedule
     remain server-owned.
   - Cleanup deletes only finalized sent rows and explicit stopped rows after
     the retention period; unresolved work is preserved.
   - Day-12 eligibility now means a full 12 days have elapsed, followed by the
     first daily 08:00 UTC cron tick.

3. **Signature and automation wording were corrected.**
   - The exact legacy `Automatically sent on behalf of:` line no longer appears
     between a stored closing and signature.
   - Shared recipient disclosure is also used by the automated reviewer reminder
     and thank-you paths touched in this slice.

4. **Verification and documentation were completed on the feature branch.**
   - Twelve focused suites passed: 96 tests.
   - Migration parity, API security, route/service boundaries, trust-boundary
     GUIDs, Dynamics context, lifecycle auth, Atlas, durable-fact consistency,
     documentation references/catalog, Dataverse access, OData escaping, enum
     parity, secret scan, and scaffolding-token gates passed with their required
     self-tests.
   - The supported webpack production build passed with zero errors/warnings.
     The default Turbopack build could not bind its internal local port in the
     Codex execution environment.
   - A full repository Jest run had 8,900 passing tests and four failures. The
     only feature-related failure was fixed and independently re-tested. Three
     untouched tests retained stale response/model expectations and were not
     changed as unrelated work.
   - Per owner direction, no Claude/Fable or other external review was requested.

### Commits

- `83e8a60d` — `feat: add personalized scheduled email review`

## Next Items

### Verified Open

1. **Owner acceptance of the P0 branch.**
   Evidence: feature commit `83e8a60d` and
   `codex/scheduled-email-review-p0:docs/SCHEDULED_PERSONALIZED_EMAIL_P0.md`.
   Review the user flow and wording before requesting another-agent review,
   merging, applying migration 036, or deploying.

2. **Release preparation after explicit owner approval.**
   Evidence: the feature document labels migration 036 and live provisioning as
   not verified. Re-check branch freshness and live migration/deployment state,
   run any owner-requested review, then follow the repository release strategy.

3. **Resolve or explicitly baseline the three unrelated Jest failures before
   promotion.**
   Evidence: the Session 461 full Jest run identified stale expectations in
   `tests/unit/applicant-reviewers-endpoint.test.js`,
   `tests/integration/enrich-recommended-route.test.js`, and
   `tests/unit/multi-llm-service.test.js`. Re-run them against the then-current
   branch before deciding whether they remain unrelated baseline failures.

### Owner Decision Needed

1. **Default for existing PDs without a saved preference.**
   Evidence: the feature branch preserves the historical automatic path for an
   unconfigured PD. Decide whether rollout should retain that compatibility
   state or force each PD to choose before the feature is promoted.

2. **When to request a second opinion and promote the branch.**
   Evidence: the owner explicitly directed that the implementation not be
   passed for further review until asked. Do not initiate review, merge, schema
   application, or deployment without that direction.

### Parked

1. **A second internal notification near recipient send time.**
   Evidence: the P0 implements the initial advance-review notification only.
   Re-open after the owner has used or accepted the first notification flow.

2. **Additional automated-email workflows.**
   Evidence: P0 is deliberately bounded to grantee abstract reminders; the
   durable model can be evaluated for other workflows only after this slice is
   accepted.

3. **Site Visit dossier, AkoyaGo publication discovery, and Final Writeup copy.**
   Evidence: Session 460 verified these as planned but not built. They remain
   parked while personalized scheduled email is the active owner priority.

4. **Preferred external email coverage for active Board/Consultant roster rows.**
   Evidence: Session 460 carried `expertise_roster.preferred_email` population
   as verified open. Probe current rows before any update.

5. **Independent inbox/calendar-client confirmation of the first Site Visit
   distribution.**
   Evidence: Session 460 proved Dynamics transport acceptance for operation
   `f497643a-2e9e-4032-a323-1e40874d16f1`, not inbox/calendar-client receipt.

### Verify Before Acting

1. **Migration and deployment state.**
   Evidence currently available: this session did not apply migration 036,
   merge the feature branch, or deploy it. Probe the then-current Postgres
   `schema_migrations`, repository branches, and Vercel deployment before any
   release action.

2. **Feature-branch freshness.**
   Evidence currently available: `83e8a60d` is based on local `main` commit
   `0d476b9e`. Fetch and compare against current remote `main` before review or
   promotion.

### Do Not Reopen Without New Decision

1. A generic shared email box or third-party approval workflow.
2. Moving recipient send time earlier when a PD selects a review lead.
3. Allowing the browser to choose sender, recipients, signature, workflow
   source, schedule, or live secure-link token.
4. External/another-agent review before the owner explicitly asks for it.
5. The completed P0 implementation unless owner testing or review produces a
   material issue.
6. Formal Site Visit `METHOD:REQUEST`, RSVP, update, or cancellation semantics;
   a parallel Site Visit status/ledger/writeup; direct ActivityParty writes; or
   automatic email on Site Visit promotion/date changes.

## Key Files Reference

The feature files below are on branch `codex/scheduled-email-review-p0` until
promotion.

| File | Purpose |
|---|---|
| `docs/SCHEDULED_PERSONALIZED_EMAIL_P0.md` | Owner decisions, contract matrix, rollout boundary, and residual risk |
| `pages/scheduled-emails.js` | PD review inbox and actions |
| `pages/profile-settings.js` | Per-PD automation/review preference UI |
| `lib/services/scheduled-email-service.js` | Notification, preview, send recovery, and finalization coordinator |
| `lib/services/scheduled-email-store.js` | Durable Postgres ledger operations and leases |
| `lib/db/migrations/036_scheduled_email_messages.sql` | Existing-database schema migration |
| `lib/services/cron/grantee-deliverable-reminders-service.js` | Preference-aware scheduling and queue processing |
| `lib/external/automated-email-notice.js` | Shared personalized automation disclosure |

## Testing

```bash
rtk git switch codex/scheduled-email-review-p0
rtk npm test -- --runInBand tests/unit/automated-email-notice.test.js tests/unit/email-automation-preferences.test.js tests/unit/maintenance-cleanup-scheduled-emails.test.js tests/unit/scheduled-email-routes.test.js tests/unit/scheduled-email-schema-parity.test.js tests/unit/scheduled-email-service.test.js tests/unit/grantee-deliverable-reminders-cron.test.js tests/unit/maintenance-cron-handler.test.js tests/unit/profile-settings-email-signature.test.js tests/unit/user-preferences-reserved-keys.test.js tests/unit/cron-batch-services.test.js tests/unit/notification-trust-model-pushup.test.js
rtk npm run check:migrations-manifest
rtk npm run check:types
rtk npm run check:api-routes:self-test
rtk npm run check:api-routes
rtk npm run check:atlas:self-test
rtk npm run check:atlas
rtk npm run check:fact-consistency:self-test
rtk npm run check:fact-consistency
rtk npx next build --webpack
```
