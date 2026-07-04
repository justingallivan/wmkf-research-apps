/**
 * Contract test for GET /api/review-manager/download-review — written BEFORE
 * converting its raw DynamicsService.getRecord call to the reviewer-suggestion
 * adapter (data-access-layer migration, Stage 3-6 conversion). Covers the
 * golden path (streamed file) and one failure path (row not found).
 */

import {
  mockUnauthenticated,
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';

import { DynamicsService } from '../../lib/services/dynamics-service';
import { GraphService } from '../../lib/services/graph-service';

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));

jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { downloadFileByPath: jest.fn() },
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  clearAppAccessCache();
  jest.clearAllMocks();
});

describe('/api/review-manager/download-review', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/review-manager/download-review');
    handler = mod.default;
  });

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method: 'GET', query: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });

  it('400s on a non-GUID suggestionId before any Dataverse lookup', async () => {
    mockAuthenticatedUser(1, ['review-manager']);
    const req = createMockReq({ method: 'GET', query: { suggestionId: 'not-a-guid' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });

  it('golden path: looks up the row by the expected select, then streams the file from SharePoint', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_reviewsharepointfolder: 'akoya_request/REQ-1/Reviewer_Uploads/Jane_Doe',
      wmkf_reviewfilename: 'review.pdf',
    });
    GraphService.downloadFileByPath.mockResolvedValue({
      mimeType: 'application/pdf',
      filename: 'review.pdf',
      size: 1234,
      buffer: Buffer.from('pdf-bytes'),
    });

    const req = createMockReq({ method: 'GET', query: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();
    await handler(req, res);

    expect(DynamicsService.getRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      { select: 'wmkf_appreviewersuggestionid,wmkf_reviewsharepointfolder,wmkf_reviewfilename' },
    );
    expect(GraphService.downloadFileByPath).toHaveBeenCalledWith(
      'akoya_request',
      'akoya_request/REQ-1/Reviewer_Uploads/Jane_Doe',
      'review.pdf',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(Buffer.from('pdf-bytes'));
  });

  it('maps a Dataverse 404 to a not_found response', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    DynamicsService.getRecord.mockRejectedValue(new Error('Get record failed (404): {"error":{"message":"not found"}}'));

    const req = createMockReq({ method: 'GET', query: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'not_found' });
    expect(GraphService.downloadFileByPath).not.toHaveBeenCalled();
  });

  it('404s with no_review_on_file when the row has no SharePoint folder', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_reviewsharepointfolder: null,
      wmkf_reviewfilename: null,
    });

    const req = createMockReq({ method: 'GET', query: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'no_review_on_file' });
  });
});
