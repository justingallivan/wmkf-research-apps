---
title: Credentials Runbook
domain: security-auth
kind: runbook
status: canonical
summary: "*Quick reference for managing environment variables, rotating secrets, and diagnosing auth failures.*."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-10-02
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
| `NEXTAUTH_URL` | Production URL for OAuth callbacks and staff API Origin/Referer checks | `https://applications.wmkeck.org` (Production; set + cut over 2026-06-23, non-sensitive) | **Live value `https://applications.wmkeck.org`** — staff auth cut over to the branded host 2026-06-23 and was VERIFIED via live runtime `/api/health` + an authenticated write probe (POST/DELETE 200) on `applications.wmkeck.org`. The `lib/utils/auth.js` Origin/Referer CSRF check is ON, pinned to this host; a production-mode runtime fails closed when its allowed-origin configuration is missing or invalid. Preview normally has no `NEXTAUTH_URL`: the check derives the allowed origin from `VERCEL_URL` and fails closed if that deployment hostname is unavailable. For a bounded signed-in smoke through the registered stable Preview alias, set `NEXTAUTH_URL` to that exact alias origin only for the target Preview Git branch, deploy again, then remove the branch-scoped record and restore the alias; see `docs/AUTHENTICATION_SETUP.md` Step 2.4. Never set the Production host or a project-wide Preview override. The legacy `wmkfresearch.vercel.app` host still 403s state-changing requests and funnels sign-in to the branded host. **Caveat:** while this var was Sensitive, `vercel env pull` read it back as `""` — which caused a false "Production is empty" belief in earlier docs/memory. The real Production runtime value (verifiable only via `/api/health`) was always non-empty. Do not re-introduce the "empty" claim from a pull. See `project-branded-domains.md`. |
| `DELIBERATION_BRIEFING_PUBLIC_BASE_URL` | Shared approved public origin used when minting or rendering/reusing external deliberation briefing links and the separate materials-only presentation links; keeps the staff auth origin in `NEXTAUTH_URL` separate from Board-facing link origins. The two audiences retain separate tokens, rows, verifiers, and reissue lifecycles. | `https://<approved-public-host>` | Optional override; when unset, both link types fall back to `NEXTAUTH_URL`. The override must be an absolute HTTPS origin with no credentials, path, query, or fragment. Verify the target deployment serves `/external/briefing/*` before enabling `DELIBERATION_BRIEFING_SCHEMA_READY`, and `/external/presentation/*` before enabling post-presentation access. |
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
| `CRON_SECRET` | Authenticates `/api/cron/*` endpoints | Self-generated (`openssl rand -base64 32`) | Required for cron jobs (secret-check, retraction-watch, Cycle Dossier drain, etc.). Cycle Dossier and the strict drain verifier require the bearer in every environment; the shared verifier retains its existing local-development bypass for other routes. |
| `EXTERNAL_LINK_SECRET` | HMAC-signs external JWTs (`/api/external/*`); in Preview it also derives authenticated-encryption keys for the disposable presentation-media upload permit and proof-token subject | Self-generated (32+ chars; `openssl rand -base64 32`) | **Must be separate from `NEXTAUTH_SECRET`**; read by `lib/services/external-token.js` and the Preview-only presentation proof service. Rotatable without breaking durable live links — see [Rotating EXTERNAL_LINK_SECRET](#rotating-external_link_secret). A rotation intentionally invalidates any in-flight disposable proof permit/token; clean up its exact test item before rotating. |
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
| `OPENAI_API_KEY` | GPT panel reviewer and the shared Executor provider seam (explicit per-call opt-in only) | [OpenAI Platform](https://platform.openai.com/api-keys) | **[VERIFIED 2026-09-13 via `vercel env ls`]** Set as a Secret in Production for the Review Panel OpenAI seat; `VRP_ALLOWED_PROVIDERS=claude,openai` set the same day. | `GOOGLE_AI_API_KEY` | Gemini panel reviewer | [Google AI Studio](https://aistudio.google.com/) |
| `PERPLEXITY_API_KEY` | Perplexity — VRP panel reviewer (sonar claim verification) AND reviewer-finder web discovery (Search API, Track C). Live in prod 2026-06-05. Same key, two surfaces; setting it also makes `perplexity` a *configured* VRP provider — gate VRP exposure with `VRP_ALLOWED_PROVIDERS`. | [Perplexity API](https://docs.perplexity.ai/) |

### Vercel-Managed (Auto-configured)

| Variable | Purpose | Notes |
|----------|---------|-------|
| `POSTGRES_URL` | Database connection | Auto-set when Vercel Postgres is linked |
| `TEST_REQUEST_LEDGER_URL` | Test Request Factory **operational ledger** (`ledger_prod` in Neon project `wmkf-factory-ledger`, a Vercel Marketplace resource **not connected to any Vercel project**; `docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md` D1) | Manual. **Set in two places since 2026-10-02:** `.env.local` on each owner Mac (the CLI reads only that; never give the CLI a Vercel-pulled value) and **Vercel Production**, where the admin Test Request form (`lib/services/test-requests/admin-run-service.js`) and the maintenance sweep of Factory artifacts read it. Not set in Preview or Development. Rotate in the Neon console (reset role password), then update Vercel Production, redeploy, and update every Mac. Maps to CLI target `production` (`scripts/rehearse-test-request-sandbox.mjs` `requireLedgerUrl`/`selectLedgerVariable`, `lib/db/ledger-registry.js`); the CLI refuses the app's `POSTGRES_URL*`/`DATABASE_URL`, a connection-string query override (`?host=`, `?port=`, `?dbname=`, etc.), a socket destination, or any host not in `lib/db/ledger-registry.js` (on the managed host: database `ledger_prod` for `--target=production`, `ledger` otherwise; port must be 5432 or unset). Schema: `npm run ledger:apply -- --url-env=TEST_REQUEST_LEDGER_URL` (checksummed per-file tracker; a changed tracked file refuses rather than re-applying — see `lib/db/ledger-migrations.js`); check: `npm run check:factory-ledger -- --allow-unreachable`. |
| `TEST_REQUEST_SANDBOX_LEDGER_URL` | Factory **sandbox ledger** (`ledger` database, same Neon project) | Manual, `.env.local` on each owner Mac; maps to CLI target `sandbox` (and any non-`production` target). When unset, CLI sandbox-target modes fall back to reading `TEST_REQUEST_LEDGER_URL` for single-variable local setups; the admin form never takes that fallback (`admin-run-service.js` `ledgerUrlFor`). **Not a standing Vercel variable:** for a Preview rehearsal of the form it is added branch-scoped (`vercel env add TEST_REQUEST_SANDBOX_LEDGER_URL preview <branch>`) and removed afterwards (done 2026-10-02 for `factory-form-rehearsal`). |
| `FACTORY_BLOB_RW_TOKEN` | RW token for the Test Request Factory's private artifact store (`wmkf-factory-private`, `store_I7EbkXANJL0zeaby`): the form's saved source bundles and run manifests (`lib/services/test-requests/factory-artifact-store.js`) | Manual. **Vercel Production** (Secret, 2026-10-02) and `.env.local` on the owner Mac, where `scripts/factory-artifacts-download.mjs` reads it. Not set in Preview or Development; a Preview rehearsal uses a separate throwaway store and a branch-scoped token. Never the shared, intake or uploads token. Rotate in the store's settings, then update Vercel Production, redeploy, and update the Mac. |
| `TEST_REQUEST_FACTORY_FORM` | Write switch for the admin Test Request form. Only the literal `on` enables source lookup, Confirm, advance, status change and status recheck (`requireWritable`, `lib/services/test-requests/admin-run-service.js`); the run list, run detail, artifacts download, Foundation recheck and status options stay available without it | Manual. **`on` in Vercel Production since 2026-10-02**; unset elsewhere. Read from the deployment's own variables, so turning it off means removing it **and redeploying**; it is not an instant stop. |
| `BLOB_READ_WRITE_TOKEN` | File upload storage (public shared store `phase-ii-summaries-blob`) | Auto-set when Vercel Blob is linked |
| `DVX_BLOB_RW_TOKEN` | Dataverse Bulk Export private store (`dvx-export-private`) RW token | Manual — see "Private Blob store provisioning" below |
| `INTAKE_BLOB_RW_TOKEN` | Applicant intake drain private store (`intake-applicant-private`, `store_Eaui32n6i2wYMS6E`, `iad1`) RW token | Manual — same provisioning shape as DVX |
| `UPLOADS_BLOB_RW_TOKEN` | Shared private store (`wmkf-uploads-private`, `store_WvoDkxrlWniAuJAj`, `iad1`) RW token — document uploader plus actor-bound portal image staging | Manual — set in **dev + preview + production** (2026-06-11). Private uploads fail closed where unset. Portal staging mints 15-minute single-path client tokens and server-reads only ledger pathnames; `scripts/probe-private-blob-client-access.mjs` must prove public override fails before release. See "Private Blob store provisioning" below |
| `DOSSIER_BLOB_READ_WRITE_TOKEN` | Dedicated private Blob RW token for Cycle Dossier immutable inputs and Word/PDF artifacts | **[VERIFIED 2026-09-07]** Connected under the custom `DOSSIER_BLOB` prefix in Development, Preview, and Production for store `wmkf-cycle-dossier-private` (`store_W9WC1TLR7kpl9hty`); managed token authenticated in Development. Do not claim Preview/Production runtime authentication until rollout preflight proves it. |
| `DOSSIER_BLOB_STORE_ID` | Managed store identity paired with the dedicated Cycle Dossier Blob token | **[VERIFIED 2026-09-07]** `store_W9WC1TLR7kpl9hty`; rollout preflight performs an authenticated read-only list and checks token/store identity. |
| `CYCLE_DOSSIER_ENABLED` | Cycle Dossier pilot activation flag | **Source-built 2026-09-07; disabled until rollout.** Set literal `true` only after migration 045, private Blob token, and governed prompts are verified; cron remains inert otherwise. |
| `TRANSCRIPTION_PILOT_ENABLED` | AssemblyAI transcription pilot route and worker interlock | **Shared-source rollout guidance: keep unset/off** until migration 060, private Blob access, encryption/HMAC keys, and operational readiness are verified. Separate scope: the isolated dedicated Production pilot has a dated 2026-10-01 checkpoint with this switch enabled; see [`postgres-transcription-pilot.md`](atlas/postgres-transcription-pilot.md). Do not infer configuration on the prior shared-project alias. |
| `TRANSCRIPTION_SUBMISSIONS_ENABLED` | AssemblyAI new-submission interlock | **Shared-source rollout guidance: keep unset/off** except during an explicitly approved pilot window; recovery, polling, and cleanup remain available while new submissions are disabled. Separate scope: the isolated dedicated Production pilot checkpoint dated 2026-10-01 records new submissions disabled; see [`postgres-transcription-pilot.md`](atlas/postgres-transcription-pilot.md). Do not infer configuration on the prior shared-project alias. |
| `ASSEMBLYAI_API_KEY` | AssemblyAI server-side API key for upload, submit, poll, and delete | Direct AssemblyAI account credential; server-only. Production Secret presence and one successful end-to-end provider transcription were verified 2026-10-02 PT; no secret value is recorded here. Track as `assemblyai_api_key`. |
| `ASSEMBLYAI_WEBHOOK_SECRET` | AssemblyAI callback HMAC credential | Server-only shared secret; generate independently from the provider API key, at least 32 bytes. Production Secret presence verified 2026-10-02 PT; callback delivery/signature validation remains unverified. No secret value is recorded here. Track as `assemblyai_webhook_secret`. |
| `TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY` | Encryption key for persisted AssemblyAI upload references | Server-only independent key, 32 bytes encoded as 64 hex characters. Production Secret presence and successful provider-reference use during the tested lifecycle verified 2026-10-02 PT; no secret value is recorded here. Track as `transcription_reference_encryption_key`. |
| `CYCLE_DOSSIER_REQUEST_ALLOWLIST` | Server-owned comma-separated request IDs or request numbers admitted to the controlled cohort | **Source-built 2026-09-07; not configured.** Required before activation; keep to the explicitly rehearsed request(s). |
| `CYCLE_DOSSIER_ROLLOUT_MODE` | Cohort mode: `pilot` admits any authenticated superuser; `smoke` requires the configured operator profile and exactly one allowlisted request | **Source-built 2026-09-07; defaults to `pilot`.** Use `smoke` for the first one-request rehearsal. |
| `CYCLE_DOSSIER_OPERATOR_PROFILE_ID` | One authenticated superuser profile allowed when rollout mode is `smoke` | **Source-built 2026-09-07; required in `smoke` mode.** The profile must already satisfy the normal active-superuser check. |
| `REVIEW_PANEL_BLOB_READ_WRITE_TOKEN` | Dedicated private Blob RW token for the Virtual Review Panel Phase A foundation's per-entry DOCX/PDF report editions (D11) | **[VERIFIED 2026-09-13 via `vercel env ls`]** Store `wmkf-review-panel-private` (`store_cwVLLxRMR3A8NFA2`) created in the dashboard and connected under the custom `REVIEW_PANEL_BLOB` prefix (Production, Preview). The dashboard connect used the OIDC model and created only the store id and a webhook public key; the RW token was copied from the store page and set as a Secret in Production and Preview. Not set in Development. Code refuses a token identical to the dossier, shared, intake, or uploads token. |
| `REVIEW_PANEL_BLOB_STORE_ID` | Managed store identity paired with the dedicated Review Panel Blob token | **[VERIFIED 2026-09-13]** `store_cwVLLxRMR3A8NFA2`, auto-created by the dashboard connect step (Production, Preview). Required alongside the token by `assertReviewPanelStorageConfigured`; launch and every paid dispatch fail closed without both. |
| `REVIEW_PANEL_ENABLED` | Review Panel Phase A activation flag (readable config, not a secret) | **[VERIFIED 2026-09-13]** `true` in Production (readable config) after migration 047, the dedicated store, and the prompt seeds (`review-panel.seat` v1, `review-panel.chair` v1). Drain cron scheduled per minute in `vercel.json` the same day. |
| `REVIEW_PANEL_ROLLOUT_MODE` | Cohort mode: `pilot`, `smoke`, or `access` (readable config, not a secret). `access` (S511, owner decision T2) makes the admin-panel `review-panel` app grant the cohort control and ignores `REVIEW_PANEL_REQUEST_ALLOWLIST`. | **[VERIFIED 2026-09-13 via `vercel env pull` after the PR #291 redeploy]** `access` in Production (was `smoke` during the four-request smoke earlier the same day); the allowlist variable remains set but is ignored in this mode. Defaults to `pilot` when unset; an unrecognised value fails closed (503, `assertReviewPanelModeValid`). |
| `REVIEW_PANEL_REQUEST_ALLOWLIST` | Server-owned comma-separated request IDs or request numbers admitted to the controlled cohort (readable config, not a secret) | **[VERIFIED 2026-09-13]** Four D26 request numbers in Production (owner's smoke subset). Parser trims whitespace; smoke mode admits at most four and requires exactly one selection per launch. |
| `CYCLE_DOSSIER_OPERATOR_STOP` | Immediate process-level outer stop checked before paid calls and SharePoint writes | **Source-built 2026-09-07; unset by default.** The durable Postgres operator stop is the authoritative pause and settles queued/running runs. |
| `NODE_ENV` | Environment flag | Auto-set (`production` on Vercel, `development` locally) |

### Optional — Meeting Tracker transcription (Production enabled after controlled acceptance)

These non-secret controls belong to the Meeting Tracker transcription flow,
not the separately hosted AssemblyAI `transcription-pilot` deployment and its
`TRANSCRIPTION_PILOT_ENABLED` / `TRANSCRIPTION_SUBMISSIONS_ENABLED` switches.
After the controlled, non-sensitive Production acceptance on 2026-10-02 PT,
the Meeting Tracker schema readiness, bundle readiness, and access controls are
enabled for staff. Use is limited to non-sensitive recordings; confidential use
is not approved. The provider's training opt-out and one-day asynchronous
retention were accepted, but this is not zero-data-retention. The separate
synthetic rehearsal/supervised-test gates remain off; they are not Production
access controls. The legacy dedicated-pilot switches remain unset/off in the
shared application.

| Variable | Purpose | Contract |
|----------|---------|----------|
| `MEETING_TRACKER_TRANSCRIPTION_ACCESS` | Independent rollout access for Meeting Tracker transcription | `on` allows eligible server-bound requests; exact `test:<request GUID>` narrows access to that matching request. Unset, malformed, or any other value resolves to off. Production is `on` after controlled acceptance (2026-10-02 PT); do not copy that state to another environment without approval. |
| `MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY` | Meeting Tracker transcription schema interlock | Only literal `on` marks the required schema ready. The service fails closed unless this and the access control both allow the request. Production is `on` after exact schema readback (2026-10-02 PT); readiness alone does not authorize a request. |
| `MEETING_TRANSCRIPTION_REHEARSAL_ENABLED` | Narrow synthetic speaker read/save rehearsal interlock | Only literal `on` permits the exact rehearsal page/API after independent project, Preview, identity, schema-ready, and request-access checks. Intended only for the dedicated test Preview project; it does not enable transcription processing or the provider. Keep unset/off elsewhere. |
| `MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED` | Separate fixed-request Meeting Tracker supervised-test interlock | Only literal `on` enables this mode, and only when the dedicated test project, Preview/auth, exact sandbox Dynamics origin, fixed request access, Meeting Tracker and post-presentation schema/access, and callback-origin checks pass. It is mutually exclusive with `MEETING_TRANSCRIPTION_REHEARSAL_ENABLED=on`; `TRANSCRIPTION_PILOT_ENABLED` and `TRANSCRIPTION_SUBMISSIONS_ENABLED` must not be `true`. Unset or literal `off` disables it; any other present value claims the mode and fails closed unless the complete contract is valid. It remains unset/off in Production; it is not the general staff access switch. |
| `MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY` | Optional Request Document transcript-manifest projection readiness | Only literal `on` permits the optional memo field to be selected, and only for a read explicitly opting into the transcript-bundle projection. Production is `on` after the optional Dataverse field was provisioned and read back exactly (2026-10-02 PT). This readiness alone does not authorize access. |

No additional credential is introduced by this flow. All three required
AssemblyAI secrets are present in Production. Provider authentication and
reference encryption were exercised by the successful E2E lifecycle; callback
delivery remains unverified. Daily/hourly cron schedules are registered and
manual platform invocations succeeded, but scheduled-time delivery has not
been observed. The incomplete-maintenance warning email was accepted for
delivery; receipt in the inbox is unverified.

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
| `TEST_REQUEST_ISOLATION` | Rollout switch for the Test Request Factory's read-side guards (email refusal at the Dynamics email seam, early grantee/materials refusals; later scheduled-job skips and report exclusion). Only the literal `'on'` enables it; unset or any other value leaves them inactive (fails open, like `DATAVERSE_DAL_ENFORCEMENT`). Turn it on in an environment only after that environment's Dataverse has the `wmkf_istestrequest` / `wmkf_testcreationrunid` columns: while on, a request whose marker cannot be read has its email refused, so turning it on before the schema apply would stop all request-regarding email. The marker write guard is always active and is not controlled by this switch. Non-sensitive. See `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` (Stage 1). |
| `SYNTHETIC_REVIEWER_ISOLATION` | Rollout switch for the Test Request Factory's synthetic-reviewer read-side fences (`lib/services/test-requests/isolation.js` `syntheticReviewerIsolationEnabled`): while on, person discovery in `lib/dataverse/adapters/potential-reviewer.js` filters on `wmkf_potentialreviewers.wmkf_issyntheticreviewer`; explicit-ID reads in `lib/services/review-manager/reviewers-service.js` and `lib/services/reviewer-finder/my-candidates-service.js` select the marker without filtering those linked people out. `lib/services/reviewer-merge.js` then refuses to merge a row that carries the marker. Only the literal `'on'` enables it; unset or any other value leaves the current read-side fences inactive (fails open). Turn it on in an environment only after that environment's Dataverse has the wave30 column (`lib/dataverse/schema/wave30-synthetic-reviewer-marker/`, confirmed PRESENT by probe section 1): a `$select`/`$filter` naming a missing column returns 400, so turning it on first would break those reviewer reads. Non-sensitive. See `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` (*Order* 3). |
| `DATAVERSE_ALLOW_PROD_READS` | `yes` allows preview/local reads of production Dataverse (Mode B shadow-reads); anything else denies | Manual, preview/local only, set when a shadow comparison is actually running |
| `DATAVERSE_PROD_WRITE_ACK` | `"<purpose> <YYYY-MM-DD>"` — operator ack for local scripts writing prod; honored only for deployment class `local` and only when the date is today (UTC) | Per-invocation operator shell only — never committed, never set in Vercel |
| `DATAVERSE_REHEARSAL_GRANT` | JSON Mode-D rehearsal grant (`purpose`/`ops`/`entitySets`/`recordIds` (GUID-only)/`expiresAt`); `$batch` and alternate-key writes are never grant-coverable | Per-rehearsal, removed after; never in production env unless a Mode-D rehearsal is live |

**B4 deployment contract [VERIFIED via branch source, 2026-09-29]:** The “fails open” descriptions above apply only to the older read-side fences. B4 requires `SYNTHETIC_REVIEWER_ISOLATION=on` before any existing-person reviewer bind or identity edit, including ordinary people. A marked synthetic reviewer also requires `TEST_REQUEST_ISOLATION=on` and an exact server-read Request/person binding. If either switch is off, unset, or invalid, the acceptance drain pauses **all** jobs before Contact, honorarium, or BILL writes; maintenance reports the configuration pause as failed. Keep both switches at literal `on` in every environment receiving B4. For a B4 rollback, redeploy the prior code before disabling either switch; disabling a switch alone interrupts reviewer workflows. Verify the environment's wave29 and wave30 columns before deploying B4.

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
| `REVIEWER_INSTITUTION_MEASUREMENT` | Exact `on` enables best-effort, privacy-minimized reviewer-institution observation writes. Migration 051 being present does not enable writes; no runtime consumer reads the table for selection or write authority. | **[VERIFIED 2026-09-15.]** Migration 051 is applied to the shared Production/Preview database and the table is empty. The variable is absent in both Vercel environments and therefore disabled. Keep unset/`off` until owner-authorized prospective measurement. |
| `REVIEWER_INSTITUTION_PHASE2` | Dormant server-only gate for independent-identity evidence projection, typed affiliation assertions, request/candidate-bound roster receipts, and fail-closed additional-affiliation COI recomputation at both reviewer save boundaries. Only the literal `on` enables it; any other value preserves the incumbent response and write path. Current producers do not establish `current` assertion evidence or server-only proposal-citation lineage, so enabling it now would hold ordinary reviewer saves for missing or incomplete institution evidence. This is separate from the public Stage 2 presentation flag and from measurement migration 051. | **[PLANNED 2026-09-15.]** Keep unset/`off` in every deployed environment until the dated-currentness policy, server-only citation marker, card/remedy projection, full flag-off equality suite, and owner-approved high-authority rollout are complete. |
| `REVIEW_SYNTHESIS_AUTOMATION_ENABLED` | Master rollout gate for `/api/cron/drain-review-syntheses`. The route authenticates and returns an inert `automation_disabled` response unless the value is exactly `true`. Migration 028, signed-in verification, and the bounded automatic production smoke completed 2026-07-28; Production is deliberately set to exact `true`. | Production: `true`; unset/anything else disables |
| `REVIEW_DOCX_SHAREPOINT_WRITE` | Non-sensitive master write gate for `/api/cron/file-review-docx`, the local operator backfill, and exact local repair. Only literal `on` permits generated individual-review DOCX uploads and pointer commits. The writer additionally requires an enforcing Dataverse target interlock and the exact canonical akoyaGO SharePoint site. Scheduled calls require a Production deployment; backfill/repair calls require a local process, the tracked Production Dataverse target bound into a reviewed manifest, and a current `DATAVERSE_PROD_WRITE_ACK`. That acknowledgement is process-wide rather than record-scoped; the service separately asserts every exact suggestion PATCH URL before Graph mutation and again per row. | **Production is exact `on` as of 2026-09-03; natural filing proved 2026-09-04.** Ready activation-proof deployment `dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM` returned an authenticated enabled response for exact D26; the known test row was then safely removed from the filing population. Production maintenance run `70820` subsequently processed one naturally received review and created `Reviews/Review-1002959-Manuel Müller.docx` (version `1.0`, 43,498 bytes) without error; Dataverse independently held the matching complete pointer. Request `1002874` remains independently verified at `Reviews/Review-1002874-Agnes Karasik.docx` version `4.0`, and its obsolete generated tree remains absent. |
| `REVIEW_DOCX_SHAREPOINT_CYCLE` | Exact automatic-filing cohort (`JYY` or `DYY`) for `/api/cron/file-review-docx`. Scheduled discovery requires that exact suggestion cycle stamp and processes newest receipts first. The separate adversarially reviewed operator backfill accepts a required exact `--cycle`, unions exact stamps with request meeting-cycle fallback, excludes complete pointer pairs from its unfinished population, and binds any later execution to a reviewed manifest. Dry-run-only `--exclude-test-request` retains an owner-confirmed test request visibly in the hash-bound manifest and fails closed when unmatched. | **Production is exact `D26` as of 2026-09-03.** The first enabled route response independently echoed `cycleCode:D26`. The exact approved v4 D26 manifest completed 22 created / zero failed; row-by-row reconciliation matched every reviewed identity, destination, semantic hash, and unique SharePoint item. Fresh post-write survey hash `f17eae89d00bf1c85301ae7a0b7ad6f3de37ff394030fbb0d66de793d10b1b64` has zero eligible missing files, zero reconcile candidates, zero blockers, and only the visible Request `1003223` test exclusion. Manifest and timestamped result files are create-only and contain no answer/document content. A cleanup failure may record bounded identifier/error telemetry in Postgres. |
| `GUARDED_REOPEN_SCHEMA_READY` | Non-sensitive Wave 20 schema-readiness interlock. Only literal `on` lets the adapter select guarded-reopen columns, lets generation include the cycle property on a Request Document create, and lets `/api/workbench/pre-site-visit/reopen` execute; unset or any other value keeps base Request Document reads and creates compatible and makes the route return 503 before Dataverse work. Set only after the target preflight reports three exact fields and zero absent/divergent, then deploy/redeploy. Once any correction cycle exists, never unset it as rollback because generation identity must keep reading the cycle; roll runtime back while retaining the schema and flag. | **Production: exact `on` (2026-08-23)** after approved Wave 20 apply and 3-exact/0-divergent readback; Ready deployment `dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp` includes the value |
| `SITE_VISIT_LOGISTICS_SCHEMA_READY` | Non-sensitive Wave 21 schema-readiness interlock. Only literal `on` lets the Site Visit adapter select the additive format/IANA-zone/location/attendee-reference fields or lets the logistics and calendar paths execute. Unset or any other value leaves the legacy custom Activity readable through its base fields and returns 503 before logistics writes. Set only after the target preflight reports all four fields exact and zero absent/divergent, then deploy/redeploy. Once Site Visit logistics rows exist, retain the additive schema and flag during runtime rollback so their identity map remains readable. | **[VERIFIED LIVE 2026-08-24.]** Wave 21 is exact in sandbox and Production; the non-sensitive literal `on` value is present in Vercel Preview and Production. Production deployment `dpl_A3PED8cA22G88dAKL4jafBAro5tn` is Ready. |
| `SITE_VISIT_MATERIALS_SCHEMA_READY` | Non-sensitive migration-042 readiness interlock for the applicant materials collection. Only literal `on` enables `/api/meeting-tracker/visits/[requestId]/materials` (503 after auth) and the `/api/external/materials/[token]/*` contributor routes (404 before any read). Owner sets it after applying migrations 042 and 043. | Manual, per environment |
| `SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY` | Non-sensitive exact-`on` readiness interlock for the applicant materials job ledger and schema-dependent reads/worker. Set only after migration 060 is applied and the physical schema/readiness gate passes. **Production verified 2026-10-02:** `on`; migration 060 and the physical table/column are present. | Production: `on` (verified 2026-10-02); other environments: verify separately |
| `SITE_VISIT_MATERIALS_BACKGROUND_ADMISSION_ENABLED` | Non-sensitive exact-`on` admission gate for queueing applicant materials uploads. It is effective only when `SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY=on` and `VIRUS_SCAN_ENABLED` is enabled. With admission off, the existing synchronous finalize path remains in use. **Production verified 2026-10-02:** `on`; first real background job completed successfully. | Production: `on` (verified 2026-10-02); other environments: verify separately |
| `MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL` | Fixed local-shell-only input for the guarded Production materials recovery CLI. Never configure it in Vercel, commit it, print it, or accept an alternate URL/environment selector. The CLI requires explicit Production target, expected host/database, exact job/action confirmations for mutations, verified TLS, and connected database/public-schema assertions inside the resolver transaction; errors must be sanitized and inspect must remain read-only. **Verified 2026-10-02:** owner-authorized agent read-only probe passed target/TLS checks and returned expected `job_not_found` for a deliberately nonexistent UUID; no recovery mutation was run. | Not stored in Vercel; owner provides the fixed input for an authorized local inspect/recovery session |
| `POST_PRESENTATION_MATERIALS_SCHEMA_READY` | Non-sensitive dual-store readiness interlock for post-presentation materials. Only literal `on` lets the Request Document adapter select Wave 30 `wmkf_ExternalUrl`/`wmkf_SlotVersion`; unset or any other value preserves the legacy projection. Set only after migration 055 is applied to that environment's Postgres and `scripts/preflight-post-presentation-materials-schema.mjs --target=<target>` reports both Dataverse fields exact with zero absent/divergent following a separately approved additive apply. Readiness never authorizes a producer by itself. | **[SOURCE-BUILT 2026-09-25; not configured.]** Keep unset/off until both stores are applied and read back exactly. |
| `POST_PRESENTATION_MATERIALS_ACCESS` | Independent server-only rollout access mode: `off`, `test:<request GUID>`, or `on`. Unset/empty is `off`; malformed values fail closed. `test` compares the normalized configured GUID only with a trusted server-derived Request binding, never a client override. Every future producer, consumer, resume/finalize path, external-token resolution, and cleanup mutation must recheck it independently. | **[SOURCE-BUILT 2026-09-25; not configured.]** Keep `off` through schema application and compatible deployment. A bounded live test must use an owner-approved human-created disposable Request because the Test Request Factory is unfinished. |
| `POST_PRESENTATION_MATERIALS_CLEANUP` | Independent destructive-cleanup permission for expired durable MP4 intents. Only literal `on`, together with valid general access mode `on`, permits the daily reconciler to abandon a Graph-confirmed closed session or delete one exact stable candidate after a proven zero-row generation-key lookup. Unset/other values keep cleanup inspect/refresh/record/alert-only. It never authorizes a producer, broad folder cleanup, or registry-bound deletion. | **[SOURCE-BUILT/OFFLINE-TESTED 2026-09-25; not configured or approved live.]** Keep unset until the owner separately approves routine Production cleanup after the bounded release gate. Named test cleanup still needs its own concrete approval. |
| `DELIBERATION_BRIEFING_SCHEMA_READY` | Non-sensitive schema-readiness interlock for the deliberation briefing page (`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`). Only literal `on` lets Share mint a briefing link and add its section to the email, lets `/api/workbench/pre-site-visit/briefing-link` answer, and lets `/api/external/briefing/[token]/*` verify tokens; unset or any other value leaves every send path byte-identical to before and answers 404/503. Set only after migration `038_deliberation_briefing_links.sql` is applied to that environment's Postgres. Runtime rollback is unsetting the flag; the migration is additive and stays. Stored links are sealed with `USER_PREFS_ENCRYPTION_KEY`: rotating that key makes every live briefing link read back as `briefing_link_unreadable` until staff issue a new one, so reissue after any rotation. | **[PLANNED 2026-09-09 (S502).]** Not set in any environment; the owner applies migration 038 and sets the flag before the first deliberation session. |
| `FINAL_WRITEUP_SCHEMA_READY` | Non-sensitive Wave 22 readiness interlock. Only literal `on` lets the Request Document adapter select explicit Final Writeup transition actor/time fields or lets the Final Writeup service read/write its transition contract. Unset or any other value keeps existing Request Document reads schema-compatible, makes GET report unavailable, and makes POST return 503 before Dataverse work. Set only after `scripts/preflight-final-writeup-schema.mjs` reports two exact DateTime fields and two exact systemuser relationships with zero absent/divergent. Once Final rows exist, retain the additive schema and flag during runtime rollback so their explicit transition attribution remains readable. | **Production: exact `on` (2026-08-30 PT)** after Wave 22 readback reported 4 exact / 0 absent / 0 divergent. Ready deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ` contains the value; Request `1002788` then Production-proved the explicit group-review actor/time contract. |
| `FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY` | Separate non-sensitive Wave 23 readiness interlock. Only literal `on` lets the acknowledgement service read or write `wmkf_finalwriteupreviewacknowledgement`; unset or any other value makes the deployed acknowledgement and dashboard routes return 503 before runtime Dataverse work and leaves the Final Word action usable. Set only after `scripts/preflight-final-writeup-review-acknowledgement-schema.mjs --target=<target>` reports 11 exact / 0 absent / 0 divergent / 0 pending and the Final-document + reviewer alternate-key index is Active. Retain the additive schema once rows exist; runtime rollback should remove/revert code while preserving schema and readable state. | **Production: exact `on`; Preview: unset (verified 2026-08-31).** Wave 23 schema was reconfirmed exact/Active before activation. Production deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo` is Ready; signed-in reads proved responsible-PD exclusion, and the later eligible-colleague retry produced the independently verified first complete acknowledgement row for Request `1002788`. |
| `REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY` | Non-sensitive Wave 24 readiness interlock. Only literal `on` lets the Request Document adapter select or write `wmkf_InitiatedBy`/`wmkf_InitiatedAt` and lets Site Visit write `wmkf_MilestoneCreatedBy`. While off, reads and writes retain their pre-Wave-24 shape. Once Wave 24 runtime is deployed to Vercel Production, off is an unhealthy health-check state even though availability-first flows remain usable. Set only after `scripts/preflight-request-document-explicit-actor-schema.mjs --target=<target>` reports all three artifacts exact with zero absent/divergent, following a separately approved additive apply. Retain the schema and flag during rollback once attributed rows exist. | **Production: exact `on` (2026-08-31); Preview: unset.** The approved additive apply and independent readback reported 3 exact / 0 absent / 0 divergent. Commit `8ff4205a0ad43337cd987a4fc76639f936bab4bc` first reached Ready Production deployment `dpl_D94J9aRcfLfK81iBDsVYARVhZFPb`; signed-in Admin health reported the Wave 24 readiness service enabled. Naturally generated Request `1002874` then proved Pre-Site origin attribution: explicit Justin Gallivan actor/time, application built-in creator, no missing-attribution event, and census 1 attributed / 0 event-backed / 0 violations. Site Visit milestone attribution remains opportunistic proof on the next natural handoff. |
| `MEETING_TRACKER_SCHEMA_READY` | Non-sensitive Wave 28 readiness interlock. Only literal `on` may let Meeting Tracker routes, adapters, and services read or write `wmkf_deliberationsession` / `wmkf_deliberationslot`. Unset or any other value makes every tracker route return 503 before Dataverse work, keeps the app tile visible as **Not yet enabled**, and makes the shared schedule reader return all-null. Set only after `scripts/preflight-meeting-tracker-schema.mjs --target=<target>` reports 22 exact / 0 absent / 0 divergent following a separately approved additive apply. Retain the schema and flag during runtime rollback once session or slot rows exist. | **[VERIFIED LIVE 2026-09-15.]** Production is exact `on`; a fresh read-only Production preflight reported 22 exact / 0 absent / 0 divergent. The Meeting Tracker runtime is live. |
| `DRAIN_BATCH_SIZE` | Intake drain cron batch size for `/api/cron/drain-submissions`. | `5` |
| `DRAIN_LOCK_TTL_SECONDS` | Intake drain lease length; cron cadence and retry behavior assume this is much larger than the 2-minute schedule. | `600` |
| `WAVE2_BACKEND_GRANT_CYCLES` | Legacy migration guard for grant-cycle reads. `postgres` is no longer supported and fails loudly; unset/default is Dataverse. | unset / `dataverse` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist used by legacy shared config. | unset → `*` |
| `API_SECRET_KEY` | Legacy client API-key encryption secret in `shared/utils/apiKeyManager.js`; production fails closed if unset on that path. Prefer `USER_PREFS_ENCRYPTION_KEY` for current saved preferences. | unset locally; required only if that legacy path is used in production |
| `ENABLE_CACHE` / `ENABLE_LOGGING` / `LOG_LEVEL` | Legacy shared-config toggles for cache/log behavior. | cache/logging enabled unless set to `false`; log level `info` |
| `CLAUDE_API_URL` / `CLAUDE_MODEL` | Legacy base Claude endpoint/model overrides in `shared/config/baseConfig.js`. Prefer canonical `lib/services/llm-client.js` transport and per-app model override rules above. | unset |
| `VIRUS_SCAN_ENABLED` | App-side Cloudmersive virus scanning on upload surfaces (reviewer uploads and applicant materials background processing). Fail-closed when on — see [Virus scanning](#virus-scanning-virus_scan_enabled--cloudmersive_api_key) for the runbook. | Production: `true` (verified 2026-10-02); other environments: verify separately |
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

## Rotating the app Postgres password (`POSTGRES_URL` family)

The app database is Neon project `expert-reviewers-neon-db` (ID `falling-surf-05640504`, AWS us-west-2), connected to Vercel through the Neon Marketplace integration. The Factory ledger project `wmkf-factory-ledger` is a different project (see the end of this section). One role password (`neondb_owner`) is embedded in every password-bearing variable.

The app runtime reads `POSTGRES_URL` (directly, and implicitly through `@vercel/postgres` `sql`/`db`) and `DATABASE_URL`. The Factory CLI's shared-database fence also compares against `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL` and `DATABASE_URL_UNPOOLED` (`lib/db/ledger-registry.js:61-64`) [VERIFIED 2026-09-30 by grep of `lib/`, `pages/`, `shared/`, `scripts/`].

| Carries the password | No secret |
|---|---|
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PGPASSWORD` | `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_DATABASE`, `NEON_PROJECT_ID` |

**Cadence:** on exposure (pasted into chat or a ticket, printed in a terminal or log), on offboarding someone with Vercel or Neon access, or about every 12 months.

**Outage window:** the old password stops working at the reset. Production cannot reach Postgres until the redeploy in step 3 is Ready (about 4 minutes on 2026-10-01). Do it at a quiet hour, away from the 08:00 UTC cron jobs (`vercel.json`).

### Step by step

1. **Reset the password:** Neon console → `expert-reviewers-neon-db` → Roles → `neondb_owner` → Reset password. Check the project ID first.
2. **Confirm that Vercel synced.** The integration rewrites all 16 variables itself within seconds of the reset; there is no manual edit [VERIFIED 2026-10-01: every variable's `updatedAt` was the same second]. Check Settings → Environment Variables for "updated just now", or list the metadata (`vercel api /v10/projects/<id>/env`, never with `decrypt`).
3. **Redeploy Production:** Deployments → latest Production → ⋯ → Redeploy. Environment changes reach only new deployments. Running Preview deployments keep the old password until they are rebuilt.
4. **Update local env files without handling values by hand.** `vercel env pull <scratch>/pulled.env --environment=development --yes` writes the values to a scratch file. Then copy only the `POSTGRES*`/`PG*`/`DATABASE_URL*` lines into each target, and delete the scratch file. Targets: the main checkout's `.env.local` (worktree `.env.local` files are symlinks to it) and any standalone file such as the feature-request worktree's `.env.presentation-proof.local`. Find them with `find`; the Bash tool's `grep` skips `.env*` files. Repeat on every other owner Mac.
5. **Verify without printing values:** a `select 1` through `pg` for `POSTGRES_URL`, `DATABASE_URL`, `POSTGRES_URL_NON_POOLING` and `DATABASE_URL_UNPOOLED` from each file. In Production, the next `health_check_history` row (cron every 15 minutes) should be `healthy`, with no new `system_alerts`. `/api/health` redirects unauthenticated callers.
6. **Record** the rotation date in the session handoff. (Postgres is not in `lib/utils/tracked-secrets.js`.)

### Sensitive variables: decided "leave readable" (owner, 2026-10-01)

Vercel shows **Needs Attention** on the 8 password-bearing variables because they are stored as readable `encrypted`, not `sensitive`. Three options were considered:
- **A, chosen:** leave them as they are. Rotation stays fully automatic. The accepted risk is that members of the Vercel team can read the current password.
- **B, Production only:** the integration resource's Settings → Allowed Environments → Production only. It makes the credentials Sensitive, but removes them from Preview and Development and blocks non-production connections. Rejected while branch Previews serve as an acceptance venue against the shared database (Preview acceptance receipts 2026-09-29/30).
- **C, hand-made Sensitive copies:** delete and re-add each variable as Sensitive. Rejected because it is unconfirmed whether the integration would still update hand-made copies on the next reset.

Revisit B if Preview acceptance leaves the workflow.

### Protected `main` branch (owner, 2026-10-01)

The app project's `main` branch is a Neon protected branch [owner-reported 2026-10-01, Session 560]. It cannot be deleted or reset (the data reset that restores a branch from its parent), and the project cannot be deleted while it is protected. The Launch plan allows 2 protected branches per project, so one slot remains. The ledger project `wmkf-factory-ledger` is unprotected; the 2026-09-30 `pg_dump` files back it up.

- **Connection strings are unchanged.** Protection did not alter the host, roles or passwords, so no Vercel or local env edits followed.
- **Password rotation still works.** Resetting the `neondb_owner` *role password* (step 1 above) is allowed on a protected branch.
- **Child branches get new passwords.** A branch created from `main` (for example, an isolated rehearsal branch) receives freshly generated role passwords. Take every connection variable from that branch's own connection details; never splice Production's password onto the branch host.

### Common mistakes

- Printing a connection string while trying to extract its host. A `sed` over the URL that fails to match prints the whole URL, password included (2026-10-01, which forced this rotation's urgency). Parse with `new URL()` and print only `hostname`, or don't print at all.
- Resetting the ledger project instead of the app project: the console opens on whichever project was last viewed.
- Forgetting to redeploy: until then the live deployment holds the dead password.
- Forgetting the second Mac, or a standalone `.env.*.local` that is not a symlink.

The Factory ledger credentials (`TEST_REQUEST_LEDGER_URL`, `TEST_REQUEST_SANDBOX_LEDGER_URL`) belong to Neon project `wmkf-factory-ledger`, which is connected to no Vercel project. Since 2026-10-02 `TEST_REQUEST_LEDGER_URL` is also a hand-set Vercel **Production** variable for the admin Test Request form; the sandbox URL is in Vercel only for the length of a Preview rehearsal. Rotate in that project's Neon console, then for the production URL update the Vercel Production variable and redeploy, update both Macs' `.env.local`, and run `npm run check:factory-ledger`. Until the redeploy, the form and the Factory artifact sweep hold the dead password.

---

## Private Blob store provisioning (`DVX_BLOB_RW_TOKEN`, `INTAKE_BLOB_RW_TOKEN`, `UPLOADS_BLOB_RW_TOKEN`, `DOSSIER_BLOB_READ_WRITE_TOKEN`, `FACTORY_BLOB_RW_TOKEN`)

These env vars hold RW tokens for **dedicated PRIVATE** Vercel Blob stores. They are deliberately separate from the shared `BLOB_READ_WRITE_TOKEN` (which is bound to the public `phase-ii-summaries-blob` store used by uploads / reviewer-finder / review-manager / maintenance) and must NOT be conflated. Apps that PUT or GET against a private store with the public token will fail at the Blob API layer.

| Var | Store name | Store ID | Region |
|-----|-----------|----------|--------|
| `DVX_BLOB_RW_TOKEN` | `dvx-export-private` | (read from dashboard) | `iad1` |
| `INTAKE_BLOB_RW_TOKEN` | `intake-applicant-private` | `store_Eaui32n6i2wYMS6E` | `iad1` |
| `UPLOADS_BLOB_RW_TOKEN` | `wmkf-uploads-private` | `store_WvoDkxrlWniAuJAj` | `iad1` |
| `DOSSIER_BLOB_READ_WRITE_TOKEN` | Dedicated Cycle Dossier private store (`wmkf-cycle-dossier-private`) | `store_W9WC1TLR7kpl9hty` | Connected all environments; Development authentication verified 2026-09-07; prove Preview/Production runtime during rollout preflight |
| `REVIEW_PANEL_BLOB_READ_WRITE_TOKEN` | Dedicated Review Panel private store (D11) | `store_cwVLLxRMR3A8NFA2` (`wmkf-review-panel-private`) | Connected under the `REVIEW_PANEL_BLOB` prefix in Production and Preview 2026-09-13; RW token set as a Secret in both; Development not connected. |
| `FACTORY_BLOB_RW_TOKEN` | `wmkf-factory-private` (Test Request Factory artifacts) | `store_I7EbkXANJL0zeaby` | `iad1`. Created 2026-10-02. The token was added by hand as a Production Secret. The store was also connected to the project under the default `BLOB` prefix, which added `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` to Production and Preview; neither is read by the app or by the installed `@vercel/blob`, and the shared `BLOB_READ_WRITE_TOKEN` was not replaced [VERIFIED via `vercel env ls` and source grep, 2026-10-02]. Disconnecting the store from the project should remove both (not done, not verified). When creating a store for a hand-named token, skip the connect step. |

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
2. **Decline the auto-link prompt** when CLI offers to connect it to the project — accepting overwrites `BLOB_READ_WRITE_TOKEN`. **CLI 59.x no longer offers a decline** (it refuses to create without `--yes`, which links); create the store in the dashboard instead and connect it under a custom env prefix (e.g. `REVIEW_PANEL_BLOB`), as done for the Review Panel store 2026-09-13. The dashboard connect creates only the OIDC `…_STORE_ID` and webhook key; copy the RW token from the store page and set it yourself (see step 3).
3. Open the Vercel dashboard → Storage → the new store → Copy the RW token.
4. Set the token under the correct custom env name per env: `vercel env add DVX_BLOB_RW_TOKEN` (or `INTAKE_BLOB_RW_TOKEN`), pasting the token at the prompt. Repeat for `production`, `preview`, and `development`.

### Where they're consumed in code

- **DVX:** `pages/api/dataverse-export/run.js` writes (`access: 'private'`); `pages/api/dataverse-export/download.js` reads via the authenticated proxy. Missing token → pre-stream fail-loud 502 `BLOB_STORE_UNCONFIGURED`.
- **Intake:** `pages/api/intake/draft/upload-token.js` mints a path-scoped client-upload token; `pages/api/intake/draft/attach.js` GETs + DELETEs for the synchronous virus-scan step; `MaintenanceService.sweepIntakePending` reaps stale pending attachments. Single source of truth for token reads is `lib/utils/intake-blob.js` (fail-loud on missing/whitespace).

### Sender constraints

These stores are private — direct browser fetches against their Blob URLs return 404/403. Retrieval MUST go through an authenticated server-side proxy (`/api/dataverse-export/download?t=<token>` for DVX; the drain's three-call attach dance for intake). The "shipping a short-lived public Blob URL to the browser" pattern is explicitly NOT used for these stores; see the Track B build plan §5 for the rationale. Cycle Dossier artifacts use the dedicated `DOSSIER_BLOB_READ_WRITE_TOKEN` and worker-side exact-path retrieval.

The Cycle Dossier store follows the same dedicated-token rule. The private
store `wmkf-cycle-dossier-private` (`store_W9WC1TLR7kpl9hty`) is connected under
the custom `DOSSIER_BLOB` prefix in all environments, and the managed token was
authenticated in Development on 2026-09-07. Do not put it in
`BLOB_READ_WRITE_TOKEN` or reuse the intake/uploads token. The service fails
closed when this token is absent and reads only server-persisted exact pathnames
with SHA-256/size checks. Keep `CYCLE_DOSSIER_ENABLED` false until the
read-only rollout preflight proves each environment's token/store identity and
the controlled smoke is authorized; no generation, SharePoint artifact
publication, deployment, or promotion is claimed.

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
| SSO login or state-changing staff API calls fail with no obvious configuration error | Production `NEXTAUTH_URL` is missing/invalid, or Preview lacks a usable `VERCEL_URL` | Set the branded `NEXTAUTH_URL` in Production; normally leave it unset in Preview and verify the deployment's `VERCEL_URL` |
| Signed-in GET through the stable Preview alias works, but a cookie-bearing POST returns CSRF-origin 403 | The alias Origin differs from the immutable `VERCEL_URL` used by Preview | Follow `docs/AUTHENTICATION_SETUP.md` Step 2.4: exact branch-scoped alias `NEXTAUTH_URL`, new deployment and POST smoke, then alias and env rollback |
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
| `assemblyai_webhook_secret` | AssemblyAI callback HMAC secret | hmac | No vendor expiry; independently generate and rotate on compromise/offboarding or at least annually. |
| `transcription_reference_encryption_key` | Transcription provider-reference encryption key | hmac | No vendor expiry; rotation requires decrypt/re-encrypt of retained provider references before replacing the key. |
| `claude_api_key` | Anthropic Claude API Key | vendor | No vendor expiry, but rotate on compromise or staff offboarding |
| `openai_api_key` | OpenAI API Key (Executor provider seam; opt-in) | vendor | No assumed vendor expiry; rotate on compromise or staff offboarding and update every enabled runtime environment |
| `openalex_api_key` | OpenAlex API Key | vendor | Authenticated request credential; rotate on compromise and update every runtime environment |
| `cloudmersive_api_key` | Cloudmersive API Key (virus scan; gated by VIRUS_SCAN_ENABLED) | vendor | Pilot uses free tier (800 scans/mo); rotate on compromise |
| `perplexity_api_key` | Perplexity API Key (VRP sonar claim-verification + reviewer web discovery) | vendor | No vendor expiry, but rotate on compromise or staff offboarding. Live in prod 2026-06-05; one key, two surfaces (set `VRP_ALLOWED_PROVIDERS` to gate VRP exposure). |
| `assemblyai_api_key` | AssemblyAI transcription API key (pilot) | vendor | Vendor-issued; rotate via AssemblyAI account controls and update all intentionally enabled runtime environments. Production Secret presence and one successful provider transcription verified 2026-10-02 PT. |
| `blob_read_write_token` | Vercel Blob RW Token (shared store) | blob | Vercel-issued; no expiry; rotate via Vercel dashboard if compromised |
| `dvx_blob_rw_token` | Vercel Blob RW Token (dvx-export-private) | blob | Same as above |
| `intake_blob_rw_token` | Vercel Blob RW Token (intake-applicant-private) | blob | Same as above |
| `dossier_blob_read_write_token` | Vercel Blob RW Token (Cycle Dossier private store) | blob | **[VERIFIED 2026-09-07]** Connected under the custom `DOSSIER_BLOB` prefix; Development authentication verified for `store_W9WC1TLR7kpl9hty`. Prove Preview/Production runtime during rollout preflight before activation |
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
