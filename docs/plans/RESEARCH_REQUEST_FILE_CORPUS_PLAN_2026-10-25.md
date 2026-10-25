---
title: Research request file corpus — derived legible layer
kind: plan
domain: dataverse
status: active
summary: "Build a derived, rebuildable index (and extracted text) over the SharePoint files attached to Research requests, 1990–present, without moving or renaming originals, so staff can browse and AI/portfolio/outcome analyses can run. Based on the 2026-10-25 read-only inventory of 9,001 requests and 60,369 files (de-duplicated across runs); index starts in Postgres and settled fields are promoted to Dataverse as the durable record (owner decision 2026-10-25); owner approved a past-weighted content pilot (~55 requests) focused on science proposals, reviews, grant reports and staff writeups, with visibility matching request access."
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

[ACTIVE; owner direction and decisions 2026-10-25; nothing built beyond the inventory script.] Make the files attached to Research
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
| 3 | 2022 – Jun 2026 cycle | `akoya_request` | Mostly flat GOapply names (`projectdescription.pdf`, `application cover page.docx`); `Phase I`/`Phase II` folders appear inconsistently from 2025 (Jun 2026 cycle: 1,879 of 2,108 files still in the root); staff-made subfolders (`Phase II/<institution> Reviews`, `Relevant Papers`) |
| 4 | Dec 2026 cycle onward (requests created 2026) | `akoya_request` | Consistent `Phase I` / `Phase II` / `Site Visit - …` / `Artifacts/…` structure; app-generated files well named |

### Findings that shape the design

- **Era 4 (Dec 2026 cycle) Phase I is uniform.** Seven GOapply filenames each appear on 203–213
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
- **Early absence is unexplained.** A pre-2016 empty folder may mean nothing was
  ever attached, or that attachments were lost in migration; the cause is open
  [ASSUMED either way].
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

**Reading priority** [DECIDED by owner 2026-10-25]. Every file is typed, but
text is extracted only for the documents the analyses need to read:

| Priority | Types | Treatment |
|---|---|---|
| **Read** | Science proposal documents (`project-summary`, `project-description`, `application-form` narrative sections, `graphical-abstract`, `bibliography`); reviews (`external-review`, `staff-review`, `agency-reviews`, `site-visit-report`); `interim-report`, `final-report`; `staff-writeup` | Classify and extract text |
| **Already legible** | `site-visit-transcript`, `site-visit-summary`, `staff-discussion-transcript`, `staff-discussion-summary`, `site-visit-slides` | Classify; these are recent, app-generated and text already, so no conversion work |
| **Type only** | `budget`, `budget-spreadsheet`, `financial-narrative`, `financial-report`, `biosketches`, `cover-page`, `governing-board`, `status-letter`, `other-funding`, `institutional-priority`, `no-cost-extension`, `budget-reallocation`, `correspondence`, other administrative types, `media` | Classify so they can be filtered out; no text extraction |

Staff writeups from before AkoyaGO have no recognizable name. The working
hypothesis is that they sit among era 1–2 documents (e.g. `Final Report Write
Up` folders, number-named `.doc`), which the pilot is meant to test.
That hypothesis is [ASSUMED].

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
- Recordings: not extracted; their transcripts stand in. In the 2026 created-year
  run all 24 requests with an MP4 also have at least one transcript file; a
  recording without one is flagged rather than transcribed.
- Scanned PDFs without a text layer: flagged `needs-ocr`, not processed in the
  first pass.

### 5. Where the index lives — decided: Postgres first, Dataverse as the durable record

[DECIDED by owner 2026-10-25.] The index starts in **Postgres**, with extracted
text in a **private Blob** store, while the vocabulary and rules are still
changing. Once they settle, a small set of stable fields per document (for
example document type and phase) is **promoted to Dataverse as the durable
record**, so it sits beside the request in AkoyaGO. This follows the System
Model's storage tiers: Postgres stages data that is not yet clean, and what
proves broadly useful is promoted to Dataverse [VERIFIED via
docs/SYSTEM_MODEL.md:229-234].

Why this order:

- The index is rebuilt every time the rules improve (60,237 non-test files
  today). Postgres takes bulk rewrites cheaply; Dataverse writes go through the
  Web API (batched at best), the target interlock (CLAUDE.md safety invariants)
  and Microsoft's service-protection limits [ASSUMED from Microsoft
  documentation, not probed], and each column change is a schema wave.
- Portfolio, outcome and full-text queries are natural in SQL.
- Embedding support for AI search is an open check before relying on it
  [ASSUMED available].
- The Postgres layer is disposable: it can be dropped and rebuilt from SharePoint.
- Extracted text lives in private Blob in both phases, not in either database;
  its size is open until the extraction pilot [ASSUMED several GB].

Alternatives considered: a Dataverse table from the start (visible in AkoyaGO
immediately, but slow to rebuild while rules change; its storage cost was not
checked against capacity) and a cleaned mirror library in SharePoint (easiest
browsing, but a second copy of the corpus to keep in sync).

The Postgres phase needs a migration, an Atlas page and a security review of who
may read extracted applicant text. Promotion to Dataverse needs its own reviewed
plan: which fields, a schema-as-code wave, and the history load. The System Model
notes promotion governance is under-specified; define it in that plan.

### 6. Rollout

1. **Rules offline** against the CSVs; report coverage per era. (No Production
   access.)
2. **Content pilot, weighted to the past** [APPROVED by owner 2026-10-25]: about
   55 requests: ~10 each from era 1 years (e.g. 1995, 2005, 2012), ~10 each from
   era 2 years (e.g. 2017, 2020), and ~5 from a recent cycle as a known-good
   baseline. Goals: learn what number-named `.doc` files contain; test `.doc`,
   `Application<n>.html` and `.xls` conversion; measure extraction quality on
   Read-priority types. A model may classify content through
   `lib/services/llm-client.js`. Results come back to the owner before any
   scale-up; the full run needs a further approval.
3. **Index build** (metadata, from a fresh listing), newest era first, using the
   rules from step 1 and what the pilot learned.
4. **Text extraction at scale** for Read-priority types, after approval.
5. **Staff browsing surface** and the first analyses.
6. **Keeping current:** a scheduled re-listing for new and changed files.
7. **Promote settled fields to Dataverse** under its own reviewed plan.

## Owner decisions (all made 2026-10-25)

1. **Index location:** Postgres first, then promote settled fields to Dataverse
   as the durable record (section 5).
2. **Content access:** the past-weighted pilot of about 55 requests (rollout
   step 2), with model classification allowed; full-scale extraction needs a
   further approval after the pilot report.
3. **Visibility:** match request access. Whoever can open a request's files today
   may see its extracted text and browsing entries; nobody gains access to a
   request they cannot already reach. How the app enforces this (existing
   request restriction context vs. a SharePoint permission check) is a design
   step for the browsing surface.
4. **History gaps:** count pre-1990 Research requests and Research requests with
   no meeting date (read-only), then decide whether to include them.
5. **Reading scope:** read science proposal documents, reviews, interim and
   final reports, and staff writeups. Budgets, biosketches and administrative
   documents (no-cost extensions, budget reallocations, emails) are typed but
   not read. Site Visit transcripts and summaries and staff discussion
   summaries are already legible (section 1, reading priority).

## Not in scope

Renaming, moving, deleting or re-permissioning any SharePoint file; changing
GOapply or AkoyaGO folder conventions; writing `wmkf_requestdocument`; programs
outside `RESEARCH_PROGRAM_IDS`.
