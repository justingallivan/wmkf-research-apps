import {
  clearAppAccessCache,
  createMockReq,
  createMockRes,
  mockAuthenticatedUser,
  setMockSqlResults,
} from '../helpers/auth-mock';

const mockStream = jest.fn();
const mockQueryRecords = jest.fn();
const mockResolveEntitySetName = jest.fn();
const mockGetEntityAttributes = jest.fn();
const mockBuildResolvedTaxonomyPromptBlock = jest.fn(() => Promise.resolve('resolved taxonomy'));

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
  // Use the REAL inline-render sanitizers so the describe_table no-leak
  // assertion actually exercises them (chat.js now applies them to curated
  // fields/rules). buildSystemPrompt/TOOL_DEFINITIONS/TABLE_ANNOTATIONS stay
  // mocked.
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
          // Carries the stale hardcoded option-set code the A2 sanitizer must strip.
          wmkf_request_type: 'int option set — 100000001="Request". DEFAULT: filter to wmkf_request_type eq 100000001.',
        },
        rules: ['curated rule', 'DEFAULT FILTER: add wmkf_request_type eq 100000001 to filter to grants only.'],
      },
    },
  };
});

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    resolveEntitySetName: (...args) => mockResolveEntitySetName(...args),
    queryRecords: (...args) => mockQueryRecords(...args),
    getEntityAttributes: (...args) => mockGetEntityAttributes(...args),
  },
}));

jest.mock('../../lib/services/dynamics-explorer-taxonomy', () => ({
  buildResolvedTaxonomyPromptBlock: (...args) => mockBuildResolvedTaxonomyPromptBlock(...args),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  withDynamicsContext: jest.fn((ctx, fn) => fn()),
}));

jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {},
}));

jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: jest.fn(),
}));

jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation(() => ({
    stream: (...args) => mockStream(...args),
  })),
}));

jest.mock('exceljs', () => ({}));

