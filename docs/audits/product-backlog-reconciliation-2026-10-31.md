---
title: Product backlog reconciliation — 2026-10-31
domain: documentation
kind: audit
status: complete
summary: Bounded source and Git reconciliation of unfinished-product claims across plans, work queue, memory, wiki and Atlas; implementation remains separate from dated release evidence and open product decisions.
canonical: false
owner: product-engineering
last_verified: 2026-10-31
related:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/STRATEGY.md
  - docs/agent-wiki/topics/strategy-roadmap.md
---

# Product backlog reconciliation — 2026-10-31

## Scope and method

Sweep Mode B; contract-reconcile review of product-state claims. Baseline:
`f6376751db70fe344a15e5b7cb494b709967a867`. Three Luna agents inspected
source and Git history; the coordinating agent reviewed the combined edits.
Claude's separate main checkout was not edited. No runtime changes, live
queries, messages, migrations, model/provider calls, environment changes or
deployments were performed.

Claims: the eleven product threads proposed in chat, the three named shipped
features incorrectly carried as to-dos, and the proposal-context prerequisite
found while checking staged review. Source → persistence → consumer was traced
for the relevant existing building blocks. For absent end-to-end features,
bounded symbol, semantic, route, registry, migration and history searches were
used; a similar feature was not treated as the requested workflow.

Scope includes the owning plans, current work queue, strategy, related memory,
wiki retrieval pages, and Atlas/API/service descriptions repeating those facts.
Excluded: unrelated backlog items, provider-price validation, live external state,
archived evidence, and complete recertification of every statement in large
reference files. A dated receipt proves its recorded checkpoint, not today's
configuration. Product decisions and target dates cannot be proved by code.

## Evidence matrix

