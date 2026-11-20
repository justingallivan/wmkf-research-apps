---
title: App suite retirement and capability preservation — November 19, 2026
domain: architecture
kind: plan
status: active
summary: "Ten standalone interfaces retired in Production; reusable capabilities, prompts, shared dependencies and history preserved. Includes CI, deployment, smoke and rollback receipts."
canonical: false
cataloged: 2026-11-19
owner: product-engineering
related:
  - shared/config/appRegistry.js
  - docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/AI_DATA_FLOW_MATRIX.md
  - docs/atlas/dataverse-wmkf-ai-run-and-prompt.md
---

# App suite retirement and capability preservation

## Decision and boundary

[VERIFIED — owner decision, 2026-11-19] Retire the ten standalone applications
listed below. Preserve their useful capabilities and stored prompt definitions,
including Grant Reporting's proposal-versus-report assessment and editing flow.
Expense Reporter remains active. Expertise Finder belongs to a separate workstream
and is not modified by this retirement.

[VERIFIED — owner decision, 2026-11-20] The preserved Grant Reporting and Literature
Analyzer capabilities are archived with no app destination. Report assessment is
expected as an expanded capability inside the automatic flows and will be designed
fresh; uploaded-paper analysis is not planned. No code was moved and no data changed.

The source change replaces the pages with retirement notices and the thirteen
processing/lookup API routes with authenticated HTTP 410 responses. Each API keeps
its previous accepted app-grant set and method boundary. Old page and API
implementations are retained under matching `_archived/pages/` paths as reference;
their original relative imports are not rewritten into a runnable archive app.
The active route files remain present, so route counts do not drop. Application
registry membership changes independently of those counts.

**Verification boundary:** source preservation and Production receipts are
recorded separately below. Passing tests do not establish external flow behavior. No live prompt/data mutation is part of this
change. Repo caller searches cannot prove the absence of bookmarks or external
Power Automate/HTTP clients; authenticated 410 responses make retirement explicit.

## Entry-point manifest

| Retired application | Page | Old processing paths retained as retirement responses |
|---|---|---|
| Batch Phase I Summaries | `/batch-phase-i-summaries` | `/api/process-phase-i` |
| Batch Phase II Summaries | `/batch-proposal-summaries` | `/api/process` (shared with Phase II writeup) |
| Create Phase I Writeup Draft | `/phase-i-writeup` | `/api/process-phase-i-writeup` |
| Create Phase II Writeup Draft | `/phase-ii-writeup` | `/api/process`, `/api/qa`, `/api/refine` |
| Phase I Dynamics | `/phase-i-dynamics` | `/api/phase-i-dynamics/summarize`, `/api/phase-i-dynamics/summarize-v2` |
| Multi-Perspective Evaluator | `/multi-perspective-evaluator` | `/api/evaluate-multi-perspective` |
| Funding Analysis | `/funding-gap-analyzer` | `/api/analyze-funding-gap` |
| Summarize Peer Reviews | `/peer-review-summarizer` | `/api/process-peer-reviews` |
| Grant Reporting | `/grant-reporting` | `/api/grant-reporting/lookup-grant`, `/api/grant-reporting/extract` |
| Literature Analyzer | `/literature-analyzer` | `/api/analyze-literature` |

The Grant Reporting lookup API previously also served Phase I Dynamics. Both
pages are in this retirement, so that caller is retired in the same change.
Do not generalize this result to the retained lookup service or its shared helpers.

## Capability and dependency preservation

