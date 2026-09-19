---
title: Workbench Responsiveness Migration Plan
domain: architecture
kind: plan
status: active
summary: "Authorized staged implementation: measure and ship local refresh/waterfall fixes first; shared caching and code splitting remain evidence-gated."
canonical: false
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md
---

# Workbench responsiveness: small improvements before shared caching

## 1. Decision and authorization

**[PLANNED]** Preserve useful content during same-context refresh and remove
independent-read waterfalls before adding a shared query layer. This supersedes
the original cache-first stages at commit `2e611d9a`. The user authorized revision
and implementation, with Luna doing reconnaissance/builds, Sol reviewing, and the
root orchestrator accepting stages and resolving review loops. Production promotion,
live writes/sends and provider calls are outside this execution.

Work on `codex/workbench-responsiveness` in an isolated worktree. Treat the combined
release as Tier 2, with explicit owner promotion under the release strategy. No
runtime changes land directly on main. Each accepted stage is independently
revertible. Preserve existing routes, API envelopes, domain services, auth guards,
server authority, and mutation semantics.

The expected benefits are less blanking during refresh, faster independent content,
and potentially faster revisits. **[UNKNOWN]** Production latency distributions and
revisit frequency have not been measured. Do not call this the objectively largest
production bottleneck or promise a percentage gain. Complete the justified local
stages; conditional stages can be explicitly omitted with evidence, not left as
implicit unfinished work.

| Alternative | Decision |
|---|---|
| Same-key RequestList/Reviews refresh retention | First implementation arm; no dependency |
| Explicit-URL dashboard waterfall removal | First arm, only when program context is unambiguous |
| Proposal/Overview GUID-only parallel reads and rendering | First arm; preserve independent API guards |
| Shared browser cache | Conditional incremental arm after local fixes; no adoption by default |
| Lazy tab imports | Separate measured experiment, independent of caching |
| Server cache, App Router/auth rewrite, Find bootstrap, list virtualization | Excluded without a new measured problem; do not expand this task |

## 2. Source baseline and evidence ledger

Planning baseline: `7c18b62290d15076452c364a76e2e61298b88db6`, inspected 2026-09-18 PT.
Anchors below refer to that source tree; re-resolve symbols at every stage.
Source proves mechanisms, not production milliseconds.

| ID | Verified mechanism | Evidence |
|---|---|---|
| E1 | Workbench navigation is already shallow; inactive dashboard panels unmount | `shared/components/workbench/WorkbenchShell.js:63–72,244–302` |
| E2 | Request list fetches on filter/mount changes and replaces rows during loading; triage reloads it | `shared/components/workbench/RequestListPanel.js:113–153,163–201,234–235` |
| E3 | Follow-up fetches the dashboard and reviewers concurrently, then joins their full responses; it already retains same-context rows on refresh | `shared/components/workbench/ReviewerFollowUpPanel.js:191–246,338–402` |
| E4 | Request shell context has no generation guard/reset; active tabs conditionally mount; request-keyed reviewer remount is intentional | `pages/workbench/[requestId].js:101–114,179–247` |
| E5 | Proposal documents wait on `context.requestId`; Overview reviewer rollup mounts only after context exists | `shared/components/workbench/ProposalTab.js:498–528`; `shared/components/workbench/OverviewTab.js:72–95,116–123,194` |
| E6 | Both endpoints in E5 independently authenticate and validate the GUID. Document service derives request number/cycle itself; rollup needs only GUID | `pages/api/workbench/proposal-documents.js:24–53`; `lib/services/workbench/proposal-documents-service.js:32–48`; `pages/api/workbench/reviewer-rollup.js:30–73` |
| E7 | Reviewers and Reviews fetch the identical per-proposal GET; Reviews also consumes `liveQuestions` | `shared/components/reviewers/ReviewersTab.js:156–192`; `shared/components/workbench/ReviewsTab.js:882–909` |
| E8 | Reviewer refresh intentionally reloads candidates, reviewers and referrals. Confirmed invite IDs overlay lagging reads, followed by delayed reconciliation | `shared/components/reviewers/ReviewersTab.js:195–243,273–292` |
| E9 | Reviewer background polling already preserves the panel and is bounded; it must not be duplicated | `shared/components/reviewers/ReviewersTab.js:156–188,445–465`; `tests/unit/reviewers-tab-review-document-refresh.test.js` |
| E10 | Dashboard cycles and proposals are distinct API modes. Default cycle depends on calendar/program; visibility, counts and authority are server-derived | `lib/services/workbench/dashboard-service.js:78–92,113–200,203–264`; `pages/api/workbench/dashboard.js` |
| E11 | Private provider stack is above pages; public/auth/external/applicant pages intentionally skip it | `pages/_app.js:11–57`; `shared/context/AppAccessContext.js`; `shared/components/RequireAppAccess.js` |
| E12 | Dashboard and request shell statically import their panels | `shared/components/workbench/WorkbenchShell.js:24–29`; `pages/workbench/[requestId].js:28–37` |
| E13 | IA cycle D26 performs no read; Awardees scope and Final Writeups selectors differ from the dashboard program contract | `shared/components/workbench/InitialAssessmentsPanel.js:25–52`; `shared/components/workbench/AwardeesPanel.js:32–137`; `shared/components/final-writeups/FinalWriteupsViews.js:636–698`; `WorkbenchShell.js:157–165` |

