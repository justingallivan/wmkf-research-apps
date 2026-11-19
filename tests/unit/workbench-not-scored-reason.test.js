/** @jest-environment node */
import { getNotScoredReason, saveNotScoredReason } from '../../lib/services/workbench/not-scored-reason-service';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { getMetadataBatch } from '../../lib/dataverse/adapters/metadata';
import { TRIAGE_REASONS, OTHER_TRIAGE_REASON } from '../../shared/config/triageReasons';
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn(), updateById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/metadata', () => ({ getMetadataBatch: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({ linkedCycleCode: r => r.cycleCode, linkedCycleExpand: () => 'cycle' }));
const row = { akoya_requestid: 'request', cycleCode: 'J27', _etag: 'W/"1"', wmkf_phaseistatus: 100000005,
  wmkf_declinereason: 682090000, wmkf_denialnotes: 'Existing note.\nPreserve exactly.' };
const schema = () => [{ OptionSet: { Options: TRIAGE_REASONS.map(o => ({ Value: o.value, Label: { LocalizedLabels: [{ LanguageCode: 1033, Label: o.label }] } })) } }, { MaxLength: 2000 }];
const input = () => ({ requestId: 'request', reason: 682090001, version: row._etag, actor: 'staff', beforeWrite: jest.fn() });
beforeEach(() => { jest.resetAllMocks(); getById.mockResolvedValue(row); getMetadataBatch.mockResolvedValue(schema()); });
it('reads existing notes unchanged and bounds input using live metadata', async () => {
  expect(await getNotScoredReason('request')).toMatchObject({ notes: row.wmkf_denialnotes, reason: row.wmkf_declinereason, editable: true, maxLength: 2000 });
});
it('changes a reason without touching notes or staff rationale', async () => {
  const args = input(); await saveNotScoredReason(args);
  expect(args.beforeWrite).toHaveBeenCalledTimes(1);
  expect(updateById).toHaveBeenCalledWith('request', { wmkf_declinereason: 682090001 }, { ifMatch: row._etag, actingUserSystemId: 'staff', noFallback: true });
});
it('saves Other and notes atomically', async () => {
  await saveNotScoredReason({ ...input(), reason: OTHER_TRIAGE_REASON, notes: 'Updated note' });
  expect(updateById.mock.calls[0][1]).toEqual({ wmkf_declinereason: OTHER_TRIAGE_REASON, wmkf_denialnotes: 'Updated note' });
});
it.each([
  ['unknown option', { reason: 42 }], ['notes on a standard reason', { notes: 'overwrite' }],
  ['empty Other', { reason: OTHER_TRIAGE_REASON, notes: '  ' }],
  ['oversize Other', { reason: OTHER_TRIAGE_REASON, notes: 'x'.repeat(2001) }],
  ['stale version', { version: 'W/"0"' }],
])('rejects %s without a write', async (_label, overrides) => {
  await expect(saveNotScoredReason({ ...input(), ...overrides })).rejects.toThrow();
  expect(updateById).not.toHaveBeenCalled();
});
it('rejects scored proposals even if client bypasses the UI', async () => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: 100000004 });
  await expect(saveNotScoredReason(input())).rejects.toThrow('Not Scored'); expect(updateById).not.toHaveBeenCalled();
});
it('disables unprovisioned choices on read and refuses their writes', async () => {
  const data = schema(); data[0].OptionSet.Options = data[0].OptionSet.Options.filter(o => o.Value !== OTHER_TRIAGE_REASON);
  getMetadataBatch.mockResolvedValue(data);
  expect((await getNotScoredReason('request')).options.find(o => o.value === OTHER_TRIAGE_REASON).available).toBe(false);
  await expect(saveNotScoredReason({ ...input(), reason: OTHER_TRIAGE_REASON, notes: 'Explanation' })).rejects.toThrow('not available');
  expect(updateById).not.toHaveBeenCalled();
});
it('does not repeat a current identical save', async () => {
  await saveNotScoredReason({ ...input(), reason: row.wmkf_declinereason }); expect(updateById).not.toHaveBeenCalled();
});
it('returns conflict after an ETag race without retrying', async () => {
  updateById.mockRejectedValue({ status: 412 });
  await expect(saveNotScoredReason(input())).rejects.toThrow('request changed'); expect(updateById).toHaveBeenCalledTimes(1);
});
