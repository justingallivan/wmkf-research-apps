---
title: Dataverse / SharePoint File Storage Model
domain: dataverse
kind: source-of-truth
status: active
summary: "File storage and linking in AkoyaGO/Dynamics, including governed staff writeups and Site Visit artifacts."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-08-13
owner: product-engineering
related:
  - scripts/probe-sharepoint-write.js
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
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
> closed, but the administrator-evidence half of it substantially is. Version
> inspection/restore and first-stage recycle recovery passed by probe; library
> version limits, second-stage administrative recovery, and ordinary-editor
> permissions were **answered 2026-08-10 and 2026-08-13** — see the
> controlled-audit section below, and note the editor answer is that ordinary
> editors **can** delete files and version history. Still open, in priority
> order: **whether the `Request` library inherits site permissions** (bounds how
> many people that reaches), Workbench history/restore, milestone snapshots
> (**scope reduced** — Diligent already holds the Board record; see the milestone
> entry), and **Purview retention** (low priority — no regulatory obligation
> applies, so this is only a safety net nobody is counting on).
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

The default proposal source for Initial Assessment and Workbench Field Primer
request mode is the one exact active request file:

`Reviewer Materials/Proposal_{Request#}.pdf`

The file must be under the request's Dynamics-associated `akoya_request`
SharePoint folder. An archive-only match, multiple active exact matches, a raw
application export, or `Phase I/ProjectDescription.pdf` does not satisfy the
contract; default automation fails before the model and before result
persistence. Reviewer Finder's authenticated explicit `fileKey` remains a
deliberate historical/ad-hoc staff override. Separately, Reviewer Finder's
current-cycle default loader prefers the canonical file and falls back only to
exactly one active `Phase I/ProjectDescription.pdf`; neither or ambiguity
returns the server-listed picker before download/Blob write. This bounded
staff-discovery compatibility rule does not change the governed writeup input
or external reviewer visibility. The Workbench Proposal tab separately
continues to display the D26 Phase I document slots.

**[VERIFIED 2026-07-30 via live read-only Graph/Dataverse probe]** Request
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
  recording, transcript, and transcript summary. Staff observations are
  structured notes rather than a file artifact;
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

The three writeup stages are three separate Word documents. The Final Writeup
is created from the latest version of the Pre Site Visit Writeup available when
staff invokes the action. The registry must retain the source artifact identity
and exact source version/hash used for that operation; subsequent edits do not
keep the two documents synchronized. Staff may rarely invoke a deliberate
regenerate-from-latest action, but it must preserve the prior Final version and
must never silently overwrite staff edits.

The Pre-Site stable proposal core may exist before every review is received.
It is drafted from the full proposal through an iterated governed
`phase-ii.summarize` prompt, with authoritative request metadata supplied from
Dataverse. Its review-derived portion uses `review-synthesis.generate` over all
currently submitted reviews; staff do not select a subset. The two layers have
independent prompt/run provenance and refresh behavior.

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

Staff collaborators use the canonical SharePoint Word file. External Board
members or consultants who join a visit receive a PDF attachment representing
an exact frozen Pre-Site version. An anonymous or guest SharePoint document
link is not required for this minimum contract.

There is no separate Site Visit Writeup. Creating the Final copies the selected
Pre-Site version and then lets the PD incorporate site observations, late
reviews, transcript evidence, and editorial changes into the independent Final
artifact. The copied review roster and anonymous narrative retain the selected
Pre-Site evidence snapshot. Any deliberate late-review refresh in the Final
updates roster, coverage/as-of metadata, and anonymous synthesis together while
preserving the prior Final version.

### Site Visit dossier and transcript-derived artifacts

The planned Site Visit tab is a dossier, not primarily an editor for one notes
memo. It joins:

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
- staff observations.

Do not add a separate Scheduled/Completed/Cancelled/Rescheduled status unless a
consuming workflow is later identified. Applicant slides, other applicant
materials, recording, transcript, and transcript summary are file-backed
artifacts. Staff observations are one paste-friendly lead-PD notes area rather
than separate timestamped entries; normal Dataverse audit and modified
metadata may still apply behind the scenes.

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
   summaries, or staff observations; browse Dataverse or SharePoint; choose
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
5. freeze every official Board milestone with request/artifact identity,
   SharePoint item and version ID, timestamp, actor, content hash, and retained
   DOCX and/or PDF snapshot.

