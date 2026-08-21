/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const FeedbackService = require('../../lib/services/feedback-service');

const REQUEST_ID = '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26';

function template(callIndex) {
  return sql.mock.calls[callIndex][0].join('?');
}

function create(overrides = {}) {
  return FeedbackService.createFeedback({
    userProfileId: 42,
    sessionId: 'session-1',
    requestId: REQUEST_ID,
    feedbackType: 'positive',
    queryText: 'question',
    conversationContext: [],
    ...overrides,
  });
}

beforeEach(() => {
  sql.mockReset();
});

test('correlates feedback only after request ownership and session verification', async () => {
  sql
    .mockResolvedValueOnce({ rows: [{ request_id: REQUEST_ID }] })
    .mockResolvedValueOnce({ rows: [{ id: 7, request_id: REQUEST_ID }] });

  await expect(create()).resolves.toEqual({ id: 7, request_id: REQUEST_ID });

  expect(template(0)).toMatch(/user_profile_id = \?/i);
  expect(template(0)).toMatch(/session_id = \?/i);
  expect(sql.mock.calls[0].slice(1)).toEqual([REQUEST_ID, 42, 'session-1']);
  expect(template(1)).toContain('request_id');
  expect(sql.mock.calls[1].slice(1)).toContain(REQUEST_ID);
});

test.each([
  ['wrong owner or session', { rows: [] }],
  ['missing request telemetry', { rows: [] }],
])('stores uncorrelated feedback when verification returns no match: %s', async (_label, lookup) => {
  sql
    .mockResolvedValueOnce(lookup)
    .mockResolvedValueOnce({ rows: [{ id: 8, request_id: null }] });

  await create();

  expect(sql.mock.calls[1].slice(1)).toContain(null);
  expect(sql.mock.calls[1].slice(1)).not.toContain(REQUEST_ID);
});

test('invalid request or absent session skips verification and saves uncorrelated feedback', async () => {
  sql.mockResolvedValueOnce({ rows: [{ id: 9, request_id: null }] });

  await create({ requestId: 'not-a-uuid', sessionId: null });

  expect(sql).toHaveBeenCalledTimes(1);
  expect(template(0)).toMatch(/INSERT INTO dynamics_feedback/i);
  expect(sql.mock.calls[0].slice(1)).not.toContain(REQUEST_ID);
});

test('a correlation lookup outage does not discard feedback', async () => {
  sql
    .mockRejectedValueOnce(new Error('request table unavailable'))
    .mockResolvedValueOnce({ rows: [{ id: 10, request_id: null }] });
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  await expect(create()).resolves.toEqual({ id: 10, request_id: null });
  expect(sql.mock.calls[1].slice(1)).not.toContain(REQUEST_ID);

  warnSpy.mockRestore();
});

test('falls back to the legacy feedback insert before migration 033 exists', async () => {
  sql
    .mockRejectedValueOnce(Object.assign(new Error('missing request table'), { code: '42P01' }))
    .mockRejectedValueOnce(Object.assign(new Error('missing request_id column'), { code: '42703' }))
    .mockResolvedValueOnce({ rows: [{ id: 11 }] });
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  await expect(create()).resolves.toEqual({ id: 11 });

  expect(sql).toHaveBeenCalledTimes(3);
  expect(template(1)).toContain('request_id');
  expect(template(2)).not.toContain('request_id');
  warnSpy.mockRestore();
});
