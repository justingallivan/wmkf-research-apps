# Session 444 Prompt: Persist and Finish the Pre-Site Draft

## Session 443 Summary

Session 443 established the final-cycle Phase I/Phase II proposal-source rules, built and tested
the Pre-Site Visit Word draft, published the governed v3 prompt, and recorded the owner's
Dataverse persistence direction. The feature branch is now merged into the local
`codex/pre-site-draft-schema` integration branch but is not deployed. At the Session 443 close there was no Pre-Site Draft schema or business-data
write path. In Session 444, owner-approved Wave 19 was applied to Production
and independently read back as 14 exact metadata items; the business-data
writer remains unbuilt and no Pre-Site row was created.

### What Was Completed

1. **Canonical AI narrative source established**
   - Initial Assessment and Field Primer use the exact
     `AI Materials/ProposalNarrative_{Request#}.pdf` convention for this final two-phase cycle.
   - Owner decision 2026-08-17 established a second exact file,
     `AI Materials/ProposalBibliography_{Request#}.pdf`. Multi-source Claude callers keep it
     separate from the narrative and fingerprint both exact sources. Pre-Site integration source
     now implements that reader; Reviewer Finder adoption remains next-cycle work.

2. **Pre-Site proposal core and Word renderer built on the integration branch**
   - The proposal core combines the exact separate narrative and bibliography with read-only Dataverse request,
     organization, budget, and personnel data and validates eight named output sections.
   - The authenticated interim route renders a Word download from in-memory validated output; it
     does not yet persist a business draft or artifact.
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
   - The test intentionally created no `wmkf_ai_run`: the local-to-Production Dataverse audit write
     is interlocked, so this is not governed Production-run evidence. The accepted v2 Executor run
     remains the latest governed run.
   - The four-page visual inspection passed the requested name underlining. The final Methodology
     sentence still spills to page four, and the Recommendation label/placeholder spacing remains
     a separate minor template issue.

4. **Dataverse persistence schema applied; writer still planned**
   - Current branch behavior remains pass-through-only: target kind `none`, in-memory rendering,
     and the normal Executor's raw `wmkf_ai_run` audit are not an editable business record.
   - Owner direction is Request parent → versioned Pre-Site Draft child → exact-version Word/PDF
     artifacts. The eight generated sections are sibling editable Multiline Text columns on one
     draft row, not one child row per section.
   - Wave 19 now supplies the eight named Multiline Text fields, two JSON
     snapshots, render fingerprint, content type, and the current Pre-Site/Final
     request lookups in Production. Post-apply readback reported 14 exact and 0
     divergent; inventory remained three Initial Assessment rows and no
     Pre-Site row.

5. **Session evidence bookkeeping attempted**
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

## Next Items

### Verified Open

1. **Build the durable Pre-Site adapter/writer on the live Production schema.**
   The 2026-08-17 owner-approved Wave 19 apply created 12 Request Document
   fields plus two Request pointers. Independent Production readback reported
   14 exact, 0 absent, and 0 divergent. Exact external narrative/bibliography
   provenance belongs in the versioned input-snapshot source manifest rather
   than ambiguous single-source Graph columns. No adapter or writer selects the
   fields yet, and the post-apply inventory confirmed no Pre-Site row was
   created. Before preview/sandbox runtime uses these fields, that target must
   pass the same preflight and schema apply.

2. **Use the approved cross-tab Word lifecycle.**
   `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` records the 2026-08-17 owner decision: the Pre-Site
   Word document remains the PD workspace during the Site Visit stage; staff enter observations
   directly in Word; Site Visit supporting files are separately registered; and Final copies the
   exact current Pre-Site row/version/hash into a new governed Word document. There is no Site
   Visit Writeup or Dataverse staff-observations field.

3. **Review and deliberately promote the integration branch.**
   `codex/pre-site-draft-schema` now contains the former proposal feature branch plus the
   production-applied schema contract, lifecycle plan, and two-input reader. The authenticated route is not Production-live.
   Live prompt v3 is still single-source; publish and verify a new immutable two-input prompt
   version before promotion.

4. **Close the Track A passive safety window after 2026-08-18 00:53:40Z (2026-08-17
   17:53:40 PDT).**
   Retain the Session 442 closeout contract in
   `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`. This remains a safety observation,
   not a campaign-launch blocker.

### Owner Decision Needed

1. **Accept the v3 page spill or tighten a v4 prompt.**
   Decide whether the soft one-page Background/Methodology goal is adequate or whether to target
   roughly 500–540 combined words and publish v4. The Recommendation spacing fix can proceed
   independently of prompt content.

2. **Optional Stage 1 browser-bundle guards.**
   Retain the prior choice only if desired; these guards are unrelated to Pre-Site persistence and
   are not required for the campaign or Track A closeout.

### Parked

1. **Next-cycle Reviewer Finder cutover to the decided two-file AI Materials contract.**
2. **Phase II applicant-intake portal pending the GOApply evaluation.**

### Verify Before Acting

1. Production Wave 19 is already applied and exact. Do not assume sandbox or
   another Dataverse target has it; preflight and apply that target before
   runtime `$select` includes the new fields there.
2. Do not treat the direct v3 Request 1002379 test as a governed Production Executor run.

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

The feature branch passed focused Pre-Site unit and integration tests, type checking, prompt gates
and self-tests, API-route gates and self-tests, documentation gates and self-tests, and a webpack
production build. The rendered Request 1002379 Word draft received four-page visual inspection.
Only the repository's previously documented dynamic-import build warnings remained.
