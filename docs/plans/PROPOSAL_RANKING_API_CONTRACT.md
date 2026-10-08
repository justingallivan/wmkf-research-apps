# Proposal Ranking API contract

Status: implementation contract for the first Proposal Ranking release. It is
updated for the 2026-10-08 owner decisions removing excusal and adding explicit dry-run erasure, after revision 3 of `PROPOSAL_RANKING_DESIGN_2026-10-07.md`. Runtime
activation is now enabled in Production; multi-identity acceptance remains pending. Sandbox and Production schema/application-role setup are verified;
bounded persistence checks and direct-table denial for the tested sandbox staff
identity passed. Production facilitator/grants and four-participant direct-table/search
privacy checks passed. Production activation passed the signed-in participant waiting-state
smoke; the full browser rehearsal remains open. See
`docs/atlas/dataverse-proposal-ranking.md` for target-specific status.

## Route

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

## Common response

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
      excuseParticipant: false; // retained wire field; excusal is unavailable
      cancelRound: boolean;
      resetDryRun: boolean;
    };
  };
  round: null | {
    etag: string;
    policyRevision: number;
    state: 'active' | 'canceled';
    dryRun: boolean;
    erased: boolean;
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
    excuse: null; // retained wire field
    cancel: null | { fingerprint: string; message: string };
    resetDryRun: null | { fingerprint: string; message: string };
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

## Actions

```ts
type Action =
  | { action: 'preview'; cycleCode: string }
  | { action: 'open'; dryRun?: boolean; cycleCode: string; previewFingerprint: string; operationId: string }
  | { action: 'read'; roundId: string; operationId?: string }
  | { action: 'save'; roundId: string; programKey: ProgramKey; order: string[]; etag: string; policyRevision: number; operationId: string }
  | { action: 'submit'; roundId: string; programKey: ProgramKey; order: string[]; etag: string; policyRevision: number; operationId: string }
  | { action: 'generate'; roundId: string; programKey: ProgramKey; etag: string; policyRevision: number; confirmationFingerprint: string; operationId: string }
  | { action: 'edit'; roundId: string; programKey: ProgramKey; order: string[]; etag: string; policyRevision: number; operationId: string }
  | { action: 'publish'; roundId: string; programKey: ProgramKey; etag: string; policyRevision: number; confirmationFingerprint: string; operationId: string }
  | { action: 'transfer'; roundId: string; successorSystemUserId: string; policyRevision: number; operationId: string }
  | { action: 'resetDryRun'; roundId: string; policyRevision: number; confirmationFingerprint: string; operationId: string }
  | { action: 'cancel'; roundId: string; policyRevision: number; confirmationFingerprint: string; operationId: string };
```

`open.previewFingerprint` must match a fresh, complete source preview. Any source
change returns `409` with the replacement preview and requires the facilitator to
review it. The server returns confirmation fingerprints in `confirmations` only
while each transition is available. `generate` and first `publish` tokens are per
program and bind the policy revision, both programs' submission state, and the
named outstanding PDs. `cancel` binds the same current round state.
This makes the final confirmation stale when submissions or policy change.

All order writes require an exact permutation of that program's frozen proposal
IDs. `save` applies only to an unsubmitted own list; `submit` atomically stores the
final order and lock. `edit` applies to a meeting order in `composite-draft` for
the facilitator only; the captured roster gains edit permission only after that
program is `published`. `generate` applies to a meeting list in `collecting`, and
`publish` applies to a generated list in `composite-draft`. The response's meeting
`etag` is required for each transition or edit.

All captured participants must submit for each nonempty program. `excuse` requests
are rejected with `400 invalid_request`. Older snapshots and published results are
retained; a round containing a legacy excusal cannot generate or publish another
composite (`409 legacy_excusal`). No stored history is rewritten. Opening uses a
single Open round button without an acknowledgment checkbox; readiness and the
fresh-preview fingerprint still gate the operation.

## Explicit dry runs (feature branch; not yet promoted)

`open.dryRun` defaults to false and accepts only a boolean. It is captured in the
immutable round snapshot; existing ordinary rounds cannot be relabeled. A retry
of the creation operation must retain the same mode. All participants see the dry-run
label; their actual authenticated identities submit their own lists.

`resetDryRun` is available only to the current facilitator of an active round
whose persisted snapshot has `dryRun: true`, before or after either publication.
The confirmation fingerprint includes the round ETag, so any intervening save,
submission, meeting edit or administration change requires fresh confirmation.
Ordinary rounds reject reset. Dry runs use erasure instead of retained cancellation.

One ETag-conditional changeset deletes every list belonging to the dry run, scrubs
its snapshot and administration history, marks the round canceled and clears its
cycle's active pointer. It retains only a content-free round receipt (round/cycle,
creation/reset operation IDs, facilitator/reset actor and timing) for safe retry
and delayed-opening detection. An exact retry returns `dry-run-erased`; it cannot
clear a subsequently opened round. Removed roster participants lose access to the
old receipt. Source proposals, source external-review scores and other rounds are
not changed. Opening a replacement is a separate explicit action with fresh inputs.

This erases active application ranking records. Dataverse audit history, backups
and copies already viewed/exported are outside this operation; their retention
has not been inspected in this session. Do not promise platform-wide erasure.
The tracked app-role spec adds Delete only on ranking lists; applying that permission
in Production and validating it remain separately owner-approved release steps.

## Errors and outcome handling

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

## Default facilitator setting

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
