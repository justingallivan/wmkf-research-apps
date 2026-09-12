---
title: Cycle Dossier Pilot Design
domain: cycle-dossier
kind: plan
status: active
summary: "D26 private Cycle Dossier pilot design and branch-local implementation status."
canonical: true
cataloged: 2026-09-07
owner: product-engineering
last_verified: 2026-09-08
related:
  - docs/atlas/postgres-cycle-dossiers.md
  - docs/EXECUTOR_CONTRACT.md
  - docs/CREDENTIALS_RUNBOOK.md
  - lib/services/cycle-dossier-generation.js
  - lib/services/cycle-dossier-documents.js
---

# Cycle Dossier Pilot Design

## Decision and scope

The D26 Cycle Dossier is a private superuser workflow for preparing scientific briefings from the Workbench D26 candidate set. A successful eligible request entry is reusable by any superuser; the dossier selection, run, and edition remain private to their owner. The pilot excludes Set Aside requests and retains the Workbench's server-owned cycle, eligibility, and program-director visibility rules.

The roster is scoped server-side to the Workbench default program (Research) through the shared program-scope resolver; the page renders no program selector and the route accepts no program input. The prompts are research-specific, so a request tagged into the D26 cycle under another program is omitted by design rather than shown. `buildDossierRosterFilter` in `lib/services/cycle-dossier-rollout.js` is the single roster predicate used by both `loadDossierRoster` and the rollout preflight, so the preflight proves the list the pilot loads. Adding a selectable program later means a program-specific prompt family plus passing a program id into the same resolver (owner decision 2026-09-08).

Owner decisions: every candidate initially selected, with persistent manual exclusions for test requests; the roster size is not hard-coded (44 on 2026-09-07; 23 on 2026-09-08, all Research, after the owner set the remaining requests, including the test copies, to Set Aside, which the pilot excludes by design). Target 2–3 pages plus references for a PD with a PhD in an unrelated scientific field. Reuse the newest successful request entry from any superuser and selectively rewrite others. Individual Word/PDF files belong in each request's AI Artifacts folder; combined, PD-grouped editions are private to the dossier owner. Preserve editions, publish partial results, and retry failures. Peer reviews and staff notes are excluded from source collection.

Each entry has five sections: Project at a glance, Why it matters, The field around it, Background for an outside-field scientist, and References. Proposal claims, retrieved external evidence, interpretation, and uncertainty remain distinct in the generated content. References are limited to source IDs returned by the bounded research stage.

## Source and generation contract

