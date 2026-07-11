/**
 * Stage 2 (docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.5) — hook-site
 * wiring tests. Stage 1 (tests/unit/dataverse-interlock.test.js) covers the
 * pure policy module in isolation; this suite proves the three hook sites
 * actually call `assertDataverseOperationAllowed` at the right place: before
 * any fetch, self-scoped so non-Dataverse URLs and `off` mode are no-ops, and
 * — critically for `dynamics/http.js` — that a denial propagates as its own
 * error rather than being reclassified as a transient no-response error by
 * the surrounding try/catch (`buildNoResponseError`).
 *
 * Style follows tests/unit/dal-enforcement.test.js: env saved/restored in
 * beforeEach/afterEach, `_resetInterlockStateForTests` clears the
 * once-per-process ack log gate between cases.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { fetchWithTimeout } from '../../lib/services/dynamics/http.js';
import { createClient } from '../../lib/dataverse/client.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';

const UNKNOWN_URL = 'https://someorg.crm.dynamics.com/api/data/v9.2/contacts';
const TOKEN_URL = 'https://login.microsoftonline.com/x/token';

const ENV_KEYS = [
  'VERCEL_ENV',
  'NODE_ENV',
  'DATAVERSE_TARGET_INTERLOCK',
  'DATAVERSE_ALLOW_PROD_READS',
  'DATAVERSE_PROD_WRITE_ACK',
  'DATAVERSE_REHEARSAL_GRANT',
  'DYNAMICS_URL',
  'DYNAMICS_SANDBOX_URL',
];

let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  // classifyDeployment() falls into the non-production bucket (test) with
  // NODE_ENV=test / no VERCEL_ENV, which jest.setup.js already sets — an
  // unknown target is denied regardless of deployment class, so that's fine
  // for these wiring tests (policy correctness itself is Stage 1's job).
  delete process.env.VERCEL_ENV;
  _resetInterlockStateForTests();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }));
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('dynamics/http.js fetchWithTimeout', () => {
  test('on mode + registry-unknown URL: throws before any fetch, message contains denial marker', async () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    await expect(
      fetchWithTimeout(UNKNOWN_URL, { method: 'PATCH' }, 5000),
    ).rejects.toThrow(/\[dataverse-interlock\] denied/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('on mode + AAD token POST: self-scoping skip — no throw, fetch is called', async () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    await expect(
      fetchWithTimeout(TOKEN_URL, { method: 'POST' }, 5000),
    ).resolves.toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('warn mode + registry-unknown URL: no throw, fetch called, console.warn fired once', async () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'warn';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      fetchWithTimeout(UNKNOWN_URL, { method: 'PATCH' }, 5000),
    ).resolves.toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/\[dataverse-interlock\] would deny/);
  });

  test('flag unset: strict no-op — no warn, fetch called', async () => {
    delete process.env.DATAVERSE_TARGET_INTERLOCK;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      fetchWithTimeout(UNKNOWN_URL, { method: 'PATCH' }, 5000),
    ).resolves.toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('denial error propagates WITHOUT being wrapped by buildNoResponseError', async () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    let caught;
    try {
      await fetchWithTimeout(UNKNOWN_URL, { method: 'PATCH' }, 5000);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.noResponse).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('dataverse/client.js call()', () => {
  test('on mode + unknown Dataverse host: rejects before fetch', async () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    const client = createClient({ resourceUrl: 'https://someorg.crm.dynamics.com', token: 't' });
    await expect(client.get('/contacts')).rejects.toThrow(/\[dataverse-interlock\] denied/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('dryRun resolves without evaluation even under on with a denied URL', async () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    const client = createClient({ resourceUrl: 'https://someorg.crm.dynamics.com', token: 't', dryRun: true });
    await expect(client.post('/contacts', { name: 'x' })).resolves.toMatchObject({ dryRun: true, ok: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
