---
title: "Power Automate Proposal File Contract"
domain: document-workflows
kind: spec
status: active
summary: "Required SharePoint folders and exact proposal PDF filenames for Power Automate."
canonical: true
owner: product-engineering
last_verified: 2026-08-17
related:
  - docs/REVIEWER_MATERIALS_FOLDER_SPEC.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
---

# Power Automate Proposal File Contract

## SharePoint structure

For each request, use the existing active request folder in the
`akoya_request` SharePoint library. Inside that request folder, ensure these
two subfolders exist:

```text
{Existing Request Folder}/
├── Reviewer Materials/
│   └── Proposal_{Request#}.pdf
└── AI Materials/
    ├── ProposalNarrative_{Request#}.pdf
    └── ProposalBibliography_{Request#}.pdf
```

Example for Request `1002379`:

```text
Reviewer Materials/Proposal_1002379.pdf
AI Materials/ProposalNarrative_1002379.pdf
AI Materials/ProposalBibliography_1002379.pdf
```

## File purposes

- `Proposal_{Request#}.pdf`: the complete reviewer-facing proposal package,
  including all materials reviewers should receive.
- `ProposalNarrative_{Request#}.pdf`: the project narrative only.
- `ProposalBibliography_{Request#}.pdf`: the bibliography or references only.

## Required rules

1. Use the folder names, filenames, and capitalization exactly as shown.
2. Keep the proposal narrative and bibliography as separate PDFs.
3. Do not create a combined canonical AI-input PDF.
4. Do not add dates, version numbers, spaces, or suffixes such as `(1)` to the
   filenames.
5. When regenerating a file, update or replace the exact existing file so
   SharePoint version history records the revision under the same path and
   filename.
6. Place the files only in the active request folder, not an archive library
   or archive request folder.
7. Resolve the existing request folder from the request's governed SharePoint
   location. Do not guess or independently reconstruct its root-folder name.

## Application behavior

- Pre-Site Visit, Initial Assessment, and Field Primer generation use only the
  exact proposal narrative file and stop before calling Claude when it is
  missing, renamed, ambiguous, or placed elsewhere.
- The separate bibliography is retained for the next-cycle Reviewer Finder,
  where cited authors can provide useful reviewer-discovery leads. It is not a
  Pre-Site Visit input.
- The reviewer release process uses the complete proposal package in
  `Reviewer Materials`.
- The PDF bytes remain in SharePoint. Dataverse will store document provenance
  and generated writeup information rather than duplicate these source PDFs.
