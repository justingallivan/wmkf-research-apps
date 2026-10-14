# Proposal Ranking API — existing wire contract and planned revision

Updated 2026-10-13. Sections 1–5 below describe **[VERIFIED via main source at
`b3219f4aa`] the existing revision-3 API**, not the agreed replacement workflow.
Revision 5 product authority is `docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md`.
Section 6 describes the branch-built v2 actions and semantics; additive fields are
provisioned and metadata-verified in the sandbox; deployed v2 creation flags remain unchanged. The paused branch `0d161d60f` differs from main (§7).
Deployment facts are dated receipts in `docs/atlas/dataverse-proposal-ranking.md`;
the October 13 saved service and browser rehearsals exercised four trusted personas,
not independent SSO/app-grant or production authenticated-route acceptance. A second
reveal and full browser restart passed; final state is private preparation for all four. See
`docs/audits/PROPOSAL_RANKING_V2_SANDBOX_REHEARSAL_2026-10-13.md` for limits.

## 1. Existing route

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

## 2. Existing common response

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

Privacy rules shape the response, not the client. Before a program is published,
a roster participant receives only their own individual list and that program's
submission progress. The facilitator receives all private lists and the draft
composite. A superuser outside the roster receives administration metadata only;
that does not include private list orders. After publication, the captured roster
receives the shared order and named ranks for that program. Publishing SE does not
expose MR. A former non-roster facilitator loses participant access after a
transfer. Canceled rounds are read-only.

## 3. Existing actions

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

## 4. Existing errors and outcome handling

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

## 5. Existing default facilitator setting

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


## 6. Version-2 contract — enabled in dedicated test Preview; not Production

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

Before reveal a response may contain the actor's own preparation and readiness
progress; only the facilitator may receive other PDs' private preparation. After
reveal expose the named immutable assessments and mutable collective view to the
round's authorized participants/facilitator. A nonparticipant superuser does not
inherit private content merely from that role. Hiding controls is not privacy.

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

[PLANNED — owner authorized, not yet live-verified] Enrich the rehearsal to 12
realistic fictional proposals (six MR, six SE), each with three varied saved synthetic
reviews, distinct institutions/titles, budgets, geography, award histories and clearly
labelled sample discussion. Fictional institution/history/discussion projection is
restricted to the dedicated test policy; it must not fabricate production data or
claim genuine accepted sentiment. Source preparation, deployment and a fresh opened
round must be verified separately; resets retain an existing round's frozen pool.

The dedicated test mode requires the exact project/profile/origin, Preview environment,
test Neon database, registered Dataverse sandbox, real authentication and enforced
DAL/target interlocks. Synthetic reviews remain excluded outside that policy.
The last verified opened pool contained six proposals and the corrected roster
Beth, Justin, Jean and John Sader, all Preparing. The first-D97 scripted fictional
sentiment fixture previously returned current through the real reader; that receipt
does not prove generation or human analysis. Earlier deployment and fixture details,
including four new TEST files in shared SharePoint, remain in the sandbox audit.
