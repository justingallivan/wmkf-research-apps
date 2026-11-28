/** @jest-environment node */
import { readPrimaryDiscipline, savePrimaryDiscipline } from '../../lib/services/workbench/primary-discipline-service';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { listAll } from '../../lib/dataverse/adapters/keyword';
import { resolvePreviewReadOnly } from '../../lib/services/workbench/preview-read-only';

jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn(), updateById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/keyword', () => ({ listAll: jest.fn(), ENTITY_SET_NAME: 'wmkf_programlevel3s' }));
jest.mock('../../lib/services/workbench/preview-read-only', () => ({ resolvePreviewReadOnly: jest.fn() }));

const requestId = '11111111-1111-1111-1111-111111111111';
const callerSystemId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const GLACIOLOGY = 'e94bd184-a1e3-f111-84ea-6045bd04539e';
const PALEO = 'ea4bd184-a1e3-f111-84ea-6045bd04539e';
const METHOD = '2a41ea86-a7e3-f111-84ea-6045bd04539e';
const keywords = [
  { wmkf_programlevel3id: PALEO, wmkf_name: 'Paleoclimatology', wmkf_keywordtype: 682090000, wmkf_keyworddisciplinegroup_formatted: 'Earth and Environmental Sciences' },
  { wmkf_programlevel3id: GLACIOLOGY.toUpperCase(), wmkf_name: 'Glaciology and Cryospheric Science', wmkf_keywordtype: 682090000, wmkf_keyworddisciplinegroup_formatted: 'Earth and Environmental Sciences' },
  { wmkf_programlevel3id: METHOD, wmkf_name: 'Instrument development', wmkf_keywordtype: 682090001 },
];
const row = { akoya_requestid: requestId, _wmkf_programareaserved_value: GLACIOLOGY, _wmkf_programareaserved_value_formatted: 'Glaciology and Cryospheric Science', _etag: 'W/"5"' };
const original = process.env.DYNAMICS_IMPERSONATION_ENABLED;
afterAll(() => { if (original === undefined) delete process.env.DYNAMICS_IMPERSONATION_ENABLED; else process.env.DYNAMICS_IMPERSONATION_ENABLED = original; });
beforeEach(() => {
  jest.resetAllMocks();
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
  getById.mockResolvedValue({ ...row });
  listAll.mockResolvedValue({ records: keywords, capped: false });
  resolvePreviewReadOnly.mockReturnValue(false);
});

test('reads the current discipline and only Discipline keywords, sorted, without writing', async () => {
  const result = await readPrimaryDiscipline({ requestId, callerSystemId });
  expect(result).toMatchObject({ version: 'W/"5"', canEdit: true, current: { id: GLACIOLOGY, name: 'Glaciology and Cryospheric Science' } });
  expect(result.options.map((option) => option.name)).toEqual(['Glaciology and Cryospheric Science', 'Paleoclimatology']);
  expect(getById).toHaveBeenCalledWith(requestId, { select: 'akoya_requestid,_wmkf_programareaserved_value' });
  expect(updateById).not.toHaveBeenCalled();
});

test('saves by binding only the discipline lookup, with the ETag and the caller as actor', async () => {
  await savePrimaryDiscipline({ requestId, callerSystemId, version: 'W/"5"', disciplineId: PALEO.toUpperCase() });
  expect(updateById).toHaveBeenCalledWith(requestId, { 'wmkf_ProgramAreaServed@odata.bind': `/wmkf_programlevel3s(${PALEO})` },
    { ifMatch: 'W/"5"', actingUserSystemId: callerSystemId, noFallback: true });
});

test('an unchanged choice does not write', async () => {
  await savePrimaryDiscipline({ requestId, callerSystemId, version: 'W/"5"', disciplineId: GLACIOLOGY });
  expect(updateById).not.toHaveBeenCalled();
});

test.each([[METHOD, 'a Method keyword'], ['99999999-9999-9999-9999-999999999999', 'an unknown id'], ['not-a-guid', 'a malformed id']])('refuses %s (%s)', async (disciplineId) => {
  await expect(savePrimaryDiscipline({ requestId, callerSystemId, version: 'W/"5"', disciplineId })).rejects.toMatchObject({ httpStatus: 400 });
  expect(updateById).not.toHaveBeenCalled();
});

test.each(['*', '', null, 'W/"x"'])('refuses a non-concrete version %s', async (version) => {
  await expect(savePrimaryDiscipline({ requestId, callerSystemId, version, disciplineId: PALEO })).rejects.toMatchObject({ httpStatus: 400 });
});

test('a stale version or a racing write is a conflict, without retry', async () => {
  await expect(savePrimaryDiscipline({ requestId, callerSystemId, version: 'W/"4"', disciplineId: PALEO })).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).not.toHaveBeenCalled();
  updateById.mockRejectedValueOnce({ status: 412 });
  await expect(savePrimaryDiscipline({ requestId, callerSystemId, version: 'W/"5"', disciplineId: PALEO })).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).toHaveBeenCalledTimes(1);
});

test('no linked identity, read-only Preview, or impersonation off cannot write', async () => {
  await expect(savePrimaryDiscipline({ requestId, callerSystemId: null, version: 'W/"5"', disciplineId: PALEO })).rejects.toMatchObject({ httpStatus: 403 });
  resolvePreviewReadOnly.mockReturnValue(true);
  await expect(savePrimaryDiscipline({ requestId, callerSystemId, version: 'W/"5"', disciplineId: PALEO })).rejects.toMatchObject({ httpStatus: 403 });
  resolvePreviewReadOnly.mockReturnValue(false);
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false';
  await expect(savePrimaryDiscipline({ requestId, callerSystemId, version: 'W/"5"', disciplineId: PALEO })).rejects.toMatchObject({ httpStatus: 403 });
  expect((await readPrimaryDiscipline({ requestId, callerSystemId })).canEdit).toBe(false);
  expect(updateById).not.toHaveBeenCalled();
});

test('an incomplete keyword list fails rather than offering a partial list', async () => {
  listAll.mockResolvedValue({ records: keywords, capped: true });
  await expect(readPrimaryDiscipline({ requestId, callerSystemId })).rejects.toThrow('incomplete');
});
