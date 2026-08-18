---
title: Workbench Writeup Lifecycle Plan
domain: workbench
kind: plan
status: draft
summary: "Cross-tab design for the Pre-Site Word workspace, Site Visit dossier, and Final Writeup lineage."
canonical: false
cataloged: 2026-08-17
last_verified: 2026-08-17
owner: product-engineering
related:
  - docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - lib/dataverse/schema/wave19-pre-site-draft/01_wmkf_requestdocument_pre_site_draft.json
  - lib/dataverse/schema/wave19-pre-site-draft/02_akoya_request_writeup_pointers.json
---

# Workbench Writeup Lifecycle Plan

## Decision and current status

**[OWNER DECISION 2026-08-17; PRE-SITE WRITER PRODUCTION-PROVED; SITE VISIT
AND FINAL PLANNED.]** The three Workbench
tabs form one document lifecycle, not three independent data-entry systems:

1. **Pre-Site Visit Writeup** creates a governed Word document from Dataverse
   data and governed AI output persisted in Dataverse. Once created, that Word
   document becomes the PD's working document.
2. **Site Visit** continues to use the same Pre-Site Word document. The PD
   records visit observations directly in Word while SharePoint preserves the
   native version history. The tab separately manages logistics and supporting
   files such as slides, recordings, transcripts, and summaries.
3. **Final Writeup** creates a new governed Word document by copying the exact
   Site Visit-stage version of the Pre-Site Word workspace selected at action
   time. The new Final document then becomes the PD's working document.

There is no separate Site Visit Writeup, no Dataverse staff-observations text
field in this design, and no attempt to synchronize arbitrary staff edits from
Word back into the eight generated Dataverse narrative fields.

Site Visit and Final remain placeholders in current `main`. The Pre-Site tab
now calls the Production durable writer and shows the stable Word file returned
from the registry. **[DEPLOYED TO PRODUCTION 2026-08-17; SIGNED-IN FEATURE
SMOKE OPEN]** its compact action panel shows Generate before a draft
exists and Edit, Download, and confirmation-guarded Regenerate actions when a
Ready draft exists; detailed workflow guidance is behind an accessible help
control. Wave 19 is live in Production: its owner-approved
metadata-only apply created all 12 attributes and two request lookups, and
independent readback found 14 exact with no absence or divergence. Request
`1002379` later created the first Ready Pre-Site row, completed governed v3 AI
run, populated the request pointer, and uploaded the stable Word item. Exact
Ready retry reused those same identities. Current inventory is four Request
Documents: three Initial Assessments and one Pre Site Visit.

## Evidence boundary

| Claim | Evidence | Status |
|---|---|---|
| The Workbench exposes Pre-Site, Site Visit, and Final tabs; Pre-Site is Production-live, while Site Visit and Final remain placeholders | Workbench source, commit `abfe5529`, Ready deployment `dpl_CF7ia9TYyT5ZU5hyv2TNWUYnPb3H`, and signed-in Request `1002379` test | VERIFIED LIVE |
| `wmkf_requestdocument` already has artifact types for Pre Site Visit, Final Writeup, Applicant Slides, Other Applicant Materials, Recording, Transcript, and Transcript Summary | Wave 16 tracked schema plus read-only Production metadata inventory | VERIFIED |
| The registry already carries request ownership, stable Graph identity, lifecycle, exact source version/hash, prompt/run/template lineage, and retry fields | Request Document adapter, schema, and Atlas | VERIFIED |
| Production contains one Ready/Draft Pre-Site Request Document row for Request `1002379` | Read-only Production inventory and exact row/pointer readback | VERIFIED LIVE |
| `akoya_request` has `akoya_sitevisitdate` and `akoya_sitevisitnotes`; the latter is not an approved workspace for this design | Read-only Production metadata inventory plus owner decision | VERIFIED / NOT REPURPOSED |
| The current Reviews flow persists structured synthesis in `akoya_request.wmkf_reviewsynthesisjson` | `review-synthesis.generate` prompt and Reviews callers | VERIFIED |
| Current Pre-Site and Final request lookups exist | 2026-08-17 post-apply Production preflight: both relationships exact; all 14 Wave 19 items exact and 0 divergent | VERIFIED LIVE |

## Ownership model

