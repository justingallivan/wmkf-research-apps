---
title: Reviewer Follow-up organization-wide cycle visibility plan
domain: request-workbench
kind: plan
status: active
summary: Organization-wide Reviewer Follow-up cycle discovery and lead-PD/superuser request mutation enforcement, built on the implementation branch.
canonical: false
cataloged: 2026-09-02
last_verified: 2026-09-02
owner: product-engineering
related:
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md
---

# Reviewer Follow-up organization-wide cycle visibility plan

## Outcome

Every active user who passes the existing `reviewers` app authorization will be
able to discover every cycle containing Reviewer Follow-up-eligible requests,
including a cycle whose only eligible rows are set aside, and
then select **All requests** to see that cycle-wide population. The page will
still open in **My requests**. Under the owner-selected mutation policy,
non-superusers will be unable to mutate requests led by another Program
Director. The owner selected that policy on 2026-09-02. The implementation is
built and automated-test verified on `codex/workbench-reviewer-follow-up`;
Preview verification and promotion remain release steps.

This is primarily a read-discovery correction. It adds no route, table,
migration, permission, role, or write capability. Because the current
Reviewer Follow-up `canManage` distinction was only a UI rule, the build adds a
shared server authorization boundary before request-bound side effects. The
policy decision and branch implementation are now verified; Production remains
unchanged until deliberate promotion.

## Contract boundary

“All users can see everything” has these exact limits:

- **Authorized users:** active users with access to the `reviewers` app. Users
  without that app remain denied by `requireAppAccess(req, res, 'reviewers')`.
- **Everything:** every request in the selected cycle that already satisfies the
  Workbench eligibility rule: `Phase II Pending` or `Advancing`. `Set aside`
  requests remain excluded until **Show set aside** is selected.
- **Read, not manage:** organization-wide rows remain visible in **All requests**,
  but `canManage` is true only for the lead Program Director or a superuser.
  The implementation branch enforces the same decision server-side before
  request-bound side effects. Client-side hiding is not authorization.
- **Default view:** **My requests** remains the initial request scope. The new
  cycle list does not silently change the page to **All requests**.

## Verified current state

| Claim | Evidence | State |
|---|---|---|
| The dashboard route requires `reviewers` app access and a session-derived Azure email. | `pages/api/workbench/dashboard.js:36-55` | `[VERIFIED via source]` |
| Cycle-list mode is currently based on meeting-dated requests led by the caller. | `lib/services/workbench/dashboard-service.js:76-88`; `lib/dataverse/adapters/grant-request.js:172-190` | `[VERIFIED via source]` |
| `scope=all` omits the Program Director filter after a cycle is selected. | `lib/services/workbench/dashboard-service.js:126-156` | `[VERIFIED via source]` |
| Non-superusers can receive another Program Director's row while `canManage=false`; superusers can manage it. | `lib/services/workbench/dashboard-service.js:180-204`; `tests/unit/workbench-dashboard-service.test.js` | `[VERIFIED via source and unit tests]` |
| The merged Reviewer Follow-up rows always originate from dashboard rows and carry the dashboard projection under `workbench`. | `shared/utils/reviewer-follow-up.js:21-41` | `[VERIFIED via source]` |
| Before this build, the UI hid foreign-row management while request-bound Reviewer APIs remained staff-shared. The implementation routes those mutations through `authorizeReviewerRequestMutation` before side effects. | `lib/services/reviewer-request-authorization.js`; affected route shells; focused route tests | `[VERIFIED via source and automated tests on implementation branch]` |
| The adapter docblock says the PD-scoped helper also serves Reviewer Finder, but a live symbol census finds only the Workbench dashboard caller; Reviewer Finder now builds its own PD-scoped `queryAllRequests` call. | `lib/dataverse/adapters/grant-request.js:172-190`; `lib/services/reviewer-finder/my-proposals-service.js:65-81` | `[STALE/CONFLICT verified via CodeGraph + rg + source]` |
| In the authenticated Preview, the owner account saw 10 requests in **My requests** and 44 in **All requests** for D26. | Preview UAT on 2026-09-02 | `[VERIFIED via authenticated browser probe]` |
| A Reviewer user with no assignment in a cycle cannot currently discover that cycle through this picker. | Follows directly from the PD-filtered cycle query | `[VERIFIED via source; browser complement still required]` |
| Reviewer Follow-up always loads selected-cycle dashboard rows with `includeSetAside=1`, then its checkbox filters set-aside rows in the client. | `pages/workbench/reviewer-follow-up.js:172-222` | `[VERIFIED via source]` |

