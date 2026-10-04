jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn(),
}));

const { LLMClient } = require('../../lib/services/llm-client');
const { callClaude, callClaudeBatch } = require('../../lib/services/dynamics-explorer/model-call');

describe('Dynamics Explorer model call configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('interactive calls stream with response headroom, low effort, and caller options', async () => {
    const stream = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'answer' }],
      model: 'claude-sonnet-test',
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cacheCreationTokens: 2,
        cacheReadTokens: 3,
      },
      stopReason: 'end_turn',
      refused: false,
      textStreamed: true,
    });
    const complete = jest.fn();
    LLMClient.mockImplementation(() => ({ stream, complete }));

    const onTextDelta = jest.fn();
    const signal = { aborted: false };
    const messages = [{ role: 'user', content: 'question' }];
    const tools = [{ name: 'search' }];
    const result = await callClaude({
      apiKey: 'test-key',
      model: 'claude-sonnet-test',
      fallbackModel: 'claude-haiku-test',
      systemPrompt: 'system instructions',
      messages,
      tools,
      userProfileId: 'user-1',
      requestId: 'request-1',
      requestRound: 2,
      signal,
      onTextDelta,
    });

    expect(LLMClient).toHaveBeenCalledWith({
      apiKey: 'test-key',
      model: 'claude-sonnet-test',
      fallbackModel: 'claude-haiku-test',
      appName: 'dynamics-explorer',
      userProfileId: 'user-1',
      requestId: 'request-1',
      requestRound: 2,
    });
    expect(stream).toHaveBeenCalledWith({
      system: [{
        type: 'text',
        text: 'system instructions',
        cache_control: { type: 'ephemeral' },
      }],
      messages,
      tools,
      maxTokens: 16000,
      outputConfig: { effort: 'low' },
      signal,
      onTextDelta,
    });
    expect(complete).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: [{ type: 'text', text: 'answer' }],
      model: 'claude-sonnet-test',
      usage: {
        input_tokens: 11,
        output_tokens: 7,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
      },
      stopReason: 'end_turn',
      refused: false,
      _textStreamed: true,
    });
  });

  test('batch exports complete with their separate 4096-token limit', async () => {
    const complete = jest.fn().mockResolvedValue({
      text: 'export result',
      usage: {
        inputTokens: 13,
        outputTokens: 5,
        cacheCreationTokens: 1,
        cacheReadTokens: 4,
      },
    });
    const stream = jest.fn();
    LLMClient.mockImplementation(() => ({ stream, complete }));
    const previousApiKey = process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_API_KEY = 'batch-test-key';

    try {
      const result = await callClaudeBatch({
        systemPrompt: 'batch instructions',
        userMessage: 'export this',
        userProfileId: 'user-2',
      });

      expect(LLMClient).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'batch-test-key',
        appName: 'dynamics-explorer-export',
        userProfileId: 'user-2',
      }));
      expect(complete).toHaveBeenCalledWith({
        system: [{
          type: 'text',
          text: 'batch instructions',
          cache_control: { type: 'ephemeral' },
        }],
        messages: [{ role: 'user', content: 'export this' }],
        maxTokens: 4096,
      });
      expect(stream).not.toHaveBeenCalled();
      expect(result).toEqual({
        text: 'export result',
        usage: {
          input_tokens: 13,
          output_tokens: 5,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 4,
        },
      });
    } finally {
      if (previousApiKey === undefined) delete process.env.CLAUDE_API_KEY;
      else process.env.CLAUDE_API_KEY = previousApiKey;
    }
  });

  test.each([
    [{ refused: true }, { refused: true }],
    [{ stopReason: 'refusal' }, { stopReason: 'refusal' }],
  ])('batch adapter preserves provider refusal metadata %j for its text consumer', async (marker, expected) => {
    const complete = jest.fn().mockResolvedValue({
      text: 'provider refusal text',
      ...marker,
      usage: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });
    LLMClient.mockImplementation(() => ({ complete }));
    const previousApiKey = process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_API_KEY = 'batch-test-key';
    try {
      await expect(callClaudeBatch({ systemPrompt: 'system', userMessage: 'user', userProfileId: 'user-2' })).resolves.toMatchObject({
        text: 'provider refusal text', ...expected,
      });
    } finally {
      if (previousApiKey === undefined) delete process.env.CLAUDE_API_KEY;
      else process.env.CLAUDE_API_KEY = previousApiKey;
    }
  });
});
