/** @jest-environment node */
import {
  MANAGED_LEDGER_HOSTS,
  LOCAL_LEDGER_HOSTS,
  LEDGER_VAR_TARGETS,
  classifyLedgerHost,
  classifyLedgerUrl,
  expectedLedgerDatabase,
  selectLedgerVariable,
  targetForLedgerVar,
  buildLedgerClientConfig,
  assertLedgerConnectionIdentity,
} from '../../lib/db/ledger-registry';

const MANAGED = MANAGED_LEDGER_HOSTS[0];
// Codex round-3 #3: a managed host now requires a verified sslmode, so the
// shared URL builder defaults to sslmode=require (tests exercising a
// missing/weak sslmode build their own URL instead of using this helper).
const url = (host, db, query = '') => {
  const q = query.includes('sslmode=') ? query : (query ? `sslmode=require&${query}` : 'sslmode=require');
  return `postgresql://role:pw@${host}/${db}?${q}`;
};

test('the registry is exact hostnames: one managed pooled host, three local hosts', () => {
  expect(MANAGED_LEDGER_HOSTS).toEqual(['ep-restless-haze-b8zxkdcl-pooler.c-14.us-east-1.aws.neon.tech']);
  expect(LOCAL_LEDGER_HOSTS).toEqual(['127.0.0.1', 'localhost', '::1']);
  expect(classifyLedgerHost(MANAGED)).toBe('managed-ledger');
  expect(classifyLedgerHost(MANAGED.toUpperCase())).toBe('managed-ledger');
  expect(classifyLedgerHost('localhost')).toBe('local');
  // The direct (non-pooler) form is deliberately unregistered until verified.
  expect(classifyLedgerHost(MANAGED.replace('-pooler', ''))).toBeNull();
  // The app database's host and any other Neon host stay refused.
  expect(classifyLedgerHost('ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech')).toBeNull();
  expect(classifyLedgerHost('')).toBeNull();
});

test('the managed host must carry the database the target expects', () => {
  expect(expectedLedgerDatabase('production')).toBe('ledger_prod');
  expect(expectedLedgerDatabase('sandbox')).toBe('ledger');
  expect(classifyLedgerUrl(url(MANAGED, 'ledger_prod'), { target: 'production' })).toMatchObject({ ok: true, label: 'managed-ledger', reason: null });
  expect(classifyLedgerUrl(url(MANAGED, 'ledger'), { target: 'sandbox' })).toMatchObject({ ok: true, label: 'managed-ledger', reason: null });
  expect(classifyLedgerUrl(url(MANAGED, 'ledger'), { target: 'production' })).toMatchObject({ ok: false, reason: 'wrong_database:ledger_prod' });
  expect(classifyLedgerUrl(url(MANAGED, 'ledger_prod'), { target: 'sandbox' })).toMatchObject({ ok: false, reason: 'wrong_database:ledger' });
  expect(classifyLedgerUrl(url(MANAGED, 'neondb'), { target: 'production' })).toMatchObject({ ok: false });
  // classifyLedgerUrl's own default (target omitted): host rules only. No
  // production caller relies on this any more — scripts/rehearse-test-request-sandbox.mjs's
  // requireLedgerUrl, scripts/check-factory-ledger.js, and
  // scripts/apply-ledger-migrations.js (Opus round-1 L1) all now resolve and
  // pass an explicit target before calling classifyLedgerUrl.
  expect(classifyLedgerUrl(url(MANAGED, 'neondb'), {})).toMatchObject({ ok: true });
});

