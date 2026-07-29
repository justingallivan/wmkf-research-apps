# Session 386 Prompt: Build the governed Initial Assessment pilot

## Session 385 Summary

Session 385 closed the review-synthesis production rollout, worked through the
remaining Request Workbench lifecycle design questions with the owner, and
established the first deadline-bound delivery slice: a human-in-the-loop Initial
Assessment pilot by 2026-08-10. The design work is committed and pushed on
`main` through merge commit `5c685da7`.

### What Was Completed

1. **Review-synthesis rollout closeout**
   - Confirmed the production lifecycle rollout, controlled automatic smoke,
     cleanup, two smoke-discovered fixes, and final zero-eligible probe were
     complete.
   - Production automation remains enabled. The final Ready deployment remains
     `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1`.

2. **Governed writeup architecture**
   - SharePoint Word is the canonical editable narrative; Dataverse is the
     typed registry/workflow authority.
   - Initial Assessment, Pre Site Visit Writeup, and Final Writeup are three
     separate documents. Final is copied from the latest Pre-Site version at
     action time, with a rare explicit regeneration path that preserves prior
     Final content.
   - Site Visit is a dossier rather than a fourth writeup.
   - The planned staff-wide Editor Dashboard preserves Allison's single-list
     editing workflow while supporting all PDs and designated proofreaders.
   - SharePoint body search, native version recovery, least-privilege editing,
     and immutable Board milestone snapshots are required parts of the design.

3. **Pre-Site and Site Visit contracts**
   - Pre-Site proposal material uses an iterated governed
     `phase-ii.summarize`; review analysis uses
     `review-synthesis.generate` over all submitted reviews.
   - The Site Visit date—not review completeness—governs distribution.
     Zero-review distribution is valid; late reviews refresh only the synthesis
     layer and must not silently overwrite edited Word prose.
   - The Site Visit dossier contains visit logistics, applicant slides, other
     applicant materials, recording, transcript, transcript summary, and one
     paste-friendly staff-observations area.
   - Applicant materials use a manually staff-triggered, request-scoped shared
     link for the liaison and/or PI. It expires 60 days after successful send.
     Resend preserves the link/expiry; Reissue safely replaces it.
   - Applicant uploads are PDF/PPTX, up to 1 GB each and 20 current files per
     request, with explicit recoverable delete/replace. SharePoint stores bytes;
     Dataverse holds the registry; Postgres holds only expiring-link/resumable
     workflow state.

4. **Initial Assessment pilot and starting content contract**
   - The first fixed gate is a real human-in-the-loop pilot by 2026-08-10,
     before proposal intake begins around 2026-08-18.
   - The pilot must exercise real proposal/Dataverse inputs, governed prompt
     execution, canonical SharePoint Word creation and human editing, typed
     Dataverse registry/provenance, Workbench and Editor Dashboard discovery,
     and one safe failure/retry path.
   - Four D26 Phase I examples established a provisional one-page starting
     structure: applicant-submitted proposal title, institution, Summary, and
     Rationale sections for Significance & Impact, Research Plan, Team
     Expertise, and Foundation Opportunity.
   - Foundation Opportunity is staff-authored and must remain visibly
     incomplete until staff fills it.
   - The Initial Assessment uses `akoya_title`, not the later house-style Keck
     title in `wmkf_wmkfprojectdescription`. The current Workbench resolver
     already supplies `akoya_title`.
   - The exact format remains in flux during the single-phase transition. The
     D26 structure is a versioned-template starting point, not a permanent
     layout contract.

5. **Multi-machine handoff**
   - The feature history was reconciled with the content-identical rollout
     commit already on `main`, then fast-forwarded to `main` as `5c685da7`.
   - A stale local `main` line containing three older documentation commits was
     preserved non-destructively as
     `codex/local-main-preserved-20260728`; local `main` was recreated from
     authoritative `origin/main`. Do not merge the preservation branch without
     a fresh content review because its old tree predates the shipped
     review-synthesis implementation.
   - The owner has separately preserved `.env.local` in an editable/restorable
     format.
   - On the office machine, a fresh clone of the default `main` branch contains
     this handoff. Restore `.env.local`, run `npm ci`, and then invoke `/start`.

### Commits

