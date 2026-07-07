/**
 * Logic-level unit tests for lib/services/review-manager/update-abstract-service.js.
 * Adapter mocked; covers the happy write, input validation (empty/oversized/
 * non-string), existence-check 404, the optimistic compare-and-set 409 guard
 * (and its last-write-wins fallback when expectedCurrent is omitted), and the
 * exact updateById call shape. No req/res anywhere.
 */

const getById = jest.fn();
const updateById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
  updateById: (...a) => updateById(...a),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'su-1';

let updateAbstract;
let ServiceHttpError;
beforeAll(async () => {
  updateAbstract = (await import('../../lib/services/review-manager/update-abstract-service')).updateAbstract;
  ServiceHttpError = (await import('../../lib/services/service-http-error')).ServiceHttpError;
});

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({ akoya_requestid: REQ });
});

test('writes the trimmed abstract to wmkf_abstract with actor attribution', async () => {
  const out = await updateAbstract({ requestId: REQ, abstract: '  Clean abstract text.  ', actingUserSystemId: ACTOR });
  expect(updateById).toHaveBeenCalledWith(REQ, { wmkf_abstract: 'Clean abstract text.' }, { actingUserSystemId: ACTOR });
  expect(out).toEqual({ success: true, requestId: REQ, abstract: 'Clean abstract text.' });
});

test('preserves internal paragraph structure the PD typed', async () => {
  await updateAbstract({ requestId: REQ, abstract: 'Para one.\n\nPara two.', actingUserSystemId: ACTOR });
  expect(updateById).toHaveBeenCalledWith(REQ, { wmkf_abstract: 'Para one.\n\nPara two.' }, { actingUserSystemId: ACTOR });
});

test('rejects an empty / whitespace-only abstract (400, no write)', async () => {
  await expect(updateAbstract({ requestId: REQ, abstract: '   ', actingUserSystemId: ACTOR }))
    .rejects.toMatchObject({ httpStatus: 400 });
  expect(updateById).not.toHaveBeenCalled();
});

test('rejects a non-string abstract (400, no write)', async () => {
  await expect(updateAbstract({ requestId: REQ, abstract: 42, actingUserSystemId: ACTOR }))
    .rejects.toBeInstanceOf(ServiceHttpError);
  expect(updateById).not.toHaveBeenCalled();
});

test('rejects an oversized abstract (400, no write)', async () => {
  await expect(updateAbstract({ requestId: REQ, abstract: 'x'.repeat(20001), actingUserSystemId: ACTOR }))
    .rejects.toMatchObject({ httpStatus: 400 });
  expect(updateById).not.toHaveBeenCalled();
});

test('404 when the request does not exist (no write)', async () => {
  getById.mockResolvedValueOnce(null);
  await expect(updateAbstract({ requestId: REQ, abstract: 'Valid text.', actingUserSystemId: ACTOR }))
    .rejects.toMatchObject({ httpStatus: 404 });
  expect(updateById).not.toHaveBeenCalled();
});

test('404 when the existence read throws (treated as not found, no write)', async () => {
  getById.mockRejectedValueOnce(new Error('boom'));
  await expect(updateAbstract({ requestId: REQ, abstract: 'Valid text.', actingUserSystemId: ACTOR }))
    .rejects.toMatchObject({ httpStatus: 404 });
  expect(updateById).not.toHaveBeenCalled();
});

test('reads wmkf_abstract alongside the id for the concurrency check', async () => {
  await updateAbstract({ requestId: REQ, abstract: 'Valid text.', actingUserSystemId: ACTOR });
  expect(getById).toHaveBeenCalledWith(REQ, { select: 'akoya_requestid,wmkf_abstract' });
});

test('optimistic compare-and-set: writes when live abstract matches expectedCurrent', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, wmkf_abstract: 'Old wrapped\ntext.' });
  await updateAbstract({
    requestId: REQ, abstract: 'Clean text.', expectedCurrent: 'Old wrapped\ntext.', actingUserSystemId: ACTOR,
  });
  expect(updateById).toHaveBeenCalledWith(REQ, { wmkf_abstract: 'Clean text.' }, { actingUserSystemId: ACTOR });
});

test('409 when the live abstract changed since the editor was opened (no write)', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, wmkf_abstract: 'Someone else already fixed it.' });
  await expect(updateAbstract({
    requestId: REQ, abstract: 'Clean text.', expectedCurrent: 'Old wrapped\ntext.', actingUserSystemId: ACTOR,
  })).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).not.toHaveBeenCalled();
});

test('treats a missing live abstract as empty string for the compare (409 vs non-empty expected)', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ }); // wmkf_abstract absent
  await expect(updateAbstract({
    requestId: REQ, abstract: 'Clean text.', expectedCurrent: 'Old text.', actingUserSystemId: ACTOR,
  })).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).not.toHaveBeenCalled();
});

test('no expectedCurrent → last-write-wins (skips the compare, writes)', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, wmkf_abstract: 'Anything at all.' });
  await updateAbstract({ requestId: REQ, abstract: 'Clean text.', actingUserSystemId: ACTOR });
  expect(updateById).toHaveBeenCalledWith(REQ, { wmkf_abstract: 'Clean text.' }, { actingUserSystemId: ACTOR });
});
