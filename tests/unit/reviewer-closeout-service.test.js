/** @jest-environment node */

const findById = jest.fn();
const updateLifecycle = jest.fn();

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
  updateLifecycle: (...args) => updateLifecycle(...args),
  isExcluded: (row) => row?.wmkf_applicantdisposition === 100000001,
  REVIEW_STATUS_MAP: {
    review_received: 100000003,
    complete: 100000004,
  },
  HONORARIUM_ELIGIBILITY_BY_VALUE: {
    100000000: 'eligible',
    100000001: 'not_eligible',
    100000002: 'not_applicable',
  },
}));

const { closeReview } = require('../../lib/services/review-manager/close-review-service');
const { ServiceHttpError } = require('../../lib/services/service-http-error');

const SUGGESTION = '11111111-1111-4111-8111-111111111111';
const HONORARIUM = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';

function row(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION,
    _wmkf_request_value: REQUEST,
    wmkf_selected: true,
    wmkf_accepted: true,
    wmkf_applicantdisposition: null,
    wmkf_reviewstatus: 100000003,
    wmkf_reviewreceivedat: '2026-09-04T12:00:00.000Z',
    wmkf_completedat: null,
    wmkf_honorariumeligibility: null,
    wmkf_notes: null,
    wmkf_honorariumoptout: false,
    _wmkf_honorariumrequest_value: HONORARIUM,
    _etag: 'W/"7"',
    ...overrides,
  };
}

const args = (disposition = 'eligible') => ({
  suggestionId: SUGGESTION,
  disposition,
  actingUserSystemId: 'staff-1',
  authorizedRequestId: REQUEST,
});

test('fails closed if the suggestion is reparented after authorization', async () => {
  findById.mockResolvedValue(row({
    _wmkf_request_value: '44444444-4444-4444-8444-444444444444',
  }));
  await expect(closeReview(args())).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'request_changed' },
  });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test.each([
  ['an interlock denial', Object.assign(new Error('[dataverse-interlock] denied: deployment=preview target=prod op=PATCH caller=x reason="policy"'), {}), 503, 'write_interlocked'],
  ['a Dataverse 403', Object.assign(new Error('Forbidden'), { status: 403 }), 502, 'dataverse_forbidden'],
  ['a Dataverse 401', Object.assign(new Error('Unauthorized'), { status: 401 }), 502, 'dataverse_forbidden'],
  ['a Dataverse 400', Object.assign(new Error('Bad Request: 0x80040203'), { status: 400 }), 502, 'dataverse_rejected'],
  ['a Dataverse 404 on write', Object.assign(new Error('gone'), { status: 404 }), 404, 'not_found'],
  ['a nested response status', Object.assign(new Error('Bad Request'), { response: { status: 400 } }), 502, 'dataverse_rejected'],
])('maps %s on the lifecycle write to a structured error instead of a generic 500', async (_label, writeError, httpStatus, code) => {
  updateLifecycle.mockRejectedValueOnce(writeError);
  const rejection = await closeReview(args()).catch((e) => e);
  expect(rejection).toBeInstanceOf(ServiceHttpError);
  expect(rejection).toMatchObject({ httpStatus, body: { code } });
  // Fixed copy only: upstream detail (error codes, hostnames, policy text) never reaches the client.
  expect(rejection.body.error).not.toMatch(/0x8004|deployment=|Forbidden|Unauthorized|Bad Request/);
});

test('an unrecognised write failure still propagates unmapped (route answers 500)', async () => {
  updateLifecycle.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
  const rejection = await closeReview(args()).catch((e) => e);
  expect(rejection).not.toBeInstanceOf(ServiceHttpError);
  expect(rejection.message).toBe('socket hang up');
});

