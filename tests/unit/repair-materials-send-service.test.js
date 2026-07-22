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

// S369 hardening: the repair now confirms the client-supplied date against the
// request's own review due date, so an authorized caller cannot walk the ledger
// to an arbitrary deadline with no email ever sent.
const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...args) => getRequestById(...args),
}));

const { repairMaterialsSendStamp } = require('../../lib/services/review-manager/repair-materials-send-service');

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SUGGESTION = '22222222-2222-4222-8222-222222222222';
const SENT_AT = '2026-07-22T10:00:00.000Z';

function row(overrides = {}) {
  return {
    _wmkf_request_value: REQUEST,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000000,
    wmkf_reviewreceivedat: null,
    wmkf_completedat: null,
    wmkf_materialssentat: null,
    wmkf_reviewduedateatsend: null,
    _etag: 'W/"11"',
    ...overrides,
  };
}

function repair(overrides = {}) {
  return repairMaterialsSendStamp({
    requestId: REQUEST,
    suggestionId: SUGGESTION,
    effectiveReviewDueDate: '2026-09-15',
    materialsSentAt: SENT_AT,
    actingUserSystemId: 'staff-1',
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(row());
  updateLifecycle.mockResolvedValue(undefined);
  getRequestById.mockResolvedValue({ akoya_requestid: REQUEST, wmkf_reviewduedate: '2026-09-15' });
});

test('first repair stamps BOTH dates and uses the fresh row ETag', async () => {
  await expect(repair()).resolves.toEqual({ ok: true, status: 'repaired', suggestionId: SUGGESTION });
  expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION, {
    reviewDueDateLastSent: '2026-09-15',
    reviewDueDateAtSend: '2026-09-15',
    materialsSentAt: SENT_AT,
    reviewStatus: 'materials_sent',
  }, { actingUserSystemId: 'staff-1', ifMatch: 'W/"11"' });
});

test('same already-recorded due date is an idempotent no-op', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewduedateatsend: '2026-09-15',
    wmkf_reviewduedatelastsent: '2026-09-15',
  }));
  await expect(repair()).resolves.toEqual({ ok: true, status: 'already_recorded', suggestionId: SUGGESTION });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

// S369 two-date model: a repair for a SECOND send at a CHANGED deadline is the
// case this endpoint exists for. It must advance lastSent while leaving the
// first commitment (atSend) untouched — the old single-date contract rejected
// this with a 409 and left the row permanently unrepairable.
test('repairing a changed deadline advances lastSent and never rewrites atSend', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewduedateatsend: '2026-09-14',
    wmkf_reviewduedatelastsent: '2026-09-14',
    wmkf_materialssentat: SENT_AT,
    wmkf_reviewstatus: 100000001,
  }));
  await expect(repair()).resolves.toEqual({ ok: true, status: 'repaired', suggestionId: SUGGESTION });
  const [, payload] = updateLifecycle.mock.calls[0];
  expect(payload.reviewDueDateLastSent).toBe('2026-09-15');
  expect(payload).not.toHaveProperty('reviewDueDateAtSend');
});

test.each([
  ['submitted', { wmkf_reviewreceivedat: '2026-07-22T10:01:00Z' }],
  ['completed', { wmkf_completedat: '2026-07-22T10:01:00Z' }],
  ['withdrew', { wmkf_reviewstatus: 100000005 }],
  ['released', { wmkf_reviewstatus: 100000006 }],
  ['missing ETag', { _etag: null }],
])('fails closed when the row is %s', async (_label, overrides) => {
  findById.mockResolvedValue(row(overrides));
  await expect(repair()).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

// S369 adversarial finding: effectiveReviewDueDate is client-supplied and ETag
// locking stops concurrent writes but not sequential replay. Without a
// server-side confirmation an authorized caller could walk lastSent to any
// valid date with no email sent, and fix a null atSend permanently on the
// first request.
test('refuses a date the request does not actually hold (no arbitrary ledger writes)', async () => {
  getRequestById.mockResolvedValue({ akoya_requestid: REQUEST, wmkf_reviewduedate: '2026-09-15' });
  await expect(repair({ effectiveReviewDueDate: '2027-01-01' }))
    .rejects.toMatchObject({ httpStatus: 409 });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('refuses when the request has no due date to confirm against', async () => {
  getRequestById.mockResolvedValue({ akoya_requestid: REQUEST, wmkf_reviewduedate: null });
  await expect(repair()).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('replaying the same repair cannot re-write an already-set atSend', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewduedateatsend: '2026-09-01',
    wmkf_reviewduedatelastsent: '2026-09-01',
    wmkf_materialssentat: SENT_AT,
    wmkf_reviewstatus: 100000001,
  }));
  await repair();
  const [, payload] = updateLifecycle.mock.calls[0];
  expect(payload).not.toHaveProperty('reviewDueDateAtSend');
  expect(payload.reviewDueDateLastSent).toBe('2026-09-15');
});