## Owner decision: foreign-row mutation policy — resolved 2026-09-02

The existing API matrix and reviewer-manager service intentionally describe
reviewer operations as staff-shared. Changing them to lead-PD/superuser writes
would remove capability from Reviewer-app users who are not a request's lead
PD. The organization-wide picker must not silently reverse that dated product
policy.

**[OWNER DECISION 2026-09-02] Lead-PD/superuser writes selected.** Foreign rows
will be genuinely read-only in both UI and server routes. Complete step 0 before
releasing organization-wide cycle discovery.

Affected population: users with `reviewers` or `review-manager` app access who
are neither a superuser nor the target request's lead Program Director. After
implementation they retain organization-wide reads but lose mutation capability
for foreign requests. Lead Program Directors retain writes on their own
requests; superusers retain writes everywhere.

This narrowly supersedes the S207/S428 org-open decision for request-bound
Reviewer Follow-up mutations. It does not change the accepted org-open policy
for global reviewer-person merges, which have no single request owner, or for
staff-wide document reads.

The 104 displayed beside D26 in the current picker is not the same population
as the 44 rows in the default **All requests** view. The picker counts every
meeting-dated request led by the caller, while the list applies Workbench
eligibility and hides `Set aside`. The revised count must have one explicit,
consistent meaning.

## Planned contract

### Cycle-list response

Preserve existing fields and add `setAsideCount` so a set-aside-only cycle is
both discoverable and honestly labelled:

```json
{
  "success": true,
  "programDirector": {
    "systemuserid": "server-resolved-id",
    "fullName": "Resolved user"
  },
  "cycles": [
    {
      "code": "D26",
      "label": "December 2026",
      "year": 2026,
      "month": 12,
      "count": 44,
      "setAsideCount": 6
    }
  ],
  "defaultCycleCode": "D26"
}
```

The field meanings change only where necessary:

- `cycles` is organization-wide for every authorized Reviewer user.
- A cycle is included when it contains at least one request satisfying the
  Workbench visibility rule with set-aside rows included. A set-aside-only
  cycle therefore remains selectable.
- `count` is the organization-wide count of eligible, non-set-aside requests in
  that cycle. It therefore matches the default **All requests** population for
  that cycle.
- `setAsideCount` is the additional number of eligible set-aside requests. The
  option label must render zero explicitly and append the set-aside count when
  nonzero, for example `December 2026 (44 active + 6 set aside)` or
  `June 2025 (0 active + 3 set aside)`.
- `defaultCycleCode` prefers the caller's most recent eligible assigned cycle.
  Preference considers non-set-aside assignments first, then the most recent
  organization-wide cycle with a non-set-aside row. Only when no such row
  exists anywhere does it fall back to the newest set-aside-only cycle. This
  preserves a useful **My requests** landing state without hiding cycles from
  unassigned users.
- With no eligible requests anywhere, return `cycles: []` and
  `defaultCycleCode: null`.

`scope` does not affect the cycle-list response. Reviewer Follow-up continues
to fetch selected-cycle rows with `includeSetAside=1` and applies **Show set
aside** in the client, so the picker remains stable when either control changes.

### Selected-cycle response

No selected-cycle response-shape change is planned:

- `scope=my` filters rows to the server-resolved Program Director.
- `scope=all` returns the existing organization-wide eligible population.
- Reviewer Follow-up requests `includeSetAside=1`; its checkbox controls whether
  those returned rows are displayed.
- `canManage` remains server-derived per row.
- Mutation routes are hardened to enforce that same manage decision
  authoritatively before organization-wide discovery is released.

## End-to-end contract trace

