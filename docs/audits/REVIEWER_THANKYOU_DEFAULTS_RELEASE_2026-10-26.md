---
title: Automatic reviewer thank-you defaults — release verification
domain: reviewers
kind: audit
status: active
summary: "PR533 merged a9e9b4de6 after all CI passed; Vercel production deployment Gpf9cxvPdMihsfKrKubFWQNM3sdk READY and aliased. Signed-out availability/auth checks passed; no live preference mutation or email send performed."
owner: product-engineering
related:
  - docs/audits/REVIEWER_THANKYOU_DEFAULTS_BUILD_2026-10-26.md
  - docs/audits/REVIEWER_THANKYOU_DEFAULTS_IMPLEMENTATION_CLAUDE_REREVIEW_2026-10-26.md
---

# Release verification — 2026-10-26

[VERIFIED via GitHub PR/commit status and Vercel CLI.] Justin authorized merge
when CI passed. All checks on `faab57aaf` passed: Jest, Postgres integration,
Playwright, Claude review, CodeQL, Semgrep, Trivy, Gitleaks and Vercel preview.
[PR #533](https://github.com/justingallivan/wmkf-research-apps/pull/533) merged at
2026-10-26T16:54:51Z as `a9e9b4de61cc544f1cdcf52cb7670dd5dc2fdde6`.
GitHub's Vercel commit status reports Deployment has completed.

`vercel inspect Gpf9cxvPdMihsfKrKubFWQNM3sdk` reports production READY, deployment
`dpl_Gpf9cxvPdMihsfKrKubFWQNM3sdk`, URL
https://wmkfresearchapps-53h7ioofs-justin-gallivans-projects.vercel.app, including
applications.wmkeck.org, reviews.wmkeck.org, grantees.wmkeck.org,
submissions.wmkeck.org and wmkfresearch.vercel.app aliases. Build duration 1m19s.
Inspection identifies output build `build-TfctsWXpff2fKS`.

[VERIFIED via signed-out HTTP GET.] Both /profile-settings and the new
/api/reviewer-thankyou-email-preferences on wmkfresearch.vercel.app return 307,
then the applications.wmkeck.org sign-in screen (HTTP200) with the requested path
as callbackUrl. This proves public availability and access protection, not a
signed-in end-to-end mutation or delivery.

[VERIFIED via Vercel runtime log query.] Error-level query for this deployment,
2026-10-26T16:42:24.975Z–17:42:24.975Z, returned zero records, no excluded intervals,
no further page. This is bounded telemetry, not proof of no future/runtime faults.

No live preference/shared-setting write, cron invocation, test email, migration,
loader, environment change or schema probe was performed. Claude's other checkout
and database work were untouched. Existing corpus/migration090 changes already
on main were preserved unchanged. No claim of real inbox/tenant acceptance.

Rollback reference: preceding main `5e004b04137fe2c3b9c10cee261407ead26d8537`.
If needed, explicitly authorize a source revert or Vercel rollback; neither would
undo stored preferences or previously claimed/sent email effects. No rollback run.
