---
title: Workbench Responsiveness Migration Plan
domain: architecture
kind: plan
status: draft
summary: Proposed staged migration of Workbench read lifetimes, navigation loading, and refresh continuity; implementation is not authorized.
canonical: false
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md
---

# Workbench responsiveness: preserve reads across navigation

## 1. Decision and authorization boundary

**[PLANNED] Recommendation:** move Workbench GET-response ownership out of individual
panels into a small, session-scoped client query layer. Keep the existing pages,
URLs, route guards, API envelopes, domain services, and mutation workflows.
Render an already-loaded resource while revalidating it; start independent reads
concurrently; load expensive tab code only when needed.

This is the largest coherent performance refactor supported by this inspection:
the dashboard and request workspace share the same read-lifetime problem across
multiple journeys. It is not a claim that this is the objectively slowest code in
production. **[UNKNOWN]** Current production p50/p95, dependency latency, browser
CPU cost, and compressed chunk sizes have not been measured in this planning task.
Stage 0 can shrink or stop the plan when measurements contradict the hypothesis.

The owner authorized **scoping and a migration document only**. No migration,
dependency installation, live data probe, provider call, or deployment is authorized
by this document. A future implementation belongs on a `codex/` feature branch.
Treat the aggregate release as Tier 2; reviewer mutation integration may require
Tier 3 treatment under the campaign release strategy. Do not push runtime stages
directly to production `main`.

### What a user should notice

- Returning to a recently visited list or read tab shows its last successful data
  immediately, with a small updating indicator rather than a full-panel spinner.
- Refreshing a populated list does not remove its rows or move the user's focus.
- Opening Proposal or Overview no longer serializes an independent read behind
  the header/context request.
- Opening a request downloads less unused tab code if the bundle experiment passes.
- Known mutations refresh all existing dependent surfaces without requiring F5.

**Limits:** a hard browser reload still starts a fresh in-memory cache. The plan
does not make external services or LLM generation intrinsically faster. Reusing a
snapshot is not a fresh server confirmation. Most remounts still revalidate: the
initial policy deliberately uses `staleTime: 0`, so the plan does not promise zero
warm network traffic. Concurrent identical reads can share a request.

### Alternatives considered

| Candidate | Source evidence / limitation | Decision |
|---|---|---|
| Workbench read lifetime and refresh continuity | Matching GETs in multiple consumers; conditional panel mounts; visible loading replacement; avoidable client waterfalls | Selected |
| Reviewer Find warm bootstrap | Proposal POST, applicant ingestion/enrichment, durable roster, document identity and open F1–F4 follow-ups | Separate project; do not absorb it |
| Server read coalescing | Existing tests already pin merged person reads; earlier coalescing is not new work | Preserve; only revisit with new timing evidence |
| Global server cache / new aggregate data API | Adds permission, invalidation, and partial-response contracts; no measured justification here | Excluded |
| App Router / authentication migration | Large blast radius; current navigation already shallow | Excluded |
| Virtualize every list | No measured DOM/render bottleneck yet | Reconsider only if Stage 0 proves one |

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
question/answer and synthesis projections. Cache those DTOs, not invented entities.

**[PLANNED] Persistence change: none.** Dataverse/SharePoint/Postgres ownership and
all writes remain where they are. The added client cache is disposable browser
memory only, containing authorized GET responses; no localStorage, IndexedDB,
service worker, persisted cache, signed document bytes, or server singleton.

## 3. Target contract — freeze before implementation

### 3.1 Library and owner

**[PLANNED]** Use `@tanstack/react-query` v5, one dependency, with an exact version
pinned in `package.json` and lockfile during Stage 1. Re-check its React 18 peer
compatibility before installation. Use its query lifecycle, cancellation and
garbage collection rather than building a new query engine. No devtools, persistence
plugin, SSR dehydration, or mutation-framework conversion is needed.

Place a proposed `WorkbenchDataBoundary` inside the existing authenticated
Profile/AppAccess providers in `_app.js`. It must remain the same mounted boundary
between `/workbench` and `/workbench/[requestId]`, survive shallow navigation, and
discard its client on leaving the Workbench. Never instantiate a server-global
QueryClient. Existing `RequireAuth` and `RequireAppAccess` remain authoritative UI
guards; every API keeps its own authorization and DAL context.

Partition the boundary by session principal (Azure identity/profile ID), nullable
session Dynamics actor ID, current profile ID when associated with that principal,
sorted app grants, superuser status, and preview-read-only mode. Only non-secret
identity values belong in the partition. **Known-null actor is valid**: auth can
emit `dynamicsSystemuserId:null` and current guards still allow reads. Do not require
every key field to be truthy or turn a preferences/profile-loading failure into a
new app-access rule. Use an explicit unresolved-profile sentinel instead of treating
a previous session's still-rendered profile as the new principal's profile.

