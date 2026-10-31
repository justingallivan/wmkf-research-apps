/**
 * @jest-environment node
 *
 * Staff "Mark as delivered" (D46/D49): POST /api/review-manager/materials-release-delivered
 * → lib/services/reviewer-engagement/mark-materials-delivered.js. Sends nothing;
 * records the reviewer markers when the row can take them, else closes the
 * release as a staff decision. Only a release at `sent` qualifies.
 */

jest.mock('../../lib/services/reviewer-engagement/materials-release-store', () => ({
  ...require('../helpers/materials-release-store-mock').createMaterialsReleaseStoreMock(),
  getMaterialsRelease: jest.fn(),
  closeSentMaterialsRelease: jest.fn(async () => ({ state: 'recorded' })),
}));
jest.mock('../../lib/services/alert-service', () => ({ __esModule: true, default: { autoResolve: jest.fn(async () => 1) } }));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({ findById: jest.fn() }));
jest.mock('../../lib/services/reviewer-engagement/record-email-outcome', () => ({ recordDeliveredEmail: jest.fn(async () => {}) }));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({ authorizeReviewerRequestMutation: jest.fn(async () => ({})) }));

const store = require('../../lib/services/reviewer-engagement/materials-release-store');
const AlertService = require('../../lib/services/alert-service').default;
const { findById } = require('../../lib/dataverse/adapters/reviewer-suggestion');
const { recordDeliveredEmail } = require('../../lib/services/reviewer-engagement/record-email-outcome');
const { requireAppAccess } = require('../../lib/utils/auth');
const { authorizeReviewerRequestMutation } = require('../../lib/services/reviewer-request-authorization');
const { ServiceHttpError } = require('../../lib/services/service-http-error');
const handler = require('../../pages/api/review-manager/materials-release-delivered').default;

const SUG = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const SENT = { suggestion_id: SUG, request_id: REQ, state: 'sent', sent_at: new Date('2026-10-30T10:00:00.000Z') };

function res() {
  const r = { statusCode: null, body: null, headers: {} };
  r.status = jest.fn((code) => { r.statusCode = code; return r; });
  r.json = jest.fn((body) => { r.body = body; return r; });
  r.setHeader = jest.fn((k, v) => { r.headers[k] = v; });
  return r;
}
const call = async (body, method = 'POST') => { const r = res(); await handler({ method, body }, r); return r; };

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } });
  store.getMaterialsRelease.mockResolvedValue(SENT);
  findById.mockResolvedValue({ _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-1' });
});

test('records the reviewer markers from the persisted sent_at, closes the release, resolves the alert', async () => {
  const r = await call({ suggestionId: SUG });
  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({ ok: true, reviewerRecorded: true });
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({ profileId: 7, callerSystemId: expect.anything(), suggestionIds: [SUG] });
  expect(recordDeliveredEmail).toHaveBeenCalledWith(expect.objectContaining({
    suggestionId: SUG, templateType: 'materials', sentAt: '2026-10-30T10:00:00.000Z',
    originalSuggestion: { _wmkf_request_value: REQ, _wmkf_potentialreviewer_value: 'person-1' },
  }));
  expect(store.recordMaterialsRelease).toHaveBeenCalledWith(SUG);
  expect(store.closeSentMaterialsRelease).not.toHaveBeenCalled();
  expect(AlertService.autoResolve).toHaveBeenCalledWith(`reviewer-materials-release:${SUG}`);
});

test('a reviewer row that cannot take the bookkeeping is closed as a staff decision', async () => {
  recordDeliveredEmail.mockRejectedValueOnce(new Error('Suggestion is closed or has an unknown review status'));
  const r = await call({ suggestionId: SUG });
  expect(r.body).toEqual({ ok: true, reviewerRecorded: false });
  expect(store.closeSentMaterialsRelease).toHaveBeenCalledWith({ suggestionId: SUG, actorProfileId: 7 });
  expect(AlertService.autoResolve).toHaveBeenCalled();
});

test('a suggestion now on another request is closed without writing reviewer markers', async () => {
  findById.mockResolvedValueOnce({ _wmkf_request_value: '99999999-9999-4999-8999-999999999999' });
  const r = await call({ suggestionId: SUG });
  expect(recordDeliveredEmail).not.toHaveBeenCalled();
  expect(r.body).toEqual({ ok: true, reviewerRecorded: false });
});

test.each([null, 'claimed', 'link_minted', 'uncertain', 'failed', 'recorded'])('a release at %s is refused with 409', async (state) => {
  store.getMaterialsRelease.mockResolvedValueOnce(state ? { ...SENT, state } : null);
  const r = await call({ suggestionId: SUG });
  expect(r.statusCode).toBe(409);
  expect(r.body).toMatchObject({ ok: false, reason: 'release_not_sent', state });
  expect(recordDeliveredEmail).not.toHaveBeenCalled();
  expect(store.closeSentMaterialsRelease).not.toHaveBeenCalled();
});

test('a release another path changed mid-way is reported, not overwritten', async () => {
  recordDeliveredEmail.mockRejectedValueOnce(new Error('down'));
  store.closeSentMaterialsRelease.mockResolvedValueOnce(null);
  store.getMaterialsRelease.mockResolvedValueOnce(SENT).mockResolvedValueOnce({ ...SENT, state: 'claimed' });
  const r = await call({ suggestionId: SUG });
  expect(r.statusCode).toBe(409);
  expect(r.body).toMatchObject({ reason: 'release_changed' });
});

test('authorization failure stops before any read or write', async () => {
  authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('foreign', { httpStatus: 403 }));
  const r = await call({ suggestionId: SUG });
  expect(r.statusCode).toBe(403);
  expect(store.getMaterialsRelease).not.toHaveBeenCalled();
});

test('rejects a non-POST and a non-GUID id', async () => {
  expect((await call({ suggestionId: SUG }, 'GET')).statusCode).toBe(405);
  expect((await call({ suggestionId: 'nope' })).statusCode).toBe(400);
  expect(store.getMaterialsRelease).not.toHaveBeenCalled();
});
