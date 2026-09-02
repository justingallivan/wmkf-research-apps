const { deriveReviewerTokenState } = require('../../lib/external/reviewer-token-state');
const {
  evaluateReviewDueReminderEligibility,
} = require('../../lib/services/reviewer-reminder-eligibility');

const NOW = Date.parse('2026-09-01T12:00:00Z');

function row(over = {}) {
  return {
    wmkf_externaltokenhash: 'stored-hash',
    wmkf_externaltokenexpires: '2026-09-10T23:59:59Z',
    wmkf_externaltokenrevoked: false,
    ...over,
  };
}

describe('deriveReviewerTokenState', () => {
  test.each([
    ['revoked wins over a blank hash', row({ wmkf_externaltokenrevoked: true, wmkf_externaltokenhash: '  ' }), 'revoked'],
    ['whitespace-only hash is not minted', row({ wmkf_externaltokenhash: '  ' }), 'not_minted'],
    ['missing expiry is invalid', row({ wmkf_externaltokenexpires: null }), 'invalid'],
    ['malformed expiry is invalid', row({ wmkf_externaltokenexpires: 'not-a-date' }), 'invalid'],
    ['expiry equal to now is expired', row({ wmkf_externaltokenexpires: '2026-09-01T12:00:00Z' }), 'expired'],
    ['future expiry is active', row(), 'active'],
  ])('%s', (_label, tokenRow, expected) => {
    expect(deriveReviewerTokenState(tokenRow, { nowMs: NOW })).toBe(expected);
  });
});

describe('evaluateReviewDueReminderEligibility', () => {
  test('future deadline is eligible only when expiry is strictly later', () => {
    expect(evaluateReviewDueReminderEligibility({
      row: row({ wmkf_externaltokenexpires: '2026-09-09T23:59:59Z' }),
      effectiveReviewDueDate: '2026-09-09',
      nowMs: NOW,
    })).toMatchObject({ eligible: false, reason: 'token_insufficient_window' });

    expect(evaluateReviewDueReminderEligibility({
      row: row({ wmkf_externaltokenexpires: '2026-09-10T00:00:00Z' }),
      effectiveReviewDueDate: '2026-09-09',
      nowMs: NOW,
    })).toMatchObject({ eligible: true, reason: null });
  });

  test('overdue review needs a token that is live now, with no arbitrary runway', () => {
    expect(evaluateReviewDueReminderEligibility({
      row: row({ wmkf_externaltokenexpires: '2026-09-01T12:00:00.001Z' }),
      effectiveReviewDueDate: '2026-08-31',
      nowMs: NOW,
    })).toMatchObject({ eligible: true, reason: null });
  });

  test.each([
    ['revoked', row({ wmkf_externaltokenrevoked: true }), 'token_revoked'],
    ['not minted', row({ wmkf_externaltokenhash: null }), 'token_not_minted'],
    ['invalid metadata', row({ wmkf_externaltokenexpires: null }), 'token_invalid_data'],
    ['expired', row({ wmkf_externaltokenexpires: '2026-08-31T00:00:00Z' }), 'token_expired'],
    ['missing due date', row(), 'due_date_missing'],
  ])('%s maps to its operator-facing block reason', (_label, tokenRow, reason) => {
    expect(evaluateReviewDueReminderEligibility({
      row: tokenRow,
      effectiveReviewDueDate: reason === 'due_date_missing' ? null : '2026-09-09',
      nowMs: NOW,
    })).toMatchObject({ eligible: false, reason });
  });
});
