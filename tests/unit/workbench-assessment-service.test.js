/** @jest-environment node */
import { getAssessment, saveAssessment } from '../../lib/services/workbench/assessment-service';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { getReasonMetadata } from '../../lib/services/workbench/not-scored-reason-service';
import { getUserRole } from '../../lib/utils/auth';
import { TRIAGE_REASONS, OTHER_TRIAGE_REASON } from '../../shared/config/triageReasons';
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn(), updateById: jest.fn() }));
jest.mock('../../lib/services/workbench/not-scored-reason-service', () => ({ getReasonMetadata: jest.fn() }));
jest.mock('../../lib/utils/auth', () => ({ getUserRole: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({ linkedCycleCode: r => r.cycleCode, linkedCycleExpand: () => 'cycle' }));
const row = { akoya_requestid: 'request', cycleCode: 'J27', _etag: 'W/"1"', wmkf_phaseistatus: null,
  _wmkf_programdirector_value: 'lead', wmkf_initialassessmentrationale: 'Saved rationale', wmkf_declinereason: 682090000, wmkf_denialnotes: 'Existing notes' };
const input = () => ({ requestId: 'request', decision: 'no', reason: 682090001, version: row._etag, actor: 'lead', profileId: 'profile', beforeWrite: jest.fn() });
beforeEach(() => {
  jest.resetAllMocks(); getById.mockResolvedValue(row); getUserRole.mockResolvedValue('staff');
  getReasonMetadata.mockResolvedValue({ options: TRIAGE_REASONS.map(o => ({ ...o, available: true })), maxLength: 2000 });
});
it('preloads both saved branches in one request read', async () => {
  expect(await getAssessment('request')).toMatchObject({ rationale: 'Saved rationale', notes: 'Existing notes', reason: 682090000, decision: '', decisionEditable: true });
  expect(getById).toHaveBeenCalledTimes(1);
});
it('saves decision and standard reason in exactly one conditional write, preserving both text fields', async () => {
  const args = input(); await saveAssessment(args);
  expect(updateById).toHaveBeenCalledTimes(1);
  expect(updateById).toHaveBeenCalledWith('request', { wmkf_phaseistatus: 100000005, wmkf_declinereason: 682090001 }, { ifMatch: row._etag, actingUserSystemId: 'lead', noFallback: true });
  expect(args.beforeWrite).toHaveBeenCalledTimes(1);
});
it('writes Other notes with decision and reason atomically', async () => {
  await saveAssessment({ ...input(), reason: OTHER_TRIAGE_REASON, notes: ' New notes\n' });
  expect(updateById).toHaveBeenCalledTimes(1);
  expect(updateById.mock.calls[0][1]).toEqual({ wmkf_phaseistatus: 100000005, wmkf_declinereason: OTHER_TRIAGE_REASON, wmkf_denialnotes: ' New notes\n' });
});
it('writes Scored and rationale without clearing the prior decline reason or notes', async () => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: 100000005 });
  await saveAssessment({ ...input(), decision: 'yes', reason: undefined, rationale: ' Revised rationale ' });
  expect(updateById.mock.calls[0][1]).toEqual({ wmkf_phaseistatus: 100000004, wmkf_initialassessmentrationale: 'Revised rationale' });
});
it('allows staff to edit details without permission to change the decision', async () => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: 100000005 });
  await saveAssessment({ ...input(), actor: 'other-staff' });
  expect(updateById.mock.calls[0][1]).toEqual({ wmkf_declinereason: 682090001 });
});
it('allows a superuser to change the decision', async () => {
  getUserRole.mockResolvedValue('superuser');
  await saveAssessment({ ...input(), actor: 'admin' }); expect(updateById).toHaveBeenCalledTimes(1);
});
it('preserves advanced status while staff edits scored rationale', async () => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: 707510005 });
  await saveAssessment({ ...input(), decision: 'yes', actor: 'staff', reason: undefined, rationale: 'Revised' });
  expect(updateById.mock.calls[0][1]).toEqual({ wmkf_initialassessmentrationale: 'Revised' });
});
it.each([
  ['unauthorized status change', { actor: 'other-staff' }], ['unknown decision', { decision: 'maybe' }],
  ['unavailable reason', { reason: 42 }], ['stale version', { version: 'W/"0"' }],
  ['notes on standard reason', { notes: 'erase' }], ['rationale on Not Scored', { rationale: 'erase' }],
  ['blank Other', { reason: OTHER_TRIAGE_REASON, notes: ' ' }], ['oversize Other', { reason: OTHER_TRIAGE_REASON, notes: 'a'.repeat(2001) }],
  ['oversize rationale', { decision: 'yes', reason: undefined, rationale: 'a'.repeat(10001) }],
])('rejects %s without any write', async (_name, overrides) => {
  await expect(saveAssessment({ ...input(), ...overrides })).rejects.toThrow(); expect(updateById).not.toHaveBeenCalled();
});
it.each([707510005, 999])('does not reopen closed or unknown status %s', async status => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: status });
  await expect(saveAssessment(input())).rejects.toThrow('closed'); expect(updateById).not.toHaveBeenCalled();
});
it('respects the admission recheck and ETag race', async () => {
  await expect(saveAssessment({ ...input(), beforeWrite: async () => { throw new Error('Admission changed'); } })).rejects.toThrow('Admission');
  expect(updateById).not.toHaveBeenCalled();
  updateById.mockRejectedValue({ status: 412 });
  await expect(saveAssessment(input())).rejects.toThrow('request changed'); expect(updateById).toHaveBeenCalledTimes(1);
});
it('does not write an identical assessment again', async () => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: 100000005 });
  await saveAssessment({ ...input(), reason: row.wmkf_declinereason }); expect(updateById).not.toHaveBeenCalled();
});
