# Session 455 Prompt: Close Frozen Distribution Review Findings

## Session 454 Summary

Session 454 completed the pricing-canary correction and built the first
cross-system frozen Pre-Site distribution implementation on
`codex/frozen-pdf-distribution`. The branch is deliberately unmerged and must
remain isolated until the independent review findings below are fixed and
re-reviewed. No migration, deployment, Production snapshot, Dynamics activity,
or email send occurred.

### What Was Completed

1. **The Claude 5 pricing canary was corrected.**
   - Commit `47051aba` updated model capability/resolution and pricing surfaces so
     Sonnet medium resolves to Sonnet 5 while intentional Haiku and Opus choices
     remain intact.
   - Focused pricing, resolver, and LLM-client tests were added or updated.

2. **Frozen Pre-Site DOCX/PDF distribution became source-built.**
   - Commit `8a240e77` adds an authenticated Workbench flow to retain the exact
     current Word version, optionally derive PDF from the retained Word item,
     preview the complete message, and send DOCX, PDF, or both through Dynamics.
   - Known staff/consultant addresses receive syntax normalization,
     deduplication, and To/Cc conflict rejection. The owner explicitly rejected
     an identity-confidence or directory-membership gate for this workflow.
   - The exact preview binds source/version/hash, selected attachment identities,
     recipients, subject/body/template, sender, and Dynamics actor.
   - Postgres migration 034 defines the attempt/recovery ledger; SharePoint plus
     Request Document rows own retained file identity; Dynamics owns the email.
   - Per-attachment receipts, a send-intent marker, a lease, correlation recovery,
     and status readback support exact retry without creating another activity.

3. **The implementation passed its scoped source verification.**
   - Six focused suites passed 55/55 tests.
   - TypeScript, scoped ESLint, migration manifest, API security, Atlas,
     route/service boundary, trust-boundary GUID, Dataverse access/context,
     OData, wiki, symbol, fact, documentation, and build-claim gates passed.
   - `npm run build -- --webpack` completed successfully with only the existing
     dynamic-dependency warnings.

4. **Independent Claude review found promotion-blocking gaps.**
   - Claude identified itself as `claude-fable-5` and left a local, gitignored
     report at
     `outputs/codex-handoff-frozen-distribution-review-2026-08-23.md`.
   - Codex independently traced the cited callers and confirmed nine actionable
     findings. The possible Dynamics subject limit remains an unverified live
     metadata preflight item, not a confirmed code defect.
   - The existing durable design resolves the report's apparent product question:
     guarded reopen must remain allowed after both prepared and sent
     distributions because each retained snapshot preserves what earlier
     recipients saw and a later Word version begins a new preview/send cycle.

5. **The session ended without promotion or external side effects.**
   - Migration 034 was not applied.
   - The feature branch was not merged into `main` and did not auto-deploy.
   - No live Graph, Dataverse, Dynamics email, or Postgres business write was
     performed for this feature.
   - The stop-time claim-evidence report could not read local observation state;
     no observation row was fabricated.

### Commits

- `47051aba` — fix pricing canary for Claude 5 models
- `8a240e77` — feat(workbench): add frozen pre-site distribution

## Next Items

### Verified Open

1. **Exclude distribution snapshots consistently from editable Pre-Site lifecycle consumers.**
   Evidence: `lib/services/pre-site-visit/reopen-service.js` `assertNoDownstream`;
   `lib/services/pre-site-visit/artifact-service.js` `wordRows`, `pendingRow`,
   `priorReady`, and `activeReadyWords`; producer prefix
   `request-workbench-distribution` in `distribution-service.js`.
   Required behavior: retained distribution DOCX/PDF rows never block guarded
   reopen, surface as pending drafts, get superseded by draft activation, or make
   activation readback report a false conflict. Use one deliberately shared or
   exactly mirrored predicate across all affected consumers and add
   discriminating fixtures that contain a distribution row.

2. **Make the direct Dynamics send path fail closed on disabled impersonation.**
   Evidence: `lib/services/dynamics/write-core.js` `_withCallerId` omits
   `MSCRMCallerID` unless `DYNAMICS_IMPERSONATION_ENABLED === 'true'`, while only
   composed `createAndSendEmail` currently preflights `noFallback`.
   Required behavior: `sendPreSiteDistribution` rejects before any Dynamics write
   when the authenticated actor is present but impersonation is not explicitly
   enabled. Do not change the behavior-frozen shared write primitives.

3. **Close retained-file conversion and version-identity races.**
   Evidence: PDF conversion uses the snapshot item's current content, and
   `GraphService.uploadFile` can return `cTag` where distribution code expects a
   native publication version.
   Required behavior: prove the Word snapshot version/eTag remains the confirmed
   input across PDF conversion; after upload, read stable metadata by drive/item
   and persist only its native `publication.versionId`, failing closed when it is
   absent or changed.

4. **Persist the Dynamics activity identity before exact round-trip assertions.**
   Evidence: `assertEmailActivityMatches` currently runs before
   `recordEmailActivity`; Dynamics HTML normalization could otherwise leave every
   retry recovering the same unpersisted draft and failing forever.
   Required behavior: once create or unique correlation recovery yields one
   activity ID, fence/persist that ID before validating exact content. A mismatch
   must still fail closed and must never create a replacement activity.

