# Codex Review Of Claude Audit Fixes

Date: 2026-05-26

Reviewer: Codex

Target commit reviewed: `f841013` (`Ship F-001 + F-002 from 2026-05-26 audit`)

Spec reviewed against: `docs/archive/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md`

## Context

Claude implemented the corrected audit findings from `docs/archive/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md`.

The spec asked for:

1. **F-001:** Add restriction parity to `DynamicsService.getEntityRelationships(tableName)` by calling `this.checkRestriction(tableName)`.
2. **F-002:** Complete the Dynamics restriction migration from module-level state to `AsyncLocalStorage`, removing `activeRestrictions`, `_restrictionRequestId`, and the deprecated `DynamicsService.setRestrictions()` / `DynamicsService.bypassRestrictions()` shims.
3. Preserve the owner-decision boundary around generic Dataverse write helpers (`createRecord`, `updateRecord`, `deleteRecord`): do not patch those directly without a broader policy decision.
4. Leave reviewer-domain Postgres drain-table drops deferred until the documented post-pilot date/checklist.

## What Codex Checked

Codex reviewed the current codebase and the `f841013` diff. I specifically checked:

- `lib/services/dynamics-service.js`
- `lib/services/dynamics-context.js`
- `tests/unit/dynamics-service-restrictions.test.js`
- migrated scripts that previously called `DynamicsService.bypassRestrictions()`
- changed integration test mocks
- live API/service call sites that invoke `DynamicsService.queryRecords()`, `getRecord()`, `queryAllRecords()`, etc.
- whether deprecated direct callers remain
- whether generic write helpers were left untouched
- whether drain-table cleanup was accidentally triggered

## Commands Run

```bash
git show --stat --oneline f841013
git show --name-only --format=short f841013
rg -n "DynamicsService\\.bypassRestrictions|DynamicsService\\.setRestrictions" scripts tests lib pages -g '!node_modules'
rg -n "enterDynamicsBypassForScript" pages lib -g '!node_modules'
rg -n "DynamicsService\\.(queryRecords|getRecord|countRecords|aggregateRecords|queryAllRecords|searchRecords|getEntityAttributes|getEntityRelationships)" pages lib shared -g '!node_modules'
npm test -- --runTestsByPath tests/unit/dynamics-service-restrictions.test.js tests/unit/dynamics-context.test.js tests/unit/dynamics-service-caller-id.test.js
npm test -- --runTestsByPath tests/integration/auth-routes.test.js tests/integration/cross-user-isolation.test.js
npm run check:api-routes
npm run check:atlas
npm run check:fact-consistency
```

## Passing Checks

These passed:

```bash
npm test -- --runTestsByPath tests/unit/dynamics-service-restrictions.test.js tests/unit/dynamics-context.test.js tests/unit/dynamics-service-caller-id.test.js
npm test -- --runTestsByPath tests/integration/auth-routes.test.js tests/integration/cross-user-isolation.test.js
npm run check:api-routes
npm run check:atlas
npm run check:fact-consistency
```

Notes:

- `check:api-routes` still prints its known warning for `/api/webhooks/bill`, which uses HMAC rather than a recognized NextAuth-style guard token.
- The targeted integration tests pass, but they do not cover the new fail-closed context behavior for all live trusted Dynamics readers.

## What Looks Correct

### F-001 Is Fixed

`DynamicsService.getEntityRelationships(tableName)` now calls `this.checkRestriction(tableName)` before fetching relationship metadata.

Evidence:

- `lib/services/dynamics-service.js`: `getEntityAttributes(tableName)` calls `this.checkRestriction(tableName)`.
- `lib/services/dynamics-service.js`: `getEntityRelationships(tableName)` now also calls `this.checkRestriction(tableName)`.
- `tests/unit/dynamics-service-restrictions.test.js` adds coverage for:
  - restricted table throw
  - fail-closed outside any ALS context
  - parity with `getEntityAttributes`
  - positive mocked-Dataverse return path under bypass context

### F-002 Is Partially Correct

Good changes:

- Removed module-level `activeRestrictions` and `_restrictionRequestId`.
- Removed deprecated static shims `DynamicsService.setRestrictions()` and `DynamicsService.bypassRestrictions()`.
- `checkRestriction()` now reads only from `getDynamicsContext()` and fails closed when no context is present.
- Migrated direct script callers from `DynamicsService.bypassRestrictions(label)` to `enterDynamicsBypassForScript(label)`.
- No direct `DynamicsService.bypassRestrictions()` / `DynamicsService.setRestrictions()` callers remain in `scripts`, `tests`, `lib`, or `pages`.
- `enterDynamicsBypassForScript()` is documented as script-only and is not imported from `pages/` or `lib/`.

### Owner-Decision Boundary Was Preserved

Generic write helpers were not patched to call `checkRestriction()` directly.

Evidence:

- `createRecord()`, `updateRecord()`, and `deleteRecord()` still do not call `checkRestriction()`.
- This matches the corrected spec: do not patch write helpers until the owner decides the generic write-helper restriction policy.

### Drain-Table Cleanup Was Not Triggered

No immediate reviewer-domain Postgres drain-table drop was introduced.

