# Session 459 Prompt: Map Site Visit Logistics After Proven Distribution

## Session 458 Summary

Session 458 completed the first explicitly approved Production frozen Pre-Site
distribution for Request `1002379`. The full prepare, preview, send, history,
and independent readback path is now Production-proved at Dynamics transport
level. Retained artifacts and receipts remain audit evidence; inbox delivery is
not yet independently verified.

### What Was Completed

1. **The request and live state were verified before mutation.**
   - `[VERIFIED via Production Dataverse/Workbench]` Request `1002379`
     (`54e2b88b-04b9-f011-bbd3-6045bd02b4cc`) was in Review with current
     Pre-Site row `888982b6-0a9f-f111-b8dc-7ced8d3d15a6`, source version `1.0`,
     and no distribution ledger row.
   - The owner named `jgallivan@wmkeck.org`, approved the PDF-only preview, and
     separately confirmed the live send.

2. **The exact snapshot preview was prepared and independently checked.**
   - Operation `85f52fc5-fb48-4ceb-84d6-0f246af0b6fb` retained Ready/Board Ready
     DOCX row `0b1ac77f-d79f-f111-b8dc-6045bd018a07` and PDF row
     `e28d3283-d79f-f111-b8dc-70a8a59cded0`.
   - The selected PDF is `PreSite_1002379_faa275f3b1b4722e.pdf`, 133,265 bytes,
     SHA-256 `574ac7b833801866c370a8056b7197933addfe3ea5dd535dcf4d29803c18f0c9`.
   - Independent Graph downloads matched the persisted sizes and hashes.

3. **The confirmed Production send completed once.**
   - `[VERIFIED via Postgres]` the ledger reached `sent` in one attempt with no
     error; send was requested at `2026-08-24T16:24:35.965Z` and reconciled at
     `2026-08-24T16:24:38.514Z`.
   - `[VERIFIED via Dataverse]` email activity
     `33ce6346-d89f-f111-b8db-6045bd07a06d` reached Sent (`statuscode=3`,
     `senton=2026-08-24T16:25:01Z`). Sender and To were both
     `jgallivan@wmkeck.org`; `createdBy` matched the authenticated actor.
   - Exactly one MIME attachment existed, with the selected PDF filename,
     content type, size, and SHA-256. Workbench history showed Accepted by
     Dynamics and the Dynamics ID.
   - Dynamics appended `CRM:0153199` to the persisted subject after transport
     acceptance. Preview exactness therefore describes the pre-transport
     subject; inbox delivery remains unverified.

4. **Production observability remained clean.**
   - A bounded error-level Vercel scan after the send returned no entries.
   - The retained DOCX/PDF rows, ledger row, Dynamics activity, and attachment
     were intentionally not deleted; they are the first durable proof set.

5. **Review remained bounded.**
   - Claude OAuth was verified through the subscription session.
   - A read-only Opus release-plan review produced no verdict within the fixed
     timebox and was stopped. Do not claim Opus approval and do not restart a
     review loop without a material new plan or code change.

6. **Durable current-state documentation was reconciled.**
   - The lifecycle/file/schema plans, API matrix, service catalog, state Atlas,
     Postgres Atlas, agent wiki, milestone log, and this handoff now distinguish
     Dynamics Sent proof from recipient inbox delivery.

## Primary Next Step

1. **Map Site Visit logistics to live Dataverse and SharePoint facts.**
   - Start read-only from `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`,
     `docs/APPLICATION_STATE_ATLAS.md`, and the relevant Atlas entity pages.
   - Inventory the desired logistics facts, then identify existing entities,
     fields, relationships, files, and current consumers before proposing any
     schema or route.
   - Label live facts with their probe/source. Propose only genuinely missing
     fields and keep applicant uploads as a separate security-reviewed slice.
   - Use `/contract-reconcile` for the plan. Obtain one bounded Claude Opus plan
     review before implementation; stop after material findings are resolved.

## Verified Open

1. **Recipient inbox confirmation.**
   - Dynamics Sent proves transport acceptance/status, not mailbox delivery.
     Record a user-reported receipt if supplied; do not infer it.

2. **Final-subject behavior.**
   - Dynamics appended its CRM tracking token after acceptance. Treat this as a
     known external transformation. Any requirement for byte-exact final subject
     text needs an owner decision before code or tenant-setting changes.

3. **AkoyaGo publication projection.**
   - Complete signed-in discovery before proposing publication fields, paths,
     relationships, filenames, or Power Automate behavior.

## Verify Before Acting

1. Do not repeat the `1002379` send; its exact operation is complete.
2. Do not delete or supersede the retained snapshots, ledger row, Dynamics
   activity, or attachment. They are Production audit evidence.
3. Re-read live source state before any new lifecycle or file mutation.
4. Final Writeup creation remains a later, separately approval-gated transaction.

## Standing Organic Observation

1. Continue real Dynamics Explorer and Stage II observation under
   `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md`,
   `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`, and
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`.
2. After 2026-09-02, re-probe the live environment and replacement deployment
   before deciding whether to retain or remove the Stage II rollout flag.

## Parked

1. Site Visit governed supporting-file dossier and applicant upload security.
2. AkoyaGo publication projection, pending signed-in discovery.
3. Final Writeup copy transaction, until logistics and publication contracts
   are established.
4. `NEXTAUTH_SECRET` rotation, until a coordinated session-invalidation window.

## Do Not Reopen Without a New Decision

1. Automatic email on Site Visit promotion; distribution remains explicit.
2. Identity-confidence/directory gating for known staff/consultant recipients.
3. Editing a preserved Review row in place; correction uses an audited successor.
4. Broad Opus/Codex review loops without material new plan or code.
5. Treating Dynamics Sent or Pending Send as recipient inbox proof.

## Key Files

| File | Purpose |
|---|---|
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Lifecycle sequence and next logistics slice |
| `docs/APPLICATION_STATE_ATLAS.md` | Cross-system ownership and adapter map |
| `docs/atlas/postgres-infra-tables.md` | Live distribution ledger proof |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Governed file and snapshot contract |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | Route authorization and live-proof status |

## Testing

```bash
rtk npm run check:api-routes
rtk npm run check:api-routes:self-test
rtk npm run check:atlas
rtk npm run check:atlas:self-test
rtk npm run check:agent-wiki
rtk npm run check:agent-wiki:self-test
rtk npm run check:memory-drift:no-write
rtk npm run check:agent-invariants
```
