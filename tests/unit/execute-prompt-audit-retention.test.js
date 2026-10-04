/**
 * @jest-environment node
 *
 * `auditRetention: 'content-free'` (Zoom VTT speaker mapping plan D9): every
 * wmkf_ai_run write for the call, on every path, carries no input or model
 * text. Each case captures ALL aiRunAdapter.create payloads and asserts the
 * sentinels are absent from the serialized payloads.
 */

const mockClaudeComplete = jest.fn();
const mockFetchCurrentPrompt = jest.fn();

jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: (_tag, fn) => fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/ai-run.js', () => ({
  create: jest.fn(async () => ({ wmkf_ai_runid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99' })),
}));
jest.mock('../../lib/services/model-resolver.js', () => ({
  resolveModel: value => value,
  loadAvailableModels: jest.fn(async () => []),
  resolveModelWithCapabilities: (value) => {
    const { requestCapabilitiesForModel } = require('../../lib/services/model-capabilities.js');
    return { model: value, capabilities: requestCapabilitiesForModel(value) };
  },
}));
jest.mock('../../lib/services/llm-client.js', () => ({
  DEFAULT_TIMEOUT_MS: 120000,
  LLMClient: jest.fn().mockImplementation(() => ({ complete: mockClaudeComplete })),
}));
jest.mock('../../lib/services/openai-client.js', () => ({
  OpenAIClient: jest.fn().mockImplementation(() => ({ complete: jest.fn() })),
}));
jest.mock('../../lib/services/prompt-store.js', () => ({
  ...jest.requireActual('../../lib/services/prompt-store.js'),
  fetchCurrentPrompt: (...args) => mockFetchCurrentPrompt(...args),
}));

import { executePrompt } from '../../lib/services/execute-prompt.js';
import * as aiRunAdapter from '../../lib/dataverse/adapters/ai-run.js';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';

const T = 'TRANSCRIPT_SENTINEL_7f3a';
const N = 'NAME_SENTINEL_9c2e';
const OVERRIDES = {
  speaker_samples: `${T} speaker samples`,
  zoom_names: `${N} zoom names`,
};
const ORIGINAL_ENV = {
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  AI_PAYLOAD_NONCE_SECRET: process.env.AI_PAYLOAD_NONCE_SECRET,
};

function snapshot(overrides = {}) {
  return {
    wmkf_ai_promptid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    wmkf_ai_promptname: 'audit.test',
    wmkf_promptversion: 1,
    wmkf_ai_model: 'claude-sonnet-5-5',
    wmkf_ai_maxtokens: 1000,
    wmkf_ai_temperature: 0.2,
    wmkf_ai_systemprompt: 'SYSTEM',
    wmkf_ai_promptbody: 'BODY {{speaker_samples}} {{zoom_names}}',
    // No dataClass / maxChars: declaration-based redaction would NOT apply.
    wmkf_ai_promptvariables: JSON.stringify({
      variables: [
        { name: 'speaker_samples', source: { kind: 'override' }, required: true },
        { name: 'zoom_names', source: { kind: 'override' }, required: true },
      ],
    }),
    wmkf_ai_promptoutputschema: JSON.stringify({
      parseMode: 'json',
      rawOutputRetention: 'full',
      outputs: [{ name: 'answer', target: { kind: 'none' } }],
      jsonSchema: { type: 'object', required: ['answer'] },
    }),
    ...overrides,
  };
}

function modelResponse(text) {
  return {
    text,
    content: [{ type: 'text', text }],
    model: 'claude-sonnet-5-5',
    usage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 },
    stopReason: 'end_turn',
    stopDetails: null,
    refused: false,
    usageComplete: true,
  };
}

function run(extra = {}) {
  return executePrompt({
    promptName: 'audit.test',
    promptSnapshot: snapshot(),
    runSource: 'Vercel Test',
    requireNoPersistence: true,
    overrideVariables: OVERRIDES,
    ...extra,
  });
}

function payloads() {
  return aiRunAdapter.create.mock.calls.map(([payload]) => payload);
}

function notesKeys(payload) {
  return payload.wmkf_ai_notes.split('; ').map((f) => f.split('=')[0]).sort();
}

function expectNoSentinels() {
  const all = payloads();
  expect(all.length).toBeGreaterThan(0);
  for (const payload of all) {
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(T);
    expect(serialized).not.toContain(N);
  }
}

