/**
 * Route test for pages/api/expertise-finder/match.js: resolver-backed prompt +
 * model, no fallback model (owner decision D4), envelopes unchanged.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('pdf-parse', () => jest.fn());
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/utils/public-blob-fetch', () => ({ fetchPublicBlob: jest.fn() }));
jest.mock('../../lib/services/llm-client', () => ({ LLMClient: jest.fn() }));
jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
  estimateCostCents: jest.fn(() => 5),
}));
jest.mock('../../lib/services/tool-prompt-resolver', () => ({
  resolveToolPrompt: jest.fn(async (_n, def) => ({
    systemPrompt: def.systemPrompt, body: def.body, model: 'claude-resolved', maxTokens: 1234, source: 'dataverse', version: 3,
  })),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import pdf from 'pdf-parse';
import { sql } from '@vercel/postgres';
import { fetchPublicBlob } from '../../lib/utils/public-blob-fetch';
import { LLMClient } from '../../lib/services/llm-client';
import { logUsage } from '../../lib/utils/usage-logger';
import { resolveToolPrompt } from '../../lib/services/tool-prompt-resolver';
import handler from '../../pages/api/expertise-finder/match';

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
}
const req = (extra = {}) => ({ method: 'POST', body: { file: { url: 'https://blob/x.pdf', filename: 'x.pdf' }, ...extra } });
const OK_TEXT = '{"proposal_summary":{"title":"T"},"staff_assignment":{"primary":{"name":"A","rationale":"r"},"secondary":{"name":"B","rationale":"r"}},"consultant_overlap":[],"board_interest":[],"expertise_gaps":{"has_gaps":false,"description":null},"conflicts":[]}';

function prime(complete) {
  fetchPublicBlob.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  pdf.mockResolvedValue({ text: 'A'.repeat(150) });
  sql
    .mockResolvedValueOnce({ rows: [{ name: 'Dr. Roster', role_type: 'Consultant' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'match-1' }] });
  LLMClient.mockImplementation(() => ({ complete }));
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
  requireAppAccess.mockResolvedValue({ profileId: 'p-1' });
  process.env.CLAUDE_API_KEY = 'test-key';
});

test('405 on non-POST', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  expect(res.statusCode).toBe(405);
});

test('calls the LLM once with the resolved model, max tokens and composed prompts; success envelope', async () => {
  const complete = jest.fn().mockResolvedValue({ content: [{ text: OK_TEXT }], usage: { inputTokens: 10, outputTokens: 20 }, model: 'm' });
  prime(complete);
  const res = mockRes();
  await handler(req({ additionalNotes: 'my note' }), res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({
    success: true, matchId: 'match-1',
    metadata: expect.objectContaining({ model: 'claude-resolved', inputTokens: 10, outputTokens: 20, estimatedCostCents: 5, rosterSize: 1 }),
  });
  expect(resolveToolPrompt).toHaveBeenCalledWith('expertise-finder.match', expect.objectContaining({ promptName: 'expertise-finder.match' }));
  expect(LLMClient).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-resolved' }));
  const arg = complete.mock.calls[0][0];
  expect(arg.maxTokens).toBe(1234);
  expect(arg.temperature).toBe(0.2);
  expect(arg.system[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
  expect(arg.system[0].text).toContain('Dr. Roster');
  expect(arg.system[0].text).toContain('UNTRUSTED CONTENT RULES:');
  expect(arg.messages[0].content).toContain('## ADDITIONAL CONTEXT FROM USER\nmy note');
  expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ appName: 'expertise-finder', model: 'claude-resolved', status: 'success' }));
});

test('a provider error is not retried on a fallback model; 500 processing envelope', async () => {
  const complete = jest.fn().mockRejectedValue(new Error('provider down'));
  prime(complete);
  const res = mockRes();
  await handler(req(), res);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(res.statusCode).toBe(500);
  expect(res.body.error).toEqual(expect.any(String));
  expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', model: 'claude-resolved' }));
});

test('a resolver PROMPT_NOT_FOUND yields the same 500 processing envelope and no LLM call', async () => {
  const complete = jest.fn();
  prime(complete);
  resolveToolPrompt.mockRejectedValueOnce(Object.assign(new Error('no row'), { code: 'PROMPT_NOT_FOUND' }));
  const res = mockRes();
  await handler(req(), res);
  expect(res.statusCode).toBe(500);
  expect(complete).not.toHaveBeenCalled();
  expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', model: 'unresolved' }));
});

test('400 when the file is missing', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: {} }, res);
  expect(res.statusCode).toBe(400);
});