## Findings

### P1: Applicant Intake Routes Now Lack A Dynamics Context For Identity/Membership Reads

`DynamicsService.checkRestriction()` now fails closed whenever no ALS context exists. That is correct for F-002, but several trusted applicant-intake paths call Dataverse-reading services without establishing a context.

Affected flow:

- `/api/intake/draft`
- `/api/intake/submit`
- `/api/intake/draft/upload-token`
- `/api/intake/draft/attach`

Examples:

- `pages/api/intake/draft.js` calls `resolveContactForSession(...)`.
- `pages/api/intake/draft.js` then calls `hasLiveMembership(...)`.
- `pages/api/intake/submit.js` calls `hasSubmitterRole(...)`.
- `pages/api/intake/draft/upload-token.js` and `pages/api/intake/draft/attach.js` call the same bridge/membership helpers in non-direct-owner branches.
- `lib/services/contact-bridge-service.js` calls `DynamicsService.queryRecords('contacts', ...)`.
- `lib/services/membership-service.js` calls `DynamicsService.queryRecords('wmkf_portalmemberships', ...)`.

Because those routes/services do not wrap these trusted reads in `bypassDynamicsRestrictions()` or `withDynamicsContext()`, they can now hit:

```text
Restrictions not initialized — cannot execute query
```

Resulting behavior:

- Applicant draft/submit/upload/attach flows may return existing 502 identity/membership failure responses even though auth and membership are otherwise valid.

Recommended fix:

Wrap these trusted applicant-intake Dynamics reads in a scoped bypass.

Reasonable implementation options:

1. Wrap route-level trusted identity/membership sections with `bypassDynamicsRestrictions(...)`.
2. Or wrap the service functions themselves, e.g. inside `resolveContactForSession()` and membership-service functions.

Preference:

- Route-level wrappers make the trust boundary more visible.
- Service-level wrappers reduce call-site burden but can hide privileged behavior inside broadly named helpers.

Either way, avoid `enterDynamicsBypassForScript()` here. It is explicitly script-only.

### P2: Staff Identity Reconciliation Now Fails Silently On Sign-In

`pages/api/auth/[...nextauth].js` fire-and-forget calls:

```js
reconcileProfile(profileId, { silent: true }).catch(() => {});
```

`reconcileProfile()` calls:

```js
DynamicsService.queryRecords('systemusers', ...)
```

without establishing a Dynamics context.

Since `silent: true`, the new fail-closed error is swallowed into an `ERROR` result instead of linking `user_profiles.dynamics_systemuser_id`.

Impact:

- Staff sign-in no longer performs the intended opportunistic Dynamics identity link.
- The cron/manual reconciliation routes may still work because the cron/admin API wrappers call `bypassDynamicsRestrictions()` around `reconcileBatch()`, but the sign-in fire-and-forget path does not.

Recommended fix:

Wrap the sign-in fire-and-forget reconciliation call:

```js
bypassDynamicsRestrictions('staff-signin-reconcile', () =>
  reconcileProfile(profileId, { silent: true })
).catch(() => {});
```

or wrap the Dynamics read inside `reconcileProfile()` if that service is intended to always be trusted.

### P2: Intake Drain Duplicate-PK Recovery Path Now Lacks A Context

In `pages/api/cron/drain-submissions.js`, the duplicate-PK recovery path calls:

```js
DynamicsService.getRecord('akoya_requests', job.request_id, { select: 'akoya_requestnum' })
```

without a Dynamics context.

This path is only used after a prior tick created the Dataverse row but crashed before advancing Postgres state. With strict fail-closed context, recovery now records a failure instead of reading back `akoya_requestnum`.

Recommended fix:

Wrap the recovery read in `bypassDynamicsRestrictions(...)`, or wrap the relevant cron handler work section if all Dynamics operations in that cron are trusted.

Note:

- `createRecord()` calls in this route are write helpers and still work because write-helper policy was intentionally left unchanged.
- The regression is specific to the read-based recovery path.

## Suggested Follow-Up Verification

After patching the missing trusted contexts, run:

```bash
npm test -- --runTestsByPath tests/unit/dynamics-service-restrictions.test.js tests/unit/dynamics-context.test.js tests/unit/dynamics-service-caller-id.test.js
npm test -- --runTestsByPath tests/integration/auth-routes.test.js tests/integration/cross-user-isolation.test.js
npm run check:api-routes
npm run check:atlas
npm run check:fact-consistency
```

Add targeted tests if practical:

1. Applicant intake draft/submit route tests where membership-service is not fully mocked, or a unit test that proves the route wraps bridge/membership reads in `bypassDynamicsRestrictions()`.
2. A `reconcileProfile()` test proving it succeeds under an explicit bypass and that the sign-in caller establishes one.
3. A drain duplicate-PK recovery test proving the `getRecord()` recovery read runs inside a Dynamics context.

## Bottom Line

Claude correctly fixed F-001 and removed the old module-level restriction state. The main issue is that the stricter fail-closed behavior exposed trusted Dynamics read paths that were not migrated to an explicit ALS context.

Please patch the missing trusted contexts before considering F-002 complete.