During initial session resolution, preserve mounted children as RequireAuth does,
but expose no cached protected data. Authenticated session plus a completed,
successful existing access check enables reads; the existing approved auth-disabled
local mode uses the shared `getAuthEnabled` result and an isolated local partition,
not an invented truthy session requirement. On a real principal change, synchronously
disconnect the old query client before rendering any query consumer; cancel/discard
it. Call existing `refreshAccess()` once for that transition (not on ordinary route
changes). Hold the new client unavailable until that refresh completes successfully
and current access state is no longer loading/error. Guard its completion by the
principal/transition generation; a late A refresh cannot release B. Initial provider
mount already fetches access: do not duplicate that read. This boundary does not
prove grants belong to a principal simply by copying them into a key. If implementing
the transition requires changing provider contracts beyond this callback integration,
stop and re-scope instead of rewriting authentication.

Sign-out, confirmed access loss, and boundary disposal discard cached responses.
Ordinary same-principal access loading hides protected query projections while
existing guards show their normal loading/retry UI. Do not infer server authority
from this client partition. API authorization is unchanged.

### 3.2 Explicit policy

The proposed `shared/components/workbench/data/query-policy.js` owns these
engineering defaults (not a new staff-facing settings system):

- `staleTime: 0`; `gcTime: 300000`; `retry: false`; `refetchOnMount: true`;
  `refetchOnWindowFocus: true`; `refetchOnReconnect: true`.
- No query-level interval by default. Existing workflow polling keeps its timing,
  stop conditions, attempt limits and owner; do not add a second poller.
- Pass the query's AbortSignal into GET fetch. Cancellation prevents obsolete
  client publication; it does **not** prove server/provider work stopped.
- No `keepPreviousData`/placeholder reuse across different keys. A successful
  empty array is loaded data. Only the exact same scoped key can reuse data.
- Background HTTP/network failure retains the same-key snapshot with a visible
  retry/stale message. Initial failure shows the existing error/Retry affordance.
  Authorization denial or malformed/wrong-context payload must not retain a
  misleading successful projection. Test both HTTP and application envelopes.
- Do not automatically retry any mutation, stream, email, generation or upload.
  Domain forms, selections, confirmations, notices, overlays and action locks stay
  with their existing owners. Do not keep inactive tabs mounted.

These policies favor immediate visual reuse and bounded freshness. Positive TTLs,
prefetching, long-lived offline data, and suppression of broad mutation refreshes
are excluded. There is no automatic reload on every keystroke or visual filter:
query keys include only actual server input.

### 3.3 Resource catalog and exact cache equivalence

All keys start with `['workbench', partition, resource, parameters]`. Normalize
validated GUIDs to lowercase; preserve non-GUID opaque keys byte-for-byte.
The partition is fixed by the boundary; parameters below are plain serializable
objects. Distinguish missing/default program from an explicit program. Do not seed
an explicit-program cache entry from a default-program response without a tested
aliasing contract (none is proposed).

| Resource | Server parameters / full envelope | Planned owner |
|---|---|---|
| dashboard-cycles | `{programId: explicit GUID or null}`; whole response incl. cycles/defaults/programs | `useWorkbenchDashboard.js` |
| dashboard-requests | `{programId, cycleCode, scope, includeSetAside}`; whole response incl. rollup | `useWorkbenchDashboard.js` |
| request-context | `{requestId}`; entire resolve DTO | `useWorkbenchRequestContext.js` |
| reviewer-rollup | `{requestId}`; counts, needed, hint, workRemaining | `useWorkbenchRequestReads.js` |
| proposal-documents | `{requestId}`; entire document envelope incl. partial errors | `useWorkbenchRequestReads.js` |
| request-reviewers | `{proposalId}`; entire `{success, proposals, liveQuestions, ...}` | `useWorkbenchReviewers.js` |
| cycle-reviewers | `{cycleCode, scope, programId}`; whole reviewers response | `useWorkbenchDashboard.js` |
| cycle-initial-assessments | `{cycleCode}`; disabled for D26 or absent cycle | `useWorkbenchCycleReads.js` |
| cycle-staff-deliberations | `/api/workbench/staff-deliberations` with `{cycleCode, scope}`; both are server inputs | `useWorkbenchCycleReads.js` |
| cycle-final-writeups | `{selector}` where uncycled uses existing `NO_CYCLE`, not empty cycle | `useWorkbenchCycleReads.js` |
| cycle-awardees / awardee-cycles | Exact cycle/all server inputs / no-query mode respectively; distinct keys | `useWorkbenchCycleReads.js` |

Preserve JSON envelopes in cache; project them in existing consumer functions.
Never use the dashboard row as a complete request-context response. Never turn
`reviewer-rollup` into the expensive reviewer-detail GET. Never conflate cycle and
request variants of an endpoint. Search/PD/status filters that are local today
remain local and create no cache variants.

### 3.4 Refresh and mutation contract

Initially preserve each existing explicit loader callback and every broad refresh.
Implement the callback with query cancellation/refetch when its read is migrated;
do not merely return cached data from a callback that callers expect to refresh.
Invalidate inactive matching entries as well as refreshing active ones.

