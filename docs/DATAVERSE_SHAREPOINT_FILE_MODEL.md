---
title: Dataverse / SharePoint File Storage Model
domain: dataverse
kind: source-of-truth
status: active
summary: "File storage and linking in AkoyaGO/Dynamics, including the governed SharePoint/Dataverse contract for editable staff writeups."
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

## Governed staff writeups — target contract

> **Owner-decided direction (2026-07-28); implementation still planned.**
> This section governs the Initial Assessment, Pre Site Visit Writeup, and
> Final Writeup design. It does not claim that the target Dataverse schema,
> SharePoint library policy, prompts, or Workbench surfaces have been
> provisioned.

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
- artifact type (`initial-assessment`, `pre-site-visit`, or `final-writeup`);
- SharePoint site/drive/item identity and human-facing URL;
- current version/eTag and last-modified metadata;
- producer and AI prompt/run provenance where applicable;
- draft/review/board-ready/superseded/final lifecycle state; and
- immutable milestone version/snapshot references.

A URL alone is not the artifact identity, and a folder/filename convention is
not a durable join contract.

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
