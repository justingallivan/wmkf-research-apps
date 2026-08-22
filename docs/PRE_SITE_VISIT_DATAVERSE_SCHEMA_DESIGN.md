---
title: Pre-Site Visit Dataverse Schema Design
domain: dataverse
kind: spec
status: active
summary: "Production-live Wave 19 schema, production-proved Pre-Site writer, and deployed Site Visit handoff contract."
canonical: false
cataloged: 2026-08-17
last_verified: 2026-08-21
owner: product-engineering
related:
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - lib/dataverse/schema/wave19-pre-site-draft/01_wmkf_requestdocument_pre_site_draft.json
  - lib/dataverse/schema/wave19-pre-site-draft/02_akoya_request_writeup_pointers.json
  - scripts/preflight-pre-site-draft-schema.mjs
---

# Pre-Site Visit Dataverse Schema Design

## Status and outcome

**[VERIFIED APPLIED 2026-08-17.]** Wave 19 is live in Production. The
owner-approved metadata-only apply created 12 additive
`wmkf_requestdocument` attributes and two `akoya_request` lookup
relationships. Independent post-apply readback classified all 14 items as
exact with zero absent and zero divergent. A separate read-only inventory
still reports three Request Document rows, all Initial Assessments, so the
apply created no Pre-Site business row. No application runtime or SharePoint
artifact was added by the schema operation. **[VERIFIED IN PRODUCTION
2026-08-17]** commit `abfe5529` deployed the adapter, durable writer, JSON
route, and stable Word-link UI. Request `1002379` then created the first Ready
Pre-Site business row and SharePoint Word item; current inventory is four
Request Documents: three Initial Assessments and one Pre Site Visit.

**[DEPLOYED TO PRODUCTION 2026-08-18; SIGNED-IN GENERATION SMOKE OPEN.]**
The Production runtime normalizes valid provider output,
stores content-free editorial diagnostics in proposal-core envelope v3, and
returns those diagnostics as non-blocking Workbench warnings. It retains v2
read compatibility and the deployed v4 DOCX bytes while advancing the render
contract identity to v5. Ready deployment
`dpl_HGogbJnprevoYKLaxevamxdajtC4` is paired with sole-current prompt v4 row
`74409f95-509b-f111-b8db-6045bd008868`; exact prompt readback had zero
mismatches. No request or SharePoint write was used for release verification.

Reuse the existing `wmkf_requestdocument` registry. Do not create a separate
Pre-Site Draft entity. Each generated Pre-Site Word version is one Request
Document row beneath its Request. That row owns the eight named proposal-core
fields, immutable generation snapshots, prompt/run/template provenance, and
the stable SharePoint identity of the Word document. The Request has separate
canonical-current lookups to its active Pre-Site and Final Word rows. There is
no Site Visit writeup lookup because staff add Site Visit observations directly
to the Pre-Site Word workspace.

**[PRODUCTION-PROVED 2026-08-21]** a guarded Site Visit handoff writer promotes
the current Ready/Draft Pre-Site row. It changes that same
row's lifecycle to Review and records the exact verified SharePoint publication
version, governed DOCX hash, and handoff timestamp in the existing
`wmkf_milestone*` fields. It creates no new row, lookup, or SharePoint item.

A PDF distribution copy is a separate Request Document row because one
registry row must identify exactly one SharePoint file. Its
`wmkf_SourceDocument` lookup points to the Word row, and the existing source
version/hash fields identify the exact Word version exported to PDF.

```text
akoya_request
  ├── wmkf_CurrentPreSiteVisit ───────────────┐
  ├── wmkf_requestdocument (Pre Site Visit, Word, current)
        ├── eight named proposal-core fields │
        ├── exact generated/input snapshots  │
        ├── prompt + AI run + template       │
        ├── stable Word file identity ◀──────┘
        ├── Draft → Review + exact Site Visit handoff milestone
        ├── native Word versions then include Site Visit observations
        └── wmkf_requestdocument (Pre Site Visit, PDF)
              └── SourceDocument + exact source version/hash
  └── wmkf_CurrentFinalWriteup ──────────────┐
      wmkf_requestdocument (Final Writeup, Word, current)
        └── SourceDocument + exact Pre-Site version/hash ◀──┘
```

