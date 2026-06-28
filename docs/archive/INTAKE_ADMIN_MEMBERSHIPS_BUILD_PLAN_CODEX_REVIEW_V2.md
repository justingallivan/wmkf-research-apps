# INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN — Codex Review V2 (date: 2026-05-13)

## Prior Findings — Status in V2

| # | Label | Status | V2 Citation | Notes |
|---|---|---|---|---|
| 1 | [HIGH] Approve/reject writes not concurrency-safe (ETag/If-Match) | PARTIALLY ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:62`, `:152`, `:187`, `:202`, `:220` | V2 now requires ETags and maps 412 to 409, and live `updateRecord(..., { ifMatch })` supports this. Remaining gap: V2 response promises a new ETag after PATCH, but live `updateRecord` returns void; see new finding NF-03. |
| 2 | [HIGH] App registry snippet shape mismatch (array, href, categories) | ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:74`, `:80`, `:82`, `:87` | V2 explicitly says the registry is an array and uses `href` plus `categories`, matching the live registry/Layout shape. |
| 3 | [MODERATE] Staff-without-grant page path is not a 403 | ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:127`, `:134`, `:139` | V2 distinguishes page denial UI from API 403 and documents the client-side `RequireAppAccess` behavior. |
| 4 | [MODERATE] Intake audit logging requirement omitted | PARTIALLY ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:19`, `:153`, `:204`, `:227`, `:298` | V2 adds audit logging, but the planned `IntakeAuditService.log(eventType, {...})` call shape does not match the live service contract; see NF-01. |
| 5 | [MODERATE] Rejected re-application contract underspecified | ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:306`, `:310`, `:313`, `:316`, `:320` | V2 adds a cross-slice re-application contract with alternate-key upsert, reset to `requested`, refreshed request metadata, and cleared rejection reason. |
| 6 | [MODERATE] Approver field reuse changes semantics (decided by/at) | ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:35`, `:37`, `:41`, `:42`, `:45`, `:340` | V2 names the pilot semantics as "Decided by / Decided at" and requires downstream PA/reporting to filter by status. |
| 7 | [MODERATE] Impersonation can silently no-op | PARTIALLY ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:151`, `:192`, `:298`, `:346` | V2 fails closed when identity resolution returns null, but it does not account for `DYNAMICS_IMPERSONATION_ENABLED !== 'true'` or the live 403 fallback to service-principal writes; see NF-02. |
| 8 | [LOW] Middleware prefix match too broad | ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:103`, `:106`, `:108`, `:110`, `:296` | V2 uses exact-or-slash prefix matching and adds `/apply/administrator` verification. |
| 9 | [LOW] Applicant-session admin-route is middleware redirect not 403 | ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:127`, `:132`, `:133` | V2 now calls out redirect/401 behavior before the handler runs. |
| 10 | [LOW] Lookup write notation could lead to invalid Dataverse PATCH | ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:66`, `:68`, `:198`, `:222` | V2 says approve/reject lookup writes must use navigation-property `@odata.bind`, with the exact key filled after schema deploy. |
| 11 | [LOW] Build slice table lists CI-gated docs too late | ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:276`, `:280`, `:282`, `:283`, `:284`, `:287` | V2 folds Atlas and API-route matrix gates into the same slices/commits that introduce the underlying schema or route files. |
| 12 | [NIT] Method handling not stated (405) | PARTIALLY ADDRESSED | `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:149`, `:150`, `:189`, `:190` | V2 states 405 method gating, but it also says `requireAppAccess` is the first line, then approve validation says 405 first; see NF-06. |

## New Findings in V2

### NF-01 [NEW ISSUE INTRODUCED] Audit logging call shape does not match `IntakeAuditService.log`

V2 citation: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:153`, `:204`, `:227`, `:298`.

Live contract excerpt:

```js
// lib/services/intake-audit-service.js:32
static async log({
  actorOid = null,
  actorType,
  action,
  targetEntity = null,
  targetId = null,
  payload = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
})
```

What V2 assumes: `IntakeAuditService.log(eventType, { actorAzureId, targetEntity, targetId, payloadDigest, ... })`, and verification refers to a `membership.approve` event_type.

