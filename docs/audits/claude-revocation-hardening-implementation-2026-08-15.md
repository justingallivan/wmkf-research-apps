---
title: Disabled-Account Revocation Hardening — Implementation & Adversarial Review — 2026-08-15
domain: security-auth
kind: audit
status: complete
summary: "Tier-2 implementation record for the accepted disabled-account revocation invariants (audit §10.2): signIn denial before side effects, current-request bare-auth blocking, JWT zero-row invalidation, fail-closed missing-profile helpers, and both link-profile branches with locked transactional persistence ordering. Records builder assignments, Opus adversarial review, Codex's independent merge review/remediation, and every finding disposition."
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
unresolved blocking findings. A subsequent independent Codex merge review found
that the accepted DELETE-before-replacement race contradicted invariant 7;
Justin authorized Codex to correct it on this branch. The correction preserves
the caller row for `createNew`, serializes the existing-profile transfer, and
makes zero-row archive attempts report failure rather than false success.

## Invariant table (contract-reconcile Mode B)

| # | Invariant | Files | Verification |
|---|---|---|---|
| 1 | Fresh sign-in for a disabled `azure_id` denied before grantDefaultApps/notifyNewUser/reconcileProfile/any write | `pages/api/auth/[...nextauth].js` signIn | `tests/unit/nextauth-revocation.test.js`: `signIn` → `false`, side-effect mocks uncalled, no INSERT/UPDATE issued |
| 2 | Disabled or missing staff profile blocked during the current bare-auth request | `lib/utils/auth.js` requireAuth | disabled → 403, zero-row → 403; route-level tests through the four real handlers |
| 3 | Zero-row active lookup invalidates staff claims for subsequent requests, with or without prior `profileId` | `[...nextauth].js` jwt | jwt returns `{}` on zero rows for both token shapes |
| 4 | `requireAuthWithProfile`/`requireAppAccess` fail closed on disabled, deleted, or missing rows | `lib/utils/auth.js` | zero-row → 403 tests (previously fail-open predicates) |
| 5 | Guard DB failure → 503 fail-closed, never authorization success; signIn DB failure denies sign-in (no API-route 503 claim) | both | existing 503 tests + jwt-error-keeps-token test + signIn catch pin |
| 6 | Both link-profile branches verify live caller `is_active` | `pages/api/auth/link-profile.js` | disabled caller → 403 on both branches with zero write queries issued |
| 7 | Revocation-vs-linking ordering: no failed or concurrent disable/claim path commits a rowless caller identity | `link-profile.js`, `database-service.js` | caller + target `FOR UPDATE`; `createNew` in-place UPDATE; claim DELETE+UPDATE in one transaction with rollback; archive succeeds only when `rowCount > 0` |
| 8 | Active linking session (active temp profile → token carries `profileId` + `needsLinking`) keeps working | `link-profile.js`, jwt | positive tests on both branches; createNew preserves the temp profile id and its existing grants |
| 9 | Applicant sessions + `AUTH_REQUIRED=false` dev bypass unchanged | `auth.js`, `[...nextauth].js` | applicant skips the staff lookup; authBypassed early-return untouched |
| 10 | All four bare-auth routes covered via the shared `requireAuth` contract | `requireAuth` only (no route edits) | handler-level tests: blob-proxy, upload-handler, health, api-capabilities |
| 11 | `is_active = false` is the durable revocation mechanism | all | no alternate mechanism introduced |
| 12 | No tombstone/denylist/migration; hard-delete reprovisioning stays an accepted residual | none | absence check + residual recorded below |

## Sonnet builder assignments

