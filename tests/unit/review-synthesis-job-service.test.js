/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const store = require('../../lib/services/review-synthesis-job-service');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const INPUT_HASH = 'a'.repeat(64);
const LEASE = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  sql.mockReset();
});

function sqlText(callIndex = 0) {
  const [strings] = sql.mock.calls[callIndex];
  return Array.isArray(strings) ? strings.join('?') : '';
}

test('automatic enqueue deduplicates the exact request fingerprint without reopening terminal work', async () => {
  sql.mockResolvedValueOnce({ rows: [{ id: 1, status: 'queued' }] });
  const row = await store.enqueueAutomaticReviewSynthesisJob({
    requestId: REQUEST_ID,
    inputHash: INPUT_HASH,
  });
  expect(row.status).toBe('queued');
  expect(sqlText()).toMatch(/ON CONFLICT \(dedupe_key\)/i);
  expect(sqlText()).toMatch(/DO NOTHING/i);
  expect(sqlText()).not.toMatch(/attempts\s*=/i);
  expect(sql.mock.calls[0].slice(1)).toContain(`automatic:${REQUEST_ID}:${INPUT_HASH}`);
});

test('manual start uses a unique generation-scoped key and a lease', async () => {
  sql.mockResolvedValueOnce({ rows: [{ id: 2, status: 'running' }] });
  await store.startManualReviewSynthesisJob({
    requestId: REQUEST_ID,
    inputHash: INPUT_HASH,
    actingUserSystemId: null,
  });
  expect(sqlText()).toMatch(/'manual'/i);
  expect(sqlText()).toMatch(/'running'/i);
  expect(sqlText()).toMatch(/INTERVAL '10 minutes'/i);
});

test('automatic claim uses SKIP LOCKED and increments attempts under one lease', async () => {
  sql.mockResolvedValueOnce({ rows: [{ id: 3, status: 'running' }] });
  const rows = await store.claimAutomaticReviewSynthesisJobs({ limit: 1 });
  expect(rows).toHaveLength(1);
  expect(sqlText()).toMatch(/FOR UPDATE SKIP LOCKED/i);
  expect(sqlText()).toMatch(/attempts = attempts \+ 1/i);
  expect(sqlText()).toMatch(/status = 'running'/i);
});

test('failure clears the lease and requeues a retryable automatic attempt below the cap', async () => {
  sql.mockResolvedValueOnce({ rows: [{ id: 3, status: 'queued' }] });
  const row = await store.recordReviewSynthesisJobFailure(
    { id: 3, lease_token: LEASE, attempts: 1 },
    new Error('provider timeout'),
    { retryable: true, maxAttempts: 3 },
  );
  expect(row.status).toBe('queued');
  expect(sqlText()).toMatch(/locked_until = NULL/i);
  expect(sqlText()).toMatch(/lease_token = NULL/i);
});

test('state is current only when a completed row matches the supplied fingerprint', async () => {
  sql
    .mockResolvedValueOnce({
      rows: [{
        id: 5,
        mode: 'automatic',
        status: 'failed',
        input_hash: 'b'.repeat(64),
        last_error: 'latest failed',
      }],
    })
    .mockResolvedValueOnce({
      rows: [{ id: 4, run_id: 'run-current', completed_at: '2026-07-28T00:00:00Z' }],
    });
  const state = await store.getReviewSynthesisJobState(REQUEST_ID, INPUT_HASH);
  expect(state).toMatchObject({
    current: true,
    status: 'failed',
    lastError: 'latest failed',
    currentRunId: 'run-current',
  });
  expect(sqlText(1)).toMatch(/input_hash =/i);
  expect(sqlText(1)).toMatch(/status = 'completed'/i);
});

test('rejects a malformed fingerprint before SQL', async () => {
  await expect(store.enqueueAutomaticReviewSynthesisJob({
    requestId: REQUEST_ID,
    inputHash: 'not-a-hash',
  })).rejects.toThrow(/SHA-256/);
  expect(sql).not.toHaveBeenCalled();
});
