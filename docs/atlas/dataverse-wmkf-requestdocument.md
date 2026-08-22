---
title: Dataverse wmkf_requestdocument
domain: application-state
kind: atlas
status: active
summary: Governed request-artifact registry; core flow, native version restore, and first-stage recovery pass while administrative controls remain.
canonical: false
owner: product-engineering
last_verified: 2026-08-22
related:
  - lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json
  - lib/dataverse/schema/wave19-pre-site-draft/01_wmkf_requestdocument_pre_site_draft.json
  - lib/dataverse/schema/wave20-guarded-reopen/wmkf_requestdocument_guarded_reopen.json
  - lib/dataverse/adapters/request-document.js
  - lib/services/initial-assessment/artifact-service.js
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md
---

# `wmkf_requestdocument`

## Status

**[VERIFIED 2026-07-29 via repository source]** Schema-as-code, adapter, producer,
read API, Workbench panel, and cycle-wide pilot locator are implemented on the
Initial Assessment pilot branch. The full Editor Dashboard remains planned.

**[VERIFIED 2026-07-30 via production Wave 16 apply and idempotent read-only
rerun]** The entity, attributes, five relationships, generation-key alternate
key, and `akoya_request.wmkf_CurrentInitialAssessment` pointer are live in
Production.

**[VERIFIED 2026-07-30 via controlled production generation and exact
readback]** Request `1002788` now has one Ready/Draft registry row
`fb995f0f-628c-f111-ab0f-6045bd018a07`; its
`wmkf_CurrentInitialAssessment` pointer resolves to that row. The row preserves
the prompt, template, AI-run, input, cycle, and stable Graph item lineage and is
visible from both the request Workbench and cycle-wide locator.

**[VERIFIED 2026-07-30 via GitHub merge status, Vercel inspection, production
alias probes, and error-log scan]** PR #102 merged as `1e958ee0`; production
deployment `dpl_AxxroabhpXLX1pz75MW6486fB4ci` is Ready on the expected aliases.
The new route fails closed to sign-in when unauthenticated, and the initial
post-deploy error scan was clean.

**[PARTIAL PILOT 2026-07-30]** A same-input UI retry returned the existing
Ready row without another run, upload, overwrite, or duplicate. Opening the
canonical Word file created a native SharePoint version. At that point, the
broader pilot was not complete: the source was an old Phase I proposal rather than the approved
Phase II reviewer package and no substantive staff content edit was verified.
Request `1003109` later closed the canonical-input, recovery, substantive-edit,
and current-version readback gaps. Production deployment
`dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2` (`68bcb4e8`) is live-verified in both
consumers. The remaining target-library boundary is classified below. Exact evidence:
`docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md`.

**[VERIFIED DEPLOYED AND PRODUCTION-EXERCISED 2026-07-30]** Production
commit `9c88a1fa` replaces whole-package byte hashing
with a `gdc1:`-tagged normalized governed-DOCX digest. It covers every `word/`
part and canonicalizes the document relationship part only to remove
SharePoint-injected `customXml` relationships and ordering/whitespace noise.

**[VERIFIED 2026-07-30 via signed-in Workbench generation/retry plus
Dataverse, Graph, and Vercel readback]** Merge `84155a5a` deployed the exact
canonical proposal-source contract. Request `1003109` has Ready/Draft registry
row `3cec63a4-768c-f111-ab0f-6045bd018a07`; the request pointer targets that
row, SharePoint item `01G4GVMS3U3DHMJQ7GERBLB2QA3SYTLNHO` is registered, and
AI run `528b97af-768c-f111-ab0f-7ced8d3d15a6` carries the correct request
lookup. A fresh recomputation from `Reviewer Materials/Proposal_1003109.pdf`
matched the persisted input fingerprint and generation key. Exact-input retry
left one row, the same run/item, attempt count `1`, and unchanged
`modifiedon`.
The controlled interrupted-finalization exercise then retried the Failed row
through the Workbench and restored the same row and request pointer with
attempt count `2`. It preserved the one AI run and the same SharePoint
item/version, eTag, last-modified timestamp, size, and governed hash, proving
that recovery made no second model call, upload, overwrite, or duplicate.
The actual pilot producer and SharePoint v1 packages hash equally; v2 differs.
The historical pilot row retains an untagged legacy digest. A non-Ready legacy
row recovers only if downloaded bytes match that digest exactly; otherwise it
blocks for operator reconciliation without a model call or duplicate upload.

