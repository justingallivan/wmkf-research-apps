/**
 * @jest-environment node
 *
 * Workbench Observability Stage 1 — graph-service.js fetchWithTimeout
 * telemetry seam, exercised through the public GraphService surface (token
 * acquisition, a data call, cache hits, and the missing-env config guard).
 */

// NOTE: deliberately NOT `import { jest } from '@jest/globals'` here — under
// this repo's SWC jest transform, importing the `jest` binding from
// '@jest/globals' anywhere in the file disables jest.mock() factory
// hoisting (the factory below silently never runs). The ambient `jest`
// global works correctly for both jest.mock and every jest.fn/spyOn call
// in this file.
jest.mock('../../lib/observability/request-correlation.js', () => {
  const actual = jest.requireActual('../../lib/observability/request-correlation.js');
  return { ...actual, emitDependencyEvent: jest.fn(actual.emitDependencyEvent) };
});

import { GraphService } from '../../lib/services/graph-service.js';
import { emitDependencyEvent as mockedEmitDependencyEvent } from '../../lib/observability/request-correlation.js';

const setupFetch = global.fetch;

const CLIENT_SECRET_MARKER = 'super-secret-marker-value';
const ACCESS_TOKEN_MARKER = 'super-secret-access-token-value';

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => JSON.stringify(body)),
    headers: { get: jest.fn(() => null) },
  };
}

function readDependencyEvents(logSpy) {
  const events = [];
  for (const call of logSpy.mock.calls) {
    const raw = call[0];
    if (typeof raw !== 'string') continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (parsed && parsed.event === 'workbench.dependency') events.push(parsed);
  }
  return events;
}

let originalCredentials;
let logSpy;

beforeEach(() => {
  originalCredentials = {
    DYNAMICS_TENANT_ID: process.env.DYNAMICS_TENANT_ID,
    DYNAMICS_CLIENT_ID: process.env.DYNAMICS_CLIENT_ID,
    DYNAMICS_CLIENT_SECRET: process.env.DYNAMICS_CLIENT_SECRET,
  };
  Object.assign(process.env, {
    DYNAMICS_TENANT_ID: 'tenant',
    DYNAMICS_CLIENT_ID: 'client',
    DYNAMICS_CLIENT_SECRET: CLIENT_SECRET_MARKER,
  });
  GraphService.clearCaches();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  GraphService.clearCaches();
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.fetch = setupFetch;
  for (const [key, value] of Object.entries(originalCredentials)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('token acquisition emits an azuread/token success event and never leaks the secret or token', async () => {
  global.fetch = jest.fn().mockResolvedValue(
    response(200, { access_token: ACCESS_TOKEN_MARKER, expires_in: 3600 }),
  );

  const token = await GraphService.getAccessToken();
  expect(token).toBe(ACCESS_TOKEN_MARKER);

  const events = readDependencyEvents(logSpy);
  expect(events).toHaveLength(1);
  expect(events[0].dependency).toBe('azuread');
  expect(events[0].resourceClass).toBe('token');
  expect(events[0].operation).toBe('POST');
  expect(events[0].outcome).toBe('success');

  for (const call of logSpy.mock.calls) {
    const raw = call[0];
    if (typeof raw !== 'string') continue;
    expect(raw).not.toContain(CLIENT_SECRET_MARKER);
    expect(raw).not.toContain(ACCESS_TOKEN_MARKER);
  }
});

test('a warm token cache hit performs no fetch and emits no event', async () => {
  global.fetch = jest.fn().mockResolvedValue(
    response(200, { access_token: ACCESS_TOKEN_MARKER, expires_in: 3600 }),
  );

  await GraphService.getAccessToken();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  logSpy.mockClear();

  const token = await GraphService.getAccessToken();
  expect(token).toBe(ACCESS_TOKEN_MARKER);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(readDependencyEvents(logSpy)).toHaveLength(0);
});

test('a Graph data call emits a graph/drive-item event and returns the parsed result unchanged', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const metadataBody = {
    id: 'item/id',
    name: 'Current Assessment.docx',
    size: 125,
    webUrl: 'https://example.sharepoint.com/current',
    eTag: '"etag"',
    cTag: '"ctag"',
    lastModifiedDateTime: '2026-07-31T01:33:55Z',
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    publication: { versionId: '2.0' },
    parentReference: { driveId: 'drive/id' },
  };
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, metadataBody));

  const result = await GraphService.getFileMetadataById('drive/id', 'item/id');

  expect(result).toMatchObject({
    id: 'item/id',
    name: 'Current Assessment.docx',
    size: 125,
    webUrl: 'https://example.sharepoint.com/current',
  });

  const events = readDependencyEvents(logSpy);
  expect(events).toHaveLength(1);
  expect(events[0].dependency).toBe('graph');
  expect(events[0].resourceClass).toBe('drive-item');
  expect(events[0].operation).toBe('GET');
  expect(events[0].outcome).toBe('success');
});

