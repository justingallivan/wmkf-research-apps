jest.mock('../../lib/services/dynamics-explorer/model-call', () => ({
  callClaudeBatch: jest.fn(),
}));

import { callClaudeBatch } from '../../lib/services/dynamics-explorer/model-call';
import { processRecordsBatch, runSampleProcessing } from '../../lib/services/dynamics-explorer/tools/batch-processing';

const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

beforeEach(() => jest.clearAllMocks());

test('sample refusal with nonempty output is terminal before JSON or fallback parsing', async () => {
  callClaudeBatch.mockResolvedValueOnce({
    text: '{"summary":"must not become sample columns"}',
    refused: true,
    stopReason: 'refusal',
    usage,
  });

  await expect(runSampleProcessing({ request: 'sample' }, 'summarize', 'profile'))
    .rejects.toMatchObject({ code: 'model_refusal' });
  expect(callClaudeBatch).toHaveBeenCalledTimes(1);
});

test('batch refusal is not retried, exported as prose, or followed by another batch chunk', async () => {
  callClaudeBatch
    .mockResolvedValueOnce({ text: '{"summary":"summary"}', usage })
    .mockResolvedValueOnce({ text: '{"summary":"refusal text must not be exported"}', refused: true, stopReason: 'refusal', usage })
    .mockResolvedValueOnce({ text: JSON.stringify(Array.from({ length: 15 }, () => ({ summary: 'ok' }))), usage })
    .mockResolvedValueOnce({ text: JSON.stringify(Array.from({ length: 15 }, () => ({ summary: 'ok' }))), usage });
  const sendEvent = jest.fn();
  const records = Array.from({ length: 46 }, (_, index) => ({ akoya_requestnum: `REQ-${index + 1}` }));

  await expect(processRecordsBatch(records, 'summarize', sendEvent, 'profile'))
    .rejects.toMatchObject({ code: 'model_refusal' });
  // One sample and the first three already-dispatched concurrent batches; no retry or next chunk.
  expect(callClaudeBatch).toHaveBeenCalledTimes(4);
  expect(sendEvent).not.toHaveBeenCalled();
  expect(records.some((record) => Object.values(record).includes('refusal text must not be exported'))).toBe(false);
});
