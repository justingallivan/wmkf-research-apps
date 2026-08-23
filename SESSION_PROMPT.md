# Session 456 Prompt: Release Frozen Pre-Site Distribution Safely

## Session 455 Summary

Session 455 closed the material plan and code review findings for frozen Pre-Site
distribution on `codex/frozen-pdf-distribution`. The branch remains isolated from
`main`. No migration was applied, deployment was promoted, Dynamics activity was
created, or email was sent.

### What Was Completed

1. **The lifecycle now recognizes retained distribution snapshots exactly.**
   - `[SOURCE-VERIFIED]` `request-workbench-distribution-docx` and
     `request-workbench-distribution-pdf` are the only classified distribution
     producers; missing and lookalike values fail closed.
   - Retained DOCX/PDF rows no longer block guarded reopen, appear as editable
     drafts, get superseded by draft activation, or create false activation
     conflicts. Other descendants and competing generations still block.
   - A stale prepared send cannot cross a guarded reopen: the source pointer and
     native version are checked under the send lease and again immediately before
     transport.

2. **Dynamics send and recovery contracts now fail closed.**
   - Exact sent receipts remain read-only and retryable when impersonation is off;
     every non-sent attempt requires literal
     `DYNAMICS_IMPERSONATION_ENABLED=true` before acquiring a lease or writing.
   - A recovered or newly created activity ID is fenced into Postgres before exact
     content assertions. Correlation ambiguity and recovery errors are preserved
     instead of being swallowed.
   - The send lease is renewed immediately before `SendEmail`; losing it blocks
     transport.

3. **Graph snapshot identity and reuse are stable.**
   - `[SOURCE-VERIFIED]` Metadata read by stable drive/item ID is authoritative;
     provisional upload/path tags are not treated as native publication versions.
   - PDF conversion proves the retained Word native version/eTag before and after
     conversion.
   - Ready reuse requires a stable metadata window plus exact size, byte, and hash
     proof. Byte-identical metadata drift refreshes the registry row with an
     eTag-conditional update; content drift fails closed.

4. **Fresh-install and existing-database schemas are reconciled in source.**
   - Setup and migration 034 use the same eight named CHECK constraints.
   - Migration 034 reconciles known anonymous legacy constraints before adding
     any missing canonical constraints.
   - `[NOT LIVE]` Migration 034 remains source-declared but unapplied; the expected
     source/live difference is recorded in `docs/RECONCILIATION_REPORT.json`.

5. **Claude Opus review was bounded and resolved once.**
   - The plan review found four material gaps: stale sends after reopen, lease
     expiry at transport, swallowed recovery ambiguity, and legacy constraint
     reconciliation. All four were incorporated before implementation.
   - The code review found two material Graph issues: byte-identical Ready rows
     could dead-end after metadata drift, and provisional upload tags could cause
     a false first-prepare conflict. Both were corrected in one pass.
   - No additional review loop was started; nits and speculative tail-chasing were
     intentionally excluded.

6. **The corrected implementation passed scoped verification.**
   - Seventeen focused suites passed 207/207 tests.
   - Five targeted mutation checks each proved its lifecycle exclusion fixture
     failed when the corresponding exclusion was removed.
   - Migration, API-route, Atlas, enum, TypeScript, documentation, build-claim,
     Dataverse boundary, lifecycle authorization, service-boundary, agent,
     instruction, and memory gates passed with their required self-tests.
   - `npm run build -- --webpack` passed with only existing dependency and
     `localStorage` warnings.

### Commits

- `0167a8b3` — fix(pre-site): harden frozen distribution contracts
- `acad76c4` — fix(pre-site): reconcile settled snapshot metadata

## Primary Next Steps

### Owner Authorization Required

1. **Apply and read back migration 034 in the intended database.**
   - Reconfirm the target and current live shape first.
   - Apply only with `node scripts/apply-migrations.js`; never use
     `scripts/setup-database.js` on an existing database.
   - Read back `schema_migrations`, all columns, eight named CHECK constraints,
     unique constraints, and indexes before treating the ledger as live.

2. **Deploy the feature branch through the governed release path.**
   - Follow `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`; do not merge
     runtime work directly into `main` merely to obtain a test deployment.
   - Confirm the deployment has the literal impersonation and Dataverse interlock
     settings before any write-path exercise.

3. **Approve a controlled non-production Dynamics preflight and recipient.**
   Verify before any Production send:
   - the tenant's `email.subject` maximum length;
   - raw `addressused` unresolved-recipient behavior;
   - description, address, and correlation round-trip fidelity;
   - status-code meanings `{3,6,7}`;
   - repeated `SendEmail` behavior for the same activity.

