/**
 * Single source of truth for which secrets the platform tracks for rotation
 * / expiration alerting.
 *
 * Consumed by:
 *   - `pages/api/cron/secret-check.js`     (daily threshold alerts)
 *   - `pages/api/admin/secrets.js`         (superuser UI to set expirations)
 *   - `docs/CREDENTIALS_RUNBOOK.md`        (table is kept in sync by hand;
 *                                           the canonical list is THIS file)
 *
 * Key naming: lowercase snake_case (NOT SCREAMING_SNAKE). Dataverse settings
 * are stored as `secret_expiration:<key>` / `secret_rotation:<key>` using
 * this lowercase form — matches the original 5 entries' convention.
 *
 * Tier marker (informational, no behavior):
 *   - `vendor`      — vendor-issued credential with a real expiration date
 *                     (Azure AD client secrets, etc.). secret_expiration:* MUST
 *                     be set or the cron silently reports 'not_tracked'.
 *   - `hmac`        — long-lived HMAC / shared secret with no vendor expiration.
 *                     Set secret_expiration:* to a synthetic value
 *                     (last_rotation + recommended_cadence) to force a rotation
 *                     reminder.
 *   - `blob`        — Vercel Blob RW token. No expiration; tracked for rotation
 *                     cadence + visibility.
 *   - `forward`     — secret tracked here in anticipation of an upcoming slice.
 *                     The underlying env var / consumer may not exist yet. Safe
 *                     to leave in the list — the cron reports 'not_tracked'
 *                     until expiration is set.
 */

export const TRACKED_SECRETS = [
  // ─── Vendor-issued (have real expiration dates) ───
  { key: 'azure_ad_client_secret',           name: 'Azure AD Client Secret',                                  tier: 'vendor' },
  { key: 'dynamics_client_secret',           name: 'Dynamics CRM Client Secret',                              tier: 'vendor' },
  { key: 'external_azure_ad_client_secret',  name: 'External Entra ID Client Secret (applicant intake)',     tier: 'vendor' },

  // ─── HMAC / shared secrets (no vendor expiration — rotation cadence only) ───
  { key: 'nextauth_secret',                  name: 'NextAuth Secret',                                         tier: 'hmac' },
  { key: 'cron_secret',                      name: 'Cron Secret',                                             tier: 'hmac' },
  { key: 'user_prefs_encryption_key',        name: 'User Preferences Encryption Key',                         tier: 'hmac' },
  { key: 'external_link_secret',             name: 'External Reviewer Link Secret (HMAC for JWT)',            tier: 'hmac' },
  { key: 'irs_verify_secret',                name: 'IRS Verify Secret (PowerAutomate shared)',                tier: 'hmac' },
  { key: 'bill_webhook_secret',              name: 'BILL Webhook Secret (HMAC for /api/webhooks/bill)',       tier: 'hmac' },
  { key: 'bill_integration_secret',          name: 'BILL Integration Secret (respond.js → /api/bill/onboard-reviewer)', tier: 'hmac' },

  // ─── API keys ───
  { key: 'claude_api_key',                   name: 'Anthropic Claude API Key',                                tier: 'vendor' },
  { key: 'cloudmersive_api_key',             name: 'Cloudmersive API Key (virus scan; gated by VIRUS_SCAN_ENABLED)', tier: 'vendor' },

  // ─── Vercel Blob RW tokens ───
  { key: 'blob_read_write_token',            name: 'Vercel Blob RW Token (shared store)',                     tier: 'blob' },
  { key: 'dvx_blob_rw_token',                name: 'Vercel Blob RW Token (dvx-export-private)',               tier: 'blob' },
  { key: 'intake_blob_rw_token',             name: 'Vercel Blob RW Token (intake-applicant-private)',         tier: 'blob' },

  // ─── Forward-declared (route/consumer ships in an upcoming slice) ───
  // (none currently)
];
