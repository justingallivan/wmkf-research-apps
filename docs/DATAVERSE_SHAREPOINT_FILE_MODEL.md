---
title: Dataverse / SharePoint File Storage Model
domain: dataverse
kind: source-of-truth
status: active
summary: "File storage and linking in AkoyaGO/Dynamics, including governed staff writeups and Site Visit artifacts."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-08-30
owner: product-engineering
related:
  - scripts/probe-sharepoint-write.js
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - docs/POWER_AUTOMATE_PROPOSAL_FILE_CONTRACT.md
---

# Dataverse / SharePoint File Storage Model

How files are stored and linked in the AkoyaGO + Dynamics environment, and how
new document flows (reviewer uploads, etc.) fit into the existing pattern.

> **Reviewer-flow status (owner-confirmed 2026-07-26):** the reviewer-PDF
> design was an experiment and is no longer the primary workflow. Reviewers now
> complete the in-browser form; final submit writes structured
> `wmkf_appreviewanswer` snapshots to Dataverse. The file-upload route and pointer
> fields remain as hidden compatibility/rescue infrastructure, so old SharePoint
> PDFs and test artifacts may still exist. A PDF's presence is not evidence of a
> current genuine review and is not deletion authority. Legacy upload-path rows
> are the exception to the structured-content assumption: their rating and
> multiselect values are in `wmkf_appreviewanswer`, but their narrative answers
> remain only in the uploaded PDF. Deleting one of those PDFs is therefore not
> recoverable from the structured rows.

---

## The architecture in one line

**Dataverse holds rows (metadata + pointers); SharePoint holds bytes (actual
files).** When you "attach a document to a request" in Dynamics, the file is
silently stored in SharePoint and a pointer record is created in Dataverse —
they look unified in the Dynamics UI, but are two separate systems under the
hood.

---

## Governed staff writeups and Site Visit artifacts — target contract

