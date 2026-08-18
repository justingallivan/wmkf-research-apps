# Session 444 Prompt: Production-Prove and Continue the Pre-Site Lifecycle

## Session 443 Summary

Session 443 established the final-cycle Phase I/Phase II proposal-source rules, built and tested
the Pre-Site Visit Word draft, published the governed v3 prompt, and recorded the owner's
Dataverse persistence direction. At the Session 443 close there was no Pre-Site
Draft schema or business-data write path. In Session 444, owner-approved Wave
19 was applied to Production and independently read back as 14 exact metadata
items. The durable business-data writer, JSON-returning Workbench route, stable
Word-link UI, and narrative-only source contract were promoted to `main` in
commit `abfe5529`. Production Request `1002379` then created the first Ready
Pre-Site row, linked AI run, request pointer, and stable SharePoint Word
document. An exact Ready retry returned the same row/run/item without a
duplicate or second model call.

### What Was Completed

1. **Canonical AI narrative source established**
   - Initial Assessment and Field Primer use the exact
     `AI Materials/ProposalNarrative_{Request#}.pdf` convention for this final two-phase cycle.
   - Owner decision 2026-08-17 established a second exact file,
     `AI Materials/ProposalBibliography_{Request#}.pdf`. Pre-Site, Initial Assessment, and Field
     Primer use and fingerprint only the narrative. Reviewer Finder will use the separate
     bibliography at the next-cycle cutover to draw reviewer leads from cited authors.

2. **Pre-Site proposal core and Word renderer built on the integration branch**
   - The proposal core combines the exact Proposal Narrative with read-only Dataverse request,
     organization, budget, and personnel data and validates eight named output sections.
   - The earlier authenticated direct-download route was replaced locally by a
     durable writer. It claims a Request Document row, persists the eight named
     sections and immutable snapshots, renders from Dataverse readback, uploads
     a stable Word item, and returns a registry DTO with the governed file identity.
   - Formatting fixes cover metadata alignment and spacing, the 1 pt Executive Summary divider,
     first-page bullet spacing, and the stray pre-break paragraph.
   - Personnel output is one paragraph, omits degrees, uses PI/co-PI, and underlines personnel
     names in both the first-page overview and detailed section.

3. **Governed single-source prompt v3 published and tested**
   - Sole-current prompt `pre-site-visit.proposal-core.generate` v3 has Dataverse id
     `f2c9ce97-f499-f111-b8db-7ced8d6e2f44` and model `claude-sonnet-4-6`; inherited runtime
     settings were retained from v2.
   - A controlled Request 1002379 direct application-LLM test used the exact live single-source v3 prompt and
     normal untrusted-input boundaries. It produced 574 combined Background/Methodology words and
     145 Personnel words, with no degrees and correct PI/co-PI formatting.
   - That direct test intentionally created no `wmkf_ai_run`; it is now
     superseded as current evidence by the governed Production v3 run
     `ba0f42b9-849a-f111-b8db-6045bd008868` for Request `1002379`.
   - The direct four-page visual inspection passed the requested name underlining. Its final
     Methodology sentence spilled to page four. The later Production v1 render fit Background and
     Methodology on page three but exposed a separate Recommendation label/value spacing issue;
     deployed template v2 fixed that spacing; the later signed-in generation exposed
     a separate width-sensitive Word Online alignment defect now targeted by local template v3.

4. **Dataverse persistence schema and durable writer production-proved**
   - The branch now uses the Request Document registry as the editable business
     record. The Executor audit remains append-only provenance rather than the
     business-data source.
   - Owner direction is Request parent → versioned Pre-Site Draft child → exact-version Word/PDF
     artifacts. The eight generated sections are sibling editable Multiline Text columns on one
     draft row, not one child row per section.
   - Wave 19 supplies the eight named Multiline Text fields, two JSON snapshots,
     render fingerprint, content type, and the current Pre-Site/Final request
     lookups in Production. Post-generation inventory now reports four Request
     Document rows: three Initial Assessments and one Ready/Draft Pre-Site row.
   - Request `1002379` row `aeb223a2-849a-f111-b8db-70a8a59cded0` is the current
     pointer target and owns Ready Word file
     `1002379 Pre-Site Visit 33abef48-077dddbd.docx`. Its immutable source
     manifest contains exactly `ProposalNarrative_1002379.pdf`; no bibliography
     source is present.
   - The writer fails before claiming a row when the exact narrative is missing
     or when the current governed prompt does not declare exactly the context
     and narrative variables. Exact Ready retries reuse the existing row/run/file;
     later partial failures retain a retryable row and recover a matching upload
     without another Claude call or duplicate upload.

