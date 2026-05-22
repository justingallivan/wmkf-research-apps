/**
 * AI payload boundary test for /api/virtual-review-panel.
 *
 * VRP fans out to multiple providers across multiple stages. Every prompt
 * builder receives proposal-derived text from the single `proposalText`
 * argument passed to `runFullPanel`. The route bounds that text once before
 * calling the service; the same bounded text propagates downstream to every
 * stage and every provider. This test verifies that:
 *
 *   1. Every proposal-bearing model call (claim verification × N providers,
 *      structured review × N providers, devil's advocate when enabled) ends up
 *      with the bounded text and the helper's truncation marker — never the
 *      raw tail.
 *   2. Synthesis, which feeds Claude only the parsed reviewer outputs, does
 *      NOT contain proposal text. This pins the assumption that synthesis is
 *      not a roundabout proposal-text leak.
 *   3. The route emits a `payload_boundary` SSE event before the panel runs.
 */

import { VIRTUAL_REVIEW_PANEL_PROPOSAL_MAX_CHARS } from '../../lib/utils/ai-payload-boundary';

// ---------------------------------------------------------------------------
// Module mocks (must be defined before the route is imported)
//
// We do NOT use tests/helpers/auth-mock.js here — its `@vercel/postgres` mock
// only matches against a fixed set of known tables (user_app_access etc.) and
// returns empty rows for `panel_reviews`, which breaks createPanelReview's
// `RETURNING id` read. Inline mocks are simpler than fighting helper override.
// ---------------------------------------------------------------------------

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(() => Promise.resolve({
    user: { profileId: 2, email: 'user@wmkeck.org', name: 'Test User' },
  })),
}));

jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

// Wave 1 closeout (2026-05-12): listAppKeysForUser moved from Postgres to
// a Dataverse-by-default dispatch wrapper. Override the jest.setup.js default
// to grant the app key this test exercises.
jest.mock('../../lib/services/app-access-service', () => ({
  listAppKeysForUser: jest.fn(() => Promise.resolve(['virtual-review-panel'])),
  listAllGrantsForAdmin: jest.fn(() => Promise.resolve([])),
  grantApps: jest.fn(() => Promise.resolve({ granted: [] })),
  revokeApps: jest.fn(() => Promise.resolve({ revoked: [] })),
}));

jest.mock('@vercel/postgres', () => {
  const handle = (queryText) => {
    const q = String(queryText).toLowerCase();
    if (q.includes('user_app_access')) {
      return Promise.resolve({ rows: [{ app_key: 'virtual-review-panel' }], rowCount: 1 });
    }
    if (q.includes('is_active')) {
      return Promise.resolve({ rows: [{ is_active: true }], rowCount: 1 });
    }
    if (q.includes('dynamics_user_roles')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    // Default — used for panel_reviews INSERT/UPDATE/SELECT and panel_review_items.
    return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
  };
  // Tagged-template `sql\`...\`` — args[0] is the strings array.
  const sql = jest.fn((...args) => {
    const queryText = Array.isArray(args[0]) ? args[0].join(' ') : '';
    return handle(queryText);
  });
  // Parameterized `sql.query(text, params)` — used by PanelReviewService.updateReviewItem etc.
  sql.query = jest.fn((text) => handle(text));
  return { sql };
});

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

let mockedPdfText = '';
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: mockedPdfText, numpages: 1 })));

// Stage 0b runs real database searches when intelligence pass is enabled.
// Stub them out — we only care whether the proposal-text-bearing prompts
// (Stage 0a, Stage 0c, Stage 0d) carry the bounded marker.
jest.mock('../../lib/services/literature-search-service', () => ({
  LiteratureSearchService: {
    searchAll: jest.fn(async () => ({
      pubmed: [],
      arxiv: [],
      biorxiv: [],
      chemrxiv: [],
      googleScholar: [],
    })),
  },
}));

