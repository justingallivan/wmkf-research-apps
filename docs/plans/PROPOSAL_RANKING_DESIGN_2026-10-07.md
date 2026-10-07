# Proposal Ranking — design for review

Date: 2026-10-07. Revision: 3 (Opus revision-2 findings incorporated). Status: **Source implemented; sandbox schema/role and persistence rehearsal verified; browser rehearsal and production activation pending.**
Owner: Justin. Design consolidation: Codex. Requested reviewer: Claude Opus.
Authority: owner decisions in the Proposal Ranking planning conversation.

## Purpose

Replace the staff's Post-it-note whiteboard ranking process with draggable proposal
lists. Support private PD preparation, facilitator preparation, and a group meeting
that reaches an ordered consensus for funding discussions. This does not record
grant approvals, award amounts, or change proposal lifecycle status.

## Agreed product decisions

- Separate app, working name **Proposal Ranking**, with a funding-cycle selector.
- Pool: all proposals in the cycle at the stage currently called Phase II. The
  stage name will change; one explicit source-status rule must be used independently
  of UI wording. No reconsidered/deferred proposals and no test requests.
- Separate Science and Engineering (SE) and Medical Research (MR) lists initially.
  A cross-program combined list is deferred. Concatenating two program lists is
  not a valid cross-program preference ranking.
- Participants: distinct lead PDs assigned to the eligible proposals across both
  programs. Every participant ranks every proposal in each program, not just their
  own assigned proposals. No manual participant selection is required in v1.
- Default facilitator: CSO Beth Pruitt; configurable to another member of the
  round's PD roster. Beth currently leads proposals and therefore also participates
  as a PD. Facilitator status alone must not add a ranking vote.
- All PDs start with identical lists based on external peer-review scores. PDs do
  not provide those review scores. They provide their own final ordered rankings.
- A PD sees only their own individual lists before publication. The facilitator
  can see every individual list, including while PDs are working.
- Explicit submission locks an individual list. Reopening submissions is out of
  the initial scope.
- Each program proceeds independently: once all required SE submissions are in,
  SE can be generated and published even if MR is unfinished, and vice versa.
  The facilitator generates separate composite drafts. Each proposal's composite score is its average submitted
  position, with equal weight for each PD; lower average ranks first.
- The facilitator may reorder the draft and publishes it when ready. Before that,
  the composite drafts are visible only to the facilitator.
- After publication, participants see the shared order and named individual PD
  ranks, supporting discussion of who favors or questions a proposal.
- Participants can edit the published order; staff coordinate who is driving.
  Other devices refresh to see changes. Screen sharing supports the meeting.
  No real-time synchronization infrastructure in v1.
- Keep individual submissions and the calculated composite separate from the
  mutable meeting order.
- The facilitator may exceptionally excuse a PD, with confirmation and a recorded
  reason, before either program composite has been generated. Exclusion applies
  to both programs. Retain any submitted list but exclude it from calculation.
  Every PD submitting is the normal process; excusal is not routine roster editing.
- The facilitator may cancel a round only while neither program is published.
  Retain the canceled round read-only and open a replacement with fresh snapshots.
- The current facilitator or a superuser may transfer facilitation to another
  active PD on the captured roster at any point in an active round. Preserve all
  orders and publication state; the former facilitator returns to participant
  visibility and the successor gains facilitator visibility.
- Freeze all card details, amounts, review-score summaries, and initial order when
  the round opens. No background refresh of those values during a round.
- No ranking notes, projected-budget input, automatic funding cutoff, or funding
  decision writeback in v1. An administrative excusal reason is not a ranking note.

## Card contents and totals

Each row shows current position, organization, proposal title, full amount
requested, external peer-review score summary, and a link to the proposal.
The right side shows the sum of that proposal's full requested amount and all
higher-ranked proposals in that program list. Reordering updates totals immediately.
Published meeting rows additionally show named submitted PD positions and a
disagreement indicator. Facilitators can inspect those inputs before publication.

