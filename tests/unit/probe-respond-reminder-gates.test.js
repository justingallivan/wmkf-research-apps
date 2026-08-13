/**
 * @jest-environment node
 */

const { classify, auditToken, parseCli, GATES, TOKEN_STATES, DAY_MS } = require('../../scripts/probe-respond-reminder-gates.js');

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

// --assume-enabled forces gate 2 open to answer "what would actually send?".
// Because the flag is the FIRST gate to close in production, it masks every later
// gate — so the projection is only trustworthy if it still honors those.
describe('assumeEnabled projection', () => {
  const disabled = () => ({ ...okRequest(), wmkf_respondreminderenabled: null });
  const project = (over = {}) => classify(
    over.row || okRow(),
    'request' in over ? over.request : disabled(),
    'pd' in over ? over.pd : okPd(),
    'reviewer' in over ? over.reviewer : okReviewer(),
    NOW,
    { assumeEnabled: true },
  );

  test('a row blocked ONLY by the flag becomes ELIGIBLE', () => {
    expect(run({ request: disabled() })).toBe('reminder_disabled');
    expect(project()).toBe('ELIGIBLE');
  });

  test('later gates still apply — the projection is not a blanket pass', () => {
    // Each of these is masked by the flag today; arming it must NOT send them.
    expect(project({ request: { ...disabled(), wmkf_respondoffsetdays: null } })).toBe('offset_unset');
    expect(project({ row: { ...okRow(), wmkf_emailsentat: new Date(NOW - DAY_MS).toISOString() } }))
      .toBe('not_yet_due');
    expect(project({ row: { ...okRow(), wmkf_externaltokenexpires: new Date(NOW - DAY_MS).toISOString() } }))
      .toBe('token_expired');
    expect(project({ pd: null })).toBe('no_program_director');
    expect(project({ reviewer: null })).toBe('no_reviewer_email');
  });

  test('a genuinely enabled request is unaffected by the projection', () => {
    expect(classify(okRow(), okRequest(), okPd(), okReviewer(), NOW, { assumeEnabled: true })).toBe('ELIGIBLE');
    expect(classify(okRow(), okRequest(), okPd(), okReviewer(), NOW)).toBe('ELIGIBLE');
  });

  test('the projection never overrides a missing request', () => {
    expect(project({ request: null })).toBe('request_not_loaded');
  });
});

// Token state is deliberately NOT derived from the ladder: a row stopping at an
// earlier gate never reaches the token check, so its link state would otherwise
// be unknown — which is exactly the case for the closed-cycle requests.
describe('auditToken', () => {
  const tok = (over = {}) => ({ wmkf_externaltokenhash: 'h', wmkf_externaltokenrevoked: false, ...over });

  test.each([
    ['a future expiry is live', new Date(NOW + DAY_MS).toISOString(), 'live'],
    ['a past expiry is expired', new Date(NOW - DAY_MS).toISOString(), 'expired'],
  ])('%s', (_label, value, expected) => {
    expect(auditToken(tok({ wmkf_externaltokenexpires: value }), NOW)).toBe(expected);
  });

  test('expiry exactly now is expired, matching the verifier’s <= comparison', () => {
    expect(auditToken(tok({ wmkf_externaltokenexpires: new Date(NOW).toISOString() }), NOW)).toBe('expired');
  });

  // Hash first, exactly as verify-suggestion-token.js:163 does. An earlier version
  // of this probe read only the expiry column and reported "never_minted" for a
  // null expiry — which conflated "no access at all" with "no expiry bound", the
  // two states that matter most for a closed cycle.
  test('no hash is no_token, whatever the expiry says', () => {
    expect(auditToken({ wmkf_externaltokenhash: null, wmkf_externaltokenexpires: new Date(NOW + DAY_MS).toISOString() }, NOW))
      .toBe('no_token');
    expect(auditToken({}, NOW)).toBe('no_token');
  });

  test('a revoked token is revoked even with a live expiry', () => {
    expect(auditToken(tok({ wmkf_externaltokenrevoked: true, wmkf_externaltokenexpires: new Date(NOW + DAY_MS).toISOString() }), NOW))
      .toBe('revoked');
  });

  // The dangerous shape: the verifier skips its expiry check when the column is
  // null (:183), so this is NOT expired — it is unbounded as far as Dataverse is
  // concerned, and must never be reported as safe.
  test.each([[null], [undefined], ['not-a-date']])(
    'a hash with expiry=%p is no_expiry_recorded — never "expired"',
    (value) => {
      const state = auditToken(tok({ wmkf_externaltokenexpires: value }), NOW);
      expect(state).toBe('no_expiry_recorded');
      expect(state).not.toBe('expired');
      expect(state).not.toBe('no_token');
    },
  );

  test('it reports state even for a row the ladder stops early on', () => {
    // The closed-cycle shape: no offset, so classify never reaches the token gate.
    const row = tok({ wmkf_emailsentat: '2026-07-01T00:00:00Z', wmkf_externaltokenexpires: new Date(NOW + 30 * DAY_MS).toISOString() });
    const request = { wmkf_respondreminderenabled: null, wmkf_respondoffsetdays: null };
    expect(classify(row, request, okPd(), okReviewer(), NOW)).toBe('reminder_disabled');
    expect(auditToken(row, NOW)).toBe('live');
  });

  test('every state auditToken returns is in TOKEN_STATES', () => {
    const seen = [
      auditToken({}, NOW),
      auditToken(tok({ wmkf_externaltokenrevoked: true }), NOW),
      auditToken(tok({ wmkf_externaltokenexpires: null }), NOW),
      auditToken(tok({ wmkf_externaltokenexpires: new Date(NOW + DAY_MS).toISOString() }), NOW),
      auditToken(tok({ wmkf_externaltokenexpires: new Date(NOW - DAY_MS).toISOString() }), NOW),
    ];
    expect(new Set(seen).size).toBe(5);
    for (const state of seen) expect(TOKEN_STATES).toContain(state);
  });
});

// The usage block documented `--output <path>` while the parser accepted only
// `--output=<path>`, so every documented invocation wrote no artifact and said
// nothing about it. A plan then cited a file that had never been created.
describe('parseCli flag forms', () => {
  test.each([
    ['equals form', ['--target=prod', '--output=outputs/a.json']],
    ['space form', ['--target=prod', '--output', 'outputs/a.json']],
  ])('--output is honored in %s', (_label, argv) => {
    expect(parseCli(argv).outputPath).toBe('outputs/a.json');
  });

  test.each([
    ['equals form', ['--target=prod', '--name=Jane Reviewer']],
    ['space form', ['--target=prod', '--name', 'Jane Reviewer']],
  ])('--name is honored in %s', (_label, argv) => {
    expect(parseCli(argv).name).toBe('jane reviewer');
  });

  test('a flag with no value does not swallow the next flag', () => {
    const parsed = parseCli(['--target=prod', '--output', '--assume-enabled']);
    expect(parsed.outputPath).toBeNull();
    expect(parsed.assumeEnabled).toBe(true);
  });

  test('omitted optional flags stay null', () => {
    const parsed = parseCli(['--target=prod']);
    expect(parsed.outputPath).toBeNull();
    expect(parsed.name).toBeNull();
    expect(parsed.assumeEnabled).toBe(false);
  });

  test('target is required and validated', () => {
    expect(() => parseCli([])).toThrow(/--target/);
    expect(() => parseCli(['--target=staging'])).toThrow(/Unknown target/);
  });
});
