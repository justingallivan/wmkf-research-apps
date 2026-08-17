/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/pre-site-visit/proposal-core-service', () => ({
  generatePreSiteVisitProposalCore: jest.fn(),
}));
jest.mock('../../lib/services/pre-site-visit/docx-renderer', () => ({
  renderPreSiteVisitDocx: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { generatePreSiteVisitProposalCore } from '../../lib/services/pre-site-visit/proposal-core-service';
import { renderPreSiteVisitDocx } from '../../lib/services/pre-site-visit/docx-renderer';
import handler from '../../pages/api/workbench/pre-site-visit';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const DOCX = Buffer.from('docx-bytes');

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

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    session: { user: { dynamicsSystemuserId: '22222222-2222-2222-2222-222222222222' } },
  });
  generatePreSiteVisitProposalCore.mockResolvedValue({
    proposalCore: { executiveSummary: 'Generated core.' },
    context: {
      requestNumber: '1002379',
      documentFields: { institutionName: 'St. Jude Childrens Research Hospital' },
    },
  });
  renderPreSiteVisitDocx.mockResolvedValue(DOCX);
});
test('rejects non-POST methods before authentication', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);

  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('short-circuits an unauthorized caller before generation', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  await handler(post(), mockRes());

  expect(generatePreSiteVisitProposalCore).not.toHaveBeenCalled();
  expect(renderPreSiteVisitDocx).not.toHaveBeenCalled();
});

test.each([
  [null, 'missing body'],
  [{ requestId: REQUEST_ID, model: 'claude-opus-4-8' }, 'extra model override'],
  [{ requestId: 'not-a-guid' }, 'invalid request id'],
])('rejects %s (%s) before generation', async (body) => {
  const res = mockRes();
  await handler(post(body), res);

  expect(res.statusCode).toBe(400);
  expect(generatePreSiteVisitProposalCore).not.toHaveBeenCalled();
  expect(renderPreSiteVisitDocx).not.toHaveBeenCalled();
});

test('generates through the governed service and streams a safe DOCX attachment', async () => {
  const res = mockRes();
  await handler(post(), res);

  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-visit', expect.any(Function));
  expect(generatePreSiteVisitProposalCore).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    actingUserSystemId: '22222222-2222-2222-2222-222222222222',
    runSource: 'Request Workbench - Pre-Site Visit',
  });
  expect(generatePreSiteVisitProposalCore.mock.calls[0][0]).not.toHaveProperty('model');
  expect(renderPreSiteVisitDocx).toHaveBeenCalledWith({
    documentFields: { institutionName: 'St. Jude Childrens Research Hospital' },
    proposalCore: { executiveSummary: 'Generated core.' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers).toMatchObject({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': 'attachment; filename="Phase II Pre-Site Visit Writeup 1002379.docx"',
    'Content-Length': DOCX.length,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  expect(res.body).toBe(DOCX);
});

test('maps governed service errors without attempting a render', async () => {
  generatePreSiteVisitProposalCore.mockRejectedValueOnce(new ServiceHttpError(
    'The governed prompt is unavailable.',
    { httpStatus: 409, code: 'prompt_unavailable' },
  ));
  const res = mockRes();
  await handler(post(), res);

  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({ error: 'The governed prompt is unavailable.' });
  expect(renderPreSiteVisitDocx).not.toHaveBeenCalled();
});
