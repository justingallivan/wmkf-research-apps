/**
 * The cron's absolute row budget must reach the real Executor/transport path.
 * External prompt, model discovery, and Dataverse boundaries are mocked; the
 * title cron, wrapper, Executor, and LLMClient remain real.
 *
 * @jest-environment node
 */
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({
  withDalContext: (_tag, fn) => fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryAllRequests: jest.fn(),
  getById: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/ai-run.js', () => ({
  create: jest.fn(async () => ({ wmkf_ai_runid: 'audit-run-id' })),
}));
jest.mock('../../lib/services/prompt-store.js', () => ({
  fetchCurrentPrompt: jest.fn(),
  interpolate: (template, vars) => template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{{${key}}}`
  )),
}));
jest.mock('../../lib/services/model-resolver.js', () => ({
  resolveModel: (value) => value || null,
  resolveModelWithCapabilities: (value) => {
    const { requestCapabilitiesForModel } = require('../../lib/services/model-capabilities');
    const model = value || null;
    return { rawModel: model, model, resolvedId: model, isTier: false, capabilities: requestCapabilitiesForModel(model) };
  },
  loadAvailableModels: jest.fn(async () => []),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { fetchCurrentPrompt } from '../../lib/services/prompt-store.js';
import { runGranteeTitleGeneration } from '../../lib/services/cron/generate-grantee-titles-service.js';

const row = {
  akoya_requestid: 'request-1',
  akoya_requestnum: '1001',
  akoya_title: 'A study of a promising biological pathway',
  wmkf_abstract: 'A sufficiently long abstract describing research and planned experiments. '.repeat(3),
};

const promptRow = {
  wmkf_ai_promptid: 'prompt-title',
  wmkf_ai_promptname: 'grantee-title.generate',
  wmkf_promptversion: '1.0',
  wmkf_ai_systemprompt: 'Write one concise objective.',
  wmkf_ai_promptbody: 'Title: {{source_title}}\nAbstract: {{source_abstract}}',
  wmkf_ai_promptvariables: JSON.stringify({ variables: [
    { name: 'source_title', source: { kind: 'override' }, required: true },
    { name: 'source_abstract', source: { kind: 'override' }, required: true },
  ] }),
  wmkf_ai_promptoutputschema: JSON.stringify({
    outputs: [{ name: 'edited_title', type: 'string', target: { kind: 'none' } }],
    parseMode: 'raw',
  }),
  wmkf_ai_model: 'claude-sonnet-4-6',
  wmkf_ai_maxtokens: 1024,
  wmkf_ai_temperature: 0.1,
};

const args = { cycleCode: 'J26', cycleFilter: 'cycle filter' };
const originalClaudeKey = process.env.CLAUDE_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
  fetchCurrentPrompt.mockResolvedValue(promptRow);
  grantRequestAdapter.queryAllRequests.mockResolvedValue({ records: [row], totalCount: 1 });
  grantRequestAdapter.getById.mockResolvedValue({ wmkf_wmkfprojectdescription: null, _etag: 'etag-1' });
  grantRequestAdapter.updateById.mockResolvedValue({});
});

afterEach(() => {
  jest.useRealTimers();
  if (originalClaudeKey === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = originalClaudeKey;
});

async function startCronAndWaitForProvider(fetchMock) {
  const providerStarted = new Promise((resolve) => {
    fetchMock.mockImplementation((url, init) => {
      resolve({ url, init });
      return new Promise((_resolve, reject) => {
        if (init.signal.aborted) reject(init.signal.reason || new Error('aborted'));
        else init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')), { once: true });
      });
    });
  });
  const run = runGranteeTitleGeneration(args);
  const transport = await providerStarted;
  return { run, transport };
}

describe('cron → wrapper → Executor → LLMClient deadline propagation', () => {
  test('aborts a hanging provider transport at the row deadline and does not write a title', async () => {
    jest.useFakeTimers();
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    try {
      const { run, transport } = await startCronAndWaitForProvider(fetchMock);
      await jest.advanceTimersByTimeAsync(40_000);
      const summary = await run;
      expect(transport.init.signal.aborted).toBe(true);
      expect(summary).toMatchObject({ failed: 1, generated: 0 });
      expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
      expect(grantRequestAdapter.updateById).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      global.fetch = originalFetch;
      jest.useRealTimers();
    }
  });

  test('does not start a 429 retry whose retry-after delay crosses the row deadline', async () => {
    jest.useFakeTimers();
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    let announceFetch;
    const firstFetch = new Promise((resolve) => { announceFetch = resolve; });
    const retryResponse = {
      ok: false,
      status: 429,
      headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '60' : null },
      text: async () => 'rate limited',
      json: async () => ({}),
    };
    global.fetch = jest.fn((_url, init) => {
      fetchCalls += 1;
      announceFetch();
      return Promise.resolve(retryResponse);
    });
    try {
      const run = runGranteeTitleGeneration(args);
      // Let the real client receive the 429 and enter its abort-aware backoff.
      await firstFetch;
      await jest.advanceTimersByTimeAsync(40_000);
      const summary = await run;
      await jest.advanceTimersByTimeAsync(60_000);
      expect(fetchCalls).toBe(1);
      expect(summary).toMatchObject({ failed: 1, generated: 0 });
      expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
      expect(grantRequestAdapter.updateById).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      global.fetch = originalFetch;
      jest.useRealTimers();
    }
  });
});
