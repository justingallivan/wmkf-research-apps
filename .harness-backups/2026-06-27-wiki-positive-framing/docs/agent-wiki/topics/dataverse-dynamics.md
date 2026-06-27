---
agent_wiki: topic
status: active
last_verified: 2026-06-13
stale_after_days: 60
owner: dynamics-platform
source_files:
  - lib/services/dynamics-service.js
  - lib/services/dynamics-context.js
  - lib/services/dynamics-odata-validator.js
  - lib/services/dynamics-identity-service.js
  - lib/services/dynamics-explorer-taxonomy.js
  - lib/dataverse/client.js
  - lib/dataverse/schema-apply.js
  - pages/dynamics-explorer.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/
  - docs/DYNAMICS_SCHEMA_ANNOTATION.md
  - docs/DATAVERSE_POWER_TOOLS_DESIGN.md
watch_paths:
  - lib/services/dynamics-service.js
  - lib/services/dynamics-context.js
  - lib/services/dynamics-odata-validator.js
  - lib/services/dynamics-identity-service.js
  - lib/services/dynamics-explorer-taxonomy.js
  - lib/dataverse/**
  - pages/dynamics-explorer.js
  - pages/api/dynamics-explorer/**
update_triggers:
  - Dataverse / Dynamics schema, probe, or OData query changes
  - Dynamics Explorer or Power Tools surface changes
  - Dynamics identity reconciliation / impersonation changes
---

# Dataverse & Dynamics

Use this page before Dynamics/Dataverse work: schema deploys, OData queries,
probes, Dynamics Explorer, Power Tools, identity reconciliation, CRM lifecycle
fields, and sandbox/prod assumptions. The Atlas adjudicates live data state.

## Ground Rules

- Use explicit Dynamics restriction context and preserve fail-closed auth.
- Validate OData before issuing it.
- Entity/table schemas, read/write paths, source-of-truth, and drop status live in the Atlas.
- Existing databases use `node scripts/apply-migrations.js`; `scripts/setup-database.js` is fresh-install-only.

## Durable Memory

- Schema/OData/taxonomy: `project-dataverse-schema-deploy-gotchas`, `project-dataverse-odata-null-filter`, `project-living-taxonomy-principle`.
- CRM users/email/limitations/writeback: `project-dynamics-crm-users`, `project-dynamics-email`, `project-dynamics-crm-limitations`, `project-dynamics-ai-writeback`.
- Identity reconciliation and sandbox state: `project-dynamics-identity-reconciliation`, `project-dynamics-sandbox-state`.
- Explorer and Power Tools: `project-dynamics-explorer-details`, `project-dynamics-explorer-schema-diff`, `project-dynamics-explorer-reuse-power-tools`, `project-dynamics-feedback-admin-shipped`, `project-dataverse-power-tools`.
- Export and lifecycle facts: `dataverse-export-floor-scoping`, `project-akoya-request-pd-fields`, `project-grant-lifecycle-states-confirmed`, `akoya-temporal-axis-encodings`.

## Recurring Hazards

- OData null filters do not behave like SQL.
- The sandbox is not drop-in prod parity.
- Do not rebuild Explorer behavior when the Power Tools surface should be reused.
- Treat any Dataverse/Power Automate/Azure claim as external-platform state; verify before asserting.

## Standard Probe

```bash
rg -n "odata|\\$filter|RetrieveMultiple|restrictionContext|impersonat|publisherPrefix" lib/services lib/dataverse pages/api/dynamics-explorer docs
```

Then read `dynamics-service.js` plus the relevant Atlas entity page before
issuing a query or deploying schema.
