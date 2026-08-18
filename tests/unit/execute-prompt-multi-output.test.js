/**
 * Multi-output PATCH coalescing tests for the Prompt Executor.
 *
 * Per docs/EXECUTOR_EXTENSIONS_PLAN.md §1 — when a prompt declares multiple
 * outputs that target the same `akoya_request` row, all field writes must
 * land in a SINGLE PATCH. Sequential PATCHes would 412 on every output
 * after the first because the captured ETag goes stale.
 *
 * These tests assert:
 *   - Two direct-field outputs → one PATCH with both fields
 *   - Direct + jsonPath into different fields → one PATCH, jsonPath field
 *     read fresh and merged
 *   - Two jsonPath outputs into the same memo → one PATCH with both keys
 *     merged into the JSON
 *   - Schema error: two direct outputs writing the same field throws
 *   - Missing output in parsed: marked failed individually but doesn't
 *     block other eligible outputs from landing
 *   - 412 on the single PATCH: all eligible outputs marked concurrent_edit
 */

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((tag, fn) => fn()),
}));

// Capture Claude calls (we mock the response per-test).
const fetchedBodies = [];
let claudeResponse = null;
const originalFetch = global.fetch;
global.fetch = jest.fn(async (url, init) => {
  fetchedBodies.push({ url, body: init?.body || '' });
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => claudeResponse,
  };
});

// DynamicsService mock — we capture updateRecord calls and program
// getRecord per-test for jsonPath merges.
const updateCalls = [];
const auditCalls = [];
let getRecordImpl = async () => null;
let updateImpl = async () => ({});
let promptRow = null;

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: jest.fn(async () => ({ records: [promptRow] })),
    getRecord: jest.fn(async (...args) => getRecordImpl(...args)),
    createRecord: jest.fn(async (entitySet, payload) => {
      auditCalls.push({ entitySet, payload });
      return 'audit-row-id';
    }),
    updateRecord: jest.fn(async (entitySet, id, payload, opts) => {
      updateCalls.push({ entitySet, id, payload, opts });
      return updateImpl(entitySet, id, payload, opts);
    }),
  },
}));