Working prose remains editable and recoverable. An official milestone remains
identifiable even after later edits to the working document. The current app
can download, search, upload, and delete SharePoint files, but it does not yet
implement Graph version-history, restore, retention, or milestone-snapshot
operations.

**Status of requirement 3 as of 2026-08-13: the live configuration does not meet
it.** Ordinary editors hold `Edit`, which grants Delete Items, Delete Versions,
and Manage Lists — precisely the "unnecessary delete … or version-deletion
authority" the requirement asks to exclude. This is now a known gap with a named
cause, not an unaudited unknown; the evidence and its bounds are in the
controlled-audit section below. Requirement 1 is met. Requirement 2's
recycle-bin half is audited across both stages; its Purview half is unanswered
but **carries no regulatory obligation** (owner, 2026-08-13) and is not a gate.
**Requirement 5 is substantially met outside this system** — Diligent timestamps
Board-bound documents and generates exportable Board Books, so the
what-did-the-Board-see problem is already solved; see the milestone entry below
for what that leaves.

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

> **First administrator response, 2026-08-10 (S413), from Connor, verbatim:**
> "Major versioning is on" / "No second-stage recycle bin" / "Not familiar with
> purview" / "Site members have 'limited control'".
>
> **Second round, 2026-08-13 (S425) — supersedes the first on every point it
> touches.** A structured six-question audit went to Connor, who escalated the
> parts his own rights could not reach to Dragonfly IT. Two of the 2026-08-10
> replies turned out to be wrong, and the caveats recorded here are what kept
> them from hardening into platform fact:
>
> - **"No second-stage recycle bin" was FALSE.** One exists. The instruction
>   below not to record its absence until a site-collection administrator
>   confirmed it is the reason this never became a durability claim.
> - **"Limited control" was a pane caption, not a permission level.** The
>   Members group holds **Edit**.
>
> **Read the evidence classes separately; they are not interchangeable.**
> *Administrator attestation* = Dragonfly IT's written reply (primary text read
> 2026-08-13). *Operator observation* = Connor's own signed-in UI, first-hand but
> UI-affordance rather than a permission-flag read. *Platform documentation* =
> Microsoft Learn, used only to interpret the other two and never as evidence
> about this tenant.

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
  working estimate, not a measured rate.

  **Re-verified independently 2026-08-13 (S425)** by Connor, from the settings
  page, on `Request` **and** `RequestArchive1`: identical on both. A different
  operator by a different route reproduced the S413 capture.
  **[ASSUMED for `RequestArchive2` and `RequestArchive3`]** — Connor reported
  item counts for all four libraries but version policy for only two, so this is
  n=2 of 4, not a library-wide finding.

  **500 is the platform default, not a decision.** [Microsoft Learn](https://learn.microsoft.com/en-us/sharepoint/set-default-org-version-limits)
  gives the organization default as manual limits, 500 major versions, no
  expiration. So this configuration reads as untouched rather than as a
  deliberate retention posture — nobody chose 500 for these documents.

  **Residual, and it is worse than previously recorded.** 500 is a **setting,
  not a law**, and the earlier text said only that *an administrator* could
  lower it. That understated the exposure by a tier: `Edit` includes **Manage
  Lists** (see the least-privilege entry below), which is the permission gating
  list-settings pages. Lowering the limit is therefore within reach of every
  principal holding Edit, and lowering prunes immediately. This removes the
  *accidental* pruning risk; it does not remove the *administrative* one, and
  the population who can trigger it is far larger than "administrators".
- **[ANSWERED 2026-08-13 (S425) — POSITIVE; reverses the 2026-08-10 answer]
  Second-stage recycle recovery.** A second-stage bin **exists**.
  **[VERIFIED via administrator attestation, primary text read]** Dragonfly IT,
  verbatim: *"Yes, the dftadmin account can access the secondary recycle bin."*

  Establishes: the bin exists, and `dftadmin` can reach it. Access to a
  site-collection recycle bin requires site-collection administrator rights
  ([Microsoft Support](https://support.microsoft.com/en-us/office/restore-deleted-items-from-the-site-collection-recycle-bin-5fa924ee-16d7-487b-9a0a-021b9062d14b)),
  so `dftadmin` holding SCA follows — **[ASSUMED by entailment]**, since IT was
  asked directly whether the Dragonfly account is an SCA and did not answer in
  those words.

  Does **not** establish: its **contents**. Nobody has reported what is in it, so
  we still cannot say whether anything has already been lost. It also gives staff
  no self-service path — only `dftadmin` can restore.

  **The recovery window is 93 days total, and it is not guaranteed.**
  **[VERIFIED via Microsoft Support, fetched 2026-08-13]** The 93 days run from
  the **original** deletion; the second stage holds the *remainder* of that
  window, not a fresh one. Two ways it ends sooner, both material:

  - the site-collection bin purges **oldest-first** once it exceeds its quota; and
  - a site-collection administrator can empty it at any time.

  **Do not record Microsoft's 14-day backup as a remedy here.** It exists, but it
  restores **entire site collections, not individual items**, so it is not a
  per-document safety net and would be misleading in a durability table.

  Net: there is a real recovery path behind ordinary deletion, which the
  2026-08-10 answer wrongly denied. It is a **time-boxed, administrator-only,
  interruptible** path — not an archive.
- **[UNKNOWN — LOW PRIORITY, and not a gate on anything] Retention.**
  **Reframed 2026-08-13 (S425) on owner correction.** Earlier revisions treated
  this as an open *compliance* question. It is not one: **these documents carry no
  regulatory retention obligation** — the Foundation is not a regulated filer, and
  nothing here is subject to a statutory retention schedule (owner, 2026-08-13).
  Do not reintroduce compliance framing.

  What a Purview policy would actually be here is a **protective mechanism nobody
  has assumed exists** — retention policies block deletion and route copies to a
  Preservation Hold Library. So the cost of not knowing is only that we cannot
  count on a safety net we never counted on. Nothing in the durability picture
  depends on the answer.

  Evidence such as it is: Connor's "not familiar with purview" (2026-08-10);
  Dragonfly IT not asked in the 2026-08-13 round, so their silence is unremarkable
  rather than a non-answer; and the controlled Request `1003109` item's Graph
  `retentionLabel` response contained no label fields, which does not prove no
  site- or library-wide policy applies. No Preservation Hold Library observation
  was reported either way, and its *absence* would not settle it — a retain-only
  policy with nothing yet deleted or edited leaves no such library behind.

  **The unfamiliarity is itself weak evidence toward "no policy."** Purview
  policies are configured by someone; if the shop that administers the tenant does
  not know the tool, the prior on one silently being in force is low.

  If it is ever wanted, it needs a Microsoft 365 compliance/Purview administrator
  — not the SharePoint site owner and not Dragonfly IT. **Do not spend another
  round-trip on it ahead of the library-inheritance question.**
- **[ANSWERED 2026-08-13 (S425)] Least-privilege human editing — ordinary
  editors CAN delete files and version history.** The Members group holds
  **Edit**. "Limited control" was a pane caption, not a permission level, and is
  retired as a description of anything.

  **Two independent lines of evidence, agreeing on all four flags:**

  | Flag | Attested (Dragonfly IT) | Observed (Connor's UI) | Microsoft Learn, unmodified `Edit` |
  |---|---|---|---|
  | Delete Items | implied by level | Delete present and enabled on documents | granted |
  | Delete Versions | implied by level | Delete offered on Version-history entries | granted |
  | Manage Permissions | implied by level | no permissions entry point renders | **not** granted |
  | Manage Lists | implied by level | Versioning settings and "Site libraries and lists" reachable | granted |

  IT's reply, verbatim: *"The akoyaGO Members group had Edit permission level."*
  The list-permission table in
  [Microsoft Learn](https://learn.microsoft.com/en-us/sharepoint/understanding-permission-levels)
  supplies the right-hand column.

  **Why the two legs are a genuine cross-check and not one claim twice.** Learn
  is explicit that every default level *except* Full Control and Limited Access
  can be edited in place, so a level *named* Edit could have had a flag removed —
  the name alone proves nothing. Connor's capability observation is independent
  of the name, and Manage Lists is the discriminator that rules out Contribute
  and Read. Agreement across four flags from two directions is what carries this.

  **Residual — this is not a permission-flag read.** IT was asked explicitly for
  the discrete permissions (*"We're after the discrete permissions, not just the
  level name"*) and answered with the level name only. Connor could not reach the
  permissions pages at all. So the flags come from Learn's definition plus UI
  affordance, and a rendered-and-enabled command is client-side — SharePoint does
  sometimes offer a command the server then refuses, which is exactly what
  happened on 2026-08-10. **[VERIFIED via two proxies; the role-definition
  checkbox read remains unperformed.]**

  **Live thread:** IT wrote the group *"had"* Edit. Most likely tense-of-
  observation, but they did not confirm nothing changed during the check, and
  Connor has asked. Do not treat the past tense as settled either way.

  **This resolves the H1/H2 pair recorded here through S424, in favour of H1.**
  The 2026-08-10 delete failures against `Application Cover Page.docx`
  (`0x80060728`, at 20:00:46 and 20:06:54 Pacific, the second 109 seconds after
  that same user's own 20:05 edit) were the **transient self-lock**, not a custom
  "Contribute minus Delete" level — H2 is refuted, because the level is a
  standard Edit and Edit grants Delete Items. Keep the reasoning that got here:
  `File is checked out to another user` is a **lock catch-all**, not the
  permissions message (a rights failure surfaces as `Access denied`), so the
  error text never distinguished the hypotheses. One alternative survives
  elimination and should not be dropped — **item-level unique permissions** on
  that specific file, which would produce the same asymmetry; see the
  Limited-Access note below.

  **Do not re-test this by deleting a governed artifact.** The original reason
  was the missing second-stage bin, which no longer holds — but the rule stands
  on its own: recovery is now known to be a 93-day, `dftadmin`-only path, and
  destroying a governed document to confirm it can be destroyed buys nothing that
  the permission model already tells us. The question is answered; there is
  nothing left to test.

  **Neither the app nor a delegated sign-in can verify this independently — stop
  trying both routes.** The app token holds only `Sites.Selected`, and
  `/sites/{siteId}/permissions` returns `403 accessDenied` (reading permission
  grants needs `Sites.FullControl.All`). **New 2026-08-13:** the *delegated*
  route is closed too. `PnP.PowerShell` interactive sign-in was refused at the
  tenant consent screen for both `AllSites.FullControl` and `AllSites.Read`, and
  a delegated token is capped at the signed-in user's own rights regardless — so
  even with consent, an ordinary member could not have read the Members role
  definition. Moving to Windows / SPO Management Shell does not help; it passes
  the same consent gate. This is why the question had to go to IT.

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

  **"Limited Access" was considered and rejected 2026-08-10; the 2026-08-13
  answer (`Edit`) confirms that rejection was right.** Retained for one reason:
  Limited Access is a system-assigned level granting only View Application Pages,
  Browse User Information, Use Remote Interfaces, Use Client Integration
  Features, and Open — **no edit, no delete** — and when it *does* appear in a
  permissions view it is commonly an artifact of **unique item-level permissions
  elsewhere in the site**. That mechanism is the one surviving alternative to the
  H1 self-lock explanation above, so keep it in mind if the 2026-08-10 asymmetry
  ever recurs on a specific file.

  **Both halves of the S413 outstanding question are now answered** (asked
  2026-08-10, answered 2026-08-13). The level is **Edit**, per the entry above.
  And Justin is **not** in the Members group individually — his access arrives
  through `Everyone except external users`. That closes the worry attached to the
  second half: **the pilot did exercise the ordinary-editor path**, so its
  evidence stands as ordinary-editor evidence rather than as a possibly-elevated
  account's.
- **[ANSWERED 2026-08-13 (S425)] Who is in the Members group.**
  **[VERIFIED via administrator attestation, primary text read]** Dragonfly IT,
  verbatim: *"'Members' included akoyaGO Members and Everyone except external
  users."* Two principals: the `akoyaGO Members` Microsoft 365 group, and
  **`Everyone except external users` (EEEU)**.

  **Consequence — the Edit grant reaches far past the platform's 16 staff.** EEEU
  contains every person in the Microsoft 365 directory who is not an explicit
  external user, so at **site scope** every licensed internal account holds Edit,
  with Delete Items and Delete Versions. Whether that reaches the `Request`
  library depends on the open inheritance question below, which bounds this.

  **EEEU's presence is most likely the platform default, not a decision anyone
  made.** [Microsoft Learn](https://learn.microsoft.com/en-us/sharepoint/understanding-permission-levels)
  states EEEU *"is added to the Members group automatically on Modern Team sites
  with **Public** privacy settings"*, and that on **Private** team sites EEEU
  cannot be granted permissions at all. **[ASSUMED, strong]** So the useful
  question is not "who granted EEEU Edit" but **"was this site deliberately
  created with Public privacy"** — that is the thing to ask, and it is a
  one-field answer.
- **[OPEN — bounds the two entries above] Does the `Request` library inherit site
  permissions?** Not answered. Dragonfly IT was not asked (the question sent to
  them covered permissions and the recycle bin only), and Connor cannot see the
  library permissions page.

  **Why this is the load-bearing gap.** Connor's delete observation was made as a
  member of the `akoyaGO Members` M365 group; EEEU is a *separate* principal in
  the same SharePoint Members group. His observation proves *someone* can delete
  in that library — it does not establish the population.

  **`true` is not by itself good news, and the odds are worse than they look.**
  Group membership is a property of the site collection, not of a library, so
  there is no configuration in which EEEU sits inside the Members group at site
  scope but outside it at library scope. Unique role assignments assign
  *permission levels to principals*, and the principal here is the SharePoint
  group that carries both. Four outcomes:

  | Outcome | Effect |
  |---|---|
  | `HasUniqueRoleAssignments = false` | Inherits; Members → Edit applies. **Organization-wide** |
  | `true`, Members group among the library's assignments | Group carries both principals. **Organization-wide** |
  | `true`, library grants the M365 group directly, no Members group | Exposure shrinks to the M365 group. The good case |
  | `true`, some other arrangement | Must be read |

  Only the third outcome narrows anything, and it takes deliberate
  restructuring — **SharePoint's default on breaking inheritance is to copy the
  parent's assignments**, which produces outcome 2. So among the `true` branches,
  the unhelpful one is the default path. When the answer arrives, the operative
  detail is whether the **Members SharePoint group** appears in the library's
  assignments or only the **`akoyaGO Members` M365 group**; the two look nearly
  identical in the UI and mean opposite things here.

  **Related trap: Dynamics record security does not gate these files.** The
  Dynamics document tab is a view onto SharePoint, not a boundary in front of it.
  [Microsoft's guidance](https://learn.microsoft.com/en-us/power-platform/admin/permissions-required-document-management-tasks)
  is that users need permissions on the SharePoint site collection itself, and
  there is no out-of-the-box synchronization between Dynamics security roles and
  SharePoint permissions. Do not let "they can't see the request record" stand in
  for "they can't reach the document."

  Accurate statement until answered: **EEEU holds Edit at site scope; whether
  that reaches the `Request` library is unconfirmed.** Do not restate the
  tenant-wide reading without this qualifier.
- **[PARTIAL] Workbench recovery UI.** Current version and last-modified
  metadata are live. Version-history navigation and an administrator-only
  restore action are not implemented.
- **[PLANNED] Board milestone freeze.** No immutable milestone snapshot
  operation exists yet. The provisioned fields (`wmkf_milestoneversionid`,
  `wmkf_milestonecontenthash`, `wmkf_milestonecreatedat` —
  `lib/dataverse/adapters/request-document.js:38-40`, read at
  `lib/services/initial-assessment/artifact-service.js:257-259`, written
  nowhere) describe a **pointer to a SharePoint version plus a drift hash, not a
  copy of the bytes.**

  **CONTEXT THAT ARRIVED AFTER THE DECISION — read this first (owner, 2026-08-13
  / S425).** Board-bound documents are captured in **Diligent**, which timestamps
  them and generates Board Books exportable to PDF. **Diligent, not SharePoint, is
  the system of record for what the Board received and when.** It is outside
  SharePoint's failure modes entirely: an `Edit` holder deleting a Word file in
  the Request library cannot touch it, and if the SharePoint document is lost the
  Board version survives as a PDF from which the content can be recovered.

  This narrows what a milestone snapshot would be *for*. The institutional
  question — prove what the Board saw on a given date, years later — is already
  answered elsewhere. What Diligent does **not** cover:

  - a working document lost **mid-cycle**, before it ever reaches the Board;
  - **version history and editorial provenance** — a Board Book PDF is a
    flattened final state carrying no tracked changes, comments, or edit
    sequence, and `Delete Versions` can strip those from a file that otherwise
    stays in place.

  So the residual risk is **work loss and provenance**, not institutional record.
  A 93-day recycle bin is a reasonable answer to "someone deleted a draft" and a
  poor one to "prove what the Board saw" — and only the first case is still ours.

  **DECIDED 2026-08-10 (S413): copy the bytes.** The owner chose copy; the three
  provisioned fields are kept as identity/provenance **beside** a retained
  snapshot rather than instead of one. Nothing is sunk in the pointer design —
  those fields are written nowhere — so the switch costs no migration. Note that
  copy is also what roadmap requirement 5 above already asked for ("retained
  DOCX and/or PDF snapshot"); the fields were provisioned ahead of the decision,
  not as the decision.

  **Record the reasoning honestly — it has now moved twice, in both directions.**
  The decision is unchanged; the argument behind it is not what it was, and a
  reader must not be left subtracting superseded legs. Current state of each:

  | Leg | Status after 2026-08-13 |
  |---|---|
  | Accidental version pruning | **Weak as an argument for copying.** 500 majors, no age expiry, and the pilot's ≈1-version-per-session rate put pruning far outside a document's life |
  | "No confirmed second-stage recycle bin" | **Refuted — one exists.** This leg is gone as stated. What replaces it is weaker but real: recovery is 93 days from original deletion, `dftadmin`-only, and interruptible by quota purge or a manual empty. A time-boxed administrator path is not an archive |
  | "Unresolved whether ordinary editors can delete" | **Resolved — they can**, files *and* version history. This leg is now the strongest one. `Delete Versions` in particular means the 500-version policy defends nothing against a history purge |
  | A limit is a setting, not a law | **Stands, and widened.** `Edit` includes `Manage Lists`, so lowering the limit is within reach of every Edit holder — not just administrators — and lowering prunes immediately |

  Net: one leg was refuted and one was confirmed, and the confirmed one is the
  more load-bearing of the two. For a multi-year Board record, a 93-day
  administrator-only bin does not substitute for retained bytes. **Do not reopen
  the decision on the strength of the second-stage bin existing** — that fact
  alone was never the case for copying.

  Anyone reopening this should know the strongest single argument was not
  probability but remedy: under a pointer, `wmkf_milestonecontenthash` can only
  detect that the milestone is gone; under a copy, it proves the retained bytes
  are intact. **That argument was written on the premise that nothing outside
  SharePoint held the Board record — and Diligent does.** The remedy exists; it
  simply is not ours.

  **[OWNER DECISION PENDING — flagged 2026-08-13 / S425, decision NOT changed.]**
  The copy-vs-pointer choice stands as decided. But its justification is now
  materially smaller than when it was made: the institutional-record case is
  covered by Diligent, and what remains is mid-cycle work loss and version
  provenance — real, but a different and lesser problem. Whether that reduced
  justification still warrants building snapshot machinery at all is the owner's
  call, not a reconciliation this document should make for them. Do not treat
  this note as a reversal, and do not act on it as one; raise it before the
  milestone work is scheduled.

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

**Naming.** `akoya_request` is the library's **internal** name — what Graph, the
Dynamics `sharepointdocumentlocation` rows, and our code use, so it is correct
everywhere in this document and in source. Its **display** name in the SharePoint
UI is **`Request`**. Use the display name when writing instructions for a human
administrator, and the internal name everywhere else.

**Scale, reported by Connor 2026-08-13 (S425)** — folder counts, operator-
observed, not independently probed:

| Library | Folders |
|---|---|
| `Request` (`akoya_request`) | 4,886 |
| `RequestArchive1` | 4,860 |
| `RequestArchive2` | 4,984 |
| `RequestArchive3` | 4,749 |
| **Total** | **19,479** |

Each sits just under 5,000. **[ASSUMED]** that this is why the archives exist —
it is a plausible reading of the pattern, but SharePoint's 5,000 is a **list-view
query threshold, not a storage cap**
([Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/sharepoint/lists-and-libraries/items-exceeds-list-view-threshold);
a library holds up to 30 million items, and indexed-column filtering mitigates).
So the threshold is consistent with a deliberate split but does not require one.

**Forecast worth tracking:** `Request` is 114 folders below the threshold and
grows with every new request. **[NOT TRACED]** whether this affects our own
enumeration — `getRequestSharePointBuckets` resolves by folder path rather than
listing a library, so it may well be unaffected, but nobody has read the code
against this question. Check before assuming either way.

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