| Producer | Mandatory handling; legacy reads remain until their own stage |
|---|---|
| RequestList triage | Keep exact server command and generation-guarded count patch. Refresh active request list; invalidate all dashboard cycle/list variants, not just current filters. Do not double-apply deltas to both a local copy and query data. |
| Reviewer Follow-up embedded ReviewerManagePanel actions | Its onRefresh currently calls the two-source loadProposals. Preserve both forced GETs and invalidate cached request-reviewers/rollup entries as well; use the exact affected request when known, otherwise conservatively all cached variants of those resources. Test Follow-up action → previously visited request. |
| ReviewersTab refreshAll callbacks | Preserve three-source refresh, overlay shape validation, delayed reconciliation and poll behavior. Refresh shared request-reviewers; invalidate rollup and dashboard/cycle-reviewers views. Candidates/referrals stay locally owned. |
| Reviews manual receipt / reminder / synthesis callbacks | Preserve current command/result handling and required reload. Invalidate request-reviewers, rollup and affected list projections; never infer a row success from aggregate counts. |
| Proposal Field Primer actions | Preserve the command/export semantics and confirmed local envelope. Use the request/mount/action-owned context suppression protocol in S2, including cancellation before action, teardown fencing and a separate post-commit hold. Invalidate without refetch after confirmed generation; revalidate on subsequent tab navigation or explicit idle refresh. Never reset action locks through a new initialRaw prop mid-action. |
| Other document/awardee mutations outside migrated readers | Their local refresh remains. Cached list reads are stale and always revalidate on remount/focus; do not claim an immediate cross-tab signal from an unintegrated writer. |
| Other staff, cron, external reviewer, direct CRM edits | No push signal exists in this plan. Revalidate on mount/focus/reconnect and offer manual refresh. State this consistency limit. |

Before executing a migrated command's existing refresh: cancel older matching GETs
and fence their publication, then force the required reads. Mutation HTTP failure,
partial success, and unknown outcome keep the existing domain handling; refresh is
not evidence that a write failed or permission to resubmit it. Do not put confirmed
invite overlays into the raw reviewer DTO or invent a shared engagement state machine.

An invalidated snapshot may still appear while revalidation runs, explicitly marked
updating; invalidation does not erase data. Never describe it as confirmed current
state. Confirmed invite overlays and other existing command-result projections take
precedence in their existing owners. §4 tests must distinguish “old data marked
updating” from a forbidden regression that enables an already-completed action.

## 4. Measurement and acceptance contract

Stage 0 must create a committed, synthetic fixture-driven browser harness using
the real pages. Reuse the authentication/API mocking pattern from
`tests/e2e/program-director-invite.spec.js`; abort every unhandled `/api/**` request.
No real sends, generation, Dataverse reads, or upload calls. Record that route mocks
do not isolate server startup/background work: `instrumentation.js` invokes
auth-bypass and migration-drift checks which can write alerts. Use an isolated
tracked-files-only worktree, no copied `.env*` secrets or `.vercel` files, and a
minimal allowlisted child environment (PATH, CI=1, throwaway NEXTAUTH_SECRET,
local NEXTAUTH_URL and E2E_PORT). Do not inherit cloud/provider/database credentials.
Verify the isolated tree's env-file names before launch; do not print values.
CI=1 prevents reuse of an unrelated running Playwright server. Reuse the existing
test JWT and route-mock seam, not a production auth bypass. Missing-credential
startup warnings are expected; an attempted live dependency call is a failed
isolation preflight, not a reason to load production credentials.

Use production builds for timing, fixed browser/viewport/CPU/network settings, a
fixed seeded data fixture, and the same machine. Record commit, Node/browser/library
versions and build command. Measure at least 20 alternating baseline/candidate runs
per journey and report median plus p95 (exploratory, not an SLA), cold separately
from warm. Warm-up runs do not enter the sample. Record traces, failures and counts,
not only successful durations. Measure click→useful content, click→fresh confirmed
content, milliseconds of full-panel blank/loading, HTTP requests by exact endpoint,
transferred JS bytes, long tasks and active poll timers.

| Journey | Deterministic acceptance / proposed timing target |
|---|---|
| Requests → Follow-up → Requests, unchanged program/cycle/scope | Exact matching dashboard key reused; simultaneous consumers one GET. Warm render appears before held response is released; no full-list blank. |
| Dashboard → request → browser Back | Same-key data visible before background response, URL filters restored by existing history; no hard reload. Do not promise the explicit “Back to dashboard” link preserves filters; its current URL is `/workbench`. |
| Direct Proposal / Overview | Hold context response: independently authorized documents/rollup request starts before context resolves. Render independent section when available; header can still show loading. |
| Reviewers Track → Reviews → Track | Full shared reviewer envelope survives; no data loss, duplicate poller, automatic POST, lost question set, or widened permissions. |
| Triage/manual receipt/invite with delayed GET | Existing success/partial/error semantics preserved; same-context rows remain visible; stale pre-command GET cannot overwrite newer confirmation. |
| A→B→A and program/scope/account changes | Zero frames with another context's data; aborted/late success, error and finally do not affect active context. |
| Slow/offline/403 response | Prior exact-key read survives ordinary background failure with notice; access denial clears protected data; retry works. |