**[VERIFIED via local commands]** All 67 startup check/self-test commands passed.
The 12 bounded suites in §9 passed: **128 tests**. No new test or runtime code was
written for this plan. No current canonical build or browser benchmark was run;
historical release builds are not evidence for a new implementation.

### Contract trace and persistence

Current list: WorkbenchShell URL state → dashboard cycle GET → authenticated route
→ loadDashboard → program/PD resolution → grant-request adapter → Dataverse
`akoya_requests` → reviewer-rollup service → projected response → RequestListPanel.
Follow-up additionally consumes the cycle reviewers projection.

Current request: route GUID → resolve-request guard → resolveWorkbenchRequest →
grant-request adapter + fail-soft Co-PI junction read → full context DTO → header,
Overview, Status, Proposal, management display. Proposal listing independently
reads request scope and SharePoint document listings; reviewer rollup reads the
engagement ledger. Reviews consumes the existing reviewer-service DTO, including
question/answer and synthesis projections. Any later cache must preserve those DTOs, not invented entities.

**[PLANNED] Persistence change: none.** Dataverse/SharePoint/Postgres ownership and
all writes remain where they are. Any conditional client cache would be disposable browser
memory only, containing authorized GET responses; no localStorage, IndexedDB,
service worker, persisted cache, signed document bytes, or server singleton.

## 3. Behavioral contracts

### Local reads and refreshes

- Retain successful data only for the exact same request or server-input tuple.
  An empty successful result counts as loaded. Changed request/program/cycle/scope
  must not show the prior context even for one render. Use existing generation
  guards plus a keyed successful snapshot, not a generic previous-data fallback.
- For readers changed in S1–S3, ordinary refresh failure may retain same-key data with an explicit error/retry
  message. HTTP 401/403 and invalid/wrong-context payloads clear or suppress the
  protected projection. Test denial **after seeded success**, including controls.
- Keep initial loading separate from updating. Preserving children changes their
  lifetime: draft, clipboard/export, synthesis and manual-entry tests are mandatory
  before retaining Reviews children. Do not preserve inactive workflow tabs.
- No new focus/reconnect refresh, polling, automatic command retry or GET on local
  search/sort/filter changes. Keep existing poll ownership/timing/stop conditions.
- Keep every response envelope and partial-success behavior. `liveQuestions` is
  part of the reviewer response. Candidates/referrals and confirmed invite overlays
  remain in their existing owner. No changes to reviewer Find or its F1–F4 backlog.

The unchanged Follow-up panel currently retains rows on any read failure, including
denial. That pre-existing behavior is outside these stages; its retention pattern
is not proof that denial-after-success is already handled. The denial assertion
above applies to modified readers and any later selected cache resource.

### Callback contracts are per caller