beforeEach(() => {
  process.env.CLAUDE_API_KEY = 'claude-test-key';
  process.env.AI_PAYLOAD_NONCE_SECRET = 'audit-test-nonce-secret-that-is-long-enough';
  aiRunAdapter.create.mockClear();
  mockClaudeComplete.mockReset().mockResolvedValue(modelResponse(`{"answer":"${T} ${N}"}`));
  mockFetchCurrentPrompt.mockReset();
});

afterAll(() => {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('executePrompt auditRetention', () => {
  it('success path: content-free drops sentinels; default path keeps them', async () => {
    await run();
    const defaultJson = JSON.stringify(payloads());
    expect(defaultJson).toContain(T);
    expect(defaultJson).toContain(N);

    aiRunAdapter.create.mockClear();
    await run({ auditRetention: 'content-free' });
    expectNoSentinels();
    const [payload] = payloads();
    expect(payload.wmkf_ai_status).toBeDefined();
    expect(JSON.parse(payload.wmkf_ai_promptoverride)).toEqual({
      speaker_samples: `[redacted: ${OVERRIDES.speaker_samples.length} chars]`,
      zoom_names: `[redacted: ${OVERRIDES.zoom_names.length} chars]`,
    });
    expect(notesKeys(payload)).toEqual(['semanticAttempt', 'stopReason']);
    expect(JSON.parse(payload.wmkf_ai_rawoutput)).toEqual({
      retention: 'none',
      originalChars: expect.any(Number),
    });
  });

  it('prompt fetch failure', async () => {
    mockFetchCurrentPrompt.mockRejectedValue(new Error(`dataverse down ${T} ${N}`));
    await expect(run({ promptSnapshot: null, auditRetention: 'content-free' })).rejects.toThrow();
    expectNoSentinels();
  });

  it('model resolution failure (unknown model)', async () => {
    await expect(run({
      promptSnapshot: snapshot({ wmkf_ai_model: 'claude-unreviewed-model-9' }),
      auditRetention: 'content-free',
    })).rejects.toThrow();
    expect(mockClaudeComplete).not.toHaveBeenCalled();
    expectNoSentinels();
  });

  it('declaration parse failure', async () => {
    await expect(run({
      promptSnapshot: snapshot({ wmkf_ai_promptvariables: `{ not json ${T}` }),
      auditRetention: 'content-free',
    })).rejects.toThrow();
    expectNoSentinels();
  });

  it('provider call failure', async () => {
    mockClaudeComplete.mockRejectedValue(new Error(`provider exploded ${T} ${N}`));
    await expect(run({ auditRetention: 'content-free' })).rejects.toThrow();
    expectNoSentinels();
  });

  it('invalid model JSON: envelope is code and stopReason only', async () => {
    mockClaudeComplete.mockResolvedValue(modelResponse(`${T} not json`));
    await expect(run({ auditRetention: 'content-free' })).rejects.toThrow();
    expectNoSentinels();
    const failed = payloads().at(-1);
    expect(Object.keys(JSON.parse(failed.wmkf_ai_rawoutput)).sort()).toEqual(['code', 'stopReason']);
    expect(failed.wmkf_ai_notes).not.toMatch(/Executor error/);
    expect(notesKeys(failed).every((k) => ['semanticAttempt', 'retryOf', 'code', 'stopReason'].includes(k))).toBe(true);
  });

  it('pre-flight blocked: no sentinel, rawoutput is {blocked:true}', async () => {
    grantRequestAdapter.getById.mockResolvedValue({ wmkf_target_field: `${T} ${N} existing` });
    const row = snapshot({
      wmkf_ai_promptoutputschema: JSON.stringify({
        parseMode: 'raw',
        outputs: [{ name: 'answer', target: { kind: 'akoya_request', field: 'wmkf_target_field' } }],
      }),
    });
    const result = await run({
      promptSnapshot: row,
      requireNoPersistence: false,
      requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      auditRetention: 'content-free',
    });
    expect(result.blocked).toBe(true);
    expect(mockClaudeComplete).not.toHaveBeenCalled();
    expectNoSentinels();
    const [payload] = payloads();
    expect(JSON.parse(payload.wmkf_ai_rawoutput)).toEqual({ blocked: true });
    expect(payload.wmkf_ai_notes).toContain('preflightBlocked=true');
  });

  it('invalid option value throws before any create call', async () => {
    await expect(run({ auditRetention: 'full' })).rejects.toThrow('executePrompt: invalid auditRetention');
    expect(aiRunAdapter.create).not.toHaveBeenCalled();
    expect(mockClaudeComplete).not.toHaveBeenCalled();
  });
});
