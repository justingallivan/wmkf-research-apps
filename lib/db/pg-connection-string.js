/**
 * Postgres connection-string normalization for the `pg` driver.
 *
 * pg 8.x (pg-connection-string 2.x) already treats sslmode 'prefer',
 * 'require', and 'verify-ca' as 'verify-full', but emits a
 * "SECURITY WARNING" process warning on every parse. Vercel logs that
 * stderr line at level 'error', so the log drain stores it as an
 * operational event. pg 9 will switch those modes to weaker libpq
 * semantics. Rewriting them to 'verify-full' keeps today's behavior
 * (full certificate verification), silences the warning, and survives
 * the pg 9 upgrade.
 *
 * Strings that are not parseable URLs, or that carry no sslmode or some
 * other sslmode, are returned unchanged.
 */

const ALIASED_SSLMODES = new Set(['prefer', 'require', 'verify-ca']);

function withVerifyFullSslmode(connectionString) {
  if (!connectionString) return connectionString;
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  const sslmode = (url.searchParams.get('sslmode') || '').toLowerCase();
  if (!ALIASED_SSLMODES.has(sslmode)) return connectionString;
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

module.exports = { withVerifyFullSslmode };
