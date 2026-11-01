/** @jest-environment node */
import { ownDistributionTemplate, getDistributionPreferences, saveDistributionPreference, clearDistributionPreference } from '../../lib/services/pre-site-visit/distribution-personalization';
import { validateDeliberationShareTemplate, renderDeliberationShareSubject } from '../../shared/config/deliberationShareEmail';
jest.mock('../../lib/services/settings-service', () => ({ getSettingStrict: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/user-preference', () => ({}));
const OWNER = '11111111-1111-4111-8111-111111111111';
const template = { subject: 'Brief {{requestNumber}}', body: 'Please read the briefing.' };
const row = (value = template, extra = {}) => ({ wmkf_appuserpreferenceid: 'row1', wmkf_preferencevalue: JSON.stringify(value), ...extra });
let deps;
beforeEach(() => { deps = { listByOwnerAndKey: jest.fn().mockResolvedValue([]), getSettingStrict: jest.fn().mockResolvedValue({ found: false }), create: jest.fn(), update: jest.fn(), remove: jest.fn() }; });
test.each([null, [], {}, { ...template, owner: OWNER }, { subject: '', body: 'x' }, { subject: 'x', body: '' }, { subject: 'x\ny', body: 'x' }, { subject: 'x'.repeat(501), body: 'x' }, { subject: 'x', body: 'x'.repeat(20001) }, { subject: '{{other}}', body: 'x' }, { subject: '{{{requestNumber}}}', body: 'x' }, { subject: '{{requestNumber}', body: 'x' }, { subject: 'x', body: '{{requestNumber}}' }])('rejects invalid raw pair %p', input => expect(validateDeliberationShareTemplate(input).valid).toBe(false));
test('raw token is reusable across requests, exact maxima accepted', () => {
  expect(validateDeliberationShareTemplate(template).value).toEqual(template);
  expect(renderDeliberationShareSubject(template.subject, 'A')).toBe('Brief A');
  expect(renderDeliberationShareSubject(template.subject, 'B')).toBe('Brief B');
  expect(validateDeliberationShareTemplate({ subject: 'x'.repeat(500), body: 'x'.repeat(20000) }).valid).toBe(true);
});
test.each([[[], 'absent'], [[row()], 'configured'], [[row(), row()], 'duplicates'], [[row(template, { wmkf_isencrypted: true })], 'encrypted'], [[row({ subject: 'bad' })], 'invalid']])('strict read %p -> %s', async (rows, status) => {
  deps.listByOwnerAndKey.mockResolvedValue(rows);
  expect((await ownDistributionTemplate(OWNER, deps)).status).toBe(status);
  expect(deps.listByOwnerAndKey).toHaveBeenCalledWith(OWNER, 'deliberation_share_template');
});
test('failure is unavailable, missing identity does not enumerate', async () => {
  deps.listByOwnerAndKey.mockRejectedValue(new Error('offline'));
  expect((await ownDistributionTemplate(OWNER, deps)).status).toBe('unavailable');
  deps.listByOwnerAndKey.mockClear();
  expect((await ownDistributionTemplate(null, deps)).status).toBe('identity_unavailable');
  expect(deps.listByOwnerAndKey).not.toHaveBeenCalled();
});
test('personal pair survives shared outage; fallback never writes', async () => {
  deps.listByOwnerAndKey.mockResolvedValue([row()]); deps.getSettingStrict.mockRejectedValue(new Error('offline'));
  const data = await getDistributionPreferences(OWNER, deps);
  expect(data).toMatchObject({ effective: template, source: 'personal', configured: true, sharedStatus: { subject: 'unavailable', body: 'unavailable' } });
  expect(deps.create).not.toHaveBeenCalled(); expect(deps.update).not.toHaveBeenCalled();
});
test('saved personal wording wins over updated shared defaults without rewriting either layer', async () => {
  const saved = { subject: 'Site Visit materials — {{requestNumber}}', body: 'The deliberation briefing page is ready.' };
  deps.listByOwnerAndKey.mockResolvedValue([row(saved)]);
  deps.getSettingStrict.mockImplementation(async (key) => ({
    found: true,
    value: key.endsWith('.subject') ? 'Proposal review packet — {{requestNumber}}' : 'The proposal review packet is ready.',
  }));
  const data = await getDistributionPreferences(OWNER, deps);
  expect(data).toMatchObject({
    own: saved,
    shared: { subject: 'Proposal review packet — {{requestNumber}}', body: 'The proposal review packet is ready.' },
    effective: saved,
    source: 'personal',
  });
  expect(deps.update).not.toHaveBeenCalled();
  expect(deps.create).not.toHaveBeenCalled();
});
test('partial shared pair uses per-field built-in fallback and no briefing reads', async () => {
  deps.getSettingStrict.mockImplementation(async key => key.endsWith('.subject') ? { found: true, value: 'Shared' } : { found: true, value: '' });
  const data = await getDistributionPreferences(OWNER, deps);
  expect(data).toMatchObject({ source: 'shared', effective: { subject: 'Shared' }, sharedStatus: { subject: 'available', body: 'missing' } });
  expect(deps.getSettingStrict).toHaveBeenCalledTimes(2); expect(data.effective.body).not.toBe('');
});
test('Save creates exact-owner pair and requires exact raw readback', async () => {
  deps.listByOwnerAndKey.mockResolvedValueOnce([]).mockResolvedValueOnce([row()]);
  expect(await saveDistributionPreference(OWNER, template, deps)).toEqual({ ok: true });
  expect(deps.create).toHaveBeenCalledWith({ 'ownerid@odata.bind': `/systemusers(${OWNER})`, wmkf_preferencekey: 'deliberation_share_template', wmkf_preferencevalue: JSON.stringify(template), wmkf_isencrypted: false });
});
test.each(['duplicate', 'lost', 'different'])('Save never confirms %s readback', async kind => {
  deps.listByOwnerAndKey.mockResolvedValueOnce([]);
  if (kind === 'lost') deps.listByOwnerAndKey.mockRejectedValueOnce(new Error('lost'));
  else deps.listByOwnerAndKey.mockResolvedValueOnce(kind === 'duplicate' ? [row(), row()] : [row({ ...template, body: 'Other' })]);
  expect(await saveDistributionPreference(OWNER, template, deps)).toEqual({ ok: false, reason: 'persistence_unconfirmed' });
  expect(deps.create).toHaveBeenCalledTimes(1);
});
test('duplicate rows require Clear before Save; invalid single can be replaced', async () => {
  deps.listByOwnerAndKey.mockResolvedValue([row(), row()]);
  expect((await saveDistributionPreference(OWNER, template, deps)).reason).toBe('duplicates'); expect(deps.update).not.toHaveBeenCalled();
  deps.listByOwnerAndKey.mockResolvedValueOnce([row({})]).mockResolvedValueOnce([row()]);
  expect((await saveDistributionPreference(OWNER, template, deps)).ok).toBe(true); expect(deps.update).toHaveBeenCalledWith('row1', expect.any(Object));
});
test('Clear verifies absence, partial failure is unconfirmed, repeated empty Clear succeeds', async () => {
  deps.listByOwnerAndKey.mockResolvedValueOnce([row(), row(template, { wmkf_appuserpreferenceid: 'row2' })]).mockResolvedValueOnce([]);
  expect((await clearDistributionPreference(OWNER, deps)).ok).toBe(true); expect(deps.remove.mock.calls).toEqual([['row1'], ['row2']]);
  deps.listByOwnerAndKey.mockResolvedValue([row()]); deps.remove.mockRejectedValueOnce(new Error('partial'));
  expect((await clearDistributionPreference(OWNER, deps)).ok).toBe(false);
  deps.listByOwnerAndKey.mockResolvedValue([]); expect((await clearDistributionPreference(OWNER, deps)).ok).toBe(true);
});
