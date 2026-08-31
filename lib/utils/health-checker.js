/**
 * Health Check Utility
 *
 * Extracted from pages/api/health.js so both the API endpoint and
 * the health-check cron job can reuse the same logic.
 *
 * Tests 8 services: Database, Claude API, Azure AD, Dynamics CRM,
 * Microsoft Graph, Encryption key, NEXTAUTH_URL, and Wave 24 readiness.
 *
 * Returns { timestamp, overall, services } where overall is
 * 'healthy', 'degraded', or 'unhealthy'.
 */

const { sql } = require('@vercel/postgres');
const {
  requestDocumentExplicitActorReadinessHealth,
} = require('./request-document-explicit-actor-readiness');

/**
 * Run all health checks and return a combined result.
 *
 * @returns {{ timestamp: string, overall: string, services: Object, responseTimeMs: number }}
 */
async function runHealthChecks() {
  const start = Date.now();
  const isDev = process.env.NODE_ENV === 'development';
  const services = {};

  // 1. Database
  try {
    const result = await sql`SELECT COUNT(*) as tables FROM information_schema.tables WHERE table_schema = 'public'`;
    services.database = { status: 'ok', detail: `${parseInt(result.rows[0].tables)} tables in public schema` };
  } catch (error) {
    services.database = { status: 'error', message: isDev ? error.message : 'Service check failed' };
  }

  // 2. Claude API
  if (process.env.CLAUDE_API_KEY) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Reply with the word ok.' }],
        }),
      });
      if (response.ok) {
        services.claude = { status: 'ok', detail: 'Tested with claude-haiku-4-5-20251001' };
      } else {
        let message = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          if (data.error?.message) message = isDev ? data.error.message : `HTTP ${response.status}`;
        } catch {}
        services.claude = { status: 'error', message };
      }
    } catch (error) {
      services.claude = { status: 'error', message: isDev ? error.message : 'Service check failed' };
    }
  } else {
    services.claude = { status: 'error', message: 'CLAUDE_API_KEY not set' };
  }

  // 3. Azure AD (SSO) — verify tenant's OpenID Connect discovery endpoint is reachable
  if (process.env.AUTH_REQUIRED === 'true' && process.env.AZURE_AD_TENANT_ID) {
    try {
      const response = await fetch(
        `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0/.well-known/openid-configuration`
      );
      if (response.ok) {
        const data = await response.json();
        services.azureAd = data.issuer
          ? { status: 'ok', detail: 'OpenID Connect discovery endpoint reachable' }
          : { status: 'error', message: 'Discovery document missing issuer' };
      } else {
        services.azureAd = { status: 'error', message: `Discovery endpoint returned HTTP ${response.status}` };
      }
    } catch (error) {
      services.azureAd = { status: 'error', message: isDev ? error.message : 'Azure AD unreachable' };
    }
  } else {
    services.azureAd = {
      status: 'skipped',
      detail: process.env.AUTH_REQUIRED !== 'true' ? 'AUTH_REQUIRED is not true' : 'Missing tenant config',
    };
  }

  // 4. Dynamics CRM
  if (process.env.DYNAMICS_CLIENT_ID && process.env.DYNAMICS_TENANT_ID) {
    try {
      const response = await fetch(
        `https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.DYNAMICS_CLIENT_ID,
            client_secret: process.env.DYNAMICS_CLIENT_SECRET,
            scope: `${process.env.DYNAMICS_URL || 'https://wmkf.crm.dynamics.com'}/.default`,
          }).toString(),
        }
      );
      const data = await response.json();
      services.dynamicsCrm = {
        status: data.access_token ? 'ok' : 'error',
        ...(data.access_token && { detail: 'OAuth token acquired for CRM API' }),
        ...(data.error && { message: isDev ? `${data.error}: ${data.error_description?.split('.')[0]}` : 'Service check failed' }),
      };
    } catch (error) {
      services.dynamicsCrm = { status: 'error', message: isDev ? error.message : 'Service check failed' };
    }
  } else {
    services.dynamicsCrm = { status: 'skipped', detail: 'DYNAMICS_CLIENT_ID or DYNAMICS_TENANT_ID not set' };
  }

  // 5. Microsoft Graph (SharePoint access)
  if (process.env.DYNAMICS_CLIENT_ID && process.env.DYNAMICS_TENANT_ID) {
    try {
      const response = await fetch(
        `https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.DYNAMICS_CLIENT_ID,
            client_secret: process.env.DYNAMICS_CLIENT_SECRET,
            scope: 'https://graph.microsoft.com/.default',
          }).toString(),
        }
      );
      const data = await response.json();
      services.microsoftGraph = {
        status: data.access_token ? 'ok' : 'error',
        ...(data.access_token && { detail: 'Graph API token acquired (SharePoint access)' }),
        ...(data.error && { message: isDev ? `${data.error}: ${data.error_description?.split('.')[0]}` : 'Service check failed' }),
      };
    } catch (error) {
      services.microsoftGraph = { status: 'error', message: isDev ? error.message : 'Service check failed' };
    }
  } else {
    services.microsoftGraph = { status: 'skipped', detail: 'DYNAMICS_CLIENT_ID not set' };
  }

  // 6. Encryption key
  services.encryption = process.env.USER_PREFS_ENCRYPTION_KEY
    ? { status: 'ok', detail: 'AES-256-GCM key present' }
    : { status: 'error', message: 'USER_PREFS_ENCRYPTION_KEY not set — API key storage will fail' };

  // 7. NEXTAUTH_URL
  services.nextAuthUrl = process.env.NEXTAUTH_URL
    ? { status: 'ok', detail: process.env.NEXTAUTH_URL }
    : { status: 'warning', message: 'NEXTAUTH_URL not set — using VERCEL_URL fallback' };

  // 8. Wave 24 readiness. Once this code is in Vercel Production, silently
  // leaving the schema flag off is unhealthy even though compatibility mode
  // keeps current writes available.
  services.requestDocumentExplicitActorReadiness =
    requestDocumentExplicitActorReadinessHealth(process.env);

  // Overall status
  const statuses = Object.values(services).map(s => s.status);
  const hasError = statuses.includes('error');
  const hasWarning = statuses.includes('warning');
  const overall = hasError ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy';

  return {
    timestamp: new Date().toISOString(),
    overall,
    services,
    responseTimeMs: Date.now() - start,
  };
}

module.exports = { runHealthChecks };
