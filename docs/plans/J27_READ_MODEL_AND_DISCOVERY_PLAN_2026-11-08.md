# J27 read model and discovery predicate: build plan (steps C and F), revision 5

**Terminology (owner, 2026-11-09; alignment log D52).** The terms "First Cut" and "Semi-finalist" are retired. The steps are "Scoring" and "Recommendation to Chairs"; staff-facing labels are the Dataverse choice names, with "Recommended to Chairs" and "Not Recommended" on the stage strip. Identifiers, task keys, the route and the settings in this plan were renamed to match in the same change (`record-scoring`, `record-chairs-recommendation`, `recorded.scoring`, `recorded.chairsRecommendation`, outcome `not-recommended`, `/api/workbench/scoring`, `J27_CHAIRS_RECOMMENDATION_ENABLED`). Narrative and review history below still uses the old words where it describes what was said or done at the time.

Author: Claude Fable 5.1 for Justin Gallivan, 2026-11-08. Status: **steps C and D BUILT** on `claude/j27-read-model` at `0fd5dbe45` (owner authorization 2026-11-09 UTC; Codex build review READY WITH NAMED CHANGES, resolved in `6f3bd34b7`, record in `J27_READ_MODEL_BUILD_REVIEW_2026-11-09.md`); page-side recomputation deferred to step E; **step F BUILT** 2026-11-09 (owner authorization; commits `f75704137`, `62855a91b`; Codex review READY WITH NAMED CHANGES, both resolved at `406727a74`, record in `J27_DISCOVERY_BUILD_REVIEW_2026-11-09.md`); **step E BUILT** at `9469c47b5`, reworked through `9d7f6aee1` after two Codex rounds, final check READY (§8). Baseline: `codex/j27-workbench-reports` at `97f696faf`.

Revision 3 resolves the six round-2 named changes: F1 projection contract, strict cycle grammar, outer grouping, paging, independent probe; Final Writeups unchanged and Reviewer Finder given its own predicate; Review Panel projection and post-filter; rollup population preserved; C7 orchestration restated as tier 1 on the server and tier 2 composed on the request page (budget stated in C7); integrity state defined over screenings, not jobs; phase, task, and blocker contradictions removed; citations corrected; fixtures and scenario end states inlined.

## 0. Owner decisions (recorded; none assumed)

- **D1** discovery: J27+ Research rows admitted by `wmkf_readyforreview = true` alone (Set aside does not exclude them). Pre-2027 cycles and every non-Research program keep today's composition unchanged: legacy clause (Phase II Pending or Advancing, not Set aside) and the existing readiness post-filter where a caller applies it.
- **D2** gates: reviewer identification ungated; invitations need Phase I Invited and request status Phase II Pending; presentation operations keep the legacy predicate until D7.
- **D3**: Semi-finalist No and First Cut Not Scored are terminal; Semi-finalist Yes is "Recommended to Chairs, awaiting outcome".
- **D4** (closed 2026-11-08): no coverage threshold; `record-offramp` available from Recommended Invite onward, never blocked; received count and dates are information.
- **D5**: lead PD or superuser may change First Cut or Semi-finalist at any time. Not existing behavior (`scoring-service.js:49`; `j27Scoring.js:3,14`). Step G item.
- **D6**: a flagged screen without PD review blocks reviewer invitations and presentation scheduling. This plan blocks exactly `send-invitations` and `schedule-presentation`; widening to materials, invitation email, or transcription would be a new owner decision and is not assumed.
- **D7** closed 2026-11-09 (Connor, Sarah; confirmed in production metadata): the offramp is recorded as `wmkf_phaseiistatus = 682090001` "Phase II Offramped". Until step I is built, `continue-decision-missing` still blocks the four presentation operations; step I replaces it (§9).
- **D8** (2026-11-09): the J27 read model and its surfaces are Research-only by design. The program gate (`deriveJ27ForRow` requires the F1 readiness-only scope) stays. Owner: "The more we do on the app for the research program, the harder it will be to make it directly compatible with SoCal. I'm actually fine with that as their business practices differ." A Southern California suite, if ever wanted, would be built as its own app, sharing code and lessons, not by widening this model.

## 1. Branch and worktree

`git worktree add -b claude/j27-read-model /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model 97f696faf`, then the per-machine repairs the bootstrap script performs (`.agents/skills` symlink, `.env.local` symlink, `npm install`; `scripts/bootstrap-machine.sh:94-103` itself targets `codex/<slug>` from `origin/main`, so it is not invoked). Review worktree and main checkout untouched. Surface disjoint from the Factory branch.

## 2. Step C: read model

### C1. Module, scope guard, input contract

`lib/services/workbench/j27-read-model.js`, pure, importable by server and client. `deriveJ27Stage(input)`.

Scope guard first: if `input.request.cycleCode` fails the strict grammar (`^[JD]\d{2}$` on the raw value, as `requestReadiness.js:15`) or its year is below 2027, return `{ phase: 'unclassified', recorded, outcome, tasks: [], blockers: [], basis: 'out-of-scope' }`. Everything below applies to J27+ rows.

Each input key is `{ status, ...detail }`, `status ∈ present | absent | unavailable | stale | not-loaded`. `not-loaded`: the caller did not attempt it. `unavailable`: attempted and failed. Neither is `absent`. As built since 2026-11-10 (section 11): a memo key whose schema wave is not ready reads `not-provisioned`, a sixth status that never satisfies a condition and never changes `basis`; the original contract folded it into `unavailable`.

Tier 1 (server, both callers):

