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
 *
 * Opus round-1 L2 (documented, not enforced): `effective` reflects only the
 * URL string; it does not account for pg's own `PGPORT`/`PGDATABASE`/
 * `PGUSER`/`PGOPTIONS` environment fallback (node-postgres fills an omitted
 * port/database/user from those variables), so a URL that omits one of
 * those could still resolve to a different port/database/user than
 * `effective` reports on a host that is otherwise correctly allowlisted.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse: parsePgConnectionString } = require('pg-connection-string');

/**
 * Env variable name -> the CLI target it is expected to serve. Shared by
 * scripts/check-factory-ledger.js and scripts/apply-ledger-migrations.js
 * (Opus round-1 L1) so both classify a candidate URL against the same
 * target-bound database rule instead of the migration runner accepting any
 * database on the managed host.
 */
export const LEDGER_VAR_TARGETS = {
  TEST_REQUEST_LEDGER_URL: 'production',
  TEST_REQUEST_SANDBOX_LEDGER_URL: 'sandbox',
};

/** @returns {string|null} the target for a known ledger env variable name, or null for an unrecognized name. */
export function targetForLedgerVar(varName) {
  return Object.prototype.hasOwnProperty.call(LEDGER_VAR_TARGETS, varName) ? LEDGER_VAR_TARGETS[varName] : null;
}

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

/**
 * sslmode values that verify the server's certificate. Codex round-3 #3: a
 * managed-host URL with no SSL option, `sslmode=disable`/`prefer`/`allow`,
 * or `ssl=0`/`ssl=false` still connects (unencrypted or unverified), so the
 * allowlisted hostname alone does not authenticate the destination — an
 * unauthenticated/spoofed endpoint can answer the post-connect identity
 * query with whatever values it likes. Anything other than one of these
 * three sslmode values is refused for a managed host, including an absent
 * sslmode.
 */
const VERIFIED_TLS_SSLMODES = new Set(['require', 'verify-ca', 'verify-full']);

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

/**
 * Canonicalizes a loopback spelling to one value so `localhost`, `127.0.0.1`
 * and `::1`/`[::1]` are recognized as the SAME destination for shared-URL
 * comparison (Codex round-3 #1). `host` is assumed already normalized
 * (lowercased, brackets stripped) by `normalizeHost`.
 */
function canonicalLoopbackHost(host) {
  return LOCAL_LEDGER_HOSTS.includes(host) ? '127.0.0.1' : host;
}

/**
 * Database identity for the shared-URL refusal: host (loopback-canonical),
 * effective port, and database — NEVER the login role. Codex round-3 #1:
 * comparing `user` too let the exact same database, on the exact same
 * host/port, be reached under a different role and still classify as a
 * distinct (non-shared) destination — the ledger and the app database are
 * the same DATABASE regardless of which role connects to it.
 */
