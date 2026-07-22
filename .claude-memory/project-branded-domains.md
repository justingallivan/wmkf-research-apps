---
name: project-branded-domains
description: External-facing comms use wmkeck.org branded domains (anti-phishing); reviewer/grantee portal base URLs are live on reviews./grantees.wmkeck.org; applications.wmkeck.org is now the LIVE staff-auth host — NEXTAUTH_URL=https://applications.wmkeck.org (cut over 2026-06-23, verified sign-in+read+write), CSRF Origin check pinned to it. The old wmkfresearch.vercel.app host now 307-REDIRECTS page navigations to applications.wmkeck.org (next.config.js host rule, S293, prod-verified; /api/* excluded → those still 403 on Origin mismatch).
metadata:
  type: project
  status: active
  scope: dev-environment
  last_verified: 2026-07-22 via live HTTP probes of four branded hosts and legacy page/API redirect behavior; authenticated write probe remains 2026-06-23
---

## Recall Rule

Read before choosing a production host, testing staff auth, or changing portal
base URLs. Staff UI belongs on `applications.wmkeck.org`; external magic-link
portals use their branded hosts. Verify runtime behavior with HTTP/browser probes,
not a Sensitive-value `vercel env pull` result.

## The strategy (owner + Codex, S271; refreshed 2026-06-23)

External-world communications (emails with magic links) should use **wmkeck.org
branded domains**, NOT `*.vercel.app` — a vercel.app link in an email to an
outside reviewer/grantee looks like phishing. Staff-facing app auth is a
separate migration because `NEXTAUTH_URL` drives OAuth callbacks and staff API
Origin/Referer checks.

## HAZARD — staff sign-in exists ONLY on applications.wmkeck.org (S326)

`reviews.wmkeck.org` (and `grantees.`/`submissions.`) are EXTERNAL-facing hosts:
token/magic-link access only, no staff users, and NOT registered as Azure
sign-in redirect URIs (owner-stated S326; consistent with the registration's
redirect-URI list below, which contains only the applications.wmkeck.org callback). The `/auth/signin` page a staff URL renders there is a
dead end BY DESIGN — "Sign in with Microsoft" cannot complete on that host.
Any browser-drive/E2E/manual check of staff UI (workbench, admin) MUST target
`https://applications.wmkeck.org`. S326 lost four browser-drive attempts to
agents treating the reviews-host sign-in page as a session problem; it is a
host-selection problem.

## State (2026-06-23)

- **`reviews.wmkeck.org`** — attached/aliased in Vercel and serving the external
  reviewer portal. `REVIEWER_PORTAL_BASE_URL=https://reviews.wmkeck.org` is set
  in Production as a non-sensitive env var and was redeployed.
- **`grantees.wmkeck.org`** — attached/aliased in Vercel and serving the external
  grantee portal. `GRANTEE_PORTAL_BASE_URL=https://grantees.wmkeck.org` is set
  in Production as a non-sensitive env var and was redeployed.
- **`submissions.wmkeck.org`** — attached/aliased in Vercel and `/apply` routes
  to the applicant sign-in flow. No separate base-url env switch was made.
- **`applications.wmkeck.org`** — attached/aliased in Vercel and **now the LIVE
  staff-auth host** (cut over 2026-06-23). Production `NEXTAUTH_URL`, the Azure
  callback, and the `lib/utils/auth.js` Origin/Referer check are aligned to it;
  an authenticated POST/DELETE probe passed at cutover. The legacy host now
  **307-redirects page navigations to `applications.wmkeck.org`** (S293,
  `next.config.js` host-conditioned `redirects()` rule, `permanent:false`,
  prod-verified: `/` and `/workbench/123?tab=foo` both redirect path+query intact).
  This runs before the `proxy.js` auth gate, so old bookmarks land on the branded
  host before they can hit the Origin-403. `/api/*` is EXCLUDED from the redirect
  (redirecting API POSTs wouldn't help — Origin still mismatches), so a stale
  old-host tab's in-flight POST/PUT/PATCH/DELETE still 403s (Origin mismatch) until
  its next navigation. Pre-S293 the host was a bare deprecation tail (GET worked,
  state-changing 403'd, sign-in funneled over). **Lesson:** the earlier "NEXTAUTH_URL is empty in prod" claim
  was WRONG — it came from `vercel env pull` reading a then-Sensitive var back as
  `""`; runtime was always `wmkfresearch.vercel.app` until this cut-over (see the
  sensitive-var trap below). Trust the runtime producer (`/api/health`), not the
  pull, for Sensitive vars.

## Host-change guardrail

The public portal variables are `REVIEWER_PORTAL_BASE_URL` and
`GRANTEE_PORTAL_BASE_URL`; staff auth is governed by `NEXTAUTH_URL` plus the
Azure redirect URI and Origin/Referer check in `lib/utils/auth.js`. Preview must
remain host-derived rather than pointing its callback at the production staff
host. For any future change: attach DNS/alias, update the matching environment,
redeploy, then probe navigation, callback, and a state-changing request. Sensitive
variables may read back empty through `vercel env pull`; see
[[reference-vercel-sensitive-env-unreadable]] and `docs/CREDENTIALS_RUNBOOK.md`.
