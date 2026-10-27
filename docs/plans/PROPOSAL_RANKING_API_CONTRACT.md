# Proposal Ranking API — D26 production contract and historical contracts

**Released to production 2026-10-15 (Session 609)**: D26 v2 round `49279ac7-3ab9-41d8-b2d6-5aaf4085e642` is open; see the receipt in `PROPOSAL_RANKING_D26_RELEASE_2026-10-14.md`. Candidate and branch statements below are dated pre-release history. §8 plus the observer and concurrent-save changes merged in PRs #485 and #489 are the production contract.

Updated 2026-10-15. **The D26 branch API is §8**. Its reviewed baseline was
source-verified at `9fe92f0ed` on `codex/d26-ranking-release`; a later baseline
at `e091dd82f` reached dedicated test Preview. The single-Ready simplification
described there is subsequent branch work. Production has not received this D26 release.
Sections 1–5 preserve the **historical revision-3 API** verified on main at
`b3219f4aa` before D26 integration. Section 6 preserves the earlier Preview v2
contract. Do not use either historical section as the current D26 privacy or
facilitation contract. Revision 5 product authority is
`docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md`. The paused branch `0d161d60f`
differs from the October 13 main baseline (§7).
Deployment facts are dated receipts in `docs/atlas/dataverse-proposal-ranking.md`;
the October 13 saved service and browser rehearsals exercised four trusted personas,
not independent SSO/app-grant or production authenticated-route acceptance. A second
reveal and full browser restart passed; final state is private preparation for all four. See
`docs/audits/PROPOSAL_RANKING_V2_SANDBOX_REHEARSAL_2026-10-13.md` for limits.

## Branch extension — meeting lock/unlock and saved cycles, 2026-10-27

[VERIFIED via source and focused tests on `codex/session-645-start`; not deployed.]
This extension supplements the production v2 contract without changing legacy v1
behavior, table schemas or the existing route's app-grant requirement.

- `POST {action: "cycles"}` is read-only and returns `{cycles: string[]}` containing
  distinct valid saved cycle codes whose coordinator has a round pointer. No
  ranking contents or private assessments are included. Dedicated rehearsal mode
  returns only its configured test cycle. The client merges these with the nearby
  calendar choices, retaining old cycles indefinitely in the selector while their
  saved coordinator pointers exist. A failed discovery is shown explicitly.
- `lockMeeting` and `unlockMeeting` use the existing v2 mutation envelope:
  `roundId`, UUID `operationId`, `roundEtag`, `policyRevision`,
  `preparationVersion`, `revealId`, and server `confirmationFingerprint`.
  Both require an active, unsuperseded, revealed group and either captured
  facilitator membership or the authenticated superuser role. Ordinary PDs and
  observers receive no confirmation and are denied by the server.
- The public workflow adds `meetingLock: null | {locked: boolean,
  actorSystemUserId: string, actorName?: string, at: string}`. Existing missing metadata means unlocked;
  malformed metadata fails closed. Stage stays `revealed`, and the round stays
  `active`, so existing read/history/workbook paths work while locked.
- A lock blocks every ordinary workflow mutation (`409 meeting_locked`), including
  collective edits, resets, preparation reopening and restarts. Current ETag and
  confirmation checks serialize it against in-flight edits. Unlock restores the
  prior edit rules; it does not broaden a superuser observer's other permissions.
- Each lock/unlock atomically persists the metadata, a bounded administration-log
  event (`meeting-locked`/`meeting-unlocked`, actor/time/operation), and immutable
  operation receipt. Lock also archives the exact saved collective revision in
  History. Identical confirmed retries never apply the transition twice.
  Reopening private preparation after unlock clears group-only lock metadata.

The permission exception here is narrow: nonparticipant superusers retain observer
privacy and receive only lock/unlock confirmations after reveal. Other observer
mutation denial remains unchanged. Historical candidate sections below retain
their dated pre-extension permissions and deployment boundaries.