| Claim | Producer / persistence / consumer | Status and exact residual | Disconfirming check |
|---|---|---|---|
| J27 intake and staff triage | Existing `pages/api/workbench/triage.js` → `lib/services/workbench/triage-service.js` → `wmkf_triagestatus`; dashboard and Workbench request list consume old visibility state. | **PARTIAL.** Existing Advancing/Set aside is not the new J27 staff-state field, bulk workflow, flags, counts and First Cut output. November 15 is the recorded owner target, not proof of delivery. | Searched new state labels, First Cut, bulk entry points and feature history; no complete requested workflow found. |
| Research document corpus | `scripts/load-request-file-corpus.mjs` → listing/classification/index store → migration 090 `request_corpus_*` tables. No app-facing corpus consumer found. | **PARTIAL.** Metadata index implemented; dated owner load records 3,853 requests / 38,399 files. Scale text extraction, browsing/analyses, scheduled refresh and Dataverse promotion remain **PLANNED**, subject to their approvals. | Searched corpus references in pages/shared/lib/scripts; callers are loaders and offline/pilot tooling, not a browsing/text-analysis product. Pre-2018 remains parked. |
| Grant Reporting integration | Extract route → `lib/services/grant-reporting/extract-service.js` → UI editable result / Word export; best-effort `wmkf_ai_run` audit with request GUID. | **VERIFIED existing app; PLANNED rework / UNKNOWN destination.** Field Set B provisioned schema is not a save-to-request implementation. Owner's October 21 integration direction does not choose scope/timing. | Service explicitly says no save endpoint; newer Grant Reporting history changes Co-PI lookup, not integration/writeback. |
| Interim report evaluation | Existing report discovery and final-report goals comparison are reusable; corpus classifiers label interim documents. | **PLANNED / UNKNOWN contract.** No dedicated annual progress prompt, destination field, UI or writeback flow found. Real staff examples and product destination remain undecided. | Searched interim evaluation terms/routes/prompts and newer history; file classification is not evaluation. |
| Literature Analyzer reassessment | `pages/literature-analyzer.js` → `pages/api/analyze-literature.js` → paper extraction/synthesis → JSON/Markdown export. | **VERIFIED existing app; UNKNOWN reuse/disposition.** Shared prompt plumbing is modernized; no confirmed successor or retirement. | Active registry and real route/page disprove an unbuilt/removed-app interpretation; bounded reuse search did not prove another destination. |
| Historical portfolio analysis | Bulk Export page → filter/preview/run → request-record Excel output. Corpus supplies file metadata only. Legacy batch summary pages take uploaded PDFs/fixed prompts. | **PARTIAL.** Record selection/export and metadata indexing exist; no verified joined document-selection/custom-prompt/multi-request-analysis/structured-model-results-export product. | Read export run route and batch pages; record workbook and PDF/Markdown summary export do not implement structured analysis workbook. No connected provider Batch submit/poll/reconcile path found. |
| Consolidated cycle readiness | Calendar source/role/readers exist; proposed readiness producer, issue/delivery persistence and consolidated panel/digest consumers not found. | **PLANNED.** Consolidated view and role-routed daily exception notices remain open. | Searched readiness/digest routes/services; synthesis readiness and leadership digest are unrelated products. |
| Agenda inside existing calendar invitation | Meeting Tracker agenda generation → Dynamics email delivery; no organizing-calendar/event binding found. | **PLANNED / UNKNOWN access.** Duncan walkthrough and event ownership/permissions/update decisions remain prerequisites. | Searched current meeting/Graph call paths; agenda defaults and standalone email are not calendar mutation. |
| Program Chairs writeup / proposal sharing | Existing Executive Summary generation and Board SharePoint exports are foundations. Reviewer/grantee/briefing links have different audiences/contracts. | **PARTIAL.** Chairs content/review timing and proposal-sharing mechanism need current decisions/build scope. No Chairs-specific end-to-end feature established. | Compared existing artifacts and token services; none proves Chairs proposal-access delivery. |
| Faster presentation-video cuts | `lib/services/meeting-tracker-recordings/presentation-video-cut-script.js` still probes frame timestamps; existing worker persists cuts and approval. | **PLANNED optimization.** Packet-based checks not implemented. Dated first run was 40 minutes on 2 vCPUs; current Production allocation/timeout **UNKNOWN** without a probe. | Searched cut script and newer Git history for packet optimization. No fresh performance or configuration claim. |
| Full-proposal eligibility/staged pipeline | Concept eligibility in `pages/api/evaluate-multi-perspective.js`; separate successor Review Panel seats/chair; separate Cycle Dossier research generation. | **PARTIAL analogues; historical pipeline unimplemented.** No `pipeline_proposals`, Fit Screener or Proposal Pipeline runtime found. Current J27 scope must govern a new design. | Semantic and exact searches for stages/table/routes plus retirement history; limited concept flags and narrative-only panel are not the old staged workflow. |
| Zoom speaker picker branch-only to-do | Verified Zoom occurrence → attendance candidate formatting → transcription service DTO → `RecordingAndTranscriptCard.js` picker. | **STALE claim corrected: VERIFIED source on main** via #511 `bb7b5e04c`. Fresh hosted Zoom/staff acceptance remains unverified. | Merge ancestry and current producer/consumer source disprove branch-only status. Merge alone is not deployment proof. |
| Cycle calendar undeployed/unbuilt to-do | Operations Grant Cycle adapter → `lib/services/cycle-calendar-service.js` → calendar page/Admin; roles and audit attribution applied at server seam. | **STALE claim corrected: VERIFIED merged source**, #542 `e8fdcaa07`, attribution #543; dated release recorded in `d6aba6cb6`. No fresh live check. | Source/history disprove prototype-only status; separate readiness feature remains open. |
| Materials-on-acceptance unbuilt to-do | Acceptance job → `releaseMaterialsOnAcceptance` → shared release claim in migration 091 → mint/send → reviewer delivery markers and portal; manual send shares claim and recovery. | **STALE claim corrected: VERIFIED merged implementation** #562 `fcad0ad53`; dated schema/release evidence in Session657 and DEVELOPMENT_LOG. First natural J27 acceptance remains observation work; invitation wording and date-field retirement remain separately scoped. | Read automatic/manual claim and delivery paths; the approximately 15-minute preparation fallback is exception handling, not proof of manual-only delivery. #568 `166b808e2` adds fresh manual reviewer/ETag binding. |
| Expanded proposal-context extraction prerequisite | Existing `wmkf_ai_dataextract` read by Workbench and Cycle Dossier `priorAiContext`; Executor supports prompt-declared outputs. Successor Review Panel excludes it. | **PARTIAL.** Existing narrow field/consumers do not establish the historical A/B/C expanded schema or default downstream input contract. | Read `cycle-dossier-generation.js`, `review-panel-input.js` and Executor contract; corrected the overly broad absence claim and the universal-extract recommendation. |

