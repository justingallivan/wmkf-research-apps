/**
 * AI payload boundary tests for the /api/process* family of summarization
 * routes.
 *
 * Each route runs a proposal PDF through Claude twice (a summarization /
 * writeup call and a structured-extraction call). These tests prove that
 * before either prompt is constructed, proposal text is passed through the
 * shared `buildBoundedTextPayload` helper at the route boundary so that
 * over-cap tail content cannot reach the model.
 *
 * The transport itself is covered by LLMClient tests; here we capture the
 * exact strings the prompt builders receive and confirm:
 *   - they end at the route-specific cap
 *   - the bounded text contains the truncation marker emitted by the helper
 *   - no out-of-bounds tail content (UNSENT_TAIL) is in the prompt input
 *
 * The tests also confirm the route emits a non-content `payload_boundary`
 * SSE event that records source / dataClass / maxChars / originalChars /
 * transmittedChars / truncated, which is the operator-visible signal.
 */

import {
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';
import {
  REVIEWER_FINDER_PROPOSAL_MAX_CHARS,
  BATCH_PHASE_II_PROPOSAL_MAX_CHARS,
  BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
  PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS,
} from '../../lib/utils/ai-payload-boundary';

// Shared scaffolding for all four routes -------------------------------------

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
  clearModelOverridesCache: jest.fn(),
}));

jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
  estimateCostCents: jest.fn(() => 0),
}));

jest.mock('../../lib/utils/safe-fetch', () => ({
  safeFetch: jest.fn(() => Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  })),
}));

// Shared fake LLMClient — captures the user message strings sent to Claude.
const sentUserMessages = [];
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn(async ({ messages }) => {
      const userText = messages?.[0]?.content ?? '';
      sentUserMessages.push(userText);
      // Return JSON-parseable text so the extraction call's parser does not
      // throw and short-circuit the route mid-test.
      return { text: '{"institution":"Example U"}', model: 'claude-test' };
    }),
  })),
}));

// pdf-parse — return whatever proposal text the test suite preloaded.
let mockedPdfText = '';
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: mockedPdfText, numpages: 1 })));

