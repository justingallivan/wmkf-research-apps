/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');

const CLIENT_PATH = path.join(__dirname, '../../lib/dataverse/client.js');

const ORIGINAL_ENV = { ...process.env };

function setDynamicsEnv() {
  process.env.DYNAMICS_TENANT_ID = 'tenant-marker-77';
  process.env.DYNAMICS_CLIENT_ID = 'client-marker-77';
  process.env.DYNAMICS_CLIENT_SECRET = 'super-secret-marker-DO-NOT-LEAK';
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => { throw new Error('not json'); },
  };
}

function dependencyEvents(logSpy) {
  return logSpy.mock.calls
    .map((call) => call[0])
    .filter((line) => typeof line === 'string')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((parsed) => parsed && parsed.event === 'workbench.dependency');
}

describe('lib/dataverse/client.js observability telemetry', () => {
  let client;

  beforeEach(() => {
    jest.resetModules();
    setDynamicsEnv();
    client = require('../../lib/dataverse/client.js');
  });

  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
    global.fetch = jest.fn();
  });

  test('getAccessToken success emits one azuread/token/POST/success/2xx event without leaking the secret or the token', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn(async () => jsonResponse(200, {
      access_token: 'ACCESS-TOKEN-MARKER-XYZ',
      expires_in: 3600,
    }));

    const token = await client.getAccessToken('https://org.crm.dynamics.com');
    expect(token).toBe('ACCESS-TOKEN-MARKER-XYZ');

    const events = dependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'workbench.dependency',
      dependency: 'azuread',
      resourceClass: 'token',
      operation: 'POST',
      outcome: 'success',
      statusClass: '2xx',
    });

    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('super-secret-marker-DO-NOT-LEAK');
    expect(serialized).not.toContain('ACCESS-TOKEN-MARKER-XYZ');
  });

  test('getAccessToken non-2xx emits http_error/4xx and still throws the existing plain Error', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn(async () => textResponse(401, 'invalid_client'));

    await expect(client.getAccessToken('https://org.crm.dynamics.com'))
      .rejects.toThrow(/^Token request failed \(401\):/);

    const events = dependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      dependency: 'azuread',
      resourceClass: 'token',
      operation: 'POST',
      outcome: 'http_error',
      statusClass: '4xx',
    });
  });

  test('createClient().get on accounts emits dataverse/accounts/GET/success and preserves response shape without leaking the $filter', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn(async () => jsonResponse(200, { value: [{ accountid: 'a1' }] }));

    const dvClient = client.createClient({
      resourceUrl: 'https://org.crm.dynamics.com',
      token: 'tkn',
    });
    const result = await dvClient.get("/accounts?$filter=emailaddress1 eq 'marker-email@example.com'");

    expect(result).toEqual({
      ok: true,
      status: 200,
      text: JSON.stringify({ value: [{ accountid: 'a1' }] }),
      body: { value: [{ accountid: 'a1' }] },
    });

    const events = dependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      dependency: 'dataverse',
      resourceClass: 'accounts',
      operation: 'GET',
      outcome: 'success',
      statusClass: '2xx',
    });
    expect(JSON.stringify(events[0])).not.toContain('marker-email@example.com');
  });

  test('unknown entity set classifies resourceClass unknown', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn(async () => jsonResponse(200, { value: [] }));

    const dvClient = client.createClient({
      resourceUrl: 'https://org.crm.dynamics.com',
      token: 'tkn',
    });
    await dvClient.get('/wmkf_appsystemsettings');

    const events = dependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(events[0].resourceClass).toBe('unknown');
  });

  test('dryRun POST emits ZERO events, returns the dryRun stub, and never calls fetch', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn();

    const dvClient = client.createClient({
      resourceUrl: 'https://org.crm.dynamics.com',
      token: 'tkn',
      dryRun: true,
    });
    const result = await dvClient.post('/accounts', { name: 'x' });

    expect(result).toEqual({ ok: true, status: 0, text: '', body: null, dryRun: true });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(dependencyEvents(logSpy)).toHaveLength(0);
  });

  test('interlock denial propagates and emits ZERO events', async () => {
    jest.resetModules();
    setDynamicsEnv();
    jest.doMock('../../lib/dataverse/core/interlock.js', () => ({
      assertDataverseOperationAllowed: () => {
        throw new Error('[dataverse-interlock] denied: test denial');
      },
    }));
    const isolatedClient = require('../../lib/dataverse/client.js');

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn(async () => jsonResponse(200, {}));

    const dvClient = isolatedClient.createClient({
      resourceUrl: 'https://org.crm.dynamics.com',
      token: 'tkn',
    });

    await expect(dvClient.get('/accounts')).rejects.toThrow('[dataverse-interlock] denied: test denial');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(dependencyEvents(logSpy)).toHaveLength(0);

    jest.dontMock('../../lib/dataverse/core/interlock.js');
  });

  test('raw fetch rejection rethrows the SAME instance and emits network_error with no statusClass', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = new TypeError('fetch failed');
    global.fetch = jest.fn(async () => { throw err; });

    const dvClient = client.createClient({
      resourceUrl: 'https://org.crm.dynamics.com',
      token: 'tkn',
    });

    let caught;
    try {
      await dvClient.get('/accounts');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);

    const events = dependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('network_error');
    expect(events[0]).not.toHaveProperty('statusClass');
  });

  test('console.log throwing does not surface to the caller and the result is unchanged', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => { throw new Error('logger exploded'); });
    global.fetch = jest.fn(async () => jsonResponse(200, { value: [{ accountid: 'a1' }] }));

    const dvClient = client.createClient({
      resourceUrl: 'https://org.crm.dynamics.com',
      token: 'tkn',
    });

    const result = await dvClient.get('/accounts');
    expect(result).toEqual({
      ok: true,
      status: 200,
      text: JSON.stringify({ value: [{ accountid: 'a1' }] }),
      body: { value: [{ accountid: 'a1' }] },
    });
  });

  describe('browser-import safety', () => {
    test('client.js source contains no static top-level require of the observability module or node:async_hooks', () => {
      const source = fs.readFileSync(CLIENT_PATH, 'utf8');
      expect(source).not.toMatch(/require\(\s*['"]\.\/\.\.\/observability\/request-correlation\.js['"]\s*\)/);
      expect(source).not.toMatch(/require\(\s*['"]node:async_hooks['"]\s*\)/);
    });

    test('requiring client.js fresh does not eagerly load the observability module', () => {
      jest.isolateModules(() => {
        jest.doMock('../../lib/observability/request-correlation.js', () => {
          throw new Error('observability module must not load eagerly at require-time');
        });
        expect(() => require('../../lib/dataverse/client.js')).not.toThrow();
      });
    });

    test('when observability fails to load, emission silently no-ops without throwing', async () => {
      let isolatedClient;
      jest.isolateModules(() => {
        jest.doMock('../../lib/observability/request-correlation.js', () => {
          throw new Error('observability unavailable in this bundle');
        });
        isolatedClient = require('../../lib/dataverse/client.js');
      });

      global.fetch = jest.fn(async () => jsonResponse(200, { value: [] }));
      const dvClient = isolatedClient.createClient({
        resourceUrl: 'https://org.crm.dynamics.com',
        token: 'tkn',
      });
      await expect(dvClient.get('/accounts')).resolves.toEqual({
        ok: true,
        status: 200,
        text: JSON.stringify({ value: [] }),
        body: { value: [] },
      });
    });
  });
});
