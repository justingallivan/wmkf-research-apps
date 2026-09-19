/**
 * Stage 0 characterization suite for pages/api/dynamics-explorer/chat.js.
 *
 * Drives the real handler through the harness's E12 mock set (copied verbatim
 * from tests/integration/dynamics-explorer-tool-serialization.test.js — do
 * NOT edit that file) with extra per-test overrides for document tools,
 * export/AI batch processing, and the restriction-context boundary. Must
 * pass against the unmodified route; these are the discriminating fixtures
 * for every later extraction stage.
 *
 * Plan: docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_PLAN_2026-09-18.md
 * section 4, items 1-7 (including 4b-4g) and item 11.
 */

import {
  clearAppAccessCache,
  createMockReq,
  createMockRes,
  mockAuthenticatedUser,
  setMockSqlResults,
} from '../helpers/auth-mock';
import { withDynamicsContext, getDynamicsContext } from '../../lib/services/dynamics-context';
import { DynamicsService } from '../../lib/services/dynamics-service';

const mockStream = jest.fn();
const mockComplete = jest.fn();
const mockQueryRecords = jest.fn();
const mockCountRecords = jest.fn();
const mockAggregateRecords = jest.fn();
const mockQueryAllRecords = jest.fn();
const mockSearchRecords = jest.fn();
const mockResolveEntitySetName = jest.fn();
const mockGetEntityAttributes = jest.fn();
const mockBuildResolvedTaxonomyPromptBlock = jest.fn(() => Promise.resolve('resolved taxonomy'));
const mockStartRequest = jest.fn(() => Promise.resolve(true));
const mockFinalizeRequest = jest.fn(() => Promise.resolve(true));
const mockListFiles = jest.fn();
const mockSearchFiles = jest.fn();
const mockGetRequestSharePointBuckets = jest.fn();

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../shared/config/baseConfig', () => ({
  BASE_CONFIG: {
    ERROR_MESSAGES: {
      QUERY_FAILED: 'Query failed',
    },
  },
  getModelForApp: jest.fn(() => 'claude-test'),
  getFallbackModelForApp: jest.fn(() => 'claude-fallback-test'),
}));

jest.mock('../../shared/config/prompts/dynamics-explorer', () => {
  const actual = jest.requireActual('../../shared/config/prompts/dynamics-explorer');
  return {
    buildSystemPrompt: jest.fn(() => 'system prompt'),
    TOOL_DEFINITIONS: [{ name: 'query_records' }],
    formatInlineFieldDescription: actual.formatInlineFieldDescription,
    formatInlineRule: actual.formatInlineRule,
    TABLE_ANNOTATIONS: {
      akoya_request: {
        entitySet: 'akoya_requests',
        description: 'Requests',
        fields: {
          akoya_requestid: 'guid — primary key',
          akoya_requestnum: 'string — unique request number',
          wmkf_request_type: 'int option set — 100000001="Request". DEFAULT: filter to wmkf_request_type eq 100000001.',
        },
        rules: ['curated rule', 'DEFAULT FILTER: add wmkf_request_type eq 100000001 to filter to grants only.'],
      },
    },
  };
});

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    resolveLogicalName: (s) => (s === 'akoya_requests' ? 'akoya_request' : s),
    resolveEntitySetName: (...args) => mockResolveEntitySetName(...args),
    queryRecords: (...args) => mockQueryRecords(...args),
    countRecords: (...args) => mockCountRecords(...args),
    aggregateRecords: (...args) => mockAggregateRecords(...args),
    queryAllRecords: (...args) => mockQueryAllRecords(...args),
    searchRecords: (...args) => mockSearchRecords(...args),
    getEntityAttributes: (...args) => mockGetEntityAttributes(...args),
  },
}));

jest.mock('../../lib/services/dynamics-explorer-taxonomy', () => ({
  buildResolvedTaxonomyPromptBlock: (...args) => mockBuildResolvedTaxonomyPromptBlock(...args),
}));

