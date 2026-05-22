/**
 * A7 prompt-injection hardening test for /api/refine (A7 Part 5, surface #6).
 *
 * The summary being refined is prior LLM output re-fed as input — untrusted.
 * This test confirms the route wraps it in nonce-bearing untrusted-content
 * sentinels and the prompt carries the hardening preamble.
 */

import {
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';
import { REFINE_SUMMARY_MAX_CHARS } from '../../lib/utils/ai-payload-boundary';

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
}));

let capturedMessages = null;
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn(async ({ messages }) => {
      capturedMessages = messages;
      return { text: 'refined summary', model: 'claude-test' };
    }),
  })),
}));

beforeEach(() => {
  capturedMessages = null;
  clearAppAccessCache();
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

describe('/api/refine A7 hardening', () => {
  test('wraps the summary in untrusted-content sentinels with the hardening preamble', async () => {
    mockAuthenticatedUser(7, ['phase-ii-writeup']);
    const handler = (await import('../../pages/api/refine')).default;

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: { currentSummary: 'a generated summary to refine', feedback: 'make it shorter' },
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const prompt = capturedMessages?.[0]?.content || '';
    expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
    const open = prompt.match(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/);
    expect(open).not.toBeNull();
    expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${open[1]}]]`);
    // Staff feedback stays outside the sentinels (it is the trusted instruction).
    expect(prompt).toContain('make it shorter');
  });

  test('caps an over-limit summary at REFINE_SUMMARY_MAX_CHARS', async () => {
    mockAuthenticatedUser(7, ['phase-ii-writeup']);
    const handler = (await import('../../pages/api/refine')).default;

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: {
        currentSummary: `${'A'.repeat(REFINE_SUMMARY_MAX_CHARS + 500)}UNSENT_TAIL`,
        feedback: 'tighten it',
      },
    });
    const res = createMockRes();
    await handler(req, res);

    const prompt = capturedMessages?.[0]?.content || '';
    expect(prompt).not.toContain('UNSENT_TAIL');
    expect(prompt).toContain('AI payload boundary: refine.currentSummary');
  });
});
