---
title: Credentials Runbook
domain: security-auth
kind: runbook
status: canonical
summary: "*Quick reference for managing environment variables, rotating secrets, and diagnosing auth failures.*."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-09-03
owner: product-engineering
related:
  - lib/utils/auth.js
  - lib/services/external-token.js
  - docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md
  - shared/config/baseConfig.js
---

# Credentials Runbook

*Quick reference for managing environment variables, rotating secrets, and diagnosing auth failures.*

## What Expires

Three configured client secrets have vendor expiration dates. Other tracked
secrets and API keys are stable until manually rotated unless their provider
changes that policy.

| Credential | Expires | Where to Check |
|------------|---------|----------------|
| `AZURE_AD_CLIENT_SECRET` | Yes — 6mo, 1yr, or 2yr from creation | Azure Portal → App registrations → *Keck Research Tools* → Certificates & secrets |
| `DYNAMICS_CLIENT_SECRET` | Yes — same schedule | Azure Portal → App registrations → *Dynamics CRM* app → Certificates & secrets |
| `EXTERNAL_AZURE_AD_CLIENT_SECRET` | Yes — tenant policy/creation schedule | External Entra tenant → App registrations → Certificates & secrets |

**Set a calendar reminder 2 weeks before each expiration date.**

---

## All Environment Variables

### Required for Core Functionality

