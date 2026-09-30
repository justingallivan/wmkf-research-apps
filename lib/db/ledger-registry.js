/**
 * Test Request Factory ledger host registry
 * (docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md, Phase 2).
 *
 * A tracked, code-reviewed allowlist of where the Factory's operational
 * ledger may live, in the same spirit as lib/dataverse/core/target-registry.js:
 * the CLI classifies the ACTUAL hostname of TEST_REQUEST_LEDGER_URL against
 * these entries, never the variable name. Extending the list is a reviewed
 * commit, not an env edit. Exact hostnames only.
 *
 * The managed ledger is Neon project `wmkf-factory-ledger` (a Vercel
 * Marketplace resource connected to no Vercel project; owner decision D1,
 * 2026-09-30). Both ledger databases (`ledger_prod`, `ledger`) share its
 * host, so the database name carries the production/sandbox distinction —
 * see `expectedLedgerDatabase`. Only the pooled hostname the owner supplied
 * is registered; the direct (non `-pooler`) form is deliberately absent
 * until someone verifies and adds it.
 *
 * The app's own Postgres is never a ledger host: the CLI additionally
 * refuses any URL equal to a configured POSTGRES_URL-family or DATABASE_URL value.
 */

/** Hostnames of the managed ledger project. */
export const MANAGED_LEDGER_HOSTS = ['ep-restless-haze-b8zxkdcl-pooler.c-14.us-east-1.aws.neon.tech'];

/** Local Docker/Colima ledgers (tests, and the interim hand-carried copies). */
export const LOCAL_LEDGER_HOSTS = ['127.0.0.1', 'localhost'];

/** @returns {'managed-ledger'|'local'|null} */
export function classifyLedgerHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (MANAGED_LEDGER_HOSTS.includes(host)) return 'managed-ledger';
  if (LOCAL_LEDGER_HOSTS.includes(host)) return 'local';
  return null;
}

/**
 * Database name a managed ledger URL must carry for a CLI target.
 * `production` → ledger_prod; any other target → ledger. Local hosts are
 * exempt (their database names are the owner's).
 */
export function expectedLedgerDatabase(target) {
  return target === 'production' ? 'ledger_prod' : 'ledger';
}

/**
 * Classifies a ledger URL for a CLI target. Returns { ok, label, reason }.
 * Never throws and never echoes the URL.
 */
export function classifyLedgerUrl(url, { target = null, sharedUrls = [] } = {}) {
  if (!url) return { ok: false, label: null, reason: 'unset' };
  if (sharedUrls.includes(url)) return { ok: false, label: null, reason: 'shared_database' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, label: null, reason: 'unparseable' };
  }
  const label = classifyLedgerHost(parsed.hostname);
  if (!label) return { ok: false, label: null, reason: 'unregistered_host' };
  if (label === 'managed-ledger' && target) {
    const database = parsed.pathname.replace(/^\//, '');
    const expected = expectedLedgerDatabase(target);
    if (database !== expected) return { ok: false, label, reason: `wrong_database:${expected}` };
  }
  return { ok: true, label, reason: null };
}
