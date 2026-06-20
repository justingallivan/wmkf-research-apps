---
name: project-branded-domains
description: External-facing comms use wmkeck.org branded domains (anti-phishing); reviews./applications.wmkeck.org are set up but unused; grantees.wmkeck.org is planned-not-yet-provisioned; grantee portal runs on wmkfresearch.vercel.app in the interim via GRANTEE_PORTAL_BASE_URL.
metadata:
  type: project
  status: active
  scope: dev-environment
  last_verified: S271 via vercel alias ls + env pull
---

## The strategy (owner + Codex, S271)

External-world communications (emails with magic links) should use **wmkeck.org
branded domains**, NOT `*.vercel.app` — a vercel.app link in an email to an
outside reviewer/grantee looks like phishing. The app itself currently lives at
**`https://wmkfresearch.vercel.app`** (the working production URL).

## State (S271)

- **`reviews.wmkeck.org`** (staff/reviewer app) and **`applications.wmkeck.org`**
  (applicant/intake) — **set up (aliased in Vercel) but NOT yet in use**; they do
  not resolve publicly yet (DNS not pointed). The earlier "reviews.wmkeck.org
  confirmed live S270" note was WRONG — aliased ≠ serving.
- **`grantees.wmkeck.org`** (grantee deliverables portal) — **PLANNED, not yet
  provisioned** (owner can't get it today). For now the grantee portal uses
  `wmkfresearch.vercel.app`.

## Base-URL env vars (the switch is env-only — nothing hardcodes a domain)

- `REVIEWER_PORTAL_BASE_URL` = `https://wmkfresearch.vercel.app` now → `reviews.wmkeck.org` later.
- `GRANTEE_PORTAL_BASE_URL` = `https://wmkfresearch.vercel.app` now (set S271, **non-sensitive**)
  → **`https://grantees.wmkeck.org` when it exists**. Code resolves
  `GRANTEE_PORTAL_BASE_URL ‖ NEXTAUTH_URL ‖ ''`; NEXTAUTH_URL is empty in prod, so this
  MUST be set or grantee magic-links are hostless/broken.
- `NEXTAUTH_URL` empty in prod (auth uses VERCEL_URL fallback); set to the stable custom
  domain once branded domains are live for robust auth callbacks.

**How to apply (when a branded domain goes live):** point DNS at Vercel, then swap the
matching `*_PORTAL_BASE_URL` env var (non-sensitive, so it stays verifiable via
`vercel env pull`) and redeploy. No code change. ⚠️ Set Vercel env vars **non-sensitive**
for these non-secret URLs — sensitive vars read back empty via pull (see
[[reference-vercel-sensitive-env-unreadable]]). Env contract: `docs/CREDENTIALS_RUNBOOK.md`.
