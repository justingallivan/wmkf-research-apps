---
title: User Perceived Performance Migration Plan
domain: architecture
kind: plan
status: historical
summary: "Historical October 2 proposal. Tracker read optimizations are implemented on main; Workbench context and return-navigation ideas remain unapproved follow-up candidates."
canonical: false
owner: product-engineering
related:
  - docs/plans/WORKBENCH_RESPONSIVENESS_MIGRATION_PLAN_2026-09-18.md
  - docs/plans/WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/CI_GATES_REFERENCE.md
---

# User Perceived Performance Migration Plan

## Disposition — October 4, 2026

This document preserves the October 2 planning specification as historical evidence, not an active execution roadmap. The comparison below was verified against fetched `origin/main` at `cd6f69982ceaf63efadd2bd272420006c8c00346`; this older checkout still points to the original source baseline. No deployment or measured production speedup is inferred.

| Original scope | Disposition and evidence |
|---|---|
| Stages 1–3: shared selection and Tracker reads | Superseded by the narrower implementation documented in `docs/plans/MEETING_TRACKER_READ_PERFORMANCE_EXECUTION_2026-10-03.md` and its companion review on main. `lib/services/workbench/dashboard-service.js` shares selection in place; Tracker schedule mode omits reviewer rollup and per-visit detail reads. Do not repeat the proposed file extraction or rebuild those optimizations. |
| Stage 4: smaller Workbench context | Remaining proposal, not authorized implementation. Main's `resolveWorkbenchRequest` still selects proposal/AI fields and awaits Co-PIs for every successful resolution. Reassess benefit and consumers before adopting a new plan. |
| Stage 5: dashboard return location | Remaining proposal, not authorized implementation. Main's request page still links explicitly back to bare `/workbench`. Reassess navigation requirements before implementation. |
| Stages 6–7: caching and splitting | Conditional ideas only. No new measurement here justifies admitting either experiment. |
| Stage 0/8 and historical blockers | Not a current acceptance checklist. The October 3 execution record reports the drain-table gate repair and points to the later baseline-test repair record. Re-establish checks on the intended current revision before any follow-up. |

The separate `docs/audits/USER_PERCEIVED_LATENCY_BASELINE_2026-10-02.md` retains a partial historical Production probe. It does not establish page latency, a bottleneck ranking, or before/after improvement. The planning review records the original specification's hash; it does not approve this disposition or a future revised implementation plan.

The October 3 records exist on main and are named here by repository path because they are absent from this older checkout. No runtime files, schema, or external state changed during this reconciliation. The remaining ideas require a new bounded plan based on current code, rather than resuming the historical stage sequence below.

## Historical specification — October 2, 2026

Everything below, including present-tense source descriptions, prerequisites, stage instructions, and gate results, records the original baseline and planning session. It is preserved for rationale only and is superseded where the disposition above identifies completed work.

## Recommendation and limits

**[PLANNED] Refactor the Workbench and Meeting Tracker read paths so each screen loads only the data it needs, with explicit ownership of reads and refreshes.** Start with redundant server work, then evaluate smaller request-context projections. Preserve the user's dashboard location when they open and return from a request. Only add browser caching or additional code splitting if a measured experiment earns it.

This is the largest coherent remaining performance opportunity supported by this source audit: it spans request selection, Dataverse reads, API projections, and their client consumers. It can improve cold loads as well as revisits without changing business workflows. **[ASSUMED] It has the largest real-world impact.** Production timings and journey frequency were not measured; Stage 0 must validate that ranking. File size and the number of effects are not latency measurements. Do not promise a percentage speedup.

**Owner clarification during planning:** there is no single sticking point; find tasks that introduce unnecessary latency, and investigate whether Dataverse sets the floor. Accordingly, removal of source-proven unnecessary Dataverse work is the core acceptance target. Dataverse being the rate-limiting dependency remains [ASSUMED], not established by this audit.

Audience: an implementation agent using a cheaper model. Execute one stage at a time, using the file order, tests and stop rules below. Do not redesign later stages while implementing the current one. This document authorizes no implementation, deployment, external writes, production probes or paid-provider calls. The current user requested a plan only.

Source baseline: `fb5d39fc907f80d294a55157f81726c6671f0204`, branch `codex/transcription-pilot`, inspected October 2, 2026 Pacific. There was an unrelated modification to `tests/unit/research-presentation-materials-card.test.js`; preserve it. This checkout was not switched or pulled. Rebase the evidence, not just the prose, before implementation on an owner-selected feature branch.

The core stages are 0–5. Stages 6 and 7 are conditional experiments. Stage 8 closes the selected scope. The implementation is a cross-layer Tier 2 refactor under the release strategy. A wider replacement of shared data access would be Tier 3 and is outside this plan.

## What already exists

[VERIFIED via current source and the September execution receipt] Do not implement these again:

- Same-context Request List and Reviews refreshes retain successful content; wrong-context and obsolete results are fenced.
- Explicit program-and-cycle dashboard URLs start rows before cycle metadata completes. Default-program resolution still waits for the server.
- Proposal documents and Overview reviewer counts start from the route GUID independently of the shell context.
- Private profile/access providers already live above pages. Most ordinary navigation already uses Next Link or the router.
- `shared/utils/api-request.js` already centralizes JSON transport while leaving retries, HTTP/body-success interpretation and workflow policy to callers.
- Reviewer person-read coalescing already has exact call-count tests.

The September responsiveness execution **omitted caching** because incremental benefit was unproven. A single ReviewPanelTab lazy-import trial saved 3,503 gzip bytes, 0.7135% of that historical initial entry, and was reverted. These are historical experiment results, not current bundle measurements. They require a new, different measured justification for Stages 6–7; they do not prove every possible split is useless.

Read `.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md` before implementation. This work must not become a reviewer evidence, eligibility, promotion-authority or authentication redesign. A faster screen that loses working actions is a failed stage.

## Evidence and comparative scope

Anchors are for the baseline revision. Re-find symbols at each checkpoint; stale line numbers do not establish evidence.

| ID | Current mechanism and evidence | Implication and disconfirming check |
|---|---|---|
| E1 | [VERIFIED via `lib/services/meeting-tracker/dashboard-service.js:98–104,181–219`] Tracker calls the full Workbench dashboard, then rereads selected requests. Its final rows omit reviewer progress. | Strongest new source-certain redundant work. Check all route consumers before omitting inherited response fields; the legacy response still spreads `base`. |
| E2 | [VERIFIED via `lib/services/workbench/dashboard-service.js:80–92,221–228`] Dashboard resolves PD/role/program, reads requests and awaits reviewer rollup. | Tracker can share selection without paying for reviewer enrichment. Do not bypass PD/program/default validation or change Workbench counts. |
| E3 | [VERIFIED via `meeting-tracker/dashboard-service.js:125–172` and `lib/dataverse/adapters/site-visit.js:59–113`] Tracker reads active visits in batches, then performs one `getById` per selected visit. That detail read expands parties. | A dedicated batch summary can avoid the per-visit reads. Logistics fields are schema-gated; duplicate visits and incomplete pages must remain visible. |
| E4 | [VERIFIED via `lib/services/workbench/resolve-request-service.js:24–47,62–83,109–139`] Every context response selects abstract/AI text/Primer and waits for Co-PIs. | A header projection benefits non-Proposal/non-Overview entry. Overview consumes Co-PIs, amounts and artifact presence; full projection remains required there in this bounded design. |
| E5 | [VERIFIED via `pages/workbench/[requestId].js:92–163,237–308`] Context is already fenced; only the active request tab mounts. | Preserve guards and remounts. Cache data only if justified; do not keep every workflow component mounted. |
| E6 | [VERIFIED via `shared/components/workbench/RequestListPanel.js:324–336`, request page `:191`, and `workbench-location.js`] List opens a request without a return location; explicit Back targets bare `/workbench`. | Returning can lose chosen filters and cause extra user work. Test explicit Back separately from browser Back, which can restore the prior URL. |
| E7 | [VERIFIED via `_app.js:43–56`, `RequireAuth.js:59–76`, `shared/utils/auth-enabled.js`] Provider lifetime and auth-status dedup already exist. | No foundation for an App Router or provider rewrite. Test any optional cache boundary against existing identity handling. |
| E8 | [VERIFIED via `shared/components/meeting-tracker/MeetingTrackerList.js:65`, `MaterialsStatusPill.js:31,34`, `proxy.js:40,79–87`] Visit/material links deliberately load a new document; destination CSP allows upload connections. | Preserve these full reloads. Converting all anchors to Link can break uploads. Downloads, OAuth and external-token navigation are also excluded. |
| E9 | [VERIFIED via `shared/components/reviewers/ReviewersTab.js:198–241,296–305,450–478`] Confirmed-invite overlays, delayed reconciliation, three-source refresh and bounded polling have distinct owners. | Leave these unchanged. Broad refresh is not automatically waste. No selective reviewer invalidation in this plan. |
| E10 | [VERIFIED via `pages/_app.js`, `package.json`, `next.config.js`] Application uses Pages Router; Next/React are already installed. | Moving files to `app/` does not itself prove a speedup. No router/framework/runtime upgrade. |

Alternatives considered: framework/router replacement has the largest blast radius with no demonstrated cause; blanket client caching adds staleness policy before proving benefit; code splitting alone already had one failed experiment; general component decomposition improves maintainability but does not establish faster user journeys. The selected read-path refactor removes specific unnecessary work first. Slow AI generation and Reviewer Find bootstrap are separate domains; do not alter them to inflate this plan's scope.

## Contract that every stage preserves

The trace is browser route and filters → existing authenticated API route → service → Dataverse adapter under `withDalContext` → response DTO → current UI. Tracker also joins existing schedule/document/material readers. Persistence remains Dataverse, existing Postgres operational stores and SharePoint. **No database migration, new durable cache or new background job is proposed.**