| Capability / asset | Preserved source | Reason / consumer |
|---|---|---|
| Grant report assessment/regeneration; historical extraction | `lib/services/grant-reporting/extract-service.js`; `shared/config/prompts/grant-reporting.js`; `shared/config/grant-reporting-output-schema.js` | Assessment/regeneration is preserved for reuse; the old extraction workflow is reference only, not a future requirement |
| Grant report assessment editing; historical Word export | `_archived/pages/grant-reporting.js`; `shared/utils/grant-report-word-export.js` | Preserves editable assessment, staff changes and counts/narratives for reuse; Word export is obsolete reference only, not a future requirement |
| Request/document lookup and classification | `lib/services/grant-reporting/lookup-grant-service.js`; `lib/services/grant-reporting/classify-file.js`; `lib/utils/sharepoint-buckets.js` | Workbench proposal loading imports `classifyFile`; shared SharePoint discovery remains live |
| Phase I code and stored-prompt summaries | `lib/services/phase-i-dynamics/`; `shared/config/prompts/phase-i-summaries.js`; stored `phase-i.summary` row | Existing writeback/A7/audit contracts retained as reference; no active standalone route invokes them |
| Phase I/II summaries, extraction, refinement, Q&A | `shared/config/prompts/phase-i-writeup.js`, `proposal-summarizer.js`, `phase-ii-dynamics.js`; original archived routes | Preserves templates and parsing/export behavior without retaining executable endpoints |
| Peer-review upload synthesis/questions | `shared/config/prompts/peer-reviewer.js`, `peer-reviewer-dynamics.js`; archived page/route | Separate from active Workbench `review-synthesis.generate` |
| Multi-perspective, federal funding, paper analysis | Corresponding `shared/config/prompts/*-dynamics.js`, output schemas, `lib/fundingApis.js`, archived pages/routes | Preserves prompt contracts and capability code for a separately reviewed future home |
| Scholarly discovery services | PubMed/OpenAlex and discovery/cycle-dossier callers | Live consumers remain; do not delete by association with Literature Analyzer |
| Shared uploader and file processing | `shared/components/FileUploaderSimple.js`, `/api/upload-handler`, `shared/api/handlers/fileProcessor.js` | Expense Reporter and other surviving apps still use them |
| Shared AI infrastructure | `tool-prompt-resolver`, `tool-prompt-composer`, `execute-prompt`, `llm-client`, payload boundaries, schemas, rate limiting, usage logger | Surviving app/backend consumers; Expense Reporter still resolves stored tool prompts |
| Common document/export utilities | PDF/Word helpers, parsers, components and libraries | Preserved; package deletion requires a separate consumer audit |

All prompt modules and existing service/helper files remain in place. The archive
contains the old entry-point code, not a replacement dependency tree. Twenty-one obsolete
interface test files are archived under matching `_archived/tests/` paths; shared
prompt/service tests stay executable. Partial mixed-app test references may also
be retained in the archive, without treating the whole mixed suite as retired. No broad
package cleanup, helper extraction, route renaming, or model-contract change is
included.

## Durable data boundary

- Existing app grants and usage history remain. Retirement blocks execution at
  the entry point; it does not purge identities or historical records.
- `wmkf_ai_prompt` rows and versions remain published/stored as they were. Source
  app lifecycle and prompt publication are separate facts. The read-only
  pre-retirement Production metadata inventory found the six `multi-perspective.*`,
  two `funding-gap.*`, three `literature-analyzer.*`, and two
  `peer-review-summarizer.*` current rows at version 1; Expense Reporter's two
  version-1 rows were outside the mutation scope. This metadata observation does
  not verify prompt-body parity or external consumers.
- Admin catalog caller descriptions identify the retired interfaces, but their
  original `application` usage fallback remains: Admin uses that category to
  block prompt retirement when a stored row has no usage metadata. Interface
  retirement does not authorize unpublishing these preserved prompts.
- Existing `wmkf_ai_run` records, `api_usage_log` entries, request summary fields,
  Blob uploads, SharePoint documents, and exported reports remain untouched.
- Grant Reporting's retained service has no save-to-request implementation for
  Field Set B. Its best-effort AI-run raw output may be the only durable copy of
  a generated report assessment. Do not delete or hash historical outputs as an
  incidental cleanup.
- No database migration, field drop, prompt unpublish, grant purge, or Blob cleanup
  follows from this retirement.

## Sweep and verification record

Mode A changed fact: standalone page/API execution becomes retired while reusable
capabilities and data remain. Authoritative evidence is the page/route diff,
`APP_REGISTRY`/`APP_LIFECYCLE_REGISTRY`, caller searches, retained helper imports,
and focused retirement tests. Durable surfaces include app lifecycle guidance,
route/data-flow catalogues, Atlas producer descriptions, and active app memories.
Historical migration/audit records retain a visible historical boundary.

Required falsification checks before completion:

1. Every retired route rejects unauthenticated/unauthorized access before HTTP 410,
   retains its old grant set, and cannot invoke the archived implementation.
2. All ten pages show retirement; none submits processing requests.
3. Expense Reporter remains registered and its upload/prompt-processing contract
   passes. Workbench proposal classification and scholarly discovery remain usable.
4. Archive copies preserve the old page/route bytes, including Grant Reporting's
   assessment editor. Prompt/service executable logic and live stored data are
   unchanged; source headers describe the retirement.
5. Route coverage, lifecycle, A7, docs/Atlas, counts, and relevant tests pass; each
   gate and its self-test run sequentially.

### Branch verification — 2026-11-19

[VERIFIED via local commands and independent source review]

