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

jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/utils/safe-fetch', () => ({
  safeFetch: jest.fn(() => Promise.resolve({
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
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn(async ({ messages }) => {
      llmCalls.push(messages);
      return {
        text: JSON.stringify({
          vendor: 'Test Cafe', amount: '$12.00', category: 'Meals & Entertainment',
          confidence: 'high', evilInjectedKey: 'rm -rf',
        }),
        model: 'claude-test',
      };
    }),
  })),
}));

beforeEach(() => {
  llmCalls.length = 0;
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
