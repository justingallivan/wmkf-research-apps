# J27 ready-for-review visibility gate

Status: **DEPLOYED via PR #611; bounded Production Workbench visibility verification passed 2026-11-02.**
Owner: Codex, `codex/session-660-start`, 2026-11-02 Pacific.
Scope: PD dashboard discovery for J27 and later; preserve earlier-cycle eligibility.

## Owner decisions and input contract

[VERIFIED via Justin's 2026-11-02 messages and Connor's relayed response]
Power Automate sets `akoya_request.wmkf_readyforreview` after backend processing,
including document assembly and AI analysis, is complete and proposals are ready
for staff work. PD dashboards must hide J27-and-later requests until ready.
Earlier cycles keep their existing eligibility. The apps read the marker and
never set it or start the flows as part of visibility filtering.

**Accepted operational risk (Justin, 2026-11-02):** PDs generally wait for Connor's
release notice before logging in. Post-release reruns are expected to be rare
and quick. Whether a rerun clears readiness, or a failure leaves a prior true
value, is not an implementation blocker. Use the current Boolean on normal
refresh; add no rerun safeguards, polling, app-owned completion state or extra
producer prerequisites.

[VERIFIED via owner-authorized Production GETs]
`scripts/probe-j27-readiness-contract.cjs` confirmed Boolean Yes/true and No/false.
Minimal receipt: `docs/plans/evidence/j27-readiness-production-2026-11-02.json`.
Requests 1003391 and 1003384 both link to J27 and have readiness false, Request
Status Phase I Pending, Phase I raw value 100000000, Phase II null, and test
marker false. Neither is evidence of completed automation. No flow was executed
or inspected; no Production data was written. The Atlas's former Picklist
classification is corrected to Boolean using this evidence.

## Invariants

| Invariant | Implementation surface | Verification |
|---|---|---|
| Linked cycles before J27 retain prior eligibility regardless of readiness | `shared/config/requestReadiness.js` | Pre-J27 truth table + existing D26 service tests |
| Linked J27/D27 and all later cycles require exact `true` | Same policy + all services below | Null/false/missing/numeric/string negatives and ready-positive service fixtures |
| No lifecycle, PD/program, authorization, test-isolation or action bypass | Readiness is composed after existing queries, before projection | Existing lifecycle/filter tests; test-marker/triage negative cases |
| Counts/defaults and hydration use only eligible requests | Server service consumers | Hidden row IDs absent from rollup/document/sentiment calls; no stale count success |
| Incomplete reads do not yield partial dashboard success | Existing bounded query contracts | Capped/hasMore tests; program-default fallback remains existing behavior |
| No new persistence, writes, routes, polling or per-cycle allowlist | Read-only policy and service edits | Diff, gates, independent review |

## Rule and execution strategy

[VERIFIED via source on this branch]
`isRequestReadyForStaff` reads the expanded Grant Cycle code, matching the
canonical `linkedCycleCode` grammar; it reuses `parseCycleCode`. J27 is the first
cycle in 2027, so parsed years before 2027 are exempt. Every linked modern cycle
in 2027 or later requires `wmkf_readyforreview === true`. This rolls forward
without a cycle list or new environment setting. No lexical code comparison,
request meeting date, creation date, status or test marker establishes an era.
An absent/malformed cycle expansion cannot establish the pre-J27 exemption and
is omitted from the normal operational discovery surfaces.

The smallest implementation uses **complete server-side request reads** and
filters their records before counts, default selection, hydration or response
projection. Existing `queryAllRequests` follows all Dataverse next links under
its export bound (`lib/services/dynamics/read-ops.js`); services refuse capped
or incomplete roster reads. Program-default assignment discovery retains its
existing Research fallback on a capped scan, rather than deriving an assignment
from incomplete data. The Final Writeups scoped reader retains its existing
100-row cap/hasMore refusal before filtering. No client page is filtered after
pagination, and no additional calendar inventory query is needed. This replaces
the draft's proposed calendar-ID partition/query construction and requires no
new Dataverse filter syntax or further live Production reads.

Every row reader selects `wmkf_readyforreview` and expands the existing
`wmkf_GrantCycle` link under the current restriction/auth context. No raw count
from the pre-filter read is returned as an eligible-request count.

## Caller → persistence → consumer coverage

[VERIFIED via inspected service source]

| Discovery consumer | Read and filter point | Downstream effect |
|---|---|---|
| Workbench dashboard | `lib/services/workbench/dashboard-service.js`, cycle and proposal modes | Cycles, counts, defaults, reviewer-rollup IDs, lists and totals |
| Meeting Tracker schedule | Same service, `loadMeetingTrackerSelection` | Shared request roster; Discussion Sentiment's picker inherits this source |
| Default Grant Program | `lib/services/workbench/program-scope-service.js` | Only ready/legacy assignments influence newest-cycle program default; catalog unchanged |
| Reviewer Finder My Proposals | `lib/services/reviewer-finder/my-proposals-service.js`, both modes and status=all | Cycle counts and proposals before reviewer-suggestion hydration |
| Program Briefing | `lib/services/meeting-tracker/program-briefing-service.js` | Cycle picker and printable groups before document/sentiment reads; existing membership validation retained |
| Staff Deliberations | `lib/services/pre-site-visit/cycle-list-service.js` | Request-first list/counts before document/schedule/material reads |
| Review Panel roster | `lib/services/review-panel-service.js` | Candidate roster before rollout/selection projection |
| Final Writeups index | `lib/services/final-writeup/dashboard-service.js` | Cycles, default walkback, queues/counts and coordinator matrix before document reads |