## Evidence and rejected alternatives

| Claim | Strongest evidence | Status |
|---|---|---|
| `wmkf_requestdocument` already represents request-owned, versioned governed artifacts and includes a Pre Site Visit artifact option | Production metadata preflight on 2026-08-17 plus Wave 16 schema and adapter | VERIFIED |
| The 2026-08-17 Production snapshot had four Request Document rows: three Initial Assessments and one Ready/Draft Pre Site Visit | Read-only production inventory after Request `1002379` generation on 2026-08-17; current count requires re-probe | VERIFIED HISTORICAL SNAPSHOT |
| Prompt `pre-site-visit.proposal-core.generate` v4 is sole-current on `claude-sonnet-4-6` and exactly matches the tracked resilience contract | Audited Admin publication plus exact Production readback on 2026-08-18 | VERIFIED LIVE |
| `wmkf_sitevisit` could store the draft | Production metadata shows an empty activity table with no suitable custom content fields; no repository caller was found | VERIFIED (not suitable) |
| `akoya_request.wmkf_researchwriteuptype` could store the draft | Production metadata and row distribution show a Phase I/Phase II classification choice, not content or version persistence | VERIFIED (not suitable) |
| The Workbench Pre-Site route persists a business draft | Request `1002379` created Ready row `aeb223a2-849a-f111-b8db-70a8a59cded0`, governed v3 run `ba0f42b9-849a-f111-b8db-6045bd008868`, stable Word item `01G4GVMS3Q5BJ65S7DDZDKFTSQLIQAIPER`, and the then-current request pointer | VERIFIED HISTORICAL GENERATION PROOF |
| Wave 19 fields and current pointers exist in Dataverse | 2026-08-17 owner-approved apply followed by independent Production preflight: 0 absent, 0 divergent, 14 exact | VERIFIED LIVE |
| The metadata-only Wave 19 apply itself created a Pre-Site business row | Immediate post-apply inventory: three Request Document rows, all Initial Assessments | VERIFIED FALSE (historical apply boundary) |
| The deployed writer later created the first Pre-Site business row | Post-generation inventory plus exact row/run/item/pointer readback for Request `1002379` | VERIFIED LIVE |

The reproducible inventory is
`scripts/probe-pre-site-dataverse-inventory.mjs`. The deployment preflight is
`scripts/preflight-pre-site-draft-schema.mjs`.

## Additive schema

### `wmkf_requestdocument` attributes

All eight narrative fields are optional Memo columns with a 32,000-character
limit. Production prompt v4 uses a 30,000-character technical sink ceiling and
treats the prior word, character, and
paragraph sizes as editorial warning targets. The larger Dataverse capacity
prevents ordinary staff revision from requiring a schema change. The
application still requires all eight normalized sections to be non-empty and
free of unresolved reserved placeholders before persistence and rendering.

| Prompt JSON key | Dataverse logical name | Purpose |
|---|---|---|
| `executiveSummary` | `wmkf_presiteexecutivesummary` | First-page executive summary |
| `impactOverview` | `wmkf_presiteimpactoverview` | First-page impact bullet |
| `methodologyOverview` | `wmkf_presitemethodologyoverview` | First-page methodology bullet |
| `personnelOverview` | `wmkf_presitepersonneloverview` | First-page personnel bullet |
| `keckFundingRationale` | `wmkf_presitekeckfundingrationale` | First-page Keck-funding rationale |
| `backgroundAndImpact` | `wmkf_presitebackgroundandimpact` | Detailed background and impact |
| `detailedMethodology` | `wmkf_presitedetailedmethodology` | Detailed methodology |
| `personnelDetails` | `wmkf_presitepersonneldetails` | Detailed one-paragraph personnel section |

