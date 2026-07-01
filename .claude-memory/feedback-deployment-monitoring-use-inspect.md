---
name: feedback-deployment-monitoring-use-inspect
description: "When checking a Vercel deploy after a push, use `vercel inspect <deployment-url>` (deterministic `status ● Ready/Building/Error`), NOT a poll loop that greps `vercel ls` for the deployment hash. The hash-grep match silently fails when the listing format/row shifts, so the loop reads 'pending' forever and burns the full timeout — waiting minutes on a signal that never comes. Deploys here finish in well under 40s."
metadata: 
  node_type: memory
  type: feedback
  status: active
  scope: global
  last_verified: 2026-06-18 via session-feedback
  originSessionId: a647b42e-0a37-4ef2-8e1d-ee1f87fb8990
---

## Rule

After `git push` triggers a Vercel production deploy (or after `vercel deploy`), confirm
readiness with `vercel inspect <deployment-url>` — it prints `status\t● Ready` (or Building /
Error / Queued) deterministically. Parse that.

**Why:** S267, repeatedly. My monitoring loops did `for i in …; do vercel ls | grep "<hash>" |
grep -oE "Building|Ready|Error"; sleep 15; done`. The `grep "<hash>"` regularly matched nothing
(the `vercel ls` table wraps/reorders rows, or the building deployment's row isn't in the default
window, or `vercel ls` emits no parseable line for that hash at that moment), so every iteration
printed "pending" and the loop ran to its full multi-minute cap — even though the deploy was
Ready in ~30s. Justin flagged it: "you're waiting on a signal that never comes." Even
`vercel ls | grep Production` returned empty intermittently.

**How to apply:**
- Prefer `vercel inspect <url>` for a one-shot status check; the URL comes from the `git push`
  output's deployment or from one `vercel ls` (grab the newest production URL once).
- If you must wait, key the loop on `vercel inspect`'s `status` line, cap the TOTAL wait LOW
  (~90s, deploys are <40s), and treat an unparseable/empty result as "re-check," never as a
  reason to keep sleeping to the cap.
- Do NOT build a poll loop around `grep "<deployment-hash>"` of `vercel ls` — that's the fragile
  pattern that fails.
- Better still: a `git push` to the default branch USUALLY auto-deploys; a single `vercel inspect`
  after a short pause usually suffices — don't over-poll.
- **Caveat (S311, 2026-07-01): the git→Vercel webhook can silently NOT fire.** A push to `main`
  landed on origin but triggered NO build (newest deployment stayed ~1h old, nothing Building/
  Queued). Git integration WAS connected (deploys carry the `…-git-main-…` alias; `vercel git
  connect/disconnect` exist) and `vercel.json` had no ignore rule — it was a transient missed
  webhook. So after a push, if `vercel ls`/`inspect` shows no new deployment for your commit,
  don't assume it's still building — RECOVER by triggering it manually: `vercel --prod` (builds+
  deploys the clean local checkout = the pushed commit; run by the user in-session — the auto-mode
  classifier blocks agent-initiated prod deploys). The Git settings live under Vercel → Settings →
  **Build and Deployment** (Vercel folded the old standalone "Git" page in there).
