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
const getSettingStrict = jest.fn();
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: (...a) => getSettingStrict(...a),
}));
jest.mock('../../lib/services/notification-service', () => ({
  notify: jest.fn().mockResolvedValue({ id: 1 }),
}));

const {
  REVIEWER_WITHDRAW_SEED_BODY,
  REVIEWER_WITHDRAW_SEED_SUBJECT,
} = require('../../lib/seed/email-defaults/reviewer-actions');

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
    _etag: 'W/"1"',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getSettingStrict.mockImplementation(async (key) => ({
    found: true,
    value: {
      'email.reviewer_withdraw.subject': REVIEWER_WITHDRAW_SEED_SUBJECT,
      'email.reviewer_withdraw.body': REVIEWER_WITHDRAW_SEED_BODY,
    }[key],
  }));
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
    expect.objectContaining({ actingUserSystemId: 'u-1', ifMatch: 'W/"1"' }),
  );
  expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  // State write precedes the courtesy email (a send failure can't leave them able to respond).
  expect(updateLifecycle.mock.invocationCallOrder[0]).toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);
  expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({
    subject: 'Thank you — W. M. Keck Foundation review',
    body: expect.stringContaining('Dear Dr. Reviewer,'),
  }));
  const email = createAndSendEmail.mock.calls[0][0];
  // The release only ever reaches a reviewer who never responded, so the copy
  // thanks them for considering the request — not for a willingness to review.
  expect(email.body).toContain('Thank you for considering our request to review the proposal “A Proposal” for the W. M. Keck Foundation.');
  expect(email.body).toContain('a full slate of reviewers');
  expect(email.body).toContain('Dr. PD<br>W. M. Keck Foundation');
  expect(res._data).toMatchObject({ ok: true, withdrawn: 1 });
});

test('blank withdraw email default skips only the courtesy email after the withdrawal write', async () => {
  const NotificationService = require('../../lib/services/notification-service');
  NotificationService.notify.mockClear();
  findById.mockResolvedValue(pendingRow());
  getSettingStrict.mockImplementation(async (key) => ({
    found: true,
    value: key === 'email.reviewer_withdraw.body' ? '   ' : REVIEWER_WITHDRAW_SEED_SUBJECT,
  }));

  const res = await run({ requestId: REQ, suggestionIds: [SUG] });

  expect(res.statusCode).toBe(200);
  expect(updateLifecycle).toHaveBeenCalledTimes(1);
  expect(createAndSendEmail).not.toHaveBeenCalled();
  expect(res._data).toMatchObject({ ok: true, withdrawn: 1, results: [{ suggestionId: SUG, status: 'withdrawn_email_skipped' }] });
  expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
    type: 'email_default_misconfigured',
    metadata: expect.objectContaining({ key: 'email.reviewer_withdraw.body', reason: 'blank' }),
  }));
  expect(updateLifecycle.mock.invocationCallOrder[0]).toBeLessThan(getSettingStrict.mock.invocationCallOrder[0]);
});

test('unavailable withdraw email default skips only the courtesy email after the withdrawal write', async () => {
  const NotificationService = require('../../lib/services/notification-service');
  NotificationService.notify.mockClear();
  findById.mockResolvedValue(pendingRow());
  getSettingStrict.mockImplementation(async (key) => {
    if (key === 'email.reviewer_withdraw.subject') throw new Error('settings down');
    return { found: true, value: REVIEWER_WITHDRAW_SEED_BODY };
  });

  const res = await run({ requestId: REQ, suggestionIds: [SUG] });

  expect(res.statusCode).toBe(200);
  expect(updateLifecycle).toHaveBeenCalledTimes(1);
  expect(createAndSendEmail).not.toHaveBeenCalled();
  expect(res._data).toMatchObject({ ok: true, withdrawn: 1, results: [{ suggestionId: SUG, status: 'withdrawn_email_skipped' }] });
  expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
    type: 'email_default_misconfigured',
    metadata: expect.objectContaining({ key: 'email.reviewer_withdraw.subject', reason: 'unavailable' }),
  }));
  expect(updateLifecycle.mock.invocationCallOrder[0]).toBeLessThan(getSettingStrict.mock.invocationCallOrder[0]);
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

test('reviewer accepts between guard-read and write (412) → changed_skipped, no email (Codex finding #2)', async () => {
  findById.mockResolvedValue(pendingRow());
  updateLifecycle.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(res._data.withdrawn).toBe(0);
  expect(res._data.results[0].status).toBe('changed_skipped');
  expect(createAndSendEmail).not.toHaveBeenCalled();
  // The write carried the row's _etag for the optimistic lock.
  expect(updateLifecycle).toHaveBeenCalledWith(SUG, expect.any(Object), expect.objectContaining({ ifMatch: expect.anything() }));
});

test('email-send failure still reports the reviewer as withdrawn (state already committed)', async () => {
  findById.mockResolvedValue(pendingRow());
  createAndSendEmail.mockRejectedValueOnce(new Error('SMTP down'));
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(res._data.withdrawn).toBe(1);
  expect(res._data.results[0].status).toBe('withdrawn_email_failed');
});

// --- Characterization additions (Stage 1 pilot, Route→Service Consolidation Plan) ---

test('wrong HTTP method (GET) -> 405 with Allow: POST, no work performed', async () => {
  const req = createMockReq({ method: 'GET', body: { requestId: REQ, suggestionIds: [SUG] } });
  const res = createMockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(405);
  expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
  expect(res._data).toEqual({ error: 'Method not allowed' });
  expect(findById).not.toHaveBeenCalled();
});

test('unauthenticated (requireAppAccess denies) -> route returns immediately, does not touch the response requireAppAccess already sent', async () => {
  const { requireAppAccess } = require('../../lib/utils/auth');
  requireAppAccess.mockImplementationOnce(async (req, res) => {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  });
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(res.statusCode).toBe(401);
  expect(res._data).toEqual({ error: 'Authentication required' });
  expect(findById).not.toHaveBeenCalled();
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('happy-path response envelope is pinned exactly (full shape, not just 200)', async () => {
  findById.mockResolvedValue(pendingRow());
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(res.statusCode).toBe(200);
  expect(res._data).toEqual({
    ok: true,
    withdrawn: 1,
    results: [{ suggestionId: SUG, status: 'withdrawn_emailed' }],
  });
});

test('domain error: no request found for requestId -> 404 with exact error body, no per-suggestion work', async () => {
  getRecord.mockImplementation(async (set) => {
    if (set === 'akoya_requests') return null;
    return null;
  });
  const res = await run({ requestId: REQ, suggestionIds: [SUG] });
  expect(res.statusCode).toBe(404);
  expect(res._data).toEqual({ error: `No request found for ${REQ}` });
  expect(findById).not.toHaveBeenCalled();
  expect(updateLifecycle).not.toHaveBeenCalled();
});
