---
name: feedback-verify-deploy-is-the-merge-build
description: Before announcing a merge is live, find the production deployment by commit SHA (vercel ls --prod -m githubCommitSha=<sha>) and confirm it is Ready; an alias reporting Ready may still be the previous build (S510, 2026-09-13).
metadata:
  type: feedback
status: active
---

## Recall Rule
Read after any push or merge to `main`, before telling the owner something is live or launching a cron or run that must execute the new code.

Do: identify the deployment by commit, not by recency — `vercel ls --prod -m githubCommitSha=$(git rev-parse <merge-sha>)` lists only the build of that commit; report its URL and status. If it is still building, poll that same filtered command until Ready/Error. Never poll "newest Production row is Ready": an earlier build that is already Ready satisfies it immediately (owner, 2026-10-12, S598: "Your deployment checks almost never work").
Polling script pitfall (S598): a loop ending in `[ -z "$line" ] && echo …` exits 1 when a deployment WAS found, so the background task reports "failed"; end it with `if [ -z "$line" ]; then …; fi` or an explicit `exit 0`.
Second pitfall (S601, twice): `vercel ls` prints its table to **stderr**, so `vercel ls ... 2>/dev/null | grep` never matches and the loop runs to its timeout although the build is Ready. Pipe with `2>&1`, and match the row by `Production` + status, not the bare URL line (the trailing URL line carries no status).
(Older method, still valid as a cross-check: the newest `target production` deployment's `created` time is after the merge commit and its status is Ready.)
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
