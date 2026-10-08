# Proposal Ranking bounded persistence rehearsal

Date: 2026-10-07. Target: `orgd9e66399.crm.dynamics.com` (sandbox).
Historical persistence checkpoint: storage checks passed; staff identity verification
was inconclusive at this point. Follow-up direct-table privacy evidence is in
`docs/audits/PROPOSAL_RANKING_STAFF_PRIVACY_2026-10-07.md`; current activation status is in
`docs/atlas/dataverse-proposal-ranking.md`.

## Scope and live evidence

[VERIFIED via single execution of `scripts/probe-proposal-ranking-persistence.js --execute`]
The owner requested a minimal rehearsal without changing existing proposal fields.
Only the three new ranking tables were written. D99 contains two synthetic card IDs
inside its ranking snapshot; no source requests or reviews were created or changed.
No grants, settings, roles, flags or production state were changed by this rehearsal.
The retained IDs below allow readback; do not rerun initialization or delete them.

- Initialization and readback by operation ID passed.
- Conditional round/list save persisted the reversed order.
- A real pre-save list ETag returned HTTP 412. The preceding round patch rolled
  back with it: both the saved order and last-operation receipt remained unchanged.
- Duplicate cycle creation returned HTTP 412; the original coordinator remained
  unchanged and no duplicate round or list persisted.
- GET `/searchstatus` reported `provisioned` and none of the three ranking entities
  in `entitystatusresults`. This proves current sandbox search exclusion only.
- The staff probe received HTTP 200 from impersonated WhoAmI, but the returned ID
  did not match the requested identity. It therefore attempted no fixture reads.
  Direct staff denial remains UNKNOWN, not a pass or a demonstrated leak. No
  permission changes or broader authentication investigation were undertaken.

This exercises the real persistence adapter, not the authenticated UI lifecycle.
API privacy, lifecycle and calculations have automated test coverage; an actual
multi-identity browser meeting remains unperformed. No eligible ordinary source
proposals were available in the earlier complete sandbox scan. The D99 fixture
does not change that pool and is not a real proposal-ranking round.

## Runtime correction and review

[VERIFIED via source and live conditional save] Shared Dynamics annotation processing
renames `@odata.etag` to `_etag`. The ranking adapter now restores its public ETag
shape on every read path. Without this correction, writes failed closed for missing
revisions. The regression runs the real annotation processor and checks both
If-Match operations. Shared Dynamics behavior is unchanged.

Luna implemented; Sol and the orchestrator reviewed. Bounded Claude Opus review
used verified `claude.ai` subscription OAuth outside the sandbox, with agent API-key
environment variables removed and read-only tools. No Fable or metered review
product was invoked. Verdict: APPROVE. Review text follows below.

## Validation and changed-fact reconciliation

- Ranking unit and Explorer integration tests: 12 suites / 116 tests passed.
- Changed-file ESLint, script syntax, DAL gate and sequential self-test passed.
- Atlas, doc-currency, canonical-pointers and doc-symbol-refs gates and sequential
  self-tests passed; docs-catalog and diff whitespace checks passed.
- Changed-fact restatement search found no remaining live stale claims within the
  listed scope. Direct staff privacy and browser behavior remain UNKNOWN.
- Prior head `8d8b10872` full GitHub Jest passed in run `37698207467`; the earlier
  transcript-card failure in the historical setup receipt is not a current blocker.
  These CI results do not attest to the new ETag correction commit.
- Mode A scope: sandbox persistence/search evidence, ETag read/write contract and
  current activation limits. Authority is the single live execution below and
  source/test/review evidence above. Current Atlas, design, API contract, catalog,
  route matrix and handoff are reconciled; earlier review/setup receipts are
  explicitly historical. No memory/wiki restatement was found.
- Disconfirming probes deliberately used a stale list revision and duplicate cycle;
  both returned 412 with rollback readback. Staff identity verification failed,
  preserving that UNKNOWN. No end-to-end browser or production claim is made.

## Retained execution receipt

