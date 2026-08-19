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

test('PATCH resolve attributes the acting profile', async () => {
  OperationalEventService.setEventStatus.mockResolvedValue({ id: 5, status: 'resolved' });
  const res = mkRes();
  await handler({ method: 'PATCH', body: { id: 5, action: 'resolve', note: 'checked' } }, res);
  expect(OperationalEventService.setEventStatus).toHaveBeenCalledWith(5, 'resolve', {
    profileId: 9, note: 'checked',
  });
  expect(res.body).toEqual({ ok: true, id: 5, status: 'resolved' });
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
