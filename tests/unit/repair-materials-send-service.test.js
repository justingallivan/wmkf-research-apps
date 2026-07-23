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
const LATER_SENT_AT = '2026-07-22T11:00:00.000Z';
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

test('commit-success response-loss retry returns already_recorded without a second write', async () => {
  const token = receipt();
  findById
    .mockResolvedValueOnce(row())
    .mockResolvedValueOnce(row({
      wmkf_reviewstatus: 100000001,
      wmkf_materialssentat: SENT_AT,
      wmkf_reviewduedateatsend: '2026-09-15',
      wmkf_reviewduedatelastsent: '2026-09-15',
      _etag: 'W/"12"',
    }));
  await expect(repair(token)).resolves.toMatchObject({ status: 'repaired' });
  await expect(repair(token)).resolves.toEqual({
    ok: true,
    status: 'already_recorded',
    suggestionId: SUGGESTION,
  });
  expect(updateLifecycle).toHaveBeenCalledTimes(1);
});

test('a fresh eligible ETag does not invalidate signed dispatch evidence', async () => {
  findById.mockResolvedValue(row({ _etag: 'W/"12"' }));
  await repair();
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    expect.any(Object),
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"12"' },
  );
});

test('two receipts sharing one initial ETag record both dispatches in signed-time order', async () => {
  const firstReceipt = receipt();
  const secondReceipt = receipt({
    effectiveReviewDueDate: '2026-10-01',
    materialsSentAt: LATER_SENT_AT,
  });
  findById
    .mockResolvedValueOnce(row())
    .mockResolvedValueOnce(row({
      wmkf_reviewstatus: 100000001,
      wmkf_materialssentat: SENT_AT,
      wmkf_reviewduedateatsend: '2026-09-15',
      wmkf_reviewduedatelastsent: '2026-09-15',
      _etag: 'W/"12"',
    }));

  await expect(repair(firstReceipt)).resolves.toMatchObject({ status: 'repaired' });
  await expect(repair(secondReceipt)).resolves.toMatchObject({ status: 'repaired' });

  expect(updateLifecycle).toHaveBeenNthCalledWith(2, SUGGESTION, {
    reviewDueDateLastSent: '2026-10-01',
    materialsSentAt: LATER_SENT_AT,
  }, { actingUserSystemId: 'staff-1', ifMatch: 'W/"12"' });
});

test('an older signed dispatch cannot overwrite a newer recorded dispatch', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewstatus: 100000001,
    wmkf_materialssentat: LATER_SENT_AT,
    wmkf_reviewduedateatsend: '2026-09-15',
    wmkf_reviewduedatelastsent: '2026-10-01',
    _etag: 'W/"12"',
  }));
  await expect(repair()).rejects.toMatchObject({
    httpStatus: 409,
    message: 'A newer materials dispatch is already recorded',
  });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('same signed timestamp with a different due date fails closed as ambiguous', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewstatus: 100000001,
    wmkf_materialssentat: SENT_AT,
    wmkf_reviewduedatelastsent: '2026-10-01',
    _etag: 'W/"12"',
  }));
  await expect(repair()).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('a concurrent replay recognizes the exact signed claims after losing the shared If-Match race', async () => {
  findById
    .mockResolvedValueOnce(row())
    .mockResolvedValueOnce(row())
    .mockResolvedValueOnce(row({
      wmkf_reviewstatus: 100000001,
      wmkf_materialssentat: SENT_AT,
      wmkf_reviewduedateatsend: '2026-09-15',
      wmkf_reviewduedatelastsent: '2026-09-15',
      _etag: 'W/"12"',
    }));
  updateLifecycle
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
  const token = receipt();
  const results = await Promise.allSettled([repair(token), repair(token)]);
  expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  expect(results.map((result) => result.value.status).sort())
    .toEqual(['already_recorded', 'repaired']);
});