1. Each route keeps its own app guard: Tracker uses `meeting-tracker`; Workbench context/dashboard use `reviewers`. Services do not call another HTTP route to inherit its guard. Server identity comes from the authenticated session.
2. Program/cycle/scope/set-aside, current working-cycle selection, test-request isolation, PD and role behavior are unchanged. UI display permissions never replace route authorization. No new user-facing eligibility gate.
3. Legacy endpoint defaults and exports remain compatible. New projections are explicit allowlisted query values. Repeated/unknown projection values fail 400 after the existing authentication boundary, before reads. Missing projection uses the legacy behavior. A browser cannot supply a field list, OData filter or trusted authorization state.
4. Empty, absent, failed and incomplete results differ. Never replace an unavailable count/material/visit with a fabricated zero or claim that omitted enrichment is complete.
5. Preserve same-key successful content during existing refreshes; immediately hide A's content on B, including before effects run. Fence late success, error and finally paths, plus A→B→A. Never apply a write receipt to the current request merely because the user navigated there.
6. Keep command endpoints, retries, partial-success receipts, awaited-versus-void callbacks, confirmed-invite overlays and poll timing unchanged. A successful write followed by failed readback stays a successful write with a refresh error. Do not retry an unknown-outcome command.
7. Keep local editor/draft state local. A valid Primer response with `persisted:false` must not be overwritten by a stale server read or treated as persisted. No auto-generation on navigation, focus, retry or prefetch.
8. Preserve required full-document navigation and CSP, preview read-only behavior, schema readiness, restriction context and target interlock. Do not change environment flags to make tests pass.

## Measurement and green stage gate

### Stage 0 measurements

Reuse `tests/e2e/workbench-responsiveness.spec.js`, the real-page staff-session fixture from `tests/e2e/program-director-invite.spec.js`, and `scripts/measure-workbench-bundle.js`. The proposed new browser suite is `tests/e2e/performance-read-models.spec.js`; proposed server-call fixtures are `tests/unit/performance-read-models.test.js`. These files do not exist at the planning baseline.

Run Mode A in an isolated checkout with no copied `.env*` or `.vercel`, a minimal environment, fixture data and a throwaway local NextAuth secret. `next/jest` loads environment files, so clearing shell variables alone is insufficient. Browser interception must fail unmatched API requests, but interception does not isolate server startup/instrumentation: verify its environment independently. Tests must not invoke real Graph, Dataverse, AI, mail or Blob operations. Do not set `DATAVERSE_ALLOW_PROD_READS` yourself. Production-shaped data or a read-only shadow comparison requires the separately authorized procedure in the release strategy.

Use two measurement layers. Browser API-intercept fixtures prove rendering, navigation and ordering; they bypass the real server and cannot prove a service optimization. Add a local service-boundary fixture which invokes the actual dashboard/resolver services with deterministic adapter delays and populated records, records actual selects, response bytes, dependency calls and elapsed service time, and holds independent branches to expose serialization. For an integrated latency claim, run a local fixture-backed server exercising those real services, or obtain separately authorized representative read-only before/after measurements. Never assign an artificially faster mocked API response to the candidate and call that measured backend improvement.

Measure these journeys on baseline and candidate, using the same production build flavor, browser, viewport, CPU/network settings and fixtures:

- Cold Workbench entry with default context and with explicit program/cycle.
- Request list → Reviewers; direct Overview, Proposal and Status links.
- Request → explicit dashboard Back; browser Back/Forward; dashboard view changes; A→B→A.
- Cold Meeting Tracker with 0, 1, 25, 26 and 51 requests, including multiple visits per request.
- Same-context refresh with held read, transient failure, denial and valid empty response.
- If selected: Proposal document revisit after navigation and after a known document change.

Record time to useful content, time to fresh complete content, time to enabled existing actions, blank-screen duration, API calls by method, dependency calls by resource class, response bytes, initial JS bytes, browser long tasks and active pollers. Use held promises for ordering assertions; fixed synthetic delays for comparative timings. At least 20 repeated samples per selected journey, report median and exploratory p95 plus raw sample count. Mocked latency is controlled evidence only. Do not present it as production p95, and do not reuse the existing `.next` directory as a baseline without proving its source revision.

Reuse existing request correlation/telemetry when available; `lib/observability/request-correlation.js` does not imply every route already establishes correlation. For new measurement seams, use the existing event contract and no bodies, tokens, names or raw URLs. Do not provision a monitoring service or add a database for this work.

### Acceptance rules

[PLANNED thresholds, not measured results] Core server stages must eliminate the named unnecessary dependency calls with correct data and demonstrate the shortened critical path in the actual service fixture, without a repeatable >10% regression on unaffected controlled journeys. This directly addresses the owner’s avoidable-work objective even before a production latency distribution exists. Freeze conditions before measuring; do not invent a slow workload to manufacture a win. For optional cache/UI experiments, require a predeclared 15% median useful-content improvement on a demonstrated residual wait and no repeatable >10% complete-content or first-action regression. These thresholds are experiment decisions, not an SLO.

Zero wrong-request data, unintended commands, lost draft content and new duplicate pollers are hard gates. Correct output with fewer reads but no detectable browser benefit is reported as a verified reduction in unnecessary work with user timing still unproven; it does not justify cache/framework expansion. Reject synthetic wins that merely delay needed content or actions.