Verification boundary: ranking tests, types, scoped lint, and relevant policy
checks passed locally; the isolated fictional browser rehearsal exercised actual
lock/confirm/unlock controls at mobile and desktop sizes. Claude Opus 5.5 reviewed
the diff through the owner's OAuth subscription, requested the non-roster actor
name fix, and approved the follow-up. The Webpack production build passed; the
default Turbopack build cannot follow this worktree's shared dependency symlink.
No live data write, production lock, schema operation or deployment was performed.
The source-to-persistence-to-consumer trace covers the existing authenticated route,
version dispatcher, reducer, conditional changeset, receipt/history and UI. New
schema/migration, provider execution, and partial batch success audits are N/A.
The documentation sweep is bounded to the branch extension in this API contract,
ranking Atlas and guide; historical deployment/candidate receipts remain historical.

## 1. Historical revision-3 route — October 13 main baseline

`/api/proposal-ranking` accepts authenticated `GET` and `POST` requests. Every
response is `Cache-Control: private, no-store`. The route requires
`requireAppAccess(req, res, 'proposal-ranking')`; actor identity comes from the
authenticated profile and its validated Dynamics system-user mapping. Client
payloads never supply an actor identity.

`GET ?cycleCode=J27` returns a facilitator preview when that cycle has no active
round. A non-facilitator with no active round receives `mode: "waiting"` and no
proposal snapshot. `GET ?roundId=<guid>` reads the current round subject to
per-request authorization. Missing both selectors returns `400`.

`POST` accepts one `action` per request. Mutating calls require a client-generated
canonical UUID `operationId`; the server stores it with the affected row(s) and
uses it to resolve repeat and uncertain outcomes.

## 2. Historical revision-3 common response — October 13 main baseline

```ts
type ProgramKey = 'se' | 'mr';
type ListStatus = 'draft' | 'submitted' | 'collecting' | 'composite-draft' | 'published';

type Response = {
  mode: 'preview' | 'round' | 'waiting';
  cycleCode: string;
  roundId: string | null;
  viewer: {
    systemUserId: string;
    isFacilitator: boolean;
    isSuperuser: boolean;
    isRosterParticipant: boolean;
    isObserver?: boolean; // v2 only: grant holder outside roster and facilitation
    capabilities: {
      preview: boolean;
      open: boolean;
      saveOwnList: boolean;
      submitOwnList: boolean;
      generate: boolean;
      editMeetingOrder: boolean;
      publish: boolean;
      transferFacilitator: boolean;
      excuseParticipant: boolean;
      cancelRound: boolean;
    };
  };
  round: null | {
    etag: string;
    policyRevision: number;
    state: 'active' | 'canceled';
    facilitator: { systemUserId: string; name: string };
    snapshot: {
      proposals: ProposalCard[];
      seedOrders: Record<ProgramKey, string[]>;
      roster: Array<{ systemUserId: string; name: string; excluded: boolean }>;
    };
  };
  preview: null | {
    proposals: ProposalCard[];
    seedOrders: Record<ProgramKey, string[]>;
    roster: Array<{ systemUserId: string; name: string; hasAppAccess: boolean }>;
    outstandingReviewCount: number;
    unexpectedStatuses: string[];
    warnings: string[];
    canOpen: boolean;
    previewFingerprint: string;
  };
  confirmations: {
    generate: Record<ProgramKey, null | { fingerprint: string; message: string; outstandingNames: string[] }>;
    publish: Record<ProgramKey, null | { fingerprint: string; message: string; outstandingNames: string[] }>;
    excuse: null | { fingerprint: string; message: string };
    cancel: null | { fingerprint: string; message: string };
  };
  programs: Record<ProgramKey, {
    proposalIds: string[];
    progress: { required: number; submitted: number; outstandingNames: string[] };
    ownList: null | ListView;
    facilitatorLists: null | ListView[];
    meeting: null | MeetingView;
    meetingStatus: ListStatus | null;
  }>;
  operation: null | { operationId: string; status: 'confirmed' | 'uncertain' | 'superseded'; result: string };
};

type ProposalCard = {
  requestId: string;
  requestNumber: string;
  title: string;
  organization: string;
  institutionGeography?: 'East' | 'West' | null; // absent in older frozen snapshots
  programKey: ProgramKey;
  amountMinorUnits: number | null;
  currency: null | { code: string; name: string; precision: number };
  score: null | { mean: number; displayMean: number; ratedCount: number; receivedCount: number; distribution: Record<string, number> };
};

type ListView = {
  listKey: string;
  programKey: ProgramKey;
  owner: null | { systemUserId: string; name: string };
  status: ListStatus;
  order: string[];
  etag: string;
  version: number;
  updatedAt: string;
  totals: Array<{ requestId: string; cumulativeMinorUnits: number | null; complete: boolean; currencyCode: string | null }>;
};

type MeetingView = ListView & {
  composite: null | {
    sourceSubmissionIds: string[];
    baselineOrder: string[];
    scores: Record<string, { rankSum: number; averageRank: number; tied: boolean }>;
    ranks: Array<{ requestId: string; participants: Array<{ systemUserId: string; name: string; rank: number }>; minRank: number; maxRank: number; disagreement: boolean }>;
  };
};
```