beforeEach(() => {
  fetchedBodies.length = 0;
  updateCalls.length = 0;
  auditCalls.length = 0;
  claudeResponse = null;
  promptRow = null;
  getRecordImpl = DEFAULT_GET_RECORD;
  updateImpl = async () => ({});
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

afterAll(() => { global.fetch = originalFetch; });

import { executePrompt } from '../../lib/services/execute-prompt';
import { PROMPT_OUTPUT_SCHEMA as REVIEW_SYNTHESIS_OUTPUT_SCHEMA } from '../../shared/config/prompts/review-synthesis';
import {
  PROMPT_OUTPUT_SCHEMA as PRE_SITE_OUTPUT_SCHEMA,
  PROPOSAL_CORE_KEYS as PRE_SITE_CORE_KEYS,
} from '../../shared/config/prompts/pre-site-visit-proposal-core';

function buildPromptRow(outputs) {
  return {
    wmkf_ai_promptid: 'prompt-multi',
    wmkf_ai_promptname: 'test.multi-output',
    wmkf_promptversion: '1.0',
    wmkf_ai_systemprompt: 'SYS',
    wmkf_ai_promptbody: 'BODY: {{x}}',
    wmkf_ai_promptvariables: JSON.stringify({
      variables: [{ name: 'x', source: { kind: 'override' }, required: true }],
    }),
    wmkf_ai_promptoutputschema: JSON.stringify({
      outputs,
      parseMode: 'json',
      rawOutputRetention: 'hash',
    }),
    wmkf_ai_model: 'claude-sonnet-4-6',
    wmkf_ai_maxtokens: 1024,
    wmkf_ai_temperature: 0.1,
  };
}

function setClaudeJson(obj) {
  claudeResponse = {
    content: [{ type: 'text', text: JSON.stringify(obj) }],
    usage: { input_tokens: 50, output_tokens: 20 },
    model: 'claude-test',
    stop_reason: 'end_turn',
  };
}

// The request row supplies the ETag and seed populated-state. Always-overwrite
// guard avoids "populated" conflicts so we exercise the persist path cleanly.
const REQUEST_ROW = {
  akoya_requestid: '11111111-1111-1111-1111-111111111111',
  akoya_requestnum: '1000000',
  _etag: 'W/"00000001"',
  modifiedon: '2026-05-10T00:00:00Z',
};

async function run(outputs, parsedOutput) {
  promptRow = buildPromptRow(outputs);
  setClaudeJson(parsedOutput);
  // Only set a default getRecordImpl if the test hasn't already configured
  // one — tests that need jsonPath memo reads set it before calling run().
  if (getRecordImpl === DEFAULT_GET_RECORD) {
    getRecordImpl = async (entitySet, id) => {
      if (entitySet === 'akoya_requests' && id === '11111111-1111-1111-1111-111111111111') return REQUEST_ROW;
      return null;
    };
  }
  return executePrompt({
    promptName: 'test.multi-output',
    requestId: '11111111-1111-1111-1111-111111111111',
    runSource: 'Vercel Test',
    overrideVariables: { x: 'value' },
  });
}

const DEFAULT_GET_RECORD = async () => null;

describe('persistOutputs — multi-output PATCH coalescing', () => {
  test('requireNoPersistence rejects a mutable prompt write target before the model call', async () => {
    const outputs = [
      { name: 'summary', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'always-overwrite' },
    ];
    promptRow = buildPromptRow(outputs);
    setClaudeJson({ summary: 'S' });
    getRecordImpl = async () => REQUEST_ROW;

    await expect(executePrompt({
      promptName: 'test.multi-output',
      requestId: '11111111-1111-1111-1111-111111111111',
      runSource: 'Vercel Test',
      overrideVariables: { x: 'value' },
      requireNoPersistence: true,
    })).rejects.toThrow('requires pass-through-only outputs');

    expect(fetchedBodies.filter(({ url }) => url.includes('/v1/messages'))).toHaveLength(0);
    expect(updateCalls.filter(c => c.entitySet === 'akoya_requests')).toHaveLength(0);
  });

  test('two direct-field outputs land in a single PATCH', async () => {
    const outputs = [
      { name: 'summary', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'always-overwrite' },
      { name: 'check',   type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_compliancecheck' }, guard: 'always-overwrite' },
    ];

    const result = await run(outputs, { summary: 'S', check: 'C' });

    const patchCalls = updateCalls.filter(c => c.entitySet === 'akoya_requests');
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].payload).toEqual({
      wmkf_ai_summary: 'S',
      wmkf_ai_compliancecheck: 'C',
    });
    expect(patchCalls[0].opts.ifMatch).toBe('W/"00000001"');
    expect(result.writeResults.results.every(r => r.ok)).toBe(true);
  });

  test('direct + jsonPath into different fields → one PATCH; jsonPath field re-read and merged', async () => {
    const outputs = [
      { name: 'summary',  type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'always-overwrite' },
      { name: 'keywords', type: 'array',  target: { kind: 'akoya_request', field: 'wmkf_ai_dataextract', jsonPath: '$.keywords' }, guard: 'always-overwrite' },
    ];

    // Existing memo has unrelated keys we should preserve. Persist-path calls
    // getRecord with `{ select: field }`; the request-row fetch is sourceless.
    getRecordImpl = async (entitySet, id, opts) => {
      if (entitySet !== 'akoya_requests' || id !== '11111111-1111-1111-1111-111111111111') return null;
      if (opts && opts.select) {
        return { wmkf_ai_dataextract: JSON.stringify({ existingKey: 'preserved' }) };
      }
      return REQUEST_ROW;
    };

    await run(outputs, { summary: 'S', keywords: ['a', 'b'] });

    const patchCalls = updateCalls.filter(c => c.entitySet === 'akoya_requests');
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].payload.wmkf_ai_summary).toBe('S');
    expect(JSON.parse(patchCalls[0].payload.wmkf_ai_dataextract)).toEqual({
      existingKey: 'preserved',
      keywords: ['a', 'b'],
    });
  });

  test('two jsonPath outputs into the same memo merge into one payload entry', async () => {
    const outputs = [
      { name: 'kw',   type: 'array',  target: { kind: 'akoya_request', field: 'wmkf_ai_dataextract', jsonPath: '$.keywords' }, guard: 'always-overwrite' },
      { name: 'sum',  type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_dataextract', jsonPath: '$.summary'  }, guard: 'always-overwrite' },
    ];

    getRecordImpl = async (entitySet, id, opts) => {
      if (entitySet !== 'akoya_requests' || id !== '11111111-1111-1111-1111-111111111111') return null;
      if (opts && opts.select) return { wmkf_ai_dataextract: null };
      return REQUEST_ROW;
    };

    await run(outputs, { kw: ['x'], sum: 'Z' });

    const patchCalls = updateCalls.filter(c => c.entitySet === 'akoya_requests');
    expect(patchCalls).toHaveLength(1);
    expect(Object.keys(patchCalls[0].payload)).toEqual(['wmkf_ai_dataextract']);
    expect(JSON.parse(patchCalls[0].payload.wmkf_ai_dataextract)).toEqual({
      keywords: ['x'],
      summary: 'Z',
    });
  });

  test('two direct outputs writing the same field throws schema error', async () => {
    const outputs = [
      { name: 'a', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'always-overwrite' },
      { name: 'b', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'always-overwrite' },
    ];

    // executePrompt rethrows; an audit failure row is still written.
    await expect(run(outputs, { a: 'X', b: 'Y' })).rejects.toThrow(/multiple outputs|same field|jsonPath/i);
    const patchCalls = updateCalls.filter(c => c.entitySet === 'akoya_requests');
    expect(patchCalls).toHaveLength(0);
  });

  test('missing parsed value: that output marked failed, eligible outputs still land', async () => {
    const outputs = [
      { name: 'summary', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'always-overwrite' },
      { name: 'ghost',   type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_compliancecheck' }, guard: 'always-overwrite' },
    ];

    const result = await run(outputs, { summary: 'S' }); // 'ghost' absent

    const patchCalls = updateCalls.filter(c => c.entitySet === 'akoya_requests');
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].payload).toEqual({ wmkf_ai_summary: 'S' });

    const byName = Object.fromEntries(result.writeResults.results.map(r => [r.output, r]));
    expect(byName.summary.ok).toBe(true);
    expect(byName.ghost.ok).toBe(false);
    expect(byName.ghost.reason).toMatch(/missing/);
  });

  test('412 on the coalesced PATCH marks every eligible output concurrent_edit', async () => {
    const outputs = [
      { name: 'a', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'always-overwrite' },
      { name: 'b', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_compliancecheck' }, guard: 'always-overwrite' },
    ];

    updateImpl = async () => {
      const err = new Error('precondition failed');
      err.status = 412;
      throw err;
    };

    const result = await run(outputs, { a: 'A', b: 'B' });

    const reasons = result.writeResults.results.map(r => r.reason);
    expect(reasons).toEqual(['concurrent_edit', 'concurrent_edit']);
  });
});

