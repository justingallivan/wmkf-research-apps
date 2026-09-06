---
title: Final Writeups Dashboard — Slice 6A Cycle Scoping Plan
domain: workbench
kind: plan
status: active
summary: "Plan-first contract for scoping the Final writeups dashboard read model to one grant cycle before the global 100-row bound fails the page; not built."
canonical: false
cataloged: 2026-09-06
last_verified: 2026-09-06
owner: product-engineering
related:
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md
---

# Final Writeups Dashboard — Slice 6A: server-side cycle scoping

**Status: [PLANNED 2026-09-06; NOT BUILT.]** Owner-directed on 2026-09-06 as work queue item 5,
build step 6A (`docs/CURRENT_WORK_QUEUE.md`; Slice 6 of
`docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`). Dated: must be live before D26 Final
writeups exist alongside the J26 set. This document is the `/contract-reconcile` Mode A output
for the plan plus the Mode B invariant table the build must satisfy. Every state claim is labeled.

## 1. Why now

- **[VERIFIED via `lib/services/final-writeup/dashboard-service.js:118-134`]** The read model
  loads every `akoya_request` with a non-null `_wmkf_currentfinalwriteup_value`, with no cycle
  constraint, `top: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS` (100), and throws
  `final_writeups_dashboard_scope_exceeded` (HTTP 503) when `totalCount` exceeds the bound or
  `hasMore` is set. The whole page fails; nothing degrades.
- **[VERIFIED via `lib/services/dynamics/read-ops.js:62`]** `queryRecords` clamps `$top` to 100
  regardless of the caller (`Math.min(top || 25, 100)`). The bound is therefore a read-primitive
  page limit, not only a service constant; raising the constant alone cannot fix it.
- **[VERIFIED via `dashboard-service.js:208,224-225`]** Each projected row already derives
  `cycleCode`/`cycleLabel` from `wmkf_meetingdate` via `meetingDateToCycleCode`, but
  **[VERIFIED via `grep -n cycle shared/components/final-writeups/FinalWriteupsViews.js` → no
  matches]** the client neither renders nor filters on it.
- **[ASSUMED]** The Foundation advances roughly 20–30 finalists per cycle to a Final writeup
  (`docs/WISHLIST.md` "1-page writeups for finalists (20-30 proposals)"). At that rate the
  global bound is crossed during the fourth cycle with current Finals, and earlier if current
  pointers are never cleared. The exact live number of requests with a current Final is
  owner-run-probe-only (`feedback-never-self-authorize-prod-dataverse-reads`); the build does not
  depend on it.

## 2. Surface (contract-reconcile Step 0)

- **Change surface:** the Final writeups dashboard read model becomes cycle-scoped: the request
  query is bounded to one grant cycle, the response carries the available cycle list and the
  selected cycle, and the focused read derives its cycle from the selected request.
- **Entry points:** `GET /api/workbench/final-writeups` (`pages/api/workbench/final-writeups.js`);
  `shared/components/final-writeups/FinalWriteupsViews.js` (`FinalWriteupsDashboardView`,
  `FinalWriteupFocusedView`); pages `pages/workbench/final-writeups/index.js` and
  `[requestId].js` (thin wrappers, unchanged).
- **Persistence:** **none.** No Dataverse, Postgres, Blob, or settings write. Read-only against
  `akoya_requests`, `wmkf_requestdocuments`, `wmkf_finalwriteupreviewacknowledgements`, and Graph
  file metadata. The acknowledgement POST route (`pages/api/workbench/final-writeup/...`) is
  untouched.
- **Consumers:** the two views above; `tests/unit/final-writeups-dashboard-service.test.js`,
  `workbench-final-writeups-route.test.js`, `final-writeups-views.test.js`; the route row in
  `docs/API_ROUTE_SECURITY_MATRIX.md:275`; the reader note in
  `docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md:105-106`; the Slice 6 entry in
  the implementation plan; queue item 5.
