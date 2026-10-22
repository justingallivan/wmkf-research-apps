# Matrix, roster contract and exports — 2026-10-22

**Bounded source audit; whole-class verdict: CLAIM NOT RECONCILED.** Sol
investigated, Luna repaired documentation, and the parent reviewed source and
diffs. No runtime/source files, live systems, credentials, environments,
worktrees, deployments or owner policies were changed. Unrelated critique/output
files and the owner-review-burden note remain untouched.

## Contract and evidence

Sweep Mode B / contract-reconcile review. Entry points are the roster HTTP route,
IRS lookup/refresh and three export families. Persistence includes PG roster,
alerts and operational telemetry, Dataverse records, and temporary refresh
staging. Consumers are staff hooks, browser downloads and future agents reading
the matrix/Atlas. Source-built behavior is not proof of hosted configuration,
traffic, external PowerAutomate consumers or affected populations. No external
request, refresh/import, provider call or live probe was performed.

| Claim | Producer → persistence → consumer; disconfirming check | Status |
|---|---|---|
| Roster GET has cached/reconciled modes and snapshot tokens | `pages/api/workbench/reviewer-roster.js:32-38` consumes requestId and ignores extra mode/token query fields; `lib/services/workbench/reviewer-roster-service.js:314-337` reads PG, reconciles DV engagement and reads repair alerts. `useReviewerRoster` sends requestId only with generation guards. No mode/token dispatcher in this path. | VERIFIED source; matrix STALE |
| Roster GET writes reconciliation back to the stores | `reviewer-roster-store.js` listForRequest SELECT → `reviewer-roster-projection-service.js` response projection → repair-alert SELECT. Missing active suggestion anchors are omitted; nonactive rows retained. Current GET has no stage-refresh/Graph/snapshot producer. | VERIFIED bounded reads; not universal zero logging/cache effects |
| All identity confirmations replace submitted identity with stored identity | `reviewer-roster-service.js:503-566`: applicant rows resolve authoritative stored row and require known hydration. Non-applicant rows use pruned submitted identity with client authority stripped; both submitted and optional stored names are checked against proposal authors. | VERIFIED source; stronger matrix claim STALE |
| Browser PATCH can mark saved | `reviewer-roster-service.js:496-501` unconditionally rejects `saved` with 409 `server_owned_transition`. Actual promotion to Dataverse is a separate endpoint. | VERIFIED source; matrix STALE |
| Stage-refresh/reconcile endpoints remain current roster entry points | Current route/service/store do not expose the reverted warm-stage dispatcher, stage freshness helpers or lease contract. Named stage/reconcile endpoint files are absent. Current applicant enrichment uses `recordSurfaced`. Revert incident records supply historical context, not current authority. | VERIFIED bounded source; Atlas active-stage claims STALE |
| Roster promotion finalization guarantees no recreation after a lost timestamp CAS | `reviewer-roster-store.js:737-812` inserts missing rows from an already-validated candidate; conflict updates are status-qualified active/saved, not updated_at CAS. Alias cleanup is best-effort. Save/applicant callers finalize after Dataverse writes and expose failure/partial success. Caller-specific safety checks do not establish the reverted shared warm snapshot contract. | VERIFIED source; stronger Atlas claim STALE |
| IRS lookup/refresh are uniformly secret-gated and read-only | Verify service performs parameterized SELECT; non-development route requires secret, development explicitly bypasses. Cron has its own development bypass. Refresh dryRun still bootstraps schema/indexes, rebuilds/populates/drops staging, downloads temporary files and attempts maintenance audit/failure alerts; only swap is skipped. | VERIFIED source; matrix omissions repaired |
| PA account writeback proves a deployed consumer | PA owns the intended account-writeback boundary. Local source cannot establish external flow deployment. June probe is historical; audit logging can fail and CLI imports do not create cron audit rows. | Ownership preserved; deployment UNKNOWN |
| Candidate XLSX export uses the old bypass wrapper | `pages/api/workbench/export-candidates.js:43` uses `withDalContext`; `export-candidates-service.js:49-78` reads request metadata and builds workbook response. Find and Invite callers supply candidate DTOs; server metadata is authoritative, candidate rows are not an eligibility receipt. No export artifact retention/provider call in traced service. | VERIFIED source; matrix wrapper STALE |
| Review file/combined DOCX exports have no business writes | Download route uses either staff app grant, GUID validation, DAL context, persisted folder plus primary/optional caller-selected filename, then Graph bytes. Combined export reads request, submitted reviewers, answers, stored synthesis and PG synthesis-job status before rendering DOCX. | VERIFIED bounded source; combined PG read omission repaired |
| Explorer's read-only tools imply no writes or cost | `tools/export.js:72-89` estimate calls sample processing before confirmed bulk branch. `tools/batch-processing.js:33-70` → `model-call.js:69-91` → `LLMClient.complete`. Main chat writes lifecycle/query telemetry; usage logger attempts PG writes. Plain file rendering emits base64 XLSX via SSE, browser creates local download Blob. | VERIFIED source; universal Atlas no-write claim STALE |

