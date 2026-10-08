# Proposal Ranking sandbox setup receipt

Date: 2026-10-07. Target: `orgd9e66399.crm.dynamics.com` (registered sandbox).
Historical setup checkpoint, before the bounded persistence rehearsal. Its remaining-work
list below records that earlier state; current status is in
`docs/atlas/dataverse-proposal-ranking.md` and
`docs/audits/PROPOSAL_RANKING_PERSISTENCE_REHEARSAL_2026-10-07.md`.
No production mutation, source-request mutation, application grant, facilitator
setting, or activation flag was performed by this setup.

## Verified setup

- Merged current main into the feature branch (`458d7248f`); only conflict was the
  generated canonical route count, regenerated as 285. Sol reviewed the merge.
- Ran existing `scripts/apply-dataverse-schema.js --target=sandbox --wave=32-proposal-ranking`
  dry run, then the same command with `--execute`: exit 0.
- Ran `scripts/apply-security-role.js --target=sandbox --role=proposal-ranking-app`
  with the sandbox WhoAmI application identity as `--assign`, dry run then execute:
  exit 0, nine Create/Read/Write privileges, solution membership and app assignment.
- Existing application credentials were loaded in process; the target interlock was
  explicitly on and classified local → sandbox. No credentials were copied or logged.
- GET-only `scripts/probe-proposal-ranking-readiness.mjs` verified all three entity
  identities, expected attribute types/bounds/options, all alternate keys Active,
  role assignment, isolation marker schema and exact source projection queries.
- The complete all-date scan, filtered to ordinary Phase II Pending SE/MR proposals,
  returned zero eligible rows without pagination cap. No rehearsal cycle is available.

## Live-schema corrections

Sandbox queries proved `systemuser` has `isdisabled` but no `statecode`, and
`transactioncurrency` exposes `currencyprecision`, not `precision`. Luna corrected
source projections, staff-active checks and the currency DTO mapping. Unknown or
disabled staff still fail closed. Raw-shape adapter and preview regressions were
added. Sol and the orchestrator reviewed; bounded OAuth-only Opus review approved.

## Evidence and remaining work

- Ranking/Explorer regression: 10 suites / 110 tests pass; changed-file ESLint and
  type check pass. Relevant DAL/OData/context gates and self-tests pass.
- Canonical production build passed again after the two source-field corrections.
  Existing document-renderer tracing warnings remain. Documentation gates passed.
- GitHub full Jest: 1 failed, 1285 passed, 12 skipped suites. Failure is
  `recording-and-transcript-card.test.js`, “a published summary opens from its
  existing material descriptor”, expecting “Available to staff and eligible for
  the Board link”. Isolated reproduction fails; both test and component have no
  diff against current main. Not changed as part of ranking. PR is not all-green.
- Relevance-search exclusion, ordinary-staff direct-table denial and audit/navigation
  live probes are still unverified. Advanced Find=true / IsPrivate=false are metadata
  observations, not proof of search enrollment or row permission.
- Local loaded environment has isolation/ranking switches off; no facilitator setting
  row exists. App grants, verified Beth identity and two-user browser sessions remain.
- Owner was asked whether to prepare a small sandbox-only eligible proposal set or
  supply a sandbox cycle. No fixture data was created. Marked test requests remain
  excluded by the production eligibility contract.
- Production promotion remains a separate deliberate owner decision.

## Scoped durable-fact reconciliation

Mode A: sandbox provisioning changed from unperformed to verified partial setup.
Authority: executed schema/role tools and GET-only readback below. Current Atlas,
design, API contract and session handoff were updated. Earlier design/implementation
review receipts remain explicitly historical. Runtime registry/catalog/security
matrix descriptions agree with the implementation; no memory restatement was found.
Unknowns above remain open; this receipt does not assert runtime readiness.

## Sanitized sandbox readback

