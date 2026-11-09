# J27 read model and discovery predicate: build plan (steps C and F), revision 5

Author: Claude Fable 5.1 for Justin Gallivan, 2026-11-08. Status: **steps C and D BUILT** on `claude/j27-read-model` at `0fd5dbe45` (owner authorization 2026-11-09 UTC; Codex build review READY WITH NAMED CHANGES, resolved in `6f3bd34b7`, record in `J27_READ_MODEL_BUILD_REVIEW_2026-11-09.md`); page-side recomputation deferred to step E; step F not authorized. Baseline: `codex/j27-workbench-reports` at `97f696faf`.

Revision 3 resolves the six round-2 named changes: F1 projection contract, strict cycle grammar, outer grouping, paging, independent probe; Final Writeups unchanged and Reviewer Finder given its own predicate; Review Panel projection and post-filter; rollup population preserved; C7 orchestration restated as tier 1 on the server and tier 2 composed on the request page (budget stated in C7); integrity state defined over screenings, not jobs; phase, task, and blocker contradictions removed; citations corrected; fixtures and scenario end states inlined.

## 0. Owner decisions (recorded; none assumed)

- **D1** discovery: J27+ Research rows admitted by `wmkf_readyforreview = true` alone (Set aside does not exclude them). Pre-2027 cycles and every non-Research program keep today's composition unchanged: legacy clause (Phase II Pending or Advancing, not Set aside) and the existing readiness post-filter where a caller applies it.
- **D2** gates: reviewer identification ungated; invitations need Phase I Invited and request status Phase II Pending; presentation operations keep the legacy predicate until D7.
- **D3**: Semi-finalist No and First Cut Not Scored are terminal; Semi-finalist Yes is "Recommended to Chairs, awaiting outcome".
- **D4** (closed 2026-11-08): no coverage threshold; `record-offramp` available from Recommended Invite onward, never blocked; received count and dates are information.
- **D5**: lead PD or superuser may change First Cut or Semi-finalist at any time. Not existing behavior (`first-cut-service.js:49`; `j27FirstCut.js:3,14`). Step G item.
- **D6**: a flagged screen without PD review blocks reviewer invitations and presentation scheduling. This plan blocks exactly `send-invitations` and `schedule-presentation`; widening to materials, invitation email, or transcription would be a new owner decision and is not assumed.
- **D7** open: no offramp state; `continue-decision-missing` blocks the four presentation operations (scheduling, materials, invitation email, transcription). Server enforcement of D7 is a step I item, listed in §4.

## 1. Branch and worktree

`git worktree add -b claude/j27-read-model /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model 97f696faf`, then the per-machine repairs the bootstrap script performs (`.agents/skills` symlink, `.env.local` symlink, `npm install`; `scripts/bootstrap-machine.sh:94-103` itself targets `codex/<slug>` from `origin/main`, so it is not invoked). Review worktree and main checkout untouched. Surface disjoint from the Factory branch.

## 2. Step C: read model

### C1. Module, scope guard, input contract

`lib/services/workbench/j27-read-model.js`, pure, importable by server and client. `deriveJ27Stage(input)`.

Scope guard first: if `input.request.cycleCode` fails the strict grammar (`^[JD]\d{2}$` on the raw value, as `requestReadiness.js:15`) or its year is below 2027, return `{ phase: 'unclassified', recorded, outcome, tasks: [], blockers: [], basis: 'out-of-scope' }`. Everything below applies to J27+ rows.

Each input key is `{ status, ...detail }`, `status ∈ present | absent | unavailable | stale | not-loaded`. `not-loaded`: the caller did not attempt it. `unavailable`: attempted and failed, or schema wave not ready. Neither is `absent`.

Tier 1 (server, both callers):