Approved defaults:

- Equal composite averages are marked as ties; the initial order stabilizes their
  display until the group resolves them. Display position is distinct from a tied
  calculated score.
- Unscored proposals remain in the pool, marked **Not scored**, initially after
  scored proposals.
- Show the minimum and maximum submitted PD rank. Highlight a spread covering at
  least a quarter of the list. Engineering definition:
  `maxRank - minRank >= ceil(proposalCount / 4)` with at least two PDs; no highlight
  when there is no variation. No disagreement label while rankings are private
  except in facilitator views.
- Capture the proposal membership, participating PD roster, and common score-based
  initial order when the round opens. New peer reviews or assignment changes must
  not silently change that round's inputs.

Calculation contract [implemented in `lib/services/proposal-ranking/calculations.js`; focused tests]:

- Seed order: descending arithmetic mean of submitted external reviews'
  `overallAssessment`, not risk ratings or categorical selections. Use unrounded
  means for sorting and round only for display; show rating distribution/count.
- Equal seed scores and unscored rows use numeric-aware request-number order,
  then request GUID as the final deterministic tie-breaker. Composite ties use
  the integer sum of PD positions (common denominator), then the saved seed order.
- Missing requested amounts must not count as zero. Mark totals incomplete from
  the first missing amount downward. Verify currency compatibility before summing.
- Sum requested amounts in integer minor units of one verified common currency.
  Store the currency alongside each amount; refuse a mixed-currency round rather
  than silently convert. Missing amounts remain null and visibly incomplete.
- Score basis: received reviews, excluding synthetic reviewers, with a finite
  overallAssessment value on the recognized Excellent=5 through Poor=1 scale.
  Use stored options when present. Older snapshots lacking options may use their
  saved answer label plus value only when that pair exactly matches this scale;
  never infer historical labels from today's editable question set. Unknown/mixed
  scales require correction before opening. Missing rating answers simply do not
  contribute; preserve rated/received counts and rating distribution in the snapshot.

## Source findings from the planning pass

These are source observations, not new production probes or deployment claims.

| Finding | Evidence | Status |
|---|---|---|
| Existing scheduler has drag reordering, immediate local movement, rollback on error, and stale-context guards. | `shared/components/meeting-tracker/SessionEditor.js`, `reorderSessionSlots`, `reorderSlots` | VERIFIED via source |
| Scheduler reorder validates a complete permutation and per-slot ETags; adapter submits a changeset. A round/list-level concurrency guard is new work, not proven by this pattern. | `lib/services/meeting-tracker/slot-service.js`, `reorderDeliberationSlots`; `lib/dataverse/adapters/deliberation-slot.js`, `updateOrders` | VERIFIED via source |
| Admin question editor has drag/up/down ordering, complete-set validation, version checks, and conflict feedback. | `shared/components/admin/ReviewQuestionsSection.js`; `lib/services/admin/review-questions-service.js` | VERIFIED via source |
| SE/MR use the internal `akoya_program` identity axis; broad Research scope is different. | `shared/config/researchPrograms.js`; `lib/services/workbench/program-scope-service.js` | VERIFIED via source |
| Existing Workbench eligibility is Phase II Pending OR advancing, with set-aside handling. It is not automatically the ranking eligibility contract. | `shared/config/workbenchVisibility.js` | VERIFIED via source |
| Review ratings come from answer snapshots. Missing ratings remain null; submitted reviews are identified by review receipt. | `lib/external/review-answer-snapshot.js`; `lib/services/review-manager/reviewers-service.js`; `shared/components/workbench/ReviewsTab.js` | VERIFIED via source |
| The defined overall-assessment scale runs from 5 Excellent to 1 Poor. Live editable questions and historical options must be considered before relying on a universal scale. | `lib/external/review-form-schema.js`; `lib/dataverse/adapters/review-answer.js` | VERIFIED via source; live scale not re-probed |
| The existing matrix rounds averages to one decimal, so its displayed average must not become the sorting input. | `shared/utils/review-matrix.js` | VERIFIED via source |
| Requested amount is `akoya_request`; total project budget is `akoya_expenses`; either may be null. | `lib/services/workbench/resolve-request-service.js` | VERIFIED via source |