Additional fields:

| Logical name | Type / limit | Contract |
|---|---|---|
| `wmkf_presiteproposalcorejson` | Memo / 1,048,576 | Write-once canonical proposal-core envelope. Source-built envelope v3 contains the normalized eight-field render core and content-free diagnostics; existing v2 envelopes remain readable. Raw provider output stays on the governed AI run. |
| `wmkf_presiteinputsnapshotjson` | Memo / 1,048,576 | Write-once structured snapshot of authoritative request metadata, personnel, budget, and the exact Proposal Narrative manifest. It excludes credentials and full PDF text. |
| `wmkf_renderinputfingerprint` | String / 64 | SHA-256 of the exact named draft fields and deterministic document inputs used for a render. A mismatch means the registered file does not represent the current draft fields. |
| `wmkf_contenttype` | String / 255 | IANA media type for the one SharePoint file represented by the row. This distinguishes Word and PDF without another closed option set. |

The Proposal Narrative is not currently a governed Request Document row. Its
bounded source manifest therefore records the role, filename, stable Graph
site/drive/item identity, exact version, and content hash inside the immutable
input snapshot. The separate Proposal Bibliography is not included because it
does not govern PSV generation identity. The existing `wmkf_SourceDocument`
lookup and source version/hash remain reserved for lineage from one governed
output artifact to another, such as Word → PDF or Pre-Site → Final.

### `akoya_request` relationships

The optional N:1 lookup `wmkf_CurrentPreSiteVisit` is live through relationship
`wmkf_request_currentpresitevisit`. It points only to the canonical Ready,
non-superseded Pre-Site Word row for that Request.

The optional N:1 lookup `wmkf_CurrentFinalWriteup` is live through relationship
`wmkf_request_currentfinalwriteup`. It points only to the canonical Ready,
non-superseded Final Writeup Word row for that Request. Final creation copies
the exact current Pre-Site Word version at action time and records the source
row/version/hash. There is intentionally no Site Visit writeup relationship.

Dataverse relationship metadata cannot enforce the target row's owning
Request, artifact type, operation status, lifecycle, or content type. The
service must enforce all five and update each pointer atomically with prior-row
supersession, mirroring the Initial Assessment transition.

## Row and version semantics

### Word draft/document row

A Pre-Site Word row has:

- `wmkf_artifacttype = 100000001` (`Pre Site Visit`);
- `wmkf_contenttype = application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
- all eight named sections;
- the proposal-core and input-snapshot JSON;
- request, AI prompt, AI run, template, source-file, and generation-key provenance; and
- one stable SharePoint Word identity.

An exact retry reuses the same generation-key row. A changed authoritative
input, prompt version, or template version creates a new row. The Ready
transition supersedes the prior current row and changes the Request pointer in
one Dataverse changeset. `createdon`, the deterministic generation key, and
native SharePoint versions provide the version trail; no separately allocated
human revision integer is required.

The generated JSON and input snapshot are write-once application fields. The
eight named fields are the Power Automate/form-friendly representation. Before
Word creation they may be revised through a governed draft action. Once the
Word row is Ready, the SharePoint Word document is the authoritative staff-
edited prose. A later Dataverse-field revision must be a deliberate new
version/rerender operation; it must never silently overwrite a staff-edited
Word file.

The Site Visit handoff is the editorial boundary for the current Pre-Site row:
Draft means the generated document may still be regenerated through the
Pre-Site producer; Review means the same Word item is now the Site Visit
workspace and ordinary regeneration is locked. Unknown or later lifecycle
values fail closed. The handoff requires the current request pointer, Ready
operation state, Word content type, exact expected artifact id, stable Graph
drive/item/publication identity around the download, and the row ETag. One
conditional PATCH persists Review plus `wmkf_milestoneversionid`,
`wmkf_milestonecontenthash`, and `wmkf_milestonecreatedat`. An exact completed
Review retry is idempotent.

### PDF row

A PDF row also uses artifact type `Pre Site Visit`, but has
`wmkf_contenttype = application/pdf` and normally leaves the eight proposal-
core fields empty. Its `wmkf_SourceDocument` lookup targets the exact Word row;
`wmkf_sourceversionid` and `wmkf_sourcecontenthash` record the exact Word
version exported. Its generation key includes the Word row ID, source version,
source content hash, PDF renderer/version, and content type. The Request's
current pointer never targets the PDF row.

## Structured snapshot contracts

`wmkf_PreSiteProposalCoreJson` stores a versioned envelope rather than an
unlabelled object:

```json
{
  "schemaVersion": 3,
  "proposalCore": {
    "executiveSummary": "...",
    "impactOverview": "...",
    "methodologyOverview": "...",
    "personnelOverview": "...",
    "keckFundingRationale": "...",
    "backgroundAndImpact": "...",
    "detailedMethodology": "...",
    "personnelDetails": "..."
  },
  "diagnostics": [
    {
      "code": "section_over_target",
      "section": "executiveSummary",
      "observedChars": 734,
      "targetChars": 700
    }
  ]
}
```

Envelope v2 remains readable and receives any warning that can be derived from
its canonical text. It cannot reconstruct provider-boundary metadata such as
input truncation, so no such historical warning is invented. The bounded input
snapshot remains schema version 2.

`wmkf_PreSiteInputSnapshotJson` stores only bounded structured metadata and
source identity:

```json
{
  "schemaVersion": 2,
  "request": {
    "requestId": "guid",
    "requestNumber": "1002379",
    "projectTitle": "...",
    "applicantInstitution": "...",
    "cityState": "City, ST",
    "meetingDate": "...",
    "requestedAmount": "...",
    "invitedAmount": "...",
    "totalProjectBudget": "...",
    "programDirector": "...",
    "projectPeriod": { "startDate": "...", "endDate": "..." },
    "personnel": []
  },
  "proposalSources": [
    {
      "role": "proposalNarrative",
      "filename": "ProposalNarrative_1002379.pdf",
      "siteId": "...",
      "driveId": "...",
      "itemId": "...",
      "versionId": "...",
      "contentHash": "..."
    }
  ]
}
```

The JSON never contains credentials, access tokens, or the full proposal text.
The source file remains authoritative for proposal content.

## Production writer contract and resilience release

The deployed runtime implementation:

1. load the authoritative request/account/budget/personnel data and the exact
   `AI Materials/ProposalNarrative_{Request#}.pdf` identity and bytes;
2. calculate the input fingerprint and deterministic generation key before
   creating or claiming a row;
3. execute a narrative-only published version of the admin-configured governed prompt
   through the shared Executor and require a persisted `wmkf_ai_run` audit;
4. validate exactly eight sections, then persist the named fields, immutable
   JSON snapshots, prompt/run lookups, and source identity under the owned
   claim;
5. render only from the persisted row and exact input snapshot, calculate the
   render-input fingerprint, and upload one Word file;
6. transition to Ready only after Graph upload and Dataverse readback agree;
7. atomically supersede the prior current Word row and set
   `wmkf_CurrentPreSiteVisit`; and
8. preserve a failed row, exact run linkage, uploaded-item cleanup work, and a
   safe retry path when any later hop fails.

The Production 2026-08-18 release adds a strict prompt-contract preflight
before claim or model execution, normalizes valid proposal-core text before it
becomes reusable, persists envelope-v3 diagnostics, and projects the same
warnings from both POST and later GET/reuse paths. Deterministic content
failures are marked non-retryable for an unchanged generation key and include
a durable AI-run or artifact support reference. Editorial target deviations
continue to Ready. The paired application/prompt contract is exact-readback
verified; controlled signed-in generation proof remains open.

The service must not report success after only the Claude call, only the
Dataverse draft write, or only the SharePoint upload. Existing claim-token,
ETag, operation-status, error, and orphan-cleanup fields are reused.

The deployed Site Visit transition is a separate authenticated service
and route. It reads the current pointer and stable SharePoint item, performs no
AI or SharePoint write, and updates only the current Request Document row. It
also makes `generatePreSiteVisitArtifact` reject a promoted current row before
input loading or any model/claim/render/upload side effect. After exact owner
approval, signed-in Production Request `1002379` completed Draft→Review on
2026-08-21, retained the same exact SharePoint Edit/Download identity, returned
the handoff timestamp after a fresh authenticated GET, and locked regeneration.
The success path's post-write reread requires the exact publication version,
governed hash, and milestone time to match.

## Deployment and compatibility sequence

1. **Completed 2026-08-17:** run the self-test and read-only Production
   preflight; all 14 items were absent and none divergent.
2. **Completed 2026-08-17:** obtain explicit owner approval for the Production
   metadata write.
3. **Completed 2026-08-17:** apply only `wave19-pre-site-draft`; independent
   readback reports all 14 declared artifacts exact.
4. **Completed locally 2026-08-17:** add the new fields to the
   request-document adapter and request lookup selects.
5. **Completed locally 2026-08-17:** implement the durable writer, registry-
   returning route/UI, persisted-readback renderer transition, and focused
   claim/retry/recovery/race tests.
6. **Completed 2026-08-17:** exercise Request `1002379` as the controlled
   old-request testbed after the exact Proposal Narrative was supplied.
7. **Completed 2026-08-17 for normal generation and exact Ready retry:** verify
   the exact row, governed run, Word item/version, current pointer, and
   no-duplicate retry. A controlled partial-failure recovery remains unproved.
8. **Deployed to Production 2026-08-18; signed-in generation smoke open:** resilience policy,
   envelope v3 with v2 reads, warning projection, guarded unchanged retry,
   typed failure responses, prompt publication readback, and render contract
   v5 over the unchanged v4 DOCX bytes. Sole-current prompt v4 and Ready
   application deployment were exact-readback verified without generating a
   request artifact.

The first long Production request completed durably but the browser displayed
`Failed to fetch`. Read-only state verification followed by an exact retry
returned the existing Ready link without another row, run, upload, or model
call. **[DEPLOYED TO PRODUCTION 2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** the route exposes
read-only current/pending status and the tab uses bounded GET polling after a
lost POST response without repeating POST. Production template v2 added the
missing Recommendation-cell padding under a new generation identity and
created Ready artifact `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6`. Its exact
SharePoint file exposed a width-sensitive Word Online alignment defect in the
Recommendation label. **[INFERRED FROM SCREENSHOT + OOXML WIDTH]** implicit
wrapping was the remaining layout variable. **[DEPLOYED TO PRODUCTION
2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** template v3 explicitly prevents
that label from wrapping under another generation identity. Signed-in
current-status, compact actions/download, and Word Online v3 proof remain open.

Production now has Wave 19. Other target environments must still pass the
same preflight and apply before runtime code deployed there selects these
fields; Dataverse rejects a `$select` containing an absent attribute.

## Remaining decisions

- The first slice now creates the Word document inside the application.
  Power Automate remains responsible for supplying the exact Proposal Narrative
  input; changing producer ownership would require a new owner decision and
  the same claim, fingerprint, Ready, and failure contracts.
- Whether PDF export is required in the first slice or can follow after the
  Word row is proven. Its lineage shape is decided above either way.
- Which staff-facing Dataverse form, if any, exposes the named fields before
  Word creation. Direct unrestricted edits to Ready rows are not part of this
  design.
- The remaining Site Visit logistics mapping and Institutional Funding History
  result field are later bounded schema decisions. Neither is silently folded
  into Wave 19.

The cross-tab lifecycle, Site Visit file paths, and Final copy transaction are
specified in `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`.