test('local hosts keep their database names; shared URLs and unknown hosts are refused before anything else', () => {
  expect(classifyLedgerUrl(url('127.0.0.1:5433', 'anything'), { target: 'production' })).toMatchObject({ ok: true, label: 'local', reason: null });
  const shared = url('ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech', 'verceldb');
  expect(classifyLedgerUrl(shared, { target: 'production', sharedUrls: [shared] })).toMatchObject({ ok: false, reason: 'shared_database' });
  expect(classifyLedgerUrl(url('db.example.com', 'ledger_prod'), { target: 'production' })).toMatchObject({ ok: false, reason: 'unregistered_host' });
  expect(classifyLedgerUrl('', {})).toMatchObject({ ok: false, reason: 'unset' });
  expect(classifyLedgerUrl('not a url', {})).toMatchObject({ ok: false, reason: 'unparseable' });
  // A managed URL that equals a shared URL is refused as shared, even though its host is registered.
  const managed = url(MANAGED, 'ledger_prod');
  expect(classifyLedgerUrl(managed, { target: 'production', sharedUrls: [managed] })).toMatchObject({ ok: false, reason: 'shared_database' });
});

describe('Codex round-1 Fix 1: effective destination, not URL text', () => {
  test('query overrides that redirect the effective connection are refused', () => {
    for (const key of ['host', 'hostaddr', 'port', 'dbname', 'user']) {
      const bad = url(MANAGED, 'ledger_prod', `${key}=something`);
      expect(classifyLedgerUrl(bad, { target: 'production' })).toMatchObject({ ok: false, reason: 'query_override' });
    }
  });

  test('?host=%2Ftmp is a query override, refused before socket classification even applies', () => {
    expect(classifyLedgerUrl(url(MANAGED, 'ledger_prod', 'host=%2Ftmp'), { target: 'production' }))
      .toMatchObject({ ok: false, reason: 'query_override' });
  });

  test('a genuine socket authority (no query override) is refused as socket_destination', () => {
    const sockUrl = 'postgresql://role:pw@%2Ftmp/ledger_prod';
    expect(classifyLedgerUrl(sockUrl, { target: 'production' })).toMatchObject({ ok: false, reason: 'socket_destination' });
  });

  test('allowed query keys (sslmode, application_name, channel_binding, connect_timeout) pass through', () => {
    const ok = url(MANAGED, 'ledger_prod', 'sslmode=require&application_name=x&channel_binding=require&connect_timeout=10');
    expect(classifyLedgerUrl(ok, { target: 'production' })).toMatchObject({ ok: true });
  });

  test('reordered query params on a shared URL still match canonically', () => {
    const configured = url('ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech', 'verceldb', 'sslmode=require&application_name=app');
    const reordered = url('ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech', 'verceldb', 'application_name=app&sslmode=require');
    expect(classifyLedgerUrl(reordered, { target: 'production', sharedUrls: [configured] })).toMatchObject({ ok: false, reason: 'shared_database' });
  });

  // Codex round-3 #1: shared-database identity is host+port+database — NEVER
  // the login role — and loopback spellings (localhost/127.0.0.1/::1) are
  // canonicalized to one value before comparing.
  test('the same endpoint under a DIFFERENT role is still refused as shared_database', () => {
    const configured = 'postgresql://app_role:pw@127.0.0.1:5433/shared_db';
    const candidate = 'postgresql://other_role:pw@127.0.0.1:5433/shared_db';
    expect(classifyLedgerUrl(candidate, { target: 'production', sharedUrls: [configured] })).toMatchObject({ ok: false, reason: 'shared_database' });
  });

  test('localhost and 127.0.0.1 at the same port/database are the same destination', () => {
    const configured = 'postgresql://role:pw@localhost:5433/shared_db';
    const candidate = 'postgresql://role:pw@127.0.0.1:5433/shared_db';
    expect(classifyLedgerUrl(candidate, { target: 'production', sharedUrls: [configured] })).toMatchObject({ ok: false, reason: 'shared_database' });
    // ::1 is the same loopback destination too.
    const ipv6Candidate = 'postgresql://role:pw@[::1]:5433/shared_db';
    expect(classifyLedgerUrl(ipv6Candidate, { target: 'production', sharedUrls: [configured] })).toMatchObject({ ok: false, reason: 'shared_database' });
  });

  test('a DIFFERENT database on the same endpoint is not shared', () => {
    const configured = 'postgresql://role:pw@127.0.0.1:5433/shared_db';
    const candidate = 'postgresql://role:pw@127.0.0.1:5433/ledger';
    expect(classifyLedgerUrl(candidate, { target: 'production', sharedUrls: [configured] })).not.toMatchObject({ reason: 'shared_database' });
  });

  test('uppercase host classifies the same as lowercase', () => {
    expect(classifyLedgerUrl(url(MANAGED.toUpperCase(), 'ledger_prod'), { target: 'production' })).toMatchObject({ ok: true, label: 'managed-ledger' });
  });

  test('userinfo with encoded characters does not affect classification', () => {
    const withUserinfo = `postgresql://us%40er:pa%25ss@${MANAGED}/ledger_prod?sslmode=require`;
    expect(classifyLedgerUrl(withUserinfo, { target: 'production' })).toMatchObject({ ok: true, label: 'managed-ledger' });
  });

  test('IPv6 literal [::1] classifies as local', () => {
    expect(classifyLedgerUrl('postgresql://role:pw@[::1]:5433/anything', { target: 'production' })).toMatchObject({ ok: true, label: 'local' });
  });

  test('a managed host with a non-default port (no override) is refused as wrong_port', () => {
    const wrongPort = `postgresql://role:pw@${MANAGED}:6543/ledger_prod`;
    expect(classifyLedgerUrl(wrongPort, { target: 'production' })).toMatchObject({ ok: false, label: 'managed-ledger', reason: 'wrong_port' });
  });

  test('a local host allows any port', () => {
    expect(classifyLedgerUrl('postgresql://role:pw@127.0.0.1:6543/ledger', { target: 'production' })).toMatchObject({ ok: true, label: 'local' });
  });

  test('effective never contains user or password', () => {
    const verdict = classifyLedgerUrl(url(MANAGED, 'ledger_prod'), { target: 'production' });
    expect(verdict.effective).toEqual({ host: MANAGED, port: '5432', database: 'ledger_prod' });
    expect(Object.keys(verdict.effective)).not.toContain('user');
    expect(Object.keys(verdict.effective)).not.toContain('password');
  });

  // Codex round-3 #3: a managed host must require verified TLS; the
  // allowlisted hostname alone does not authenticate the destination.
  describe('Codex round-3 #3: verified TLS required on managed hosts', () => {
    const bare = (query) => `postgresql://role:pw@${MANAGED}/ledger_prod${query ? `?${query}` : ''}`;
    test('absent sslmode is refused', () => {
      expect(classifyLedgerUrl(bare(), { target: 'production' })).toMatchObject({ ok: false, label: 'managed-ledger', reason: 'tls_required' });
    });
    test('sslmode=disable is refused', () => {
      expect(classifyLedgerUrl(bare('sslmode=disable'), { target: 'production' })).toMatchObject({ ok: false, reason: 'tls_required' });
    });
    test('sslmode=prefer is refused', () => {
      expect(classifyLedgerUrl(bare('sslmode=prefer'), { target: 'production' })).toMatchObject({ ok: false, reason: 'tls_required' });
    });
    test('sslmode=allow is refused', () => {
      expect(classifyLedgerUrl(bare('sslmode=allow'), { target: 'production' })).toMatchObject({ ok: false, reason: 'tls_required' });
    });
    test('ssl=0 (no sslmode) is refused', () => {
      expect(classifyLedgerUrl(bare('ssl=0'), { target: 'production' })).toMatchObject({ ok: false, reason: 'tls_required' });
    });
    test('ssl=false (no sslmode) is refused', () => {
      expect(classifyLedgerUrl(bare('ssl=false'), { target: 'production' })).toMatchObject({ ok: false, reason: 'tls_required' });
    });
    test('sslmode=require, verify-ca, and verify-full are all accepted', () => {
      for (const mode of ['require', 'verify-ca', 'verify-full']) {
        expect(classifyLedgerUrl(bare(`sslmode=${mode}`), { target: 'production' })).toMatchObject({ ok: true, label: 'managed-ledger' });
      }
    });
    test('sslmode is case-insensitive', () => {
      expect(classifyLedgerUrl(bare('sslmode=REQUIRE'), { target: 'production' })).toMatchObject({ ok: true });
    });
    test('a local host needs no sslmode at all', () => {
      expect(classifyLedgerUrl('postgresql://role:pw@127.0.0.1:5433/ledger', { target: 'production' })).toMatchObject({ ok: true, label: 'local' });
    });
  });

  describe('Codex round-3 #3: buildLedgerClientConfig forces verified TLS on managed hosts', () => {
    test('managed host: ssl is always { rejectUnauthorized: true }, never false, regardless of the URL\'s own ssl setting', () => {
      const cfg = buildLedgerClientConfig(`postgresql://role:pw@${MANAGED}/ledger_prod?sslmode=require`);
      expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
    });
    test('managed host with sslmode=disable in the URL still gets rejectUnauthorized:true from buildLedgerClientConfig (classifyLedgerUrl is what refuses the URL itself)', () => {
      const cfg = buildLedgerClientConfig(`postgresql://role:pw@${MANAGED}/ledger_prod?sslmode=disable`);
      expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
    });
    test('ambient PGSSLMODE does not affect the managed-host ssl config', () => {
      const ORIGINAL = process.env.PGSSLMODE;
      process.env.PGSSLMODE = 'disable';
      try {
        const cfg = buildLedgerClientConfig(`postgresql://role:pw@${MANAGED}/ledger_prod?sslmode=require`);
        expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
      } finally {
        if (ORIGINAL === undefined) delete process.env.PGSSLMODE; else process.env.PGSSLMODE = ORIGINAL;
      }
    });
    test('local host keeps the prior behavior (ssl false when the URL has none)', () => {
      const cfg = buildLedgerClientConfig('postgresql://role:pw@127.0.0.1:5433/ledger');
      expect(cfg.ssl).toBe(false);
    });
  });
});

