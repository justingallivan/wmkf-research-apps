---
agent_wiki: topic
status: active
last_verified: 2026-07-27
stale_after_days: 60
owner: dynamics-platform
source_files:
  - lib/services/dynamics-service.js
  - lib/services/dynamics/email.js
  - lib/services/dynamics-context.js
  - lib/services/dynamics-odata-validator.js
  - lib/services/dynamics-identity-service.js
  - lib/services/dynamics-explorer-taxonomy.js
  - lib/services/dataverse-app-access-service.js
  - lib/utils/auth.js
  - lib/dataverse/client.js
  - lib/dataverse/schema-apply.js
  - pages/dynamics-explorer.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/
  - docs/DYNAMICS_SCHEMA_ANNOTATION.md
  - docs/DATAVERSE_POWER_TOOLS_DESIGN.md
  - docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md
watch_paths:
  - lib/services/dynamics-service.js
  - lib/services/dynamics/**
  - lib/services/dynamics-context.js
  - lib/services/dynamics-odata-validator.js
  - lib/services/dynamics-identity-service.js
  - lib/services/dynamics-explorer-taxonomy.js
  - lib/services/dataverse-app-access-service.js
  - lib/utils/auth.js
  - lib/dataverse/**
  - pages/dynamics-explorer.js
  - pages/api/dynamics-explorer/**
update_triggers:
  - Dataverse / Dynamics schema, probe, or OData query changes
  - Dynamics Explorer or Power Tools surface changes
  - Dynamics identity reconciliation / impersonation changes
  - Q9 app-access transport or DATAVERSE_DAL_UNIVERSAL posture changes
---

# Dataverse & Dynamics

Use this page before Dynamics/Dataverse work: schema deploys, OData queries,
probes, Dynamics Explorer, Power Tools, identity reconciliation, CRM lifecycle
fields, and sandbox/prod assumptions. The Atlas adjudicates live data state.

## Ground Rules

- Use explicit Dynamics restriction context and preserve fail-closed auth.
  Since Stage 7 (S329): post-auth entry points establish it via
  `lib/dataverse/core/context.js` `withDalContext(scopeLabel, fn)` — a
  DAL-labeled wrapper over the same ALS machinery `[VERIFIED via
  lib/dataverse/core/context.js:46]`; entity WRITES
  (create/update/delete/disassociate/executeChangeset) are fail-closed outside
  a trusted context under `DATAVERSE_DAL_ENFORCEMENT` — explicit `on`/`off`,
  unset = on outside production `[VERIFIED via
  lib/services/dynamics-context.js:124 isDalEnforcementOn + 8
  assertTrustedDalContext call sites across the DynamicsService facade and its
  write-core module — 5 entity-write + 3 email-write (the latter added S330).
  Since S345 (Checkpoint C) the 4 entity mutators
  (createRecord/updateRecord/deleteRecord/disassociate) live in
  lib/services/dynamics/write-core.js; executeChangeset + the 3 email-write
  asserts remain in lib/services/dynamics-service.js. VERIFIED S345. A 9th
  site lives in lib/dataverse/core/changeset.js]`.
  **Prod flipped 2026-07-04 (S330):** `DATAVERSE_DAL_ENFORCEMENT=on` set as an explicit
  Vercel production env var and redeployed (aliased `reviews.wmkeck.org`) — enforcement is
  live in ALL environments; initial runtime-log scan clean.
  **Resolved (Session 330, 2026-07-04):** the email-write helpers
  `createEmailActivity`/`addEmailAttachment`/`sendEmail` in
  `lib/services/dynamics/email.js` call `assertTrustedDalContext` as their first
  statement; `dynamics-service.js` remains the public facade that delegates to them. This matches
  entity-write enforcement (Codex post-impl review,
  2026-07-05, flagged this gap; closed same session per stage log). Stage 8's
  gate still exempts their method names as `non-entity-transport` — that
  exemption is unchanged and intentional (they're guarded at runtime instead
  of by the static gate); see `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`
  stage log Session 330 entry.
- Validate OData before issuing it.
- **Route→Service layout is law (Route→Service consolidation Stage 7,
  2026-07-05):** `pages/api` routes are thin shells and may not import
  `lib/dataverse/adapters/*` or `lib/services/dynamics-service` — business
  logic lives in per-domain `lib/services/<domain>/` services (only the
  services touch adapters/`DynamicsService`). Enforced by
  `check:route-service-boundary` in law mode (no baseline, no ratchet)
  `[VERIFIED via scripts/check-route-service-boundary.js checkLaw + the live
  gate run at census 0, 2026-07-05]`; exempt dirs remain
  `pages/api/dynamics-explorer/` + `pages/api/dataverse-export/`. See
  `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`.
- Entity/table schemas, read/write paths, source-of-truth, and drop status live in the Atlas.
- Existing databases use `node scripts/apply-migrations.js`; `scripts/setup-database.js` is fresh-install-only.

## Durable Memory

- Schema/OData/taxonomy: `project-dataverse-schema-deploy-gotchas`, `project-dataverse-odata-null-filter`, `project-living-taxonomy-principle`.
- CRM users/email/limitations/writeback: `project-dynamics-crm-users`, `project-dynamics-email`, `project-dynamics-crm-limitations`, `project-dynamics-ai-writeback`.
- Identity reconciliation and sandbox state: `project-dynamics-identity-reconciliation`, `project-dynamics-sandbox-state`.
- Explorer and Power Tools: `project-dynamics-explorer-details`, `project-dynamics-explorer-schema-diff`, `project-dynamics-explorer-reuse-power-tools`, `project-dynamics-feedback-admin-shipped`, `project-dataverse-power-tools`.
- Export and lifecycle facts: `dataverse-export-floor-scoping`, `project-akoya-request-pd-fields`, `project-grant-lifecycle-states-confirmed`, `akoya-temporal-axis-encodings`.

## Operating Notes

- **Data-access layer migration is COMPLETE as of Stage 8 (S329): all 9
  stages executed in one session.** `lib/dataverse/core/` (odata / entity-registry
  / errors / changeset / context) + 18 per-entity adapters `[VERIFIED via
  ls lib/dataverse/adapters/ — 18 files]`. `entity-registry.js`
  `entitySet()` throws on any entity-set name outside the Stage-0 census
  (never guess names — the S328 `wmkf_prompts`/`wmkf_aiprompts` 404s are the
  motivating case); `odata.js` owns escape/eq/eqGuid filter builders;
  `core/changeset.js` is the registry-validated batch path. The gate
  (`check:dataverse-access-layer`) is now LAW, not a ratchet — the allowlist
  file was deleted at Stage 8; any raw `DynamicsService` call (direct,
  aliased, via `executeChangeset`, or via exported/source-expression
  indirection) in `pages/`+`lib/`+`shared/`+`modules/` that isn't behind an
  adapter or on the closed `non-entity-transport` method list fails closed,
  including unrecognized method names and `unattributable-use:*` reference
  shapes. Plan + full stage log: `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`.
  See the resolved email-helper note above for the runtime guard layered under
  the static gate exemption.
- **Dataverse target/write interlock: ENFORCED
  (S355 wiring; Production `on` 2026-07-22).** `lib/dataverse/core/interlock.js` + `target-registry.js`
  (tracked hostname registry: prod `wmkf.crm.dynamics.com`, sandbox
  `orgd9e66399.crm.dynamics.com`) implement the deployment×target×op policy
  from `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`; the three hook
  families (dynamics/http.js `fetchWithTimeout`, dataverse/client.js `call()`,
  dataverse-export) call `assertDataverseOperationAllowed` unconditionally
  (merge 8067de3a). `DATAVERSE_TARGET_INTERLOCK=on` is live in `.env.local` +
  Vercel Production/Preview since 2026-07-22. The production flip followed a
  positive warn-mode observation; the post-flip signed-in Workbench smoke
  loaded normally and logged `mode=on` with no denial. A denied
  `[dataverse-interlock]` line in prod logs means env misconfig or an
  unregistered target — investigate, don't extend the registry blindly.
  Set-but-invalid
  flag values fail closed to `on`. Hardened by four Codex adversarial rounds
  (rehearsal grants: GUID-only recordIds, exact-collection creates, `$batch`
  never coverable; denials never reclassified as transient/FetchXml network
  errors). Hazard facts settled by probe:
  `akoyago.crm.dynamics.com` is NOT an org (akoyaGO is the prod org's display
  name); the app registration sees exactly two instances via Global Discovery;
  `.api.crm.dynamics.com` host forms are deliberately unregistered (fail
  closed).
- **Q9 app-access transport is ready for Stage 4 (verified 2026-07-27).**
  Preferences use the 19th DynamicsService adapter, while
  `lib/services/dataverse-app-access-service.js` still uses
  `lib/dataverse/client.js` for `wmkf_appuserappaccesses`. Current Vercel
  Preview and Production project configuration omit
  `DATAVERSE_DAL_UNIVERSAL`, which source defaults to `off`. The owner accepted
  that observability posture and replaced the passive soak with deterministic
  `on`-mode acceptance across the ordinary-user auth lookup, admin
  list/grant/revoke, fresh-profile default grant, and partial-failure UI
  refresh. All 27 focused assertions
  passed; the read-only live inventory found six mapped ordinary users with
  three to five grants each. Current auth behavior is fail-closed but
  retryable: `requireAppAccess` returns 503 on grant-lookup failure and does not
  cache an empty grant set. Admin grant-list failures are also fail-loud, and
  partial writes report only completed identifiers. Stage 2 is satisfied;
  retain the normal authenticated Preview smoke and production log watch when
  Stage 4 is released. See
  `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`.
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