| Variable | Purpose | Source | Rotation |
|----------|---------|--------|----------|
| `CLAUDE_API_KEY` | AI processing for all apps | [Anthropic Console](https://console.anthropic.com) → API Keys | Create new key, update in Vercel, revoke old one |
| `NEXTAUTH_URL` | Production URL for OAuth callbacks and staff API Origin/Referer checks | `https://applications.wmkeck.org` (Production; set + cut over 2026-06-23, non-sensitive) | **Live value `https://applications.wmkeck.org`** — staff auth cut over to the branded host 2026-06-23 and was VERIFIED via live runtime `/api/health` + an authenticated write probe (POST/DELETE 200) on `applications.wmkeck.org`. The `lib/utils/auth.js` Origin/Referer CSRF check is ON, pinned to this host; a production-mode runtime fails closed when its allowed-origin configuration is missing or invalid. Preview should NOT carry a fixed `NEXTAUTH_URL`: when it is intentionally absent, the check derives the allowed origin from `VERCEL_URL` and fails closed if that deployment hostname is unavailable. The legacy `wmkfresearch.vercel.app` host still 403s state-changing requests and funnels sign-in to the branded host. **Caveat:** while this var was Sensitive, `vercel env pull` read it back as `""` — which caused a false "Production is empty" belief in earlier docs/memory. The real Production runtime value (verifiable only via `/api/health`) was always non-empty. Do not re-introduce the "empty" claim from a pull. See `project-branded-domains.md`. |
| `REVIEWER_PORTAL_BASE_URL` | Public base URL used in external-reviewer invitation links | `https://reviews.wmkeck.org` | Non-secret. Active in Production as of 2026-06-23 and redeployed. Defaults to `NEXTAUTH_URL` if unset, but keep explicit so reviewer email links move independently from staff OAuth callbacks. |
| `GRANTEE_PORTAL_BASE_URL` | Public base URL used in grantee deliverables magic-links (invite + reminder) | `https://grantees.wmkeck.org` | Non-secret. Active in Production as of 2026-06-23 and redeployed. Code resolves `GRANTEE_PORTAL_BASE_URL || NEXTAUTH_URL || ''` — **MUST stay set** so grantee magic-links use the grantee host; otherwise they fall back to `NEXTAUTH_URL` (now the staff host `applications.wmkeck.org`), which is wrong for grantee-facing links. |
| `REVIEWER_EMAIL_DELIVERY_MODE` | Reviewer invite delivery mode | Manual (`send` or `capture`) | Non-secret. Default `send`. `capture` is for non-production E2E rehearsal only; it returns rendered email artifacts without sending through Dynamics and is refused when `VERCEL_ENV=production`. |
| `NEXTAUTH_SECRET` | Signs JWT session tokens | Self-generated | `openssl rand -base64 32` — rotating logs out all users |
| `AUTH_REQUIRED` | Enable/disable SSO (`true`/`false`) | Manual | Kill switch — see `EMERGENCY_AUTH_BYPASS` for production |
| `EMERGENCY_AUTH_BYPASS` | Required to disable auth in production (`true`/`false`) | Manual | Production fails closed unless this is `true` even when `AUTH_REQUIRED=false`. **Monitored:** while set in production, a CRITICAL `system_alerts` row is raised at every server cold start (`instrumentation.js`) and re-asserted daily by `/api/cron/auth-bypass-check`; the alert auto-resolves once the variable is unset. Never leave it set after an incident. |
| `AZURE_AD_CLIENT_ID` | SSO app registration ID | Azure Portal → App registrations → Overview | Never changes |
| `AZURE_AD_CLIENT_SECRET` | SSO app secret | Azure Portal → App registrations → Certificates & secrets | See [Rotating Azure AD Secrets](#rotating-azure-ad-secrets) |
| `AZURE_AD_TENANT_ID` | Organization tenant | Azure Portal → Azure AD → Properties | Never changes |
| `USER_PREFS_ENCRYPTION_KEY` | Encrypts stored API keys (AES-256) | Self-generated | `openssl rand -hex 32` — rotating requires re-entering all saved API keys |

### Required in Production

| Variable | Purpose | Source | Notes |
|----------|---------|--------|-------|
| `CRON_SECRET` | Authenticates `/api/cron/*` endpoints | Self-generated (`openssl rand -base64 32`) | Required for cron jobs (secret-check, retraction-watch, etc.). Both the shared verifier and the stricter drain-submissions verifier use `constantTimeEqual`; the shared verifier alone retains its local-development bypass. |
| `EXTERNAL_LINK_SECRET` | HMAC-signs external-reviewer JWTs (`/api/external/*`) | Self-generated (32+ chars; `openssl rand -base64 32`) | **Must be separate from `NEXTAUTH_SECRET`**; read by `lib/services/external-token.js`. Rotatable without breaking live links — see [Rotating EXTERNAL_LINK_SECRET](#rotating-external_link_secret). |
| `EXTERNAL_LINK_SECRET_PREVIOUS` | Outgoing `EXTERNAL_LINK_SECRET` value during a rotation window | The previous `EXTERNAL_LINK_SECRET` | **Optional** — set only while rotating. `verifyToken` also accepts tokens signed with it; `mintToken` never uses it. Clear once all old tokens have expired. |
| `VRP_ALLOWED_PROVIDERS` | Comma-separated allowlist for Virtual Review Panel | Manual (e.g., `claude,openai,gemini`) | Must include `claude`. Production fails closed if unset. Intersects with configured API keys |
| `IRS_VERIFY_SECRET` | Authenticates PowerAutomate calls to `/api/irs/verify-ein` | Self-generated (32+ chars; `openssl rand -base64 32`) | **Must be separate from `CRON_SECRET`** — PA is not a Vercel cron. Sent by PA in the `x-irs-verify-secret` request header. |

### Optional — Applicant Intake Portal (dual-provider auth)

The `/apply/*` intake portal authenticates against a separate Entra External ID tenant. The `entra-external` NextAuth provider registers only when **all three `EXTERNAL_AZURE_AD_*` vars** (tenant ID, client ID, client secret) are set; partial config skips registration cleanly. The well-known OpenID config URL is derived from the tenant ID. Staff-only deployments can leave all three unset.

| Variable | Purpose | Source |
|----------|---------|--------|
| `EXTERNAL_AZURE_AD_TENANT_ID` | External ID tenant | Azure Portal → External tenant Properties |
| `EXTERNAL_AZURE_AD_CLIENT_ID` | App registration ID in External tenant | Azure Portal → App registrations (External tenant) |
| `EXTERNAL_AZURE_AD_CLIENT_SECRET` | App secret in External tenant | Azure Portal → Certificates & secrets (External tenant) |

### Optional — Virtual Review Panel (multi-LLM)

Each provider key is independent; `VRP_ALLOWED_PROVIDERS` further gates which are exposed to the panel.

| Variable | Purpose | Source |
|----------|---------|--------|
| `OPENAI_API_KEY` | GPT panel reviewer | [OpenAI Platform](https://platform.openai.com/api-keys) |
| `GOOGLE_AI_API_KEY` | Gemini panel reviewer | [Google AI Studio](https://aistudio.google.com/) |
| `PERPLEXITY_API_KEY` | Perplexity — VRP panel reviewer (sonar claim verification) AND reviewer-finder web discovery (Search API, Track C). Live in prod 2026-06-05. Same key, two surfaces; setting it also makes `perplexity` a *configured* VRP provider — gate VRP exposure with `VRP_ALLOWED_PROVIDERS`. | [Perplexity API](https://docs.perplexity.ai/) |

### Vercel-Managed (Auto-configured)

| Variable | Purpose | Notes |
|----------|---------|-------|
| `POSTGRES_URL` | Database connection | Auto-set when Vercel Postgres is linked |
| `BLOB_READ_WRITE_TOKEN` | File upload storage (public shared store `phase-ii-summaries-blob`) | Auto-set when Vercel Blob is linked |
| `DVX_BLOB_RW_TOKEN` | Dataverse Bulk Export private store (`dvx-export-private`) RW token | Manual — see "Private Blob store provisioning" below |
| `INTAKE_BLOB_RW_TOKEN` | Applicant intake drain private store (`intake-applicant-private`, `store_Eaui32n6i2wYMS6E`, `iad1`) RW token | Manual — same provisioning shape as DVX |
| `UPLOADS_BLOB_RW_TOKEN` | Shared private store (`wmkf-uploads-private`, `store_WvoDkxrlWniAuJAj`, `iad1`) RW token — document uploader plus actor-bound portal image staging | Manual — set in **dev + preview + production** (2026-06-11). Private uploads fail closed where unset. Portal staging mints 15-minute single-path client tokens and server-reads only ledger pathnames; `scripts/probe-private-blob-client-access.mjs` must prove public override fails before release. See "Private Blob store provisioning" below |
| `NODE_ENV` | Environment flag | Auto-set (`production` on Vercel, `development` locally) |

### Optional — Dynamics Explorer

| Variable | Purpose | Source |
|----------|---------|--------|
| `DYNAMICS_URL` | CRM instance URL | `https://wmkf.crm.dynamics.com` |
| `DYNAMICS_TENANT_ID` | Azure tenant for CRM | Same as `AZURE_AD_TENANT_ID` |
| `DYNAMICS_CLIENT_ID` | CRM app registration ID | Azure Portal → separate app registration |
| `DYNAMICS_CLIENT_SECRET` | CRM app secret | Azure Portal → same app → Certificates & secrets |
| `DYNAMICS_SANDBOX_URL` | Sandbox CRM instance. ⚠️ NOT probe-only: four runtime services (`dataverse-settings-service`, `dataverse-identity-map`, `dataverse-app-access-service`, `grant-cycles-dataverse`) resolve `DYNAMICS_SANDBOX_URL \|\| DYNAMICS_URL`, so setting it repoints them | `https://orgd9e66399.crm.dynamics.com` (verified via Global Discovery probe S355 — the only sandbox instance visible to the app registration; the previously documented `wmkfsandbox.crm.dynamics.com` is not among them and is unrecognized by the interlock target registry) |
| `DYNAMICS_IMPERSONATION_ENABLED` | Send `MSCRMCallerID` on user-driven Dynamics writes | Manual — `true` in Production (verified S271; re-verified S466); unset/other values disable. See `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` |
| `SHAREPOINT_SITE_URL` | SharePoint Graph base | e.g., `https://appriver3651007194.sharepoint.com/sites/akoyaGO` |

### Dataverse target/write interlock (enforced; see `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`)

None are secrets. The hook sites are wired (merge 8067de3a), and
`DATAVERSE_TARGET_INTERLOCK=on` is live in `.env.local` + Vercel
Production/Preview since 2026-07-22. Production was flipped only after a
positive `mode=warn deployment=production target=production` observation;
the post-flip Workbench smoke emitted `mode=on` and no denial.

| Variable | Purpose | Source |
|----------|---------|--------|
| `DATAVERSE_TARGET_INTERLOCK` | Enforcement mode: `off`/`warn`/`on`. Unset/empty → `off`; any other invalid value fails closed to `on` with a console.warn (`lib/dataverse/core/interlock.js:77-85`) | Manual, per environment; current value `on` in local, Preview, and Production; stored **non-sensitive** (S414) so the value is auditable — keep it that way; rollback to `warn` only for a diagnosed incident |
| `DATAVERSE_DAL_ENFORCEMENT` | **Distinct control** from the interlock above: fail-closed entity-write enforcement requiring a trusted DAL context. **Fails OPEN in production** — only the literal `'on'` enables it; `'off'` disables it; *any other value* (including `'on\n'` from an `echo`-piped write) falls through to `NODE_ENV !== 'production'`, which is `false` in production `[VERIFIED via lib/services/dynamics-context.js:124-129]`. Contrast the interlock, which fails closed on an invalid value. | Manual; Production `on`. Stored **non-sensitive** (S414) so a wrong value is detectable — it was previously Sensitive and therefore unverifiable. Set with `vercel env add --value on`, never `echo` |
| `DATAVERSE_ALLOW_PROD_READS` | `yes` allows preview/local reads of production Dataverse (Mode B shadow-reads); anything else denies | Manual, preview/local only, set when a shadow comparison is actually running |
| `DATAVERSE_PROD_WRITE_ACK` | `"<purpose> <YYYY-MM-DD>"` — operator ack for local scripts writing prod; honored only for deployment class `local` and only when the date is today (UTC) | Per-invocation operator shell only — never committed, never set in Vercel |
| `DATAVERSE_REHEARSAL_GRANT` | JSON Mode-D rehearsal grant (`purpose`/`ops`/`entitySets`/`recordIds` (GUID-only)/`expiresAt`); `$batch` and alternate-key writes are never grant-coverable | Per-rehearsal, removed after; never in production env unless a Mode-D rehearsal is live |

### Optional — Research APIs

| Variable | Purpose | Source | Cost |
|----------|---------|--------|------|
| `NCBI_API_KEY` | PubMed higher rate limits | [NCBI Account](https://www.ncbi.nlm.nih.gov/account/settings/) | Free |
| `ORCID_CLIENT_ID` | Researcher contact lookup **+ identity-spine verification (OpenAlex+ORCID Track-A)** | [ORCID Developer Tools](https://orcid.org/developer-tools) | Free |
| `ORCID_CLIENT_SECRET` | ORCID authentication | Created with client ID | Free |
| `OPENALEX_API_KEY` | OpenAlex author/institution/work lookup authentication and rate-limit budget | [OpenAlex API key](https://openalex.org/settings/api) | Free daily budget |
| `ROR_CLIENT_ID` | Optional, non-secret client identifier sent as `Client-Id` by the request-scoped ROR institution candidate adapter. The adapter remains operational when unset; configure it when ROR registration is available/policy requires identified traffic. | [ROR Client ID](https://ror.readme.io/docs/client-id) | Free |
| `SERP_API_KEY` | Reviewer contact lookup + PubPeer + news (integrity). NOT academic search — Scholar metrics/literature migrated to OpenAlex S251 | [SerpAPI](https://serpapi.com/) | ~$0.01/search |

> **Load-bearing for the reviewer identity spine:** the OpenAlex+ORCID Track-A
> verifier (`reviewer-identity-evidence.js`) uses `ORCID_CLIENT_ID`/`ORCID_CLIENT_SECRET`
> to corroborate a candidate's current employment. **Without them the spine cannot
> reach `probable`/`confirmed` and silently degrades to `needs-review` for
> non-biomedical / PubMed-off suggestions** — it fails safe (never mis-verifies), but
> resolution rate drops. OpenAlex retired the polite pool in February 2026:
> `OPENALEX_API_KEY` is now the authenticated request credential and must be set
> server-side in each runtime environment. `OPENALEX_POLITE_MAILTO` remains only
> as an optional monitored contact in the User-Agent; it does not authenticate or
> increase the request budget. Never expose the API key to client code.

`ROR_CLIENT_ID` is an identifier, not a secret, and therefore is intentionally
absent from `lib/utils/tracked-secrets.js`. The production adapter sends only
institution affiliation text to ROR; optional country/domain evidence remains
local decision evidence and is not added to the provider request.

### Optional — Per-App Model Overrides

`getModelForApp()` in `shared/config/baseConfig.js` reads a runtime env var of the form `CLAUDE_MODEL_<APP>` for static per-app overrides (DB-stored overrides in Dataverse `wmkf_appsystemsettings`, loaded via `loadModelOverrides()`, take precedence — the Postgres `system_settings` table was dropped 2026-05-12; see §"How It Works" below). Prefer tier keys (`opus`, `sonnet`, `haiku`) unless a concrete pin has passed the model-change checklist. Concrete `claude-*` env values are deployment configuration, not route-validated writes: before setting one, add/confirm matching entries in `lib/services/model-capabilities.js` and `lib/utils/model-pricing.js`, then run `npm run check:model-registry` followed by `npm run check:model-registry:self-test`.

- `CLAUDE_MODEL_REVIEWER_FINDER=claude-opus-4-8` (reviewer-finder origination runs on Opus as of S286; see baseConfig default + the `model_override:reviewer-finder` Dataverse override that governs live resolution)
- `CLAUDE_MODEL_BATCH_PHASE_I_SUMMARIES=claude-haiku-4-5-20251001`
- App key transformation: lowercase + hyphens → uppercase + underscores. The full app-key list is in `shared/config/appRegistry.js`.

Prefer the admin dashboard (`/admin` → Models tab) for non-static overrides — env var values are baked into the deployment until next redeploy. The admin Models API rejects unreviewed concrete Claude ids before writing Dataverse; env overrides rely on the pre-deploy check above.

### Optional — BILL.com Honorarium Integration

Automated BILL onboarding is disabled unless `BILL_ENABLED=true`; the current no-BILL grant-cycle posture keeps `BILL_ONBOARDING_DEFERRED=true`, which returns `status: 'deferred'` before any BILL call. To enable BILL, provision the runtime credentials, webhook HMAC, internal-call HMAC, and Dataverse option-set values together, then redeploy.

| Variable | Purpose | Default / Notes |
|----------|---------|-----------------|
| `BILL_ENABLED` | Master gate for automated BILL onboarding in `lib/bill/onboard-reviewer-service.js`. | unset/`false` → `alert_only` unless `BILL_ONBOARDING_DEFERRED=true` short-circuits first |
| `BILL_ONBOARDING_DEFERRED` | Cycle-level lock that skips the BILL tail silently after the honorarium request exists. Tested with strict `===` against the literal string `'true'` (`lib/bill/onboard-reviewer-service.js:90`), so any other value — including `'true\n'` from an `echo`-piped write — silently falls through to the per-reviewer `alert_only` branch. **Set it with `vercel env add ... --value true`, never `echo`.** Deliberately stored **non-sensitive** so the value is readable; keep it that way. | no-BILL cycle: `true`; unset only when ready to call BILL |
| `BILL_BASE_URL` | BILL API base URL used by login and API requests. | Required when `BILL_ENABLED=true`; keep to the approved BILL gateway host |
| `BILL_DEV_KEY` | BILL developer key used for login and request headers. | Required when `BILL_ENABLED=true` |
| `BILL_USERNAME` / `BILL_PASSWORD` | BILL login credentials for the configured organization. | Required when `BILL_ENABLED=true` |
| `BILL_ORG_ID` | BILL organization id used during login. | Required when `BILL_ENABLED=true` |
| `BILL_WEBHOOK_SECRET` | HMAC secret for `/api/webhooks/bill` (`x-bill-sha-signature`). | Required outside development for BILL webhook verification; tracked as `bill_webhook_secret` |
| `BILL_WEBHOOK_DEBUG` | Logs a redacted raw payload sample for sandbox payload-shape discovery. | unset/`false`; use only in sandbox because BILL payloads contain vendor PII |
| `VERCEL_LOG_DRAIN_SECRET` | HMAC-SHA1 signature secret for `/api/webhooks/vercel-log-drain` (`x-vercel-signature`). Must equal the drain's Signature Verification Secret in Vercel Team Settings → Drains. | Required outside development for drain ingestion (endpoint fails closed 500 when unset); tracked as `vercel_log_drain_secret`. See `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md` |
| `VERCEL_LOG_DRAIN_VERIFY` | Optional legacy endpoint-verification token echoed as `x-vercel-verify` on drain responses. | unset unless Vercel's drain creation demands endpoint verification |
| `BILL_INTEGRATION_SECRET` | Internal HMAC secret for same-deployment calls to `/api/bill/onboard-reviewer`. | Required for the HTTP endpoint; tracked as `bill_integration_secret`; generate with `openssl rand -base64 48` |
| `BILLCOM_ACCOUNT_YES_VALUE` / `BILLCOM_ACCOUNT_NO_VALUE` | Dataverse option-set integer values for `wmkf_exisitngbillcomaccount`. | Probe per environment with `node scripts/probe-bill-option-set-values.js`; required when `BILL_ENABLED=true` |

### Optional — Operational Flags

| Variable | Purpose | Default |
|----------|---------|---------|
| `PROMPT_RESOLVER_STRICT` | Disable bundled-prompt fallback in `lib/services/prompt-resolver.js` | unset (fallback enabled) |
| `WAVE1_BACKEND_SETTINGS` | Dispatch flag for settings backend. Default Dataverse since Wave 1 closeout 2026-05-12; setting to `postgres` fails loudly (table dropped). | `dataverse` (implicit) |
| `WAVE1_BACKEND_APP_ACCESS` | Dispatch flag for app-access backend. Default Dataverse since 2026-05-12. | `dataverse` (implicit) |
| `WAVE1_BACKEND_PREFS` | Dispatch flag for user-preferences backend. Default Dataverse since 2026-05-12. | `dataverse` (implicit) |
| `DEBUG_REVIEWER_FINDER` | Verbose logging for Reviewer Finder pipeline | unset |
| `REVIEWER_IDENTITY_RESOLVER_MODE` | Server-owned W2 identity resolver seam. `shadow` runs works-first comparison telemetry but still returns the exact legacy result. `combined` is the explicit owner-gated authoritative adapter. Unknown values, including `w2`/`cutover`, fail back to legacy. | unset / `legacy`; do not set `combined` in a deployed environment without owner-approved cutover |
| `REVIEWER_PAGE_EMAIL_TIER_ENABLED` | Enables the guarded faculty/profile-page email recovery tier in `ContactEnrichmentService._attachEmailFromResolvedPage()`. The tier is SSRF-bound to anchored institution domains and only runs when no trusted email is present. | unset/`false` locally; production enabled 2026-07-03 |
| `NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION` | Exact `on` enables source-aware post-acceptance institution notifications and explanatory reviewer-card copy. It does not change candidate selectability, identity weighting, or Dataverse-write gates. Unset/`off` restores the incumbent boolean presentation. Because the client reads this flag, changes require a new build/deployment. | **Preview + Production: exact `on` (2026-08-19).** Production deployment `dpl_85jgQ2c4jR6V599KycEHcbww5Xag` was built after the variable was set and is Ready. Code/local default remains unset/`off`; remove the rollout flag after the observation window if Stage 2 becomes unconditional. |
| `REVIEW_SYNTHESIS_AUTOMATION_ENABLED` | Master rollout gate for `/api/cron/drain-review-syntheses`. The route authenticates and returns an inert `automation_disabled` response unless the value is exactly `true`. Migration 028, signed-in verification, and the bounded automatic production smoke completed 2026-07-28; Production is deliberately set to exact `true`. | Production: `true`; unset/anything else disables |
| `REVIEW_DOCX_SHAREPOINT_WRITE` | Non-sensitive master write gate for `/api/cron/file-review-docx` and the local operator backfill. Only literal `on` permits generated individual-review DOCX uploads and pointer commits. The writer additionally requires an enforcing Dataverse target interlock and the exact canonical akoyaGO SharePoint site. Scheduled calls require a Production deployment; backfill calls require a local process, the tracked Production Dataverse target bound into the reviewed manifest, and a current `DATAVERSE_PROD_WRITE_ACK`. That acknowledgement is process-wide rather than record-scoped; the service separately asserts every manifest suggestion PATCH URL before Graph mutation and again per row. | **Production route deployed at `83da197f` / `dpl_F3oZ9MDbnyFox7S8Ekdos7423ece`; variable absent in Production (CLI-verified 2026-09-03).** Unset/empty/any other value returns before a maintenance row, candidate read, or Graph call. Authenticated Production proof returned `enabled:false` and left the job's maintenance-run count unchanged at zero. Do not enable without the separately approved write rollout. |
| `REVIEW_DOCX_SHAREPOINT_CYCLE` | Exact automatic-filing cohort (`JYY` or `DYY`) for `/api/cron/file-review-docx`. Scheduled discovery requires that exact suggestion cycle stamp and processes newest receipts first. The separate adversarially reviewed operator backfill accepts a required exact `--cycle`, unions exact stamps with request meeting-cycle fallback, excludes complete pointer pairs from its unfinished population, and binds any later execution to a reviewed manifest. | **Variable absent in Production (CLI-verified 2026-09-03).** Configure only together with deliberate write activation; planned first cohort is `D26`. The Wave 3 backfill has not been run against Production. Its manifest and timestamped execution-result files are create-only and contain no answer/document content. A cleanup failure may record bounded identifier/error telemetry in Postgres. |
| `GUARDED_REOPEN_SCHEMA_READY` | Non-sensitive Wave 20 schema-readiness interlock. Only literal `on` lets the adapter select guarded-reopen columns, lets generation include the cycle property on a Request Document create, and lets `/api/workbench/pre-site-visit/reopen` execute; unset or any other value keeps base Request Document reads and creates compatible and makes the route return 503 before Dataverse work. Set only after the target preflight reports three exact fields and zero absent/divergent, then deploy/redeploy. Once any correction cycle exists, never unset it as rollback because generation identity must keep reading the cycle; roll runtime back while retaining the schema and flag. | **Production: exact `on` (2026-08-23)** after approved Wave 20 apply and 3-exact/0-divergent readback; Ready deployment `dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp` includes the value |
| `SITE_VISIT_LOGISTICS_SCHEMA_READY` | Non-sensitive Wave 21 schema-readiness interlock. Only literal `on` lets the Site Visit adapter select the additive format/IANA-zone/location/attendee-reference fields or lets the logistics and calendar paths execute. Unset or any other value leaves the legacy custom Activity readable through its base fields and returns 503 before logistics writes. Set only after the target preflight reports all four fields exact and zero absent/divergent, then deploy/redeploy. Once Site Visit logistics rows exist, retain the additive schema and flag during runtime rollback so their identity map remains readable. | **[VERIFIED LIVE 2026-08-24.]** Wave 21 is exact in sandbox and Production; the non-sensitive literal `on` value is present in Vercel Preview and Production. Production deployment `dpl_A3PED8cA22G88dAKL4jafBAro5tn` is Ready. |
| `FINAL_WRITEUP_SCHEMA_READY` | Non-sensitive Wave 22 readiness interlock. Only literal `on` lets the Request Document adapter select explicit Final Writeup transition actor/time fields or lets the Final Writeup service read/write its transition contract. Unset or any other value keeps existing Request Document reads schema-compatible, makes GET report unavailable, and makes POST return 503 before Dataverse work. Set only after `scripts/preflight-final-writeup-schema.mjs` reports two exact DateTime fields and two exact systemuser relationships with zero absent/divergent. Once Final rows exist, retain the additive schema and flag during runtime rollback so their explicit transition attribution remains readable. | **Production: exact `on` (2026-08-30 PT)** after Wave 22 readback reported 4 exact / 0 absent / 0 divergent. Ready deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ` contains the value; Request `1002788` then Production-proved the explicit group-review actor/time contract. |
| `FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY` | Separate non-sensitive Wave 23 readiness interlock. Only literal `on` lets the acknowledgement service read or write `wmkf_finalwriteupreviewacknowledgement`; unset or any other value makes the deployed acknowledgement and dashboard routes return 503 before runtime Dataverse work and leaves the Final Word action usable. Set only after `scripts/preflight-final-writeup-review-acknowledgement-schema.mjs --target=<target>` reports 11 exact / 0 absent / 0 divergent / 0 pending and the Final-document + reviewer alternate-key index is Active. Retain the additive schema once rows exist; runtime rollback should remove/revert code while preserving schema and readable state. | **Production: exact `on`; Preview: unset (verified 2026-08-31).** Wave 23 schema was reconfirmed exact/Active before activation. Production deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo` is Ready; signed-in reads proved responsible-PD exclusion, and the later eligible-colleague retry produced the independently verified first complete acknowledgement row for Request `1002788`. |
| `REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY` | Non-sensitive Wave 24 readiness interlock. Only literal `on` lets the Request Document adapter select or write `wmkf_InitiatedBy`/`wmkf_InitiatedAt` and lets Site Visit write `wmkf_MilestoneCreatedBy`. While off, reads and writes retain their pre-Wave-24 shape. Once Wave 24 runtime is deployed to Vercel Production, off is an unhealthy health-check state even though availability-first flows remain usable. Set only after `scripts/preflight-request-document-explicit-actor-schema.mjs --target=<target>` reports all three artifacts exact with zero absent/divergent, following a separately approved additive apply. Retain the schema and flag during rollback once attributed rows exist. | **Production: exact `on` (2026-08-31); Preview: unset.** The approved additive apply and independent readback reported 3 exact / 0 absent / 0 divergent. Commit `8ff4205a0ad43337cd987a4fc76639f936bab4bc` first reached Ready Production deployment `dpl_D94J9aRcfLfK81iBDsVYARVhZFPb`; signed-in Admin health reported the Wave 24 readiness service enabled. Naturally generated Request `1002874` then proved Pre-Site origin attribution: explicit Justin Gallivan actor/time, application built-in creator, no missing-attribution event, and census 1 attributed / 0 event-backed / 0 violations. Site Visit milestone attribution remains opportunistic proof on the next natural handoff. |
| `DRAIN_BATCH_SIZE` | Intake drain cron batch size for `/api/cron/drain-submissions`. | `5` |
| `DRAIN_LOCK_TTL_SECONDS` | Intake drain lease length; cron cadence and retry behavior assume this is much larger than the 2-minute schedule. | `600` |
| `WAVE2_BACKEND_GRANT_CYCLES` | Legacy migration guard for grant-cycle reads. `postgres` is no longer supported and fails loudly; unset/default is Dataverse. | unset / `dataverse` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist used by legacy shared config. | unset → `*` |
| `API_SECRET_KEY` | Legacy client API-key encryption secret in `shared/utils/apiKeyManager.js`; production fails closed if unset on that path. Prefer `USER_PREFS_ENCRYPTION_KEY` for current saved preferences. | unset locally; required only if that legacy path is used in production |
| `ENABLE_CACHE` / `ENABLE_LOGGING` / `LOG_LEVEL` | Legacy shared-config toggles for cache/log behavior. | cache/logging enabled unless set to `false`; log level `info` |
| `CLAUDE_API_URL` / `CLAUDE_MODEL` | Legacy base Claude endpoint/model overrides in `shared/config/baseConfig.js`. Prefer canonical `lib/services/llm-client.js` transport and per-app model override rules above. | unset |
| `VIRUS_SCAN_ENABLED` | App-side Cloudmersive virus scanning on upload surfaces (today: reviewer uploads). Fail-closed when on — see [Virus scanning](#virus-scanning-virus_scan_enabled--cloudmersive_api_key) for the runbook. | unset (scanning skipped) |
| `CLOUDMERSIVE_API_KEY` | Cloudmersive virus-scan API key. Required when `VIRUS_SCAN_ENABLED=true`. Free tier 800 scans/month. | unset |
| `HONORARIUM_ONBOARDING_DEFERRED` | Forces reviewer honorarium onboarding to **capture-only**: `ensureHonorariumOnboarding()` captures contact + mailing address then STOPS before minting the honorarium `akoya_request` or calling BILL (`lib/bill/honorarium-onboard-orchestrator.js:54`). Capture-only is *also* implied whenever the discriminator GUIDs (`HONORARIUM_PROGRAM_ID` / `HONORARIUM_GRANTPROGRAM_ID` / `HONORARIUM_TYPE_ID`) are unset — but this flag is the **explicit** lock that still holds if those GUIDs are later configured. **SET to `true` in Production 2026-06-22** as the capture-only lock for the reviewer onboarding-at-accept cycle. **2026-07-01 no-BILL creation plan:** set the three discriminator GUIDs and unset this flag so the portal creates the honorarium request; keep `BILL_ONBOARDING_DEFERRED=true` so no Bill.com payment/onboarding fires. Env-var changes require a deployment/restart built after the update because the discriminator module reads them at load time. To go live on Bill.com later, keep the GUIDs configured and separately unset `BILL_ONBOARDING_DEFERRED` after BILL credentials and option-set values are ready. **GO-LIVE 2026-07-02:** the three discriminator GUIDs were set in **Production**, this flag was **removed from Production** (kept `true` on **Preview**, which also has no GUIDs, so preview stays capture-only), `BILL_ONBOARDING_DEFERRED=true` retained, and prod was redeployed (`dpl_CqnqfG6mp3U9FkLuvzWsuzmnUfc1`) so the module constants took effect — no-BILL honorarium creation is live. | **Production: unset 2026-07-02 (live)**; Preview: `true` (capture-only) |

### Optional — Notifications & Spend Alerts

| Variable | Purpose |
|----------|---------|
| `NOTIFICATION_EMAIL_FROM` | Sender mailbox for system-alert emails. Must be a Dynamics systemuser with Server-Side Sync enabled (resolvable via `internalemailaddress`). Recipients are resolved at send time via the per-category routing config in `/admin` → Alert Recipients (Dataverse setting `alertRecipientsByCategory`), falling back to the active superuser roster. |
| `NOTIFICATION_EMAIL_FROM` | Set to `alerts@wmkeck.org` in Vercel on 2026-07-27, replacing an individual staff mailbox so program directors stop receiving system alerts that appear to come from a person [VERIFIED via owner report, session 2026-07-27]. A read-only Dataverse probe confirmed it resolves to an enabled, write-capable sender, and the owner accepted its visible sender name. Internal row identity, access metadata, and display value are intentionally omitted from public documentation. **Outgoing Server-Side Sync was production-proved 2026-07-28:** a controlled self-addressed message sent through the application transport moved from `Pending Send` to `Sent` after 20 seconds with one delivery attempt. See `docs/TODO_EMAIL_NOTIFICATIONS.md` for the evidence and retained silent-failure caveat. |
| `SCHOLARLY_POLITE_MAILTO` | Monitored contact address sent as the `email` parameter to NCBI E-utilities (`lib/services/pubmed-service.js`) and Europe PMC (`lib/services/contact-enrichment/scholarly-email.js`). Optional; falls back to `NOTIFICATION_EMAIL_FROM`, which historically served double duty here. Set it explicitly whenever `NOTIFICATION_EMAIL_FROM` is an unmonitored system/noreply mailbox, so those providers retain a reachable contact. Does not authenticate or raise any rate limit. OpenAlex uses its own `OPENALEX_POLITE_MAILTO`. |
| `DAILY_SPEND_ALERT_CENTS` | Daily spend threshold for the runaway-cost alert in `/api/cron/spend-check`. **Default $75** (calibrated S183 against 60d prod data: max legitimate day was $26.16 on a batch-processing day; threshold sits ~3× above that while still catching a true runaway within an hour). Catches code wedged in a loop or a prompt mistakenly looping a large input — not normal usage. Re-evaluate if cycle activity pushes legitimate days above ~$50. |
| `ANTHROPIC_ADMIN_API_KEY` | Separate `sk-ant-admin-…` key (NOT the regular `CLAUDE_API_KEY`). Mint at `console.anthropic.com/settings/admin-keys` — only org admins can. Read-only consumer is `/api/cron/pricing-refresh`, which compares Anthropic's authoritative `/cost_report` against `lib/utils/model-pricing.js` monthly and alerts on >5% drift. When unset, the cron skips with `status='skipped'`; no other code path requires it. |
| `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` | Used by maintenance/health utilities that pull deployment metadata |

---

## Rotating Azure AD Secrets

This is the most common maintenance task. Both `AZURE_AD_CLIENT_SECRET` and `DYNAMICS_CLIENT_SECRET` follow the same process.

### Step by step

1. **Azure Portal** → App registrations → select the app
2. **Certificates & secrets** → Client secrets → **New client secret**
3. Choose **24 months** for description/expiration
4. Click **Add** — copy the **Value** immediately (it's only shown once; the Secret ID is not the value)
5. **Vercel Dashboard** → Settings → Environment Variables
6. Update the variable with the new value (Production scope)
7. **Redeploy** — Deployments → latest → Redeploy (uncheck "Use existing Build Cache")
8. **Verify** — visit `/api/health` to confirm the service is working
9. **Delete the old secret** in Azure Portal (only after verifying the new one works)
10. **Set a calendar reminder** for the new expiration date

### Common mistakes

- Copying the **Secret ID** instead of the **Value** — the value is in the second column
- Setting the variable for **Preview** scope only — must include **Production**
- Forgetting to **redeploy** after updating the variable
- Including **trailing whitespace** when pasting the value

---

## Rotating EXTERNAL_LINK_SECRET

`EXTERNAL_LINK_SECRET` signs the magic-link JWTs that external reviewers use. A naïve rotation would invalidate every live reviewer link the instant it took effect. The dual-secret window avoids that: `verifyToken` accepts tokens signed with **either** the current secret or `EXTERNAL_LINK_SECRET_PREVIOUS`, while `mintToken` always uses the current one.

**Cadence:** no fixed expiry. Rotate on suspected compromise, on staff offboarding with production env access, or routinely every 12 months. Track via `secret_rotation:external_link_secret`.

### Step by step

1. **Pick the window length.** It must be ≥ the longest-lived unexpired token — the latest reviewer due-date-plus-grace currently outstanding. When in doubt, 60 days covers a normal review cycle.
2. **Generate a new secret:** `openssl rand -base64 32`.
3. **Vercel Dashboard** → Settings → Environment Variables (Production scope):
   - Set `EXTERNAL_LINK_SECRET_PREVIOUS` to the **current** `EXTERNAL_LINK_SECRET` value.
   - Set `EXTERNAL_LINK_SECRET` to the **new** value.
4. **Redeploy** (uncheck "Use existing Build Cache").
5. **Verify** — an existing reviewer link still loads (old secret) and a freshly minted link works (new secret).
6. **Set a calendar reminder** for the end of the rotation window.
7. **At the end of the window:** delete `EXTERNAL_LINK_SECRET_PREVIOUS` and redeploy. Tokens signed with the old secret are now rejected (`invalid_signature`) — by then they have all expired anyway.

### Drill

`node scripts/drill-external-link-secret-rotation.mjs` exercises all three phases (before rotation / window open / window closed) in-process with throwaway secrets — it touches no real environment and no database. Run it before a real rotation, or any time as a regression check. Exit 0 means the mechanism is healthy.

### Common mistakes

- Setting `EXTERNAL_LINK_SECRET_PREVIOUS` to the **new** value instead of the outgoing one.
- Closing the window before the longest-lived token has expired — this locks reviewers out mid-cycle.
- Forgetting to **redeploy** after either the open or the close step.
- Leaving `EXTERNAL_LINK_SECRET_PREVIOUS` set indefinitely — it widens the accepted-signature surface; clear it once the window closes.

---

## Private Blob store provisioning (`DVX_BLOB_RW_TOKEN`, `INTAKE_BLOB_RW_TOKEN`, `UPLOADS_BLOB_RW_TOKEN`)

These env vars hold RW tokens for **dedicated PRIVATE** Vercel Blob stores. They are deliberately separate from the shared `BLOB_READ_WRITE_TOKEN` (which is bound to the public `phase-ii-summaries-blob` store used by uploads / reviewer-finder / review-manager / maintenance) and must NOT be conflated. Apps that PUT or GET against a private store with the public token will fail at the Blob API layer.

| Var | Store name | Store ID | Region |
|-----|-----------|----------|--------|
| `DVX_BLOB_RW_TOKEN` | `dvx-export-private` | (read from dashboard) | `iad1` |
| `INTAKE_BLOB_RW_TOKEN` | `intake-applicant-private` | `store_Eaui32n6i2wYMS6E` | `iad1` |
| `UPLOADS_BLOB_RW_TOKEN` | `wmkf-uploads-private` | `store_WvoDkxrlWniAuJAj` | `iad1` |

`UPLOADS_BLOB_RW_TOKEN` backs the **private-blob migration of the shared document uploader** (Phase 1; `FileUploaderSimple access="private"` → `pages/api/upload-handler.js` mints the client token against this store, and `lib/utils/uploaded-blob.js` reads private blobs with it). **Provisioned 2026-06-11** in **dev + preview + production**, and the **live smoke PASSED** (`node scripts/smoke-private-upload.mjs` + a real expense-reporter upload→extract run locally against the store — receipts landed in the private store; the receipt URL returns HTTP 403 unauthenticated). **Cohort promoted to production 2026-06-11:** the prod token + `NEXT_PUBLIC_PHASE_I_DYNAMICS_PRIVATE_BLOB` + `NEXT_PUBLIC_GRANT_REPORTING_PRIVATE_BLOB` are set in Production and deployed (`dpl_Cd6MGvsGvYgcqW8LHPNV4j7Wg5oA`); grant-reporting prod-verified (live upload → private store, URL 403, extraction ran). **`expense-reporter` also promoted** — `NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB=true` set in Production + deployed (`wmkfresearchapps-njdq4gr5y`); all three Phase-1 consumers now upload private in prod (expense shares the prod-verified store/token/read path). Where the token is unset, `process-expenses` (and any future private consumer) fails closed and the flag must stay `public`.

As of 2026-08-19 the same private store also backs `portal_upload_staging`
for external-grantee image submit and staff image replacement. This adds no new
credential. The server chooses each opaque pathname, stores its actor/scope/
request binding in Postgres, and returns a short-lived client token constrained
to that one pathname/type/size. Finalizers never accept a client pathname. Before
shipping changes to this mechanism, run
`node scripts/probe-private-blob-client-access.mjs`; the release gate is: public
mode PUT rejected, private PUT accepted, anonymous HEAD = 403, and probe objects
deleted in cleanup. This is deliberately a credentialed Preview release probe,
not a normal CI/Jest test, because it mutates the live Blob store. Independently,
every finalizer performs an anonymous HEAD of its exact staged Blob and fails
closed unless the response is 401/403 before consuming the bytes.

> **Note (2026-06-11): the modern dashboard/CLI auto-connect uses the OIDC model.** When `wmkf-uploads-private` was connected it auto-created `BLOB_STORE_ID` (pointing at the private store) + `BLOB_WEBHOOK_PUBLIC_KEY` and **no** static RW token. That conflicts with this repo's explicit-per-store-token model (it would make the private store the default for token-less `@vercel/blob` calls). Fix applied: the RW token was copied from the store dashboard into `UPLOADS_BLOB_RW_TOKEN`, and `BLOB_STORE_ID` + `BLOB_WEBHOOK_PUBLIC_KEY` were **removed** (`vercel env rm`). For future private stores, either decline the auto-connect or remove those two vars afterward and wire only the explicit token.

### Why the CLI workflow is awkward

The Vercel CLI (53.x + 54.x) cannot connect a *second* Blob store under a custom env-var name. It always tries to write the token into `BLOB_READ_WRITE_TOKEN`, which would clobber the shared-store token. So the provisioning dance is:

1. Create the store via CLI: `vercel blob create-store dvx-export-private --access private` (or `intake-applicant-private`).
2. **Decline the auto-link prompt** when CLI offers to connect it to the project — accepting overwrites `BLOB_READ_WRITE_TOKEN`.
3. Open the Vercel dashboard → Storage → the new store → Copy the RW token.
4. Set the token under the correct custom env name per env: `vercel env add DVX_BLOB_RW_TOKEN` (or `INTAKE_BLOB_RW_TOKEN`), pasting the token at the prompt. Repeat for `production`, `preview`, and `development`.

### Where they're consumed in code

- **DVX:** `pages/api/dataverse-export/run.js` writes (`access: 'private'`); `pages/api/dataverse-export/download.js` reads via the authenticated proxy. Missing token → pre-stream fail-loud 502 `BLOB_STORE_UNCONFIGURED`.
- **Intake:** `pages/api/intake/draft/upload-token.js` mints a path-scoped client-upload token; `pages/api/intake/draft/attach.js` GETs + DELETEs for the synchronous virus-scan step; `MaintenanceService.sweepIntakePending` reaps stale pending attachments. Single source of truth for token reads is `lib/utils/intake-blob.js` (fail-loud on missing/whitespace).

### Sender constraints

Both stores are private — direct browser fetches against their Blob URLs return 404/403. Retrieval MUST go through an authenticated server-side proxy (`/api/dataverse-export/download?t=<token>` for DVX; the drain's three-call attach dance for intake). The "shipping a short-lived public Blob URL to the browser" pattern is explicitly NOT used for these stores; see the Track B build plan §5 for the rationale.

---

## Virus scanning (`VIRUS_SCAN_ENABLED` + `CLOUDMERSIVE_API_KEY`)

App-side malware scanning for user-uploaded files. Current guarded paths include
reviewer uploads (external-token and staff session paths) through
`lib/services/review-upload.js` and intake draft attachment processing through
`pages/api/intake/draft/attach.js`. Strict intake validation accepts only an
attachment whose recorded scan result is `clean`.

**Default off.** Operators opt in by setting `VIRUS_SCAN_ENABLED=true` (and providing `CLOUDMERSIVE_API_KEY`). When on, the contract is fail-closed: a scanner outage or misconfiguration blocks uploads. This is intentional — the opt-in flag means the operator has explicitly accepted the scanner as a gatekeeper; partial degradation would defeat the point.

**This is one of several upload paths into the SharePoint document library** (others: staff direct uploads via web/desktop sync, Power Automate flows, integrations). App-side scanning closes the path *we* control; coverage at the SharePoint / M365 layer is a separate question for DFT (see `docs/DFT_VIRUS_SCAN_QUESTIONS_DRAFT.md`).

### Behavior reference

| Situation | `VIRUS_SCAN_ENABLED=true` | `VIRUS_SCAN_ENABLED` unset/false |
|---|---|---|
| File scans clean | Upload proceeds | Upload proceeds (no scan performed) |
| File flagged infected | 422 to caller, file rejected, no SharePoint write | n/a (no scan) |
| Scanner returns 5xx, network error, or 429 (after 3 retries) | 503 to caller (`scan_unavailable`) | n/a |
| Bad API key (401/403) or `CLOUDMERSIVE_API_KEY` missing | 500 to caller (`scan_misconfigured`) | n/a (no scan attempted) |

Server-side, every scan failure is logged with structured Cloudmersive error context (`serviceName`, `status`, `isTransient`, `causeKind`). Client-facing messages are intentionally opaque.

### Emergency bypass procedure

If the scanner is down and uploads must be unblocked before Cloudmersive recovers:

1. **Verify the outage is real and not a misconfiguration.** Run the smoke: `node scripts/smoke-virus-scan.mjs`. If it returns `scan_misconfigured`-class errors (4xx, missing key), fix that first — bypassing won't help.
2. **In Vercel:** `vercel env rm VIRUS_SCAN_ENABLED <env>` for whichever environment is affected (preview or production). Or set it to `false`.
3. **Redeploy.** The flag is read per-request via `lib/utils/virus-scan-config.js`, but the env var won't propagate to running functions without a deploy.
4. **Annotate `system_alerts`** with the bypass reason + expected restoration time so the next operator on rotation can see why scanning is currently off.
5. **Re-enable as soon as the scanner is healthy.** Bypass is a temporary measure, not a default.

### Cost ceiling

Free tier is 800 scans/month. Pilot-cycle estimate: ~150 reviewer uploads + (when intake portal launches) ~200 applicant attachments = ~350/cycle. Combined comfortably under the free tier; if cycle volume grows past 800/month, paid tier is ~$0.001/scan.

### Verification smoke

`scripts/smoke-virus-scan.mjs` posts an EICAR test string and a clean string against the real Cloudmersive endpoint. Run after rotating `CLOUDMERSIVE_API_KEY` or whenever you suspect the scanner integration is mis-wired.

---

## Diagnosing Issues

### Quick checks

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| SSO login fails with "OAuthCallback" | `AZURE_AD_CLIENT_SECRET` expired or wrong | Rotate the secret (see above) |
| SSO login or state-changing staff API calls fail with no obvious configuration error | Production `NEXTAUTH_URL` is missing/invalid, or Preview lacks a usable `VERCEL_URL` | Set the branded `NEXTAUTH_URL` in Production; keep it unset in Preview and verify Vercel supplies that deployment's `VERCEL_URL` |
| "Authentication required" on API calls | `AUTH_REQUIRED=true` but credentials missing | Check all Azure AD vars are set |
| API key save fails | `USER_PREFS_ENCRYPTION_KEY` not set | Generate and add to Vercel |
| Dynamics Explorer: "missing credentials" | `DYNAMICS_*` vars not set in production | Add all four Dynamics vars to Vercel |
| Slow PubMed searches | `NCBI_API_KEY` not set | Add key for 10 req/sec (vs 3 without) |

### Health check endpoint

Visit **`/api/health`** to test all integrations at once. Returns:

```json
{
  "timestamp": "2026-02-13T22:30:00.000Z",
  "services": {
    "database": { "status": "ok" },
    "claude": { "status": "ok" },
    "azureAd": { "status": "ok" },
    "dynamicsCrm": { "status": "ok" },
    "ncbi": { "status": "skipped", "reason": "Not configured" }
  }
}
```

- **`ok`** — service is reachable and credentials are valid
- **`error`** — credentials are wrong or service is down
- **`skipped`** — not configured (optional service)

### Vercel function logs

For deeper debugging: Vercel Dashboard → your project → **Logs** → filter by function name (e.g., `/api/auth/callback`).

---

## Secret Expiration Tracking

The system includes automated secret expiration monitoring via a daily cron job (`/api/cron/secret-check`, 8:00 AM UTC).

### How It Works

1. Expiration dates are stored in Dataverse `wmkf_appsystemsettings` with keys like `secret_expiration:azure_ad_client_secret`. (Pre-2026-05-12 this lived in the Postgres `system_settings` table; that table has been dropped.)
2. The cron checks all tracked secrets daily and creates alerts at tiered thresholds:
   - **Warning** at 14 days before expiry
   - **Error** at 7 days before expiry
   - **Critical** if expired
3. Alerts appear on the admin dashboard and auto-resolve when the expiration date is updated

### Setting Expiration Dates

Use the **Secret Expiration Tracking** section on the admin dashboard (`/admin`) to set or update dates inline. The admin UI writes through `lib/services/settings-service.js`, which routes to the Dataverse `wmkf_appsystemsettings` entity set. Direct SQL is no longer available — there is no Postgres equivalent of these rows.

Programmatic writes from a script should use the service module:

```js
const { setSetting } = require('./lib/services/settings-service');
await setSetting('secret_expiration:azure_ad_client_secret', '2026-06-15');
await setSetting('secret_rotation:azure_ad_client_secret', '2026-03-15');
```

### Tracked Secrets

Canonical list lives in `lib/utils/tracked-secrets.js` — both `pages/api/cron/secret-check.js` (daily threshold alerts) and `pages/api/admin/secrets.js` (superuser UI) import from it. Update that file when adding/removing entries; this table mirrors it manually.

| Key (lowercase, used in `secret_expiration:<key>`) | Display name | Tier | Typical expiry / cadence |
|---|---|---|---|
| `azure_ad_client_secret` | Azure AD Client Secret | vendor | 90 days (vendor-issued) |
| `dynamics_client_secret` | Dynamics CRM Client Secret | vendor | 90 days (vendor-issued) |
| `external_azure_ad_client_secret` | External Entra ID Client Secret (applicant intake) | vendor | 90 days (vendor-issued) |
| `nextauth_secret` | NextAuth Secret | hmac | No expiry. Rotate periodically or on compromise |
| `cron_secret` | Cron Secret | hmac | No expiry. Rotate periodically |
| `user_prefs_encryption_key` | User Preferences Encryption Key | hmac | No expiry. **Rotation tooling pending Dataverse rewrite** — the legacy `scripts/rotate-encryption-key.js` was archived 2026-05-12 when the underlying `user_preferences` Postgres table was dropped. Until rewritten, key rotation requires reading all `wmkf_appuserpreferences` rows where `wmkf_isencrypted=true`, decrypting with the old key, re-encrypting with the new key, and PATCHing back via the dispatcher. |
| `external_link_secret` | External-Reviewer Link Secret (HMAC for JWT) | hmac | No expiry. Rotate on compromise / offboarding / ~12 months via the dual-secret window — see [Rotating EXTERNAL_LINK_SECRET](#rotating-external_link_secret). |
| `irs_verify_secret` | IRS Verify Secret (PowerAutomate shared) | hmac | No expiry. Rotate on PA-flow rebuild or compromise |
| `bill_webhook_secret` | BILL Webhook Secret (HMAC for /api/webhooks/bill) | hmac | Per-subscription `securityKey` from BILL. Rotate via `POST /v3/subscriptions/{id}/security-key` |
| `vercel_log_drain_secret` | Vercel Log Drain Secret (HMAC for /api/webhooks/vercel-log-drain) | hmac | No expiry. Rotate by editing the drain's Signature Verification Secret in Vercel Team Settings → Drains and updating the env var in the same window |
| `claude_api_key` | Anthropic Claude API Key | vendor | No vendor expiry, but rotate on compromise or staff offboarding |
| `openalex_api_key` | OpenAlex API Key | vendor | Authenticated request credential; rotate on compromise and update every runtime environment |
| `cloudmersive_api_key` | Cloudmersive API Key (virus scan; gated by VIRUS_SCAN_ENABLED) | vendor | Pilot uses free tier (800 scans/mo); rotate on compromise |
| `perplexity_api_key` | Perplexity API Key (VRP sonar claim-verification + reviewer web discovery) | vendor | No vendor expiry, but rotate on compromise or staff offboarding. Live in prod 2026-06-05; one key, two surfaces (set `VRP_ALLOWED_PROVIDERS` to gate VRP exposure). |
| `blob_read_write_token` | Vercel Blob RW Token (shared store) | blob | Vercel-issued; no expiry; rotate via Vercel dashboard if compromised |
| `dvx_blob_rw_token` | Vercel Blob RW Token (dvx-export-private) | blob | Same as above |
| `intake_blob_rw_token` | Vercel Blob RW Token (intake-applicant-private) | blob | Same as above |
| `bill_integration_secret` | BILL Integration Secret (respond.js → /api/bill/onboard-reviewer) | hmac | Env var: `BILL_INTEGRATION_SECRET`. **≥32 chars required** — endpoint fails closed below that (`lib/bill/internal-call-auth.js`). HMAC-SHA256 over canonical `v1:${timestamp}:${nonce}:${rawBody}` with ±300s skew window. Generate with `openssl rand -base64 48`. Rotation cadence: 12mo (same as `external_link_secret`). Distinct from `bill_webhook_secret` (BILL→us) and `cron_secret`. |

---

## Setting Up a New Environment

Configure in this order:

1. Link **Vercel Postgres** (auto-sets `POSTGRES_URL`)
2. Bootstrap the new empty database: `node scripts/setup-database.js` (existing environments use `node scripts/apply-migrations.js`)
3. Set `CLAUDE_API_KEY`
4. Generate and set `USER_PREFS_ENCRYPTION_KEY`: `openssl rand -hex 32`
5. Set `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and Azure AD variables
6. Set `AUTH_REQUIRED=true`
7. (Optional) Set Dynamics variables
8. (Optional) Set research API keys
9. Deploy and visit `/api/health` to verify
