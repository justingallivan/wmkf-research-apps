---
name: reference-vercel-sensitive-env-unreadable
description: Vercel "Sensitive" env vars are write-only — `vercel env pull` / the API return them as EMPTY, so you cannot verify their value via pull. Recreate as non-sensitive (for non-secret flags) to make them readable.
metadata:
  type: reference
  status: active
  scope: dev-environment
  last_verified: S271 via vercel env pull across prod/preview
---

## Recall Rule

Read this when verifying a Vercel environment variable's VALUE (not just presence) via
`vercel env pull` / `vercel env ls` — especially a boolean feature flag like
`DYNAMICS_IMPERSONATION_ENABLED`.

## The gotcha (S271)

`vercel env pull --environment=production` returned `DYNAMICS_IMPERSONATION_ENABLED=""`
(empty) even though the owner had set it. Cause: it was created as a **Sensitive** Vercel
env var. **Sensitive vars are write-only** — Vercel never returns their value through
`env pull` or the API; they read back as empty/absent. So an empty pull does NOT mean the
var is unset — it may be set-but-sensitive.

- `vercel env ls` shows the var exists ("Encrypted") but not whether it's Sensitive vs
  plaintext, and not the value.
- A **non-sensitive** var IS readable via pull (Preview's copy read back `"true"`).
- Fix used: delete + recreate the flag as **non-sensitive** (safe — it's a boolean feature
  flag, not a credential). Real secrets (`DYNAMICS_CLIENT_SECRET` etc.) stay Sensitive.

**How to apply:**
- To VERIFY a non-secret flag's value, ensure it's non-sensitive, then `vercel env pull
  --environment=<env>` and grep the one line. Pull into a temp file, read only the target
  var, delete the temp file.
- Env-var changes only take effect on a NEW deployment (the stored value shows in pull
  immediately, but the running deployment keeps its build-time value until redeployed).
- A var can have **per-environment** entries (Production / Preview / Development) AND
  branch/custom-environment overrides — check `vercel env ls` for duplicate rows across
  environments; a "dangling" leftover often lives in Preview. Remove with
  `vercel env rm <NAME> <environment> --yes`.

Related: [[feedback-deployment-monitoring-use-inspect]].
