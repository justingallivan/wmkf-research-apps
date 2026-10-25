---
title: Research request file corpus — derived legible layer
kind: plan
domain: dataverse
status: proposed
summary: "Build a derived, rebuildable index (and extracted text) over the SharePoint files attached to Research requests, 1990–present, without moving or renaming originals, so staff can browse and AI/portfolio/outcome analyses can run. Based on the 2026-10-25 read-only inventory of 9,001 requests and 60,369 files (de-duplicated across runs); storage location and content-access steps await owner decisions."
owner: product-engineering
related:
  - scripts/probe-request-file-inventory.mjs
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - shared/config/researchPrograms.js
  - lib/utils/sharepoint-buckets.js
  - lib/utils/file-loader.js
---

# Research request file corpus — derived legible layer

## Goal and boundary

[PROPOSED; owner direction 2026-10-25.] Make the files attached to Research
requests simple to find and usable for later analysis: AI over full text,
portfolio statistics, linking proposal content to reviews and outcomes, and
staff browsing.

The owner chose a **derived layer**: originals stay exactly where GOapply,
AkoyaGO and the migrations put them. Nothing in SharePoint is renamed, moved or
deleted. The layer is a rebuildable index plus extracted text that points back to
each original by its Graph item identity. Scope is Research only
(`RESEARCH_PROGRAM_IDS`: S&E and Medical Research), working newest first and
eventually back as far as the records go.

This layer is not the governed Request Document registry (`wmkf_requestdocument`),
which tracks app-produced writeups and Site Visit artifacts with lifecycle and
version rules. The corpus may read those files, but it never writes that registry
or substitutes for it.

## What exists — inventory of 2026-10-25

[VERIFIED via `scripts/probe-request-file-inventory.mjs` (847f86141), read-only
Production listing; no downloads.] CSVs are kept outside the repo in the owner's
OneDrive (`Research/Shuttle/request-file-inventory-2026-10-25/`) because filenames
can name people.

| Run (selection) | Requests | Files | Listing errors |
|---|---|---|---|
| Meeting date 1990–2015 | 4,455 | 18,181 | 0 |
| Meeting date 2016–2023 | 3,405 | 30,293 | 2 |
| Meeting date 2024 – Jun 2026 | 930 | 9,070 | 0 |
| Created 2026 (Dec 2026 cycle) | 213 | 2,879 | 0 |

De-duplicated on `request_id` and Graph item id, the four runs hold 9,001
requests and 60,369 files (60,237 excluding test requests); two requests appear
in both of the last two runs. Migrated requests carry
a 2023 `createdon` (3,401 of 3,405 in 2016–2023), so history must be windowed by
`wmkf_meetingdate`. Requests with no meeting date were not covered by the
history runs.

### Four eras

| Era | Meeting years | Library | Shape |
|---|---|---|---|
| 1 | 1990–2015 | `RequestArchive1` (1990–2004), `RequestArchive2` (2004–2015), some `RequestArchive3` from 2014 | Flat folders; 92% legacy `.doc`; 15,837 files named only `<number>.doc` |
| 2 | 2016–2021 | `RequestArchive3`; `akoya_request` from 2018 | Flat; old form exports (`Application<n>.html`), legacy `.doc` (reviews stored as files, e.g. `<institution> - Phase II Review.doc`), interim/final reports mixed in |
| 3 | 2022–2025 | `akoya_request` | Mostly flat GOapply names (`projectdescription.pdf`, `application cover page.docx`); some staff-made subfolders (`Phase II/<institution> Reviews`, `Relevant Papers`) |
| 4 | 2026 | `akoya_request` | Consistent `Phase I` / `Phase II` / `Site Visit - …` / `Artifacts/…` structure; app-generated files well named |

### Findings that shape the design

- **Era 4 Phase I is uniform.** Seven GOapply filenames each appear on 203–213
  of the 213 requests created in 2026 (application form, project description,
  cover page, biosketches, governing board list, budget PDF, budget
  spreadsheet), and `otherfunding.pdf` on 113, so filename rules should
  classify most of it.