`ReviewersTab.refreshAll` starts candidates/reviewers/referrals and returns void;
keep it fire-and-forget, never rejecting. `ReviewsTab.load` and manual-submission
handling are asynchronous, catch read errors, and settle after the reload; preserve
that await before clearing manual entry. Follow-up's load is also asynchronous and
catches errors; inspect its actual host adapter before changing it. Do not globally
convert all callbacks to void or expose query-library throw semantics to callers.
A confirmed write followed by a failed refresh remains a confirmed write.

Triage stays one command, one list reload and one generation-guarded count patch.
No cycles GET is added by triage. If cycles are cached later, patch the active
matching entry once and mark other variants stale with `refetchType: 'none'`;
explicitly refetch only sources the original callback actually refreshed.

### Request context and Primer

Keep context outside the proposed cache. Add request isolation where needed for
independent rendering: a response/error/finally for A cannot affect B, and context
must match the current route before reaching child props or canManage. Retain the
current once-per-request fetch policy. Do not introduce focus, reconnect or tab-
navigation context refetch, action suppression leases or a principal-transition
state machine.

Primer generation/export is unchanged by these local improvements. Its returned
local envelope can be valid with `persisted:false`; do not refetch/replace it as a
side effect of this task. Updating Overview's Primer chips after generation is a
separate existing freshness defect, not prerequisite performance work. If a later
stage needs a new context-refresh policy, stop that stage for a bounded design
review instead of reconstructing the removed lifecycle protocol.

## 4. Measurement and branch acceptance

Luna owns test/build execution; reviewers do not run competing builds or fixture-
writing gates. Use isolated Mode A only: no `.env*` secrets or `.vercel`, minimal
allowlisted child environment, throwaway test auth secret and localhost URLs.
Route-mock every browser `/api/**` call and fail unmatched routes. This does not
isolate instrumentation by itself: verify no real credentials enter server startup.
Do not copy main-checkout environment files to make tests pass.

Reuse the real-page/auth fixture pattern in
`tests/e2e/program-director-invite.spec.js`. Proposed new harness:
`tests/e2e/workbench-responsiveness.spec.js` and a helper only if needed. Record
baseline and candidate commit, build flavor, browser/Node version, fixtures and
fixed synthetic API delays. Use held responses for deterministic ordering and
fixed delays for comparative timing; these are distinct assertions.

Compare arms:

1. A: unchanged runtime at `2e611d9a` (test-only commits allowed).
2. B: local improvements from S1–S3.
3. C: only if warranted, a bounded cache experiment for a specific revisit journey.

Record useful-content and fresh-content time, blank duration, endpoint/method counts,
initial JS transfer and active pollers. Use the same delay/data/environment for A/B,
multiple repeated samples (target 20 for timing conclusions), median and exploratory
p95. Do not assert production latency from these fixtures. Existing deployed
observability may inform route selection if read-only telemetry is already available;
record unavailability rather than provisioning observability or accessing production
data to satisfy this task. Production revisit frequency remains unknown without data.

| Journey | Required result |
|---|---|
| Same-key triage/list refresh | Rows or successful empty state stay visible while reload held; one POST + one list GET, zero new cycles GETs |
| Explicit program+cycle dashboard entry / Back | List starts before held cycles response; no wrong-program fallback, preserved default-path behavior |
| Direct Proposal/Overview with held context | Document/rollup GET and useful section appear independently; no extra analysis/generation/download |
| Reviews refresh / manual receipt | Same-request content and allowed drafts survive; manual completion keeps its existing await; full DTO retained |
| A→B, filter/program changes, stale failures | No wrong-context content or late writes; newer owner wins |
| S1/S3 changed reader success then 401/403 | Protected rows/actions disappear; ordinary network failure is distinct |
| Focus/reconnect during open dialogs/actions | No new GET or automatic state reset |

Cold-path API counts may not increase from A. No >10% repeatable cold useful/fresh
latency regression without root acceptance of a named tradeoff. A held-response
snapshot beating the response is correctness evidence, not proof of net benefit.
At S3, stop expansion if B addresses the observed problem; C must add demonstrated
benefit beyond B for an identified journey. Unmeasured revisit frequency cannot
justify migrating every panel. Bundle splitting must reduce initial bytes without
materially delaying first use; omit it otherwise.

## 5. Stages and prerequisite tests

