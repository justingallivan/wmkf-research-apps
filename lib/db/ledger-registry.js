/**
 * Test Request Factory ledger host registry
 * (docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md, Phase 2;
 * Codex round-1 Fix 1 validates the EFFECTIVE connection destination
 * node-postgres will actually use, not the URL's authority text).
 *
 * A tracked, code-reviewed allowlist of where the Factory's operational
 * ledger may live, in the same spirit as lib/dataverse/core/target-registry.js:
 * the CLI classifies the ACTUAL destination node-postgres resolves for
 * TEST_REQUEST_LEDGER_URL against these entries, never the variable name or
 * the URL's raw text. Extending the list is a reviewed commit, not an env
 * edit. Exact hostnames only.
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
 * refuses any URL whose EFFECTIVE {host, port, database, user} tuple equals
 * that of a configured POSTGRES_URL-family or DATABASE_URL value (as well as
 * raw-string equality).
 *
 * classifyLedgerUrl parses the candidate with node-postgres's own driver
 * parser (`pg-connection-string`), the same library `pg.Client` uses, so the
 * destination validated here is the destination pg will actually connect to
 * — not just the URL's `new URL()` authority, which a `?host=`/`?port=`
 * query override can silently disagree with.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse: parsePgConnectionString } = require('pg-connection-string');

/** Hostnames of the managed ledger project. */
export const MANAGED_LEDGER_HOSTS = ['ep-restless-haze-b8zxkdcl-pooler.c-14.us-east-1.aws.neon.tech'];

/**
 * Local Docker/Colima ledgers (tests, and the interim hand-carried copies).
 * `::1` is IPv6 loopback, the same host as `127.0.0.1`; it is included so an
 * IPv6-literal local connection string classifies the same way.
 */
export const LOCAL_LEDGER_HOSTS = ['127.0.0.1', 'localhost', '::1'];

/**
 * Connection-string query keys that let libpq override the host/port/database/
 * credentials the URL's own authority names. Any of these present in the
 * query string is an automatic refusal — the class of bug is "URL authority
 * says one place, the actual connection goes somewhere else" — regardless of
 * what the override's value happens to be.
 */
const QUERY_OVERRIDE_KEYS = new Set([
  'host', 'hostaddr', 'port', 'dbname', 'user', 'password', 'options', 'service', 'uselibpqcompat',
]);

const MANAGED_PORT = '5432';

/** @returns {'managed-ledger'|'local'|null} */
export function classifyLedgerHost(hostname) {
  const host = normalizeHost(hostname);
  if (MANAGED_LEDGER_HOSTS.includes(host)) return 'managed-ledger';
  if (LOCAL_LEDGER_HOSTS.includes(host)) return 'local';
  return null;
}

function normalizeHost(hostname) {
  let host = String(hostname || '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host;
}

/**
 * The effective {host, port, database, user} tuple node-postgres will use
 * for `url`, via the driver's own connection-string parser. Returns null if
 * the string cannot be parsed. Port is null when the URL leaves it at the
 * Postgres default (5432); never returns the password.
 */
function effectiveTuple(url) {
  let parsed;
  try {
    parsed = parsePgConnectionString(url);
  } catch {
    return null;
  }
  return {
    host: normalizeHost(parsed.host),
    port: parsed.port ? String(parsed.port) : null,
    database: parsed.database || '',
    user: parsed.user || '',
  };
}

function tuplesMatch(a, b) {
  return a.host === b.host
    && (a.port || MANAGED_PORT) === (b.port || MANAGED_PORT)
    && a.database === b.database
    && a.user === b.user;
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
 * Selects the env variable name a CLI target should read
 * (Codex round-1 Fix 7). `production` always reads
 * TEST_REQUEST_LEDGER_URL. Any other target reads
 * TEST_REQUEST_SANDBOX_LEDGER_URL when it is set, falling back to
 * TEST_REQUEST_LEDGER_URL for single-variable local setups. Pure function of
 * (target, env) so it is testable without touching process.env.
 */
export function selectLedgerVariable(target, env = process.env) {
  if (target === 'production') return 'TEST_REQUEST_LEDGER_URL';
  if (env.TEST_REQUEST_SANDBOX_LEDGER_URL) return 'TEST_REQUEST_SANDBOX_LEDGER_URL';
  return 'TEST_REQUEST_LEDGER_URL';
}

/**
 * Classifies a ledger URL for a CLI target. Returns
 * { ok, label, reason, effective } where `effective` is the {host, port,
 * database} node-postgres will actually use (never user/password). Never
 * throws and never echoes the URL.
 */
export function classifyLedgerUrl(url, { target = null, sharedUrls = [] } = {}) {
  if (!url) return { ok: false, label: null, reason: 'unset', effective: null };
  if (sharedUrls.includes(url)) return { ok: false, label: null, reason: 'shared_database', effective: null };

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return { ok: false, label: null, reason: 'unparseable', effective: null };
  }
  for (const key of urlObj.searchParams.keys()) {
    if (QUERY_OVERRIDE_KEYS.has(key.toLowerCase())) {
      return { ok: false, label: null, reason: 'query_override', effective: null };
    }
  }

  const tuple = effectiveTuple(url);
  if (!tuple) return { ok: false, label: null, reason: 'unparseable', effective: null };
  const effective = { host: tuple.host, port: tuple.port || MANAGED_PORT, database: tuple.database };

  for (const shared of sharedUrls) {
    const sharedTuple = effectiveTuple(shared);
    if (sharedTuple && tuplesMatch(tuple, sharedTuple)) {
      return { ok: false, label: null, reason: 'shared_database', effective };
    }
  }

  if (tuple.host.startsWith('/')) return { ok: false, label: null, reason: 'socket_destination', effective };

  const label = classifyLedgerHost(tuple.host);
  if (!label) return { ok: false, label: null, reason: 'unregistered_host', effective };

  if (label === 'managed-ledger' && tuple.port && tuple.port !== MANAGED_PORT) {
    return { ok: false, label, reason: 'wrong_port', effective };
  }

  if (label === 'managed-ledger' && target) {
    const expected = expectedLedgerDatabase(target);
    if (tuple.database !== expected) return { ok: false, label, reason: `wrong_database:${expected}`, effective };
  }

  return { ok: true, label, reason: null, effective };
}
