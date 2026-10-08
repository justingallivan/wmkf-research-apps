# Proposal Ranking direct staff privacy check

Date: 2026-10-07. Target: `orgd9e66399.crm.dynamics.com` (sandbox).
Status: VERIFIED for the tested ordinary staff identity and three retained records.
All Dataverse operations in this check were GETs. No data, grants, roles, settings,
activation flags or production state changed.

## Evidence and limits

The application read each exact retained D99 cycle, round and list record with
HTTP 200 and a matching primary ID. The selected staff identity was enabled,
access mode 0, and had no application ID. Under both supported impersonation
headers, `EqualUserId` selected exactly that staff identity and excluded the app.
Each of the three exact record reads then returned HTTP 403 / `0x80040220`.
The staff effective-privilege response contained none of the three table Read
privileges. This combines positive record controls, effective-identity evidence,
and actual access denials; it is not a denial inferred from missing rows.

WhoAmI returned the calling app identity under both headers in this experiment.
That explains the earlier inconclusive probe; it does not establish that the
impersonation headers were ignored. The historical persistence receipt records
that original attempt unchanged.

This is application-token impersonation, not an interactive staff OAuth login.
It proves the tested account cannot read these tables at this sandbox checkpoint;
it does not prove all staff assignments, future role changes, production privacy,
or the authenticated application/browser lifecycle. Administrators remain privileged.
No synthetic source proposals were created to perform this check.

## Reproduction and validation

`scripts/probe-proposal-ranking-staff-privacy.js` is GET-only and pins the registered
sandbox. It reads the original completed persistence receipt, uses its recorded
fixture/staff IDs, verifies app controls and effective identity, and requires actual
403s plus a complete effective-privilege response without the three Read privileges.
Run with the repository application credentials loaded in process and interlock on:

```bash
DATAVERSE_TARGET_INTERLOCK=on node scripts/probe-proposal-ranking-staff-privacy.js --receipt=/private/tmp/proposal-ranking-persistence-rehearsal.json --output=/private/tmp/proposal-ranking-privacy-repro.json
```

The checked-in probe repeated the preferred CallerObjectId proof successfully at
2026-10-07T23:11:19.152Z: all app controls 200, effective identity matched, all three
staff reads 403, and all three effective Read privileges absent. The earlier dual-header
receipt below preserves the additional legacy-header and WhoAmI observations.
The persistence rehearsal script now uses EqualUserId for future staff checks too;
its write mode was not rerun.

Focused safeguard regression: 9 tests passed, including wrong/multiple identities,
non-403 responses and incomplete privilege evidence. Atlas, doc-currency,
doc-symbol-refs and API-route gates plus sequential self-tests passed; docs-catalog
and whitespace checks passed. Existing external-materials route warnings remain.
No app runtime code changed, so a new production build was not required.

## Authoritative protocol references

- [Microsoft impersonation documentation](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/impersonate-another-user-web-api) documents the supported headers and privilege intersection.
- [EqualUserId](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/equaluserid?view=dataverse-latest) evaluates the querying user's ID.
- [RetrieveUserPrivileges](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/retrieveuserprivileges?view=dataverse-latest) includes privileges inherited through teams. Team depth limits do not affect this absence check.

## Sanitized live receipt

```json
{
  "target": "orgd9e66399.crm.dynamics.com",
  "fixtureIds": {
    "cycle": "80369e36-855a-449c-b62d-7113770ff2a4",
    "round": "aa0920a8-d386-41ae-af3b-b1a2c83986ce",
    "list": "94e848b7-0fad-492d-a00b-c25224e18f49"
  },
  "appBaseline": {
    "whoAmIStatus": 200,
    "whoAmIIsAppUser": true,
    "fixtureRows": {
      "cycle": {
        "status": 200,
        "idMatched": true,
        "code": null
      },
      "round": {
        "status": 200,
        "idMatched": true,
        "code": null
      },
      "list": {
        "status": 200,
        "idMatched": true,
        "code": null
      }
    }
  },
  "staff": {
    "userId": "d57ddb27-c8db-ee11-904d-000d3a310f67",
    "readStatus": 200,
    "identityMatched": true,
    "enabled": true,
    "accessMode": 0,
    "applicationIdPresent": false,
    "entraObjectIdPresent": true,
    "effectivePrivilegeRead": {
      "httpStatus": 200,
      "returned": true,
      "count": 555,
      "customTableReadPrivilegesPresent": {
        "prvReadwmkf_proposalrankingcycle": false,
        "prvReadwmkf_proposalrankinground": false,
        "prvReadwmkf_proposalrankinglist": false
      }
    }
  },
  "impersonation": {
    "MSCRMCallerID": {
      "whoAmIStatus": 200,
      "whoAmIUserIsCandidate": false,
      "whoAmIUserIsApp": true,
      "equalUserIdStatus": 200,
      "candidateAppearsInEqualUserId": true,
      "appAppearsInEqualUserId": false,
      "equalUserIdCount": 1,
      "fixtureRows": {
        "cycle": {
          "status": 403,
          "idMatched": false,
          "code": "0x80040220"
        },
        "round": {
          "status": 403,
          "idMatched": false,
          "code": "0x80040220"
        },
        "list": {
          "status": 403,
          "idMatched": false,
          "code": "0x80040220"
        }
      }
    },
    "CallerObjectId": {
      "whoAmIStatus": 200,
      "whoAmIUserIsCandidate": false,
      "whoAmIUserIsApp": true,
      "equalUserIdStatus": 200,
      "candidateAppearsInEqualUserId": true,
      "appAppearsInEqualUserId": false,
      "equalUserIdCount": 1,
      "fixtureRows": {
        "cycle": {
          "status": 403,
          "idMatched": false,
          "code": "0x80040220"
        },
        "round": {
          "status": 403,
          "idMatched": false,
          "code": "0x80040220"
        },
        "list": {
          "status": 403,
          "idMatched": false,
          "code": "0x80040220"
        }
      }
    }
  }
}
```

## Reconciliation scope

Mode A: the previously unknown selected-staff direct-table denial is now verified.
Producer: GET-only probe. Authority: Dataverse identity/privilege queries and exact
retained-record reads. Consumer: activation checklist. App runtime was unchanged.
Current Atlas, design, API contract, service catalog, route matrix and handoff
reflect the bounded proof. Earlier setup/persistence receipts remain historical.
Browser acceptance and production activation remain open.

## Final review

Luna implemented the GET-only probe; Sol and the orchestrator reviewed the source
and repeat execution receipt. Bounded Claude Opus review used verified `claude.ai`
subscription OAuth outside the sandbox, with agent API-key variables removed and
read-only tools. Verdict: **APPROVE**, no blocking findings. The reviewer noted an
outdated eight-test count; the receipt now correctly records nine passing tests.
No Fable, direct model API or metered review product was used. No production
milestone was shipped; no DEVELOPMENT_LOG entry is required.

The changed-fact search found no remaining live stale privacy claims within the
listed documentation scope. Historical evidence remains visibly historical.
