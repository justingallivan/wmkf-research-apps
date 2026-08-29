/**
 * Unit tests for pages/api/admin/operational-events.js.
 *
 * Covers: superuser gate short-circuit, GET filter passthrough + envelope,
 * PATCH resolve with profile attribution, typed 400s, 404 on missing row,
 * and 405 for other methods.
 *
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireSuperuser: jest.fn(),
}));
jest.mock('../../lib/services/operational-event-service', () => ({
  queryEvents: jest.fn(),
  getEventSummary: jest.fn(),
  setEventStatus: jest.fn(),
  setEventStatuses: jest.fn(),
}));

import handler from '../../pages/api/admin/operational-events.js';
import { requireSuperuser } from '../../lib/utils/auth';
import OperationalEventService from '../../lib/services/operational-event-service';

function mkRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireSuperuser.mockResolvedValue({ profileId: 9 });
  OperationalEventService.queryEvents.mockResolvedValue([{ id: 1 }]);
  OperationalEventService.getEventSummary.mockResolvedValue([{ status: 'open', severity: 'error', count: 1 }]);
});

test('DELETE → 405', async () => {
  const res = mkRes();
  await handler({ method: 'DELETE' }, res);
  expect(res.statusCode).toBe(405);
});

test('gate failure stops the handler (guard already wrote the response)', async () => {
  requireSuperuser.mockResolvedValue(null);
  const res = mkRes();
  await handler({ method: 'GET', query: {} }, res);
  expect(OperationalEventService.queryEvents).not.toHaveBeenCalled();
});

test('GET passes filters through and returns events + summary', async () => {
  const res = mkRes();
  await handler({
    method: 'GET',
    query: { status: 'open', severity: 'error', source: 'app', search: '1002912', hours: '24', limit: '50' },
  }, res);
  expect(OperationalEventService.queryEvents).toHaveBeenCalledWith(expect.objectContaining({
    status: 'open', severity: 'error', source: 'app', search: '1002912', hours: '24', limit: '50',
  }));
  expect(res.statusCode).toBe(200);
  expect(res.body.events).toEqual([{ id: 1 }]);
  expect(res.body.summary).toHaveLength(1);
});

test('PATCH resolve attributes the acting profile and forwards freshness expectations', async () => {
  OperationalEventService.setEventStatus.mockResolvedValue({ id: 5, status: 'resolved' });
  const res = mkRes();
  await handler({
    method: 'PATCH',
    body: {
      id: 5, action: 'resolve', note: 'checked',
      expectedStatus: 'open', expectedLastOccurredAt: '2026-08-19T00:00:00.000Z',
    },
  }, res);
  expect(OperationalEventService.setEventStatus).toHaveBeenCalledWith(5, 'resolve', {
    profileId: 9,
    note: 'checked',
    expectedStatus: 'open',
    expectedLastOccurredAt: '2026-08-19T00:00:00.000Z',
  });
  expect(res.body).toEqual({ ok: true, id: 5, status: 'resolved' });
});

test('PATCH against a row that changed since render → 409 with current state', async () => {
  const err = new Error('event changed since it was rendered');
  err.code = 'stale_state';
  err.current = { id: 5, status: 'open', occurrence_count: 3 };
  OperationalEventService.setEventStatus.mockRejectedValue(err);
  const res = mkRes();
  await handler({
    method: 'PATCH',
    body: { id: 5, action: 'resolve', expectedStatus: 'open', expectedLastOccurredAt: 'x' },
  }, res);
  expect(res.statusCode).toBe(409);
  expect(res.body.current).toMatchObject({ occurrence_count: 3 });
});

test('PATCH invalid action → 400', async () => {
  const err = new Error('invalid action');
  err.code = 'invalid_action';
  OperationalEventService.setEventStatus.mockRejectedValue(err);
  const res = mkRes();
  await handler({ method: 'PATCH', body: { id: 5, action: 'nuke' } }, res);
  expect(res.statusCode).toBe(400);
});

test('PATCH unknown id → 404', async () => {
  OperationalEventService.setEventStatus.mockResolvedValue(null);
  const res = mkRes();
  await handler({ method: 'PATCH', body: { id: 999, action: 'resolve' } }, res);
  expect(res.statusCode).toBe(404);
});

test('PATCH with an events[] batch resolves each row with its own precondition and returns counts', async () => {
  OperationalEventService.setEventStatuses.mockResolvedValue({
    updated: [5, 6], stale: [7], notFound: [], invalid: [],
  });
  const res = mkRes();
  const events = [
    { id: 5, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:00:00.000Z' },
    { id: 6, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:00:01.000Z' },
    { id: 7, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:00:02.000Z' },
  ];
  await handler({ method: 'PATCH', body: { action: 'resolve', events, note: 'S468 throttle storm' } }, res);
  expect(OperationalEventService.setEventStatuses).toHaveBeenCalledWith(events, 'resolve', {
    profileId: 9,
    note: 'S468 throttle storm',
  });
  expect(OperationalEventService.setEventStatus).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    ok: true, action: 'resolve', requested: 3, updated: 2, stale: 1, notFound: 0, invalid: 0,
  });
});

test('PATCH batch over the cap → 400', async () => {
  const err = new Error('too many events in one batch (max 500)');
  err.code = 'batch_too_large';
  OperationalEventService.setEventStatuses.mockRejectedValue(err);
  const res = mkRes();
  await handler({ method: 'PATCH', body: { action: 'resolve', events: new Array(501).fill({ id: 1 }) } }, res);
  expect(res.statusCode).toBe(400);
});
