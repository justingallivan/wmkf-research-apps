/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(), getUserRole: jest.fn(async () => 'staff') }));
jest.mock('../../lib/services/pre-site-visit/writeup-visibility', () => ({
  resolveWriteupViewer: jest.fn(async (input) => ({ ...input, isCoordinator: false })),
}));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/site-visit/logistics-service', () => ({
  getSiteVisitLogistics: jest.fn(),
  saveSiteVisitLogistics: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { getSiteVisitLogistics } from '../../lib/services/site-visit/logistics-service';
import handler from '../../pages/api/workbench/site-visit/logistics';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

test('Workbench GET returns only visit and materials, even if the service gains extra fields', async () => {
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: REQUEST_ID } } });
  getSiteVisitLogistics.mockResolvedValue({
    siteVisit: { activityId: 'a1' },
    materials: [{ artifactId: 'm1' }],
    applicantAttendees: [{ name: 'Franklin Cat', email: 'franklin@example.edu' }],
    applicantAttendeesUnavailable: false,
  });
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };

  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);

  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
  expect(getSiteVisitLogistics).toHaveBeenCalledWith({ requestId: REQUEST_ID, includePresentationSummaryText: true, writeupViewer: expect.objectContaining({ isSuperuser: false }) });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, siteVisit: { activityId: 'a1' }, materials: [{ artifactId: 'm1' }] });
});

test('Workbench GET passes the presentation summary through only with a ready projection', async () => {
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: REQUEST_ID } } });
  const presentationSummary = { text: 'What was presented', stale: false, publishedAt: '2026-10-05T15:00:00Z' };
  getSiteVisitLogistics.mockResolvedValue({ siteVisit: null, materials: [], presentationMaterialsStatus: 'ready',
    presentationMaterials: [], presentationMaterialConflicts: [], presentationSummary,
    discussionSummary: { text: 'Main points raised', stale: false, publishedAt: '2026-10-06T15:00:00Z' } });
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.body).toMatchObject({ presentationMaterialsStatus: 'ready', presentationSummary,
    discussionSummary: { text: 'Main points raised' } });

  getSiteVisitLogistics.mockResolvedValue({ siteVisit: null, materials: [], presentationMaterialsStatus: 'disabled', presentationSummary });
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.body).not.toHaveProperty('presentationSummary');
});