| Builder | Exclusive scope | Status |
|---|---|---|
| A | `pages/api/auth/[...nextauth].js` (signIn disabled-row denial; jwt zero-row invalidation) + `tests/unit/nextauth-revocation.test.js` (10 tests pre-remediation; count corrected per Opus reviewer 2 finding 5) | COMPLETE — mutation check: disabled-sign-in test fails against pre-fix code (`return true` + provisioning observed) |
| B | `lib/utils/auth.js` (requireAuth active check; fail-closed zero-row fixes) + `tests/unit/utils/auth.test.js` (+9 tests) + `tests/helpers/auth-mock.js` (3 new presets) + `tests/unit/bare-auth-revocation.test.js` (8 route-level tests) + suite fallout triage (none needed; 2 failures pre-existing on baseline, re-confirmed by lead via `git stash -u`) | COMPLETE — discriminating fixtures: zero-row lookups where old/new predicates disagree, sequenced sql mocks to isolate `requireAuthWithProfile`'s own read |
| C | `pages/api/auth/link-profile.js` (live caller guard + conditional writes + rowcount-checked UPDATE → 409 — this conditional-write shape was later superseded by Codex's locked transactional rewrite, recorded below) + `tests/unit/link-profile-revocation.test.js` (11 tests pre-remediation; 12 after the NULL-row test; rewritten to 18 by the Codex remediation) | COMPLETE — empirical mutation check: suite re-run against the pre-fix handler; every revocation case failed (200 + writes executed), green after restore |

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
| 1 | R1 MEDIUM | Claim-branch race: target profile disabled between the target SELECT and conditional UPDATE → temp row already deleted → caller becomes rowless and can reprovision | CONFIRMED mechanism. The initial **ACCEPTED** disposition was **OVERRULED during Codex's independent merge review**: the missing row was created by this route, not by the owner's accepted hard-delete policy, so it contradicted invariants 7 and 11. **FIXED** with caller/target row locks and a transaction whose rollback restores the temp row when the target update fails. |
| 2 | R1 LOW + R2 LOW | `is_active` NULL split-brain: `=== false` / `!== false` sites treat NULL as active while `!is_active` sites deny; `requireAppAccess` would be the fail-open side (~94 endpoints). No write path produces NULL today (both reviewers exhaustively enumerated writes) | CONFIRMED (latent, unreachable); **FIXED** in the remediation round — all revocation predicates normalized to `is_active === true`-grants / everything-else-denies, with a discriminating NULL test per site |
| 3 | R1 LOW | Wiki bullet overclaimed "enforced at every layer" — the proxy edge itself has no `is_active` read (`proxy.js:96-144`); it inherits revocation via JWT invalidation | CONFIRMED; **FIXED** (wording corrected in `docs/agent-wiki/topics/security-auth.md`) |
| 4 | R2 MEDIUM | Residual-list omission: the applicant pass-through on the four bare-auth routes (`auth.js` skips the check for `userType === 'applicant'`) is now a codified exemption but was unrecorded. Pre-existing, not a regression; proxy staff-surface classification rejects applicant tokens today (`proxy.js:141`) | CONFIRMED; **FIXED** (recorded in residuals below) |
| 5 | R2 LOW | Implementation-record test count for builder A was wrong (claimed 13; file had 10) | CONFIRMED; **FIXED** (counts corrected in this record) |
| 6 | R2 LOW + R1 INFO | Stale mutation-check comment in `link-profile-revocation.test.js` ("9 of 12"; the file has 11 tests) | CONFIRMED; **FIXED** in the remediation round |
| 7 | R1 INFO | `/api/health` now 503s during a Postgres outage (fail-closed health surface) | Already recorded in residuals; verified by R1 |
| 8 | R2 INFO | jwt's `if (token.azureId)` fall-through (non-applicant token without azureId keeps stale claims) is safe only because `requireAuth`'s keyless-session 403 backstops it | CONFIRMED; **recorded below** so a future edit doesn't remove the requireAuth check believing jwt covers it |
| 9 | R1 INFO | Transient signout/revocation window in createNew (DELETE→INSERT gap) | The initial **ACCEPTED** disposition was **OVERRULED and FIXED** during Codex review. `createNew` now finalizes the locked temp row in place, preserving its id and grants; it performs no DELETE or INSERT. |
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

### Independent Codex merge review and remediation

Codex then reviewed the final branch read-only and found one blocking
concurrency class the Opus passes had not discharged. Both link branches
committed the active temporary-row DELETE before securing the replacement
identity. A concurrent archive could therefore update zero rows (while
`archiveUserProfile` still returned `true`) and the link request could create
or claim an active identity. The already-recorded target-disable 409 race was
the same root defect; treating it as the owner's hard-delete residual was
incorrect because `link-profile` itself manufactured the missing row.

Justin authorized Codex to remediate the branch. The correction:

- locks the caller row and requires live `is_active = true` plus
  `needs_linking = true` inside the transaction;
- finalizes `createNew` with one conditional UPDATE of that locked row, so the
  stable profile id and its default app grants survive;
- locks the existing-profile target and performs temp DELETE + target UPDATE
  in one transaction, rolling back the DELETE on every failed target outcome;
- returns archive success only when Postgres reports `rowCount > 0`, preventing
  a concurrent identity transfer from producing a false revocation success;
- adds discriminating tests that prohibit DELETE/INSERT on createNew, require
  both row locks, require rollback after a failed post-DELETE target update,
  and pin zero-row archive failure.

The repository already ships `@vercel/postgres`'s pooled `db.connect()` API
(the exported `db` is the same lazily-created pool object the `sql` tagged
template already uses in every route — `node_modules/@vercel/postgres`
`var db = sql`) and uses explicit Postgres transactions in runtime routes
(via node-postgres pools: per-request in `pages/api/intake/submit.js` and
`lib/services/irs-bmf-service.js`; a module-memoized pool created in
`pages/api/cron/drain-submissions.js` for the drain service).
`link-profile` is the first runtime route to run a transaction on the shared
`@vercel/postgres` pool; the earlier record's claim that a serverless-route
transaction was an exceptional unsupported risk was refuted by the installed
dependency and this precedent. Codex's
complete targeted revocation run passed 91/91 tests across five suites after
the correction.

### Claude adversarial re-review of the Codex remediation (`7b8b3d95..49b4c402`)

Two further independent Opus reviewers examined commit `b85a84f9` (with the
`49b4c402` handoff), seeded with the lead's transaction-lifecycle and
provenance traces. **Verdict: no BLOCKING and no HIGH findings from either
reviewer.** Reviewer A (transaction/concurrency) confirmed: every BEGIN exit
reaches COMMIT or ROLLBACK with no flag desynchronization window; rollback
failure destroys the pooled connection (`release(err)` semantics verified in
the installed `@vercel/postgres` typings); the cross-claim deadlock aborts
pre-writePhase → 503 with nothing committed; all four archive interleavings
behave truthfully (including the load-bearing case where an archive of a
claimed-away temp id now reports failure instead of false success); the
three-way concurrent-signIn race is safe under READ COMMITTED (the DELETE and
azure_id transfer commit atomically, so there is no zero-row window and the
provisioning `ON CONFLICT` branches are unreachable during a claim); and the
91/91 five-suite run reproduces. Reviewer B (contract/tests/docs) confirmed:
exactly two `archiveUserProfile` callers, both already mapping `false` → 500,
and their UI consumers handle the error body; response contracts inert (the
linking dialog reads only `error` and reloads); scope containment exact; the
auth-mock/db mock-shape collision risk REFUTED by static and dynamic sweep
(no test co-loads both); all five regression classes (drop FOR UPDATE,
reorder COMMIT, drop rollback-on-failed-update, reintroduce DELETE/INSERT on
createNew, drop the archive rowCount check) are each pinned by a named test;
every claimed test count re-derived empirically (18/2/49/91); and the
overruled-race narrative in this record is accurate against the pre-delta
source. The lead independently re-ran the full unit suite on the reviewed
tree (`49b4c402`): 7,658/7,660 with only the two known pre-existing baseline
failures; after the second-cycle test additions below, the final tree runs
7,660/7,662 with the same two failures (both counts re-derived empirically
by the closing delta reviewer).

Second-cycle findings and dispositions:

| # | Reviewer / severity | Finding | Disposition |
|---|---|---|---|
| 11 | B F1 LOW | `docs/API_ROUTE_SECURITY_MATRIX.md` link-profile row still said "Updates/inserts" — the route no longer has an INSERT path | CONFIRMED; **FIXED** (row now states the locked live-caller check and "Updates/deletes … in one transaction (no INSERT path)") |
| 12 | B F2 + A4 LOW | Record's transaction-precedent sentence implied a runtime `db.connect()` precedent that did not exist (prior runtime transactions use per-request node-postgres pools; the only prior `db.connect()` was a script) | CONFIRMED; **FIXED** (sentence reworded: `db` is the same pool object `sql` uses; link-profile is the first runtime route transaction on the shared pool) |
| 13 | B F3 MEDIUM-LOW + A2 LOW | Self-claim path (caller POSTs its own temp-row id; the `String()` guard skips the DELETE) untested; success paths never asserted a healthy no-argument `release()` | CONFIRMED; **FIXED** (tests added: self-claim 200 with exactly one UPDATE and no DELETE, numeric and string profileId variants; healthy-release assertions on all success paths) |
| 14 | A1 LOW | `String(callerProfileId) !== String(profileId)` treats `"05"` ≠ `5` where the old SQL integer compare did not — fail-closed only (spurious 409+ROLLBACK), unreachable via the UI's select value | CONFIRMED mechanism; **ACCEPTED** (fail-closed direction; no live path) |
| 15 | B F6 INFO | The in-place `createNew` finalize incidentally FIXES a pre-existing bug: the old DELETE+INSERT minted a new profile id, orphaning the Dataverse default app grants keyed to the temp id — createNew users landed with zero grants | CONFIRMED; recorded here for attributability (grants now survive by design) |
| 16 | B F7 INFO | The durable-row `needs_linking !== true` → 403 check is a small hardening beyond the stated scope (previously only the stale JWT claim gated re-linking) | CONFIRMED; recorded — within the spirit of invariant 6 |
| 17 | B F4 INFO | First runtime transaction over the pooled Neon endpoint — reasoned sound (transaction-mode pinning holds FOR UPDATE locks; same pool `sql` uses); a one-time signed-in preview smoke of both branches would convert reasoning to observation | Recommended to owner as a pre-merge (non-blocking) smoke |
| 18 | A6/A7/B F5 INFO | Archive-failure 500 copy lacks a re-target hint; COMMIT-throw two-generals ambiguity (fail-closed 500); target-SELECT DB error now 503 instead of 500 (more accurate retryable copy) | ACCEPTED as-is; no consumer branches on these |

## Residual risks and owner decisions

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
