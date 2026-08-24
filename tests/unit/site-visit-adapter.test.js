import { DynamicsService } from '../../lib/services/dynamics-service';
import {
  PARTY_NAVIGATION_PROPERTY,
  replaceWithParties,
  update,
} from '../../lib/dataverse/adapters/site-visit';

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    updateRecord: jest.fn(async () => undefined),
    executeChangeset: jest.fn(async () => ({ ok: true })),
  },
}));

const ACTIVITY_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => jest.clearAllMocks());

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
