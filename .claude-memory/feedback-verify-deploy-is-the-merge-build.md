---
name: feedback-verify-deploy-is-the-merge-build
description: Before announcing a merge is live, confirm the newest production deployment was created after the merge commit and is Ready; an alias reporting Ready may still be the previous build (S510, 2026-09-13).
metadata:
  type: feedback
status: active
---

## Recall Rule
Read after any push or merge to `main`, before telling the owner something is live or launching a cron or run that must execute the new code.

Do: `vercel ls`, take the newest `target production` deployment, confirm its `created` time is after the merge commit and its status is Ready.
Do not: treat `vercel inspect <alias>` reporting Ready as proof the merge deployed.
Ground truth: `vercel ls`; the GitHub deployments API for the merge commit.

`vercel inspect <production alias>` answers "is the alias Ready", not "is the merge deployed".
In S510 the alias reported Ready one minute after a merge, but that was the previous deployment;
the new build finished later, and a cron tick in between ran the old report template on a
production run.

**Why:** Vercel keeps the previous deployment aliased until the new build is Ready, and
long-running cron invocations bind to whichever deployment served their first request.

**How to apply:** after a merge, list deployments (`vercel ls`), pick the newest with
`target production`, check its `created` time is after the merge commit's time, and wait for its
status to be Ready. Only then tell the owner to launch anything that must run the new code.
Related: [[feedback-deployment-monitoring-use-inspect]].