**[VERIFIED 2026-07-30 local / 2026-07-31 UTC via Graph, DOCX inspection,
Dataverse readback, and both signed-in consumers]** Justin Gallivan's
substantive edit advanced Request `1003109`'s stable SharePoint item to version
`2.0`; Foundation Opportunity contains staff-authored content and no
`STAFF INPUT REQUIRED` marker. Both consumers still open the same item.
Dataverse retains the upload-time version `1.0`, eTag, size, and last-modified
values, however. The registry fields are therefore an upload/finalization
snapshot, not Graph-current metadata after native Word edits.

**[VERIFIED DEPLOYED 2026-07-30 via production deployment
`dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`, commit `68bcb4e8`, and signed-in Request
`1003109` checks]** the shared read model now
uses stable Graph drive/item identity to overlay response-only current
name/size/link/version/eTag/last-modified metadata. Successful reads are marked
`current`; 404, transient failure, incomplete-identity, mismatched/non-file,
and total-budget cases preserve the registry snapshot as `missing` or
`unavailable` and never guess by path or write Dataverse. Request and cycle
reads deduplicate identical identities and cap Graph concurrency at eight
under a ten-second total refresh budget. Only Graph's publication version is
labeled as a version. Both consumers use one renderer for
current/missing/unavailable/unchecked semantics and suppress the Open link
after a confirmed 404. Both live consumers displayed current SharePoint
version `2.0` and the same stable document link.

**[VERIFIED 2026-07-30 local / 2026-07-31 UTC via production Graph and
signed-in SharePoint probes]** a disposable file in the actual Request library
proved prior-version inspection/download and restore to a new current version
with exact expected bytes. Justin then restored the deleted probe from the
first-stage recycle bin, and Graph confirmed the same item and exact contents
live. Both probes were removed from the first-stage bin after testing. Justin
was denied the second-stage administrator view at the time; 2026-08-20 IT
screenshots later showed both probes in the second-stage bin (bin confirmed
present) and closed the Members level as built-in Edit on a Public M365 group
site. Version limits were read 2026-08-10 (major-only, keep 500, no age
limit); Purview retention and the Edit level's Delete flags remain
owner-accepted-open (see `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`).
**Workbench version-history DISPLAY is built as of S413 (2026-08-10)** —
`GET /api/workbench/initial-assessment/versions`, read-only, resolving drive/item
from the Ready registry row and never from the caller. **Administrator restore and
immutable Board snapshot copies remain open**, restore because it depends on the
permission evidence above. The Site Visit handoff milestone is a distinct
source-verified writer described below; it records version/hash/time on the
working Pre-Site row but does not retain Board-distribution bytes.

**[VERIFIED INVENTORY / PRODUCTION SCHEMA 2026-08-17]** The pre-generation
read-only Production inventory confirmed that the registry already had a
`Pre Site Visit` artifact type but no Pre-Site rows. The legacy
`wmkf_sitevisit` activity and
`akoya_request.wmkf_researchwriteuptype` classification are not suitable draft
stores. Additive Wave 19 now provides eight named Pre-Site proposal-core Memo
fields, exact generated/input snapshots, render/source identity, and
`akoya_request.wmkf_CurrentPreSiteVisit` plus
`akoya_request.wmkf_CurrentFinalWriteup`. The owner-approved metadata-only
Production apply completed on 2026-08-17; independent readback reports all 14
items exact and zero divergent. **[VERIFIED IN PRODUCTION 2026-08-17]** commit
`abfe5529` deployed the Request Document adapter and Pre-Site writer. Request
`1002379` created Ready/Draft row `aeb223a2-849a-f111-b8db-70a8a59cded0`,
governed v3 AI run `ba0f42b9-849a-f111-b8db-6045bd008868`, stable SharePoint
item `01G4GVMS3Q5BJ65S7DDZDKFTSQLIQAIPER`, and the then-current request pointer. Its
input manifest has exactly one Proposal Narrative source and no bibliography.
Exact retry reused the same row/run/item. The dated 2026-08-17 inventory
reported four rows: three Initial Assessments and one Pre Site Visit, all then
Ready/Draft. The 2026-08-21 signed-in handoff proves the current pointer is now
Ready/Review; it did not refresh the aggregate count or expose the current row
GUID. There is
intentionally no Site Visit writeup pointer: staff observations remain direct
edits in the Pre-Site Word workspace.
Exact design and deployment boundary:
`docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md` and
`docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`.

