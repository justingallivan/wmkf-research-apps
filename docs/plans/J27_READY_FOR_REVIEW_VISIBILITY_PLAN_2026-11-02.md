# J27 ready-for-review visibility plan

Status: **PLANNED; no runtime change. Bounded Production read completed 2026-11-02; flow execution unverified.**
Owner: Codex, branch `codex/session-660-start`; written 2026-11-02 Pacific.
Scope: PD dashboard discovery for J27 and later; preserve earlier-cycle behavior.

## Owner decisions

[VERIFIED via Justin's 2026-11-02 messages, including Connor's relayed response]
`akoya_request.wmkf_readyforreview` is the authoritative intake handoff marker.
Power Automate sets it after backend work, including document assembly and AI
analysis, has completed and proposals are ready for staff work. PDs must not
see affected requests on their dashboards before this marker is ready.
Justin explicitly chose **J27 and later; preserve earlier-cycle visibility**.
The apps consume this marker; this feature does not set it or start the flows.

This is an additional visibility prerequisite. It does not replace request
lifecycle, staff state, PD/program scope, test isolation, authorization, or
reviewer eligibility. In particular, ready does not mean invited for peer review.

## Contract surface and evidence

Entry points: `/api/workbench/dashboard` (also Meeting Tracker's shared selection)
and `/api/reviewer-finder/my-proposals`. Persistence: existing Dataverse Request
field and linked operations Grant Cycle; no new table, column, or app-owned copy.
Producer: external Power Automate, implementation not inspected here. Consumers:
server-side discovery queries, cycle pickers, proposal lists and their totals,
then the UI. Prior finding: current discovery is not gated on this marker.

[VERIFIED via source inspection at `fb8afa427`]

| Surface | Evidence and current behavior | Planned treatment |
|---|---|---|
| Workbench lifecycle visibility | `shared/config/workbenchVisibility.js`, `buildVisibilityFilter` and `isVisibleRequestRow`: Phase II Pending / Advancing / Set aside; no readiness check | Keep existing lifecycle semantics; compose a separate readiness rule for discovery |
| Workbench dashboard and Meeting Tracker selection | `lib/services/workbench/dashboard-service.js`, `listCycles`, `selectProposalRecords`, `loadMeetingTrackerSelection`: cycle list and proposal list share the existing visibility filter | Gate both query paths before counts, default-cycle derivation and reviewer rollups |
| Program default | `lib/services/workbench/program-scope-service.js`, `assignmentFilter`: derives caller's program from visible assignments | Apply readiness to assignment discovery too; preserve active program catalog and existing fallback |
| Reviewer Finder My Proposals | `lib/services/reviewer-finder/my-proposals-service.js`, `listCycles`, `listProposalsInCycle`: separate filters; actionable additionally requires null Phase II Status | Gate both modes, including `status=all`; preserve reviewer eligibility separately |
| Cycle source | `lib/dataverse/adapters/operations-grant-cycle.js`, `linkedCycleExpand`, `linkedCycleCode`, `linkedCycleFilter` | Derive era only from the Request's Grant Cycle link; no request meeting-date or created-date fallback |
| Row-predicate regression coverage | `tests/unit/workbench-visibility-row-predicate.test.js` | Keep legacy truth table and add independent readiness / composition coverage |
| Field schema | `docs/atlas/dataverse-akoya-request.md`, Custom Picklists: records `wmkf_readyforreview` as Picklist | STALE/CONFLICT: live probe confirms Boolean Yes/No; ready is exact `true` |

A repository search for `wmkf_readyforreview` in `lib`, `shared`, `pages`,
`scripts` and `tests` found no runtime consumer. A contrary hit there would
falsify the absence claim; the broader docs search found Atlas/evidence mentions.
No claim about deployed behavior or Power Automate definitions is established by
these source reads.

[VERIFIED via `scripts/probe-j27-readiness-contract.cjs`, owner-authorized
Production GETs, 2026-11-02] The field is Boolean: Yes/true and No/false.
Receipt: `docs/plans/evidence/j27-readiness-production-2026-11-02.json`. Both
1003391 and 1003384 link to J27, have readiness false, Request Status Phase I
Pending, Phase I raw value 100000000, Phase II null, and test marker false.
Phase I formatted labels were not returned; do not infer that label from this
raw value alone. Neither example proves a completed automation handoff.
The Atlas Picklist classification is STALE/CONFLICT; reconcile it with its
other field groupings in the implementation documentation pass.

## Visibility rule

[PLANNED]

| Linked cycle | Readiness value | Result of new prerequisite |
|---|---|---|
| Earlier than J27 | Any, including missing | Preserve existing visibility exactly |
| J27 or later | Exact verified ready value | Pass; existing surface eligibility still decides inclusion |
| J27 or later | Null, missing, not-ready, or unknown value | Hide from dashboard discovery and its counts |
| Missing / malformed / unreadable linked cycle | Any | Cannot prove legacy exemption: do not admit through dashboard discovery; report incomplete data through existing operational error handling |

Compare parsed J/D cycle chronology (year, then June/December), never lexical
code order. J27 is a one-time process cutover, not a list requiring a new entry
for D27, J28, etc. Reuse existing cycle parsing. Readiness failure must sit
outside all lifecycle OR branches, so Advancing, Set aside, `status=all`, scope
`all`, or a test marker cannot bypass it. Do not truth-test the raw field:
nonzero picklist values may represent not-ready.

Use a small shared readiness policy with equivalent row and query behavior.
Keep the dependency-free lifecycle module independent of DAL imports. Place
linked-cycle query construction at the existing adapter/service boundary with
restriction checks preserved. For known-cycle queries, classify that verified
cycle and add the ready equality when required. For cross-cycle discovery,
resolve and partition linked cycle IDs from the operations calendar, then build
an equivalent server-side filter; page all required calendar rows, fail on an
incomplete inventory, and respect URL bounds with bounded chunks if needed.
Do not filter a paginated response only in the browser: that produces incorrect
counts, empty pages and inconsistent cycle/default selection. Exact query shape
must be checked against authorized Dataverse reads before implementation is
accepted; no untested string-range OData comparison is assumed to work.

## Shared consumers and scope boundary

[VERIFIED via import/call-site census] The lifecycle helper also feeds:
`lib/services/pre-site-visit/cycle-list-service.js`,
`lib/services/meeting-tracker/program-briefing-service.js`,
`lib/services/review-panel-rollout.js`, and
`lib/services/cycle-dossier-rollout.js`. Row checks also occur in
`lib/services/meeting-tracker-transcription/binding.js`,
`lib/services/meeting-coordination/invitation-service.js`,
`lib/services/site-visit/logistics-service.js`, and
`lib/services/site-visit-materials/collection-service.js`.

[VERIFIED via `lib/services/post-presentation-materials/discussion-sentiment-candidates.js`]
Discussion Sentiment indirectly uses `loadMeetingTrackerSelection` for its
candidate picker. Test the inherited discovery gate there as well; existing
analysis records and direct analysis operations are outside this filter change.

These are a consumer inventory, not proof that every path was audited end to
end. Review each discovery/roster query before implementation and apply the new
prerequisite to PD-facing dashboard rosters. Do not silently change an existing
meeting, materials, invitation or transcription action's eligibility by adding
readiness to the shared lifecycle helper. Those persistent workflows need their
own semantics when readiness is cleared; changing them is outside this plan.

[PLANNED; scope limit] This plan hides dashboard discovery, not record access.
Workbench request search (`lib/services/workbench/request-search-service.js`),
direct resolution (`lib/services/workbench/resolve-request-service.js`), Dynamics
Explorer and administrator diagnostics remain separate. If the owner wants
unready records unavailable through search/direct links too, define that as an
explicit extension with server guards and matching UI behavior; dashboard
filtering alone cannot provide it. Existing auth/restrictions stay enforced.

## Implementation sequence

1. **Verify the external input contract before writing runtime logic.** With
   specific owner authorization for Production reads (or owner-run evidence),
   inspect the field metadata, actual ready/not-ready values and representative
   J27 records, including 1003391 and 1003384. Confirm with Connor that the flow
   writes ready only after every required assembly/AI step succeeds. Confirm
   whether reruns clear readiness, when it is cleared, and whether failures can
   leave a previously ready value. Do not infer complete output from status or
   filename. Record the producer contract and exact approved value mapping.
2. **Implement the shared readiness policy and required discovery consumers**
   on a runtime feature branch. Add required field projections and linked-cycle
   expansion to row readers; OData-only filters need not select a field unless
   a later row consumer reads it. Audit every relevant select/expand, including
   cycle counts, program defaults and sibling dashboard rosters. No new route,
   schema, env allowlist, background job, or client-supplied bypass is planned.
3. **Verify before promotion.** Run the tests below and relevant gates,
   sequentially with their self-tests: types, Atlas, API routes if routes change,
   DAL, OData, request-meeting-date reads, status parity, and documentation gates.
   Perform an authorized Preview read comparison. No automatic Production
   backfill or readiness toggling is included. Existing D26 results must match;
   unready J27 rows must be absent from every in-scope list/count.
4. **Promote deliberately**, then observe an actual Power Automate completion:
   the request appears on a fresh dashboard fetch without app-side flag writes.
   Inspect source of readiness on failure; never weaken the equality to make
   missing records appear. Record deployment and observation separately.

## Acceptance and negative-space checks

[PLANNED; not executed]

- Independent table tests: D26/earlier with absent/not-ready/ready fields retain
  prior lifecycle results; J27/D27/J28 with not-ready/null/missing/unknown values
  are hidden; exact ready passes only when that surface's other rules pass.
- Cross-product cases: unready + Phase II Pending, Advancing, Set aside enabled,
  `status=all`, `scope=all`, superuser, test marker; none bypass readiness in the
  dashboard. Ready does not bypass PD/program/auth restrictions.
- Missing cycle, malformed cycle, missing projection and calendar-read failure
  cannot masquerade as pre-J27. Verify row/query parity and pagination/count
  behavior with mixed old/new cohorts, not merely filter-string assertions.
- Service tests cover both cycle-list and request-list modes and program-default
  discovery. Existing selected cycle remains a valid empty state after the last
  visible request becomes unready. Failed reads must not return stale eligible
  rows as a successful refreshed feed.
- Verify readiness appears on the next normal refresh; no new polling assumed.
  Inspect existing client generation/abort guards during implementation so an
  earlier cycle/program response cannot overwrite the latest selection.
- Factory integration is a separate write change: never copy a source's ready
  marker or set it merely to make a clone visible. Any fixture that bypasses
  Power Automate needs an explicit owner-defined artifact-completion contract.

## Adjacent J27 dependencies

[VERIFIED via source] Current Workbench eligibility does not include an untriaged
`Phase I Pending` request. Therefore this gate alone will **not** make every
ready newly submitted J27 proposal visible. The planned J27 staff-intake list
must compose readiness with its own submitted-stage/staff-state eligibility,
without broadening Reviewer Finder into Phase I reviewer assignment.

[VERIFIED via `lib/services/reviewer-finder/my-proposals-service.js`,
`listProposalsInCycle`] Reviewer Finder actionable mode requires null
`wmkf_phaseiistatus`. Connor specifies non-null `Phase II Pending Committee
Review` for advanced J27 requests. Consequently even a ready advanced J27 row
can be excluded there. Resolve J27 actionable-status semantics in the relevant
reviewer lifecycle work before claiming end-to-end visibility; this gate-only
change must not silently remove that existing eligibility rule. Test both the
newly submitted and advanced J27 examples against their intended surfaces.

[PLANNED / unresolved] Keep this work aligned with
`docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` (staff-intake list and staff-state
work). Its D25 describes an upstream files-ready trigger for the AI pass; this
handoff marker is downstream of assembly **and** AI completion. Do not collapse
those two milestones or substitute readiness for the still-unconfirmed staff
state / program-at-submission fields. This plan does not claim D25's upstream
field was provisioned or decide its identity.

## Contract-reconcile / bounded sweep record

Review mode; seven audit dispositions:
whole-flow PARTIAL (live schema verified; external writer uninspected); partial-success
PLANNED (all required producer steps must succeed before ready); async PLANNED
(refresh and generation guards to inspect); helper semantics PLANNED (new
readiness rule, existing lifecycle helper preserved); durable surfaces PLANNED
(no new persistence, update Atlas/runtime docs with implementation evidence);
doc reconciliation PARTIAL; symbol fan-out inventoried above, not fully audited.

Bounded sweep mode A, claim: owner-defined readiness is a post-automation PD
visibility prerequisite, J27 onward. Authoritative intent: this conversation;
implementation evidence: source at `fb8afa427`. Searches covered source, tests,
scripts, docs, memory/wiki and root instructions/session prompt for the field,
readiness and J27 visibility. Atlas field mentions are AGREE on existence but
STALE on the Picklist classification, contradicted by the live Boolean metadata; old saved-view evidence is HISTORICAL; D25's
files-ready AI trigger is a distinct upstream milestone, not a contradictory
completion claim. The new plan is PLANNED. No owning J27/Factory documents were
edited while Claude works in parallel. Broader reconciliation is AUDIT
INCOMPLETE until the external contract and in-scope sibling consumers are
verified; this is not a whole-repo readiness certification.

Recommendation evidence: the policy composition is supported by the inspected
query paths and owner intent, but query parity, end-to-end
Power Automate handoff are NOT TESTED; live Boolean mapping is now verified. A ready J27 Phase I row still failing the
legacy lifecycle predicate is the explicit disconfirming case for claiming this
gate alone delivers staff intake. Verdict: **NEEDS PRODUCER COMPLETION/RERUN CONTRACT VERIFICATION
BEFORE RUNTIME IMPLEMENTATION**, with scope decisions already recorded above.