Primary matrix classifications: **15 claims → 3 VERIFIED implemented features /
6 PARTIAL capabilities / 2 PLANNED features / 4 UNKNOWN product or external
contracts**. The three VERIFIED feature rows correct former STALE build claims;
partial rows name their remaining work rather than labeling whole products absent.

## Durable-surface reconciliation

- **STALE → corrected:** queue/wiki/manual-only materials claims; materials
  Atlas, service catalog, API matrix and register branch/build status;
  cycle-calendar and speaker-picker branch status; corpus inventory-only
  framing; Grant Reporting writeback descriptions; blanket missing historical
  selection/export premise; staged pipeline current-plan metadata and legacy
  panel dependency; universal proposal-context input recommendation.
- **AGREE → retained:** interim evaluation's unresolved destination/field/prompt;
  Grant Reporting and Literature owner decisions; Duncan walkthrough hold;
  video optimization versus current measurement limits; J27 staff-state and
  readiness feature gaps. Accurate memories were read and left unchanged.
- **HISTORICAL → retained within explicit boundaries:** dated audit reports,
  old roadmap snapshots, the original retrospective design, obsolete pipeline
  schemas/migration/provider/cost examples, and original rollout inventories.
  They do not establish current scope or execution authority.
- **UNRELATED → excluded:** other branches named with session-number 562,
  manual-video-pairing deployment status, unrelated reviewer repairs and broader
  parked programs. No bulk deletion, archiving or runtime cleanup was performed.

Current queue priority is unchanged. The queue and wiki now route to this
bounded inventory instead of treating every active plan as authorized backlog.
The current handoff is updated additively; concurrent work and its permissions
remain intact.

## Verification and limits

Parent review and two cross-owner Luna reviews corrected stale Board-calendar
restatements, overly broad extraction consumer/input descriptions, and unsupported
assertions that no natural J27 acceptance had occurred. The latter now state the
actual evidence limit: natural delivery was not verified.

The final affected checks passed: 19 gates and 15 paired self-tests, run
sequentially. Gates: agent invariants (local and CI), instruction architecture,
API route coverage, Atlas, document currency, fact consistency, canonical pointers,
docs catalog, drain-table mentions, prompt-storage mentions, document-symbol
references, build-claim freshness, memory router, agent wiki, harness framing,
J27 register, secret scan and scaffolding tokens. The catalog summary-length
failures and three stale J27 excerpt bindings discovered on the first pass were
corrected and the affected checks rerun. `git diff --check` passed. The J27 gate
reports 60 ok / 0 stale / 5 unverifiable / 14 closed; the five unresolvable entries
remain explicit, not silently certified. Its self-test retains listener warnings.

Repeated scoped stale-status searches found no remaining unqualified branch-only
or unbuilt claims for #511/#542/#561/#562 in the audited current surfaces.
Historical checkpoint reports remain visibly dated. Documentation gates cover
structure, references, registered facts and policy; they do not prove live
deployment, delivery or missing features outside the bounded searches above.
No runtime test/build was needed for this Markdown-only change.

Remaining unknowns: natural J27 acceptance delivery; current environment values;
corpus live load state beyond the dated receipt; calendar organizer access;
Chairs content/sharing scope; interim destination/examples; Grant Reporting and
Literature product decisions; current provider batch capabilities/costs.

Verdict: **bounded source/document reconciliation**, not a whole-repository or
live-system clean-state claim. The historical records retain their original
checkpoint meaning. No feature implementation is authorized by this report.
