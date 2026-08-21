import { jest } from '@jest/globals';

jest.mock('@vercel/postgres', () => ({
  sql: jest.fn(() => Promise.resolve({ rows: [] })),
}));

const { sql } = require('@vercel/postgres');
const { logUsage } = require('../../lib/utils/usage-logger.js');

beforeEach(() => {
  sql.mockClear();
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
  });

  expect(sql).toHaveBeenCalledTimes(1);
  const [strings, ...values] = sql.mock.calls[0];
  expect(strings.join('?')).toContain('stop_reason');
  expect(values).toContain('max_tokens');
});
