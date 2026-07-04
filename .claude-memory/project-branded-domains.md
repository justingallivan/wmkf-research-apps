---
name: project-branded-domains
description: External-facing comms use wmkeck.org branded domains (anti-phishing); reviewer/grantee portal base URLs are live on reviews./grantees.wmkeck.org; applications.wmkeck.org is now the LIVE staff-auth host — NEXTAUTH_URL=https://applications.wmkeck.org (cut over 2026-06-23, verified sign-in+read+write), CSRF Origin check pinned to it. The old wmkfresearch.vercel.app host now 307-REDIRECTS page navigations to applications.wmkeck.org (next.config.js host rule, S293, prod-verified; /api/* excluded → those still 403 on Origin mismatch).
metadata:
  type: project
  status: active
  scope: dev-environment
  last_verified: 2026-06-23 via live runtime /api/health probe + authenticated write probe (POST/DELETE 200) on applications.wmkeck.org
---

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
host-selection problem. Also from S326: the portal is being built AHEAD of the
D26 cycle — zero reviews have ever been submitted through it, so populated
review-consumption UI (Compare/Export) cannot be verified against real data
until the first real or staged submission.

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
  staff-auth host** (cut over 2026-06-23). The staff Azure app registration
  ("WMK: SSO Authentication", client `a652a292-2574-434c-ae6f-aa01f61d82ad`)
  includes the redirect URI
  `https://applications.wmkeck.org/api/auth/callback/azure-ad`, and
  `NEXTAUTH_URL=https://applications.wmkeck.org` is set in Production (non-sensitive
  now). VERIFIED via live probe: runtime `/api/health` reports the branded host,
  and an authenticated write probe on the branded host returned POST/DELETE 200
  (preference persisted + cleaned up). So sign-in + reads + writes all work on the
  branded host, and the `lib/utils/auth.js` Origin/Referer CSRF check is ON, pinned
  to `applications.wmkeck.org`. The legacy `wmkfresearch.vercel.app` host now
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
- `NEXTAUTH_URL` = `https://applications.wmkeck.org` in **Production** (set
  2026-06-23, now non-sensitive). `lib/utils/auth.js` compares state-changing
  request Origin/Referer to `NEXTAUTH_URL`, so the CSRF check is ON and pinned to
  the branded host; writes from any other host (incl. `wmkfresearch.vercel.app`)
  403. Do NOT trust `vercel env pull` history here — while it was Sensitive the
  pull read back `""`, which produced a months-long false "empty in prod" belief;
  the real runtime value (`wmkfresearch.vercel.app` before, `applications.wmkeck.org`
  now) only shows via the runtime `/api/health` producer.
- **Preview caveat:** `NEXTAUTH_URL` was ALSO set to `https://applications.wmkeck.org`
  in the **Preview** environment on 2026-06-23. That likely breaks preview
  deployments (preview sign-in callback would target the prod host, and preview-URL
  writes 403 on Origin mismatch). Preview previously had no `NEXTAUTH_URL`
  (host-derived, matching the registered `wmkfresearchapps-preview.vercel.app`
  callback). RESOLVED 2026-06-23: `NEXTAUTH_URL` was removed from Preview via
  `vercel env rm NEXTAUTH_URL preview`; it now scopes to Production only (verified
  via `vercel env ls`), so Preview is back to host-derived.

**How to apply future host changes:** point DNS at Vercel, attach/alias the host
to the project, set any matching public base URL as **non-sensitive** so it can
be verified via `vercel env pull`, then redeploy. Sensitive vars read back empty
via pull (see [[reference-vercel-sensitive-env-unreadable]]). Env contract:
`docs/CREDENTIALS_RUNBOOK.md`.
