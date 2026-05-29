/**
 * Auth gate for /api/test-email (eval #11).
 *
 * The endpoint sends email from the caller's Dynamics identity to arbitrary
 * recipients — a privilege-verification test surface its own docstring scopes
 * to superusers. It was guarded by requireAppAccess('dynamics-explorer'), which
 * let any dynamics-explorer user reach it. These tests pin the tightened
 * superuser-only gate.
 *
 * @jest-environment node
 */

import {
  mockAuthenticatedUser,
  mockUnauthenticated,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../../tests/helpers/auth-mock';

const createEmailActivity = jest.fn(async () => 'draft-activity-id');
const createAndSendEmail = jest.fn(async () => ({ emailId: 'sent-email-id' }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    createEmailActivity: (...a) => createEmailActivity(...a),
    createAndSendEmail: (...a) => createAndSendEmail(...a),
  },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (tag, fn) => fn(),
}));

import handler from '../../pages/api/test-email';

beforeEach(() => {
  clearAppAccessCache();
  createEmailActivity.mockClear();
  createAndSendEmail.mockClear();
});

const validBody = (over = {}) => ({ to: 'r@x.org', subject: 'S', body: 'B', from: 'sender@wmkeck.org', ...over });

describe('/api/test-email — superuser-only gate', () => {
  it('405 on non-POST', async () => {
    mockAuthenticatedUser(2, [], { isSuperuser: true });
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects an authenticated NON-superuser (even with dynamics-explorer access) → 403, no email sent', async () => {
    mockAuthenticatedUser(1, ['dynamics-explorer']); // not a superuser
    const req = createMockReq({ method: 'POST', body: validBody() });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(createEmailActivity).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request → 401', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method: 'POST', body: validBody() });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  it('allows a superuser: draft mode creates an email activity', async () => {
    mockAuthenticatedUser(2, [], { isSuperuser: true });
    const req = createMockReq({ method: 'POST', body: validBody({ sendMode: 'draft' }) });
    const res = createMockRes();
    await handler(req, res);
    expect(createEmailActivity).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, status: 'draft' }));
  });

  it('allows a superuser: send mode sends the email', async () => {
    mockAuthenticatedUser(2, [], { isSuperuser: true });
    const req = createMockReq({ method: 'POST', body: validBody({ sendMode: 'send' }) });
    const res = createMockRes();
    await handler(req, res);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, status: 'sent' }));
  });

  it('superuser with missing fields → 400 (gate passed, validation failed)', async () => {
    mockAuthenticatedUser(2, [], { isSuperuser: true });
    const req = createMockReq({ method: 'POST', body: { subject: 'S' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