**[PLANNED targets]** For eligible warm journeys: useful-content p95 ≤100 ms under
the controlled fixture, and no full-panel blank between click and revalidation.
Cold Proposal/Overview should remove one serialized dependency: concurrent total
approaches `max(context, section)` rather than their sum. No >10% regression in
cold useful/fresh-content p95 or total route requests on the agreed fixture without
explicitly accepting the measured tradeoff. Bundle stage needs a real reduction
in initial transferred JS after including the query-library cost; otherwise omit it.
Never convert synthetic timing into a production latency claim.

## 5. Ordered implementation stages

Every stage has a prerequisite-test commit, then its bounded implementation commit.
New behavior tests may start red only on the working branch during that stage;
do not commit a red milestone. First add passing characterization tests; add the
new-contract tests immediately before implementation and demonstrate their intended
failure, then commit the green result together. No stage may begin until its named
prerequisites exist and the prior stage's full gate/review receipt is accepted.

All paths below marked **new** are proposed files, not existing implementation.
Public page/component paths and exports stay stable. “Move” means extract the named
logical region, update its imports, and remove the old duplicate owner in the same
green commit; do not copy whole components or leave two live fetch effects.

### S0 — Characterize, benchmark and freeze the boundary

**Before starting:** run the existing §9 suites; verify baseline SHA, no unrelated
WIP, and current release posture. No source moves.

**Add first:** `tests/e2e/workbench-responsiveness.spec.js` and
`tests/e2e/helpers/workbench-responsiveness.js` (**new**) with §4 journeys, held
responses and endpoint census. Add `tests/unit/workbench-read-contracts.test.js`
(**new**) to pin full consumer envelopes, empty/partial/error distinctions, default
program/cycle normalization, and per-request vs cycle reviewer projections.
Record baseline measurements in a companion execution receipt (**new**, created
only during implementation). Keep the three existing reviewer reconciliation suites.

**Exit:** browser baseline reproduced; exact duplicate GET equivalence documented;
before/after targets frozen; choose the smallest stage set justified by evidence.
If provider/server latency dominates and warm reuse is rare, re-scope instead of
executing a large client rewrite. Fresh review checks scope against source.

### S1 — Add an unused, tested query boundary

**Prerequisites:** S0 baseline plus tests for account A→B, logout, failed/loading
access, permission changes, preview mode, server render isolation, boundary disposal,
successful empty data, inactive garbage collection, and abort/no stale publication.
Use `tests/unit/workbench-data-boundary.test.js` and
`tests/unit/workbench-query-contracts.test.js` (**new**).
Include known-null Dynamics actor, delayed profile replacement, auth-disabled local
mode, initial access-fetch count, and A→B→C with out-of-order access-refresh completion.

**Order:** (1) exact dependency + lockfile; (2) **new** `data/query-policy.js`;
(3) **new** `data/query-keys.js`; (4) **new** `data/read-json.js`;
(5) **new** `data/WorkbenchDataBoundary.js`; (6) mount boundary in `pages/_app.js`.
The `data/` directory is under `shared/components/workbench/`.
`read-json.js` handles GET/AbortSignal/HTTP parsing only; resource-specific success
validation stays explicit. No existing consumer uses the cache yet.

**Exit:** navigation preserves one client; identity change replaces it before child
render; public routes perform no query work; no extra business GETs. Canonical build
proves the new dependency stays client-compatible. Rollback is dependency/boundary revert.

### S2 — Make request context isolated and reusable

**Prerequisites:** S1 tests plus request A slow/B fast, A→B→A, failed B after successful
A, late finally, unmount, GUID case, no `n` parameter, malformed/wrong-ID DTO, and
server-derived `canManage` display parity. Add
`tests/unit/workbench-request-context-lifecycle.test.js` (**new**).

**Order:** (1) **new** `data/useWorkbenchRequestContext.js` with full DTO and GUID key;
(2) replace only `ctx/error/loadCtx` ownership in `pages/workbench/[requestId].js`;
(3) preserve tab aliases, app guards, request-keyed remounts, and all props;
(4) add optional action-lifecycle callbacks to the local FieldPrimer owner in
ProposalTab, threading only to this context hook. This is a local read-suppression
contract, not a shared mutation framework:

- Suppression belongs to a token containing the partition, request ID, Proposal
  mount generation and action generation. Before generation/export starts,
  synchronously acquire that token and suppress context publication/automatic
  refresh, then await cancellation of the matching context GET before the action.
  Keep displayed context; only the current token may complete or release its hold.
- Confirmed generation invalidates context without refetch and retains a separate
  post-commit hold until this Proposal mount ends or the user explicitly refreshes
  while idle. Action `finally` releases busy but **not** the post-commit hold.
  Focus/reconnect/re-enabling must not overwrite the confirmed local envelope.