**Final Writeups historical/direct exceptions:** its existing `none` lens is an
explicit archival workflow for current Finals without a modern linked cycle;
that lens and its picker availability remain unchanged. The exemption is enforced
by `!linkedCycleCode(request)`, and cannot admit a row linked to J27 or later.
Focused `selectedRequestId` reads retain direct-access behavior, including the
existing within-cycle navigation. The readiness gate applies to the unfocused
index; this is discovery filtering, not an authorization or record-access gate.
These preserve existing Final workflows rather than claiming an unlinked record
has a known pre-J27 era.

The Cycle Dossier roster remains D26-only via `DOSSIER_CYCLE` and
`buildDossierRosterFilter` (`lib/services/cycle-dossier-rollout.js`), so no readiness
change is needed there. Existing action checks using `isVisibleRequestRow` in
meeting invitations, transcription binding, Site Visit logistics and materials
remain lifecycle-only. The lifecycle helper is unchanged. Workbench request
search, direct resolution, Dynamics Explorer and administrator diagnostics
remain outside the dashboard discovery gate.

## Adjacent J27 work, not part of this change

[VERIFIED via existing source] An untriaged Phase I Pending row still fails the
Workbench lifecycle predicate, even when ready. The J27 staff-intake-list work
must add submitted-stage/staff-state eligibility separately. Reviewer Finder's
actionable filter still requires null Phase II Status; Connor's advanced J27
contract specifies Phase II Pending Committee Review. That compatibility change
also remains separate. This gate does not promise those rows become visible
where existing lifecycle rules exclude them.

`docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` D25 describes an upstream files-ready
trigger for AI. This downstream assembly-and-AI completion marker does not prove
that upstream field was provisioned or replace staff-state/program-at-submission
fields. No owning Factory/J27 flow plan is modified while Claude works in parallel.

## Verification and release

Targeted mocked service tests cover actual hidden J27 rows, ready positives,
legacy D26 rows without readiness, cycle/count/default behavior, downstream
hydration IDs, empty selected cycles, strict Boolean semantics, and incomplete
read refusal. Existing lifecycle truth-table, Meeting Tracker, Discussion
Sentiment, Final Writeups archival/focused, and program-scope tests cover retained
contracts. No new asynchronous client behavior is introduced; the current marker
is re-read on each normal server fetch. Accepted rerun risk is not a new stale
state protocol to implement.

Run scoped tests and relevant gates, each gate/self-test sequentially: types,
Atlas, DAL, OData, request-meeting-date reads, status parity, documentation and
secret checks. Review the final diff independently before completion. Runtime work merged via PR #611 (`46b4cd2cf`). Vercel deployment
`dpl_AVPRpii82wjn6MYhSAWSqZmen7Ed` is Production Ready with the
`applications.wmkeck.org` alias. Actual Power Automate completion visibility
remains an operational observation, not a prerequisite to implementation.

## Contract reconciliation and bounded sweep

Implementation mode. Whole-flow: existing authenticated routes → server service
→ Dataverse readiness/cycle read → filter → counts/hydration → existing DTO/UI.
Partial success: no batch writes; capped rosters refused (program-default fallback
retained). Async: no new client/state writes, background work, caching or polling.
Helper: readiness prerequisite only, lifecycle/action helpers unchanged. Durable:
no new schema/migration/route; Atlas corrected, this plan rewritten around accepted
intent. Symbol fan-out: consumers listed above; direct/action exclusions explicit.

Bounded sweep mode A: readiness type/semantics and implementation status. Searches
of source/tests/docs/wiki/memory found the Atlas type misclassification (corrected),
the initial plan's unresolved rerun blocker (removed), and old saved-view evidence
(historical, unchanged). D25 is a distinct upstream milestone. No claim that all
J27 intake is implemented or that Power Automate has been live-tested follows
from this change. Local verification (2026-11-02): 279 tests passed across 11 targeted suites;
scoped ESLint passed; `npm run build` passed (seven dynamic filesystem/tracing
warnings, no build errors); all 24 scoped gate/self-test commands named above
passed, run sequentially. Independent read-only source review found and closed
the initially omitted Final Writeups index path, then reported no further
material findings. `git diff --check` passed. No additional live Production
read, write, flow run or deploy was performed for implementation.

[VERIFIED via owner-authorized read-only Production check, 2026-11-02]
Deployment inspected Ready. Authenticated Research Workbench GETs returned D26
25 rows / 23 ordinary by default and 208 rows / 199 ordinary including set-aside;
request-number fingerprints match the independent live Dataverse query. Applying
the new predicate to the same live D26 cohort preserves the exact old eligible
ID sets in both modes. J27 has six unready rows; one meets old lifecycle
eligibility, but the deployed dashboard returns zero rows in both modes. Named
examples 1003391 and 1003384 remain unready and absent (also excluded by old
lifecycle rules). No ready J27 positive exists to observe, and no write was used
to manufacture one. No historical before-deploy snapshot is claimed. Scope is
Research Workbench, all-PD mode, not every application/program. Probe:
`scripts/probe-j27-readiness-visibility.cjs`; minimal evidence:
`docs/plans/evidence/j27-readiness-production-visibility-2026-11-02.json`.

Bounded verdict: source implementation, local regressions, deployment and this
live negative/legacy check VERIFIED; natural positive handoff remains unobserved. The operational rerun risk
is accepted, not unresolved. Restatement classification within this scope:
Atlas Boolean/input contract AGREE after correction; old initial plan blocker
STALE and replaced; saved-view snapshots HISTORICAL; upstream D25 UNRELATED to
completion semantics. No known stale readiness/type/blocker claim remains in the
modified live plan/Atlas surfaces; this is not a whole-repo J27 certification.