| Key | Fields | Source and projection change |
|---|---|---|
| `request` | `requestStatus, statusClass, phaseIStatus, phaseIStatusLabel, phaseIIStatus, readyForReview, cycleCode, grantProgramId, triageStatus, isTestRequest` | `resolve-request-service.js:26` SELECT + `wmkf_phaseiistatus, wmkf_readyforreview, wmkf_triagestatus`; `dashboard-service.js:64` `PROPOSAL_SELECT` + `wmkf_phaseistatus` (formatted value gives the label). `statusClass` via `classifyStatus` (`dataverse-export/constants.js:133`, exported `:388`). |
| `rationale`, `reviewSummary`, `visitAssessment`, `rosterMemo` | presence only | memo columns `wmkf_initialassessmentrationale`, `wmkf_staffreviewsummary`, `wmkf_staffvisitassessment`, `wmkf_confirmedmeetingroster` added to both SELECTs only when the matching schema-ready helper says the wave is provisioned (`lib/utils/initial-assessment-rationale-readiness.js`, `lib/utils/j27-integrity-readiness.js` pattern, and the roster/visit helpers of waves 37 to 39); otherwise `unavailable`. `rosterMemo.present` means the JSON is non-empty; it says nothing about the current visit (see C3). |
| `reviewers` | `{ candidates, invited, accepted, received, completed, anySuggestion }` | Dashboard: `fetchReviewerRollup` (`reviewer-rollup.js:67`), already loaded per page. Request page: counts are tier 2, from the per-request rollup the Overview tab already fetches (`OverviewTab.js:68-82`, `useReviewerProgress`); resolution does not fetch the rollup and will not start to. `anySuggestion` is tier 1 on both callers (its own query, below) and is carried as a separate field so the later arrival of counts merges into `reviewers.counts` without overwriting it. `anySuggestion` comes from a **second, separate** adapter query `existsAnySuggestionForRequests(ids)` (`reviewer-suggestion.js`, beside `findForRollup :444`) with filter `(<or-chain>) and <notExcludedFilter()>` and `$select=_wmkf_request_value`; `findForRollup` and every existing count and progress bucket (`reviewer-rollup.js:79-112`) are untouched, pinned by a test that unselected non-declined rows change `anySuggestion` only. |
| `integrity` | `{ latest: null \| { flagged, reviewed, provenance: 'automated' \| 'manual-unverified-target' } }` | New Postgres reader `readLatestIntegrityStates(targetHost, requestIds[])` in `j27-integrity-jobs.js`. Candidate rows: `integrity_screenings` for each `request_id`, LEFT JOIN `j27_integrity_jobs` on `screening_id`. A row with a job is `automated` and is eligible only when `job.target_host = targetHost`; a row without a job is `manual-unverified-target` (both writers store `screening_type = 'workbench'`, `j27-integrity-jobs.js:139`, `integrity-service.js:533`, so provenance comes from the job association, never the type). Winner per request: the globally latest screening for the request, `ORDER BY created_at DESC, id DESC`, exactly as `getLatestRequestIntegrityRun` (`integrity-service.js:151-157`) and the disposition endpoint's `getCurrentRequestScreeningRow` (`:554`, rejected as `screening_not_latest` at `:592` when a review targets an older screening) select it. Target filtering is applied **after** selection, not before: if the winner is an automated screening whose job `target_host` differs from the current target, the key is `unavailable` with detail `other-target-latest` and no review task is raised, because a review of any older local screening would be refused by the endpoint. `flagged` uses the writer's own predicate, any result with `hasConcerns === true` or `matchCount > 0` (`j27-integrity-jobs.js:126`), evaluated over `results`, not `match_count` alone. `reviewed = EXISTS integrity_screening_reviews for the winner`. Accepted limitation, owner-visible: `integrity_screenings` has no target column (`setup-database.js:137`) and Preview can share Postgres with Production, so manual evidence cannot be bound to a target; it is accepted for the same request GUID and labeled `manual-unverified-target`, matching the existing GUID-only latest read at `integrity-service.js:151` (the `first-cut-service.js:52` fence is about Factory rehearsal provenance and is not the precedent). D6 blocking applies to both provenances. A failed query marks the key `unavailable`; a null `j27IntegrityTarget()` does not. Tests: concerns with zero matches; equal timestamps; latest manual superseding automated; reviewed winner; older local flagged screening plus newer other-target screening → `unavailable`, no task; manual evidence without provenance (included, labeled). |
| `calendar` | `{ offrampMeetingDate, reviewsDueDate, today }` | Columns `wmkf_researchofframpmeetingdate`, `wmkf_researchreviewsduedate` (`shared/config/cycleCalendar.js:18-19`). Request page: the calendar read already at `resolve-request-service.js:90` keeps these two. Dashboard proposal-list mode (`listProposals`, `dashboard-service.js:234`) adds one read of the selected cycle's calendar row through the same throwing adapter the request page uses; a throw marks `calendar.unavailable` for the page of rows. Cycle-list mode keeps `listBoardDatesOrNone` (`operations-grant-cycle.js:294`) and does not compute the read model. `today` injected. |
| `capabilities` | `{ readOnly }` | `resolvePreviewReadOnly` (`preview-read-only.js:11`), as `pages/workbench/[requestId].js:495` computes it. Not a blocker; see C6. |
| `features` | `{ semiFinalistEnabled }` | existing helper for `J27_SEMI_FINALIST_ENABLED` |

