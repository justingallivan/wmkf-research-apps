---
agent_wiki: topic
status: active
last_verified: 2026-06-10
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
  - docs/atlas/dataverse-akoya-request.md
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

Use this page before work touching the Dynamics/Dataverse data layer: schema
deploys, OData queries, probes, the Dynamics Explorer, and Power Tools. **The
Atlas remains the source of truth for tables, entity sets, and read/write paths** —
this page routes; the Atlas adjudicates.

## Ground Rules

- Use explicit Dynamics restriction context and preserve fail-closed auth and
  restriction behavior (CLAUDE.md safety invariant). `dynamics-context.js` carries it.
- Validate OData before issuing it: `lib/services/dynamics-odata-validator.js`.
- Live-state for any specific entity (`akoya_request`, etc.) lives in the Atlas and
  its `docs/atlas/` page. Do not restate schema here as fresh truth; cite the Atlas.

## Recurring Hazards

- **OData null filters do not behave like SQL.** Confirm null-filter syntax before
  trusting a query. Memory `project-dataverse-odata-null-filter`.
- **Schema-deploy has gotchas** (publisher prefixes, option-set timing, publish
  steps). Memory `project-dataverse-schema-deploy-gotchas`; expand enums over new
  child tables (memory `feedback-human-legibility-schema-principle`,
  `project-living-taxonomy-principle`).
- **The Dynamics sandbox is NOT drop-in usable** — don't assume parity with prod.
  Memory `project-dynamics-sandbox-state`.
- **OData has row/query limits and AI-field quirks.** Memory
  `project-dynamics-crm-limitations`, `project-dynamics-ai-writeback`.
- **Identity reconciliation / impersonation is subtle** — Dynamics users map to
  contacts in non-obvious ways. Memory `project-dynamics-identity-reconciliation`,
  `project-dynamics-crm-users`.
- **Reuse the Power Tools surface; don't rebuild the Explorer.** Memory
  `project-dynamics-explorer-reuse-power-tools`, `project-dataverse-power-tools`.

## Standard Probe

```bash
rg -n "odata|\\$filter|RetrieveMultiple|restrictionContext|impersonat|publisherPrefix" lib/services lib/dataverse pages/api/dynamics-explorer docs
```

Then read `dynamics-service.js` + the relevant Atlas entity page in full before
issuing a query or deploying schema.