```json
{
  "version": 1,
  "purpose": "Proposal Ranking sandbox persistence rehearsal; synthetic fixture only; rows retained.",
  "target": "orgd9e66399.crm.dynamics.com",
  "cycleCode": "D99",
  "actorSystemUserId": "79913eac-7f3e-f111-88b4-6045bd015cb0",
  "fixtureRequestIds": [
    "80000000-0000-4000-8000-000000000001",
    "80000000-0000-4000-8000-000000000002"
  ],
  "ids": {
    "cycleId": "80369e36-855a-449c-b62d-7113770ff2a4",
    "roundId": "aa0920a8-d386-41ae-af3b-b1a2c83986ce",
    "listId": "94e848b7-0fad-492d-a00b-c25224e18f49",
    "creationOperationId": "80cb4fa6-c38d-4609-856b-7e05e2d6d77b",
    "saveOperationId": "1aeb85e7-ec3b-4ebd-869c-961c72f6e8e4",
    "staleOperationId": "31cbe266-410d-4fdb-8145-1702ad11496f",
    "duplicateCycleId": "a2b1f70c-017b-47fa-be7c-f3cde3b2c6d2",
    "duplicateRoundId": "c12b6564-fac5-4fc2-a287-05cba52fdb49",
    "duplicateListId": "33c43824-e7aa-4c7f-b85c-d86f4da14f3a",
    "duplicateOperationId": "571c6c34-2f66-4e62-aa3f-5c280d5e54f2"
  },
  "createdAt": "2026-10-07T22:58:14.564Z",
  "result": "verified-persistence",
  "assertions": {
    "initializeAndRead": true,
    "conditionalSave": true,
    "staleEtagRejectedAtomically": {
      "passed": true,
      "httpStatus": 412
    },
    "duplicateCycleRejectedAtomically": {
      "passed": true,
      "httpStatus": 412
    },
    "ordinaryStaffFixtureReadDenied": null
  },
  "searchStatus": {
    "available": true,
    "httpStatus": 200,
    "status": "provisioned",
    "rankingEntityStatusListed": {
      "cycle": false,
      "round": false,
      "list": false
    },
    "rankingTablesAbsentFromSearchStatus": true
  },
  "staffRead": {
    "attempted": true,
    "impersonationVerified": false,
    "whoAmIStatus": 200,
    "fixtureReadStatuses": null,
    "candidateSystemUserId": "d57ddb27-c8db-ee11-904d-000d3a310f67",
    "candidateRoleCheck": "bounded-direct-role-scan-found-no-admin-customizer-or-ranking-role; team-inherited-roles-not-checked"
  },
  "retained": {
    "cycleId": "80369e36-855a-449c-b62d-7113770ff2a4",
    "roundId": "aa0920a8-d386-41ae-af3b-b1a2c83986ce",
    "listId": "94e848b7-0fad-492d-a00b-c25224e18f49"
  },
  "completedAt": "2026-10-07T22:58:16.243Z"
}
```

## Bounded Opus review — verbatim

**APPROVE.** I found no blocking correctness or security issues in the ETag normalization.

**The `_etag` contract holds**
- `processAnnotations` (`lib/services/dynamics/annotations.js:25-28`) renames `@odata.etag` to `_etag` and drops all other `@odata*` keys.
- Every read the adapter uses goes through it: `getRecord` (`lib/services/dynamics/read-ops.js:139`) and `queryAllRecords` (`read-ops.js:312`). So before this fix, every `['@odata.etag']` check in the adapter saw `undefined`, and every conditional write failed with "revision required".
- `changeset.js:205` only sends `If-Match` when `op.ifMatch` is truthy. The guards at `proposal-ranking.js:82,104,112,119` stop an operation from going out without a precondition, so a missing ETag fails closed instead of turning into an unconditional overwrite.

**The fix covers every read path**
- `exposeConcurrencyEtag` (`lib/dataverse/adapters/proposal-ranking.js:35-38`) is applied to every adapter read that returns rows: `oneByFilter` (which covers `findCycleCoordinator` and `findRoundByCreationOperation`), `readRound` and `listRoundRows`.
- Every service consumer reads its ETag only through these adapter functions:
  - `roundState` and `listState` (`lib/services/proposal-ranking/service.js:100,108`)
  - `verifyEtag` (`service.js:406`)
  - the coordinator payload in the open flow (`service.js:592`), which feeds `makeOpenOperations`' `If-Match`
  - `cancelRoundChangeset`, which gets its coordinator from `findCycleCoordinator` (`service.js:927-937`)
- No caller hands a raw `DynamicsService` row to a PATCH helper.
- The `If-Match` value is passed through exactly as the server sent it (e.g. `W/"…"`), and the existing `@odata.etag` takes precedence. The function returns a shallow copy, so it never mutates the source row.

**No new exposure**
- The leftover `_etag` field holds the same value as the ETag the service already sends to clients on purpose (`service.js:100,108`), so nothing new leaks.
- Write bodies are built fresh (`roundPatch`, `listPatch`, `coordinatorPatch`, `coordinator.patch`), so neither `_etag` nor `@odata.etag` can end up in a PATCH or POST payload.
- Clients can't inject an ETag: `verifyEtag` compares the client-supplied value to the server row, and `If-Match` always uses the server's value.

**Test** (`tests/unit/proposal-ranking-adapter-etag.test.js`)
It runs the real `processAnnotations` rather than a fake, so it will catch future changes to the contract. It checks all three read paths and that both `If-Match` values reach the changeset.

`patchRound`, `cancelRoundChangeset` and `findRoundByCreationOperation` aren't tested directly. They use the same helper and the same `['@odata.etag']` access, so this is optional extra coverage, not a blocker.