**[VERIFIED IN SOURCE 2026-08-22; NOT LIVE-VERIFIED.]** The guarded-reopen
feature branch adds an additive Wave 20 spec for `wmkf_ReopenCycleId` (String
36), `wmkf_ReopenReasonCode` (String 50), and `wmkf_ReopenReasonNote` (Memo
2000). The successor row itself is the append-only reopen event when combined
with its existing source lookup/version/hash and standard created-by/created-on
fields. Source service, superuser route, status/history projection, Site Visit
dialog, exact-operation dedupe, post-upload recovery, ETag changeset, and
correction-cycle generation salting are focused-test covered. No target
preflight, metadata apply, runtime deployment, or business-row smoke has run.
The adapter's base projection excludes the Wave 20 fields while the literal-on
`GUARDED_REOPEN_SCHEMA_READY` interlock is disabled, and the reopen route then
fails closed with 503. The generation create payload also omits the Wave 20
property while off. After schema apply/readback, enabling that non-sensitive
flag exposes the fields. Failed attempts remain append-only evidence but do not
block a distinct later operation; unchanged retry reclaims the same row/item.
A competing generation blocks reopen only under a live lease. Expired reopen
claims are marked Failed, with any retained copy recorded by stable identity as
cleanup work, before a new operation proceeds. Generation activation rechecks
exact correction-cycle equality against the current Draft pointer. Reopen
history, nested correction details, and actor attribution are returned only to
superusers on both GET and generation responses; a pending reason-bearing reopen
attempt is omitted entirely for other roles. A Failed row remains available to
its exact operation retry, but a later distinct operation records any resolvable
retained copy as cleanup work. Actor/time is attributed only to reason-bearing
reopen events, never to later generated descendants that inherit only the cycle.

## Ownership

- SharePoint owns editable Word bytes and native version history.
- `wmkf_requestdocument` owns the request/cycle relationship, typed artifact and
  lifecycle state, producer operation state, stable Graph site/drive/item
  identity, upload/finalization eTag/version snapshot, and
  prompt/run/input/template/content provenance.
- `akoya_request.wmkf_CurrentInitialAssessment` is the request-level canonical
  pointer and shared concurrency fence for Initial Assessment activation.
- `akoya_request.wmkf_CurrentPreSiteVisit` is a live optional lookup and the
  Production writer/transition use it as the current-pointer/fence. Request
  `1002379` now resolves through that pointer to the Ready/Review Site Visit
  workspace; the 2026-08-21 browser proof did not expose its row GUID.
- `akoya_request.wmkf_CurrentFinalWriteup` is a live optional lookup for the
  independent Final Word row. Final will record the exact source Pre-Site
  row/version/hash; no writer populates this lookup yet.
- Site Visit has no current writeup pointer. The current Pre-Site Word item
  remains the workspace during that stage and SharePoint versions preserve PD
  observations.
- **[PRODUCTION-PROVED 2026-08-21]** the Site Visit transition
  resolves that current pointer, requires Ready/Draft Word state and a matching
  expected artifact id, verifies one stable SharePoint publication version
  around DOCX download/hash, then ETag-conditionally sets lifecycle Review and
  writes `wmkf_milestoneversionid`, `wmkf_milestonecontenthash`, and
  `wmkf_milestonecreatedat` on the same row. Exact completed retries are
  idempotent; no SharePoint copy or mutation occurs.