describe('Opus round-1 L1: targetForLedgerVar / LEDGER_VAR_TARGETS (migration runner target derivation)', () => {
  test('known variable names map to their CLI target', () => {
    expect(LEDGER_VAR_TARGETS).toEqual({ TEST_REQUEST_LEDGER_URL: 'production', TEST_REQUEST_SANDBOX_LEDGER_URL: 'sandbox' });
    expect(targetForLedgerVar('TEST_REQUEST_LEDGER_URL')).toBe('production');
    expect(targetForLedgerVar('TEST_REQUEST_SANDBOX_LEDGER_URL')).toBe('sandbox');
  });

  test('an unrecognized variable name maps to null (the runner refuses rather than guessing)', () => {
    expect(targetForLedgerVar('SOME_OTHER_VARIABLE')).toBeNull();
    expect(targetForLedgerVar('')).toBeNull();
  });

  test('the migration runner\'s effective classification refuses the wrong database for its variable\'s target', () => {
    // TEST_REQUEST_LEDGER_URL -> production -> must name ledger_prod.
    const prodTarget = targetForLedgerVar('TEST_REQUEST_LEDGER_URL');
    expect(classifyLedgerUrl(url(MANAGED, 'ledger'), { target: prodTarget })).toMatchObject({ ok: false, reason: 'wrong_database:ledger_prod' });
    expect(classifyLedgerUrl(url(MANAGED, 'ledger_prod'), { target: prodTarget })).toMatchObject({ ok: true });
    // TEST_REQUEST_SANDBOX_LEDGER_URL -> sandbox -> must name ledger.
    const sandboxTarget = targetForLedgerVar('TEST_REQUEST_SANDBOX_LEDGER_URL');
    expect(classifyLedgerUrl(url(MANAGED, 'ledger_prod'), { target: sandboxTarget })).toMatchObject({ ok: false, reason: 'wrong_database:ledger' });
    expect(classifyLedgerUrl(url(MANAGED, 'ledger'), { target: sandboxTarget })).toMatchObject({ ok: true });
  });
});