### Gate G after every stage

One executor owns build/tests; reviewers read only. Gate and its self-test always run sequentially.

1. Run prerequisite suites and new behavior tests. Check assertions against populated adverse cases; demonstrate failure when the intended guard/optimization is removed. Keep passing characterization separate from intentionally failing pre-fix acceptance tests; never commit a red stage.
2. Run full `npm test -- --runInBand --silent`, `npm run lint`, `npm run check:types`, and canonical `npm run build`. Record HEAD, environment and exit codes. Do not run another build while Playwright owns `.next`.
3. Run relevant real-browser fixture journeys: `npm run test:e2e -- tests/e2e/workbench-responsiveness.spec.js tests/e2e/performance-read-models.spec.js --project=chromium`. Run invitation/CSP/Tracker suites when their boundaries are implicated. Playwright currently builds with Webpack; that is separate from canonical Turbopack verification. A fallback Webpack success is not canonical-build success.
4. For server/projection stages, run `check:api-routes`, `check:route-lifecycle-auth`, `check:route-service-boundary`, `check:dataverse-access-layer`, `check:odata-escape`, `check:dynamics-context-boundary`, `check:trust-boundary-guid`, `check:atlas`, `check:status-enum-parity` and available self-tests, sequentially. Run docs/catalog/symbol/fact gates for moved symbols and changed docs. Discover scripts in `package.json`, not from an old count.
5. Fresh-context reviewer checks the current source/diff/assumptions. Resolve correctness findings; rerun impacted checks after corrections. Executor accepts the evidence and makes a descriptive, stage-sized green commit. Record before/after hashes, metrics and rollback. Do not advance with unexplained red results.

At Stage 0 and Stage 8 run all current `check:*` scripts sequentially. A stage can be omitted with a written evidence-based decision. A failed stage is not an omitted stage and must be reverted or repaired before continuing.

## Stages

### Stage 0 Establish the actual baseline and prerequisite tests

**Before starting:** implementation authorization, intended isolated branch, source revision and ownership confirmed. Read CLAUDE.md, the performance postmortem, prior responsiveness execution, release strategy and the relevant source. No runtime edit before the baseline test work.

**Tests that must exist before the next stage starts:** characterization fixtures for full dashboard/Tracker/context DTOs; the existing 12-suite planning baseline listed in the review record; request selection cases across program/cycle/scope, working-cycle boundaries, roles, set-aside and test-request isolation. Add the proposed performance suites above with seeded realistic long AI/Primer content, duplicate/missing visits, missing request hydration, failed materials and held responses. Pin current errors and ordering as well as happy paths. Record full DTO assertions rather than snapshots containing only the easy fields.

**Order:** tests/fixtures → measurement evidence → caller and mutation census → revised stage admission decisions. No production-source moves. Inspect every `loadDashboard`, `resolveWorkbenchRequest`, `findActiveByRequests`, `/api/meeting-tracker/dashboard` and `/api/workbench/resolve-request` caller. Trace the actual transport for any statement about pagination or call counts.

**Exit:** Gate G, baseline build green, causal request/dependency graph, metrics and thresholds frozen; fresh review accepts stages 1–5 or narrows them. If another flow dominates, stop and revise this document before committing to the architecture. The known red drain-table gate below must be resolved in its owning workstream before calling the implementation baseline green.

### Stage 1 Extract shared request selection without changing output

**Prerequisites:** passing `workbench-dashboard-service.test.js`, `workbench-program-scope-service.test.js`, `workbench-visibility-row-predicate.test.js`, `meeting-tracker-dashboard-service.test.js`, and Stage 0 DTO/call-count/error fixtures. Add proposed `tests/unit/workbench-request-selection.test.js` before extraction; characterize missing PD, ambiguous program/default, capped cycle discovery, empty cycle and date rollover.

**File and move order:**

1. Add `lib/services/workbench/request-selection-service.js` with the request-selection/metadata portions extracted from `dashboard-service.js`: the existing PD/role/program resolution and the cycle-filtered request read. Preserve call order, fields, failure semantics and DAL assumptions. Keep cycle-list mode in the existing service initially.
2. Replace only those bodies in `lib/services/workbench/dashboard-service.js` with calls to the extracted module. Leave `loadDashboard`, `buildVisibilityFilter`, enrichment, projection and response shape at their current import paths.
3. Leave Meeting Tracker on the legacy service for this commit. Update service header/catalog references to the extraction; no route filename moves.

Use explicit named internal selection profiles, initially Workbench only; never a client-defined select. The extracted module must not import the dashboard service, React, browser code or an API handler. Keep the adapter as the only Dataverse access seam.

**Exit:** byte-equivalent DTO/error fixtures and unchanged dependency counts for legacy callers; no performance claim for this mechanical stage. Gate G and fresh review. Rollback: revert this extraction commit; no consumer should depend on its private profile yet.

### Stage 2 Stop computing unused reviewer progress for Meeting Tracker

