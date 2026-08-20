# Session 448 Prompt: Complete Controlled Upload Smoke and Observe Production

## Session 447 Summary

Session 447 completed credential housekeeping, diagnosed the repeat 9.12 MiB
grantee-image failure as a pre-handler transport rejection, built durable direct
private-Blob staging for the two live grantee-image consumers, iterated with
Claude Opus to ship-ready consensus, and promoted the release to Production.

### What Was Completed

1. **Credential housekeeping was completed without exposing values**
   - The Azure AD client secret was rotated and the application configuration
     continued to complete Azure SSO under `AZURE_AD_CLIENT_SECRET`.
   - `CRON_SECRET` was rotated in Production and local configuration.
   - `NEXTAUTH_SECRET` was identified as the NextAuth session-signing/encryption
     secret, distinct from the local-environment file. Its Vercel sensitivity
     warning/rotation was explicitly set aside by the owner.

2. **The repeat upload incident was reconstructed**
   - The reporter's 1:53 PM email aligned with a successful portal/context load
     around 1:49 PM but no submit POST or application upload marker.
   - The supplied PNG is valid: 9,564,384 bytes, 4755×4615, accepted by the
     application validator, SHA-256
     `1b8663c98764d70af416bfa6a0bf3a0b1b5befc1cfa8ad6cae6f785dea4e8f14`.
   - Live no-write probes established that the 9.12 MiB request was rejected
     before handler code, including on a proxy-excluded real Function. The
     affected grantee must not be asked to retry.

3. **Durable direct private-Blob staging shipped**
   - External grantee submission and staff replacement now mint actor/resource-
     bound private Blob tokens, upload image bytes directly, and finalize with
     small JSON requests.
   - Migration 031 adds `portal_upload_staging` for ownership, lease/retry,
     idempotency, candidate reconciliation, and exact-path cleanup.
   - Reauthorization, magic-byte validation, virus scanning, SharePoint and
     Dataverse behavior, notification semantics, and sanitized client-failure
     Operational Events remain enforced.

4. **Adversarial review and exact-payload verification passed**
   - Claude Opus found and drove fixes for crash reconciliation, terminal retry,
     notification-skipped recovery, private response-shape handling, and the
     probe's redirect mismatch.
   - Its final verdict was **SHIP READY** with no remaining blockers.
   - The exact supplied PNG passed the runtime-identical private-store gate:
     public PUT rejected, private PUT accepted, anonymous manual-redirect HEAD
     returned 403, and the disposable Blob was deleted.

5. **Production promotion and safe checks passed**
   - `main` advanced to `1f31afdf`; initial runtime deployment
     `dpl_AKWrYmBjCaPy8LCuiwKRzdKoFz9d` reached Ready and acquired all
     application aliases.
   - Production has the required upload and virus-scan configuration. The new
     token route matched and failed closed with 401 for an invalid token.
   - `portal_upload_staging` existed with zero rows after promotion, the
     canonical sign-in route returned 200, and the release-window error query
     returned no logs.

### Commits

- `8d1f2a43` - plan direct staging for large portal uploads
- `b73dddb8` - route grantee images through durable direct Blob staging
- `0dd3d808` - harden upload crash reconciliation and terminal retries
- `6b3a905e` - record Opus ship-ready review consensus
- `20631c7c` - record Preview release evidence
- `1f31afdf` - close exact-payload release verification

## Next Items

### Verified Open

1. **Observe Stage II Production outcomes through 2026-09-02.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` records the
   exact-on Production state and organic-observation window.
   Sample naturally produced Stage II DTOs for false-clear risk,
   informational-alert volume, and whether compatible/historical copy reduces
   manual review. Do not manufacture shared-roster rows.

2. **Run a staff acceptance smoke of reviewer identity remediation.**
   Evidence: `docs/REVIEWER_CONTACT_LEADS_SPEC.md` and shipped commits
   `d9c29c7d` through `5fcd913c`.
   Use a reviewer genuinely intended for an invite list and confirm the card
   names the problem and exposes the exact next action before any durable
   promotion.

3. **Finish the read-only Phase II document display smoke.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` and commit `83b9c68a`.
   Formally record filenames plus both View and Download end to end; keep the
   smoke read-only.