- **Prior findings being verified:** the S491 boundary statement in queue item 5 (global cap,
  no cycle rendering, no filters). Both re-verified above.

## 3. Decisions

### 3.1 Cycle identity: meeting-date window, not `wmkf_cyclecode`

Scope the request query with `cycleCodeToOdataFilter(cycleCode)` on `wmkf_meetingdate`
(**[VERIFIED via `lib/utils/cycle-code.js:70-79`]**, exclusive upper bound). Rationale:

- The row's own `cycleCode` is already derived from `wmkf_meetingdate`
  (`dashboard-service.js:208`); scoping on the same field keeps the list and the row label
  consistent by construction.
- Every sibling cycle-scoped surface scopes requests the same way **[VERIFIED via
  `lib/services/workbench/dashboard-service.js:98-108` (reviewer follow-up cycle picker) and
  `lib/services/reviewer-finder/my-proposals-service.js:73-80`]**.
- The Final row does carry `wmkf_cyclecode`, but only as a field copied from the Pre-Site source
  row at handoff **[VERIFIED via `lib/services/final-writeup/transition-service.js:41-42`
  `COPIED_FIELDS`]**; whether the source row always had it is **[ASSUMED]** and not something
  this read model should depend on. `requestDocumentAdapter.findByCycle` /
  `findArtifactCycles` **[VERIFIED via `lib/dataverse/adapters/request-document.js:180-198`]**
  remain the Initial Assessment locator's tools and are not reused here.

### 3.2 Cycle discovery: one lightweight scan, fail closed on cap

Add a cycle-list step that runs before the scoped request query:

```
grantRequestAdapter.queryAllRequests({
  select: 'akoya_requestid,wmkf_meetingdate',
  filter: '_wmkf_currentfinalwriteup_value ne null',
  orderby: 'wmkf_meetingdate desc',
})
```

- `queryAllRequests` is the paginated scan **[VERIFIED via
  `lib/dataverse/adapters/grant-request.js:252-254`]**; on `result.capped` throw a typed 503
  (`final_writeups_dashboard_cycle_list_capped`) exactly as the reviewer follow-up picker does
  **[VERIFIED via `workbench/dashboard-service.js:109-113`]**. Never return a partial cycle list.
- Dedupe to `{ code, label, count }` with `meetingDateToCycleCode` / `cycleCodeToLabel`, newest
  first. `count` is the number of requests with a current Final in that cycle: a navigation count
  for the picker, never a denominator (contract row "no denominator" preserved).
- **Buckets must be total.** Requests whose meeting date is null yield `cycleCode === null`.
  Count them as `uncycledCount`. If it is above zero, the picker shows an explicit **No cycle**
  option that scopes with `wmkf_meetingdate eq null`. A current Final on a request whose meeting
  date is set but falls outside June/December cannot be expressed as a cycle window, so it is
  surfaced as a data fault by a typed 500 (`final_writeups_dashboard_cycle_invalid`) naming the
  request number, matching the fail-loud posture of `lifecycleStage`
  (`dashboard-service.js:167-179`). Rows must never vanish silently from every view. **[PLANNED]**
- Whether any null-date or off-month rows exist in Production is **[ASSUMED none]** and
  unverifiable from the repo; the build handles both branches and the tests pin both.

### 3.3 Default cycle and selection

- Index request without `cycleCode`: default to the newest cycle with any current Final.
  Return `cycles.selected`.
- Index request with `cycleCode`: must match `^[JD]\d{2}$` after trim/uppercase (reuse
  `parseCycleCode`); otherwise the handler rejects it as a bad request. A well-formed code that
  is not in the discovered list succeeds with empty queues and `cycles.selected` set, so a
  bookmarked future cycle does not error. **[PLANNED]**
- **Focused request (`requestId`) never takes `cycleCode`.** The service resolves the request
  first (`akoya_requestid eq <guid>` with the same select), derives its cycle from
  `wmkf_meetingdate`, then runs the scoped queue projection so previous/next navigation stays
  inside the request's own cycle. Passing both parameters is rejected as a bad request. This
  keeps focused URLs stable (`/workbench/final-writeups/<requestId>`) and avoids a client-chosen
  cycle disagreeing with the row. **[PLANNED]**

