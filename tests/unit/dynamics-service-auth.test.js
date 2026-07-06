/**
 * Characterization coverage for DynamicsService auth (getAccessToken + token
 * cache), landed BEFORE the Stage 1 `auth.js` extraction (DynamicsService
 * decomposition, Checkpoint A) so the leaf move is behavior-frozen.
 *
 * Pins the three observable behaviors the plan calls out:
 *   1. token caching — a valid cached token is reused (no second token fetch);
 *   2. expiry refresh — once inside the 60s pre-expiry window, the next call
 *      re-fetches;
 *   3. missing-env — a config gap throws a FORCED non-transient error
 *      (`isTransient === false`), so the drain's retry classifier does not burn
 *      attempts on an unrecoverable bug.
 *
 * `getAccessToken` calls `fetchWithTimeout`, which calls the global `fetch`
 * (mocked here); the OAuth token endpoint is `login.microsoftonline.com`.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';

const REQUIRED_ENV = {
  DYNAMICS_URL: 'https://example.crm.dynamics.com',
  DYNAMICS_TENANT_ID: 't',
  DYNAMICS_CLIENT_ID: 'c',
  DYNAMICS_CLIENT_SECRET: 's',
};

function tokenResponse(accessToken, expiresIn = 3600) {
  return {
    ok: true,
    json: () => Promise.resolve({ access_token: accessToken, expires_in: expiresIn }),
  };
}

describe('DynamicsService.getAccessToken — token caching + expiry (characterization)', () => {
  const savedEnv = {};

  beforeAll(() => {
    for (const k of Object.keys(REQUIRED_ENV)) savedEnv[k] = process.env[k];
  });

  beforeEach(() => {
    for (const [k, v] of Object.entries(REQUIRED_ENV)) process.env[k] = v;
    fetch.mockReset();
    DynamicsService.clearCaches();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    for (const k of Object.keys(REQUIRED_ENV)) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  test('caches a valid token — second call reuses it, no second token fetch', async () => {
    fetch.mockResolvedValue(tokenResponse('tok-1'));

    const t1 = await DynamicsService.getAccessToken();
    const t2 = await DynamicsService.getAccessToken();

    expect(t1).toBe('tok-1');
    expect(t2).toBe('tok-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('login.microsoftonline.com');
  });

  test('refreshes once inside the 60s pre-expiry window', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    fetch
      .mockResolvedValueOnce(tokenResponse('tok-1', 3600)) // expiresAt = 1_000_000 + 3_600_000
      .mockResolvedValueOnce(tokenResponse('tok-2', 3600));

    const first = await DynamicsService.getAccessToken();
    expect(first).toBe('tok-1');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Advance to exactly expiresAt: cache guard is `expiresAt > now + 60_000`,
    // which is now false, so the next call must re-fetch.
    nowSpy.mockReturnValue(1_000_000 + 3_600_000);

    const second = await DynamicsService.getAccessToken();
    expect(second).toBe('tok-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('still-valid token (outside the 60s window) is NOT refreshed', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    fetch.mockResolvedValue(tokenResponse('tok-1', 3600));

    await DynamicsService.getAccessToken();
    // Advance well within validity (1 hour token, only +30 min elapsed).
    nowSpy.mockReturnValue(1_000_000 + 1_800_000);
    const again = await DynamicsService.getAccessToken();

    expect(again).toBe('tok-1');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('missing env var throws a FORCED non-transient error (no token fetch)', async () => {
    delete process.env.DYNAMICS_CLIENT_SECRET;
    DynamicsService.clearCaches();

    await expect(DynamicsService.getAccessToken()).rejects.toThrow(/Missing Dynamics 365/);

    DynamicsService.clearCaches();
    const err = await DynamicsService.getAccessToken().catch((e) => e);
    expect(err.isTransient).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
