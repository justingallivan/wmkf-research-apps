import {
  clearAppAccessCache,
  createMockReq,
  createMockRes,
  mockAuthenticatedUser,
  setMockSqlResults,
} from '../helpers/auth-mock';

const mockStream = jest.fn();
const mockQueryRecords = jest.fn();
const mockCountRecords = jest.fn();
const mockAggregateRecords = jest.fn();
const mockQueryAllRecords = jest.fn();
const mockSearchRecords = jest.fn();
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
    // entity-set name → logical name (the real method is a static map lookup);
    // A5 classifyToolError normalizes table_name through this.
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

jest.mock('../../lib/services/dynamics-context', () => ({
  withDynamicsContext: jest.fn((ctx, fn) => fn()),
  bypassDynamicsRestrictions: jest.fn((labelOrFn, maybeFn) => {
    const fn = typeof labelOrFn === 'function' ? labelOrFn : maybeFn;
    return fn();
  }),
  getDynamicsContext: jest.fn(() => ({ restrictions: [], requestId: 'test' })),
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
      { logicalName: 'description', displayName: 'Description', type: 'Memo', description: '' },
      { logicalName: 'wmkf_abstract', displayName: 'Abstract', type: 'Memo', description: '' },
      { logicalName: 'normal_field', displayName: 'Normal', type: 'String', description: '' },
      { logicalName: 'statecode', displayName: 'Status', type: 'State', description: '' },
      { logicalName: 'createdon', displayName: 'Created On', type: 'DateTime', description: '' },
      // AttributeMetadata reports BARE lookup logical names; the `_<name>_value`
      // computed alias is never an attribute row. See the fixture-shape note in
      // tests/unit/dynamics-odata-validator.test.js ([ASSUMED], not live-captured).
      { logicalName: 'regardingobjectid', displayName: 'Regarding', type: 'Lookup', description: '' },
      { logicalName: 'wmkf_potentialreviewer1', displayName: 'Potential Reviewer 1', type: 'Lookup', description: '' },
      { logicalName: 'akoya_applicantid', displayName: 'Applicant', type: 'Lookup', description: 'Applying organization' },
      { logicalName: 'ownerid', displayName: 'Owner', type: 'Owner', description: '' },
      { logicalName: 'wmkf_secret', displayName: 'Secret', type: 'String', description: '' },
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
    mockSearchRecords.mockResolvedValue({
      results: [],
      totalCount: 0,
      queryContext: {},
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

  // A5 — fail-loud typed errors. A Dynamics 400 for an unknown field must be
  // classified into an actionable tool_result (errorType + hint + closest valid
  // field names + describe_table pointer), not a bare error string.
  test('classifies an unknown-field Dynamics error into an actionable hint', async () => {
    mockQueryRecords.mockReset();
    mockQueryRecords.mockRejectedValue(new Error(
      "Count failed (400): Could not find a property named 'akoya_requestnumber' on type 'Microsoft.Dynamics.CRM.akoya_request'."
    ));

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'show requests' }] },
    });
    const res = createMockRes();
    await handler(req, res);

    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;

    expect(toolResult).toContain('unknown_field');
    expect(toolResult).toContain('akoya_requestnumber');
    // Closest valid field surfaced from live attributes.
    expect(toolResult).toContain('akoya_requestnum');
    // A5 alias normalization (Codex LOW, S202): the entity-set alias
    // "akoya_requests" must be normalized to the logical name before fetching
    // attributes, so enrichment fires and restriction filtering matches.
    expect(mockGetEntityAttributes).toHaveBeenCalledWith('akoya_request');
    // Deterministic correction pointer, not a re-guess.
    expect(toolResult).toContain('describe_table');
    expect(toolResult).toMatch(/Do NOT retry with a guessed name/i);
  });

  // A5 — the /$count Edm.Int32 false-positive must NOT be mislabeled as a bad
  // field (it names a real field on type Edm.Int32).
  test('does not misclassify the Edm.Int32 count error as an unknown field', async () => {
    mockQueryRecords.mockReset();
    mockQueryRecords.mockRejectedValue(new Error(
      "Could not find a property named 'akoya_folio' on type 'Edm.Int32'."
    ));

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'show requests' }] },
    });
    const res = createMockRes();
    await handler(req, res);

    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;
    expect(toolResult).not.toContain('unknown_field');
    expect(toolResult).toContain('Edm.Int32');
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

  test('describe_table denies the operational AI run table before live metadata fetch', async () => {
    mockGetEntityAttributes.mockClear();
    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'describe_table',
            input: { table_name: 'wmkf_ai_run', full: true },
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
      body: { messages: [{ role: 'user', content: 'describe ai run fields' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(mockGetEntityAttributes).not.toHaveBeenCalled();
    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMessage = secondCall.messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    );
    const toolResult = toolResultMessage.content[0].content;
    expect(toolResult).toContain('DENIED');
    expect(toolResult).toContain('operational AI audit log');
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

  test('OData validator returns a precise tool_result for wrong fields before Dynamics call', async () => {
    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'query_records', input: { table_name: 'akoya_request', select: 'akoya_name' } },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Corrected.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'bad field' }] } });
    const res = createMockRes();
    await handler(req, res);

    expect(mockQueryRecords).not.toHaveBeenCalled();
    const toolResult = mockStream.mock.calls[1][0].messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    ).content[0].content;
    expect(toolResult).toContain('akoya_name');
    expect(toolResult).toContain('does not exist on akoya_request');
  });

  test('OData validator denies restricted fields in filter before checkRestriction would see them', async () => {
    setMockSqlResults({
      dynamics_restrictions: {
        rows: [{ table_name: 'akoya_request', field_name: 'wmkf_secret', restriction_type: 'field', reason: 'sensitive' }],
      },
    });
    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'query_records', input: { table_name: 'akoya_request', select: 'akoya_requestnum', filter: "wmkf_secret eq 'x'" } },
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

    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'restricted filter' }] } });
    const res = createMockRes();
    await handler(req, res);

    expect(mockQueryRecords).not.toHaveBeenCalled();
    const toolResult = mockStream.mock.calls[1][0].messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    ).content[0].content;
    expect(toolResult).toContain('DENIED');
    expect(toolResult).toContain('wmkf_secret');
    expect(toolResult).toContain('restricted');
  });

  // ─── Lookup computed-alias handling (production request
  // tq9j6-1786197256337-e64473f8bbd5 burned 15 rounds because the pre-flight
  // validator accepted the WRONG lookup spelling and rejected the right one).
  describe('lookup computed alias', () => {
    const GUID = '3f2504e0-4f89-11d3-9a0c-0305e82c330c';

    /** Drive one tool_use round through the handler and return its tool_result. */
    const runTool = async (name, input) => {
      mockStream
        .mockReset()
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'tool-1', name, input }],
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
      const req = createMockReq({
        method: 'POST',
        body: { messages: [{ role: 'user', content: 'lookup query' }] },
      });
      const res = createMockRes();
      await handler(req, res);
      return mockStream.mock.calls[1][0].messages.find(
        m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
      ).content[0].content;
    };

    test('mocked live metadata carries no precomputed _value alias', async () => {
      const mocked = await mockGetEntityAttributes();
      const precomputed = mocked
        .map(a => a.logicalName)
        .filter(n => n.startsWith('_') && n.endsWith('_value'));
      expect(mocked.length).toBeGreaterThan(0);
      expect(precomputed).toEqual([]);
    });

    test('the correct alias filter validates and reaches queryRecords', async () => {
      await runTool('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        filter: `_akoya_applicantid_value eq ${GUID}`,
        top: 1,
      });

      expect(mockQueryRecords).toHaveBeenCalledTimes(1);
      expect(mockQueryRecords.mock.calls[0][1].filter).toContain(`_akoya_applicantid_value eq ${GUID}`);
    });

    test('the bare lookup spelling is rejected locally and never reaches queryRecords', async () => {
      for (const filter of [`akoya_applicantid eq '${GUID}'`, `akoya_applicantid eq ${GUID}`]) {
        mockQueryRecords.mockClear();
        const toolResult = await runTool('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          filter,
          top: 1,
        });
        expect(mockQueryRecords).not.toHaveBeenCalled();
        expect(toolResult).toContain('_akoya_applicantid_value');
      }
    });

    test('the alias is rejected in $orderby and the bare alias hint stays out of $expand', async () => {
      const ordered = await runTool('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        orderby: '_akoya_applicantid_value desc',
      });
      expect(mockQueryRecords).not.toHaveBeenCalled();
      expect(ordered).toContain('orderby');

      mockQueryRecords.mockClear();
      const expanded = await runTool('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        expand: '_akoya_applicantid_value',
      });
      expect(mockQueryRecords).not.toHaveBeenCalled();
      expect(expanded).toContain('akoya_applicantid');

      mockQueryRecords.mockClear();
      await runTool('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        expand: 'akoya_applicantid($select=name)',
      });
      expect(mockQueryRecords).toHaveBeenCalledTimes(1);
      expect(mockQueryRecords.mock.calls[0][1].expand).toBe('akoya_applicantid($select=name)');
    });

    test('describe_table surfaces the queryable alias for lookup attributes', async () => {
      const toolResult = await runTool('describe_table', { table_name: 'akoya_request', full: true });

      expect(toolResult).toContain('_akoya_applicantid_value');
      expect(toolResult).toContain('_ownerid_value');
      // The bare logical name still appears as the attribute's logicalName, but
      // the note must not present it as the $expand navigation property.
      expect(toolResult).toContain('akoya_applicantid');
      expect(toolResult).not.toMatch(/bare logicalName is the navigation property/i);
      expect(toolResult).toMatch(/do not guess/i);
    });

    test('describe_table honors a restriction stored under the alias spelling', async () => {
      setMockSqlResults({
        dynamics_restrictions: {
          rows: [{
            table_name: 'akoya_request',
            field_name: '_akoya_applicantid_value',
            restriction_type: 'field',
            reason: 'sensitive',
          }],
        },
      });

      const toolResult = await runTool('describe_table', { table_name: 'akoya_request', full: true });

      expect(toolResult).not.toContain('akoya_applicantid');
      expect(toolResult).not.toContain('Applying organization');
      expect(toolResult).toContain('akoya_requestnum');
    });

    test('a bare-stored restriction denies the alias spelling before Dynamics is called', async () => {
      setMockSqlResults({
        dynamics_restrictions: {
          rows: [{
            table_name: 'akoya_request',
            field_name: 'akoya_applicantid',
            restriction_type: 'field',
            reason: 'sensitive',
          }],
        },
      });

      const toolResult = await runTool('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        filter: `_akoya_applicantid_value eq ${GUID}`,
      });

      expect(mockQueryRecords).not.toHaveBeenCalled();
      expect(toolResult).toContain('DENIED');
      expect(toolResult).toContain('_akoya_applicantid_value');
    });

    // A restriction on the bare lookup used to be bypassed by filtering its
    // NAVIGATION PATH: the general tokenizer drops any token containing "/", and
    // chat.js's checkRestriction never inspects $filter at all, so the query
    // reached Dataverse and returned the restricted column's value by name.
    test('a navigation-path filter cannot bypass a restriction on the lookup', async () => {
      setMockSqlResults({
        dynamics_restrictions: {
          rows: [{
            table_name: 'akoya_request',
            field_name: 'akoya_applicantid',
            restriction_type: 'field',
            reason: 'sensitive',
          }],
        },
      });

      const toolResult = await runTool('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        filter: "akoya_applicantid/name eq 'Secret Org'",
      });

      expect(mockQueryRecords).not.toHaveBeenCalled();
      expect(toolResult).toContain('DENIED');
      // The denial names the spelling the model typed, not the complement.
      expect(toolResult).not.toContain('_akoya_applicantid_value');
    });

    // Nested $expand options name fields on the EXPANDED table, whose identity
    // cannot be resolved from AttributeMetadata. With any field restriction
    // configured they must fail closed rather than be forwarded unchecked.
    test('nested $expand options fail closed while a field restriction exists', async () => {
      setMockSqlResults({
        dynamics_restrictions: {
          rows: [{
            table_name: 'account',
            field_name: 'wmkf_secret',
            restriction_type: 'field',
            reason: 'sensitive',
          }],
        },
      });

      const toolResult = await runTool('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        expand: 'akoya_applicantid($select=name,wmkf_secret)',
      });

      expect(mockQueryRecords).not.toHaveBeenCalled();
      expect(toolResult).toContain('DENIED');
      expect(toolResult).not.toContain('wmkf_secret');
    });

    // A PLAIN $expand returns the related entity's default field set, and
    // nested $orderby/$top/$expand read that table too — the same leak the
    // nested-$select case has. None of them may reach Dynamics while a field
    // restriction exists, because the expanded target cannot be resolved here.
    test('every $expand shape fails closed while a field restriction exists', async () => {
      for (const expand of [
        'akoya_applicantid',
        'akoya_applicantid($orderby=name desc)',
        'akoya_applicantid($top=5)',
        'akoya_applicantid($expand=parentaccountid)',
        // A provably-wrong path root still answers with the BLANKET denial while
        // a restriction exists — the fail-closed rule runs first.
        'akoya_requestid/child',
      ]) {
        setMockSqlResults({
          dynamics_restrictions: {
            rows: [{
              table_name: 'account',
              field_name: 'wmkf_secret',
              restriction_type: 'field',
              reason: 'sensitive',
            }],
          },
        });
        mockQueryRecords.mockClear();

        const toolResult = await runTool('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          expand,
        });

        expect(mockQueryRecords).not.toHaveBeenCalled();
        expect(toolResult).toContain('DENIED');
        expect(toolResult).not.toContain('wmkf_secret');
      }
    });

    test('an $expand naming a scalar or fabricated alias never reaches queryRecords', async () => {
      for (const expand of ['akoya_requestid', '_akoya_requestid_value', 'akoya_requestnum']) {
        mockQueryRecords.mockClear();
        const toolResult = await runTool('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          expand,
        });
        expect(mockQueryRecords).not.toHaveBeenCalled();
        expect(toolResult).toContain('relationship metadata');
      }
    });

    // Appending a path cannot turn a scalar, PartyList or computed-value
    // property into a navigation property, so `$expand=<wrong root>/child` must
    // be stopped here exactly like the bare spelling is.
    test('a path-shaped $expand with a provably-wrong root never reaches queryRecords', async () => {
      const baseAttrs = await mockGetEntityAttributes();
      mockGetEntityAttributes.mockResolvedValue([
        ...baseAttrs,
        { logicalName: 'to', displayName: 'To', type: 'PartyList', description: '' },
      ]);

      for (const expand of [
        'to/child',                          // PartyList root
        'akoya_requestid/child',             // Uniqueidentifier (scalar) root
        '_to_value/child',                   // fabricated alias root
        '_akoya_applicantid_value/child',    // computed lookup value root
      ]) {
        mockQueryRecords.mockClear();
        const toolResult = await runTool('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          expand,
        });
        expect(mockQueryRecords).not.toHaveBeenCalled();
        expect(toolResult).toContain('relationship metadata');
      }
    });

    test('a path-shaped $expand with an unknown plausible root is forwarded unchanged', async () => {
      mockQueryRecords.mockClear();
      await runTool('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        expand: 'Unknown_Nav/child',
      });
      expect(mockQueryRecords).toHaveBeenCalledTimes(1);
      expect(mockQueryRecords.mock.calls[0][1].expand).toBe('Unknown_Nav/child');
    });

    test('grouped and reversed invalid Guid comparisons never reach queryRecords', async () => {
      for (const filter of [
        "'not-guid' eq akoya_requestid",
        '12345678 ne akoya_requestid',
        `(_akoya_applicantid_value) eq '${GUID}'`,
        `_akoya_applicantid_value eq ('${GUID}')`,
      ]) {
        mockQueryRecords.mockClear();
        const toolResult = await runTool('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          filter,
          top: 1,
        });
        expect(mockQueryRecords).not.toHaveBeenCalled();
        expect(toolResult).toContain('UNQUOTED GUID');
      }
    });

    test('a valid Guid comparison written in reverse or grouped still reaches queryRecords', async () => {
      for (const filter of [
        `${GUID} eq _akoya_applicantid_value`,
        `(_akoya_applicantid_value) eq ${GUID}`,
      ]) {
        mockQueryRecords.mockClear();
        await runTool('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          filter,
          top: 1,
        });
        expect(mockQueryRecords).toHaveBeenCalledTimes(1);
        expect(mockQueryRecords.mock.calls[0][1].filter).toContain(filter);
      }
    });

    test('invalid Edm.Guid literals never reach queryRecords', async () => {
      for (const filter of [
        `_akoya_applicantid_value eq '${GUID}'`,
        "_akoya_applicantid_value eq 'Secret Org'",
        '_akoya_applicantid_value eq 12345678',
      ]) {
        mockQueryRecords.mockClear();
        const toolResult = await runTool('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          filter,
          top: 1,
        });
        expect(mockQueryRecords).not.toHaveBeenCalled();
        expect(toolResult).toContain('UNQUOTED GUID');
      }
    });

    test('classified unknown-field hints suggest the queryable alias, not the bare lookup', async () => {
      mockQueryRecords.mockReset();
      mockQueryRecords.mockRejectedValue(new Error(
        "Query failed (400): Could not find a property named 'akoya_applicantid' on type 'Microsoft.Dynamics.CRM.akoya_request'."
      ));

      const toolResult = await runTool('query_records', {
        table_name: 'akoya_requests',
        select: 'akoya_requestnum',
        top: 1,
      });

      expect(toolResult).toContain('unknown_field');
      const suggestions = toolResult.match(/"suggestions":\[(.*?)\]/)?.[1] || '';
      expect(suggestions).toContain('"_akoya_applicantid_value"');
      expect(suggestions).not.toContain('"akoya_applicantid"');
    });
  });

  test('search strips operational AI run hits returned by Dataverse Search', async () => {
    mockSearchRecords.mockResolvedValueOnce({
      results: [
        {
          entity: 'wmkf_ai_run',
          objectId: 'run-1',
          attributes: { wmkf_ai_rawoutput: 'SHOULD_NOT_REACH_CLAUDE' },
          highlights: { wmkf_ai_rawoutput: ['SHOULD_NOT_REACH_CLAUDE'] },
        },
        {
          entity: 'akoya_request',
          objectId: 'req-1',
          attributes: {
            akoya_requestnum: '1001234',
            akoya_applicantidname: 'Visible University',
            akoya_title: 'Visible grant',
          },
          highlights: { akoya_title: ['Visible grant'] },
        },
      ],
      totalCount: 2,
      queryContext: {},
    });
    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'search', input: { search: 'summary' } },
        ],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Found visible result.' }],
        model: 'claude-test',
        usage: {},
        textStreamed: false,
      });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'search summary' }] },
    });
    const res = createMockRes();

    await handler(req, res);

    const toolResult = mockStream.mock.calls[1][0].messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    ).content[0].content;
    expect(toolResult).toContain('Visible University');
    expect(toolResult).toContain('Visible grant');
    expect(toolResult).not.toContain('wmkf_ai_run');
    expect(toolResult).not.toContain('SHOULD_NOT_REACH_CLAUDE');
  });

  // A rejected tool must still be answered against its OWN tool_use id. It used
  // to be answered with a literal 'unknown', which leaves the real tool_use
  // unanswered and invents an id that was never issued — the Anthropic API
  // rejects both on the next round, so any rejection here became an
  // unexplainable top-level failure instead of a recoverable tool error.
  test('answers a rejected tool call with its own tool_use id', async () => {
    // A BigInt survives the serializer and makes truncateResult's
    // JSON.stringify throw, which rejects the executeOne promise.
    mockQueryRecords.mockReset();
    mockQueryRecords.mockResolvedValue({
      records: [{ akoya_requestnum: 1n }],
      totalCount: 1,
    });

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'show requests' }] },
    });
    const res = createMockRes();
    await handler(req, res);

    // The loop must continue — a rejected tool is recoverable, not fatal.
    expect(mockStream).toHaveBeenCalledTimes(2);

    const assistantMsg = mockStream.mock.calls[1][0].messages.find(
      m => m.role === 'assistant' && Array.isArray(m.content),
    );
    const issuedIds = assistantMsg.content
      .filter(b => b.type === 'tool_use')
      .map(b => b.id);
    const toolResults = mockStream.mock.calls[1][0].messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    ).content;

    // Every issued tool_use is answered, and no answer names an unissued id.
    expect(toolResults.map(r => r.tool_use_id).sort()).toEqual([...issuedIds].sort());
    expect(toolResults.map(r => r.tool_use_id)).not.toContain('unknown');
    expect(toolResults[0].content).toContain('error');
  });

  // The case the fix actually exists for: SEVERAL tools in one round, settling
  // out of order, with only one of them rejecting. Index alignment between
  // Promise.allSettled results and toolBlocks is what keeps each answer attached
  // to its own id — the single-tool test above cannot detect a misalignment.
  // (Gap identified in Codex review, 2026-08-07.)
  test('keeps ids aligned when several tools settle out of order and one rejects', async () => {
    mockStream
      .mockReset()
      .mockResolvedValueOnce({
        content: [
          // Middle one will reject; the others resolve on different timelines.
          { type: 'tool_use', id: 'tu_a', name: 'count_records', input: { table_name: 'akoya_request', filter: 'statecode eq 0' } },
          { type: 'tool_use', id: 'tu_b', name: 'query_records', input: { table_name: 'akoya_request', top: 1 } },
          { type: 'tool_use', id: 'tu_c', name: 'count_records', input: { table_name: 'akoya_request', filter: 'statecode eq 1' } },
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

    // tu_b rejects (BigInt breaks JSON.stringify inside truncateResult).
    mockQueryRecords.mockReset();
    mockQueryRecords.mockResolvedValue({ records: [{ akoya_requestnum: 1n }], totalCount: 1 });

    // The two count_records calls settle in reverse order relative to issue
    // order, so a naive positional assumption would cross the answers over.
    mockCountRecords.mockReset();
    mockCountRecords
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(41), 20)))
      .mockImplementationOnce(() => Promise.resolve(7));

    const req = createMockReq({
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'three lookups' }] },
    });
    const res = createMockRes();
    await handler(req, res);

    expect(mockStream).toHaveBeenCalledTimes(2);

    const toolResults = mockStream.mock.calls[1][0].messages.find(
      m => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
    ).content;

    // Answered in issue order, one per issued id, none invented.
    expect(toolResults.map(r => r.tool_use_id)).toEqual(['tu_a', 'tu_b', 'tu_c']);
    // The rejection is attached to tu_b specifically, not to a sibling.
    const byId = Object.fromEntries(toolResults.map(r => [r.tool_use_id, r.content]));
    expect(byId.tu_b).toContain('error');
    // The two successes carry their own distinct counts — proof the results
    // didn't get swapped by completion order. Matched with the JSON key so a
    // bare number can't fake-pass against the hex nonce in the wrapper.
    expect(byId.tu_a).toContain('"count":41');
    expect(byId.tu_c).toContain('"count":7');
    expect(byId.tu_a).not.toContain('error');
    expect(byId.tu_c).not.toContain('error');
  });

  // Top-level failure copy. A top-level throw used to emit the bare string
  // "Query failed", which named neither what broke nor what to do, and gave the
  // user nothing to quote when escalating. Owner-reported 2026-08-07.
  describe('top-level failure reporting', () => {
    /** Reassemble the SSE `error` event payload from res.write calls. */
    const errorEvent = (res) => {
      const stream = res.write.mock.calls.map(c => c[0]).join('');
      const blocks = stream.split('\n\n').filter(Boolean);
      const errBlock = blocks.find(b => b.startsWith('event: error'));
      if (!errBlock) return null;
      const dataLine = errBlock.split('\n').find(l => l.startsWith('data: '));
      return JSON.parse(dataLine.slice(6));
    };

    const runWithStreamError = async (err) => {
      mockStream.mockReset().mockRejectedValue(err);
      const req = createMockReq({
        method: 'POST',
        body: { messages: [{ role: 'user', content: 'find all interactions with Texas Tech' }] },
      });
      const res = createMockRes();
      await handler(req, res);
      return errorEvent(res);
    };

    test('does not emit the bare "Query failed" string, and carries a reference id', async () => {
      const payload = await runWithStreamError(new Error('boom'));

      expect(payload).not.toBeNull();
      expect(payload.message).not.toBe('Query failed');
      // Plain-language, system-as-subject, with the retry → administrator ladder.
      expect(payload.message).toMatch(/temporary blip/i);
      expect(payload.message).toMatch(/contact an administrator/i);
      // Never implies the user's own access is at fault.
      expect(payload.message).not.toMatch(/your (access|permission)/i);
      // The Explorer has no retry button — an error is a plain chat bubble — so
      // the copy must not tell the user to press one.
      expect(payload.message).not.toMatch(/press retry|retry button/i);
      // Correlates with the server log line.
      expect(payload.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    test('keeps the raw provider error server-side', async () => {
      const payload = await runWithStreamError(
        Object.assign(new Error('Claude API error 500: internal-detail-leak'), { status: 500 }),
      );

      expect(JSON.stringify(payload)).not.toContain('internal-detail-leak');
    });

    test('distinguishes an overloaded provider from a timeout', async () => {
      const overloaded = await runWithStreamError(
        Object.assign(new Error('Claude API error 529 after 3 attempts: overloaded'), { status: 529 }),
      );
      expect(overloaded.message).toMatch(/overloaded/i);

      const timedOut = await runWithStreamError(new Error('Claude API timeout after 60000ms'));
      expect(timedOut.message).toMatch(/took too long/i);
      // A timeout is the one case with a useful self-service next step.
      expect(timedOut.message).toMatch(/date range|single organization/i);
      expect(timedOut.message).not.toMatch(/overloaded/i);
    });

    test('reports a rate-limited provider as capacity, not as user fault', async () => {
      const payload = await runWithStreamError(
        Object.assign(new Error('Claude API error 429 after 3 attempts: rate limit'), { status: 429 }),
      );
      expect(payload.message).toMatch(/too many requests/i);
      expect(payload.message).not.toMatch(/your /i);
    });
  });
});
