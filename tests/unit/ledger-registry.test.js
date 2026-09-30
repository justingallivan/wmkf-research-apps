/** @jest-environment node */
import {
  MANAGED_LEDGER_HOSTS,
  LOCAL_LEDGER_HOSTS,
  classifyLedgerHost,
  classifyLedgerUrl,
  expectedLedgerDatabase,
} from '../../lib/db/ledger-registry';

const MANAGED = MANAGED_LEDGER_HOSTS[0];
const url = (host, db) => `postgresql://role:pw@${host}/${db}?sslmode=require`;

test('the registry is exact hostnames: one managed pooled host, two local hosts', () => {
  expect(MANAGED_LEDGER_HOSTS).toEqual(['ep-restless-haze-b8zxkdcl-pooler.c-14.us-east-1.aws.neon.tech']);
  expect(LOCAL_LEDGER_HOSTS).toEqual(['127.0.0.1', 'localhost']);
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
  expect(classifyLedgerUrl(url(MANAGED, 'ledger_prod'), { target: 'production' })).toEqual({ ok: true, label: 'managed-ledger', reason: null });
  expect(classifyLedgerUrl(url(MANAGED, 'ledger'), { target: 'sandbox' })).toEqual({ ok: true, label: 'managed-ledger', reason: null });
  expect(classifyLedgerUrl(url(MANAGED, 'ledger'), { target: 'production' })).toMatchObject({ ok: false, reason: 'wrong_database:ledger_prod' });
  expect(classifyLedgerUrl(url(MANAGED, 'ledger_prod'), { target: 'sandbox' })).toMatchObject({ ok: false, reason: 'wrong_database:ledger' });
  expect(classifyLedgerUrl(url(MANAGED, 'neondb'), { target: 'production' })).toMatchObject({ ok: false });
  // No target (e.g. --run-inspect): host rules only.
  expect(classifyLedgerUrl(url(MANAGED, 'neondb'), {})).toMatchObject({ ok: true });
});

test('local hosts keep their database names; shared URLs and unknown hosts are refused before anything else', () => {
  expect(classifyLedgerUrl(url('127.0.0.1:5433', 'anything'), { target: 'production' })).toEqual({ ok: true, label: 'local', reason: null });
  const shared = url('ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech', 'verceldb');
  expect(classifyLedgerUrl(shared, { target: 'production', sharedUrls: [shared] })).toMatchObject({ ok: false, reason: 'shared_database' });
  expect(classifyLedgerUrl(url('db.example.com', 'ledger_prod'), { target: 'production' })).toMatchObject({ ok: false, reason: 'unregistered_host' });
  expect(classifyLedgerUrl('', {})).toMatchObject({ ok: false, reason: 'unset' });
  expect(classifyLedgerUrl('not a url', {})).toMatchObject({ ok: false, reason: 'unparseable' });
  // A managed URL that equals a shared URL is refused as shared, even though its host is registered.
  const managed = url(MANAGED, 'ledger_prod');
  expect(classifyLedgerUrl(managed, { target: 'production', sharedUrls: [managed] })).toMatchObject({ ok: false, reason: 'shared_database' });
});