jest.mock('../../lib/services/dynamics-explorer-request-telemetry', () => ({
  DynamicsExplorerRequestTelemetry: {
    startRequest: (...args) => mockStartRequest(...args),
    finalizeRequest: (...args) => mockFinalizeRequest(...args),
  },
  normalizeSessionId: value => (
    typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : null
  ),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  withDynamicsContext: jest.fn((ctx, fn) => fn()),
  bypassDynamicsRestrictions: jest.fn((labelOrFn, maybeFn) => {
    const fn = typeof labelOrFn === 'function' ? labelOrFn : maybeFn;
    return fn();
  }),
  getDynamicsContext: jest.fn(() => ({ restrictions: [], requestId: 'test' })),
}));

// Item 1 needs a real document-links path, so this file's GraphService stub
// is richer than the shared harness's `{}` — a per-test override, not an
// edit to tests/integration/dynamics-explorer-tool-serialization.test.js.
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    listFiles: (...args) => mockListFiles(...args),
    searchFiles: (...args) => mockSearchFiles(...args),
  },
}));

jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: (...args) => mockGetRequestSharePointBuckets(...args),
}));

jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    stream: (...args) => mockStream(...args),
    complete: (...args) => mockComplete(...args),
  })),
}));

// Item 1's export path needs a real Workbook stub; chat.js default-imports
// ExcelJS, and Babel's CJS interop treats a mock factory with no `__esModule`
// flag as the whole default export, so `ExcelJS.Workbook` resolves here.
jest.mock('exceljs', () => ({
  Workbook: jest.fn().mockImplementation(() => ({
    addWorksheet: () => ({ addRow: jest.fn(), columns: [] }),
    xlsx: { writeBuffer: () => Promise.resolve(Buffer.from('fixed-xlsx-bytes')) },
  })),
}));