describe('Codex round-1 Fix 7: selectLedgerVariable', () => {
  test('production always reads TEST_REQUEST_LEDGER_URL', () => {
    expect(selectLedgerVariable('production', { TEST_REQUEST_SANDBOX_LEDGER_URL: 'x' })).toBe('TEST_REQUEST_LEDGER_URL');
  });
  test('sandbox reads TEST_REQUEST_SANDBOX_LEDGER_URL when set', () => {
    expect(selectLedgerVariable('sandbox', { TEST_REQUEST_SANDBOX_LEDGER_URL: 'x' })).toBe('TEST_REQUEST_SANDBOX_LEDGER_URL');
  });
  test('sandbox falls back to TEST_REQUEST_LEDGER_URL for single-variable local setups', () => {
    expect(selectLedgerVariable('sandbox', {})).toBe('TEST_REQUEST_LEDGER_URL');
  });
});

describe('Opus round-2 item 1: buildLedgerClientConfig ignores ambient PG* variables', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      PGPORT: '6543',
      PGDATABASE: 'shadow',
      PGUSER: 'hostile',
      PGOPTIONS: '-c search_path=shadow',
    };
  });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  test('the config is built entirely from the URL, never from PGPORT/PGDATABASE/PGUSER', () => {
    const cfg = buildLedgerClientConfig(`postgresql://role:pw@${MANAGED}/ledger_prod`);
    expect(cfg).toEqual({
      host: MANAGED,
      port: 5432,
      database: 'ledger_prod',
      user: 'role',
      password: 'pw',
      ssl: expect.anything(),
    });
    expect(cfg.port).not.toBe(6543);
    expect(cfg.database).not.toBe('shadow');
    expect(cfg.user).not.toBe('hostile');
  });

  test('port defaults to 5432 when the URL omits it, never from PGPORT', () => {
    const cfg = buildLedgerClientConfig(`postgresql://role:pw@${MANAGED}/ledger_prod`);
    expect(cfg.port).toBe(5432);
  });

  test('options is absent from the config (Neon\'s pooler rejects any options startup parameter; see the post-connect identity check instead)', () => {
    const cfg = buildLedgerClientConfig(`postgresql://role:pw@${MANAGED}/ledger_prod`);
    expect('options' in cfg).toBe(false);
  });

  test('throws when the URL is missing a host, database, or user', () => {
    expect(() => buildLedgerClientConfig('postgresql:///onlydb')).toThrow(/host/);
    expect(() => buildLedgerClientConfig(`postgresql://role@${MANAGED}/`)).toThrow(/database/);
  });
});

