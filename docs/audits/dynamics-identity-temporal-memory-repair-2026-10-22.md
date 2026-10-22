# Bounded memory repair: Dynamics identity, schema discovery, and temporal axes

**Status:** bounded reconciliation completed on 2026-10-22; parent review complete for these five repairs. This is not a whole-repository sweep certification. The Luna editing agent ran no gates, live probes, environment reads, sends, or commits. The parent independently reviewed the changes and source branches; only documentation was changed in this batch.

## Scope

Five memories were whole-read and repaired:

- `.claude-memory/project-dynamics-explorer-schema-diff.md`
- `.claude-memory/project-dynamics-identity-reconciliation.md`
- `.claude-memory/akoya-temporal-axis-encodings.md`
- `.claude-memory/project-interim-report-automation.md`
- `.claude-memory/project-phase-i-summary-app-winddown.md`

No other durable surfaces were edited by this batch. The cross-agent review census was an initial bounded census of 304 memory files/paths: 272 active, 38 whole-read (37 active and 1 closed), leaving 235 active unreviewed in that census. This count is not total unique session coverage and does not certify the remaining memories.

## Evidence and repairs

- **Dynamics Explorer schema discovery — [VERIFIED via source].** `lib/services/dynamics-explorer/tools/describe-table.js:24-34,52-79,120-136` combines curated descriptions with fetched live readable attributes and returns the complete extra-field list for `full: true`; unknown-to-curation tables can still return live field metadata. `shared/config/prompts/dynamics-explorer.js:22-25,579-580` defines curated annotations and directs missing-field discovery. The memory now distinguishes live discoverability from curated semantic descriptions. `scripts/dynamics-schema-diff.js` remains the repository curation comparison; sample mapping is a different, population-based question. No live Dataverse schema was queried.

- **Identity and attribution — [VERIFIED via source; environment evidence is dated].** `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md:19` and `docs/CREDENTIALS_RUNBOOK.md:202` record `DYNAMICS_IMPERSONATION_ENABLED=true` in Production from S271 and owner re-verification at S466 (2026-08-27). This is recorded as a dated receipt, not a fresh environment check. The reviewer thank-you sweep supplies an explicit Program Director system-user ID and `noFallback: true` (`lib/services/reviewer-thankyou-sweep.js:107-117`); `lib/services/dynamics/write-core.js:101-115` and `lib/services/dynamics/email.js:333-363` preserve the no-fallback/403 behavior. Request Document actor tracking is a separate owner-selected contract: service-principal write plus explicit actor fields (`lib/services/request-document-actor-service.js:18-39,97-113,164-169`; `lib/dataverse/adapters/request-document.js:282-307`). Current guidance now distinguishes session impersonation, intentional unattended no-human paths, explicit worker identity, and request-document actor tracking. The older S129 smoke checklist remains labeled historical; dated flag receipts do not prove that independent checklist complete.

- **Temporal axes and Workbench — [VERIFIED via source; population data is historical].** `shared/components/workbench/WorkbenchShell.js:77-147,297-329` loads the shared cycle list, applies an explicit URL cycle or shell default, and passes the selected cycle to Final Writeups, Initial Assessments, and Awardees. `shared/components/workbench/InitialAssessmentsPanel.js:21-56` consumes the supplied cycle. `shared/components/final-writeups/FinalWriteupsViews.js:552-578,633-694,805-814` supports an explicit cycle selector and manual newest-cycle fallback; this is not automatic cycle selection. Awardees gets the shell cycle and offers last-decided as an alternative. The memory now preserves explicit off-month/null-cycle safety guidance while requiring consumer-specific evidence before claiming a sentinel is built. The S162 meeting-date population figures remain explicitly dated to the 2026-05-18 evidence snapshot; no live Dataverse query was run. Original design analysis and owner decisions were retained verbatim under a superseded historical-snapshot boundary.

- **Interim report automation — [STALE direction superseded by owner decision].** The 2026-10-21 owner note `.claude-memory/project-grant-reporting-rework.md` leaves destination, scope, and timing undecided. The older memory now retains its evaluation purpose and reusable bucket/Graph plumbing while marking the small Grant Reporting UI and PA-callable endpoint as historical proposal, not approved destination. Old access checks are not treated as current authorization.

- **Phase I investment guidance — [PARTIAL, scoped].** The Phase I summary app remains a retained prompt/reference surface, not proven current usage. The Grant Reporting app remains registered (`shared/config/appRegistry.js:131-139`) and its extract route remains present (`pages/api/grant-reporting/extract.js:43-45`); the 2026-10-21 direction concerns future product home and does not retire or disable the app. The memory now directs readers to revisit standalone Grant Reporting investment before making recommendations and preserves earlier Phase I direction as historical context.

## Verification boundary

The source references above were checked with CodeGraph before source-level documentation edits; relevant memory and owner-direction files were read whole before editing. Source status does not establish current Production configuration beyond the dated S271/S466 receipt. No live tenant state, deployment, current SharePoint contents, or active usage was probed. Parent review confirmed the live-discovery source path, conditional noFallback behavior, scheduler email identity, explicit actor-policy branches, shared shell cycle propagation, manual empty-cycle navigation, dated flag receipts, and newer owner-direction conflict. The complete original temporal-analysis body was independently compared with committed source and retained exactly under the historical boundary. Applicable final documentation checks are recorded in the companion audit index.

## Initial Sol whole-read inventory

All paths are under `.claude-memory/`. This is the initial bounded census sample,
not all unique leaves read by every agent during the session. Its complement in
the 304-leaf census was metadata-only in that pass; 235 active leaves remained
outside the whole-read sample. Source verification was selective, as described above.

```text
project-dynamics-explorer-details.md
project-dynamics-explorer-schema-diff.md
project-dynamics-explorer-reuse-power-tools.md
project-irs-exempt-verification.md
project-grant-phasing-evolution.md
project-grant-lifecycle-states-confirmed.md
project-living-taxonomy-principle.md
project-cache-hit-rate-review.md
dataverse-export-floor-scoping.md
project-dynamics-crm-limitations.md
project-dynamics-explorer-socal-campaign.md
project-dynamics-explorer-serializer-deferred.md [closed]
project-grantee-waiver-versioning.md
project-interim-report-automation.md
project-phaseistatus-decision-lifecycle.md
project-research-special-grants-in-cohorts.md
project-grant-reporting-rework.md
akoya-temporal-axis-encodings.md
project-dynamics-ai-writeback.md
project-dataverse-power-tools.md
project-dataverse-settings-audit-enablement.md
project-dynamics-sandbox-state.md
project-dynamics-identity-reconciliation.md
project-dynamics-email.md
project-dynamics-crm-users.md
project-a7-prompt-injection-hardening.md
project-app-access-control.md
project-admin-dashboard.md
project-dataverse-creator-privileges.md
project-deferred-code-cleanup.md
project-phase-i-summary-app-winddown.md
project-appresearcher-collapse-post-pilot.md
project-download-proxy-parked.md
project-intake-portal-parked.md
project-intake-portal-skinny-scope.md
project-intake-portal-ui-todo.md
project-dataverse-odata-null-filter.md
project-dataverse-batch-changeset-available.md
```

The later Grant Reporting follow-up also whole-read the owner-direction note and
adjacent backend, capability, system-model, and strategy memories. Those additional
reads do not change the initial sample's denominator or certify its complement.