### 3.4 Cap semantics, preserved per cycle

- `FINAL_WRITEUPS_DASHBOARD_MAX_ROWS` stays and now bounds **one cycle**
  [DERIVED-FROM: `dashboard-service.js:38`; independent of TBD count]. The `scope_exceeded`
  503 stays, with the message naming the cycle. This is the same fail-loud contract the existing
  test "fails loudly instead of silently truncating the dashboard" pins
  (`final-writeups-dashboard-service.test.js:393`); that test is re-pinned to the scoped query.
- Downstream batch bounds (`REQUEST_DOCUMENT_BATCH_MAX_IDS`,
  `ACKNOWLEDGEMENT_BATCH_MAX_FINAL_IDS` [DERIVED-FROM:
  `lib/dataverse/adapters/final-writeup-review-acknowledgement.js:14`; independent of TBD
  count]) and Graph metadata concurrency (`FILE_METADATA_CONCURRENCY`, `dashboard-service.js:40`)
  are unchanged.

### 3.5 Response shape (additive)

```
{
  success: true,
  viewer: { ...unchanged },
  cycles: {
    selected: 'D26' | 'none' | null,
    available: [{ code: 'D26', label: 'December 2026', count: <n> }, ...],  // newest first
    uncycledCount: <n>
  },
  limits: { maximumRows: FINAL_WRITEUPS_DASHBOARD_MAX_ROWS, scope: 'cycle' },
  counts: { ...unchanged keys, scoped to the selected cycle },
  queues: { ...unchanged },
  coordinatorMatrix: ...unchanged shape, scoped to the selected cycle,
  selected, navigation: ...unchanged
}
```

No existing key changes meaning. `counts.*` and the matrix now describe one cycle, which is the
intended semantic change and is called out in the security-matrix row and Atlas note.

### 3.6 Client (minimal; 6B adds the other filters)

- `FinalWriteupsDashboardView` reads `cycleCode` from `window.location.search` on mount (same
  pattern as `pages/workbench/artifacts.js:32-36`), passes it as the only query parameter,
  renders a cycle `<select>` labeled **Cycle** above the search field (mirroring the Initial
  assessments locator), and on change writes `?cycleCode=` to the URL via `history.replaceState`
  then reloads. The existing `requestIdRef` stale-response guard **[VERIFIED via
  `FinalWriteupsViews.js:425-453`]** already covers the reload; the cycle select is disabled
  while `loading`.
- The header line becomes "N awaiting your review in December 2026".
- The **No cycle** option renders only when `uncycledCount` is above zero.
- `FinalWriteupFocusedView` is unchanged except that it renders `cycles.selected` as context
  under the request number. It never sends `cycleCode`.
- The header comment "THESIS: one legible review queue replaces a metrics-and-filters dashboard"
  (`FinalWriteupsViews.js:3`) is rewritten in 6B, not here; 6A adds one control and the existing
  views test "dashboard search filters all queues without adding filter controls"
  (`final-writeups-views.test.js:118`) is re-pinned in 6A to "…without adding filter controls
  other than the cycle selector".

## 4. Contract trace (Step 3)

| Hop | Before | After 6A |
|---|---|---|
| 1 user | opens `/workbench/final-writeups` | same, optionally with `?cycleCode=D26` |
| 2 client state | `data`, `search`, stale guard | + `cycleCode` from URL; select disabled while loading |
| 3 payload | `GET /api/workbench/final-writeups` or `?requestId=` | + `?cycleCode=` on index only; never with `requestId` |
| 4 handler | allowlist `requestId` only; GUID check | allowlist `requestId` XOR `cycleCode`; `cycleCode` must parse (`parseCycleCode`); both together rejected as a bad request |
| 5 service | viewer ∥ all-requests ∥ personas | viewer ∥ cycle list ∥ personas → resolve selected cycle → scoped requests → unchanged projection |
| 6 persistence | reads only | reads only; one extra paginated scan of two columns |
| 7 response | queues/matrix over all cycles | + `cycles`; queues/matrix over one cycle |
| 8 consumer render | queues, matrix, search | + cycle select, cycle label in header and focused view |
| 9 docs/tests/gates | matrix row, Atlas note, three test files | updated matrix row + Atlas note + plan/queue; tests below; `check:api-routes`, `check:trust-boundary-guid`, `check:route-service-boundary`, `check:atlas` |