## Explicit pool and opening contract

Open only through a deliberate facilitator action after preview. The configured
CSO identity can preview/open before a roster exists. The preview shows proposal
membership, assigned PDs, unscored proposals and outstanding review counts.
A superuser can configure the default facilitator using an active Dynamics user
GUID; no name/email matching or copied profile ID is an authorization mechanism.
Missing/disabled default identity blocks opening with an actionable message.
The CSO may facilitate without being a voting participant; replacement facilitators
must belong to the captured PD roster.

Pool predicate: selected cycle from `wmkf_meetingdate`, exact SE/MR internal
`_akoya_programid_value`, exact stored `akoya_requeststatus = Phase II Pending`,
non-test marker and null test-creation-run marker. Ignore dashboard triage flags.
The pending-status literal must be shared/exported instead of duplicated. A future
source-status rename requires a reviewed change to this predicate, not a UI edit.
Deferred, withdrawn, declined and other status values do not match. Flag unexpected
statuses in preview; do not broaden the pool to get past an empty result.

Require the test-request and synthetic-reviewer isolation schema and switches to
be ready before preview/open; an unset switch must not silently admit test data.
Complete pagination is mandatory. Any capped/failed read aborts opening. Resolve
all lead IDs from `_wmkf_programdirector_value` to active staff identities with
app access. Missing/ambiguous/inactive PDs block opening, never remove proposals.
The union of lead PDs across SE/MR is the captured voter roster. Empty program:
no individual lists or generation required; show No proposals. Both empty: refuse
opening. One voter is allowed, with no disagreement highlight. At least one
non-excused voter is required in every nonempty program.

Opening performs a fresh full read and compares a preview fingerprint covering
pool, staff identities, review basis, and card fields. If changed, return the new
preview for confirmation; do not freeze data other than what was reviewed. The
source read is a captured dataset, not a claim of a cross-entity Dataverse snapshot
transaction. Once captured, it supplies every PD's initial list. Later withdrawal
or data correction does not mutate it; the unpublished cancel/reopen control is
available. Published pools stay fixed in v1.

## Architecture and permissions [source implemented; sandbox storage provisioned]

Use existing app registration and authenticated route/service/adapter boundaries.
Dataverse is the implemented persistence target. The three table definitions and
application role are checked in under `lib/dataverse/schema/wave32-proposal-ranking/`
and `lib/dataverse/schema/roles/proposal-ranking-app.json`. Sandbox schema and application-role provisioning have passed readback. Runtime
configuration, direct-user privacy and multi-identity verification remain open. See
`docs/atlas/dataverse-proposal-ranking.md` for the activation boundary.

Use three logical tables (`wmkf_proposalrankingcycle`, `wmkf_proposalrankinground`,
and `wmkf_proposalrankinglist`):

1. **Cycle coordinator:** unique cycle key, active round GUID, version. A stable
   per-cycle row prevents two concurrent opens creating different active rounds.
   Create it by POST with a unique cycle key, NEVER alternate-key PATCH/upsert.
   Its active-round pointer is canonical UUID text (36 characters), not a lookup;
   cancellation clears it with a conditional PATCH.
2. **Round:** server-validated creation operation UUID, cycle, immutable pool/card/
   score/seed/roster snapshot, current facilitator GUID, policy revision, active or
   canceled state, timestamped administration events. Cancel never deletes data.
3. **List:** unique (round, listKey), where server-derived listKey identifies either
   an individual program+PD list or the program meeting list. An ordered request-ID
   JSON array lives on ONE row. Individual status: draft/submitted. Meeting status:
   collecting/draft/published. Immutable composite calculation and source submission
   IDs sit beside the separately mutable meeting order. Empty programs have no rows.