> **Owner-decided direction (2026-07-28); Initial Assessment implemented in
> source 2026-07-29; production registry/pointer schema and governed prompt v1
> provisioned 2026-07-30; Request `1002788` proved mechanics and Request
> `1003109` production-proved canonical input, new-run lineage, and
> interrupted-finalization recovery
> 2026-07-30.**
> This section governs the Initial Assessment, Pre Site Visit Writeup, and
> Final Writeup design as well as the Site Visit dossier and its materials.
> The application generated and registered the canonical artifact, both
> consumers found it, and exact-input retry created no duplicate. The pilot is
> mechanics evidence only because its source was an old Phase I proposal.
> Request `1003109` subsequently proved canonical-input generation,
> exact-input reuse, new-run request linkage, and recovery using the same
> registry row, AI run, SharePoint item, and version. An attributed
> substantive edit then advanced the same stable item to SharePoint version
> `2.0`, replaced the Foundation Opportunity marker, and remained discoverable
> through both consumers. **[VERIFIED DEPLOYED 2026-07-30 via production
> deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`, commit `68bcb4e8`, and
> signed-in Request `1003109` checks]** response-only current metadata refresh
> by stable drive/item identity is live in both consumers, which displayed
> SharePoint version `2.0` and the same stable document link. The pilot is not
> closed because target-library controls are only partially verified: version
> inspection/restore, first-stage recycle recovery, the configured version
> policy (major-only, keep 500, no age limit), and second-stage recycle
> presence (bin confirmed populated 2026-08-20) are verified, while Purview
> retention and the Edit level's exact Delete flags remain open
> (owner-accepted-open 2026-08-20 absent a pressing need). Workbench history
> is Production-live. Administrator restore and the owner-decided byte-copy
> Board snapshot are source-built 2026-08-30 on
> `codex/initial-assessment-controls`; promotion and owner-authorized
> Production write proof remain open.
> **[VERIFIED via owner decisions 2026-07-28
> and 2026-07-30, repository source,
> production Dataverse/Graph probes, and signed-in consumer checks
> 2026-07-30.]**

### Authority boundary

- **SharePoint Word document:** authoritative editable narrative. Native Word
  co-authoring, comments, tracked changes, AutoSave, and SharePoint version
  history operate on this copy.
- **Dataverse:** authoritative document identity, request/cycle relationship,
  artifact type, lifecycle state, structured decisions, access/workflow
  metadata, durable SharePoint identity/version references, and the
  request-level canonical Initial Assessment pointer.
- **Workbench:** creates or finds the registered artifact, displays its state
  and preview, opens it in Word, and exposes authorized recovery/milestone
  actions.
- **AkoyaGo publication projection (owner direction 2026-08-21; planned and
  discovery-gated):** selected governed writeups must remain discoverable to
  staff who use the AkoyaGo Documents interface and to approved Power Automate
  consumers. The governed artifact remains authoritative; destination,
  representation, naming, schema, triggers, and permissions are not yet
  decided or implemented.
- **Site Visit handoff (Production-proved 2026-08-21):** keeps
  the same stable Pre-Site Word item, verifies one exact current SharePoint
  publication version around a DOCX download/hash, records the version/hash/time
  on the row, and moves lifecycle Draft→Review under its Dataverse ETag.
- **Post-handoff UI ownership (Production-deployed and signed-in receipt smoke
  passed 2026-08-21):** commit `b3bb0ef6` first reached Production in Ready deployment
  `dpl_FkWu55fyBqSEo8q4DBcdcA3xvigi` and limits Pre-Site working controls to Draft.
  Review becomes a handoff receipt whose one action routes to Site Visit; later
  and unknown lifecycle values fail closed. Site Visit owns Edit/Download for
  the active Review workspace. Signed-in Request `1002379` verified the receipt,
  absence of Pre-Site work controls, one continuation action, and same-item Site
  Visit Edit/Download without invoking a document or write action.
- **Initial Assessment pilot locator (deployed and exercised):** queries the
  same typed registry across a cycle so approved
  collaborators can find and open the canonical Word files without visiting
  every request separately. This narrow cycle list does not yet implement the
  full Editor Dashboard filters, preview/version context, or Reviewed progress
  contract below.
- **Current metadata readback (deployed and live-verified 2026-07-30 local /
  2026-07-31 UTC):** native
  Word editing preserves stable item identity, while Dataverse intentionally
  remains the upload/finalization snapshot. The production read model queries
  current metadata by stable drive/item ID, overlays successful Graph values
  in the response only, and distinguishes `current`, `missing`, and
  `unavailable` without path guessing or registry writes. Both production
  consumers use one renderer for current/missing/unavailable/unchecked
  semantics. Signed-in Request `1003109` checks showed SharePoint version
  `2.0` and the same stable link in both consumers.
- **Replacement/current rule (deployed; exact-input retry exercised):**
  changed authoritative inputs or cycle produce a distinct generation row. The
  replacement's Ready transition and prior-Ready supersession are one
  ETag-guarded Dataverse changeset with
  `akoya_request.wmkf_CurrentInitialAssessment`. The request ETag provides the
  shared fence across otherwise-disjoint generation rows. Reverted inputs
  reactivate the exact earlier Ready artifact atomically. Pilot reads resolve
  the canonical Ready document through that pointer
  while exposing a newer pending/failed replacement separately, preserving
  both file access and retry visibility.
- **Governed write location (deployed and exercised):** the
  producer requires a positively resolved Dynamics-tracked `akoya_request`
  parent library. The best-effort fallback retained for legacy read-only bucket
  discovery is never accepted as a write target.

### Automated proposal input contract

The current proposal source for Initial Assessment and Workbench Field Primer
request mode remains the one exact active request file:

`AI Materials/ProposalNarrative_{Request#}.pdf`

The file must be under the request's Dynamics-associated `akoya_request`
SharePoint folder. An archive-only match, multiple active exact matches, a raw
application export, `Reviewer Materials/Proposal_{Request#}.pdf`, or
`Phase I/ProjectDescription.pdf` does not satisfy the contract; default
automation fails before the model and before result persistence. Reviewer
Finder remains a separate current-cycle surface: its authenticated explicit
`fileKey` supports deliberate historical/ad-hoc staff selection, while its
default loader prefers the exact outbound reviewer package and falls back only
to exactly one active `Phase I/ProjectDescription.pdf`. Neither or ambiguity
returns the server-listed picker before download/Blob write. The Workbench
Proposal tab separately displays the D26 Phase I document slots and every file
beneath the request's `Phase II` folder; these display/download collections do
not change the automated proposal-input contract above.

**[VERIFIED IN SOURCE 2026-08-16 via resolver tests and a read-only live
Dataverse/Graph extraction]** Request `1002788` resolves exactly
`AI Materials/ProposalNarrative_1002788.pdf` from the active
Dynamics-associated request folder and returns non-empty proposal text. Field
Primer preserves its existing stored-envelope behavior, so this source change
applies to new generations and explicit regenerations rather than silently
invalidating an existing primer.

**[OWNER DECISION 2026-08-17; PRE-SITE NARRATIVE-ONLY; REVIEWER FINDER CUTOVER
PLANNED.]** Power Automate keeps two exact files:
`AI Materials/ProposalNarrative_{Request#}.pdf` and
`AI Materials/ProposalBibliography_{Request#}.pdf`. Do not combine them into a
third canonical PDF. Pre-Site, Initial Assessment, and Field Primer supply and
fingerprint only the narrative. The current-cycle Reviewer Finder resolver is
unchanged; next cycle it will separately label and fingerprint both files so
cited authors can provide reviewer-discovery leads.

**Historical proof for the superseded automated-input contract:** [VERIFIED
2026-07-30 via live read-only Graph/Dataverse probe] Request
`1003109` has the exact active file
`Reviewer Materials/Proposal_1003109.pdf` in library `akoya_request`.
Request `1002788`'s earlier Initial Assessment instead used an old Phase I
proposal, so its registry and SharePoint results prove mechanics but not
approved-input semantics.

**[VERIFIED 2026-07-30 via signed-in production generation/retry and exact
read-only identity recomputation]** Request `1003109` generated Ready/Draft
registry row `3cec63a4-768c-f111-ab0f-6045bd018a07` from that exact PDF. The
recomputed input fingerprint and generation key match the persisted values;
AI run `528b97af-768c-f111-ab0f-7ced8d3d15a6` carries the correct request
lookup. Exact-input retry preserved one row/run/SharePoint item.
A controlled interrupted-finalization retry then restored the same registry
row and request pointer with attempt count `2` while preserving the one AI run
and SharePoint item/version, eTag, last-modified timestamp, size, and governed
hash.

Do not mirror the Word body into an independently editable Dataverse memo. That
would create two competing sources of truth and an unsafe Word→Dataverse merge
problem after co-editing. If later search or AI requirements need extracted
text, store it only as a derived, version-keyed representation that can be
rebuilt from the SharePoint original.

### Registry contract

The approved typed registry is implemented in schema-as-code as
`wmkf_requestdocument` (entity set `wmkf_requestdocuments`) rather than one ad
hoc URL field per writeup. Its complete Wave 16 schema, alternate key,
relationships, and request pointer are live in Production as of 2026-07-30.
The two controlled requests now each have one Ready/Draft row and matching
pointer: mechanics-only Request `1002788` and canonical-input Request
`1003109`.
The persistence contract accounts for:

- request and cycle;
- artifact type. The three narrative types are `initial-assessment`,
  `pre-site-visit`, and `final-writeup`; the Site Visit dossier also needs
  typed file artifacts for applicant slides, other applicant materials,
  recording, transcript, and transcript summary. Staff observations are direct
  edits in the Pre-Site Word workspace rather than a file artifact or a
  Dataverse notes field;
- SharePoint site/drive/item identity and human-facing URL;
- current version/eTag and last-modified metadata;
- producer, input coverage/fingerprint, AI prompt/run provenance, and
  Word-template identity/version where applicable;
- draft/review/board-ready/superseded/final lifecycle state; and
- immutable milestone version/snapshot references.

A URL alone is not the artifact identity, and a folder/filename convention is
not a durable join contract.

For the Initial Assessment pilot, the producer writes to the existing
Dynamics-tracked `akoya_request` request folder under the exact request-relative
path `Artifacts/Initial Assessment/`. It records the friendly path/filename for
humans but registers the Graph site, drive, and item IDs as identity. Exact
retries use a deterministic SHA-256 alternate key; a Ready row is never
regenerated or overwritten. The Request `1002788` exact-input retry proved
that Ready-row behavior for the then-loaded Phase I input, but not correct
Phase II source selection. If upload succeeds before the final registry PATCH
fails, the intended recovery downloads the deterministic SharePoint item and
compares it with the stored governed-content hash. **The controlled pilot
disproved whole-package byte hashing for the target library:** SharePoint
repacks the DOCX during ingestion. Branch
production commit `9c88a1fa` instead stores a `gdc1:`-tagged
SHA-256 over every `word/` part and canonicalizes the document relationship
part only to remove SharePoint-injected `customXml` relationships and XML
ordering/whitespace. Synthetic tests and the actual pilot packages prove
producer=v1 and producer≠v2. Untagged legacy hashes that do not match the
downloaded package exactly block for operator reconciliation without another
model call or upload. Recovery-stage exceptions are persisted as Failed rather
than leaving a live Generating lease. Request `1003109` production-proved the
matching-content path without another model call, upload, overwrite, duplicate
row, or SharePoint version change. If a scheme-tagged item's governed
content does not match, the producer preserves its exact identity in the
operator-visible cleanup queue and generate to a fresh claim-specific
filename; it does not overwrite or repeatedly dead-end on the changed file.
If the primary cleanup queue reaches capacity, exact new work is retained in a
dedicated overflow field and that deterministic generation is blocked until
manual cleanup resolves the overflow.

### Writeup lineage and distribution

The three governed writeup documents are Initial Assessment, Pre Site Visit,
and Final. There is no separate Site Visit Writeup. During the visit stage, the
Pre-Site Word document remains the PD's workspace and site observations are
entered directly into it; SharePoint preserves those edits as native versions.
The Final Writeup is created from the exact current Pre-Site version available
when staff invokes the action. The registry retains the source artifact
identity and exact source version/hash used for that operation; subsequent edits
do not keep the two documents synchronized. Staff may rarely invoke a
deliberate regenerate-from-latest action, but it must create a new Final
row/file, preserve the prior Final, and never silently overwrite staff edits.

The Pre-Site→Site Visit handoff is now a concrete lifecycle operation in
source. The request pointer remains authoritative; the browser artifact id is
only a stale-view fence. The transition requires a Ready/Draft Word row and a
stable Graph drive/item/publication version before and after content download,
records `wmkf_milestoneversionid`, `wmkf_milestonecontenthash`, and
`wmkf_milestonecreatedat`, and sets lifecycle Review in one ETag-conditional
PATCH. It performs no SharePoint write or copy. Review locks the Pre-Site
producer before it loads inputs, resolves a prompt, calls Claude, claims a row,
renders, or uploads. Exact completed retries are idempotent.

**[OWNER DIRECTION 2026-08-21; PRODUCTION-PROVED 2026-08-23.]** Wave 20 readback is 3 exact/0 divergent, the Production
readiness flag is literal `on`, and merge `af986d92` is Ready in deployment
`dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp`. Signed-in Request `1002788` exercised the
extended read-only status path without a write. After exact owner approval,
signed-in Request `1002379` created one Ready/Draft successor and one distinct
SharePoint copy, preserved and superseded the Review source, and moved the
request pointer atomically. Exact unchanged retry reused the same row/item;
Dataverse/Graph postcheck proved one cycle row, distinct item identities,
stable reads, and identical governed source/successor bytes.
Reopening Pre-Site preparation is a successor operation, not an in-place
Review→Draft demotion.
For an accidental handoff or wrong governed input, the service must verify that
the current Ready/Review item still exactly matches its handoff milestone and
has no derived Final, retained snapshot, completed informational distribution,
or AkoyaGo publication. It then copies those exact bytes to one new stable Word
item, creates one linked Ready/Draft successor row with the exact source
row/version/hash, and atomically moves the Request pointer while preserving and
superseding the prior Review row without clearing its milestone. Actor, reason,
operation ID, source, and successor require a durable append-only audit record;
exact retry returns the same successor. A post-handoff Word edit or downstream
consumer fails closed for explicit reconciliation. Ordinary content correction
continues in the live Site Visit Word file and does not reopen generation.
The branch implements that record on the successor row with three bounded Wave
20 fields (cycle/client UUID, reason code, reason note), existing source and
source-version/hash fields, and standard Dataverse created-by/created-on
attribution. The route is superuser-only. Later Pre-Site generation keys are
salted by the correction cycle so unchanged governed inputs cannot reactivate
the preserved row. The service re-reads both source and verified target identities
immediately before its ETag-guarded transition, and durable incomplete or failed
rows remain visible as attempts rather than completed history. Target metadata has
not been probed or changed; schema apply, runtime promotion, and a signed-in
controlled smoke remain explicit later gates.

The Pre-Site stable proposal core may exist before every review is received.
It is drafted from the exact Proposal Narrative through the governed
`pre-site-visit.proposal-core.generate` prompt, which iterates the useful body
of the retired Phase II summarizer while removing inferred administrative
fields. Authoritative request metadata and the ordered PI/Co-PI roster come
from Dataverse. **[VERIFIED IN PRODUCTION 2026-08-17]** the guarded
proposal-core helper and tracked Word template renderer are live. Request
`1002379` resolved the exact narrative and every template metadata field,
completed the governed writer, and produced the stable Word artifact.
The governed history includes prompt v3
`f2c9ce97-f499-f111-b8db-7ced8d6e2f44`; latest audited Executor evidence is governed v3 run
`ba0f42b9-849a-f111-b8db-6045bd008868`. The Production renderer fits
Background and Methodology on page 3 and applies the revised personnel rules
and roster-name underlining. The writer requires the exact Proposal Narrative,
passes it as a bounded Claude
variable, persists its identity/version/hash manifest and all
eight named fields in Wave 19, renders from Dataverse readback, uploads one
stable Word item to `Artifacts/Pre-Site Visit/`, and atomically activates the
current Ready row. The route returns a registry DTO. Draft-state Pre-Site UI
exposes its stable Word link; Production-deployed receipt hardening removes that
link after Review and routes work through Site Visit instead. Request `1002379` exact Ready retry reused the same
row/run/item without another model call or upload. **[DEPLOYED TO PRODUCTION
2026-08-18; SIGNED-IN GENERATION + NO-DUPLICATE SMOKES PASSED 2026-08-27]**
prompt v4 `74409f95-509b-f111-b8db-6045bd008868` was exact-readback verified
2026-08-18 and later re-published as sole-current v5 (unattributed,
content-identical per the runtime exact-match preflight); the 2026-08-27
Request `1002852` smoke proved Ready-with-warning generation and exact
no-duplicate retry on Ready deployment `dpl_HGogbJnprevoYKLaxevamxdajtC4`
(see `docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md` §Status).
**[DEPLOYED TO PRODUCTION 2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** the Workbench loads
read-only current/pending status and uses bounded GET polling after a lost POST
response without repeating POST. Production template v2 added
Recommendation-cell padding under a new generation identity and created Ready
artifact `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6`, leaving the Production v1
row/file untouched. Its exact SharePoint file exposed a Word Online-only
width-sensitive alignment defect in the Recommendation label. **[INFERRED FROM
SCREENSHOT + OOXML WIDTH]** implicit wrapping was the remaining layout variable.
**[DEPLOYED TO PRODUCTION 2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]**
template v3 makes that label explicitly non-wrapping under another generation
identity.
Its future review-derived portion uses `review-synthesis.generate` over all
currently submitted reviews; staff do not select a subset. The two layers have
independent prompt/run provenance and refresh behavior.

**[VERIFIED INVENTORY / PRODUCTION SCHEMA 2026-08-17.]** Versioned
Pre-Site drafts reuse `wmkf_requestdocument` beneath the Request. The live
registry already has a `Pre Site Visit` artifact option and the necessary
request, prompt, run, template, lifecycle, retry, and SharePoint identity
spine. The legacy `wmkf_sitevisit` activity has no suitable content fields,
and `akoya_request.wmkf_researchwriteuptype` is only a Phase I/Phase II-style
classification.

Production-live Wave 19 provides the eight proposal-core sections as sibling editable
Multiline Text columns on the Pre-Site Word row, not eight child records. It
also specifies exact validated-output and structured-input JSON snapshots,
render/source identity, `akoya_request.wmkf_CurrentPreSiteVisit` as the
canonical Ready Pre-Site Word pointer, and
`akoya_request.wmkf_CurrentFinalWriteup` as the canonical Ready Final Word
pointer. There is intentionally no Site Visit writeup pointer. `wmkf_ai_run`
remains the append-only execution audit rather than the editable business
record. A retained Word distribution snapshot is a separate registry row whose
`wmkf_SourceDocument`, source version, and source hash identify the exact
editable Word version frozen. When PDF is selected, a second registry row
links to that retained Word row and records the Word-snapshot version/hash
converted through Graph. Full field, transition, and cross-tab contracts:
`docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md` and
`docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`.

All 12 Wave 19 attributes and both request-pointer relationships are live and
exact in Production. The immediate post-apply inventory reported only three
Initial Assessment registry rows, so the schema apply itself created no
business row. The deployed writer later created Ready/Draft Request `1002379`
row `aeb223a2-849a-f111-b8db-70a8a59cded0`, stable SharePoint item
`01G4GVMS3Q5BJ65S7DDZDKFTSQLIQAIPER`, and the then-current request pointer. The
dated 2026-08-17 inventory was four rows: three Initial Assessments and one Pre
Site Visit. The 2026-08-21 signed-in handoff proves the current pointer is now
Ready/Review; it did not refresh the aggregate count or expose the current row
GUID.
SharePoint Word remains authoritative for
staff prose after document creation; the named Dataverse fields are the
structured generation/automation representation and do not claim automatic
synchronization from later Word edits.

The review-derived portion has two presentation channels over that same exact
submitted-review population. Application/template code renders a named reviewer
roster; `review-synthesis.generate` supplies anonymous observations. For each
roster row, use the engagement-specific accepted
`wmkf_appreviewersuggestion.wmkf_revieweraffiliation` first, then the
potential-reviewer person's primary affiliation, then an explicit
missing-affiliation state. Do not make Contact `parentcustomerid` a prerequisite
and do not ask the model to reproduce the roster. This keeps names and
affiliations legible without attributing a synthesized point to a person.

The Site Visit date, not review completeness, controls distribution. A
zero-review document is valid and states that no reviews were received as of
its evidence timestamp. Otherwise the review-derived portion carries submitted
review count/coverage, its matching named-affiliation roster, and an as-of
stamp. A later review makes that portion
visibly stale and supports deliberate synthesis regeneration without
regenerating the proposal core.

Because staff edit the canonical Word prose, a new review synthesis must not
silently replace the edited review section. Staff deliberately incorporates or
refreshes it, and the earlier distributed version remains frozen. A
redistributed Pre-Site document is a new frozen version/snapshot, not an
overwrite of the evidence for what earlier recipients saw.

The Word layout is a versioned, replaceable template initially based on the
owner-supplied Pre-Site/Final examples and current prompt structure. Each
generated artifact records both template and prompt versions. New structural
requirements publish a compatible prompt/template pair for future generations
without altering the historical layout or meaning of existing documents.

The starting Initial Assessment template is derived from four owner-supplied
D26 Phase I examples verified on 2026-07-28. It targets one page and contains
the applicant-submitted proposal title, institution, Summary, and a Rationale
with Significance & Impact, Research Plan, Team Expertise, and Foundation
Opportunity. The AI drafts the first three rationale sections and the Summary.
Foundation Opportunity is an explicit staff-authored slot and must remain
visibly outstanding until staff fills it; model-generated filler is not
authoritative.

Institution and proposal title are structured inputs, not prose to infer. Resolve
institution from `akoya_request.wmkf_organizationname`, falling back to the
formatted applicant lookup. Resolve the title from the applicant-submitted
`akoya_request.akoya_title`; do not use the later house-style Keck title in
`wmkf_wmkfprojectdescription`. A read-only production probe matched the
supplied D26 examples to their stored Keck titles and confirmed that those rows
used the applicant-lookup fallback for institution, but the owner chose the
applicant-submitted title for the J27 Initial Assessment because the Keck title
belongs to the later post-advancement workflow. The exact Initial Assessment
format remains in flux during the transition to a single-phase submission.
The D26 structure is a starting point to iterate through the versioned template,
not a permanent layout contract.

Staff collaborators continue to use the canonical SharePoint Word workspace.
For informational email, authorized staff can attach an exact frozen Word
snapshot, a PDF converted from that retained Word snapshot, or both. An
anonymous or guest SharePoint document link is not required for this minimum
contract.

**[OWNER DIRECTION 2026-08-23; PRODUCTION-PROVED 2026-08-24.]**
Promotion does not send email. Staff explicitly creates or reuses the retained
snapshot set, selects Word, PDF, or both, enters To/CC recipients, previews the
editable subject/body plus exact attachments, and confirms that preview before
send. Recipients are known staff members or consultants; staff entry is
authoritative, so the server applies syntax validation, lowercase
normalization, deduplication, and To/CC conflict checks without an
identity-confidence or directory-membership gate. Any invalid recipient rejects
the whole operation before a send.

Migration `034_pre_site_distribution_attempts.sql` added the live, schema-read-
back Postgres coordination ledger. Production Request `1002379`, operation
`85f52fc5-fb48-4ceb-84d6-0f246af0b6fb`, proved the PDF-only path from a
Review-state source: retained DOCX and PDF Request Document rows are Ready and
Board Ready, the ledger is `sent`, and Dynamics activity
`33ce6346-d89f-f111-b8db-6045bd07a06d` reached Sent with exactly one PDF
attachment whose SHA-256 is
`574ac7b833801866c370a8056b7197933addfe3ea5dd535dcf4d29803c18f0c9`.
The activity sender/recipient was `jgallivan@wmkeck.org`, its `createdBy`
matched the authenticated actor, the Workbench history row was visible, and a
bounded Production error-log scan was clean. Dynamics appended its
`CRM:0153199` tracking token to the persisted subject after transport
acceptance; preview exactness remains the pre-transport contract. Inbox
delivery remains unverified. SharePoint and
`wmkf_requestdocument` own retained file identities; Postgres owns exact
preview/send recovery; Dynamics owns the email activity. Production metadata
and sandbox raw-recipient transport/repeat probes also passed.

One durable distribution attempt retains the exact source Word, retained Word,
and selected PDF identities/versions/hashes, recipient set,
subject/body/template hashes,
actor/time, Dynamics email activity ID, client operation ID, state, attempt
count, last completed step, and bounded error evidence. Its state machine is
`preparing → prepared → activity_created → attachments_added →
send_requested → sent`,
with separate Word/PDF attachment timestamps so `both` can resume between files.
The existing composed Dynamics helper is not a sufficient retry coordinator
because a create or attachment may survive an exception before the helper
returns the email ID. Runtime persists the ID after creation or unique
correlation recovery and before exact activity-content assertions, resumes the
same activity after attachment/send failure, and renews the fenced lease
immediately before transport. Correlation ambiguity remains a failure rather
than authorizing a replacement create. Exact sent retry returns the existing receipt;
changed attachment mode, recipients, body, template, source version, or
selected attachment bytes require a new preview and attempt. `sent` means
transport acceptance, not inbox delivery.
History preserves what each audience received and compares the recorded source
version with the current Word pointer/version to mark a prior distribution
changed-since-preview when the workspace advances.

**[OWNER DIRECTION 2026-08-21; PLANNED, NOT BUILT.]** The Workbench must also
plan for an **AkoyaGo publication projection** so important governed writeups
remain findable to staff who work from the request's AkoyaGo Documents surface
and to approved Power Automate flows. This is additive to the canonical Word
workspace and the frozen-attachment distribution contract. It does not authorize a
second independently editable source of truth.

The exact AkoyaGo-visible destination is **UNKNOWN** pending signed-in discovery:
the request root, a dedicated folder, an additional SharePoint Document
Location, a materialized copy, and a supported link-like representation remain
candidates. Filename conventions, Word/PDF representations, publication
triggers, permission behavior, and the minimum Dataverse schema are likewise
undecided. Example paths and filenames discussed before discovery are not a
contract. The existing Power Automate proposal-file contract applies only to
the exact `Reviewer Materials` and `AI Materials` inputs and is not evidence for
a writeup-publication naming scheme.

Regardless of the eventual storage design, a publication must retain the exact
source Request Document row/item/version/hash, the destination's stable
identity/version/hash, its purpose or representation, actor/time, and durable
success/failure state. Exact retry must not create a duplicate. Updating a
published destination must first detect unexpected staff changes and fail
closed rather than overwrite them or merge them back into the governed source.
Lifecycle completion and publication are separate outcomes: a failed
publication stays retryable and visible without undoing a completed Site Visit
handoff or claiming combined success.

Before schema or runtime work, inspect representative historical/current
AkoyaGo request Documents views, inventory the relevant Power Automate flows
and old naming/replacement assumptions, and run approved non-governed tests of
candidate destinations and representations. The discovery must prove AkoyaGo
visibility, Power Automate consumption, first publish, exact retry,
changed-source republish, destination-drift handling, partial failure, recovery,
and SharePoint item/version behavior. The bounded discovery and implementation
gates live in `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`.

There is no separate Site Visit Writeup. The PD adds site observations and
other visit-stage prose directly to the Pre-Site Word workspace. Creating the
Final then copies the selected exact Pre-Site version—including those edits—
and lets the PD continue incorporating late reviews, transcript evidence, and
editorial changes into the independent Final artifact. The copied review roster
and anonymous narrative retain the selected Pre-Site evidence snapshot. Any
deliberate late-review refresh in the Final updates roster, coverage/as-of
metadata, and anonymous synthesis together while preserving the prior Final
version.

### Site Visit dossier and transcript-derived artifacts

The Site Visit Word-workspace handoff is Production-deployed and passed its
controlled signed-in Request `1002379` Draft→Review smoke on 2026-08-21. The
same SharePoint item remained the Edit/Download workspace; a fresh authenticated
load returned Review plus the handoff time, and the service's post-write reread
required the exact version/hash/time milestone. The structured logistics and
supporting-file dossier remains planned.
The full tab joins:

- visit date;
- start and end time, with time zone;
- in-person, virtual, or hybrid format;
- physical location and/or meeting link;
- lead PD;
- participating WMKF staff;
- applicant participants;
- participating Board members or consultants;
- applicant slides;
- other applicant materials;
- recording;
- transcript;
- transcript summary; and
- the current Pre-Site Word workspace, where staff record observations.

Do not add a separate Scheduled/Completed/Cancelled/Rescheduled status unless a
consuming workflow is later identified. Applicant slides, other applicant
materials, recording, transcript, and transcript summary are file-backed
artifacts. Do not add or repurpose a Dataverse staff-observations Memo: staff
record observations directly in Word, with native SharePoint version history.

The governed request-relative paths are
`Site Visit/Applicant Materials/Slides`,
`Site Visit/Applicant Materials/Other`, `Site Visit/Recording`,
`Site Visit/Transcript`, and `Site Visit/Transcript Summary`. Each file is one
Request Document row with stable Graph identity; path and filename are not its
durable key.

Pre-Site distribution snapshots and the Final Writeup are linked lifecycle
documents, not Site Visit material categories.

The recording and transcript are authoritative evidence. A transcript summary
is derived and replaceable. Prefer an acceptable summary emitted by the
approved transcription platform; do not silently make a redundant suite LLM
call. A suite LLM run is a deliberate fallback when no platform summary exists,
staff explicitly requests one, or the platform result fails the approved
quality contract.

The operational transcript workflow must be coordinated with a program
coordinator; provider, handoff, timing, and ownership details remain pending
that discussion.

For every summary, the registry must preserve the producer/system and relevant
version, source transcript item plus version/hash, generation time, lifecycle
state, and current/stale relationship to the transcript. A changed transcript
must not leave an old summary presented as current.

Do not build a general app-level revision chain or current-file picker for
staff- or system-managed Site Visit materials without observed need. Register
every file independently and display both if a second file unexpectedly
appears in the same category; category or filename alone never implies
replacement. The applicant upload surface is the narrow exception: an
authorized applicant may explicitly delete or replace an applicant-material
file while access remains active. Those actions must remain auditable and
recoverable. Native SharePoint version/recycle history and Dataverse
audit/provenance remain the protection mechanisms.

### Site Visit Materials Upload contract

The planned external surface is a narrow **Site Visit Materials Upload**, not
the parked general applicant-intake portal. The conceptual precedent is the
existing request-scoped external upload pattern, but its routes, tables, and
persistence contract must not be reused without an explicit design review.
**[VERIFIED via `docs/API_ROUTE_SECURITY_MATRIX.md` and the current
`/api/external/grantee/[token]` routes, 2026-07-28.]**

Minimum whole-flow invariants:

1. An authorized staff user manually triggers an expiring, request-scoped
   link. Entering or changing the Site Visit date never sends it automatically.
   Site Visits are scheduled promptly after advancement, roughly when reviewer
   invitations begin. Once the date is recorded, the action is available and
   staff chooses when to send; review receipt, synthesis, and Pre-Site Writeup
   readiness are not gates. Any authenticated staff member with access to the
   Workbench Site Visit workflow may send, resend, or reissue; there is no
   lead-PD or administrative-role restriction. Visible sender/reply-to and
   whether or how the lead PD is copied remain product decisions pending the
   owner's coordination with staff. Historically, non-PD staff usually sent
   these requests without PD involvement; do not encode that prior convention
   as the future contract. The server sets token expiration to exactly 60 days
   after a successful invitation send; staff do not enter or edit the expiry,
   and moving the Site Visit date has no effect. The token supports revocation
   and cannot be supplied as an arbitrary destination selector. Resend is
   available only for a current active link, reuses that link, and preserves
   its original expiry. Reissue deliberately revokes the prior link, creates a
   replacement, and starts a fresh 60-day period from the successful
   replacement send. Expired or revoked links require reissue, not resend.
   Reissue is also the backup restart path. A replacement is staged and the
   new invitation must be accepted by the email transport before the old
   active link is revoked and the replacement becomes active. A failed
   replacement therefore leaves a still-active prior link usable; if none was
   active, staff may restart again. The minimum product has no standalone
   Revoke action: normal access ends through the 60-day expiry, while Reissue
   uses the underlying revocation state only to retire the superseded link.
2. Recipient choices are the request's Dataverse-linked liaison and PI. The
   normal default is the liaison in **To**; staff may instead address the PI
   and optionally copy the liaison. The server resolves the selected contacts
   and current email addresses from Dataverse at send time; the minimum product
   has no free-form recipient requirement. The owner expects these contacts to
   remain complete and non-duplicative. The server nevertheless fails closed
   when a selected contact is missing, lacks a valid email, or the selected
   To/CC contacts resolve to the same address. Staff corrects Dataverse rather
   than entering a substitute address. The message contains one shared
   request-scoped bearer link;
   both To and CC recipients may use it and manage the same applicant-material
   file list. Without sign-in or separate personalized links, audit can identify
   the request/link but cannot attribute an action reliably to the PI or
   liaison.
3. The external recipient sees only the request identity, instructions, and
   the permitted **applicant slides** and **other applicant materials**
   categories. The recipient cannot upload recordings, transcripts, transcript
   summaries, or edit the staff Word workspace; browse Dataverse or SharePoint; choose
   another request; or supply a drive, folder, item, or record identifier.
4. The server resolves the request, Site Visit context, and server-controlled
   SharePoint destination from the validated token. Files land inside the
   request's governed SharePoint folder under
   `Site Visit/Applicant Materials/Slides` or
   `Site Visit/Applicant Materials/Other`.
5. Applicant uploads are limited to **PDF** and **PPTX**. Before persistence,
   the server enforces rate, size, file-count, extension, MIME/magic-byte, and
   malware checks and normalizes the stored filename/path. Large-file support
   requires a resumable/chunked Microsoft Graph upload session; it must not
   buffer an entire large file in a Vercel function or merely raise the current
   `GraphService.uploadFile()` 60 MB guard. The product limit is **1 GB per
   file** and **20 current applicant files per request** across both categories.
   Retired/replaced versions do not count as current files. At the 20-file cap,
   replacement remains allowed by reserving the target file's slot and making
   the new registry row current only as the prior row becomes retired; an
   unrelated twenty-first current file remains blocked.
6. Successful bytes end in the governed SharePoint location and a typed
   Dataverse registry row records stable identity and provenance. A temporary
   Blob location, if later chosen for scanning, is transit rather than the
   durable source of truth.
7. The implementation must define idempotency and compensate safely when the
   SharePoint write succeeds but registry creation fails, or vice versa.
   Staff must see a retryable, auditable state rather than an unregistered
   orphan or false success. This is an engineering acceptance invariant, not
   an owner workflow decision.
8. Additional uploads are allowed while access remains active. The external
   surface lists the shared applicant files authorized by the request-scoped
   link and supports explicit delete and replace actions for both To and CC
   recipients. It shows only current files and success/error confirmations,
   not an applicant-facing activity or recovery log.
9. A replacement first uploads and registers the new file successfully; only
   then may the prior file be retired or recycled. A failed replacement leaves
   the prior file intact. Delete and replacement accept only a server-resolved
   opaque artifact identity scoped to the request/token, never a client-supplied
   SharePoint path, and preserve an audit/recovery trail. The prior registry
   row remains as retired/removed provenance, while native SharePoint
   version/recycle recovery protects the bytes. The minimum product gives
   neither applicants nor Workbench users a custom restore control; authorized
   staff recover through SharePoint when needed.
10. Successful uploads, replacements, and deletions are batched into a short
    automated digest to the lead PD and the relevant staff audience rather than
    generating one message per operation. A program coordinator may be among
    the recipients, but changing staffing means that role must not be
    hard-coded as the only additional recipient. The exact staff-recipient
    policy and short batching window remain open.
11. Staff audit display identifies the action, file name, category, size,
    timestamp, request, and shared-link identity. It does not claim whether the
    PI or liaison acted. Applicants receive no activity log.

Exact sender/reply-to and lead-PD copy behavior after owner/staff coordination,
exact registry schema and target-library configuration, large-file
malware-scanning contract, additional notification audience and short-digest
window, and retention remain open design decisions.

### Applicant large-file infrastructure boundary

**[VERIFIED 2026-07-28 via current source and primary vendor documentation;
Site Visit implementation PLANNED.]**

- SharePoint Online permits an individual file up to 250 GB. Microsoft Graph
  upload sessions accept sequential fragments smaller than 60 MiB, with
  non-final fragment sizes divisible by 320 KiB.
- Dataverse file columns can be configured up to 10 GB through code and require
  chunking above 128 MB. PostgreSQL variable-length fields have a 1 GB logical
  ceiling. Those are platform capabilities, not reasons to store the applicant
  bytes there.
- The existing `GraphService.uploadFile()` accepts an in-memory `Buffer` and
  rejects content above 60 MB. The current external reviewer route buffers each
  file and caps it at 25 MB. Raising either number would increase function
  memory pressure without providing resumability.
- The target contract is therefore SharePoint bytes, Dataverse registry and
  provenance, and Postgres only for expiring-link/resumable-session workflow
  state. A new Graph upload-session flow must support retry/resume and
  server-controlled destination resolution. The product cap is 1 GB per file
  and 20 current applicant files per request, leaving roughly fourfold
  headroom over the approximately 250 MB files reported by the owner. The
  target-library behavior and large-file malware-scanning path must still be
  exercised.

Primary references:
[SharePoint limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/sharepoint-online-service-description/sharepoint-online-limits),
[Microsoft Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0),
[Dataverse file columns](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/file-attributes),
and [PostgreSQL limits](https://www.postgresql.org/docs/current/limits.html).

### Cycle-wide Editor Dashboard contract

Allison is a confirmed primary user for a staff-wide cycle editing surface.
All PDs are expected eventually to evaluate the materials, and designated
staff proofreaders also need access. The dashboard must replace the useful
affordance of the former designated SharePoint folder—a single browsable set of
writeups—without copying the files or rebuilding Word editing.

It should list the registered artifacts by cycle and expose request identity,
institution, program/PD, artifact type/stage, lifecycle state, current version,
last modified, preview, and **Open in Word**. The earlier design also established
an explicit per-editor **Reviewed** marker and personal “N of M” progress.
That marker is tracking, not approval; SharePoint “has edits” evidence is only
a secondary hint because no edits can mean either “reviewed; no changes” or
“not reviewed.”

The Reviewed marker requires durable per-editor state, likely a child row keyed
to the editor and registered artifact. Its exact granularity (request versus
artifact stage), coordinator matrix, and access key remain design decisions.
The first draft-functional delivery gate was targeted at 2026-08-10, before
proposal intake begins around 2026-08-18. That date was a deliberately early
**internal buffer, not an external commitment** (owner, 2026-08-10 / S412) and
has passed unmet with administrator evidence still outstanding — expected, not
slippage; see `docs/CURRENT_WORK_QUEUE.md` row 1 for the real completion gate.
A human-in-the-loop Initial Assessment pilot must
create and register a real canonical Word artifact, let authorized staff open
and edit it, and let staff find and open that same registered artifact from
both the Workbench and this dashboard. One safe failure/retry path must prove
that the SharePoint bytes and Dataverse registry reconcile before success.
The owner chose a controlled production rehearsal using colleague-created
representative dummy requests rather than building the existing Dataverse
sandbox organization into an integrated application/file test environment.
The dummy request IDs and content shape, named testers, and schedule remain
open. App list visibility and SharePoint edit permission are separate
authorization boundaries; passing one must not imply the other.

### Search contract

SharePoint document bodies remain systematically searchable. The current
`GraphService.searchFiles()` implementation calls Microsoft Graph Search with
`driveItem` results and KQL path scoping; a read-only 2026-07-28 tenant probe
with a quoted scientific phrase returned the implementation's 100-result cap
across `.doc`, `.docx`, and `.pdf` body content.

That proves platform and tenant capability, not a finished Workbench search
contract. Before exposing corpus search, the implementation must add:

- pagination/completeness beyond the current first 100 hits;
- authorization appropriate to app-only Graph permissions;
- a join from each result to its typed Dataverse document/request record;
- cycle, program, artifact-type, and lifecycle filters; and
- an explicit freshness posture for SharePoint's asynchronous index.

Use Dataverse for structured narrowing and Microsoft Search for file-body
matching. Add a separate derived text index only if measured freshness,
completeness, or semantic-search requirements cannot be met that way.

### Version and data-protection contract

An editable SharePoint file is not production-ready until its recovery and
records controls are verified:

1. audit the target library's version-history limits and demonstrate
   previous-version inspection and restoration;
2. audit first/second-stage recycle-bin recovery and the applicable Microsoft
   Purview retention policy or label;
3. define an editor permission level that supports Word co-authoring without
   granting ordinary editors unnecessary delete, move, rename, permission, or
   version-deletion authority;
4. expose current version, last-modified identity/time, and version history in
   the Workbench; restrict restore to an approved administrative role; and
5. freeze every official Board milestone as a separate retained Request
   Document snapshot row/item with source request/artifact identity, SharePoint
   item and version ID, timestamp, actor, content hash, and retained DOCX and/or
   PDF bytes. Do not overwrite the working Pre-Site row's Site Visit handoff
   milestone.

Working prose remains editable and recoverable. An official milestone remains
identifiable even after later edits to the working document. The current app
can download, search, upload, and delete SharePoint files; source now also
implements exact prior-version download plus retained Pre-Site Word/PDF
distribution snapshots. Administrator restore, retention enforcement, and
general Board-milestone controls remain separate open work.

### Controlled target-library audit — 2026-07-30 local / 2026-07-31 UTC

**[VERIFIED via production Microsoft Graph and signed-in SharePoint probes]**
The actual `akoya_request` Request library supports native version creation,
specific-version inspection/download, and restore. A disposable text file was
uploaded twice, exposing versions `2.0` and `1.0`; version `1.0` was downloaded,
restored through Graph, and became current as new version `3.0`. Exact expected
bytes matched before and after restoration. The probe was then deleted.

The same deleted probe was visible in the first-stage SharePoint recycle bin
with its original library location. Justin restored it through the normal
signed-in SharePoint UI, Graph readback confirmed the same item and exact
version-one contents were live, and the file was deleted again. Both
disposable probe artifacts were then removed from the first-stage bin. This
proves ordinary signed-in first-stage recovery and leaves no probe file live
or in the first-stage bin.

The remaining controls are deliberately not collapsed into that pass:

> **Administrator response received 2026-08-10 (S413), from Connor, verbatim:**
> "Major versioning is on" / "No second-stage recycle bin" / "Not familiar with
> purview" / "Site members have 'limited control'". One of the four questions is
> cleanly answered; the classifications below record what each reply does and does
> not settle. Connor's replies are an administrator's report, not a probe — treat
> the surprising one (no second-stage bin) as needing confirmation before any
> durability guarantee rests on it.

> **IT screenshot evidence received 2026-08-20 (S448), relayed by Justin from a
> signed-in IT/administrator session; screenshots retained by the owner, not
> committed.** Three captures: (1) a classic library permissions page on the
> akoyaGO site — "This library inherits permissions from its parent (akoyaGO)";
> akoyaGO Members hold **Edit**, Owners Full Control, Visitors Read; two
> individual Limited Access grants and four organization-edit SharingLinks
> groups. Caveat: that page's List GUID `{833C5A1F-94F4-4F2E-B94C-F31CF73728E1}`
> does **not** match `akoya_request`'s verified `fd037f0b-8df4-41f5-8fed-c3984d351918`,
> so the site-level assignments are proven but `akoya_request`'s own inheritance
> is [ASSUMED] from this capture. (2) The site home: the connected Microsoft 365
> group is **Public**, 4 explicit members. (3) The **second-stage recycle bin,
> open and populated** — containing exactly the two 2026-07-30
> `_wmkf_library_control_probe_*.txt` audit probes, deleted by "SharePoint App",
> original location `sites/akoyaGO/akoya_request`. The owner ruled 2026-08-20
> that no further administrator information is expected unless a pressing need
> arises; the classifications below reflect that.

- **[ANSWERED 2026-08-10 (S413)] Library version-limit policy.**
  **[VERIFIED via the signed-in Versioning Settings page for `akoya_request`,
  captured to PDF and read directly.]** The full configuration:

  | Setting | Value |
  |---|---|
  | Document Version History | **Create major versions** only (minor/draft versions **off**) |
  | Version time limit | **No time limit** — versions are never deleted by age |
  | Version count limit | **Keep 500 major versions** |
  | Keep drafts for N major versions | unchecked |
  | Content approval | No |
  | Require check out | **No** (this is what permits the Word co-authoring behaviour the pilot observed) |

  This closes the question and **confirms Connor's "major versioning is on"
  independently**, matching the pilot's empirical `1.0 → 2.0 → 3.0`.

  **Consequence for durability: version *pruning* is no longer a material risk.**
  500 major versions with no age-based expiry is far beyond the realistic life
  of an assessment document — **[ASSUMED, n=1]** on the version-production rate:
  Word coalesces an editing session into a single version rather than one per
  save, evidenced only by Request `1003109`, where one multi-field editing
  session produced exactly one version (`2.0`). No probe has measured this
  across sessions or co-authors, so treat "≈1 version per session" as a
  working estimate, not a measured rate. Note the residual: 500 is a **setting, not a
  law** — an administrator can lower it, and lowering prunes immediately. So
  this removes the *accidental* pruning risk, not the *administrative* one.
- **[CLOSED — POSITIVE 2026-08-20 (S448)] Second-stage recycle recovery.**
  **[VERIFIED via the IT-provided signed-in second-stage recycle bin
  screenshot.]** The site-collection (second-stage) recycle bin **exists and
  functions**, and Connor's 2026-08-10 "no second-stage recycle bin" is refuted
  as the access-visibility artifact this section predicted — his account (like
  Justin's on 2026-07-30) simply could not see it. The administrator view showed
  the bin containing **exactly the two 2026-07-30 controlled-audit probe files**
  (`_wmkf_library_control_probe_1785465804885.txt` / `_1785465842651.txt`,
  deleted by "SharePoint App", original location
  `sites/akoyaGO/akoya_request`). Those are the probes removed from the
  first-stage bin at the end of the 2026-07-30 audit — they cascaded to the
  second stage instead of being destroyed, so the full chain **delete →
  first-stage bin → purge from first stage → second-stage catch** is
  empirically proved on the actual target library, including for app-identity
  deletions. There IS an administrator safety net behind ordinary deletion.
  Residuals: the recovery window is [ASSUMED] the standard shared 93 days, so
  both probes should age out around late October 2026 — leave them (do not
  restore or purge); and second-stage **restore** was observed available, not
  exercised.
- **[UNKNOWN — reroute] Retention.** Connor replied "not familiar with purview,"
  which does not answer the question and tells us he is **not the right owner for
  it**. The controlled Request `1003109` item's Graph `retentionLabel` response
  contained no label fields, which still does not prove that no site- or
  library-wide Microsoft Purview retention policy applies. Needs a Microsoft 365
  compliance/Purview administrator, not the SharePoint site owner.
  **Accepted-open (owner, 2026-08-20):** no further administrator information is
  expected unless a pressing need arises; treat retention as unknown in any
  durability reasoning rather than re-asking.
- **[PARTIALLY RESOLVED 2026-08-20 (S448); Delete flags accepted-open]
  Least-privilege human editing.** **[VERIFIED via the IT-provided site
  permissions screenshot]** the akoyaGO Members group's assigned permission
  level is the built-in name **Edit** (Owners Full Control, Visitors Read; no
  custom level appears). Connor's "limited control" is thereby resolved as the
  modern pane's friendly caption, not a level. The operative question — **can an
  ordinary editor delete the file or its version history?** — is now
  **presumptively YES**: the *unmodified* built-in Edit level grants both Delete
  Items and Delete Versions. The only escape is an in-place-modified Edit level,
  which the screenshot cannot rule out; the authoritative close remains reading
  the level's checkboxes (Permission Levels → Edit → Delete Items / Delete
  Versions), and that read is **accepted-open (owner, 2026-08-20)** — no
  further IT information expected absent a pressing need. **Design as if
  ordinary editors can delete files and version history.**

  **The 2026-08-10 delete attempts did NOT settle this — do not cite them as
  evidence either way.** Two attempts against `Application Cover Page.docx`
  (`Request Folders - Akoya > Phase I`) both returned
  `File is checked out to another user` (error `0x80060728`), at 20:00:46 and
  20:06:54 Pacific. **The observed asymmetry is the finding: the same user could
  open and edit the file — the library shows it `Modified 8/10/2026 8:05 PM` by
  that user — but could not delete it.**

  Note that `File is checked out to another user` is a **misleading catch-all**.
  SharePoint emits it for any lock, including one held by the Office
  co-authoring service on the acting user's own behalf. It is **not** the
  permissions message; a rights failure surfaces as `Access denied`. So the
  message alone distinguishes nothing.

  **Historical hypothesis record (superseded 2026-08-20).** Two hypotheses were
  live with opposite consequences; the 2026-08-20 screenshot settles the weight
  between them: with the assigned level named **Edit** and "limited control"
  explained as a pane caption, H2's motivating anomaly is gone, and **H1
  (transient co-authoring self-lock; members CAN delete) is the working
  reading** of the `0x80060728` asymmetry — pending only the unread Delete
  flags above.

  - **H1 — transient self-lock.** The 20:06:54 attempt came **109 seconds after
    that same user's own 20:05 edit**, inside the window where SharePoint still
    holds the editing lock after a Word session closes. If this is the cause,
    **ordinary members CAN delete**, and the durability risk this document has
    been designing around is real.
  - **H2 — custom permission level without Delete.** Both standard levels that
    grant editing (Contribute, Edit) **also grant Delete Items**, so
    edit-yes/delete-no is not possible under a standard level. A custom
    "Contribute minus Delete" level would produce exactly this asymmetry — and
    would explain Connor's otherwise unexplained **"limited control"** as a real
    custom level rather than a paraphrase. If this is the cause, **members
    CANNOT delete**, member-caused loss drops sharply, and administrator restore
    is unblocked.

  **Discriminating check — non-destructive, run both halves:**
  1. Add the **"Checked Out To"** column to the library view. **Blank** → no
     check-out exists, favouring H1; then close Word entirely, wait ~15 minutes,
     and retry the delete — success confirms H1. **A name** → a real check-out,
     and the holder is named; if it is the akoyaGO app or a service account,
     that is a systemic finding in its own right (see the orphaned-check-out
     causes: explicit check-out never checked in, a died Word/upload session, or
     upload while a required column was empty).
  2. Read the Members group's permission **level definition** and look for
     **Delete Items** / **Delete Versions**. This settles H2 directly and is
     authoritative regardless of what the lock turns out to be.

  **Do not discriminate these by deleting a governed artifact.** Even with the
  second-stage bin now confirmed (above), a recycle cascade is a remedy, not a
  license — destroying an artifact to test whether artifacts survive
  destruction remains an unacceptable trade. Use a disposable file the tester
  created, in a non-governed location, that nobody has open; note even that
  only establishes delete-own, since some configurations permit that while
  restricting delete-others.

  **H2 being true would NOT reopen the milestone copy decision.** Delete rights
  are one of four reasons recorded there; copy also survives an administrator
  lowering the version limit, unreadable retention policy, and the
  then-unconfirmed second-stage bin (since confirmed present 2026-08-20).

  **Do not retry this by deleting.** Testing a durability question by
  destroying the artifact whose durability is in question stays off the table
  regardless of the now-confirmed second-stage bin. **Resolve it by reading the
  permission definition instead:** Site Settings → Site permissions →
  Permission Levels → open **Edit** (the level the 2026-08-20 screenshot shows
  assigned to Members) and read its **Delete Items** and **Delete Versions**
  checkboxes. That is non-destructive and answers *delete versions* as well as
  *delete file* (a file-delete test cannot). If an empirical check is still
  wanted, use a disposable file the tester created, in a non-governed location,
  that nobody has open — and note it only establishes delete-own, since some
  configurations permit that while restricting delete-others. The compounding
  risk recorded here previously (member delete + no second-stage bin) is
  retired: the second-stage bin exists, so first-stage recovery is not the only
  remedy. The app token still holds only `Sites.Selected` and
  `/sites/{siteId}/permissions` returns `403 accessDenied`, so the app cannot
  verify this itself.

  **The major-version limit is likewise not readable programmatically — stop
  trying.** [VERIFIED via live Graph probe 2026-08-10 (S413)] `GET
  /drives/{driveId}/list` returns `200` for this library but its `list` facet
  carries exactly three keys — `contentTypesEnabled`, `hidden`, `template` — and a
  case-insensitive `version*limit` search over the whole response body matched
  nothing. The call returned `200`, so this is a **permissions-independent**
  gap rather than another `Sites.Selected` denial: the app is authorized to read
  the list and the settings simply are not in the response. [ASSUMED, not probed]
  that no other Graph v1.0 or beta endpoint exposes them — only the `list`
  resource was tested, so a future need could re-check `beta` before concluding
  it is impossible. It must be read from the settings page by a human
  with library access:

  **Prefer the UI path; the one classic deep link tried here failed.**

  > `https://appriver3651007194.sharepoint.com/sites/akoyaGO/akoya_request`
  > → gear → Library settings → More library settings → Versioning settings

  The library **identity** below is [VERIFIED via the same live Graph probe]
  (`GET /drives/{driveId}/list` → `200`): list GUID
  `fd037f0b-8df4-41f5-8fed-c3984d351918`, webUrl
  `https://appriver3651007194.sharepoint.com/sites/akoyaGO/akoya_request`.
  A `_layouts/15/VersionSettings.aspx?List={guid}` deep link built from that
  GUID was **tried on 2026-08-10 and returned an unexpected error.** The
  identity is not in doubt — only that URL form is. **Rights are ruled out as
  the cause**: the same user reached this page through the UI minutes later and
  captured it, so the account held sufficient permission the whole time. The
  remaining candidates — Microsoft having relocated the versioning-settings page
  in recent tenants, or the classic page name simply being wrong here — were
  **[ASSUMED, not discriminated]**; the `listedit.aspx?List={guid}` probe that
  would separate them was never run, and there is now no reason to run it.
  Operative rule: send an administrator the UI path, never a reconstructed
  deep link. Read three values: major-vs-minor versioning
  mode, the major-version limit (unchecked = unlimited), and the draft limit.
  **That page sets the limit as well as showing it, and lowering the number
  prunes existing versions immediately** — it is a look-and-report, never a
  change-and-report.

  **Do not resolve this to "Limited Access" (considered and rejected 2026-08-10).**
  Limited Access is a system-assigned level granting only View Application Pages,
  Browse User Information, Use Remote Interfaces, Use Client Integration Features,
  and Open — **no edit, no delete.** If Members held it, ordinary staff could not
  edit the Word artifacts at all, contradicting the staff-wide Editor Dashboard
  audience (owner decision 39,
  `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`). The pilot contradicts it
  empirically too: Justin edited Request `1003109` and produced version `2.0` under
  his own identity, yet was denied the second-stage admin view — so he has at least
  Edit/Contribute and is not a site-collection administrator. "Limited Access" in a
  permissions view is commonly an artifact of unique item-level permissions
  elsewhere in the site, which would itself be a finding.

  **The 2026-08-10 question to Connor is closed (2026-08-20, S448):** the first
  half is answered — Members hold **Edit** — and the second half (is Justin an
  ordinary member or directly granted?) is **mooted by the Public-group finding
  below**: with the connected Microsoft 365 group Public, the effective
  ordinary-editor population is any internal user, so there is no narrower
  "ordinary editor path" the pilot could have missed.
- **[NEW FINDING 2026-08-20 (S448)] Org-wide effective Edit via Public
  Microsoft 365 group.** **[VERIFIED via the IT-provided site home
  screenshot]** the akoyaGO site's connected M365 group shows **"Public group"**
  with 4 explicit members. Public group privacy lets any internal user join
  without approval, and SharePoint grants "Everyone except external users"
  access to public group-connected sites — which explains that principal's
  earlier appearance in the Members group. Chained with Members = Edit and
  library inheritance, the practical posture is: **any internal user in the
  tenant can edit — and presumptively delete — the grant document libraries.**
  The "4 members" count is cosmetic. Consequences: the second-stage recycle
  bin and the Board milestone byte-copy are the load-bearing durability
  controls, not defense-in-depth extras. The cheapest structural mitigation,
  if ever wanted, is flipping group privacy Public → Private — an owner/IT
  decision, not an app change ([ASSUMED] the app's own `Sites.Selected` grant
  is per-site and independent of group privacy — verify app access after any
  flip, and add ambient-access staff as real members first). No change was
  requested on 2026-08-20; the intentional-vs-default question is posed to IT
  in `docs/SHAREPOINT_SITE_PUBLIC_ACCESS_MEMO_2026-08-20.md`.
- **[SOURCE-BUILT 2026-08-30; NOT PRODUCTION-CLAIMED] Workbench recovery
  UI.** Current version/last-modified metadata and read-only version history
  are Production-live. The superuser restore control resolves the canonical
  row from `akoya_request.wmkf_CurrentInitialAssessment`, uses client artifact
  and current-version IDs only as freshness fences, invokes native Graph
  restore, verifies the selected governed content after readback, and updates
  registry metadata under its Dataverse ETag. Graph's restore endpoint has no
  conditional-write header: a stable metadata reread narrows but cannot remove
  the final-call race; any concurrent edit is retained in version history and
  the selected version then becomes a new current version.
- **[SOURCE-BUILT 2026-08-30; NOT PRODUCTION-CLAIMED] Site Visit handoff
  built; Initial Assessment Board milestone freeze implemented.** The existing fields (`wmkf_milestoneversionid`,
  `wmkf_milestonecontenthash`, `wmkf_milestonecreatedat`) now have one
  source-verified writer: the Pre-Site→Site Visit transition records the exact
  working-document handoff version/hash/time before lifecycle becomes Review.
  This is a **pointer to a SharePoint version plus a drift hash, not a copy of
  the bytes**, and it does not satisfy the separate Board-retention contract.

  **DECIDED 2026-08-10 (S413): copy the bytes.** The owner chose copy; the three
  Site Visit handoff fields remain working-document provenance, while a Board
  freeze creates a separate retained snapshot Request Document row/item linked
  to the exact source row/version/hash. Nothing requires overwriting the handoff
  fields or migrating the working row. Note that
  copy is also what roadmap requirement 5 above already asked for ("retained
  DOCX and/or PDF snapshot"); the fields were provisioned ahead of the decision,
  not as the decision.

  The Initial Assessment implementation creates/reuses a deterministic,
  distinct Ready/Board Ready Request Document row and SharePoint item linked
  to the exact canonical source row/version/governed hash. It uses create-only
  path conflict behavior, uploads the exact selected source buffer, and verifies
  normalized governed Word content after SharePoint ingestion so legitimate
  package repacking does not appear as content drift. It never moves
  `wmkf_CurrentInitialAssessment` and excludes the exact snapshot
  producer from editable Ready cardinality, supersession, and cycle discovery.
  Failed/interrupted attempts retain a reclaimable row; only items uploaded by
  the attempt can be recorded for orphan cleanup. Unknown/lookalike producers
  remain ordinary fail-closed rows.

  **Record the reasoning honestly, because the legs kept changing after the
  choice was made.** Pointer-only durability rested on three things. The
  Versioning Settings capture **answered the first**: the version limit is 500
  majors with no age expiry, so accidental pruning is not a material risk, and
  that argument for copying is now weak. The 2026-08-20 screenshots then moved
  the other two in opposite directions: the **second-stage recycle bin is
  confirmed present** (weakening that leg too), while editor delete rights
  hardened the wrong way — **the whole tenant presumptively holds Edit with
  delete**, via the Public group (strengthening the copy case). The remaining
  leg no administrator answer can remove: a version *limit* is a setting an
  administrator can lower at any time, and lowering it prunes immediately. A
  retained copy depends on none of them. The copy decision stands.

  Anyone reopening this should know the strongest single argument is not
  probability but remedy: under a pointer, `wmkf_milestonecontenthash` can only
  detect that the milestone is gone; under a copy, it proves the retained bytes
  are intact. For a Board record, detection without recovery is a different
  product, not a cheaper one.

### Version-listing behaviour — probed live 2026-08-10 (S413)

Read-only probe against a real governed artifact (Request `1003109`'s Initial
Assessment item, 2 versions). Settles the premise the version-history read is
built on. **[VERIFIED via live Graph probe; n=1 item, 2 versions — see the
limitation below.]**

| Question | Result |
|---|---|
| Does `/versions` honour `$orderby`? | **No — but it returns HTTP 200.** `lastModifiedDateTime desc` and the ascending form returned the *identical* order. Accepted and silently ignored. |
| Default order | Newest-first in this observation (`2.0` then `1.0`). |
| Does `$top` page? | Yes — `$top=1` returned one row plus an `@odata.nextLink`. |

Consequences, and why the read is shaped the way it is:

- **A single ordered query is not available.** The bounded-scan design in
  `GraphService.listFileVersions` cannot be collapsed into one `$orderby` request;
  that option was tested and does not exist. Do not re-propose it.
- **A 200 is not evidence of support here.** Checking only the status code would
  have produced exactly the wrong conclusion. Any future claim that this endpoint
  honours a query option needs a behavioural check, not a status check.
- **Limitation:** one item with two versions says nothing about ordering under
  many versions, concurrent edits, or after a restore. Default order is therefore
  treated as observed-not-guaranteed, and the current-version identity is still
  resolved from the item's own `publication.versionId` rather than from position.

Platform references:
[Microsoft Graph file versions](https://learn.microsoft.com/en-us/graph/api/driveitem-list-versions?view=graph-rest-1.0),
[SharePoint version history](https://learn.microsoft.com/en-us/sharepoint/document-library-version-history-limits),
[SharePoint retention](https://learn.microsoft.com/en-us/purview/retention-policies-sharepoint).

---

## How the bridge works

A `sharepointdocumentlocation` row in Dataverse says "this request's documents
live at this SharePoint folder." Each `akoya_request` row gets one (or more)
of these rows pointing at:

```
SharePoint site:  appriver3651007194.sharepoint.com/sites/akoyaGO
  └─ Document library: akoya_request   (a SharePoint library, exposed as a Graph API "drive")
      └─ Folder: 1001289_EEC6F39CE7D4EF118EE96045BD082F70   ← the request's folder
          ├─ proposal.pdf                                    ← put there by GOapply at submission
          ├─ biosketch.pdf
          └─ budget.xlsx
```

`RequestArchive1`, `RequestArchive2`, and `RequestArchive3` are sibling
libraries holding migrated content from the previous grants management system.
Same folder-naming convention. Older grants often have their full file set in
one of those archives instead.

The folder name pattern is always `{requestNumber}_{requestGuidNoHyphensUpper}`.

---

## Where legacy review uploads land (retained hidden flow)

The retained file-upload service uses the same library and request folder, with a
subfolder per reviewer:

```
akoya_request/
  └─ 1001289_EEC6F39CE7D4EF118EE96045BD082F70/         ← request's folder (already exists)
      ├─ proposal.pdf                                     ← from GOapply
      ├─ biosketch.pdf
      └─ Reviews/                                         ← new subfolder, created on first upload
          ├─ abc-123-def/                                 ← per-suggestion folder (uses suggestion GUID)
          │   ├─ review.pdf
          │   └─ supplementary_notes.pdf
          └─ xyz-456-ghi/                                 ← second reviewer's folder
              └─ review.docx
```

The corresponding `wmkf_appreviewersuggestion` row for `abc-123-def` gets
`wmkf_reviewsharepointfolder = "1001289_EEC6F39CE7D4EF118EE96045BD082F70/Reviews/abc-123-def"`.

That string plus the library name (`akoya_request`) is everything the backend
needs to find the files via Graph API.

---

## Why this approach (and not the alternatives)

| Option | What it would mean | Why not |
|---|---|---|
| **(a) Files inside Dataverse** (File columns or Annotations) | Bytes stored in Dataverse blob storage | Breaks the pattern AkoyaGO uses everywhere else; staff couldn't see files via the normal Dynamics document tab; Dataverse File columns have size/search limitations vs. SharePoint |
| **(b) Files in SharePoint, pointer in Dataverse** | What proposals already do | This is what we're doing — consistent with everything else |
| **(c) Files in Vercel Blob** | Current state for reviews under the legacy upload flow | Orphaned from the canonical document graph — staff can't find them in Dynamics, no SharePoint search, no versioning |

(b) is the standard Dynamics CE + SharePoint pattern, what GOapply uses, and
what the retained reviewer-file path relies on. The current structured form path
does not create a review PDF; it persists answer snapshots in Dataverse.

---

## What this means in practice

For the **current form-based review**, final submit writes
`wmkf_appreviewanswer` child rows plus the engagement's affiliation,
`wmkf_reviewreceivedat`, and lifecycle status in one Dataverse changeset, then
removes the Postgres draft. No review file is required or authoritative.

For a **legacy/retained file upload**, the data lands in two places:

- **Dataverse** — the existing `wmkf_appreviewersuggestion` row is updated
  with token timestamps, `wmkf_reviewreceivedat`, the new
  `wmkf_reviewsharepointfolder` (path string), `wmkf_reviewfilename` (primary
  filename, kept for back-compat with existing UI), and the
  `wmkf_reviewuploadedbystaff` boolean flag.
- **SharePoint** — 1–5 actual file blobs at the folder path above.
- **Vercel Blob** — not used for new review uploads. (The legacy `wmkf_reviewbloburl`
  fallback path was retired 2026-05-03; zero real reviews still pointed at
  Blob storage at retirement.)

Of the seven new Dataverse fields planned for this work, only **one** is
file-related (`wmkf_reviewsharepointfolder`, a string holding a path). The
bytes never enter Dataverse. The other six are pure metadata: token state,
timestamps, revocation flag, staff-vs-self upload provenance.

---

## Permissions in place

- **Microsoft Graph: `Sites.Selected`** application permission on the
  `WMK: Research Review App Suite` app registration.
- **Per-site grant on the akoyaGO SharePoint site:** read role and write role,
  granted via `POST /sites/{site-id}/permissions` with `roles: ["read"]` and
  `roles: ["write"]` respectively.
- **Verified end-to-end** via `scripts/probe-sharepoint-write.js` — PUT a
  small text file to the akoya_request library, DELETE it, both succeed with
  204/200.

The reviewer never touches SharePoint directly — all reads and writes flow
through our backend, which authenticates as the app registration. The akoyaGO
site itself never needs anonymous-public permissions.