## 5. Audits (Step 4)

1. **Whole-flow:** every hop above has a named file. N/A hops: none.
2. **Partial-success:** N/A for writes (none). For reads: the cycle list either completes or
   503s; the scoped query either completes under the bound or 503s; there is no partial page.
3. **Async / stale-state:** the dashboard reload on cycle change reuses the existing
   `requestIdRef` generation guard; every post-await `setData`/`setError`/`setLoading` is already
   fenced (`FinalWriteupsViews.js:434,438,443`). The build adds no new post-await state write
   outside that fence. Focused view unchanged.
4. **Helper-extraction:** a small `listFinalWriteupCycles(dependencies)` helper is new and
   local to `dashboard-service.js`. It must **not** be shared with the reviewer follow-up
   `listCycles` (different visibility predicate, set-aside semantics) or `my-proposals`
   `listCycles` (PD-scoped). Preserved difference: this list counts requests with a current
   Final, nothing else.
5. **Durable-surface:** no migration, no schema, no Atlas entity change. Required edits:
   `docs/API_ROUTE_SECURITY_MATRIX.md:275` (query-parameter contract and per-cycle bound),
   `docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md:105-106` (reader is
   cycle-scoped), Slice 6A status in the implementation plan, queue item 5 boundary, this doc's
   status. Gate that catches omission: `check:api-routes` (route contract text) and
   `check:doc-currency`.
6. **Doc-reconcile:** grep `final-writeups` and `scope_exceeded` across `docs/` and
   `.claude-memory/` at build time; every restatement of the row bound gains "per cycle".
   Delegate to `/sweep` if more than the four surfaces above restate it.
7. **Symbol-consumer fan-out:** new response key `cycles` and new query parameter `cycleCode`.
   Read surfaces: `FinalWriteupsDashboardView`, `FinalWriteupFocusedView`, the three test files,
   the handler allowlist at `final-writeups.js:30-33` (a denylist-shaped check
   `key !== 'requestId'`; the build converts it to an explicit allowlist set
   `{ requestId, cycleCode }` so an unrecognized key still fails closed). `counts` and `limits`
   keep their keys; `limits.scope` is additive.

## 6. Invariant table (Mode B guardrail for the build)

| Invariant | Files likely touched | Verification |
|---|---|---|
| A request row never appears in a cycle other than the one its own `cycleCode` derives | `dashboard-service.js` | test: fixtures across J26/D26; each scoped response contains only rows whose `cycleCode` equals `cycles.selected`; mutation (drop the filter) turns it red |
| Rows with a null meeting date never vanish silently | `dashboard-service.js`, views | test: one null-date fixture → `uncycledCount` of one, absent from J26/D26, present under `cycleCode=none`; UI shows the option only when the count is above zero |
| A current Final on a non-June/December meeting date fails loud, not silent | `dashboard-service.js` | test: March meeting date → typed 500 `cycle_invalid` naming the request number; mutation (skip) turns it red |
| Capped cycle list never returns partially | `dashboard-service.js` | test: `queryAllRequests` returns `capped: true` → 503 `cycle_list_capped`; no downstream reads |
| Per-cycle bound keeps the fail-loud contract | `dashboard-service.js` | re-pin existing test at `:393` with a scoped filter assertion |
| `requestId` and `cycleCode` are mutually exclusive; unrecognized keys fail closed | `final-writeups.js` | handler test: both together, an unrecognized key, and a malformed `cycleCode` are each rejected before any service call |
| Focused navigation stays inside the request's cycle | `dashboard-service.js` | test: focused read on a D26 request with J26 rows present → previous/next are D26 only |
| No client-chosen cycle reaches the focused read | `FinalWriteupsViews.js`, handler | handler test: `requestId` + `cycleCode` rejected; views test: focused fetch URL has no `cycleCode` |
| Cycle change cannot write a stale response | `FinalWriteupsViews.js` | views test modeled on `:247` "ignores a late response after its request changes" for cycle change |
| Persona lenses, matrix semantics, self-acknowledgement rule unchanged | `dashboard-service.js` | existing tests at `:152-374` pass unmodified except the scoped filter assertion |
| No write path added | all | `git diff` shows no `create`/`update`/`patch` call; `check:request-document-writers` green |

