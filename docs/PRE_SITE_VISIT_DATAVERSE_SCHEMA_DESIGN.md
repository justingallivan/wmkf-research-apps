---
title: Pre-Site Visit Dataverse Schema Design
domain: dataverse
kind: spec
status: active
summary: "Production-live Wave 19, Site Visit handoff/correction, and Production-proved frozen distribution."
canonical: false
cataloged: 2026-08-17
last_verified: 2026-08-24
owner: product-engineering
related:
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - lib/dataverse/schema/wave19-pre-site-draft/01_wmkf_requestdocument_pre_site_draft.json
  - lib/dataverse/schema/wave19-pre-site-draft/02_akoya_request_writeup_pointers.json
  - scripts/preflight-pre-site-draft-schema.mjs
  - lib/dataverse/schema/wave20-guarded-reopen/wmkf_requestdocument_guarded_reopen.json
  - scripts/preflight-guarded-reopen-schema.mjs
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
Pre-Site business row and SharePoint Word item. The 2026-08-23 post-reopen
inventory is 10 Request Documents: three Initial Assessments and seven Pre Site
Visits; nine are Ready, one Failed, six Draft, and four Superseded.

**[DEPLOYED TO PRODUCTION 2026-08-18; SIGNED-IN GENERATION + NO-DUPLICATE
SMOKES PASSED 2026-08-27.]**
The Production runtime normalizes valid provider output,
stores content-free editorial diagnostics in proposal-core envelope v3, and
returns those diagnostics as non-blocking Workbench warnings. It retains v2
read compatibility and the deployed v4 DOCX bytes while advancing the render
contract identity to v5. Ready deployment
`dpl_HGogbJnprevoYKLaxevamxdajtC4` shipped paired with prompt v4 row
`74409f95-509b-f111-b8db-6045bd008868` (exact readback, zero mismatches);
the prompt was later re-published as sole-current v5 (unattributed,
content-identical per the runtime exact-match preflight). The 2026-08-27
Request `1002852` smoke proved Ready-with-warning generation under v5 and
the exact no-duplicate retry (see
`docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md` §Status).

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

**[PRODUCTION-PROVED 2026-08-23.]** The guarded
correction branch provides the preserve-and-succeed service, superuser route/UI,
history projection, and additive Wave 20 fields. Production typed-metadata
readback is 3 exact/0 absent/0 divergent; the non-sensitive readiness flag is
literal `on`; merge `af986d92` is Ready in deployment
`dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp`. Signed-in Request `1002788` exercised the
extended read-only status path without application errors or writes. After
exact owner approval, signed-in Request `1002379` created one Ready/Draft
successor and one distinct SharePoint copy while preserving and superseding the
prior Review row. Exact unchanged retry returned the same row/item, and
Dataverse/Graph postcheck proved one cycle row plus identical governed source
and successor bytes. The base adapter projection
omits the new columns until `GUARDED_REOPEN_SCHEMA_READY` is literal `on`; the
reopen route returns 503 while it is off. This lets source deploy safely before
provisioning without making ordinary Request Document reads query absent
columns, while keeping guarded reopen mechanically unavailable.

A frozen distribution always retains a separate Word snapshot Request Document
row because one registry row identifies exactly one SharePoint file. Its
`wmkf_SourceDocument` lookup points to the editable Word row, and the existing
source version/hash fields identify the exact version frozen. When PDF is
selected, a second row points to the retained Word snapshot and identifies the
exact snapshot version/hash converted through Graph. The outgoing email may
attach the Word snapshot, PDF, or both.

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
        └── wmkf_requestdocument (Pre Site Visit, frozen Word snapshot)
              ├── SourceDocument + exact editable-Word version/hash
              └── wmkf_requestdocument (Pre Site Visit, PDF snapshot)
                    └── SourceDocument + exact Word-snapshot version/hash
  └── wmkf_CurrentFinalWriteup ──────────────┐
      wmkf_requestdocument (Final Writeup, Word, current)
        └── SourceDocument + exact Pre-Site version/hash ◀──┘