`institutionGeography` comes from the applicant account's `wmkf_eastwest` choice
(East `100000000`, West `100000001`), is frozen with the card at opening, and
participates in the preview fingerprint. Unknown or missing values become null;
older snapshots may omit the field. Only known values render an E/W marker.
Geography does not affect ranking calculations or eligibility.

These privacy rules describe the dated revision-3 main baseline, not the current
D26 candidate. Privacy rules shape the response, not the client. Before a program is published,
a roster participant receives only their own individual list and that program's
submission progress. The facilitator receives all private lists and the draft
composite. A superuser outside the roster receives administration metadata only;
that does not include private list orders. After publication, the captured roster
receives the shared order and named ranks for that program. Publishing SE does not
expose MR. A former non-roster facilitator loses participant access after a
transfer. Canceled rounds are read-only.

## 3. Historical revision-3 actions — October 13 main baseline

```ts
type Action =
  | { action: 'preview'; cycleCode: string }
  | { action: 'open'; cycleCode: string; previewFingerprint: string; operationId: string }
  | { action: 'read'; roundId: string; operationId?: string }
  | { action: 'save'; roundId: string; programKey: ProgramKey; order: string[]; etag: string; policyRevision: number; operationId: string }
  | { action: 'submit'; roundId: string; programKey: ProgramKey; order: string[]; etag: string; policyRevision: number; operationId: string }
  | { action: 'generate'; roundId: string; programKey: ProgramKey; etag: string; policyRevision: number; confirmationFingerprint: string; operationId: string }
  | { action: 'edit'; roundId: string; programKey: ProgramKey; order: string[]; etag: string; policyRevision: number; operationId: string }
  | { action: 'publish'; roundId: string; programKey: ProgramKey; etag: string; policyRevision: number; confirmationFingerprint: string; operationId: string }
  | { action: 'transfer'; roundId: string; successorSystemUserId: string; policyRevision: number; operationId: string }
  | { action: 'excuse'; roundId: string; participantSystemUserId: string; reason: string; policyRevision: number; confirmationFingerprint: string; operationId: string }
  | { action: 'cancel'; roundId: string; policyRevision: number; confirmationFingerprint: string; operationId: string };
```

`open.previewFingerprint` must match a fresh, complete source preview. Any source
change returns `409` with the replacement preview and requires the facilitator to
review it. The server returns confirmation fingerprints in `confirmations` only
while each transition is available. `generate` and first `publish` tokens are per
program and bind the policy revision, both programs' submission state, and the
named outstanding PDs. `excuse` and `cancel` bind the same current round state.
This makes the final confirmation stale when submissions or policy change.

All order writes require an exact permutation of that program's frozen proposal
IDs. `save` applies only to an unsubmitted own list; `submit` atomically stores the
final order and lock. `edit` applies to a meeting order in `composite-draft` for
the facilitator only; the captured roster gains edit permission only after that
program is `published`. `generate` applies to a meeting list in `collecting`, and
`publish` applies to a generated list in `composite-draft`. The response's meeting
`etag` is required for each transition or edit.

## 4. Historical revision-3 errors and outcome handling — October 13 main baseline

Errors use `{ "error": { "code": string, "message": string, "retryable": boolean, "current": object|null } }`.

- `400 invalid_request`: malformed action, selector, UUID, program, or order.
- `403 access_denied`: app, roster, facilitator, or lifecycle permission denied.
- `409 conflict`: stale ETag/policy, incomplete submissions, changed preview,
  invalid lifecycle transition, or duplicate concurrent operation. `current`
  carries a permission-filtered current response or refreshed preview when useful.