describe('/api/dynamics-explorer/chat tool-result serialization', () => {
  let handler;

  beforeAll(async () => {
    handler = (await import('../../pages/api/dynamics-explorer/chat')).default;
  });

  beforeEach(() => {
    clearAppAccessCache();
    jest.clearAllMocks();
    process.env.CLAUDE_API_KEY = 'test-key';

    mockAuthenticatedUser(9, ['dynamics-explorer']);
    mockResolveEntitySetName.mockResolvedValue('akoya_requests');
    mockGetEntityAttributes.mockResolvedValue([
      { logicalName: 'akoya_requestid', displayName: 'Request', type: 'Uniqueidentifier', description: '' },
      { logicalName: 'akoya_requestnum', displayName: 'Request Number', type: 'String', description: '' },
      { logicalName: 'wmkf_live_only_field', displayName: 'Live Only Field', type: 'String', description: 'Absent from curated annotations' },
    ]);
    mockQueryRecords.mockResolvedValue({
      records: [
        {
          akoya_requestnum: 'REQ-123',
          description: 'FULL EMAIL OR MEMO BODY SHOULD NOT REACH CLAUDE',
          wmkf_abstract: `${'A'.repeat(1600)}UNSENT_TAIL`,
          normal_field: 'safe value',
        },
      ],
      count: 1,
      totalCount: 1,
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

  test('redacts sensitive fields and long tails before appending tool_result messages', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'show requests' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(mockStream).toHaveBeenCalledTimes(2);
    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;

    expect(toolResult).toContain('REQ-123');
    expect(toolResult).toContain('safe value');
    expect(toolResult).toContain('_aiContextBoundary');
    expect(toolResult).not.toContain('FULL EMAIL OR MEMO BODY');
    expect(toolResult).not.toContain('UNSENT_TAIL');
  });

  test('contact→requests searches PI and co-PI roles, not only primary contact', async () => {
    const contactId = '304bf67c-ce8f-ee11-8179-000d3a341e8f';
    mockQueryRecords.mockResolvedValueOnce({
      records: [
        {
          akoya_requestnum: '993791',
          akoya_requeststatus: 'Closed',
          akoya_submitdate: '2021-06-01T00:00:00Z',
          _akoya_applicantid_value_formatted: 'University of Washington',
          _wmkf_grantprogram_value_formatted: 'Research',
          _wmkf_projectleader_value: contactId,
          akoya_paid: 1000000,
        },
      ],
      count: 1,
      totalCount: 1,
    });

    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'get_related',
            input: {
              source_type: 'contact',
              source_id: contactId,
              target_type: 'requests',
            },
          },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Found it.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'find requests for Kelly Stevens' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    const queryArgs = mockQueryRecords.mock.calls[0];
    expect(queryArgs[0]).toBe('akoya_requests');
    expect(queryArgs[1].filter).toContain(`_akoya_primarycontactid_value eq ${contactId}`);
    expect(queryArgs[1].filter).toContain(`_wmkf_projectleader_value eq ${contactId}`);
    expect(queryArgs[1].filter).toContain(`_wmkf_copi5_value eq ${contactId}`);

    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;
    expect(toolResult).toContain('993791');
    expect(toolResult).toContain('PI');
  });

  test('describe_table full:true surfaces live fields absent from annotations', async () => {
    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'describe_table',
            input: { table_name: 'akoya_request', full: true },
          },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Schema loaded.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'describe live-only request fields' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(mockGetEntityAttributes).toHaveBeenCalledWith('akoya_request');
    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;
    expect(toolResult).toContain('wmkf_live_only_field');
    expect(toolResult).toContain('Absent from curated annotations');
    // describe_table must apply the same inline sanitizers as the system prompt
    // so the stale hardcoded wmkf_request_type codes can't leak back via this
    // path (they were replaced by the resolved-taxonomy block in A2).
    expect(toolResult).not.toContain('100000001');
    expect(toolResult).toContain('SERVER-SIDE RESOLVED TAXONOMY');
  });

  test('describe_table full:true omits field-restricted live metadata', async () => {
    // A field-level restriction must not leak the attribute via describe_table
    // (getEntityAttributes only enforces table-level restrictions).
    setMockSqlResults({
      dynamics_restrictions: {
        rows: [{ table_name: 'akoya_request', field_name: 'wmkf_live_only_field', restriction_type: 'field', reason: 'sensitive' }],
      },
    });

    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'describe_table', input: { table_name: 'akoya_request', full: true } },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Schema loaded.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'describe request fields' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;
    expect(toolResult).not.toContain('wmkf_live_only_field');
    // A non-restricted live field still comes through.
    expect(toolResult).toContain('akoya_requestnum');
  });

  test('describe_table redacts a restricted field name from rules/descriptions', async () => {
    // wmkf_request_type appears in the mock annotation as both a field AND in
    // the DEFAULT FILTER rule. Restricting it must drop the field AND redact
    // its name from the rule prose (not just the field list).
    setMockSqlResults({
      dynamics_restrictions: {
        rows: [{ table_name: 'akoya_request', field_name: 'wmkf_request_type', restriction_type: 'field', reason: 'sensitive' }],
      },
    });

    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'describe_table', input: { table_name: 'akoya_request', full: true } },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Schema loaded.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'describe request fields' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;
    expect(toolResult).not.toContain('wmkf_request_type');
    expect(toolResult).toContain('[restricted]');
  });

  test('describe_table default stays compact while reporting live-field count', async () => {
    mockGetEntityAttributes.mockResolvedValue([
      { logicalName: 'akoya_requestid', displayName: 'Request', type: 'Uniqueidentifier', description: '' },
      { logicalName: 'akoya_requestnum', displayName: 'Request Number', type: 'String', description: '' },
      ...Array.from({ length: 150 }, (_, i) => ({
        logicalName: `wmkf_extra_${i}`,
        displayName: `Extra ${i}`,
        type: 'String',
        description: 'additional live field',
      })),
    ]);
    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'describe_table',
            input: { table_name: 'akoya_request' },
          },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Schema loaded.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'describe request' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;
    expect(toolResult).toContain('additionalLiveFieldCount');
    expect(toolResult).toContain('additionalLiveFieldSample');
    expect(toolResult).not.toContain('wmkf_extra_149');
    expect(toolResult.length).toBeLessThanOrEqual(12000 + 1000); // wrapper adds boundary metadata
  });

  test('describe_table surfaces live metadata restriction failures', async () => {
    mockGetEntityAttributes.mockRejectedValueOnce(new Error('Access denied: table "akoya_request" is restricted'));
    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'describe_table',
            input: { table_name: 'akoya_request', full: true },
          },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Denied.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'describe request' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(mockGetEntityAttributes).toHaveBeenCalledWith('akoya_request');
    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    expect(toolResultMessage.content[0].content).toContain('Access denied');
  });
});
