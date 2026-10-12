/**
 * Unit tests for lib/services/expertise-finder/batch-match-service.js
 * (Stage 5 batch 1). Logic-level; SharePoint adapter, Graph, pdf, sql, and
 * LLM mocked. Pins the explicit ServiceHttpError bodies (the multi-key
 * envelopes) and the resolved-model (no fallback) + usage-logging behavior.
 *
 * @jest-environment node
 */

jest.mock('pdf-parse', () => jest.fn());
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/sharepoint-document-location.js', () => ({
  findByRegardingObject: jest.fn(),
  findByParentIds: jest.fn(),
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { listFiles: jest.fn(), downloadFileByPath: jest.fn() },
}));
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn(),
}));
jest.mock('../../lib/services/tool-prompt-resolver', () => ({
  ...jest.requireActual('../../lib/services/tool-prompt-resolver'),
  resolveToolPrompt: jest.fn(async (_name, def) => ({
    systemPrompt: def.systemPrompt, body: def.body, model: 'claude-resolved', maxTokens: 1234, source: 'bundled', version: null,
  })),
}));
jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
  estimateCostCents: jest.fn(() => 5),
}));

import pdf from 'pdf-parse';
import { sql } from '@vercel/postgres';
import * as locAdapter from '../../lib/dataverse/adapters/sharepoint-document-location.js';
import { GraphService } from '../../lib/services/graph-service';
import { LLMClient } from '../../lib/services/llm-client';
import { logUsage } from '../../lib/utils/usage-logger';
import { resolveToolPrompt } from '../../lib/services/tool-prompt-resolver';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { batchMatch } from '../../lib/services/expertise-finder/batch-match-service';

const ARGS = { requestId: 'req-1', requestNumber: 'R-1000', profileId: 'p-7' };