Each stage begins with existing passing characterization tests. Add discriminating
new behavior tests and show they fail for the intended old behavior before the fix;
commit only the green stage. Run the §9 gate and fresh Sol review before proceeding.
No stage assumes a proposed file already exists.

### S0 — Reconnaissance, baseline and fixtures

Prerequisites: clean intended branch, baseline HEAD, existing Workbench/Reviews/
Primer test suites. Run all current `check:*` scripts sequentially, baseline Jest,
lint/types and canonical build. Add route-mocked browser characterization and an
endpoint census for the §4 journeys; keep baseline expected behavior explicit.
No runtime moves. Root revises this plan using reconnaissance, then fresh Sol
reviews plan/source assumptions before runtime changes begin.

Exit: baseline evidence recorded, production unknowns explicit, local stage scope
frozen. Missing runtime/browser tooling is a reported verification blocker, not a
reason to claim success from unit tests alone.

### S1 — Retain RequestList and remove the explicit-URL waterfall

Prerequisites: existing workbench-shell, request-number-lookup, reviewer-follow-up
and dashboard service tests. Add cases for same-key held refresh, successful empty,
network error, 403 after success, changed-key late success/error, triage counts and
focus. Pin explicit program+cycle versus missing/default program, program switch,
unlisted cycle and cycles failure. Preserve server-dependent default resolution.

Order: tests → `RequestListPanel.js` exact-key loaded state/render guard →
`WorkbenchShell.js` early explicit-cycle dispatch only with safe program scope →
counts/callback parity tests. No file relocations, hook extraction or dependencies.
Do not treat URL cycle alone as proof that the default program is resolved.
Pass only cycle metadata belonging to the current program. During an early list
read, show rows but defer cycle-derived counts and triage controls until the
matching cycles GET succeeds; this preserves their existing prerequisite rather
than inventing a new permission rule. Test A→B Back navigation with the same cycle,
held cycles → rows visible/no old counts or triage → cycles success → one triage
POST/list reload/count patch. A cycles error must retain retry and must not strand
an unexplained disabled control. If this requires broader coordination, omit the
early URL arm and retain the list-continuity change.

Exit: same-context list stays visible, explicit safe URL begins independent work,
triage counts/requests unchanged, default path stays correct. Revert S1 commit to
rollback; no durable writes/schema changes introduced.

### S2 — Independent Proposal and Overview reads

Prerequisites: Proposal documents, Overview status, request-resolution and Primer
export suites. Add held context, missing/failed context, wrong request context,
A-slow/B-fast, unmount, partial document errors, 403 and exact GET-count tests.
Characterize context-only component callers before changing signatures.

Order: tests → request-page context identity/generation fence → explicit route GUID
prop to `ProposalTab` (tested context-only fallback) → separate document rendering
from context loading guard → `OverviewTab` independent rollup rendering. Keep
existing pure GET owners in the components; no shared query layer is needed.
Fence document/rollup snapshots at render time by request identity or key their
owners by request. Parent context fencing alone is insufficient: old child state
survives until effects clear it. Assert A→B synchronously before effects settle,
including A document links and reviewer counts, not merely after B responds.

Exit: independent reads and useful sections render before context, request A never
supplies B's fields/permissions, no new automatic commands, Primer tests unchanged.
No context refresh callback is added. Revert this stage independently of S1.

### S3 — Reviews refresh continuity and comparison checkpoint

Prerequisites: reviews-tab, reviewer stale-request, post-send, document-refresh,
manual-review and synthesis tests applicable to the changed logical regions.
Add mounted-child tests for ManualReviewEntryForm, SynthesisCard, ExportMenu,
WriteupParagraphsCard and ConsultantFeedbackSection; preserve drafts and held
clipboard/export work, manual submit/reload ordering, success then 403, changed
request and late callbacks. Use existing child-specific suites when they cover
these cases rather than building decorative duplicate tests.

Order: tests → `ReviewsTab.js` exact-request loaded identity and separate updating
state → error/denial handling → lifecycle fixes only when directly necessary for
retention. `ReviewersTab`, its polls/three-source refresh and candidates remain
unchanged. If retention needs a new workflow state machine, keep the affected child
behavior and narrow the improvement instead.