| Information | System of record | Editing contract |
|---|---|---|
| Request, institution, location, meeting, staff lead, invited/requested amounts, project budget, personnel | Dataverse source entities | Read-only inputs to document creation |
| Eight proposal-core narrative sections | Named fields on the Pre-Site `wmkf_requestdocument` row | Generated and reviewable before Word activation; frozen as the render inputs for that row |
| Exact Claude proposal-core output and bounded input snapshot | Pre-Site `wmkf_requestdocument` JSON snapshot fields | Write-once audit/reproducibility evidence |
| Reviewer roster and review narrative | Submitted-review roster plus current `wmkf_reviewsynthesisjson` | Deterministically rendered at the selected evidence timestamp; no duplicate Pre-Site review store initially |
| Graphical abstract image/caption and staff recommendation | The Word document | Manually pasted or entered by the PD |
| Institutional funding history | Future governed AI result in Dataverse | Requires an approved Dataverse field and producer before automatic insertion |
| Site Visit observations and later editorial prose | The current Word document | Direct staff edits; SharePoint native versions are authoritative |
| Site Visit logistics | Dataverse | Separate bounded schema/adapter decision; do not hide these inside the Word file |
| Slides, other applicant materials, recording, transcript, transcript summary | SharePoint bytes plus one `wmkf_requestdocument` row per file | Governed upload/registration and normal SharePoint version/recycle behavior |
| Current document selection | Request lookup to the current Ready Word row | Service-controlled atomic transition |

The existing `akoya_sitevisitnotes` field may contain historical content. This
plan neither deletes it nor silently changes its meaning. Before any future
migration or retirement, inventory populated rows and live callers.

## Lifecycle and lineage

```text
Dataverse facts + AI Materials narrative + review evidence
                         │
                         ▼
       Pre-Site Request Document row ─── stable SharePoint DOCX
                         │                    │
                         │                    ├─ PD adds graphical abstract,
                         │                    │  recommendation, and edits
                         │                    └─ PD adds Site Visit observations
                         │                       as native Word versions
                         │
               exact row + item version + hash
                         │
                         ▼
         Final Request Document row ───── new SharePoint DOCX copy
                                              │
                                              └─ PD continues editing in Word
```

The source of a Final Writeup is never “whatever file currently has this
name.” It is the exact Pre-Site Request Document row and exact SharePoint
version/hash captured when the action runs.

## Pre-Site Visit Writeup tab

### Minimum interface

- Show source readiness for the exact proposal narrative, authoritative Dataverse
  metadata, governed prompt/model configuration, and Word template.
- Generate or retry the Pre-Site draft through one durable operation.
- Show the current Ready Word document with a compact status plus Edit,
  Download, and confirmation-guarded Regenerate actions. Keep detailed source,
  provenance, and manual-completion guidance available through contextual help
  rather than permanently occupying the panel.
- Identify manual Word tasks: graphical abstract image/caption and staff
  recommendation. Institutional funding history remains visibly unavailable
  until its governed Dataverse producer exists.
- If review evidence is included, show its as-of timestamp and submitted-review
  coverage so staff can choose a deliberate refresh rather than silently
  overwriting an edited document.

### Creation transaction

1. Resolve the Request and authoritative related Dataverse records.
2. Resolve the exact `AI Materials/ProposalNarrative_{Request#}.pdf` by stable
   Graph site/drive/item/version identity; the path is a discovery convention,
   not the durable key.
3. Build a bounded input snapshot and deterministic generation key.
4. Execute the admin-configured governed prompt through the shared Executor,
   persisting the `wmkf_ai_run` audit.
5. Validate all eight proposal-core sections and write the named fields plus
   immutable output/input snapshots to the claimed Request Document row.
6. Render Word only from that persisted row and deterministic supporting data.
7. Upload the DOCX, read it back, and transition the row to Ready.
8. In one Dataverse changeset, supersede the prior current Pre-Site row and set
   `akoya_request.wmkf_CurrentPreSiteVisit` to the new Ready Word row.

Success means all of Dataverse, the AI-run audit, the SharePoint item, and the
current pointer agree. A Claude response or an uploaded file alone is not
success. Exact retry reuses the same claimed operation; changed inputs create a
new row rather than overwriting a staff-edited Ready Word document.

## Site Visit tab

