# Proposal Ranking Production setup receipt

Date: 2026-10-07 (owner local date). Target: `wmkf.crm.dynamics.com`.
Owner explicitly approved step 1: provision the three ranking tables and assign
its dedicated role to the application identity. No activation, participant grants,
facilitator settings, source writes or ranking business rows were part of this setup.

This is the historical schema/role checkpoint. Later configuration and privacy
results: `docs/audits/PROPOSAL_RANKING_PRODUCTION_ACCESS_PRIVACY_2026-10-07.md`.

## Execution and verification

[VERIFIED via live commands and GET readback] Existing solution
`wmkfResearchReviewAppSuite` was present. The enabled application system user
`53e97fb3-a006-f111-8406-000d3a352682` matched the configured OAuth application ID.
Dry run and execution of `scripts/apply-dataverse-schema.js --target=prod
--wave=32-proposal-ranking` (execution adds `--execute`) completed successfully.
The three entities, every declared field/type/bound/option and all three Active
alternate keys passed independent metadata readback.

Dry run and execution of `scripts/apply-security-role.js --target=prod
--role=proposal-ranking-app --assign=53e97fb3-a006-f111-8406-000d3a352682`
(execution adds `--execute`) succeeded, including solution membership.
Role `a2b0de3d-d1c2-f111-aaaf-002248086b29` has all nine required ranking privileges
at Global depth in the root business unit, one direct assignment to that app user,
and no team assignments. The role also has the nine privileges Dataverse assigns
by default, exactly matching the [Microsoft new-role sample](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/web-api-functions-actions-sample).
The verifier reports these separately and rejects unknown extras; none grants
additional access to the ranking tables. No role privileges were removed.

The target interlock remained on with same-day, purpose-specific write acknowledgements.
Application secrets remained in process and were not copied or logged. Provisioning
is not deployment: branch promotion, runtime flags, participant grants, facilitator
selection, Production staff privacy/search checks and browser rehearsal remain open.
The app stays disabled. D26 still has 23 matching requests (11 SE / 12 MR).

## Review and validation

Luna implemented stronger readback; Sol reviewed scope and exclusive assignment.
Subscription-OAuth Opus identified missing privilege verification; the final probe
now verifies actual privilege IDs, names, depths and business unit, and Sol's team
assignment gap was closed. Initial role comparison correctly surfaced nine platform
defaults; the documented baseline is now explicit. No review loop over minor polish.
Schema regression, syntax, lint and sequential Dataverse/OData gates passed.
The final live probe exited 0 with `inventoryComplete=true`; this inventory does
not claim activation or live meeting readiness. Local logs in `/private/tmp` are
nonportable; the sanitized final report below is the durable receipt.

## Final readback

```json
{
  "target": "wmkf.crm.dynamics.com",
  "writesPerformed": false,
  "selectedProposalFields": [
    "akoya_requestnum",
    "wmkf_meetingdate",
    "_akoya_programid_value"
  ],
  "businessRowsPrinted": false,
  "activationChecked": false,
  "solution": {
    "uniqueName": "wmkfResearchReviewAppSuite",
    "available": true,
    "status": 200,
    "exists": true
  },
  "rankingTables": [
    {
      "logicalName": "wmkf_proposalrankingcycle",
      "available": true,
      "identityMatches": true,
      "attributesMatch": true,
      "attributeFailures": [],
      "attributesStatus": 200,
      "expectedKeysActive": true,
      "keyStatuses": [
        {
          "schemaName": "wmkf_proposalrankingcycle_cyclecode",
          "keyAttributes": [
            "wmkf_cyclecode"
          ],
          "indexStatus": "Active"
        }
      ],
      "keysStatus": 200
    },
    {
      "logicalName": "wmkf_proposalrankinground",
      "available": true,
      "identityMatches": true,
      "attributesMatch": true,
      "attributeFailures": [],
      "attributesStatus": 200,
      "expectedKeysActive": true,
      "keyStatuses": [
        {
          "schemaName": "wmkf_proposalrankinground_creationoperation",
          "keyAttributes": [
            "wmkf_creationoperationid"
          ],
          "indexStatus": "Active"
        }
      ],
      "keysStatus": 200
    },
    {
      "logicalName": "wmkf_proposalrankinglist",
      "available": true,
      "identityMatches": true,
      "attributesMatch": true,
      "attributeFailures": [],
      "attributesStatus": 200,
      "expectedKeysActive": true,
      "keyStatuses": [
        {
          "schemaName": "wmkf_proposalrankinglist_round_listkey",
          "keyAttributes": [
            "wmkf_listkey",
            "wmkf_roundid"
          ],
          "indexStatus": "Active"
        }
      ],
      "keysStatus": 200
    }
  ],
  "applicationRole": {
    "name": "WMKF Proposal Ranking Application User",
    "roleId": "a2b0de3d-d1c2-f111-aaaf-002248086b29",
    "queryStatus": 200,
    "exists": true,
    "rootBusinessUnitVerified": true,
    "rootBusinessUnitId": "c8836c09-cf7a-ee11-8179-00224802aaea",
    "expectedPrivilegeCount": 9,
    "missingExpectedPrivileges": [],
    "retrievePrivilegesStatus": 200,
    "actualPrivilegeCount": 18,
    "privilegeSetMatches": true,
    "allowedPlatformBaselinePrivileges": [
      "prvCreateSharePointData",
      "prvReadPluginAssembly",
      "prvReadPluginType",
      "prvReadSdkMessage",
      "prvReadSdkMessageProcessingStep",
      "prvReadSdkMessageProcessingStepImage",
      "prvReadSharePointData",
      "prvReadSharePointDocument",
      "prvWriteSharePointData"
    ],
    "privilegeMismatches": [],
    "systemUserId": "53e97fb3-a006-f111-8406-000d3a352682",
    "userStatus": 200,
    "appIdMatches": true,
    "enabled": true,
    "assignedToCurrentApplication": true,
    "assignmentStatus": 200,
    "exclusiveAssignmentToApplication": true,
    "exclusiveAssignmentStatus": 200,
    "assignedUserCount": 1,
    "unassignedToTeams": true,
    "teamAssignmentStatus": 200,
    "assignedTeamCount": 0
  },
  "eligibleOrdinaryPhaseIIPendingResearchRequests": {
    "complete": true,
    "status": 200,
    "capped": false,
    "scannedProposalCount": 26,
    "eligibleProposalCount": 24,
    "excludedByD26RequestNumberCutoffCount": 2,
    "byCycle": {
      "D26": {
        "eligibleProposalCount": 23,
        "se": 11,
        "mr": 12
      },
      "J26": {
        "eligibleProposalCount": 1,
        "se": 1,
        "mr": 0
      }
    },
    "unmappedMeetingDateCount": 0
  },
  "inventoryComplete": true
}
```