// MultiLLMService — every stage calls .call(provider, prompt, opts). Capture
// each call so the assertions can pin which prompts contain proposal text and
// which don't. Returns a JSON-shaped response so each stage's parser succeeds.
const llmCalls = [];
jest.mock('../../lib/services/multi-llm-service', () => ({
  MultiLLMService: {
    getAvailableProviders: jest.fn(() => ['claude', 'openai']),
    getProviderName: jest.fn((p) => ({ claude: 'Claude', openai: 'GPT' }[p] || p)),
    getDefaultModel: jest.fn((p) => ({ claude: 'claude-test', openai: 'gpt-test' }[p] || 'unknown')),
    call: jest.fn(async (provider, prompt) => {
      llmCalls.push({ provider, prompt });
      // Union of fields needed by every stage's parser. Stage 0a checks
      // `claimData.noveltySearchStrings`; Stage 0c just needs parse to succeed;
      // structured review reads overallRating/riskRating/impactRating; synthesis
      // reads its own fields. Returning the union keeps every stage live.
      return {
        text: JSON.stringify({
          // Stage 0a (claim extraction)
          noveltySearchStrings: ['novelty 1'],
          techniqueSearchStrings: ['technique 1'],
          piNames: ['Dr. Test'],
          // Stage 0c (search collation)
          mostRelevantPapers: [],
          activeGroups: [],
          competingApproaches: [],
          // Stage 1 (claim verification)
          claims: [],
          // Stage 2 (structured review)
          overallRating: 'strong',
          riskRating: 'low',
          impactRating: 'high',
          summary: 'test review',
          // Synthesis
          consensus: 'positive',
          disagreements: [],
          openQuestions: [],
        }),
        model: provider === 'claude' ? 'claude-test' : 'gpt-test',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 10,
        citations: null,
      };
    }),
  },
}));

// PanelReviewService DB methods — silent. We do NOT mock the orchestration
// methods (runFullPanel, _runStage, _runSynthesis, _runIntelligencePass) so
// the real proposal-text propagation path runs.

// Minimal req/res helpers (we used to import these from auth-mock).
function createMockReq({ method, headers = {}, body = {} } = {}) {
  return { method, headers, body, query: {} };
}
function createMockRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    status: jest.fn(function (code) { this.statusCode = code; return this; }),
    json: jest.fn(function (data) { this._data = data; return this; }),
    end: jest.fn(function () { this._ended = true; return this; }),
    setHeader: jest.fn(function (k, v) { this._headers[k] = v; return this; }),
    write: jest.fn(),
  };
  return res;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  llmCalls.length = 0;
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
  process.env.NODE_ENV = 'test';
  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
  process.env.VRP_ALLOWED_PROVIDERS = 'claude,openai';
});

afterEach(() => {
  delete process.env.VRP_ALLOWED_PROVIDERS;
});

function makeOverLimit(maxChars) {
  return `${'A'.repeat(maxChars + 500)}UNSENT_TAIL`;
}