- `70dba3c8` — Document governed writeup artifact contract
- `60163cc7` — Document cycle-wide editor dashboard
- `39f5601e` — Document site visit dossier and upload plan
- `353f095b` — Define pre-site writeup input contract
- `27c79dfb` — Define site visit dossier content contract
- `235cdd9c` — Refine site visit applicant upload contract
- `10eb3703` — Set site visit materials request trigger
- `6956d84a` — Define site visit materials recipients
- `2ebc8430` — Define shared applicant materials access
- `d06df4c2` — Define site visit materials request timing
- `ffda9b3f` — Set applicant materials link expiry
- `5957d0d6` — Define applicant link resend and reissue
- `1459f450` — Set materials request staff access
- `2c934632` — Record site visit email sender action item
- `0f0eeb08` — Refine site visit materials upload contract
- `150918f6` — Lock site visit applicant file defaults
- `e3921b23` — Lock remaining Workbench design decisions
- `8470d1d5` — Define August Initial Assessment pilot
- `be27fdd1` — Define Initial Assessment template inputs
- `d2e68229` — Use applicant title for Initial Assessments
- `0f7e16e5` — Document Session 385 and create Session 386 prompt
- `5c685da7` — Reconcile the feature history with `main`

## Next Items

### Verified Open

1. **Build the governed Initial Assessment pilot.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`;
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`;
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.
   Build the smallest complete producer → SharePoint artifact → Dataverse
   registry → Workbench/Editor Dashboard read path needed for the 2026-08-10
   human pilot. No implementation exists yet for this new document flow.

2. **Run the Q9 ordinary-user app-access smoke in the office.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`;
   `.claude-memory/project-app-access-control.md`.
   Use another person's ordinary staff account in Preview while the owner
   performs and reverses the bounded grant/revoke steps. Do not substitute the
   owner's superuser account.

### Owner Decision Needed

1. **Pilot proposal, human testers, environment, and exact schedule.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.

2. **First approved Initial Assessment prompt/template pair.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.
   The D26 structure is only the starting point; preserve the decided
   applicant-title and staff-authored Foundation Opportunity requirements.

3. **Artifact registry and SharePoint target-library controls.**
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.
   Finalize exact Dataverse schema plus SharePoint version, restore, recycle,
   retention, permission, and milestone-snapshot behavior.

4. **Later Site Visit operational details.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.
   Sender/reply-to and lead-PD copy behavior require staff coordination.
   Notification audience/window, large-file scanner, and transcript workflow
   also remain open.

### Parked

1. General applicant intake while WMKF evaluates GOApply re-engineering. The
   narrow Site Visit Materials Upload does not reopen it.
2. Automated BILL onboarding; honorarium payment remains offline.
3. Retired-table script deletion/quarantine without a new owner-approved scope.
4. Public Git history rewriting or repository cleanup without a separate
   explicit authorization and fresh preflight.

### Verify Before Acting

1. A fresh office clone of `main` must resolve to `5c685da7` or a later commit
   before `/start`; no feature-branch switch is now required.
2. Restore `.env.local`, run `npm ci`, and let `/start` verify the per-machine
   memory and `.agents/skills` symlinks before feature work.
3. Re-probe live Dataverse/SharePoint state before schema, migration, or
   production claims. The new Initial Assessment flow remains planned.
4. Re-read the live governed prompt rows before publishing or modifying any
   prompt.
5. Treat `codex/local-main-preserved-20260728` as recovery-only historical
   provenance, not an integration candidate; its three commits sit on a stale
   pre-rollout tree.

### Do Not Reopen Without New Decision

1. Do not use `wmkf_wmkfprojectdescription` as the Initial Assessment title;
   use the applicant-submitted `akoya_title`.
2. Do not backfill the D26 Initial Writeup placeholder.
3. Do not make review count a Pre-Site distribution gate.
4. Do not create a fourth Site Visit Writeup.
5. Do not mirror the editable Word body into a competing Dataverse memo.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical delivery sequence |
| `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | Lifecycle decisions and August pilot |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Governed artifact/storage contract |
| `lib/services/workbench/resolve-request-service.js` | Existing request metadata, including applicant title and institution |
| `lib/services/grantee-title-service.js` | Later Keck-title producer; not the Initial Assessment title source |
| `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md` | Office ordinary-user smoke contract |

## Testing

The session's documentation changes passed:

```bash
rtk npm run check:doc-currency
rtk npm run check:doc-currency:self-test
rtk npm run check:fact-consistency
rtk npm run check:fact-consistency:self-test
rtk npm run check:docs-catalog
```

On the office machine, `/start` must run the complete current `check:*` gate
inventory and each applicable self-test sequentially.
