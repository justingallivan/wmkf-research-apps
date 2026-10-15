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

test('list facts preserve provenance and schema gates while dropping document bodies', async () => {
  const { findByRequests } = jest.requireActual('../../lib/dataverse/adapters/request-document.js');
  const { isFinalWriteupSchemaReady } = jest.requireMock('../../lib/utils/final-writeup-readiness.js');
  await findByRequests([DOCUMENT_ID], { listFactsOnly: true, includeGuardedReopen: true });
  let fields = DynamicsService.queryAllRecords.mock.calls.at(-1)[1].select.split(',');
  expect(fields).toEqual(expect.arrayContaining(['wmkf_producer', 'wmkf_milestonecontenthash', '_wmkf_sourcedocument_value', 'wmkf_reopencycleid']));
  expect(fields).not.toContain('wmkf_presiteproposalcorejson');
  expect(fields).not.toContain('wmkf_groupreviewstartedat');
  isFinalWriteupSchemaReady.mockReturnValueOnce(true);
  await findByRequests([DOCUMENT_ID], { listFactsOnly: true });
  fields = DynamicsService.queryAllRecords.mock.calls.at(-1)[1].select.split(',');
  expect(fields).toContain('wmkf_groupreviewstartedat');
  await findByRequests([DOCUMENT_ID]);
  expect(DynamicsService.queryAllRecords.mock.calls.at(-1)[1].select).toContain('wmkf_presiteproposalcorejson');
});
