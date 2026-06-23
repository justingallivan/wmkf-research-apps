---
name: project-branded-domains
description: External-facing comms use wmkeck.org branded domains (anti-phishing); reviewer/grantee portal base URLs are live on reviews./grantees.wmkeck.org; applications.wmkeck.org staff-auth callback is registered and sign-in is verified, but NEXTAUTH_URL is intentionally kept empty so BOTH hosts work during the staff rollout (the flip is the later deprecation switch).
metadata:
  type: project
  status: active
  scope: dev-environment
  last_verified: 2026-06-23 via vercel alias ls + env pull + HTTPS probes + live staff sign-in on applications.wmkeck.org
---

## The strategy (owner + Codex, S271; refreshed 2026-06-23)

External-world communications (emails with magic links) should use **wmkeck.org
branded domains**, NOT `*.vercel.app` — a vercel.app link in an email to an
outside reviewer/grantee looks like phishing. Staff-facing app auth is a
separate migration because `NEXTAUTH_URL` drives OAuth callbacks and staff API
Origin/Referer checks.

## State (2026-06-23)

- **`reviews.wmkeck.org`** — attached/aliased in Vercel and serving the external
  reviewer portal. `REVIEWER_PORTAL_BASE_URL=https://reviews.wmkeck.org` is set
  in Production as a non-sensitive env var and was redeployed.
- **`grantees.wmkeck.org`** — attached/aliased in Vercel and serving the external
  grantee portal. `GRANTEE_PORTAL_BASE_URL=https://grantees.wmkeck.org` is set
  in Production as a non-sensitive env var and was redeployed.
- **`submissions.wmkeck.org`** — attached/aliased in Vercel and `/apply` routes
  to the applicant sign-in flow. No separate base-url env switch was made.
- **`applications.wmkeck.org`** — attached/aliased in Vercel and serving the app.
  The staff Azure app registration NOW INCLUDES the redirect URI
  `https://applications.wmkeck.org/api/auth/callback/azure-ad` (added 2026-06-23),
  and **staff sign-in on the branded host is verified working** (full OAuth
  round-trip). `NEXTAUTH_URL` is **intentionally kept empty** so that BOTH
  `applications.wmkeck.org` and the legacy `wmkfresearch.vercel.app` continue to
  work during the staff rollout — with `NEXTAUTH_URL` empty, NextAuth derives the
  callback from the browsing host and both hosts' callbacks are registered, so
  sign-in + writes work on either. Setting `NEXTAUTH_URL` is the **later
  deprecation switch**: it pins the flow to `applications.wmkeck.org` AND turns on
  the `lib/utils/auth.js` Origin/Referer CSRF check, after which writes from the
  old host return 403. Throw it only once staff have moved to the branded host.

## Verification trail (2026-06-23)

- Codex branch: `codex/portal-domain-hardening-2026-06-23`.
- Deployed commits: `6574f939` (external request-number hardening) and
  `13757115` (grantee copy: "Graphical Abstract Request" / "materials").
- Production deployments: `dpl_8tmRkKX9mhEpL7uU6o1NKKpMQuMb` and
  `dpl_7Mvdv1juuDTRSJXeFQaatyqEyE7M`.
- Smoke checks: fake reviewer/grantee token pages returned HTTP 200 on branded
  hosts; reviewer invite smoke succeeded after using the latest email link;
  grantee visual smoke reached the submitted confirmation state. Smoke rows,
  SharePoint image upload, approved abstract test data, and reviewer test CRM
  contact were cleaned up.

## Base-URL env vars (the switch is env-only — nothing hardcodes a domain)

- `REVIEWER_PORTAL_BASE_URL` = `https://reviews.wmkeck.org`.
- `GRANTEE_PORTAL_BASE_URL` = `https://grantees.wmkeck.org`.
- `NEXTAUTH_URL` = empty in prod (verified `NEXTAUTH_URL=""` via env pull
  2026-06-23 — the key exists, value is blank). Azure redirect URI is now
  registered and branded-host sign-in is verified, so the prerequisite is met;
  the var is held empty ON PURPOSE for the dual-host rollout. Future target is
  `https://applications.wmkeck.org`, to be set at deprecation time (after staff
  have migrated). `lib/utils/auth.js` compares state-changing request
  Origin/Referer to `NEXTAUTH_URL` — that CSRF check is therefore OFF while the
  var is empty (baseline protection is SameSite cookies); setting it turns the
  check on.

**How to apply future host changes:** point DNS at Vercel, attach/alias the host
to the project, set any matching public base URL as **non-sensitive** so it can
be verified via `vercel env pull`, then redeploy. Sensitive vars read back empty
via pull (see [[reference-vercel-sensitive-env-unreadable]]). Env contract:
`docs/CREDENTIALS_RUNBOOK.md`.
