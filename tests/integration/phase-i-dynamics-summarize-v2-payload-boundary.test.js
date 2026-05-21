/**
 * Handler-level AI payload boundary test for /api/phase-i-dynamics/summarize-v2.
 *
 * The companion v1 route (/api/phase-i-dynamics/summarize) bounds proposal
 * text at the route boundary. This v2 route delegates to the Prompt Executor,
 * which now enforces the cap declaratively via the prompt row's variable
 * metadata (`dataClass: 'proposal_text'`, `maxChars: 100000` on
 * `proposal_text`). The route just hands raw `fileLoad.text` through.
 *
 * This test pins the end-to-end path: drive the handler with over-cap
 * `fileLoad.text`, mock the prompt-row fetch to return the new declaration,
 * and verify the Claude request body contains the Executor source marker
 * and not the over-cap tail.
 */

import { BATCH_PHASE_I_PROPOSAL_MAX_CHARS } from '../../lib/utils/ai-payload-boundary';

// ---------------------------------------------------------------------------
// Module mocks (must be defined before the route is imported)
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
  listAppKeysForUser: jest.fn(() => Promise.resolve(['batch-phase-i-summaries'])),
  listAllGrantsForAdmin: jest.fn(() => Promise.resolve([])),
  grantApps: jest.fn(() => Promise.resolve({ granted: [] })),
  revokeApps: jest.fn(() => Promise.resolve({ revoked: [] })),
}));

// S145 added a loadAvailableModels() warmup call inside the Executor's
// callClaude; the extra /v1/models fetch trips the "exactly one fetch" assert.
jest.mock('../../lib/services/model-resolver', () => ({
  resolveModel: (v) => v || null,
  loadAvailableModels: jest.fn(() => Promise.resolve([])),
}));

jest.mock('@vercel/postgres', () => {
  const handle = (q) => {
    const text = String(q).toLowerCase();
    if (text.includes('user_app_access')) {
      return Promise.resolve({ rows: [{ app_key: 'batch-phase-i-summaries' }], rowCount: 1 });
    }
    if (text.includes('is_active')) {
      return Promise.resolve({ rows: [{ is_active: true }], rowCount: 1 });
    }
    if (text.includes('dynamics_user_roles')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
  const sql = jest.fn((...args) => {
    const queryText = Array.isArray(args[0]) ? args[0].join(' ') : '';
    return handle(queryText);
  });
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

let mockedFileText = '';
jest.mock('../../lib/utils/file-loader', () => ({
  loadFile: jest.fn(async () => ({ text: mockedFileText, filename: 'phase1.pdf' })),
  httpError: jest.fn((res, status, msg) => res.status(status).json({ error: msg })),
  // The Executor calls this for sharepoint variable preprocessing; v2 doesn't
  // exercise that path in this test (proposal_text is `kind: 'override'`).
  extractTextFromBuffer: jest.fn(async () => ''),
}));

// Stub Dynamics — return the v2 prompt row with the new variable declaration.
// The prompt row mirrors what scripts/seed-phase-i-summary-prompt.js will
// upsert once it's run against the live tenant.
const PROMPT_ROW = {
  wmkf_ai_promptid: 'prompt-1',
  wmkf_ai_promptname: 'phase-i.summary',
  wmkf_promptversion: '1.0',
  wmkf_ai_systemprompt: 'You summarize Phase I research proposals.',
  wmkf_ai_promptbody: 'PROPOSAL: {{proposal_text}}\nLENGTH: {{summary_length}}',
  wmkf_ai_promptvariables: JSON.stringify({
    variables: [
      {
        name: 'proposal_text',
        source: { kind: 'override' },
        required: true,
        cacheable: true,
        placement: 'user',
        dataClass: 'proposal_text',
        maxChars: BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
      },
      {
        name: 'summary_length',
        source: { kind: 'override', default: 1 },
        required: false,
      },
      {
        name: 'summary_length_suffix',
        source: { kind: 'override', default: '' },
        required: false,
      },
      {
        name: 'audience_description',
        source: { kind: 'override', default: 'a technical non-expert audience' },
        required: false,
      },
    ],
  }),
  wmkf_ai_promptoutputschema: JSON.stringify({
    outputs: [
      { name: 'summary', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'skip-if-populated' },
    ],
    parseMode: 'raw',
    rawOutputRetention: 'hash',
  }),
  wmkf_ai_model: 'claude-test',
  wmkf_ai_maxtokens: 1024,
  wmkf_ai_temperature: 0.1,
};

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: jest.fn(async () => ({ records: [PROMPT_ROW] })),
    // Request row for output guard check + ETag — return empty wmkf_ai_summary
    // so writeback isn't blocked by the skip-if-populated guard.
    getRecord: jest.fn(async () => ({ wmkf_ai_summary: '', _etag: 'W/"abc"' })),
    updateRecord: jest.fn(async () => ({})),
    createRecord: jest.fn(async () => 'audit-row-id'),
    logAiRun: jest.fn(async () => ({ id: 'audit-1' })),
  },
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((tag, fn) => fn()),
}));

// Capture the body sent to Claude via direct fetch.
const fetchedBodies = [];
const originalFetch = global.fetch;
global.fetch = jest.fn(async (url, init) => {
  fetchedBodies.push({ url, body: init?.body || '' });
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      content: [{ type: 'text', text: 'A multi-paragraph Phase I summary that is well over twenty characters long.' }],
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'claude-test',
      stop_reason: 'end_turn',
    }),
  };
});

// Minimal req/res helpers (independent of auth-mock helper).
function createMockReq({ method, headers = {}, body = {} } = {}) {
  return { method, headers, body, query: {} };
}
function createMockRes() {
  const res = {
    statusCode: 200,
    _headers: {},
    status: jest.fn(function (code) { this.statusCode = code; return this; }),
    json: jest.fn(function (data) { this._data = data; return this; }),
    end: jest.fn(function () { this._ended = true; return this; }),
    setHeader: jest.fn(function (k, v) { this._headers[k] = v; return this; }),
    write: jest.fn(),
  };
  return res;
}

beforeEach(() => {
  fetchedBodies.length = 0;
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('/api/phase-i-dynamics/summarize-v2 payload boundary (Executor-enforced)', () => {
  test('Executor caps proposal_text via prompt-variable metadata; route hands raw text through', async () => {
    mockedFileText = `${'P'.repeat(BATCH_PHASE_I_PROPOSAL_MAX_CHARS + 500)}UNSENT_TAIL`;

    const handler = (await import('../../pages/api/phase-i-dynamics/summarize-v2')).default;

    const req = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: {
        requestGuid: '11111111-1111-1111-1111-111111111111',
        fileRef: {
          source: 'upload',
          fileUrl: 'https://test.public.blob.vercel-storage.com/p.pdf',
          filename: 'phase1.pdf',
        },
        summaryLength: 1,
        summaryLevel: 'technical-non-expert',
      },
    });
    const res = createMockRes();

    await handler(req, res);

    // Sanity — handler reached the Claude call.
    expect(fetchedBodies.length).toBe(1);

    // The Executor's source string is what proves enforcement happened in the
    // Executor (not at the route or in a residual prompt-builder substring).
    const body = fetchedBodies[0].body;
    expect(body).toContain('AI payload boundary: executor.phase-i.summary.proposal_text');
    expect(body).not.toContain('UNSENT_TAIL');

    // Sanity — handler returned 200 (not an early auth/preflight failure).
    expect(res.statusCode).toBe(200);
  });
});
