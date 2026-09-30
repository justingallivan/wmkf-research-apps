/** @jest-environment node */
import {
  MANAGED_LEDGER_HOSTS,
  LOCAL_LEDGER_HOSTS,
  classifyLedgerHost,
  classifyLedgerUrl,
  expectedLedgerDatabase,
  selectLedgerVariable,
} from '../../lib/db/ledger-registry';

const MANAGED = MANAGED_LEDGER_HOSTS[0];
const url = (host, db, query = '') => `postgresql://role:pw@${host}/${db}${query ? `?${query}` : ''}`;

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
  // No target (e.g. --run-inspect): host rules only.
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

  test('uppercase host classifies the same as lowercase', () => {
    expect(classifyLedgerUrl(url(MANAGED.toUpperCase(), 'ledger_prod'), { target: 'production' })).toMatchObject({ ok: true, label: 'managed-ledger' });
  });

  test('userinfo with encoded characters does not affect classification', () => {
    const withUserinfo = `postgresql://us%40er:pa%25ss@${MANAGED}/ledger_prod`;
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
