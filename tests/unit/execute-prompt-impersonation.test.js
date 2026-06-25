/**
 * Executor impersonation threading — end-to-end through executePrompt().
 *
 * The MSCRMCallerID impersonation feature threads a caller identity from the
 * route entry (`actingUserSystemId`) all the way down to every Dynamics write:
 *
 *   summarize-v2.js → executePrompt({ actingUserSystemId })
 *      → persistOutputs(...) → DynamicsService.updateRecord(.., { actingUserSystemId })   [field write]
 *      → writeRunRow(...)    → DynamicsService.createRecord(.., { actingUserSystemId })   [audit run row]
 *
 * `tests/unit/dynamics-service-caller-id.test.js` already proves the LAST hop:
 * that DynamicsService.{create,update}Record turn `opts.actingUserSystemId`
 * into an MSCRMCallerID header iff DYNAMICS_IMPERSONATION_ENABLED==='true'.
 *
 * What was UNCOVERED (and what this file pins) is the hop BEFORE that — that
 * executePrompt actually forwards the caller identity to *both* write sites.
 * The existing execute-prompt tests capture `opts` on updateRecord but never
 * assert its contents, and don't capture createRecord opts at all, so a
 * refactor that dropped `actingUserSystemId` from persistOutputs() or
 * writeRunRow() would pass every other test in the suite. (Codebase eval
 * 2026-05-29, "test-risk: executor impersonation end-to-end".)
 */

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((tag, fn) => fn()),
}));

// Claude transport — mocked per-test via `claudeResponse`.
let claudeResponse = null;
const originalFetch = global.fetch;
global.fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => '',
  json: async () => claudeResponse,
}));

// DynamicsService mock. We capture the opts object on BOTH write sites so the
// test can assert caller-identity threading through each hop independently.
const updateCalls = [];
const createCalls = [];
let promptRow = null;

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: jest.fn(async () => ({ records: [promptRow] })),
    getRecord: jest.fn(async (entitySet, id) => {
      if (entitySet === 'akoya_requests' && id === 'req-1') return REQUEST_ROW;
      return null;
    }),
    createRecord: jest.fn(async (entitySet, payload, opts) => {
      createCalls.push({ entitySet, payload, opts });
      return { wmkf_ai_runid: 'run-1' };
    }),
    updateRecord: jest.fn(async (entitySet, id, payload, opts) => {
      updateCalls.push({ entitySet, id, payload, opts });
      return {};
    }),
  },
}));

beforeEach(() => {
  updateCalls.length = 0;
  createCalls.length = 0;
  claudeResponse = null;
  promptRow = null;
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

afterEach(() => {
  delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
});

afterAll(() => { global.fetch = originalFetch; });

import { executePrompt } from '../../lib/services/execute-prompt';

const ACTING_GUID = '00000000-0000-0000-0000-000000000abc';

// The request row supplies the ETag; always-overwrite avoids populated-guard
// conflicts so a clean single-field write lands.
const REQUEST_ROW = {
  akoya_requestid: 'req-1',
  akoya_requestnum: '1000000',
  _etag: 'W/"00000001"',
  modifiedon: '2026-05-10T00:00:00Z',
};

function buildPromptRow() {
  return {
    wmkf_ai_promptid: 'prompt-imp',
    wmkf_ai_promptname: 'test.impersonation',
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

// Drive a full executePrompt run. `actingUserSystemId` is passed verbatim;
// omit it (pass undefined) to exercise the non-impersonated path.
async function run({ actingUserSystemId } = {}) {
  promptRow = buildPromptRow();
  setClaudeJson({ summary: 'S' });
  const args = {
    promptName: 'test.impersonation',
    requestId: 'req-1',
    runSource: 'Vercel Test',
    overrideVariables: { x: 'value' },
  };
  if (actingUserSystemId !== undefined) args.actingUserSystemId = actingUserSystemId;
  return executePrompt(args);
}

function patchCall() {
  return updateCalls.find(c => c.entitySet === 'akoya_requests');
}
function runRowCall() {
  return createCalls.find(c => c.entitySet === 'wmkf_ai_runs');
}

describe('executePrompt — caller-identity threading to Dynamics writes', () => {
  test('actingUserSystemId is forwarded to BOTH the field write and the audit run row', async () => {
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';

    const result = await run({ actingUserSystemId: ACTING_GUID });

    // Sanity: a clean run produces exactly one field PATCH and one run row.
    expect(result.writeResults.results.every(r => r.ok)).toBe(true);
    expect(patchCall()).toBeTruthy();
    expect(runRowCall()).toBeTruthy();

    // The output PATCH carries the caller id (alongside the ETag).
    expect(patchCall().opts.actingUserSystemId).toBe(ACTING_GUID);
    expect(patchCall().opts.ifMatch).toBe('W/"00000001"');

    // The audit run row carries it too.
    expect(runRowCall().opts.actingUserSystemId).toBe(ACTING_GUID);
  });

  test('threading is independent of the feature flag — executePrompt forwards the id even when impersonation is OFF (DynamicsService gates the header, not the executor)', async () => {
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false';

    await run({ actingUserSystemId: ACTING_GUID });

    // The executor's job is to thread identity; whether it becomes an
    // MSCRMCallerID header is DynamicsService's decision (covered by
    // dynamics-service-caller-id.test.js). So the id is still forwarded.
    expect(patchCall().opts.actingUserSystemId).toBe(ACTING_GUID);
    expect(runRowCall().opts.actingUserSystemId).toBe(ACTING_GUID);
  });

  test('no caller identity → field write omits actingUserSystemId; run row passes it through as null', async () => {
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';

    await run({ /* no actingUserSystemId */ });

    // persistOutputs spreads actingUserSystemId only when truthy, so the
    // PATCH opts must NOT contain the key (defaults to null inside executePrompt).
    expect(patchCall().opts).not.toHaveProperty('actingUserSystemId');
    expect(patchCall().opts.ifMatch).toBe('W/"00000001"');

    // writeRunRow always passes the option object; the value is null.
    expect(runRowCall().opts.actingUserSystemId).toBeNull();
  });

  test('explicit null caller identity behaves the same as omitted', async () => {
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';

    await run({ actingUserSystemId: null });

    expect(patchCall().opts).not.toHaveProperty('actingUserSystemId');
    expect(runRowCall().opts.actingUserSystemId).toBeNull();
  });
});
