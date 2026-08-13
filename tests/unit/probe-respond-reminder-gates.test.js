/**
 * @jest-environment node
 */

const { classify, GATES, DAY_MS } = require('../../scripts/probe-respond-reminder-gates.js');

const NOW = Date.parse('2026-08-13T12:00:00Z');

// A row/request pair that passes EVERY gate. Each test below breaks exactly one
// thing, so a passing assertion proves that gate fired — not merely that the
// ladder returned something.
const okRow = () => ({
  wmkf_emailsentat: '2026-07-01T00:00:00Z',            // 43 days ago
  wmkf_externaltokenexpires: '2026-12-01T00:00:00Z',   // live
});
const okRequest = () => ({
  wmkf_respondreminderenabled: true,
  wmkf_respondoffsetdays: 7,
  wmkf_respondreminderleaddays: 0,
  _wmkf_programdirector_value: 'PD-1',
});
const okPd = () => ({ systemuserid: 'PD-1', internalemailaddress: 'pd@wmkeck.org' });
const okReviewer = () => ({ wmkf_emailaddress: 'r@uni.edu' });

const run = ({ row = okRow(), request = okRequest(), pd = okPd(), reviewer = okReviewer() } = {}) =>
  classify(row, request, pd, reviewer, NOW);

describe('respond-reminder gate attribution', () => {
  test('the control fixture is ELIGIBLE — without this, every test below is vacuous', () => {
    expect(run()).toBe('ELIGIBLE');
  });

  test('a missing request is attributed to the context load', () => {
    expect(run({ request: null })).toBe('request_not_loaded');
  });

  // The suspected production cause. `=== true` is strict, so null (never
  // configured, which is every request until the toggle is exposed) fails.
  test.each([[null], [undefined], [false], ['true'], [1]])(
    'respondReminderEnabled=%p is not exactly true → reminder_disabled',
    (value) => {
      expect(run({ request: { ...okRequest(), wmkf_respondreminderenabled: value } })).toBe('reminder_disabled');
    },
  );

  test.each([[null], [undefined], ['7'], [7.5]])(
    'respondOffsetDays=%p is not an integer → offset_unset',
    (value) => {
      expect(run({ request: { ...okRequest(), wmkf_respondoffsetdays: value } })).toBe('offset_unset');
    },
  );

  test('a row with no emailSentAt is attributed to that, not to the offset', () => {
    expect(run({ row: { ...okRow(), wmkf_emailsentat: null } })).toBe('no_email_sent_at');
  });

  test('before the reminder comes due → not_yet_due', () => {
    // Invited yesterday with a 7-day offset: due in 6 days.
    const row = { ...okRow(), wmkf_emailsentat: new Date(NOW - 1 * DAY_MS).toISOString() };
    expect(run({ row })).toBe('not_yet_due');
  });

  test('leadDays pulls the send earlier, flipping not_yet_due to eligible', () => {
    const row = { ...okRow(), wmkf_emailsentat: new Date(NOW - 5 * DAY_MS).toISOString() };
    expect(run({ row })).toBe('not_yet_due');
    expect(run({ row, request: { ...okRequest(), wmkf_respondreminderleaddays: 3 } })).toBe('ELIGIBLE');
  });

  test.each([
    ['expired yesterday', new Date(NOW - DAY_MS).toISOString()],
    ['never minted', null],
  ])('token %s → token_expired', (_label, value) => {
    expect(run({ row: { ...okRow(), wmkf_externaltokenexpires: value } })).toBe('token_expired');
  });

  test.each([
    ['null (missing or disabled)', null],
    ['no email address', { systemuserid: 'PD-1', internalemailaddress: null }],
    ['no system user id', { systemuserid: null, internalemailaddress: 'pd@wmkeck.org' }],
  ])('PD %s → no_program_director', (_label, pd) => {
    expect(run({ pd })).toBe('no_program_director');
  });

  test('a person row with no email → no_reviewer_email', () => {
    expect(run({ reviewer: { wmkf_emailaddress: null } })).toBe('no_reviewer_email');
    expect(run({ reviewer: null })).toBe('no_reviewer_email');
  });

  // Ladder ORDER is the probe's whole claim: it reports the FIRST gate that
  // closes. A row failing several gates must be attributed to the earliest one,
  // or the "dominant reason" summary points at the wrong fix.
  test('a row failing several gates is attributed to the earliest', () => {
    const doomed = {
      row: { wmkf_emailsentat: null, wmkf_externaltokenexpires: null },
      request: { ...okRequest(), wmkf_respondreminderenabled: null, wmkf_respondoffsetdays: null },
      pd: null,
      reviewer: null,
    };
    expect(run(doomed)).toBe('reminder_disabled');
    // ...and with the flag on, attribution advances exactly one rung.
    expect(run({ ...doomed, request: { ...doomed.request, wmkf_respondreminderenabled: true } }))
      .toBe('offset_unset');
  });

  test('every verdict classify can return has a legend entry', () => {
    const keys = new Set(GATES.map((g) => g.key));
    for (const verdict of [
      'request_not_loaded', 'reminder_disabled', 'offset_unset', 'no_email_sent_at',
      'not_yet_due', 'token_expired', 'no_program_director', 'no_reviewer_email', 'ELIGIBLE',
    ]) {
      expect(keys.has(verdict)).toBe(true);
    }
  });
});
