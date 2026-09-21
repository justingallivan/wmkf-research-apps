---
title: Agenda and D1 sequential release record
domain: platform
kind: plan
status: complete
summary: Owner-authorized agenda then D1 production releases, read-only smoke evidence, CI and rollback targets.
owner: product-engineering
related:
  - docs/plans/AGENDA_SEND_REFUSAL_FIX_2026-09-20.md
  - docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Agenda and D1 release — 2026-09-20 PT

Owner authorization: "Do it in the suggested order" after the proposed sequence
of agenda release and verification, then D1 release and verification. Both
candidates were built by Luna, reviewed by Sol, and adjudicated by root.

## Production releases

[VERIFIED via Git push, Vercel deployment API commit metadata and production aliases]

| Order | Candidate | Main merge | Ready production deployment |
|---|---|---|---|
| 1: agenda | `eed5e458c` | `301d4d141` | `dpl_HoTApcaJCeMFaJEZFHeHWwdfSJZy` / `wmkfresearchapps-akddtnis5-justin-gallivans-projects.vercel.app` |
| 2: D1 + D9 | `3a81b38a4` | `8623c2f7b` | `dpl_9rNyDMfuEMHPHo6ndSNh3di9d9eQ` / `wmkfresearchapps-8n81ppyo3-justin-gallivans-projects.vercel.app` |

Each deployment was verified on the staff `applications.wmkeck.org` and external
`reviews.wmkeck.org` / `grantees.wmkeck.org` aliases through the Vercel API. D1
was pushed only after the agenda deployment's read-only smoke and all five
GitHub CI workflows succeeded.

## Evidence and limits

- Agenda: 4 focused suites / 56 tests passed; red-first refusal regression,
  scoped lint, types and documentation gates passed.
- D1: 6 focused suites / 66 tests passed before release; Sol review accepted.
- Combined merge: 8 focused suites / 103 tests passed; types, doc-currency and
  self-test, docs-catalog, doc-symbol-refs and self-test, and diff checks passed.
- Agenda CI: Tests, E2E (Playwright), Security Scan, Secret Scanning and
  Dependency Scan all succeeded at `301d4d141` (Tests run `35551922914`).
- D1 CI: full Tests run `35552232599`, browser E2E and the three
  security/dependency workflows succeeded. GitHub's additional CodeQL
  "Push on main" run `35552232453` was still analyzing JavaScript/TypeScript
  at the closeout snapshot (Python and Actions analyses passed).
- [VERIFIED via signed-in Chrome] Agenda deployment: canonical staff sign-in,
  Workbench and Meeting Tracker list loaded; an existing session loaded its
  agenda sent status and send-again control. Starting sign-in from the reviews
  host gave an OAuthCallback error; retry on the canonical staff host succeeded.
- [VERIFIED via signed-in Chrome] D1 deployment: Scheduled Emails settled to
  "No scheduled emails"; Explorer's role settled from Read Only to Superuser;
  Virtual Review Panel replaced default provider values with loaded availability.
  Empty-queue posture controls were not visible, so their behavior remains
  test-covered. No production failure was deliberately induced.
- Vercel error-level log queries on each exact deployment returned no entries
  during the smoke window. This is a bounded observation, not continuous monitoring.

Mode A mocks cover refusal, uncertainty, stale completions and recovery. Live
checks were read-only. No real email, model run, schema/configuration change,
or business-data edit was performed. No flags/cohorts changed. Expected durable
business writes from this release procedure: none; normal app behavior is unchanged.

## Rollback

Operator: owner or delegated releasing agent. Repoint deployment aliases with:

- Undo D1 while retaining agenda: `vercel rollback dpl_HoTApcaJCeMFaJEZFHeHWwdfSJZy --yes`.
- Undo both: `vercel rollback dpl_4ajtSM8j27stSVmJJYef8ZF6hxBf --yes` (pre-release
  Ready deployment `wmkfresearchapps-gg4hywnlt-justin-gallivans-projects.vercel.app`).

Then verify aliases, staff sign-in and the affected read path. Coordinate a
reviewed Git revert before another main push so automation does not republish
the reverted behavior. This is a code rollback; it does not undo emails or other
normal business writes occurring independently of the release.
