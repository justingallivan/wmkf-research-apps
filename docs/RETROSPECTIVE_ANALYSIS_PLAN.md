---
title: "Retrospective Analysis — Long-Term Plan"
domain: docs-governance
kind: audit
status: historical
summary: "Historical design: record export and file indexing exist; a joined document-selection, custom-prompt batch and structured-results workflow remains open."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/utils/sharepoint-buckets.js
  - docs/WORKFLOW_CHAINING_DESIGN.md
  - docs/PDF_INPUT_FOR_BACKEND.md
  - docs/PROMPT_STORAGE_DESIGN.md
---

# Retrospective Analysis — Historical Plan and Current State

**Created:** 2026-04-22 (Session 106, from Connor + Justin conversation)
**Status:** Historical design snapshot (2026-04-22). The statement “no code yet” described that date only and is superseded in part by the current-state record below.

## Current state (verified from repository source, 2026-10-31)

Two related building blocks now exist, but neither implements the full retrospective analysis workflow:

- **Dataverse Bulk Export is shipped.** The `dataverse-bulk-export` app lets staff filter request records, preview the result set, confirm the run, and download an Excel workbook (`shared/config/appRegistry.js`; `pages/dataverse-bulk-export.js`; `pages/api/dataverse-export/preview.js`; `pages/api/dataverse-export/run.js`). It exports request data; it does not select and supply SharePoint documents to an AI analysis or export structured model results.
- **The Research request-file metadata index is shipped and loaded.** The owner-run index covers Research requests from the 2018 meeting year, stores file metadata/classification, and has no staff UI or route consumer. Its approved build explicitly excludes text extraction and model calls (`docs/plans/RESEARCH_REQUEST_FILE_CORPUS_INDEX_BUILD_PLAN_2026-10-25.md`, especially “Scope” and “First Production load”).
- **The requested end-to-end workflow remains open:** there is no verified staff workflow joining historical request selection, attached-document retrieval, a user-selected/custom prompt, multi-request analysis, and a structured analysis-results workbook. Existing batch summary pages use uploaded PDFs and fixed app prompts, with PDF/Markdown exports (`pages/batch-phase-i-summaries.js`, `pages/batch-proposal-summaries.js`).

This is a repository-source assessment only; no live database, SharePoint, or deployment probe was run. It establishes the named components and their checked-in contracts, not external runtime availability.

## Purpose

Define how we handle *bespoke, retrospective* analyses of historical grant data (e.g. "how did Phase I proposals in 2022–2024 address AI?") and distinguish them from the recurring backend-automation work Connor is building in PowerAutomate.

## The dividing line

PA and the existing web apps cover different regimes. Neither should grow to cover both.

|  | **PA (backend automation)** | **Our web apps** |
|---|---|---|
| Cadence | Recurring — every submission, every cycle | One-off — ad hoc research question |
| Trigger | Event-driven (Dataverse status changes, new records) | Human-initiated (staff opens the app) |
| Scope per run | Single request | Tens to hundreds of requests in one session |
| Writeback | Auto to Dynamics fields | Display/download for a human; usually no writeback |
| Cost regime | Synchronous `/v1/messages` (list pricing) | Async-capable (Batch API for cost and reliability) |
| Prompt lifecycle | Stable across cycles, versioned in `wmkf_ai_prompt` | May be bespoke per analysis; some worth promoting to the table |

**Implication:** don't build a PA flow every time a staff member has a research question. Keep ad hoc workloads in the web apps and invest in making those apps better at the retrospective regime.

## Historical design gaps and their current status

A retrospective analysis looks like: *"Pick 200 proposals from 3 historical cycles matching criterion X. Apply prompt P. Get structured results back as a spreadsheet."* The 2026-04-22 plan identified four gaps. Their status below distinguishes later partial building blocks from the still-missing end-to-end capability.

### 1. Historical-request picker
**Still open for document analysis; partly superseded for record export.** Dataverse Bulk Export now provides a filtered, previewed request-record export, and the Research request-file corpus indexes metadata for Research request files from 2018 onward. Neither provides an analysis UI that selects a request cohort and automatically supplies its SharePoint PDFs to a model. The batch summary apps still require manual uploads. The earlier blanket claim that no historical request-set/export surface exists is stale; the narrower document-to-analysis gap remains.

**Historical shape:** a reusable component that queries Dynamics, resolves SharePoint buckets, and supplies PDFs to an analysis app. The metadata index is a new source for file discovery, but no such staff-facing component is verified as built.

### 2. Bring-your-own-prompt batch app
**Open.** Today's batch apps (`batch-phase-i-summaries`, `batch-proposal-summaries`) are hardwired to specific prompts. No generic historical-cohort runner with a prompt picker or custom prompt editor is verified in the checked-in UI/routes.

