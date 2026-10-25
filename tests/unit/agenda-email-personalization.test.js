/** @jest-environment node */
import { validateAgendaTemplate, resolveAgendaTemplate } from '../../shared/config/agendaEmail';
import { getAgendaPreferences, ownAgendaTemplate, saveAgendaPreference, clearAgendaPreference } from '../../lib/services/meeting-tracker/agenda-personalization';
const OWNER = '33333333-3333-4333-8333-333333333333';
function fixture(values = []) {
  let rows = values.map((template, i) => ({ wmkf_appuserpreferenceid: `id-${i}`, wmkf_preferencevalue: JSON.stringify(template) }));
  const deps = {
    getSettingStrict: jest.fn(async (key) => ({ found: true, value: key.endsWith('subject') ? 'Shared {{sessionDate}}' : null })),
    listByOwnerAndKey: jest.fn(async () => rows),
    create: jest.fn(async (body) => { rows.push({ ...body, wmkf_appuserpreferenceid: 'new' }); }),
    update: jest.fn(async (id, body) => { rows = rows.map((r) => r.wmkf_appuserpreferenceid === id ? { ...r, ...body } : r); }),
    remove: jest.fn(async (id) => { rows = rows.filter((r) => r.wmkf_appuserpreferenceid !== id); }),
  };
  return deps;
}
test.each(['', '   ', '{{sessionDate}}'])('optional opening %p survives Save and exact readback', async (body) => {
  const deps = fixture(); const template = { subject: 'My {{sessionDate}}', body };
  expect(await saveAgendaPreference(OWNER, template, deps)).toEqual({ ok: true });
  expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({ 'ownerid@odata.bind': `/systemusers(${OWNER})`, wmkf_preferencekey: 'meeting_agenda_template' }));
  expect((await getAgendaPreferences(OWNER, deps)).template).toEqual(template);
  expect(deps.listByOwnerAndKey).toHaveBeenCalledWith(OWNER, 'meeting_agenda_template');
});
test('own configured pair wins despite shared failure; absent uses null-stored empty shared body', async () => {
  const deps = fixture([{ subject: 'Own', body: '' }]); deps.getSettingStrict.mockRejectedValue(Error('offline'));
  expect((await getAgendaPreferences(OWNER, deps)).defaults).toMatchObject({ source: 'personal', message: '', sharedStatus: 'unavailable' });
  expect((await getAgendaPreferences(OWNER, fixture())).defaults).toMatchObject({ source: 'shared', message: '', sharedStatus: 'available' });
});
test('duplicates are invalid; Clear removes all exact matches and confirms absence', async () => {
  const deps = fixture([{ subject: 'One', body: '' }, { subject: 'Two', body: '' }]);
  expect(await ownAgendaTemplate(OWNER, deps)).toMatchObject({ status: 'invalid' });
  expect(await saveAgendaPreference(OWNER, { subject: 'No silent choice', body: '' }, deps)).toMatchObject({ reason: 'preference_invalid' });
  expect(deps.update).not.toHaveBeenCalled();
  expect(await clearAgendaPreference(OWNER, deps)).toEqual({ ok: true }); expect(deps.remove).toHaveBeenCalledTimes(2);
  expect((await ownAgendaTemplate(OWNER, deps)).status).toBe('absent');
});
test('partial Clear and uncertain Save do not report success or repair other data', async () => {
  const deps = fixture([{ subject: 'One', body: '' }, { subject: 'Two', body: '' }]);
  deps.remove.mockRejectedValueOnce(Error('failed'));
  expect(await clearAgendaPreference(OWNER, deps)).toMatchObject({ ok: false, reason: 'persistence_unconfirmed', removed: [] });
  const save = fixture(); save.create.mockResolvedValue(undefined);
  expect(await saveAgendaPreference(OWNER, { subject: 'Lost', body: '' }, save)).toMatchObject({ ok: false, reason: 'persistence_unconfirmed' });
});
test.each(['{{unknown}}','{{{sessionDate}}}','{{sessionDate}','{{sessionDate}}}','{{sessionDate}}{{bad}}'])('rejects unknown or malformed %s', (subject) => {
  expect(validateAgendaTemplate({ subject, body: '' }).valid).toBe(false);
});
test('raw and expanded bounds; dates resolve in snapshot zone without losing templates', () => {
  const template = { subject: '{{sessionDate}}', body: '   ' };
  const snapshot = { scheduledStartIso: '2026-10-26T01:00:00Z', ianaTimeZone: 'America/Los_Angeles' };
  expect(resolveAgendaTemplate(template, snapshot).value).toEqual({ subject: 'Sunday, October 25', body: '' });
  expect(template.subject).toBe('{{sessionDate}}');
  expect(validateAgendaTemplate({ subject: 'x'.repeat(501), body: '' }).valid).toBe(false);
  expect(resolveAgendaTemplate({ subject: '{{sessionDate}}'.repeat(33), body: '' }, snapshot).valid).toBe(false);
});
test('unlinked identity never reads personal rows; invalid shared pair does not partially populate', async () => {
  const deps = fixture(); deps.getSettingStrict.mockResolvedValueOnce({ found: true, value: 'Bad {{bad}}' }).mockResolvedValueOnce({ found: true, value: 'Opening' });
  const data = await getAgendaPreferences(null, deps);
  expect(deps.listByOwnerAndKey).not.toHaveBeenCalled();
  expect(data.defaults).toMatchObject({ source: 'empty', subject: '', message: '', personalStatus: 'identity_unavailable', sharedStatus: 'shared_invalid' });
});