- Unmount, request change and partition disposal retire the token and that mount's
  holds. Fence late callbacks: they cannot release, invalidate or publish for a
  newer owner. Tab navigation releases the departing mount's holds and revalidates
  destination context. Preserve context-only ProposalTab callers using optional
  callbacks with the same original command/export behavior.

These are prerequisite tests before changing ownership: focus/late GET during
both generation and export; held action → leave Proposal → remount/start a second
action → settle the old action; confirmed generation → focus/reconnect/re-enable
before navigation; request/partition changes during each callback path; and
Overview revisit after leaving Proposal. The existing local token has no unmount
cleanup, so a boolean busy callback alone does not satisfy the contract.

**Exit:** warm header renders before refetch; context never belongs to the wrong
request; old context cannot feed a new request's Proposal or manage projection.
Test current owner/unknown/non-owner/superuser cases. No endpoint change.

### S3 — Share dashboard reads and keep the request list visible

**Prerequisites:** existing shell/request-number/follow-up suites plus exact-key
equivalence, default-vs-explicit program, D26/J27, unlisted cycle, cycle-fetch failure,
my/all, include-set-aside, A→B→A, and triage-in-flight with filter/program changes.
Add `tests/unit/workbench-dashboard-query-lifecycle.test.js` (**new**).

**Order:** (1) **new** `data/useWorkbenchDashboard.js` cycle and request definitions;
(2) move cycle fetch ownership from WorkbenchShell without moving URL state;
(3) move RequestListPanel loadProposals GET into hook, keep setTriage;
(4) preserve count-patch generation semantics with a single count owner;
(5) move Follow-up's two GETs to independently keyed queries, retain the existing
merge/filter/summary functions and combined error semantics;
(6) wire triage and Follow-up refreshes to required invalidation/refetch.

Do not show half a newly selected Follow-up context as a complete successful join.
Its prior same-key merged projection may remain while either request revalidates.
Do not reuse a dashboard variant with `includeSetAside=true` for one without it.

**Exit:** held-response test proves same-context rows/focus persist; filter changes
never display wrong-context rows; count patch applied exactly once; follow-up empty,
degraded and partial constituent responses match the specified contract. Query
counts prove concurrent dedupe, not fictional zero sequential requests.

### S4 — Remove the two independent-read waterfalls

**Prerequisites:** S2 plus Overview/Proposal document and primer-export suites.
Add `tests/unit/workbench-independent-reads.test.js` (**new**): hold resolve-request,
prove both target GETs need only GUID; preserve 403/404, partial document-library
errors, missing context, mismatched IDs, and superseded response behavior.

**Order:** (1) **new** `data/useWorkbenchRequestReads.js` with rollup/documents queries;
(2) pass explicit route `requestId` to ProposalTab, retaining a tested fallback for
existing context-only callers; (3) start docs query independently and split only
the context-dependent rendering guard from the documents section;
(4) move Overview's rollup read to the hook, render its section independently of
header/context; (5) preserve document download scope and AI/editor boundaries.

**Exit:** both queries start before held context resolves; available independent
section actually renders early (starting a hidden request alone is not acceptance).
No download, analysis, ingestion or generation is initiated automatically.

### S5 — Share the full reviewer GET between tracking and reviews

**Prerequisites:** S0 reviewer envelopes and all post-send/stale-request/poll tests;
add `tests/unit/workbench-reviewer-query-lifecycle.test.js` (**new**) with full
`liveQuestions`, synthesis, empty accepted list, accepted+removed candidate,
confirmed partial invite, lagging GET, manual receipt, unknown mutation outcome,
and navigation during reconciliation. Demonstrate old in-flight GET rejection.
Also characterize **mounted** refresh of SynthesisCard, ExportMenu,
WriteupParagraphsCard, ConsultantFeedbackSection and ManualReviewEntryForm: preserved
drafts, a held clipboard/export promise, synthesis result, manual submit/close, and
request switch. These children previously unmounted under ReviewsTab's loading
guard; keeping them mounted changes lifetime and needs direct tests. Existing
`tests/unit/reviews-tab.test.js` and primer/export suites remain required.

**Order:** (1) **new** `data/useWorkbenchReviewers.js`, cache full response;
(2) adapt ReviewersTab.loadReviewers only; leave candidate/referral loaders and
confirmed-invite overlay/timer in place; (3) adapt ReviewsTab.load;
(4) adapt existing refresh/poll callbacks to force fresh reads and preserve timing;
(5) add the invalidation matrix from §3.4, preserving all three refreshAll calls;
(6) separate initial loading from background updating in Reviews' render guard.

Keep raw server DTO and local action-derived projection separate. Do not use
query focus refresh to overwrite candidate overlays, open materials dialogs,
manual-entry forms, or user edits. Do not move Find loaders or `search/*` owners.
Unknown callbacks still invoke conservative existing refresh; do not introduce
selective invalidation without a complete producer/consumer proof.

**Exit:** one full-response owner across Track/Reviews, no lost questions, no
duplicate poller, and successful invites cannot reappear as unsent because of this
migration. Scope excludes suppressing expensive Find POSTs and F1–F4 fixes.