**Historical shape:** staff picks a prompt (from `wmkf_ai_prompt` or an ad hoc editor), picks a request set, runs a job, and downloads results. No approval or input contract for this surface is established by this historical plan.

### 3. Batch API integration
**Not verified as built for this workflow.** The historical plan proposed Anthropic Batch API integration for large proposal sets. The bounded source review found no Batch API submission/polling/reconciliation path connected to these batch apps. This statement is not a fresh provider-feature or pricing assessment.

**Historical shape:** route larger jobs to an asynchronous provider batch, persist request-to-result mapping, and reconcile completions. Threshold, persistence, and polling design remain undecided; this plan does not approve them.

### 4. Structured-results export
**Open for model results.** Dataverse Bulk Export creates an Excel workbook of request records, but no checked-in app was found that exports structured model-extracted fields across an analysis batch.

**Historical shape:** export structured model results from the eventual runner. The Bulk Export workbook is a separate request-data capability and does not close this gap.

## Historical sequencing proposal (not current direction)

The original plan proposed this order. It is preserved as historical context, not an approved implementation sequence:

1. **Gap 1 — Historical-request picker.** Standalone UI, testable immediately against current Dynamics data, drops into any existing app. Unlocks every downstream step.
2. **Gap 3 — Batch API integration.** Retrofit `batch-phase-i-summaries` and `batch-proposal-summaries` to optionally route to Batch API. Cost-saving win even before gap 2 ships. Also shakes out the async / polling / reconciliation infrastructure we'll need.
3. **Gap 2 — Bring-your-own-prompt batch app.** Build once the picker and Batch API plumbing exist. This is also the first app that reads non-hardwired prompts from `wmkf_ai_prompt` on the user-facing side, so it validates the storage layer under real usage.
4. **Gap 4 — Structured-results export.** Add alongside gap 2; they're the same UI surface.

## Historical relationship to prompt storage

The original proposal suggested `wmkf_ai_prompt` (see `docs/PROMPT_STORAGE_DESIGN.md`) for retrospective prompts. No product decision in this document establishes that storage choice. The two proposed subcategories were:

- **Published retrospective prompts** — the analysis has been run once, validated, and the prompt is worth keeping for future repeats. Lives in the main table, discoverable in a prompt picker.
- **Ad hoc / scratch prompts** — one-off experiments. Either don't persist, or persist with a `status: 'draft'` and an author scope, so the picker doesn't show them to everyone.

The `wmkf_ai_promptoutputschema` field becomes especially important here — it's how the generic batch runner knows what columns to put in the exported spreadsheet.

## Historical cost illustration (informal; not revalidated)

Example: retrospective analysis across 300 historical Phase I proposals, ~1 stable prompt, Sonnet 4.6.

| Path | Per-proposal cost | Total |
|---|---:|---:|
| Synchronous, naive (current) | ~$0.13 | ~$40 |
| Synchronous + system-prompt cache (after padding system > 2048 tok) | ~$0.10 | ~$30 |
| **Batch API, list pricing** | ~$0.065 | **~$20** |
| **Batch API + system-prompt cache** | ~$0.055 | **~$17** |

Small absolute dollars, but the reliability and 24-hour-SLA gains matter more than the cost cut — large synchronous loops are brittle.

## Open questions

1. **Threshold for Batch vs. synchronous routing.** 50 proposals? 20? Staff preference will drive this — batch means "check back later," synchronous means "watch a progress bar."
2. **Who runs retrospectives?** If only a few senior staff, app UX can assume power-user comfort. If it opens up broadly, picker + prompt-editor UX needs to be more guarded.
3. **Is a `wmkf_batch_run` table worth it?** Parallel to `wmkf_ai_run` but scoped to multi-request jobs: batch_id, status, request_count, prompt ref, audit trail. Probably yes, but only when gap 3 ships.
4. **Do retrospective prompts ever get promoted to PA flows?** If a retrospective surfaces a recurring question (e.g. "flag any proposal claiming novel AI use"), do we migrate the prompt into the backend automation? Mechanism TBD.

## Not in scope for this plan

- Real-time dashboards / embedded analytics (Power BI territory)
- Cross-foundation benchmarking (separate data-sharing problem)
- Anything that requires modifying proposal source documents

## Related docs

- `docs/BACKEND_AUTOMATION_PLAN.md` — the PA side of the split
- `docs/PROMPT_STORAGE_DESIGN.md` — prompt table schema + versioning
- `docs/WORKFLOW_CHAINING_DESIGN.md` — output schema pattern that the generic batch runner consumes
- `docs/PDF_INPUT_FOR_BACKEND.md` — Batch API details captured under "Future batch-analysis regime"
