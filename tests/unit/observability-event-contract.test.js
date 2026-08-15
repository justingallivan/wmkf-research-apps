/**
 * Event envelope / classifiers / emission contract for
 * lib/observability/request-correlation.js.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import {
  withRequestCorrelation,
  emitDependencyEvent,
  classifyDependency,
  classifyResourceClass,
  classifyOutcome,
} from '../../lib/observability/request-correlation.js';

afterEach(() => jest.restoreAllMocks());

function lastLoggedEvent(logSpy, callIndex = logSpy.mock.calls.length - 1) {
  const arg = logSpy.mock.calls[callIndex][0];
  expect(typeof arg).toBe('string');
  return JSON.parse(arg);
}

describe('classifyDependency', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('login.microsoftonline.com -> azuread', () => {
    expect(classifyDependency('https://login.microsoftonline.com/tenant/oauth2/v2.0/token')).toBe('azuread');
  });

  test('graph.microsoft.com -> graph', () => {
    expect(classifyDependency('https://graph.microsoft.com/v1.0/sites/host:/path')).toBe('graph');
  });

  test('*.crm.dynamics.com -> dataverse', () => {
    expect(classifyDependency('https://something.crm.dynamics.com/api/data/v9.2/accounts')).toBe('dataverse');
  });

  test('DYNAMICS_URL-configured custom host -> dataverse', () => {
    delete process.env.DYNAMICS_SANDBOX_URL;
    process.env.DYNAMICS_URL = 'https://custom-dv-host.example.net/';
    expect(classifyDependency('https://custom-dv-host.example.net/api/data/v9.2/accounts')).toBe('dataverse');
  });

  test('DYNAMICS_SANDBOX_URL-configured custom host -> dataverse', () => {
    delete process.env.DYNAMICS_URL;
    process.env.DYNAMICS_SANDBOX_URL = 'https://sandbox-dv-host.example.net/';
    expect(classifyDependency('https://sandbox-dv-host.example.net/api/data/v9.2/accounts')).toBe('dataverse');
  });

  test('unrecognized host -> unknown (fail closed)', () => {
    expect(classifyDependency('https://evil.example.com/api/data/v9.2/accounts')).toBe('unknown');
  });

  test('unparseable URL -> unknown (fail closed)', () => {
    expect(classifyDependency('not-a-url')).toBe('unknown');
  });
});

describe('classifyResourceClass', () => {
  test('azuread is always token, regardless of URL', () => {
    expect(classifyResourceClass('azuread', 'https://login.microsoftonline.com/t/oauth2/v2.0/token')).toBe('token');
    expect(classifyResourceClass('azuread', 'https://login.microsoftonline.com/anything/else')).toBe('token');
  });

  test.each([
    ['wmkf_potentialreviewerses', 'https://x.crm.dynamics.com/api/data/v9.2/wmkf_potentialreviewerses'],
    ['wmkf_appreviewersuggestions', 'https://x.crm.dynamics.com/api/data/v9.2/wmkf_appreviewersuggestions?$select=id'],
    ['akoya_requests', 'https://x.crm.dynamics.com/api/data/v9.2/akoya_requests(9f8b6e1a-1111-2222-3333-444455556666)'],
    ['accounts', 'https://x.crm.dynamics.com/api/data/v9.2/accounts(aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)'],
    ['systemusers', 'https://x.crm.dynamics.com/api/data/v9.2/systemusers'],
    ['wmkf_appuserappaccesses', 'https://x.crm.dynamics.com/api/data/v9.2/wmkf_appuserappaccesses'],
  ])('dataverse entity set %s classifies correctly', (expected, url) => {
    expect(classifyResourceClass('dataverse', url)).toBe(expected);
  });

  test('dataverse: $batch -> unknown', () => {
    expect(classifyResourceClass('dataverse', 'https://x.crm.dynamics.com/api/data/v9.2/$batch')).toBe('unknown');
  });

  test('dataverse: unlisted entity set (wmkf_appsystemsettings) -> unknown', () => {
    expect(classifyResourceClass('dataverse', 'https://x.crm.dynamics.com/api/data/v9.2/wmkf_appsystemsettings')).toBe('unknown');
  });

  test('dataverse: no /api/data/v9.2/ segment -> unknown', () => {
    expect(classifyResourceClass('dataverse', 'https://x.crm.dynamics.com/EntityDefinitions(LogicalName=\'account\')')).toBe('unknown');
  });

  test('graph: site addressing -> site', () => {
    // GraphService.getSiteId: `${GRAPH_BASE}/sites/${host}:${pathname}`
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/akoyaGO')).toBe('site');
  });

  test('graph: drives listing under a site -> drive', () => {
    // GraphService.getDriveId: `${GRAPH_BASE}/sites/${siteId}/drives`
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/sites/SITE_ID/drives')).toBe('drive');
  });

  test('graph: root/children listing (no item id) -> drive', () => {
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/drives/DRIVE_ID/root/children')).toBe('drive');
  });

  test('graph: root: path-addressed content -> drive-item', () => {
    // GraphService listFiles: `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}:/children?...`
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/drives/DRIVE_ID/root:/Folder/Sub:/children?$select=name')).toBe('drive-item');
  });

  test('graph: items/ metadata addressing -> drive-item', () => {
    // GraphService getFileMetadataById: `${GRAPH_BASE}/drives/${driveId}/items/${itemId}?...`
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/drives/DRIVE_ID/items/ITEM_ID?$select=id,name')).toBe('drive-item');
  });

  test('graph: items/.../versions/{id} -> drive-item', () => {
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/drives/DRIVE_ID/items/ITEM_ID/versions/VERSION_ID')).toBe('drive-item');
  });

  test('graph: items/.../content -> drive-item', () => {
    // GraphService downloadFile: `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/content`
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/drives/DRIVE_ID/items/ITEM_ID/content')).toBe('drive-item');
  });

  test('graph: /search/query -> search, wins priority over drive-ish path', () => {
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/search/query')).toBe('search');
  });

  test('graph: unrecognized shape -> unknown', () => {
    expect(classifyResourceClass('graph', 'https://graph.microsoft.com/v1.0/me')).toBe('unknown');
  });

  test('unknown dependency -> unknown regardless of URL', () => {
    expect(classifyResourceClass('unknown', 'https://graph.microsoft.com/v1.0/drives/x/items/y/content')).toBe('unknown');
  });

  test('azuread token endpoint never classifies as graph/token (dependency+resourceClass must agree)', () => {
    const dep = classifyDependency('https://login.microsoftonline.com/tenant/oauth2/v2.0/token');
    expect(dep).toBe('azuread');
    expect(classifyResourceClass(dep, 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token')).toBe('token');
  });
});

describe('classifyOutcome', () => {
  test('response.ok -> success/2xx', () => {
    expect(classifyOutcome({ response: { ok: true, status: 200 } })).toEqual({ outcome: 'success', statusClass: '2xx' });
  });

  test('3xx -> http_error/3xx', () => {
    expect(classifyOutcome({ response: { ok: false, status: 302 } })).toEqual({ outcome: 'http_error', statusClass: '3xx' });
  });

  test('4xx -> http_error/4xx', () => {
    expect(classifyOutcome({ response: { ok: false, status: 404 } })).toEqual({ outcome: 'http_error', statusClass: '4xx' });
  });

  test('5xx -> http_error/5xx', () => {
    expect(classifyOutcome({ response: { ok: false, status: 503 } })).toEqual({ outcome: 'http_error', statusClass: '5xx' });
  });

  test('non-standard status (999) -> http_error with NO statusClass key', () => {
    const result = classifyOutcome({ response: { ok: false, status: 999 } });
    expect(result.outcome).toBe('http_error');
    expect(Object.prototype.hasOwnProperty.call(result, 'statusClass')).toBe(false);
  });

  test('causeKind abort -> timeout, no statusClass', () => {
    const result = classifyOutcome({ error: { causeKind: 'abort' } });
    expect(result).toEqual({ outcome: 'timeout' });
    expect(Object.prototype.hasOwnProperty.call(result, 'statusClass')).toBe(false);
  });

  test('causeKind timeout -> timeout, no statusClass', () => {
    expect(classifyOutcome({ error: { causeKind: 'timeout' } })).toEqual({ outcome: 'timeout' });
  });

  test.each(['socket', 'dns', 'unknown'])('causeKind %s -> network_error, no statusClass', (causeKind) => {
    const result = classifyOutcome({ error: { causeKind } });
    expect(result).toEqual({ outcome: 'network_error' });
  });

  test('error with no causeKind at all (raw fetch error) -> network_error', () => {
    const result = classifyOutcome({ error: new TypeError('fetch failed') });
    expect(result).toEqual({ outcome: 'network_error' });
    expect(Object.prototype.hasOwnProperty.call(result, 'statusClass')).toBe(false);
  });

  test('raw error name AbortError (no causeKind) -> timeout, mirrors service-error.js', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(classifyOutcome({ error: err })).toEqual({ outcome: 'timeout' });
  });

  test.each(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT'])(
    'raw error code %s (no causeKind) -> timeout, mirrors service-error.js',
    (code) => {
      const err = new Error('timed out');
      err.code = code;
      expect(classifyOutcome({ error: err })).toEqual({ outcome: 'timeout' });
    },
  );

  test('structured causeKind socket wins over a coincidentally-matching name -> network_error', () => {
    const err = new Error('reset');
    err.causeKind = 'socket';
    err.name = 'AbortError';
    expect(classifyOutcome({ error: err })).toEqual({ outcome: 'network_error' });
  });

  // Real Node fetch shape: rejections are TypeError('fetch failed') with the
  // undici error (carrying the code) on .cause — the code is NOT top-level.
  test('real fetch shape: TypeError with cause code UND_ERR_HEADERS_TIMEOUT -> timeout', () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' });
    expect(classifyOutcome({ error: err })).toEqual({ outcome: 'timeout' });
  });

  test('real fetch shape: TypeError with cause code ECONNREFUSED -> network_error', () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    expect(classifyOutcome({ error: err })).toEqual({ outcome: 'network_error' });
  });
});

describe('emitDependencyEvent — envelope shape', () => {
  test('logs a JSON string with event/v/key order and eventId shape', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: 12, response: { ok: true, status: 200 } });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const rawArg = logSpy.mock.calls[0][0];
    expect(typeof rawArg).toBe('string');
    const parsed = JSON.parse(rawArg);

    expect(parsed.event).toBe('workbench.dependency');
    expect(parsed.v).toBe(1);
    expect(typeof parsed.eventId).toBe('string');
    expect(Object.keys(parsed)).toEqual(['event', 'v', 'eventId', 'dependency', 'resourceClass', 'operation', 'ms', 'outcome', 'statusClass']);
  });

  test('correlationId/routeName appear right after eventId when present, in order', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    withRequestCorrelation({ correlationId: 'corr-x', routeName: 'route-x' }, () => {
      emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: 5, response: { ok: true, status: 200 } });
    });
    const parsed = lastLoggedEvent(logSpy);
    expect(Object.keys(parsed)).toEqual([
      'event', 'v', 'eventId', 'correlationId', 'routeName',
      'dependency', 'resourceClass', 'operation', 'ms', 'outcome', 'statusClass',
    ]);
    expect(parsed.correlationId).toBe('corr-x');
    expect(parsed.routeName).toBe('route-x');
  });

  test('eventId differs across two emissions with identical inputs', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const args = { url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: 1, response: { ok: true, status: 200 } };
    emitDependencyEvent(args);
    emitDependencyEvent(args);
    const first = lastLoggedEvent(logSpy, 0);
    const second = lastLoggedEvent(logSpy, 1);
    expect(first.eventId).not.toBe(second.eventId);
  });

  test('outside any correlation scope, correlationId/routeName keys are absent (not present-with-undefined)', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: 3, response: { ok: true, status: 200 } });
    const parsed = lastLoggedEvent(logSpy);
    expect(Object.prototype.hasOwnProperty.call(parsed, 'correlationId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, 'routeName')).toBe(false);
    expect(parsed.event).toBe('workbench.dependency');
  });

  test('non-standard status (999) event omits statusClass key entirely', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: 1, response: { ok: false, status: 999 } });
    const parsed = lastLoggedEvent(logSpy);
    expect(parsed.outcome).toBe('http_error');
    expect(Object.prototype.hasOwnProperty.call(parsed, 'statusClass')).toBe(false);
  });
});

describe('emitDependencyEvent — operation classification', () => {
  test('undefined method -> GET', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', ms: 1, response: { ok: true, status: 200 } });
    expect(lastLoggedEvent(logSpy).operation).toBe('GET');
  });

  test('lowercase "patch" -> PATCH', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'patch', ms: 1, response: { ok: true, status: 200 } });
    expect(lastLoggedEvent(logSpy).operation).toBe('PATCH');
  });

  test.each(['TRACE', 'FOO/../bar'])('unrecognized method %s -> unknown', (method) => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method, ms: 1, response: { ok: true, status: 200 } });
    expect(lastLoggedEvent(logSpy).operation).toBe('unknown');
  });

  test('object method (non-hostile toString) -> unknown, does not throw', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: { odd: true }, ms: 1, response: { ok: true, status: 200 } })).not.toThrow();
    expect(lastLoggedEvent(logSpy).operation).toBe('unknown');
  });

  test('hostile toString method does not throw (may swallow the whole event)', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const hostile = { toString() { throw new Error('boom'); } };
    expect(() => emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: hostile, ms: 1, response: { ok: true, status: 200 } })).not.toThrow();
    // Acceptable either way: no event logged, or an event logged without throwing.
    expect(logSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('emitDependencyEvent — dependency/resourceClass compatibility', () => {
  const LEGAL = {
    azuread: new Set(['token']),
    dataverse: new Set(['wmkf_potentialreviewerses', 'wmkf_appreviewersuggestions', 'akoya_requests', 'accounts', 'systemusers', 'wmkf_appuserappaccesses', 'unknown']),
    graph: new Set(['site', 'drive', 'drive-item', 'search', 'unknown']),
    unknown: new Set(['unknown']),
  };

  const FIXTURES = [
    'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
    'https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/akoyaGO',
    'https://graph.microsoft.com/v1.0/sites/SITE_ID/drives',
    'https://graph.microsoft.com/v1.0/drives/DRIVE_ID/root:/Folder:/children',
    'https://graph.microsoft.com/v1.0/drives/DRIVE_ID/items/ITEM_ID/content',
    'https://graph.microsoft.com/v1.0/search/query',
    'https://x.crm.dynamics.com/api/data/v9.2/accounts(aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)',
    'https://x.crm.dynamics.com/api/data/v9.2/$batch',
    'https://evil.example.com/super/secret/path',
  ];

  test.each(FIXTURES)('for %s, resourceClass is legal for its classified dependency', (url) => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url, method: 'GET', ms: 1, response: { ok: true, status: 200 } });
    const parsed = lastLoggedEvent(logSpy);
    expect(LEGAL[parsed.dependency].has(parsed.resourceClass)).toBe(true);
    logSpy.mockRestore();
  });
});

describe('emitDependencyEvent — redaction / hostility', () => {
  const SEEDED_MARKERS = {
    emailFilter: {
      url: 'https://x.crm.dynamics.com/api/data/v9.2/accounts?$filter=emailaddress1 eq \'secret.email@example.com\'',
      markers: ['secret.email@example.com'],
    },
    guidKeyed: {
      url: 'https://x.crm.dynamics.com/api/data/v9.2/akoya_requests(9f8b6e1a-cafe-babe-dead-beef12345678)',
      markers: ['9f8b6e1a-cafe-babe-dead-beef12345678'],
    },
    graphFilename: {
      url: 'https://graph.microsoft.com/v1.0/drives/DRIVE_ID/root:/Folder/Confidential%20Budget.xlsx',
      markers: ['Confidential%20Budget.xlsx', 'Confidential Budget'],
    },
    signedCdn: {
      url: 'https://cdn.example.net/download?sig=SECRETTOKEN123',
      markers: ['SECRETTOKEN123'],
    },
    unknownHostPath: {
      url: 'https://evil.example.com/super/secret/path',
      markers: ['super', 'secret/path'],
    },
  };

  test.each(Object.entries(SEEDED_MARKERS))('%s: serialized event contains none of the seeded markers', (_name, { url, markers }) => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url, method: 'GET', ms: 1, response: { ok: true, status: 200 } });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const rawArg = logSpy.mock.calls[0][0];
    for (const marker of markers) {
      expect(rawArg).not.toContain(marker);
    }
    logSpy.mockRestore();
  });
});

describe('emitDependencyEvent — emission failure swallowing', () => {
  test('console.log throwing does not propagate', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('console is broken');
    });
    expect(() => emitDependencyEvent({
      url: 'https://graph.microsoft.com/v1.0/me',
      method: 'GET',
      ms: 1,
      response: { ok: true, status: 200 },
    })).not.toThrow();
    logSpy.mockRestore();
  });

  test('JSON.stringify-breaking input (BigInt ms) does not throw', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => emitDependencyEvent({
      url: 'https://graph.microsoft.com/v1.0/me',
      method: 'GET',
      ms: BigInt(5),
      response: { ok: true, status: 200 },
    })).not.toThrow();
    logSpy.mockRestore();
  });
});

describe('emitDependencyEvent — ms clamping', () => {
  test('negative ms (clock step) clamps to 0', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: -5, response: { ok: true, status: 200 } });
    expect(lastLoggedEvent(logSpy).ms).toBe(0);
  });

  test('NaN ms normalizes to 0', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: NaN, response: { ok: true, status: 200 } });
    expect(lastLoggedEvent(logSpy).ms).toBe(0);
  });

  test('Infinity ms normalizes to 0', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: Infinity, response: { ok: true, status: 200 } });
    expect(lastLoggedEvent(logSpy).ms).toBe(0);
  });

  test('a normal positive finite ms passes through unchanged', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitDependencyEvent({ url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', ms: 42, response: { ok: true, status: 200 } });
    expect(lastLoggedEvent(logSpy).ms).toBe(42);
  });
});

describe('lazy async_hooks — emission still works when unavailable', () => {
  test('emitDependencyEvent still emits a valid event without correlation keys when ALS is unavailable', () => {
    jest.isolateModules(() => {
      jest.doMock('node:async_hooks', () => {
        throw new Error('simulated unavailable');
      });
      const mod = require('../../lib/observability/request-correlation.js');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mod.withRequestCorrelation({ correlationId: 'ignored' }, () => {
        mod.emitDependencyEvent({
          url: 'https://graph.microsoft.com/v1.0/me',
          method: 'GET',
          ms: 1,
          response: { ok: true, status: 200 },
        });
      });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed.event).toBe('workbench.dependency');
      expect(Object.prototype.hasOwnProperty.call(parsed, 'correlationId')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'routeName')).toBe(false);
      logSpy.mockRestore();
    });
  });
});