- Workbench and the pilot locator consume the same registry row; neither joins
  by filename. The planned full Editor Dashboard will reuse this identity
  contract.

## Initial Assessment pilot contract

- Artifact type: `Initial Assessment`.
- SharePoint library: the request's single Dynamics-tracked active
  `akoya_request` drive.
- Proposal input: exactly one active
  `AI Materials/ProposalNarrative_{Request#}.pdf`. The outbound reviewer
  package, Phase I display documents, archive-only matches, neighboring PDFs,
  and ambiguous active matches do not satisfy the producer contract.
- Request-relative destination: `Artifacts/Initial Assessment/`.
- Prompt: `initial-assessment.generate`, version 1.
- Template: `initial-assessment-standard-business-brief`, version `1.0.0`.
- AI-authored fields: Summary, Significance & Impact, Research Plan, Team
  Expertise.
- Staff-owned field: Foundation Opportunity. It is absent from the prompt
  output schema and visibly marked `STAFF INPUT REQUIRED` by the DOCX template.

## Production Pre-Site Visit runtime contract

- Artifact type: `Pre Site Visit` (already live in the Wave 16 option set).
- One Word file per versioned draft row; the row carries all eight named
  proposal-core fields and the exact validated Claude/input snapshots.
- The source proposal is exactly
  `AI Materials/ProposalNarrative_{Request#}.pdf`, with its stable Graph
  identity, version, and content hash captured in the immutable input snapshot.
  The bibliography is excluded from PSV generation identity and is reserved
  for next-cycle Reviewer Finder.
- The governed prompt remains admin-configured through
  `pre-site-visit.proposal-core.generate`; `wmkf_ai_run` remains the execution
  audit rather than the editable business record.
- A PDF distribution copy is a second Request Document row linked through
  `wmkf_SourceDocument` to the exact Word row and source version/hash.
- SharePoint Word becomes authoritative for staff prose once the row is Ready;
  no automatic Word-to-Dataverse section synchronization is claimed.
- The Site Visit tab reuses that stable Word item for staff observations while
  registering supporting files separately. The built handoff changes Draft to
  Review, records the exact current version/hash/time, and locks Pre-Site
  regeneration before any AI or write side effects. Final creation copies an exact
  Pre-Site item version to a new Final row/file and sets the separate planned
  current-Final pointer.

