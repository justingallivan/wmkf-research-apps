---
name: feedback-verify-deploy-is-the-merge-build
description: Before announcing a merge is live, establish the exact commit's Production deployment identity, then inspect that immutable deployment; alias readiness and recency alone are insufficient.
metadata:
  type: feedback
status: active
---

## Recall Rule
Read after any push or merge to `main`, before telling the owner something is live or launching a cron or run that must execute the new code.

Do:
1. Record the intended full commit SHA and confirm the intended project and Production target.
2. Find the matching deployment using commit metadata, then record its immutable ID/URL and verify the returned commit and target. CLI example: `vercel list --environment production --meta githubCommitSha=<full-sha> --json`. If several match, establish which deployment is intended for promotion rather than choosing an arbitrary row.
3. Inspect that immutable deployment: `vercel inspect <immutable-url> --json`. If still building, use `vercel inspect <immutable-url> --wait --timeout 90s` through the runtime's supported background/task mechanism; report a timeout or failure rather than interpreting it as readiness. Keep any later merge/redeploy/run in a separate step.
4. If no matching deployment can be established, report that identity/readiness is unknown. Do not substitute the newest row or assume a build is pending. GitHub deployment evidence may corroborate identity when present; its absence alone does not prove Vercel failed to deploy.
5. Before saying the commit is serving Production, confirm the intended production alias resolves to that deployment/commit. Ready proves build completion, not current alias ownership or authenticated application acceptance; report those checks separately.

Do not: treat an alias reporting Ready, a recent listing row, or green build checks as proof that the intended commit is serving Production.
Ground truth: commit-specific deployment metadata and immutable deployment inspection. [VERIFIED 2026-10-22 via installed CLI help only] `list` supports `--environment`, `--meta`, and `--json`; `inspect` supports `--json`, `--wait`, and `--timeout`. No deployment was queried in that check; recheck current help before relying on command syntax.

## Historical monitoring incidents

S598 (2026-10-12) established that a previous Ready build could satisfy a recency check; owner: "Your deployment checks almost never work". A home-written poller also exited 1 when its final `[ -z "$line" ] && echo …` condition was false. S601 twice hid the listing table with `2>/dev/null`, producing empty matches until timeout. Those observations explain why current guidance avoids listing-parser poll loops; they are not a guarantee of current CLI stream formatting.

`vercel inspect <production alias>` answers "is the alias Ready", not "is the merge deployed".
In S510 the alias reported Ready one minute after a merge, but that was the previous deployment;
the new build finished later, and a cron tick in between ran the old report template on a
production run.

**Historical example (S510):** Vercel kept the previous deployment aliased until the new build is Ready, and
long-running cron invocations bind to whichever deployment served their first request.

**How to apply:** follow the commit-specific procedure above. Use alias status or
the newest Production deployment only as a cross-check; neither proves that the
merge commit is deployed.
Related: [[feedback-deployment-monitoring-use-inspect]].
