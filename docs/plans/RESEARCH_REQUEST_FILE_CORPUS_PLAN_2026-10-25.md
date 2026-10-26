---
title: Research request file corpus — derived legible layer
kind: plan
domain: dataverse
status: active
summary: "Build a derived, rebuildable index (and extracted text) over the SharePoint files attached to Research requests, 1990–present, without moving or renaming originals, so staff can browse and AI/portfolio/outcome analyses can run. Based on the 2026-10-25 read-only inventory of 9,001 requests and 60,369 files (de-duplicated across runs); index starts in Postgres and settled fields are promoted to Dataverse as the durable record (owner decision 2026-10-25); owner approved a past-weighted content pilot (~55 requests) focused on science proposals, reviews, grant reports and staff writeups, with visibility governed by the app's request restrictions; inventory counts are provisional pending a strict re-listing. The content pilot (55 requests, 449 files) found legacy .doc converts through Graph, about a quarter of PDFs need OCR, and the 1995–2012 archives hold staff and grant-management documents with strong first-line templates rather than proposals."
owner: product-engineering
related:
  - scripts/probe-request-file-inventory.mjs
  - scripts/pilot-request-file-content.mjs
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

**These counts are provisional.** The runs did not pass `requireResolvedParents`,
so if a request's parent-library lookup failed, `getRequestSharePointBuckets`
silently fell back to `akoya_request` instead of reporting an error
[VERIFIED via lib/utils/sharepoint-buckets.js:97-117]; a request stored in another
library could then be under-listed while showing no error. The script now
passes the strict option; the index build's fresh listing replaces these counts.

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
`wmkf_meetingdate`. Requests with no meeting date, and those with a meeting
date before 1990, were not covered by the history runs; decision 4 counts them.

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
- **Other:** `correspondence`, `relevant-paper`, `media` (recordings),
  `institutional-info`, `ai-material`, `uncertain`.
- **Added from rule building (section 2a):** `compiled-proposal`,
  `institutional-info`, `ai-material`.

Each file also gets a **phase** (`concept`, `phase-i`, `phase-ii`, `site-visit`,
`post-award`, `unknown`) and an **era**.

**Reading priority** [DECIDED by owner 2026-10-25]. Every file is typed, but
text is extracted only for the documents the analyses need to read:

| Priority | Types | Treatment |
|---|---|---|
| **Read** | Science proposal documents (`compiled-proposal`, `project-summary`, `project-description`, `application-form` narrative sections, `graphical-abstract`, `bibliography`); reviews (`external-review`, `staff-review`, `agency-reviews`, `site-visit-report`); `interim-report`, `final-report`; `staff-writeup`; `site-visit-slides` (PDF) | Classify and extract text |
| **Already legible** | `site-visit-transcript`, `site-visit-summary`, `staff-discussion-transcript`, `staff-discussion-summary` | Classify; these are recent, app-generated `.txt` (with `.vtt`/`.json` copies), so no conversion work |
| **Deferred** | Any `.pptx`/`.ppt`, whatever its type | Typed, not read this round [DECIDED by owner 2026-10-25]; revisit later |
| **Type only** | `budget`, `budget-spreadsheet`, `financial-narrative`, `financial-report`, `biosketches`, `cover-page`, `governing-board`, `status-letter`, `other-funding`, `institutional-priority`, `no-cost-extension`, `budget-reallocation`, `correspondence`, `institutional-info`, `ai-material`, other administrative types, `media` | Classify so they can be filtered out; no text extraction |

Staff writeups from before AkoyaGO have no recognizable name. The working
hypothesis is that they sit among era 1–2 documents (e.g. `Final Report Write
Up` folders, number-named `.doc`), which the pilot is meant to test.
That hypothesis is [ASSUMED].

### 2. Classification, cheapest first

1. **Folder and filename rules** per era (exact GOapply names, request-number
   patterns, `Site Visit - …` folders). Developed and measured offline against the
   inventory CSVs: no Production access needed.