- `503 dependency_unavailable`: source, configuration, schema readiness, or
  Dataverse dependency unavailable. No fallback data is returned.
- Unconfirmed transport outcome is `409 uncertain_outcome` with `retryable: true`;
  the client keeps the view visibly unsaved and rereads by operation ID.

Embedded transactional 4xx results are confirmed rollbacks. Timeouts, 5xx, and
unparseable changeset responses are uncertain and require readback using
`{ action: 'read', roundId, operationId }`. The response's `operation` reports
whether the operation is confirmed, uncertain, or superseded by newer state. A
repeat terminal action returns its existing result only if the operation ID
matches the action persisted with that transition. Conflict `current` values are
always shaped using the same privacy filtering as a successful read.

## 5. Historical scalar facilitator setting — October 13 main baseline

`GET /api/admin/proposal-ranking-facilitator` returns
`{ systemUserId: string|null, name: string|null, configured: boolean, revision: string|null, eligibleStaff: Array<{ systemUserId: string, name: string }> }`.
The UI displays `eligibleStaff` names and posts the selected identity as
`PUT { systemUserId: string, revision: string|null }`. The route validates that it is a canonical GUID
for an enabled Dynamics user, and stores only that GUID in
`proposal_ranking.default_facilitator_systemuser_id`. The route requires both
Proposal Ranking app access and superuser authority. Missing configuration,
disabled identity, or failed configuration reads block preview/open with a
user-readable message.

A successful transfer by a facilitator outside the captured roster returns a
`mode: "waiting"` receipt with no round snapshot or lists; subsequent round reads
are denied. An uncertain opening retains its original action payload and operation
ID in the UI's “Resolve opening attempt” control, so retry cannot create a
replacement for the original round after cancellation.


## 6. Historical version-2 Preview contract — October 13/14 (superseded by D26)

Snapshot: candidate source and hosted Preview as recorded in the October 13/14
receipts. This section preserves that dated wire contract; it does not describe the
current D26 branch's pre-reveal visibility or dual-facilitator rules. Section 8 is
the current branch contract and explicitly identifies its remaining acceptance
limits.

Use the agreed design for product rules. `service.js` dispatches snapshot version 2
to `workflow-service.js`; legacy actions/readers remain a separate version-1 path.
The authenticated route, session-derived actor, app grant and private/no-store headers
are unchanged. New opening requires both literal-on v2 creation/schema flags.

All mutations carry `action`, `roundId`, UUID `operationId`, `roundEtag`,
`policyRevision`, `preparationVersion` and `revealId` (null before reveal).

| Action token | Additional payload |
|---|---|
| `saveAssessment` | `programKey` (`mr`, `se`, `co`), `listVersion`, `assessment: {order, boundaries, confidence}` |
| `buildCombined` | `confirmationFingerprint` |
| `confirmCombined`, `ready`, `reopenOwn` | None |
| `resetProgram` | `programKey` (`mr`, `se`), `confirmationFingerprint` |
| `reveal`, `resetCollective`, `reopenPreparation`, `restartWalkthrough` | `confirmationFingerprint` |
| `editCollective` | `listVersion`, `order`, `boundaries` |
| `history` (read-only POST) | Only `roundId` and optional `before` ordinal; at most ten entries |
| `sentiment`, `exportWorkbook` (read-only POST) | `roundId`, `roundEtag`, `preparationVersion`, `revealId`, `listVersion` |

V2 round responses identify `workflowVersion: 2` and contain `workflow` stage/pointers,
`own` assessments, readiness `progress`, facilitator-only `facilitatorLists`, and
`collective` only after reveal. Assessment order plus two boundary positions owns grade;
confidence is keyed by proposal (`confident` / `not-sure`, absent until answered).
`confirmations` is keyed by action (program reset uses `resetProgram:<program>`).
Canceled/replaced runs are read-only and carry the successor pointer.

