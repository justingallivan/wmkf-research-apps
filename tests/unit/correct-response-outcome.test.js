/**
 * @jest-environment node
 *
 * Wave 35 Ended by / Ended at for staff corrections (correct-response.js).
 */
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({}));

const NOW = '2026-10-31T12:00:00.000Z';
let correctionOutcome;
beforeAll(async () => {
  ({ correctionOutcome } = await import('../../lib/services/reviewer-engagement/correct-response.js'));
});

const open = (over = {}) => ({ wmkf_declined: false, wmkf_accepted: false, wmkf_responsetype: null, ...over });

test.each([
  ['a decline corrected to Accepted reopens the engagement', open({ wmkf_declined: true, wmkf_responsetype: 100000001 }), { accepted: true, responseType: 'accepted' }, { endedBy: null, endedAt: null }],
  ['an unanswered row corrected to declined: reviewer before accepting', open(), { declined: true, responseType: 'declined' }, { endedBy: 'reviewer_before_accepting', endedAt: NOW }],
  ['an accepted row corrected to declined: reviewer after accepting', open({ wmkf_accepted: true, wmkf_responsetype: 100000000 }), { declined: true }, { endedBy: 'reviewer_after_accepting', endedAt: NOW }],
  ['corrected to no longer needed: Foundation', open(), { responseType: 'withdrawn_sufficient' }, { endedBy: 'foundation', endedAt: NOW }],
  ['corrected to no response: blank', open(), { responseType: 'no_response' }, { endedBy: null, endedAt: null }],
  ['an additive correction leaves the fields alone', open({ wmkf_accepted: true }), { invited: true }, undefined],
  ['an already-ended row is not re-attributed', open({ wmkf_responsetype: 100000002 }), { declined: true }, undefined],
])('%s', (_label, current, lifecycle, expected) => {
  expect(correctionOutcome(current, lifecycle, NOW)).toEqual(expected);
});