| Key | Fields | Source and projection change |
|---|---|---|
| `request` | `requestStatus, statusClass, phaseIStatus, phaseIStatusLabel, phaseIIStatus, readyForReview, cycleCode, grantProgramId, triageStatus, isTestRequest` | `resolve-request-service.js:26` SELECT + `wmkf_phaseiistatus, wmkf_readyforreview, wmkf_triagestatus`; `dashboard-service.js:64` `PROPOSAL_SELECT` + `wmkf_phaseistatus` (formatted value gives the label). `statusClass` via `classifyStatus` (`dataverse-export/constants.js:133`, exported `:388`). |
| `rationale`, `reviewSummary`, `visitAssessment`, `rosterMemo` | presence only | memo columns `wmkf_initialassessmentrationale`, `wmkf_staffreviewsummary`, `wmkf_staffvisitassessment`, `wmkf_confirmedmeetingroster` added to both SELECTs only when the matching schema-ready helper says the wave is provisioned (`lib/utils/initial-assessment-rationale-readiness.js`, `lib/utils/j27-integrity-readiness.js` pattern, and the roster/visit helpers of waves 37 to 39); otherwise `not-provisioned` (originally `unavailable`; changed 2026-11-10, section 11). `rosterMemo.present` means the JSON is non-empty; it says nothing about the current visit (see C3). |
| `reviewers` | `{ candidates, invited, accepted, received, completed, anySuggestion }` | Dashboard: `fetchReviewerRollup` (`reviewer-rollup.js:67`), already loaded per page. Request page: counts are tier 2, from the per-request rollup the Overview tab already fetches (`OverviewTab.js:68-82`, `useReviewerProgress`); resolution does not fetch the rollup and will not start to. `anySuggestion` is tier 1 on both callers (its own query, below) and is carried as a separate field so the later arrival of counts merges into `reviewers.counts` without overwriting it. `anySuggestion` comes from a **second, separate** adapter query `existsAnySuggestionForRequests(ids)` (`reviewer-suggestion.js`, beside `findForRollup :444`) with filter `(<or-chain>) and <notExcludedFilter()>` and `$select=_wmkf_request_value`; `findForRollup` and every existing count and progress bucket (`reviewer-rollup.js:79-112`) are untouched, pinned by a test that unselected non-declined rows change `anySuggestion` only. |
| `integrity` | `{ latest: null \| { flagged, reviewed, provenance: 'automated' \| 'manual-unverified-target' } }` | New Postgres reader `readLatestIntegrityStates(targetHost, requestIds[])` in `j27-integrity-jobs.js`. Candidate rows: `integrity_screenings` for each `request_id`, LEFT JOIN `j27_integrity_jobs` on `screening_id`. A row with a job is `automated` and is eligible only when `job.target_host = targetHost`; a row without a job is `manual-unverified-target` (both writers store `screening_type = 'workbench'`, `j27-integrity-jobs.js:139`, `integrity-service.js:533`, so provenance comes from the job association, never the type). Winner per request: the globally latest screening for the request, `ORDER BY created_at DESC, id DESC`, exactly as `getLatestRequestIntegrityRun` (`integrity-service.js:151-157`) and the disposition endpoint's `getCurrentRequestScreeningRow` (`:554`, rejected as `screening_not_latest` at `:592` when a review targets an older screening) select it. Target filtering is applied **after** selection, not before: if the winner is an automated screening whose job `target_host` differs from the current target, the key is `unavailable` with detail `other-target-latest` and no review task is raised, because a review of any older local screening would be refused by the endpoint. `flagged` uses the writer's own predicate, any result with `hasConcerns === true` or `matchCount > 0` (`j27-integrity-jobs.js:126`), evaluated over `results`, not `match_count` alone. `reviewed = EXISTS integrity_screening_reviews for the winner`. Accepted limitation, owner-visible: `integrity_screenings` has no target column (`setup-database.js:137`) and Preview can share Postgres with Production, so manual evidence cannot be bound to a target; it is accepted for the same request GUID and labeled `manual-unverified-target`, matching the existing GUID-only latest read at `integrity-service.js:151` (the `scoring-service.js:52` fence is about Factory rehearsal provenance and is not the precedent). D6 blocking applies to both provenances. A failed query marks the key `unavailable`; a null `j27IntegrityTarget()` does not. Tests: concerns with zero matches; equal timestamps; latest manual superseding automated; reviewed winner; older local flagged screening plus newer other-target screening → `unavailable`, no task; manual evidence without provenance (included, labeled). |
| `calendar` | `{ offrampMeetingDate, reviewsDueDate, today }` | Columns `wmkf_researchofframpmeetingdate`, `wmkf_researchreviewsduedate` (`shared/config/cycleCalendar.js:18-19`). Request page: the calendar read already at `resolve-request-service.js:90` keeps these two. Dashboard proposal-list mode (`listProposals`, `dashboard-service.js:234`) adds one read of the selected cycle's calendar row through the same throwing adapter the request page uses; a throw marks `calendar.unavailable` for the page of rows. Cycle-list mode keeps `listBoardDatesOrNone` (`operations-grant-cycle.js:294`) and does not compute the read model. `today` injected. |
| `capabilities` | `{ readOnly }` | `resolvePreviewReadOnly` (`preview-read-only.js:11`), as `pages/workbench/[requestId].js:495` computes it. Not a blocker; see C6. |
| `features` | `{ chairsRecommendationEnabled }` | existing helper for `CHAIRS_RECOMMENDATION_ENABLED` (named `J27_CHAIRS_RECOMMENDATION_ENABLED` until 2026-11-10) |

Tier 2 (request page only; the dashboard passes `not-loaded`):

| Key | Fields | Source |
|---|---|---|
| `presentation` | `{ exists, id, ended: true \| false \| null, legacyException: boolean }` | `transition-state.js` schedule check (`assertScheduledEnd`, `transition-schedule.js:38-44`): `ended: true` when the single eligible presentation's end is in the past; `false` when `presentationSchedule` is `upcoming`; `null` when `unverified`, `missing`, or `not_checked`. `legacyException: true` carries either explicit compatibility reason the server emits, `legacy_complete_review_without_schedule` or `legacy_review_schedule_unverified` (`transition-schedule.js:28-38`), never inferred from a Boolean. Tests: future presentation blocked; exact end boundary; unknown timing blocked; missing presentation blocked; each of the two legacy exceptions allows the task. |
| `roster` | `{ present, stale }` for the current presentation | `meeting-roster-service.js:120-134` result: `roster` non-null and `stale`. Supersedes `rosterMemo` when loaded. |
| `reviewSummary.stale` | boolean | `staff-review-summary-service.js:33` handoff (evidence hash) |
| `boardDraft`, `transition` | `{ exists }`, `{ phase \| null }` | `final-writeup/transition-state.js:16` rows, projected to objective state by a small pure mapper added beside it; actor capabilities (`:48`) not consumed. |

