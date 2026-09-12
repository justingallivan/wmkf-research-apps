/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  getUserRole: jest.fn(),
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/pre-site-visit/artifact-service', () => ({
  generatePreSiteVisitArtifact: jest.fn(),
  getPreSiteVisitArtifactStatus: jest.fn(),
}));
jest.mock('../../lib/services/deliberation-stage-labels', () => ({
  readDeliberationStageLabels: jest.fn(),
}));
jest.mock('../../lib/services/deliberation-briefing/session-reader', () => ({
  getDeliberationSessionForRequest: jest.fn(async () => null),
}));
jest.mock('../../lib/services/site-visit-materials/summary-reader', () => ({
  getMaterialsSummaryForRequest: jest.fn(async () => null),
}));
import { getMaterialsSummaryForRequest } from '../../lib/services/site-visit-materials/summary-reader';
import { getDeliberationSessionForRequest } from '../../lib/services/deliberation-briefing/session-reader';

import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import {
  generatePreSiteVisitArtifact,
  getPreSiteVisitArtifactStatus,
} from '../../lib/services/pre-site-visit/artifact-service';
import { readDeliberationStageLabels } from '../../lib/services/deliberation-stage-labels';
import handler from '../../pages/api/workbench/pre-site-visit';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const STAGE_LABELS = { draft: 'AI draft ready', shared: 'Shared', visit: 'Visit', final: 'Final' };

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const PROFILE_ID = '44444444-4444-4444-8444-444444444444';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

function post(body = { requestId: REQUEST_ID }) {
  return { method: 'POST', body };
}

function get(requestId = REQUEST_ID) {
  return { method: 'GET', query: { requestId } };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: PROFILE_ID,
    session: { user: { dynamicsSystemuserId: '22222222-2222-2222-2222-222222222222' } },
  });
  getUserRole.mockResolvedValue('superuser');
  generatePreSiteVisitArtifact.mockResolvedValue({
    artifact: {
      artifactId: '33333333-3333-3333-3333-333333333333',
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      file: {
        name: '1002379 Pre-Site Visit.docx',
        webUrl: 'https://sharepoint.test/pre-site.docx',
      },
    },
    reused: false,
    recovered: false,
  });
  getPreSiteVisitArtifactStatus.mockResolvedValue({
    currentArtifact: null,
    pendingArtifact: null,
    reopenHistory: [],
  });
  readDeliberationStageLabels.mockResolvedValue(STAGE_LABELS);
});
test('rejects methods other than GET/POST before authentication', async () => {
  const res = mockRes();
  await handler({ method: 'DELETE' }, res);

  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET, POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('reads current/pending status without invoking generation', async () => {
  const currentArtifact = {
    artifactId: '33333333-3333-3333-8333-333333333333',
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
  };
  getPreSiteVisitArtifactStatus.mockResolvedValueOnce({
    currentArtifact,
    pendingArtifact: null,
    reopenHistory: [],
  });
  const res = mockRes();

  await handler(get(), res);

  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-visit', expect.any(Function));
  expect(getPreSiteVisitArtifactStatus).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(generatePreSiteVisitArtifact).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    success: true,
    currentArtifact,
    pendingArtifact: null,
    reopenHistory: [],
    stageLabels: STAGE_LABELS,
    session: null,
    sessionAttendees: [],
    materials: null,
  });
});

test('the GET payload carries the applicant-materials summary (counts and window only; the reader owns the fail-open null)', async () => {
  const summary = { state: 'missing', receivedCount: 1, requiredCount: 3, otherCount: 0, dueAt: '2026-10-05T19:00:00.000Z', closesAt: '2026-10-14T19:00:00.000Z', overdue: false, invited: true };
  getMaterialsSummaryForRequest.mockResolvedValueOnce(summary);
  getPreSiteVisitArtifactStatus.mockResolvedValueOnce({ currentArtifact: null, pendingArtifact: null, reopenHistory: [] });
  const res = mockRes();
  await handler(get(), res);
  expect(getMaterialsSummaryForRequest).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(res.body.materials).toEqual(summary);
  expect(JSON.stringify(res.body)).not.toMatch(/contributorUrl|contacts/);
});

test('the GET payload carries the tracker session line through the briefing seam, reduced to the card shape (fail-open null on error)', async () => {
  getDeliberationSessionForRequest.mockResolvedValueOnce({
    sessionId: 's-1',
    scheduledStartIso: '2026-12-01T18:00:00Z',
    scheduledEndIso: '2026-12-01T18:30:00Z',
    ianaTimeZone: 'America/Los_Angeles',
    meetingLink: 'https://zoom.example/j/1',
    location: '',
    order: 1,
    minutes: 30,
    attendees: [{ name: 'A', email: 'a@example.org' }],
  });
  getPreSiteVisitArtifactStatus.mockResolvedValueOnce({ currentArtifact: null, pendingArtifact: null, reopenHistory: [] });
  const res = mockRes();
  await handler(get(), res);
  expect(getDeliberationSessionForRequest).toHaveBeenCalledWith(REQUEST_ID);
  expect(res.body.session).toEqual({
    scheduledStartIso: '2026-12-01T18:00:00Z',
    scheduledEndIso: '2026-12-01T18:30:00Z',
    ianaTimeZone: 'America/Los_Angeles',
    meetingLink: 'https://zoom.example/j/1',
    location: null,
  });
  expect(res.body.session).not.toHaveProperty('attendees');
  // Tracker §5.6: attendees ride alongside as the Share email's default recipients, lowercased and email-only.
  expect(res.body.sessionAttendees).toEqual([{ name: 'A', email: 'a@example.org' }]);

  getDeliberationSessionForRequest.mockRejectedValueOnce(new Error('tracker down'));
  getPreSiteVisitArtifactStatus.mockResolvedValueOnce({ currentArtifact: null, pendingArtifact: null, reopenHistory: [] });
  const failed = mockRes();
  await handler(get(), failed);
  expect(failed.statusCode).toBe(200);
  expect(failed.body.session).toBeNull();
});