Tier 2 (request page only; the dashboard passes `not-loaded`):

| Key | Fields | Source |
|---|---|---|
| `presentation` | `{ exists, id, ended: true \| false \| null, legacyException: boolean }` | `transition-state.js` schedule check (`assertScheduledEnd`, `transition-schedule.js:38-44`): `ended: true` when the single eligible presentation's end is in the past; `false` when `presentationSchedule` is `upcoming`; `null` when `unverified`, `missing`, or `not_checked`. `legacyException: true` carries either explicit compatibility reason the server emits, `legacy_complete_review_without_schedule` or `legacy_review_schedule_unverified` (`transition-schedule.js:28-38`), never inferred from a Boolean. Tests: future presentation blocked; exact end boundary; unknown timing blocked; missing presentation blocked; each of the two legacy exceptions allows the task. |
| `roster` | `{ present, stale }` for the current presentation | `meeting-roster-service.js:120-134` result: `roster` non-null and `stale`. Supersedes `rosterMemo` when loaded. |
| `reviewSummary.stale` | boolean | `staff-review-summary-service.js:33` handoff (evidence hash) |
| `boardDraft`, `transition` | `{ exists }`, `{ phase \| null }` | `final-writeup/transition-state.js:16` rows, projected to objective state by a small pure mapper added beside it; actor capabilities (`:48`) not consumed. |

### C2. Recorded decisions and Chairs outcome

From `wmkf_phaseistatus` only. Values: `FIRST_CUT_STATUS`, `SEMI_FINALIST_STATUS` (`j27FirstCut.js:1,8`), Invited 100000003, Not Invited 100000002 (`docs/atlas/dataverse-akoya-request.md:202`).

| Phase I | `firstCut` | `semiFinalist` | `chairsOutcome` | Label |
|---|---|---|---|---|
| unset / Pending Committee Review | unset | unset | pending | none |
| Scored | scored | unset | pending | Scored |
| Not Scored | not-scored | unset | pending | Not Scored (terminal) |
| Recommended Do Not Invite | inferred-scored | no | pending | Triaged (terminal) |
| Recommended Invite | inferred-scored | yes | pending | Recommended to Chairs, awaiting outcome |
| Invited | inferred-scored | inferred-yes | invited | Invited for peer review |
| Not Invited | inferred-scored | inferred-yes | not-invited | Not invited (terminal) |
| other | unset | unset | pending | raw `phaseIStatusLabel`, `recorded.unmapped = true` |

`inferred-*` renders as "implied by the current Phase I value", never as a recorded event.

### C3. Phase precedence (J27+ rows only)

| Order | Phase | Condition |
|---|---|---|
| 1 | decided | `statusClass ∈ {DECIDED_AWARD, DECIDED_NO_AWARD, WITHDRAWN}` |
| 2 | final-assessment | `transition.phase ∈ {group-review, leadership-review}` or `boardDraft.exists === true` |
| 3 | deliberations | `presentation.exists === true`, or `visitAssessment.present`, or (`roster.present` when loaded, else `rosterMemo.present`) |
| 4 | peer-review | `chairsOutcome === 'invited'` or `reviewers.anySuggestion === true` |
| 5 | initial-assessment | total fallback for J27+ |

