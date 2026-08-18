# Session 445 Prompt: Production-Smoke the Site Visit and Proposal Document Flows

## Session 444 Summary

Session 444 finished the Pre-Site Word experience, deployed the guarded
Pre-Site→Site Visit handoff and its confirmation UI, and added the request's
SharePoint `Phase II` files to the Proposal tab. Production is at commit
`83b9c68a`; the latest deployment and branded sign-in health check are Ready.

### What Was Completed

1. **Pre-Site Word draft production UX completed**
   - Added read-only recovery/status polling after a lost long-running POST so
     the browser does not repeat generation after durable completion.
   - Corrected the Recommendation layout for Word Online, simplified the panel
     to Generate/Regenerate, Edit, and Download actions, and linked the latest
     draft filename directly to Word.
   - Request `1002379` remains the production-proved narrative-only generation
     and exact-reuse fixture.

2. **Guarded Site Visit handoff deployed**
   - The transition independently resolves the current Pre-Site row, verifies
     one stable SharePoint item/version before and after DOCX download, records
     the governed hash/version/time, and ETag-conditionally changes Draft→Review.
   - Site Visit continues to use the same Word file; Pre-Site regeneration is
     locked after promotion. No separate Site Visit Writeup or Dataverse
     observations memo was introduced.
   - The Pre-Site tab now presents this as a distinct `Start Site Visit` action
     with a confirmation modal explaining the consequences before mutation.

3. **Phase II Proposal documents deployed**
   - The Proposal tab now has a separate Phase II Documents section containing
     every file beneath the request's SharePoint `Phase II` folder.
   - View/Download remain behind the request-scoped proxy. The proxy authorizes
     only files re-derived by the Proposal listing service; unrelated request
     files remain excluded.
   - Phase I slot matching and the exact AI Materials display are unchanged.

4. **Documentation reconciled**
   - Updated the writeup lifecycle plan, SharePoint model, API security matrix,
     Proposal-tab documentation, agent memory, and Workbench onboarding copy.
   - Added a Session 444 milestone entry because the handoff and Phase II
     document access are new Production capabilities.

5. **Claim-evidence bookkeeping attempted**
   - `report:claim-evidence-pilot -- --current` reported unavailable local
     state, so no observation row was added.

### Commits

- `5dc45b7d` — Document Pre-Site production proof
- `1ac01405` — Recover Pre-Site generation status
- `0f5ce787` — Record Pre-Site production deployment
- `6eeae054` — Fix Pre-Site Recommendation alignment
- `96c63f0f` — Simplify Pre-Site draft actions
- `12648053` — Record Pre-Site UI production deployment
- `27b88275` — Link latest Pre-Site draft filename
- `32b16f5f` — Build guarded Site Visit handoff
- `5f316a29` — Clarify Site Visit stage transition
- `83b9c68a` — Show Phase II documents in Proposal tab

## Next Items

### Verified Open

1. **Read-only smoke the Phase II document display.**
   Evidence: commit `83b9c68a`, Ready deployment
   `dpl_BiottKiZuBra2xpfv8quSaZ8jjVM`, and focused listing/UI/download tests.
   Open a request with known `Phase II` files and confirm filenames plus
   View/Download in the signed-in Workbench. This does not mutate the request.

2. **Run the elapsed Track A passive-safety closeout.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` records
   the 48-hour window opened at `2026-08-16 00:53:40Z`; that interval has
   elapsed. Measure total dependency events/day, malformed/invalid events,
   throttling/truncation, visible cost, and unexpected `unknown` classifications.
   Absence of target-route traffic is explicitly not a failure.

3. **Plan the next Site Visit dossier slice and Final copy transaction.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` and
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`. First map existing Dataverse
   logistics fields/relationships and the five registered file categories;
   then design the exact-version Final copy without overwriting the Pre-Site
   workspace.

### Owner Decision Needed

1. **Choose an approved request for the signed-in Site Visit handoff smoke.**
   Evidence: commits `32b16f5f`/`5f316a29` and the deployed guarded route.
   The action is a durable Draft→Review transition that records a milestone and
   locks Pre-Site regeneration, so do not click it on a request without explicit
   approval. Confirm that Edit/Download still target the same Word item afterward.

### Parked

1. Next-cycle Reviewer Finder cutover to the separate Proposal Narrative and
   Bibliography AI Materials inputs.
2. Broader historical Workbench search by institution, PI, title, cycle, and
   status. Exact request-number opening is already Production-live.
3. Phase II applicant-intake portal pending the GOApply evaluation.

### Verify Before Acting

1. Wave 19 is exact in Production, but another Dataverse target must pass the
   same preflight and schema apply before runtime uses its Pre-Site fields.
2. Site Visit logistics/supporting-file persistence and Final creation remain
   planned; do not describe their schemas or routes as provisioned.

### Do Not Reopen Without New Decision

1. A separate Site Visit Writeup or Dataverse staff-observations memo.
2. Combining Proposal Narrative and Bibliography into one canonical AI PDF.
3. One child Dataverse record per generated Pre-Site section.

## Key Files Reference

| File | Purpose |
|---|---|
| `shared/components/workbench/ProposalTab.js` | Reviewer Materials, AI Materials, Phase I, and Phase II display |
| `lib/services/workbench-proposal-documents.js` | Scoped SharePoint Proposal document classification |
| `lib/services/workbench/download-proposal-document-service.js` | Exact listed-file download authorization |
| `shared/components/workbench/PreSiteVisitTab.js` | Pre-Site actions and Site Visit confirmation UI |
| `lib/services/workbench/pre-site-visit-service.js` | Governed Pre-Site writer and lifecycle guards |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Pre-Site→Site Visit→Final contract |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | SharePoint/Dataverse document ownership model |

## Testing

The Phase II change passed 30 focused listing, service, route, download-security,
and UI tests; API-security/documentation gates and self-tests passed; the webpack
production build passed. The Site Visit handoff passed focused service, route,
and component coverage for exact success, idempotent retry, stale UI, SharePoint
version races, ETag conflicts, regeneration lock, modal cancellation, and
request-switch cancellation. Vercel deployments for `5f316a29` and `83b9c68a`
reached Ready; `https://applications.wmkeck.org/auth/signin` returned HTTP 200,
and the deployment error scans were clean. Signed-in handoff and live Phase II
folder display smokes remain open.
