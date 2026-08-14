import {
  declineReferralContentVersion,
  MAX_DECLINE_REFERRALS,
  normalizeDeclineReferrals,
  parseStoredDeclineReferral,
  referralDisplayText,
  resolveLegacyDeclineReferral,
  resolveStructuredDeclineReferral,
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
    { name: 'Sarah Chen', institution: 'Stanford', email: 'chen@example.edu', structured: true, resolved: false },
    { name: 'Alex Rivera', institution: '', email: '', structured: true, resolved: false },
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
      resolved: false,
    },
  ]);
  expect(parseStoredDeclineReferral('wmkf-referrals:v1:not-json')[0]).toMatchObject({
    legacyText: 'wmkf-referrals:v1:not-json',
    structured: false,
  });
  expect(parseStoredDeclineReferral('wmkf-referrals:r1:not-json')[0]).toMatchObject({
    legacyText: 'wmkf-referrals:r1:not-json',
    structured: false,
  });
  expect(parseStoredDeclineReferral('wmkf-referrals:r8:[{"n":"One"},{"n":"Two"}]')[0])
    .toMatchObject({ structured: false });
});

test('archives a legacy note in place while preserving its original text', () => {
  const resolved = resolveLegacyDeclineReferral('  Try Dr. Jane Smith at MIT  ');
  expect(resolved).toMatchObject({ ok: true, alreadyResolved: false });
  expect(resolved.storedValue).toBe('wmkf-referral-resolved:v1:Try Dr. Jane Smith at MIT');
  expect(parseStoredDeclineReferral(resolved.storedValue)).toEqual([
    {
      name: null,
      institution: null,
      email: null,
      legacyText: 'Try Dr. Jane Smith at MIT',
      structured: false,
      resolved: true,
    },
  ]);
  expect(resolveLegacyDeclineReferral(resolved.storedValue)).toEqual({
    ok: true,
    storedValue: resolved.storedValue,
    alreadyResolved: true,
  });
});

test('never allows structured referrals to be dismissed as legacy prose', () => {
  const stored = normalizeDeclineReferrals([{ name: 'Sarah Chen' }]).storedValue;
  expect(resolveLegacyDeclineReferral(stored)).toEqual({
    ok: false,
    reason: 'structured_decline_referral_not_dismissible',
  });
  expect(resolveLegacyDeclineReferral('wmkf-referrals:v1:not-json')).toEqual({
    ok: false,
    reason: 'structured_decline_referral_not_dismissible',
  });
  expect(resolveLegacyDeclineReferral('wmkf-referrals:v2:[{"n":"Sarah Chen"}]')).toEqual({
    ok: false,
    reason: 'structured_decline_referral_not_dismissible',
  });
});

test('binds dismissal to exact submitted content while ignoring resolution markers', () => {
  const stored = normalizeDeclineReferrals([
    { name: 'Sarah Chen' },
    { name: 'Alex Rivera' },
  ]).storedValue;
  const masked = resolveStructuredDeclineReferral(stored, 1).storedValue;

  expect(declineReferralContentVersion(stored))
    .toBe('structured:[{"n":"Sarah Chen"},{"n":"Alex Rivera"}]');
  expect(declineReferralContentVersion(masked)).toBe(declineReferralContentVersion(stored));
  expect(declineReferralContentVersion('Try Dr. Jane Smith'))
    .toBe('legacy:Try Dr. Jane Smith');
  expect(declineReferralContentVersion('wmkf-referral-resolved:v1:Try Dr. Jane Smith'))
    .toBe('legacy:Try Dr. Jane Smith');
  expect(declineReferralContentVersion('wmkf-referrals:v1:not-json')).toBeNull();
  expect(declineReferralContentVersion('wmkf-referrals:v2:[{"n":"Sarah Chen"}]')).toBeNull();
});

test('resolves one structured row without changing the submitted payload or memo length', () => {
  const stored = normalizeDeclineReferrals([
    { name: 'Sarah Chen', institution: 'Stanford' },
    { name: 'Alex Rivera', institution: 'UCLA' },
  ]).storedValue;

  const resolved = resolveStructuredDeclineReferral(stored, 1);

  expect(resolved).toMatchObject({ ok: true, alreadyResolved: false });
  expect(resolved.storedValue).toMatch(/^wmkf-referrals:r2:/);
  expect(resolved.storedValue).toHaveLength(stored.length);
  expect(resolved.storedValue.replace(/^wmkf-referrals:[^:]+:/, ''))
    .toBe(stored.replace(/^wmkf-referrals:[^:]+:/, ''));
  expect(parseStoredDeclineReferral(resolved.storedValue)).toEqual([
    { name: 'Sarah Chen', institution: 'Stanford', email: '', structured: true, resolved: false },
    { name: 'Alex Rivera', institution: 'UCLA', email: '', structured: true, resolved: true },
  ]);
  expect(resolveStructuredDeclineReferral(resolved.storedValue, 1)).toEqual({
    ok: true,
    storedValue: resolved.storedValue,
    alreadyResolved: true,
  });
  const bothResolved = resolveStructuredDeclineReferral(resolved.storedValue, 0);
  expect(bothResolved.storedValue).toMatch(/^wmkf-referrals:r3:/);
  expect(parseStoredDeclineReferral(bothResolved.storedValue).map((row) => row.resolved))
    .toEqual([true, true]);
});

test('keeps the configured maximum within the one-hex-digit persisted mask', () => {
  const stored = normalizeDeclineReferrals(
    Array.from({ length: MAX_DECLINE_REFERRALS }, (_, index) => ({ name: `Person ${index}` })),
  ).storedValue;

  const resolved = resolveStructuredDeclineReferral(stored, MAX_DECLINE_REFERRALS - 1);

  expect(resolved.ok).toBe(true);
  expect(resolved.storedValue).toMatch(/^wmkf-referrals:r[0-9a-f]:/);
  expect(resolved.storedValue).toHaveLength(stored.length);
  expect(parseStoredDeclineReferral(resolved.storedValue).map((row) => row.resolved))
    .toEqual([false, false, false, true]);
});

test('rejects a structured dismissal index outside the stored rows', () => {
  const stored = normalizeDeclineReferrals([{ name: 'Sarah Chen' }]).storedValue;
  expect(resolveStructuredDeclineReferral(stored, 1)).toEqual({
    ok: false,
    reason: 'decline_referral_index_out_of_range',
  });
});

test('rejects legacy resolution when the preserved value would exceed the memo limit', () => {
  expect(resolveLegacyDeclineReferral('x'.repeat(1974))).toMatchObject({ ok: true });
  expect(resolveLegacyDeclineReferral('x'.repeat(1975))).toEqual({
    ok: false,
    reason: 'resolved_legacy_decline_referral_too_long',
  });
  expect(resolveLegacyDeclineReferral('x'.repeat(2000))).toEqual({
    ok: false,
    reason: 'resolved_legacy_decline_referral_too_long',
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