```

## Evidence and rejected alternatives

| Claim | Strongest evidence | Status |
|---|---|---|
| `wmkf_requestdocument` already represents request-owned, versioned governed artifacts and includes a Pre Site Visit artifact option | Production metadata preflight on 2026-08-17 plus Wave 16 schema and adapter | VERIFIED |
| The 2026-08-17 Production snapshot had four Request Document rows: three Initial Assessments and one Ready/Draft Pre Site Visit | Read-only production inventory after Request `1002379` generation on 2026-08-17; current count requires re-probe | VERIFIED HISTORICAL SNAPSHOT |
| Prompt `pre-site-visit.proposal-core.generate` v4 was sole-current on `claude-sonnet-4-6` and exactly matched the tracked resilience contract on 2026-08-18 | Audited Admin publication plus exact Production readback on 2026-08-18 | VERIFIED HISTORICAL — superseded by v5 |
| Prompt `pre-site-visit.proposal-core.generate` v5 is sole-current and content-identical to the tracked resilience contract; the v4→v5 republish is unattributed | 2026-08-27 governed generation on Request `1002852` passed the runtime exact-match preflight (`artifact-service.js::validateNarrativePrompt`) and recorded promptVersion 5 in provenance | VERIFIED LIVE 2026-08-27 |
| `wmkf_sitevisit` could store the draft | Production metadata shows an empty activity table with no suitable custom content fields; no repository caller was found | VERIFIED (not suitable) |
| `akoya_request.wmkf_researchwriteuptype` could store the draft | Production metadata and row distribution show a Phase I/Phase II classification choice, not content or version persistence | VERIFIED (not suitable) |
| The Workbench Pre-Site route persists a business draft | Request `1002379` created Ready row `aeb223a2-849a-f111-b8db-70a8a59cded0`, governed v3 run `ba0f42b9-849a-f111-b8db-6045bd008868`, stable Word item `01G4GVMS3Q5BJ65S7DDZDKFTSQLIQAIPER`, and the then-current request pointer | VERIFIED HISTORICAL GENERATION PROOF |
| Wave 19 fields and current pointers exist in Dataverse | 2026-08-17 owner-approved apply followed by independent Production preflight: 0 absent, 0 divergent, 14 exact | VERIFIED LIVE |
| The metadata-only Wave 19 apply itself created a Pre-Site business row | Immediate post-apply inventory: three Request Document rows, all Initial Assessments | VERIFIED FALSE (historical apply boundary) |
| The deployed writer later created the first Pre-Site business row | Post-generation inventory plus exact row/run/item/pointer readback for Request `1002379` | VERIFIED LIVE |
| Wave 20 reopen fields exist in Production | Approved 2026-08-23 apply plus typed metadata readback: 3 exact, 0 absent, 0 divergent | VERIFIED LIVE |
| Guarded reopen service, route, UI, and retry/recovery contract exist | Merge `af986d92`, focused tests, Ready deployment `dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp`, signed-in read-only Request `1002788` status smoke, and approved Request `1002379` durable mutation/exact-retry/readback | PRODUCTION-PROVED |

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

### Guarded-reopen Wave 20 attributes — Production-provisioned

The successor `wmkf_requestdocument` row is the durable append-only correction
event. Wave 20 adds only the fields that existing registry lineage and standard
Dataverse audit columns do not already provide:

| Logical name | Type / limit | Contract |
|---|---|---|
| `wmkf_reopencycleid` | String / 36 | Client operation UUID. Dedupe/correction-cycle identity; later generated drafts retain it in their generation identity. |
| `wmkf_reopenreasoncode` | String / 50 | Closed application reason code (`accidental_handoff` or `wrong_governed_inputs`). |
| `wmkf_reopenreasonnote` | Memo / 2,000 | Required bounded staff explanation. |

Existing `wmkf_SourceDocument`, `wmkf_sourceversionid`, and
`wmkf_sourcecontenthash` bind the exact preserved handoff. Standard
`createdby`/`createdon`, written under the session's Dynamics impersonation,
bind actor and time. The generation-key alternate key remains the uniqueness
fence; the cycle ID alone is not treated as a new database key. No separate
audit entity is needed for this bounded operation. Dataverse formatted lookup
annotation `_createdby_value_formatted` supplies the actor display name.
Actor/time attribution is projected only when the row carries a reopen reason,
so later regenerated descendants may inherit the correction cycle without
misidentifying their generator as the actor who authorized the reopen.

Failed successor rows remain immutable attempt evidence but are excluded from
the downstream blocker for a later client operation. The dialog mints one UUID;
after first submit its audit inputs are frozen so unchanged retry reclaims the
same row/item, while closing/reopening starts a different operation. A different
Generating row blocks reopen only while its 15-minute lease is live. An expired
reopen row is marked Failed before fallthrough, and any retained copy is bound
by stable drive/item identity in the cleanup queue for explicit reconciliation.
A Failed row remains the exact retry target for its own client operation. When a
different client operation supersedes it, any resolvable retained copy is then
added to the same cleanup queue without replacing the original failure evidence.
Final generation activation compares the target correction cycle with the
current Draft pointer so a stale older generation cannot replace a newer cycle.

### `akoya_request` relationships

The optional N:1 lookup `wmkf_CurrentPreSiteVisit` is live through relationship
`wmkf_request_currentpresitevisit`. It points only to the canonical Ready,
non-superseded Pre-Site Word row for that Request.

The optional N:1 lookup `wmkf_CurrentFinalWriteup` is live through relationship
`wmkf_request_currentfinalwriteup`. It points only to the canonical Ready,
non-superseded Final Writeup row for that Request. The Final row records the
exact current Pre-Site row/version/hash at action time and references the same
stable SharePoint Word item; it does not create a second editable file. There
is intentionally no Site Visit writeup relationship.

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

### Distribution snapshot rows

The retained DOCX row and optional PDF row both use artifact type `Pre Site
Visit`, lifecycle `Board Ready`, and producer-specific generation identities;
they leave the eight proposal-core fields empty. The DOCX row points to the
editable Word source. The PDF row points to the retained DOCX row, so PDF bytes
and Word bytes share provable lineage even if the workspace advances during a
later operation. The PDF row uses `wmkf_contenttype = application/pdf` and a raw
SHA-256 byte digest in `wmkf_contenthash`; governed DOCX rows continue to use
the `gdc1:` normalized hash scheme. Each generation key includes the exact
source row/version/hash, raw source-byte hash, representation, and distribution
contract version. The Request's current pointer never targets either snapshot.
The exact distribution producer namespace is also excluded from editable
Pre-Site status, activation/supersession cardinality, and guarded-reopen
downstream/competing-generation checks. This is a narrow informational-row
classification: absent, unknown, or lookalike producers retain ordinary
fail-closed lifecycle behavior. Snapshot Ready finalization uses stable-ID
Graph native publication version/eTag readback, and PDF conversion fences the
retained Word publication identity before and after conversion.

**[PRODUCTION-PROVED 2026-08-24 on Request `1002379`, PDF-only operation
`85f52fc5-fb48-4ceb-84d6-0f246af0b6fb`.]** Postgres table
`pre_site_distribution_attempts` stores the selected attachment mode, exact
preview and selected file hashes, recipients/content/actor, granular send
state, Dynamics activity ID/status, leases, and bounded failure evidence. It
coordinates recovery only; SharePoint and Request Document rows remain file
authority, and Dynamics remains email-activity authority. A non-sent attempt
requires literal Dynamics impersonation, revalidates the current source under
its lease, persists a created/recovered activity ID before exact assertions,
and renews the lease immediately before transport. The live path retained
Ready/Board Ready DOCX and PDF Request Document rows, persisted one `sent`
ledger row, and produced a Dynamics Sent activity with actor attribution and
exactly one selected PDF attachment matching the retained hash. Workbench
history showed the transport receipt and a bounded Production error-log scan
was clean. Dynamics appended its CRM tracking token to the persisted subject
after transport acceptance; inbox delivery is not independently verified.

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
8. **Deployed to Production 2026-08-18; signed-in generation + no-duplicate
   smokes passed 2026-08-27:** resilience policy,
   envelope v3 with v2 reads, warning projection, guarded unchanged retry,
   typed failure responses, prompt publication readback, and render contract
   v5 over the unchanged v4 DOCX bytes. Then-sole-current prompt v4 and Ready
   application deployment were exact-readback verified without generating a
   request artifact; the 2026-08-27 smoke later proved live generation and
   no-duplicate retry under sole-current v5.

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

Wave 20 Production completed this strict order on 2026-08-23. Reuse it for any
other target; Production also completed the durable mutation proof:

1. Run `node scripts/preflight-guarded-reopen-schema.mjs --target=<target>`
   read-only and classify all three attributes absent/exact/divergent. The
   preflight first probes the uncast attribute path, so an existing wrong-type
   attribute is divergent rather than misreported as absent by a typed-cast
   404.
2. Stop on any divergence. If absent, obtain explicit owner approval before
   `node scripts/apply-dataverse-schema.js --target=<target> --wave=20-guarded-reopen --execute`.
3. Re-run the preflight and require three exact, zero absent/divergent.
4. Set the non-sensitive deployment flag `GUARDED_REOPEN_SCHEMA_READY=on`
   only after that exact readback, then promote/redeploy the runtime. Literal
   `on` is the only enabling value; unset and invalid values fail closed.
5. **Production complete:** signed-in Request `1002788` passed the read-only
   extended-status smoke. After exact owner approval, signed-in Request
   `1002379` completed one superuser reopen; exact retry and authoritative
   Dataverse/Graph readback proved one successor row/item and exact copied bytes.
6. After the first correction cycle exists, never unset the readiness flag as
   a rollback. Roll runtime back while retaining the exact schema and flag;
   hiding the cycle field would make generation identity incomplete.

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
- Site Visit logistics is now a separate Production-deployed Wave 21 contract
  on the existing `wmkf_sitevisit` Activity; it was not folded into Wave 19.
  Institutional Funding History needed no result field: since S467
  (2026-08-28) it is derived deterministically from Dataverse at generation
  and stored only in the v3 input snapshot (`docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`).

The cross-tab lifecycle, Site Visit file paths, and Final same-item lineage transaction are
specified in `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`.