### Document workspace

The Site Visit tab opens the current Pre-Site Word document. Site Visit
observations are entered directly into that document. Each save produces
ordinary SharePoint/Word version history. The application does not create:

- a Site Visit Writeup artifact;
- a current Site Visit writeup lookup;
- a staff-observations Request Document category;
- a staff-observations Dataverse Memo field; or
- a field-by-field synchronization job that parses staff-edited Word prose.

The tab should display the current Word item and its latest version metadata so
the PD can confirm which document is the workspace. The application must not
replace that stable item as a side effect of receiving site-visit files.

### Logistics

The desired logistics are date, time/time zone, format, location/link, lead PD,
WMKF staff, applicant participants, and Board/consultant participants. The only
currently confirmed relevant Request fields are `akoya_sitevisitdate` and
`akoya_sitevisitnotes`. A separate schema-design slice must map the remaining
facts to existing relationships/fields or propose the smallest additive
Dataverse shape. No separate Scheduled/Completed/Cancelled status is required
without a consuming workflow.

### Supporting-file registry and paths

Each file is one Request Document row and one stable SharePoint item. Use the
existing artifact choices; do not infer category from filenames alone.

| Artifact type | Governed request-relative folder |
|---|---|
| Applicant Slides | `Site Visit/Applicant Materials/Slides` |
| Other Applicant Materials | `Site Visit/Applicant Materials/Other` |
| Recording | `Site Visit/Recording` |
| Transcript | `Site Visit/Transcript` |
| Transcript Summary | `Site Visit/Transcript Summary` |

Folder strings should become shared server-side constants when the upload
surface is implemented. Stable Graph site/drive/item identity remains the
registry key even if names or folders later change.

Applicant-facing upload access remains limited to the first two categories.
Recording, transcript, and summary are staff/system-side. The established
expiring-link, validation, malware, size, resumable-upload, notification, and
recovery decisions remain governed by the near-term execution plan.

## Final Writeup tab

### Minimum interface

- Show the current Pre-Site Word workspace and latest available SharePoint
  version that would be copied.
- Require a deliberate Create Final Writeup action.
- After creation, show and open the independent current Final Word document.
- Offer regeneration only as an explicit rare action that creates a new Final
  row/file and preserves the existing Final and its staff edits.

### Copy transaction

1. Read `wmkf_CurrentPreSiteVisit` and verify that it targets a Ready,
   non-superseded Pre Site Visit Word row owned by the same Request.
2. Resolve and freeze the exact current SharePoint item version and content
   hash at action time.
3. Build a Final generation key from Request ID, Final artifact type, source
   row ID, source item version/hash, and copy/producer contract version.
4. Claim or reuse the matching Final Request Document operation.
5. Copy the exact source bytes to a new stable Final DOCX item; do not rename or
   mutate the Pre-Site item.
6. Set `wmkf_SourceDocument` to the Pre-Site row and persist the exact source
   version/hash on the Final row.
7. After upload/readback agreement, transition Final to Ready and atomically
   supersede the prior current Final row while setting
   `akoya_request.wmkf_CurrentFinalWriteup`.
8. Open the new Final Word item as the PD's continuing workspace.

The copy deliberately includes the visit observations already entered in Word.
It also preserves the selected reviewer roster and review narrative. Any later
review refresh is an explicit operation on a new preserved version, never a
silent rewrite.

## Dataverse schema impact

### Wave 19: Production schema live

Wave 19 was applied to Production on 2026-08-17. It provides:

- 12 fields on `wmkf_requestdocument`: eight named proposal-core Memo fields,
  two immutable JSON snapshots, render fingerprint, and content type; and
- two N:1 Request lookups: `wmkf_CurrentPreSiteVisit` and
  `wmkf_CurrentFinalWriteup`.

There is intentionally no Site Visit current-document lookup. Both lookups
must be validated in service code because Dataverse metadata cannot enforce
same-Request ownership, artifact type, Word content type, Ready status, or
non-superseded lifecycle.

### Later bounded schema decisions

1. Map Site Visit logistics to existing Dataverse data, then propose only the
   missing fields/relationships.
2. Define the Institutional Funding History result field, its governed prompt,
   refresh semantics, and how it is incorporated into a new Pre-Site version.