Bound snapshots at 512 KiB, each ordered list at 64 KiB, and round administration
logs at 128 KiB; refuse before writing if exceeded, never truncate. Use at most
one server retry for an unrelated save conflict. Test these limits against the
actual schema Memo sizes and realistic fixtures before enabling the app.
Use Dataverse row ETags, not a pre-read hash, for atomic compare-and-swap. Every round/list stores last operation UUID; irreversible round actions also
append their operation UUID to the bounded administration log. Actor/round pointer
columns use validated canonical UUID text, not Dataverse lookups. Capture
explicit authenticated actor GUIDs and timestamps for creation/submission/editing/
publication/administration. Do not treat `createdby` as a voting identity.

### Privacy and platform authorization

App API permissions are mandatory on every read and write. App access alone does
not grant access to rounds or lists. Before publication a participant gets only
their own program lists and submission progress; the facilitator gets all. After
program publication, that program's source ranks and shared order are available
to the roster. Publishing SE does not expose MR. Excluded PDs remain on the roster
for meeting participation, with their excluded status visible; their drafts are
not included in source-rank projections. A superuser alone gets administration
metadata for facilitator transfer, not other PDs' private list contents.

The new tables must not be included in ordinary staff Dataverse table privileges.
Use a dedicated application-user role for these app-owned tables. Database tenant
administrators remain privileged; this is not encryption against administrators.
Do not expose these tables through Dynamics Explorer, generic exports, search or
navigation expansions using the application's broad read identity. Implementation
must inventory and test those seams and apply an unconditional server-owned
sensitive-table exclusion, independent of mutable user restrictions. This exclusion
must cover direct and related entity reads; leaving a generic read path open blocks
release. One shared sensitive-table registry must feed Explorer validation,
describe/discovery, search filtering and export. Resolve relationship targets via
metadata, not navigation-name substring checks; deny unknown targets. Include
navigation paths in filters/order/count/FetchXML as applicable, not only explicit
expands, and the implicit createdby/modifiedby reverse relationships from systemuser.
Never enable the ranking tables for Dataverse relevance search. Direct Dataverse access by an ordinary PD must also be denied in rehearsal.

Ranking writes use an explicit application-owned adapter operation after the
ranking service authorizes the session actor. Store that actor in mandatory fields;
do not attempt impersonation and then rely on a 403 fallback. The adapter retains
trusted DAL context checks and the target/write interlock. The ranking adapter never passes `actingUserSystemId` to the shared changeset
transport; authenticated actors are recorded in mandatory payload fields. Pin
this in tests. The transport without a caller ID neither impersonates nor enters
the 403 impersonation-fallback branch; retain all existing context/interlock checks. No global auth/restriction
bypass, privilege broadening, or silent fallback is authorized by this design.

### Atomic lifecycle and repeat handling

- Every mutation re-reads the round, validates current actor permissions/state and
  client policy revision, and includes a conditional round PATCH and conditional
  list PATCH in one changeset. This fences facilitator/excusal/cancellation races
  as well as stale orders. Increment policy revision only for policy changes;
  ordinary list saves still conditionally touch the round version.
- For another participant's unrelated save, a bounded server retry is permitted
  only if the target list ETag, policy revision and permission decision remain
  unchanged. Never retry a target-list conflict by overwriting newer data.
- Reorder input is an exact permutation of that program's snapshot IDs plus list
  version. Reject duplicate/omitted/foreign IDs and unsupported fields.
- Submission waits for any client save, then writes the final order, submitted
  status, actor and time atomically. All further edits fail, including stale tabs.
- Initialize every nonempty program's individual and collecting meeting rows with
  the round, and point the cycle coordinator to it in one changeset using generated
  GUIDs. First coordinator creation uses POST plus a unique cycle key; a confirmed duplicate-key
  failure reloads the winner, while other errors retain their actual classification. Open requests carry a stable operation UUID so an uncertain
  retry resolves the original round and cannot create another after cancellation.
