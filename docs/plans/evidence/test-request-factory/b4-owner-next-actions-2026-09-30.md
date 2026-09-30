# B4 owner actions — 2026-09-30

**Release remains blocked; PR #369 remains draft.** Local switches now read off/off and block literal-on readiness; B4 Preview/Production last read on/on, and dated marker checks passed. This packet supplies the remaining owner procedures; it does not authorize a migration, Dataverse write or slot PATCH. The operational ledgers are confirmed on the home Mac only; every ledger-dependent check is blocked: ledger not on this machine until tomorrow's restore.

## Snapshot/restore the confirmed home-Mac journals

[OWNER-REPORTED, 2026-09-30] The operational databases are wmkf-ledger-pg/ledger_prod and wmkf-ledger-pg/ledger on the home Mac. This Mac's local ledger is stale residue. Do not investigate or apply migrations to that residue as a substitute. The new [restore brief](https://github.com/justingallivan/wmkf-research-apps/blob/124ba673998a4676578fe169d283fbab80ac70f2/docs/plans/briefs/FACTORY_LEDGER_SNAPSHOT_BRIEF_2026-09-30.md) and [portability plan](https://github.com/justingallivan/wmkf-research-apps/blob/124ba673998a4676578fe169d283fbab80ac70f2/docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md) are read-only remote references from PR #374, absent from this branch; follow the owner's restore process tomorrow, compare digests/row counts and preserve journal history before B4 checks.

The separate managed-ledger databases now have 054+058 schema per owner report, but the operational-record restore remains pending. Do not connect through this B4 CLI's expected Neon refusal or change its guard. For local work after restore, use an owner-supplied shell-only TEST_REQUEST_LEDGER_URL override to 127.0.0.1:5433/ledger_prod; never commit URL/password. Owner restored this worktree's shared .env.local symlink; both ledger keys now resolve present, but both Local isolation switches are off. Establish Local literal-on readiness before B4 checks; no shared target changes were made. [Details and second-landing integration obligations](b4-ledger-location-update-2026-09-30.md).

After restore, use the read-only [schema query](b4-schema-preflight.sql) at a named B4 source commit. Record ledger label/database, source/UTC/schema evidence; schema presence alone does not prove journal ownership. For every new Factory run/cast/status line, name its actual ledger beside the run ID.

## Schema preflight and owner apply

The read-only [schema query](b4-schema-preflight.sql) reports all `test_request_*` columns, constraints, indexes and installed receipt-function definitions. Run it on the intended shared Production target and return sanitized schema/tracker output. Do not infer shared state from local state.

For each restored local operational ledger, follow §6 of the [B4 plan](../../TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md): preflight/classify shape → explicit owner-run single-transaction 058 apply → record source SHA, migration SHA-256, database, UTC and post-apply shape. Stop for incompatible shape. Extend a tracker only when it already contains its historical rows. Never run the all-migrations runner on the local ledgers. Shared Production application remains owner-run through the existing-database versioned process; shared 058 is not a B4 runtime prerequisite.

058 SHA-256: `b90730eccebbba2d779cd6ce80b66874fb375307395f83494a6165459e4847b4`. No migration was applied by this session.

## Automation disposition worksheet

[VERIFIED via the committed section 13 receipt](reviewer-slot-readiness-receipt-2026-09-30T19-36-50-888Z.json) The six open items below are real probe results. No owner classification is recorded. Effective Process read was Global at the 19:36 probe; all 14 activated flow definitions were readable, with no hard incomplete reasons. [New metadata evidence](b4-automation-evidence-2026-09-30.md) records literal trigger parameters, nested actions, all six custom registrations and classic-workflow creation paths. The collector snapshot/hash are recorded separately from the clean committed section 13 source.

| Item | Observed trigger / scope | Evidence the owner still needs | Disposition |
|---|---|---|---|
| `AkoyaGo.CalculatedFieldsAsync: Update of akoya_request` | Custom Request update step, any column | Actual vendor behavior on a slot update; Request writes and any indirect flow invocation | OPEN |
| `AkoyaGo.RequestPreOperation: Update of akoya_request` | Custom global update step, any entity/column | Applicability to Request, slot effects and downstream automation | OPEN |
| `AkoyaGo.RequestPostOperation: Update of akoya_request` | Custom global update step, any entity/column | Applicability to Request, slot effects and downstream automation | OPEN |
| `GOapply Add Request to Review Group (Deprecated)` | `manual`; `Request` / `ApiConnection`; literal `akoya_requests`; no visible Dataverse subscription | Collected: dataset=default.cds, table=akoya_requests, visible no-subscription shape and action tree. Still needed: actual callers/invocation routes, downstream effects and possible plug-in invocation | OPEN |
| `Bill.com - Push Payments` | `manual`; `Request` / `ApiConnection`; literal `akoya_requestpayments`; no visible Dataverse subscription | Collected: dataset=default.cds, table=akoya_requestpayments and payment/external-action tree. Still needed: actual callers/invocation routes and indirect effects | OPEN |
| `GOapply AutoFill Next Phase (Deprecated)` | `When_a_row_is_added,_modified_or_deleted`; `OpenApiConnectionWebhook`; literal subscription entity `akoya_goapplystatustracking`; message `1` as read | Collected: message 1 means Create/Added; Request read and CurrentPhase update on status tracking. Still needed: whether slot updates can indirectly create status tracking/reach it | OPEN |

Each disposition must identify its evidence, reviewer and UTC time, explain direct and indirect effects, and state whether it clears this particular slot operation. A name containing “Deprecated” is not evidence of inactivity. Review every listed custom step, other-column Request workflow/step and all 14 activated flows; the six rows alone are not the full indirect-chain review. The new evidence links Microsoft’s confirmed message contract (`1` = Create/Added); that fact does not clear indirect reachability. Actual manual-flow callers and compiled vendor behavior remain UNKNOWN.

Immediately before the eventual first slot PATCH, re-read every activated flow/definition and effective Process visibility; compare the server-read cast email digest with the recovered journal; verify the exact marked Request/run/person and a concrete ETag. A changed/unknown trigger shape, unreadable definition or unresolved owner disposition keeps the operation blocked. No slot PATCH is authorized here.

## Preview and release

The [earlier switch receipt](b4-environment-switches-enabled-2026-09-30.json) records its dated on/on configuration and marker reads. [Current shared-link receipt](b4-shared-env-link-2026-09-30.json) gives Local off/off with both ledger keys present; Local readiness is blocked until literal-on configuration is restored for B4 checks. B4 Preview and Production were not changed by the link restoration. The [post-edit Preview deployment](b4-preview-deployment-2026-09-30.json) is Ready at commit `1a86c10da`, and all 12 CI checks passed. Direct deployment-captured value readback remains UNKNOWN: the CLI refuses `env pull --id` on Ready deployments, and the deployment API exposes key names without values. Branch configuration is independently verified on/on; runtime/job behavior was not exercised. Old deployments retain prior settings. Resolve captured-value verification before making a runtime-value claim. Keep PR #369 draft. After all runtime release prerequisites pass, merging remains the owner's explicit Tier 2 decision because main auto-deploys.