4. **After migration and deployment, run authenticated read-only UI verification.**
   Confirm compose, frozen preview, DOCX/PDF selection, history, and guarded reopen
   behavior without sending.

5. **Perform one separately approved controlled non-production send/readback.**
   Use an explicitly approved recipient and exact artifact selection. Production
   proof remains a separate authorization boundary.

### Standing Organic Observation

1. Continue accumulating real Dynamics Explorer and Stage II outcomes under
   `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md`,
   `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`, and
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Do not manufacture
   staff traffic or shared-roster evidence.
2. Explorer campaign Phases C-D remain blocked on 10-20 real Southern California
   questions and owner answers about population-served and `_socal` program-area
   usage.
3. After 2026-09-02, re-probe the live environment and replacement deployment
   before deciding whether to retain or remove the Stage II rollout flag.

### Parked

1. Site Visit logistics and its governed supporting-file dossier, pending live
   Dataverse fact mapping.
2. AkoyaGo publication projection, pending signed-in AkoyaGo, historical
   path/filename, Power Automate, and non-governed SharePoint discovery.
3. Final Writeup copy transaction, until the earlier lifecycle slices close.
4. `NEXTAUTH_SECRET` rotation and Sensitive conversion, until a coordinated
   session-invalidation window exists.

### Do Not Reopen Without a New Decision

1. Automatic email on Site Visit promotion; the owner chose explicit preview and
   send of DOCX, PDF, or both.
2. Identity-confidence or directory-membership gating for known
   staff/consultant recipients.
3. Editing a preserved Review row in place; correction uses an audited Draft
   successor while earlier distribution snapshots remain retained.
4. Allowing an unsent preview prepared against an earlier source version to send
   after guarded reopen.
5. Repeating plan or code review without a new material change or finding.
6. Treating an AkoyaGo-visible publication as a second editable source of truth.

## Operational Gotchas

1. Only the exact producer names ending in `-docx` and `-pdf` are distribution
   snapshots; broader prefix matching would weaken lifecycle blockers.
2. An exact sent retry may read its receipt with impersonation disabled. Any
   non-sent path must reject unless the flag is literally `true`.
3. Stable-ID Graph metadata owns native version/eTag. Ready-row metadata may be
   refreshed only after stable-window and exact byte/hash proof.
4. `docs/RECONCILIATION_REPORT.json` should continue to show migration 034 as
   source-declared/live-absent until the authorized migration and readback finish.
5. Production Dataverse reads are owner-run. Never set
   `DATAVERSE_ALLOW_PROD_READS` in an agent session.
6. Request `1002379` remains an audited guarded-reopen successor. Do not
   regenerate or start another Site Visit handoff without exact durable-write
   approval.

## Key Files Reference

| File | Purpose |
|---|---|
| `shared/config/requestDocument.js` | Exact shared distribution contract and classifier |
| `lib/services/pre-site-visit/distribution-service.js` | Frozen source/snapshot, preview, Dynamics recovery, and send coordinator |
| `lib/services/pre-site-visit/distribution-store.js` | Attempt ledger, send lease, and fenced receipts |
| `lib/db/migrations/034_pre_site_distribution_attempts.sql` | Existing-database ledger migration; not applied |
| `scripts/setup-database.js` | Fresh-install mirror with canonical named constraints |
| `lib/services/pre-site-visit/artifact-service.js` | Editable lifecycle projection and activation |
| `lib/services/pre-site-visit/reopen-service.js` | Guarded reopen descendant checks |
| `lib/services/graph-service.js` | Stable metadata, version, and byte retrieval |
| `lib/dataverse/adapters/email-activity.js` | Dynamics email activity and attachment adapter |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Canonical lifecycle and release contract |

## Testing

```bash
rtk npx jest --runInBand tests/unit/pre-site-distribution-service.test.js tests/unit/pre-site-distribution-panel.test.js tests/unit/request-document-distribution.test.js tests/unit/pre-site-visit-artifact-service.test.js tests/unit/pre-site-visit-reopen-service.test.js tests/unit/email-activity-adapter.test.js tests/unit/graph-service-versions.test.js tests/unit/dynamics-service-caller-id.test.js
rtk npm run check:migrations-manifest
rtk npm run check:types
rtk npm run check:api-routes
rtk npm run check:atlas
rtk npm run check:dataverse-access-layer
rtk npm run check:agent-invariants
rtk npm run build -- --webpack
```
