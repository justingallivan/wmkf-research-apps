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

## Operating Notes

- OData null filters do not behave like SQL.
- The sandbox is not drop-in prod parity.
- Do not rebuild Explorer behavior when the Power Tools surface should be reused.
- Treat any Dataverse/Power Automate/Azure claim as external-platform state; verify before asserting.
- **`wmkf_potentialreviewers.wmkf_name` whitespace is stored, not display-only; the adapter does NOT trim it.** [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:148` (create) and `:284` (update)] both write `wmkf_name = name` raw; only `splitName` (`:35`) trims the derived `wmkf_firstname`/`wmkf_lastname`. No central trim, so each caller's whitespace hygiene leaks to storage. [VERIFIED via Explorer length probe 2026-06-30] a manual-add row stored `wmkf_name = " Test 3 Reviewer "` (leading+trailing pad, len 17) while `wmkf_firstname`="Test"(4)/`wmkf_lastname`="3 Reviewer"(10) were clean; a 14-row sample showed non-uniform `nameLen−(firstLen+lastLen)` deltas (0,1,2,3) incl. double internal spaces and trailing spaces baked into `wmkf_firstname`. [VERIFIED via attribute-metadata probe 2026-06-30] `wmkf_name` is a plain WRITABLE field, NOT computed: `SourceType=0` (0=simple, 1=calculated, 2=rollup), `IsValidForCreate=true`, `IsValidForUpdate=true`, `FormulaDefinition=""`. So writes stick — the padding came from write paths, not a Dynamics recompute. [VERIFIED via grep] the potential-reviewer adapter is the ONLY writer of this field (discovery/save → `upsertByEmail`; no direct `wmkf_name` write to this entity elsewhere), and a full-table dry-run found 4368/4368 rows padded — i.e. the historical write path systematically stored `" first last "` (leading+trailing, plus a double space where a middle slot was empty). NOT re-verified: whether a Power Automate FLOW re-pads on write (metadata can't see flows; the write-stick test was deferred). Render-time defense exists ([VERIFIED] `ContactParser.normalizeDisplayName`, commit 3a359cc5, strips it in emails/UI). [VERIFIED — implemented] the adapter now normalizes `wmkf_name` on every write via `cleanName()` (= `normalizeDisplayName`) in `create`/`upsertByEmail`/`update` (`potential-reviewer.js`), so no NEW padding is stored. CAVEAT: `update`'s no-op guard (`fieldsEqual`, `:331`, trim+lowercase compare) treats a padded-vs-clean name as equal and SKIPS the write, so `update` does NOT self-heal already-padded rows — existing rows need a one-time cleanup that force-writes `wmkf_name` (bypassing the guard), not a plain `update()`.

## Standard Probe

```bash
rg -n "odata|\\$filter|RetrieveMultiple|restrictionContext|impersonat|publisherPrefix" lib/services lib/dataverse pages/api/dynamics-explorer docs
```

Then read `dynamics-service.js` plus the relevant Atlas entity page before
issuing a query or deploying schema.