One-sentence fix: call `IntakeAuditService.log({ actorOid: session.user.azureId, actorType: 'staff', action: 'membership.approve', targetEntity: 'wmkf_portal_membership', targetId: id, payload, metadata, ipAddress, userAgent })` and let the service compute `payload_digest`.

### NF-02 [MODERATE] Impersonation fail-closed ignores the env flag and live 403 fallback

V2 citation: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:151`, `:298`, `:346`.

Live contract excerpt:

```js
// lib/services/dataverse-identity-map.js:70
async function resolveProfileToSystemUser(profileId)

// lib/services/dynamics-service.js:166
static _withCallerId(headers, actingUserSystemId)

// lib/services/dynamics-service.js:188
static async _writeFetch(url, init, actingUserSystemId)
```

What V2 assumes: resolving a `systemuserid` is enough to ensure `MSCRMCallerID` fired, and an unmapped profile is the only service-principal attribution risk.

Actual live contract: `_withCallerId` only sets `MSCRMCallerID` when `process.env.DYNAMICS_IMPERSONATION_ENABLED === 'true'`, and `_writeFetch` retries once without `MSCRMCallerID` after a 403.

One-sentence fix: require `DYNAMICS_IMPERSONATION_ENABLED === 'true'` before approve/reject writes and either disable the service-principal 403 fallback for these routes or treat a fallback-attributed write as failure.

### NF-03 [MODERATE] No way to obtain a new ETag after PATCH with current `updateRecord`

V2 citation: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:62`, `:152`, `:181`, `:206`, `:229`.

Live contract excerpt:

```js
// lib/services/dynamics-service.js:800
// Update a record by ID (PATCH). Returns void on success (204).

// lib/services/dynamics-service.js:814
static async updateRecord(entitySet, recordId, data, { ifMatch, actingUserSystemId } = {})
```

What V2 assumes: approve/reject can return `{ etag: <new> }` directly from the PATCH path.

One-sentence fix: either re-fetch the row after `updateRecord` to obtain the new `@odata.etag`, or change `updateRecord` to support `Prefer: return=representation` and return the updated record.

### NF-04 [MODERATE] GET contract mixes `queryAllRecords` with pagination and `$expand`, which the helper does not support

V2 citation: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:157`, `:181`, `:183`, `:282`.

Live contract excerpt:

```js
// lib/services/dynamics-service.js:445
static async queryRecords(entitySet, { select, filter, orderby, top, expand } = {})

// lib/services/dynamics-service.js:616
static async queryAllRecords(entitySet, { select, filter, orderby } = {})
```

What V2 assumes: GET can expose `?top=50&continuationToken=...`, use `queryAllRecords`, and `$expand` contact/account in the same path.

Actual live contract: `queryAllRecords` has no `top`, `continuationToken`, or `expand` option; `queryRecords` supports `top` and `expand` but does not return a continuation token.

One-sentence fix: for pilot scale, use `queryRecords` with `top` and `expand` and remove continuation-token language, or add explicit helper support for continuation tokens plus `$expand`.

### NF-05 [MODERATE] Pending re-application GET shape lacks prior-decision context

V2 citation: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:58`, `:171`, `:173`, `:175`, `:317`, `:329`.

Live contract excerpt: no source method is wrong here; this is an internal plan contract mismatch between the GET read shape and the cross-slice re-application rules.

What V2 assumes: §9 requires pending re-applications to display "Last decision: rejected by X on Y", but the §5 GET response only shows `decidedBy: null`, `decidedAt: null`, `rejectionReason: null` for requested rows, and the fields table does not read `_wmkf_approvedby_value`.

One-sentence fix: add a `priorDecision` or `lastDecision` object to the GET response for `approvalStatus='requested'` rows with non-null `wmkf_approvedat`, and include the needed approved-by/approved-at/rejection-reason read fields.

### NF-06 [LOW] Method-gating order contradicts itself

V2 citation: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:149`, `:150`, `:189`, `:190`.

Live contract excerpt:

```js
// lib/utils/auth.js:245
export async function requireAppAccess(req, res, ...appKeys)
```

What V2 assumes: the common contract says `requireAppAccess` is "the first line", while method gating says unsupported methods return 405 first and approve validations list 405 before 403.

One-sentence fix: state a single order, preferably method gate first (`405` with `Allow`), then `requireAppAccess`, then body/Dataverse work.

### NF-07 [NIT] Staff Azure ID is on `session.user.azureId`, not `session.azureId`

V2 citation: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:204`.