Exit: useful content stays during same-request refresh, callbacks preserve timing
and error behavior, no duplicate operation/poller. Compare arm B to A. Root and Sol
record whether caching or code splitting earns a bounded experiment. A documented
omit decision is a completed conditional gate, not authorization to expand scope.

### S4 — Conditional shared-cache experiment, not blanket migration

Start only if S3 demonstrates residual revisit delay worth addressing beyond B.
Before any dependency or provider change, name the one target resource/journey,
benefit threshold, full consumers and mutation producers in the execution receipt.
Keep request-context, auth providers, Find, and the single-consumer cycle panels
outside this experiment. If no justified resource is identified, mark S4 omitted.

If selected, use TanStack Query v5 with exact compatible version verified before
installing, not a custom query engine. Defaults: staleTime 0, bounded gcTime,
retry false, focus/reconnect false, no new polling. Preserve full DTOs. Identity
partition uses stable session Azure/profile identity; dispose on real principal
change/logout/leaving Workbench, preserve same-principal transient loading without
cross-principal data. Existing guards remain authoritative; no refreshAccess
orchestration or new grants/preview authority gate. Explicit denial clears the
scoped entry and render projection. A test must seed success before denial.

Prerequisite tests: identity A→B/logout/loading; exact key params and empty response;
403/malformed after success; obsolete GET cancellation/publication; required
mutation invalidation; callback void versus await contracts; no extra focus GETs.
If reviewer sharing is selected also test implicit sub-tab stability across
snapshot→fresh, pending-document poll limits and all confirmed-invite overlays.
Do not freeze sub-tabs without pinning intended post-mutation navigation behavior.

Order only after selection: package+lock → policy/keys/GET helper → scoped boundary
→ one resource hook → first consumer → second consumer → invalidation adapters.
Proposed files under `shared/components/workbench/data/`; no server imports or
barrel importing UI trees. Active invalidation uses `refetchType: 'none'` where
existing behavior requires no GET; explicitly start only required reloads. Revert
consumer commits before boundary/dependency. Stop experiment if no incremental
benefit; no automatic S6-style migration of all remaining panels.

### S5 — Conditional lazy-import experiment

Prerequisites: production bundle measurement, deep-link/back/forward and first-tab
use tests. Independent of S4. If initial transfer/parse is not a demonstrated
problem, omit. Change one import at a time using supported `next/dynamic`, default
SSR, no background mounts/prefetch workflow side effects. Order: request page
ReviewPanelTab → ReviewersTab → ReviewsTab; then dashboard FinalWriteupsPanel named
export → AwardeesPanel. Other tabs only if the same measurement proves benefit.
No file moves; preserve exports and useful loading/failure behavior. Revert splits
that merely move delay to first use. Sol reviews each accepted slice.

### S6 — Final verification and release handoff

Prerequisites: every selected stage green; explicit decisions for S4/S5; no open
correctness finding. Run §9 final gates, browser journeys and compare evidence.
Update execution receipt and source docs only where ownership actually changed.
Root reviews final diff after Sol acceptance and may fix concrete findings.
Deliver branch/commits, evidence, limitations, deliberate promotion requirements
and rollback. No merge/push to main or live rehearsal in this task.

## 6. File order and boundaries

```
S0 tests/fixtures only
S1 RequestListPanel → WorkbenchShell
S2 request page isolation → ProposalTab props/render → OverviewTab rollup render
S3 ReviewsTab loading/refresh → directly implicated child lifetime corrections
S4 optional package → policy/keys/parser → boundary → hook → consumers → invalidation
S5 optional one dynamic import at a time
S6 execution receipt and changed ownership documentation
```

Public filenames and exports stay stable. No wholesale file relocation is justified.
A later extraction removes its old live fetch effect in the same green commit so
there are never two owners. No API, database, provider or domain-service rewrite.

## 7. Review cadence and loop budget

Fresh Sol context reviews the revised plan before implementation, then each stage
against current HEAD, tests and actual source. Re-resolve E1–E13 at that HEAD;
record inherited assumptions checked, including unchanged contract consumers.
Review stage changes, not the author's summary. Trace caller/state/API/guard/
service/persistence/response/consumer where relevant. Distinguish existing defects
from regressions and correctness blockers from style preferences.