// ---------------------------------------------------------------------------
// A7 step 3 — validationSchema: post-parse output-schema enforcement
// ---------------------------------------------------------------------------
describe('parseClaudeOutput — validationSchema (A7 step 3)', () => {
  function buildSchemaPromptRow(validationSchema) {
    return {
      wmkf_ai_promptid: 'prompt-vs',
      wmkf_ai_promptname: 'test.validation-schema',
      wmkf_promptversion: '1.0',
      wmkf_ai_systemprompt: 'SYS',
      wmkf_ai_promptbody: 'BODY: {{x}}',
      wmkf_ai_promptvariables: JSON.stringify({
        variables: [{ name: 'x', source: { kind: 'override' }, required: true }],
      }),
      wmkf_ai_promptoutputschema: JSON.stringify({
        outputs: [
          { name: 'summary', type: 'string', target: { kind: 'akoya_request', field: 'wmkf_ai_summary' }, guard: 'always-overwrite' },
        ],
        parseMode: 'json',
        rawOutputRetention: 'hash',
        validationSchema,
      }),
      wmkf_ai_model: 'claude-sonnet-4-6',
      wmkf_ai_maxtokens: 1024,
      wmkf_ai_temperature: 0.1,
    };
  }

  // A declarative validateAiJson node — JSON-serialisable, exactly as it would
  // be stored in the wmkf_ai_promptoutputschema Memo field.
  const SCHEMA = { type: 'object', fields: { summary: { type: 'string', maxLength: 5000 } } };

  async function runWithSchema(validationSchema, claudeOutput) {
    promptRow = buildSchemaPromptRow(validationSchema);
    setClaudeJson(claudeOutput);
    getRecordImpl = async (entitySet, id) =>
      (entitySet === 'akoya_requests' && id === '11111111-1111-1111-1111-111111111111') ? REQUEST_ROW : null;
    return executePrompt({
      promptName: 'test.validation-schema',
      requestId: '11111111-1111-1111-1111-111111111111',
      runSource: 'Vercel Test',
      overrideVariables: { x: 'value' },
    });
  }

  test('drops an injected key the validationSchema does not declare', async () => {
    const result = await runWithSchema(SCHEMA, { summary: 'S', injected: 'rm -rf /' });
    expect(result.parsed).toEqual({ summary: 'S' });
    expect(result.meta.droppedOutputPaths).toEqual(['$.injected']);
    const patch = updateCalls.find(c => c.entitySet === 'akoya_requests');
    expect(patch.payload).toEqual({ wmkf_ai_summary: 'S' });
  });

  test('a type-invalid output (invalid-but-parseable JSON) fails the run', async () => {
    const error = await runWithSchema(SCHEMA, { summary: 12345 }).catch((caught) => caught);
    expect(error.code).toBe('claude_output_schema_invalid');
    expect(error.message).toMatch(/failed schema validation/);
  });

  test('no validationSchema → parsed passes through unchanged (backward compat)', async () => {
    const result = await runWithSchema(undefined, { summary: 'S', extra: 'kept' });
    expect(result.parsed).toEqual({ summary: 'S', extra: 'kept' });
  });

  test('the stored Pre-Site schema accepts over-target prose and drops extras', async () => {
    const proposalCore = Object.fromEntries(
      PRE_SITE_CORE_KEYS.map((key) => [key, `${key} content.`]),
    );
    proposalCore.executiveSummary = 'Long but usable. '.repeat(60);
    proposalCore.personnelOverview = 'First paragraph.\n\nSecond paragraph.';
    proposalCore.backgroundAndImpact = 'One.\n\nTwo.\n\nThree.';
    proposalCore.staffRecommendation = 'Fund it.';
    promptRow = buildPromptRow([]);
    promptRow.wmkf_ai_promptname = 'test.pre-site-stored-schema';
    promptRow.wmkf_ai_promptoutputschema = JSON.stringify(PRE_SITE_OUTPUT_SCHEMA);
    setClaudeJson({ proposalCore });
    getRecordImpl = async () => REQUEST_ROW;

    const result = await executePrompt({
      promptName: promptRow.wmkf_ai_promptname,
      requestId: REQUEST_ROW.akoya_requestid,
      runSource: 'Vercel Test',
      overrideVariables: { x: 'value' },
      requireNoPersistence: true,
    });

    expect(result.parsed.proposalCore.executiveSummary.length).toBeGreaterThan(700);
    expect(result.parsed.proposalCore.personnelOverview).toContain('\n\n');
    expect(result.parsed.proposalCore.backgroundAndImpact).toContain('Three.');
    expect(result.parsed.proposalCore).not.toHaveProperty('staffRecommendation');
    expect(result.meta.droppedOutputPaths).toContain('$.proposalCore.staffRecommendation');
  });
});