prepareRequestInput(requestId) resolves the exact active AI Materials/ProposalNarrative_{Request#}.pdf through the existing strict resolver and freezes SharePoint site/drive/item/version identity, raw-byte hash, extracted text, request identity, and bounded allowlisted AI context. Source text over the supported context bound fails closed.

snapshotConfiguration() captures the full published rows for cycle-dossier.research-plan and cycle-dossier.entry, including prompt identity/version, concrete model, temperature, token budget, variable declarations, and output schema. The seeded input/output contracts are fixed: the Admin may edit prose, a concrete Claude model, temperature, and token limits, while generation rejects changes to declared variables, their A7 boundary metadata, or the output schema. executePrompt accepts this historical row only through its guarded promptSnapshot input; existing callers continue resolving the sole current row. Dossier stages use pass-through outputs and perform no request writeback.

Every dossier source variable is marked untrusted and is wrapped by the Executor's A7 payload boundary before interpolation, with the declared character and data-class limits retained in the frozen prompt snapshot. No client-supplied variable names or prompt fragments are accepted. Literature lookups are bounded per query and receive an `AbortSignal.timeout()` deadline, so a slow OpenAlex or PubMed response cannot run past the worker stage lease.

generateResearch() makes one bounded research-plan call, then bounded OpenAlex and PubMed searches. It retains source IDs, titles, URLs, retrieval times, and adequate abstract context; adapter failures, no-result sources, and partial coverage are disclosed. If no adequate source context remains, the stage fails closed. generateEntry() uses only the frozen narrative and retained evidence, validates the five required sections, rejects unknown references, and returns an immutable payload with usage and provenance.

estimateGenerationCost() returns a conservative low/high dollar estimate when the pinned model pricing is known, using the captured rates, UTF-8 byte ceilings, prompt and payload overhead, JSON/A7 wrapper overhead, every repeated variable interpolation, cache-write pricing, and configured output ceilings. The high bound assumes five provider attempts for each paid stage (the LLM transport retry/correction ceiling, with no fallback model). Unknown pricing remains unknown. A caller must reserve the entire high bound once and retain an ambiguous charge.

## Document and state contract

renderDossierDocuments(manifest) renders Word and PDF directly from frozen payloads. Individual request documents and combined PD-grouped editions share the same canonical entry data. Word preserves scientific Unicode and provides linked references/page numbers; PDF uses readable transliterations for symbols unsupported by its standard font and states that rule visibly. Rendering has no LLM, network, Blob, or database side effect.

The six Postgres tables are documented in docs/atlas/postgres-cycle-dossiers.md. JSONB stores bounded previews, immutable entry revisions, one global run lease with independently checkpointed items, a durable operator stop, and private edition metadata. The dedicated private Blob store owns bytes and accepts only create-only exact pathnames with SHA-256/size verification. Retries create a new run budget while preserving prior charges. Published SharePoint copies are verified against the frozen bytes before the item is recorded: PDFs must match exactly; DOCX packages are compared by their decompressed `word/` parts, with relationship parts compared as order-independent attribute sets that ignore customXml links, because SharePoint Online rewrites `docProps/`, `customXml/`, package rels, and content types on upload, appends customXml relationships to `word/_rels/document.xml.rels`, and leaves `[trash]/NNNN.dat` packaging slots (document property promotion; observed on the first production smoke, 2026-09-12). A mismatch logs the differing part names. The item record keeps the frozen `sha256`/`size` and the observed `publishedSha256`/`publishedSize`.

## Branch-local implementation status

**[VERIFIED 2026-09-07 via source, focused tests, and controlled setup]** The generation/document modules, guarded historical prompt support, prompt seed definitions, prompt seeder, six-table migration, setup-database fresh-install shape, API routes, worker/service/store, and UI are source-built on branch codex/cycle-dossier-pilot-build. Migration 045 is applied and verified; the private store `wmkf-cycle-dossier-private` (`store_W9WC1TLR7kpl9hty`) is connected under the custom `DOSSIER_BLOB` prefix in all environments, with the managed token authenticated in Development. Focused generation/document/Executor tests and targeted lint pass in the local checkout.

**[VERIFIED 2026-09-07 via governed publication and readback]** Both prompt families are published at version 1 and read back successfully. No paid generation call was made.

**[VERIFIED 2026-09-07 via local validation]** Sol approved the generation and UI contracts. The focused Dossier/Executor suite passes 140 tests in 16 suites; production build, scoped ESLint, types, migration, Atlas, route/security, prompt-boundary, and documentation gates pass. The browser rehearsal exercises 44 synthetic candidates, two retained exclusions, selective rewrites, partial editions, retry, and mobile layout without unknown API calls or console errors. The document rehearsal renders 1,270-word synthetic entries to three pages per individual document and six pages per combined document in both formats, with visible citations, PD boundaries, and no clipping. These fixtures do not establish live service integration.

**[VERIFIED 2026-09-07 via controlled rollout state]** The feature remains disabled. No Cycle Dossier generation, SharePoint artifact publication, deployment, or promotion is claimed. Production and Preview token runtime authentication remains pending the rollout preflight.

**[VERIFIED 2026-09-07]** Migration 045, dedicated store setup, and governed prompt publication/readback are complete. `CYCLE_DOSSIER_ENABLED` remains disabled; no generation, SharePoint artifact publication, unattended cron processing, deployment, or promotion has occurred. Existing populated databases must use the governed migration process; do not run fresh-install setup against them.

## Controlled rollout remaining

1. Run the read-only rollout preflight to prove each environment's dedicated Blob token/store identity, schema/control row, prompt readback, roster, source, and destination; keep CYCLE_DOSSIER_ENABLED disabled during review.
2. Review the preflight evidence and authorize exactly one controlled request through generation, SharePoint publication, private downloads, and unattended recovery before cycle-wide use; the preflight's roster, source, destination, material-listing, and access checks must cover that request.
3. Promote through the Tier 2 release process and enable the worker with literal CYCLE_DOSSIER_ENABLED=true only in the approved environment. A user still launches each dossier after reviewing their inclusion list and budget.

The LLM estimate excludes storage/hosting costs and is a dispatch control rather than an exact provider-invoice promise. The pilot retains entries and editions; cleanup of expired previews and unreferenced temporary objects remains deferred. PD groups and their requests currently sort by name and request number; custom group ordering and native SharePoint-edit ingestion are outside this build.