- **Phase II naming drifts.** One document type appears under several names
  ("biosketches" / "biographical sketches"; "project budget sheet" / "project
  budget spreadsheet"), and some Phase II sets sit in the root as
  `proposal_<req>.pdf`, `proposalnarrative_<req>.pdf`.
- **Era 1 filenames carry no meaning.** Number-only `.doc` files can only be
  classified from their content.
- **Formats repeat.** Among non-test files created in 2026, 109 base names in
  the same folder exist in more than one format
  (transcripts as json/txt/vtt; docx/pdf; pptx/pdf).
- **Video dominates bytes, not value.** MP4 recordings are 16.1 of 21.6 GB of real
  2026 files; their transcripts are already beside them.
- **Empty requests differ by era.** From 2016 on, empty requests are almost all
  status "Concept Done" (993 of 999 in 2016–2023; 133 of 136 in 2024 – Jun 2026).
  Before 2016 they are spread across statuses (236 "Office Visit", 98 "Site
  Visit", 66 "Closed" among the 1990–2015 empties), and early years are sparse
  (40 of 56 requests in 1990 have no files).
- **Early absence is unexplained.** Whether pre-2016 empty folders mean "never
  had files" or a migration gap is not known [ASSUMED either way].
- **Test requests are flagged.** `wmkf_istestrequest` marks Factory requests (6 in
  2026, 132 files); the corpus excludes them.
- **Two listing errors to resolve:** one request (1001703) has a document location
  whose library name the SharePoint allowlist refuses (likely a malformed location
  row); one archive folder failed mid-walk.

## Proposed design

### 1. Document type vocabulary

A short, human-legible list, applied across all eras. Draft:

- **Application:** `application-form`, `cover-page`, `project-summary`,
  `project-description` (narrative), `bibliography`, `graphical-abstract`,
  `biosketches`, `budget`, `budget-spreadsheet`, `financial-narrative`,
  `other-funding`, `governing-board`, `status-letter`, `institutional-priority`,
  `collaborative-arrangements`, `equipment-quotes`, `recognition-statement`,
  `agency-reviews` (applicant-supplied federal reviews).
- **Review and decision:** `external-review`, `staff-review`, `site-visit-report`,
  `site-visit-slides`, `site-visit-transcript`, `site-visit-summary`,
  `staff-discussion-transcript`, `staff-discussion-summary`, `staff-writeup`
  (Initial Assessment / Pre-Site / Final).
- **Post-award:** `interim-report`, `final-report`, `financial-report`,
  `no-cost-extension`, `budget-reallocation`, `publication`.
- **Other:** `correspondence`, `relevant-paper`, `media` (recordings), `other`.

Each file also gets a **phase** (`concept`, `phase-i`, `phase-ii`, `site-visit`,
`post-award`, `unknown`) and an **era**.

### 2. Classification, cheapest first

1. **Folder and filename rules** per era (exact GOapply names, request-number
   patterns, `Site Visit - …` folders). Developed and measured offline against the
   inventory CSVs: no Production access needed.
2. **Content check** for what rules leave as `other`: extract the first page of
   text and classify it, with a model where rules cannot decide. Required for
   era 1 and much of era 2.

Every row records how it was classified (`rule:<id>`, `content-rule`, `model`) so
results can be audited and re-run when rules improve.

### 3. One preferred text copy

When a document exists in several formats, mark one as the text source: `txt`
over `vtt`/`json` for transcripts; the PDF of a docx/pdf pair when both carry
the same content (it reflects what reviewers saw); the PDF over pptx for slides.
Other copies stay indexed but are not extracted again.

### 4. Text extraction

- PDF and DOCX: existing `pdf-parse` and `mammoth` (`lib/utils/file-loader.js`).
- Legacy `.doc`, `.html`, `.xls`, `.pptx`: convert through Graph's
  PDF conversion (`GraphService.downloadFileAsPdf`) and then parse.
  [ASSUMED: Microsoft documents `.doc`/`.html`/`.xls` as convertible; probe a
  small sample of each before relying on it.]
- Spreadsheets: extract the cells as text (exceljs).
- Recordings: not extracted; their transcripts stand in.
- Scanned PDFs without a text layer: flagged `needs-ocr`, not processed in the
  first pass.

### 5. Where the index lives — owner decision

| Option | Fits | Costs |
|---|---|---|
| **A. Postgres index + private Blob text** (recommended) | Rebuildable cache, not a business record; cheap to re-run; good for analysis queries | Not visible in AkoyaGO; staff browse through an app page |
| B. Dataverse table | Visible next to the request in AkoyaGO | 60,000+ rows (60,237 non-test files today) plus text is costly in Dataverse storage; slower to rebuild |
| C. Clean mirror library in SharePoint (converted PDFs, normalized names) | Easiest staff browsing | Duplicates the corpus; a second copy to keep in sync |

A new table means a migration, an Atlas page and a security review of who may
read extracted applicant text.

### 6. Rollout, newest first

1. **Rules offline** against the CSVs; report coverage per era. (No Production
   access.)
2. **Owner decisions** below.
3. **Index build for era 4, then era 3** (metadata only, from a fresh listing).
4. **Text extraction pilot** on a bounded set of recent requests; check quality.
5. **Eras 2 and 1** with content classification, sampled and reviewed before the
   full run.
6. **Staff browsing surface** and the first analyses.
7. **Keeping current:** a scheduled re-listing for new and changed files.

## Owner decisions needed

1. **Index location:** option A, B or C (recommended A).
2. **Content access:** reading file contents (download and extraction) is a
   larger step than the metadata listing done so far. Approve a bounded pilot,
   and whether a model may classify content.
3. **Who may see extracted text and the browsing page:** all staff, Research
   staff, or a named group.
4. **Pre-1990 and requests with no meeting date:** whether to look for them.
5. **Grant reports:** in scope for the first pass or later.

## Not in scope

Renaming, moving, deleting or re-permissioning any SharePoint file; changing
GOapply or AkoyaGO folder conventions; writing `wmkf_requestdocument`; programs
outside `RESEARCH_PROGRAM_IDS`.
