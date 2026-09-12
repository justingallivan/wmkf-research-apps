/**
 * Executor `signal` argument (S509 hardening): an optional caller-owned
 * AbortSignal, combined with the internal `deadlineMs` abort via
 * `AbortSignal.any`, so a caller (e.g. the Cycle Dossier worker's operator-
 * stop poll) can interrupt an in-flight paid call. See docs/EXECUTOR_CONTRACT.md.
 */
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: (_tag, fn) => fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn(async () => null) }));
jest.mock('../../lib/dataverse/adapters/ai-run.js', () => ({ create: jest.fn(async () => ({ wmkf_ai_runid: 'audit' })) }));
jest.mock('../../lib/services/model-resolver.js', () => ({
  resolveModel: value => value,
  loadAvailableModels: jest.fn(async () => []),
  resolveModelWithCapabilities: value => ({ model: value, capabilities: { maxOutputTokens: 16000, supportsStructuredOutput: true } }),
}));
const mockComplete = jest.fn();
jest.mock('../../lib/services/llm-client.js', () => ({
  DEFAULT_TIMEOUT_MS: 120000,
  LLMClient: jest.fn().mockImplementation(() => ({ complete: mockComplete })),
}));
import { executePrompt } from '../../lib/services/execute-prompt.js';

const PROMPT_ROW = {
  wmkf_ai_promptid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  wmkf_ai_promptname: 'signal-test-prompt',
  wmkf_promptversion: 1,
  wmkf_ai_model: 'claude-sonnet-4-6',
  wmkf_ai_maxtokens: 1000,
  wmkf_ai_systemprompt: 'SYS',
  wmkf_ai_promptbody: 'BODY {{topic}}',
  wmkf_ai_promptvariables: JSON.stringify({ variables: [{ name: 'topic', source: { kind: 'override' } }] }),
  wmkf_ai_promptoutputschema: JSON.stringify({ parseMode: 'raw', outputs: [{ name: 'topic', target: { kind: 'none' } }] }),
};

function run(overrides = {}) {
  return executePrompt({
    promptName: PROMPT_ROW.wmkf_ai_promptname,
    promptSnapshot: PROMPT_ROW,
    requireNoPersistence: true,
    runSource: 'Vercel Test',
    overrideVariables: { topic: 'x' },
    ...overrides,
  });
}

describe('executePrompt signal argument', () => {
  let previousKey;
  beforeEach(() => {
    previousKey = process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_API_KEY = 'test-signal-fixture';
    mockComplete.mockReset();
  });
  afterEach(() => {
    if (previousKey == null) delete process.env.CLAUDE_API_KEY; else process.env.CLAUDE_API_KEY = previousKey;
  });

  test('rejects a non-AbortSignal value before doing any work', async () => {
    await expect(run({ signal: {} })).rejects.toThrow('signal must be an AbortSignal');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('a pre-aborted signal throws its reason before the model call is made', async () => {
    const controller = new AbortController();
    const reason = new Error('operator stop');
    controller.abort(reason);
    await expect(run({ signal: controller.signal })).rejects.toBe(reason);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('with deadlineMs and signal both set, client.complete receives a combined signal and the caller reason propagates unwrapped', async () => {
    const controller = new AbortController();
    const reason = Object.assign(new Error('Work is paused.'), { interrupted: true });
    let sentSignal = null;
    mockComplete.mockImplementation((opts) => {
      sentSignal = opts.signal;
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
      });
    });

    const pending = run({ signal: controller.signal, deadlineMs: Date.now() + 60000 });
    // Let callClaude actually reach client.complete before aborting.
    while (mockComplete.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(sentSignal).toBeInstanceOf(AbortSignal);
    expect(sentSignal.aborted).toBe(true);
    expect(sentSignal.reason).toBe(reason);
  });

  test('with no caller signal, deadlineMs alone still works (existing typed exhaustion preserved)', async () => {
    mockComplete.mockImplementation((opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
    }));
    await expect(run({ deadlineMs: Date.now() - 1 }))
      .rejects.toMatchObject({ code: 'executor_deadline_exhausted' });
  });
});
