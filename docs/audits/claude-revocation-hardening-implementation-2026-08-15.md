---
title: Disabled-Account Revocation Hardening — Implementation & Adversarial Review — 2026-08-15
domain: security-auth
kind: audit
status: complete
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
| A | `pages/api/auth/[...nextauth].js` (signIn disabled-row denial; jwt zero-row invalidation) + `tests/unit/nextauth-revocation.test.js` (10 tests pre-remediation; count corrected per Opus reviewer 2 finding 5) | COMPLETE — mutation check: disabled-sign-in test fails against pre-fix code (`return true` + provisioning observed) |
| B | `lib/utils/auth.js` (requireAuth active check; fail-closed zero-row fixes) + `tests/unit/utils/auth.test.js` (+9 tests) + `tests/helpers/auth-mock.js` (3 new presets) + `tests/unit/bare-auth-revocation.test.js` (8 route-level tests) + suite fallout triage (none needed; 2 failures pre-existing on baseline, re-confirmed by lead via `git stash -u`) | COMPLETE — discriminating fixtures: zero-row lookups where old/new predicates disagree, sequenced sql mocks to isolate `requireAuthWithProfile`'s own read |
| C | `pages/api/auth/link-profile.js` (live caller guard + conditional writes + rowcount-checked UPDATE → 409) + `tests/unit/link-profile-revocation.test.js` (11 tests pre-remediation; 12 after the NULL-row test) | COMPLETE — empirical mutation check: suite re-run against the pre-fix handler; every revocation case failed (200 + writes executed), green after restore |

## Opus adversarial review passes

Two independent read-only Opus reviewers ran against commit `445dd1f8`
(diff over `d32e2d56`), each seeded with the lead's lifecycle/provenance
trace to verify rather than trust. **Neither reviewer refuted any of the 12
invariants; neither reported a BLOCKING finding.** Reviewer 1 (end-to-end
auth/authz semantics) independently verified the next-auth v4 internals
(`node_modules/next-auth/core/routes/session.js`: a `{}` token still yields a
non-null session object — confirming the audit's both-layers-required
premise), swept every `getServerSession`/`getSession(` consumer to prove no
DB-outage path becomes authorization success, and traced all four
link-profile race interleavings. Reviewer 2 (TOCTOU/negative-test
adequacy/coverage/docs) re-derived pre-fix behavior for every new negative
test (none decorative), confirmed the exact four-route bare-auth census and
that the route tests import the real handlers, mapped **all six §10.2
required-regression-test bullets to concrete tests** (table in its report;
no bullet uncovered), and independently reproduced the two known unit-suite
failures on pristine baseline `d32e2d56`.

### Findings and dispositions

| # | Reviewer / severity | Finding | Disposition |
|---|---|---|---|
| 1 | R1 MEDIUM | Claim-branch 409 race: target profile disabled between the SELECT (`link-profile.js:101`) and the conditional UPDATE (`:128`) → temp row already deleted → caller has zero rows for `azure_id` → next sign-in falls to the create-new branch and provisions a fresh default-grant profile | CONFIRMED mechanism; **ACCEPTED as residual** (owner may overturn). The disabled target profile stays disabled — the user gains only a new vanilla identity with default grants, which is exactly the already-accepted email-only/hard-delete reprovisioning residual class. Invariant 7 (disabled *caller*) is not violated; closing the two-statement window would need a `db.connect()` transaction in a serverless route (real added risk) or a fragile CTE ordering. Recorded below. |
| 2 | R1 LOW + R2 LOW | `is_active` NULL split-brain: `=== false` / `!== false` sites treat NULL as active while `!is_active` sites deny; `requireAppAccess` would be the fail-open side (~94 endpoints). No write path produces NULL today (both reviewers exhaustively enumerated writes) | CONFIRMED (latent, unreachable); **FIXED** in the remediation round — all revocation predicates normalized to `is_active === true`-grants / everything-else-denies, with a discriminating NULL test per site |
| 3 | R1 LOW | Wiki bullet overclaimed "enforced at every layer" — the proxy edge itself has no `is_active` read (`proxy.js:96-144`); it inherits revocation via JWT invalidation | CONFIRMED; **FIXED** (wording corrected in `docs/agent-wiki/topics/security-auth.md`) |
| 4 | R2 MEDIUM | Residual-list omission: the applicant pass-through on the four bare-auth routes (`auth.js` skips the check for `userType === 'applicant'`) is now a codified exemption but was unrecorded. Pre-existing, not a regression; proxy staff-surface classification rejects applicant tokens today (`proxy.js:141`) | CONFIRMED; **FIXED** (recorded in residuals below) |
| 5 | R2 LOW | Implementation-record test count for builder A was wrong (claimed 13; file had 10) | CONFIRMED; **FIXED** (counts corrected in this record) |
| 6 | R2 LOW + R1 INFO | Stale mutation-check comment in `link-profile-revocation.test.js` ("9 of 12"; the file has 11 tests) | CONFIRMED; **FIXED** in the remediation round |
| 7 | R1 INFO | `/api/health` now 503s during a Postgres outage (fail-closed health surface) | Already recorded in residuals; verified by R1 |
| 8 | R2 INFO | jwt's `if (token.azureId)` fall-through (non-applicant token without azureId keeps stale claims) is safe only because `requireAuth`'s keyless-session 403 backstops it | CONFIRMED; **recorded below** so a future edit doesn't remove the requireAuth check believing jwt covers it |
| 9 | R1 INFO | Transient signout window in createNew (DELETE→INSERT gap: a concurrent session read sees zero rows → `{}` → re-sign-in) | ACCEPTED — fail-closed direction is the right trade; recoverable; recorded below |
| 10 | R1/R2 INFO | Minor optional test gaps (no end-to-end unique-violation race test — not exercisable in a mock-based suite; no `entra-external` early-return pin) | ACCEPTED as non-load-bearing; both reviewers judged them acceptable |

