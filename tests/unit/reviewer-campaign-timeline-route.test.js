/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
  requireSuperuser: jest.fn(),
}));

jest.mock('../../lib/services/reviewer-campaign-timeline', () => ({
  getReviewerCampaignTimeline: jest.fn(),
  setReviewerCampaignTimeline: jest.fn(),
}));

import { requireAppAccess, requireSuperuser } from '../../lib/utils/auth';
import {
  getReviewerCampaignTimeline,
  setReviewerCampaignTimeline,
} from '../../lib/services/reviewer-campaign-timeline';
import handler from '../../pages/api/review-manager/campaign-timeline-defaults';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { id: 1 } } });
  requireSuperuser.mockResolvedValue({ profileId: 42 });
  getReviewerCampaignTimeline.mockResolvedValue({
    key: 'reviewer.campaign_timeline_defaults',
    timeline: { reviewDueDate: '2026-07-22' },
    isDefault: false,
    malformed: false,
  });
  setReviewerCampaignTimeline.mockResolvedValue({
    key: 'reviewer.campaign_timeline_defaults',
    timeline: { reviewDueDate: '2026-07-22' },
    isDefault: false,
    malformed: false,
  });
});

describe('/api/review-manager/campaign-timeline-defaults', () => {
  test('wrong method returns 405 before auth', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, PUT');
    expect(requireAppAccess).not.toHaveBeenCalled();
    expect(requireSuperuser).not.toHaveBeenCalled();
  });

  test('GET is review-manager app-gated and returns defaults', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), res, 'review-manager', 'reviewers');
    expect(requireSuperuser).not.toHaveBeenCalled();
    expect(getReviewerCampaignTimeline).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body.timeline.reviewDueDate).toBe('2026-07-22');
  });

  test('PUT is superuser-gated and saves with profile id', async () => {
    const timeline = { reviewDueDate: '2026-07-22' };
    const res = mockRes();
    await handler({ method: 'PUT', body: { timeline }, headers: {} }, res);
    expect(requireSuperuser).toHaveBeenCalledWith(expect.any(Object), res);
    expect(requireAppAccess).not.toHaveBeenCalled();
    expect(setReviewerCampaignTimeline).toHaveBeenCalledWith(timeline, 42);
    expect(res.statusCode).toBe(200);
  });

  test('PUT validation errors map to 400', async () => {
    setReviewerCampaignTimeline.mockRejectedValueOnce(new Error('reviewDueDate must be a YYYY-MM-DD date or blank'));
    const res = mockRes();
    await handler({ method: 'PUT', body: { timeline: { reviewDueDate: 'bad' } }, headers: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'reviewDueDate must be a YYYY-MM-DD date or blank' });
  });
});
