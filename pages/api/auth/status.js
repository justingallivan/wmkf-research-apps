/**
 * API Route: /api/auth/status
 *
 * Returns the client-bootstrap view of whether authentication is configured.
 * Used by `RequireAuth` and the sign-in page bootstrap to decide whether to
 * redirect unauthenticated visitors before any session cookie exists.
 *
 * **Intentionally public.** The response shape MUST stay `{ enabled: boolean }`
 * — never grow this endpoint to expose tenant IDs, client IDs, configured
 * provider names, env-var presence flags, or any other deployment metadata.
 * The boolean alone is what the client needs and is the only thing that's
 * safe to expose pre-auth. If you need richer config on the client, gate it
 * behind a session.
 *
 * This endpoint reports enabled when ALL of these conditions are met:
 * 1. AUTH_REQUIRED=true (kill switch - set to false to disable auth)
 * 2. Azure AD credentials are configured (CLIENT_ID, CLIENT_SECRET, TENANT_ID)
 *
 * IMPORTANT: this predicate is not the server enforcement policy. In any
 * runtime where NODE_ENV=production (including Vercel Preview and Production),
 * `isAuthRequired()` fails closed unless EMERGENCY_AUTH_BYPASS=true. Therefore
 * this endpoint can report `enabled:false` while the server still enforces
 * authentication. See docs/AUTHENTICATION_SETUP.md. The divergence is a known
 * P1 and must not be described as a working single-variable kill switch.
 */

export default function handler(req, res) {
  const hasCredentials = !!(
    process.env.AZURE_AD_CLIENT_ID &&
    process.env.AZURE_AD_CLIENT_SECRET &&
    process.env.AZURE_AD_TENANT_ID
  );

  // Client-bootstrap configuration flag; not the fail-closed server policy.
  const authRequired = process.env.AUTH_REQUIRED === 'true';

  const enabled = authRequired && hasCredentials;

  res.status(200).json({ enabled });
}
