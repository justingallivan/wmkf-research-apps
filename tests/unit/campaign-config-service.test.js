/**
 * Logic-level unit tests for lib/services/review-manager/campaign-config-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave — the new test layer that
 * could not exist while logic lived in the route).
 *
 * Adapter mocked; covers GET read-shape defaults, POST save (coercion,
 * unknown/read-only field rejection, empty patch, read-before-write, merged
 * response), and the 404 domain error. No req/res anywhere.
 */

const getById = jest.fn();
const updateById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
  updateById: (...a) => updateById(...a),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'su-1';

let getCampaignConfig;
let saveCampaignConfig;
let CampaignConfigError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/campaign-config-service');
  getCampaignConfig = mod.getCampaignConfig;
  saveCampaignConfig = mod.saveCampaignConfig;
  CampaignConfigError = mod.CampaignConfigError;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function record(over = {}) {
  return { akoya_requestid: REQ, wmkf_desiredcount: 5, wmkf_reviewduedate: '2026-08-01', ...over };
}

describe('getCampaignConfig', () => {
  test('returns full config shape with nulls where unset', async () => {
    getById.mockResolvedValueOnce(record());
    const out = await getCampaignConfig({ requestId: REQ });
    expect(out).toEqual({
      requestId: REQ,
      config: {
        respondOffsetDays: null,
        reviewDueDate: '2026-08-01',
        respondReminderEnabled: null,
        respondReminderLeadDays: null,
        reviewDueReminderEnabled: null,
        reviewDueReminderLeadDays: null,
        desiredCount: 5,
        quotaNotifiedAt: null,
      },
    });
  });

  test('throws 404 CampaignConfigError when the request is missing (lookup throws)', async () => {
    getById.mockRejectedValueOnce(new Error('boom'));
    await expect(getCampaignConfig({ requestId: REQ })).rejects.toMatchObject({
      httpStatus: 404,
      message: `No request found for ${REQ}`,
    });
    await expect(getCampaignConfig({ requestId: REQ })).rejects.toBeInstanceOf(CampaignConfigError);
  });
});

describe('saveCampaignConfig', () => {
  test('writes only provided fields (coerced to columns) and returns merged config', async () => {
    getById.mockResolvedValueOnce(record());
    const out = await saveCampaignConfig({
      requestId: REQ,
      config: { desiredCount: 7, respondReminderEnabled: true },
      actingUserSystemId: ACTOR,
    });
    expect(updateById).toHaveBeenCalledWith(
      REQ,
      { wmkf_desiredcount: 7, wmkf_respondreminderenabled: true },
      { actingUserSystemId: ACTOR },
    );
    expect(out.success).toBe(true);
    expect(out.config.desiredCount).toBe(7);
    expect(out.config.respondReminderEnabled).toBe(true);
    expect(out.config.reviewDueDate).toBe('2026-08-01'); // merged from pre-write record
    expect(out.config.quotaNotifiedAt).toBeNull();
  });

  test('null clears a column', async () => {
    getById.mockResolvedValueOnce(record());
    await saveCampaignConfig({ requestId: REQ, config: { reviewDueDate: null }, actingUserSystemId: null });
    expect(updateById).toHaveBeenCalledWith(REQ, { wmkf_reviewduedate: null }, { actingUserSystemId: null });
  });

  test('rejects unknown/read-only field with 400 BEFORE any Dataverse read', async () => {
    await expect(
      saveCampaignConfig({ requestId: REQ, config: { quotaNotifiedAt: '2026-01-01' }, actingUserSystemId: null }),
    ).rejects.toMatchObject({
      httpStatus: 400,
      message: 'Unknown or read-only config field: quotaNotifiedAt',
    });
    expect(getById).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  test('rejects bad types with 400', async () => {
    await expect(
      saveCampaignConfig({ requestId: REQ, config: { desiredCount: -1 }, actingUserSystemId: null }),
    ).rejects.toMatchObject({ httpStatus: 400, message: 'desiredCount must be a non-negative integer' });
    await expect(
      saveCampaignConfig({ requestId: REQ, config: { respondReminderEnabled: 'yes' }, actingUserSystemId: null }),
    ).rejects.toMatchObject({ httpStatus: 400, message: 'respondReminderEnabled must be a boolean' });
    await expect(
      saveCampaignConfig({ requestId: REQ, config: { reviewDueDate: '2026-13-40' }, actingUserSystemId: null }),
    ).rejects.toMatchObject({ httpStatus: 400, message: 'reviewDueDate must be a YYYY-MM-DD date or null' });
  });

  test('rejects an empty effective patch with 400', async () => {
    await expect(
      saveCampaignConfig({ requestId: REQ, config: { desiredCount: undefined }, actingUserSystemId: null }),
    ).rejects.toMatchObject({ httpStatus: 400, message: 'config must contain at least one editable field' });
    expect(updateById).not.toHaveBeenCalled();
  });

  test('throws 404 and never writes when the request does not exist', async () => {
    getById.mockResolvedValueOnce(null);
    await expect(
      saveCampaignConfig({ requestId: REQ, config: { desiredCount: 3 }, actingUserSystemId: null }),
    ).rejects.toMatchObject({ httpStatus: 404 });
    expect(updateById).not.toHaveBeenCalled();
  });
});
