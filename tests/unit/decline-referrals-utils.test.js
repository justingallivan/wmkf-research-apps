import {
  MAX_DECLINE_REFERRALS,
  normalizeDeclineReferrals,
  parseStoredDeclineReferral,
  referralDisplayText,
} from '../../shared/utils/decline-referrals';

test('normalizes and round-trips structured referral rows through the memo envelope', () => {
  const normalized = normalizeDeclineReferrals([
    { name: ' Sarah Chen ', institution: ' Stanford ', email: ' chen@example.edu ' },
    { name: 'Alex Rivera', institution: '', email: '' },
    { name: ' ', institution: '', email: '' },
  ]);

  expect(normalized).toMatchObject({
    ok: true,
    referrals: [
      { name: 'Sarah Chen', institution: 'Stanford', email: 'chen@example.edu' },
      { name: 'Alex Rivera', institution: '', email: '' },
    ],
  });
  expect(normalized.storedValue).toMatch(/^wmkf-referrals:v1:/);
  const parsed = parseStoredDeclineReferral(normalized.storedValue);
  expect(parsed).toEqual([
    { name: 'Sarah Chen', institution: 'Stanford', email: 'chen@example.edu', structured: true },
    { name: 'Alex Rivera', institution: '', email: '', structured: true },
  ]);
  expect(referralDisplayText(parsed[0])).toBe('Sarah Chen · Stanford · chen@example.edu');
});

test('preserves legacy free text and malformed envelopes as legacy display-only values', () => {
  expect(parseStoredDeclineReferral('Try Dr. Jane Smith at MIT')).toEqual([
    {
      name: null,
      institution: null,
      email: null,
      legacyText: 'Try Dr. Jane Smith at MIT',
      structured: false,
    },
  ]);
  expect(parseStoredDeclineReferral('wmkf-referrals:v1:not-json')[0]).toMatchObject({
    legacyText: 'wmkf-referrals:v1:not-json',
    structured: false,
  });
});

test.each([
  { value: 'not-an-array', reason: 'invalid_decline_referrals' },
  {
    value: Array.from({ length: MAX_DECLINE_REFERRALS + 1 }, () => ({ name: 'Person' })),
    reason: 'too_many_decline_referrals',
  },
  { value: [{ institution: 'MIT' }], reason: 'decline_referral_name_required' },
  { value: [{ name: 'Person', email: 'not-an-email' }], reason: 'invalid_decline_referral_email' },
  { value: [{ name: 'Person', biography: 'prose' }], reason: 'unknown_decline_referral_field' },
])('rejects malformed structured input: $reason', ({ value, reason }) => {
  expect(normalizeDeclineReferrals(value)).toMatchObject({ ok: false, reason });
});