describe('Opus round-2 item 1: assertLedgerConnectionIdentity', () => {
  test('passes when the live db/schema/port match the expected effective tuple', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ db: 'ledger_prod', schema: 'public', port: 5432 }] })) };
    await expect(assertLedgerConnectionIdentity(db, { database: 'ledger_prod', port: '5432' })).resolves.toMatchObject({ db: 'ledger_prod' });
  });
  test('throws when the live database differs (e.g. a PGDATABASE override)', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ db: 'shadow', schema: 'public', port: 5432 }] })) };
    await expect(assertLedgerConnectionIdentity(db, { database: 'ledger_prod', port: '5432' })).rejects.toThrow(/identity mismatch/);
  });
  test('throws when the live schema is not public (e.g. a PGOPTIONS search_path override)', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ db: 'ledger_prod', schema: 'shadow', port: 5432 }] })) };
    await expect(assertLedgerConnectionIdentity(db, { database: 'ledger_prod', port: '5432' })).rejects.toThrow(/identity mismatch/);
  });
  test('throws when the live port differs', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ db: 'ledger_prod', schema: 'public', port: 6543 }] })) };
    await expect(assertLedgerConnectionIdentity(db, { database: 'ledger_prod', port: '5432' })).rejects.toThrow(/identity mismatch/);
  });
});