```json
{
  "target": "orgd9e66399.crm.dynamics.com",
  "writesPerformed": false,
  "identityAndRole": {
    "available": true,
    "systemUserId": "79913eac-7f3e-f111-88b4-6045bd015cb0",
    "status": 200,
    "proposalRankingRoleAssigned": true
  },
  "schema": [
    {
      "name": "wmkf_proposalrankingcycle",
      "exists": true,
      "status": 200,
      "identityMatches": true,
      "entitySetName": "wmkf_proposalrankingcycles",
      "primaryIdAttribute": "wmkf_proposalrankingcycleid",
      "primaryNameAttribute": "wmkf_name",
      "ownershipOrganization": true,
      "advancedFindValid": true,
      "privateEntity": false,
      "relevanceSearchExclusion": "not verified by entity metadata",
      "attributes": true,
      "attributesStatus": 200,
      "attributeFailures": [],
      "keys": true,
      "keysStatus": 200,
      "keyStatuses": [
        {
          "name": "wmkf_proposalrankingcycle_cyclecode",
          "status": "Active"
        }
      ]
    },
    {
      "name": "wmkf_proposalrankinground",
      "exists": true,
      "status": 200,
      "identityMatches": true,
      "entitySetName": "wmkf_proposalrankingrounds",
      "primaryIdAttribute": "wmkf_proposalrankingroundid",
      "primaryNameAttribute": "wmkf_name",
      "ownershipOrganization": true,
      "advancedFindValid": true,
      "privateEntity": false,
      "relevanceSearchExclusion": "not verified by entity metadata",
      "attributes": true,
      "attributesStatus": 200,
      "attributeFailures": [],
      "keys": true,
      "keysStatus": 200,
      "keyStatuses": [
        {
          "name": "wmkf_proposalrankinground_creationoperation",
          "status": "Active"
        }
      ]
    },
    {
      "name": "wmkf_proposalrankinglist",
      "exists": true,
      "status": 200,
      "identityMatches": true,
      "entitySetName": "wmkf_proposalrankinglists",
      "primaryIdAttribute": "wmkf_proposalrankinglistid",
      "primaryNameAttribute": "wmkf_name",
      "ownershipOrganization": true,
      "advancedFindValid": true,
      "privateEntity": false,
      "relevanceSearchExclusion": "not verified by entity metadata",
      "attributes": true,
      "attributesStatus": 200,
      "attributeFailures": [],
      "keys": true,
      "keysStatus": 200,
      "keyStatuses": [
        {
          "name": "wmkf_proposalrankinglist_round_listkey",
          "status": "Active"
        }
      ]
    }
  ],
  "isolation": {
    "requestMarkers": {
      "available": true,
      "complete": true,
      "status": 200,
      "fields": [
        "wmkf_istestrequest",
        "wmkf_testcreationrunid"
      ]
    },
    "syntheticReviewerMarker": {
      "available": true,
      "complete": true,
      "status": 200,
      "fields": [
        "wmkf_issyntheticreviewer"
      ]
    },
    "switches": {
      "testRequestIsolationEnabled": false,
      "syntheticReviewerIsolationEnabled": false,
      "proposalRankingSchemaReady": false,
      "proposalRankingEnabled": false
    }
  },
  "defaultFacilitatorSetting": {
    "available": true,
    "status": 200,
    "rowPresent": false,
    "valueValidGuid": false
  },
  "source": {
    "selects": {
      "akoya_requests": {
        "available": true,
        "status": 200
      },
      "wmkf_appreviewersuggestions": {
        "available": true,
        "status": 200
      },
      "wmkf_potentialreviewerses": {
        "available": true,
        "status": 200
      },
      "systemusers": {
        "available": true,
        "status": 200
      },
      "transactioncurrencies": {
        "available": true,
        "status": 200
      }
    },
    "requestScan": {
      "available": true,
      "status": 200,
      "capped": false,
      "eligibleOrdinaryPhaseIIPendingCount": 0,
      "missingJuneDecemberDateCount": 0
    },
    "activeSystemUserCount": 223,
    "cycles": {}
  }
}
```

## Bounded Opus correction review — verbatim

Authentication checked outside the sandbox: `claude.ai` subscription OAuth. Agent
API-key environment variables were removed. Read-only tools, no Fable. Reviewer
assessed source only and did not execute tests or probe live services.

**Verdict: APPROVE.** These corrections don't introduce or expose any material defect.

This is a read-only review: I didn't edit files or run commands, so I haven't run the tests myself. It doesn't cover script provisioning or completing the live rehearsal.

**Security fail-closed behavior (systemuser)**
- `proposal-ranking-source.js:30` now selects only `systemuserid,fullname,isdisabled`. The staff directory filter is `isdisabled eq false` (`:155`), and nothing in scope still references `statecode` on systemuser. The `statecode` in `REVIEWER_SELECT` (`:29`) is on `wmkf_potentialreviewerses`, so it's correct to leave it.
- Every check that decides whether someone is active requires `isdisabled` to be exactly `false`, so `null`, `undefined`, `true` or a missing record all count as not active:
  - Lead roster check: `preview-service.js:57`
  - Single-record read: `proposal-ranking-source.js:168`
  - Directory mapping: `proposal-ranking-source.js:161`
- The callers of `readEnabledProposalRankingStaff` check for a falsy result and fail closed:
  - Facilitator transfer: `service.js:835-836`
  - Admin settings save (`PUT`): `service.js:989-990`
  - Preview facilitator check: `preview-service.js:81`
- The function's return shape is unchanged: `{ systemUserId, name, enabled }` or `null`.
- The admin `GET` list (`service.js:973-983`) relies on the server-side filter and doesn't recheck `enabled`. That doesn't open a gap, because saving re-validates through `readEnabledProposalRankingStaff`.

**Budget precision mapping**
- The adapter queries `currencyprecision` (`:115`) and maps it to `precision` in the DTO (`:142`). `preview-service.js` and `shared/components/proposal-ranking/model.js` both read `currency.precision`, so they need no changes.
- `moneyToMinorUnits` (`calculations.js:105`) and the client formatter (`model.js:42`) both require an integer precision. A missing field becomes `NaN`, which blocks opening and shows the "Incomplete" display.

**Caller contracts**
- The preview DTO shape, the snapshot shape and the fingerprint inputs are all unchanged apart from `isdisabled` now being the only user state field.
- The tests check that the select strings match the verified live field names, that no query selects `statecode`, and that `isdisabled: null` fails closed in both the adapter and the preview.

**Non-blocking note (not a defect introduced here):** `Number(currency.currencyprecision)` turns a `null` value into `0`, and `0` passes the integer checks. If a currency row ever had a null precision, whole-dollar amounts would be accepted at precision 0, while amounts with cents would still be blocked. `currencyprecision` is a required field on transactioncurrency, and the earlier `Number(...)` code had the same pattern, so I'm not treating this as material. If you want to harden it, store `null` instead of `0` when the field is null.
