---
title: Dataverse / SharePoint File Storage Model
domain: dataverse
kind: source-of-truth
status: active
summary: "File storage and linking in AkoyaGO/Dynamics, including governed staff writeups and Site Visit artifacts."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-07-28
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

> **Owner-decided direction (2026-07-28); implementation still planned.**
> This section governs the Initial Assessment, Pre Site Visit Writeup, and
> Final Writeup design as well as the Site Visit dossier and its materials. It
> does not claim that the target Dataverse schema, SharePoint library policy,
> prompts, upload surface, or Workbench surfaces have been provisioned.
> **[VERIFIED via owner decisions 2026-07-28; implementation PLANNED.]**

### Authority boundary

- **SharePoint Word document:** authoritative editable narrative. Native Word
  co-authoring, comments, tracked changes, AutoSave, and SharePoint version
  history operate on this copy.
- **Dataverse:** authoritative document identity, request/cycle relationship,
  artifact type, lifecycle state, structured decisions, access/workflow
  metadata, and durable SharePoint identity/version references.
- **Workbench:** creates or finds the registered artifact, displays its state
  and preview, opens it in Word, and exposes authorized recovery/milestone
  actions.
- **Editor Dashboard (planned):** queries the same typed registry across a
  cycle so approved collaborators can review progress and open the canonical
  Word files without visiting every request separately.

Do not mirror the Word body into an independently editable Dataverse memo. That
would create two competing sources of truth and an unsafe Word→Dataverse merge
problem after co-editing. If later search or AI requirements need extracted
text, store it only as a derived, version-keyed representation that can be
rebuilt from the SharePoint original.

### Registry contract

The exact Dataverse table/columns remain a design decision. The approved shape
is a typed document registry rather than one ad hoc URL field per writeup. At a
minimum, the persistence design must account for:

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

The Site Visit date, not review completeness, controls distribution. A
zero-review document is valid and states that no reviews were received as of
its evidence timestamp. Otherwise the review-derived portion carries submitted
review count/coverage and an as-of stamp. A later review makes that portion
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
the Keck “To …” title, institution, Summary, and a Rationale with Significance
& Impact, Research Plan, Team Expertise, and Foundation Opportunity. The AI
drafts the first three rationale sections and the Summary. Foundation
Opportunity is an explicit staff-authored slot and must remain visibly
outstanding until staff fills it; model-generated filler is not authoritative.

Institution and Keck title are structured inputs, not prose to infer. Resolve
institution from `akoya_request.wmkf_organizationname`, falling back to the
formatted applicant lookup. Resolve the Keck title from
`akoya_request.wmkf_wmkfprojectdescription`, not `akoya_title`. A read-only
production probe matched the four example documents to their exact stored
Keck titles; those four rows used the applicant-lookup fallback for institution.
The existing title cron does not guarantee pre-advancement availability because
it fills empty Keck titles only after a Research request becomes Phase I
Invited. The Initial Assessment producer therefore still needs an approved
missing-title rule before its prompt/template contract is complete.

Staff collaborators use the canonical SharePoint Word file. External Board
members or consultants who join a visit receive a PDF attachment representing
an exact frozen Pre-Site version. An anonymous or guest SharePoint document
link is not required for this minimum contract.

There is no separate Site Visit Writeup. Creating the Final copies the selected
Pre-Site version and then lets the PD incorporate site observations, late
reviews, transcript evidence, and editorial changes into the independent Final
artifact.

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
The first draft-functional delivery gate is 2026-08-10, before proposal intake
begins around 2026-08-18. A human-in-the-loop Initial Assessment pilot must
create and register a real canonical Word artifact, let authorized staff open
and edit it, and let staff find and open that same registered artifact from
both the Workbench and this dashboard. One safe failure/retry path must prove
that the SharePoint bytes and Dataverse registry reconcile before success.
Named testers, pilot environment, and schedule remain open. App list visibility
and SharePoint edit permission are separate authorization boundaries; passing
one must not imply the other.

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