### S6 — Migrate remaining cycle read panels in four green slices

**Prerequisites:** shell tests plus each panel's current test suite. Before each
slice add exact parameters, empty-success, same-key background failure, changed-key
late response and inactive-remount tests to
`tests/unit/workbench-cycle-query-lifecycle.test.js` (**new**).
Existing suites by slice: S6a `workbench-shell.test.js` and
`workbench-initial-assessment-route.test.js`; S6b `staff-deliberations-panel.test.js`
and `workbench-staff-deliberations-route.test.js`; S6c `final-writeups-views.test.js`
and `workbench-final-writeups-route.test.js`; S6d `awardees-page.test.js` and
`grantee-awardees-route.test.js` (all under `tests/unit/`).

**Order, with the full exit gate and fresh review between slices:**

1. **S6a:** create **new** `data/useWorkbenchCycleReads.js`; migrate
   `InitialAssessmentsPanel.js` GET effect. D26 remains a zero-call path.
2. **S6b:** migrate `StaffDeliberationsPanel.js` GET effect; retain existing stage
   grouping and server `scope` parameter. No StaffDeliberationsTab command/poller migration.
3. **S6c:** migrate only `FinalWriteupsPanel` GET in
   `shared/components/final-writeups/FinalWriteupsViews.js`; preserve named exports,
   uncycled selector, PD/search filtering and queues. Leave focused-view mutations.
4. **S6d:** migrate `AwardeesPanel.js` cycle-data and empty-state cycle-options GETs;
   preserve context-key/version protections until their query equivalents are tested,
   lazy cycle-options condition, my/all and last-decided-cycle behavior.

**Exit per slice:** same-key immediate redisplay, scoped failure recovery, no new
GET on local filtering, no invented program filtering, no per-request governed
document state-machine changes. Preserve each old public component facade.

### S7 — Load inactive tab code on demand, only if the experiment wins

**Prerequisites:** all migrated reader tests and browser deep-link/back/forward/
keyboard scenarios; record initial compressed JS and first-use tab latency.
Add `tests/e2e/workbench-tab-loading.spec.js` (**new**) for cold direct links,
chunk failure/retry, request switches during chunk load, and no background mounts.

**Order:** (1) in `pages/workbench/[requestId].js`, replace static imports one at a
time with top-level `next/dynamic` imports in this order: ReviewPanelTab,
ReviewersTab, ReviewsTab, StaffDeliberationsTab, FinalWriteupTab, AwardeeTab,
InitialAssessmentTab, ProposalTab. Keep Overview/Status eager;
(2) in WorkbenchShell, defer FinalWriteupsPanel via its named export, then Awardees,
StaffDeliberations, InitialAssessments and Follow-up; keep RequestList eager.
Use normal SSR support; do not add `ssr:false` indiscriminately. Preserve public
exports and meaningful loading/error state; do not pre-mount or hover-prefetch
workflows with effects. No file relocation is required in this stage.

**Exit:** measured initial JS benefit exceeds query-library overhead; direct tabs
work; first-use tab latency stays within §4 regression bound. Drop/revert any
individual split that merely trades useful-content delay for a smaller number.

### S8 — Integration acceptance and release handoff

**Prerequisites:** all preceding selected stage receipts green; no open P0/P1;
complete invalidation/consumer census and retained correctness tests.

**Order:** reconcile source headers/catalog ownership as needed; run the entire
journey matrix and canonical build; produce before/after traces and all §9 gates;
fresh review of actual final diff and evidence; record release tier, proposed
cohort/preview, known-good deployment and rollback. No route/schema deletion or
workflow cleanup is part of acceptance. Old release remains deployable.

**Exit:** owner can approve a concrete release. If a deterministic runtime cohort
is required by the campaign strategy, design and review that seam before promotion;
do not invent a client-controlled authorization flag. Implementation authorization
does not silently authorize production reads, sends or a main-branch deployment.

## 6. File move/dependency order for the implementer

```text
S0  existing public consumers → characterization/browser fixtures (no moves)
S1  package + policy → keys → GET parser → data boundary → _app integration
S2  request page loadCtx → useWorkbenchRequestContext → page consumes hook
S3  shell cycles → dashboard queries → RequestList GET → Follow-up GET pair
S4  Proposal documents / Overview rollup → request read hooks → independent render
S5  Reviewers loadReviewers → shared full-DTO hook → Reviews load → refresh adapters
S6a InitialAssessmentsPanel read → cycle hook
S6b StaffDeliberationsPanel read → cycle hook
S6c FinalWriteupsPanel read → cycle hook
S6d AwardeesPanel two reads → cycle hook
S7  static imports → dynamic imports, one component per verification slice
S8  ownership documentation + final receipt; no additional runtime refactor
```

Dependencies point from components → domain query hooks → keys/policy/GET parser.
The boundary imports only client-safe identity/context and query-library modules.
No hook imports a server service, adapter, credential module or another UI panel.
Do not introduce a catch-all barrel that eagerly imports all panels again.

