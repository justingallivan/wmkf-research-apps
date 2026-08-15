---
agent_wiki: topic
status: active
last_verified: 2026-06-23
stale_after_days: 60
owner: platform-security
source_files:
  - lib/utils/auth.js
  - lib/utils/tracked-secrets.js
  - lib/utils/intake-blob.js
  - lib/utils/guid.js
  - scripts/check-trust-boundary-guid.js
  - pages/api/auth/[...nextauth].js
  - pages/api/
canonical_docs:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/AUTHENTICATION_SETUP.md
  - docs/SECURITY_OPERATING_PLAN.md
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
  - NEXTAUTH_URL or branded staff-domain changes
---

# Security & Auth

Use this page for app access, admin routes, API security, tracked secrets,
private Blob/file access, prompt-injection hardening, and download proxy patterns.
`docs/SECURITY_ARCHITECTURE.md` is a historical March 2026 IT-review snapshot,
not a current authority.

## Ground Rules

- Never accept user/profile identity from request input when authenticated context supplies it.
- API keys and secrets stay server-side.
- Private intake Blob operations use `INTAKE_BLOB_RW_TOKEN`.
- API route security changes must reconcile the security matrix.
- Route→Service consolidation (Stage 7, 2026-07-05) moved route business logic
  into `lib/services/<domain>/` services; route URLs, guards, and response
  envelopes are unchanged and the matrix rows still describe the live guard
  posture `[VERIFIED via check:api-routes green + the route-service-boundary
  law gate at census 0, 2026-07-05]`. Auth guards stay IN the route shells
  (never in services).
- `NEXTAUTH_URL` is the canonical public origin for NextAuth callbacks and the
  state-changing API Origin/Referer check. Do not point it at a new staff domain
  until the matching Azure/Entra redirect URI is configured and smoke-tested.
- **Client auth-gate render contract (S398, `27aba5be`):** `RequireAuth` keeps
  children mounted through `useSession()` 'loading' — it must NOT swap to a
  spinner mid-resolution (that unmounted `ProfileProvider`+`AppAccessProvider`,
  discarded the in-flight `/api/app-access`, and re-fetched on remount; ~0.3–2s
  per page load). Children already render before any auth check completes
  (designed no-flicker `!authEnabled` branch), so this widens nothing;
  `'unauthenticated'` still tears down to the sign-in screen, and
  `RequireAppAccess`/`AppAccessContext` stay the fail-closed content gates.
  `/api/auth/status` lookups go through `shared/utils/auth-enabled.js`
  (in-flight-promise dedupe across RequireAuth/Layout/index) — a non-2xx or
  shape-invalid response is a RETRYABLE failure and must never be cached as
  "auth disabled" (Codex adversarial finding, S398: a cached transient 503
  disabled the client auth gate for the page lifetime). Regression tests:
  `tests/unit/require-auth-render-race.test.js`.
- **Disabled-account revocation is enforced at every layer (2026-08-15
  revocation hardening, branch `codex/claude-revocation-hardening`):** the
  NextAuth `signIn` callback looks up the caller's `azure_id` WITHOUT an
  `is_active` filter and denies sign-in for a disabled row before any
  provisioning/notification/reconcile side effect; the `jwt` callback returns
  `{}` (full invalidation) when the active-profile lookup returns zero rows —
  DB errors keep the token and defer to the route guards' 503; bare
  `requireAuth` (and therefore the four bare-auth routes: blob-proxy,
  upload-handler, health, api-capabilities) does a live `is_active` read per
  request for non-applicant sessions; `requireAuthWithProfile` and
  `requireAppAccess` fail closed on zero rows (a deleted profile is not
  active); and `/api/auth/link-profile` re-checks the live caller's active
  status before any write in BOTH branches, with `is_active = true`
  conditional writes as a TOCTOU backstop. `is_active = false` is the durable
  revocation mechanism; hard-delete reprovisioning is an accepted residual (no
  tombstone by owner decision). Tests: `tests/unit/nextauth-revocation.test.js`,
  `tests/unit/bare-auth-revocation.test.js`,
  `tests/unit/link-profile-revocation.test.js`, `tests/unit/utils/auth.test.js`.
  Record: `docs/audits/claude-revocation-hardening-implementation-2026-08-15.md`.
- A client-supplied id (`req.query`/`req.body`) that becomes a Dataverse selector
  must be GUID-validated at the route edge BEFORE the selector. `getRecord`/
  `updateRecord` interpolate the record id raw into the request URL
  (`${entitySet}(${id})`), and the reviewer-suggestion adapter's `findByRequest`
  interpolates `requestId` raw into an OData `$filter` — an unvalidated id is an
  over-fetch / IDOR / filter-injection vector. Server-derived ids (read off a row
  already fetched, or a token-bound row) are trusted.

## Branded Staff-Domain Migration Backlog

- Current external magic-link state (2026-06-23): reviewer links use
  `REVIEWER_PORTAL_BASE_URL=https://reviews.wmkeck.org`; grantee links use
  `GRANTEE_PORTAL_BASE_URL=https://grantees.wmkeck.org`. These are independent
  of staff NextAuth callbacks (`lib/external/token-lifecycle.js`,
  `lib/external/grantee-token-lifecycle.js`).
- Public external surfaces must not show the internal request number. Reviewer
  and grantee token context APIs intentionally omit `requestNumber`, and the
  reviewer/grantee send paths guard against sending hydrated email subject/body
  copy that contains the internal request number.
- Staff-auth cut over to the branded host (2026-06-23): the staff Azure app
  registration includes the redirect URI
  `https://applications.wmkeck.org/api/auth/callback/azure-ad`, and
  `NEXTAUTH_URL=https://applications.wmkeck.org` is set in Production. VERIFIED via
  live runtime `/api/health` + an authenticated write probe (POST/DELETE 200) on
  the branded host: sign-in + reads + writes all work there. The Origin check is
  ON, pinned to the branded host: `lib/utils/auth.js` rejects POST/PUT/PATCH/DELETE
  whose Origin/Referer ≠ `NEXTAUTH_URL`.
- Legacy `wmkfresearch.vercel.app` now **307-redirects page navigations to
  `applications.wmkeck.org`** (S293, `next.config.js` host-conditioned `redirects()`,
  `permanent:false`, prod-verified; runs before the `proxy.js` auth gate). `/api/*` is
  EXCLUDED, so an in-flight POST from an already-open old-host tab still 403s on Origin
  mismatch until the next navigation. Pre-S293 it was a bare deprecation tail (GET worked,
  state-changing 403'd). Underlying Origin-403 still applies to any API call that reaches
  the old host. Do not hard-retire the host until outstanding external magic links are
  accounted for.
- `NEXTAUTH_URL` runtime-vs-pull note: while it was a Sensitive Vercel var,
  `vercel env pull` read it back as `""`, producing a false "empty in prod" belief
  in earlier docs. The authoritative producer is runtime `/api/health` (reports
  `process.env.NEXTAUTH_URL`); do not infer the value from a pull of a Sensitive
  var.
- Preview env should NOT carry a fixed `NEXTAUTH_URL` (leave host-derived) or
  preview-deployment sign-in/writes break; see `project-branded-domains.md`.

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
  route (`resolve-request.js`) and then expanded it across the reviewer surface; the fix +
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