test('a Graph timeout surfaces a structured graph/abort error and a timeout event', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const abortErr = new Error('The operation was aborted');
  abortErr.name = 'AbortError';
  global.fetch = jest.fn().mockRejectedValueOnce(abortErr);

  let caught;
  try {
    await GraphService.getFileMetadataById('drive/id', 'item/id');
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeDefined();
  expect(caught.serviceName).toBe('graph');
  expect(caught.noResponse).toBe(true);
  expect(caught.causeKind).toBe('abort');

  const events = readDependencyEvents(logSpy);
  expect(events).toHaveLength(1);
  expect(events[0].dependency).toBe('graph');
  expect(events[0].outcome).toBe('timeout');
});

test('missing-env config guard throws before any fetch and emits zero events', async () => {
  delete process.env.DYNAMICS_TENANT_ID;
  delete process.env.DYNAMICS_CLIENT_ID;
  delete process.env.DYNAMICS_CLIENT_SECRET;
  global.fetch = jest.fn();

  let caught;
  try {
    await GraphService.getAccessToken();
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeDefined();
  expect(caught.serviceName).toBe('graph');
  expect(caught.status).toBe(500);
  expect(caught.isTransient).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(readDependencyEvents(logSpy)).toHaveLength(0);
});

test('an emission failure on the Graph path does not change the returned result', async () => {
  logSpy.mockImplementation(() => {
    throw new Error('console.log exploded');
  });
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const metadataBody = { id: 'item/id', name: 'File.docx', file: { mimeType: 'application/octet-stream' } };
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, metadataBody));

  const result = await GraphService.getFileMetadataById('drive/id', 'item/id');
  expect(result).toMatchObject({ id: 'item/id', name: 'File.docx' });
});

test('emitter throwing (despite its own guard) does not break the Graph success path — safeEmitDependencyEvent seam guard', async () => {
  mockedEmitDependencyEvent.mockImplementationOnce(() => {
    throw new Error('emitter exploded despite its own try/catch');
  });
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const metadataBody = { id: 'item/id', name: 'File.docx', file: { mimeType: 'application/octet-stream' } };
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, metadataBody));

  const result = await GraphService.getFileMetadataById('drive/id', 'item/id');
  expect(result).toMatchObject({ id: 'item/id', name: 'File.docx' });
});

test('emitter throwing (despite its own guard) does not break the Graph error path — structured error still thrown intact', async () => {
  mockedEmitDependencyEvent.mockImplementationOnce(() => {
    throw new Error('emitter exploded despite its own try/catch');
  });
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const abortErr = new Error('The operation was aborted');
  abortErr.name = 'AbortError';
  global.fetch = jest.fn().mockRejectedValueOnce(abortErr);

  let caught;
  try {
    await GraphService.getFileMetadataById('drive/id', 'item/id');
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeDefined();
  expect(caught.serviceName).toBe('graph');
  expect(caught.noResponse).toBe(true);
  expect(caught.causeKind).toBe('abort');
});
