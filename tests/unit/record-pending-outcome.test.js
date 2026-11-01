/** @jest-environment node */

const findById = jest.fn();
const applyStaffPendingOutcome = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  applyStaffPendingOutcome: (...a) => applyStaffPendingOutcome(...a),
}));

import { recordPendingOutcome } from '../../lib/services/reviewer-engagement/record-pending-outcome';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SUGGESTION = '22222222-2222-4222-8222-222222222222';
const outcome = { reasonPicklist: 'conflict-of-interest', reasonText: 'Co-author', endedBy: 'foundation' };

function row(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION,
    _wmkf_request_value: REQUEST.toUpperCase(),
    wmkf_invited: true,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    _wmkf_honorariumrequest_value: null,
    _etag: 'W/"9"',
    ...overrides,
  };
}

const call = () => recordPendingOutcome({ requestId: REQUEST, suggestionId: SUGGESTION, outcome, actingUserSystemId: 'staff-1' });

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(row());
  applyStaffPendingOutcome.mockResolvedValue(undefined);
});

test('a still-pending row is written with the ETag from the same read', async () => {
  await expect(call()).resolves.toEqual({ status: 'recorded' });
  expect(applyStaffPendingOutcome).toHaveBeenCalledWith(SUGGESTION, {
    ifMatch: 'W/"9"',
    actingUserSystemId: 'staff-1',
    reasonPicklist: 'conflict-of-interest',
    reasonText: 'Co-author',
    endedBy: 'foundation',
  });
});

test.each([
  ['not_found', null],
  ['not_found', 'throws'],
  ['wrong_request', row({ _wmkf_request_value: '33333333-3333-4333-8333-333333333333' })],
  ['wrong_request', row({ _wmkf_request_value: null })],
  ['not_pending', row({ wmkf_invited: false })],
  ['not_pending', row({ wmkf_accepted: true })],
  ['not_pending', row({ wmkf_declined: true })],
  ['not_pending', row({ wmkf_responsetype: 100000002 })],
  ['honorarium_linked', row({ _wmkf_honorariumrequest_value: '44444444-4444-4444-8444-444444444444' })],
])('%s is returned without a write', async (status, value) => {
  if (value === 'throws') findById.mockRejectedValue(new Error('gone'));
  else findById.mockResolvedValue(value);
  await expect(call()).resolves.toEqual({ status });
  expect(applyStaffPendingOutcome).not.toHaveBeenCalled();
});

test('a reviewer answering between the read and the write is changed_skipped', async () => {
  applyStaffPendingOutcome.mockRejectedValue(Object.assign(new Error('Precondition failed'), { status: 412 }));
  await expect(call()).resolves.toEqual({ status: 'changed_skipped' });
});

test('any other write error propagates', async () => {
  applyStaffPendingOutcome.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
  await expect(call()).rejects.toThrow('boom');
});