- Generate only when all non-excused lists for that program are submitted. Store
  source IDs, exact sums/counts/ranges and baseline order in the meeting row while
  moving collecting to draft. Inputs are immutable. Repeat generation returns the
  existing result without resetting meeting edits. Excusal is forbidden after
  either meeting list leaves collecting, keeping the voter set stable.
- Publish conditionally updates the meeting row version that the facilitator
  reviewed. This atomically exposes its current order and corresponding source
  ranks. Repeat publication does not reset its timestamp or order.
- Before first generation, name outstanding PD submissions in either program and
  confirm that excusal will no longer be available. Before first publication,
  name the other program's outstanding submissions and confirm that cancellation
  will no longer be available. These confirmations bind to current round policy
  and submission state. If a PD becomes unavailable afterward, the unfinished
  program can remain blocked; this is a disclosed v1 limitation, not automatic
  authority to alter published inputs or waive a vote.
- Excusal is irreversible within a round; excused PD lists become read-only.
  An excused PD remains eligible to facilitate because facilitator eligibility is
  roster-based, not vote-based. Their vote remains excluded. After transfer a
  former non-roster facilitator has no participant access. The current facilitator
  and captured roster may edit a published program list.
- Transfer facilitator/cancel/exceptional excusal use the round version and record
  actor/time/reason as applicable. Cancellation conditionally clears the active
  coordinator pointer and marks the round canceled in one changeset, only if no
  program is published. Canceled rounds reject all mutations; use a new operation
  UUID for a replacement. Do not support deletion/reopening of submitted lists.
- For a network timeout, read back by operation/round/list identity. Transport
  exceptions are not proof of rollback: the write may already have committed.
  Return a confirmed result or a clearly uncertain/conflict response, never a
  false saved or rolled-back claim. An embedded transactional 4xx confirms rollback;
  timeout, 5xx or unconfirmed response parsing requires readback. Match operation
  UUIDs in list/round rows and administration events. If a later save has superseded
  the last operation UUID, return current state/conflict, never falsely infer the
  earlier action failed. Retries of terminal transitions return their existing
  result only when matching the original action/state. Keep submission/generation/
  publication operation IDs with their immutable transition metadata.

### Client and response contract

`app -> authenticated API -> ranking service -> adapter -> conditional durable
write/read -> permission-filtered response -> card stack and cumulative totals`.
Use app key `proposal-ranking`. Named operations are preview/open, read
round, save own list, submit own list, generate/edit/publish program meeting list,
transfer facilitator, excuse participant, cancel unpublished round. All request
actors are session-derived. Program/round selectors are validated; errors use
400 invalid, 403 denied, 409 stale/incomplete, and 503 dependency unavailable.

Responses return only authorized data plus list ETag/policy revision and confirmed
operation status. Use private/no-store responses. Scope every load/save response
with a generation token for cycle/round/program changes; clear private data when
permissions change. A transfer cannot erase data already seen by a former
facilitator, but subsequent reads/writes must use their new rights.

Move cards optimistically; sum snapshot amounts locally. Serialize saves, retaining
only the latest queued drag, with submission/publication disabled until confirmed.
Use returned versions for subsequent writes. On conflict require refresh; on a
failed or uncertain save, retain a visibly unsaved state until readback/retry resolves
it. No WebSocket service, polling infrastructure, or silent multi-user merging.

## Build sequence and acceptance evidence

1. Finalize eligibility and schema/security details, verify source fields against
   the intended cycle through the authorized rehearsal/probe process, and register
   the separate app. No production writes are authorized by this design review.
2. Build deterministic seed/average/range/total calculations and complete-list
   validation; test missing data, ties, and small lists.
3. Build round initialization, private autosaved individual lists, and immutable
   submission. Test owner/facilitator/other-PD permissions at API level.
4. Build facilitator generation/publication and the shared editable meeting list.
   Test preservation of inputs, publication privacy, and repeated actions.
