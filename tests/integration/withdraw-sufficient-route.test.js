/**
 * PD selective-decline route (Phase 4) — still-pending guard, state-before-email
 * ordering, and the withdrawn_sufficient + marker-clear write.
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 'p-1', session: { user: { dynamicsSystemuserId: 'u-1' } } })),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_ctx, fn) => fn(),
}));
const getRecord = jest.fn();
const createAndSendEmail = jest.fn(async () => ({ emailId: 'e-1' }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: (...a) => getRecord(...a), createAndSendEmail: (...a) => createAndSendEmail(...a) },
}));
const findById = jest.fn();
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({ signature: 'Dr. PD\nW. M. Keck Foundation' })),
}));

const { createMockReq, createMockRes } = require('../helpers/auth-mock');

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const PERSON = 'person-1';

let handler;
beforeAll(async () => { handler = (await import('../../pages/api/review-manager/withdraw-sufficient')).default; });

function pendingRow(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_invited: true, wmkf_accepted: false, wmkf_declined: false, wmkf_responsetype: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getRecord.mockImplementation(async (set) => {
    if (set === 'akoya_requests') return { akoya_requestid: REQ, akoya_title: 'A Proposal', _wmkf_programdirector_value: 'pd-1' };
    if (set === 'systemusers') return { systemuserid: 'pd-1', internalemailaddress: 'pd@keck.org', isdisabled: false };
    if (set === 'wmkf_potentialreviewerses') return { wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: 'rev@example.org' };
    return null;
  });
});

async function run(body) {
  const req = createMockReq({ method: 'POST', body });
  const res = createMockRes();
  await handler(req, res);
  return res;
}

test('still-pending row: writes withdrawn_sufficient (+ clears respond marker) BEFORE the email', async () => {
  findById.mockResolvedValue(pendingRow());
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(res.statusCode).toBe(200);
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUG,
    expect.objectContaining({ responseType: 'withdrawn_sufficient', withdrawnSufficientAt: expect.any(String), respondReminderSentAt: null }),
    { actingUserSystemId: 'u-1' },
  );
  expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  // State write precedes the courtesy email (a send failure can't leave them able to respond).
  expect(updateLifecycle.mock.invocationCallOrder[0]).toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);
  expect(res._data).toMatchObject({ ok: true, withdrawn: 1 });
});

test('accepted row is refused (not_pending) — never touches an accepted/honorarium row', async () => {
  findById.mockResolvedValue(pendingRow({ wmkf_accepted: true }));
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(createAndSendEmail).not.toHaveBeenCalled();
  expect(res._data).toMatchObject({ ok: true, withdrawn: 0, results: [{ suggestionId: SUG, status: 'not_pending' }] });
});

test('declined row is refused (not_pending)', async () => {
  findById.mockResolvedValue(pendingRow({ wmkf_declined: true }));
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(res._data).toMatchObject({ withdrawn: 0 });
});

test('row belonging to a different request is skipped (wrong_request)', async () => {
  findById.mockResolvedValue(pendingRow({ _wmkf_request_value: '33333333-3333-4333-8333-333333333333' }));
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(res._data.results[0].status).toBe('wrong_request');
});

test('non-GUID suggestionId → 400 before any work', async () => {
  const res = await run({ requestId: REQ, suggestionIds: ['not-a-guid'] });
  expect(res.statusCode).toBe(400);
  expect(findById).not.toHaveBeenCalled();
});

test('non-GUID requestId → 400', async () => {
  const res = await run({ requestId: 'nope', suggestionIds: [SUG] });
  expect(res.statusCode).toBe(400);
});

test('email-send failure still reports the reviewer as withdrawn (state already committed)', async () => {
  findById.mockResolvedValue(pendingRow());
  createAndSendEmail.mockRejectedValueOnce(new Error('SMTP down'));
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(res._data.withdrawn).toBe(1);
  expect(res._data.results[0].status).toBe('withdrawn_email_failed');
});
