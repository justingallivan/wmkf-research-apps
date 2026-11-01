/**
 * @jest-environment node
 *
 * Wave 35 Ended by / Ended at for staff corrections (correct-response.js).
 */
const findById = jest.fn();
const updateLifecycle = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({ ensureToken: jest.fn() }));
jest.mock('../../lib/services/reviewer-first-manual-invitation-coi', () => ({
  isFirstManualInvitation: () => false,
  screenFirstManualInvitationInstitutionCOI: jest.fn(),
}));

const NOW = '2026-10-31T12:00:00.000Z';
const REQ = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
let correctionOutcome;
let normalizeCorrection;
let correctResponse;
beforeAll(async () => {
  ({ correctionOutcome, normalizeCorrection, correctResponse } = await import('../../lib/services/reviewer-engagement/correct-response.js'));
});
beforeEach(() => {
  findById.mockReset();
  updateLifecycle.mockReset().mockResolvedValue(undefined);
});

const open = (over = {}) => ({ wmkf_declined: false, wmkf_accepted: false, wmkf_responsetype: null, ...over });
const row = (over = {}) => ({
  wmkf_appreviewersuggestionid: ID, _wmkf_request_value: REQ, _etag: 'W/"4"',
  wmkf_invited: true, wmkf_emailsentat: '2026-07-01T00:00:00Z', wmkf_selected: true,
  wmkf_accepted: false, wmkf_declined: false, wmkf_responsetype: null, wmkf_reviewstatus: null,
  wmkf_reviewreceivedat: null, wmkf_completedat: null, ...over,
});

test.each([
  ['a complete decline → Accepted reopens the engagement', open({ wmkf_declined: true, wmkf_responsetype: 100000001 }), { accepted: true, declined: false, responseType: 'accepted' }, { endedBy: null, endedAt: null }],
  ['an unanswered row corrected to declined: reviewer before accepting', open(), { declined: true, responseType: 'declined' }, { endedBy: 'reviewer_before_accepting', endedAt: NOW }],
  ['an accepted row corrected to declined: reviewer after accepting', open({ wmkf_accepted: true, wmkf_responsetype: 100000000 }), { declined: true }, { endedBy: 'reviewer_after_accepting', endedAt: NOW }],
  ['corrected to no longer needed: Foundation', open(), { responseType: 'withdrawn_sufficient' }, { endedBy: 'foundation', endedAt: NOW }],
  ['corrected to no response: blank', open(), { responseType: 'no_response' }, { endedBy: null, endedAt: null }],
  ['an additive correction leaves the fields alone', open({ wmkf_accepted: true }), { invited: true }, undefined],
  ['an already-ended row is not re-attributed', open({ wmkf_responsetype: 100000002 }), { declined: true }, undefined],
  ['a partial re-accept that was not normalized does not clear', open({ wmkf_declined: true, wmkf_responsetype: 100000001 }), { accepted: true }, undefined],
])('%s', (_label, current, lifecycle, expected) => {
  expect(correctionOutcome(current, lifecycle, NOW)).toEqual(expected);
});

test.each([
  [100000001, 'declined'],
  ['DECLINED', 'declined'],
  [' Withdrawn_Sufficient ', 'withdrawn_sufficient'],
])('normalizeCorrection maps responseType %p to %p', (input, key) => {
  expect(normalizeCorrection(open(), { responseType: input }).responseType).toBe(key);
});

test('normalizeCorrection refuses an unknown response type', () => {
  expect(() => normalizeCorrection(open(), { responseType: 999 })).toThrow('Unknown response type');
});

describe('through correctResponse', () => {
  const run = (lifecycle) => correctResponse({ suggestionId: ID, lifecycle, authorizedRequestId: REQ, actingUserSystemId: 'staff-1' });

  test('a partial re-accept becomes the complete transition and clears Ended by atomically', async () => {
    findById.mockResolvedValue(row({ wmkf_declined: true, wmkf_selected: false, wmkf_responsetype: 100000001, wmkf_endedby: 100000000 }));
    await run({ accepted: true });
    expect(updateLifecycle).toHaveBeenCalledWith(
      ID,
      { accepted: true, declined: false, responseType: 'accepted' },
      expect.objectContaining({ ifMatch: 'W/"4"', outcome: { endedBy: null, endedAt: null } }),
    );
  });

  test.each([
    [{ responseType: 100000001 }, 'reviewer_before_accepting'],
    [{ responseType: 'DECLINED', declined: true }, 'reviewer_before_accepting'],
    [{ responseType: 'Withdrawn_Sufficient' }, 'foundation'],
  ])('alternate representation %p is attributed', async (lifecycle, endedBy) => {
    findById.mockResolvedValue(row());
    await run(lifecycle);
    const [, written, options] = updateLifecycle.mock.calls[0];
    expect(written.responseType).toBe(lifecycle.responseType === 100000001 || /declined/i.test(lifecycle.responseType) ? 'declined' : 'withdrawn_sufficient');
    expect(options.outcome).toMatchObject({ endedBy });
  });

  test('a response-type-only decline is recorded as the complete decline', async () => {
    findById.mockResolvedValue(row());
    await run({ responseType: 'declined' });
    expect(updateLifecycle).toHaveBeenCalledWith(
      ID,
      { responseType: 'declined', declined: true, accepted: false },
      expect.objectContaining({ outcome: { endedBy: 'reviewer_before_accepting', endedAt: expect.any(String) } }),
    );
  });

  test('an unknown response type is refused before any write', async () => {
    findById.mockResolvedValue(row());
    await expect(run({ responseType: 'maybe' })).rejects.toMatchObject({ httpStatus: 400 });
    expect(updateLifecycle).not.toHaveBeenCalled();
  });
});
