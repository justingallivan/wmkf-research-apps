/** @jest-environment node */

const findById = jest.fn();
const updateLifecycle = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
  updateLifecycle: (...args) => updateLifecycle(...args),
  REVIEW_STATUS_MAP: {
    accepted: 100000000,
    materials_sent: 100000001,
    under_review: 100000002,
  },
}));

const { repairMaterialsSendStamp } = require('../../lib/services/review-manager/repair-materials-send-service');
const {
  mintMaterialsSendRepairReceipt,
  verifyMaterialsSendRepairReceipt,
} = require('../../lib/services/review-manager/materials-send-repair-receipt');

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SUGGESTION = '22222222-2222-4222-8222-222222222222';
const SENT_AT = '2026-07-22T10:00:00.000Z';
const ETAG = 'W/"11"';

function row(overrides = {}) {
  return {
    _wmkf_request_value: REQUEST,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000000,
    wmkf_reviewreceivedat: null,
    wmkf_completedat: null,
    wmkf_materialssentat: null,
    wmkf_reviewduedateatsend: null,
    wmkf_reviewduedatelastsent: null,
    _etag: ETAG,
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return mintMaterialsSendRepairReceipt({
    requestId: REQUEST,
    suggestionId: SUGGESTION,
    effectiveReviewDueDate: '2026-09-15',
    materialsSentAt: SENT_AT,
    ifMatch: ETAG,
    ...overrides,
  });
}

function repair(repairReceipt = receipt()) {
  return repairMaterialsSendStamp({ repairReceipt, actingUserSystemId: 'staff-1' });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-materials-repair';
  findById.mockResolvedValue(row());
  updateLifecycle.mockResolvedValue(undefined);
});

test('first repair stamps both dates from signed dispatch evidence and uses its ETag', async () => {
  await expect(repair()).resolves.toEqual({ ok: true, status: 'repaired', suggestionId: SUGGESTION });
  expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION, {
    reviewDueDateLastSent: '2026-09-15',
    reviewDueDateAtSend: '2026-09-15',
    materialsSentAt: SENT_AT,
    reviewStatus: 'materials_sent',
  }, { actingUserSystemId: 'staff-1', ifMatch: ETAG });
});

test('legitimate render-time override is recoverable without matching the request column', async () => {
  await repair(receipt({ effectiveReviewDueDate: '2026-10-03' }));
  expect(updateLifecycle.mock.calls[0][1]).toMatchObject({
    reviewDueDateAtSend: '2026-10-03',
    reviewDueDateLastSent: '2026-10-03',
  });
});

test('changed-deadline re-send advances lastSent, preserves atSend, and records this dispatch time', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewduedateatsend: '2026-09-14',
    wmkf_reviewduedatelastsent: '2026-09-14',
    wmkf_materialssentat: '2026-07-20T10:00:00.000Z',
    wmkf_reviewstatus: 100000001,
  }));
  await repair();
  const [, payload] = updateLifecycle.mock.calls[0];
  expect(payload).toEqual({
    reviewDueDateLastSent: '2026-09-15',
    materialsSentAt: SENT_AT,
  });
});

test.each([
  ['submitted', { wmkf_reviewreceivedat: '2026-07-22T10:01:00Z' }],
  ['completed', { wmkf_completedat: '2026-07-22T10:01:00Z' }],
  ['withdrew', { wmkf_reviewstatus: 100000005 }],
  ['released', { wmkf_reviewstatus: 100000006 }],
  ['changed ETag', { _etag: 'W/"12"' }],
])('fails closed when the row is %s', async (_label, overrides) => {
  findById.mockResolvedValue(row(overrides));
  await expect(repair()).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('tampered client data cannot forge a different due date', async () => {
  const token = receipt();
  const [encoded, sig] = token.split('.');
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  claims.effectiveReviewDueDate = '2027-01-01';
  const tampered = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
  await expect(repair(tampered)).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('receipt expires after fifteen minutes', () => {
  const now = Date.parse('2026-07-22T10:00:00.000Z');
  const token = receipt({ now });
  expect(() => verifyMaterialsSendRepairReceipt(token, { now: now + (16 * 60 * 1000) }))
    .toThrow('expired_repair_receipt');
});

test('replay is rejected after the first repair changes the row ETag', async () => {
  const token = receipt();
  await repair(token);
  findById.mockResolvedValue(row({ _etag: 'W/"12"' }));
  await expect(repair(token)).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateLifecycle).toHaveBeenCalledTimes(1);
});

test('a concurrent replay loses the shared If-Match race', async () => {
  updateLifecycle
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
  const token = receipt();
  const results = await Promise.allSettled([repair(token), repair(token)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected.reason).toMatchObject({ httpStatus: 409 });
});