- Branch: `codex/app-suite-cleanup-2026-11-19`, based on `09041225a` (the other
  workstream's Expertise Finder retirement). Expense Reporter and Expertise Finder
  runtime files have no diff in this branch.
- Focused regression: 32 Jest suites, 907 tests passed. Coverage includes ten
  notice pages, thirteen retirement endpoints, auth/method fall-through, Expense
  Reporter processing, preserved Grant Reporting services, prompt parity,
  Workbench proposal loading, and app-access administration.
- The thirteen edited service/prompt modules have identical executable Babel
  ASTs to the base revision after comments/location metadata are excluded; edits
  there only correct source headers.
- Production build passed. Full ESLint passed with zero errors and 213 warnings.
- All 47 new archive copies match their originals in `09041225a` byte-for-byte:
  ten pages, thirteen routes, twenty-one obsolete interface test files, one mixed
  test reference copy, and two legacy maintenance probes.
- The two old impersonation sentinel probes are disabled before credential loading:
  their restoration instructions depended on the retired Phase I page. Original
  scripts are archived. Local invocation exits 1 without data operations.
- Independent review confirmed the prior route grant sets, no surviving in-repo
  application callers of retired endpoints, preserved assessment/editor logic,
  and untouched Expense Reporter/shared classifier. Both review findings were
  corrected and rechecked.
- All 72 repository checks/self-tests passed across the final run and targeted
  reruns. The first run exposed the generated app count and transition-register
  citations; both were reconciled and their gates/self-tests passed. The register
  keeps five pre-existing unverifiable entries; none is a new failure here.
- Active-file whitespace checks pass. Byte-for-byte archived copies deliberately
  retain inherited whitespace from the original implementations.

Contract audit: the active flow is notice rendering or method/auth check → 410;
there is no processing, streaming, persistence, or partial-success path after
access authorization. Authentication still performs its normal account/grant
reads. No schema or background-work changes are introduced. The shared notice
component only renders its supplied name and Home link; it imports no archived
code. Existing grants and historical data remain available to their existing
readers. Future capability adaptation and external backend behavior are separate
work, not outcomes claimed by these tests.

The first full CI run passed 1,566 suites and found one prompt-retirement
regression: changing the catalog usage category weakened its blank-metadata
retirement guard. The original protection was restored for all fourteen affected
prompt names and covered with parameterized no-write tests. The correction passed
217 focused tests and independent review. Final CI on `274bfb72f` passed 1,567
Jest suites / 28,277 tests (27 suites / 335 tests skipped); the separate Postgres
job passed 15 suites / 189 tests. All PR checks were green before merging.
CI run: https://github.com/justingallivan/wmkf-research-apps/actions/runs/44666491019.

### Production release receipt and rollback

[VERIFIED via owner approval, GitHub merge, Vercel deployment metadata and signed-in
Chrome smoke, 2026-11-19 Pacific / 2026-11-20 UTC]

- Owner explicitly approved “Merge and deploy after CI passes.” This satisfies
  the Tier 2 promotion decision in the campaign release strategy.
- PR #651 merged at 2026-11-20 03:24:12 UTC as
  `ce4bc2618555a6b6a4196ff93c2b10f89de7b388`.
- Production deployment `dpl_2KcHR8Gd5vEUE9hxFBmd92mtNDBx` reached **READY** at
  `https://wmkfresearchapps-bwj9ogkby-justin-gallivans-projects.vercel.app` and
  received the `applications.wmkeck.org` production alias. Vercel list metadata
  linked that deployment to the merge SHA.
- Signed-in staff smoke: Home shows eight active applications; all ten manifest
  pages show retirement notices and Home links; Expense Reporter displays its
  receipt-upload controls; Workbench D26 loads request data. No receipts were
  uploaded and no model generation or lifecycle writes were exercised.
- Anonymous GET and POST requests to all thirteen retired API URLs returned 307
  to the application sign-in route at the proxy. They did not reach the route
  handler. Authenticated 410 / method 405 behavior is covered by automated tests,
  not claimed as a live authenticated API probe.
- A deployment-specific runtime log query (`level:error`, preceding ten minutes,
  limit 30) returned no error entries. This is a bounded release check, not an
  assertion about all historical errors or monitoring configuration.

**Last known good:** `442f9018f550a2155d17c10b0e5ce68ae82a477f`, deployment
`dpl_8eJC42giXbHvEbhJsLPGVMUckepj`,
`https://wmkfresearchapps-gofmf2qkt-justin-gallivans-projects.vercel.app`. It was
recorded READY with the production alias before the retirement merge. The owner
or authorized release operator can restore that deployment with
`vercel rollback <last-known-good-url> --scope justin-gallivans-projects`, then
revert the retirement source through the normal release path. No rollback was
needed or executed.

No database migration, stored prompt edit, grant purge, or data cleanup is needed
to undo this source change. No such operation ran during the release. The archive
is reference material; do not run it as a second app tree. Future Dataverse
adaptation of preserved capabilities remains separate work.
