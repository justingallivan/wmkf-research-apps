---
title: "Reviewer Materials — SharePoint Folder Convention"
domain: reviewer-workbench
kind: source-of-truth
status: canonical
summary: "Audience: Connor (PowerAutomate / file generation owner) Status: Agreed 2026-05-01. Code aligned to these names."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
---

# Reviewer Materials — SharePoint Folder Convention

**Audience:** Connor (PowerAutomate / file generation owner)
**Status:** Agreed 2026-05-01. Code aligned to these names.
**Related:** `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` (file storage architecture)

---

## What we agreed

For each `akoya_request` going out for external review, two sibling
subfolders under the request's existing SharePoint folder:

```
akoya_request/                                                ← existing library
  └─ 1002379_54E2B88B04B9F011BBD36045BD02B4CC/                 ← existing per-request folder
      ├─ (existing internal files — staff briefs, admin paperwork, etc.)
      ├─ Phase II/                                              ← raw GoApply submission (untouched)
      ├─ Reviewer_Downloads/                                    ← Connor's flow populates this
      │   ├─ Project Narrative.pdf
      │   ├─ Bibliography.pdf
      │   └─ ... (curated reviewer-facing files)
      └─ Reviewer_Uploads/                                      ← reviewers' completed reviews land here
          ├─ Patel_7f3a9c2e/                                    ← per-reviewer subfolder, created on first upload
          │   ├─ review.pdf
          │   └─ supplementary_notes.pdf
          └─ vanderBerg_a1b2c3d4/
              └─ review.docx
```

- **`Reviewer_Downloads/`** — Connor's PA flow creates this empty at
  request creation, then drops files in as they're generated. The
  reviewer-facing app reads only what's inside.
- **`Reviewer_Uploads/`** — Connor's PA flow creates this empty at
  request creation. Per-reviewer subfolders are created automatically
  by our backend on first upload (you don't populate this folder).

The reviewer-facing app reads only `Reviewer_Downloads/`. Anything else
in the request folder — admin paperwork, staff briefs, the raw `Phase
II/` submission — is invisible to reviewers by construction.

---

## Why this design

**Security by default.** A typical request folder holds 20+ files,
several of which (staff AI summaries, governing board lists, internal
status letters, applicant admin paperwork) should never be exposed
externally. Allowlisting one curated subfolder makes leakage impossible
absent staff explicitly placing the wrong file there.

**Symmetric naming.** "Downloads" and "Uploads" name the direction from
the reviewer's perspective — easy for everyone to remember.

**Decoupled from GoApply.** GoApply's submission shape can change
without affecting what reviewers see. PowerAutomate becomes the single
canonical place that decides "here is the reviewer package."

**Staff visibility.** Anyone browsing SharePoint can see exactly what
was shared with reviewers and what came back — no opaque filter buried
in code.

---

## What goes in `Reviewer_Downloads/`

For Phase II reviews, the reviewer-facing package today looks like:

- Project Narrative
- Bibliography
- Biographical Sketches
- Project Budget
- Financial Narrative
- Collaborative Arrangements
- Graphical Abstract
- (Optional) Proposal Abstract

Most of these are already produced by GoApply into `Phase II/`. The
flow's job is to copy (or generate fresh PDFs of) the curated subset
into `Reviewer_Downloads/`. Subfolders inside are fine if useful — the
reader walks recursively up to depth 3.

**Explicitly do NOT include:**

- `*_Staff_Version.*` — internal AI-generated staff briefs
- Application / Proposal Cover Pages — admin forms
- Recognition Statement, Declaration of Status Letter, Governing Board
  List — applicant administrative paperwork
- Phase I materials (when reviewing Phase II)
- Other Support documents (PII risk: pending grants from non-applicants)

When in doubt, exclude. Staff can always drop a file in manually after
the fact.

---

## Per-reviewer subfolder format (`Reviewer_Uploads/{name}/`)

`{sanitizedLastName}_{shortId}` — e.g. `Patel_7f3a9c2e`,
`OBrien_a1b2c3d4`, `vanderBerg_aabb1122`.

- `sanitizedLastName`: ASCII-folded (`José` → `Jose`), punctuation and
  spaces stripped (`O'Brien` → `OBrien`, `van der Berg` → `vanderBerg`),
  truncated to 30 chars
- `shortId`: first 8 chars of the suggestion GUID (collision-proof
  pairing)
- If the lastname sanitizes to empty (e.g. CJK-only with no ASCII fold),
  falls back to `{shortId}` only

The folder name is computed once at first upload and frozen. Replacing
files reuses the same folder. If the reviewer's name is corrected later
in the CRM, the SharePoint folder name does not auto-update — the
canonical pointer lives in `wmkf_appreviewersuggestion.wmkf_reviewsharepointfolder`.

**Important for any future automation that reads review uploads:**
identify reviewers by joining through Dataverse
(`_wmkf_potentialreviewer_value` → name, affiliation, email), never by
parsing the folder name. Folder names are display strings.

---

## Folder name details

- **Spelling:** exactly `Reviewer_Downloads` and `Reviewer_Uploads`
  (capital R, capital second word, single underscore). Case-insensitive
  on the read side, but standardize on this for clarity.
- **Location:** directly inside `akoya_request/{requestNumber}_{requestGuid}/`.
- **Empty `Reviewer_Downloads/`:** the reviewer-facing app shows "The
  Foundation hasn't shared materials yet — please contact us if you
  need them." Reviewers can still load the page, just no downloads.

---

## Multi-folder support / transition windows

The reviewer app supports a comma-separated environment variable
`REVIEWER_MATERIALS_FOLDERS` for periods where two folder names need to
coexist (e.g., a future rename). Default: `Reviewer_Downloads`. If we
change the convention later, the var lets us match both names during
the transition without a deploy.

---

## What the system does on its end

For reference — you don't need to build any of this; it's already in
place.

1. **Magic link generation** — when a reviewer accepts, the app mints
   a one-time JWT and sends them a `https://[app]/external/review/{token}`
   URL, embedded into the materials email body.
2. **File listing** — the landing page calls Microsoft Graph, walks
   the request's SharePoint folder under the `akoya_request` library,
   and returns only files whose path contains `/Reviewer_Downloads/`.
3. **File download** — when a reviewer clicks Download, the app
   re-validates membership (defense against ID brute-forcing), then
   streams the file from SharePoint via Graph as the foundation's app
   registration. The reviewer never sees a SharePoint URL or token.
4. **Review upload** — multipart POST. Files validated (extension,
   magic bytes, size cap). On success, written to
   `Reviewer_Uploads/{Patel_7f3a9c2e}/...` and the suggestion row's
   `wmkf_reviewsharepointfolder` is set to the path. Rollback on failure.

---

## What you need to build

1. **At request creation (or whenever the request enters Phase II
   Pending):** create the two empty subfolders
   `Reviewer_Downloads/` and `Reviewer_Uploads/` under the request's
   SharePoint folder.
2. **As reviewer-facing files become available:** drop them into
   `Reviewer_Downloads/`. Curate per the include/exclude list above.

That's it. The rest happens automatically.

---

## Open questions (post-pilot)

- Trigger point for folder creation: when the request enters "Phase II
  Pending," or earlier?
- Any naming you want for subfolders within `Reviewer_Downloads/` if
  you want to organize (e.g., `Reviewer_Downloads/Proposal/`,
  `Reviewer_Downloads/Supporting/`) — works fine on our end either way.
