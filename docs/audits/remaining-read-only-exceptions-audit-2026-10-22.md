# Remaining read-only exceptions — 2026-10-22

> **Historical audit checkpoint.** The findings, authorization limits and test receipts below describe the earlier documentation-only batch. The later [autonomous cleanup ledger](autonomous-memory-cleanup-2026-10-22.md) owns current repair status, scoped live evidence and remaining actions; runtime repairs there remain local and unreleased. Original findings and historical context are retained below.

**Status: bounded source audit; CLAIM NOT RECONCILED for the whole class.**
Sol investigated and Luna repaired four memory/Atlas files. The parent reviewed
the edits and the cited source boundaries. Runtime code, owner decisions, live
systems, environments, worktrees and deployments are outside this repair batch.
The unrelated critique/output files and owner-review-burden note are untouched.

## Scope and authority

Sweep Mode B / contract-reconcile review. Entry points are external reviewer
context, reviewer email rendering/materials preflight, proposal loading/download,
IRS verification/refresh and Factory rechecks. Persistence includes Dataverse
first-access timestamps, Postgres counters/staging/audit rows and public Blob
cache objects. Consumers are the portal, staff proposal/attachment UI, analysis
services, reference-data callers and future agents reading these documents.
Source establishes built behavior; hosted configuration, traffic, populations,
refresh dates and external PowerAutomate consumers remain UNKNOWN. No live probe,
request, refresh, provider call or import was performed.

## Evidence matrix

| Claim / entry point | Persistence and consumer | Evidence and disconfirming check | Status |
|---|---|---|---|
| Reviewer action-query GET cannot accept or decline | Client action selects form; response requires explicit POST. Context GET can stamp Dataverse first access and update PG limiter state. | `pages/external/review/[token].js:51-77,177-187`; `pages/api/external/review/[token]/context.js:35-56`; `lib/services/external-review/context-service.js:90-115`; `lib/external/rate-limit.js:124-240`. Traced context beyond the pure view helper, falsifying universal no-mutation/scanner-harmless claims. | VERIFIED source; broad memory claim STALE |
| First-access stamping is exactly once | Presence check uses verifier snapshot; adapter PATCH itself is unconditional. ETag refresh follows stamp. | `lib/dataverse/adapters/reviewer-suggestion.js:1377-1380`. Two concurrent initial loads can both reach the PATCH; no compare-and-set/null predicate found at that write. Existing route tests cover first/returning visits, not this concurrency guarantee. | Exact-once guarantee NOT VERIFIED |
| Render email and materials preflight | Renderer uses non-live placeholder, with no token mint/business write found in the traced service. Preflight lists SharePoint metadata. Attachment hydration is a separate Blob-writing action. | `lib/services/review-manager/render-emails-service.js`; `lib/services/review-manager/materials-preflight-service.js:51-60`; `lib/external/reviewer-materials.js:70-115`; `shared/components/reviewers/ReleaseMaterialsModal.js:433-435`. The separate hydration call falsifies a whole-modal zero-write inference. | VERIFIED bounded source; no whole-modal exemption |
| Preflight proves send readiness | Listing catches bucket errors; zero files can reflect unavailable metadata. Release permits proceeding with confirmation. | `lib/external/reviewer-materials.js:70-103`; materials modal send-confirm region. No token/draft/write path found in preflight, but read success is not completeness proof. | Read-only metadata path; readiness guarantee NOT VERIFIED |
| Reviewer Finder load-proposal is read-only | Reads request/SharePoint; writes public Blob cache on miss. Reliable metadata hit can reuse URL; ordinary miss uses deterministic overwrite, size-race mismatch uses random suffix. UI automatically loads it for analysis or enabled attachment hydration. | `lib/services/reviewer-finder/load-proposal-service.js:104-305`, especially `:198-300`; `ReviewerFindPanel.js:163`; materials modal `:379,433-435`. Compared warm-hit and both put branches, falsifying guaranteed changing URL. | VERIFIED source; Atlas random-suffix claim STALE |
| Workbench proposal download shares those cache writes | Request-file membership validated, then Graph bytes streamed; no public Blob copy in this route. Shared private file loader is a separate bounded path. | `pages/api/workbench/download-proposal-document.js` and private-file-loader trace by Sol. No inference from the sibling load-proposal endpoint. | VERIFIED bounded download trace |
| IRS verify-EIN writes account results | `verifyEin` reads PG reference table; app does not perform account writeback here. PA ownership is the intended boundary, not proof an external flow is deployed. | `lib/services/irs-bmf-service.js`; `pages/api/irs/verify-ein.js`; local caller search found endpoint use, not external flow deployment. Route also has explicit development secret bypass. | VERIFIED source; deployed PA consumer UNKNOWN |
| IRS refresh dryRun is read-only | GET/POST refresh still downloads temporary files, creates schema/indexes if absent, rebuilds/populates/drops staging, and attempts maintenance audit/failure alerts. dryRun skips live-table swap only. | `pages/api/cron/refresh-irs-bmf.js:36-91`; `lib/services/irs-bmf-service.js:359-560`. Inspected operations before dryRun branch; no execution. | VERIFIED source; zero-write dry-run inference false |
| June IRS row/audit probe proves current dormant state | June 4 observation records 1,264,156 rows and zero recorded IRS audit runs then. Audit start can fail without preventing refresh; CLI does not write those audit rows. | `MaintenanceService.startRun`/`completeRun` in `lib/services/maintenance-service.js`; `scripts/import-irs-bmf.js:9-13`. Logging-failure and CLI paths falsify absolute never-executed inference. | Historical observation; present count/freshness/traffic UNKNOWN |
| Factory Foundation and status rechecks have identical read-only semantics | Foundation recheck reads ledger receipts and Dataverse, returns evaluation. Status recheck may append newly seen late-effect IDs to PG journal; no Dataverse write. | `lib/services/test-requests/admin-run-service.js:793-814,864-880`; `foundation-transition.js:390-397`; `status-change-runner.js:330-365`. Distinct methods and write-switch handling disconfirm interchangeable exemptions. | VERIFIED source; existing runbook/plan distinction AGREE |

