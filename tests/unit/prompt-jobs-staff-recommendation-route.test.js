/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import handler from '../../pages/api/expertise-finder/recommendations.js';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { readRecommendationsAccessPolicy } from '../../lib/services/prompt-jobs/recommendations-sandbox-policy';
import { readStaffRecommendation } from '../../lib/services/prompt-jobs/staff-recommendations-service';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/prompt-jobs/recommendations-sandbox-policy', () => ({ readRecommendationsAccessPolicy: jest.fn() }));
jest.mock('../../lib/services/prompt-jobs/staff-recommendations-service', () => ({ readStaffRecommendation: jest.fn() }));
const requestId = randomUUID(), jobId = randomUUID();
const staff = { profileId: 7, session: { user: { userType: 'staff', profileId: 7, azureId: randomUUID(), dynamicsSystemuserId: randomUUID() } } };
function res() {
  return { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}
beforeEach(() => {
  jest.clearAllMocks();
  readRecommendationsAccessPolicy.mockReturnValue({});
  requireAppAccess.mockResolvedValue(staff);
  readStaffRecommendation.mockResolvedValue(null);
});

test('returns default-off 404 before auth, DAL or reads, and accepts only GET', async () => {
  readRecommendationsAccessPolicy.mockReturnValue(null);
  const disabled = res();
  await handler({ method: 'GET', query: { requestId, jobId } }, disabled);
  expect(disabled.status).toHaveBeenCalledWith(404);
  expect(disabled.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(requireAppAccess).not.toHaveBeenCalled();
  expect(readStaffRecommendation).not.toHaveBeenCalled();
  const wrongMethod = res();
  await handler({ method: 'POST' }, wrongMethod);
  expect(wrongMethod.status).toHaveBeenCalledWith(405);
  expect(wrongMethod.setHeader).toHaveBeenCalledWith('Allow', 'GET');
});

test.each([{ profileId: null, session: { authBypassed: true } },
  { profileId: 7, session: { user: { ...staff.session.user, userType: 'applicant' } } },
  { profileId: 7, session: { user: { userType: 'staff' } } },
])('rejects unlinked or bypassed identities before DAL', async access => {
  requireAppAccess.mockResolvedValue(access);
  const response = res();
  await handler({ method: 'GET', query: { requestId, jobId } }, response);
  expect(response.status).toHaveBeenCalledWith(403);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(readStaffRecommendation).not.toHaveBeenCalled();
});

test.each([{ requestId: [requestId], jobId }, { requestId, jobId, actor: 'input' }, { requestId, jobId: 'wrong' }])('validates exact scalar selectors', async query => {
  const response = res();
  await handler({ method: 'GET', query }, response);
  expect(response.status).toHaveBeenCalledWith(400);
  expect(readStaffRecommendation).not.toHaveBeenCalled();
});

test('uses expertise guard and returns only the authorized projection', async () => {
  const request = { method: 'GET', query: { requestId: requestId.toUpperCase(), jobId } };
  const response = res();
  const dto = { jobId, requestId, taskKey: 'expertise.recommendations', contractVersion: 'expertise-recommendations-v1', status: 'unavailable', freshness: 'unknown', expiresAt: new Date().toISOString() };
  readStaffRecommendation.mockResolvedValueOnce(dto);
  await handler(request, response);
  expect(requireAppAccess).toHaveBeenCalledWith(request, response, 'expertise-finder');
  expect(readStaffRecommendation).toHaveBeenCalledWith({ requestId, jobId, access: staff });
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith(dto);
  for (const fault of [null, new Error('private diagnostic')]) {
    if (fault) readStaffRecommendation.mockRejectedValueOnce(fault);
    const missing = res();
    await handler(request, missing);
    expect(missing.status).toHaveBeenCalledWith(404);
    expect(missing.json).toHaveBeenCalledWith({ error: 'recommendation_not_found' });
  }
});
