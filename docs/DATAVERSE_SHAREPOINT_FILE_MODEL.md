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
is created once from a staff-selected version of the Pre Site Visit Writeup.
The registry must retain the source artifact identity and exact source
version/hash used for that operation; subsequent edits do not keep the two
documents synchronized.

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
   readiness are not gates. Exact staff-role eligibility and visible
   sender/reply-to remain product decisions. The server sets token expiration
   to exactly 60 days after a successful invitation send; staff do not enter or
   edit the expiry, and moving the Site Visit date has no effect. The token
   supports revocation and cannot be supplied as an arbitrary destination
   selector.
2. Recipient choices are the request's Dataverse-linked liaison and PI. The
   normal default is the liaison in **To**; staff may instead address the PI
   and optionally copy the liaison. The server resolves the selected contacts
   and current email addresses from Dataverse at send time; the minimum product
   has no free-form recipient requirement. Missing/duplicate contact handling
   remains open. The message contains one shared request-scoped bearer link;
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
   SharePoint destination from the validated token.
5. Applicant uploads are limited to **PDF** and **PPTX**. Before persistence,
   the server enforces rate, size, file-count, extension, MIME/magic-byte, and
   malware checks and normalizes the stored filename/path.
6. Successful bytes end in the governed SharePoint location and a typed
   Dataverse registry row records stable identity and provenance. A temporary
   Blob location, if later chosen for scanning, is transit rather than the
   durable source of truth.
7. The implementation must define idempotency and compensate safely when the
   SharePoint write succeeds but registry creation fails, or vice versa.
   Staff must see a retryable, auditable state rather than an unregistered
   orphan or false success.
8. Additional uploads are allowed while access remains active. The external
   surface lists the shared applicant files authorized by the request-scoped
   link and supports explicit delete and replace actions for both To and CC
   recipients.
9. A replacement first uploads and registers the new file successfully; only
   then may the prior file be retired or recycled. A failed replacement leaves
   the prior file intact. Delete and replacement accept only a server-resolved
   opaque artifact identity scoped to the request/token, never a client-supplied
   SharePoint path, and preserve an audit/recovery trail.
10. Successful applicant-material changes notify the lead PD and other
   designated staff. The additional staff audience, batching, and message
   timing remain open.

Exact authorized staff roles, sender/reply-to, missing/duplicate contact
handling, resend/reissue and revocation behavior, shared-link audit disclosure,
schema, folder, size/count limits, notification audience/timing, retention,
and delete/replace persistence and recovery behavior remain open design
decisions.

### Cycle-wide Editor Dashboard contract

Allison is the confirmed primary user for a cycle-wide editing surface; other
writeup collaborators may be included once the audience is approved. The
dashboard must replace the useful affordance of the former designated
SharePoint folder—a single browsable set of writeups—without copying the files
or rebuilding Word editing.

It should list the registered artifacts by cycle and expose request identity,
institution, program/PD, artifact type/stage, lifecycle state, current version,
last modified, preview, and **Open in Word**. The earlier design also established
an explicit per-editor **Reviewed** marker and personal “N of M” progress.
That marker is tracking, not approval; SharePoint “has edits” evidence is only
a secondary hint because no edits can mean either “reviewed; no changes” or
“not reviewed.”

The Reviewed marker requires durable per-editor state, likely a child row keyed
to the editor and registered artifact. Its exact granularity (request versus
artifact stage), coordinator matrix, access key, and deadline remain design
decisions. App list visibility and SharePoint edit permission are separate
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
