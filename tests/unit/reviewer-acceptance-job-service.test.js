/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const store = require('../../lib/services/reviewer-acceptance-job-service');

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  sql.mockReset();
});

function sqlText(callIndex = 0) {
  const [strings] = sql.mock.calls[callIndex];
  return Array.isArray(strings) ? strings.join('?') : '';
}

describe('enqueueReviewerAcceptanceJob', () => {
  it('inserts a frozen accept payload and can reuse the suggestion+acceptedAt job', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 1, status: 'accept_pending' }] });

    const row = await store.enqueueReviewerAcceptanceJob({
      acceptanceKey: 'acceptance-1',
      acceptedAt: '2026-07-01T10:00:00.000Z',
      suggestion: { wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_request_value: REQUEST_ID, _wmkf_potentialreviewer_value: REVIEWER_ID },
      request: { akoya_requestid: REQUEST_ID },
      reviewer: { wmkf_potentialreviewersid: REVIEWER_ID },
      body: { contactEdits: { email: 'reviewer@example.org' } },
      isAcceptRepeat: false,
      optedOut: false,
    });

    expect(row.id).toBe(1);
    expect(sqlText(0)).toMatch(/INSERT INTO reviewer_acceptance_jobs/i);
    expect(sqlText(0)).toMatch(/ON CONFLICT \(suggestion_id, accepted_at\)/i);
    const [, ...values] = sql.mock.calls[0];
    expect(values).toContain('acceptance-1');
    expect(values).toContain(SUGGESTION_ID);
    expect(values.some((v) => typeof v === 'string' && v.includes('"contactEdits"'))).toBe(true);
  });
});

describe('claimReviewerAcceptanceJobs', () => {
  it('uses FOR UPDATE SKIP LOCKED and the active statuses', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const rows = await store.claimReviewerAcceptanceJobs({ limit: 5, lockSeconds: 300 });

    expect(rows).toHaveLength(1);
    expect(sqlText(0)).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sqlText(0)).toMatch(/status = ANY/i);
  });
});

describe('recordReviewerAcceptanceJobFailure', () => {
  it('clears the lease and leaves a retryable job non-terminal before the cap', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 1, status: 'queued', attempts: 1 }] });

    const row = await store.recordReviewerAcceptanceJobFailure(
      { id: 1, lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', attempts: 0 },
      new Error('boom'),
      { retryable: true, maxAttempts: 8 },
    );

    expect(row.status).toBe('queued');
    expect(sqlText(0)).toMatch(/attempts = attempts \+ 1/i);
    expect(sqlText(0)).toMatch(/locked_until = NULL/i);
    expect(sqlText(0)).toMatch(/lease_token = NULL/i);
  });
});
