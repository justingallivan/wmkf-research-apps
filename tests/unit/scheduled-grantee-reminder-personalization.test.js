/** @jest-environment node */
import { ownScheduledGranteeReminderTemplate as own, getScheduledGranteeReminderPreferences as get, saveScheduledGranteeReminderPreference as save, clearScheduledGranteeReminderPreference as clear } from '../../lib/services/scheduled-grantee-reminder-personalization';
import { validateScheduledGranteeReminderTemplate as validate } from '../../shared/config/scheduledGranteeReminderEmail';
import { buildGranteeReminderDraftBodyText, composeScheduledGranteeReminderBodyText, renderGranteeInviteHtml } from '../../lib/external/grantee-invite-email';
jest.mock('../../lib/services/settings-service', () => ({ getSettingStrict: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/user-preference', () => ({}));
const OWNER = 'abcdefab-1111-4111-8111-111111111111';
const KEY = 'scheduled_grantee_reminder_template';
const pair = { subject: 'Reminder', body: 'Dear {{granteeName}}, please review {{proposalTitle}} by COB {{dueDate}}.\n{{signature}}' };
const row = (value = pair, extra = {}) => ({ wmkf_appuserpreferenceid: 'row1', wmkf_preferencevalue: JSON.stringify(value), ...extra });
let deps;
beforeEach(() => { deps = { listByOwnerAndKey: jest.fn().mockResolvedValue([]), getSettingStrict: jest.fn().mockResolvedValue({ found: false }), create: jest.fn(), update: jest.fn(), remove: jest.fn() }; });
test.each([null, [], {}, { ...pair, owner: OWNER }, { ...pair, subject: '' }, { ...pair, subject: 'a\nb' }, { ...pair, subject: 'x'.repeat(301) }, { ...pair, subject: '{{proposalTitle}}' }, { ...pair, body: '' }, { ...pair, body: 'short' }, { ...pair, body: 'x'.repeat(20001) }, ...['{{other}}', '{{{dueDate}}}', '{{ dueDate }}', '{', '}', '[Name]', '[title]', 'COB [date]', '[Program Director signature]'].map(token => ({ ...pair, body: `${pair.body} ${token}` }))])('rejects invalid raw template %p', value => expect(validate(value).valid).toBe(false));
test.each(['granteeName', 'proposalTitle', 'dueDate'])('requires %s token', name => expect(validate({ ...pair, body: pair.body.replace(`{{${name}}}`, '') }).valid).toBe(false));
test('normalizes, supports ordinary brackets, and accepts exact limits', () => {
  expect(validate({ subject: ' Reminder ', body: ` ${pair.body} [ordinary] ` }).value).toEqual({ subject: 'Reminder', body: `${pair.body} [ordinary]` });
  expect(validate({ subject: 'x'.repeat(300), body: pair.body.padEnd(20000, 'x') }).valid).toBe(true);
});
test('renderer preserves surname/deadline, removes signature slot, escapes text and appends signature/link/notice once', () => {
  const draft = buildGranteeReminderDraftBodyText({ bodyTemplate: pair.body, piName: 'Professor Ada Lovelace', title: '<Award>', invitedDate: '2026-10-01' });
  expect(draft).toContain('Dear Lovelace'); expect(draft).toContain('COB October 15, 2026'); expect(draft).not.toContain('{{');
  const body = composeScheduledGranteeReminderBodyText({ bodyText: draft, signatureText: 'PD signature' });
  const html = renderGranteeInviteHtml({ bodyText: body, url: 'https://example.org/secure', automationNotice: { senderName: 'PD', senderEmail: 'pd@example.org', kind: 'reminder' } });
  expect(html).toContain('&lt;Award&gt;'); expect(html.match(/PD signature/g)).toHaveLength(1); expect(html).toContain('Open the Grantee Portal'); expect(html).toContain('on behalf of PD');
});
test.each([[[], 'absent'], [[row()], 'configured'], [[row(), row()], 'duplicates'], [[row(pair, { wmkf_isencrypted: true })], 'encrypted'], [[row({})], 'invalid'], [[row(pair, { wmkf_preferencevalue: '{bad' })], 'invalid']])('strict read identifies %s as %s', async (rows, status) => {
  deps.listByOwnerAndKey.mockResolvedValue(rows); expect((await own(OWNER.toUpperCase(), deps)).status).toBe(status);
  expect(deps.listByOwnerAndKey).toHaveBeenCalledWith(OWNER, KEY);
});
test('enumeration failure/cap is unavailable; invalid identity never enumerates', async () => {
  deps.listByOwnerAndKey.mockRejectedValue(new Error('enumeration incomplete'));
  expect((await own(OWNER, deps)).status).toBe('unavailable'); deps.listByOwnerAndKey.mockClear();
  expect((await own('not-guid', deps)).status).toBe('identity_unavailable'); expect(deps.listByOwnerAndKey).not.toHaveBeenCalled();
});
test('configured personal pair survives shared outage without writes', async () => {
  deps.listByOwnerAndKey.mockResolvedValue([row()]); deps.getSettingStrict.mockRejectedValue(new Error('offline'));
  expect(await get(OWNER, deps)).toMatchObject({ ownerSystemId: OWNER, ownStatus: 'configured', source: 'personal', effective: pair, sharedStatus: 'unavailable' });
  expect(deps.create).not.toHaveBeenCalled(); expect(deps.update).not.toHaveBeenCalled();
});
test('confirmed absence uses shared legacy copy without personal validation; incomplete shared pair is not effective', async () => {
  deps.getSettingStrict.mockImplementation(async key => ({ found: true, value: key.endsWith('subject') ? 'Shared {{literal}}' : 'Dear [Name], old body' }));
  expect(await get(OWNER, deps)).toMatchObject({ source: 'shared', ownStatus: 'absent', effective: { subject: 'Shared {{literal}}', body: 'Dear [Name], old body' } });
  deps.getSettingStrict.mockResolvedValue({ found: false }); expect((await get(OWNER, deps)).effective).toBeNull();
});
test('Save creates exact owner/key and confirms exact normalized readback', async () => {
  deps.listByOwnerAndKey.mockResolvedValueOnce([]).mockResolvedValueOnce([row()]);
  expect(await save(OWNER.toUpperCase(), pair, deps)).toEqual({ ok: true });
  expect(deps.create).toHaveBeenCalledWith({ 'ownerid@odata.bind': `/systemusers(${OWNER})`, wmkf_preferencekey: KEY, wmkf_preferencevalue: JSON.stringify(pair), wmkf_isencrypted: false });
});
test.each(['lost', 'different', 'duplicate', 'create'])('Save does not confirm %s persistence', async kind => {
  deps.listByOwnerAndKey.mockResolvedValueOnce([]);
  if (kind === 'lost') deps.listByOwnerAndKey.mockRejectedValueOnce(new Error('lost'));
  else deps.listByOwnerAndKey.mockResolvedValueOnce(kind === 'duplicate' ? [row(), row()] : [row({ ...pair, subject: 'other' })]);
  if (kind === 'create') deps.create.mockRejectedValueOnce(new Error('lost'));
  expect((await save(OWNER, pair, deps)).reason).toBe('persistence_unconfirmed');
});
test('duplicates require Clear; invalid single row can be repaired; update failure remains unconfirmed', async () => {
  deps.listByOwnerAndKey.mockResolvedValue([row(), row()]); expect((await save(OWNER, pair, deps)).reason).toBe('duplicates'); expect(deps.update).not.toHaveBeenCalled();
  deps.listByOwnerAndKey.mockResolvedValueOnce([row({})]).mockResolvedValueOnce([row()]); expect((await save(OWNER, pair, deps)).ok).toBe(true);
  deps.update.mockRejectedValueOnce(new Error('lost')); deps.listByOwnerAndKey.mockResolvedValue([row()]); expect((await save(OWNER, pair, deps)).reason).toBe('persistence_unconfirmed');
});
test('Clear removes duplicates only for exact owner/key, confirms absence and preserves actual foreign rows', async () => {
  let rows = [{ ...row(), owner: OWNER, key: KEY }, { ...row(pair, { wmkf_appuserpreferenceid: 'row2' }), owner: OWNER, key: KEY }, { ...row(pair, { wmkf_appuserpreferenceid: 'foreign-owner' }), owner: 'other', key: KEY }, { ...row(pair, { wmkf_appuserpreferenceid: 'foreign-key' }), owner: OWNER, key: 'other' }];
  deps.listByOwnerAndKey.mockImplementation(async (owner, key) => rows.filter(r => r.owner === owner && r.key === key));
  deps.remove.mockImplementation(async id => { rows = rows.filter(r => r.wmkf_appuserpreferenceid !== id); });
  expect((await clear(OWNER, deps)).ok).toBe(true); expect(rows.map(r => r.wmkf_appuserpreferenceid)).toEqual(['foreign-owner', 'foreign-key']);
  expect((await clear(OWNER, deps)).ok).toBe(true);
});
test('partial Clear and failed absence readback are not success', async () => {
  deps.listByOwnerAndKey.mockResolvedValue([row(), row(pair, { wmkf_appuserpreferenceid: 'row2' })]);
  deps.remove.mockResolvedValueOnce().mockRejectedValueOnce(new Error('lost'));
  expect((await clear(OWNER, deps)).reason).toBe('persistence_unconfirmed');
  deps.listByOwnerAndKey.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('capped'));
  expect((await clear(OWNER, deps)).reason).toBe('persistence_unconfirmed');
});

test.each([save, clear])('an initial enumeration failure is unavailable with no mutation attempted', async action => {
  deps.listByOwnerAndKey.mockRejectedValue(new Error('offline'));
  const result = action === save ? await save(OWNER, pair, deps) : await clear(OWNER, deps);
  expect(result).toEqual({ ok: false, reason: 'preference_unavailable' }); expect(deps.create).not.toHaveBeenCalled(); expect(deps.update).not.toHaveBeenCalled(); expect(deps.remove).not.toHaveBeenCalled();
});
