# Session 449 Prompt: Observe Stage II and Close Passive Safety

## Session 448 Summary

Session 448 closed the owner-approved large-image business smoke, corrected the
route-local response warning exposed by that smoke, cleaned up the merged image
fix branch, and completed the signed-in Phase II document display smoke.

### What Was Completed

1. **The controlled staff replacement smoke passed end to end**
   - Production Request `1002788` accepted the exact 9,564,384-byte PNG with
     SHA-256
     `1b8663c98764d70af416bfa6a0bf3a0b1b5befc1cfa8ad6cae6f785dea4e8f14`.
   - The staging row reached `consumed`/`ok`, the exact temporary Blob was gone,
     the scanner allowed the clean file, SharePoint and Dataverse committed,
     and the Awardee image rendered at 4755×4615.
   - The impersonated Dataverse PATCH returned 403 because ordinary staff lack
     Global Write on the organization-owned table; the designed service-
     principal retry returned 2xx. The owner accepted that fallback without a
     staff-role expansion. Staff replacement correctly sent no notification.

2. **The valid large image no longer creates the default response warning**
   - PR #127 / commit `68979db3` raised only the grantee-image route's Next.js
     response warning threshold above the existing 10 MiB product contract.
   - Ready deployment `dpl_GxXEy525EkJNJPir1DNFqcaDHoLi` served the image with
     HTTP 200, and the old 4 MiB warning did not recur.
   - Merged branch `codex/grantee-image-response-limit` was deleted locally and
     from `origin` after verification.

3. **The Phase II Proposal-tab display smoke passed**
   - Request `1002788` correctly showed an empty Phase II section, so populated
     production Request `1002379` was used for the read-only smoke.
   - The tab displayed ten exact filenames: `Bibliography.pdf`,
     `Biographical Sketches.pdf`, `Collaborative Arrangements.pdf`,
     `Financial Narrative.pdf`, `Graphical Abstract.pdf`, `Project Budget.pdf`,
     `Project Narrative.pdf`, `Proposal Abstract.docx`,
     `Proposal Cover Page.docx`, and `Recognition Statement.docx`.
   - `Bibliography.pdf` opened through View in Chrome's inline PDF viewer and
     downloaded as a valid 756,947-byte PDF. The production proxy returned 200
     and its terminal Graph drive-item read returned 2xx. PDFs expose View and
     Download; the three DOCX files correctly expose Download only.

### Commits

- `68979db3` - raise the grantee-image route response warning threshold

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

3. **Re-probe and close Track A passive safety.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` still
   carries the completed 48-hour window as open guidance.
   Reconcile collection against the now-live Log Drain before interpreting or
   closing the old export procedure.

### Owner Decision Needed

1. **Choose an approved request for the Site Visit handoff smoke.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` marks the signed-in
   Draft→Review handoff smoke open.
   The action records a durable milestone and locks Pre-Site regeneration, so
   do not click it without explicit request approval.

2. **After 2026-09-02, retain or remove the Stage II rollout flag.**
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
2. Re-probe the live Stage II environment before changing/removing its flag;
   `NEXT_PUBLIC_` changes require a new build.
3. Reconcile the Track A plan with the live Log Drain before collecting or
   interpreting closeout evidence.

### Do Not Reopen Without New Decision

1. A multipart fallback or proxy-matcher exclusion for large grantee images;
   both were falsified by the measured Function transport boundary.
2. Another string-side institution checker or Stage III authority flip based
   only on the 25-case Stage II benchmark.
3. A separate Site Visit Writeup or Dataverse staff-observations memo.
4. Routine Vercel CLI update reminders without a concrete incompatibility.
5. The direct-upload business smoke: Request `1002788` closed it on 2026-08-20.
   Reopen only for a new regression signal or a changed storage/scanner contract.
6. The Phase II Proposal-tab display smoke: populated Request `1002379` closed
   filename, View, and Download verification on 2026-08-20. Reopen only for a
   regression signal or a changed SharePoint listing/proxy contract.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/LARGE_UPLOAD_DIRECT_BLOB_REMEDIATION_PLAN.md` | Incident evidence, direct-upload contract, release proof, and completed staff smoke |
| `lib/services/portal-upload-staging.js` | Actor-bound staging, lease/idempotency, reconciliation, and exact-path cleanup |
| `lib/db/migrations/031_portal_upload_staging.sql` | Existing-database staging ledger migration |
| `pages/api/external/grantee/[token]/upload-token.js` | External token mint route |
| `pages/api/external/grantee/[token]/submit.js` | External JSON finalizer |
| `pages/api/workbench/grantee-deliverables/replacement-upload-token.js` | Staff replacement token mint route |
| `pages/api/workbench/grantee-deliverables/replace-submission.js` | Staff JSON finalizer |
| `scripts/probe-private-blob-client-access.mjs` | Disposable private-store and exact-payload gate |
| `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` | Stage II rollout and observation gate |
| `docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md` | Phase II display contract and completed production smoke |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Site Visit handoff contract and open signed-in smoke |

## Testing

The upload release passed 669 Jest suites / 8,636 tests, the canonical Production
build, migration-manifest, Atlas, API-route, documentation, fact-consistency,
secret-scan, and agent-invariant gates. The exact supplied PNG passed the live
private Blob transport/privacy probe. Post-deploy checks confirmed a Ready
deployment, fail-closed route matching, required Production configuration,
zero staging rows before approved use, a healthy canonical sign-in route, and
no release-window errors. Claim-evidence reporting was unavailable because local
advisory state could not be read; no observation row was added.

The later owner-approved Request `1002788` staff smoke passed the exact-payload
token → private Blob → JSON finalize → scanner → SharePoint → Dataverse path.
The staging row consumed with matching bytes/hash and its temporary Blob was
gone; the Awardee image rendered in Production after PR #127, with no recurrence
of the default 4 MiB response warning.

The signed-in Proposal tab on populated Request `1002379` displayed all ten
Phase II files. Representative View and Download actions for
`Bibliography.pdf` reached the production proxy with 200 responses and terminal
Graph 2xx reads; the downloaded 756,947-byte artifact was a valid PDF.

The Session 448 claim-evidence pilot report returned zero advisory events and
zero claims, so no observation row was eligible.