5. **Restore schema and deployment-contract parity.**
   Evidence: migration 034 names all CHECK constraints; the fresh-install v40
   mirror uses anonymous CHECKs. The lifecycle plan also removed the unresolved-
   recipient tenant probe without evidence that the tenant supports raw
   `addressused` consultant recipients.
   Required behavior: use the migration's constraint names in
   `scripts/setup-database.js` and restore unresolved-recipient behavior as an
   explicit pre-deployment go/no-go probe. Do not apply migration 034 yet.

6. **Obtain a fresh independent re-review after fixes.**
   Evidence: the current Claude review is a findings handoff, not approval.
   Required behavior: run all focused distribution suites plus affected
   pre-site artifact/reopen suites and relevant gates, commit the fixes on this
   branch, then request a read-only Claude Opus/Fable review. Promotion remains
   blocked until actionable findings close.

7. **Continue standing organic-use observations without manufacturing evidence.**
   Evidence: `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md`,
   `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`, and
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`.
   Description: accumulate real Dynamics Explorer and Stage II outcomes; do not
   generate synthetic staff traffic or shared-roster rows.

### Blocked on External Input

1. **Explorer campaign Phases C-D.**
   Evidence: `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` Section 4.
   Blocked on 10-20 real Southern California questions and owner answers about
   population-served and `_socal` program-area usage.

### Owner Decision Needed

1. **After 2026-09-02, retain or remove the Stage II rollout flag.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`.
   Re-probe the live environment and replacement deployment before changing it.

### Parked

1. **Frozen distribution release operations.** Apply/read back migration 034,
   deploy, run authenticated read-only UI verification, and perform a separately
   approved controlled send only after fixes and re-review.
2. **Site Visit logistics and governed supporting-file dossier.** Map live
   Dataverse facts before proposing schema.
3. **AkoyaGo publication projection.** Complete signed-in AkoyaGo, historical
   path/filename, Power Automate, and non-governed SharePoint discovery first.
4. **Final Writeup copy transaction.** Freeze and copy an exact Site Visit-stage
   source version/hash only after the earlier lifecycle slices are closed.
5. **`NEXTAUTH_SECRET` rotation and Sensitive conversion.** Reopen only with a
   coordinated session-invalidation window.

### Verify Before Acting

1. **Dynamics `email.subject` maximum length.** Claude suspected the standard
   field may be 200 characters while source accepts 500. Verify tenant metadata
   before promotion; do not change the limit from memory alone.
2. **Unresolved-recipient behavior.** Probe the non-production tenant before any
   live consultant send. Runtime currently creates To/Cc parties with raw
   `addressused` and no party lookup.
3. **Dynamics round-trip behavior.** Verify description/address fidelity,
   correlation consistency, status-code meanings `{3,6,7}`, and repeated
   `SendEmail` behavior on the same activity before Production proof.
4. **Migration 034.** Apply only through `node scripts/apply-migrations.js` after
   source fixes and review approval; then read back the exact table/constraints.
5. **Production Dataverse reads are owner-run.** Never set
   `DATAVERSE_ALLOW_PROD_READS` in an agent session.
6. **Request `1002379` remains an audited guarded-reopen successor.** Do not
   regenerate or start another Site Visit handoff without new exact durable-write
   approval.

### Do Not Reopen Without New Decision

1. Automatic email on Site Visit promotion; the owner chose explicit preview
   and send of DOCX, PDF, or both.
2. Identity-confidence or directory-membership gating for the known
   staff/consultant distribution workflow.
3. Editing the preserved Review row in place; correction uses a separately
   audited Draft successor.
4. Treating an AkoyaGo-visible publication as a second editable source of truth.

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/pre-site-visit/distribution-service.js` | Frozen source/snapshot, preview, Dynamics recovery, and history coordinator |
| `lib/services/pre-site-visit/distribution-store.js` | Postgres attempt ledger and fenced step receipts |
| `lib/db/migrations/034_pre_site_distribution_attempts.sql` | Existing-database distribution ledger migration, not applied |
| `lib/services/pre-site-visit/artifact-service.js` | Current/pending Pre-Site projection and Ready activation consumers needing snapshot exclusion |
| `lib/services/pre-site-visit/reopen-service.js` | Guarded reopen downstream check needing snapshot exclusion |
| `shared/components/workbench/PreSiteDistributionPanel.js` | DOCX/PDF/both compose, preview, send, and history UI |
| `lib/dataverse/adapters/email-activity.js` | Dynamics activity/attachment reads and granular writes |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Canonical frozen-distribution and later-version contract |

## Testing

```bash
rtk npx jest --runInBand tests/unit/pre-site-distribution-service.test.js tests/unit/pre-site-distribution-panel.test.js tests/unit/email-activity-adapter.test.js tests/unit/graph-service-versions.test.js tests/unit/dynamics-service-caller-id.test.js tests/unit/site-visit-tab.test.js
rtk npm run check:types
rtk npm run check:api-routes
rtk npm run check:atlas
rtk npm run check:dataverse-access-layer
rtk npm run build -- --webpack
```

