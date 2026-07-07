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
let getRecordImpl = async () => null;
let updateImpl = async () => ({});
let promptRow = null;

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: jest.fn(async () => ({ records: [promptRow] })),
    getRecord: jest.fn(async (...args) => getRecordImpl(...args)),
    createRecord: jest.fn(async () => 'audit-row-id'),
    updateRecord: jest.fn(async (entitySet, id, payload, opts) => {
      updateCalls.push({ entitySet, id, payload, opts });
      return updateImpl(entitySet, id, payload, opts);
    }),
  },
}));

beforeEach(() => {
  fetchedBodies.length = 0;
  updateCalls.length = 0;
  claudeResponse = null;
  promptRow = null;
  getRecordImpl = DEFAULT_GET_RECORD;
  updateImpl = async () => ({});
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

afterAll(() => { global.fetch = originalFetch; });

import { executePrompt } from '../../lib/services/execute-prompt';

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
    const patch = updateCalls.find(c => c.entitySet === 'akoya_requests');
    expect(patch.payload).toEqual({ wmkf_ai_summary: 'S' });
  });

  test('a type-invalid output (invalid-but-parseable JSON) fails the run', async () => {
    await expect(runWithSchema(SCHEMA, { summary: 12345 }))
      .rejects.toThrow(/failed schema validation/);
  });

  test('no validationSchema → parsed passes through unchanged (backward compat)', async () => {
    const result = await runWithSchema(undefined, { summary: 'S', extra: 'kept' });
    expect(result.parsed).toEqual({ summary: 'S', extra: 'kept' });
  });
});