The persistence schema and writer are live in Production. **[VERIFIED IN
PRODUCTION 2026-08-17]** the runtime writer required the exact narrative,
persisted the eight named fields and immutable snapshots under its claim,
rendered only from Dataverse readback, uploaded one Word file to
`Artifacts/Pre-Site Visit/`, and atomically activated the current Ready row for
Request `1002379`. Exact Ready retry returned the same row/run/item without
another model call or upload. The first long client request displayed `Failed
to fetch` after durable server completion. **[DEPLOYED TO PRODUCTION
2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** GET status reads the current pointer plus the newest later
pending operation without mutation, and the tab performs bounded GET polling
after a lost POST response without repeating POST. Production template v2 added
Recommendation-cell padding under a new generation identity and created Ready
artifact `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6`, leaving the v1 row/file
untouched. Its exact SharePoint file exposed a width-sensitive Word Online
alignment defect in the Recommendation label. **[INFERRED FROM SCREENSHOT +
OOXML WIDTH]** implicit wrapping was the remaining layout variable. **[DEPLOYED TO
PRODUCTION 2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** template v3 makes that
label explicitly non-wrapping under another generation identity. Signed-in
current-status, compact actions/download, and Word Online v3 proof remain open;
this was never a registry consistency failure.

## Retry and partial-success behavior

`wmkf_generationkey` is a SHA-256 alternate key over request, artifact type,
authoritative input fingerprint, prompt identity/version, and template
identity/version. A Ready row returns without another model call or SharePoint
upload. A failed/stale operation can reclaim by ETag. If SharePoint upload
succeeded but the final registry PATCH failed, the row retains the expected
scheme-tagged governed-DOCX content hash and deterministic target. The intended
retry downloads the item, verifies normalized Word content, and finalizes
stable identity without rerunning AI. Recovery-stage errors transition an
owned claim to Failed immediately rather than leaving a misleading Generating
lease. Request `1003109` production-proved this branch by reusing the same
registry row, AI run, and SharePoint item/version while restoring the request
pointer. If the existing item's bytes no longer match, the producer retains
its exact drive/item identity for operator cleanup and generates to a fresh
claim-specific filename instead of overwriting the changed file or
dead-ending every retry.

Changed authoritative inputs or cycle create a distinct generation row. Its
Ready transition, the supersession of prior Ready rows, and the
`akoya_request.wmkf_CurrentInitialAssessment` pointer commit atomically in one
ETag-guarded Dataverse changeset. The request ETag is the shared fence across
different generation rows, so concurrent first-time activations cannot both
become canonical. If authoritative inputs revert, the exact earlier Ready
artifact is atomically reactivated rather than returned as Superseded.
Workbench/pilot-locator reads resolve the current Ready artifact through that
pointer
while exposing a newer pending/failed replacement separately. A claimant that
loses ownership after uploading deletes its exact claim-specific item; if
Graph deletion fails, exact drive/item cleanup work is retained in bounded
registry JSON and surfaced by the read model. The queue has no automated drain
yet. If its primary field reaches capacity, the exact new identity is written
to a dedicated overflow field and further generation for that deterministic
artifact is blocked until an operator resolves the cleanup; unresolved
identifiers are never silently evicted. Ordinary post-upload registry failures
retain their item for normalized governed-content recovery.

The governed writer requires positive resolution of the Dynamics-tracked
`akoya_request` parent library; it does not inherit the shared read helper's
best-effort library fallback. The route never returns success until a registry
read-back confirms `Ready`, stable drive/item IDs, and the atomic lineage
transition.

## Deployment/probe sequence

1. **Completed 2026-07-30:** name Production as the schema/prompt target.
2. **Completed 2026-07-30:** run
   `node scripts/preflight-request-document-table.mjs --target=prod`.
3. **Completed 2026-07-30:** with every artifact absent, run
   `node scripts/apply-dataverse-schema.js --target=<target> --wave=16-request-document-registry --execute`.
4. **Completed 2026-07-30:** re-run the preflight and verify the expected entity-set name
   `wmkf_requestdocuments` and request lookup
   `akoya_request.wmkf_CurrentInitialAssessment`.
5. **Completed 2026-07-30:** seed `initial-assessment.generate` with
   `node scripts/seed-initial-assessment-prompt.js --execute`.
6. **Completed 2026-07-30:** merge PR #102 and verify production deployment
   `dpl_AxxroabhpXLX1pz75MW6486fB4ci` Ready.
7. **Partially completed 2026-07-30:** Request `1002788` generation, lineage,
   both consumers, Word opening/version creation, and same-input retry passed
   for mechanics. The old Phase I source invalidates approved-input semantic
   proof. Request `1003109` then passed canonical-input generation,
   exact-input reuse, new-run request lineage, and interrupted-finalization
   recovery using the same row/run/SharePoint item and version. An attributed
   substantive edit on the stable item then passed through both consumers.
   Response-only current-version refresh and display in both consumers are
   deployed and live-verified on Request `1003109` via deployment
   `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`. Native version restore and first-stage
   recycle recovery also pass. Workbench version-history display shipped S413
   (2026-08-10, read-only). Administrator policy/access evidence, administrator
   restore, and retained Board snapshot copies remain open. The separate
   Pre-Site→Site Visit lifecycle milestone writer is deployed and the first
   controlled signed-in Draft→Review transition passed on Request `1002379`.
   The same exact SharePoint Edit/Download identity remained current, a fresh
   authenticated load returned the handoff time and Review state, and the
   service post-write reread required the exact version/hash/time milestone.

No live command in this sequence is authorized merely by this page.

For Wave 20, run the guarded-reopen preflight, stop on divergence, obtain
explicit apply approval, apply and re-read three exact fields, then set
`GUARDED_REOPEN_SCHEMA_READY=on` and promote/redeploy the runtime. Once the
environment contains a correction cycle, retain both the schema and flag during
rollback so generation continues to see the cycle identity.