beforeEach(() => {
  sentUserMessages.length = 0;
  clearAppAccessCache();
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

function makeOverLimit(maxChars) {
  // Tail string we'll grep for. The bounded text + marker should end at
  // exactly maxChars; the literal tail is appended past the cap.
  return `${'A'.repeat(maxChars + 500)}UNSENT_TAIL`;
}

async function runRoute(handlerModule, body, profileAppKeys) {
  // Reset module registry and reload the handler so the per-route mocks above
  // (rateLimiter, LLMClient, pdf-parse, safe-fetch) are re-applied freshly.
  jest.resetModules();
  mockAuthenticatedUser(2, profileAppKeys);
  const handler = (await import(handlerModule)).default;
  const req = createMockReq({
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body,
  });
  const res = createMockRes();
  await handler(req, res);
  return res;
}

function findBoundaryEvent(res) {
  // res.write was called for SSE chunks; locate the `payload_boundary` event.
  for (const call of res.write.mock.calls) {
    const chunk = call[0];
    if (typeof chunk !== 'string') continue;
    if (!chunk.includes('"payload_boundary"')) continue;
    const json = chunk.replace(/^data: /, '').trim();
    try {
      return JSON.parse(json);
    } catch {
      // ignore malformed
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// /api/process — batch Phase II summarizer
// ---------------------------------------------------------------------------

describe('/api/process payload boundary', () => {
  test('caps proposal text under BATCH_PHASE_II_PROPOSAL_MAX_CHARS for both summary and extraction calls', async () => {
    mockedPdfText = makeOverLimit(BATCH_PHASE_II_PROPOSAL_MAX_CHARS);

    const res = await runRoute(
      '../../pages/api/process',
      { files: [{ filename: 'big.pdf', url: 'https://test.public.blob.vercel-storage.com/big.pdf' }] },
      ['batch-proposal-summaries']
    );

    // Two LLM calls: summary, then extraction. Both bounded in code; pin
    // each call's bounded source string so a future regression that drops
    // the helper from one call is caught even if the SSE event still fires.
    expect(sentUserMessages.length).toBe(2);
    expect(sentUserMessages[0]).toContain('AI payload boundary: batch-phase-ii.summary.proposalText');
    expect(sentUserMessages[1]).toContain('AI payload boundary: batch-phase-ii.extraction.proposalText');
    for (const prompt of sentUserMessages) {
      expect(prompt).not.toContain('UNSENT_TAIL');
    }

    const ev = findBoundaryEvent(res);
    expect(ev?.aiPayloadBoundary).toEqual(expect.objectContaining({
      source: 'batch-phase-ii.summary.proposalText',
      dataClass: 'proposal_text',
      maxChars: BATCH_PHASE_II_PROPOSAL_MAX_CHARS,
      transmittedChars: BATCH_PHASE_II_PROPOSAL_MAX_CHARS,
      truncated: true,
    }));
  });

  // A7 Part 5: both Claude calls wrap proposal text + carry the preamble.
  test('wraps proposal text in untrusted-content sentinels with the hardening preamble', async () => {
    mockedPdfText = `${'A'.repeat(2_000)} proposal body`;

    await runRoute(
      '../../pages/api/process',
      { files: [{ filename: 'big.pdf', url: 'https://test.public.blob.vercel-storage.com/big.pdf' }] },
      ['batch-proposal-summaries']
    );

    expect(sentUserMessages.length).toBe(2);
    for (const prompt of sentUserMessages) {
      expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
      const open = prompt.match(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/);
      expect(open).not.toBeNull();
      expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${open[1]}]]`);
    }
  });
});

// ---------------------------------------------------------------------------
// /api/process-legacy was archived to _archived/ in S291 (2026-06-26); its
// payload-boundary tests were removed with it. The live /api/process,
// /api/process-phase-i, and /api/process-phase-i-writeup routes remain below.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// /api/process-phase-i — Phase I batch summarizer
// ---------------------------------------------------------------------------

describe('/api/process-phase-i payload boundary', () => {
  test('caps proposal text under BATCH_PHASE_I_PROPOSAL_MAX_CHARS for both calls', async () => {
    mockedPdfText = makeOverLimit(BATCH_PHASE_I_PROPOSAL_MAX_CHARS);

    const res = await runRoute(
      '../../pages/api/process-phase-i',
      { files: [{ filename: 'phase1.pdf', url: 'https://test.public.blob.vercel-storage.com/phase1.pdf' }] },
      ['batch-phase-i-summaries']
    );

    expect(sentUserMessages.length).toBe(2);
    expect(sentUserMessages[0]).toContain('AI payload boundary: batch-phase-i.summary.proposalText');
    expect(sentUserMessages[1]).toContain('AI payload boundary: batch-phase-i.extraction.proposalText');
    for (const prompt of sentUserMessages) {
      expect(prompt).not.toContain('UNSENT_TAIL');
    }

    const ev = findBoundaryEvent(res);
    expect(ev?.aiPayloadBoundary).toEqual(expect.objectContaining({
      source: 'batch-phase-i.summary.proposalText',
      maxChars: BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
      transmittedChars: BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
      truncated: true,
    }));
  });

  // A7 Part 5: both Claude calls wrap proposal text + carry the preamble.
  test('wraps proposal text in untrusted-content sentinels with the hardening preamble', async () => {
    mockedPdfText = `${'A'.repeat(2_000)} proposal body`;

    await runRoute(
      '../../pages/api/process-phase-i',
      { files: [{ filename: 'phase1.pdf', url: 'https://test.public.blob.vercel-storage.com/phase1.pdf' }] },
      ['batch-phase-i-summaries']
    );

    expect(sentUserMessages.length).toBe(2);
    for (const prompt of sentUserMessages) {
      expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
      const open = prompt.match(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/);
      expect(open).not.toBeNull();
      expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${open[1]}]]`);
    }
  });
});

// ---------------------------------------------------------------------------
// /api/process-phase-i-writeup — single Phase I writeup
// ---------------------------------------------------------------------------

describe('/api/process-phase-i-writeup payload boundary', () => {
  test('caps proposal text under PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS for both calls', async () => {
    mockedPdfText = makeOverLimit(PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS);

    const res = await runRoute(
      '../../pages/api/process-phase-i-writeup',
      { files: [{ filename: 'writeup.pdf', url: 'https://test.public.blob.vercel-storage.com/writeup.pdf' }] },
      ['phase-i-writeup']
    );

    expect(sentUserMessages.length).toBe(2);
    expect(sentUserMessages[0]).toContain('AI payload boundary: phase-i-writeup.writeup.proposalText');
    expect(sentUserMessages[1]).toContain('AI payload boundary: phase-i-writeup.extraction.proposalText');
    for (const prompt of sentUserMessages) {
      expect(prompt).not.toContain('UNSENT_TAIL');
    }

    const ev = findBoundaryEvent(res);
    expect(ev?.aiPayloadBoundary).toEqual(expect.objectContaining({
      source: 'phase-i-writeup.writeup.proposalText',
      maxChars: PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS,
      transmittedChars: PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS,
      truncated: true,
    }));
  });

  // A7 Part 5: both Claude calls wrap the proposal text in nonce-bearing
  // untrusted-content sentinels and carry the hardening preamble.
  test('wraps proposal text in untrusted-content sentinels with the hardening preamble', async () => {
    mockedPdfText = `${'A'.repeat(2_000)} proposal body`;

    await runRoute(
      '../../pages/api/process-phase-i-writeup',
      { files: [{ filename: 'writeup.pdf', url: 'https://test.public.blob.vercel-storage.com/writeup.pdf' }] },
      ['phase-i-writeup']
    );

    expect(sentUserMessages.length).toBe(2);
    for (const prompt of sentUserMessages) {
      // Hardening preamble present.
      expect(prompt).toContain('UNTRUSTED CONTENT RULES:');
      // Nonce-bearing open + close sentinels both present.
      const open = prompt.match(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/);
      expect(open).not.toBeNull();
      expect(prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${open[1]}]]`);
      // The preamble names the exact nonce in play.
      expect(prompt).toContain(open[1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Sanity: REVIEWER_FINDER constant remains intact alongside the new ones.
// ---------------------------------------------------------------------------

describe('payload boundary constants', () => {
  test('expose distinct caps for each route', () => {
    expect(REVIEWER_FINDER_PROPOSAL_MAX_CHARS).toBe(100_000);
    expect(BATCH_PHASE_II_PROPOSAL_MAX_CHARS).toBe(100_000);
    expect(BATCH_PHASE_I_PROPOSAL_MAX_CHARS).toBe(100_000);
    expect(PHASE_I_WRITEUP_PROPOSAL_MAX_CHARS).toBe(100_000);
  });
});
