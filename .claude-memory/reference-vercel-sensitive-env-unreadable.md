---
name: reference-vercel-sensitive-env-unreadable
description: In S271, a Vercel Sensitive env var read back empty through `vercel env pull`; treat an empty pull as ambiguous and verify current platform behavior before changing the variable.
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

[VERIFIED historically via S271 production/preview `vercel env pull`
observations.] Re-check current official Vercel documentation and CLI behavior
before treating this as a platform-wide guarantee.

In S271, `vercel env pull --environment=production` returned
`DYNAMICS_IMPERSONATION_ENABLED=""` even though the owner had set it. The
production entry was Sensitive. In the same dated observation, a non-sensitive
Preview copy read back `"true"`, and recreating this non-secret boolean as
non-sensitive made its value readable through pull.

That incident proves only that an empty pull was ambiguous under the S271 CLI and
configuration. It does not prove current API behavior for every Sensitive variable.

**How to apply:**
- Do not interpret an empty pulled value as proof that the variable is unset.
- Before changing it, consult current official Vercel documentation and inspect the
  current project's environment metadata.
- Recreating as non-sensitive is appropriate only for a confirmed non-secret flag
  and only with explicit authorization; credentials remain Sensitive.

Related: [[feedback-deployment-monitoring-use-inspect]].
