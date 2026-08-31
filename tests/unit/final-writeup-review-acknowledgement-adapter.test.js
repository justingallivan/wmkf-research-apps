import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  ACKNOWLEDGEMENT_SELECT_FIELDS,
  create,
  ENTITY_SET_NAME,
  findByFinalDocuments,
  findByFinalDocument,
  findByFinalDocumentAndReviewer,
  update,
} from '../../lib/dataverse/adapters/final-writeup-review-acknowledgement.js';

jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: {
    queryAllRecords: jest.fn(async () => ({ records: [] })),
    queryRecords: jest.fn(async () => ({ records: [] })),
    createRecord: jest.fn(async () => ({ id: 'created' })),
    updateRecord: jest.fn(async () => undefined),
  },
}));

const FINAL_ID = '11111111-1111-4111-8111-111111111111';
const REVIEWER_ID = '22222222-2222-4222-8222-222222222222';
const ACK_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => jest.clearAllMocks());

test('uses the metadata-confirmed entity set and named projection', () => {
  expect(ENTITY_SET_NAME).toBe('wmkf_finalwriteupreviewacknowledgements');
  expect(ACKNOWLEDGEMENT_SELECT_FIELDS).toEqual(expect.arrayContaining([
    'wmkf_finalwriteupreviewacknowledgementid',
    '_wmkf_finaldocument_value',
    '_wmkf_reviewer_value',
    'wmkf_publicationversionid',
    'wmkf_acknowledgedat',
  ]));
});

test('reads all acknowledgements for one exact Final artifact', async () => {
  await findByFinalDocument(FINAL_ID);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith(
    ENTITY_SET_NAME,
    expect.objectContaining({
      filter: `_wmkf_finaldocument_value eq ${FINAL_ID}`,
      orderby: 'wmkf_acknowledgedat asc',
    }),
  );
});

test('reads at most two rows for the composite alternate-key identity', async () => {
  await findByFinalDocumentAndReviewer(FINAL_ID, REVIEWER_ID);
  expect(DynamicsService.queryRecords).toHaveBeenCalledWith(
    ENTITY_SET_NAME,
    expect.objectContaining({
      filter: `_wmkf_finaldocument_value eq ${FINAL_ID} and _wmkf_reviewer_value eq ${REVIEWER_ID}`,
      top: 2,
    }),
  );
});

test('batch-reads acknowledgements for server-derived Final identities', async () => {
  await findByFinalDocuments([FINAL_ID]);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith(
    ENTITY_SET_NAME,
    expect.objectContaining({
      filter: `(_wmkf_finaldocument_value eq ${FINAL_ID})`,
      orderby: 'wmkf_acknowledgedat asc',
    }),
  );
});

test('create and conditional update pass payload and actor options through unchanged', async () => {
  const payload = { wmkf_name: '1001 — Ada Reviewer' };
  const options = { actingUserSystemId: REVIEWER_ID, noFallback: true };
  await create(payload, options);
  expect(DynamicsService.createRecord).toHaveBeenCalledWith(ENTITY_SET_NAME, payload, options);

  const patch = { wmkf_publicationversionid: '2.0' };
  const updateOptions = { ...options, ifMatch: 'W/"2"' };
  await update(ACK_ID, patch, updateOptions);
  expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
    ENTITY_SET_NAME,
    ACK_ID,
    patch,
    updateOptions,
  );
});

test('rejects non-GUID lookup filters before transport', async () => {
  await expect(findByFinalDocument('not-a-guid')).rejects.toThrow(/must be a GUID/);
  await expect(findByFinalDocumentAndReviewer(FINAL_ID, 'not-a-guid'))
    .rejects.toThrow(/must be a GUID/);
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
  expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
});
