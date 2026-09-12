---
name: feedback-verify-vercel-env-with-env-ls
description: A handoff or preflight saying a Vercel env var "is set" is not evidence; verify with `vercel env ls <environment>` before trusting it
metadata:
  type: feedback
  status: active
  scope: dev-environment
  last_verified: S508, 2026-09-12
---
On 2026-09-12 the Cycle Dossier page showed "The dossier pilot request cohort is not
configured" because `CYCLE_DOSSIER_REQUEST_ALLOWLIST` had never been saved in Vercel in any
environment, although the S507 handoff listed it among five vars "set in Production" and the
rollout preflight had reported all checks ready.

**Why:** the preflight script reads `process.env` of the shell it runs in; the owner had
exported the value by hand for that run, so it proved nothing about Vercel. Session
summaries then restated the shell state as deployment state.

**How to apply:** before relying on a claim that a Vercel variable exists, run
`vercel env ls <environment> | grep <NAME>` (read-only, allowed). Treat preflight scripts that
read `process.env` as proving the shell, not the platform. When handing the owner an add
command, prefer `--type config` for non-secret flags so `env ls` shows the value. See
[[reference-vercel-sensitive-env-unreadable]] and [[feedback-verify-external-platform-claims]].