[VERIFIED via branch source and dedicated sandbox deployment `d1b206185`; not Production]
V2 source cards carry `researchFunding: { status, qualifyingGrantCount,
latestAwardYear, totalAmountMinorUnits }`. The additive total is a safe integer in
USD cents for `available`/`provisional` history, and null when unavailable. It sums
the same qualifying regular Research awards as the count, retaining all existing
exclusions and provisional classification. The object is frozen with the opening
snapshot; older snapshots may omit the total and render **Not available**, never
an invented zero. No migration/backfill or reset refresh is implied. The card
disclosure consumes this field; scoring and workbook columns are unchanged.

The service stores immutable operation receipts containing request hashes. To resolve
an ambiguous write, resubmit the identical payload/operation UUID; the stored outcome
is returned alongside the current authorized view, without executing it again.
An operation UUID reused with different input conflicts. Serialized storage limits
are enforced before the atomic changeset; historical receipts are not loaded into
ordinary views. Version-1 operation readback remains as described in §4.

[VERIFIED via branch tests and dedicated Preview d59e4dc33, 2026-10-14] Private preparation
clients recover from definite `409 stale_scope`, `conflict`, or
`confirmation_stale` responses with up to three automatic retries. Each rereads
the round and requires the same actor, active round, policy, full workflow and
complete own preparation before rebasing the round ETag/confirmation. A fresh
operation UUID accompanies the changed request hash. Shared actions, changed own
work and uncertain outcomes never take this automatic path. If a rebased attempt
has an uncertain outcome, the UI retains that exact last payload/UUID for receipt
recovery. See `docs/audits/PROPOSAL_RANKING_PD_SAVE_CONFLICT_2026-10-14.md`.


Sentiment returns optional current envelopes or an explicit access/dependency status;
any failed batch clears the entire enrichment. A round change during the read rejects
the response. Workbook export returns `{filename, base64}` for one saved
group revision, with the matching individual inputs and no sentiment.

| Semantic operation | Required contract |
|---|---|
| Save program preparation | Save a complete MR or SE permutation, two A/B/C boundaries, and per-proposal confidence atomically with the relevant version. Default boundaries roughly split the reviewer-score seed into thirds. Grades follow boundaries, not a conflicting second grade store. |
| Create/review PD combined order | Within A then B then C, pair MR/SE items by the PD's position and order each pair by reviewer mean; finish each pair before the next and append leftovers. Save the reviewed total order, grades/boundaries and confidence. Program edits invalidate combined confirmation and readiness; only an explicit confirmed rebuild replaces combined-only work. |
| Mark ready / reopen | Require every proposal once, grade and explicit confidence, combined-order confirmation and confirmed saves. Reopening before reveal clears readiness. Readiness belongs to a particular saved version, not an unversioned boolean. |
| Reveal | Facilitator only; require all captured PDs ready on the same validated versions. Atomically preserve their combined orders/grades/confidence, save equal-weight rank sums and deterministic unique starting positions, and expose one collective list for this preparation version. Initial bars enclose unanimous-A prefix and unanimous-C suffix, without reordering; everything between is Alternates. Repeats/readback must not overwrite group edits. |
| Edit collective list | After reveal, persist only collective order and the Recommend funding / Alternates / Do not recommend separators; preserve individual inputs and calculated baseline. ETag/policy checks apply to card and boundary changes together. |
| Reset own program / rebuild own combined | Owner only in private preparation; reopen own ready state first. Program reset restores seed/thirds, clears its confidence and invalidates combined confirmation/readiness. Combined rebuild uses current program assessments and requires reconfirmation. |
| Reopen after reveal | Facilitator only; preserve old reveal and group work, start a new private preparation version from saved individual work, clear all readiness. Old revealed inputs stay read-only; new edits are private until all PDs are ready and facilitator reveals again. |
| Reset collective | Facilitator only; preserve the replaced group revision and restore this reveal's calculated baseline/unanimous initial bars. No individual-input changes. |
| Restart walkthrough | Facilitator at every stage, including after export; retain prior run, start new seed/thirds/unanswered-confidence preparation. Do not require a dry-run flag. No source-data edits. |
| Enrich discussion cards | Ranking-authorized server read plus the sentiment reader's own access check. Accepted, current, not-withdrawn sentiment only; no preparation response enrichment. History shows qualifying Research count/latest award year across all available history, with total USD in an expandable card disclosure. History and E/W are informational and never affect ranking. |
| Export workbook | One confirmed collective revision plus its immutable reveal inputs; two sheets from the design. Reject/wait for pending or uncertain edits. No sentiment/transcript quotes in the agreed export. |

