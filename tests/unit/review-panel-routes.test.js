/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_caller, fn) => fn()),
}));
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/services/review-panel-service', () => ({
  getReviewPanelPage: jest.fn(),
  reviewPanelAction: jest.fn(),
  downloadReviewPanel: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { getReviewPanelPage, reviewPanelAction, downloadReviewPanel } from '../../lib/services/review-panel-service';
import pageHandler from '../../pages/api/review-panel/index';
import downloadHandler from '../../pages/api/review-panel/download';

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { email: 'super@example.test' } } });
  getReviewPanelPage.mockResolvedValue({ panel: { id: 'p1' }, candidates: [], runs: [], configuration: { ready: false, error: 'awaiting activation' } });
  reviewPanelAction.mockResolvedValue({ run: { id: 'run-1', status: 'queued' } });
  downloadReviewPanel.mockResolvedValue({ bytes: Buffer.from('pdf'), contentType: 'application/pdf', filename: 'ReviewPanel-1001-v1.pdf' });
});

describe('/api/review-panel auth fail-closed', () => {
  test('an unauthenticated request never reaches the service — requireAppAccess itself sends 401 and returns null', async () => {
    requireAppAccess.mockImplementation(async (req, res) => { res.status(401).json({ error: 'Authentication required' }); return null; });
    const res = response();
    await pageHandler({ method: 'GET', query: {}, body: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(getReviewPanelPage).not.toHaveBeenCalled();
  });

  test('a profile without the review-panel app grant never reaches the service — requireAppAccess sends 403 and returns null', async () => {
    requireAppAccess.mockImplementation(async (req, res) => { res.status(403).json({ error: 'No access to this application' }); return null; });
    const res = response();
    await pageHandler({ method: 'GET', query: {}, body: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(getReviewPanelPage).not.toHaveBeenCalled();
  });

  test('a 403 thrown by the service (e.g. its own actor assertion — see review-panel-service.test.js) is propagated verbatim, not swallowed or remapped', async () => {
    getReviewPanelPage.mockRejectedValue(Object.assign(new Error('An active profile with Review Panel access is required.'), { httpStatus: 403 }));
    const res = response();
    await pageHandler({ method: 'GET', query: {}, body: {} }, res);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'review-panel');
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'An active profile with Review Panel access is required.' });
  });
});

test('GET warms model overrides before resolving the page and runs inside DAL context', async () => {
  const res = response();
  await pageHandler({ method: 'GET', query: {}, body: {} }, res);
  expect(loadModelOverrides).toHaveBeenCalled();
  expect(withDalContext).toHaveBeenCalledWith('review-panel', expect.any(Function));
  expect(getReviewPanelPage).toHaveBeenCalledWith(7);
  expect(res.statusCode).toBe(200);
});

test('POST forwards only the action body to the service while identity stays server-derived', async () => {
  const res = response();
  const body = { action: 'launch', selectedRequestIds: ['11111111-1111-4111-8111-111111111111'], idempotencyKey: '22222222-2222-4222-8222-222222222222', profileId: 999 };
  await pageHandler({ method: 'POST', query: {}, body }, res);
  expect(reviewPanelAction).toHaveBeenCalledWith(7, body);
  expect(res.body).toEqual({ run: { id: 'run-1', status: 'queued' } });
});

test('launch is rejected when the rollout is not enabled — the service 503 surfaces verbatim', async () => {
  reviewPanelAction.mockRejectedValue(Object.assign(new Error('The review panel is awaiting activation.'), { httpStatus: 503 }));
  const res = response();
  await pageHandler({ method: 'POST', query: {}, body: { action: 'launch', selectedRequestIds: [] } }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ error: 'The review panel is awaiting activation.' });
});

test('unsupported methods are rejected before touching the service', async () => {
  const res = response();
  await pageHandler({ method: 'DELETE', query: {}, body: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET, POST');
  expect(getReviewPanelPage).not.toHaveBeenCalled();
});

describe('/api/review-panel/download', () => {
  test('authenticates first, derives owner from auth (never from query), warms model overrides, and sets PDF preview headers', async () => {
    const res = response();
    await downloadHandler({ method: 'GET', query: { entryId: 'entry-1', format: 'pdf', profileId: 999 } }, res);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'review-panel');
    expect(loadModelOverrides).toHaveBeenCalled();
    expect(downloadReviewPanel).toHaveBeenCalledWith(7, { entryId: 'entry-1', format: 'pdf', profileId: 999 });
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(res.headers['Content-Disposition']).toBe(`inline; filename="ReviewPanel-1001-v1.pdf"; filename*=UTF-8''ReviewPanel-1001-v1.pdf`);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  test('sets an attachment Content-Disposition (and no X-Frame-Options) for DOCX', async () => {
    downloadReviewPanel.mockResolvedValue({ bytes: Buffer.from('docx'), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'ReviewPanel-1001-v1.docx' });
    const res = response();
    await downloadHandler({ method: 'GET', query: { entryId: 'entry-1', format: 'docx' } }, res);
    expect(res.headers['Content-Disposition']).toBe(`attachment; filename="ReviewPanel-1001-v1.docx"; filename*=UTF-8''ReviewPanel-1001-v1.docx`);
    expect(res.headers['X-Frame-Options']).toBeUndefined();
  });

  test('an unauthenticated download never reaches the service', async () => {
    requireAppAccess.mockImplementation(async (req, res) => { res.status(401).json({ error: 'Authentication required' }); return null; });
    const res = response();
    await downloadHandler({ method: 'GET', query: { entryId: 'entry-1', format: 'pdf' } }, res);
    expect(res.statusCode).toBe(401);
    expect(downloadReviewPanel).not.toHaveBeenCalled();
  });

  test('rejects unsupported methods and preserves a service error', async () => {
    const methodRes = response();
    await downloadHandler({ method: 'POST', query: {} }, methodRes);
    expect(methodRes.statusCode).toBe(405);
    expect(methodRes.headers.Allow).toBe('GET');

    downloadReviewPanel.mockRejectedValue(Object.assign(new Error('Entry not found.'), { httpStatus: 404 }));
    const errorRes = response();
    await downloadHandler({ method: 'GET', query: { entryId: 'entry-1', format: 'docx' } }, errorRes);
    expect(errorRes.statusCode).toBe(404);
    expect(errorRes.body).toEqual({ error: 'Entry not found.' });
  });
});