describe('Executor response-completeness + native structured output', () => {
  const outputs = [
    {
      name: 'summary',
      type: 'string',
      target: { kind: 'akoya_request', field: 'wmkf_ai_summary' },
      guard: 'always-overwrite',
    },
  ];

  async function runWithResponse(response, outputSchema = null) {
    promptRow = buildPromptRow(outputs);
    if (outputSchema) {
      promptRow.wmkf_ai_promptoutputschema = JSON.stringify(outputSchema);
    }
    claudeResponse = response;
    getRecordImpl = async (entitySet, id) =>
      (entitySet === 'akoya_requests' && id === REQUEST_ROW.akoya_requestid)
        ? REQUEST_ROW
        : null;
    return executePrompt({
      promptName: promptRow.wmkf_ai_promptname,
      requestId: REQUEST_ROW.akoya_requestid,
      runSource: 'Vercel Test',
      overrideVariables: { x: 'value' },
    });
  }

  test('joins every text block before parsing and writes only after end_turn', async () => {
    const result = await runWithResponse({
      content: [
        { type: 'text', text: '{"sum' },
        { type: 'text', text: 'mary":"complete"}' },
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
      model: 'claude-test',
      stop_reason: 'end_turn',
    });

    expect(result.parsed).toEqual({ summary: 'complete' });
    expect(updateCalls.filter((c) => c.entitySet === 'akoya_requests')).toHaveLength(1);
  });

  test('max_tokens fails closed even when the returned prefix is syntactically valid JSON', async () => {
    const error = await runWithResponse({
      content: [{ type: 'text', text: '{"summary":"looks complete"}' }],
      usage: { input_tokens: 50, output_tokens: 1024 },
      model: 'claude-test',
      stop_reason: 'max_tokens',
    }).catch((err) => err);

    expect(error.code).toBe('claude_output_truncated');
    expect(error.maxTokens).toBe(1024);
    expect(updateCalls.filter((c) => c.entitySet === 'akoya_requests')).toHaveLength(0);
    const failedAudit = auditCalls.find((c) => c.entitySet === 'wmkf_ai_runs');
    expect(failedAudit.payload.wmkf_ai_status).toBe(682090001);
    const retained = JSON.parse(failedAudit.payload.wmkf_ai_rawoutput);
    expect(retained.response.stopReason).toBe('max_tokens');
    expect(retained.response.output).toMatchObject({
      retention: 'hash',
      originalChars: 28,
    });
  });

  test.each([
    ['refusal', 'refusal', 'claude_output_refused', '{"summary":"complete"}'],
    ['missing stop reason', undefined, 'claude_output_incomplete', '{"summary":"complete"}'],
    ['context-window exhaustion', 'model_context_window_exceeded', 'claude_context_window_exceeded', '{"summary":"complete"}'],
    ['unexpected tool stop', 'tool_use', 'claude_output_incomplete', '{"summary":"complete"}'],
    ['ordinary malformed JSON', 'end_turn', 'claude_output_invalid_json', '{"summary":'],
  ])('%s fails before request persistence', async (_label, stopReason, code, text) => {
    const error = await runWithResponse({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 50, output_tokens: 20 },
      model: 'claude-test',
      ...(stopReason === undefined ? {} : { stop_reason: stopReason }),
    }).catch((err) => err);

    expect(error.code).toBe(code);
    expect(updateCalls.filter((c) => c.entitySet === 'akoya_requests')).toHaveLength(0);
    expect(auditCalls.filter((c) => c.entitySet === 'wmkf_ai_runs')).toHaveLength(1);
  });

  test('ordinary JSON prompts do not implicitly opt into provider structured output', async () => {
    await runWithResponse({
      content: [{ type: 'text', text: '{"summary":"complete"}' }],
      usage: { input_tokens: 50, output_tokens: 20 },
      model: 'claude-test',
      stop_reason: 'end_turn',
    });

    const messageBody = fetchedBodies
      .map((entry) => JSON.parse(entry.body || '{}'))
      .find((body) => Array.isArray(body.messages));
    expect(messageBody.output_config).toBeUndefined();
  });

  test('unknown generationMode fails closed before the Messages API call', async () => {
    const outputSchema = {
      ...REVIEW_SYNTHESIS_OUTPUT_SCHEMA,
      generationMode: 'native-json-scheam',
    };
    const error = await runWithResponse({
      content: [{ type: 'text', text: '{"summary":"unused"}' }],
      usage: {},
      stop_reason: 'end_turn',
    }, outputSchema).catch((err) => err);

    expect(error.message).toMatch(/unsupported generationMode/);
    const messageBodies = fetchedBodies
      .map((entry) => JSON.parse(entry.body || '{}'))
      .filter((body) => Array.isArray(body.messages));
    expect(messageBodies).toHaveLength(0);
    expect(updateCalls.filter((c) => c.entitySet === 'akoya_requests')).toHaveLength(0);
  });

  test('structured output fails closed for a reviewed model that does not support it', async () => {
    promptRow = buildPromptRow(outputs);
    promptRow.wmkf_ai_model = 'claude-sonnet-4';
    promptRow.wmkf_ai_promptoutputschema = JSON.stringify(REVIEW_SYNTHESIS_OUTPUT_SCHEMA);
    claudeResponse = {
      content: [{ type: 'text', text: '{"summary":"unused"}' }],
      usage: {},
      stop_reason: 'end_turn',
    };
    getRecordImpl = async (entitySet, id) =>
      (entitySet === 'akoya_requests' && id === REQUEST_ROW.akoya_requestid)
        ? REQUEST_ROW
        : null;

    const error = await executePrompt({
      promptName: promptRow.wmkf_ai_promptname,
      requestId: REQUEST_ROW.akoya_requestid,
      runSource: 'Vercel Test',
      overrideVariables: { x: 'value' },
    }).catch((err) => err);

    expect(error.message).toMatch(/not reviewed for native structured output/);
    const messageBodies = fetchedBodies
      .map((entry) => JSON.parse(entry.body || '{}'))
      .filter((body) => Array.isArray(body.messages));
    expect(messageBodies).toHaveLength(0);
  });

  test.each([
    ['none', { retention: 'none', originalChars: 28 }],
    ['full', '{"summary":"looks complete"}'],
  ])('failure audit applies rawOutputRetention=%s', async (rawOutputRetention, expectedOutput) => {
    const baseSchema = JSON.parse(promptRow?.wmkf_ai_promptoutputschema || JSON.stringify({
      outputs,
      parseMode: 'json',
    }));
    const error = await runWithResponse({
      content: [{ type: 'text', text: '{"summary":"looks complete"}' }],
      usage: { input_tokens: 50, output_tokens: 1024 },
      model: 'claude-test',
      stop_reason: 'max_tokens',
      stop_details: { type: 'max_tokens' },
    }, {
      ...baseSchema,
      outputs,
      parseMode: 'json',
      rawOutputRetention,
    }).catch((err) => err);

    expect(error.code).toBe('claude_output_truncated');
    const failedAudit = auditCalls.find((c) => c.entitySet === 'wmkf_ai_runs');
    const retained = JSON.parse(failedAudit.payload.wmkf_ai_rawoutput);
    expect(retained.response.output).toEqual(expectedOutput);
    // Retention governs generated output content. Provider termination metadata
    // remains content-free diagnostic state under every mode.
    expect(retained.response.stopDetails).toEqual({ type: 'max_tokens' });
  });

  test('review synthesis opt-in sends Anthropic native JSON-schema output_config', async () => {
    const synthesis = {
      synthesis: {
        consensus: [],
        disagreements: [],
        keyConcerns: [],
        ratingSummaries: [],
        overall: 'Complete.',
      },
    };
    const result = await runWithResponse({
      content: [{ type: 'text', text: JSON.stringify(synthesis) }],
      usage: { input_tokens: 50, output_tokens: 20 },
      model: 'claude-test',
      stop_reason: 'end_turn',
    }, REVIEW_SYNTHESIS_OUTPUT_SCHEMA);

    const messageBody = fetchedBodies
      .map((entry) => JSON.parse(entry.body || '{}'))
      .find((body) => Array.isArray(body.messages));
    expect(messageBody.output_config).toEqual({
      format: {
        type: 'json_schema',
        schema: REVIEW_SYNTHESIS_OUTPUT_SCHEMA.jsonSchema,
      },
    });
    expect(result.parsed).toEqual(synthesis);
    expect(result.meta).toMatchObject({
      semanticAttempt: 1,
      retryOfRunId: null,
    });
    expect(updateCalls.filter((c) => c.entitySet === 'akoya_requests')).toHaveLength(1);
  });
});