[CURRENT BRANCH BEHAVIOR, not the D26 target] Before reveal a response may contain
the actor’s own preparation and readiness progress; the existing facilitator
exception may return other PDs’ private preparation. [PLANNED — owner decision
2026-10-14] Remove that exception for the D26 release: both facilitators receive
only their own preparation plus readiness, including conflict/readback/history
paths and newly reopened preparation. See the D26 release plan for acceptance.
After
reveal expose the named immutable assessments and mutable collective view to the
round's authorized participants/facilitator and to observers. A superuser role adds
nothing: a nonparticipant superuser with the grant is an observer like anyone else.
Proposal Ranking grant holders who are neither roster participants nor captured facilitators are read-only observers (owner decision 2026-10-15): before reveal they see the source snapshot and readiness only; after reveal they see the named assessments and collective view, history, workbook and sentiment (sentiment still needs Meeting Tracker readership); every mutation is refused. Hiding controls is not privacy.

The new API must not silently accept revision-3 or branch `co` data as individual
combined rankings. Old snapshots lack grades/confidence/readiness/reveal versions.
Explicitly version their readers and writes; do not backfill invented assessments.
Retain old audit/read capability and reject incompatible mutations clearly.

All resets bind a server-issued impact confirmation to current state, actor authority,
round/preparation/reveal versions and operation identity. Record outcomes durably so
a retry after later edits cannot execute the reset again. Reset is not DELETE.
Historical versions never contribute to current ready counts or current exports.

Reveal must serialize against resets, reopening, autosave and facilitator/roster changes.
A response may report confirmed reveal only after the complete durable transaction;
uncertain transport requires operation-identity readback and the same authorization
filter as normal reads. No partial roster composite or partial privacy release.

Calculation: compare combined rank sums, then unrounded reviewer mean descending,
then numeric-aware request number and identity. A missing reviewer score sorts after
a known one for a tie-break; equal/missing values use the stable fallback. No shared
positions or `tied` presentation in the revised contract. Confidence and grades
are descriptive inputs, not weights. Keep missing currency/amount safeguards.

Sentiment service: `getDeliberationSentiments(requestIds, { profileId })`, inside
trusted DAL context, validates GUIDs and at most 50 IDs, checks active Meeting Tracker
grant/superuser live, and returns a map of `current` / `out_of_date` / `none` envelopes.
Only `current` includes sentiment. Known per-request unavailability becomes `none`;
genuine infrastructure failures throw; access denial must not be mislabeled as
"no analysis exists". Data must remain absent from unauthorized payloads. Batch sizing,
read timing, dependency-error display, and withdrawal/currentness refresh are required
integration details, not a reason to bypass the existing reader.

## 7. Paused branch differences — source inspection only

At `codex/proposal-ranking` / `0d161d60f`, `combine` creates `meeting:co` from already
published program meeting orders. There is no `pd:co` preparation workflow. Branch
`resetDryRun` and `open.dryRun` are rehearsal capabilities, not revision-5 readiness.
Its reset physically deletes list rows and is gated by `snapshot.dryRun`; neither
behavior satisfies the agreed non-destructive, all-stage reset contract. Do not
carry over its Delete privilege or reset implementation as a default.
The branch carries `researchFunding` with `status`, `qualifyingGrantCount`,
`totalUsd`, `lastAwardCycle`; it currently displays dollars/latest cycle and exports
one saved published meeting order as CSV. This differs from the current expandable count/year/total-USD
card presentation and the two-sheet workbook. Main's types above do not include those
branch-only additions. See the source comparison audit for exact evidence and
remaining storage/access prerequisites before implementation.

## Dedicated authenticated test Preview — deployed to dedicated Preview; partial acceptance

[VERIFIED via deployment receipt and hosted browser] Source `d1b206185` is deployed
in dedicated READY Preview `dpl_GCjqpVkTNncxSC2kRzByGLbbspyq` at
`https://wmkf-meeting-transcription-test-h2yh5pkf4.vercel.app`, with stable alias
`https://wmkf-meeting-transcription-test.vercel.app`. The compact card refinements
and expandable total Research funding are included. The release passed 179 ranking
tests and Justin's Microsoft SSO/updated-interface check. This is sandbox deployment,
not Production promotion or independent acceptance by the other three PDs.