5. **Historical request entry deployed**
   - The Production Workbench dashboard now has an exact “Open request by number” launcher
     backed by the existing authenticated `resolve-request` route. It opens
     active or historical requests in the same per-request Workbench without
     changing their status or the active-cycle dashboard population.
   - Broader historical discovery by institution, PI, proposal title, cycle,
     and request status is owner-decided future work. It should be a Workbench
     locator/search whose results open the existing request page; pagination,
     query bounds, result projection, and authorization semantics remain to be
     designed. The existing Expertise Finder historical-proposals service
     supplies a useful projection and fiscal-year/program query precedent, but
     it uses the separate `expertise-finder` grant and is not itself the
     Workbench search contract.

6. **Session evidence bookkeeping attempted**
   - `report:claim-evidence-pilot -- --current` ran during `/stop`, but local state was unavailable.
     No canonical observation row was added.

### Feature-Branch Commits

- `badc0d1b` — Use AI proposal narrative for governed analysis
- `2b0d0e0a` — Draft pre-site visit proposal core prompt
- `739e2480` — Refine pre-site visit personnel and model ownership
- `f10dff3f` — Harden pre-site prompt model publishing
- `e16bfea9` — Build guarded pre-site proposal core renderer
- `39f129ea` — Fix pre-site metadata table spacing
- `cdd2d766` — Refine pre-site summary divider
- `e77f44e6` — Make pre-site divider 1pt
- `c979156c` — Add Pre-Site Visit Word draft download
- `abda6686` — Use valid Pre-Site AI run source
- `4048159a` — Validate Pre-Site proposal prompt output
- `4b71fecf` — Fix Pre-Site first-page paragraph spacing
- `2023671a` — Refine Pre-Site narrative and personnel output
- `fd8dbfd7` — Record Pre-Site prompt v3 controlled render
- `b19d27ee` — Underline personnel names in both summaries
- `abfe5529` — Use narrative only for Pre-Site drafts and deploy the durable writer

## Next Items

### Verified Open

