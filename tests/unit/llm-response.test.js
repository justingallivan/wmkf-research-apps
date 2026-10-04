import { requireAcceptedLlmResponse } from '../../lib/utils/llm-response';
import { compactMessages } from '../../lib/services/dynamics-explorer/conversation';

test.each([{ refused: true }, { stopReason: 'refusal' }])('rejects either normalized refusal signal %j', marker => {
  for (const text of ['', 'valid-looking refused output']) {
    expect(() => requireAcceptedLlmResponse({ ...marker, text })).toThrow(expect.objectContaining({ code: 'model_refusal', status: 422 }));
  }
});
test('returns ordinary output unchanged', () => {
  const response = { text: 'normal', content: [], stopReason: 'end_turn', refused: false };
  expect(requireAcceptedLlmResponse(response)).toBe(response);
});

test.each(['thinking', 'redacted_thinking'])('preserves the full prefix across three rounds with %s', type => {
  let history = [{ role: 'user', content: 'Question' }];
  for (let i = 0; i < 3; i++) {
    history.push({ role: 'assistant', content: [{ type, thinking: '', signature: 'signed', data: 'encrypted' }, { type: 'tool_use', id: `tool-${i}`, name: 'query_records', input: { filter: 'must remain' } }] });
    history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool-${i}`, content: JSON.stringify({ records: ['long data'.repeat(40)] }) }] });
    const before = JSON.stringify(history);
    const compacted = compactMessages(history);
    expect(compacted).toBe(history);
    expect(JSON.stringify(compacted)).toBe(before);
    history = compacted;
  }
});

test('ordinary tool rounds still compact without mutating caller input', () => {
  const messages = [0, 1].flatMap(i => [
    { role: 'assistant', content: [{ type: 'tool_use', id: `tool-${i}`, input: { keep: 'latest only' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool-${i}`, content: JSON.stringify({ count: 3, records: ['data'.repeat(40)] }) }] },
  ]);
  const original = JSON.stringify(messages);
  const compacted = compactMessages(messages);
  expect(compacted[0].content[0].input).toEqual({});
  expect(compacted[1].content[0].content).toBe('Returned 1 records');
  expect(compacted[2]).toEqual(messages[2]);
  expect(JSON.stringify(messages)).toBe(original);
});
