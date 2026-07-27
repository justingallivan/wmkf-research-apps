---
title: Q9 App-Access Stage 2 Acceptance — 2026-07-27
domain: data-layer
kind: audit
status: active
summary: "Deterministic enforcement-mode acceptance replacing the low-signal Q9 app-access production soak."
canonical: false
cataloged: 2026-07-27
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md
  - docs/audits/documentation-memory-hygiene-sweep-2026-07-27.md
  - pages/api/app-access.js
  - lib/utils/auth.js
  - lib/services/dataverse-app-access-service.js
---

# Q9 App-Access Stage 2 Acceptance — 2026-07-27

## Decision

The owner replaced the passive `warn` traffic soak with deterministic
enforcement-mode acceptance. The point-in-time live population is small, and
the owner expects sign-ins and grant changes to be rare, so waiting for organic
traffic would not provide representative coverage.

Stage 2 is **SATISFIED**. Stage 4 may begin.

This decision does not claim that Preview or Production currently sets
`DATAVERSE_DAL_UNIVERSAL`. Both project configurations omit it, so a new
deployment resolves the source default, `off`. The acceptance instead runs the
same guard as `on`, where any missing trusted context throws immediately.

## Contract surface

| Entry point | Persisted/live dependency | Consumer | Acceptance |
|---|---|---|---|
| `requireAppAccess` ordinary-user lookup | Dataverse app grants | 87 app-gated API routes | Guard runs in `on` mode inside trusted DAL context; lookup errors return retryable 503 and are not cached. |
| `/api/app-access?all=true` | Postgres active profiles + all Dataverse grants | Admin access UI | Strict read rejects transport failure; it cannot masquerade as an empty grant set. |
| `/api/app-access` POST/DELETE | Dataverse grant rows | Admin access UI and auth cache | Calls run inside trusted context; partial failure reports only completed identifiers and returns non-2xx. |
| NextAuth fresh-profile default grant | Dataverse grant rows | First staff sign-in | Default-grant call runs inside trusted context in `on` mode. |

## Live read-only inventory

**[VERIFIED 2026-07-27 via Postgres active-profile reads and production
Dataverse app-grant reads]**

- 10 active profiles;
- 2 superusers;
- 6 mapped ordinary users;
- 2 unmapped read-only profiles;
- mapped ordinary users hold 3–5 grants each; and
- no dedicated mapped test account was found, and no reusable ordinary-user
  session was available to this run.

The inventory supports the owner's conclusion that a passive change or traffic
watch is low-signal. It also prevents silently choosing a real staff member for
a temporary permission mutation.

## Programmatic acceptance

The focused run used:

```text
DATAVERSE_DAL_UNIVERSAL=on
7 Jest suites
27 tests
27 passed
```

Suites:

- `tests/unit/app-access-admin-partial-refresh.test.js`
- `tests/unit/dataverse-app-access-failure-contract.test.js`
- `tests/unit/app-access-route-dal-context.test.js`
- `tests/unit/require-app-access-dal-context.test.js`
- `tests/unit/nextauth-signin-dal-context.test.js`
- `tests/unit/dataverse-read-guard-probes.test.js`
- `tests/unit/dal-universal-guard.test.js`

The route, auth, and sign-in tests invoke the real universal guard from their
mocked storage seams. The failure-contract suite drives the real Dataverse
app-access service with mocked transport and verifies strict reads plus
partial-success results.

## Safety correction found by the acceptance review

The pre-acceptance admin route discarded service results and returned success
for every requested key even when the Dataverse service returned an error.
The all-grants service also collapsed read failures to `[]`.

The current source now:

- passes `{ throwOnError: true }` for the admin all-grants snapshot and returns
  502 on failure;
- preserves the completed prefix from grant/revoke batch loops;
- returns 502 with that completed prefix on partial failure; and
- logs transport details server-side without returning raw Dataverse response
  text to the browser;
- forces and awaits a canonical grant refetch after any admin mutation
  failure, so Discard cannot restore a stale client snapshot;
- locks a snapshot whose canonical refetch fails and exposes an explicit Retry
  action; mutation controls remain disabled until that retry loads canonical
  grants; and
- clears the affected user's two-minute access cache after every attempted
  mutation, including partial failure.

These changes are required for any later reversible live smoke to distinguish
the original state, completed work, and restoration target.

## Gates and result

The following ran sequentially and passed with their self-tests:

- `check:dataverse-access-layer`;
- `check:dynamics-context-boundary`;
- `check:route-lifecycle-auth`;
- `check:route-service-boundary`; and
- `check:api-routes`.

Changed-file ESLint reported 0 errors and 10
`react-hooks/set-state-in-effect` warnings in the existing monolithic admin
page.

The production build passed. The full Jest run passed **519 suites / 6,159
tests**. An independent adversarial re-review found no remaining P1/P2 issue
after the stale-snapshot lock and Retry regression were added.

## Mutation and deployment boundary

No staff grant, Vercel environment variable, deployment, or saved browser
session changed during this acceptance. The existing production deployment
remained the baseline.

A real ordinary-user OAuth smoke is still useful at Stage 4's normal release
boundary. It requires a deliberately designated ordinary user because
superusers bypass the grant lookup. It is a release verification, not a
pre-build observation window.