## 7. Fresh-context review protocol

Planning checkpoints: **P1** source census/scope; **P2** target contracts and stage
boundaries; **P3** final executable work order and tests. Each uses a new reviewer
with no conversation history. Root continues independent evidence/test inspection
while review runs. Reusing the author's context is not a fresh review.

During implementation: review at the end of **every stage and S6 slice**, before
starting the next. Review again after any scope expansion or failed assumption.
Limit one implementer to the named surface. Reviewer is read-only and reports
findings; root independently confirms/fixes the plan or implementation, then obtains
a fresh review of substantive changes. No paid review product is authorized.

Pass this prompt to the reviewer:

> Read CLAUDE.md, the latency-plan postmortem, this plan, the accepted previous
> receipt, and the actual staged diff at BASE..HEAD. Use CodeGraph first and read
> uncovered logical regions/callers. Do not trust the author's summary. Re-trace
> caller → state → API → guard → service → persistence → response → every consumer.
> Attempt to disprove cache-key equivalence, identity isolation, mutation freshness,
> partial-success handling, cancellation claims, and benefit measurements. Check
> the full response envelope and all failure/finally paths. Identify pre-existing
> behavior separately from new defects. Confirm prerequisite tests would fail for
> the discriminating broken implementation. Return cited findings with severity,
> disconfirming cases, missing evidence, and READY / NEEDS REWORK. Do not edit files,
> call live systems, or substitute a paid review product.

Receipt fields: checkpoint/stage, reviewer ID, baseline and reviewed content hash,
source files independently inspected, tests/measurements actually run, findings,
author dispositions, residual assumptions, and next permitted stage. A statement
“reviewed” without a source-anchored receipt is insufficient.

## 8. Contract-reconcile audit disposition

| Audit | Scope and acceptance |
|---|---|
| Whole flow | §2 traces existing source/persistence/consumers; stage tests exercise real UI boundaries and route contracts |
| Partial success | Preserve invite IDs, candidates/referrals semantics, full reviewer DTO, document-list partial errors and fail-soft Co-PI read; no new batch writer |
| Async/stale state | S1/S2 identity and key isolation; S3/S5 pre-command read fencing; all post-await success/error/finally paths tested |
| Helper extraction | Query hooks own GET lifetimes only; no mutation/result transformation, authority, business filters or state-machine consolidation |
| Durable surface | New plan now; future client memory only. No new tables, columns, migrations, API routes or server cache. API matrix/Atlas only change if later scope actually changes |
| Documentation | New proposal does not mark any runtime stage built. Existing performance/decomposition work remains historical or independently scoped |
| Symbol fan-out | No new persisted enum/status. Preserve full existing envelopes and all consumers, especially liveQuestions, canManage, counts and selectors |

## 9. Commands and green-stage gate

Run from the stage checkout. A green stage requires all applicable steps below,
not a green test subset with an unrun build. Never run fixture-writing gates or
their self-tests concurrently. Only one build may own a checkout at a time.

Baseline subset (executed during planning, 12 suites / 128 tests):

```bash
npm test -- --runInBand --silent \
  tests/unit/workbench-shell.test.js \
  tests/unit/workbench-request-number-lookup.test.js \
  tests/unit/workbench-dashboard-service.test.js \
  tests/unit/workbench-resolve-request-service.test.js \
  tests/unit/workbench-overview-status.test.js \
  tests/unit/workbench-proposal-tab-documents.test.js \
  tests/unit/reviewer-follow-up.test.js \
  tests/unit/reviewers-tab-stale-request.test.js \
  tests/unit/reviewers-tab-post-send-refresh.test.js \
  tests/unit/reviewers-tab-review-document-refresh.test.js \
  tests/unit/workbench-read-coalescing-stage2-characterization.test.js \
  tests/unit/workbench-read-coalescing-stage2-callcounts.test.js
```

At each implementation stage:

1. Run the named new prerequisite/contract tests and all existing tests for touched
   consumers. Check negative fixtures contain the data they claim to exclude.
2. `npm test -- --runInBand --silent` (full Jest); `npm run lint`;
   `npm run check:types`; `npm run build` (canonical).
3. Run the stage's route-mocked browser journeys against that production build:
   `npm run test:e2e -- tests/e2e/workbench-responsiveness.spec.js --project=chromium`.
   S7 adds its tab-loading spec; S5 adds the existing program-director-invite spec.
   Playwright's configured Webpack build is separate from the canonical build;
   record which artifact each measurement used and never run two builders together.
4. Run `check:api-routes`, `check:atlas`, `check:doc-currency`,
   `check:fact-consistency`, `check:canonical-pointers`, `check:doc-symbol-refs`,
   `check:build-claim-freshness`, `check:route-service-boundary`,
   `check:dataverse-access-layer`, `check:reviewer-engagement-boundary`,
   `check:request-document-writers`, `check:status-enum-parity`,
   `check:trust-boundary-guid`, `check:harness-framing`, `check:secret-scan`, and
   `check:scaffolding-tokens`, each followed by its defined self-test; also
   `check:docs-catalog`. S1 runs `check:agent-invariants` too if harness files change
   (none are planned). At S0/S8 discover and run every current `check:*` script as
   `/start` requires; do not freeze this list as the future inventory.
