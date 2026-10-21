/**
 * A7 prompt-injection hardening test for /api/process-expenses (Part 5, #11).
 *
 * Two paths:
 *  - image receipt → Anthropic image content block (multimodal; the prompt
 *    text carries the preamble and names the attached image).
 *  - PDF receipt → extracted text wrapped with wrapUntrustedContent.
 * Both paths validate parsed output against EXPENSE_EXTRACTION_SCHEMA.
 */

import {
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));

const mockResolve = jest.fn();
jest.mock('../../lib/services/tool-prompt-resolver', () => ({
  ...jest.requireActual('../../lib/services/tool-prompt-resolver'),
  resolveToolPrompt: (...a) => mockResolve(...a),
}));

jest.mock('../../lib/utils/public-blob-fetch', () => ({
  fetchPublicBlob: jest.fn(() => Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  })),
}));

// File processor — PDF path. Return receipt text with an over-cap tail.
jest.mock('../../shared/api/handlers/fileProcessor', () => ({
  createFileProcessor: () => ({
    processFile: jest.fn(async () => ({ text: 'VENDOR: Test Cafe  TOTAL: $12.00 receipt body' })),
  }),
}));

const llmCalls = [];
const ctorArgs = [];
const completeArgs = [];
let mockConstructorError = null;
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation((args) => {
    if (mockConstructorError) throw mockConstructorError;
    ctorArgs.push(args);
    return {
    complete: jest.fn(async (callArgs) => {
      const { messages } = callArgs;
      completeArgs.push(callArgs);
      llmCalls.push(messages);
      return {
        text: JSON.stringify({
          vendor: 'Test Cafe', amount: '$12.00', category: 'Meals & Entertainment',
          confidence: 'high', evilInjectedKey: 'rm -rf',
        }),
        model: 'claude-test',
      };
    }),
    };
  }),
}));

const resolvedFrom = (model, bump) => async (_name, def) => ({
  systemPrompt: def.systemPrompt, body: def.body, model, maxTokens: def.maxTokens + bump, source: 'dataverse', version: 3,
});

