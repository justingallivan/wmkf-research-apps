---
title: "Reviewer Materials — SharePoint Folder Convention"
domain: reviewer-workbench
kind: source-of-truth
status: canonical
summary: "Canonical outbound reviewer package: Reviewer Materials/Proposal_{Request#}.pdf; every other request file remains internal."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-08-01
owner: product-engineering
related:
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
---

# Reviewer Materials — SharePoint Folder Convention

**Audience:** Connor (PowerAutomate / file generation owner)
**Status:** Owner-confirmed 2026-07-30. External delivery, Workbench Field
Primer request mode, and Initial Assessment generation are aligned to this
exact folder/file contract. Reviewer Finder alone has the bounded current-cycle
compatibility fallback documented below.
**Related:** `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` (file storage architecture)

---

## What we agreed

For each `akoya_request` going out for external review, the outbound reviewer
package is one exact PDF under the request's existing SharePoint folder:

```
akoya_request/                                                ← existing library
  └─ 1002379_54E2B88B04B9F011BBD36045BD02B4CC/                 ← existing per-request folder
      ├─ (existing internal files — staff briefs, admin paperwork, etc.)
      ├─ Phase II/                                              ← raw GoApply submission (untouched)
      ├─ Reviewer Materials/                                    ← outbound reviewer package
      │   ├─ Proposal_1002379.pdf                               ← the ONLY reviewer-visible file
      │   └─ Research Phase I Application_2026-...pdf           ← internal; NEVER exposed
      └─ (other internal files and folders)
```

- **`Reviewer Materials/Proposal_{Request#}.pdf`** — Connor's PA flow creates
  or replaces this compiled reviewer package. The reviewer-facing app exposes
  only this exact request-bound filename.

Anything else in the request folder — including other files placed in
`Reviewer Materials/`, admin paperwork, staff briefs, and raw application
exports — is invisible to reviewers by construction.

---

## Why this design

**Security by default.** A typical request folder holds 20+ files, several of
which should never be exposed externally. Folder-only allowlisting is not
enough because internal artifacts can coexist with the reviewer package.
Requiring both the canonical folder and request-bound filename prevents those
neighboring files from leaking.

**One explicit outbound contract.** Staff and automation can identify the
reviewer package without inferring visibility from a broad folder.

**Decoupled from GoApply.** GoApply's submission shape can change without
affecting what reviewers see. PowerAutomate produces one compiled package with
a stable name.

**Staff visibility.** Anyone browsing SharePoint can identify the shared file
unambiguously: `Proposal_{Request#}.pdf`.

---

## What reviewers receive

The only reviewer-visible file is:

`Reviewer Materials/Proposal_{Request#}.pdf`

Live-verified example for Request #1003109:

`Reviewer Materials/Proposal_1003109.pdf`

PowerAutomate owns assembling the approved reviewer-facing content into that
single PDF.

**Explicitly never expose:**

- `Research Phase I Application_<timestamp>.pdf` — this raw/internal
  application artifact contains more information than WMKF sends reviewers.
- Any other filename in `Reviewer Materials/`, even if it is a PDF.
- `*_Staff_Version.*`, cover pages, governing-board lists, declarations,
  recognition statements, Other Support documents, internal summaries, or
  administrative paperwork.

The portal enforces this server-side at both listing and download time. Merely
placing another file beside the proposal does not make it reviewer-visible.

---

## Folder name details

- **Outbound folder spelling:** exactly `Reviewer Materials` (one space).
  Matching is case-insensitive on the read side because SharePoint paths are
  case-insensitive, but automation and staff should use the canonical spelling.
- **Outbound filename:** exactly `Proposal_{Request#}.pdf`, including
  capitalization and extension. Filename matching is case-sensitive.
- **Location:** directly inside `akoya_request/{requestNumber}_{requestGuid}/`.
- **Missing exact proposal file:** the reviewer-facing app shows no download.
  An unrelated PDF in the same folder does not satisfy the release preflight.

---

## No environment-configurable widening

The outbound folder and filename are code-reviewed constants, not an
environment allowlist. Widening reviewer visibility requires a reviewed code
change and matching tests; an environment edit cannot expose another folder.

---

## What the system does on its end

For reference — you don't need to build any of this; it's already in place.

1. **Magic link generation** — when a reviewer accepts, the app mints
   a one-time JWT and sends them a `https://[app]/external/review/{token}`
   URL, embedded into the materials email body.
2. **File listing** — the landing page calls Microsoft Graph, walks the
   request's SharePoint buckets, and returns only
   `Reviewer Materials/Proposal_{Request#}.pdf`.
3. **File download** — when a reviewer clicks Download, the app
   independently re-validates the same folder + filename + request-number
   predicate (defense against ID brute-forcing or a leaked internal file ID), then
   streams the file from SharePoint via Graph as the foundation's app
   registration. The reviewer never sees a SharePoint URL or token.
4. **Review submission** — the reviewer completes the in-browser form. Final
   submit writes structured `wmkf_appreviewanswer` snapshots to Dataverse; no
   reviewer PDF is required. Retained legacy upload infrastructure is outside
   this outbound-materials contract.
5. **Governed proposal analysis** — Workbench Field Primer request mode and
   Initial Assessment generation read this same exact file from the active
   `akoya_request` library. They do not fall back to
   `Phase I/ProjectDescription.pdf`, a raw application export, an archive
   library, or another PDF. Missing or duplicate active canonical files stop
   before the model call and before any artifact or Dataverse result write.
6. **Reviewer Finder current-cycle compatibility** — Reviewer Finder prefers
   this same exact active canonical file. Only when it is absent, its default
   loader falls back to exactly one active
   `Phase I/ProjectDescription.pdf`. If neither exact path exists, or either
   applicable path is ambiguous, it returns the server-listed picker before
   download or Blob write. This staff-only ingestion rule does not widen the
   external reviewer package and does not apply to Field Primer or Initial
   Assessment generation.

Reviewer Finder retains an explicit authenticated `fileKey` override for
deliberate staff analysis of a historical or ad-hoc source. That manual action
does not change the default, and it does not widen the files visible to an
external reviewer.

---

## What you need to build

1. **At request creation (or whenever the request enters Phase II Pending):**
   create `Reviewer Materials/` under the request's SharePoint folder.
2. **When the reviewer package is ready:** create or replace exactly
   `Reviewer Materials/Proposal_{Request#}.pdf`.
3. **Do not rename the raw timestamped application export to the canonical
   proposal filename.** The canonical PDF must contain only the content
   approved for external reviewers.

That's it. The rest happens automatically.

For the current cycle this PDF contains the separate Phase II proposal. This
is expected to be the last cycle with a separate Phase II submission. The
stable contract for this work remains
`Reviewer Materials/Proposal_{Request#}.pdf` when the application process
moves to a single submission, unless the owner explicitly changes it.

---

## Open question

- Trigger point for folder/file generation: when the request enters
  "Phase II Pending," or another explicit release-ready state?