Luna owns changes and test/build commands; Sol is read-only. Sol can send concrete
findings to Luna, but root controls stage advancement. At most two correction
rounds per stage before root adjudicates/takes over. No optional stylistic finding
blocks progress; do not weaken a correctness test to end a loop. After substantive
root changes obtain a bounded Sol recheck, then root final acceptance.

Review receipts live separately in the execution receipt: model/reviewer ID,
reviewed HEAD/diff and SHA-256 of this plan **before `## 11.`**, inherited assumptions
re-verified, files read, tests actually run, findings/dispositions, residual unknowns
and next stage. Receipt text cannot silently change the reviewed specification.
No paid review product. Runtime correctness and measured benefit are separate gates.

## 8. Contract audit scope

Whole-flow and partial-success: preserve existing authenticated reads, DTOs,
confirmed writes and local envelopes; no new writes. Async audit covers every
changed post-await success/error/finally and changed-context render. Extraction
audit is N/A unless S4 earns a hook; then prove consumer equivalence first.
Durable-state/schema/enum changes are N/A. Documentation reconciliation covers
this revised plan and its execution receipt; old decisions remain only in git
history, not contradictory live stages. Excluded domain plans remain independent.

## 9. Verification commands

Baseline targeted suites: workbench-shell, workbench-request-number-lookup,
workbench-dashboard-service, workbench-resolve-request-service,
workbench-overview-status, workbench-proposal-tab-documents, reviewer-follow-up,
reviewers-tab-stale-request, reviewers-tab-post-send-refresh,
reviewers-tab-review-document-refresh, workbench-read-coalescing-stage2-characterization,
workbench-read-coalescing-stage2-callcounts, reviews-tab and primer-export (resolve
exact existing filenames before invocation).

Each selected implementation stage:

1. Run its prerequisite and changed-surface suites; prove newly introduced behavior
   fails on the baseline when feasible without overwriting another agent's work.
2. Full `npm test -- --runInBand --silent`, `npm run lint`, `npm run check:types`,
   and canonical `npm run build`. Only one build owner per checkout. An environment
   failure remains distinct from a green build; escalate canonical Turbopack sandbox
   issues rather than substituting Webpack success.
3. Run applicable route-mocked browser journeys with `npm run test:e2e --
   tests/e2e/workbench-responsiveness.spec.js --project=chromium`. Record whether
   Playwright uses its configured Webpack build. Never concurrently overwrite `.next`.
4. Relevant documentation/security/boundary gates for touched surfaces; every gate
   and self-test run sequentially. At S0/S6 run all current `check:*` scripts.
5. Sol review → bounded corrections → root acceptance → green stage commit.

No new production claim follows from mocked tests. Record all skipped/blocked
verification honestly with its impact. Do not call a red stage complete.

## 10. Stop and rollback

Stop the affected change on wrong-context rendering, denied data retention,
changed command semantics, lost confirmed result, duplicate polling/requests,
new client authority gate or unmeasured expansion. Keep the smallest working
improvement, not a framework justified by its own complexity. Production telemetry
and campaign timing remain unknown until separately established before promotion.

Revert stage commits in reverse dependency order; local S1–S3 require no database
repair. If S4 is selected, revert its consumers before its boundary/dependency.
Do not merge main to rescue an incomplete stage, and do not deploy from this work.

## 11. Revision and execution receipts

Original plan at `2e611d9a` received four planning reviews. Claude's subsequent
independent review correctly challenged cache-first scope and default automatic
refresh. This revision replaces those stages rather than appending exceptions.
It adopts local-first comparison, callback-specific contracts, explicit no-refetch
invalidation, denial-after-success tests and evidence-gated expansion. It does not
adopt unconditional post-generation refetch (unpersisted envelopes are valid), a
universal void callback, or the claim that `_app` cannot receive page props.

User subsequently authorized this revised implementation and the Luna/Sol/root
workflow. Execution status, hashes, review records, command results and conditional
stage decisions belong in a companion execution receipt created during S0. The
prior 128-test planning baseline is historical; new execution evidence must identify
its own HEAD and commands. Nothing in this revision claims runtime changes shipped.
