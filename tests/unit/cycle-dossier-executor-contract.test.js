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
import * as entry from '../../shared/config/prompts/cycle-dossier-entry.js';
import * as plan from '../../shared/config/prompts/cycle-dossier-research-plan.js';

const row = definition => ({ wmkf_ai_promptid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', wmkf_ai_promptname: definition.PROMPT_NAME, wmkf_promptversion: 1, wmkf_ai_model: 'claude-sonnet-4-6', wmkf_ai_maxtokens: 12000, wmkf_ai_systemprompt: definition.SYSTEM_PROMPT, wmkf_ai_promptbody: definition.USER_PROMPT_TEMPLATE, wmkf_ai_promptvariables: JSON.stringify(definition.VARIABLES), wmkf_ai_promptoutputschema: JSON.stringify(definition.OUTPUT_SCHEMA) });

test.each([plan, entry])('actual Executor preserves $PROMPT_NAME result and wraps every source input', async definition => {
  const previous = process.env.CLAUDE_API_KEY;
  process.env.CLAUDE_API_KEY = 'test-executor-fixture';
  const output = definition === plan ? { queries: [{ query: 'mechanism', reason: 'field context' }] } : {
    projectAtAGlance: 'Project aims', whyItMatters: 'Importance [1]', fieldAroundIt: 'Field context [1]', backgroundForOutsideField: 'Background',
    references: [{ sourceId: 'oa-1', title: 'Paper', url: 'https://example.test/paper', retrievedAt: '2026-09-07' }],
  };
  mockComplete.mockResolvedValue({ text: JSON.stringify({ ...output, injected: 'drop me' }), model: 'claude-sonnet-4-6', stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 100 } });
  try {
    const result = await executePrompt({ promptName: definition.PROMPT_NAME, promptSnapshot: row(definition), requireNoPersistence: true, runSource: 'Vercel Test', overrideVariables: Object.fromEntries(definition.VARIABLES.variables.map(v => [v.name, `UNTRUSTED ${v.name}`])) });
    expect(result.parsed).toEqual(output);
    expect(result.meta.aiPayloadBoundaries).toHaveLength(definition.VARIABLES.variables.length);
    const sent = mockComplete.mock.calls.at(-1)[0];
    expect(sent.system[0].text).toMatch(/untrusted/i);
    for (const variable of definition.VARIABLES.variables) {
      expect(sent.messages[0].content).toContain(`UNTRUSTED ${variable.name}`);
    }
  } finally {
    if (previous == null) delete process.env.CLAUDE_API_KEY; else process.env.CLAUDE_API_KEY = previous;
  }
});
