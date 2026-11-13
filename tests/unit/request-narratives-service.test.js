/** @jest-environment node */
import { readRequestNarratives, saveRequestNarratives } from '../../lib/services/workbench/request-narratives-service';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { getUserRole } from '../../lib/utils/auth';
import { resolvePreviewReadOnly } from '../../lib/services/workbench/preview-read-only';
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn(), updateById: jest.fn() }));
jest.mock('../../lib/utils/auth', () => ({ getUserRole: jest.fn() }));
jest.mock('../../lib/services/workbench/preview-read-only', () => ({ resolvePreviewReadOnly: jest.fn() }));
const requestId = '11111111-1111-1111-1111-111111111111';
const callerSystemId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const input = { requestId, callerSystemId, profileId: 7, version: 'W/"123"', changes: { lay_abstract: 'Edited by staff' } };
const row = { akoya_requestid: requestId, _wmkf_programdirector_value: callerSystemId.toUpperCase(),
  _etag: input.version, wmkf_layabstract: 'From Power Automate', wmkf_initialassessment: 'Keep this human edit' };
const originalImpersonation = process.env.DYNAMICS_IMPERSONATION_ENABLED;
afterAll(() => { if (originalImpersonation === undefined) delete process.env.DYNAMICS_IMPERSONATION_ENABLED; else process.env.DYNAMICS_IMPERSONATION_ENABLED = originalImpersonation; });
beforeEach(() => { process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true'; jest.resetAllMocks(); getById.mockResolvedValue({ ...row }); getUserRole.mockResolvedValue('read_only'); });
test('reads Executive Summary under the stable API key without writing or generating', async () => {
  expect(await readRequestNarratives(input)).toMatchObject({ lay_abstract: row.wmkf_layabstract,
    version: input.version, canEdit: true });
  expect(updateById).not.toHaveBeenCalled();
});
test('saves only supplied changed fields, with concrete ETag and trusted actor', async () => {
  await saveRequestNarratives(input);
  expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_layabstract: 'Edited by staff' },
    { ifMatch: input.version, actingUserSystemId: callerSystemId, noFallback: true });
});
test('Executive Summary persists and reads back verbatim, including Unicode/newlines', async () => {
  updateById.mockImplementation(async (_, patch) => Object.assign(row, patch));
  const changes = { lay_abstract: '  A\nβ  ' };
  await saveRequestNarratives({ ...input, changes });
  getById.mockResolvedValue(row);
  expect(await readRequestNarratives(input)).toMatchObject(changes);
});
test.each(['', null])('intentional clearing writes null: %s', async value => {
  await saveRequestNarratives({ ...input, changes: { lay_abstract: value } });
  expect(updateById.mock.calls[0][1]).toEqual({ wmkf_layabstract: null });
});
test('unchanged save skips writes', async () => {
  await saveRequestNarratives({ ...input, changes: { lay_abstract: row.wmkf_layabstract } });
  expect(updateById).not.toHaveBeenCalled();
});
test.each([{}, [], null, { other: 'bad' }, { lay_abstract: 4 }, { lay_abstract: {} }, { lay_abstract: 'x'.repeat(100001) }])('rejects malformed changes %#', async changes => {
  await expect(saveRequestNarratives({ ...input, changes })).rejects.toMatchObject({ httpStatus: 400 });
  expect(updateById).not.toHaveBeenCalled();
});
test.each(['*', '', null, 'W/"x"'])('rejects non-concrete version %s', async version => {
  await expect(saveRequestNarratives({ ...input, version })).rejects.toMatchObject({ httpStatus: 400 });
  expect(updateById).not.toHaveBeenCalled();
});
test('rejects stale form and racing PATCH, without retry', async () => {
  await expect(saveRequestNarratives({ ...input, version: 'W/"122"' })).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).not.toHaveBeenCalled();
  updateById.mockRejectedValue({ status: 412 });
  await expect(saveRequestNarratives(input)).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).toHaveBeenCalledTimes(1);
});
test('ordinary staff may read but cannot write another PD request; linked superuser may', async () => {
  getById.mockResolvedValue({ ...row, _wmkf_programdirector_value: null });
  expect(await readRequestNarratives(input)).toMatchObject({ canEdit: false });
  await expect(saveRequestNarratives(input)).rejects.toMatchObject({ httpStatus: 403 });
  getUserRole.mockResolvedValue('superuser');
  await expect(saveRequestNarratives(input)).resolves.toMatchObject({ success: true });
});
test('missing actor and read-only preview cannot write even as superuser', async () => {
  getUserRole.mockResolvedValue('superuser');
  await expect(saveRequestNarratives({ ...input, callerSystemId: null })).rejects.toMatchObject({ httpStatus: 403 });
  resolvePreviewReadOnly.mockReturnValue(true);
  await expect(saveRequestNarratives(input)).rejects.toMatchObject({ httpStatus: 403 });
  expect(updateById).not.toHaveBeenCalled();
});
test('successful PATCH is not followed by a fallible service read', async () => {
  await saveRequestNarratives(input);
  expect(getById).toHaveBeenCalledTimes(1);
});
test('missing request and invalid identifiers fail closed', async () => {
  await expect(readRequestNarratives({ ...input, requestId: 'bad' })).rejects.toMatchObject({ httpStatus: 400 });
  getById.mockResolvedValue(null);
  await expect(saveRequestNarratives(input)).rejects.toMatchObject({ httpStatus: 404 });
});

test('disabled impersonation cannot silently attribute a staff save to the service principal', async () => {
  delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
  expect(await readRequestNarratives(input)).toMatchObject({ canEdit: false });
  await expect(saveRequestNarratives(input)).rejects.toMatchObject({ httpStatus: 403 });
  expect(updateById).not.toHaveBeenCalled();
});

 test('only the enabled Executive Summary column is selected; sibling field and renamed keys cannot be written', async () => {
  const result = await readRequestNarratives(input);
  expect(result).not.toHaveProperty('initial_assessment');
  expect(getById).toHaveBeenCalledWith(requestId, { select: 'akoya_requestid,_wmkf_programdirector_value,wmkf_layabstract' });
  for (const changes of [{ initial_assessment: 'no' }, { executive_summary: 'no' }, { wmkf_layabstract: 'no' }]) {
    await expect(saveRequestNarratives({ ...input, changes })).rejects.toMatchObject({ httpStatus: 400 });
  }
  expect(updateById).not.toHaveBeenCalled();
});
test('preserves the existing 100000-character manual editing contract', async () => {
  const value = 'x'.repeat(100000);
  await saveRequestNarratives({ ...input, changes: { lay_abstract: value } });
  expect(updateById.mock.calls[0][1]).toEqual({ wmkf_layabstract: value });
});