**Prerequisites:** Stage 1 accepted. Existing Tracker dashboard, list, material filters and route tests; new selected-projection contract tests proving default legacy equivalence, array/unknown projection rejection, correct app grant, schema-disabled response and no reads before authorization. Seed reviewer records so a zero-read assertion cannot pass just because the cycle is empty.

**Order:**

1. Add a named Tracker selection entry in `request-selection-service.js`, reusing exactly the established scope/visibility rules. Preserve role/PD/default validation; do not opportunistically skip those reads.
2. Add a schedule projection path in `lib/services/meeting-tracker/dashboard-service.js` using the selector directly, without `fetchReviewerRollup`. Preserve its second request hydration for now: that read supplies missing/deleted-request notices and current document pointers.
3. In `pages/api/meeting-tracker/dashboard.js`, accept only absent/`legacy`/`schedule` projection values. Default stays legacy; keep the literal existing guard and `withDalContext`. New schedule response contains `success`, `programDirector`, `programs`, `programId`, `defaultProgramId`, `programName`, `cycleCode`, `cycleLabel`, `scope`, `includeSetAside`, schedule `proposals` and `notices`, plus `projection: schedule`; omit the unused inherited reviewer `rollup` explicitly. No fabricated empty rollup. Without a cycle, retain the legacy cycle-list fields/defaulting behavior and add only the requested projection discriminator; there is no reviewer-rollup saving in that mode.
4. Switch `shared/components/meeting-tracker/MeetingTrackerList.js` to the schedule projection. Keep existing UI normalization/error/loading behavior. Update actual consumers/fixtures, route security documentation and service catalog as applicable.

**Required verification:** all metadata used by the list survives; same eligible request IDs and sorting; date/program/test-request behavior unchanged; 0 reviewer-rollup calls for schedule mode with populated reviewer fixtures; legacy dashboard still computes identical counts. Existing route consumers using default legacy remain valid. Test malformed responses, failed joins and missing request hydration. Do not combine removing the second request read with removing unused rollup.

**Exit:** Gate G plus real-service call-count/critical-path improvement and source-proven removed reads. Browser/API request count must not increase. Rollback: revert the client opt-in first; legacy route stays available. If browser timing is unchanged, label that limitation and do not claim a user speedup; the source-proven removed work can still satisfy this stage. If calls or service critical path do not improve, revert before expansion.

### Stage 3 Replace per-visit hydration with a complete batch summary

**Prerequisites:** Stage 2 accepted. Existing `site-visit-adapter.test.js`, `meeting-tracker-dashboard-service.test.js`, `pre-site-visit-cycle-list-service.test.js` and selection-rule coverage. Add proposed `tests/unit/site-visit-summary-batch.test.js`: empty/25/26/51 IDs, repeated mixed-case GUIDs, multiple pages, duplicates, missing end dates, ties, schema ready/off, transient failure, and cap exhaustion. Test real adapter argument shapes, not only an injected fake that ignores selects/pagination.

**Order:**

1. Add `findActiveSummariesByRequests` to `lib/dataverse/adapters/site-visit.js`. Keep `findActiveByRequests`, `getById` and their callers unchanged. The new read selects ID, regarding ID, start/end, plus only the schema-ready format/location fields consumed by `siteVisitShape`; no ActivityParty expand or attendee payload.
2. Chunk request filters at 25 and follow all pages within the existing bounded read limits. Inspect the adapter's actual `queryAllRecords` cap behavior. Return completion metadata; cap/truncation becomes a typed incomplete result which the service maps to 503, never an apparently complete visit result. This intentional error difference applies only to schedule projection. The guarantee covers visits for the selected request IDs, not completeness of the entire cycle: current base proposal selection discards its capped flag, which this extraction must not silently change. The exact adapter ceiling conservatively reports capped, even if it happens to equal total rows; test that boundary too. Do not carry the current multi-read helper's silent loss of completeness into the new helper.
3. Wire only the schedule projection to the new helper. Use the existing `selectActiveSiteVisit` rule on complete rows, preserve `siteVisitNeedsReconciliation`, and project directly; no selected-visit `getById` calls. Leave legacy projection and the pre-site-visit cycle reader on their current paths.

**Required verification:** complete fixtures give equivalent rendered visit fields and duplicate notices; logistics-off does not select unprovisioned fields; no parties requested; 0 per-visit detail reads; chunk/page count matches the actual transport rather than a fixed guessed formula. Empty IDs produce zero reads. An incomplete page cannot silently hide a duplicate or show “no visit.” A later-page visit winning the selection must be tested. A deleted visit between old selection/detail reads versus the new single snapshot is a named consistency difference: pin display-only semantics and ensure mutation routes continue to reread current authority.

**Exit:** Gate G and comparative large-cycle timings, with bounded upstream concurrency. Do not parallelize every request unboundedly. Rollback: client returns to legacy projection, then revert schedule wiring before removing the additive adapter function.

### Stage 4 Give noncontent request tabs a smaller context

**Prerequisites:** accepted selection work and baseline evidence of context cost. Existing resolve-request service/route, request-page-context, Overview/Status, Proposal-documents, Primer-export, Awardee and preview-safety tests. Add proposed `tests/unit/workbench-context-projections.test.js`, including each header consumer, full legacy equality, wrong/missing discriminator, seeded denial, A→B→A, uppercase GUIDs and mixed response ordering. Do not weaken the existing full-response test requiring the Primer select.

