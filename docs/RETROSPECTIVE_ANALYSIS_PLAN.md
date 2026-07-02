---
title: "Retrospective Analysis — Long-Term Plan"
domain: docs-governance
kind: audit
status: historical
summary: "Created: 2026-04-22 (Session 106, from Connor + Justin conversation) Status: Planning — no code yet."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/utils/sharepoint-buckets.js
  - docs/WORKFLOW_CHAINING_DESIGN.md
  - docs/PDF_INPUT_FOR_BACKEND.md
  - docs/PROMPT_STORAGE_DESIGN.md
---

# Retrospective Analysis — Long-Term Plan

**Created:** 2026-04-22 (Session 106, from Connor + Justin conversation)
**Status:** Planning — no code yet

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

## Gaps in the current web apps for retrospective work

A retrospective analysis looks like: *"Pick 200 proposals from 3 historical cycles matching criterion X. Apply prompt P. Get structured results back as a spreadsheet."* Today, no single app supports this end to end. The four gaps:

### 1. Historical-request picker
No app today lets you select a *set* of requests by cycle / year / program area / status and auto-pull their SharePoint PDFs. Our batch summary apps require manual uploads. This is the biggest friction point — staff can't run any retrospective without exporting from Dynamics by hand first.

**Shape when built:** a reusable component: query Dynamics with staff-friendly filters, resolve each request's SharePoint bucket via `lib/utils/sharepoint-buckets.js`, stream PDFs into whichever analysis app is running.

### 2. Bring-your-own-prompt batch app
Today's batch apps (`batch-phase-i-summaries`, `batch-proposal-summaries`) are hardwired to specific prompts. A generic "apply this prompt template to this set of proposals, return structured results" surface does not exist. Most retrospective questions need exactly that.

**Shape when built:** staff picks a prompt (from `wmkf_ai_prompt` or an ad hoc editor), picks a request set (gap 1), kicks off a job, downloads results. The prompt's `wmkf_ai_promptoutputschema` (see `docs/WORKFLOW_CHAINING_DESIGN.md`) drives the result columns.

### 3. Batch API integration
Existing batch apps call `/v1/messages` synchronously in a loop. For 100+ proposals that's fragile (timeouts, rate limits, partial-failure handling is crude) and full-price. Anthropic's Batch API (`/v1/messages/batches`) fixes both: async submit with a 24-hour SLA (often ~1 hour in practice), 50% off list, pattern-match JSONL results. Details captured in `docs/PDF_INPUT_FOR_BACKEND.md` under "Future batch-analysis regime."

**Shape when built:** for jobs above a threshold (~50 proposals?), route to Batch API; smaller jobs stay synchronous for immediacy. Poll status from a scheduled cron or a "check status" button. Store the `batch_id` + `custom_id → source_request` mapping in Postgres so results can be reconciled.

### 4. Structured-results export
No current app exports a CSV of extracted fields across a batch. For retrospective analyses, that's the primary deliverable — staff pastes into Excel or Power BI for downstream analysis.

**Shape when built:** whichever job runner produces structured results (gap 2 + 3) drops an `.xlsx` into Vercel Blob, returns a signed URL.

## Sequencing

Gaps depend on each other. Recommended order:

1. **Gap 1 — Historical-request picker.** Standalone UI, testable immediately against current Dynamics data, drops into any existing app. Unlocks every downstream step.
2. **Gap 3 — Batch API integration.** Retrofit `batch-phase-i-summaries` and `batch-proposal-summaries` to optionally route to Batch API. Cost-saving win even before gap 2 ships. Also shakes out the async / polling / reconciliation infrastructure we'll need.
3. **Gap 2 — Bring-your-own-prompt batch app.** Build once the picker and Batch API plumbing exist. This is also the first app that reads non-hardwired prompts from `wmkf_ai_prompt` on the user-facing side, so it validates the storage layer under real usage.
4. **Gap 4 — Structured-results export.** Add alongside gap 2; they're the same UI surface.

## Relationship to prompt storage

Retrospective prompts naturally live in `wmkf_ai_prompt` (see `docs/PROMPT_STORAGE_DESIGN.md`). Two subcategories to anticipate:

- **Published retrospective prompts** — the analysis has been run once, validated, and the prompt is worth keeping for future repeats. Lives in the main table, discoverable in a prompt picker.
- **Ad hoc / scratch prompts** — one-off experiments. Either don't persist, or persist with a `status: 'draft'` and an author scope, so the picker doesn't show them to everyone.

The `wmkf_ai_promptoutputschema` field becomes especially important here — it's how the generic batch runner knows what columns to put in the exported spreadsheet.

## Cost shape (informal)

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
