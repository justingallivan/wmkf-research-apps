# J27 staff dashboard and actionable reviewer eligibility

Status: **PARTIAL: Reviewer Finder compatibility implemented on a feature branch;
Phase I dashboard/workflow deferred by owner. Not deployed.** Owner: Codex, 2026-11-02 Pacific.
Scope: two additive J27-and-later eligibility changes. D26 and earlier behavior
and the deployed readiness gate remain intact.

## Requested outcomes and settled inputs

[VERIFIED via Justin's request, 2026-11-02]
1. Show ready Phase I requests in the staff dashboard.
2. Include advanced requests with Phase II Pending Committee Review in Reviewer
   Finder's actionable list.

[VERIFIED via Connor's relayed contract and the preceding Production probe]
`akoya_requeststatus` is derived by Dynamics Business Rules; apps do not write it
for this feature. Newly submitted J27 requests have Request Status Phase I
Pending, Phase I Pending Committee Review, Phase II null. Advanced requests have
Phase I Invited and Phase II Phase II Pending Committee Review, with Request
Status expected to follow as Phase II Pending. `wmkf_readyforreview` is Boolean;
Power Automate owns real-intake readiness after assembly and AI complete; the
separate Factory has an owner-approved test-fixture finalizer. J27 onward requires exact
true. Earlier linked cycles are exempt from readiness, not from existing
eligibility rules. Rerun risk is accepted; no additional producer checks/polling.

The existing Atlas records Phase II Pending Committee Review as raw option
100000002 (owner-run status metadata probe, 2026-10-26). Use a named semantic
constant, not labels or an unexplained repeated number. This plan performed no
new Production reads or status writes.

## Baseline gaps and source trace (before this fix)

[VERIFIED via branch source at `5349a3542`, plus local read-only evidence commit
`74c37f6a5`; not a claim that the proposed feature is built]

| Path | Current enforcing behavior | Required addition |
|---|---|---|
| `/api/workbench/dashboard` → `lib/services/workbench/dashboard-service.js` | `buildVisibilityFilter` admits Phase II Pending / Advancing, optionally Set aside; readiness filters complete rows afterward | Staff-only discovery can additionally admit ready J27+ Phase I Pending |
| `shared/components/workbench/WorkbenchShell.js` | Uses the same dashboard endpoint for program/cycle discovery, then mounts the request list | Cycle picker/counts/default must include the added staff cohort |
| `shared/components/workbench/RequestListPanel.js` | Rows open Reviewers, show reviewer stage/progress and old triage controls | Phase I rows need staff-oriented display and destination |
| `lib/services/workbench/program-scope-service.js` | Default program derives from newest currently visible assignments | Staff mode must consider ready Phase I assignments; other modes remain unchanged |
| `/api/reviewer-finder/my-proposals` → `lib/services/reviewer-finder/my-proposals-service.js` | Actionable requires Phase II Pending and null `wmkf_phaseiistatus`; status=all drops the null condition | In J27+ actionable mode also allow 100000002; retain readiness and PD/cycle filters |
| `shared/config/requestReadiness.js` | Linked modern cycle before 2027 is exempt; J27+ requires literal true; unclassifiable link excluded | Reuse the cutover and gate, without bypasses |

A new staff Phase I branch must not use Phase I Status = Pending Committee
Review as its only gate: staff recommendations may change that field while
Request Status remains Phase I Pending. This increment admits that in-flight
Phase I cohort by the high-level request status; it does not implement the
future staff-state lifecycle or discard triaged rows because a recommendation
changed.

## Eligibility contract

[PLANNED]

| Surface / era | Rule after the change |
|---|---|
| Staff dashboard, pre-J27 | Exact existing lifecycle/set-aside rules; readiness does not change eligibility |
| Staff dashboard, J27+ | Ready AND (existing lifecycle eligibility OR Request Status = Phase I Pending) |
| Reviewer Finder actionable, pre-J27 | Exact existing Phase II Pending AND Phase II Status null |
| Reviewer Finder actionable, J27+ | Ready AND Phase II Pending AND (Phase II Status null OR 100000002) |
| Reviewer Finder status=all | Existing Phase II Pending rule, existing PD/cycle scope, deployed readiness gate; no Phase I addition |
| Unknown/missing cycle or readiness in J27+ | No new eligibility; preserve fail-closed readiness handling |

The J27+ null Phase II case remains eligible to preserve the existing accepted
path; this is an additive change. Recommended, Not Recommended, Approved,
Declined, Deferred, Withdrawn, unknown numeric values and other non-null Phase
II outcomes do not enter actionable through the new branch. Phase I requests,
Concepts and declined requests do not enter Reviewer Finder through it.
Phase I Invited remains the expected producer contract for advanced requests;
do not add an extra Phase I filter to an existing list in this additive change.
An inconsistent producer record is not repaired by this read path.

J27 is a fixed process cutover, not a maintained allowlist. Derive era from the
linked operations Grant Cycle and the existing parser. Do not use request dates
or lexically compare J/D codes. Readiness remains an outer AND, including when
scope=all, includeSetAside or status=all is selected; no test/superuser bypass.

## Staff list presentation

[DEFERRED BY OWNER 2026-11-02; requires broader workflow review, not approval to build]
Use the existing list layout and controls, with a minimal Phase I variant:

- Identify a Phase I row as **Staff review** and link to the Proposal tab.
  Keep number, institution, PI/PD identity, test badge and ordinary counts.
- Do not label it Find reviewers or display empty reviewer coverage/progress.
  Hide the old Advancing / Set aside control on these Phase I rows; it is not
  the new J27 staff-state editor. Peer-review rows retain their present display.
- Keep ready Phase I rows visible regardless of the legacy D26 triage field;
  the Set aside toggle continues controlling the existing legacy branch only.
  Count added Phase I rows as ordinary active staff rows, never as D26 set-aside
  because of a stale legacy field. Test rows follow current count isolation.
- Add an explicit DTO discriminator, e.g. `reviewStage: 'phase-i' | 'peer-review'`.
  Classify a row as `phase-i` only when its linked cycle is J27+ and Request
  Status is Phase I Pending; this classification takes precedence over stale
  legacy Advancing/Set aside values. A pre-J27 Phase I row already admitted
  through the legacy Advancing branch retains its old peer-review presentation.
  Phase I DTOs use `workRemaining: null` and `reviewers: null`, rather than a
  fabricated reviewer work stage. Keep reviewer-rollup's
  stage union unchanged; return a separate `rollup.staffReview` count and retain
  existing `rollup.stages` for peer-review rows. Total includes both ordinary
  cohorts. Update list summary text to account for staff review distinctly.

This is a visibility/display increment, not bulk triage, staff-state persistence,
Initial Assessment generation, invitations or status editing. The proposed
presentation needs owner confirmation; eligibility scope itself is requested.

## Keep staff discovery separate from downstream operational eligibility

[VERIFIED via caller inspection]
Meeting Tracker's `lib/services/meeting-tracker/dashboard-service.js` invokes
**both** `loadDashboard` (default/detail and cycle-list modes) and
`loadMeetingTrackerSelection` (selected-cycle schedule projection). Discussion
Sentiment uses the latter. Other services use the lifecycle helper directly:
Program Briefing, Staff Deliberations, Review Panel, Cycle Dossier and existing
meeting/material/transcription action checks.

[PLANNED] Do not globally broaden `buildVisibilityFilter` or
`isVisibleRequestRow`. Add a staff-specific entry point in the dashboard service
(e.g. `loadStaffDashboard`) and have only the Workbench dashboard route call it.
Keep `loadDashboard` and `loadMeetingTrackerSelection` operationally compatible
for their existing callers. Use an internal service selection mode, never a
client-controlled authorization bypass. The staff entry must select the same
mode for cycle discovery, row selection, defaults and counts. The shared
Workbench shell may then list a Phase-I-only cycle even when a different
operational view in that shell has no rows; that is a legitimate empty view,
not permission to broaden its roster.

Program-default resolution must also take that internal audience context:
ready Phase I assignments can affect the staff default, without changing
Meeting Tracker/operational defaults for callers using the old mode. Preserve
the active program catalog, capped-read fallback and existing auth restrictions.

For staff candidate reads, query the existing lifecycle set OR Phase I Pending,
then apply the precise linked-era predicate and readiness to the **complete**
server-side result before projections/counts/hydration. This avoids new cycle
inventory queries and unsupported OData string comparisons. Select status,
triage, readiness and cycle expansion wherever the row predicate consumes them.
Do not trust a caller-supplied cycle argument to grant the era exception.

For Reviewer Finder's selected-cycle query, normalize/parse the cycle using the
existing helpers and add the Phase II pending option only for J27+. Keep the
existing linked-cycle filter and row readiness recheck. Its cycle-list mode
currently counts PD-owned linked requests independently of actionable status;
do not quietly redefine that picker contract in this patch.

## Build sequence and invariants

1. Add the smallest pure staff-eligibility rule and named Phase II option
   constant, with truth-table coverage. Reuse the readiness/cycle contract;
   do not merge staff discovery with reviewer assignment semantics.
2. Wire staff-only route/service, cycle/default/program counts and DTO
   projections. Fetch reviewer rollups only for peer-review rows. Verify the
   ordinary/test count rules for mixed and Phase-I-only cycles.
3. Add the small row variant and summary count, preserving existing rendering,
   focus behavior and loading/error feedback for legacy rows. Preserve
   `RequestListPanel` request-generation/context guards and the shell's cycle
   generation guard for both success and failure paths after awaits.
4. Extend Reviewer Finder actionable predicate; retain full DTO, suggestion
   count chunking, primary-PD filtering and incomplete-read refusal.
5. Independent review, scoped gates and tests, then PR. No merge/deploy or
   Production state changes are part of this planning request.

## Acceptance tests

[PLANNED; not yet run]

- D26 and earlier: identical eligible IDs, counts, defaults, row destinations,
  triage control, actionable null-only behavior, and status=all behavior.
- Ready J27/D27/J28 Phase I Pending: staff list/cycle picker/default include it;
  staff-review count increments; not marked as needing reviewers. Unready,
  missing and non-Boolean values remain excluded under the readiness contract.
- Phase I recommendation changes while high-level status stays Phase I Pending:
  stays in staff discovery. Phase I Declined / Concept / unknown statuses gain
  no eligibility from the new branch. Both status and phase fields are read,
  never written by these lists.
- Mixed staff/peer cohorts: total and stage counts reconcile; downstream
  reviewer-rollup calls receive peer IDs only; test rows do not inflate counts.
- Advanced J27 ready + Phase II Pending + 100000002: actionable includes it.
  The same row in D26 stays excluded; null remains accepted in both eras.
  Enumerate every live Phase II option plus an unknown option to prove only
  the intended addition; retain status=all unchanged except its existing gate.
- Route-level tests, including the fixture that failed PR #611 CI, must carry
  real cycle expansions and readiness fields. Cover empty, capped/hasMore,
  malformed response, PD/program scope, rapid cycle/program changes and retry.
- Both Meeting Tracker calling modes and its cycle picker, Discussion Sentiment,
  Staff Deliberations, Program Briefing and Review Panel do not gain Phase I
  membership. Test with ready Phase I records actually present in the fixture.
- UI tests: Phase I opens Proposal and has no review-progress/old triage cues;
  peer rows remain unchanged. Test stage-summary labels and null DTO handling.
  Run status-enum parity and its self-test; don't extend `workRemaining` for
  an intake stage unless every producer/consumer contract is deliberately changed.

## Verification, durable surfaces and recommendation evidence

[PLANNED] Run affected route/service/component suites (including stale-request
matrices), type check, lint/build and applicable gates/self-tests sequentially:
API routes/security, Atlas, DAL/OData, route-service boundary, status-enum parity,
meeting-date-read ratchet, doc currency/fact/symbol checks. Existing route identity
and matrix entry stay in place; no new route, table, migration or backend flow.
Update the readiness plan's adjacent-dependency section, relevant Atlas/source
headers and J27 owning record with verified implementation status at build time.
Coordinate durable-file ownership with Claude before touching its active plans.

Contract-reconcile review: whole-flow traced above; partial success = read-only
lists, preserve complete-read/cap handling; async = preserve and test existing
generation guards; helper = staff discovery and reviewer lifecycle separated;
durable = no new persistence; fan-out = both Tracker modes plus direct lifecycle
consumers explicitly protected. New DTO discriminator/counts require consumer
coverage and total enum mappings. Bounded doc sweep: readiness evidence AGREES;
old null-only actionable source is VERIFIED current behavior, not current intent;
prior readiness plan's adjacent gaps remain PLANNED until this work ships.

Recommendation evidence: the source paths establish the two gaps and show why a
global lifecycle-filter edit would broaden other rosters. Contrary checks:
Meeting Tracker's default path also calls `loadDashboard`, and an unchanged
`deriveWorkRemaining(emptyCounts())` would label a new Phase I row Find reviewers;
both are accounted for here. No runtime prototype, new live schema query or
Phase-I-ready Production positive was tested by this planning pass.

Current bounded implementation: `lib/services/reviewer-finder/my-proposals-service.js`
now adds the 100000002 alternative only in J27+ actionable queries. Pre-J27,
status=all, readiness, PD/cycle constraints, projections and suggestion hydration
are retained. Service/route tests exercise all eight Phase II options plus unknown,
null, old/new cycles, readiness negatives and the formatted-label response.

Owner scope decision: defer the Phase I presentation and broader workflow; the
above staff design is a draft, not a confirmed brief or build authorization.
Only the independent Reviewer Finder compatibility fix was implemented in this
workstream. The separate Factory plan now starts with prepared reviewer-workflow
fixtures (`docs/plans/J27_TEST_REQUEST_FACTORY_FINISH_PLAN_2026-11-02.md`); no
Factory runtime writes or dashboard/UI changes are included here.

## Historical planning-pass verification (before the Reviewer Finder build)

Planning checks: all 11 scoped documentation gate/self-test commands passed;
`git diff --check` passed. Independent read-only review checked service routing,
legacy presentation and the explicit null DTO contract. No runtime edits,
live calls or rollout actions were performed.

## Reviewer Finder build verification

[VERIFIED locally, 2026-11-02] All 54 targeted service/route/readiness tests
passed. Scoped ESLint passed. Independent read-only source review reported no
material findings. No live calls, business-record writes, merge or deployment
were performed for this compatibility change. All 18 scoped gate/self-test commands (including the J27 register pair),
type check and production build passed. Phase I dashboard work remains deferred. Factory work has a separate
prepared-fixture plan; it is not implemented by this Reviewer Finder change.