3. Decide whether Final needs any additional generated/structured fields. The
   minimum design copies Word and lineage only.
4. Define Editor Dashboard Reviewed acknowledgements separately. They are not
   document lifecycle or approval fields.

## PDF snapshots

When a frozen PDF is needed for an external Board member or consultant, create
a separate Request Document row and SharePoint item. Link it to the exact Word
row with `wmkf_SourceDocument` and persist the source Word version/hash. A
current writeup pointer always targets Word, never PDF.

## Failure, retry, and concurrency rules

- Claim one deterministic operation before model execution or file creation.
- Preserve failed rows and exact run/file cleanup evidence; never report partial
  success as complete.
- Use claim tokens and ETags so two staff actions cannot both activate a
  current document.
- Update prior-row supersession and the corresponding current lookup in one
  changeset.
- A retry with the same generation key reuses its row; a materially changed
  input creates a new row.
- Never overwrite a Ready staff-edited Word item during generation,
  regeneration, review refresh, or Final creation.
- Treat SharePoint native versions as the human-edit history. Do not allocate a
  second application revision counter.

## Delivery slices and gates

1. **Schema review and apply — completed for Production 2026-08-17.** The
   self-test passed, the owner approved the metadata write, and post-apply
   readback reported 14 exact and 0 divergent. Other environments still require
   their own preflight/apply before runtime `$select` references these fields.
2. **Pre-Site persistence and generation — completed and Production-proved
   2026-08-17.** The durable writer generated Request `1002379` from the exact
   narrative, persisted its run/row/pointer, uploaded Word, and reused the same
   artifact on exact Ready retry.
3. **Pre-Site tab — first slice and recovery hardening deployed.**
   Generate/retry and the stable Word link are live. **[DEPLOYED TO PRODUCTION
   2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** read-only current/pending status loading and bounded GET
   polling recover a long request whose client response is lost after durable
   completion without another POST. Production template v2 fixed
   Recommendation-cell spacing under a new generation identity and created
   Ready artifact `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6`, but Word Online
   exposed a width-sensitive Recommendation-label alignment defect.
   **[INFERRED FROM SCREENSHOT + OOXML WIDTH]** implicit wrapping was the
   remaining layout variable. **[DEPLOYED TO PRODUCTION 2026-08-17; SIGNED-IN
   FEATURE SMOKE OPEN]** template v3
   makes the label explicitly non-wrapping under another generation identity.
   Ready deployment `dpl_58hstAQNBP8ATqfBXtYczC9tFziE` also includes the compact help/action panel:
   Generate before a draft exists; Edit, Download, and confirmation-guarded
   Regenerate when Ready. Signed-in current-status, action-panel, download, and
   Word Online v3 proof remain open.
4. **Site Visit logistics design.** Inventory and map every desired logistics
   fact before proposing or applying any further schema.
5. **Site Visit dossier.** Implement the Word-workspace link plus governed
   supporting-file listing/upload paths. Keep applicant upload work as its own
   security-reviewed slice.
6. **Final copy operation and tab.** Freeze exact source version/hash, create a
   new Final row/item, transition the current pointer, and verify safe retry and
   deliberate regeneration.
7. **PDF and Editor Dashboard follow-ons.** Add only after the Word lifecycle is
   proven end to end.

Each slice must trace caller → restriction context → registry persistence →
SharePoint bytes → current pointer → UI consumer and test partial failure,
retry, and concurrent activation. Runtime work follows the campaign release
strategy; this plan itself performs no deployment.

## Acceptance criteria

- A PD can generate one governed Pre-Site Word document whose automatically
  populated content is reproducible from Dataverse and exact AI evidence.
- Opening the Site Visit tab leads to the same Pre-Site Word item; observations
  saved in Word are preserved in SharePoint version history.
- Every Site Visit supporting file appears in the correct governed category and
  has one registry row with stable Graph identity.
- Creating Final copies the exact latest/selected Site Visit-stage Pre-Site Word
  version into a new file and records the source row/version/hash.
- Retrying an identical operation creates no duplicate current artifact.
- Regenerating after changed inputs never destroys staff edits in a Ready
  Pre-Site or Final file.
- Overview and the future Editor Dashboard can derive the current Pre-Site and
  Final documents from Request lookups without filename or folder joins.