function primeGoldenPath() {
  locAdapter.findByRegardingObject.mockResolvedValue({
    records: [{ relativeurl: '/sites/x/folder', _parentsiteorlocation_value: 'parent-1' }],
  });
  locAdapter.findByParentIds.mockResolvedValue({ records: [{ relativeurl: 'akoya_request' }] });
  GraphService.listFiles.mockResolvedValue([{ name: 'Phase_I_Staff_Version.pdf' }]);
  GraphService.downloadFileByPath.mockResolvedValue({ buffer: Buffer.from('pdf') });
  pdf.mockResolvedValue({ text: 'A'.repeat(150) });
  sql
    .mockResolvedValueOnce({ rows: [{ name: 'Dr. Roster', role_type: 'reviewer' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'match-1' }] });
  LLMClient.mockImplementation(() => ({
    complete: jest.fn().mockResolvedValue({
      content: [{ text: '{"proposal_summary":{"title":"T"}}' }],
      usage: { inputTokens: 10, outputTokens: 20 },
      model: 'claude-test',
    }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset(); // drop leftover mockResolvedValueOnce queues between tests
  process.env.CLAUDE_API_KEY = 'test-key';
});

describe('batchMatch', () => {
  it('404 with requestNumber body when no SharePoint location is tracked', async () => {
    locAdapter.findByRegardingObject.mockResolvedValue({ records: [] });
    await expect(batchMatch(ARGS)).rejects.toMatchObject({
      httpStatus: 404,
      body: { error: 'No SharePoint document location found for this request', requestNumber: 'R-1000' },
    });
    expect(logUsage).not.toHaveBeenCalled(); // early domain exits never usage-log
  });

  it('404 with folder + availableFiles body when no staff-version PDF exists', async () => {
    locAdapter.findByRegardingObject.mockResolvedValue({
      records: [{ relativeurl: '/f', _parentsiteorlocation_value: null }],
    });
    GraphService.listFiles.mockResolvedValue([{ name: 'other.docx' }]);
    await expect(batchMatch(ARGS)).rejects.toMatchObject({
      httpStatus: 404,
      body: {
        error: 'No Phase_I_Staff_Version PDF found in SharePoint folder',
        requestNumber: 'R-1000', folder: '/f', availableFiles: ['other.docx'],
      },
    });
  });

  it('400 with filename body on an empty PDF', async () => {
    locAdapter.findByRegardingObject.mockResolvedValue({
      records: [{ relativeurl: '/f', _parentsiteorlocation_value: null }],
    });
    GraphService.listFiles.mockResolvedValue([{ name: 'Phase_I_Staff_Version.pdf' }]);
    GraphService.downloadFileByPath.mockResolvedValue({ buffer: Buffer.from('x') });
    pdf.mockResolvedValue({ text: 'short' });
    await expect(batchMatch(ARGS)).rejects.toMatchObject({
      httpStatus: 400,
      body: {
        error: 'PDF appears to be empty or contains insufficient text',
        requestNumber: 'R-1000', filename: 'Phase_I_Staff_Version.pdf',
      },
    });
  });

  it('502 with explicit body when the model output fails schema validation', async () => {
    primeGoldenPath();
    LLMClient.mockImplementation(() => ({
      complete: jest.fn().mockResolvedValue({
        content: [{ text: '[1, 2, 3]' }], // array root — structurally invalid vs the object schema
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'm',
      }),
    }));
    await expect(batchMatch(ARGS)).rejects.toMatchObject({
      httpStatus: 502,
      body: { error: 'Claude returned structurally invalid matching results', requestNumber: 'R-1000' },
    });
  });

  it('golden path: persists the match, logs success usage, returns the full envelope', async () => {
    primeGoldenPath();
    const r = await batchMatch({ ...ARGS, additionalNotes: 'note' });
    expect(r).toMatchObject({
      success: true, matchId: 'match-1', requestNumber: 'R-1000',
      metadata: expect.objectContaining({
        inputTokens: 10, outputTokens: 20, estimatedCostCents: 5,
        rosterSize: 1, filename: 'Phase_I_Staff_Version.pdf',
      }),
    });
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      userProfileId: 'p-7', appName: 'expertise-finder', status: 'success',
    }));
  });

  it('unexpected failures usage-log an error and wrap into a 500 ServiceHttpError', async () => {
    locAdapter.findByRegardingObject.mockRejectedValue(new Error('dataverse down'));
    let caught;
    try { await batchMatch(ARGS); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ServiceHttpError);
    expect(caught.httpStatus).toBe(500);
    expect(caught.body).toMatchObject({ error: 'Failed to process proposal', requestNumber: 'R-1000' });
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', errorMessage: 'dataverse down' }));
  });

  it('calls the LLM once with the resolved model, max tokens and composed prompts; no fallback', async () => {
    primeGoldenPath();
    const complete = jest.fn().mockResolvedValue({
      content: [{ text: '{"proposal_summary":{"title":"T"}}' }],
      usage: { inputTokens: 1, outputTokens: 1 }, model: 'm',
    });
    LLMClient.mockImplementation(() => ({ complete }));
    const r = await batchMatch({ ...ARGS, additionalNotes: 'note' });
    expect(resolveToolPrompt).toHaveBeenCalledWith('expertise-finder.match', expect.objectContaining({ promptName: 'expertise-finder.match' }));
    expect(LLMClient).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-resolved' }));
    const arg = complete.mock.calls[0][0];
    expect(arg.maxTokens).toBe(1234);
    expect(arg.temperature).toBe(0.2);
    expect(arg.system[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    expect(arg.system[0].text).toContain('UNTRUSTED CONTENT RULES:');
    expect(arg.messages[0].content).toContain('## ADDITIONAL CONTEXT FROM USER\nnote');
    expect(r.metadata.model).toBe('claude-resolved');
  });

  it('a provider error is not retried on another model and surfaces as the 500 envelope', async () => {
    primeGoldenPath();
    const complete = jest.fn().mockRejectedValue(new Error('provider down'));
    LLMClient.mockImplementation(() => ({ complete }));
    await expect(batchMatch(ARGS)).rejects.toMatchObject({ httpStatus: 500, body: { error: 'Failed to process proposal' } });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', model: 'claude-resolved' }));
  });

  it.each([
    ['PROMPT_NOT_FOUND', 'not set up yet'],
    ['PROMPT_DUPLICATE_CURRENT', 'more than one current version'],
  ])('a resolver %s surfaces as an actionable 503 and no LLM call', async (code, text) => {
    primeGoldenPath();
    resolveToolPrompt.mockRejectedValueOnce(Object.assign(new Error('no row'), { code }));
    await expect(batchMatch(ARGS)).rejects.toMatchObject({
      httpStatus: 503,
      body: { code: 'tool_prompt_unavailable', error: expect.stringContaining(text), requestNumber: 'R-1000' },
    });
    expect(LLMClient).not.toHaveBeenCalled();
  });
});