1. **Complete the signed-in smoke of the deployed recovery/template fix.**
   The first Production request took about 47 seconds and completed durably,
   but the browser surface displayed `Failed to fetch`. After read-only
   confirmation of the Ready row, an exact retry returned the same stable Word
   link without another run, row, or upload. **[DEPLOYED TO PRODUCTION
   2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** commit `1ac01405` reached Ready
   deployment `dpl_EzNRXmcG2NVQawGNKMMdUN3crpZg`; the route has a read-only
   GET status path, the tab loads
   the current artifact on entry, and a lost POST response triggers bounded GET
   polling without issuing another POST. Production template v2 added the missing
   Recommendation value-cell padding and created artifact
   `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6`, but Word Online exposed a second
   width-sensitive alignment defect despite explicit centered-cell formatting.
   **[INFERRED FROM SCREENSHOT + OOXML WIDTH]** implicit wrapping was the
   remaining layout variable. **[DEPLOYED TO PRODUCTION 2026-08-17; SIGNED-IN
   FEATURE SMOKE OPEN]** template v3 makes that label explicitly
   non-wrapping and changes the governed generation identity again, preserving
   both earlier Ready documents.
   The same Ready production deployment, `dpl_58hstAQNBP8ATqfBXtYczC9tFziE`
   from main commit `96c63f0f`, includes the compact Pre-Site panel: it hides the
   long workflow explanation behind
   an accessible help control. Before a draft exists it shows Generate Word
   Draft; when Ready it shows Edit, Download, and confirmation-guarded
   Regenerate Word Draft actions plus one compact status line. Regeneration
   preserves the existing deterministic reuse contract: unchanged governed
   inputs may return the current artifact rather than forcing another model run.
   Before preview/sandbox runtime uses Wave 19 fields, that target must still
   pass the same preflight and schema apply.

2. **Use the approved cross-tab Word lifecycle.**
   `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` records the 2026-08-17 owner decision: the Pre-Site
   Word document remains the PD workspace during the Site Visit stage; staff enter observations
   directly in Word; Site Visit supporting files are separately registered; and Final copies the
   exact current Pre-Site row/version/hash into a new governed Word document. There is no Site
   Visit Writeup or Dataverse staff-observations field.

3. **Continue the approved Site Visit and Final lifecycle.**
   The Pre-Site producer is Production-live and proven. Site Visit and Final
   remain planned: first map the logistics data and supporting-file registry,
   then implement the exact-version Final copy transaction without replacing
   the Pre-Site Word workspace.

4. **Close the Track A passive safety window after 2026-08-18 00:53:40Z (2026-08-17
   17:53:40 PDT).**
   Retain the Session 442 closeout contract in
   `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`. This remains a safety observation,
   not a campaign-launch blocker.

### Owner Decision Needed

1. **No prompt publication is required for the narrative-only change.**
   Sole-current Production v3 already declares the exact context and
   `proposal_text` variables and matches the tracked body, system, output
   schema, model, and required safety assertions. Any future page-length
   tightening should still publish a new immutable version through Admin.

2. **Optional Stage 1 browser-bundle guards.**
   Retain the prior choice only if desired; these guards are unrelated to Pre-Site persistence and
   are not required for the campaign or Track A closeout.

### Parked

1. **Next-cycle Reviewer Finder cutover to the decided two-file AI Materials contract.**
2. **Phase II applicant-intake portal pending the GOApply evaluation.**
3. **Broader historical Workbench search by institution, PI, title, cycle, and status.**
   Exact request-number opening is already implemented locally; this item is
   the bounded multi-field browse/search experience, not a new standalone app.

### Verify Before Acting

1. Production Wave 19 is already applied and exact. Do not assume sandbox or
   another Dataverse target has it; preflight and apply that target before
   runtime `$select` includes the new fields there.
2. The current governed Production proof is AI run
   `ba0f42b9-849a-f111-b8db-6045bd008868` and Request Document
   `aeb223a2-849a-f111-b8db-70a8a59cded0`. Preserve the earlier direct v3 test
   only as pre-deployment layout history.

### Do Not Reopen Without New Decision

1. One child record per generated section; the working owner direction is one versioned draft row
   with named section columns.
2. Closed Session 442 security and applicant-intake items except where explicitly retained above.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | Pre-Site source, generation, and persistence direction |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Dataverse/SharePoint draft and artifact ownership model |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Cross-tab Pre-Site → Site Visit workspace → Final lineage plan |
| `docs/APPLICATION_STATE_ATLAS.md` | Required entry point for live data ownership inventory |
| `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` | Prompt and execution-audit contracts |
| `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` | Branch, test, and promotion rules |
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | Track A closeout contract |

## Testing

The feature passed focused Pre-Site unit and integration tests, type checking,
prompt/API/documentation gates and self-tests, and a webpack production build.
The exact Production Request `1002379` Word file was downloaded and rendered
to four pages for visual inspection: page-one alignment/amount spacing/divider
and name underlining passed; Background and Methodology fit together on page
three; Personnel is one paragraph on page four with underlined names, PI/co-PI
abbreviations, and no degree listings. **[DEPLOYED TO PRODUCTION 2026-08-17;
SIGNED-IN FEATURE SMOKE OPEN]** production template v2 added 0.1-inch left
padding to the Recommendation value cell. A later controlled generation created
artifact `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6`; its exact SharePoint file
rendered cleanly locally, but Word Online shifted the width-constrained
Recommendation label despite explicit centered-cell formatting. Template
v3 is deployed and locally verified with an explicit no-wrap label; its
no-Claude Request `1002379` fixture rendered cleanly on all three fixture pages.
The signed-in Word Online v3 and compact-action/download smoke remain open.
