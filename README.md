# WMKF Document Processing Multi-App System

A Next.js application (deployed on Vercel) hosting a suite of Claude-AI tools for
the W. M. Keck Foundation's grant workflows — proposal summarization, multi-perspective
evaluation, reviewer finding/management, integrity screening, natural-language CRM
queries, an applicant intake portal, and more. Each "app" is a thin adapter (input
gathering + output routing) around a prompt; the architecture is converging on shared,
Dataverse-backed prompts (see `docs/SYSTEM_MODEL.md`), though most apps still run bundled
in-repo prompts today.

> **Start here for the why, not just the what:** `docs/SYSTEM_MODEL.md` is the canonical
> conceptual model (the rote-vs-thinking principle, the two orthogonal axes, capabilities
> vs. trunk vs. substrate, the two interaction modes, and a **Glossary** defining the
> load-bearing terms — Executor, Mode 1/Mode 2, drain, slice-0, thin adapter). Read it
> before cross-capability work.
>
> **Conventions, architecture, and the per-app catalogue** live in `CLAUDE.md` (the single
> canonical agent-instruction surface) and `DEVELOPMENT_LOG.md` (session-by-session history).

API keys (Claude and others) are **server-side only** — they are never entered in the UI.
For the optional research integrations, `/api/api-capabilities` exposes booleans
(ORCID / NCBI / SerpAPI availability) so the UI can show/hide features without seeing keys.
Authentication is Microsoft Entra ID (Azure AD) via NextAuth with a server-side proxy gate.

## Setup Instructions

1. Clone the repository and connect it to a Vercel project.
2. Provision the required environment variables (full list, defaults, and rotation cadence
   in `docs/CREDENTIALS_RUNBOOK.md`). For core boot/auth/basic AI: `CLAUDE_API_KEY`,
   `POSTGRES_URL`, and the NextAuth/Azure AD set (`NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
   `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`, `AUTH_REQUIRED`).
   Dataverse-backed routes additionally require the `DYNAMICS_*` set (URL, tenant, client,
   secret); other capabilities have their own vars (see the runbook).
3. `npm install`, then `node scripts/apply-migrations.js` on any existing environment
   (`scripts/setup-database.js` is fresh-install-only — see `CLAUDE.md`).
4. `npm run dev` to run locally, or deploy to Vercel.

## Usage

The deployed site presents the apps the signed-in user has been granted (nav is filtered by
app access). Each app's user-facing guide lives in `docs/guides/`.

## Authentication

NextAuth with two providers: `azure-ad` for staff and `entra-external` for applicants
(the intake portal). A server-side proxy (`proxy.js`) validates the session before any
page or bundle is served — unauthenticated users never see the app — and the kill switch
`AUTH_REQUIRED` fails closed in production. Full setup (Azure app registration, both
tenants, the three-layer defense-in-depth) is in `docs/AUTHENTICATION_SETUP.md`.

Quick local start:
1. Register an app in the Azure Portal and obtain client/secret/tenant IDs.
2. Copy `.env.local.example` to `.env.local` and fill in the values, including
   `NEXTAUTH_URL` and `NEXTAUTH_SECRET` (`openssl rand -base64 32`).
3. `npm run dev` — sign-in appears where required.

Key files:
- `pages/api/auth/[...nextauth].js` — dual-provider NextAuth route
- `proxy.js` — server-side auth gate + CSP nonce (Next 16 proxy convention)
- `lib/utils/auth.js` — API-route guards (`requireAppAccess`, `requireAuthWithProfile`, …)

Deploy to Vercel and set the environment variables in the project settings.