### C2. Recorded decisions and Chairs outcome

From `wmkf_phaseistatus` only. Values: `SCORING_STATUS`, `CHAIRS_RECOMMENDATION_STATUS` (`j27Scoring.js:1,8`), Invited 100000003, Not Invited 100000002 (`docs/atlas/dataverse-akoya-request.md:202`).

| Phase I | `scoring` | `chairsRecommendation` | `chairsOutcome` | Label |
|---|---|---|---|---|
| unset / Pending Committee Review | unset | unset | pending | none |
| Scored | scored | unset | pending | Scored |
| Not Scored | not-scored | unset | pending | Not Scored (terminal) |
| Recommended Do Not Invite | inferred-scored | no | pending | Not Recommended (terminal) |
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

A row's `basis` is `full` when every input a higher row consults, plus on a non-terminal row every task input (C5), is `present`, `absent`, or `stale`; `partial` when any is `not-loaded`; `degraded` when any is `unavailable`, and `degraded` wins when both apply. A `not-provisioned` key counts toward neither (section 11). Task inputs join the basis so the landing-list cue also covers tasks that may appear once a missing read lands (C8.4 expects every tier 1 key `unavailable` to degrade); a terminal row has no forward tasks, so only the phase rows above it count. As built, `rosterMemo` and `roster` carry presence in their key `status` (`present` / `absent`), and `roster` adds `stale`. `stale` never changes `basis`; it only raises its blocker. Conditions only match on confirmed values; `not-loaded` and `unavailable` never match. There is no `unclassified` for J27+ rows. The dashboard (tier 1 only) can place a row lower than the page does, and `rosterMemo` can place a row at `deliberations` for an obsolete presentation; the page's tier 2 corrects in either direction. The landing list labels `partial` and `degraded` rows with a small "may change when opened" cue.

### C4. Outcome

`outcome ∈ none | not-scored | not-recommended | not-invited | offramped | decided-award | decided-no-award | withdrawn`. Terminal outcome → no forward tasks. `offramped` (`wmkf_phaseiistatus = 682090001`) was added by step I (§9); before D7 closed, this row read "No offramp outcome" and that text is historical.

### C5. Tasks (display order)

| Key | Present when (all operands confirmed, never `not-loaded`/`unavailable`) | Owner | Phase |
|---|---|---|---|
| record-rationale | `rationale.absent`, no terminal outcome | existing edit rule | initial-assessment |
| record-scoring | `scoring === 'unset'` | lead PD / superuser | initial-assessment |
| record-chairs-recommendation | `scoring === 'scored'`, `chairsRecommendation === 'unset'`, `chairsRecommendationEnabled` | lead PD / superuser | initial-assessment |
| review-integrity | `integrity.latest.flagged && !reviewed` | lead PD | initial-assessment |
| identify-reviewers | no terminal outcome, `completed < 3` | lead PD | peer-review; secondary, quiet link on the landing list |
| send-invitations | `chairsOutcome === 'invited'`, `requestStatus === 'Phase II Pending'`, `candidates > invited` | lead PD | peer-review |
| read-reports | `received > 0` and (`reviewSummary.absent` or `.stale === true`) | any staff | peer-review |
| record-offramp | `chairsRecommendation ∈ {yes, inferred-yes}`, no terminal outcome; detail `received`, `pastOfframpDate` (null without a date) | lead PD | deliberations; secondary |
| confirm-roster | `presentation.ended === true` and (`roster.absent` or `.stale`) | any staff | deliberations |
| write-visit-assessment | `presentation.ended === true`, `visitAssessment.absent` | any staff | deliberations |
| write-board-draft | `visitAssessment.present`, `boardDraft.exists === false` | lead PD | final-assessment |
| start-group-review | `boardDraft.exists === true`, `transition.phase === null`, and (`presentation.ended === true` or `presentation.legacyException === true`), no applicable blocker | lead PD / superuser | final-assessment |

`primaryTask`: first task in table order whose phase equals the derived phase that is not secondary; else the first non-secondary task overall; else a secondary task (in-phase first), so the two secondary keys lead only when nothing else qualifies anywhere; else null. `tasksBasis` mirrors `basis`.

### C6. Blockers and capability

