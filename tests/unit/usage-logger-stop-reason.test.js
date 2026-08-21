import { jest } from '@jest/globals';

jest.mock('@vercel/postgres', () => ({
  sql: jest.fn(() => Promise.resolve({ rows: [] })),
}));

const { sql } = require('@vercel/postgres');
const { logUsage } = require('../../lib/utils/usage-logger.js');

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
});

test('persists the provider stop reason in the existing usage row', () => {
  logUsage({
    userProfileId: 42,
    appName: 'dynamics-explorer',
    model: 'claude-sonnet-5',
    inputTokens: 10,
    outputTokens: 5,
    latencyMs: 25,
    stopReason: 'max_tokens',
    requestId: '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26',
    requestRound: 3,
  });

  expect(sql).toHaveBeenCalledTimes(1);
  const [strings, ...values] = sql.mock.calls[0];
  expect(strings.join('?')).toContain('stop_reason');
  expect(strings.join('?')).toContain('request_id');
  expect(strings.join('?')).toContain('request_round');
  expect(values).toContain('max_tokens');
  expect(values).toContain('2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26');
  expect(values).toContain(3);
});

test('falls back to the legacy usage insert before migration 033 exists', async () => {
  sql
    .mockRejectedValueOnce(Object.assign(new Error('missing column'), { code: '42703' }))
    .mockResolvedValueOnce({ rows: [] });

  logUsage({
    appName: 'dynamics-explorer',
    model: 'claude-fable-5',
    requestId: '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26',
    requestRound: 1,
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(sql).toHaveBeenCalledTimes(2);
  expect(sql.mock.calls[0][0].join('?')).toContain('request_id');
  expect(sql.mock.calls[1][0].join('?')).not.toContain('request_id');
});