1. `pages/workbench/reviewer-follow-up.js` loads
   `GET /api/workbench/dashboard` without `cycleCode`.
2. `pages/api/workbench/dashboard.js` enforces method, Reviewer app access,
   session identity, and Dataverse restriction context.
3. `loadDashboard` resolves the caller to an active Dataverse `systemuser` and
   obtains the caller's application role.
4. Cycle-list mode performs one paginated, organization-wide read of the
   minimal request projection needed for cycle grouping and default selection:
   request id, meeting date, triage/request status, and lead Program Director.
5. Dataverse applies the shared set-aside-inclusive Workbench predicate. The
   service does not reimplement that predicate in memory; it only separates
   returned rows into default-visible versus set-aside counts, groups them by
   cycle, and derives the preferred personal default with an organization-wide
   fallback.
6. If the paginated adapter reports `capped: true`, the service fails closed
   with a typed 503 instead of returning an incomplete picker.
7. The page renders the returned cycles and loads the chosen cycle with
   `scope=my` by default.
8. Selecting **All requests** triggers the existing `scope=all` request and the
   existing Reviewer aggregate request.
9. The UI renders other Program Directors' rows read-only only when
   `workbench.canManage === true`; missing authorization data fails closed.
10. Every page mutation resolves the target row back to its request and rejects
    a non-lead, non-superuser caller at the server boundary.

There is no persistence or background work in this flow.

## Implementation plan

### 0. Make foreign-row read-only behavior authoritative

This step is authorized by the 2026-09-02 owner decision above.

Before widening cycle discovery, inventory every mutation control rendered by
`ReviewerGroup`, `ReviewerManagePanel`, `CampaignConfigModal`, and the reminder
action. Trace each endpoint from target suggestion/request to its lead Program
Director and current authorization.

The final component-to-route census is:

- `PATCH /api/review-manager/reviewers`;
- `POST /api/review-manager/regenerate-token`;
- `POST /api/review-manager/revoke-token`;
- request-bound `PATCH` and `DELETE /api/reviewer-finder/my-candidates`;
- `POST /api/review-manager/terminal-transition`;
- `POST /api/review-manager/send-review-reminder`;
- `POST /api/review-manager/send-emails`;
- `/api/upload-handler` is not request-bound: it stages generic outbound email
  attachments and accepts no request/suggestion ownership input, so it remains
  under its existing authenticated upload contract;
- `POST /api/review-manager/campaign-config`; and
- `POST /api/review-manager/review-due-extension`.

Re-run the component-to-route census immediately before implementation and add
any newly reachable mutation endpoint to this denominator.

For every route reachable from Reviewer Follow-up:

- Use the session's server-minted `dynamicsSystemuserId` as the one canonical
  manage actor, matching existing write-attribution and triage conventions.
  Pass that same identity into dashboard projection; do not continue deriving
  `canManage` from one identity while write routes authorize another.
- A missing actor id fails closed for non-superusers. Compare GUID strings
  case-insensitively. Superuser status remains server-derived from `profileId`.
- Resolve the target request from the server-side suggestion/request record;
  never accept ownership or Program Director identity from the client.
- Permit a mutation only when the caller is the target request's lead Program
  Director or a superuser; otherwise return 403 before any write or email.
- Preserve existing request-local behavior for authorized callers and add
  consumer tests so this intentional tightening cannot silently break a
  legitimate path.
- For batch operations, authorize the complete batch before the first mutation
  so a foreign row cannot create partial success.

At minimum this includes the confirmed gap in
`PATCH /api/review-manager/reviewers`. The endpoint census is a blocking
deliverable because `canManage` gates several other mutation routes. Change the
Reviewer Follow-up UI check from `workbench?.canManage !== false` to
`workbench?.canManage === true` so missing projection data also fails closed.

Also change the request-local Workbench gate in
`shared/components/reviewers/reviewer-modes.js` and
`pages/workbench/[requestId].js` to use the same fail-closed, case-insensitive
identity rule. Otherwise that page would render controls that the hardened
server correctly rejects.