5. Inspect full diff for server-side/write/authority drift, run fresh review,
   reconcile findings, commit only the stage's working changes, record receipt.

If canonical build fails with the documented sandbox Turbopack permission signature,
retry the same command via the approved host mechanism. A Webpack success alone does
not close that gate. Do not delete shared build artifacts or kill other agents' jobs.

## 10. Stop, rollback and non-goals

Stop the affected stage on an uncharacterized envelope, wrong-user/request render,
missing invalidation producer, duplicate action/poller, loss of a confirmed invite,
new permission gate, changed document identity, growing GET storm, or absent measured
benefit. Fix the bounded contract or return to the last green stage; do not expand
into backend authority, persistent caches or provider migration to rescue the plan.

Rollback each consumer slice by reverting its commit while leaving additive unused
hooks harmless. Roll back S1 only after consumer commits are reverted. Keep baseline
SHA and accepted stage SHAs in the execution receipt. Browser caches disappear on
reload/deployment; no durable state repair is needed for pure read code. If a later
rehearsal performs writes, code rollback does not undo them.

Excluded: redesign/typography, broad component cleanup, positive cache TTLs,
selective replacement of refreshAll, request schema/projection changes, app-access
policy rewrites, client authorization receipts, external portal reload removal,
Find proposal/enrichment/roster caching, and reviewer follow-ups F1–F4. Deletion of
old infrastructure is not proposed.

## 11. Planning review receipts and remaining unknowns

P1 — fresh reviewer `/root/planning_review_1`, no inherited conversation, baseline
`7c18b622`. Verdict: READY WITH NAMED CHANGES as a planning direction. Independently
confirmed E1–E9; required full DTO caching, request-context isolation first, retention
of keyed workflow remounts and three-source refresh, no universal blanking claim,
and exclusion of Find POST/enrichment. All incorporated above. No live measurements.

P2 — fresh reviewer `/root/planning_review_2`, no inherited conversation, baseline
`7c18b622`; reviewed draft SHA-256
`1ac9c8a78150cda5203334190fdec9a58bd40fecfdede325ab7c816ee3876af8`.
Verdict on that draft: NEEDS REWORK. Four findings: Primer action locks could be
reset by context refresh (P1); missing Follow-up mutation invalidation (P2);
nullable identity/access-transition ambiguity (P2); retained Reviews child-lifetime
coverage missing (P2). Root confirmed each in source and revised §§3, S1/S2/S5.
Root separately corrected StaffDeliberations' endpoint/server scope and specified
isolated browser startup because instrumentation can write alerts. These are plan
corrections; the proposed implementations have not been tested.

P3 — fresh reviewer `/root/planning_review_3`, no inherited conversation, baseline
`7c18b622`; reviewed draft SHA-256
`0269da4a8b5cd5492007942a03c1a2b07d0f6623046b7471a157d5d320ed65fe`.
Verdict: NEEDS REWORK on one P2 finding: Primer callbacks needed explicit mount/action
ownership, teardown fencing and a post-commit hold. Root incorporated the exact
bounded protocol and discriminating tests in S2. No other planning blockers found.

P4 — fresh reviewer `/root/planning_review_4`, no inherited conversation;
reviewed draft SHA-256
`419e304073a2fca0a6be6090704f55626ffdc19a0e27e3bb13402a1733207746`.
Verdict: READY as a planning document. Independently inspected Primer, request-page
tab lifecycle, Overview consumer, resolve-request service and generation persistence.
Confirmed the S2 protocol addresses lock resets, unmount fencing and post-commit
refresh. No edits, tests or live calls by reviewer. Implementation must preserve
returned local envelopes even with `persisted:false` and check token retirement
after each added cancellation await; these are existing preservation/fencing
obligations, not additional scope. No new planning blocker. The reviewed hash
predates this receipt-only update. Next permitted action: deliver this document;
runtime implementation remains subject to owner authorization and S0 prerequisites.

Planning validation: 12 existing relevant Jest suites passed (128 tests). Documentation
currency, fact consistency, canonical pointers, symbol references, build-claim
freshness, catalogue, harness framing and scaffolding checks passed, with each
available self-test run sequentially. No application build, browser benchmark or
proposed lifecycle test has been run; this change is a plan only.

Remaining unknowns: actual production latency/frequency, browser bundle savings,
exact dependency version at implementation, and campaign release window. They are
measurement/release gates, not permission for a cheaper model to guess.

Official implementation references (checked during planning):
[TanStack query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults),
[cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation),
[invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation),
and [Next.js Pages Router lazy loading](https://nextjs.org/docs/pages/guides/lazy-loading).
These support the library mechanisms; the policy and stages above are this plan's
proposals, not library defaults or measured results.
