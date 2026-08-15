---
title: Disabled-Account Revocation Hardening — Implementation & Adversarial Review — 2026-08-15
domain: security-auth
kind: audit
status: draft
summary: "Tier-2 implementation record for the accepted disabled-account revocation invariants (audit §10.2): signIn denial before side effects, current-request bare-auth blocking, JWT zero-row invalidation, fail-closed missing-profile helpers, and both link-profile branches with conditional persistence ordering. Records builder assignments, both Opus adversarial review passes, and every finding disposition."
canonical: false
---

# Disabled-Account Revocation Hardening — Implementation & Adversarial Review — 2026-08-15

Branch `codex/claude-revocation-hardening`, worktree
`WMKF_Apps-claude-revocation-hardening`, baseline `d32e2d56` (post-merge
`main` containing the accepted audit
`docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md`). Owner
authorization: SESSION_PROMPT.md Session 430 "Owner Decision Needed" item 2,
executed via the 2026-08-15 orchestration work order. Lead integrator: Claude
Fable. Implementation: three Sonnet builders with disjoint file ownership.
Adversarial review: two independent read-only Opus reviewers, repeated until no
unresolved blocking findings.

## Invariant table (contract-reconcile Mode B)

| # | Invariant | Files | Verification |
|---|---|---|---|
| 1 | Fresh sign-in for a disabled `azure_id` denied before grantDefaultApps/notifyNewUser/reconcileProfile/any write | `pages/api/auth/[...nextauth].js` signIn | `tests/unit/nextauth-revocation.test.js`: `signIn` → `false`, side-effect mocks uncalled, no INSERT/UPDATE issued |
| 2 | Disabled or missing staff profile blocked during the current bare-auth request | `lib/utils/auth.js` requireAuth | disabled → 403, zero-row → 403; route-level tests through the four real handlers |
| 3 | Zero-row active lookup invalidates staff claims for subsequent requests, with or without prior `profileId` | `[...nextauth].js` jwt | jwt returns `{}` on zero rows for both token shapes |
| 4 | `requireAuthWithProfile`/`requireAppAccess` fail closed on disabled, deleted, or missing rows | `lib/utils/auth.js` | zero-row → 403 tests (previously fail-open predicates) |
| 5 | Guard DB failure → 503 fail-closed, never authorization success; signIn DB failure denies sign-in (no API-route 503 claim) | both | existing 503 tests + jwt-error-keeps-token test + signIn catch pin |
| 6 | Both link-profile branches verify live caller `is_active` | `pages/api/auth/link-profile.js` | disabled caller → 403 on both branches with zero write queries issued |
| 7 | Revocation-vs-linking conditional ordering: no create/claim/update/delete persists for a disabled caller | `link-profile.js` | pre-check before writes + `AND is_active = true` conditional writes + rowcount check on the final UPDATE |
| 8 | Active linking session (active temp profile → token carries `profileId` + `needsLinking`) keeps working | `link-profile.js`, jwt | positive tests on both branches |
| 9 | Applicant sessions + `AUTH_REQUIRED=false` dev bypass unchanged | `auth.js`, `[...nextauth].js` | applicant skips the staff lookup; authBypassed early-return untouched |
| 10 | All four bare-auth routes covered via the shared `requireAuth` contract | `requireAuth` only (no route edits) | handler-level tests: blob-proxy, upload-handler, health, api-capabilities |
| 11 | `is_active = false` is the durable revocation mechanism | all | no alternate mechanism introduced |
| 12 | No tombstone/denylist/migration; hard-delete reprovisioning stays an accepted residual | none | absence check + residual recorded below |

## Sonnet builder assignments

| Builder | Exclusive scope | Status |
|---|---|---|
| A | `pages/api/auth/[...nextauth].js` (signIn disabled-row denial; jwt zero-row invalidation) + `tests/unit/nextauth-revocation.test.js` (13 tests) | COMPLETE — mutation check: disabled-sign-in test fails against pre-fix code (`return true` + provisioning observed) |
| B | `lib/utils/auth.js` (requireAuth active check; fail-closed zero-row fixes) + `tests/unit/utils/auth.test.js` (+9 tests) + `tests/helpers/auth-mock.js` (3 new presets) + `tests/unit/bare-auth-revocation.test.js` (8 route-level tests) + suite fallout triage (none needed; 2 failures pre-existing on baseline, re-confirmed by lead via `git stash -u`) | COMPLETE — discriminating fixtures: zero-row lookups where old/new predicates disagree, sequenced sql mocks to isolate `requireAuthWithProfile`'s own read |
| C | `pages/api/auth/link-profile.js` (live caller guard + conditional writes + rowcount-checked UPDATE → 409) + `tests/unit/link-profile-revocation.test.js` (11 tests) | COMPLETE — empirical mutation check: suite re-run against the pre-fix handler; every revocation case failed (200 + writes executed), green after restore |

## Opus adversarial review passes

(To be recorded: reviewer scopes, every finding, disposition
CONFIRMED/REFUTED with file:line evidence, and remediation round results.)

## Residual risks and owner decisions

- Hard-delete reprovisioning remains an explicitly accepted residual
  (audit §10.3); no tombstone/denylist implemented per owner scope.
- A disabled profile that shares only an email (not `azure_id`) with a fresh
  sign-in does not block provisioning of a new identity — revocation keys on
  `azure_id`; the email-only case is the same class as hard-delete
  reprovisioning.
- `requireAuthWithProfile` routes now perform the active-profile read twice
  (once in `requireAuth`, once in the helper) — accepted as defense in depth;
  no dedup mechanism added by design.
- `/api/health` behind the hardened `requireAuth` now returns 503 when
  Postgres is unavailable — fail-closed per the audit contract; noted because
  it is a health surface.
- Intake proxy routing + intake CSRF, Workbench observability Stage 1, and the
  `NEXTAUTH_URL` fail-closed change remain out of scope per the work order.
