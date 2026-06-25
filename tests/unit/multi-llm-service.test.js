/**
 * MultiLLMService Claude request-shaping tests.
 *
 * The virtual-review-panel transport still owns its own retry/logging loop, but
 * its Anthropic request body must share the reviewed model capability registry
 * with LLMClient so new Claude ids do not bypass parameter compatibility rules.
 */

jest.mock('../../lib/utils/safe-fetch', () => ({
  safeFetch: jest.fn(),
}));
jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
}));

import { safeFetch } from '../../lib/utils/safe-fetch';
import { MultiLLMService } from '../../lib/services/multi-llm-service';

function claudeResponse(body = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: body.model || 'claude-sonnet-4-6',
      stop_reason: body.stopReason || 'end_turn',
      stop_details: body.stopDetails,
    }),
  };
}

function sentBody() {
  return JSON.parse(safeFetch.mock.calls.at(-1)[1].body);
}

beforeEach(() => {
  safeFetch.mockReset();
  safeFetch.mockResolvedValue(claudeResponse());
});

describe('MultiLLMService Claude capability shaping', () => {
  test('keeps temperature for reviewed temperature-capable Claude models', async () => {
    await MultiLLMService._callClaude(
      'sk-ant-test',
      'prompt',
      'system',
      'claude-sonnet-4-6',
      1000,
      0.2,
    );

    expect(sentBody()).toEqual(expect.objectContaining({
      model: 'claude-sonnet-4-6',
      temperature: 0.2,
      system: 'system',
    }));
  });

  test('omits temperature for Fable and sends effort under output_config', async () => {
    await MultiLLMService._callClaude(
      'sk-ant-test',
      'prompt',
      '',
      'claude-fable-5',
      1000,
      0.2,
      { effort: 'medium' },
    );

    const body = sentBody();
    expect(body).not.toHaveProperty('temperature');
    expect(body.output_config).toEqual({ effort: 'medium' });
  });

  test('unknown Claude ids fail closed for optional params', async () => {
    await MultiLLMService._callClaude(
      'sk-ant-test',
      'prompt',
      '',
      'claude-future-99',
      1000,
      0.2,
      { outputConfig: { effort: 'medium' } },
    );

    const body = sentBody();
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('output_config');
  });

  test('resolves tier aliases before applying Claude capabilities', async () => {
    await MultiLLMService._callClaude(
      'sk-ant-test',
      'prompt',
      '',
      'sonnet',
      1000,
      0.2,
    );

    expect(sentBody()).toEqual(expect.objectContaining({
      model: 'claude-sonnet-4-6',
      temperature: 0.2,
    }));
  });

  test('surfaces HTTP-200 refusal metadata for Fable responses', async () => {
    safeFetch.mockResolvedValueOnce(claudeResponse({
      model: 'claude-fable-5',
      stopReason: 'refusal',
      stopDetails: { classifier: 'safety' },
    }));

    const result = await MultiLLMService._callClaude(
      'sk-ant-test',
      'prompt',
      '',
      'claude-fable-5',
      1000,
      0.2,
    );

    expect(result).toEqual(expect.objectContaining({
      stopReason: 'refusal',
      stopDetails: { classifier: 'safety' },
      refused: true,
    }));
  });
});
