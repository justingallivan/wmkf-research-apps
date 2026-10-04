jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    resolveEntitySetName: jest.fn(async () => 'akoya_requests'),
    queryRecords: jest.fn(),
    queryAllRecords: jest.fn(),
  },
}));

jest.mock('../../lib/services/dynamics-explorer/model-call', () => ({
  callClaudeBatch: jest.fn(),
}));

jest.mock('../../lib/services/dynamics-explorer/tool-errors', () => ({
  validateEffectiveODataCall: jest.fn(async () => ({ reject: null })),
  validatorReject: jest.fn(),
}));

import { DynamicsService } from '../../lib/services/dynamics-service';
import { callClaudeBatch } from '../../lib/services/dynamics-explorer/model-call';
import { exportCsv } from '../../lib/services/dynamics-explorer/tools/export';

const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const refusal = { text: '{"summary":"PRIVATE_REFUSAL_TEXT"}', refused: true, stopReason: 'refusal', usage };
const record = { akoya_requestnum: 'REQ-1', akoya_name: 'Test request' };

beforeEach(() => {
  jest.clearAllMocks();
});

test('estimate export stops on a nonempty sample refusal without preview or file_ready', async () => {
  DynamicsService.queryRecords.mockResolvedValueOnce({ records: [record], totalCount: 1 });
  callClaudeBatch.mockResolvedValueOnce(refusal);
  const sendEvent = jest.fn();

  await expect(exportCsv({ table_name: 'akoya_requests', select: 'akoya_requestnum', process_instruction: 'Summarize' }, sendEvent, 'profile'))
    .rejects.toMatchObject({ code: 'model_refusal' });

  expect(callClaudeBatch).toHaveBeenCalledTimes(1);
  expect(sendEvent).not.toHaveBeenCalled();
});

test('confirmed export stops on a nonempty batch refusal before any file_ready event', async () => {
  DynamicsService.queryAllRecords.mockResolvedValueOnce({ records: [record], totalCount: 1, capped: false });
  callClaudeBatch
    .mockResolvedValueOnce({ text: '{"summary":"sample columns"}', usage })
    .mockResolvedValueOnce(refusal);
  const sendEvent = jest.fn();

  await expect(exportCsv({ table_name: 'akoya_requests', select: 'akoya_requestnum', process_instruction: 'Summarize', confirmed: true }, sendEvent, 'profile'))
    .rejects.toMatchObject({ code: 'model_refusal' });

  expect(callClaudeBatch).toHaveBeenCalledTimes(2);
  expect(sendEvent).not.toHaveBeenCalled();
});
