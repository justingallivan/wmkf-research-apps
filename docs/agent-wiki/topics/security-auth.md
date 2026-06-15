---
agent_wiki: topic
status: active
last_verified: 2026-06-15
stale_after_days: 60
owner: platform-security
source_files:
  - lib/utils/tracked-secrets.js
  - lib/utils/intake-blob.js
  - lib/utils/guid.js
  - scripts/check-trust-boundary-guid.js
  - pages/api/
canonical_docs:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/AUTHENTICATION_SETUP.md
  - docs/SECURITY_ARCHITECTURE.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - pages/api/**
  - lib/utils/tracked-secrets.js
  - lib/utils/intake-blob.js
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/CREDENTIALS_RUNBOOK.md
update_triggers:
  - API route auth/security changes
  - credential or tracked-secret changes
  - private blob/file access changes
---

# Security & Auth

Use this page for app access, admin routes, API security, tracked secrets,
private Blob/file access, prompt-injection hardening, and download proxy patterns.

## Ground Rules

- Never accept user/profile identity from request input when authenticated context supplies it.
- API keys and secrets stay server-side.
- Private intake Blob operations use `INTAKE_BLOB_RW_TOKEN`.
- API route security changes must reconcile the security matrix.
- A client-supplied id (`req.query`/`req.body`) that becomes a Dataverse selector
  must be GUID-validated at the route edge BEFORE the selector. `getRecord`/
  `updateRecord` interpolate the record id raw into the request URL
  (`${entitySet}(${id})`), and the reviewer-suggestion adapter's `findByRequest`
  interpolates `requestId` raw into an OData `$filter` — an unvalidated id is an
  over-fetch / IDOR / filter-injection vector. Server-derived ids (read off a row
  already fetched, or a token-bound row) are trusted.

## Trust-Boundary GUID Validation

- Canonical edge guard: `lib/utils/guid.js` — `isGuid(x)` (single) / `allGuids(x)`
  (batch arrays). An inline `GUID_RE.test(...)` is equivalent and recognized.
  Reject with a 400 before the id reaches any selector.
- Enforced by **`check:trust-boundary-guid`** (AST taint analysis,
  `scripts/check-trust-boundary-guid.js` + self-test). It is BOTH a startup gate
  and a **blocking commit guard** (`.claude/hooks/trust-boundary-guid-commit-guard.js`,
  exit 2 on `git commit`). Sinks covered: `getRecord`/`updateRecord`/`deleteRecord`
  (arg 1) and adapter `findById`/`updateLifecycle`/`softDelete`/`findByRequest`/
  `bulkUpdateByRequest` (arg 0). It is intra-file (interprocedural taint not
  modeled); a sink whose id is provably server-derived in a helper this gate can't
  follow may carry `// trust-boundary-guid:ignore reason=<id>`.
- Origin: Codex's S259 adversarial review found this guard had been applied to one
  route (`resolve-request.js`) but missed across the reviewer surface; the fix +
  gate are the fan-out remediation. See `feedback-symbol-consumer-fanout`.

## Durable Memory

- Access/admin/credits: `project-app-access-control`, `project-admin-dashboard`, `project-api-credit-monitoring`.
- Security: `project-a7-prompt-injection-hardening`.
- Private download pattern: `project-download-proxy-parked`.
- No banking/PII: `project-no-banking-pii-in-dataverse`.

## Standard Probe

```bash
rg -n "getServerSession|requireAuth|authorization|trackedSecrets|INTAKE_BLOB_RW_TOKEN|BLOB" pages/api lib docs
```