2. **Template signatures** for what filename rules leave `other` or
   `uncertain`: many documents are written on a template with fixed wording
   (form headings, review prompts, report section titles). Regular expressions
   over normalized extracted text (case, whitespace and line breaks
   collapsed) identify the template, and therefore the type. Required for era 1
   and much of era 2. [Owner suggestion 2026-10-25; the templates themselves are
   [ASSUMED] until the pilot opens documents.]
3. **Model classification** only for what neither rules nor signatures decide.

Every row records how it was classified (`rule:<id>`, `template:<id>`, `model`) so
results can be audited and re-run when rules improve.

**Template discovery is data-driven.** Within each era and candidate type,
count the normalized lines that recur across many documents; the high-frequency
lines are the template's fixed wording and become signatures. Templates drift,
so each signature carries the era or date range it was found in, and a template
seen in a new era is checked rather than assumed to match.

**Section splitting.** Where a template is identified, its fixed headings or
prompts also split the document into named sections (for example each review
prompt and its answer, or a report's progress and outcomes sections). Sections
are stored with the extracted text so analyses can compare like with like across
years. A document whose template is found but whose sections do not all match
keeps its full text and is flagged `sections-partial`, not forced.

**Rules may not silently exclude.** A filename rule that labels a document
Type-only would otherwise keep a misnamed proposal or writeup out of the
reading set without any signal. So:

- a rule that cannot decide assigns `uncertain`, never a forced type; `uncertain`
  documents go to template signatures, then the model;
- the pilot independently labels a sample of rule-matched documents (Read and
  Type-only) from every era and measures **missed Read documents**, not only
  coverage;
- rules may exclude a type from extraction only after the owner accepts the
  measured miss rate.

### 2a. Filename rule results — 2026-10-25 (rollout step 1)

[VERIFIED via `lib/services/request-file-corpus/filename-rules.js` applied offline
by `scripts/report-request-file-rule-coverage.mjs` to the provisional inventory
CSVs; 60,237 non-test files; unit tests in
`tests/unit/request-file-corpus-filename-rules.test.js`.]

| Era | Files | Read | Already legible | Type-only | Deferred (PowerPoint) | Uncertain (of which opaque names) |
|---|---|---|---|---|---|---|
| 1 | 18,181 | 503 | 0 | 449 | 0 | 17,229 (16,354) |
| 2 | 22,461 | 4,745 | 0 | 8,485 | 19 | 9,212 (6,295) |
| 3 | 16,902 | 6,957 | 0 | 7,710 | 25 | 2,210 (297) |
| 4 | 2,693 | 898 | 314 | 1,456 | 25 | 0 |

After the second Codex review: a name mixing proposal and administrative words
(e.g. a combined proposal-and-budget package) is `uncertain` (`mixed-purpose`;
18 files), and the tax-status rule needs a letter, determination, exempt or
status word beside "IRS". Tax determination letters themselves stay Type-only
(owner: ignorable).

- **Opaque names are larger than the inventory summary showed.** Era 2 holds
  4,148 `.doc` files named with hyphenated GUIDs in addition to 1,688
  number-only `.doc` and 440 GUID `.html`; eras 1–2 together have 22,649 files
  whose names carry no meaning. Only template signatures or the model can
  classify them, which makes the content pilot the deciding step for history.
- **Pre-AkoyaGO staff documents exist by name in era 3** (and a few in era 2):
  252 "Phase I rationale" documents, 63 site visit memos and write-ups
  (`SV memo …`, `… site visit WU`), 224 other write-ups, and office visit
  memos. They are Read (`staff-review`, `site-visit-report`, `staff-writeup`).
- **Reviews by name:** 980 files across eras 1–4 match the review rule.
- **Vocabulary additions found while building rules:** `compiled-proposal` (a
  Phase II package or staff version, Read), `institutional-info` (fact sheets,
  audited financials, treasurer's reports; Type-only) and `ai-material`
  (app-made AI inputs; Type-only, applied only after Read rules so a copied
  proposal stays Read).
- **Remaining non-opaque uncertain** (875 / 2,917 / 1,913 in eras 1–3) is a long
  tail of institution-specific names. More rules have diminishing returns;
  those documents go to template signatures and the model.
- These counts are a rule-quality signal, not a final classification: the pilot
  still measures missed Read documents among rule-matched samples (section 2).

### 2b. Content pilot results — 2026-10-25 (rollout step 2)

[VERIFIED via `scripts/pilot-request-file-content.mjs`, run by the owner against
Production SharePoint, read-only; output in the owner's Shuttle folder.] Sample:
55 non-test requests, 10 each with a meeting year of 1995, 2005, 2012, 2017 and
2020 and 5 from 2025 on, taken at an even stride through request numbers. 466
files were selected (every file except PowerPoint); 449 were downloaded with no
download errors and 17 were skipped by the caps or as `.msg`. Findings hold for
this sample only.

- **Legacy `.doc` converts.** Graph's PDF conversion handled all 244 `.doc`
  files: 232 gave full text, 11 gave little text and 1 none. All 25 `.xlsx`
  converted. `.htm`/`.html` (19, including `Application<n>.html`) were read by
  stripping tags locally, not through Graph. No `.xls` or `.rtf` was in the
  sample, so their conversion is still untested.
- **About a quarter of PDFs have no text layer.** Of 120 PDFs, 22 gave no text
  and 7 gave very little (under 100 characters per page); these need OCR. Some
  PDFs with a text layer carry poor OCR (misread letterheads, pages upside down),
  so a text-quality check is needed besides "has text".
- **Era 1 archives hold Foundation documents, not proposals.** In the 30
  sampled requests from 1995, 2005 and 2012, no applicant proposal text was
  found. The files are Foundation letters (66 by first line), staff memos,
  grantee information sheets, proposal control sheets (1995), staff Phase I and
  Phase II reviews (2005), Phase I Summary and Rationale write-ups (2012), grant
  monitoring reports, financial summaries and grantee reports. For history, the
  readable record in these years is the staff's account of each proposal.
- **Opaque names hide strong templates.** Almost all of those files have
  number-only names, but their first lines identify them: `PHASE I REVIEW`,
  `PHASE II REVIEW`, `Phase I Summary and Rationale`, `Tracking Overview`,
  `GRANTEE INFORMATION SHEET`, `GRANT MONITORING REPORT`, `Financial Summary
  for:`, `Memorandum`, `PROPOSAL CONTROL SHEET`, and dated letters. Template
  signatures (section 2) should classify most era 1–2 opaque files without a
  model.
- **"Phase II Review" names staff writeups in the older files.** In the sample,
  documents headed `Phase II Review` (2005, 2017) are staff reviews with the
  requested amount and budget, not external referee reviews (those are headed
  `REFEREE REVIEW`). The filename rule that maps such names to `external-review`
  (about 64 inventory filenames contain "Phase I(I) Review") needs a content check
  before it is trusted; both types are Read, so nothing is excluded meanwhile.
- **"References" files are referee lists, not bibliographies.** In 2020 the
  files the `bibliography` rule matched are lists of suggested referees (names,
  titles, addresses), and one 2017 match is a referee review. The type needs
  renaming, and whether a referee list is Read or Type-only is an owner call.
- **Type-only labels held in a spot check.** Type-only files were checked by
  their first lines (up to six per type and cohort), and the 14 over 20,000
  characters were searched for proposal terms; none was a proposal, review,
  report or staff writeup. The large ones are audited financial statements,
  annual reports and grant agreement packets.
- **An unflagged test request.** One sampled recent request has placeholder
  content ("blahblahblah", applicant "W M Keck Foundation") but no
  `wmkf_istestrequest` flag, so the flag alone does not exclude all test data.
- **No model pass yet.** Templates and filename rules explain the sample well
  enough that the model is better spent on what remains after template
  signatures than on the whole pilot.

### 3. One preferred text copy

When a document exists in several formats, mark one as the text source: `txt`
over `vtt`/`json` for transcripts; the PDF of a docx/pdf pair when both carry
the same content (it reflects what reviewers saw); the PDF over pptx for slides.
Other copies stay indexed but are not extracted again.

### 4. Text extraction

- PDF and DOCX: existing `pdf-parse` and `mammoth` (`lib/utils/file-loader.js`).
- Legacy `.doc` and `.xlsx`: convert through Graph's PDF conversion
  (`GraphService.downloadFileAsPdf`) and then parse; the pilot converted all 244
  `.doc` and 25 `.xlsx` files (section 2b). `.htm`/`.html`: strip tags locally.
  `.xls` and `.rtf` were not in the pilot sample and stay [ASSUMED] convertible.
  Do not route `.doc` through `lib/utils/file-loader.js`: its `.doc` branch
  hands binary Word files to mammoth, which reads only `.docx`.
- Spreadsheets: extract the cells as text (exceljs).
- Recordings: not extracted; their transcripts stand in. In the 2026 created-year
  run all 24 requests with an MP4 also have at least one transcript file; a
  recording without one is flagged rather than transcribed.
- Scanned PDFs without a text layer: flagged `needs-ocr`, not processed in the
  first pass. The pilot found about a quarter of PDFs in this state, plus some
  with a poor OCR layer, so a text-quality score is recorded too (section 2b).

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
   Read-priority types; measure missed Read documents among rule-matched
   samples (section 2); and discover recurring templates per era, then test
   whether their signatures classify and split documents reliably after
   conversion. A model may classify content through
   `lib/services/llm-client.js`. Pilot output, including extracted text, goes to
   the owner's OneDrive Shuttle folder (owner-approved for the pilot). Results
   come back to the owner before any scale-up; the full run needs a further
   approval.
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
3. **Visibility: the app's request restrictions are authoritative.** Request
   restrictions and SharePoint permissions are different systems: SharePoint
   access to the akoyaGO site is broader (a Public Microsoft 365 group with
   Members holding Edit, per the IT capture recorded in
   docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md). So extracted text and index rows
   are visible only to users the app's Dynamics request restriction context
   allows, enforced server-side and fail-closed for **every** consumer:
   browsing, search, text download, export and AI context selection. Tests for
   a denied request and for access revocation are required before any consumer
   is enabled. The pilot's local output in the owner's Shuttle folder is the one
   owner-approved exception.
4. **History gaps:** count pre-1990 Research requests and Research requests with
   no meeting date (read-only), then decide whether to include them.
   Counted 2026-10-25 [VERIFIED via `scripts/probe-research-history-gaps.mjs`,
   Production read run by the owner; aggregates only]:
   - **Meeting date before 1990:** 357 requests, none test (MR 171, S&E 186);
     meeting years 1974–1989, 312 of them 1983–1989; all `createdon` 2023;
     statuses mostly Closed (187) and declined/denied (136).
   - **No meeting date:** 46 requests, none test (MR 31, S&E 15); all `createdon`
     2023; statuses mostly Denied (23) and Phase I Ineligible (9), 2 Pending.
   Together 403 requests, about 4% of the 9,001 inventoried. Their file counts
   are unknown until they are listed. Whether to include them is still open.
5. **Reading scope:** read science proposal documents, reviews, interim and
   final reports, and staff writeups. Budgets, biosketches and administrative
   documents (no-cost extensions, budget reallocations, emails) are typed but
   not read. Site Visit transcripts and summaries and staff discussion
   summaries are already legible (section 1, reading priority).

## Likely future direction (not decided)

The owner expects the corpus will eventually write new folders into request
folders in SharePoint. If so, a sweep for requests that lack that folder (or
an index row) catches **skipped requests**. It does not catch a request
processed against the wrong library, which would still receive a folder; the
strict parent-library check covers that case. Writing into request folders
goes through the governed SharePoint path (target registry, interlock) and
needs its own design before it is built.

## Not in scope

Renaming, moving, deleting or re-permissioning any existing SharePoint file; changing
GOapply or AkoyaGO folder conventions; writing `wmkf_requestdocument`; programs
outside `RESEARCH_PROGRAM_IDS`.