| Key | Condition | Blocks |
|---|---|---|
| chairs-outcome-pending | `chairsRecommendation === 'yes'` and `chairsOutcome === 'pending'` (Recommended to Chairs, outcome not yet recorded) | send-invitations |
| phase-two-status-pending | `chairsOutcome === 'invited'` and `requestStatus !== 'Phase II Pending'` (Chairs' outcome recorded; production derives `Phase II Pending` from `wmkf_phaseiistatus` Pending Committee Review or Recommended, read 2026-11-09, so Phase II status is not yet set) | send-invitations |
| integrity-unreviewed | `integrity.latest.flagged && !reviewed` | send-invitations, schedule-presentation (D6 as recorded) |
| offramped | `outcome === 'offramped'` (step I, §9; replaced the pre-D7 `continue-decision-missing` blocker, which fired unconditionally) | send-invitations, schedule-presentation, presentation-materials, presentation-invitation-email, presentation-transcription |
| presentation-not-ended | `presentation.ended === false` (confirmed future or in-progress presentation, `transition-schedule.js:41-44`) | start-group-review |
| presentation-end-unverified | `presentation.ended === null` and `presentation.legacyException !== true` | start-group-review |
| presentation-schedule-unavailable | `presentation.unavailable` | confirm-roster, start-group-review |
| evidence-stale | `reviewSummary.stale` | read-reports re-raised |
| roster-stale | `roster.stale` | confirm-roster re-raised |

`capabilities.readOnly` is returned separately as `readOnly: true`; surfaces disable every mutation on it. It is not a blocker, so the invariant holds: `record-rationale`, `record-scoring`, `record-chairs-recommendation`, `identify-reviewers`, `record-offramp` never appear in any `blocks` set (asserted by test over the table). "No applicable blocker" for `start-group-review` means no blocker whose `blocks` contains that key.

### C7. Orchestration and read budget

**Amended 2026-11-10** by the later-phase lists plan (`J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md` on `main`, step 1; built on `claude/j27-cycle-page`). The four keys this section calls tier 2 (`presentation`, `roster`, `boardDraft`, `transition`) are now worked out on the server by `lib/services/workbench/j27-later-facts.js` for both callers, so they are no longer "request page only" and a list row is no longer always `partial`. Added read budget: three batched Dataverse reads per list load (draft documents, Final documents, presentation records) for the 2027-or-later Research rows, and the same three for one request on resolution. The page's tabs still report; each report now carries whole keys by the same rule. The text below describes the budget before that change.

- **Request page**: `resolveWorkbenchRequest` (`resolve-request-service.js:65`) returns tier 1 (request fields and memo presence from the widened SELECT, calendar from the read already at `:90`, `integrity` from the new Postgres read, `reviewers.anySuggestion` from the new Dataverse read) plus `j27 = deriveJ27Stage(tier1)` with `reviewers.counts` and every tier 2 key `not-loaded`. Incremental read budget on resolution: **two Dataverse reads (any suggestion; the bounded program catalog for the F1 Research scope, added with the program gate 2026-11-09) and one Postgres read** (a single id never chunks or partitions). Both loaded facts affect derivation immediately (peer-review via `anySuggestion`, the integrity task and blocker) and survive the later merge of reviewer counts from the Overview rollup. The page then recomputes with the same pure function as each existing read lands: the Overview's rationale, summary, assessment, and roster handoffs on mount (`J27Overview.js:86`) and its reviewer rollup (`OverviewTab.js:68-82`), and the Final Writeup state only when that tab mounts (`FinalWriteupTab.js:60`, `pages/workbench/[requestId].js:351,445`). Classification therefore stays `partial` until those reads occur and may never reach `full` for a viewer who does not open the Final Writeup tab; the page does not add reads to force it. Presentation timing comes from the Final Writeup state's schedule check, which runs only when `canStart` is true (`transition-state.js:78`); `not_checked` maps to `presentation.ended = null` (unknown), never to ended or absent. Tests: initial Overview load, a viewer without start authority, tab changes, request change during a pending load (stale-generation guard on every post-await write), the exact read count per endpoint, and that resolution's integrity and `anySuggestion` facts shape derivation before counts arrive and after.
- **Dashboard proposal list**: per page of rows, in addition to today's rollup: one integrity read (as built: one Postgres query per database partition, ordinary requests on the application database and designated simulation requests on the isolated store), one calendar row read, one adapter invocation for `anySuggestion` (as built: one Dataverse query per 25 request ids, each paginated by `queryAllRecords`; a capped or paged batch is refused and the fact reads `unavailable`). No per-row reads. Rows carry `j27: { phase, basis, primaryTask, taskKeys, blockerKeys, recorded, outcome }`. A failed batch read marks its key `unavailable` on every row of the page; the list still renders.
- Isolation and permissions untouched: the read model consumes rows after the existing isolation filters and never decides access.

### C8. Tests (`tests/unit/j27-read-model.test.js`)

Table rows, each asserting phase, basis, recorded, outcome, ordered task keys, primary, blocker keys with `blocks` sets:

1. Factory scenario end states (Factory plan revision 2 §6; committed at `c20db9bb4` on `codex/j27-factory-scenarios`): S1 intake Phase I clone value, ready, memo empty; S2 same + rationale; S3 Not Scored + rationale; S4 Scored; S5 Recommended Do Not Invite; S6 Recommended Invite; S7 Invited + Phase II PCR + request status Phase II Pending + two selected uninvited suggestions (intended; the sandbox row 1000386 stopped at Invited + PCR + request status `Proposal Invited`, unready, no slate, because the platform derives `Phase II Pending` from a proposal-received date, so both rows are tested); S8 unready: excluded by discovery (F3 test) but still a J27 row for direct-request derivation, which returns `initial-assessment` with its tasks.
2. Fixtures as read 2026-11-08: #1000372 Phase I Pending, triage Advancing, ready, nothing saved; #1000370 request status null, Advancing, ready, two received reports, interpretation saved, First Cut unset; #1000369 request status Phase I Pending (readback 2026-11-08; an earlier draft said null), Advancing, ready, Scored, one report, interpretation, visit assessment, roster, board draft, presentation timing unverifiable; #1000376 Recommended Invite, triage null, readiness false, flagged unreviewed screen, no reviewers.
3. Combinations: presentation scheduled with reports still arriving; Site Visit read fails on a row with a draft; decided award with roster never confirmed; First Cut Not Scored; Invited and Not Invited reached without Recommended Invite; unmapped Phase I; Invited without Phase II Pending (Chairs blocker); unselected-only suggestions (`candidates 0, anySuggestion true` → peer-review); obsolete roster memo on the dashboard then corrected on the page; each terminal class.
4. Each tier 1 key `unavailable` one at a time (basis `degraded`); each tier 2 key `not-loaded` (basis `partial`); board draft `unavailable` must not produce `write-board-draft` or `start-group-review`.
5. Out-of-scope: D26 decided row and D26 intake row both return `unclassified` with no tasks; lowercase or padded cycle code is out of scope.
6. Invariants: the five recording keys never blocked; `start-group-review` is not blocked by `offramped` (an Offramped row has no tasks at all; historically this row checked `continue-decision-missing`, retired by step I); date boundaries for `pastOfframpDate`; null calendar.

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

- Step G: invitation send guard gains `chairs-outcome-pending`, `phase-two-status-pending`, and `integrity-unreviewed`; D5 editability widening in `j27Scoring.js` and `scoring-service.js:49` plus the Record button; D6 scheduling refusal in `site-visit/logistics-service.js` reading `readLatestIntegrityStates`.
- Step I (D7 closed 2026-11-09): read the Offramped status as a terminal outcome, retire `continue-decision-missing`, and refuse the four presentation operations for an Offramped row (§9). The written justification's home is still open.

## 5. Sequence and gates

Commits: C1 module + C8 tests; C7 wiring (resolve, dashboard, page composition); F1 predicate + F3 predicate and composition tests; F2 callers + caller tests; scripts and comments. Gates per touched surface, each followed by its self-test, sequentially: `check:status-enum-parity`, `check:dataverse-access-layer`, `check:dynamics-context-boundary`, `check:route-service-boundary`, `check:request-meeting-date-reads`, `check:atlas`, `check:doc-symbol-refs`, `check:types`; unit suites `workbench-*`, `j27-*`, `request-readiness`, `reviewer-rollup*`, `reviewer-suggestion-rollup`, `reviewer-finder*`, `review-panel*`, `meeting-tracker-dashboard-service`, `final-writeups-dashboard-service`, `pre-site-*`. Push `claude/j27-read-model`; no merge.

## 6. Round 5 scope

Revision 5 applies the four round-4 named changes: query validation takes select and expand; integrity winner is the global latest with target applied afterward and an `unavailable` collision; resolution's budget is one Dataverse read and one Postgres read with both facts entering the model; both legacy schedule exceptions exempt the unverified blocker. Round 5 question: are the four resolved, and is anything newly introduced wrong?

### Round 4 scope (historical)

Revision 4 applies the five round-3 named changes (projection contract at the query; integrity provenance, flag predicate, ordering, and target posture; orchestration and read budget restated; group review blocked before a presentation ends; Reviewer Finder's complete fallback with readiness) and the non-blocking polish (export count, assignment-discovery cap fallback, cap wording, scenario 8 scope, basis precedence). Round 4 question: do any of the five remain unresolved, and is anything newly introduced wrong?

## 7. Step F build record (2026-11-09)

Built on `claude/j27-read-model`: `f75704137` (F1 predicate, scope resolver, 33 predicate tests including the exhaustive superset check over 1944 combinations) and `62855a91b` (F2 callers, caller tests, unchanged-caller comments, probe). Deviations from the reviewed text, stated for the reviewer:

1. **Scope resolver shape.** `readinessOnlyProgramIds(programs)` is pure over an already-fetched catalog (raw rows or normalized entries); `resolveWorkbenchProgramScope` returns it as `discoveryScope`, so the dashboard, cycle list, pre-site list, review panel and assignment discovery pay no extra read. The briefing and the Reviewer Finder hold no catalog and take one bounded catalog read each (`resolveDiscoveryScope`). Zero or several programs named Research resolve to an empty scope and today's composition.
2. **Exact predicate on the row needs the legacy fields present.** Every opted-in caller now selects status and triage through `withDiscoverySelect`, and the row predicate re-evaluates the legacy clause rather than trusting the OData result. Test fixtures that previously carried only a cycle code gained `akoya_requeststatus: 'Phase II Pending'`; no production projection changed meaning.
3. **Reviewer Finder actionable rule moved from OData to code** (as the F2 row specifies). The emitted filter is `pd and cycle and ((research-ready) or (Phase II Pending))`; the Phase II disposition rule is applied after admission on both branches. Its route and service tests pin the new filter.
4. **Review panel helper signature** `buildReviewPanelRosterFilter(programId, discoveryScope)`; its only caller is the panel service.

Sandbox probe (`scripts/probe-j27-readiness-visibility.cjs --target=sandbox`, 2026-11-09T18:19:45.124Z, scope resolved by name from the sandbox catalog): J27 cohort A 16 rows (10 ready, 8 test); legacy eligible 3, discovery eligible 10; added by discovery 1000380, 1000381, 1000382, 1000383, 1000384, 1000385, 1000386; removed none. Superset: cohort B 10 rows, exact(A) ⊆ B True, exact(B) = exact(A) True, superset overhead 0; identical for includeSetAside. D26 has no rows in the sandbox. Output saved outside the repo.

Gates green in the worktree: status-enum-parity, dataverse-access-layer, dynamics-context-boundary, route-service-boundary, request-meeting-date-reads, odata-escape, trust-boundary-guid, atlas, doc-symbol-refs, types. Unit run: every suite passes except four red on the base commit and untouched here (`awardee-tab` date-dependent; `reviewer-engagement-census`, `reviewer-follow-up`, `workbench-read-coalescing-stage2-characterization` expect base-commit shapes that the semi-finalist branch later changed). `reviewer-suggestion-rollup` was fixed at `fec2c7228`.

Codex review outcome: READY WITH NAMED CHANGES; the two changes (cycle counts by discovery membership; Reviewer Finder projection plus caller-level `assertDiscoveryQuery` regressions) are resolved at `406727a74`. Record: `docs/plans/J27_DISCOVERY_BUILD_REVIEW_2026-11-09.md`.

## 8. Step E build record (2026-11-09)

Owner decision (2026-11-09): step E ships with a minimal visible surface, a read-only strip on the request page, so the recomputation is observable. Built at `9469c47b5`.

- `shared/utils/j27PageStage.js` (pure): maps the Overview's reviewer rollup to `reviewers.counts`; the Overview handoffs to `rationale`, `reviewSummary`, `visitAssessment`, `presentation` (existence and id from the meeting-roster read) and `roster` (presence and stale); the Final Writeup state to `boardDraft.exists` (source artifact present), `transition.phase` (`group-review` / `leadership-review`, else null) and `presentation.ended` (`ended` → true, `upcoming` → false, `missing` / `unverified` / `not_checked` → null) with `legacyException` from the two compatibility reasons. `composeJ27PageInput(serverInput, facts)` then `deriveJ27Stage`. No fetch.
- Callbacks: `OverviewTab` reports the rollup once it settles, `J27Overview` reports its handoffs, `FinalWriteupTab` reports its state or failure, each as `onJ27Facts(requestId, patch)`. The page keeps the facts keyed by request id and discards any patch for another request; the stage is recomputed with `useMemo` from the resolve DTO's `input`.
- `shared/components/workbench/J27StageStrip.js`: phase, primary task (since 2026-11-10 the cycle list's next-step line instead; section 12), basis note (`partial` / `degraded`), and the blockers that touch a task of the model. Presentation-only blockers were not shown until step I replaced `continue-decision-missing` with `offramped` (§9); the strip now shows the Offramped outcome badge instead. Label maps for phases, tasks and blockers are pinned to the model's vocabularies by test rather than the enum-parity gate, whose extractors do not read `Object.freeze` arrays.
- Deviation from the C7 text: the strip is new surface the reviewed plan did not include (owner-approved). Classification can stay `partial` for a viewer who never opens the Final Writeup tab, as C7 states; the strip says so.
- Tests: `tests/unit/j27-page-stage.test.js` (mapping, label parity, recomputation to `full` basis, strip rendering) and `tests/unit/workbench-request-page-j27-strip.test.js` (strip from the DTO, recomputation on report, no cross-request leakage, no strip and no callback for pre-2027 rows). Existing page and tab suites unchanged and green.
- Two corrections after the advisor pass, commit `65ae8d088`: (a) **program gate.** The C1 scope guard classified by cycle year only, so once the strip made the stage visible, J27 Southern California rows would have shown Research tasks. `deriveJ27ForRow` now also requires `isReadinessOnlyRow(row, scope)` (the F1 Research scope by catalog name); the resolve service reads the scope once per request and a failed catalog read yields no stage; the dashboard passes `programScope.discoveryScope`. A J27 SoCal row carries no `j27` key anywhere. (b) **No Board draft yet** (`final_writeup_source_missing`) maps to `boardDraft: present, exists: false` and `transition: present, phase: null`, so `write-board-draft` can surface; other failures stay `unavailable`. *(Amended 2026-11-10: `final_writeup_source_ineligible`, a draft not yet shared for review, also maps to "no Board draft", matching the server rule in `lib/services/workbench/j27-later-facts.js`; see the C7 amendment.)*
- Codex review of step E (record: `docs/plans/J27_STEP_E_REVIEW_2026-11-09.md`): NEEDS REWORK, five P2s. Resolved in the rework commit: (1) facts are owned by the current route (a callback for any other request is dropped, and facts reset on navigation; tests cover late A after B is populated and A→B→A); (2) the Final Writeup tab publishes every status write through one effect, so polling, start and advance reach the page; (3) the schedule check alone yields a present presentation with unknown timing and keeps both legacy compatibility reasons, so an explicit legacy exception permits `start-group-review` without an Overview meeting read; (4) summary freshness comes from the read-only summary panel on the Deliberations surface once both evidence hashes are known (no new read; unknown is never "current"); (5) C7's budget now reads two Dataverse reads plus one Postgres read on resolution, with a read-count regression. Strip blockers are shown from the phase of the task they block onward. Re-review: NEEDS REWORK on one point, summary freshness was retained when a later read could not establish it; fixed in the following commit (the panel now reports `summaryStale: null` on an unknown or failed read, and the page replaces the earlier value; same-page regressions for true → unknown and false → unknown). Finding 1's residual limitation (facts are keyed by request id, not route generation; a same-request re-navigation reuses nothing because facts reset on every route change) is accepted as documented. Final Codex check after `9d7f6aee1`: READY (approval), all six findings closed; one noted test weakness, the page's false → unknown assertion checks label absence only, while the reviewer's own reproduction verified the composed value clears.

## 9. Step I: the offramp as a Phase II status (2026-11-09; owner go 2026-11-09 "1-3 in order"; BUILT, see the record at the end of this section)

Decision input. Connor (2026-11-09): "adding a new phase II status choice is the way to go … Phase II Offramped #682090001 … the name can be changed later with no downstream consequences." [VERIFIED via production option-set metadata, owner-authorized read 2026-11-09] `wmkf_phaseiistatus` on `wmkf.crm.dynamics.com` carries `682090001` "Phase II Offramped"; the sandbox does not yet. D50 stands: staff decide the offramp after reviews, with a short written justification, and the Chairs do not approve it. D36 stands: the formal status is set in Dataverse; the apps read it.

What the production request-status rule does with it [VERIFIED 2026-11-09]: `WMKF_Set Request Status Program Phase II` has no branch for `682090001`, so recording Offramped leaves `akoya_requeststatus` as it was (normally `Phase II Pending`). The apps must key on the Phase II status value, never on the request status string, for this outcome.

### I1. Read model (pure)

- `PHASE_II_OFFRAMPED = 682090001` beside `PHASE_I_CHAIRS`.
- `J27_OUTCOMES` gains `offramped`; `deriveOutcome` returns it when `request.phaseIIStatus === PHASE_II_OFFRAMPED`, after the request-status classes and before the Phase I outcomes. Terminal: no forward tasks, phase derived from evidence as today (an Offramped row that presented stays in deliberations with no tasks).
- `continue-decision-missing` is removed from `J27_BLOCKERS`. A new blocker `offramped` blocks the four `J27_PRESENTATION_OPERATIONS` and `send-invitations`; it fires only when the outcome is `offramped`. Presentation operations are therefore open by default for a live row, closed by the recorded offramp. The C6 invariant holds (recording keys never blocked).
- `record-offramp` keeps its D4 contract (available from Recommended Invite onward, never blocked) and gains `detail.recordedAs`: the Phase II status label, so the strip can say how the decision is recorded. The task disappears once the outcome is terminal, as every task does.
- Label maps: outcome has no label map today; the strip shows `J27_PHASE_LABEL` plus, for a terminal outcome, one line "Offramped" (strip change, not a model change).
- Dashboard DTO unchanged in shape; `outcome: 'offramped'` flows through `j27DashboardDto`.

### I2. Server enforcement (the four presentation services)

Each gate keeps its legacy visibility check and adds one refusal: when the request's `wmkf_phaseiistatus === PHASE_II_OFFRAMPED`, refuse with a service-specific code (`site_visit_logistics_request_offramped`, `site_visit_materials_request_offramped`, `presentation_invitation_request_offramped`, `meeting_transcription_request_offramped`) and a plain sentence ("This request took the offramp; presentations are not scheduled for it."). [VERIFIED 2026-11-09] None of the four request reads selects `wmkf_phaseiistatus` today (`logistics-service.js`, `collection-service.js`, `invitation-service.js`, `binding.js`); each gains the field in its request projection. UI gates mirror the server (feedback-ui-gates-must-mirror-server-guards): the scheduling, materials, invitation and transcription controls disable with the same sentence when the resolve DTO's outcome is `offramped`.

### I3. Discovery and lists

- Discovery is unchanged: an Offramped row stays discoverable (readiness alone for J27 Research), so the record is never lost (owner principle).
- Reviewer Finder: `actionable` already hides a row with a post-review Phase II disposition; `682090001` is one, so Offramped rows leave the actionable list and remain in `all`. No code change; one test row.
- The dashboard list shows the outcome through the existing `j27.outcome` key once step E's list consumer exists; the strip shows it now.

### I4. Open after this step

- **Written justification (D50(2)).** Connor's answer covers the status only. Candidates: a new memo column on `akoya_request` (sandbox-first, like the other J27 memos), or the existing visit-assessment memo. Not assumed here; the strip will say "Offramped" without the reason until decided.
- **Who sets the status.** D36 says staff set it in Dataverse. If the Workbench should record it (a lead PD action next to First Cut and Semi-finalist), that is a step G-style write with the D5 editability rule and belongs in a later addendum.
- **Alignment log.** D36/D50 said the field was open; row D51 below records Connor's answer.

### I5. Tests and gates

Pure-model rows: Offramped at each phase (initial, peer review with reviews received, deliberations with a presentation record) → outcome `offramped`, tasks empty, blocker `offramped` present, `continue-decision-missing` absent everywhere; Offramped plus decided award → `decided-award` wins. Service tests: each of the four gates refuses an Offramped row and still admits a live Phase II Pending row; projection includes the field. Reviewer Finder: Offramped hidden in actionable, shown in all. Gates: status-enum-parity (label maps), types, route-service-boundary, trust-boundary-guid, api-routes if any route body changes (none planned).

Sequence: I1 with tests → I2 with tests → strip line → Codex review → owner go. No merge.

### I6. Build record (2026-11-09)

Built as specified in I1, I2 (server side), I3 and I5. Deviations: (a) **UI mirroring of the four refusals is deferred.** The controls that reach the refused operations do not receive the J27 stage today: `SiteVisitEditor` (schedule/edit the presentation), `SiteVisitMaterialsCard` (Request materials, Send reminder, Send invitation again, and its email preview), `PresentationInvitationPanel` (prepare and send), and `RecordingAndTranscriptCard` (bind a recording). The server refusal's sentence reaches each through its existing error path. Plumbing the outcome into those components is a later UI step, noted here so feedback-ui-gates-must-mirror-server-guards is not silently skipped. (b) **Strip outcome badge** added: a small label for any terminal outcome (`J27_OUTCOME_LABEL`, pinned to `J27_OUTCOMES` by test), so "Offramped" is visible without a task list. (c) `record-offramp` does not gain `detail.recordedAs`; the status label is the badge's job once the outcome is recorded, and before that the task text already says how to record it. Refusal codes: `site_visit_logistics_request_offramped` (409), `site_visit_materials_request_offramped`, `presentation_invitation_request_offramped`, `meeting_transcription_request_offramped` (409). The Reviewer Finder test's Phase II option list gains 682090001 and its actionable rule hides it with no code change.

### I7. Rework after Codex review (2026-11-09, commit 806e7bc6c)

Codex's step I review (NEEDS REWORK) found the materials invite, remind and email-preview paths and the invitation send action reached their dispatch without the Offramped refusal. Fixed: `collection-service.js` has one `assertNotOfframped(request)` helper called in create, invite, remind (after `loadContext`, before `getOpenCollection`) and preview; `invitation-service.js` `actOnInvitation` refuses a send after `requestForActor` and before `store.get`/`claim`, so no receipt is ever claimed for an Offramped row. Tests prove each guard by presence (an open collection, a prepared invitation) and assert the dispatch mocks were not called. Sibling checked: the automatic reminder sweep (`reminder-sweep.js`) calls `sendReminderEmail` directly but is retired at runtime (`automatic_reminders_retired` with default dependencies), so it needs no guard today; a re-enable must add one. Codex's re-review then found `waiveMaterialsItem` and `confirmMaterialsReady` still mutated an Offramped request's collection (commit 806e7bc6c); both now refuse through the same helper, so every materials mutation and dispatch is refused and the open collection simply rests (the Offramped row has no presentation to be ready for). Reads (`getMaterialsCollection`) stay open. All three rounds are recorded verbatim in `J27_STEP_I_REVIEW_2026-11-09.md`.

Codex's targeted re-verification of the waive/ready fix (session 01a1c1e1-5fb7-7723-836d-8f364303c46c; the earlier NEEDS REWORK round was 01a1c1de-70c3-7fd3-be7c-124a4285d393) returned READY: guards precede every write, each regression fails without its guard, no mutating or dispatching materials export is unguarded, reads stay open. The full Jest run (unit and integration) is green on the branch after two integration suites were repinned: dashboard fixtures gained a request status for the exact discovery predicate, and the live-questions envelope accepts the reports line's `staffReviewEvidenceHash`.

### I8. Preview smoke (2026-11-09)

Deployment `dpl_8kaj9FtYL6R9JkfAEjZjntE2hoSc` (commit 1556da9e9) served under the stable alias with a branch-scoped Preview `DYNAMICS_URL` pointing at the sandbox. `/api/workbench/resolve-request` for 1000384 returned the `j27` block (phase `initial-assessment`, outcome `triaged`, basis `degraded`); the request page rendered the strip "Initial Assessment · Semi-finalist recommendation: No · Some facts could not be read."; `/api/workbench/dashboard` listed the J27 cycle with ten Research rows and no set-asides. Degraded basis on Preview: `integrity` reported `read-failed` and the three memo facts reported `unavailable`. The memo result is explained by source: each memo guard requires its `J27_*_SCHEMA_READY=on` flag plus a sandbox `DYNAMICS_URL`, and no such flag is set for Preview (`vercel env ls`, read 2026-11-09). The integrity read failure was not diagnosed (Preview has a `POSTGRES_URL`, so the cause is not a missing connection string); it is recorded as an open observation, not a venue property. The alias was restored to `dpl_5wQcfshKGG4z8cyeTueXkt9L4sve` afterwards and verified with `vercel inspect`. The branch-scoped `DYNAMICS_URL` Preview variable for `claude/j27-read-model` must be removed when the branch retires.

## 10. Merge rehearsal (2026-11-09, read-only, throwaway worktrees removed)

Ancestry: `claude/j27-read-model` is built on `codex/j27-workbench-reports` (31 commits not on `main`); `codex/j27-factory-scenarios` is on `main`; `codex/j27-semi-finalist` (one commit, 2026-11-06, pushed 2026-11-09 for preservation) is on `main`.

- Reports → read-model → Factory merge cleanly in sequence; on that combined tree types, status-enum-parity, api-routes, atlas, doc-symbol-refs and fact-consistency are green.
- `codex/j27-semi-finalist` conflicts with the reports line in six First Cut files in every order. It is an earlier version of the reports line's 2026-11-07 semifinalist commit, which carries strictly more (integrity rehearsal, test-request isolation, the screen check). Its one unique piece, `tests/unit/workbench-first-cut-route.test.js`, is ported to this branch. Recommendation: park the branch; do not merge it.
- Four unit suites are red on the combined tree and green on `main`, so the reports line introduced them: `awardee-tab` (date-dependent), `reviewer-engagement-census` (recorded caller list lacks `staff-review-summary-service.js`), `reviewer-follow-up` (page props gained `j27IntegrityEnabled`), `workbench-read-coalescing-stage2-characterization` (`staffReviewEvidenceHash` on the reviewers DTO). They block a merge and belong to the reports line's surfaces.

## 11. "Not provisioned" is not a failed read (2026-11-10)

Owner report, 2026-11-09: "Some details could not be read." appears often. Trace of the sandbox Preview of `claude/j27-read-model`, where every J27 row was `degraded`:

1. **Memo waves switched off.** [VERIFIED via source and `vercel env ls --environment preview`, 2026-11-10] `j27MemoInputs` marked a memo key `unavailable` whenever its readiness helper was false. No `J27_*` variable is set for Preview, so `rationale` and `rosterMemo` were `unavailable` on every row there. All four helpers also require a non-production deployment, so after promotion every open J27 Research row in Production would have been `degraded` with no read having failed. The request page never cleared it: the Overview skips a gated-off read, so the server's key stood.
2. **Integrity read failed.** [VERIFIED via a throwaway local Postgres 16, 2026-11-10] `queryLatestIntegrityRows` joins `j27_integrity_jobs` (migration 096, on this line only). Without the table the query fails with `relation "j27_integrity_jobs" does not exist`; with 096 applied it returns rows. [VERIFIED via `vercel env ls`] the Preview of this branch has no branch-scoped Postgres setting and uses the shared database. [ASSUMED] that database lacks the table; `schema_migrations` there was not read (owner-run). This closes the open observation in I8.

Change: `j27MemoInputs` now emits `{ status: 'not-provisioned' }` for a wave that is off. `deriveJ27Stage` treats it as unconfirmed (no phase row, task or blocker matches) and leaves it out of `basis`. A failed read still yields `unavailable` and `degraded`. This reverses the C1 sentence "or schema wave not ready" and narrows C8.4: every tier 1 key `unavailable` still degrades, but an unprovisioned memo is no longer `unavailable`. Both the cycle list note and the request page's stage strip follow from `basis`, so both are covered. Tests: `tests/unit/j27-read-model.test.js` (C8.4), `tests/unit/j27-read-model-inputs.test.js`, and the dashboard and resolve service suites, whose waves-off rows are now `partial`.

No code change for the integrity read: the reader is correct once its table exists, and manual screenings need that read even when the automatic screen is off. Migration 096 must be applied to the target database before this line's code serves there (rollout plan, "Postgres preparation"). Until then every J27 row on that deployment is `degraded`, correctly.

Not resolved: section I8 records three memo facts `unavailable` on the Preview; current source gives two there (the review summary and visit assessment share a gate with no flag). Not investigated further.

## 12. The strip's next-step line follows the cycle list (2026-11-10)

The strip printed the model's `primaryTask`. Once reviewer counts loaded, a request recommended to the Chairs read "Next: Identify reviewers" (cycle-page build plan, finding 1). The strip now calls `rowLine` from `shared/utils/j27CycleRows.js`, the list's rule: a main task leads; a wait on the Chairs or on the Phase II status is said as a wait; the optional offramp task never leads; "Identify reviewers" leads only in Peer Review. One difference from the list: the list always has reviewer counts, the page gets its facts as tabs load, so the strip prints "Nothing is waiting on staff right now." only when `basis` is `full` and otherwise leaves the basis note to stand alone. Tests: `tests/unit/j27-page-stage.test.js`, `tests/unit/workbench-request-page-j27-strip.test.js`. Commits `eaf8758f1` and the one after it on `claude/j27-cycle-page`.