**Complement check the build must write down:** for the handler allowlist, the response when the
query has zero keys (index, default cycle), one allowed key, two allowed keys (rejected), one
unrecognized key (rejected). For the cycle resolver, the response for: no requests at all (empty
`available`, `selected: null`, empty queues, success); requested cycle absent from the list
(success, empty); null meeting date (uncycled); off-month date (typed server fault).

## 7. Tests (names to add or re-pin)

- `tests/unit/final-writeups-dashboard-service.test.js`: "scopes the request query to the
  selected cycle and returns the available cycle list"; "defaults to the newest cycle with a
  current Final"; "counts null-meeting-date rows as uncycled and serves them under `none`";
  "fails loud on a current Final whose meeting date is not a June/December cycle"; "fails closed
  when the cycle list scan is capped"; "focused reads derive the cycle from the request and
  navigate within it"; re-pin "fails loudly instead of silently truncating" to assert the
  meeting-date window appears in the filter.
- `tests/unit/workbench-final-writeups-route.test.js`: "accepts requestId or a well-formed
  cycleCode, never both, and rejects unrecognized keys before service work".
- `tests/unit/final-writeups-views.test.js`: "cycle selector reflects the server list, defaults
  to the selected cycle, and reloads with the chosen code"; "ignores a late response after the
  cycle changes"; re-pin `:118` wording; "No cycle option renders only when uncycled rows exist".

Each negative assertion must be constructed with the excluded thing present (a J26 row in the
fixture when asserting a D26 response excludes it), per the contract-reconcile test rule.

## 8. Gates and exit

Sequential, each with its self-test: `check:api-routes`, `check:trust-boundary-guid`,
`check:route-service-boundary`, `check:route-lifecycle-auth`, `check:atlas`,
`check:doc-currency`, `check:fact-consistency`, `check:docs-catalog`; then
`npm test -- --runInBand --watch=false --testPathPattern 'final-writeups|workbench-final-writeups'`,
`check:types`, `lint`, `build -- --webpack`, `git diff --check`. Tier 1 runtime change: build on
this branch, Codex adversarial review of the diff, merge by deliberate promotion, then a
signed-in read-only Production smoke: the cycle select shows the J26 cycle, the default is the
newest cycle, and a bookmarked `?cycleCode=D26` before any D26 Final exists returns the empty
state rather than an error.

## 9. Explicitly out of scope

Program/PD, stage, and review-state filters (6B); publication-version display (6C); "has edits"
hint (6D); other writeup stages (6E); any change to acknowledgement writes, persona resolution,
matrix audiences, the leadership transition, or PC backup actions; any Dataverse write; any
change to the Initial assessments locator.

## 10. Open questions for the owner (non-blocking; defaults stated)

1. **Should the picker list cycles with zero current Finals?** Default: no. The list is derived
   from current Finals, so a cycle appears once its first Final exists. A bookmarked future cycle
   still resolves to an empty state.
2. **Should the coordinator matrix stay per-cycle only?** Default: yes. A cross-cycle matrix
   reintroduces the unbounded scan this slice removes.