**Order:**

1. Extract only pure context projection/field-list logic from `lib/services/workbench/resolve-request-service.js` into proposed `lib/services/workbench/request-context-projection.js`. Leave `resolveWorkbenchRequest` and its existing import path intact. The full path keeps its exact current source fields, Co-PI behavior and errors.
2. Add `header` alongside absent/`full` projection to the existing `pages/api/workbench/resolve-request.js` route/service. Header returns success, matching request ID, request number/title, cycle/date/status/classification, institution/applicant/project leader, grant program, PD label/ID and the existing conditional test badge. It omits `proposalInfo` and `aiContent`, and does not call `fetchCoPIs`. Reuse safe field construction; no arbitrary selects from the browser.
3. Add proposed `shared/components/workbench/data/useRequestContext.js`. Move the page's context-load effect and ownership guards into it without changing the guard semantics. Keep one owner; delete the old live effect in the same commit that wires the hook. Tests must pin its prop/result contract before moving it.
4. In `pages/workbench/[requestId].js`, request full context for Overview/Proposal, header for all other tabs. Same-request full data may satisfy header needs; a header can never satisfy full needs. A→B hides all A data synchronously. Preserve route-keyed workflow subtrees.

No cross-page cache in this stage. Within this one page keep the existing full snapshot when switching to a header-only tab so returning to Proposal does not discard its context unnecessarily; never replace it with a later smaller response. Store validity by request and projection. Keep the initial default Overview as one full request, not header plus full. Entering from the Request List currently targets Reviewers and can use header only. Upgrade header→full exactly once on demand; expose full-detail readiness separately from header availability. Pass full context to Overview/Proposal only after full success; retain the header while those detail sections show loading or a retryable error. A header object must never render false “no AI content” or empty Co-PI conclusions. Test denied/malformed full reads, header→full→header races and a denied gated-tab deep link falling back to Overview. No refetch on focus/reconnect. Context failure/retry messages remain explicit.

Do not parallelize request/Co-PI calls or split Overview into further endpoints in this stage. Those changes would alter call counts, error ordering or its consumed data and need a new measured decision. This plan therefore makes **no promise to accelerate default Overview through the header projection**.

**Required verification:** header completes with zero Co-PI and no AI-memo field selection; full result remains exact, including unpersisted Primer behavior after a command; all tabs retain their inputs/management display; full/header races cannot downgrade valid content. Proposal documents and Overview counts still start independently. Measure direct Reviewers/Status entry, direct Proposal/Overview and first switch to Proposal; reject a win that creates an unacceptable first-use delay.

**Exit:** Gate G, measured benefit for admitted journey, no regression to prior responsiveness fixes. Rollback: restore full-only caller, then hook extraction, then remove additive projection only after caller search. Leave legacy full service facade available.

### Stage 5 Return users to their chosen dashboard view

**Prerequisites:** `workbench-location.test.js`, shell/navigation/request-page suites and Stage 0 browser history cases. Add proposed `tests/unit/workbench-return-location.test.js` before implementation. Cover explicit Back, browser Back/Forward, refresh/direct deep link, multiple browser tabs, changed request, query arrays, malformed and external return targets.

**Order:** extend `shared/components/workbench/workbench-location.js` with a bounded codec for an internal dashboard return location → pass the current canonical dashboard URL from `WorkbenchShell.js` to `RequestListPanel.js` → append it when opening a request → preserve it through `WorkbenchRequest.selectTab` → use it for the explicit Back link. Inspect nested reviewer sub-tab route changes for preservation; only change a caller if it drops this value.

Return targets are constructed from the known `/workbench` path plus the existing allowlisted filter keys, length-bounded and normalized. Never pass arbitrary URLs to router navigation. Invalid/absent values fall back to `/workbench`. No global “last screen” in localStorage and no new authority inferred from return filters. Limit this stage to Request List entry; other launchers are out of scope unless Stage 0 identified them as the same lost-location journey.

**Exit:** Gate G; click Back restores the exact normalized program/cycle/scope/set-aside view after tab changes; no extra document navigation for ordinary Workbench links; intentional upload reloads remain. This stage improves user continuity, not a claimed reduction in backend response time. Rollback: remove link propagation/consumption before its codec.

### Stage 6 Conditional cache for one proven revisit problem

**Admission:** after Stages 2–5, evidence still shows a material Proposal-document revisit wait. Record before/after target and full writer/reader census before changing dependencies. If absent, mark this stage **omitted with evidence**. Do not resurrect the omitted September cache project by default.

Scope is one pure GET resource: `/api/workbench/proposal-documents`, only if its DTO contains no short-lived signed URLs, secrets or bytes requiring a different lifetime. Read its service and all upload/replacement/filing writers first. Do not cache context, grants, reviewer actions, candidates, engagement eligibility, streams or mutations. If complete invalidation cannot be specified, omit this stage.

