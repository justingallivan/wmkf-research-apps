/**
 * Dataverse option-set int values for BILL-related fields.
 *
 * `wmkf_exisitngbillcomaccount` is a global option-set on akoya_request with
 * three labels: "Yes", "No", "Recently Confirmed". The int values aren't
 * stable across environments without metadata import, so they must be probed.
 *
 * Probe script: scripts/probe-bill-option-set-values.js (run once per
 * environment; output a Vercel env var or fill these constants below).
 *
 * Fail-loud check: assertOptionSetValuesConfigured() throws if values aren't
 * set AND BILL_ENABLED is true, so chunk 6 can ship in BILL_ENABLED=false
 * fallback mode (which never reads these) without breaking.
 */

// TODO(post-sandbox): populate from probe. Until then, BILL_ENABLED=true must
// not be set in any environment, or onboardReviewer() will throw on attempt.
export const BILLCOM_ACCOUNT_YES = parseEnvInt(process.env.BILLCOM_ACCOUNT_YES_VALUE);
export const BILLCOM_ACCOUNT_NO = parseEnvInt(process.env.BILLCOM_ACCOUNT_NO_VALUE);
export const BILLCOM_ACCOUNT_RECENTLY_CONFIRMED = parseEnvInt(
  process.env.BILLCOM_ACCOUNT_RECENTLY_CONFIRMED_VALUE,
);

export function assertOptionSetValuesConfigured() {
  if (BILLCOM_ACCOUNT_YES === null || BILLCOM_ACCOUNT_NO === null) {
    throw new Error(
      'BILL option-set values not configured: set BILLCOM_ACCOUNT_YES_VALUE and ' +
      'BILLCOM_ACCOUNT_NO_VALUE env vars. Run scripts/probe-bill-option-set-values.js ' +
      'against the target Dataverse environment to get them.',
    );
  }
}

function parseEnvInt(v) {
  if (typeof v !== 'string' || v.length === 0) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