Live contract excerpt:

```js
// pages/api/auth/[...nextauth].js:284
session.user.azureId = token.azureId;

// lib/utils/auth.js:312
return { profileId, session };
```

What V2 assumes: audit logging can read `session.azureId`.

One-sentence fix: use `access.session.user.azureId` after `const access = await requireAppAccess(...)`.

### NF-08 [LOW] Applicant re-application contract uses read-side lookup shadow-field notation

V2 citation: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:314`.

Live contract excerpt:

```js
// lib/services/dynamics-service.js:768
// @param {object} data - Field payload. Lookups use `<nav>@odata.bind`.
```

What V2 assumes: the applicant slice should set `_wmkf_requestedby_value` directly.

One-sentence fix: rewrite rule 3 to use the requested-by navigation-property `@odata.bind` key once slice 0 records the relationship name, keeping `_wmkf_requestedby_value` as read-only projection terminology.

## Live Contract Mismatches

### `lib/services/intake-audit-service.js`

Method signature from source:

```js
static async log({
  actorOid = null,
  actorType,
  action,
  targetEntity = null,
  targetId = null,
  payload = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
})
```

What the plan assumed: `IntakeAuditService.log(eventType, { actorAzureId, targetEntity, targetId, payloadDigest, ... })`.

Fix needed: pass one object with `actorOid`, `actorType: 'staff'`, `action`, `payload`, and optional request metadata; do not precompute/pass `payloadDigest` as the service computes it internally.

### `lib/services/dataverse-identity-map.js`

Method signature from source:

```js
async function resolveProfileToSystemUser(profileId)
```

What the plan assumed: resolving null vs. non-null is the complete impersonation fail-closed contract.

Fix needed: use the returned `{ systemuserid, fullname, remappedFromId }` as only the first gate, then also enforce Dynamics impersonation is enabled and not silently retried without `MSCRMCallerID`.

### `lib/services/dynamics-service.js`

Method signatures from source:

```js
static _withCallerId(headers, actingUserSystemId)
static async _writeFetch(url, init, actingUserSystemId)
static async queryRecords(entitySet, { select, filter, orderby, top, expand } = {})
static async queryAllRecords(entitySet, { select, filter, orderby } = {})
static async updateRecord(entitySet, recordId, data, { ifMatch, actingUserSystemId } = {})
```

What the plan assumed: `updateRecord` can both enforce `If-Match` and return a fresh ETag, `queryAllRecords` can be used with pagination plus `$expand`, and a supplied acting user guarantees caller attribution.

Fix needed: re-fetch after PATCH or extend `updateRecord` to return representation; use `queryRecords` or extend the helper for continuation-token pagination and `$expand`; explicitly handle `DYNAMICS_IMPERSONATION_ENABLED` and `_writeFetch`'s 403 fallback.

### `pages/api/auth/[...nextauth].js` / `lib/utils/auth.js`

Method/session contract from source:

```js
// pages/api/auth/[...nextauth].js
session.user.azureId = token.azureId;
session.user.profileId = token.profileId;
session.user.dynamicsSystemuserId = token.dynamicsSystemuserId || null;

// lib/utils/auth.js
export async function requireAppAccess(req, res, ...appKeys)
// returns { profileId, session }
```

What the plan assumed: `session.azureId` is available directly for audit logging.

Fix needed: read `access.session.user.azureId` and `access.profileId` from the `requireAppAccess` return value.

## Summary

- V2 resolves most prior review items at the plan level: registry shape, middleware routing, page-vs-API denial behavior, re-application semantics, lookup bind syntax for approve/reject, and per-commit CI gates are materially improved.
- The remaining blockers are live contract mismatches introduced by the revision: audit logging call shape, post-PATCH ETag handling, `queryAllRecords` capability assumptions, and impersonation attribution guarantees.
- Before implementation, update the plan to specify exact helper usage: method gate order, `requireAppAccess` return fields, `resolveProfileToSystemUser(profileId)`, `updateRecord` returning void, and GET pagination/expand behavior.
- Treat caller attribution as a hard requirement: fail if Dynamics impersonation is disabled or if the write would fall back to the service principal.