This is an intentional authorization tightening. Record it in
`docs/API_ROUTE_SECURITY_MATRIX.md`, enumerate the staff population losing
capability, and test every request-local and non-Workbench caller.

### 1. Make the visibility predicate reusable without changing its semantics

In `lib/services/workbench/dashboard-service.js`, extract a small pure helper
that builds the existing Workbench visibility filter for
`includeSetAside=true|false`.

Requirements:

- Preserve the exact parentheses around the `Phase II Pending OR Advancing`
  clause.
- Preserve the null-inclusive exclusion that makes `Set aside` win even when a
  request is also `Phase II Pending`.
- Build both the current default filter and its set-aside-inclusive variant from
  the same helper. Selected-cycle mode keeps its existing branch; cycle-list
  mode uses the inclusive branch so set-aside-only cycles remain discoverable.
- Add direct tests for both helper branches through public service behavior;
  do not export a test-only production API unless necessary.

### 2. Replace only the Workbench cycle query

Change `listCycles` to use `grantRequestAdapter.queryAllRequests` with:

- the minimal projection described above;
- `wmkf_meetingdate ne null`;
- the shared set-aside-inclusive visibility filter; and
- meeting-date descending order.

Group the fully paginated result by `meetingDateToCycleCode`, split default and
set-aside counts, and collect the cycles containing a default-visible row whose
Program Director matches the server-resolved caller. The OData filter is the
eligibility boundary; do not duplicate it in memory.

Handle the adapter result explicitly. If `capped` is true, throw a
`ServiceHttpError` with HTTP 503 and a sanitized incomplete-picker message.
The approved read-only production probe on 2026-09-02 returned 236 eligible
rows and `capped:false`: 4.7% of the 5,000-row cap, with 95.3% headroom.

No meeting-date history bound is planned because the requested contract is
complete cycle discovery and the current picker exposes the caller's full
meeting-dated history. This is deliberate, not an omission. The implementation
may proceed only when the live inclusive population is below 80% of
`MAX_EXPORT_RECORDS` (currently 5,000). At or above that threshold, replace the
scan design with an uncapped server aggregate or authoritative cycle source
before shipping; do not narrow history silently.

A fresh caller census currently finds no live caller for
`findMeetingDatesByProgramDirector` after this replacement; Reviewer Finder
uses its own query. Re-run CodeGraph and `rg` immediately before editing. If the
census remains empty, remove the dead helper and its characterization tests and
correct its stale caller docblock. If a live caller appears, leave the helper
unchanged and document that caller instead.

### 3. Preserve the useful personal default

After sorting cycles newest first:

1. choose the first cycle containing a default-visible request led by the caller;
2. otherwise choose the first organization-wide cycle with `count > 0`;
3. otherwise choose the newest set-aside-only cycle; and
4. otherwise return `null`.

Matching must be case-insensitive and tolerate a missing Program Director
lookup without treating the row as personally assigned.

### 4. Make the small client changes required for honest discovery

In `pages/workbench/reviewer-follow-up.js`:

- render `count` even when it is zero and append `setAsideCount` when nonzero;
- preserve `?cycleCode` precedence when the requested code is in the returned
  organization-wide list;
- if `scope=my` has zero loaded proposals, show: “No requests are assigned to
  you in this cycle. Select All requests to view the full cycle.” Do not direct
  an unassigned user only to **All reviewers**;
- retain the existing attention-filter empty state when proposals exist but no
  reviewer currently needs attention; and
- use `workbench?.canManage === true` for every mutation surface, aligned with
  the owner-selected server policy.

Verify:

- initial scope is still `my`;
- the API-provided `defaultCycleCode` is honored;
- changing cycle or scope cannot display a stale prior response;
- a user with no requests in the fallback cycle gets the new actionable empty
  state and can switch directly to **All requests**; and
- a set-aside-only cycle stays visible with an honest zero-active label.

### 5. Reconcile durable contract descriptions

Update the `/api/workbench/dashboard` row in
`docs/API_ROUTE_SECURITY_MATRIX.md` to state that:

- cycle discovery is organization-wide for authorized Reviewer users;
- picker counts distinguish default-visible and set-aside populations;
- default selection prefers the caller's newest eligible cycle and falls back
  to the newest organization-wide cycle; and