test('adds stageLabels to the GET success payload from the shared admin-editable catalog', async () => {
  readDeliberationStageLabels.mockResolvedValueOnce({ draft: 'Custom draft label', shared: 'Shared', visit: 'Visit', final: 'Final' });
  const res = mockRes();
  await handler(get(), res);
  expect(readDeliberationStageLabels).toHaveBeenCalledTimes(1);
  expect(res.body.stageLabels).toEqual({ draft: 'Custom draft label', shared: 'Shared', visit: 'Visit', final: 'Final' });
});

test('omits guarded-reopen audit history for non-superusers', async () => {
  getUserRole.mockResolvedValueOnce('staff');
  getPreSiteVisitArtifactStatus.mockResolvedValueOnce({
    currentArtifact: {
      artifactId: 'current-artifact',
      correction: { reasonNote: 'Restricted note', actorName: 'Test Admin' },
    },
    pendingArtifact: {
      artifactId: 'pending-artifact',
      correction: {
        cycleId: 'restricted-cycle',
        reasonCode: 'accidental_handoff',
      },
    },
    reopenHistory: [{ artifactId: 'restricted-audit-row' }],
  });
  const res = mockRes();

  await handler(get(), res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    success: true,
    currentArtifact: { artifactId: 'current-artifact' },
    pendingArtifact: null,
    stageLabels: STAGE_LABELS,
    session: null,
    sessionAttendees: [],
    materials: null,
  });
});

test('keeps a regular pending generation visible to non-superusers without correction details', async () => {
  getUserRole.mockResolvedValueOnce('staff');
  getPreSiteVisitArtifactStatus.mockResolvedValueOnce({
    currentArtifact: null,
    pendingArtifact: {
      artifactId: 'pending-generation',
      correction: { cycleId: 'inherited-cycle', reasonCode: null },
    },
    reopenHistory: [],
  });
  const res = mockRes();

  await handler(get(), res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    success: true,
    currentArtifact: null,
    pendingArtifact: { artifactId: 'pending-generation' },
    stageLabels: STAGE_LABELS,
    session: null,
    sessionAttendees: [],
    materials: null,
  });
});

test('omits correction audit details from a non-superuser generation response', async () => {
  getUserRole.mockResolvedValueOnce('staff');
  generatePreSiteVisitArtifact.mockResolvedValueOnce({
    artifact: {
      artifactId: '33333333-3333-3333-8333-333333333333',
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      correction: {
        cycleId: '55555555-5555-4555-8555-555555555555',
        reasonNote: 'Restricted note',
        actorId: '66666666-6666-4666-8666-666666666666',
      },
    },
    reused: false,
    recovered: false,
  });
  const res = mockRes();

  await handler(post(), res);

  expect(res.statusCode).toBe(200);
  expect(res.body.artifact).toEqual({
    artifactId: '33333333-3333-3333-8333-333333333333',
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
  });
});

test('rejects an invalid GET request id before reading status', async () => {
  const res = mockRes();
  await handler(get('not-a-guid'), res);

  expect(res.statusCode).toBe(400);
  expect(getPreSiteVisitArtifactStatus).not.toHaveBeenCalled();
  expect(generatePreSiteVisitArtifact).not.toHaveBeenCalled();
});

test('short-circuits an unauthorized caller before generation', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  await handler(post(), mockRes());

  expect(generatePreSiteVisitArtifact).not.toHaveBeenCalled();
});

test.each([
  [null, 'missing body'],
  [{ requestId: REQUEST_ID, model: 'claude-opus-4-8' }, 'extra model override'],
  [{ requestId: 'not-a-guid' }, 'invalid request id'],
])('rejects %s (%s) before generation', async (body) => {
  const res = mockRes();
  await handler(post(body), res);

  expect(res.statusCode).toBe(400);
  expect(generatePreSiteVisitArtifact).not.toHaveBeenCalled();
});

test('generates through the durable service and returns the governed artifact identity', async () => {
  const res = mockRes();
  await handler(post(), res);

  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-visit', expect.any(Function));
  expect(generatePreSiteVisitArtifact).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    actingUserSystemId: '22222222-2222-2222-2222-222222222222',
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({
    success: true,
    artifact: {
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      file: { webUrl: 'https://sharepoint.test/pre-site.docx' },
    },
  });
});

test('returns 202 when another owned generation is still active', async () => {
  generatePreSiteVisitArtifact.mockResolvedValueOnce({
    artifact: { operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING },
    reused: true,
    recovered: false,
  });
  const res = mockRes();
  await handler(post(), res);

  expect(res.statusCode).toBe(202);
  expect(res.body.success).toBe(true);
});

test('maps governed service errors', async () => {
  generatePreSiteVisitArtifact.mockRejectedValueOnce(new ServiceHttpError(
    'The governed prompt is unavailable.',
    { httpStatus: 409, code: 'prompt_unavailable' },
  ));
  const res = mockRes();
  await handler(post(), res);

  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({
    error: 'The governed prompt is unavailable.',
    code: 'prompt_unavailable',
  });
});
