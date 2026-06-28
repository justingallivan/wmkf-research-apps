# Corrected Audit Findings For Claude Review

Date: 2026-05-26

> **RESOLUTION STATUS (verified 2026-06-28):** Both actionable findings are **RESOLVED**
> in current code — F-001 (`getEntityRelationships` now calls `checkRestriction`) and
> F-002 (module-level restriction globals + deprecated shims removed; 0 callers;
> `checkRestriction` fails closed when no AsyncLocalStorage context). The "Deferred
> Cleanup: drain tables" section is **SUPERSEDED** — those 5 tables were dropped early
> via migration `018_drop_reviewer_finder_postgres_tables.sql` (backup `scripts/w6-drop-backup.js`).
> Only the "Generic Write Helper Restriction Policy" owner-decision remains open. This
> doc is retained as a historical record; per-section status lines below are stamped.

Purpose: this document distills the useful findings from the third-party audit cycle into a corrected, evidence-bounded review packet for Claude. It intentionally omits retracted findings and avoids destructive recommendations that are not yet due.

## Summary

The third-party audit produced two findings that remain worth acting on:

1. `DynamicsService.getEntityRelationships()` does not call `checkRestriction(tableName)`, unlike nearby metadata/read methods.
2. The migration from module-level Dynamics restriction state to `AsyncLocalStorage` remains incomplete because legacy fallback state and deprecated shims still exist.

Two areas should **not** be treated as ready-to-act findings:

1. Whether generic Dataverse write helpers (`createRecord`, `updateRecord`, `deleteRecord`) should call `checkRestriction()` directly remains an owner/design decision. The repo proves Track A write routes must enforce table+field restrictions before writes; it does not conclusively prove a universal write-helper policy.
2. Reviewer-domain Postgres drain-table drops are not yet due. The documented trigger is on or after 2026-07-01, with required probes, backup, restore script, docs updates, and gates.

## F-001: `getEntityRelationships()` Missing Restriction Check

Severity: P2

Status: **RESOLVED (verified 2026-06-28)** — `lib/services/dynamics-service.js:379`
`getEntityRelationships(tableName)` calls `this.checkRestriction(tableName)` as its first
statement, matching `getEntityAttributes`. (No dedicated regression gate was added; the
fix is in source. Original finding below for history.)

Category: Security / Metadata Exposure / Dynamics Restrictions

### Evidence

- `lib/services/dynamics-service.js` has `getEntityAttributes(tableName)` calling `this.checkRestriction(tableName)` before fetching metadata.
- `lib/services/dynamics-service.js` has `getEntityRelationships(tableName)` fetching relationship metadata without a corresponding `checkRestriction(tableName)` call.
- `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` already identifies this as a metadata-leak gap: `getEntityRelationships()` exposes lookup targets and, unlike `getEntityAttributes()`, does not call `checkRestriction`.

### Risk

Relationship metadata can reveal navigation paths and related restricted table names. Even if it does not return row data, it can expose schema information that should be covered by the same table-level restrictions as attribute discovery.

### Recommended Fix

Add `this.checkRestriction(tableName);` at the start of `DynamicsService.getEntityRelationships(tableName)`, matching the pattern used by `getEntityAttributes(tableName)`.

Suggested implementation shape:

```js
static async getEntityRelationships(tableName) {
  this.checkRestriction(tableName);

  const now = Date.now();
  // existing logic...
}
```

### Validation

- Add or update a unit test proving `getEntityRelationships('restricted_table')` throws when that table is restricted.
- Add or update a positive test proving the method still returns relationships for an unrestricted table.
- Run the relevant Dynamics service tests.
- Consider a narrow mechanical gate that checks `getEntityRelationships` contains `this.checkRestriction(tableName)` before outbound metadata fetches.

## F-002: Dynamics Restriction ALS Migration Is Incomplete

Severity: P2

Status: **RESOLVED (verified 2026-06-28)** — in `lib/services/dynamics-service.js`:
module-level `activeRestrictions` / `_restrictionRequestId` are gone, the
`setRestrictions()` / `bypassRestrictions()` shims are gone, `rg` finds **0** direct
callers across `scripts tests lib pages`, and `checkRestriction()` now **fails closed**
(throws "Restrictions not initialized" when `getDynamicsContext()` is absent — fix step 6).
The AsyncLocalStorage migration is complete. Original finding below for history.

Category: Concurrency / Security Hygiene / Migration Completion

### Evidence

- `lib/services/dynamics-context.js` documents the desired request-scoped `AsyncLocalStorage` model and says it replaces module-level `activeRestrictions` / `_restrictionRequestId`.
- `lib/services/dynamics-service.js` still defines module-level `activeRestrictions` and `_restrictionRequestId`.
- `DynamicsService.checkRestriction()` prefers `getDynamicsContext()` but still falls back to the module-level globals.
- `DynamicsService.setRestrictions()` and `DynamicsService.bypassRestrictions()` still exist as deprecated shims.
- Remaining deprecated direct callers are concentrated in scripts, with a small number of test mocks/comments. Exact counts should be regenerated before implementation with:

```bash
rg -n "DynamicsService\\.bypassRestrictions|DynamicsService\\.setRestrictions" scripts tests lib pages
```

### Risk

Module-level request/security state is unsafe under reused function instances and concurrent request handling. The intended `AsyncLocalStorage` isolation is already present, but the fallback preserves the old state-leak class of bug until all callers migrate and the globals are removed.