A row's `basis` is `full` when every input a higher row consults, plus on a non-terminal row every task input (C5), is `present`, `absent`, or `stale`; `partial` when any is `not-loaded`; `degraded` when any is `unavailable`, and `degraded` wins when both apply. Task inputs join the basis so the landing-list cue also covers tasks that may appear once a missing read lands (C8.4 expects every tier 1 key `unavailable` to degrade); a terminal row has no forward tasks, so only the phase rows above it count. As built, `rosterMemo` and `roster` carry presence in their key `status` (`present` / `absent`), and `roster` adds `stale`. `stale` never changes `basis`; it only raises its blocker. Conditions only match on confirmed values; `not-loaded` and `unavailable` never match. There is no `unclassified` for J27+ rows. The dashboard (tier 1 only) can place a row lower than the page does, and `rosterMemo` can place a row at `deliberations` for an obsolete presentation; the page's tier 2 corrects in either direction. The landing list labels `partial` and `degraded` rows with a small "may change when opened" cue.

### C4. Outcome

`outcome ∈ none | not-scored | triaged | not-invited | decided-award | decided-no-award | withdrawn`. Terminal outcome → no forward tasks. No offramp outcome (D7).

### C5. Tasks (display order)

| Key | Present when (all operands confirmed, never `not-loaded`/`unavailable`) | Owner | Phase |
|---|---|---|---|
| record-rationale | `rationale.absent`, no terminal outcome | existing edit rule | initial-assessment |
| record-first-cut | `firstCut === 'unset'` | lead PD / superuser | initial-assessment |
| record-semi-finalist | `firstCut === 'scored'`, `semiFinalist === 'unset'`, `semiFinalistEnabled` | lead PD / superuser | initial-assessment |
| review-integrity | `integrity.latest.flagged && !reviewed` | lead PD | initial-assessment |
| identify-reviewers | no terminal outcome, `completed < 3` | lead PD | peer-review; secondary, quiet link on the landing list |
| send-invitations | `chairsOutcome === 'invited'`, `requestStatus === 'Phase II Pending'`, `candidates > invited` | lead PD | peer-review |
| read-reports | `received > 0` and (`reviewSummary.absent` or `.stale === true`) | any staff | peer-review |
| record-offramp | `semiFinalist ∈ {yes, inferred-yes}`, no terminal outcome; detail `received`, `pastOfframpDate` (null without a date) | lead PD | deliberations; secondary |
| confirm-roster | `presentation.ended === true` and (`roster.absent` or `.stale`) | any staff | deliberations |
| write-visit-assessment | `presentation.ended === true`, `visitAssessment.absent` | any staff | deliberations |
| write-board-draft | `visitAssessment.present`, `boardDraft.exists === false` | lead PD | final-assessment |
| start-group-review | `boardDraft.exists === true`, `transition.phase === null`, and (`presentation.ended === true` or `presentation.legacyException === true`), no applicable blocker | lead PD / superuser | final-assessment |

`primaryTask`: first task in table order whose phase equals the derived phase that is not secondary; else the first non-secondary task overall; else a secondary task (in-phase first), so the two secondary keys lead only when nothing else qualifies anywhere; else null. `tasksBasis` mirrors `basis`.

### C6. Blockers and capability

| Key | Condition | Blocks |
|---|---|---|
| chairs-outcome-pending | `semiFinalist === 'yes'` and `chairsOutcome === 'pending'`; or `chairsOutcome === 'invited'` and `requestStatus !== 'Phase II Pending'` | send-invitations |
| integrity-unreviewed | `integrity.latest.flagged && !reviewed` | send-invitations, schedule-presentation (D6 as recorded) |
| continue-decision-missing | always until D7 | schedule-presentation, presentation-materials, presentation-invitation-email, presentation-transcription |
| presentation-not-ended | `presentation.ended === false` (confirmed future or in-progress presentation, `transition-schedule.js:41-44`) | start-group-review |
| presentation-end-unverified | `presentation.ended === null` and `presentation.legacyException !== true` | start-group-review |
| presentation-schedule-unavailable | `presentation.unavailable` | confirm-roster, start-group-review |
| evidence-stale | `reviewSummary.stale` | read-reports re-raised |
| roster-stale | `roster.stale` | confirm-roster re-raised |