**Prerequisite tests:** populated cache then 401/403/malformed response; expired auth/principal/profile change/logout/transient session loading; route A→B→A; exact-case-normalized keys; last observer cancellation; abort during body parse; successful empty documents; old in-flight GET after invalidation; known write success plus refresh failure; scope exit and memory expiry; no focus/reconnect/poll/retry effects. Assert both immediate render and later completion.

**Order:** compatible pinned TanStack Query v5 package+lockfile → proposed `shared/components/workbench/data/query-policy.js` → `WorkbenchDataProvider.js` → `useProposalDocuments.js` → provider boundary inside the existing private `_app.js` tree only for Workbench → Proposal consumer replacing its old effect → tested invalidation at the exact affected command callbacks. These are proposed files. Do not build a custom cache engine or add persistent storage.

Proposed policy: request key includes schema/projection version, session/principal partition and normalized GUID; five-minute inactive garbage collection, stale immediately, retries/focus/reconnect/polling off. One QueryClient per client scope, never a server module singleton. Clear/cancel on logout, actual identity change or scope exit; block old-principal projection synchronously. Never use previous-request placeholder data. Existing auth guards remain authoritative. Forward the provided AbortSignal through `requestEnvelope`, including body parsing.

A cached revisit paints its same-key snapshot marked Updating, then performs ordinary mount revalidation. **staleTime 0 does not remove sequential remount GETs**; the expected gain is earlier useful content, with only simultaneous identical reads deduplicated. Preserve error/denial handling explicitly because a query library may retain old data after an error. Do not introduce a new promotion/authority lease. File actions retain their server checks.

Invalidate only from confirmed affected writes or unknown-outcome refresh reconciliation, never replay the command. Mark inactive keys stale without starting unsolicited GETs; perform only refreshes the prior callback required. External CRM/SharePoint changes are discovered on ordinary remount or explicit refresh; no claim of realtime coherence. A cache invalidation map and tests must name every in-scope producer before integration.

**Exit:** Gate G; incremental improvement over Stage 5, with truthful fresh-content timing and no leaked/cross-request content. If it fails, revert all experiment consumers/provider/package changes; retaining a measurement test is acceptable. No automatic expansion to other resources.

### Stage 7 Conditional split of a demonstrated heavy dependency

**Admission:** production bundle and browser CPU evidence shows significant cold-entry work. Use actual dependency reachability; a large file is insufficient. Prefer examining the Awardee rich editor boundary (`AwardeeTab.js` → `GranteeAbstractEditor.js` → Tiptap/ProseMirror) over repeating the failed single ReviewPanelTab experiment.

**Prerequisites:** actual bundle baseline plus deep-link, tab-loading/failure, first-use, history, editor/draft and keyboard tests. Verify exports and any dynamic-import mocks. No API call should begin simply because a chunk is fetched.

**Order:** one `next/dynamic` boundary at a time in the request page; keep default SSR and stable component exports/keys. Alternatively defer the editor within Awardee only if measured reachable there. Choose one, not both, for the first experiment. No file move is required; no eager-import barrel. Never keep hidden tabs mounted or prefetch all workflows. Existing Proposal export libraries are already dynamically imported.

**Exit:** predeclared minimum 5% initial-entry gzip reduction **and** better measured transfer/parse or useful-content time, no repeatable >10% first-use regression. Use the same manifest accounting as the existing bundle probe. Gate G; fresh review per accepted split. If the threshold fails, restore the import and mark experiment rejected. SSR configuration alone is not proof of chunk removal.

### Stage 8 Release handoff and stop

**Prerequisites:** every core stage accepted or explicitly narrowed by reviewed evidence; conditional stages accepted/omitted/reverted; no unresolved correctness finding. All current check scripts, full Jest/lint/types/canonical build and applicable browser journeys pass on the final diff. Record final metrics against the original baseline and each intervening accepted stage.

Update actual read-path descriptions, service catalog and API projection documentation. Do not update Atlas schema or create migrations when persistence did not change. Review all moved-symbol references before deleting a compatibility export; retain legacy route defaults through this rollout. No mass rename of `pages/`, `shared/` or adapters.

Tier 2 promotion is a separate owner decision with the target environment rechecked, staff rehearsal, recorded last-known-good deployment and rollback. No current deployment is inferred from branch contents. Use the release strategy's authorized test mode; this plan does not grant production-read flags, live writes or sends. Roll back to the last accepted commit/deployment before stacking production hotfixes. No database repair is required by these read-only stages.

Deliver stage commits, measurements, test/review receipts, omitted experiments and residual unknowns. Do not call the migration complete while a chosen stage is red. Stop after the selected scope; migrating the entire application onto a new client framework is not a follow-on obligation.

## File move ledger

All destinations below are proposed; check for collisions before creation. Each extraction keeps the old public import path as a facade until every current caller and test has been checked.