### Remediation round (post-review)

One Sonnet remediation builder implemented findings 2 and 6:
`[...nextauth].js` signIn `is_active === false` → `!== true`;
`requireAppAccess` `is_active !== false` → `=== true`; `link-profile.js`
caller check `=== false` → `!== true` (the `!is_active` sites in
`requireAuth`/`requireAuthWithProfile` already denied NULL and were left
alone); stale mutation-check comment corrected to "9 of 11". Three
discriminating NULL-row tests added (one per site — each seeds a PRESENT row
with `is_active: null`, the fixture where the old and new predicates
disagree). Verified by the lead: targeted suites 86/86 green; full unit
suite 7652 tests with only the two known pre-existing baseline failures;
predicate diff inspected line-by-line.

### Opus re-review of the remediation delta (`445dd1f8..6268e26b`)

A third Opus reviewer verified the delta: predicate changes exact and
NULL-only (true/false behavior unchanged); full `is_active` census across
`lib/utils/auth.js` + `pages/api/auth/` shows **no NULL-permissive site
remains** (JS predicates and SQL `AND is_active = true` three-valued logic
alike); the three NULL tests are discriminating, including a mock-routing
check proving the `requireAppAccess` test reaches the real read; no test
weakened (delta is pure addition apart from the comment correction); scope
exact; targeted suites 86/86 green. **Verdict: no BLOCKING, HIGH, or MEDIUM
findings.** Its supporting check beyond the lead's trace: the new-profile
INSERT omits `is_active`, and the schema default `true`
(`scripts/setup-database.js`) keeps new users active under the tightened
predicates — no new-user regression. Three LOW/INFO record-accuracy nits
(builder-C test count, mutation-comment denominator context, proxy line
citations) were fixed by the lead in the closing commit; review cycle
converged with zero unresolved blocking or high-confidence findings.

## Residual risks and owner decisions

- **Claim-branch 409 race (Opus R1 finding 1, accepted):** if the *target*
  profile is disabled between link-profile's target SELECT and its
  conditional UPDATE, the caller's temp row is already deleted and the 409
  leaves the caller row-less; their next sign-in provisions a fresh
  default-grant profile. The disabled profile itself stays disabled — this is
  the accepted reprovisioning residual class, not a revocation bypass.
- **Applicant pass-through on bare-auth routes (Opus R2 finding 4,
  pre-existing):** `requireAuth`'s revocation check deliberately skips
  `userType === 'applicant'` sessions (applicants have no `user_profiles`
  row), so an applicant session reaching blob-proxy/upload-handler would face
  no profile check. Today the proxy classifies those routes as staff surface
  and rejects applicant tokens (`proxy.js:141`); this exemption must be
  revisited if the applicant surface classification ever widens (the intake
  proxy/CSRF workstream).
- **jwt fall-through backstop coupling (Opus R2 finding 8):** a non-applicant
  token without `azureId` skips the jwt active lookup and keeps its claims;
  it is denied only by `requireAuth`'s keyless-session 403. Do not remove
  that requireAuth branch on the belief that the jwt callback covers it.
- **Transient signout window in createNew (Opus R1 finding 9, accepted):**
  between the temp DELETE and the INSERT, a concurrent session read sees zero
  rows and invalidates the token; the user re-signs-in and re-enters the
  linking flow. Fail-closed direction, recoverable.

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