## Restatement classification and repairs

- **STALE → repaired:** accept/decline memory's universal no-GET-mutation and
  scanner-harmless claims. Preserve the explicit POST decision boundary and
  historical upload/expiry contract.
- **STALE → repaired:** IRS memory/Atlas current-tense row count, dormant/never-run
  conclusions and claims of existing PA flows. Preserve June evidence, PA
  writeback ownership and owner hold on intake/cadence changes. Explain that
  refresh dryRun is a writing operation.
- **STALE → repaired:** roster Atlas guaranteed random-suffix/reload explanation.
  Preserve canonical suggestion-key cache identity and visibly dated August
  incident/owner-decision context.
- **AGREE:** API matrix context/proposal rows disclose limiter/first-access
  writes; load-proposal row discloses Blob writes. Renderer/preflight rows agree
  within their action-specific scope. These were excerpt checks, not a whole
  matrix certification. Reviewer engagement spec and capture-mode memory retain
  placeholder/no-mint distinctions. Factory runbook/plan distinguish rechecks.
- **HISTORICAL:** capture-mode render-time minting checkpoint, old expiry
  contract, June IRS probe and August roster incident. History is not present
  hosted-state proof.
- **UNRELATED:** UI disabled-editing labels and other dry-run tools. No universal
  side-effect claim is derived from those names.

## Prioritized remaining work

| Priority | Actionable item | Proposed fix / evidence needed |
|---|---|---|
| P1 documentation | IRS API matrix row still omits development secret bypass and describes PA writeback as existing behavior | Whole-read matrix, compare verify route bypass and intended ownership, then narrow row. Refresh row's atomic/live-table statement also needs dryRun/schema qualification. This first batch left the matrix unchanged; the [matrix/roster/export follow-up](matrix-roster-export-audit-2026-10-22.md) repairs these rows. The whole class remains CLAIM NOT RECONCILED. |
| P2 investigation | Finish remaining read-labelled exports/private-file helpers; resolve reviewer-roster mode contract disagreement | Trace each action independently through helper writes and consumer. Roster Atlas says no mode/snapshot contract while API matrix says cached/reconciled modes; establish direction from current route/service before editing. The follow-up resolves the roster disagreement against source; the wiki URL wording is a durability caution, not a universal random-suffix promise. Other exports retain action-specific investigation needs. No blanket exemption. |
| P2 runtime proposal, separate scope | First-access concurrency; preflight unavailable-versus-empty | Add meaningful concurrent first-load and Graph-failure tests before proposing CAS or availability semantics. Preserve accepted send-with-confirmation policy. Neither is changed here. |
| P2 owner/security review, separate scope | Proposal public-cache lifecycle | Determine intended access/retention and actual current objects through separately authorized evidence; source public-cache behavior is established, live exposure/population is UNKNOWN. Do not delete objects or change token/store ownership from this audit. |
| P2 external evidence, separately scoped | IRS data freshness and external consumer deployment | Name authorized read-only probes for row count, refresh history/data metadata, cron config and PA consumer. Audit rows alone cannot prove refresh absence. Do not run refresh/import as a probe or advance parked intake/cadence decisions. |

Earlier PI role-source, shared-person write ordering, request mutation concurrency
and Awardee browser/export follow-ups remain in their linked audits. This batch
does not lower their priority or authorize runtime repairs.

## Verification limits

Parent review includes Sol investigation, Luna edits, independent Sol challenge and selective parent source checks. Validation results are recorded below. Existing tests
were inspected as evidence of their bounded assertions; green documentation
gates cannot prove hosted behavior, external consumers, zero side effects or
concurrency correctness. Whole-class verdict remains **CLAIM NOT RECONCILED**
until the named remaining restatements and action families are addressed.

Validation: agent-invariants, memory-router, fact-consistency, canonical-pointers, doc-symbol-refs, build-claim-freshness, doc-currency and Atlas checks passed, with applicable self-tests run sequentially. Docs-catalog and final diff checks also passed. No runtime test or hosted-state probe was run for these documentation-only repairs.
