# Credentials Runbook

*Quick reference for managing environment variables, rotating secrets, and diagnosing auth failures.*

## What Expires

Only two credentials expire automatically. Everything else is stable until manually rotated.

| Credential | Expires | Where to Check |
|------------|---------|----------------|
| `AZURE_AD_CLIENT_SECRET` | Yes — 6mo, 1yr, or 2yr from creation | Azure Portal → App registrations → *Keck Research Tools* → Certificates & secrets |
| `DYNAMICS_CLIENT_SECRET` | Yes — same schedule | Azure Portal → App registrations → *Dynamics CRM* app → Certificates & secrets |

**Set a calendar reminder 2 weeks before each expiration date.**

---

## All Environment Variables

### Required for Core Functionality

| Variable | Purpose | Source | Rotation |
|----------|---------|--------|----------|
| `CLAUDE_API_KEY` | AI processing for all apps | [Anthropic Console](https://console.anthropic.com) → API Keys | Create new key, update in Vercel, revoke old one |
| `NEXTAUTH_URL` | Production URL for OAuth callbacks and staff API Origin/Referer checks | Held empty on purpose for the dual-host staff rollout; future target `https://applications.wmkeck.org` at deprecation time | **Production is currently empty** (`NEXTAUTH_URL=""`, verified via env pull 2026-06-23). The Azure prerequisite is now MET — the staff app registration includes `https://applications.wmkeck.org/api/auth/callback/azure-ad` and branded-host staff sign-in is verified. The var is held empty deliberately so BOTH `applications.wmkeck.org` and legacy `wmkfresearch.vercel.app` work during rollout (host-derived callbacks). Setting `NEXTAUTH_URL=https://applications.wmkeck.org` is the deprecation switch: it pins the callback AND activates the `lib/utils/auth.js` Origin/Referer CSRF check (currently OFF), after which state-changing requests from the old host return 403. Flip only after staff have migrated; then redeploy and smoke a staff sign-in + one cookie-bearing write from the branded host. |
| `REVIEWER_PORTAL_BASE_URL` | Public base URL used in external-reviewer invitation links | `https://reviews.wmkeck.org` | Non-secret. Active in Production as of 2026-06-23 and redeployed. Defaults to `NEXTAUTH_URL` if unset, but keep explicit so reviewer email links move independently from staff OAuth callbacks. |
| `GRANTEE_PORTAL_BASE_URL` | Public base URL used in grantee deliverables magic-links (invite + reminder) | `https://grantees.wmkeck.org` | Non-secret. Active in Production as of 2026-06-23 and redeployed. Code resolves `GRANTEE_PORTAL_BASE_URL || NEXTAUTH_URL || ''` — **MUST be set** while `NEXTAUTH_URL` remains empty or grantee links are hostless/broken. |
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
| `CRON_SECRET` | Authenticates `/api/cron/*` endpoints | Self-generated (`openssl rand -base64 32`) | Required for cron jobs (secret-check, retraction-watch, etc.) |
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
| `UPLOADS_BLOB_RW_TOKEN` | Shared document-uploader private store (`wmkf-uploads-private`, `store_WvoDkxrlWniAuJAj`, `iad1`) RW token — Phase 1 private-blob migration of `FileUploaderSimple` | Manual — set in **dev + preview + production** (2026-06-11); live smoke **passed**; **all three consumers promoted to prod 2026-06-11** (`expense-reporter` + `phase-i-dynamics` + `grant-reporting` flags set + deployed; grant-reporting prod-verified). Private uploads fail closed where the token is unset. See "Private Blob store provisioning" below |
| `NODE_ENV` | Environment flag | Auto-set (`production` on Vercel, `development` locally) |

### Optional — Dynamics Explorer

| Variable | Purpose | Source |
|----------|---------|--------|
| `DYNAMICS_URL` | CRM instance URL | `https://wmkf.crm.dynamics.com` |
| `DYNAMICS_TENANT_ID` | Azure tenant for CRM | Same as `AZURE_AD_TENANT_ID` |
| `DYNAMICS_CLIENT_ID` | CRM app registration ID | Azure Portal → separate app registration |
| `DYNAMICS_CLIENT_SECRET` | CRM app secret | Azure Portal → same app → Certificates & secrets |
| `DYNAMICS_SANDBOX_URL` | Sandbox CRM instance (probe scripts only) | `https://wmkfsandbox.crm.dynamics.com` |
| `DYNAMICS_IMPERSONATION_ENABLED` | Send `MSCRMCallerID` on user-driven Dynamics writes | Manual (`true` to enable) — off by default; see `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` |
| `SHAREPOINT_SITE_URL` | SharePoint Graph base | e.g., `https://appriver3651007194.sharepoint.com/sites/akoyaGO` |
| `REVIEWER_MATERIALS_FOLDERS` | Allowlist for external reviewer file visibility | Manual (default `Reviewer_Downloads`) |

### Optional — Research APIs

| Variable | Purpose | Source | Cost |
|----------|---------|--------|------|
| `NCBI_API_KEY` | PubMed higher rate limits | [NCBI Account](https://www.ncbi.nlm.nih.gov/account/settings/) | Free |
| `ORCID_CLIENT_ID` | Researcher contact lookup **+ identity-spine verification (OpenAlex+ORCID Track-A)** | [ORCID Developer Tools](https://orcid.org/developer-tools) | Free |
| `ORCID_CLIENT_SECRET` | ORCID authentication | Created with client ID | Free |
| `SERP_API_KEY` | Reviewer contact lookup + PubPeer + news (integrity). NOT academic search — Scholar metrics/literature migrated to OpenAlex S251 | [SerpAPI](https://serpapi.com/) | ~$0.01/search |

> **Load-bearing for the reviewer identity spine:** the OpenAlex+ORCID Track-A
> verifier (`reviewer-identity-evidence.js`) uses `ORCID_CLIENT_ID`/`ORCID_CLIENT_SECRET`
> to corroborate a candidate's current employment. **Without them the spine cannot
> reach `probable`/`confirmed` and silently degrades to `needs-review` for
> non-biomedical / PubMed-off suggestions** — it fails safe (never mis-verifies), but
> resolution rate drops. `OPENALEX_POLITE_MAILTO` sets the OpenAlex polite-pool
> contact — configured in Vercel as `alerts@wmkeck.org` (a real, monitored,
> non-sensitive WMKF mailbox; OpenAlex uses it only to reach us about API usage).
> If unset (e.g. local/test), requests use the common pool and no contact email is
> sent. Never hardcode a fabricated address.

### Optional — Per-App Model Overrides

`getModelForApp()` in `shared/config/baseConfig.js` reads a runtime env var of the form `CLAUDE_MODEL_<APP>` for static per-app overrides (DB-stored overrides in Dataverse `wmkf_appsystemsettings`, loaded via `loadModelOverrides()`, take precedence — the Postgres `system_settings` table was dropped 2026-05-12; see §"How It Works" below). Examples:

- `CLAUDE_MODEL_REVIEWER_FINDER=claude-sonnet-4-6`
- `CLAUDE_MODEL_BATCH_PHASE_I_SUMMARIES=claude-haiku-4-5-20251001`
- App key transformation: lowercase + hyphens → uppercase + underscores. The full app-key list is in `shared/config/appRegistry.js`.

Prefer the admin dashboard (`/admin` → Models tab) for non-static overrides — env var values are baked into the deployment until next redeploy.

### Optional — Operational Flags

| Variable | Purpose | Default |
|----------|---------|---------|
| `PROMPT_RESOLVER_STRICT` | Disable bundled-prompt fallback in `lib/services/prompt-resolver.js` | unset (fallback enabled) |
| `WAVE1_BACKEND_SETTINGS` | Dispatch flag for settings backend. Default Dataverse since Wave 1 closeout 2026-05-12; setting to `postgres` fails loudly (table dropped). | `dataverse` (implicit) |
| `WAVE1_BACKEND_APP_ACCESS` | Dispatch flag for app-access backend. Default Dataverse since 2026-05-12. | `dataverse` (implicit) |
| `WAVE1_BACKEND_PREFS` | Dispatch flag for user-preferences backend. Default Dataverse since 2026-05-12. | `dataverse` (implicit) |
| `DEBUG_REVIEWER_FINDER` | Verbose logging for Reviewer Finder pipeline | unset |
| `VIRUS_SCAN_ENABLED` | App-side Cloudmersive virus scanning on upload surfaces (today: reviewer uploads). Fail-closed when on — see [Virus scanning](#virus-scanning-virus_scan_enabled--cloudmersive_api_key) for the runbook. | unset (scanning skipped) |
| `CLOUDMERSIVE_API_KEY` | Cloudmersive virus-scan API key. Required when `VIRUS_SCAN_ENABLED=true`. Free tier 800 scans/month. | unset |
| `HONORARIUM_ONBOARDING_DEFERRED` | Forces reviewer honorarium onboarding to **capture-only**: `ensureHonorariumOnboarding()` captures contact + mailing address then STOPS before minting the honorarium `akoya_request` or calling BILL (`lib/bill/honorarium-onboard-orchestrator.js:54`). Capture-only is *also* implied whenever the discriminator GUIDs (`HONORARIUM_PROGRAM_ID` / `HONORARIUM_GRANTPROGRAM_ID` / `HONORARIUM_TYPE_ID`) are unset — but this flag is the **explicit** lock that still holds if those GUIDs are later configured. **SET to `true` in Production 2026-06-22** as the capture-only lock for the reviewer onboarding-at-accept cycle: addresses are captured for manual checks and **no Bill.com payment can fire this cycle**. The three discriminator GUIDs are intentionally **unset** in prod. To go live on Bill.com later: configure the GUIDs *and* unset this flag. | unset (this cycle: `true` in prod) |

### Optional — Notifications & Spend Alerts

| Variable | Purpose |
|----------|---------|
| `NOTIFICATION_EMAIL_FROM` | Sender mailbox for system-alert emails. Must be a Dynamics systemuser with Server-Side Sync enabled (resolvable via `internalemailaddress`). Recipients are resolved at send time via the per-category routing config in `/admin` → Alert Recipients (Dataverse setting `alertRecipientsByCategory`), falling back to the active superuser roster. |
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

App-side malware scanning for user-uploaded files. Today: reviewer uploads (both external-token and staff session paths) via `lib/services/review-upload.js`. Future: intake-portal attach endpoint.

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
| SSO login fails, no error visible | `NEXTAUTH_URL` not set | Add `NEXTAUTH_URL` in Vercel |
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
| `claude_api_key` | Anthropic Claude API Key | vendor | No vendor expiry, but rotate on compromise or staff offboarding |
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