`capabilities.readOnly` is returned separately as `readOnly: true`; surfaces disable every mutation on it. It is not a blocker, so the invariant holds: `record-rationale`, `record-first-cut`, `record-semi-finalist`, `identify-reviewers`, `record-offramp` never appear in any `blocks` set (asserted by test over the table). "No applicable blocker" for `start-group-review` means no blocker whose `blocks` contains that key.

### C7. Orchestration and read budget

- **Request page**: `resolveWorkbenchRequest` (`resolve-request-service.js:65`) returns tier 1 (request fields and memo presence from the widened SELECT, calendar from the read already at `:90`, `integrity` from the new Postgres read, `reviewers.anySuggestion` from the new Dataverse read) plus `j27 = deriveJ27Stage(tier1)` with `reviewers.counts` and every tier 2 key `not-loaded`. Incremental read budget on resolution: **one Dataverse read and one Postgres read** (a single id never chunks or partitions). Both loaded facts affect derivation immediately (peer-review via `anySuggestion`, the integrity task and blocker) and survive the later merge of reviewer counts from the Overview rollup. The page then recomputes with the same pure function as each existing read lands: the Overview's rationale, summary, assessment, and roster handoffs on mount (`J27Overview.js:86`) and its reviewer rollup (`OverviewTab.js:68-82`), and the Final Writeup state only when that tab mounts (`FinalWriteupTab.js:60`, `pages/workbench/[requestId].js:351,445`). Classification therefore stays `partial` until those reads occur and may never reach `full` for a viewer who does not open the Final Writeup tab; the page does not add reads to force it. Presentation timing comes from the Final Writeup state's schedule check, which runs only when `canStart` is true (`transition-state.js:78`); `not_checked` maps to `presentation.ended = null` (unknown), never to ended or absent. Tests: initial Overview load, a viewer without start authority, tab changes, request change during a pending load (stale-generation guard on every post-await write), the exact read count per endpoint, and that resolution's integrity and `anySuggestion` facts shape derivation before counts arrive and after.
- **Dashboard proposal list**: per page of rows, in addition to today's rollup: one integrity read (as built: one Postgres query per database partition, ordinary requests on the application database and designated simulation requests on the isolated store), one calendar row read, one adapter invocation for `anySuggestion` (as built: one Dataverse query per 25 request ids, each paginated by `queryAllRecords`; a capped or paged batch is refused and the fact reads `unavailable`). No per-row reads. Rows carry `j27: { phase, basis, primaryTask, taskKeys, blockerKeys, recorded, outcome }`. A failed batch read marks its key `unavailable` on every row of the page; the list still renders.
- Isolation and permissions untouched: the read model consumes rows after the existing isolation filters and never decides access.

### C8. Tests (`tests/unit/j27-read-model.test.js`)

Table rows, each asserting phase, basis, recorded, outcome, ordered task keys, primary, blocker keys with `blocks` sets:

1. Factory scenario end states (Factory plan revision 2 §6; committed at `c20db9bb4` on `codex/j27-factory-scenarios`): S1 intake Phase I clone value, ready, memo empty; S2 same + rationale; S3 Not Scored + rationale; S4 Scored; S5 Recommended Do Not Invite; S6 Recommended Invite; S7 Invited + Phase II PCR + request status Phase II Pending + two selected uninvited suggestions (intended; the sandbox row 1000386 stopped at Invited + PCR + request status `Proposal Invited`, unready, no slate, because the platform derives `Phase II Pending` from a proposal-received date, so both rows are tested); S8 unready: excluded by discovery (F3 test) but still a J27 row for direct-request derivation, which returns `initial-assessment` with its tasks.
2. Fixtures as read 2026-11-08: #1000372 Phase I Pending, triage Advancing, ready, nothing saved; #1000370 request status null, Advancing, ready, two received reports, interpretation saved, First Cut unset; #1000369 request status Phase I Pending (readback 2026-11-08; an earlier draft said null), Advancing, ready, Scored, one report, interpretation, visit assessment, roster, board draft, presentation timing unverifiable; #1000376 Recommended Invite, triage null, readiness false, flagged unreviewed screen, no reviewers.
3. Combinations: presentation scheduled with reports still arriving; Site Visit read fails on a row with a draft; decided award with roster never confirmed; First Cut Not Scored; Invited and Not Invited reached without Recommended Invite; unmapped Phase I; Invited without Phase II Pending (Chairs blocker); unselected-only suggestions (`candidates 0, anySuggestion true` → peer-review); obsolete roster memo on the dashboard then corrected on the page; each terminal class.
4. Each tier 1 key `unavailable` one at a time (basis `degraded`); each tier 2 key `not-loaded` (basis `partial`); board draft `unavailable` must not produce `write-board-draft` or `start-group-review`.
5. Out-of-scope: D26 decided row and D26 intake row both return `unclassified` with no tasks; lowercase or padded cycle code is out of scope.
6. Invariants: the five recording keys never blocked; `start-group-review` present with `continue-decision-missing` active (not applicable to it); date boundaries for `pastOfframpDate`; null calendar.

