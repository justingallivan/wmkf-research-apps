/** @jest-environment node */

import { DynamicsService } from '../../lib/services/dynamics-service';
import {
  findByRequestIds,
  findBySession,
  update,
  updateOrders,
} from '../../lib/dataverse/adapters/deliberation-slot';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

const originalReady = process.env.MEETING_TRACKER_SCHEMA_READY;

beforeEach(() => {
  process.env.MEETING_TRACKER_SCHEMA_READY = 'on';
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalReady === undefined) delete process.env.MEETING_TRACKER_SCHEMA_READY;
  else process.env.MEETING_TRACKER_SCHEMA_READY = originalReady;
});

test('batched request read pages the full result, expands only the session fields, and excludes cancelled sessions', async () => {
  const query = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: false });
  await findByRequestIds([REQUEST_ID]);

  expect(query).toHaveBeenCalledWith('wmkf_deliberationslots', expect.objectContaining({
    filter: expect.stringContaining('wmkf_Session/wmkf_status ne 100000002'),
    expand: expect.stringContaining('wmkf_Session($select='),
  }));
  const options = query.mock.calls[0][1];
  expect(options.top).toBeUndefined();
  expect(options.expand).toContain('wmkf_attendeerefsjson');
  expect(options.expand.toLowerCase()).not.toContain('activitypart');
});

test('slot update passes the exact ETag and authenticated actor to one PATCH', async () => {
  const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
  await update(SLOT_ID, 'W/"10"', { wmkf_order: 4 }, { actingUserSystemId: ACTOR_ID });

  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith(
    'wmkf_deliberationslots',
    SLOT_ID,
    { wmkf_order: 4 },
    { ifMatch: 'W/"10"', actingUserSystemId: ACTOR_ID },
  );
});

test('session slot read expands request and lead PD display details without party data', async () => {
  const query = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
  await findBySession(REQUEST_ID);

  const options = query.mock.calls[0][1];
  expect(options.expand).toContain('wmkf_Request($select=');
  expect(options.expand).toContain('wmkf_LeadPd($select=');
  expect(options.expand.toLowerCase()).not.toContain('activitypart');
});

test('reorder is one atomic changeset with an ETag and explicit actor per row', async () => {
  const execute = jest.spyOn(DynamicsService, 'executeChangeset').mockResolvedValue({ ok: true });
  await updateOrders([{ slotId: SLOT_ID, etag: 'W/"10"', order: 1 }], {
    actingUserSystemId: ACTOR_ID,
  });

  expect(execute).toHaveBeenCalledWith([{
    method: 'PATCH',
    url: `wmkf_deliberationslots(${SLOT_ID})`,
    ifMatch: 'W/"10"',
    body: {
      wmkf_order: 1,
      'wmkf_UpdatedBy@odata.bind': `/systemusers(${ACTOR_ID})`,
    },
  }], { actingUserSystemId: ACTOR_ID });
});

test('adapter refuses every read while readiness is not literal on', async () => {
  delete process.env.MEETING_TRACKER_SCHEMA_READY;
  const query = jest.spyOn(DynamicsService, 'queryRecords');
  expect(() => findByRequestIds([REQUEST_ID])).toThrow(/not ready/i);
  expect(query).not.toHaveBeenCalled();
});
