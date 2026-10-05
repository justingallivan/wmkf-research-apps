import { DynamicsService } from '../../lib/services/dynamics-service';
import {
  PARTY_NAVIGATION_PROPERTY,
  findActiveSummariesByRequests,
  replaceWithParties,
  update,
} from '../../lib/dataverse/adapters/site-visit';

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    updateRecord: jest.fn(async () => undefined),
    executeChangeset: jest.fn(async () => ({ ok: true })),
    queryAllRecords: jest.fn(async () => ({ records: [], totalCount: 0, capped: false })),
  },
}));

const ACTIVITY_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY;
});

test('field-only update is an ETag-fenced PATCH', async () => {
  await update(ACTIVITY_ID, 'W/"2"', { subject: 'Updated' }, {
    actingUserSystemId: ACTOR_ID,
  });
  expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
    'wmkf_sitevisits',
    ACTIVITY_ID,
    { subject: 'Updated' },
    { ifMatch: 'W/"2"', actingUserSystemId: ACTOR_ID },
  );
});

test('party change atomically deletes and recreates the same activity ID with nested parties', async () => {
  await replaceWithParties({
    activityId: ACTIVITY_ID,
    etag: 'W/"2"',
    payload: { subject: 'Updated' },
    parties: [{
      participationtypemask: 7,
      addressused: 'organizer@wmkeck.org',
      systemUserId: ACTOR_ID,
    }],
    actingUserSystemId: ACTOR_ID,
  });

  expect(DynamicsService.executeChangeset).toHaveBeenCalledWith([
    {
      method: 'DELETE',
      url: `wmkf_sitevisits(${ACTIVITY_ID})`,
      ifMatch: 'W/"2"',
    },
    {
      method: 'POST',
      url: 'wmkf_sitevisits',
      body: {
        subject: 'Updated',
        activityid: ACTIVITY_ID,
        [PARTY_NAVIGATION_PROPERTY]: [{
          participationtypemask: 7,
          addressused: 'organizer@wmkeck.org',
          'partyid_systemuser@odata.bind': `/systemusers(${ACTOR_ID})`,
        }],
      },
    },
  ], { actingUserSystemId: ACTOR_ID });
  expect(JSON.stringify(DynamicsService.executeChangeset.mock.calls[0][0]))
    .not.toContain('activityparties');
});

test('summary batch returns no reads for empty ids and deduplicates mixed-case GUIDs', async () => {
  await expect(findActiveSummariesByRequests([])).resolves.toEqual({ records: [], totalCount: 0, capped: false });
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();

  DynamicsService.queryAllRecords.mockResolvedValueOnce({
    records: [{ activityid: ACTIVITY_ID }], totalCount: 1, capped: false,
  });
  const lowercaseRequestId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  expect(lowercaseRequestId.toUpperCase()).not.toBe(lowercaseRequestId);
  const result = await findActiveSummariesByRequests([lowercaseRequestId, lowercaseRequestId.toUpperCase()]);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledTimes(1);
  const [entitySet, options] = DynamicsService.queryAllRecords.mock.calls[0];
  expect(entitySet).toBe('wmkf_sitevisits');
  expect(options).toMatchObject({
    select: 'activityid,_regardingobjectid_value,scheduledstart,scheduledend,modifiedon,statecode,statuscode',
    filter: expect.stringContaining('_regardingobjectid_value eq'),
  });
  expect(options).not.toHaveProperty('expand');
  expect(result).toEqual({ records: [{ activityid: ACTIVITY_ID }], totalCount: 1, capped: false });
});

test.each([[25, 1], [26, 2], [51, 3]])('summary batch chunks %i distinct request IDs into %i paginated reads', async (idCount, expectedCalls) => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [], totalCount: 0, capped: false });
  const ids = Array.from({ length: idCount }, (_, index) => `${index + 1}`.padStart(8, '0') + '-1111-4111-8111-111111111111');
  const result = await findActiveSummariesByRequests(ids);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledTimes(expectedCalls);
  expect(result).toEqual({ records: [], totalCount: 0, capped: false });
  for (const [, options] of DynamicsService.queryAllRecords.mock.calls) {
    expect(options.select).toBe('activityid,_regardingobjectid_value,scheduledstart,scheduledend,modifiedon,statecode,statuscode');
    expect(options).not.toHaveProperty('expand');
  }
});

test('summary batch selects only ready logistics fields and propagates the bounded cap', async () => {
  process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY = 'on';
  DynamicsService.queryAllRecords.mockResolvedValueOnce({ records: [], totalCount: 5000, capped: true });
  const result = await findActiveSummariesByRequests([ACTIVITY_ID]);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('wmkf_sitevisits', expect.objectContaining({
    select: 'activityid,_regardingobjectid_value,scheduledstart,scheduledend,modifiedon,statecode,statuscode,wmkf_visitformat,wmkf_locationorlink',
  }));
  expect(result).toEqual({ records: [], totalCount: 5000, capped: true });
});
