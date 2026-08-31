/** @jest-environment node */

jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { queryAllRecords: jest.fn(async () => ({ records: [] })) },
}));
jest.mock('../../lib/utils/final-writeup-readiness.js', () => ({
  isFinalWriteupSchemaReady: jest.fn(() => false),
}));
jest.mock('../../lib/utils/guarded-reopen-readiness.js', () => ({
  isGuardedReopenSchemaReady: jest.fn(() => false),
}));

import {
  ENTITY_SET_NAME,
  findByIds,
  REQUEST_DOCUMENT_BATCH_MAX_IDS,
} from '../../lib/dataverse/adapters/request-document.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => jest.clearAllMocks());

test('batch-read uses exact GUID filters and a paginated read', async () => {
  await findByIds([DOCUMENT_ID]);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith(
    ENTITY_SET_NAME,
    expect.objectContaining({
      filter: `(wmkf_requestdocumentid eq ${DOCUMENT_ID})`,
      orderby: 'createdon desc',
    }),
  );
});

test('batch-read rejects malformed or over-broad identity sets before transport', async () => {
  await expect(findByIds(['not-a-guid'])).rejects.toThrow(/must be a GUID/);
  await expect(findByIds(Array.from(
    { length: REQUEST_DOCUMENT_BATCH_MAX_IDS + 1 },
    (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
  ))).rejects.toThrow(/at most/);
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
});
