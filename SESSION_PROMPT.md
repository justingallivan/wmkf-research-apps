# Session 514 Prompt: Use the shipped-state brief; keep reviewer-institution authority off

## Session 513 Summary

Session 513 reconciled a dense parallel release window. Start with `/start`, then use
`docs/audits/shipped-features-last-24-hours-2026-09-15.md` as the bounded release summary and
re-probe mutable external state before acting on it.

### What Was Completed

1. **Phase II Reviews-tab writeup material shipped.** PR #296 added deterministic review
   count/score, reviewer roster/rank/institution/expertise paragraphs, v4 themes and
   server-verified quotations, rich-text Copy, Word panel-prep export, and the new Pre-Site
   `[[STAFF:RefereeSection]]` fill. Production Request `1002852` passed the signed-in smoke.
2. **Roster Contact links shipped and were backfilled.** PR #301 added governed
   `expertise_roster.dataverse_contact_id` links and live active-Contact email resolution;
   migration 050 is applied. The owner-approved backfill linked ten active rows (four Board, six
   Consultants). Five Board rows were deliberately deferred because they are not needed this
   cycle. PR #303 recorded closeout.
3. **Meeting Tracker and Review Panel follow-ups shipped.** PR #294 disables attendee choices
   without a usable email and returns a named actionable error. PR #298 improved Review Panel
   narrow-screen navigation, 44-pixel action targets, keyboard focus, and contrast. A fresh
   Production probe found Meeting Tracker Wave 28 at 22 exact / 0 absent / 0 divergent with its
   readiness flag exact-on; Review Panel remains live in `access` mode.
4. **Reviewer-institution Phase 2 landed dormant after two adversarial reviews.** PR #304 added
   the evidence/receipt/evaluator and prospective measurement contracts. The second Claude
   review found no merge-blocking defect, but the high-authority rollout prerequisites remain
   open. `REVIEWER_INSTITUTION_PHASE2` and `REVIEWER_INSTITUTION_MEASUREMENT` remain off.
5. **Migration 051 and the tracker were reconciled.** PR #305 applied
   `051_reviewer_institution_measurement_events.sql` as empty dormant storage, verified its exact
   schema and zero rows, removed the obsolete byte-identical `038_cycle_dossiers.sql` tracker
   alias while retaining canonical migration 045, and cleared the migration-drift alert. Final
   tracker state was 50/50 with no missing or extra migrations.
6. **A rolling 24-hour shipped-features brief was created.** Commit `5ea883ab` records the five
   Production-facing features separately from dormant reviewer-institution work. The same sweep
   corrected stale current Meeting Tracker and Review Panel documentation.

### Commits and releases

- `9dd57264` — PR #294, Meeting Tracker missing-email attendee guard.
- `b9ad64eb` — PR #296, Reviews-tab writeup paragraphs and exports.
- `2d152715` — PR #298, Review Panel mobile usability.
- `17c314b3` — PR #301, roster Contact linking and migration 050.
- `ec21fd95` — PR #303, roster Contact-link production closeout.
- `622c9f63` — PR #304, dormant reviewer-institution evidence contracts.
- `85a3ecb4` — PR #305, migration 051 Production reconciliation.
- `5ea883ab` — last-24-hours release brief and current-state doc reconciliation.

## Next Items

### Verified Open

1. **Wednesday 2026-09-16 operations meeting.** The active agenda remains in
   `.claude-memory/project-ops-meeting-2026-09-16-agenda.md`: decide the applicant-materials
   reminder schedule/effects, the PC manual-reminder race, and disabled-worker cron cadence.
   After the meeting, record decisions in the owning plans and close the memory.
2. **Select the next repository priority from current evidence.** Re-probe
   `docs/CURRENT_WORK_QUEUE.md`, active project memories, source, and any relevant live state;
   this handoff does not promote an arbitrary backlog item merely because it is listed.

### Owner Decision Needed

1. **Reviewer-institution Phase 3/enablement.** Before any high-authority activation, define and
   review the source-specific dated-currentness policy, finish v2 policy/card/remedy projection,
   add the remaining exact call-set/partial-batch/rendered-state and frozen 40-case regressions,
   and take a separate owner decision for each consumer. Evidence:
   `docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md` § Immediate next work.
2. **Prospective measurement activation.** Migration 051 being present does not authorize data
   collection. Enabling `REVIEWER_INSTITUTION_MEASUREMENT` requires a separate owner-approved
   measurement decision, including the threshold/sample policy declared before results are read.

### Parked

1. **Five Board Contact links:** Kent Kresa, Richard N. Foster, Robert A. Bradway, Thomas E.
   Everhart, and William R. Brody. Re-open when one is needed for an attendee flow or the owner
   requests a broader roster cleanup. Evidence: `docs/plans/ROSTER_CONTACT_LINK_PLAN_2026-09-14.md`.
2. **Consultant profile deep links.** No stable shared profile-route/access contract exists;
   re-open only after that contract is explicitly decided.

### Verify Before Acting

1. Keep `REVIEWER_INSTITUTION_PHASE2` and `REVIEWER_INSTITUTION_MEASUREMENT` unset/off. Exact-on
   would activate incomplete high-authority behavior; migration 051 alone is safe dormant storage.
2. Do not recreate `038_cycle_dossiers.sql` in `schema_migrations`. Canonical migration 045 owns
   the byte-identical dossier schema; the obsolete tracker alias was deliberately removed.
3. Do not treat Meeting Tracker as awaiting Production activation. Wave 28 and exact-on readiness
   were reverified 2026-09-15. Agenda transport remains the narrower unproved boundary.
4. Existing Pre-Site drafts are not retroactively rewritten with the new referee section; regenerate
   or create a new draft when that output is required.

### Do Not Reopen Without New Decision

1. Reviewer-institution Phase 2 is merge-complete as dormant code; the two Claude reviews are
   evidence, not authorization to enable it.
2. Migration 051 and the 038/045 tracker reconciliation are complete. Future schema changes use a
   forward migration; do not edit the applied migration.
3. The ten approved roster Contact links are complete. Broken linked Contacts fail visibly and do
   not fall back to stale copied email.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/audits/shipped-features-last-24-hours-2026-09-15.md` | Exact rolling-window release brief and evidence matrix |
| `docs/plans/REVIEWS_TAB_WRITEUP_PARAGRAPHS_PLAN_2026-09-14.md` | Reviews-tab writeup/export contract and Production proof |
| `docs/plans/ROSTER_CONTACT_LINK_PLAN_2026-09-14.md` | Contact-link contract, backfill, and deferred rows |
| `docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md` | Dormant Phase 2 state and Phase 3 prerequisites |
| `docs/audits/reviewer-institution-migration-051-production-reconciliation-2026-09-15.md` | Migration/tracker/flag evidence |
| `docs/PC_MEETING_TRACKER_PLAN.md` | Production-live Meeting Tracker state and agenda boundary |
| `.claude-memory/project-ops-meeting-2026-09-16-agenda.md` | Next dated operational decision point |

## Testing

```bash
npm run check:agent-invariants
npm run check:atlas && npm run check:atlas:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run check:agent-wiki && npm run check:agent-wiki:self-test
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test
npm run check:docs-catalog
```

The Session 513 `report:claim-evidence-pilot -- --current` call could not read local advisory state,
so no pilot observation row was added.