| Order | Source | Destination or action | Compatibility condition |
|---|---|---|---|
| 0 | Existing tests/fixtures | Add characterization/performance tests only | Green baseline, no runtime change |
| 1 | `lib/services/workbench/dashboard-service.js` selection/metadata regions | New sibling `request-selection-service.js` | Original dashboard entry point/output stays |
| 2 | `lib/services/meeting-tracker/dashboard-service.js` | Add schedule branch in place, then route, then client | Legacy route default remains |
| 3 | `lib/dataverse/adapters/site-visit.js` | Add summary batch in place, then schedule caller | Existing readers/party writes unchanged |
| 4a | `lib/services/workbench/resolve-request-service.js` pure field/projection regions | New sibling `request-context-projection.js` | Full resolver facade and DTO preserved |
| 4b | `pages/workbench/[requestId].js` context effect/state ownership | New `shared/components/workbench/data/useRequestContext.js`, then page | One fetch owner; same exports/route |
| 5 | Existing location codec and navigation callers | Edit in place in producer→consumer order | Bounded local fallback |
| 6 | Optional Proposal documents effect | New hook only after policy/provider | Remove old effect with consumer switch |
| 7 | Heavy import | Change import in place | No physical move necessary |
| 8 | Actual changed read descriptions | Update docs after verification | No invented as-built status |

Do not use a single giant `git mv` commit. A move/extraction and its wiring may be one green commit; no intermediate accepted commit may leave imports broken or both old and new effects fetching.

## Fresh context review at every planning and implementation checkpoint

The review interval is **event-based: after every planning stage, every migration stage and any material architecture revision**, before the next dependent stage. Also checkpoint before a stage grows beyond two commits or roughly 30 minutes of support work. Fresh means a new reviewer context with no inherited author conversation; the same reviewer continuing its own earlier discussion is not fresh.

Planning was divided into P1 source diagnosis, P2 architecture/contracts, and P3 full executable stage order. Receipts and findings are recorded in the companion review record. Do not infer approval from a reviewer's silence or from an earlier draft's verdict.

For implementation, send the reviewer only this document, exact HEAD/base/diff and dirty-file inventory, evidence paths and the bounded question. The reviewer independently reads applicable instructions, actual source and consumers. Use the session's ordinary authorized agent mechanism; no API-key agent authentication, Ultrareview or other metered product substitution. If review fails to run, report it and stop dependent advancement.

Suggested fresh reviewer prompt:

> Review stage S at HEAD H against this plan, without reading the author's conversation. Read current entry points through auth, service, persistence reads, DTOs and consumers. Reverify the inherited assumptions for the stage and its next consumer. Look for omitted live callers, stale-error writes, changed defaults/partial success, accidental provider work and measurements that pass for the wrong reason. Check the previous stage's protections still hold. Do not edit or run competing builds. Return findings with file:line, the disconfirming check, tests actually run or NOT RUN, unknowns and READY / READY WITH NAMED CHANGES / NEEDS REWORK. Distinguish pre-existing issues from regressions. Do not add unrelated redesigns.

Receipt template, stored outside the reviewed specification:

```text
Stage / reviewer ID / fresh context: yes
Source HEAD / prior stage commit / dirty-file diff hash
Plan SHA-256 / source files and symbols re-read
Assumptions tested / contrary cases checked
Tests actually run / test-log location / build flavor
Timing sample count and conditions / call-count evidence
Findings and dispositions / residual unknowns
Verdict / executor acceptance / next stage or stop
Rollback commit or deployment
```

Two correction rounds maximum before the executor adjudicates scope or narrows the stage. Correctness remains blocking; style does not. Any substantive correction after a review requires a bounded fresh recheck. A receipt must fingerprint the version actually read; changing the plan requires a new hash and review of the changed contracts.

## Planning verification and remaining blockers

[VERIFIED via local commands] Twelve existing suites passed, 195 tests: dashboard service, Tracker dashboard service, resolver service/route, request-page context, shell, Proposal documents, Overview/Status, read-coalescing call counts, site-visit adapter, Tracker pages and API request helper. This establishes the bounded current behavior only. Proposed tests above still need to be created during authorized implementation.

[VERIFIED via sequential startup checks] All discovered `check:*` commands except `check:drain-table-mentions` and its self-test exited zero, including types. The red gate flags `docs/atlas/postgres-transcription-pilot.md:72`, where a link to the Meeting Tracker publication Atlas matches the drained-table scanner. Its self-test fails because its baseline is red. This task leaves that unrelated document unchanged; resolving it is an explicit implementation-baseline prerequisite, not permission to weaken the gate. No green whole-repository baseline is claimed.

No fresh canonical build, browser timing run, live production measurement or migration execution was performed while writing this plan. The existing build artifacts have unproven provenance. Dependency availability differs from the manifest range: the inspected local installation reports Next 16.3.5 and React 18.3.1, while `package.json` declares ranges beginning at Next 16.2.12 and React 18.2.0. Stage 0 uses a reproducible lockfile installation and records exact versions; do not upgrade incidentally.

External references checked for the conditional experiments: [TanStack Query cancellation](https://tanstack.com/query/v5/docs/framework/react/guides/query-cancellation) describes AbortSignal consumption; [Next Pages lazy loading](https://nextjs.org/docs/pages/guides/lazy-loading) documents `next/dynamic`. Recheck APIs against the selected installed version before implementation. Neither reference establishes a performance win in this repository.