beforeEach(() => {
  llmCalls.length = 0;
  ctorArgs.length = 0;
  completeArgs.length = 0;
  mockResolve.mockReset();
  mockResolve.mockImplementation(resolvedFrom('claude-resolved', 7));
  mockConstructorError = null;
  clearAppAccessCache();
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

async function runRoute(body) {
  jest.resetModules();
  mockAuthenticatedUser(2, ['expense-reporter']);
  const handler = (await import('../../pages/api/process-expenses')).default;
  const req = createMockReq({
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body,
  });
  const res = createMockRes();
  res.writeHead = jest.fn();
  await handler(req, res);
  return res;
}

describe('/api/process-expenses A7 hardening (#11)', () => {
  test('PDF path wraps extracted text in untrusted-content sentinels + preamble', async () => {
    await runRoute({ files: [{ filename: 'receipt.pdf', url: 'https://test.public.blob.vercel-storage.com/r.pdf' }] });

    expect(llmCalls.length).toBe(1);
    const prompt = llmCalls[0][0].content; // PDF path sends a plain string
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
    const open = prompt.match(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/);
    expect(open).not.toBeNull();
    expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${open[1]}]]`);
  });

  test('image path carries the multimodal preamble naming the attached image', async () => {
    await runRoute({ files: [{ filename: 'receipt.jpg', url: 'https://test.public.blob.vercel-storage.com/r.jpg' }] });

    expect(llmCalls.length).toBe(1);
    const content = llmCalls[0][0].content; // image path sends content blocks
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].type).toBe('image');
    const textBlock = content.find((b) => b.type === 'text');
    expect(textBlock.text).toContain('UNTRUSTED CONTENT RULES:');
    expect(textBlock.text).toContain('ATTACHED IMAGE');
  });
});

describe('/api/process-expenses error after streaming starts', () => {
  test('sends an error frame and ends the stream instead of throwing', async () => {
    mockConstructorError = new Error('client setup failed');
    jest.resetModules();
    mockAuthenticatedUser(2, ['expense-reporter']);
    const handler = (await import('../../pages/api/process-expenses')).default;
    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: { files: [{ filename: 'receipt.pdf', url: 'https://test.public.blob.vercel-storage.com/r.pdf' }] },
    });
    const res = createMockRes();
    res.writeHead = jest.fn(() => { res.headersSent = true; });
    res.write = jest.fn();
    res.end = jest.fn();

    await expect(handler(req, res)).resolves.not.toThrow();

    const frames = res.write.mock.calls.map(([chunk]) => chunk);
    const errorFrame = frames.find((chunk) => chunk.includes('"type":"error"'));
    expect(errorFrame).toBeDefined();
    expect(JSON.parse(errorFrame.replace(/^data: /, '').trim()).error).toBe('Failed to process document');
    expect(res.end).toHaveBeenCalled();
  });
});

const frames = (res) =>
  res.write.mock.calls.map((c) => c[0]).join('').split('\n\n').filter(Boolean)
    .map((c) => c.replace(/^data: /, ''));

async function runStreaming(files) {
  jest.resetModules();
  mockAuthenticatedUser(2, ['expense-reporter']);
  const handler = (await import('../../pages/api/process-expenses')).default;
  const req = createMockReq({
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: { files },
  });
  const res = createMockRes();
  res.writeHead = jest.fn(() => { res.headersSent = true; });
  res.write = jest.fn();
  res.end = jest.fn();
  await handler(req, res);
  return res;
}

const PDF = { filename: 'receipt.pdf', url: 'https://test.public.blob.vercel-storage.com/r.pdf' };
const IMG = { filename: 'receipt.jpg', url: 'https://test.public.blob.vercel-storage.com/r.jpg' };

describe('/api/process-expenses prompt resolution (convergence Stage 3)', () => {
  test('success frame sequence is progress..., result, [DONE]', async () => {
    const res = await runStreaming([PDF, IMG]);
    const out = frames(res);
    expect(out[out.length - 1]).toBe('[DONE]');
    const types = out.slice(0, -1).map((f) => JSON.parse(f).type);
    expect(types).toEqual(['progress', 'progress', 'progress', 'progress', 'result']);
    const result = JSON.parse(out[out.length - 2]);
    expect(result.expenses).toHaveLength(2);
    expect(Object.keys(result)).toEqual(['type', 'expenses', 'summary', 'processedFiles', 'timestamp']);
  });

  test('both rows resolve once per request; resolved model and max tokens reach both paths', async () => {
    mockResolve.mockImplementation(async (name, def) => resolvedFrom(`m-${name}`, name.endsWith('image') ? 11 : 5)(name, def));
    await runStreaming([PDF, IMG]);
    expect(mockResolve.mock.calls.map((c) => c[0])).toEqual([
      'expense-reporter.extract-document',
      'expense-reporter.extract-image',
    ]);
    expect(ctorArgs.map((a) => [a.model, a.appName])).toEqual([
      ['m-expense-reporter.extract-document', 'expense-reporter'],
      ['m-expense-reporter.extract-image', 'expense-reporter'],
    ]);
    const byType = completeArgs.map((a) => [typeof a.messages[0].content === 'string' ? 'doc' : 'img', a.maxTokens, a.temperature]);
    expect(byType).toHaveLength(2);
    expect(byType).toEqual(expect.arrayContaining([['doc', 1005, 0.2], ['img', 1011, 0.2]]));
  });

  test('a non-empty resolved system prompt is sent as system', async () => {
    mockResolve.mockImplementation(async (_n, def) => ({ systemPrompt: 'SYS', body: def.body, model: 'm', maxTokens: 10 }));
    await runStreaming([PDF]);
    expect(completeArgs[0].system).toBe('SYS');
  });

  test('missing prompt row before streaming returns 503 JSON and never calls the model', async () => {
    mockResolve.mockRejectedValue(Object.assign(new Error('nf'), { code: 'PROMPT_NOT_FOUND' }));
    const res = await runStreaming([PDF]);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res._data).toMatchObject({ code: 'tool_prompt_unavailable', error: expect.stringContaining('Prompt Templates') });
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(completeArgs).toHaveLength(0);
  });

  test('other resolver failure before streaming returns a JSON 500', async () => {
    mockResolve.mockRejectedValue(new Error('unreviewed model'));
    const res = await runStreaming([PDF]);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.writeHead).not.toHaveBeenCalled();
  });
});