function tuplesMatch(a, b) {
  return canonicalLoopbackHost(a.host) === canonicalLoopbackHost(b.host)
    && (a.port || MANAGED_PORT) === (b.port || MANAGED_PORT)
    && a.database === b.database;
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
 * Opus round-2 item 1 (Codex #1): builds the EXACT config `new pg.Client`/
 * `new pg.Pool` should receive, so ambient PGHOST/PGPORT/PGUSER/PGOPTIONS/
 * PGDATABASE environment variables can never silently redirect the
 * connection node-postgres actually opens. pg only falls back to a PG*
 * variable for a config field that is falsy/absent
 * (node_modules/pg/lib/connection-parameters.js's `val()`: `if
 * (config[key]) return config[key]`, except `ssl`, which only falls back
 * when the key is `undefined`); every destination field here is therefore
 * always present with an explicit, non-falsy value drawn ONLY from the
 * parsed URL. `options` is deliberately left UNSET (absent from the
 * returned object), not neutralized — Neon's pooled endpoint REJECTS any
 * `options` startup parameter outright [VERIFIED live 2026-09-30: `options:
 * '-c search_path=public'` against the real sandbox ledger fails to connect
 * with "unsupported startup parameter in options: search_path"], so this
 * field cannot be used to block a PGOPTIONS-injected search_path on the
 * managed host. That ambient path is instead caught AFTER connecting by
 * assertLedgerConnectionIdentity's `current_schema() = 'public'` check,
 * which fails closed exactly when PGOPTIONS would have redirected the
 * session's schema.
 *
 * `ssl` (Codex round-3 #3): for a managed host this is ALWAYS
 * `{ rejectUnauthorized: true }` — full certificate validation — never
 * `false` and never derived from the URL's own `parsed.ssl` or from ambient
 * `PGSSLMODE`, regardless of what classifyLedgerUrl's sslmode check already
 * required of the URL text (that check only proves the URL ASKS for
 * verified TLS; this is what actually ENFORCES it at connect time). Local
 * hosts keep the prior behavior (the URL's own ssl setting, or `false`).
 *
 * Throws if the URL is missing a host, database, or user (never reached for
 * a URL classifyLedgerUrl has already accepted, since those are required
 * for host/database classification to succeed).
 */
export function buildLedgerClientConfig(url) {
  const parsed = parsePgConnectionString(url);
  if (!parsed.host) throw new Error('buildLedgerClientConfig: URL has no host.');
  if (!parsed.database) throw new Error('buildLedgerClientConfig: URL has no database.');
  if (!parsed.user) throw new Error('buildLedgerClientConfig: URL has no user.');
  const label = classifyLedgerHost(parsed.host);
  return {
    host: parsed.host,
    port: parsed.port ? Number(parsed.port) : Number(MANAGED_PORT),
    database: parsed.database,
    user: parsed.user,
    password: parsed.password || undefined,
    ssl: label === 'managed-ledger' ? { rejectUnauthorized: true } : (parsed.ssl === undefined ? false : parsed.ssl),
  };
}

/**
 * Opus round-2 item 1: verifies the LIVE connection actually landed where
 * `effective` (classifyLedgerUrl's result) says it should have — belt and
 * suspenders on top of buildLedgerClientConfig, in case some other code
 * path ever constructs a pg client without it. `db` is any `{ query(text,
 * params) -> { rows } }`.
 *
 * Port comparison: observed live 2026-09-30 against BOTH real Neon ledgers
 * (the managed pooled endpoint), `inet_server_port()` reports 5432,
 * matching the registry's effective port, so the port check IS enforced by
 * default (`checkPort: true`) — that is the managed host this registry
 * exists to protect. A LOCAL Docker/Colima ledger is a different case:
 * `inet_server_port()` reports the port Postgres listens on INSIDE the
 * container (5432), not the host-mapped port the client actually dialed
 * (5433 in this checkout's local setup) [VERIFIED 2026-09-30: connecting to
 * 127.0.0.1:5433 and running this query returned port 5432], so callers
 * pass `checkPort: false` for a `local`-labelled host.
 */
export async function assertLedgerConnectionIdentity(db, effective, { checkPort = true } = {}) {
  const { rows } = await db.query('SELECT current_database() AS db, current_schema() AS schema, inet_server_port() AS port');
  const row = rows[0] || {};
  const portMatches = !checkPort || String(row.port) === String(effective.port);
  if (row.db !== effective.database || row.schema !== 'public' || !portMatches) {
    throw new Error(`Ledger connection identity mismatch: expected database=${effective.database} schema=public${checkPort ? ` port=${effective.port}` : ''}, got database=${row.db} schema=${row.schema} port=${row.port}.`);
  }
  return row;
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

  // Opus round-3 L3: a configured shared URL that fails to parse used to be
  // silently SKIPPED — the shared-database comparison simply couldn't run
  // against it, so a candidate that actually IS the same database as an
  // unparseable POSTGRES_URL (say) passed with no comparison at all. Fail
  // closed instead: an unparseable shared URL refuses every candidate,
  // since "is this the same database as X" is unanswerable when X can't be
  // read.
  for (const shared of sharedUrls) {
    const sharedTuple = effectiveTuple(shared);
    if (!sharedTuple) {
      return { ok: false, label: null, reason: 'shared_unparseable', effective };
    }
    if (tuplesMatch(tuple, sharedTuple)) {
      return { ok: false, label: null, reason: 'shared_database', effective };
    }
  }

  if (tuple.host.startsWith('/')) return { ok: false, label: null, reason: 'socket_destination', effective };

  const label = classifyLedgerHost(tuple.host);
  if (!label) return { ok: false, label: null, reason: 'unregistered_host', effective };

  if (label === 'managed-ledger' && tuple.port && tuple.port !== MANAGED_PORT) {
    return { ok: false, label, reason: 'wrong_port', effective };
  }

  if (label === 'managed-ledger') {
    const sslmode = (urlObj.searchParams.get('sslmode') || '').toLowerCase();
    if (!VERIFIED_TLS_SSLMODES.has(sslmode)) {
      return { ok: false, label, reason: 'tls_required', effective };
    }
  }

  if (label === 'managed-ledger' && target) {
    const expected = expectedLedgerDatabase(target);
    if (tuple.database !== expected) return { ok: false, label, reason: `wrong_database:${expected}`, effective };
  }

  return { ok: true, label, reason: null, effective };
}
