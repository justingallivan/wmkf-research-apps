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
| `NEXTAUTH_URL` | Production URL for OAuth callbacks | Your Vercel domain | Set to `https://wmkfresearch.vercel.app` — no rotation needed |
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
| `EXTERNAL_LINK_SECRET` | HMAC-signs external-reviewer JWTs (`/api/external/*`) | Self-generated (32+ chars; `openssl rand -base64 32`) | **Must be separate from `NEXTAUTH_SECRET`**; used by `lib/external/token-lifecycle.js` |
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
| `PERPLEXITY_API_KEY` | Perplexity panel reviewer (claim verification) | [Perplexity API](https://docs.perplexity.ai/) |

### Vercel-Managed (Auto-configured)

| Variable | Purpose | Notes |
|----------|---------|-------|
| `POSTGRES_URL` | Database connection | Auto-set when Vercel Postgres is linked |
| `BLOB_READ_WRITE_TOKEN` | File upload storage | Auto-set when Vercel Blob is linked |
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
| `ORCID_CLIENT_ID` | Researcher contact lookup | [ORCID Developer Tools](https://orcid.org/developer-tools) | Free |
| `ORCID_CLIENT_SECRET` | ORCID authentication | Created with client ID | Free |
| `SERP_API_KEY` | Google Scholar + PubPeer search | [SerpAPI](https://serpapi.com/) | ~$0.01/search |

### Optional — Per-App Model Overrides

`getModelForApp()` in `shared/config/baseConfig.js` reads a runtime env var of the form `CLAUDE_MODEL_<APP>` for static per-app overrides (DB-stored overrides via `system_settings` take precedence). Examples:

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

### Optional — Notifications & Spend Alerts

| Variable | Purpose |
|----------|---------|
| `NOTIFICATION_EMAIL_FROM` | Sender mailbox for system-alert emails. Must be a Dynamics systemuser with Server-Side Sync enabled (resolvable via `internalemailaddress`). Recipients are queried at send time as the active superuser roster (`dynamics_user_roles` joined to `user_profiles`); no `NOTIFICATION_EMAIL_TO` is required. |
| `SPEND_ALERT_EMAIL_FROM` / `SPEND_ALERT_EMAIL_TO` | Anthropic balance / daily-spend alert routing |
| `LOW_BALANCE_ALERT_CENTS` / `DAILY_SPEND_ALERT_CENTS` | Threshold tuning for alerts |
| `ANTHROPIC_BALANCE_ANCHOR_CENTS` / `ANTHROPIC_BALANCE_ANCHOR_DATE` | Manual baseline for the Anthropic balance estimator (last known balance + date) |
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

| Key | Name | Typical Expiry |
|-----|------|---------------|
| `azure_ad_client_secret` | Azure AD Client Secret | 90 days |
| `dynamics_client_secret` | Dynamics CRM Client Secret | 90 days |
| `nextauth_secret` | NextAuth Secret | No expiry (rotate if compromised) |
| `user_prefs_encryption_key` | Encryption Key | No expiry. **Rotation tooling pending Dataverse rewrite** — the legacy `scripts/rotate-encryption-key.js` was archived 2026-05-12 when the underlying `user_preferences` Postgres table was dropped. Until rewritten, key rotation requires reading all `wmkf_appuserpreferences` rows where `wmkf_isencrypted=true`, decrypting with the old key, re-encrypting with the new key, and PATCHing back via the dispatcher. |
| `cron_secret` | Cron Secret | No expiry (rotate periodically) |

---

## Setting Up a New Environment

Configure in this order:

1. Link **Vercel Postgres** (auto-sets `POSTGRES_URL`)
2. Run migrations: `node scripts/setup-database.js`
3. Set `CLAUDE_API_KEY`
4. Generate and set `USER_PREFS_ENCRYPTION_KEY`: `openssl rand -hex 32`
5. Set `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and Azure AD variables
6. Set `AUTH_REQUIRED=true`
7. (Optional) Set Dynamics variables
8. (Optional) Set research API keys
9. Deploy and visit `/api/health` to verify
