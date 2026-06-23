---
name: project-branded-domains
description: External-facing comms use wmkeck.org branded domains (anti-phishing); reviewer/grantee portal base URLs are live on reviews./grantees.wmkeck.org; applications.wmkeck.org staff auth is held pending Azure redirect validation.
metadata:
  type: project
  status: active
  scope: dev-environment
  last_verified: 2026-06-23 via vercel alias ls + env pull + HTTPS probes
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
- **`applications.wmkeck.org`** — attached/aliased in Vercel and serving the app,
  but the staff-auth migration is intentionally HELD. `NEXTAUTH_URL` remains
  empty in Production until the staff Azure app registration allows
  `https://applications.wmkeck.org/api/auth/callback/azure-ad` and a staff
  sign-in + state-changing staff API action are smoke-tested.

## Base-URL env vars (the switch is env-only — nothing hardcodes a domain)

- `REVIEWER_PORTAL_BASE_URL` = `https://reviews.wmkeck.org`.
- `GRANTEE_PORTAL_BASE_URL` = `https://grantees.wmkeck.org`.
- `NEXTAUTH_URL` = empty in prod for now. Future target is
  `https://applications.wmkeck.org`, but only after Azure redirect URI validation
  and smoke tests; `lib/utils/auth.js` compares state-changing request
  Origin/Referer to `NEXTAUTH_URL`.

**How to apply future host changes:** point DNS at Vercel, attach/alias the host
to the project, set any matching public base URL as **non-sensitive** so it can
be verified via `vercel env pull`, then redeploy. Sensitive vars read back empty
via pull (see [[reference-vercel-sensitive-env-unreadable]]). Env contract:
`docs/CREDENTIALS_RUNBOOK.md`.
