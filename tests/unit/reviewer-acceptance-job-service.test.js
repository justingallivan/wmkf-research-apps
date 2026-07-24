/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const store = require('../../lib/services/reviewer-acceptance-job-service');
const { decrypt } = require('../../lib/utils/encryption');

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

  it('stores the reviewer portal token encrypted for the withdrawal link', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 2, status: 'accept_pending' }] });
    const rawToken = 'header.payload.signature';

    await store.enqueueReviewerAcceptanceJob({
      acceptedAt: '2026-07-01T10:00:00.000Z',
      suggestion: { wmkf_appreviewersuggestionid: SUGGESTION_ID },
      request: { akoya_requestid: REQUEST_ID },
      reviewer: { wmkf_potentialreviewersid: REVIEWER_ID },
      body: {},
      reviewerPortalToken: rawToken,
    });

    const [, ...values] = sql.mock.calls[0];
    const payloadText = values.find((value) =>
      typeof value === 'string' && value.includes('"schemaVersion":2'));
    expect(payloadText).toBeTruthy();
    expect(payloadText).not.toContain(rawToken);
    const payload = JSON.parse(payloadText);
    expect(decrypt(payload.reviewerPortalTokenEncrypted)).toBe(rawToken);
  });
});

describe('cancelReviewerAcceptanceJobsForSuggestion', () => {
  it('cancels only active jobs for the exact suggestion id', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 3, status: 'cancelled' }] });

    const rows = await store.cancelReviewerAcceptanceJobsForSuggestion(
      SUGGESTION_ID,
      'reviewer_withdrew_before_materials',
    );

    expect(rows).toHaveLength(1);
    expect(sqlText(0)).toMatch(/WHERE suggestion_id =/i);
    expect(sqlText(0)).toMatch(/status = ANY/i);
    expect(sqlText(0)).toMatch(/lease_token IS NULL OR locked_until < NOW\(\)/i);
    const [, ...values] = sql.mock.calls[0];
    expect(values).toContain(SUGGESTION_ID);
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