[VERIFIED via provisioning logs, READY Preview and saved-round readback] The enriched
rehearsal is deployed from `591c3e98e7f24e699f7f83260a16ab1b1a929167` in Preview
`dpl_BcJwMnCKWAQp9RueY2F4hDNjdPb6` at
`https://wmkf-meeting-transcription-test-9qilqb16b.vercel.app`; the stable test alias
points to this deployment. New round `ea3496d5-c105-4e97-95c0-6b13a2e3f2ef` contains
12 realistic fictional proposals (six MR, six SE) and 36 saved synthetic reviews,
three per proposal, with all four PDs in private preparation and nobody ready.
Fictional institutions, geography, award histories and explicitly labelled sample
discussions use a strict dedicated-test projection; they are not real awards or
accepted human discussion analyses. The 182 ranking tests in 20 suites, scoped lint,
types and DAL/reviewer-boundary/script-writer/API/status gate/self-test pairs passed.
[VERIFIED via hosted browser] Signed-in Justin saw six proposals in each program,
distinct institutions/project titles and three review tiles per card, including
E/E/VG and divergent E/G/F. Both programs remained at 0/6 confidence answers.
History opened the original run read-only, and Open replacement run returned to
the enriched round. Anonymous `/api/proposal-ranking` returned 401. No PD assessment
data changed and no live group reveal occurred in this check; other staff sign-ins
and a full group walkthrough remain pending.

The atomic operator upgrade preserved old round `f48741f0-4560-471d-b51f-ef93db48c152`,
its exact frozen snapshot hash and lists, with previous/superseded links. This was a
fresh source-pool replacement, not a normal UI reset. The commit succeeded once;
a readback DTO typo was repaired and exact-hash/link verification completed without
replaying the mutation (`/private/tmp/ranking-rich-round-receipt.json`). Normal resets
continue to retain the current frozen pool. Production is unchanged.

The dedicated test mode requires the exact project/profile/origin, Preview environment,
test Neon database, registered Dataverse sandbox, real authentication and enforced
DAL/target interlocks. Synthetic reviews remain excluded outside that policy.
The current enriched pool contains 12 proposals and the corrected roster
Beth, Justin, Jean and John Sader, all Preparing. The first-D97 scripted fictional
sentiment fixture previously returned current through the real reader; that receipt
does not prove generation or human analysis. Earlier deployment and fixture details,
including four new TEST files in shared SharePoint, remain in the sandbox audit.

## 8. D26 implementation candidate — dedicated Preview baseline and branch simplification

[VERIFIED via local source, focused Jest, and final Opus/Sol review,
`codex/d26-ranking-release` commit `9fe92f0ed`, 2026-10-15] This section supersedes conflicting §2/§5/§6 privacy
claims for the D26 branch candidate only. Sections 1–7 retain their dated main,
branch, and dedicated-Preview history; they are not evidence of the D26 behavior.
The `e091dd82f` baseline was deployed to dedicated test Preview at
`https://wmkf-meeting-transcription-test-8zuz51qab.vercel.app`. The single-Ready
simplification below is later branch work; this document does not record a deployment
of that change. Production remains unchanged. Persisted sandbox testing described
below used synthetic D96 data, not the live D26 proposal pool.

[VERIFIED 2026-10-14 via `workflow.js` Git blob
`141d5861df403c32ad01aef0e03869aa0cd2575e`, current
`AssessmentWorkflow.js`, and focused
`proposal-ranking-workflow.test.js`, `proposal-ranking-workflow-service.test.js`,
and `proposal-ranking-assessment-ui.test.js`] The approved
preparation simplification gives the PD one **Ready for group discussion** action
after reviewing the combined list. `ready` validates current program source
versions and complete confidence, then sets `co.confirmed = true` and the
version-bound readiness receipt within the same reducer transition and atomic
save. The separate `confirmCombined` token remains accepted for older clients,
but the current UI does not require or present it as a preceding step. Outstanding
private saves, uncertain outcomes, and an outdated combined list still block Ready.