## 3. Step F: discovery

### F1. Design: OData superset, exact row predicate, projection contract

`shared/config/workbenchVisibility.js` gains five exports; the two existing functions are untouched.

```
DISCOVERY_FIELDS = ['akoya_requeststatus', 'wmkf_triagestatus', '_wmkf_grantprogram_value', 'wmkf_readyforreview']  // plus the linked-cycle expansion
withDiscoverySelect(select)      // adds the four fields, like withRequestReadinessSelect
buildDiscoveryFilter(includeSetAside, scope)   // returns `((<legacy>) or (<programs> and wmkf_readyforreview eq true))`
assertDiscoveryQuery({ select, expand })   // throws unless select names every DISCOVERY_FIELDS entry and expand carries the linked-cycle expansion; callers pass both as they build them (dashboard-service.js:312)
isDiscoverableRequestRow(row, includeSetAside, scope)   // exact; omitted nullable fields read as null, as isVisibleRequestRow does today
```

`scope = { readinessOnlyProgramIds: string[] }` (lower-cased GUIDs, resolved by the caller). Empty list: `buildDiscoveryFilter` returns `(<legacy>)` and the exact predicate is `isVisibleRequestRow && isRequestReadyForStaff`, byte-for-byte today's composition.

Exact predicate:

```
// no row-level own-property assertion: a selected null-valued field can be absent from the row (existing regression, tests/unit/workbench-visibility-row-predicate.test.js:37), so a sparse row is legitimate
code = row.wmkf_GrantCycle?.wmkf_cyclecode; strict = typeof code === 'string' && /^[JD]\d{2}$/.test(code)
researchJ27 = strict && parseCycleCode(code).year >= 2027 && scope.readinessOnlyProgramIds.includes(lower(row._wmkf_grantprogram_value || ''))
researchJ27 ? row.wmkf_readyforreview === true
            : isVisibleRequestRow(row, includeSetAside) && isRequestReadyForStaff(row)
```

Strict grammar is the same raw test `requestReadiness.js:15` applies, so `"j27"` and `" J27 "` take the legacy branch and are rejected there exactly as today. Null program → legacy branch. The projection class is closed at the query, not the row: every opted-in caller builds its SELECT through `withDiscoverySelect`, and each caller's test calls `assertDiscoveryQuery` on the real `select` and `expand` it sends. A sparse row (selected triage omitted because null) evaluates exactly as `isVisibleRequestRow` evaluates it today; a genuinely incomplete query (missing field or missing expansion) fails the caller test. Tests: valid select plus valid expand passes; missing expansion fails; sparse nullable triage, status, program, readiness each omitted from a row do not throw.

Grouping: the returned filter is wrapped in its own parentheses, so `filters.join(' and ')` (`dashboard-service.js:314`; `odata.and`, `odata.js:67`) composes correctly. A test composes the full dashboard, assignment, and panel queries and asserts that an out-of-PD, out-of-cycle, or out-of-selected-program ready Research row does not escape the OR.

