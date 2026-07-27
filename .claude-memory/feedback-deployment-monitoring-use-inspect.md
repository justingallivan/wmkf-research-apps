---
name: feedback-deployment-monitoring-use-inspect
description: "When checking a Vercel deploy after a push, inspect the deployment directly rather than polling a fragile grep over the deployment listing; re-check current CLI output before parsing it."
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: global
  last_verified: 2026-06-18 via session-feedback
  originSessionId: a647b42e-0a37-4ef2-8e1d-ee1f87fb8990
---

## Recall Rule

After a push or explicit deployment, identify the deployment URL once and inspect
that deployment directly. Do not base readiness on a listing-row grep.

[VERIFIED historically via S267 and S311 CLI observations.] In those sessions,
`vercel inspect <deployment-url>` exposed a direct status while `vercel ls` row
matching intermittently returned nothing. The exact status formatting and observed
deployment durations below are dated; inspect current output before parsing it.

**Why:** S267, repeatedly. My monitoring loops did `for i in …; do vercel ls | grep "<hash>" |
grep -oE "Building|Ready|Error"; sleep 15; done`. The `grep "<hash>"` regularly matched nothing
(the `vercel ls` table wraps/reorders rows, or the building deployment's row isn't in the default
window, or `vercel ls` emits no parseable line for that hash at that moment), so every iteration
printed "pending" and the loop ran to its full multi-minute cap — even though the deploy was
Ready in ~30s. Justin flagged it: "you're waiting on a signal that never comes." Even
`vercel ls | grep Production` returned empty intermittently.

**How to apply:**
- Prefer a direct deployment inspection for a one-shot status check; obtain the URL
  from the current deployment output or a single listing lookup.
- If waiting is necessary, use the current inspection output rather than assuming
  the S267 status format or timing. Treat empty/unparseable output as unknown.
- Do NOT build a poll loop around `grep "<deployment-hash>"` of `vercel ls` — that's the fragile
  pattern that fails.
- **Historical caveat (S311, 2026-07-01): the git→Vercel webhook did not fire once.** A push to `main`
  landed on origin but triggered NO build (newest deployment stayed ~1h old, nothing Building/
  Queued). Git integration WAS connected (deploys carry the `…-git-main-…` alias; `vercel git
  connect/disconnect` exist) and `vercel.json` had no ignore rule — it was a transient missed
  webhook. If current inspection shows no deployment for the pushed commit, report
  that absence rather than assuming a build is pending; any manual production
  deployment still requires the user's authorization and current runbook.
