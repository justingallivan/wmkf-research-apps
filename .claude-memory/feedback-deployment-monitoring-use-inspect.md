---
name: feedback-deployment-monitoring-use-inspect
description: "Waiting on a deploy or on PR checks: use the tool's own blocking wait (vercel inspect --wait, gh pr checks --watch) in a background command and act on the completion notification; never a home-rolled foreground poll loop that parses listings and merges in the same call."
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: global
  last_verified: 2026-09-12 (S509) — owner: "Your tracking of deploys keeps failing. They finish and you don't notice them."
  originSessionId: a647b42e-0a37-4ef2-8e1d-ee1f87fb8990
---

## Recall Rule

After a push or explicit deployment, establish the intended commit's immutable
deployment identity using [[feedback-verify-deploy-is-the-merge-build]], then
inspect that deployment directly. That note owns deployment identification;
this note owns waiting and the historical reasons to avoid parser loops.

**Recurrence S597 (2026-10-12):** two more home-rolled loops. (1) Polling GitHub commit statuses for a
Vercel context: for these `main` pushes GitHub recorded **no** Production deployment or status at all,
so the loop could never finish. (2) A `vercel ls | grep Production` loop the owner interrupted
("what are you waiting for?"). A single `vercel ls --prod` showed the deploy Ready within a minute.
That session used a newest-row lookup. S598 subsequently showed why recency was
insufficient; current identification must follow the commit-specific procedure
above before waiting on the immutable deployment.

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

**Recurrence (S509, 2026-09-12):** the same failure class on `gh pr checks`. I wrapped
`gh pr checks <n>` in a `for … sleep 10` loop with tab-field parsing, ran it as one
foreground Bash call (up to 15 min) and chained `gh pr merge` onto it. The owner:
"Your tracking of deploys keeps failing. They finish and you don't notice them. I
think you need a new strategy." The strategy that replaces it, for every wait on
external state:
1. Use the tool's own wait primitive: `gh pr checks <n> --watch --fail-fast` (exits
   when checks finish), `vercel inspect <url> --wait` (blocks until the deploy
   completes), `gh run watch <id>`.
2. Use the current runtime's supported background/task mechanism and bounded waits,
   keeping the owner informed. `run_in_background: true` was the Claude tool syntax
   in S509, not a universal parameter for other runtimes.
3. Merge / redeploy / verify in a SEPARATE step after the notification, never in
   the same command as the wait.

**How to apply:**
- For a one-shot status check, inspect the immutable deployment whose commit,
  target, and project were established through the identity note above.
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