Paging: every opted-in caller keeps its existing incomplete-result behavior: 503 refusal in the dashboard and panel (`dashboard-service.js:317`, `review-panel-service.js:68`), and in assignment discovery the existing conservative fallback that disables assignment-based defaulting on a capped scan (`program-scope-service.js:85-105`). The exact filter runs only on a complete result. The superset increases volume by the unready legacy rows and the ready Research rows outside legacy; the existing ceiling (`grant-request.js:282`) stays enforced and a larger superset may therefore refuse where today's query did not. A test feeds a capped superset and asserts each caller's documented incomplete path, never a partial list.

Probe: `scripts/probe-j27-readiness-visibility.cjs` gains a `--target=sandbox` branch (today production-only, `:17-20`), the program field in its SELECT, and two complete reads: cohort A, all J27-linked rows without discovery filtering; cohort B, `buildDiscoveryFilter` applied. Expected membership is computed by the exact predicate over A; the probe asserts `exact(A) ⊆ B` and `exact(B) == exact(A)`. Output recorded in the PR as evidence.

### F2. Caller matrix (verified against `97f696faf`)

Opt in (use `withDiscoverySelect`, `buildDiscoveryFilter`, `isDiscoverableRequestRow`; Research grant program id resolved by name through the program catalog in `program-scope-service.js`, `WORKBENCH_DEFAULT_PROGRAM_NAME`, never from the selected program and never a literal):

| Caller | Today | Change |
|---|---|---|
| `workbench/dashboard-service.js` proposals `:306-320` | legacy + readiness post-filter | opt in; selected program filter unchanged; readiness-only scope from the catalog |
| `workbench/dashboard-service.js` cycle list `:162-172` | legacy(true) + readiness | opt in with `includeSetAside = true` preserved on the legacy branch |
| `meeting-tracker/dashboard-service.js:30` and `post-presentation-materials/discussion-sentiment-candidates.js:41` | share the dashboard selection | follow it; a test each |
| `workbench/program-scope-service.js:46-68` assignment discovery | legacy; SELECT has only program + readiness | opt in; SELECT gains `akoya_requeststatus, wmkf_triagestatus` via `withDiscoverySelect` |
| `pre-site-visit/cycle-list-service.js:71` | legacy + readiness; SELECT lacks triage | opt in; SELECT via `withDiscoverySelect` |
| `review-panel-rollout.js:29` and `review-panel-service.js:61-72` (Virtual Review Panel roster; proposal narrative input, not a D7 presentation operation) | legacy via rollout helper, readiness post-filter; SELECT lacks triage and program | opt in: helper builds the discovery filter, the service's post-filter becomes the exact predicate, SELECT via `withDiscoverySelect`; access and input guards (`review-panel-input.js:45`, `review-panel-service.js:376`) untouched |
| `meeting-tracker/program-briefing-service.js:33,90-95` | SE/MR `_akoya_programid_value` membership + legacy | keep the SE/MR membership filter; add `_wmkf_grantprogram_value` and triage via `withDiscoverySelect`; opt in with the Research grant program id; both program fields tested |
| `reviewer-finder/my-proposals-service.js:142-175, 256-259` | `akoya_requeststatus eq 'Phase II Pending'` gate, then `readyRecords` / `isRequestReadyForStaff` post-filter; SELECT lacks triage | **own predicate, not the generic one.** Filter = `<pd> and <cycle> and ((<research-ready: program in scope and wmkf_readyforreview eq true>) or (<existing status gate, unchanged>))`. Post-filter, complete: `researchJ27 ? row.wmkf_readyforreview === true : (existingStatusGate(row) && isRequestReadyForStaff(row))`, so an unready non-Research Phase II Pending row stays hidden as today and the generic Advancing / Set aside predicate is never used here. The `actionable` mode's exclusion of rows with a post-review `wmkf_phaseiistatus` is a **view filter** applied after admission on both branches; the `all` mode shows every admitted row. Reviewer identification itself is not gated by either mode (D2); this service only decides what the list shows. Tests: unready non-Research Phase II Pending hidden; D26 identical to today; ready Research with a post-review disposition hidden in actionable and shown in all; J27 Research intake row shown in both modes. |

Unchanged, with a one-line comment naming the reason:

| Caller | Reason |
|---|---|
| `final-writeup/dashboard-service.js:165-170, 236-240` | its rule is current-Final membership plus readiness with the no-linked-cycle archival exception and the focused direct-request bypass; not Workbench visibility (round-2 finding accepted) |
| `cycle-dossier-rollout.js:16-25` | fixed D26 |
| `site-visit/logistics-service.js:170`, `site-visit-materials/collection-service.js:568, 891`, `meeting-coordination/invitation-service.js:37`, `meeting-tracker-transcription/binding.js:46` | D7 presentation gates |
| scripts `generate-pre-site-drafts-cycle.mjs:92`, `probe-pre-site-generation-preflight.mjs:62`, `review-staff-deliberations-preparation-cohort.mjs:58`, `probe-meeting-transcription-e2e-readiness.js:495` | legacy; the readiness probe is the exception (F1) |

### F3. Tests

- `tests/unit/workbench-visibility-row-predicate.test.js`: truth table for `isDiscoverableRequestRow` × `includeSetAside` × scope present/empty: J27 Research ready not Advancing (visible); J27 Research ready Set aside (visible); J27 Research unready Advancing (hidden); J27 Research unready Phase II Pending (hidden); J27 SoCal ready not Advancing (hidden); J27 SoCal Phase II Pending ready (visible); D26 Research ready Set aside (hidden, legacy); D26 Phase II Pending (visible); null program; lowercase and padded cycle codes; missing expansion; incomplete query (field or expansion) → `assertDiscoveryQuery` throws, sparse rows do not; empty scope → equals today's composition for every row.
- Superset property: for every admitted truth-table row, the matching disjunct's operands hold (structural); the 648-combination exhaustive check Codex ran in round 2 is added as a test over the two JS predicates.
- Composition: full dashboard, assignment, panel, briefing, and Reviewer Finder filter strings with out-of-scope ready Research rows.
- Caller tests: each opted-in caller with its real SELECT (the round-2 D26 Set aside false positive and J27 intake false negative reproduced as regression rows); paging cap → each caller's documented incomplete path (503, or assignment discovery's conservative fallback); Final Writeups Approved current-Final row and direct-ID bypass unchanged; Reviewer Finder both modes; the four presentation services refuse a J27 Research intake row.

## 4. Named dependencies outside this plan

- Step G: invitation send guard gains `chairs-outcome-pending` and `integrity-unreviewed`; D5 editability widening in `j27FirstCut.js` and `first-cut-service.js:49` plus the Record button; D6 scheduling refusal in `site-visit/logistics-service.js` reading `readLatestIntegrityStates`.
- Step I (after D7): the offramp field and memo, the "continue" value, and server enforcement in the four presentation services.

## 5. Sequence and gates

Commits: C1 module + C8 tests; C7 wiring (resolve, dashboard, page composition); F1 predicate + F3 predicate and composition tests; F2 callers + caller tests; scripts and comments. Gates per touched surface, each followed by its self-test, sequentially: `check:status-enum-parity`, `check:dataverse-access-layer`, `check:dynamics-context-boundary`, `check:route-service-boundary`, `check:request-meeting-date-reads`, `check:atlas`, `check:doc-symbol-refs`, `check:types`; unit suites `workbench-*`, `j27-*`, `request-readiness`, `reviewer-rollup*`, `reviewer-suggestion-rollup`, `reviewer-finder*`, `review-panel*`, `meeting-tracker-dashboard-service`, `final-writeups-dashboard-service`, `pre-site-*`. Push `claude/j27-read-model`; no merge.

## 6. Round 5 scope

Revision 5 applies the four round-4 named changes: query validation takes select and expand; integrity winner is the global latest with target applied afterward and an `unavailable` collision; resolution's budget is one Dataverse read and one Postgres read with both facts entering the model; both legacy schedule exceptions exempt the unverified blocker. Round 5 question: are the four resolved, and is anything newly introduced wrong?

### Round 4 scope (historical)

Revision 4 applies the five round-3 named changes (projection contract at the query; integrity provenance, flag predicate, ordering, and target posture; orchestration and read budget restated; group review blocked before a presentation ends; Reviewer Finder's complete fallback with readiness) and the non-blocking polish (export count, assignment-discovery cap fallback, cap wording, scenario 8 scope, basis precedence). Round 4 question: do any of the five remain unresolved, and is anything newly introduced wrong?