describe('/api/dynamics-explorer/chat characterization (Stage 0)', () => {
  let handler;

  beforeAll(async () => {
    handler = (await import('../../pages/api/dynamics-explorer/chat')).default;
  });

  beforeEach(() => {
    clearAppAccessCache();
    jest.clearAllMocks();
    process.env.CLAUDE_API_KEY = 'test-key';
    mockStartRequest.mockResolvedValue(true);
    mockFinalizeRequest.mockResolvedValue(true);

    mockAuthenticatedUser(9, ['dynamics-explorer']);
    mockResolveEntitySetName.mockResolvedValue('akoya_requests');
    mockGetEntityAttributes.mockResolvedValue([
      { logicalName: 'akoya_requestid', displayName: 'Request', type: 'Uniqueidentifier', description: '' },
      { logicalName: 'akoya_requestnum', displayName: 'Request Number', type: 'String', description: '' },
      { logicalName: 'wmkf_live_only_field', displayName: 'Live Only Field', type: 'String', description: 'Absent from curated annotations' },
      { logicalName: 'description', displayName: 'Description', type: 'Memo', description: '' },
      { logicalName: 'wmkf_abstract', displayName: 'Abstract', type: 'Memo', description: '' },
      { logicalName: 'normal_field', displayName: 'Normal', type: 'String', description: '' },
      { logicalName: 'statecode', displayName: 'Status', type: 'State', description: '' },
      { logicalName: 'createdon', displayName: 'Created On', type: 'DateTime', description: '' },
      { logicalName: 'regardingobjectid', displayName: 'Regarding', type: 'Lookup', description: '' },
      { logicalName: 'wmkf_potentialreviewer1', displayName: 'Potential Reviewer 1', type: 'Lookup', description: '' },
      { logicalName: 'akoya_applicantid', displayName: 'Applicant', type: 'Lookup', description: 'Applying organization' },
      { logicalName: 'ownerid', displayName: 'Owner', type: 'Owner', description: '' },
      { logicalName: 'wmkf_secret', displayName: 'Secret', type: 'String', description: '' },
    ]);
    mockQueryRecords.mockResolvedValue({
      records: [
        {
          akoya_requestid: 'a1b2c3d4-0000-0000-0000-000000000001',
          akoya_requestnum: 'REQ-123',
          description: 'FULL EMAIL OR MEMO BODY SHOULD NOT REACH CLAUDE',
          wmkf_abstract: `${'A'.repeat(1600)}UNSENT_TAIL`,
          normal_field: 'safe value',
        },
      ],
      count: 1,
      totalCount: 1,
    });
    mockSearchRecords.mockResolvedValue({
      results: [],
      totalCount: 0,
      queryContext: {},
    });
    mockQueryAllRecords.mockResolvedValue({
      records: [{ akoya_requestnum: 'REQ-123', normal_field: 'x' }],
      count: 1,
      totalCount: 1,
      capped: false,
    });
    mockGetRequestSharePointBuckets.mockResolvedValue([
      { library: 'akoya_request', folder: 'REQ-123_ABCDE', source: 'dynamics' },
    ]);
    mockListFiles.mockResolvedValue([
      { name: 'doc1.pdf', size: 1234, mimeType: 'application/pdf', lastModified: '2026-01-01T00:00:00Z', folder: 'REQ-123_ABCDE' },
    ]);
    mockSearchFiles.mockResolvedValue([
      { id: 'f1', name: 'search-result.pdf', size: 222, mimeType: 'application/pdf', lastModified: '2026-01-02T00:00:00Z', library: 'akoya_request', folder: 'REQ-123_ABCDE' },
    ]);
    mockComplete
      .mockResolvedValueOnce({
        text: '{"summary":"x"}',
        usage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 },
      })
      .mockResolvedValueOnce({
        text: '[{"summary":"y"}]',
        usage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });

    mockStream
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'query_records',
            input: {
              table_name: 'akoya_requests',
              select: 'akoya_requestnum,description,wmkf_abstract,normal_field',
              top: 1,
            },
          },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });
  });

  afterEach(() => {
    delete process.env.CLAUDE_API_KEY;
  });

  // ─── Helpers ───

  /** Reassemble the joined SSE stream and split into `event: X\ndata: {...}` blocks. */
  function parseSse(res) {
    const stream = res.write.mock.calls.map(c => c[0]).join('');
    return stream
      .split('\n\n')
      .filter(Boolean)
      .map(block => {
        const lines = block.split('\n');
        const eventLine = lines.find(l => l.startsWith('event: '));
        const dataLine = lines.find(l => l.startsWith('data: '));
        return {
          event: eventLine ? eventLine.slice('event: '.length) : null,
          data: dataLine ? JSON.parse(dataLine.slice('data: '.length)) : null,
        };
      });
  }

  function rawSse(res) {
    return res.write.mock.calls.map(c => c[0]).join('');
  }

  // ─── Item 1: SSE event census ───

  test('item 1: full SSE event census across document, export, blocked, and final-answer rounds', async () => {
    mockStream.mockReset();
    mockStream
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-list', name: 'list_documents', input: { request_number: 'REQ-123' } }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-search', name: 'search_documents', input: { request_number: 'REQ-123', query: 'budget' } }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{
          type: 'tool_use',
          id: 'tool-export',
          name: 'export_csv',
          input: { table_name: 'akoya_requests', process_instruction: 'Summarize', confirmed: true },
        }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-blocked', name: 'query_records', input: { table_name: 'blocked_table' } }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'All done.' }],
        model: 'claude-test',
        usage: {},
        stopReason: 'end_turn',
        textStreamed: false,
      });

    setMockSqlResults({
      dynamics_restrictions: {
        rows: [{ table_name: 'blocked_table', field_name: null, restriction_type: 'table', reason: 'no' }],
      },
    });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'show me everything about REQ-123' }] },
    });
    const res = createMockRes();

    await handler(req, res);
    await new Promise(resolve => setTimeout(resolve, 0));

    const requestId = mockStartRequest.mock.calls[0][0].requestId;
    const blocks = parseSse(res);

    expect(blocks.map(b => b.event)).toEqual([
      'thinking',
      'thinking',
      'document_links',
      'thinking',
      'document_links',
      'thinking',
      'export_progress',
      'file_ready',
      'thinking',
      'response',
      'complete',
    ]);

    expect(Object.keys(blocks[0].data).sort()).toEqual(['message']);
    expect(Object.keys(blocks[2].data).sort()).toEqual(['files', 'requestNumber']);
    expect(Object.keys(blocks[4].data).sort()).toEqual(['files']);
    expect(Object.keys(blocks[6].data).sort()).toEqual(['failed', 'processed', 'total']);
    expect(Object.keys(blocks[7].data).sort()).toEqual(
      ['base64', 'capped', 'columns', 'filename', 'recordCount', 'totalCount'],
    );
    expect(blocks[8].data.message).toMatch(/^Blocked:/);
    expect(Object.keys(blocks[9].data).sort()).toEqual(['content']);
    expect(Object.keys(blocks[10].data).sort()).toEqual(['outcome', 'requestId', 'rounds', 'suggestFeedback']);
    expect(blocks[10].data.requestId).toBe(requestId);
    expect(blocks[10].data.outcome).toBe('completed');

    // document_links, export_progress, and file_ready must actually have fired
    // for both list_documents and search_documents emitters and the export path
    // — a fixture that never exercises them is a wrong test, not a wrong plan.
    expect(blocks.filter(b => b.event === 'document_links')).toHaveLength(2);
    expect(blocks.some(b => b.event === 'export_progress')).toBe(true);
    expect(blocks.some(b => b.event === 'file_ready')).toBe(true);

    const normalized = rawSse(res).split(requestId).join('<REQUEST_ID>');
    expect(normalized).toMatchSnapshot('sse-census-normalized');
  });

  // ─── Item 2: blocked tool path ───

  test('item 2: a restricted table_name yields Blocked thinking, DENIED tool result, and a denied logQuery row', async () => {
    const { sql } = require('@vercel/postgres');
    setMockSqlResults({
      dynamics_restrictions: {
        rows: [{ table_name: 'blocked_table', field_name: null, restriction_type: 'table', reason: 'confidential' }],
      },
    });
    mockStream.mockReset()
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'query_records', input: { table_name: 'blocked_table' } }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'show blocked_table' }] } });
    const res = createMockRes();
    await handler(req, res);
    await new Promise(resolve => setTimeout(resolve, 0));

    const blocks = parseSse(res);
    const blockedThinking = blocks.find(b => b.event === 'thinking' && /^Blocked:/.test(b.data.message));
    expect(blockedThinking.data.message).toBe('Blocked: Table "blocked_table" is restricted');

    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    expect(toolResultMessage.content[0].content).toBe('DENIED: Table "blocked_table" is restricted');

    const queryLogCall = sql.mock.calls.find(call => call[0].join(' ').includes('INSERT INTO dynamics_query_log'));
    expect(queryLogCall).toBeDefined();
    const values = queryLogCall.slice(1);
    expect(values).toEqual(expect.arrayContaining([true, 'Table "blocked_table" is restricted']));
  });

  // ─── Item 3: tool throw path ───

  test('item 3: a rejected tool is classified and the tool_result keeps the original tool_use_id', async () => {
    mockQueryRecords.mockRejectedValue(new Error('boom'));
    mockStream.mockReset()
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-throws', name: 'query_records', input: { table_name: 'akoya_requests' } }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'show requests' }] } });
    const res = createMockRes();
    await handler(req, res);

    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    expect(toolResultMessage.content).toHaveLength(1);
    expect(toolResultMessage.content[0].tool_use_id).toBe('tool-throws');
  });

  // ─── Item 5: logQuery fallback on 42703 ───

  test('item 5: a 42703 rejection on the correlated insert issues the uncorrelated insert once', async () => {
    const { sql } = require('@vercel/postgres');
    setMockSqlResults({ request_round: Object.assign(new Error('col'), { code: '42703' }) });

    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'show requests' }] } });
    const res = createMockRes();
    await handler(req, res);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const logCalls = sql.mock.calls.filter(call => call[0].join(' ').includes('INSERT INTO dynamics_query_log'));
    const correlated = logCalls.filter(c => c[0].join(' ').includes('request_round'));
    const uncorrelated = logCalls.filter(c => !c[0].join(' ').includes('request_round'));
    expect(correlated).toHaveLength(1);
    expect(uncorrelated).toHaveLength(1);
  });

  test('item 5: any other logQuery error warns once and does not retry', async () => {
    const { sql } = require('@vercel/postgres');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setMockSqlResults({ request_round: new Error('some other db error') });

    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'show requests' }] } });
    const res = createMockRes();
    await handler(req, res);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const logCalls = sql.mock.calls.filter(call => call[0].join(' ').includes('INSERT INTO dynamics_query_log'));
    expect(logCalls).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // ─── Item 6: getUserRole fail-soft ───

  test('item 6: a rejected dynamics_user_roles query resolves to read_only', async () => {
    // lib/utils/auth.js's own requireAppAccess superuser check queries the
    // SAME table/text ("SELECT role FROM dynamics_user_roles WHERE
    // user_profile_id = ...") as chat.js's getUserRole, so a blanket
    // setMockSqlResults key would fail auth itself (503) before the route's
    // own getUserRole ever runs. Let auth's own (first) query pass through
    // the default empty-rows result and only reject chat.js's later call.
    const { sql } = require('@vercel/postgres');
    const original = sql.getMockImplementation();
    let userRolesCalls = 0;
    sql.mockImplementation((...args) => {
      const text = args[0].join(' ').toLowerCase();
      if (text.includes('dynamics_user_roles')) {
        userRolesCalls++;
        if (userRolesCalls > 1) return Promise.reject(new Error('x'));
      }
      return original(...args);
    });
    const promptModule = require('../../shared/config/prompts/dynamics-explorer');

    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'show requests' }] } });
    const res = createMockRes();
    await handler(req, res);

    expect(promptModule.buildSystemPrompt.mock.calls[0][0].userRole).toBe('read_only');
    // This test's custom sql.mockImplementation is not cleared by
    // jest.clearAllMocks() (only call history is); restore the default
    // matcher so later tests' dynamics_user_roles reads are not permanently
    // wired to reject.
    sql.mockImplementation(original);
  });

  // ─── Item 7: model resolution order ───

  test('item 7: getModelForApp is not called before loadModelOverrides resolves', async () => {
    const { loadModelOverrides } = require('../../lib/services/model-override-loader');
    const { getModelForApp } = require('../../shared/config/baseConfig');
    let resolveOverrides;
    loadModelOverrides.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveOverrides = resolve; }));

    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'show requests' }] } });
    const res = createMockRes();
    const running = handler(req, res);

    // Poll until loadModelOverrides has actually been invoked (a fixed
    // number of microtask flushes is not robust against the several real
    // awaits — origin check, session, role/restriction loads — ahead of it
    // in the handler).
    while (!resolveOverrides) await new Promise(resolve => setTimeout(resolve, 0));
    expect(getModelForApp).not.toHaveBeenCalled();

    resolveOverrides();
    await running;
    expect(getModelForApp).toHaveBeenCalled();
  });

  // ─── Item 4b-4g: terminal-outcome ordering, disconnect, and error-stage attribution ───
  // Items 4/4a (completed/truncated/refused/max_rounds/abort-during-model/error-at-model)
  // are already covered by tests/integration/dynamics-explorer-tool-serialization.test.js
  // (see plan section 4, item 4) and are not duplicated here.

  describe('item 4: terminal-outcome ordering and error-stage attribution', () => {
    test('4b (textStreamed true): neither response nor complete is written until finalizeRequest resolves', async () => {
      let resolveFinalize;
      mockFinalizeRequest.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveFinalize = resolve; }));
      mockStream.mockReset().mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-test',
        usage: {},
        stopReason: 'end_turn',
        textStreamed: true,
      });

      const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
      const res = createMockRes();
      const running = handler(req, res);

      while (mockFinalizeRequest.mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
      const before = rawSse(res);
      expect(before).not.toContain('event: response');
      expect(before).not.toContain('event: complete');

      resolveFinalize(true);
      await running;

      const after = rawSse(res);
      expect(after).not.toContain('event: response'); // textStreamed true → the fallback response event never fires
      expect(after).toContain('event: complete');
      expect(mockFinalizeRequest).toHaveBeenCalledTimes(1);
      expect(mockFinalizeRequest.mock.calls).toEqual([[{
        requestId: expect.any(String),
        userProfileId: 9,
        sessionId: null,
        outcome: 'completed',
        roundsUsed: 1,
        model: 'claude-test',
        stopReason: 'end_turn',
        errorStage: null,
      }]]);
    });

    test('4b (textStreamed false, non-streamed fallback path): neither response nor complete is written until finalizeRequest resolves', async () => {
      let resolveFinalize;
      mockFinalizeRequest.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveFinalize = resolve; }));
      mockStream.mockReset().mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-test',
        usage: {},
        stopReason: 'end_turn',
        textStreamed: false,
      });

      const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
      const res = createMockRes();
      const running = handler(req, res);

      while (mockFinalizeRequest.mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
      const before = rawSse(res);
      expect(before).not.toContain('event: response');
      expect(before).not.toContain('event: complete');

      resolveFinalize(true);
      await running;

      const after = rawSse(res);
      expect(after).toContain('event: response');
      expect(after).toContain('event: complete');
      expect(mockFinalizeRequest).toHaveBeenCalledTimes(1);
      expect(mockFinalizeRequest.mock.calls).toEqual([[{
        requestId: expect.any(String),
        userProfileId: 9,
        sessionId: null,
        outcome: 'completed',
        roundsUsed: 1,
        model: 'claude-test',
        stopReason: 'end_turn',
        errorStage: null,
      }]]);
    });

    test('4b (max_rounds): neither response nor complete is written until finalizeRequest resolves', async () => {
      let resolveFinalize;
      mockFinalizeRequest.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveFinalize = resolve; }));
      mockStream.mockReset();
      for (let round = 1; round <= 15; round++) {
        mockStream.mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: `tool-${round}`,
            name: 'query_records',
            input: { table_name: 'akoya_requests', select: 'akoya_requestnum', top: 1 },
          }],
          model: 'claude-test',
          usage: {},
          stopReason: 'tool_use',
          textStreamed: false,
        });
      }

      const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
      const res = createMockRes();
      const running = handler(req, res);

      while (mockFinalizeRequest.mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
      const before = rawSse(res);
      expect(before).not.toContain('event: response');
      expect(before).not.toContain('event: complete');

      resolveFinalize(true);
      await running;

      const after = rawSse(res);
      expect(after).toContain('event: response');
      expect(after).toContain('event: complete');
      expect(mockFinalizeRequest).toHaveBeenCalledTimes(1);
      expect(mockFinalizeRequest.mock.calls).toEqual([[{
        requestId: expect.any(String),
        userProfileId: 9,
        sessionId: null,
        outcome: 'max_rounds',
        roundsUsed: 15,
        model: 'claude-test',
        stopReason: 'tool_use',
        errorStage: null,
      }]]);
    });

    test('4c: disconnect observed while a tool call is pending yields exactly two client_disconnected finalize calls and no complete event', async () => {
      const { EventEmitter } = require('events');
      let resolveQuery;
      mockQueryRecords.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveQuery = resolve; }));
      mockStream.mockReset()
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: 'tool-1',
            name: 'query_records',
            input: { table_name: 'akoya_requests', select: 'akoya_requestnum', top: 1 },
          }],
          model: 'claude-test',
          usage: {},
          textStreamed: false,
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'A service that dropped the poll would reach this.' }],
          model: 'claude-test',
          usage: {},
          stopReason: 'end_turn',
          textStreamed: false,
        });

      const req = Object.assign(new EventEmitter(), createMockReq({
        method: 'POST',
        body: { messages: [{ role: 'user', content: 'hi' }] },
      }));
      const res = Object.assign(new EventEmitter(), createMockRes());

      const running = handler(req, res);
      while (mockQueryRecords.mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
      req.emit('aborted');
      // Give the disconnect listener's finalize a turn while the tool promise is still held open.
      await Promise.resolve();
      await Promise.resolve();
      resolveQuery({ records: [{ akoya_requestnum: 'REQ-123' }], count: 1, totalCount: 1 });
      await running;

      const outcomes = mockFinalizeRequest.mock.calls.map(call => call[0].outcome);
      expect(outcomes).toEqual(['client_disconnected', 'client_disconnected']);
      expect(mockStream).toHaveBeenCalledTimes(1);
      expect(rawSse(res)).not.toContain('event: complete');
    });

    test('4d: a rejected buildResolvedTaxonomyPromptBlock finalizes with errorStage context and model null', async () => {
      mockBuildResolvedTaxonomyPromptBlock.mockReset().mockRejectedValueOnce(new Error('taxonomy failed'));

      const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
      const res = createMockRes();
      await handler(req, res);

      expect(mockFinalizeRequest).toHaveBeenCalledTimes(1);
      expect(mockFinalizeRequest.mock.calls[0][0]).toEqual(expect.objectContaining({
        outcome: 'error',
        errorStage: 'context',
        model: null,
      }));
    });

    test('4e: a model response with undefined content throws after resolving, finalizing with errorStage model', async () => {
      mockStream.mockReset().mockResolvedValueOnce({ content: undefined, model: 'claude-test', usage: {} });

      const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
      const res = createMockRes();
      await handler(req, res);

      expect(mockFinalizeRequest).toHaveBeenCalledTimes(1);
      expect(mockFinalizeRequest.mock.calls[0][0]).toEqual(expect.objectContaining({
        outcome: 'error',
        errorStage: 'model',
      }));
    });

    test('4f(a): a round-1 model rejection finalizes with the resolved model and roundsUsed 0', async () => {
      mockStream.mockReset().mockRejectedValueOnce(new Error('boom'));

      const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
      const res = createMockRes();
      await handler(req, res);

      expect(mockFinalizeRequest).toHaveBeenCalledTimes(1);
      expect(mockFinalizeRequest.mock.calls[0][0]).toEqual(expect.objectContaining({
        outcome: 'error',
        errorStage: 'model',
        roundsUsed: 0,
        model: 'claude-test',
      }));
    });

    test('4f(b): an abort observed before the model call is attempted produces two finalize calls, listener with model null and loop-top with the resolved model', async () => {
      const { EventEmitter } = require('events');
      const req = Object.assign(new EventEmitter(), createMockReq({
        method: 'POST',
        body: { messages: [{ role: 'user', content: 'hi' }] },
      }));
      const res = Object.assign(new EventEmitter(), createMockRes());

      // No await point exists between `lastModel = model` and the `claude.stream(...)`
      // call itself (both are synchronous statements), so the only way to land the
      // abort strictly between them is to fire it synchronously from inside the
      // preceding awaited call — buildResolvedTaxonomyPromptBlock — which the route
      // awaits BEFORE resolving `model`. Emitting it there guarantees the listener's
      // finalize (model still null) fires first, and the while-loop's own
      // disconnectObserved check (model now resolved) fires second, with mockStream
      // never invoked at all.
      mockBuildResolvedTaxonomyPromptBlock.mockReset().mockImplementationOnce(() => {
        req.emit('aborted');
        return Promise.resolve('resolved taxonomy');
      });

      await handler(req, res);

      expect(mockStream).not.toHaveBeenCalled();
      expect(mockFinalizeRequest.mock.calls.map(call => call[0].outcome)).toEqual([
        'client_disconnected',
        'client_disconnected',
      ]);
      expect(mockFinalizeRequest.mock.calls[0][0].model).toBeNull();
      expect(mockFinalizeRequest.mock.calls[1][0].model).toBe('claude-test');
    });

    test('4g: a restriction row with table_name null plus an $expand input throws in the pre-flight guard, producing an outer-catch tool-stage error', async () => {
      setMockSqlResults({
        dynamics_restrictions: {
          rows: [{ table_name: null, field_name: null, restriction_type: 'table', reason: 'x' }],
        },
      });
      mockStream.mockReset().mockResolvedValueOnce({
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'query_records',
          input: { table_name: 'akoya_requests', expand: 'y' },
        }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

      const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
      const res = createMockRes();
      await handler(req, res);

      expect(mockFinalizeRequest).toHaveBeenCalledTimes(1);
      expect(mockFinalizeRequest.mock.calls[0][0]).toEqual(expect.objectContaining({
        outcome: 'error',
        errorStage: 'tool',
        roundsUsed: 1,
        model: 'claude-test',
      }));
    });
  });

  // ─── Item 11: restriction context boundary ───

  describe('item 11: restriction context boundary', () => {
    let recordedCtx;
    let active;

    beforeEach(() => {
      recordedCtx = null;
      active = false;
      withDynamicsContext.mockImplementation((ctx, fn) => {
        recordedCtx = ctx;
        active = true;
        return Promise.resolve(fn()).finally(() => { active = false; });
      });
      getDynamicsContext.mockImplementation(() => (active ? recordedCtx : null));

      const guard = impl => (...args) => {
        if (!active) return Promise.reject(new Error('DynamicsService read attempted outside a loaded restriction context'));
        return impl(...args);
      };

      mockQueryRecords.mockImplementation(guard(() => Promise.resolve({
        records: [{ akoya_requestnum: 'REQ-123', normal_field: 'x' }],
        count: 1,
        totalCount: 1,
      })));
      mockCountRecords.mockImplementation(guard(() => Promise.resolve({ count: 1 })));
      mockAggregateRecords.mockImplementation(guard(() => Promise.resolve({ value: 1 })));
      mockQueryAllRecords.mockImplementation(guard(() => Promise.resolve({
        records: [], count: 0, totalCount: 0, capped: false,
      })));
      mockSearchRecords.mockImplementation(guard(() => Promise.resolve({
        results: [], totalCount: 0, queryContext: {},
      })));
      mockResolveEntitySetName.mockImplementation(guard(() => Promise.resolve('akoya_requests')));
      mockGetEntityAttributes.mockImplementation(guard(() => Promise.resolve([
        { logicalName: 'akoya_requestid', displayName: 'Request', type: 'Uniqueidentifier', description: '' },
        { logicalName: 'akoya_requestnum', displayName: 'Request Number', type: 'String', description: '' },
        { logicalName: 'description', displayName: 'Description', type: 'Memo', description: '' },
        { logicalName: 'normal_field', displayName: 'Normal', type: 'String', description: '' },
        { logicalName: 'statecode', displayName: 'Status', type: 'State', description: '' },
      ])));
      // getRecord is not part of the harness's DynamicsService mock (E21: no
      // test today calls it); assign it directly. This mutates the shared
      // mock object for the rest of THIS file's run, but nothing else here
      // calls getRecord.
      DynamicsService.getRecord = jest.fn(guard(() => Promise.resolve({})));
    });

    test('DynamicsService reads happen only inside the withDynamicsContext-loaded scope, with the exact restrictions rows by identity', async () => {
      const restrictionsRow = [{ table_name: 'blocked_table', field_name: null, restriction_type: 'table', reason: 'x' }];
      setMockSqlResults({ dynamics_restrictions: { rows: restrictionsRow } });

      mockStream.mockReset()
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: 'tool-1',
            name: 'query_records',
            input: { table_name: 'akoya_requests', select: 'akoya_requestnum', top: 1 },
          }],
          model: 'claude-test',
          usage: {},
          textStreamed: false,
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Done.' }],
          model: 'claude-test',
          usage: {},
          stopReason: 'end_turn',
          textStreamed: false,
        });

      const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
      const res = createMockRes();
      await handler(req, res);

      const blocks = parseSse(res);
      const completeBlock = blocks.find(b => b.event === 'complete');

      expect(recordedCtx.restrictions).toBe(restrictionsRow);
      expect(recordedCtx.requestId).toBe(completeBlock.data.requestId);
      expect(mockQueryRecords).toHaveBeenCalled();
      expect(completeBlock.data.outcome).toBe('completed');
      expect(rawSse(res)).not.toContain('DynamicsService read attempted outside');
    });

    test('guard sanity: with no active context, a DynamicsService read rejects', async () => {
      await expect(mockQueryRecords('akoya_requests', {})).rejects.toThrow(
        'DynamicsService read attempted outside a loaded restriction context',
      );
    });
  });
});
