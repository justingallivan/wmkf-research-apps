# B4 owner actions — 2026-09-30

**Release remains blocked; PR #369 remains draft.** Local/B4 Preview/Production switch configuration and marker availability passed. This packet supplies the remaining owner procedures; it does not authorize a migration, Dataverse write or slot PATCH. The owner cannot access the other Mac until approximately nine hours after the chat decision.

## Recover the existing journal

On the other Mac, inspect the existing Docker installation without recreating containers or databases:

```bash
docker context ls
docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}'
docker volume ls
```

If the known `wmkf-ledger-pg` container is already running, list its database names:

```bash
docker exec wmkf-ledger-pg psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname"
```

If `ledger_prod` exists, run the committed read-only query against it. Repeat for `ledger` only after identifying it as the intended operational sandbox ledger:

```bash
docker exec -i wmkf-ledger-pg psql -X -U postgres -d ledger_prod \
  -v ON_ERROR_STOP=1 \
  < docs/plans/evidence/test-request-factory/b4-schema-preflight.sql
```

Use the query from this B4 branch's named commit; preserve database name, source commit, UTC time and schema output. If the migration tracker exists, separately read the tracker query at the end of the SQL file. Schema presence alone does not establish ownership history: the journal must contain the existing clone/cast/binding records. Do not paste cast addresses or record IDs into release evidence. If the database is absent there too, locate a backup before proposing restoration; an empty replacement does not establish ownership of existing Dataverse objects.

This Mac's Docker inventory found one Colima profile, one Postgres container and one volume. Its `ledger_prod` is absent and its `ledger` is an early two-table shape. No recovery, migration or database creation was attempted. The CLI-phase local storage choice and later shared-storage intent are in the production plan; moving storage remains a separate decision requiring preservation of journal history.

## Schema preflight and owner apply

The read-only [schema query](b4-schema-preflight.sql) reports all `test_request_*` columns, constraints, indexes and installed receipt-function definitions. Run it on the intended shared Production target and return sanitized schema/tracker output. Do not infer shared state from local state.

For each recovered local operational ledger, follow §6 of the [B4 plan](../../TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md): preflight/classify shape → explicit owner-run single-transaction 058 apply → record source SHA, migration SHA-256, database, UTC and post-apply shape. Stop for incompatible shape. Extend a tracker only when it already contains its historical rows. Never run the all-migrations runner on the local ledgers. Shared Production application remains owner-run through the existing-database versioned process; shared 058 is not a B4 runtime prerequisite.

058 SHA-256: `b90730eccebbba2d779cd6ce80b66874fb375307395f83494a6165459e4847b4`. No migration was applied by this session.

## Automation disposition worksheet

[VERIFIED via the committed section 13 receipt](reviewer-slot-readiness-receipt-2026-09-30T16-20-11-291Z.json) The six open items below are real probe results. No owner classification is recorded. Effective Process read was Global at the dated probe; all 14 activated flow definitions were readable, with no hard incomplete reasons.

| Item | Observed trigger / scope | Evidence the owner still needs | Disposition |
|---|---|---|---|
| `AkoyaGo.CalculatedFieldsAsync: Update of akoya_request` | Custom Request update step, any column | Actual vendor behavior on a slot update; Request writes and any indirect flow invocation | OPEN |
| `AkoyaGo.RequestPreOperation: Update of akoya_request` | Custom global update step, any entity/column | Applicability to Request, slot effects and downstream automation | OPEN |
| `AkoyaGo.RequestPostOperation: Update of akoya_request` | Custom global update step, any entity/column | Applicability to Request, slot effects and downstream automation | OPEN |
| `GOapply Add Request to Review Group (Deprecated)` | `manual`; `Request` / `ApiConnection`; literal `akoya_requests`; no visible Dataverse subscription | Trigger parameter keys/values, invocation path, absence of subscription, all Request/slot actions and possible indirect invocation | OPEN |
| `Bill.com - Push Payments` | `manual`; `Request` / `ApiConnection`; literal `akoya_requestpayments`; no visible Dataverse subscription | Same manual-trigger evidence, plus any Request/slot effects of payment actions | OPEN |
| `GOapply AutoFill Next Phase (Deprecated)` | `When_a_row_is_added,_modified_or_deleted`; `OpenApiConnectionWebhook`; literal subscription entity `akoya_goapplystatustracking`; message `1` as read | Actual trigger semantics, Request/slot actions, and whether a slot update can reach it indirectly | OPEN |

Each disposition must identify its evidence, reviewer and UTC time, explain direct and indirect effects, and state whether it clears this particular slot operation. A name containing “Deprecated” is not evidence of inactivity. Review every listed custom step, other-column Request workflow/step and all 14 activated flows; the six rows alone are not the full indirect-chain review. Do not interpret numeric message `1` without confirming its actual trigger contract.

Immediately before the eventual first slot PATCH, re-read every activated flow/definition and effective Process visibility; compare the server-read cast email digest with the recovered journal; verify the exact marked Request/run/person and a concrete ETag. A changed/unknown trigger shape, unreadable definition or unresolved owner disposition keeps the operation blocked. No slot PATCH is authorized here.

## Preview and release

The [new switch receipt](b4-environment-switches-enabled-2026-09-30.json) proves configuration and marker reads. The [post-edit Preview deployment](b4-preview-deployment-2026-09-30.json) is Ready at commit `1a86c10da`, and all 12 CI checks passed. Direct deployment-captured value readback remains UNKNOWN: the CLI refuses `env pull --id` on Ready deployments, and the deployment API exposes key names without values. Branch configuration is independently verified on/on; runtime/job behavior was not exercised. Old deployments retain prior settings. Resolve captured-value verification before making a runtime-value claim. Keep PR #369 draft. After all runtime release prerequisites pass, merging remains the owner's explicit Tier 2 decision because main auto-deploys.