4. **Re-probe and close Track A passive safety.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` still
   carries the completed 48-hour window as open guidance.
   Reconcile collection against the now-live Log Drain before interpreting or
   closing the old export procedure.

### Owner Decision Needed

1. **Choose and approve a Production record for the direct-upload business smoke.**
   Evidence: `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md` §§9.2 and 15.
   Use the exact supplied PNG through the approved external-grantee or staff
   replacement flow, then verify the SharePoint/Dataverse result, one
   notification, consumed staging state, byte cleanup, and clean operational
   evidence. Do not use the affected grantee as the tester.

2. **Choose an approved request for the Site Visit handoff smoke.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` marks the signed-in
   Draft→Review handoff smoke open.
   The action records a durable milestone and locks Pre-Site regeneration, so
   do not click it without explicit request approval.

3. **After 2026-09-02, retain or remove the Stage II rollout flag.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` records Stage
   II as Production-live behind an exact-on public build flag.
   Re-probe the live environment and replacement deployment before changing it.

### Parked

1. **`NEXTAUTH_SECRET` rotation and Vercel Sensitive conversion.**
   Evidence: owner decision in Session 447; Vercel metadata still classifies it
   as non-sensitive.
   Reopen only when the owner chooses a coordinated session invalidation window.

2. **Reviewer multipart direct-upload conversion.**
   Evidence: `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md` §8.
   The two reviewer routes have tests and security-matrix entries but no source
   caller was found. Complete consumer discovery and obtain an owner decision
   before changing their request contract.

3. **Stage III institution identity authority.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`.
   Selectability, write vetoes, and identity weighting remain blocked until the
   execution-point contract exists and each consumer is separately approved.

4. **Site Visit dossier/logistics and Final copy transaction.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`.
   Inventory existing Dataverse fields and registered SharePoint categories
   before proposing schema or upload changes.

### Verify Before Acting

1. A rollback may leave additive migration 031 in place; never drop
   `portal_upload_staging` during incident rollback or delete SharePoint content
   referenced by committed Dataverse state.
2. Re-probe live upload configuration and use a named approved record before the
   remaining business smoke; transport evidence alone does not prove the
   SharePoint/Dataverse commit.
3. Re-probe the live Stage II environment before changing/removing its flag;
   `NEXT_PUBLIC_` changes require a new build.
4. Reconcile the Track A plan with the live Log Drain before collecting or
   interpreting closeout evidence.

### Do Not Reopen Without New Decision

1. A multipart fallback or proxy-matcher exclusion for large grantee images;
   both were falsified by the measured Function transport boundary.
2. Another string-side institution checker or Stage III authority flip based
   only on the 25-case Stage II benchmark.
3. A separate Site Visit Writeup or Dataverse staff-observations memo.
4. Routine Vercel CLI update reminders without a concrete incompatibility.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md` | Incident evidence, direct-upload contract, release proof, and remaining smoke |
| `lib/services/portal-upload-staging.js` | Actor-bound staging, lease/idempotency, reconciliation, and exact-path cleanup |
| `lib/db/migrations/031_portal_upload_staging.sql` | Existing-database staging ledger migration |
| `pages/api/external/grantee/[token]/upload-token.js` | External token mint route |
| `pages/api/external/grantee/[token]/submit.js` | External JSON finalizer |
| `pages/api/workbench/grantee-deliverables/replacement-upload-token.js` | Staff replacement token mint route |
| `pages/api/workbench/grantee-deliverables/replace-submission.js` | Staff JSON finalizer |
| `scripts/probe-private-blob-client-access.mjs` | Disposable private-store and exact-payload gate |
| `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` | Stage II rollout and observation gate |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Phase II display and Site Visit handoff smokes |

## Testing

The upload release passed 669 Jest suites / 8,636 tests, the canonical Production
build, migration-manifest, Atlas, API-route, documentation, fact-consistency,
secret-scan, and agent-invariant gates. The exact supplied PNG passed the live
private Blob transport/privacy probe. Post-deploy checks confirmed a Ready
deployment, fail-closed route matching, required Production configuration,
zero staging rows before approved use, a healthy canonical sign-in route, and
no release-window errors. Claim-evidence reporting was unavailable because local
advisory state could not be read; no observation row was added.
