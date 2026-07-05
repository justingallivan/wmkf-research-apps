/**
 * Contract test for POST /api/expertise-finder/batch-match's SharePoint
 * folder-resolution step (the surface converted onto
 * sharepoint-document-location adapter). Golden path: no tracked location →
 * 404 with the documented DTO shape. Failure path: missing requestId → 400,
 * no lookup performed.
 *
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn().mockResolvedValue() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (label, fn) => fn(),
}));
jest.mock('../../lib/dataverse/adapters/sharepoint-document-location.js', () => ({
  findByRegardingObject: jest.fn(),
  findByParentIds: jest.fn(),
}));
jest.mock('pdf-parse', () => jest.fn());
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { listFiles: jest.fn(), downloadFileByPath: jest.fn() },
}));
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({ complete: jest.fn() })),
}));
jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
  estimateCostCents: jest.fn(() => 5),
}));
jest.mock('../../lib/utils/ai-output-schema', () => ({
  validateAiJson: jest.fn((value) => ({ ok: true, value })),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import * as sharepointDocumentLocationAdapter from '../../lib/dataverse/adapters/sharepoint-document-location.js';
import pdf from 'pdf-parse';
import { sql } from '@vercel/postgres';
import { GraphService } from '../../lib/services/graph-service';
import { LLMClient } from '../../lib/services/llm-client';
import { logUsage } from '../../lib/utils/usage-logger';
import handler from '../../pages/api/expertise-finder/batch-match';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p' });
  sharepointDocumentLocationAdapter.findByRegardingObject.mockReset();
  sharepointDocumentLocationAdapter.findByParentIds.mockReset();
  pdf.mockReset();
  sql.mockReset();
  GraphService.listFiles.mockReset();
  GraphService.downloadFileByPath.mockReset();
  logUsage.mockReset();
  process.env.CLAUDE_API_KEY = 'test-key';
});

test('unauth: requireAppAccess short-circuits, no SharePoint lookup', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: 'req-1' } }, res);
  expect(sharepointDocumentLocationAdapter.findByRegardingObject).not.toHaveBeenCalled();
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'expertise-finder');
});

test('golden: full match pipeline — envelope pinned', async () => {
  sharepointDocumentLocationAdapter.findByRegardingObject.mockResolvedValue({
    records: [{ relativeurl: '/sites/x/folder', _parentsiteorlocation_value: 'parent-1' }],
  });
  sharepointDocumentLocationAdapter.findByParentIds.mockResolvedValue({
    records: [{ relativeurl: 'akoya_request' }],
  });
  GraphService.listFiles.mockResolvedValue([{ name: 'Phase_I_Staff_Version.pdf' }]);
  GraphService.downloadFileByPath.mockResolvedValue({ buffer: Buffer.from('pdf-bytes') });
  pdf.mockResolvedValue({ text: 'A'.repeat(150) });
  sql
    .mockResolvedValueOnce({ rows: [{ name: 'Dr. Roster', role_type: 'reviewer' }] }) // roster query
    .mockResolvedValueOnce({ rows: [{ id: 'match-1' }] }); // insert
  const complete = jest.fn().mockResolvedValue({
    content: [{ text: '```json\n{"proposal_summary":{"title":"A Study"}}\n```' }],
    usage: { inputTokens: 10, outputTokens: 20 },
    model: 'claude-test',
  });
  LLMClient.mockImplementation(() => ({ complete }));

  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: 'req-1', requestNumber: 'R-1000' } }, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    success: true,
    matchId: 'match-1',
    requestNumber: 'R-1000',
    results: { proposal_summary: { title: 'A Study' } },
    metadata: {
      model: expect.any(String),
      inputTokens: 10,
      outputTokens: 20,
      estimatedCostCents: 5,
      latencyMs: expect.any(Number),
      rosterSize: 1,
      filename: 'Phase_I_Staff_Version.pdf',
    },
  });
  expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
});

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler({ method: 'GET', body: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('missing requestId → 400, no SharePoint lookup', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: {} }, res);
  expect(res.statusCode).toBe(400);
  expect(sharepointDocumentLocationAdapter.findByRegardingObject).not.toHaveBeenCalled();
});

test('no tracked SharePoint location → 404 with requestNumber echoed', async () => {
  sharepointDocumentLocationAdapter.findByRegardingObject.mockResolvedValue({ records: [] });
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: 'req-1', requestNumber: 'R-1000' } }, res);
  expect(res.statusCode).toBe(404);
  expect(res.body).toEqual({
    error: 'No SharePoint document location found for this request',
    requestNumber: 'R-1000',
  });
  expect(sharepointDocumentLocationAdapter.findByRegardingObject).toHaveBeenCalledWith('req-1', {
    select: 'name,relativeurl,_parentsiteorlocation_value',
  });
});