- selected-cycle `my|all` and set-aside behavior is unchanged; document the
  owner-selected mutation policy and make foreign-row denial
  server-authoritative rather than only a UI rule.

Search all durable restatements of the old PD-scoped picker fact and reconcile
each current-state statement. Keep historical/as-built notes historical rather
than silently rewriting history. Run `/sweep` before completion because the
cycle-source fact currently appears in the API matrix, Workbench triage plan,
Atlas page, source comments, and tests.

## Verification plan

### Automated tests

Extend `tests/unit/workbench-dashboard-service.test.js` to prove:

1. a non-superuser receives cycles that contain only other Program Directors'
   eligible requests;
2. counts are organization-wide and exclude set-aside and ineligible Concept
   rows from `count` while reporting set-aside rows separately;
3. the default prefers the caller's newest eligible cycle even when a newer
   organization-wide cycle exists;
4. a caller with no eligible assignments defaults to the newest
   organization-wide cycle;
5. null meeting dates and invalid cycle conversions are skipped;
6. a set-aside-only cycle remains listed with `count: 0`, a positive
   `setAsideCount`, and the defined fallback behavior;
7. an empty inclusive eligible population returns an empty picker and null
   default;
8. case differences in Dataverse GUID strings do not break personal matching;
9. selected-cycle `scope=my|all` filters and `canManage` results are unchanged;
10. `includeSetAside` preserves its existing selected-cycle behavior;
11. `capped: true` fails closed with the planned typed error; and
12. after the fresh caller census, either the unused
    `findMeetingDatesByProgramDirector` export and its tests are removed, or—if
    a caller exists—the retained helper is explicitly asserted not to be called
    by Workbench cycle-list mode.

Extend `tests/integration/workbench-routes.test.js` to prove:

1. an authorized Reviewer user with no personal assignments receives the
   organization-wide cycle list;
2. the cycle query contains no Program Director predicate and contains the
   exact inclusive visibility and non-null meeting-date predicates;
3. unauthorized users still receive the existing denial;
4. missing session identity and unresolved active Dataverse identity keep their
   existing 400/404 behavior; and
5. selected-cycle route behavior is unchanged; and
6. capped cycle discovery returns the planned sanitized failure.

Update Reviewer Follow-up UI tests to prove that the page still defaults to
**My requests**, honors a server-selected default that is not the first array
entry, honors a valid `?cycleCode` override, refetches with `scope=all`, renders
zero/set-aside counts, uses the actionable zero-assignment empty state, and
fails closed when `workbench.canManage` is absent.

Add route/service tests for each mutation endpoint found in step 0. At minimum,
`tests/integration/review-manager-reviewers-patch.test.js` must cover lead PD,
superuser, foreign Reviewer user, unresolved identity, single-row, and
preauthorized-all-or-nothing batch behavior.

Add request-local page tests for missing actor identity, case-varied GUIDs,
foreign staff, lead PD, and superuser. Reconcile the current soft/fail-open
statements in
`shared/components/reviewers/ReviewerManagePanel.js`,
`shared/components/reviewers/ReviewersTab.js`,
`shared/components/reviewers/reviewer-modes.js`,
`pages/api/workbench/resolve-request.js`, `pages/workbench/[requestId].js`, and
`pages/workbench.js`.

### Required gates

Run each gate and its self-test sequentially where a self-test exists:

```text
focused unit and integration tests
npm run check:api-routes
npm run check:api-routes:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:docs-catalog
npm run build
```

Run the repository's React/Next.js condensed quality checklist only if TSX/JSX
is changed after verification reveals a client-side need.

### Authenticated Preview matrix

Deploy the implementation branch to Vercel Preview and register the exact
deployment callback URI through Azure CLI before Microsoft sign-in testing.
Do not treat a project alias as sufficient for the deployment-specific callback.

Exercise at least:

| Persona | My requests | All requests | Manage controls |
|---|---|---|---|
| Superuser with assignments | Own rows in preferred personal cycle | Every eligible row in cycle | Available on all rows |
| Reviewer user with assignments | Own rows | Every eligible row in cycle | Available only on owned rows |
| Reviewer user without an assignment in a visible cycle | Empty state | Every eligible row in cycle | Unavailable on all foreign rows |
| User without Reviewer app access | Access denied | Access denied | Not applicable |

For each authorized persona, verify that the picker contains the same
organization-wide cycles and counts. Verify **Show set aside** separately on a
selected cycle. Preview remains read-only unless the owner separately authorizes
a write rehearsal.

## Failure and rollback behavior

- A Dataverse read failure remains a route failure; do not return a partial
  cycle list that looks authoritative.
- `capped: true` produces the planned typed 503; it is never returned as a
  successful partial list.
- No optimistic client state is introduced, so there is no new stale-write or
  partial-success state.
- Authorization is completed for the whole batch before the first write.
- Rollback of cycle discovery restores the prior Workbench `listCycles` call.
  Authorization hardening must not be rolled back merely to restore the picker;
  treat it as a separate security commit.

## Out of scope

- Granting the Reviewer app to additional people.
- Making Reviewer Follow-up public or available to other app roles.
- Changing global reviewer-person merge authorization or staff-wide document
  read authorization; the 2026-09-02 decision is limited to request-bound
  Reviewer Follow-up mutations.
- Changing the triage eligibility rule or making `Set aside` visible by default.
- Redesigning mobile navigation or the Reviewer Follow-up layout.
- Changing Reviewer Finder's personal proposal/cycle contract.
- Production promotion or production write testing.

## Completion criteria

This plan is complete only when:

1. every authorized Reviewer persona receives the same eligible cycle options
   and organization-wide counts;
2. an authorized user with no personal assignment can select a cycle and see
   its rows under **All requests**;
3. **My requests** remains the default and personal-default selection works;
4. the owner-selected mutation policy is implemented consistently;
   non-superusers cannot manage foreign rows in UI or through authoritative
   write routes;
5. picker and selected-cycle eligibility predicates are contract-tested against
   drift;
6. Reviewer Finder behavior is unchanged;
7. relevant code, tests, API security documentation, Atlas/current-state
   restatements, and Preview evidence agree; and
8. no production promotion occurs without an explicit owner decision.

## Claude review receipt

Claude Code reviewed the first draft read-only through the authenticated
`claude.ai` subscription on 2026-09-02. It returned **APPROVE WITH CHANGES**.
The review found:

1. a high-severity mismatch between the draft's server-write claim and the
   staff-shared PATCH route;
2. loss of set-aside-only cycles;
3. unspecified `capped: true` behavior;
4. an unhelpful zero-assignment empty state;
5. a stale Reviewer Finder caller claim;
6. ambiguous in-memory versus OData predicate placement;
7. inaccurate wording about how Reviewer Follow-up handles set-aside rows; and
8. a missing URL-override test.

This revision addresses all eight findings and adds the specific complement
tests Claude requested.

Claude then completed a second read-only pass and again returned **APPROVE WITH
CHANGES**, with no blocking design finding. It verified the cycle, count,
set-aside, default, URL, pagination, and stale-caller corrections. It required
the plan to pin one actor identity, cover the fail-open request-local gate,
record an owner decision before reversing the staff-shared write policy,
enumerate the mutation census, state the intentional no-history-bound decision,
and make the dead-helper test conditional. This revision incorporates each of
those points. The owner resolved the remaining policy decision on 2026-09-02 by
selecting lead-PD/superuser-only writes for request-bound Reviewer Follow-up
mutations. No further Claude pass is required before implementation.

## Status

`[BUILT + TEST-VERIFIED — RELEASE PENDING 2026-09-02]` The organization-wide
cycle picker, truthful active/set-aside counts and defaults, fail-closed UI
mirrors, and server-authoritative lead-PD/superuser request mutation boundary
are implemented on `codex/workbench-reviewer-follow-up`. The Production volume
probe returned 236 eligible rows with `capped:false`. Claude code review,
authenticated Preview verification, and deliberate Production promotion remain
release steps; Production is unchanged.
