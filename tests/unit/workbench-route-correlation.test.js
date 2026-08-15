/**
 * @jest-environment node
 */

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function dependencyEvents(logSpy) {
  return logSpy.mock.calls
    .map((call) => call[0])
    .filter((line) => typeof line === 'string')
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((parsed) => parsed && parsed.event === 'workbench.dependency');
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const ORIGINAL_ENV = { ...process.env };
function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe('workbench route correlation wiring', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    restoreEnv();
    global.fetch = jest.fn();
  });

  test('correlation established before requireAppAccess: an uncached app-access Dataverse lookup inside the mocked auth guard emits the route correlationId; a second request mints a different one', async () => {
    jest.resetModules();
    process.env.DYNAMICS_TENANT_ID = 't1';
    process.env.DYNAMICS_CLIENT_ID = 'c1';
    process.env.DYNAMICS_CLIENT_SECRET = 's1';
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
      }
      return jsonResponse(200, { value: [] });
    });

    jest.doMock('../../lib/utils/auth', () => ({
      requireAppAccess: jest.fn(async () => {
        // Simulates the uncached app-access cache-miss path: a real Dataverse
        // call through client.js BEFORE any route DAL scope exists.
        const dvClient = require('../../lib/dataverse/client.js');
        const client = dvClient.createClient({ resourceUrl: 'https://org.crm.dynamics.com', token: 'tok' });
        await client.get('/wmkf_appuserappaccesses?$filter=x');
        return { session: { user: { dynamicsSystemuserId: 'user-1' } } };
      }),
    }));
    jest.doMock('../../lib/services/workbench/decline-referrals-service', () => ({
      getDeclineReferrals: jest.fn(async () => {
        // Simulates a second service-layer Dataverse call.
        const dvClient = require('../../lib/dataverse/client.js');
        const client = dvClient.createClient({ resourceUrl: 'https://org.crm.dynamics.com', token: 'tok' });
        await client.get('/wmkf_declinereferral');
        return { success: true, referrals: [] };
      }),
      dismissDeclineReferral: jest.fn(async () => ({ success: true })),
    }));

    const handler = require('../../pages/api/workbench/decline-referrals').default;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const REQUEST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const res1 = response();
    await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res1);
    expect(res1.statusCode).toBe(200);

    const events1 = dependencyEvents(logSpy);
    // token fetch + auth-guard dataverse call + service-layer dataverse call
    const dataverseEvents1 = events1.filter((e) => e.dependency === 'dataverse');
    expect(dataverseEvents1.length).toBeGreaterThanOrEqual(2);
    const correlationIds1 = new Set(dataverseEvents1.map((e) => e.correlationId));
    expect(correlationIds1.size).toBe(1);
    for (const e of dataverseEvents1) {
      expect(e.routeName).toBe('/api/workbench/decline-referrals');
      expect(typeof e.correlationId).toBe('string');
      expect(e.correlationId.length).toBeGreaterThan(0);
    }

    logSpy.mockClear();
    const res2 = response();
    await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res2);
    const events2 = dependencyEvents(logSpy).filter((e) => e.dependency === 'dataverse');
    expect(events2.length).toBeGreaterThanOrEqual(1);
    const correlationId2 = events2[0].correlationId;
    expect(correlationId2).not.toBe([...correlationIds1][0]);
  });

  test('correlation survives nested withDalContext (separate ALS instances do not leak into or clobber each other)', async () => {
    jest.resetModules();
    const { withRequestCorrelation, getRequestCorrelation, mintCorrelationId } = require('../../lib/observability/request-correlation.js');
    const { withDalContext } = require('../../lib/dataverse/core/context.js');

    let insideDalCorrelation;
    let insideDalEventCorrelation;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { emitDependencyEvent } = require('../../lib/observability/request-correlation.js');

    const cid = mintCorrelationId();
    await withRequestCorrelation({ correlationId: cid, routeName: '/api/workbench/decline-referrals' }, async () => {
      return withDalContext('test-nested-scope', async () => {
        insideDalCorrelation = getRequestCorrelation();
        emitDependencyEvent({ url: 'https://org.crm.dynamics.com/api/data/v9.2/accounts', method: 'GET', ms: 1, response: { ok: true, status: 200 } });
      });
    });

    const events = dependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    insideDalEventCorrelation = events[0].correlationId;

    expect(insideDalCorrelation).toEqual({ correlationId: cid, routeName: '/api/workbench/decline-referrals' });
    expect(insideDalEventCorrelation).toBe(cid);
  });

  test('concurrency: two overlapping handler invocations never leak each other\'s correlationId', async () => {
    jest.resetModules();
    process.env.DYNAMICS_TENANT_ID = 't1';
    process.env.DYNAMICS_CLIENT_ID = 'c1';
    process.env.DYNAMICS_CLIENT_SECRET = 's1';

    jest.doMock('../../lib/utils/auth', () => ({
      requireAppAccess: jest.fn(async () => ({ session: { user: { dynamicsSystemuserId: 'user-1' } } })),
    }));

    const seen = [];
    jest.doMock('../../lib/services/workbench/decline-referrals-service', () => ({
      getDeclineReferrals: jest.fn(async ({ requestId }) => {
        const { getRequestCorrelation } = require('../../lib/observability/request-correlation.js');
        // Stagger so the two invocations' async work genuinely overlaps.
        await new Promise((resolve) => setTimeout(resolve, requestId.startsWith('a') ? 20 : 5));
        seen.push({ requestId, correlation: getRequestCorrelation() });
        await new Promise((resolve) => setTimeout(resolve, requestId.startsWith('a') ? 5 : 20));
        seen.push({ requestId, correlation: getRequestCorrelation() });
        return { success: true, referrals: [] };
      }),
      dismissDeclineReferral: jest.fn(async () => ({ success: true })),
    }));

    const handler = require('../../pages/api/workbench/decline-referrals').default;

    const REQUEST_ID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const REQUEST_ID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    await Promise.all([
      handler({ method: 'GET', query: { requestId: REQUEST_ID_A } }, response()),
      handler({ method: 'GET', query: { requestId: REQUEST_ID_B } }, response()),
    ]);

    const forA = seen.filter((s) => s.requestId === REQUEST_ID_A);
    const forB = seen.filter((s) => s.requestId === REQUEST_ID_B);
    expect(forA).toHaveLength(2);
    expect(forB).toHaveLength(2);
    const idsA = new Set(forA.map((s) => s.correlation?.correlationId));
    const idsB = new Set(forB.map((s) => s.correlation?.correlationId));
    expect(idsA.size).toBe(1);
    expect(idsB.size).toBe(1);
    expect([...idsA][0]).not.toBe([...idsB][0]);
  });

  test('byte-identical characterization: GET /api/reviewer-finder/my-candidates?mode=proposals runs the real route/service/adapter/dynamics-http stack; console.log throwing does not change status/body', async () => {
    // Chosen route: my-candidates GET mode=proposals. It resolves the PD via
    // a single systemusers query with no PD match, so the response is fully
    // determined by requireAppAccess (mocked) + one token fetch + one
    // systemusers query (mocked via global.fetch) — no Postgres dependency
    // on this path (resolvePD/program-director-resolver only touches
    // Dataverse; my-candidates-service's proposals branch never reaches
    // Postgres).
    async function runOnce({ breakLogging }) {
      jest.resetModules();
      process.env.DYNAMICS_URL = 'https://org.crm.dynamics.com';
      process.env.DYNAMICS_TENANT_ID = 't1';
      process.env.DYNAMICS_CLIENT_ID = 'c1';
      process.env.DYNAMICS_CLIENT_SECRET = 's1';

      jest.doMock('../../lib/utils/auth', () => ({
        requireAppAccess: jest.fn(async () => ({
          session: { user: { azureEmail: 'pd@wmkf.org', dynamicsSystemuserId: 'user-1' } },
        })),
      }));

      global.fetch = jest.fn(async (url, options) => {
        const u = String(url);
        if (u.includes('login.microsoftonline.com')) {
          return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
        }
        if (u.includes('systemusers')) {
          return jsonResponse(200, { value: [] }); // no PD match
        }
        return jsonResponse(200, { value: [] });
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {
        if (breakLogging) throw new Error('logger exploded');
      });

      const handler = require('../../pages/api/reviewer-finder/my-candidates').default;
      const res = response();
      await handler({ method: 'GET', query: { mode: 'proposals' } }, res);

      return { status: res.statusCode, body: res.body, logSpy };
    }

    const normal = await runOnce({ breakLogging: false });
    const broken = await runOnce({ breakLogging: true });

    // Pin the byte-identical comparison to a real success shape so it can't
    // silently characterize an error response (e.g. both runs 500-ing the
    // same way would otherwise still pass the JSON.stringify equality check).
    expect(normal.status).toBe(200);
    expect(normal.body).toMatchObject({ success: true, proposals: [] });

    expect(normal.status).toBe(broken.status);
    expect(JSON.stringify(normal.body)).toBe(JSON.stringify(broken.body));

    // NOTE ON THE ORIGINAL DEAD LINE: completing it as "console.log throws
    // => nothing recorded" would be an incorrect assertion — Jest's mock
    // records a spy's call args synchronously as each call happens, BEFORE
    // running mockImplementation, so a throwing console.log still leaves its
    // JSON-stringified event in logSpy.mock.calls (verified empirically: the
    // broken run below captures the same events as the normal run). The
    // meaningful invariant is instead: every emission attempt made in the
    // normal run was also attempted (and threw, and was swallowed) in the
    // broken run — same call count — while status/body stayed identical.
    expect(broken.logSpy.mock.calls.length).toBe(normal.logSpy.mock.calls.length);
    expect(broken.logSpy.mock.calls.length).toBeGreaterThan(0);
    expect(broken.logSpy.mock.results.some((r) => r.type === 'throw')).toBe(true);

    const normalEvents = normal.logSpy.mock.calls
      .map((c) => c[0])
      .filter((l) => typeof l === 'string')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((p) => p && p.event === 'workbench.dependency');
    expect(normalEvents.length).toBeGreaterThanOrEqual(1);
    expect(normalEvents.every((e) => e.routeName === '/api/reviewer-finder/my-candidates')).toBe(true);
  });

  test('a client.js call OUTSIDE any withRequestCorrelation scope emits an event with correlationId/routeName keys absent', async () => {
    jest.resetModules();
    process.env.DYNAMICS_TENANT_ID = 't1';
    process.env.DYNAMICS_CLIENT_ID = 'c1';
    process.env.DYNAMICS_CLIENT_SECRET = 's1';
    global.fetch = jest.fn(async () => jsonResponse(200, { value: [] }));

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const dvClient = require('../../lib/dataverse/client.js');
    const client = dvClient.createClient({ resourceUrl: 'https://org.crm.dynamics.com', token: 'tok' });
    await client.get('/accounts');

    const events = dependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(events[0], 'correlationId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(events[0], 'routeName')).toBe(false);
  });
});