test('maps a structured Dataverse record disappearance to 404', async () => {
  const missing = new Error('gone');
  missing.serviceName = 'dataverse';
  missing.status = 404;
  missing.dataverseCode = '0x80040217';
  findById.mockRejectedValue(missing);
  await expect(closeReview(args())).rejects.toMatchObject({
    httpStatus: 404,
    body: { code: 'not_found' },
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(row());
  updateLifecycle.mockResolvedValue(undefined);
});

test('closes one received review with status, timestamp, and disposition in one ETag-bound suggestion update', async () => {
  const result = await closeReview(args());

  expect(result).toMatchObject({
    success: true,
    status: 'closed',
    suggestionId: SUGGESTION,
    disposition: 'eligible',
    completedAt: expect.any(String),
  });
  expect(updateLifecycle).toHaveBeenCalledTimes(1);
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    {
      reviewStatus: 'complete',
      completedAt: result.completedAt,
      honorariumEligibility: 'eligible',
    },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
  const payload = updateLifecycle.mock.calls[0][1];
  expect(payload).not.toHaveProperty('reviewReceivedAt');
  expect(payload).not.toHaveProperty('authorizationToRemitPayment');
  expect(payload).not.toHaveProperty('honorariumRequest');
});

test('trims closeout notes into the same ETag-bound first-closeout write', async () => {
  const result = await closeReview({ ...args(), notes: '  Review was late but useful.  ' });

  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    {
      reviewStatus: 'complete',
      completedAt: result.completedAt,
      honorariumEligibility: 'eligible',
      notes: 'Review was late but useful.',
    },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
});

test('repeat of the same completed disposition is an unchanged success with no restamp', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewstatus: 100000004,
    wmkf_completedat: '2026-09-04T13:00:00.000Z',
    wmkf_honorariumeligibility: 100000000,
  }));

  await expect(closeReview(args())).resolves.toEqual({
    success: true,
    status: 'unchanged',
    suggestionId: SUGGESTION,
    disposition: 'eligible',
    completedAt: '2026-09-04T13:00:00.000Z',
  });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('corrects only the disposition on an already-complete row and preserves completion time', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewstatus: 100000004,
    wmkf_completedat: '2026-09-04T13:00:00.000Z',
    wmkf_honorariumeligibility: 100000001,
  }));

  const result = await closeReview(args('eligible'));
  expect(result).toEqual({
    success: true,
    status: 'corrected',
    suggestionId: SUGGESTION,
    disposition: 'eligible',
    completedAt: '2026-09-04T13:00:00.000Z',
  });
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    { honorariumEligibility: 'eligible' },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
});

test('updates changed notes without restamping or rewriting an unchanged disposition', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewstatus: 100000004,
    wmkf_completedat: '2026-09-04T13:00:00.000Z',
    wmkf_honorariumeligibility: 100000000,
    wmkf_notes: 'Old note',
  }));

  const result = await closeReview({ ...args(), notes: 'New closeout note' });
  expect(result).toMatchObject({ status: 'corrected', completedAt: '2026-09-04T13:00:00.000Z' });
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    { notes: 'New closeout note' },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
});

test('treats normalized matching notes as unchanged and supports an explicit clear', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewstatus: 100000004,
    wmkf_completedat: '2026-09-04T13:00:00.000Z',
    wmkf_honorariumeligibility: 100000000,
    wmkf_notes: 'Existing note',
  }));

  await expect(closeReview({ ...args(), notes: '  Existing note  ' }))
    .resolves.toMatchObject({ status: 'unchanged' });
  expect(updateLifecycle).not.toHaveBeenCalled();

  await expect(closeReview({ ...args(), notes: '   ' }))
    .resolves.toMatchObject({ status: 'corrected' });
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    { notes: null },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
});