function findPayloadBoundaryEvent(res) {
  for (const call of res.write.mock.calls) {
    const chunk = call[0];
    if (typeof chunk !== 'string') continue;
    if (!chunk.includes('"event":"payload_boundary"')) continue;
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
// Test
// ---------------------------------------------------------------------------

describe('/api/virtual-review-panel payload boundary', () => {
  test('caps proposal text once at the route boundary; bounded text propagates to every proposal-bearing stage', async () => {
    mockedPdfText = makeOverLimit(VIRTUAL_REVIEW_PANEL_PROPOSAL_MAX_CHARS);

    const handler = (await import('../../pages/api/virtual-review-panel')).default;

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: {
        files: [{ filename: 'big.pdf', url: 'https://test.public.blob.vercel-storage.com/big.pdf' }],
        providers: ['claude', 'openai'],
        includeClaimVerification: true,
        includeIntelligencePass: false,
        includeDevilsAdvocate: false,
      },
    });
    const res = createMockRes();

    await handler(req, res);

    // Sanity — a non-trivial number of fan-out calls happened.
    // 2 providers × claim_verification + 2 providers × structured_review + 1 synthesis = 5
    expect(llmCalls.length).toBeGreaterThanOrEqual(5);

    // Categorize calls. Synthesis is recognizable as the only `claude` call
    // whose prompt does NOT mention "Research Proposal" or carry the bounded
    // marker — it operates on parsed reviewer outputs.
    const proposalCarryingCalls = llmCalls.filter(c =>
      c.prompt.includes('AI payload boundary: virtual-review-panel.run.proposalText')
    );
    const synthesisCalls = llmCalls.filter(c =>
      !c.prompt.includes('AI payload boundary: virtual-review-panel.run.proposalText')
    );

    // Every proposal-bearing call must use the bounded text — the helper's
    // marker is the load-bearing proof that the text was passed through
    // buildBoundedTextPayload, not handed in raw.
    expect(proposalCarryingCalls.length).toBe(4); // CV×2 + structured×2
    for (const call of proposalCarryingCalls) {
      expect(call.prompt).not.toContain('UNSENT_TAIL');
    }

    // Synthesis call exists and provably does NOT contain proposal text or
    // the tail. Pins the architectural assumption that synthesis isn't a
    // proposal-text leak path.
    expect(synthesisCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of synthesisCalls) {
      expect(call.prompt).not.toContain('UNSENT_TAIL');
      expect(call.prompt).not.toContain('AAAAAAAAAAAAAAAAAAAA'); // raw proposal pattern
    }

    // SSE event surfaced for operator visibility, before the run starts.
    const ev = findPayloadBoundaryEvent(res);
    expect(ev?.aiPayloadBoundary).toEqual(expect.objectContaining({
      source: 'virtual-review-panel.run.proposalText',
      dataClass: 'proposal_text',
      maxChars: VIRTUAL_REVIEW_PANEL_PROPOSAL_MAX_CHARS,
      transmittedChars: VIRTUAL_REVIEW_PANEL_PROPOSAL_MAX_CHARS,
      truncated: true,
    }));
  });

  test('bounded text propagates to optional intelligence-pass and devil\'s-advocate stages when enabled', async () => {
    mockedPdfText = makeOverLimit(VIRTUAL_REVIEW_PANEL_PROPOSAL_MAX_CHARS);

    const handler = (await import('../../pages/api/virtual-review-panel')).default;

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: {
        files: [{ filename: 'big.pdf', url: 'https://test.public.blob.vercel-storage.com/big.pdf' }],
        providers: ['claude', 'openai'],
        // Both optional stages enabled — covers the doc claim.
        includeClaimVerification: true,
        includeIntelligencePass: true,
        includeDevilsAdvocate: true,
      },
    });
    const res = createMockRes();

    await handler(req, res);

    // With intelligence pass + DA enabled, proposal-text-bearing calls are:
    //   Stage 0a (claim extraction, claude) — embeds raw proposal
    //   Stage 1 claim verification × 2 (claude + openai)
    //   Stage 2 structured review × 2 (claude + openai)
    //   Stage 2.5 devil's advocate × 1 (rotated provider)
    // = 6 calls.
    //
    // Calls that do NOT receive raw proposal text (architectural safety
    // feature — proposal funnels through Stage 0a, downstream stages work on
    // extracted metadata):
    //   Stage 0c (search collation) — embeds claimData fields + raw search
    //     results, but not raw proposal
    //   Stage 0d (Perplexity synthesis) — SKIPPED (perplexity not in allowlist)
    //   Synthesis — operates on parsed reviewer outputs only
    const proposalCarrying = llmCalls.filter(c =>
      c.prompt.includes('AI payload boundary: virtual-review-panel.run.proposalText')
    );
    const nonProposal = llmCalls.filter(c =>
      !c.prompt.includes('AI payload boundary: virtual-review-panel.run.proposalText')
    );

    expect(proposalCarrying.length).toBe(6);
    for (const call of proposalCarrying) {
      expect(call.prompt).not.toContain('UNSENT_TAIL');
    }

    // Both Stage 0c (collation) and synthesis must run without raw proposal
    // text. Pin both — neither can leak the over-cap tail.
    expect(nonProposal.length).toBeGreaterThanOrEqual(2);
    for (const call of nonProposal) {
      expect(call.prompt).not.toContain('UNSENT_TAIL');
      expect(call.prompt).not.toContain('AAAAAAAAAAAAAAAAAAAA');
    }

    // Specifically verify Stage 0a (claim extraction) and devil's advocate
    // ran — they're the two stages most likely to silently get skipped under
    // a future refactor.
    const stage0a = proposalCarrying.find(c => c.prompt.includes('extracting search queries'));
    const devilsAdvocate = proposalCarrying.find(c => c.prompt.includes('strongest reasons this proposal should NOT be'));
    expect(stage0a).toBeDefined();
    expect(devilsAdvocate).toBeDefined();
  });

  // A7 Part 5: every proposal-bearing stage prompt carries the hardening
  // preamble and the proposal text sits inside nonce-bearing sentinels.
  test('every proposal-bearing stage carries the untrusted-content preamble + sentinels', async () => {
    mockedPdfText = `${'A'.repeat(2_000)} proposal body`;

    const handler = (await import('../../pages/api/virtual-review-panel')).default;
    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: {
        files: [{ filename: 'p.pdf', url: 'https://test.public.blob.vercel-storage.com/p.pdf' }],
        providers: ['claude', 'openai'],
        includeClaimVerification: true,
        includeIntelligencePass: false,
        includeDevilsAdvocate: true,
      },
    });
    const res = createMockRes();
    await handler(req, res);

    const proposalCarrying = llmCalls.filter(c =>
      c.prompt.includes('[[WMKF-UNTRUSTED-CONTENT nonce=')
    );
    expect(proposalCarrying.length).toBeGreaterThanOrEqual(5); // CV×2 + review×2 + DA
    for (const call of proposalCarrying) {
      expect(call.prompt).toContain('UNTRUSTED CONTENT RULES:');
      const open = call.prompt.match(/\[\[WMKF-UNTRUSTED-CONTENT nonce=([0-9a-f]{24})/);
      expect(open).not.toBeNull();
      expect(call.prompt).toContain(`[[/WMKF-UNTRUSTED-CONTENT nonce=${open[1]}]]`);
    }
  });
});