Admin `PUT /api/admin/proposal-ranking-facilitator` accepts exactly
`{ facilitatorSystemUserIds: string[], revision: string|null }`. The array must
contain one or two unique canonical system-user GUIDs. Each identity must resolve
to enabled staff, an active mapped profile, and an explicit Proposal Ranking app
grant. The save uses the expected setting revision and writes only
`proposal_ranking.default_facilitators_v1`, encoded as
`{version:1,systemUserIds:[...]}`. GET returns the eligible staff list, selected
IDs/names, new-key revision and a missing-key marker. A present malformed new
setting blocks fallback; only absence allows a singleton legacy scalar.

New v2 opens store the sorted captured membership and provenance in
`workflow.facilitation`; the older round scalar stores the first sorted member for
compatibility only. Either captured member may preview/open and authorize shared
facilitator actions. Existing v2 workflow JSON without membership uses that
round's own scalar as a singleton. Restart carries forward the captured set or
materializes that singleton with `source: "legacy-round"`; it never reads current
defaults. A present malformed persisted set fails closed. A new dual setting with
v2 creation disabled refuses v1 preview/open with `409 configuration_requires_v2`.

For v2 responses, `facilitatorLists` is always null. `own` contains only the
authenticated actor's private preparation; `progress` contains readiness only;
collective content is present only after reveal. History, supplements, operation
replay, and error `current` use explicit privacy projections; observers
(including nonparticipant superusers) get the snapshot and readiness before reveal and
the revealed group view after it, never `own`. In the October 27 branch extension,
nonparticipant superusers receive only lock/unlock confirmations after reveal;
ordinary observers receive no confirmations. Observer round and history reads end
with a round ETag check and rebuild from the current round (bounded retries, then
`stale_scope`), so a reopen committed mid-read cannot return revealed work. For v1, every participant
including a facilitator-as-PD receives their own list. Before publication, even
facilitators receive no individual lists or meeting draft; they get only a safe
`meetingControl: {listKey,status,etag,version}` handle for Generate/Publish.
Unpublished composite-draft edits return `409 invalid_transition` without writing.
After publication, existing edit rules continue.

The service validates stored round version before selecting legacy or v2
read/action/history/supplement consumers. V2 requests on v1 rounds, legacy actions
on v2 rounds, and unknown stored versions return `409 unsupported_version` before
mutation. Private preparation retries remain bounded to three definite conflict
rebases after the initial attempt and require unchanged actor, own state, and
workflow/policy scope; shared writes continue to use ETags, operation IDs, and the
existing atomic changeset.

**Local verification on `9fe92f0ed`:** 25 suites / 269 tests, types, scoped lint and
production build passed. The scoped API-route, status-enum, DAL, OData,
Dynamics-context, route-lifecycle, route-service and trust-boundary-GUID gates with
sequential self-tests passed on the previous reviewed source slice. Documentation
gates and self-tests pass for the current docs. Opus's final follow-up is satisfied
and Sol found no actionable defects. The host Chrome smoke with trusted sandbox
personas rendered cards/readiness/controls, navigated history and downloaded the
workbook; it does not establish independent SSO or WebKit/iPad acceptance. See the
[implementation review record](../audits/PROPOSAL_RANKING_D26_IMPLEMENTATION_REVIEW_2026-10-14.md).
The implementation review is tracked in
`docs/audits/PROPOSAL_RANKING_D26_IMPLEMENTATION_REVIEW_2026-10-14.md`.
**[VERIFIED via isolated sandbox run, 2026-10-15 UTC]** New synthetic
D96 rounds persisted actor-only private preparation, one-winner two-facilitator
reveal/collective-edit/reopen/restart races, retained captured membership and
history, and a workbook with 23 synthetic proposals / 92 assessments. The durable
local receipt is `/private/tmp/proposal-ranking-d26-d96-sandbox-receipt.json`.
Four trusted direct service personas were used; the run did not test preview/open
configuration revision capture, active profile mappings, app grants, route auth,
independent OAuth/SSO sessions, or signed-in Safari/iPad acceptance. It does not
prove the live D26 pool. See the [D26 addendum](PROPOSAL_RANKING_D26_IMPLEMENTATION_ADDENDUM_2026-10-14.md)
for the acceptance boundary.
