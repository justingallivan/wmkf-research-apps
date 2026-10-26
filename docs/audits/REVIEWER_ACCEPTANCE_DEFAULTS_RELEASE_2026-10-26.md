---
title: Reviewer acceptance defaults — release verification
domain: reviewers
kind: audit
status: active
summary: "PR534 merged8b02e8467 after all CI passed; production BsvYSDRZBEGVAwkNknvJJsbyes8v READY and aliased. Public settings assets and signed-out protection verified; zero error records in inspected window. No live preference write or email send."
owner: product-engineering
related:
  - docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_BUILD_2026-10-26.md
  - docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_IMPLEMENTATION_CLAUDE_REREVIEW_2026-10-26.md
---

# Release verification — 2026-10-26

[VERIFIED via GitHub PR/checks and Vercel inspection.] Justin authorized release
once CI passed. All checks on reviewed head d907328e5c0cd2c7ad79c62b7fe763e68dcb3d51
passed: Jest (9m6s), Playwright, PostgreSQL16 integration, Claude review, CodeQL,
Semgrep, Trivy, Gitleaks and Vercel preview. Independent code review PASS at
0ac9ce254; later pre-release changes were documentation only.

[PR #534](https://github.com/justingallivan/wmkf-research-apps/pull/534) merged at
2026-10-26T18:50:15Z as `8b02e84679f2c6294f87385829dc839233c27b53`.
GitHub's Vercel commit status reports success for production deployment
`dpl_BsvYSDRZBEGVAwkNknvJJsbyes8v`:
https://wmkfresearchapps-3t7ef9i2o-justin-gallivans-projects.vercel.app.
Vercel inspect reports READY, production; inspecting the active
wmkfresearch.vercel.app alias returns that exact deployment. Aliases include
applications.wmkeck.org, reviews.wmkeck.org, grantees.wmkeck.org,
submissions.wmkeck.org and wmkfresearch.vercel.app.

## Read-only production probe

[VERIFIED via `scripts/probe-acceptance-defaults-deployment.mjs` at 2026-10-26T18:53:50.452Z.]
Canonical applications.wmkeck.org: sign-in HTTP200; /profile-settings and
/api/reviewer-acceptance-email-preferences both return signed-out HTTP307
redirects to sign-in. The public build manifest and four profile-settings asset
chunks contain the new preference endpoint, acceptance-subject label and
pending/uncertain discard-warning text. BuildId `build-TfctsWXpff2fKS` is metadata,
not independently a commit proof; GitHub deployment status and active alias bind
the release identity. Probe supports Vercel's static/immutable/chunks packaging
and never executes downloaded JavaScript.

[VERIFIED via Vercel runtime logs.] Error-level query scoped to this deployment,
2026-10-26T18:37:21.170Z–2026-10-26T18:52:21.170Z, returned zero records,
no excluded intervals and no further page. This is a bounded early error scan,
not proof of no future faults.

No authenticated live preference mutation, real acceptance action, cron invocation,
email, migration, loader, environment change or direct database command was run.
The probe uses public GETs/assets with no cookies or credentials. No live inbox or
signed-in Save/Clear acceptance is claimed. Pre-release evidence remains421
focused tests,3 scratch-Postgres cases and15 fixture browser cases plus CI.
The owned scratch database was removed before release; Claude's other checkout,
pre-existing database and committed corpus/report/migration work remain untouched.

## Rollback and retained limits

Pre-release production reference: `1a908ba6e86058f702f2689335a9bca47ee5bbb4`,
`dpl_2NLNbbbcW9jwPogRjw9ETcbBZxEz`, READY at
https://wmkfresearchapps-aednfz9e0-justin-gallivans-projects.vercel.app.
An explicitly authorized Vercel rollback/source revert can restore code but cannot
undo saved defaults, claims or emails. No rollback was performed.

Keep the reviewed finite-retry/manual-repair limits, independent signature lookup,
outside-drain stale-alert limit and at-most-once postclaim behavior described in
the build receipt. No schema change or data repair was needed for rollout.

## Bounded fact reconciliation

Sweep Mode A: release state only. Authoritative PR/checks/deployment/probe evidence
above updates the route matrix, preference Atlas, service catalog and slice
inventory/TODO. Build and plan receipts are explicitly historical pre-release
contracts with links to this dated release proof. Prior independent review reports
remain verbatim historical evidence. Unrelated Duncan/Connor and corpus/database
facts are excluded. API/Atlas/doc-currency/facts/symbol/build-claim gates and sequential self-tests,
docs catalog, secret scan/self-test, probe syntax/lint and whitespace checks
passed before the closeout commit.
