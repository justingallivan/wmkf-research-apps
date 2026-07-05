/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/awardees-service — logic-level
 * tests (adapter mocked), Stage 4 series C extraction. The route suite pins
 * filter shape + envelopes; this pins the service branches: PD-unresolved
 * empty list, per-row deliverable fail-soft, and scope plumbing.
 */

const queryRequests = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryRequests: (...a) => queryRequests(...a),
}));

const resolveByEmail = jest.fn();
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: (...a) => resolveByEmail(...a),
}));

const getDeliverableForRequest = jest.fn();
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: (...a) => getDeliverableForRequest(...a),
}));

import { listGranteeAwardees } from '../../lib/services/workbench/grantee-deliverables/awardees-service';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';

beforeEach(() => {
  jest.clearAllMocks();
  resolveByEmail.mockResolvedValue({ systemuserid: 'pd-me', fullName: 'Justin Gallivan' });
  queryRequests.mockResolvedValue({ records: [] });
  getDeliverableForRequest.mockResolvedValue(null);
});

test('mine-scope with unresolvable PD returns the flagged empty list without querying', async () => {
  resolveByEmail.mockResolvedValue(null);
  const body = await listGranteeAwardees({ cycleCode: 'J26', showAll: false, azureEmail: 'x@wmkeck.org' });
  expect(body).toEqual({
    cycleCode: 'J26', cycleLabel: 'June 2026', count: 0, awardees: [],
    scope: 'mine', pdResolved: false, programDirector: null,
  });
  expect(queryRequests).not.toHaveBeenCalled();
});

test('mine-scope appends the server-resolved PD clause; scope=all omits it and pdResolved is undefined', async () => {
  await listGranteeAwardees({ cycleCode: 'J26', showAll: false, azureEmail: 'x@wmkeck.org' });
  expect(queryRequests.mock.calls[0][0].filter).toContain('_wmkf_programdirector_value eq pd-me');

  const all = await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: 'x@wmkeck.org' });
  expect(queryRequests.mock.calls[1][0].filter).not.toContain('_wmkf_programdirector_value');
  expect(all.scope).toBe('all');
  expect(all.pdResolved).toBeUndefined();
});

test('a per-row deliverable lookup failure is fail-soft (status null), other rows keep their status', async () => {
  queryRequests.mockResolvedValue({ records: [
    { akoya_requestid: 'r1', akoya_requestnum: '1', wmkf_abstractformatted: 'x' },
    { akoya_requestid: 'r2', akoya_requestnum: '2' },
  ] });
  getDeliverableForRequest
    .mockResolvedValueOnce({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED })
    .mockRejectedValueOnce(new Error('lookup down'));
  const body = await listGranteeAwardees({ cycleCode: 'J26', showAll: true, azureEmail: null });
  expect(body.awardees[0]).toMatchObject({ status: GRANTEE_DELIVERABLE_STATUS.DRAFTED, statusLabel: 'Drafted', abstractReady: true });
  expect(body.awardees[1]).toMatchObject({ status: null, statusLabel: null, abstractReady: false });
  expect(body.count).toBe(2);
});