test('rejects invalid notes before reading or writing Dataverse', async () => {
  await expect(closeReview({ ...args(), notes: 'x'.repeat(2001) })).rejects.toMatchObject({
    httpStatus: 400,
    body: { code: 'invalid_notes' },
  });
  expect(findById).not.toHaveBeenCalled();
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('requires a non-empty note for not eligible before reading or writing Dataverse', async () => {
  await expect(closeReview({ ...args('not_eligible'), notes: '   ' })).rejects.toMatchObject({
    httpStatus: 400,
    body: { code: 'notes_required' },
  });
  expect(findById).not.toHaveBeenCalled();
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('allows a legacy Complete row with null disposition to receive its first recorded disposition without restamping', async () => {
  findById.mockResolvedValue(row({
    wmkf_reviewstatus: 100000004,
    wmkf_completedat: '2026-09-04T13:00:00.000Z',
  }));

  const result = await closeReview({ ...args('not_eligible'), notes: 'Review quality concern' });
  expect(result.status).toBe('corrected');
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    { honorariumEligibility: 'not_eligible', notes: 'Review quality concern' },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
});

test.each([
  ['not selected', { wmkf_selected: false }, 'not_selected'],
  ['not accepted', { wmkf_accepted: false }, 'not_accepted'],
  ['missing receipt', { wmkf_reviewreceivedat: null }, 'review_not_received'],
  ['wrong source status', { wmkf_reviewstatus: 100000002 }, 'invalid_source_status'],
  ['missing ETag', { _etag: null }, 'missing_etag'],
  ['applicant excluded', { wmkf_applicantdisposition: 100000001 }, 'excluded'],
])('rejects %s without writing', async (_label, overrides, code) => {
  findById.mockResolvedValue(row(overrides));
  await expect(closeReview(args())).rejects.toMatchObject({ httpStatus: 409, body: { code } });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test.each([
  ['eligible', { wmkf_honorariumoptout: true }, 'eligible_opted_out'],
  ['eligible', { _wmkf_honorariumrequest_value: null }, 'eligible_missing_honorarium'],
  ['not_applicable', { wmkf_honorariumoptout: false, _wmkf_honorariumrequest_value: HONORARIUM }, 'not_applicable_conflict'],
  ['not_eligible', { wmkf_honorariumoptout: true }, 'not_eligible_not_applicable'],
  ['not_eligible', { _wmkf_honorariumrequest_value: null }, 'not_eligible_not_applicable'],
])('rejects disposition %s when its persisted complement is invalid', async (disposition, overrides, code) => {
  findById.mockResolvedValue(row(overrides));
  await expect(closeReview({ ...args(disposition), notes: disposition === 'not_eligible' ? 'Reason' : undefined }))
    .rejects.toMatchObject({ body: { code } });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test.each([
  ['not_eligible', { wmkf_honorariumoptout: false, _wmkf_honorariumrequest_value: HONORARIUM }],
  ['not_applicable', { wmkf_honorariumoptout: true }],
  ['not_applicable', { _wmkf_honorariumrequest_value: null }],
])('accepts valid disposition %s state', async (disposition, overrides) => {
  findById.mockResolvedValue(row(overrides));
  await expect(closeReview({ ...args(disposition), notes: disposition === 'not_eligible' ? 'Reason' : undefined }))
    .resolves.toMatchObject({ status: 'closed', disposition });
});

test('unknown request disposition and unknown persisted disposition fail closed', async () => {
  await expect(closeReview(args('pay_it'))).rejects.toMatchObject({ httpStatus: 400 });
  expect(findById).not.toHaveBeenCalled();

  findById.mockResolvedValue(row({
    wmkf_reviewstatus: 100000004,
    wmkf_honorariumeligibility: 100000099,
  }));
  await expect(closeReview({ ...args('not_eligible'), notes: 'Reason' })).rejects.toMatchObject({
    body: { code: 'unknown_existing_disposition' },
  });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('maps an ETag conflict to a retryable 409 without a second write', async () => {
  const conflict = new Error('Dataverse update failed (412 Precondition Failed)');
  conflict.status = 412;
  updateLifecycle.mockRejectedValue(conflict);

  await expect(closeReview(args())).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'conflict' },
  });
  expect(updateLifecycle).toHaveBeenCalledTimes(1);
});
