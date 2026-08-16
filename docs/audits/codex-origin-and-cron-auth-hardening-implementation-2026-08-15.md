---
title: Codex Origin and Cron Authentication Hardening Implementation — 2026-08-15
domain: security-auth
kind: audit
status: complete
summary: "Implementation and verification record for production-mode Origin fail-closed behavior and constant-time cron-secret comparison."
canonical: false
cataloged: 2026-08-15
owner: product-engineering
related:
  - lib/utils/auth.js
  - lib/utils/cron-auth.js
  - pages/api/cron/drain-submissions.js
  - docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md
---

# Codex Origin and Cron Authentication Hardening Implementation — 2026-08-15

## Status and scope

Implemented on `codex/security-origin-cron-hardening` from main `715ab060`; awaiting independent
review and deliberate owner promotion. The controls in this record are **not Production-live**
until that branch is merged and deployed.

Authorized scope is limited to two findings from the accepted follow-up security audit:

1. production-mode staff API Origin/Referer validation must fail closed when its trusted-origin
   configuration is absent or invalid, while Preview can use its deployment hostname; and
2. both cron bearer-secret verifiers must use a shared constant-time comparison without changing
   their different development-bypass policies.

There is no persistence, migration, data mutation, intake proxy/CSRF, raw-error response, grantee
token, recipient-authority, or hard-delete/tombstone change.

## Mode B contract reconciliation

| # | Invariant | Evidence on branch |
|---|---|---|
| 1 | Safe methods keep bypassing Origin validation. | Existing `validateOrigin` early return and unchanged characterization tests. |
| 2 | Cookie-free requests with neither Origin nor Referer retain the existing server-to-server exemption. | Configuration resolution remains after the headerless/cookie classification branches in `lib/utils/auth.js`. |
| 3 | Cookie-bearing state-changing requests without Origin/Referer remain rejected. | Existing `tests/unit/utils/auth.test.js` coverage remains green. |
| 4 | Production uses explicit `NEXTAUTH_URL` and rejects missing or unparseable configuration. | New production missing/invalid tests exercise `requireAuth` and assert 403. |
| 5 | Production does not substitute `VERCEL_URL` for a missing `NEXTAUTH_URL`. | Production missing test seeds `VERCEL_URL` and still asserts 403. |
| 6 | Preview may derive the trusted origin from scheme-less `VERCEL_URL` only when `NEXTAUTH_URL` is absent. | New exact-match and mismatch Preview tests. |
| 7 | Preview fails closed when its deployment hostname is missing or unparseable. | New missing and invalid `VERCEL_URL` Preview tests. |
| 8 | An explicitly invalid `NEXTAUTH_URL` never silently falls through to request data or another source. | A dedicated Preview regression test supplies both invalid `NEXTAUTH_URL` and valid `VERCEL_URL` and asserts 403. |
| 9 | Local/test behavior remains permissive when allowed-origin configuration is absent or invalid. | Updated non-production regression tests. |
| 10 | Exact cron bearer values still authenticate and mismatches still return 401. | `tests/unit/utils/cron-auth.test.js`. |
| 11 | Wrong-length cron inputs still execute `crypto.timingSafeEqual` on equal-size padded buffers before rejection. | Spy-backed unit test over `constantTimeEqual`. |
| 12 | Missing non-development `CRON_SECRET` still returns the existing 500 response. | Shared and drain verifier regression tests. |
| 13 | Shared `verifyCronSecret` retains its development bypass. | Dedicated regression test. |
| 14 | `drain-submissions` remains strict in development and still rejects before opening a database connection. | Route-level regression tests. |
| 15 | Both verifier variants call the shared comparison primitive. | Direct shared-verifier tests plus a route-wiring assertion for the local drain verifier. |
| 16 | CommonJS/ES module consumption remains build-compatible. | Type check and successful Next.js Webpack production build. |

Complement/fall-through review found no path that derives a trusted origin from caller-controlled
headers, no Preview fallback after an explicitly invalid `NEXTAUTH_URL`, and no accidental reuse
of the shared verifier's development bypass by the strict drain route.

## Verification

- Focused auth and drain baseline before implementation: 55/55 tests passed.
- Final focused implementation set: 3 suites, 74/74 tests passed.
- Broader auth/cron sibling set: 12 suites, 147/147 tests passed.
- `npm run check:api-routes`: 157 routes; self-test passed.
- `npm run check:types`: passed.
- `npm run lint`: 0 errors; 65 pre-existing warnings.
- `npx next build --webpack`: passed as the production-build fallback.
- `git diff --check`: passed before documentation reconciliation.

An independent adversarial reviewer found no runtime security or correctness defect. Its sole P3
finding was test isolation: a route test's `console.error` spy could survive into later cases.
`jest.restoreAllMocks()` now runs after every test in that suite; the focused set passed again, and
the reviewer confirmed the finding closed with no new issue.

The repository's exact `npm run build` Turbopack path was attempted twice, including outside the
Codex sandbox. Both attempts reached compilation and then failed because this host prohibited the
build worker's local port bind (`Operation not permitted`). Before retrying, the worktree's external
`node_modules` symlink was replaced with a local APFS-cloned dependency tree because Turbopack
correctly rejects dependencies outside the project root. This is an environment limitation, not a
claimed green exact-build result; the Webpack fallback completed the full production build.

## Mode A durable-fact reconciliation

Authoritative source was the changed implementation and its tests. Live current-state restatements
were reconciled in `docs/AUTHENTICATION_SETUP.md`, `docs/CREDENTIALS_RUNBOOK.md`,
`docs/SECURITY_OPERATING_PLAN.md`, `docs/agent-wiki/topics/security-auth.md`, and
`SESSION_PROMPT.md`. The originating Claude audit and older security audits remain labeled
point-in-time historical evidence and were not rewritten to pretend the finding had always been
closed. `DEVELOPMENT_LOG.md` remains unchanged because the branch is unmerged and no Production
milestone has occurred.

## Promotion and residuals

After independent review, the owner may deliberately merge the branch. Deployment verification is
then:

1. a signed-in state-changing request on `applications.wmkeck.org` succeeds;
2. the same class of request with a mismatched Origin returns 403; and
3. a current Preview deployment succeeds with its fixed `NEXTAUTH_URL` absent and its platform
   `VERCEL_URL` present.

The already-deferred intake proxy-routing plus intake-CSRF work remains a joint pre-launch item and
is not weakened or closed by this staff-origin change.
