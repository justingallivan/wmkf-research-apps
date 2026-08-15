/**
 * @jest-environment node
 *
 * Workbench Observability Stage 1 — dynamics/http.js fetchWithTimeout
 * telemetry seam. Verifies emitDependencyEvent is called exactly once per
 * fetch attempt, with the right classification, and that the interlock
 * denial path (before the try block) is neither timed nor emitted.
 *
 * The interlock-denial case reuses the real assertDataverseOperationAllowed
 * (rather than mocking the interlock module) with DATAVERSE_TARGET_INTERLOCK
 * set to 'on' against a registry-unknown URL — the same denial trigger used
 * by tests/unit/dataverse-interlock-wiring.test.js — so this file doesn't
 * need to hand-roll an ESM module mock for a policy module it doesn't own.
 */

import { jest } from '@jest/globals';
import { fetchWithTimeout } from '../../lib/services/dynamics/http.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';

const DATAVERSE_URL = 'https://example.crm.dynamics.com/api/data/v9.2/accounts?$filter=x';
const UNKNOWN_URL = 'https://someorg.crm.dynamics.com/api/data/v9.2/contacts';

const ENV_KEYS = ['VERCEL_ENV', 'DATAVERSE_TARGET_INTERLOCK'];

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

let savedEnv;
let logSpy;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.VERCEL_ENV;
  delete process.env.DATAVERSE_TARGET_INTERLOCK;
  _resetInterlockStateForTests();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = jest.fn();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('dynamics/http.js fetchWithTimeout — telemetry', () => {
  test('success: returns the exact Response object and emits one success 2xx event', async () => {
    const mockResponse = { ok: true, status: 200, headers: { get: () => null } };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const result = await fetchWithTimeout(DATAVERSE_URL, { headers: { Authorization: 'x' } }, 5000);

    expect(result).toBe(mockResponse);
    const events = readDependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.dependency).toBe('dataverse');
    expect(event.resourceClass).toBe('accounts');
    expect(event.operation).toBe('GET');
    expect(event.outcome).toBe('success');
    expect(event.statusClass).toBe('2xx');
    expect(typeof event.ms).toBe('number');
    expect(Number.isFinite(event.ms)).toBe(true);
    expect(event.ms).toBeGreaterThanOrEqual(0);
    expect(event.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test('non-2xx: Response is returned (not thrown), event is http_error/4xx', async () => {
    const mockResponse = { ok: false, status: 404, headers: { get: () => null } };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const result = await fetchWithTimeout(DATAVERSE_URL, {}, 5000);

    expect(result).toBe(mockResponse);
    const events = readDependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('http_error');
    expect(events[0].statusClass).toBe('4xx');
  });

  test('timeout: AbortError rejection produces a structured throw and a statusClass-free timeout event', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortErr);

    let caught;
    try {
      await fetchWithTimeout(DATAVERSE_URL, {}, 5000);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.noResponse).toBe(true);
    expect(caught.serviceName).toBe('dataverse');
    expect(caught.causeKind).toBe('abort');

    const events = readDependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('timeout');
    expect(Object.prototype.hasOwnProperty.call(events[0], 'statusClass')).toBe(false);
  });

  test('network error: ECONNRESET produces causeKind socket and a network_error event, no statusClass', async () => {
    const netErr = new Error('socket hang up');
    netErr.code = 'ECONNRESET';
    global.fetch = jest.fn().mockRejectedValue(netErr);

    let caught;
    try {
      await fetchWithTimeout(DATAVERSE_URL, {}, 5000);
    } catch (err) {
      caught = err;
    }

    expect(caught.causeKind).toBe('socket');
    const events = readDependencyEvents(logSpy);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('network_error');
    expect(Object.prototype.hasOwnProperty.call(events[0], 'statusClass')).toBe(false);
  });

  test('thrown-error identity: same shape as pre-instrumentation behavior', async () => {
    const original = new Error('socket hang up');
    original.code = 'ECONNRESET';
    global.fetch = jest.fn().mockRejectedValue(original);

    let caught;
    try {
      await fetchWithTimeout(DATAVERSE_URL, {}, 5000);
    } catch (err) {
      caught = err;
    }

    expect(caught.message).toBe('dataverse no-response: socket hang up');
    expect(caught.isTransient).toBe(true);
    expect(caught.cause).toBe(original);
  });

  test('emission failure does not break the success or error paths', async () => {
    logSpy.mockImplementation(() => {
      throw new Error('console.log exploded');
    });

    const mockResponse = { ok: true, status: 200, headers: { get: () => null } };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);
    const result = await fetchWithTimeout(DATAVERSE_URL, {}, 5000);
    expect(result).toBe(mockResponse);

    const netErr = new Error('boom');
    netErr.code = 'ECONNRESET';
    global.fetch = jest.fn().mockRejectedValue(netErr);
    let caught;
    try {
      await fetchWithTimeout(DATAVERSE_URL, {}, 5000);
    } catch (err) {
      caught = err;
    }
    expect(caught.noResponse).toBe(true);
    expect(caught.message).toBe('dataverse no-response: boom');
  });

  test('interlock denial propagates unwrapped and emits zero events', async () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    global.fetch = jest.fn();

    let caught;
    try {
      await fetchWithTimeout(UNKNOWN_URL, { method: 'PATCH' }, 5000);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/\[dataverse-interlock\] denied/);
    expect(caught.noResponse).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(readDependencyEvents(logSpy)).toHaveLength(0);
  });

  test('method pass-through: known method mapped verbatim, unknown method mapped to unknown', async () => {
    const mockResponse = { ok: true, status: 200, headers: { get: () => null } };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    await fetchWithTimeout(DATAVERSE_URL, { method: 'PATCH' }, 5000);
    await fetchWithTimeout(DATAVERSE_URL, { method: 'WEIRD' }, 5000);

    const events = readDependencyEvents(logSpy);
    expect(events).toHaveLength(2);
    expect(events[0].operation).toBe('PATCH');
    expect(events[1].operation).toBe('unknown');
  });
});
