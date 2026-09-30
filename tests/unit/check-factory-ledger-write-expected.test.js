/** @jest-environment node */
/**
 * Codex round-3 #4: --write-expected used to bypass the ledger registry
 * entirely (a raw `neon.tech` substring check plus equality with just
 * POSTGRES_URL, connecting with a bare `{ connectionString: url }`). A
 * hostless URL inherits ambient PGHOST, and a percent-encoded `?host=`
 * override reaches a different host than the URL's own authority names —
 * either could land `--write-expected`'s scratch-schema DDL on a real
 * database while the raw checks still said "not neon.tech" / "not
 * POSTGRES_URL". writeExpected now runs the same classifyLedgerUrl +
 * buildLedgerClientConfig + assertLedgerConnectionIdentity path as every
 * other ledger connection point, and additionally requires label `local`.
 *
 * check-factory-ledger.js has no require.main guard (main() runs at module
 * load), so these tests exercise it the same way
 * tests/unit/apply-ledger-migrations.test.js exercises
 * scripts/apply-ledger-migrations.js: set process.argv/env, require() the
 * script inside jest.isolateModules, and observe the process.exit(1) +
 * refusal message main().catch() produces. None of these cases reach
 * `new Client(...)` (classifyLedgerUrl / the label check refuse first), so
 * `pg` does not need to be mocked.
 */
const ORIGINAL_ENV = process.env;
const ORIGINAL_ARGV = process.argv;

const LEDGER_URL = 'postgresql://role:pw@ep-restless-haze-b8zxkdcl-pooler.c-14.us-east-1.aws.neon.tech/ledger?sslmode=require';

function runWriteExpected(env) {
  const calls = [];
  const exits = [];
  process.env = { ...ORIGINAL_ENV, ...env };
  process.argv = ['node', 'scripts/check-factory-ledger.js', '--write-expected'];
  let doneResolve;
  const done = new Promise((resolve) => { doneResolve = resolve; });
  jest.spyOn(process, 'exit').mockImplementation((code) => { exits.push(code); doneResolve(); });
  jest.spyOn(console, 'error').mockImplementation((...args) => { calls.push(args.join(' ')); });
  jest.isolateModules(() => { require('../../scripts/check-factory-ledger.js'); });
  return Promise.race([done, new Promise((resolve) => { setTimeout(resolve, 5000); })]).then(() => ({ calls, exits }));
}

describe('check-factory-ledger.js --write-expected refuses an unsafe TEST_REQUEST_LEDGER_TEST_URL', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    process.argv = ORIGINAL_ARGV;
    jest.restoreAllMocks();
  });

  test('a percent-encoded ?host= query override is refused', async () => {
    const { calls, exits } = await runWriteExpected({
      TEST_REQUEST_LEDGER_TEST_URL: 'postgres://postgres:pw@127.0.0.1:5433/ledger?host=evil.example',
    });
    expect(exits).toEqual([1]);
    expect(calls.join(' ')).toMatch(/query_override/);
  }, 10000);

  test('a hostless URL is refused', async () => {
    const { calls, exits } = await runWriteExpected({
      TEST_REQUEST_LEDGER_TEST_URL: 'postgres:///ledger',
    });
    expect(exits).toEqual([1]);
    expect(calls.join(' ')).toMatch(/unregistered_host/);
  }, 10000);

  test('a managed-ledger URL (even a registered, TLS-verified one) is refused as not local', async () => {
    // Use a database name distinct from both real ledger databases
    // (ledger/ledger_prod) so this never accidentally collides with a real
    // TEST_REQUEST_LEDGER_URL/TEST_REQUEST_SANDBOX_LEDGER_URL from
    // .env.local under the shared_database check (which is checked first).
    const url = LEDGER_URL.replace('/ledger?', '/ledger_scratch_probe?');
    // Non-URL sentinels (truthy, so loadEnvLocal's `!process.env[k]` fallback
    // never repopulates them from .env.local; unparseable, so
    // classifyLedgerUrl's sharedUrls comparison silently skips them instead
    // of colliding with this test's synthetic managed-host URL).
    const { calls, exits } = await runWriteExpected({
      TEST_REQUEST_LEDGER_URL: 'unset-for-this-test',
      TEST_REQUEST_SANDBOX_LEDGER_URL: 'unset-for-this-test',
      POSTGRES_URL: 'unset-for-this-test',
      POSTGRES_URL_NON_POOLING: 'unset-for-this-test',
      POSTGRES_PRISMA_URL: 'unset-for-this-test',
      DATABASE_URL: 'unset-for-this-test',
      TEST_REQUEST_LEDGER_TEST_URL: url,
    });
    expect(exits).toEqual([1]);
    expect(calls.join(' ')).toMatch(/must be a local scratch Postgres/);
    expect(calls.join(' ')).toMatch(/managed-ledger/);
  }, 10000);

  test('a URL equal to a real ledger variable is refused as shared_database', async () => {
    const { calls, exits } = await runWriteExpected({
      TEST_REQUEST_LEDGER_URL: LEDGER_URL,
      TEST_REQUEST_LEDGER_TEST_URL: LEDGER_URL,
    });
    expect(exits).toEqual([1]);
    expect(calls.join(' ')).toMatch(/shared_database/);
  }, 10000);

  test('an unset TEST_REQUEST_LEDGER_TEST_URL is refused with a clear message', async () => {
    const env = { ...ORIGINAL_ENV };
    delete env.TEST_REQUEST_LEDGER_TEST_URL;
    const { calls, exits } = await runWriteExpected(env);
    expect(exits).toEqual([1]);
    expect(calls.join(' ')).toMatch(/needs TEST_REQUEST_LEDGER_TEST_URL/);
  }, 10000);
});