5. Exercise two browser sessions: stale save, submit-versus-save race,
   publish-versus-edit race, failed/uncertain save, refresh and scope changes.
6. Add schema-as-code, entity registry/security registration, Atlas coverage, API
   security matrix, service catalog and app lifecycle entries as applicable. Run
   relevant gates/self-tests sequentially and use the normal reviewed release path.

Existing baseline validation: 20 tests passed across `review-matrix.test.js` and
`meeting-tracker-slot-service.test.js` during this planning conversation. These
tests verify existing building blocks. Feature-specific tests are now under
`tests/unit/proposal-ranking-*.test.js`; final integrated results and review are
recorded separately from this historical planning baseline.

## Review reconciliation

Original review: `docs/audits/PROPOSAL_RANKING_OPUS_DESIGN_REVIEW_2026-10-07.md`
(historical assessment of revision 1, not a statement of current design status).

| Finding | Revision 2 resolution |
|---|---|
| B1 eligibility | Exact current-cycle Phase II Pending SE/MR predicate, no reconsidered or test requests; triage ignored. |
| B2 opening/recovery | Facilitator preview/open, exceptional recorded excusal, unpublished cancellation/replacement. |
| B3 privacy | App-only table access, mandatory generic-read exclusions, explicit authorized adapter writes; no fallback-based privacy. |
| B4 facilitator | Configured stable CSO GUID, roster-derived replacement, current facilitator or superuser transfer. |
| B5 atomicity | Coordinator unique key, row ETags, whole-list payloads, conditional round+list transactions and open operation identity. |
| S1 scores | Received/non-synthetic overall ratings, saved scale validation and explicit missing/unknown handling. |
| S2 snapshots | All card fields frozen at opening (owner accepted). |
| S3 programs | Independent SE/MR generation and publication (owner accepted). |
| S4 saves | Serial client saves, atomic submission, policy and list fences, uncertain-result readback. |
| S5 totals | Requested amount snapshot, common verified currency, integer minor units, missing-data indicator. |
| S6 ties | Exact rank sums, then seed order; numeric-aware request-number seed ties. |

Sandbox schema/security-role provisioning is verified in
`docs/audits/PROPOSAL_RANKING_SANDBOX_SETUP_2026-10-07.md`. Runtime activation
and real multi-identity rehearsal remain unperformed; no eligible sandbox proposals
were found by the complete source scan. Source assertions are bounded to the cited code; no production-read
permission is inferred from design approval. Engineering contracts above remain the acceptance requirements; source code and
focused tests provide implementation evidence. Bounded live storage checks passed
(initialization, conditional save, stale-write and duplicate-key rollback); current
sandbox search exclusion is verified. See
`docs/audits/PROPOSAL_RANKING_PERSISTENCE_REHEARSAL_2026-10-07.md`.
Direct-user privacy and authenticated browser lifecycle remain unverified.

Revision-2 Opus outcome: **READY WITH NAMED CHANGES**, returned by
`claude-opus-5-5` on 2026-10-07. Receipt:
`docs/audits/PROPOSAL_RANKING_OPUS_DESIGN_REVIEW_R2_2026-10-07.md`.
Revision 3 incorporates N1–N6: create-only coordinator, explicit app-owned writes,
operation IDs/uncertain outcome classification, metadata-resolved generic-reader
exclusions, escape-hatch warnings and explicit excusal/transfer edge cases.
The implementation against revision 3 received an Opus source review and bounded
correction review (APPROVE WITH NONBLOCKING NOTES). Receipt:
`docs/audits/PROPOSAL_RANKING_OPUS_IMPLEMENTATION_REVIEW_2026-10-07.md`.

## Review request

Assess simplicity, fidelity to owner decisions, missing product contracts,
eligibility/data interpretation, privacy, atomic state transitions, concurrency,
and durable-state design. Distinguish build-blocking gaps from implementation
choices. Do not demand live synchronization, notes, funding cutoffs, or another
product beyond the agreed scope. Recommend the smallest concrete corrections.
