/**
 * AI payload boundary test for /api/analyze-funding-gap.
 *
 * The route sends extracted proposal text to Claude for PI/institution/keyword
 * extraction. This pins the explicit boundary before the extraction prompt is
 * built, so future prompt-builder changes cannot quietly widen the payload.
 */

import {
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';
import { FUNDING_GAP_PROPOSAL_MAX_CHARS } from '../../lib/utils/ai-payload-boundary';

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../shared/config/baseConfig', () => ({
  BASE_CONFIG: {
    ERROR_MESSAGES: { PROCESSING_FAILED: 'Processing failed' },
  },
  getModelForApp: jest.fn(() => 'claude-test'),
}));

let mockedProposalText = '';
jest.mock('../../shared/api/handlers/fileProcessor', () => ({
  createFileProcessor: jest.fn(() => ({
    processFile: jest.fn(async () => ({
      text: mockedProposalText,
      metadata: { pages: 12 },
    })),
  })),
}));

jest.mock('../../lib/utils/public-blob-fetch', () => ({
  fetchPublicBlob: jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })),
}));

jest.mock('../../lib/fundingApis', () => ({
  queryNSFforPI: jest.fn(async () => ({
    awards: [],
    totalCount: 0,
    totalFunding: 0,
    error: null,
  })),
  queryNSFforKeywords: jest.fn(async () => ({})),
  queryNIHforPI: jest.fn(async () => ({
    projects: [],
    totalCount: 0,
    totalFunding: 0,
    warnings: [],
    error: null,
  })),
  queryNIHforKeywords: jest.fn(async () => ({})),
  queryUSASpending: jest.fn(async () => ({
    awards: [],
    totalCount: 0,
    totalFunding: 0,
    byAgency: {},
    error: null,
  })),
  formatCurrency: jest.fn(value => `$${value}`),
  formatDate: jest.fn(value => value),
}));

const sentPrompts = [];
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn(async ({ messages }) => {
      const prompt = messages?.[0]?.content ?? '';
      sentPrompts.push(prompt);
      if (prompt.includes('Return only valid JSON')) {
        return {
          text: JSON.stringify({
            pi: 'Jane Researcher',
            institution: 'Example University',
            state: 'CA',
            keywords: ['quantum materials', 'spectroscopy', 'nanofabrication', 'devices', 'sensing'],
          }),
          model: 'claude-test',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      }
      return {
        text: '# Analysis',
        model: 'claude-test',
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    }),
  })),
}));

beforeEach(() => {
  sentPrompts.length = 0;
  clearAppAccessCache();
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

function parseSseData(res) {
  const chunks = res.write.mock.calls.map(call => call[0]).join('');
  return chunks
    .split('\n\n')
    .filter(Boolean)
    .map(chunk => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      return data ? JSON.parse(data) : null;
    })
    .filter(Boolean);
}

describe('/api/analyze-funding-gap payload boundary', () => {
  test('caps extracted proposal text before the Claude extraction prompt', async () => {
    mockedProposalText = `${'P'.repeat(FUNDING_GAP_PROPOSAL_MAX_CHARS + 500)}UNSENT_TAIL`;
    mockAuthenticatedUser(9, ['funding-gap-analyzer']);

    const handler = (await import('../../pages/api/analyze-funding-gap')).default;
    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: {
        files: [{ url: 'https://test.public.blob.vercel-storage.com/proposal.pdf', filename: 'proposal.pdf' }],
        searchYears: 5,
        includeCoPIs: false,
        includeUSASpending: false,
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(sentPrompts.length).toBe(2);
    expect(sentPrompts[0]).toContain('AI payload boundary: funding-gap.extraction.proposalText');
    expect(sentPrompts[0]).not.toContain('UNSENT_TAIL');
    expect(sentPrompts[1]).not.toContain('UNSENT_TAIL');

    const finalEvent = parseSseData(res).find(event => event.complete === true);
    const result = finalEvent?.results?.['proposal.pdf'];
    expect(result?.metadata?.aiPayloadBoundary).toEqual(expect.objectContaining({
      source: 'funding-gap.extraction.proposalText',
      dataClass: 'proposal_text',
      maxChars: FUNDING_GAP_PROPOSAL_MAX_CHARS,
      transmittedChars: FUNDING_GAP_PROPOSAL_MAX_CHARS,
      truncated: true,
    }));
  });
});