### Recommended Fix

1. Inventory direct callers of `DynamicsService.bypassRestrictions()` and `DynamicsService.setRestrictions()`.
2. Migrate live/app/service callers to `bypassDynamicsRestrictions()` or `withDynamicsContext()` from `lib/services/dynamics-context.js`.
3. Migrate or update script callers where practical. If some ad-hoc scripts are intentionally left for later, document that explicitly and do not remove the shim until they are migrated.
4. Update test mocks to mock `dynamics-context.js` instead of deprecated `DynamicsService` shims where appropriate.
5. Remove `activeRestrictions`, `_restrictionRequestId`, `setRestrictions()`, and `bypassRestrictions()` from `dynamics-service.js`.
6. Change `checkRestriction()` so a missing `getDynamicsContext()` fails closed.

### Validation

- `rg -n "DynamicsService\\.bypassRestrictions|DynamicsService\\.setRestrictions" scripts tests lib pages` returns zero direct callers, or only explicitly documented temporary exceptions.
- `rg -n "activeRestrictions|_restrictionRequestId" lib/services/dynamics-service.js` returns zero.
- Unit tests for `dynamics-context.js` continue to pass.
- Dynamics Explorer tests prove restricted and unrestricted query paths still work.
- Trusted service paths that need unrestricted Dynamics access explicitly run inside `bypassDynamicsRestrictions(...)`.

## Owner Decision: Generic Write Helper Restriction Policy

Status: Needs owner

The third-party audit originally recommended adding `checkRestriction()` directly to `DynamicsService.updateRecord()`. That recommendation was too narrow and potentially wrong if applied mechanically.

Current evidence:

- Generic write helpers such as `createRecord()`, `updateRecord()`, and `deleteRecord()` do not call `checkRestriction()`.
- Read helpers generally resolve entity set names to logical names before checking restrictions.
- `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` says Track A write endpoints must explicitly enforce table+field restrictions before calling `updateRecord()`.
- That Track A guidance does not, by itself, prove the universal policy for all generic write helpers.

Questions for Claude / owner review:

1. Are Dynamics restrictions intended to protect only user-facing query/metadata tools, or all generic `DynamicsService` methods?
2. Should write helpers enforce restrictions internally, or should route-specific write endpoints enforce table+field policy before calling trusted service helpers?
3. If write helpers enforce restrictions internally, which trusted paths need explicit `bypassDynamicsRestrictions()` wrappers?
4. Should write-helper restriction checks use logical table names via `resolveLogicalName(entitySet)`?
5. What regression tests are required before changing this behavior?

Recommendation: do **not** patch `updateRecord()` alone. First decide the policy, then implement consistently across write helpers and trusted bypass paths.

## Deferred Cleanup: Reviewer-Domain Postgres Drain Tables

Status: **SUPERSEDED / DONE (verified 2026-06-28)** — the 5 drain tables were dropped
early via migration `018_drop_reviewer_finder_postgres_tables.sql` (rows backed up to
local JSONL + Vercel Blob by `scripts/w6-drop-backup.js` before the drop). The deferral
guidance below is historical.

Do not perform drain-table drops as part of the immediate audit fix.

Current evidence:

- `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` says the W6-step-2 drain-only table drop should fire on or after 2026-07-01.
- The checklist requires:
  1. Staleness probe over the drain-only tables.
  2. One-shot `DELETE ... RETURNING *` per table piped to JSONL.
  3. Upload of backup JSONL files to Vercel Blob under `cleanup-backup/YYYY-MM-DD/<table>.jsonl`.
  4. A restore script, `scripts/restore-postgres-drain-table-backup.js`, written before real-mode cleanup.
  5. `DROP TABLE` in dependency order.
  6. Atlas/plan documentation updates.
  7. `npm run check:atlas` and `npm run check:api-routes`.

Recommendation: keep this as a scheduled post-pilot task. Do not treat it as ready until the date gate and checklist are satisfied.

## Suggested Mechanical Gates

These are targeted gates that would help prevent recurrence without broad false positives.

| Gate | Detects | False-positive risk | Suggested self-test |
|---|---|---|---|
| Deprecated Dynamics restriction shims | Direct `DynamicsService.bypassRestrictions()` / `DynamicsService.setRestrictions()` callers outside an explicit allowlist | Low | Fixture with a script or lib file using the deprecated shim should fail; fixture using `bypassDynamicsRestrictions()` should pass |
| Relationship metadata restriction | `getEntityRelationships()` missing `this.checkRestriction(tableName)` before outbound fetches | Low | Fixture dynamics-service snippet missing the call should fail; snippet with the call should pass |
| API route guard warnings | `check:api-routes` warnings for routes without recognized guard tokens unless explicitly allowlisted as HMAC/webhook/public metadata | Medium | Fixture route without guard should fail; fixture HMAC webhook with allowlist annotation should pass |
| Audit doc cross-reference consistency | Action plan references to `F-###` IDs that do not exist as findings | Low | Fixture markdown with dangling `F-999` should fail |

## Recommended Immediate Sequence

1. Fix F-001 with a small code change and targeted test.
2. Create a small migration plan for F-002 that separates live app/service callers from ad-hoc scripts.
3. Ask Claude/owner to decide the write-helper restriction policy before touching `createRecord()`, `updateRecord()`, or `deleteRecord()`.
4. Leave the reviewer-domain Postgres drain-table drop deferred until the documented post-pilot checklist is due.
