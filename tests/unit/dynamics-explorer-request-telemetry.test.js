/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const {
  DynamicsExplorerRequestTelemetry,
  normalizeRequestId,
  normalizeSessionId,
} = require('../../lib/services/dynamics-explorer-request-telemetry');

const REQUEST_ID = '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26';

function template(callIndex) {
  return sql.mock.calls[callIndex][0].join('?');
}

beforeEach(() => {
  sql.mockReset();
});

test('normalizes only bounded session ids and UUID request ids', () => {
  expect(normalizeRequestId(REQUEST_ID)).toBe(REQUEST_ID);
  expect(normalizeRequestId('not-a-uuid')).toBeNull();
  expect(normalizeSessionId('session-1')).toBe('session-1');
  expect(normalizeSessionId('')).toBeNull();
  expect(normalizeSessionId('x'.repeat(101))).toBeNull();
});

test('starts one running lifecycle row for a valid request', async () => {
  sql.mockResolvedValueOnce({ rows: [{ request_id: REQUEST_ID }] });

  await expect(DynamicsExplorerRequestTelemetry.startRequest({
    requestId: REQUEST_ID,
    userProfileId: 42,
    sessionId: 'session-1',
  })).resolves.toBe(true);

  expect(template(0)).toMatch(/INSERT INTO dynamics_explorer_requests/i);
  expect(template(0)).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/i);
  expect(sql.mock.calls[0].slice(1)).toEqual(expect.arrayContaining([
    REQUEST_ID, 42, 'session-1',
  ]));
});

test('start is fail-soft when telemetry storage is unavailable', async () => {
  sql.mockRejectedValueOnce(new Error('database unavailable'));
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  await expect(DynamicsExplorerRequestTelemetry.startRequest({
    requestId: REQUEST_ID,
    userProfileId: 42,
    sessionId: null,
  })).resolves.toBe(false);

  warnSpy.mockRestore();
});

test('finalizes only a running row and does not insert when update wins', async () => {
  sql.mockResolvedValueOnce({ rows: [{ request_id: REQUEST_ID }] });

  await expect(DynamicsExplorerRequestTelemetry.finalizeRequest({
    requestId: REQUEST_ID,
    userProfileId: 42,
    sessionId: 'session-1',
    outcome: 'completed',
    roundsUsed: 2,
    model: 'claude-fable-5',
    stopReason: 'end_turn',
  })).resolves.toBe(true);

  expect(sql).toHaveBeenCalledTimes(1);
  expect(template(0)).toMatch(/outcome = 'running'/i);
  expect(sql.mock.calls[0].slice(1)).toEqual(expect.arrayContaining([
    'completed', 2, 'claude-fable-5', 'end_turn', REQUEST_ID,
  ]));
});

test('recovers a missing start row with a terminal insert', async () => {
  sql
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ request_id: REQUEST_ID }] });

  await expect(DynamicsExplorerRequestTelemetry.finalizeRequest({
    requestId: REQUEST_ID,
    userProfileId: 42,
    sessionId: null,
    outcome: 'error',
    roundsUsed: 0,
    errorStage: 'context',
  })).resolves.toBe(true);

  expect(sql).toHaveBeenCalledTimes(2);
  expect(template(1)).toMatch(/INSERT INTO dynamics_explorer_requests/i);
  expect(template(1)).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/i);
  expect(sql.mock.calls[1].slice(1)).toEqual(expect.arrayContaining([
    REQUEST_ID, 'error', 0, 'context',
  ]));
});

test('a competing terminal finalizer remains a no-op', async () => {
  sql.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

  await expect(DynamicsExplorerRequestTelemetry.finalizeRequest({
    requestId: REQUEST_ID,
    userProfileId: 42,
    outcome: 'client_disconnected',
    roundsUsed: 1,
  })).resolves.toBe(false);
});

test('rejects invalid terminal outcomes without touching storage', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(DynamicsExplorerRequestTelemetry.finalizeRequest({
    requestId: REQUEST_ID,
    outcome: 'running',
    roundsUsed: 0,
  })).resolves.toBe(false);

  expect(sql).not.toHaveBeenCalled();
  warnSpy.mockRestore();
});

test('stores error_stage only for error outcomes', async () => {
  sql.mockResolvedValue({ rows: [{ request_id: REQUEST_ID }] });

  await DynamicsExplorerRequestTelemetry.finalizeRequest({
    requestId: REQUEST_ID,
    outcome: 'truncated',
    roundsUsed: 1,
    errorStage: 'model',
  });

  expect(sql.mock.calls[0].slice(1)).toContain(null);
  expect(sql.mock.calls[0].slice(1)).not.toContain('model');
});