Read-only Dataverse business-record access does not establish zero provider cost,
telemetry writes or cache effects. The Explorer prompt already describes sample
output followed by confirmation; no new consent defect or approval rule is
inferred here. AI estimate sampling and confirmed processing were inspected,
never executed. Batch model usage currently lacks request/round propagation;
matrix correlation fields already allow null. Sample/batch calls are distinct
from the plain XLSX renderer and from a Vercel Blob store write.

## Durable reconciliation and history

Luna owns the matrix, two implicated Atlas pages and the warm-performance/browser plan framing. The repaired matrix
describes the current requestId-only GET, actual mutation branches, IRS bypass
and refresh effects, candidate export context, review-export PG reads and
Explorer estimate sampling. Atlas rolled-back stage machinery is historical;
owner engagement and staff confirmation decisions remain intact. The Request
Atlas now scopes Explorer read-only behavior to Dataverse business records.

AGREE: roster Atlas requestId-only GET paragraph, bounded export no-retention
claims, matrix nullable telemetry correlations, settled organization-wide staff
review access, and the wiki's explicitly reverted warm-build paragraph.
HISTORICAL: warm-stage build/revert receipts and pinned extraction-plan source
baseline. UNRELATED: generic disabled-editing labels and the wiki caution that a
Blob URL is not durable proposal identity. These do not promise every URL changes.
Whole-reading an edited document is not certification of its unrelated claims.

## Prioritized remaining backlog

| Priority | Evidence gap | Proposed next action |
|---|---|---|
| P1 runtime, separate scope | Existing PI role-source conflict and shared-person field-write ordering | Keep earlier audits' source findings and population/concurrency questions open. No runtime repair authorized by this documentation batch. |
| P2 source verification | Other claims in large historical planning hubs | The named warm-performance/browser headers and mode assertions were repaired in this batch. Other dated implementation claims are not independently re-proven by historical framing; use current source before reusing a recipe. Preserve revert and owner stop decisions. |
| P2 investigation | Other export families and promotion/finalization concurrency | Trace each action independently; meaningful concurrency tests must assess status guards versus timestamp changes without assuming a current warm snapshot. Factory artifact GET is not its Blob-writing exportSource operation. Awardee completeness/browser-output follow-ups remain in their prior audit. No universal export exemption. |
| P2 source-comment drift, separate scope | `reviewer-suggestion.js` getForDownload comment still says bypass remains at route | Correct comment to current caller-owned DAL context when source edits are in scope; current route already uses withDalContext. No executable behavior change proposed here. |
| P2 runtime evidence | Roster non-applicant confirmation authority and concurrent updates | Meaningful adversarial tests must distinguish stripped authority, submitted identity, stored name and author checks. Stronger policy requires an explicit design; do not silently recreate reverted architecture. |
| P2 external evidence | IRS freshness/PA deployment and actual export usage/cost/access populations | Define separately authorized read-only probes. Neither zero audit rows nor documentation proves present state. Do not use import, refresh, export or provider invocation as a probe. |

This batch used source inspection; no runtime tests or hosted probes were run.
Agent-invariants, memory-router, fact-consistency, canonical-pointers, doc-symbol-refs, build-claim-freshness, doc-currency, Atlas, API-route and docs-catalog checks passed; applicable gate/self-test pairs ran sequentially. The API checker retained its three existing external-materials guard-recognition warnings, and the memory-router self-test retained Node listener warnings. Neither checker was changed. Final diff checks passed. This report closes the named documentary discrepancies
only; remaining plans, export families and live state retain explicit limits.

Parent review corrected an accidental Slice A/reverted-stage conflation, preserved detailed current partial-save behavior, narrowed confirmation/eligibility wording and checked the status-qualified finalizer against source. Sol reviewed the roster/IRS/plan changes and export evidence independently. No broader unchanged Atlas/matrix certification is implied.
