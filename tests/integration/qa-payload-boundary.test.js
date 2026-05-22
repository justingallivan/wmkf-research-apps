/**
 * AI payload boundary tests for /api/qa.
 *
 * Q&A is tool-enabled: proposal context and web search are present in the same
 * Claude session. This test pins the explicit 80k proposal-context boundary
 * before the system prompt is streamed to Claude.
 */

import {
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';
import { QA_PROPOSAL_CONTEXT_MAX_CHARS } from '../../lib/utils/ai-payload-boundary';

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
}));

let capturedStreamArgs = null;
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    stream: jest.fn(async (args) => {
      capturedStreamArgs = args;
      args.onTextDelta?.('answer');
      return {
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        model: 'claude-test',
        stopReason: 'end_turn',
      };
    }),
  })),
}));

beforeEach(() => {
  capturedStreamArgs = null;
  clearAppAccessCache();
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

function makeOverLimit() {
  return `${'A'.repeat(QA_PROPOSAL_CONTEXT_MAX_CHARS + 500)}UNSENT_TAIL`;
}

function parseNamedSseEvents(res) {
  const events = [];
  const chunks = res.write.mock.calls.map(call => call[0]).join('');
  for (const raw of chunks.split('\n\n')) {
    if (!raw.trim()) continue;
    const event = raw.match(/^event: (.+)$/m)?.[1];
    const dataText = raw.match(/^data: (.+)$/m)?.[1];
    if (!event || !dataText) continue;
    events.push({ event, data: JSON.parse(dataText) });
  }
  return events;
}

describe('/api/qa payload boundary', () => {
  test('caps proposal text before building the system prompt and emits non-content metadata', async () => {
    mockAuthenticatedUser(7, ['phase-ii-writeup']);
    const handler = (await import('../../pages/api/qa')).default;

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: {
        question: 'What are the risks?',
        proposalText: makeOverLimit(),
        summaryText: 'Brief summary',
        filename: 'qa.pdf',
        messages: [],
      },
    });
    const res = createMockRes();

    await handler(req, res);

    const systemText = capturedStreamArgs?.system?.[0]?.text || '';
    expect(systemText).toContain('AI payload boundary: qa.system.proposalText');
    expect(systemText).not.toContain('UNSENT_TAIL');

    const events = parseNamedSseEvents(res);
    const boundary = events.find(e => e.event === 'payload_boundary');
    expect(boundary?.data?.aiPayloadBoundary).toEqual(expect.objectContaining({
      source: 'qa.system.proposalText',
      dataClass: 'proposal_text',
      maxChars: QA_PROPOSAL_CONTEXT_MAX_CHARS,
      transmittedChars: QA_PROPOSAL_CONTEXT_MAX_CHARS,
      truncated: true,
    }));

    expect(events.some(e => e.event === 'text_delta' && e.data.text === 'answer')).toBe(true);
    expect(events.some(e => e.event === 'complete')).toBe(true);
  });

  // A7 Part 5: the system prompt wraps proposal text + summary in
  // nonce-bearing untrusted-content sentinels and carries the preamble.
  test('wraps proposal + summary in untrusted-content sentinels with the hardening preamble', async () => {
    mockAuthenticatedUser(7, ['phase-ii-writeup']);
    const handler = (await import('../../pages/api/qa')).default;

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: {
        question: 'What are the risks?',
        proposalText: 'proposal body text',
        summaryText: 'generated summary text',
        filename: 'qa.pdf',
        messages: [],
      },
    });
    const res = createMockRes();
    await handler(req, res);

    const systemText = capturedStreamArgs?.system?.[0]?.text || '';
    expect(systemText).toContain('UNTRUSTED CONTENT RULES:');
    // Two distinct wrapped blocks: proposal + summary, each with its own nonce.
    const nonces = [...systemText.matchAll(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/g)].map(m => m[1]);
    expect(new Set(nonces).size).toBe(2);
    for (const n of nonces) {
      expect(systemText).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${n}]]`);
    }
  });
});

